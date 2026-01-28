
import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { ukgClient } from "./ukg";
import { RETAIL_JOB_CODES } from "@shared/schema";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { isHoliday } from "./holidays";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";

const TIMEZONE = "America/New_York";

// Create a date with specific time in EST timezone
function createESTTime(baseDate: Date, hours: number, minutes: number = 0): Date {
  const zonedDate = toZonedTime(baseDate, TIMEZONE);
  zonedDate.setHours(hours, minutes, 0, 0);
  return fromZonedTime(zonedDate, TIMEZONE);
}

// Middleware to require authentication (uses session user like rest of codebase)
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = (req.session as any)?.user;
  if (!user) {
    return res.status(401).json({ message: "Authentication required" });
  }
  next();
}

// Middleware to require admin role
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req.session as any)?.user;
  if (!user || user.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Register object storage routes for PDF document uploads
  registerObjectStorageRoutes(app);

  // === Employees ===
  app.get(api.employees.list.path, async (req, res) => {
    const user = (req.session as any)?.user;
    
    // Viewers cannot access the employee list
    if (user?.role === "viewer") {
      return res.status(403).json({ message: "You do not have permission to view the employee list" });
    }
    
    let employees = await storage.getEmployees();
    
    // Filter by retail job codes if requested
    const retailOnly = req.query.retailOnly === "true";
    if (retailOnly) {
      employees = employees.filter(emp => 
        RETAIL_JOB_CODES.some(code => emp.jobTitle.toUpperCase().includes(code))
      );
    }
    
    // Filter by location for non-admin users with assigned locations
    // user.locationIds contains location IDs (as strings), but emp.location contains location NAMES
    // We need to look up the location names from the IDs
    // Admins can see all employees regardless of locationIds
    if (user && user.role !== "admin" && user.locationIds && user.locationIds.length > 0) {
      const allLocations = await storage.getLocations();
      const userLocationNames = allLocations
        .filter(loc => user.locationIds.includes(String(loc.id)))
        .map(loc => loc.name);
      
      employees = employees.filter(emp => 
        emp.location && userLocationNames.includes(emp.location)
      );
    }
    
    res.json(employees);
  });

  app.get(api.employees.get.path, async (req, res) => {
    const employee = await storage.getEmployee(Number(req.params.id));
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    res.json(employee);
  });

  app.post(api.employees.create.path, async (req, res) => {
    try {
      const input = api.employees.create.input.parse(req.body);
      const employee = await storage.createEmployee(input);
      res.status(201).json(employee);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.put(api.employees.update.path, async (req, res) => {
    try {
      const input = api.employees.update.input.parse(req.body);
      const employee = await storage.updateEmployee(Number(req.params.id), input);
      res.json(employee);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      return res.status(404).json({ message: "Employee not found" });
    }
  });

  app.delete(api.employees.delete.path, async (req, res) => {
    await storage.deleteEmployee(Number(req.params.id));
    res.status(204).send();
  });

  // === Shifts ===
  app.get(api.shifts.list.path, async (req, res) => {
    // Parse query params for filtering
    const start = req.query.start ? new Date(req.query.start as string) : undefined;
    const end = req.query.end ? new Date(req.query.end as string) : undefined;
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
    
    const shifts = await storage.getShifts(start, end, employeeId);
    res.json(shifts);
  });

  app.post(api.shifts.create.path, async (req, res) => {
    try {
      // Coerce dates from strings if necessary (though Zod usually handles this if schema is set up right)
      // The schema expects dates/timestamps.
      const input = api.shifts.create.input.parse({
        ...req.body,
        startTime: new Date(req.body.startTime),
        endTime: new Date(req.body.endTime)
      });
      const shift = await storage.createShift(input);
      res.status(201).json(shift);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.put(api.shifts.update.path, async (req, res) => {
    try {
       const body = { ...req.body };
       if (body.startTime) body.startTime = new Date(body.startTime);
       if (body.endTime) body.endTime = new Date(body.endTime);

      const input = api.shifts.update.input.parse(body);
      const shift = await storage.updateShift(Number(req.params.id), input);
      res.json(shift);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      return res.status(404).json({ message: "Shift not found" });
    }
  });

  app.delete(api.shifts.delete.path, async (req, res) => {
    await storage.deleteShift(Number(req.params.id));
    res.status(204).send();
  });

  // === PAL (Paid Annual Leave) Entries ===
  // Get PAL entries from UKG time clock data (paycodeId = 2) for a date range
  app.get("/api/pal-entries", async (req, res) => {
    try {
      const startDate = req.query.start as string;
      const endDate = req.query.end as string;
      
      if (!startDate || !endDate) {
        return res.status(400).json({ message: "start and end query parameters are required" });
      }
      
      // Get PAL entries from storage
      const palEntries = await storage.getPALEntries(startDate, endDate);
      
      // Get employee data to map UKG IDs to employee records
      const employees = await storage.getEmployees();
      const employeeByUkgId = new Map(
        employees.filter(e => e.ukgEmployeeId).map(e => [e.ukgEmployeeId, e])
      );
      
      // Enrich PAL entries with employee info
      const enrichedEntries = palEntries.map(entry => {
        const employee = employeeByUkgId.get(entry.ukgEmployeeId);
        return {
          ...entry,
          employeeId: employee?.id || null,
          employeeName: employee?.name || "Unknown",
          // Convert total hours from minutes to hours
          hoursDecimal: entry.totalHours / 60,
        };
      });
      
      res.json(enrichedEntries);
    } catch (error) {
      console.error("Error fetching PAL entries:", error);
      res.status(500).json({ message: "Failed to fetch PAL entries" });
    }
  });

  // === Unpaid Time Off Entries ===
  // Get unpaid time off entries from UKG time clock data (paycodeId = 4) for a date range
  app.get("/api/unpaid-time-off-entries", async (req, res) => {
    try {
      const startDate = req.query.start as string;
      const endDate = req.query.end as string;
      
      if (!startDate || !endDate) {
        return res.status(400).json({ message: "start and end query parameters are required" });
      }
      
      // Get unpaid time off entries from storage
      const unpaidEntries = await storage.getUnpaidTimeOffEntries(startDate, endDate);
      
      // Get employee data to map UKG IDs to employee records
      const employees = await storage.getEmployees();
      const employeeByUkgId = new Map(
        employees.filter(e => e.ukgEmployeeId).map(e => [e.ukgEmployeeId, e])
      );
      
      // Enrich entries with employee info
      const enrichedEntries = unpaidEntries.map(entry => {
        const employee = employeeByUkgId.get(entry.ukgEmployeeId);
        return {
          ...entry,
          employeeId: employee?.id || null,
          employeeName: employee?.name || "Unknown",
          // Convert total hours from minutes to hours
          hoursDecimal: entry.totalHours / 60,
        };
      });
      
      res.json(enrichedEntries);
    } catch (error) {
      console.error("Error fetching unpaid time off entries:", error);
      res.status(500).json({ message: "Failed to fetch unpaid time off entries" });
    }
  });

  // === Schedule Copy & Templates ===
  
  // Helper to validate date string
  const isValidDate = (dateStr: string): boolean => {
    const d = new Date(dateStr);
    return !isNaN(d.getTime());
  };
  
  // Copy current week's schedule to the next week
  app.post("/api/schedule/copy-to-next-week", requireAuth, async (req, res) => {
    try {
      const { weekStart } = req.body;
      if (!weekStart) {
        return res.status(400).json({ message: "weekStart is required" });
      }
      
      if (!isValidDate(weekStart)) {
        return res.status(400).json({ message: "Invalid weekStart date" });
      }
      
      const currentWeekStart = new Date(weekStart);
      const currentWeekEnd = new Date(currentWeekStart);
      currentWeekEnd.setDate(currentWeekEnd.getDate() + 6);
      currentWeekEnd.setHours(23, 59, 59, 999);
      
      // Get all shifts from current week
      const shifts = await storage.getShifts(currentWeekStart, currentWeekEnd);
      
      if (shifts.length === 0) {
        return res.status(400).json({ message: "No shifts to copy in the current week" });
      }
      
      // Create new shifts for next week (add 7 days)
      const newShifts = shifts.map(shift => ({
        employeeId: shift.employeeId,
        startTime: new Date(new Date(shift.startTime).getTime() + 7 * 24 * 60 * 60 * 1000),
        endTime: new Date(new Date(shift.endTime).getTime() + 7 * 24 * 60 * 60 * 1000),
      }));
      
      const created = await storage.createShiftsBatch(newShifts);
      res.json({ message: `Copied ${created.length} shifts to next week`, count: created.length });
    } catch (err) {
      console.error("Error copying schedule:", err);
      res.status(500).json({ message: "Failed to copy schedule" });
    }
  });
  
  // Get all schedule templates
  app.get("/api/schedule-templates", requireAuth, async (req, res) => {
    const templates = await storage.getScheduleTemplates();
    res.json(templates);
  });
  
  // Save current week as a template
  app.post("/api/schedule-templates", requireAuth, async (req, res) => {
    try {
      const { name, description, weekStart, createdBy } = req.body;
      if (!name || !weekStart) {
        return res.status(400).json({ message: "name and weekStart are required" });
      }
      
      if (!isValidDate(weekStart)) {
        return res.status(400).json({ message: "Invalid weekStart date" });
      }
      
      const currentWeekStart = new Date(weekStart);
      const currentWeekEnd = new Date(currentWeekStart);
      currentWeekEnd.setDate(currentWeekEnd.getDate() + 6);
      currentWeekEnd.setHours(23, 59, 59, 999);
      
      // Get all shifts from current week
      const shifts = await storage.getShifts(currentWeekStart, currentWeekEnd);
      
      if (shifts.length === 0) {
        return res.status(400).json({ message: "No shifts to save as template" });
      }
      
      // Convert shifts to patterns (day of week + times)
      const patterns = shifts.map(shift => {
        const startTime = new Date(shift.startTime);
        const endTime = new Date(shift.endTime);
        return {
          employeeId: shift.employeeId,
          dayOfWeek: startTime.getDay(), // 0-6
          startHour: startTime.getHours(),
          startMinute: startTime.getMinutes(),
          endHour: endTime.getHours(),
          endMinute: endTime.getMinutes(),
        };
      });
      
      const template = await storage.createScheduleTemplate({
        name,
        description: description || null,
        createdBy: createdBy || null,
        shiftPatterns: JSON.stringify(patterns),
      });
      
      res.status(201).json(template);
    } catch (err) {
      console.error("Error creating template:", err);
      res.status(500).json({ message: "Failed to create template" });
    }
  });
  
  // Apply a template to a week
  app.post("/api/schedule-templates/:id/apply", requireAuth, async (req, res) => {
    try {
      const templateId = Number(req.params.id);
      const { weekStart } = req.body;
      
      if (!weekStart) {
        return res.status(400).json({ message: "weekStart is required" });
      }
      
      if (!isValidDate(weekStart)) {
        return res.status(400).json({ message: "Invalid weekStart date" });
      }
      
      const template = await storage.getScheduleTemplate(templateId);
      if (!template) {
        return res.status(404).json({ message: "Template not found" });
      }
      
      let patterns;
      try {
        patterns = JSON.parse(template.shiftPatterns);
      } catch {
        return res.status(500).json({ message: "Template data is corrupted" });
      }
      
      const targetWeekStart = new Date(weekStart);
      
      // Convert patterns back to shifts
      const newShifts = patterns.map((pattern: any) => {
        // Calculate the actual date for this day of week
        const shiftDate = new Date(targetWeekStart);
        const currentDay = shiftDate.getDay();
        const daysToAdd = pattern.dayOfWeek - currentDay;
        shiftDate.setDate(shiftDate.getDate() + daysToAdd);
        
        const startTime = new Date(shiftDate);
        startTime.setHours(pattern.startHour, pattern.startMinute, 0, 0);
        
        const endTime = new Date(shiftDate);
        endTime.setHours(pattern.endHour, pattern.endMinute, 0, 0);
        
        return {
          employeeId: pattern.employeeId,
          startTime,
          endTime,
        };
      });
      
      const created = await storage.createShiftsBatch(newShifts);
      res.json({ message: `Applied template with ${created.length} shifts`, count: created.length });
    } catch (err) {
      console.error("Error applying template:", err);
      res.status(500).json({ message: "Failed to apply template" });
    }
  });
  
  // Delete a template
  app.delete("/api/schedule-templates/:id", requireAuth, async (req, res) => {
    await storage.deleteScheduleTemplate(Number(req.params.id));
    res.status(204).send();
  });

  // === Time Off Requests ===
  app.get(api.timeOffRequests.list.path, async (req, res) => {
    const requests = await storage.getTimeOffRequests();
    res.json(requests);
  });

  app.post(api.timeOffRequests.create.path, async (req, res) => {
    try {
      const input = api.timeOffRequests.create.input.parse(req.body);
      const request = await storage.createTimeOffRequest(input);
      res.status(201).json(request);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.put(api.timeOffRequests.update.path, async (req, res) => {
    try {
      const input = api.timeOffRequests.update.input.parse(req.body);
      const request = await storage.updateTimeOffRequest(Number(req.params.id), input);
      res.json(request);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      return res.status(404).json({ message: "Request not found" });
    }
  });

  // === Role Requirements ===
  app.get(api.roleRequirements.list.path, async (req, res) => {
    const reqs = await storage.getRoleRequirements();
    res.json(reqs);
  });

  app.post(api.roleRequirements.create.path, async (req, res) => {
    try {
      const input = api.roleRequirements.create.input.parse(req.body);
      const reqs = await storage.createRoleRequirement(input);
      res.status(201).json(reqs);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.put(api.roleRequirements.update.path, async (req, res) => {
    try {
      const input = api.roleRequirements.update.input.parse(req.body);
      const reqs = await storage.updateRoleRequirement(Number(req.params.id), input);
      res.json(reqs);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      return res.status(404).json({ message: "Role requirement not found" });
    }
  });

  app.delete(api.roleRequirements.delete.path, async (req, res) => {
    await storage.deleteRoleRequirement(Number(req.params.id));
    res.status(204).send();
  });

  // === Global Settings ===
  app.get(api.globalSettings.get.path, requireAdmin, async (req, res) => {
    const settings = await storage.getGlobalSettings();
    res.json(settings);
  });

  app.post(api.globalSettings.update.path, requireAdmin, async (req, res) => {
    try {
      const input = api.globalSettings.update.input.parse(req.body);
      const settings = await storage.updateGlobalSettings(input);
      res.json(settings);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.post(api.schedule.generate.path, async (req, res) => {
    try {
      const { weekStart, location } = api.schedule.generate.input.parse(req.body);
      const startDate = new Date(weekStart);
      
      const allEmployees = await storage.getEmployees();
      // Filter employees by location if specified
      const employees = location 
        ? allEmployees.filter(e => e.location === location)
        : allEmployees;
      
      console.log(`[Scheduler] Location filter: ${location || 'none'}, Employees: ${employees.length} of ${allEmployees.length}`);
      
      const settings = await storage.getGlobalSettings();
      const timeOff = await storage.getTimeOffRequests();
      const locations = await storage.getLocations();
      
      // Fetch PAL (Paid Annual Leave) and UTO (Unpaid Time Off) entries for the week
      const weekEndDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = weekEndDate.toISOString().split('T')[0];
      const palEntries = await storage.getPALEntries(startDateStr, endDateStr);
      const utoEntries = await storage.getUnpaidTimeOffEntries(startDateStr, endDateStr);
      
      // Create a map of employeeId -> dates with PAL/UTO for quick lookup
      const employeeByUkgId = new Map(
        allEmployees.filter(e => e.ukgEmployeeId).map(e => [e.ukgEmployeeId, e])
      );
      const paidLeaveByEmpDate = new Set<string>();
      [...palEntries, ...utoEntries].forEach(entry => {
        const employee = employeeByUkgId.get(entry.ukgEmployeeId);
        if (employee) {
          paidLeaveByEmpDate.add(`${employee.id}-${entry.workDate}`);
        }
      });
      console.log(`[Scheduler] Found ${palEntries.length} PAL entries and ${utoEntries.length} UTO entries for the week`);

      // Clear existing shifts for the week (batch delete for performance)
      const deletedCount = await storage.deleteShiftsByDateRange(startDate, weekEndDate);
      console.log(`[Scheduler] Cleared ${deletedCount} existing shifts`);
      
      // Collect shifts in memory first, then batch insert at the end for performance
      const pendingShifts: { employeeId: number; startTime: Date; endTime: Date }[] = [];

      const FULL_SHIFT_HOURS = 8; // 8.5 clock hours - 0.5 unpaid lunch = 8 paid hours
      const SHORT_SHIFT_HOURS = 5.5; // 5.5 clock hours - NO lunch deduction (less than 6 hours)
      const GAP_SHIFT_HOURS = 5; // 5 clock hours = 5 paid hours (under 6h, no lunch deduction)
      
      // ========== EMPLOYEE STATE TRACKING ==========
      const employeeState: Record<number, {
        hoursScheduled: number;
        daysWorked: number;
        daysWorkedOn: Set<number>; // Track which day indices they work
      }> = {};
      
      // Calculate PAL hours per employee for the week
      // Note: totalHours in the database is stored in MINUTES, so we convert to hours
      const palHoursByEmployee = new Map<number, number>();
      [...palEntries, ...utoEntries].forEach(entry => {
        const employee = employeeByUkgId.get(entry.ukgEmployeeId);
        if (employee && entry.totalHours) {
          const current = palHoursByEmployee.get(employee.id) || 0;
          const hoursFromMinutes = entry.totalHours / 60; // Convert minutes to hours
          palHoursByEmployee.set(employee.id, current + hoursFromMinutes);
        }
      });
      
      employees.forEach(emp => {
        // Initialize with PAL hours already counted toward weekly total
        const palHours = palHoursByEmployee.get(emp.id) || 0;
        employeeState[emp.id] = { hoursScheduled: palHours, daysWorked: 0, daysWorkedOn: new Set() };
        if (palHours > 0) {
          console.log(`[Scheduler] ${emp.name}: ${palHours} PAL/UTO hours pre-counted`);
        }
      });

      // ========== HELPER FUNCTIONS ==========
      // Day names array: index 0 = Sunday (matching dayIndex from weekStart which is always Sunday)
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      
      const isOnTimeOff = (empId: number, day: Date, dayIndex: number) => {
        // Check approved time-off requests
        const hasApprovedTimeOff = timeOff.some(to => 
          to.employeeId === empId && 
          to.status === "approved" && 
          new Date(to.startDate) <= day && 
          new Date(to.endDate) >= day
        );
        if (hasApprovedTimeOff) return true;
        
        // Check PAL/UTO entries from UKG
        const dayStr = day.toISOString().split('T')[0];
        const hasPaidLeave = paidLeaveByEmpDate.has(`${empId}-${dayStr}`);
        if (hasPaidLeave) return true;
        
        // Check non-working days configuration using dayIndex (0=Sunday, 1=Monday, etc.)
        // This avoids timezone issues with day.getDay() since weekStart is always a Sunday
        const emp = employees.find(e => e.id === empId);
        if (emp?.nonWorkingDays && emp.nonWorkingDays.length > 0) {
          const dayName = dayNames[dayIndex];
          if (emp.nonWorkingDays.includes(dayName)) return true;
        }
        
        return false;
      };
      
      // Get max days per week for an employee (uses preferred setting, defaults to 5)
      const getMaxDays = (emp: typeof employees[0]) => emp.preferredDaysPerWeek || 5;
      
      // Check if employee can work a full 8-hour shift
      const canWorkFullShift = (emp: typeof employees[0], day: Date, dayIndex: number) => {
        const state = employeeState[emp.id];
        if (!emp.isActive) return false;
        if (isOnTimeOff(emp.id, day, dayIndex)) return false;
        if (state.hoursScheduled + FULL_SHIFT_HOURS > emp.maxWeeklyHours) return false;
        if (state.daysWorked >= getMaxDays(emp)) return false; // Respect preferred days setting
        if (state.daysWorkedOn.has(dayIndex)) return false; // Already working this day
        return true;
      };
      
      // Check if employee can work a short 5.5-hour shift
      const canWorkShortShift = (emp: typeof employees[0], day: Date, dayIndex: number) => {
        const state = employeeState[emp.id];
        if (!emp.isActive) return false;
        if (isOnTimeOff(emp.id, day, dayIndex)) return false;
        if (state.hoursScheduled + SHORT_SHIFT_HOURS > emp.maxWeeklyHours) return false;
        if (state.daysWorked >= getMaxDays(emp)) return false;
        if (state.daysWorkedOn.has(dayIndex)) return false;
        return true;
      };
      
      // Check if employee can work ANY shift (including shorter shifts to fill remaining hours)
      const canWorkAnyShift = (emp: typeof employees[0], day: Date, dayIndex: number) => {
        const state = employeeState[emp.id];
        if (!emp.isActive) return false;
        if (isOnTimeOff(emp.id, day, dayIndex)) return false;
        if (state.hoursScheduled >= emp.maxWeeklyHours) return false; // Already maxed
        if (state.daysWorked >= getMaxDays(emp)) return false;
        if (state.daysWorkedOn.has(dayIndex)) return false;
        return true;
      };
      
      // Check if employee can work a 5-hour gap shift (for filling remaining hours)
      const canWorkGapShift = (emp: typeof employees[0], day: Date, dayIndex: number) => {
        const state = employeeState[emp.id];
        if (!emp.isActive) return false;
        if (isOnTimeOff(emp.id, day, dayIndex)) return false;
        if (state.hoursScheduled + GAP_SHIFT_HOURS > emp.maxWeeklyHours) return false;
        if (state.daysWorked >= getMaxDays(emp)) return false;
        if (state.daysWorkedOn.has(dayIndex)) return false;
        return true;
      };
      
      // Is this employee a part-timer? (less than 32 max hours)
      const isPartTime = (emp: typeof employees[0]) => emp.maxWeeklyHours < 32;
      
      // Get remaining hours an employee can work
      const getRemainingHours = (emp: typeof employees[0]) => {
        return emp.maxWeeklyHours - employeeState[emp.id].hoursScheduled;
      };
      
      // Calculate best shift type for part-timer to maximize hours
      // OPTIMAL STRATEGY: Calculate what shift combination maximizes total hours
      // Then use that to guide each day's decision
      const getBestShiftForPartTimer = (emp: typeof employees[0], day: Date, dayIndex: number, shifts: ReturnType<typeof getShiftTimes>) => {
        const remaining = getRemainingHours(emp);
        const state = employeeState[emp.id];
        const maxDays = getMaxDays(emp);
        const daysRemaining = maxDays - state.daysWorked;
        
        // Helper to get appropriate shift time based on job
        const getFullShift = () => {
          if (['DONPRI', 'APPROC'].includes(emp.jobTitle)) return shifts.opener;
          else if (emp.jobTitle === 'DONDOOR') return shifts.closer;
          else return shifts.mid10;
        };
        
        const getShortShift = () => {
          if (['DONPRI', 'APPROC'].includes(emp.jobTitle)) return shifts.shortMorning;
          else if (emp.jobTitle === 'DONDOOR') return shifts.shortEvening;
          else return shifts.shortMid;
        };
        
        const getGapShift = () => {
          if (['DONPRI', 'APPROC'].includes(emp.jobTitle)) return shifts.gapMorning;
          else if (emp.jobTitle === 'DONDOOR') return shifts.gapEvening;
          else return shifts.gapMid;
        };
        
        // OPTIMAL SHIFT CALCULATION
        // Find the best combination of full (8h), short (5.5h), and gap (5h) shifts
        // that maximizes hours while respecting days limit
        const calculateOptimalPlan = (hours: number, days: number) => {
          let bestPlan = { full: 0, short: 0, gap: 0, total: 0 };
          
          // Try all combinations of full shifts (0 to maxFull)
          const maxFull = Math.min(days, Math.floor(hours / FULL_SHIFT_HOURS));
          
          for (let fullCount = 0; fullCount <= maxFull; fullCount++) {
            const hoursAfterFull = hours - (fullCount * FULL_SHIFT_HOURS);
            const daysAfterFull = days - fullCount;
            
            // Try all combinations of short shifts with remaining days
            const maxShort = Math.min(daysAfterFull, Math.floor(hoursAfterFull / SHORT_SHIFT_HOURS));
            
            for (let shortCount = 0; shortCount <= maxShort; shortCount++) {
              const hoursAfterShort = hoursAfterFull - (shortCount * SHORT_SHIFT_HOURS);
              const daysAfterShort = daysAfterFull - shortCount;
              
              // Use gap shifts for remainder if possible
              const maxGap = Math.min(daysAfterShort, Math.floor(hoursAfterShort / GAP_SHIFT_HOURS));
              const gapCount = maxGap;
              
              const total = (fullCount * FULL_SHIFT_HOURS) + 
                           (shortCount * SHORT_SHIFT_HOURS) + 
                           (gapCount * GAP_SHIFT_HOURS);
              
              if (total > bestPlan.total && total <= hours) {
                bestPlan = { full: fullCount, short: shortCount, gap: gapCount, total };
              }
            }
          }
          
          return bestPlan;
        };
        
        const optimalPlan = calculateOptimalPlan(remaining, daysRemaining);
        
        // Based on optimal plan, decide what shift to use NOW
        // Priority: If we still need full shifts in the plan, use full shift
        // Then short shifts, then gap shifts
        
        const fullsStillNeeded = optimalPlan.full;
        const shortsStillNeeded = optimalPlan.short;
        const gapsStillNeeded = optimalPlan.gap;
        
        // Use full shift if plan calls for it and we can
        if (fullsStillNeeded > 0 && canWorkFullShift(emp, day, dayIndex)) {
          return getFullShift();
        }
        
        // Use short shift if plan calls for it and we can
        if (shortsStillNeeded > 0 && canWorkShortShift(emp, day, dayIndex)) {
          return getShortShift();
        }
        
        // Use gap shift if plan calls for it and we can
        if (gapsStillNeeded > 0 && canWorkGapShift(emp, day, dayIndex)) {
          return getGapShift();
        }
        
        // Fallback: try any available shift type in order of efficiency
        if (remaining >= FULL_SHIFT_HOURS && canWorkFullShift(emp, day, dayIndex)) {
          return getFullShift();
        }
        
        if (remaining >= SHORT_SHIFT_HOURS && canWorkShortShift(emp, day, dayIndex)) {
          return getShortShift();
        }
        
        if (remaining >= GAP_SHIFT_HOURS && canWorkGapShift(emp, day, dayIndex)) {
          return getGapShift();
        }
        
        return null;
      };
      
      // Priority score: lower = should schedule first (employees needing more hours)
      const getEmployeePriority = (emp: typeof employees[0]) => {
        const state = employeeState[emp.id];
        const hoursRemaining = emp.maxWeeklyHours - state.hoursScheduled;
        const daysRemaining = getMaxDays(emp) - state.daysWorked;
        // Prioritize: more hours remaining, fewer days already worked
        return -(hoursRemaining * 10 + daysRemaining);
      };

      // Calculate paid hours from a shift (subtract 0.5 for lunch if 6+ hours)
      const calculateShiftPaidHours = (startTime: Date, endTime: Date) => {
        const clockHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
        return clockHours >= 6 ? clockHours - 0.5 : clockHours;
      };

      const scheduleShift = (emp: typeof employees[0], startTime: Date, endTime: Date, dayIndex: number) => {
        const paidHours = calculateShiftPaidHours(startTime, endTime);
        // Collect shift data in memory (will batch insert at the end)
        pendingShifts.push({ 
          employeeId: emp.id, 
          startTime, 
          endTime 
        });
        employeeState[emp.id].hoursScheduled += paidHours;
        employeeState[emp.id].daysWorked++;
        employeeState[emp.id].daysWorkedOn.add(dayIndex);
        return { paidHours };
      };

      // ========== CATEGORIZE EMPLOYEES ==========
      const managerCodes = ['STSUPER', 'STASSTSP', 'STLDWKR'];
      const managers = employees.filter(emp => managerCodes.includes(emp.jobTitle) && emp.isActive);
      const donorGreeters = employees.filter(emp => emp.jobTitle === 'DONDOOR' && emp.isActive);
      const donationPricers = employees.filter(emp => ['DONPRI', 'APPROC'].includes(emp.jobTitle) && emp.isActive);
      const cashiers = employees.filter(emp => emp.jobTitle === 'CASHSLS' && emp.isActive);
      
      console.log(`[Scheduler] Total employees: ${employees.length}`);
      console.log(`[Scheduler] Managers: ${managers.length}, Greeters: ${donorGreeters.length}, Pricers: ${donationPricers.length}, Cashiers: ${cashiers.length}`);

      // ========== SHIFT TIME DEFINITIONS ==========
      const getShiftTimes = (day: Date) => {
        const dayOfWeek = day.getDay(); // 0 = Sunday
        const isSunday = dayOfWeek === 0;
        
        return {
          // Full 8-hour shifts (8.5 clock hours)
          opener: { start: createESTTime(day, 8, 0), end: createESTTime(day, 16, 30) },
          early9: { start: createESTTime(day, 9, 0), end: createESTTime(day, 17, 30) },
          mid10: { start: createESTTime(day, 10, 0), end: createESTTime(day, 18, 30) },
          mid11: { start: createESTTime(day, 11, 0), end: createESTTime(day, 19, 30) },
          // Sunday closes at 7:30pm, so closer is 11am-7:30pm instead of 12pm-8:30pm
          closer: isSunday 
            ? { start: createESTTime(day, 11, 0), end: createESTTime(day, 19, 30) }
            : { start: createESTTime(day, 12, 0), end: createESTTime(day, 20, 30) },
          // Short 5.5-hour shifts (5.5 clock hours) for PT employees
          shortMorning: { start: createESTTime(day, 8, 0), end: createESTTime(day, 13, 30) },
          shortMid: { start: createESTTime(day, 11, 0), end: createESTTime(day, 16, 30) },
          // Sunday short evening ends at 7:30pm
          shortEvening: isSunday
            ? { start: createESTTime(day, 14, 0), end: createESTTime(day, 19, 30) }
            : { start: createESTTime(day, 15, 0), end: createESTTime(day, 20, 30) },
          // Gap-filling 5-hour shifts (5 clock hours = 5 paid hours, no lunch)
          // Used to help employees reach their max hours (e.g., 24h + 5h = 29h for 29h max)
          gapMorning: { start: createESTTime(day, 8, 0), end: createESTTime(day, 13, 0) },
          gapMid: { start: createESTTime(day, 11, 0), end: createESTTime(day, 16, 0) },
          gapEvening: isSunday
            ? { start: createESTTime(day, 14, 30), end: createESTTime(day, 19, 30) }
            : { start: createESTTime(day, 15, 30), end: createESTTime(day, 20, 30) }
        };
      };

      // ========== DAILY COVERAGE REQUIREMENTS ==========
      const managersRequired = settings.managersRequired ?? 1;
      const openersRequired = settings.openersRequired ?? 2;
      const closersRequired = settings.closersRequired ?? 2;

      // Day weights: Sat/Fri get more staff, but all days get coverage
      // Process in order: Sat, Fri, then Sun-Thu to fill priority days first
      const dayOrder = [6, 5, 0, 1, 2, 3, 4]; // Sat, Fri, Sun, Mon, Tue, Wed, Thu
      const dayMultiplier: Record<number, number> = {
        6: 1.3, // Saturday - 30% more staff
        5: 1.3, // Friday - 30% more staff  
        0: 1.0, 1: 1.0, 2: 1.0, 3: 1.0, 4: 1.0 // Weekdays - baseline
      };

      // ========== PHASE 1: MANDATORY COVERAGE (All 7 days except holidays) ==========
      // First pass: ensure every day has minimum required coverage
      // IMPORTANT: Prefer full-timers for coverage positions to maximize part-timer flexibility
      // Process days in priority order: Saturday and Friday first to ensure weekend leadership coverage
      for (const dayIndex of dayOrder) {
        const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
        
        // Skip holidays - store is closed on Easter, Thanksgiving, Christmas
        const holidayName = isHoliday(currentDay);
        if (holidayName) {
          console.log(`[Scheduler] Skipping ${holidayName} - store is closed`);
          continue;
        }
        
        const shifts = getShiftTimes(currentDay);
        const isSaturday = dayIndex === 6;

        // Helper to sort employees: full-timers first, then by priority, then by ID (for determinism)
        const sortFullTimersFirst = (a: typeof employees[0], b: typeof employees[0]) => {
          // Full-timers (>= 32h) should come before part-timers
          const aIsFullTime = a.maxWeeklyHours >= 32;
          const bIsFullTime = b.maxWeeklyHours >= 32;
          if (aIsFullTime && !bIsFullTime) return -1;
          if (!aIsFullTime && bIsFullTime) return 1;
          // If same type, sort by priority
          const priorityDiff = getEmployeePriority(a) - getEmployeePriority(b);
          if (priorityDiff !== 0) return priorityDiff;
          // Tie-breaker: sort by employee ID for deterministic results
          return a.id - b.id;
        };

        // On Saturdays, schedule more managers (at least 2 per shift if available)
        const saturdayManagerBonus = isSaturday ? 1 : 0;
        const managersToSchedule = managersRequired + saturdayManagerBonus;

        // 1a. Morning Manager - sort by priority (who needs hours most)
        const availableManagers = managers
          .filter(m => canWorkFullShift(m, currentDay, dayIndex))
          .sort(sortFullTimersFirst);
        
        for (let i = 0; i < managersToSchedule && i < availableManagers.length; i++) {
          scheduleShift(availableManagers[i], shifts.opener.start, shifts.opener.end, dayIndex);
        }

        // 1b. Evening Manager (different from morning)
        const eveningManagers = managers
          .filter(m => canWorkFullShift(m, currentDay, dayIndex))
          .sort(sortFullTimersFirst);
        
        for (let i = 0; i < managersToSchedule && i < eveningManagers.length; i++) {
          scheduleShift(eveningManagers[i], shifts.closer.start, shifts.closer.end, dayIndex);
        }

        // 1c. Opening Donor Greeter - prefer full-timers
        const availableGreeters = donorGreeters
          .filter(g => canWorkFullShift(g, currentDay, dayIndex))
          .sort(sortFullTimersFirst);
        
        if (availableGreeters.length > 0) {
          scheduleShift(availableGreeters[0], shifts.opener.start, shifts.opener.end, dayIndex);
        }

        // 1d. Closing Donor Greeter - prefer full-timers
        const closingGreeters = donorGreeters
          .filter(g => canWorkFullShift(g, currentDay, dayIndex))
          .sort(sortFullTimersFirst);
        
        if (closingGreeters.length > 0) {
          scheduleShift(closingGreeters[0], shifts.closer.start, shifts.closer.end, dayIndex);
        }

        // 1e. Opening cashiers - prefer full-timers
        const availableCashiers = cashiers
          .filter(c => canWorkFullShift(c, currentDay, dayIndex))
          .sort(sortFullTimersFirst);
        
        for (let i = 0; i < openersRequired && i < availableCashiers.length; i++) {
          scheduleShift(availableCashiers[i], shifts.opener.start, shifts.opener.end, dayIndex);
        }

        // 1f. Closing cashiers - prefer full-timers
        const closingCashiers = cashiers
          .filter(c => canWorkFullShift(c, currentDay, dayIndex))
          .sort(sortFullTimersFirst);
        
        for (let i = 0; i < closersRequired && i < closingCashiers.length; i++) {
          scheduleShift(closingCashiers[i], shifts.closer.start, shifts.closer.end, dayIndex);
        }

        // 1g. Donation Pricers - use short morning shifts for part-timers, full for full-timers
        // Pricers don't need to be there all day, just early morning for pricing
        const availablePricers = donationPricers
          .filter(p => canWorkShortShift(p, currentDay, dayIndex) || canWorkFullShift(p, currentDay, dayIndex))
          .sort(sortFullTimersFirst);
        
        // Schedule at least 2 pricers per day on early shifts
        const minPricers = Math.min(2, availablePricers.length);
        for (let i = 0; i < minPricers; i++) {
          const pricer = availablePricers[i];
          // Part-timers (<=29h) get short morning shifts to maximize their weekly hours
          if (pricer.maxWeeklyHours <= 29 && canWorkShortShift(pricer, currentDay, dayIndex)) {
            scheduleShift(pricer, shifts.shortMorning.start, shifts.shortMorning.end, dayIndex);
          } else if (canWorkFullShift(pricer, currentDay, dayIndex)) {
            const shift = i % 2 === 0 ? shifts.opener : shifts.early9;
            scheduleShift(pricer, shift.start, shift.end, dayIndex);
          }
        }
      }

      console.log(`[Scheduler] After Phase 1: ${pendingShifts.length} shifts scheduled`);

      // ========== PHASE 2: FILL REMAINING CAPACITY (Round-robin for even distribution) ==========
      // Use round-robin approach: assign one shift per day, cycling through all 7 days
      // This ensures Wed/Thu get staff before Sat/Fri use up all available employees
      // Part-timers get flexible shift selection (full or short based on what maximizes hours)
      
      // Track how many additional shifts we want per day (Sat/Fri get 30% more)
      const additionalTargets: Record<number, number> = {};
      const additionalAssigned: Record<number, number> = {};
      const baseAdditionalShifts = 4;
      for (let d = 0; d < 7; d++) {
        additionalTargets[d] = Math.ceil(baseAdditionalShifts * (dayMultiplier[d] || 1.0));
        additionalAssigned[d] = 0;
      }
      
      // Round-robin: keep cycling through days until all targets are met or no progress
      let phase2Progress = true;
      while (phase2Progress) {
        phase2Progress = false;
        
        // Process each day in order (0-6 = Sun-Sat)
        for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
          if (additionalAssigned[dayIndex] >= additionalTargets[dayIndex]) continue;
          
          const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
          
          // Skip holidays
          if (isHoliday(currentDay)) continue;
          
          const shifts = getShiftTimes(currentDay);
          
          // Get all available employees who can work any shift today
          // Sort by fewest days worked first (to spread evenly), then by priority, then ID
          const allAvailable = [...donationPricers, ...cashiers]
            .filter(e => canWorkShortShift(e, currentDay, dayIndex) || canWorkFullShift(e, currentDay, dayIndex))
            .sort((a, b) => {
              // Prefer employees who have worked fewer days (spread coverage evenly)
              const daysWorkedDiff = employeeState[a.id].daysWorked - employeeState[b.id].daysWorked;
              if (daysWorkedDiff !== 0) return daysWorkedDiff;
              // Then by priority
              const priorityDiff = getEmployeePriority(a) - getEmployeePriority(b);
              if (priorityDiff !== 0) return priorityDiff;
              return a.id - b.id;
            });
          
          // Try to assign just ONE shift per day per cycle (round-robin)
          for (const emp of allAvailable) {
            const shiftRotation = [shifts.early9, shifts.mid10, shifts.mid11, shifts.closer];
            
            if (isPartTime(emp)) {
              const bestShift = getBestShiftForPartTimer(emp, currentDay, dayIndex, shifts);
              if (bestShift) {
                scheduleShift(emp, bestShift.start, bestShift.end, dayIndex);
                additionalAssigned[dayIndex]++;
                phase2Progress = true;
                break; // Move to next day
              }
            } else if (canWorkFullShift(emp, currentDay, dayIndex)) {
              let shift;
              if (['DONPRI', 'APPROC'].includes(emp.jobTitle)) {
                shift = additionalAssigned[dayIndex] % 2 === 0 ? shifts.opener : shifts.early9;
              } else {
                shift = shiftRotation[additionalAssigned[dayIndex] % shiftRotation.length];
              }
              scheduleShift(emp, shift.start, shift.end, dayIndex);
              additionalAssigned[dayIndex]++;
              phase2Progress = true;
              break; // Move to next day
            }
          }
        }
      }

      console.log(`[Scheduler] After Phase 2: ${pendingShifts.length} shifts scheduled`);

      // ========== CALCULATE BUDGET (DISABLED - Maximize employee hours instead) ==========
      // const activeLocations = locations.filter(l => l.isActive);
      // const totalBudgetHours = activeLocations.reduce((sum, loc) => sum + (loc.weeklyHoursLimit || 0), 0);
      // console.log(`[Scheduler] Budget: ${totalBudgetHours} hours from ${activeLocations.length} active locations`);
      
      // Instead of budget, calculate total capacity from employee max hours
      const totalEmployeeCapacity = employees.reduce((sum, e) => sum + (e.maxWeeklyHours || 40), 0);
      console.log(`[Scheduler] Total employee capacity: ${totalEmployeeCapacity} hours from ${employees.length} employees`);
      
      // Calculate current total scheduled hours using pending shift times
      const getTotalScheduledHours = () => {
        return pendingShifts.reduce((sum, shift) => {
          return sum + calculateShiftPaidHours(shift.startTime, shift.endTime);
        }, 0);
      };
      
      // Calculate hours per day using pending shift times
      const getHoursPerDay = () => {
        const dayHours: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
        for (const shift of pendingShifts) {
          const shiftDate = new Date(shift.startTime);
          const dayOfWeek = shiftDate.getDay();
          const paidHours = calculateShiftPaidHours(shift.startTime, shift.endTime);
          dayHours[dayOfWeek] += paidHours;
        }
        return dayHours;
      };

      // ========== PHASE 3: MAXIMIZE EMPLOYEE HOURS (Round-robin) ==========
      // Fill each employee to their max hours using round-robin across days
      // This ensures even distribution of hours across all 7 days
      
      // Keep filling until no one can take more shifts
      let madeProgress = true;
      let iterations = 0;
      const maxIterations = 50; // Prevent infinite loops
      
      while (madeProgress && iterations < maxIterations) {
        madeProgress = false;
        iterations++;
        
        // Process each day in sequence (round-robin across all 7 days)
        for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
          const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
          
          // Skip holidays
          if (isHoliday(currentDay)) continue;
          
          const shifts = getShiftTimes(currentDay);

          // Find employees who can still work (either full or short shifts)
          // Sort by fewest days worked first to ensure even distribution
          const underScheduled = [...managers, ...donorGreeters, ...donationPricers, ...cashiers]
            .filter(e => canWorkShortShift(e, currentDay, dayIndex) || canWorkFullShift(e, currentDay, dayIndex))
            .sort((a, b) => {
              // Prefer employees who have worked fewer days (spread coverage evenly)
              const daysWorkedDiff = employeeState[a.id].daysWorked - employeeState[b.id].daysWorked;
              if (daysWorkedDiff !== 0) return daysWorkedDiff;
              // Then by priority (who needs more hours)
              const priorityDiff = getEmployeePriority(a) - getEmployeePriority(b);
              if (priorityDiff !== 0) return priorityDiff;
              return a.id - b.id;
            });

          // Assign ONE employee per day per iteration (round-robin)
          for (const emp of underScheduled) {
            // Managers always get full shifts (opener or closer only)
            if (managerCodes.includes(emp.jobTitle)) {
              if (!canWorkFullShift(emp, currentDay, dayIndex)) continue;
              // Deterministic: alternate based on employee ID to ensure consistent results
              const shift = (emp.id % 2 === 0) ? shifts.opener : shifts.closer;
              scheduleShift(emp, shift.start, shift.end, dayIndex);
              madeProgress = true;
              break; // Move to next day (round-robin)
            } 
            // Part-timers get flexible shift selection
            else if (isPartTime(emp)) {
              const bestShift = getBestShiftForPartTimer(emp, currentDay, dayIndex, shifts);
              if (bestShift) {
                scheduleShift(emp, bestShift.start, bestShift.end, dayIndex);
                madeProgress = true;
                break; // Move to next day (round-robin)
              }
            }
            // Full-timers get full shifts only
            else if (canWorkFullShift(emp, currentDay, dayIndex)) {
              let shift;
              if (['DONPRI', 'APPROC'].includes(emp.jobTitle)) {
                shift = shifts.opener;
              } else if (emp.jobTitle === 'DONDOOR') {
                shift = shifts.closer;
              } else {
                shift = shifts.mid10;
              }
              scheduleShift(emp, shift.start, shift.end, dayIndex);
              madeProgress = true;
              break; // Move to next day (round-robin)
            }
          }
        }
      }

      console.log(`[Scheduler] After Phase 3: ${pendingShifts.length} shifts, ${getTotalScheduledHours()} hours`);

      // ========== PHASE 4: FILL REMAINING HOURS WITH GAP/SHORT SHIFTS ==========
      // For part-time employees who have remaining hours, add appropriate shifts to reach max
      // - 5h gap shift for employees with exactly 5h remaining (e.g., 24h + 5h = 29h)
      // - 5.5h short shift for employees with 5.5h+ remaining
      // Note: Managers are excluded - they should only work full opener/closer shifts for coverage
      const allRetailEmployees = [...donorGreeters, ...donationPricers, ...cashiers];
      
      // Sort by employees who are closest to max (smallest gap first) to prioritize filling
      const sortedForPhase4 = [...allRetailEmployees].sort((a, b) => {
        const gapA = getRemainingHours(a);
        const gapB = getRemainingHours(b);
        if (gapA !== gapB) return gapA - gapB; // Smallest gap first
        return a.id - b.id; // Tie-breaker
      });
      
      for (const emp of sortedForPhase4) {
        const remaining = getRemainingHours(emp);
        const state = employeeState[emp.id];
        
        // Skip if they can't work more days
        if (state.daysWorked >= getMaxDays(emp)) continue;
        
        // Use gap shift (5h) if remaining is exactly 5h or close to it
        if (remaining >= 5 && remaining <= 5.5) {
          for (let dayIndex = 0; dayIndex < 7; dayIndex++) { // Even distribution
            if (state.daysWorkedOn.has(dayIndex)) continue;
            
            const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
            if (isOnTimeOff(emp.id, currentDay, dayIndex)) continue;
            if (!canWorkGapShift(emp, currentDay, dayIndex)) continue;
            
            const shifts = getShiftTimes(currentDay);
            
            // Assign gap shift based on role
            let gapShift;
            if (['DONPRI', 'APPROC'].includes(emp.jobTitle)) {
              gapShift = shifts.gapMorning;
            } else if (emp.jobTitle === 'DONDOOR') {
              gapShift = shifts.gapEvening;
            } else {
              gapShift = shifts.gapMid;
            }
            
            scheduleShift(emp, gapShift.start, gapShift.end, dayIndex);
            break;
          }
        }
        // Use short shift (5.5h) if remaining is more than 5.5h but less than 8h
        else if (remaining >= SHORT_SHIFT_HOURS && remaining < FULL_SHIFT_HOURS) {
          for (let dayIndex = 0; dayIndex < 7; dayIndex++) { // Even distribution
            if (state.daysWorkedOn.has(dayIndex)) continue;
            
            const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
            if (isOnTimeOff(emp.id, currentDay, dayIndex)) continue;
            if (!canWorkShortShift(emp, currentDay, dayIndex)) continue;
            
            const shifts = getShiftTimes(currentDay);
            
            // Assign short shift based on role
            let shortShift;
            if (['DONPRI', 'APPROC'].includes(emp.jobTitle)) {
              shortShift = shifts.shortMorning;
            } else if (emp.jobTitle === 'DONDOOR') {
              shortShift = shifts.shortEvening;
            } else {
              shortShift = shifts.shortMid;
            }
            
            scheduleShift(emp, shortShift.start, shortShift.end, dayIndex);
            break;
          }
        }
      }

      // Debug: Log part-timer hours allocation
      const partTimerSummary = employees
        .filter(e => e.maxWeeklyHours <= 29 && e.isActive)
        .map(e => ({
          name: e.name,
          maxHours: e.maxWeeklyHours,
          scheduled: employeeState[e.id].hoursScheduled,
          daysWorked: employeeState[e.id].daysWorked,
          gap: e.maxWeeklyHours - employeeState[e.id].hoursScheduled
        }))
        .filter(e => e.scheduled > 0) // Only show those with shifts
        .sort((a, b) => b.gap - a.gap); // Sort by largest gap first
      
      console.log(`[Scheduler] Part-timer summary (showing top 10 with gaps):`);
      partTimerSummary.slice(0, 10).forEach(pt => {
        console.log(`  ${pt.name}: ${pt.scheduled}h / ${pt.maxHours}h max (${pt.daysWorked} days, gap: ${pt.gap.toFixed(1)}h)`);
      });

      // ========== BATCH INSERT ALL SHIFTS ==========
      // This is much faster than individual inserts (single DB round-trip vs 100+ individual calls)
      console.log(`[Scheduler] Batch inserting ${pendingShifts.length} shifts...`);
      const insertedShifts = await storage.createShiftsBatch(pendingShifts);
      
      console.log(`[Scheduler] COMPLETE: ${insertedShifts.length} shifts, ${getTotalScheduledHours()} total hours`);
      res.status(201).json(insertedShifts);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // AI-Powered Schedule Generation
  app.post("/api/schedule/generate-ai", async (req, res) => {
    try {
      const { weekStart } = api.schedule.generate.input.parse(req.body);
      
      // Get user's location filter
      const user = (req.session as any)?.user;
      let locationIds: string[] | undefined;
      if (user && user.locationIds && user.locationIds.length > 0) {
        locationIds = user.locationIds;
      }
      
      const { generateAISchedule } = await import("./ai-scheduler");
      const result = await generateAISchedule(weekStart, locationIds);
      
      res.status(201).json({
        shifts: result.shifts,
        reasoning: result.reasoning,
        warnings: result.warnings,
        aiGenerated: true,
      });
    } catch (err) {
      console.error("AI Schedule generation error:", err);
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ 
        message: "Failed to generate AI schedule. Try the standard scheduler instead.",
        error: err instanceof Error ? err.message : "Unknown error"
      });
    }
  });

  // Clear schedule for a week
  app.post("/api/schedule/clear", async (req, res) => {
    try {
      const { weekStart } = api.schedule.generate.input.parse(req.body);
      const startDate = new Date(weekStart);
      const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);
      
      // Use batch delete for performance (single DB query instead of N queries)
      const deletedCount = await storage.deleteShiftsByDateRange(startDate, endDate);
      
      res.json({ message: `Cleared ${deletedCount} shifts`, deletedCount });
    } catch (err) {
      console.error("Clear schedule error:", err);
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: "Failed to clear schedule" });
    }
  });

  // === UKG INTEGRATION ===
  app.get(api.ukg.status.path, async (req, res) => {
    const configured = ukgClient.isConfigured();
    let connected = false;
    if (configured) {
      try {
        await ukgClient.getAllEmployees();
        connected = true;
      } catch {
        connected = false;
      }
    }
    res.json({ configured, connected });
  });

  app.get(api.ukg.stores.path, async (req, res) => {
    if (!ukgClient.isConfigured()) {
      return res.json([]);
    }
    const locations = await ukgClient.getLocations();
    res.json(locations);
  });

  app.get(api.ukg.employees.path, async (req, res) => {
    if (!ukgClient.isConfigured()) {
      return res.json([]);
    }
    const storeId = req.query.storeId as string | undefined;
    const employees = storeId 
      ? await ukgClient.getEmployeesByLocation(storeId)
      : await ukgClient.getAllEmployees();
    res.json(employees);
  });

  app.post(api.ukg.sync.path, async (req, res) => {
    try {
      if (!ukgClient.isConfigured()) {
        return res.status(400).json({ message: "UKG is not configured", apiError: null });
      }

      const { storeId } = api.ukg.sync.input.parse(req.body);
      const ukgEmployees = storeId 
        ? await ukgClient.getEmployeesByLocation(storeId)
        : await ukgClient.getAllEmployees();

      const apiError = ukgClient.getLastError();
      if (apiError) {
        return res.json({ imported: 0, updated: 0, errors: 0, skipped: 0, apiError });
      }

      const activeEmployees = ukgEmployees.filter(emp => emp.isActive);
      const skipped = ukgEmployees.length - activeEmployees.length;
      console.log(`UKG: Processing ${activeEmployees.length} active employees (skipping ${skipped} terminated)`);

      let imported = 0;
      let updated = 0;
      let errors = 0;

      for (const ukgEmp of activeEmployees) {
        try {
          const appEmployee = ukgClient.convertToAppEmployee(ukgEmp);
          
          const existingByUkgId = await storage.getEmployeeByUkgId(String(ukgEmp.ukgId));
          
          if (existingByUkgId) {
            await storage.updateEmployee(existingByUkgId.id, appEmployee);
            updated++;
          } else {
            await storage.createEmployee(appEmployee);
            imported++;
          }
        } catch (err) {
          console.error("Error syncing employee:", err);
          errors++;
        }
      }

      console.log(`UKG Sync complete: ${imported} imported, ${updated} updated, ${skipped} skipped (terminated), ${errors} errors`);
      res.json({ imported, updated, skipped, errors, apiError: null });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // Discover available UKG OData entities/tables
  app.get(api.ukg.discover.path, requireAdmin, async (req, res) => {
    if (!ukgClient.isConfigured()) {
      return res.json({ entities: [], error: "UKG is not configured" });
    }

    // Known UKG UltiClock OData entities to probe
    const knownEntities = [
      "Employee",
      "Job",
      "Location",
      "Paygroup",
      "Shift",
      "ShiftDet",
      "Schedule",
      "ScheduleRequest",
      "Timecard",
      "TimecardDet",
      "Punch",
      "PunchDet",
      "PayPeriod",
      "Paycode",
      "Holiday",
      "Accrual",
      "AccrualTransaction",
      "OrgLevel1",
      "OrgLevel2",
      "OrgLevel3",
      "OrgLevel4",
    ];

    const results: { name: string; accessible: boolean; fields: string[] }[] = [];

    // Probe each known entity to see if it's accessible
    for (const entityName of knownEntities) {
      const probe = await ukgClient.probeEntity(entityName);
      results.push({
        name: entityName,
        accessible: probe.success,
        fields: probe.sampleFields,
      });
    }

    // Also try to discover additional entities from the service document
    const discoveredEntities = await ukgClient.discoverEntities();
    for (const entity of discoveredEntities) {
      if (!knownEntities.includes(entity)) {
        const probe = await ukgClient.probeEntity(entity);
        results.push({
          name: entity,
          accessible: probe.success,
          fields: probe.sampleFields,
        });
      }
    }

    const error = ukgClient.getLastError();
    res.json({ entities: results, error });
  });

  // Debug: Probe OrgLevel1 API for location data
  app.get("/api/ukg/probe-location", requireAdmin, async (req, res) => {
    if (!ukgClient.isConfigured()) {
      return res.json({ success: false, error: "UKG is not configured" });
    }

    const result = await ukgClient.probeLocationAPI();
    res.json(result);
  });

  // Get time clock data for a date range (from stored data)
  app.get(api.ukg.timeclock.path, requireAuth, async (req, res) => {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.json({ entries: [], error: "startDate and endDate query parameters are required" });
    }

    try {
      // Get time clock data from database
      const storedEntries = await storage.getTimeClockEntries(
        String(startDate),
        String(endDate)
      );

      // Convert stored entries to the format expected by the frontend
      // Database stores hours as minutes, convert back to hours
      const entries = storedEntries.map(entry => ({
        employeeId: entry.ukgEmployeeId,
        date: entry.workDate,
        clockIn: entry.clockIn || "",
        clockOut: entry.clockOut || "",
        regularHours: (entry.regularHours || 0) / 60,
        overtimeHours: (entry.overtimeHours || 0) / 60,
        totalHours: (entry.totalHours || 0) / 60,
        locationId: entry.locationId,
        jobId: entry.jobId,
      }));

      res.json({ entries, error: null });
    } catch (err) {
      console.error("Error fetching time clock data:", err);
      res.json({ entries: [], error: "Failed to fetch time clock data" });
    }
  });

  // === Users ===
  app.get(api.users.list.path, requireAdmin, async (req, res) => {
    const users = await storage.getUsers();
    res.json(users);
  });

  app.get(api.users.get.path, requireAdmin, async (req, res) => {
    const user = await storage.getUser(Number(req.params.id));
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  });

  app.post(api.users.create.path, requireAdmin, async (req, res) => {
    try {
      const input = api.users.create.input.parse(req.body);
      const user = await storage.createUser(input);
      res.status(201).json(user);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.put(api.users.update.path, requireAdmin, async (req, res) => {
    try {
      const input = api.users.update.input.parse(req.body);
      const user = await storage.updateUser(Number(req.params.id), input);
      res.json(user);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      return res.status(404).json({ message: "User not found" });
    }
  });

  app.delete(api.users.delete.path, requireAdmin, async (req, res) => {
    await storage.deleteUser(Number(req.params.id));
    res.status(204).send();
  });

  // === Retail Job Codes ===
  app.get("/api/retail-job-codes", (req, res) => {
    res.json(RETAIL_JOB_CODES);
  });

  // === Locations ===
  // List locations is accessible by authenticated users (managers need it for scheduling)
  app.get(api.locations.list.path, requireAuth, async (req, res) => {
    const locations = await storage.getLocations();
    res.json(locations);
  });

  // Get single location requires admin
  app.get(api.locations.get.path, requireAdmin, async (req, res) => {
    const location = await storage.getLocation(Number(req.params.id));
    if (!location) return res.status(404).json({ message: "Location not found" });
    res.json(location);
  });

  app.post(api.locations.create.path, requireAdmin, async (req, res) => {
    try {
      const input = api.locations.create.input.parse(req.body);
      const location = await storage.createLocation(input);
      res.status(201).json(location);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.put(api.locations.update.path, requireAdmin, async (req, res) => {
    try {
      const input = api.locations.update.input.parse(req.body);
      const location = await storage.updateLocation(Number(req.params.id), input);
      res.json(location);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      return res.status(404).json({ message: "Location not found" });
    }
  });

  app.delete(api.locations.delete.path, requireAdmin, async (req, res) => {
    await storage.deleteLocation(Number(req.params.id));
    res.status(204).send();
  });

  // === Shift Presets ===
  app.get(api.shiftPresets.list.path, requireAdmin, async (req, res) => {
    const presets = await storage.getShiftPresets();
    res.json(presets);
  });

  app.get(api.shiftPresets.get.path, requireAdmin, async (req, res) => {
    const preset = await storage.getShiftPreset(Number(req.params.id));
    if (!preset) return res.status(404).json({ message: "Shift preset not found" });
    res.json(preset);
  });

  app.post(api.shiftPresets.create.path, requireAdmin, async (req, res) => {
    try {
      const input = api.shiftPresets.create.input.parse(req.body);
      const preset = await storage.createShiftPreset(input);
      res.status(201).json(preset);
    } catch (err: any) {
      if (err?.errors) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      return res.status(400).json({ message: "Invalid shift preset data" });
    }
  });

  app.put(api.shiftPresets.update.path, requireAdmin, async (req, res) => {
    try {
      const input = api.shiftPresets.update.input.parse(req.body);
      const preset = await storage.updateShiftPreset(Number(req.params.id), input);
      res.json(preset);
    } catch (err: any) {
      if (err?.errors) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      return res.status(404).json({ message: "Shift preset not found" });
    }
  });

  app.delete(api.shiftPresets.delete.path, requireAdmin, async (req, res) => {
    await storage.deleteShiftPreset(Number(req.params.id));
    res.status(204).send();
  });

  // === Published Schedules ===
  // Check if a week's schedule is published
  app.get("/api/schedule/published/:weekStart", async (req, res) => {
    try {
      const weekStart = req.params.weekStart as string;
      if (!isValidDate(weekStart)) {
        return res.status(400).json({ message: "Invalid weekStart date" });
      }
      const isPublished = await storage.isSchedulePublished(weekStart);
      res.json({ weekStart, isPublished });
    } catch (error) {
      console.error("Error checking schedule publish status:", error);
      res.status(500).json({ message: "Failed to check schedule status" });
    }
  });

  // Publish a week's schedule (managers and admins only)
  app.post("/api/schedule/publish", requireAuth, async (req, res) => {
    try {
      const user = (req.session as any)?.user;
      if (user.role !== "admin" && user.role !== "manager") {
        return res.status(403).json({ message: "Only managers and admins can publish schedules" });
      }
      
      const { weekStart } = req.body;
      if (!weekStart || !isValidDate(weekStart)) {
        return res.status(400).json({ message: "Invalid weekStart date" });
      }
      
      const published = await storage.publishSchedule(weekStart, user.id);
      res.json({ message: "Schedule published", published });
    } catch (error) {
      console.error("Error publishing schedule:", error);
      res.status(500).json({ message: "Failed to publish schedule" });
    }
  });

  // Unpublish a week's schedule (managers and admins only)
  app.delete("/api/schedule/publish/:weekStart", requireAuth, async (req, res) => {
    try {
      const user = (req.session as any)?.user;
      if (user.role !== "admin" && user.role !== "manager") {
        return res.status(403).json({ message: "Only managers and admins can unpublish schedules" });
      }
      
      const weekStart = req.params.weekStart as string;
      if (!isValidDate(weekStart)) {
        return res.status(400).json({ message: "Invalid weekStart date" });
      }
      
      await storage.unpublishSchedule(weekStart);
      res.status(204).send();
    } catch (error) {
      console.error("Error unpublishing schedule:", error);
      res.status(500).json({ message: "Failed to unpublish schedule" });
    }
  });

  // === Weather Forecast ===
  // Cache weather data for 1 hour to avoid excessive API calls
  let weatherCache: { data: any; timestamp: number } | null = null;
  const WEATHER_CACHE_DURATION = 60 * 60 * 1000; // 1 hour

  app.get("/api/weather/forecast", async (req, res) => {
    try {
      // Check cache first
      if (weatherCache && (Date.now() - weatherCache.timestamp) < WEATHER_CACHE_DURATION) {
        return res.json(weatherCache.data);
      }

      // Default coordinates for store region (can be made configurable later)
      // Using coordinates for typical store location area
      const latitude = req.query.lat || "39.7456";
      const longitude = req.query.lon || "-75.5466";
      
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=fahrenheit&timezone=America/New_York&forecast_days=14`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Weather API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Transform data into a more usable format
      const forecast = data.daily.time.map((date: string, i: number) => ({
        date,
        highTemp: Math.round(data.daily.temperature_2m_max[i]),
        lowTemp: Math.round(data.daily.temperature_2m_min[i]),
        precipitationChance: data.daily.precipitation_probability_max[i]
      }));
      
      // Cache the result
      weatherCache = { data: forecast, timestamp: Date.now() };
      
      res.json(forecast);
    } catch (error) {
      console.error("Weather API error:", error);
      res.status(500).json({ message: "Failed to fetch weather data" });
    }
  });

  // === User's Linked Employee ===
  // Get the current user's linked employee (for viewers to access their own data)
  app.get("/api/my-employee", requireAuth, async (req, res) => {
    try {
      const user = (req.session as any)?.user;
      if (!user?.email) {
        return res.json({ employee: null });
      }
      
      const employees = await storage.getEmployees();
      const linkedEmployee = employees.find(e => e.email && e.email.toLowerCase() === user.email.toLowerCase());
      
      res.json({ employee: linkedEmployee || null });
    } catch (error) {
      console.error("Error fetching linked employee:", error);
      res.status(500).json({ message: "Failed to fetch linked employee" });
    }
  });

  // === Occurrences ===
  // Get occurrences for an employee within a date range
  app.get("/api/occurrences/:employeeId", requireAuth, async (req, res) => {
    try {
      const employeeId = Number(req.params.employeeId);
      const { startDate, endDate } = req.query;
      const user = (req.session as any)?.user;
      
      // Viewers can only see their own occurrences
      if (user.role === "viewer") {
        const employees = await storage.getEmployees();
        const linkedEmployee = employees.find(e => e.email && e.email.toLowerCase() === user.email.toLowerCase());
        if (!linkedEmployee || linkedEmployee.id !== employeeId) {
          return res.status(403).json({ message: "You can only view your own occurrence history" });
        }
      }
      
      if (!startDate || !endDate) {
        return res.status(400).json({ message: "startDate and endDate query parameters are required" });
      }
      
      const occurrenceList = await storage.getOccurrences(employeeId, String(startDate), String(endDate));
      res.json(occurrenceList);
    } catch (error) {
      console.error("Error fetching occurrences:", error);
      res.status(500).json({ message: "Failed to fetch occurrences" });
    }
  });

  // Create a new occurrence
  app.post("/api/occurrences", requireAuth, async (req, res) => {
    try {
      const user = (req.session as any)?.user;
      if (user.role !== "admin" && user.role !== "manager") {
        return res.status(403).json({ message: "Only managers and admins can create occurrences" });
      }
      
      const { employeeId, occurrenceDate, occurrenceType, occurrenceValue, illnessGroupId, notes, isNcns, reason, documentUrl } = req.body;
      
      if (!employeeId || !occurrenceDate || !occurrenceType || occurrenceValue === undefined) {
        return res.status(400).json({ message: "employeeId, occurrenceDate, occurrenceType, and occurrenceValue are required" });
      }
      
      const occurrence = await storage.createOccurrence({
        employeeId,
        occurrenceDate,
        occurrenceType,
        occurrenceValue,
        illnessGroupId: illnessGroupId || null,
        notes: notes || null,
        isNcns: isNcns || false,
        reason: reason || null,
        documentUrl: documentUrl || null,
        createdBy: user.id
      });
      
      res.status(201).json(occurrence);
    } catch (error) {
      console.error("Error creating occurrence:", error);
      res.status(500).json({ message: "Failed to create occurrence" });
    }
  });

  // Retract an occurrence
  app.post("/api/occurrences/:id/retract", requireAuth, async (req, res) => {
    try {
      const user = (req.session as any)?.user;
      if (user.role !== "admin" && user.role !== "manager") {
        return res.status(403).json({ message: "Only managers and admins can retract occurrences" });
      }
      
      const id = Number(req.params.id);
      const { reason } = req.body;
      
      if (!reason) {
        return res.status(400).json({ message: "Retraction reason is required" });
      }
      
      const occurrence = await storage.retractOccurrence(id, reason, user.id);
      res.json(occurrence);
    } catch (error) {
      console.error("Error retracting occurrence:", error);
      res.status(500).json({ message: "Failed to retract occurrence" });
    }
  });

  // Get occurrence summary (rolling 12-month tally) for an employee
  app.get("/api/occurrences/:employeeId/summary", requireAuth, async (req, res) => {
    try {
      const employeeId = Number(req.params.employeeId);
      const user = (req.session as any)?.user;
      
      // Viewers can only see their own occurrence summary
      if (user.role === "viewer") {
        const employees = await storage.getEmployees();
        const linkedEmployee = employees.find(e => e.email && e.email.toLowerCase() === user.email.toLowerCase());
        if (!linkedEmployee || linkedEmployee.id !== employeeId) {
          return res.status(403).json({ message: "You can only view your own occurrence history" });
        }
      }
      
      const now = new Date();
      const oneYearAgo = new Date(now);
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      
      const startDate = oneYearAgo.toISOString().split('T')[0];
      const endDate = now.toISOString().split('T')[0];
      
      // Get active (non-retracted) occurrences in the rolling 12-month window
      const allOccurrences = await storage.getOccurrences(employeeId, startDate, endDate);
      const activeOccurrences = allOccurrences.filter(o => o.status === 'active');
      
      // Calculate total points (stored as integers x100, so divide by 100)
      const totalPoints = activeOccurrences.reduce((sum, o) => sum + o.occurrenceValue, 0) / 100;
      
      // Get manual adjustments for the current calendar year (only unscheduled_shift now)
      const currentYear = now.getFullYear();
      const adjustments = await storage.getOccurrenceAdjustmentsForYear(employeeId, currentYear);
      // Filter out any legacy perfect_attendance adjustments - these are now calculated automatically
      const manualAdjustments = adjustments.filter(a => a.adjustmentType !== 'perfect_attendance');
      const manualAdjustmentTotal = manualAdjustments.reduce((sum, a) => sum + a.adjustmentValue, 0) / 100;
      
      // Calculate automatic perfect attendance bonus (90 days without occurrences = -1.0, once per calendar year)
      // Check if employee has had 90 consecutive days of perfect attendance this calendar year
      const yearStart = `${currentYear}-01-01`;
      const yearOccurrences = await storage.getOccurrences(employeeId, yearStart, endDate);
      const activeYearOccurrences = yearOccurrences.filter(o => o.status === 'active');
      
      let perfectAttendanceBonus = 0;
      let perfectAttendanceEligible = false;
      
      if (activeYearOccurrences.length === 0) {
        // No occurrences this calendar year - check if 90 days have passed since Jan 1
        const yearStartDate = new Date(`${currentYear}-01-01T00:00:00`);
        const daysSinceYearStart = Math.floor((now.getTime() - yearStartDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceYearStart >= 90) {
          perfectAttendanceBonus = -1.0;
          perfectAttendanceEligible = true;
        }
      } else {
        // Has occurrences - check for 90 consecutive days after the most recent occurrence
        const sortedOccurrences = [...activeYearOccurrences].sort((a, b) => 
          new Date(b.occurrenceDate).getTime() - new Date(a.occurrenceDate).getTime()
        );
        const mostRecentOccurrence = sortedOccurrences[0];
        const mostRecentDate = new Date(mostRecentOccurrence.occurrenceDate + 'T00:00:00');
        const daysSinceLastOccurrence = Math.floor((now.getTime() - mostRecentDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceLastOccurrence >= 90) {
          perfectAttendanceBonus = -1.0;
          perfectAttendanceEligible = true;
        }
      }
      
      // Total adjustment = manual adjustments + automatic perfect attendance
      const totalAdjustment = manualAdjustmentTotal + perfectAttendanceBonus;
      
      // Net tally = total occurrences + adjustments (adjustments are negative values)
      const netTally = Math.max(0, totalPoints + totalAdjustment);
      
      res.json({
        employeeId,
        periodStart: startDate,
        periodEnd: endDate,
        totalOccurrences: totalPoints,
        adjustmentsThisYear: totalAdjustment,
        adjustmentsRemaining: 2 - manualAdjustments.length, // Only count manual adjustments toward limit
        netTally,
        occurrenceCount: activeOccurrences.length,
        occurrences: activeOccurrences,
        adjustments: manualAdjustments,
        perfectAttendanceBonus: perfectAttendanceBonus !== 0,
        perfectAttendanceBonusValue: perfectAttendanceBonus
      });
    } catch (error) {
      console.error("Error fetching occurrence summary:", error);
      res.status(500).json({ message: "Failed to fetch occurrence summary" });
    }
  });

  // Get occurrence alerts - employees at 5, 7, or 8+ occurrences
  app.get("/api/occurrence-alerts", requireAuth, async (req, res) => {
    try {
      const user = (req.session as any)?.user;
      if (user.role !== "admin" && user.role !== "manager") {
        return res.status(403).json({ message: "Only managers and admins can view occurrence alerts" });
      }

      const now = new Date();
      const oneYearAgo = new Date(now);
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      
      const startDate = oneYearAgo.toISOString().split('T')[0];
      const endDate = now.toISOString().split('T')[0];
      const currentYear = now.getFullYear();
      const yearStart = `${currentYear}-01-01`;

      // Get all active employees
      let allEmployees = await storage.getEmployees();
      allEmployees = allEmployees.filter(e => e.isActive);
      
      // Filter by manager's locations if not admin
      if (user.role === "manager" && user.locationIds && user.locationIds.length > 0) {
        const allLocations = await storage.getLocations();
        const userLocationNames = allLocations
          .filter(loc => user.locationIds.includes(String(loc.id)))
          .map(loc => loc.name);
        allEmployees = allEmployees.filter(emp => 
          emp.location && userLocationNames.includes(emp.location)
        );
      }

      const alerts: Array<{
        employeeId: number;
        employeeName: string;
        location: string | null;
        jobTitle: string;
        occurrenceTotal: number;
        netTally: number;
        threshold: 5 | 7 | 8;
        message: string;
      }> = [];

      // Calculate occurrence totals for each employee
      for (const emp of allEmployees) {
        const allOccurrences = await storage.getOccurrences(emp.id, startDate, endDate);
        const activeOccurrences = allOccurrences.filter(o => o.status === 'active');
        const totalPoints = activeOccurrences.reduce((sum, o) => sum + o.occurrenceValue, 0) / 100;

        // Get adjustments for this year
        const adjustments = await storage.getOccurrenceAdjustmentsForYear(emp.id, currentYear);
        const manualAdjustments = adjustments.filter(a => a.adjustmentType !== 'perfect_attendance');
        const manualAdjustmentTotal = manualAdjustments.reduce((sum, a) => sum + a.adjustmentValue, 0) / 100;

        // Check for perfect attendance bonus
        const yearOccurrences = await storage.getOccurrences(emp.id, yearStart, endDate);
        const activeYearOccurrences = yearOccurrences.filter(o => o.status === 'active');
        let perfectAttendanceBonus = 0;

        if (activeYearOccurrences.length === 0) {
          const yearStartDate = new Date(`${currentYear}-01-01T00:00:00`);
          const daysSinceYearStart = Math.floor((now.getTime() - yearStartDate.getTime()) / (1000 * 60 * 60 * 24));
          if (daysSinceYearStart >= 90) perfectAttendanceBonus = -1.0;
        } else {
          const sortedOccurrences = [...activeYearOccurrences].sort((a, b) => 
            new Date(b.occurrenceDate).getTime() - new Date(a.occurrenceDate).getTime()
          );
          const mostRecentDate = new Date(sortedOccurrences[0].occurrenceDate + 'T00:00:00');
          const daysSinceLastOccurrence = Math.floor((now.getTime() - mostRecentDate.getTime()) / (1000 * 60 * 60 * 24));
          if (daysSinceLastOccurrence >= 90) perfectAttendanceBonus = -1.0;
        }

        const totalAdjustment = manualAdjustmentTotal + perfectAttendanceBonus;
        const netTally = Math.max(0, totalPoints + totalAdjustment);

        // Check thresholds (using netTally for accurate count)
        if (netTally >= 8) {
          alerts.push({
            employeeId: emp.id,
            employeeName: emp.name,
            location: emp.location,
            jobTitle: emp.jobTitle,
            occurrenceTotal: totalPoints,
            netTally,
            threshold: 8,
            message: `${emp.name} has reached ${netTally.toFixed(1)} occurrences. Termination threshold exceeded.`
          });
        } else if (netTally >= 7) {
          alerts.push({
            employeeId: emp.id,
            employeeName: emp.name,
            location: emp.location,
            jobTitle: emp.jobTitle,
            occurrenceTotal: totalPoints,
            netTally,
            threshold: 7,
            message: `${emp.name} is at ${netTally.toFixed(1)} occurrences. At termination threshold.`
          });
        } else if (netTally >= 5) {
          alerts.push({
            employeeId: emp.id,
            employeeName: emp.name,
            location: emp.location,
            jobTitle: emp.jobTitle,
            occurrenceTotal: totalPoints,
            netTally,
            threshold: 5,
            message: `${emp.name} is at ${netTally.toFixed(1)} occurrences. Final written warning threshold.`
          });
        }
      }

      // Sort by severity (8 first, then 7, then 5) and then by netTally descending
      alerts.sort((a, b) => {
        if (a.threshold !== b.threshold) return b.threshold - a.threshold;
        return b.netTally - a.netTally;
      });

      res.json(alerts);
    } catch (error) {
      console.error("Error fetching occurrence alerts:", error);
      res.status(500).json({ message: "Failed to fetch occurrence alerts" });
    }
  });

  // Create an occurrence adjustment
  app.post("/api/occurrence-adjustments", requireAuth, async (req, res) => {
    try {
      const user = (req.session as any)?.user;
      if (user.role !== "admin" && user.role !== "manager") {
        return res.status(403).json({ message: "Only managers and admins can create adjustments" });
      }
      
      const { employeeId, adjustmentValue, adjustmentType, notes, calendarYear } = req.body;
      
      if (!employeeId || adjustmentValue === undefined || !adjustmentType) {
        return res.status(400).json({ message: "employeeId, adjustmentValue, and adjustmentType are required" });
      }
      
      const year = calendarYear || new Date().getFullYear();
      
      // Check if employee already has 2 adjustments this year
      const existingAdjustments = await storage.getOccurrenceAdjustmentsForYear(employeeId, year);
      if (existingAdjustments.length >= 2) {
        return res.status(400).json({ message: "Employee has already used maximum 2 adjustments for this year" });
      }
      
      const adjustment = await storage.createOccurrenceAdjustment({
        employeeId,
        adjustmentDate: new Date().toISOString().split('T')[0],
        adjustmentValue,
        adjustmentType,
        notes: notes || null,
        calendarYear: year,
        createdBy: user.id
      });
      
      res.status(201).json(adjustment);
    } catch (error) {
      console.error("Error creating adjustment:", error);
      res.status(500).json({ message: "Failed to create adjustment" });
    }
  });

  // === SEED DATA ===
  await seedDatabase();

  return httpServer;
}

async function seedDatabase() {
  const employees = await storage.getEmployees();
  if (employees.length === 0) {
    console.log("Seeding database...");
    
    // Create Role Requirements
    await storage.createRoleRequirement({ jobTitle: "Chef", requiredWeeklyHours: 40 });
    await storage.createRoleRequirement({ jobTitle: "Waiter", requiredWeeklyHours: 80 });
    await storage.createRoleRequirement({ jobTitle: "Bartender", requiredWeeklyHours: 40 });
    await storage.createRoleRequirement({ jobTitle: "Manager", requiredWeeklyHours: 40 });

    // Create Employees
    const chef = await storage.createEmployee({ 
      name: "Gordon Ramsay", 
      email: "gordon@kitchen.com", 
      jobTitle: "Chef", 
      maxWeeklyHours: 50,
      color: "#ef4444" // Red
    });

    const manager1 = await storage.createEmployee({ 
      name: "Tony Soprano", 
      email: "tony@management.com", 
      jobTitle: "Manager", 
      maxWeeklyHours: 45,
      color: "#8b5cf6" // Purple
    });

    const manager2 = await storage.createEmployee({ 
      name: "Carmela Soprano", 
      email: "carmela@management.com", 
      jobTitle: "Manager", 
      maxWeeklyHours: 45,
      color: "#d946ef" // Pink
    });

    const waiter1 = await storage.createEmployee({ 
      name: "John Doe", 
      email: "john@kitchen.com", 
      jobTitle: "Waiter", 
      maxWeeklyHours: 40,
      color: "#3b82f6" // Blue
    });

    const waiter2 = await storage.createEmployee({ 
      name: "Jane Smith", 
      email: "jane@kitchen.com", 
      jobTitle: "Waiter", 
      maxWeeklyHours: 30,
      color: "#60a5fa" // Lighter Blue
    });

    const bartender = await storage.createEmployee({ 
      name: "Moe Szyslak", 
      email: "moe@bar.com", 
      jobTitle: "Bartender", 
      maxWeeklyHours: 45,
      color: "#10b981" // Green
    });

    // Create some initial shifts for the current week
    const now = new Date();
    // Monday 9am-5pm
    const mondayStart = new Date(now);
    mondayStart.setHours(9, 0, 0, 0);
    const mondayEnd = new Date(now);
    mondayEnd.setHours(17, 0, 0, 0);

    await storage.createShift({
      employeeId: chef.id,
      startTime: mondayStart,
      endTime: mondayEnd
    });

    await storage.createShift({
      employeeId: waiter1.id,
      startTime: mondayStart,
      endTime: mondayEnd
    });

    // Create a time off request
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);
    
    await storage.createTimeOffRequest({
      employeeId: waiter2.id,
      startDate: nextWeek.toISOString().split('T')[0],
      endDate: nextWeek.toISOString().split('T')[0],
      reason: "Doctor's appointment",
      status: "pending"
    });

    console.log("Database seeded successfully!");
  }
}
