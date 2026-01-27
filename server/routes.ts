
import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { ukgClient } from "./ukg";
import { RETAIL_JOB_CODES } from "@shared/schema";
import { toZonedTime, fromZonedTime } from "date-fns-tz";

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

  // === Employees ===
  app.get(api.employees.list.path, async (req, res) => {
    let employees = await storage.getEmployees();
    
    // Filter by retail job codes if requested
    const retailOnly = req.query.retailOnly === "true";
    if (retailOnly) {
      employees = employees.filter(emp => 
        RETAIL_JOB_CODES.some(code => emp.jobTitle.toUpperCase().includes(code))
      );
    }
    
    // Filter by location for users with assigned locations (applies to all roles including admin)
    // user.locationIds contains location IDs (as strings), but emp.location contains location NAMES
    // We need to look up the location names from the IDs
    const user = (req.session as any)?.user;
    if (user && user.locationIds && user.locationIds.length > 0) {
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
  app.get(api.globalSettings.get.path, async (req, res) => {
    const settings = await storage.getGlobalSettings();
    res.json(settings);
  });

  app.post(api.globalSettings.update.path, async (req, res) => {
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
      const { weekStart } = api.schedule.generate.input.parse(req.body);
      // Normalize weekStart to EST timezone
      const startDate = new Date(weekStart);
      
      const employees = await storage.getEmployees();
      const settings = await storage.getGlobalSettings();
      const timeOff = await storage.getTimeOffRequests();
      const locations = await storage.getLocations();

      // Clear existing shifts for the week (7 days from start)
      const weekEndMs = startDate.getTime() + 7 * 24 * 60 * 60 * 1000;
      const weekEndDate = new Date(weekEndMs);
      const existingShifts = await storage.getShifts(startDate, weekEndDate);
      for (const shift of existingShifts) {
        await storage.deleteShift(shift.id);
      }

      const generatedShifts = [];
      
      // Calculate total available hours from all active locations
      const activeLocations = locations.filter(l => l.isActive);
      const totalAvailableHours = activeLocations.reduce((sum, loc) => sum + (loc.weeklyHoursLimit || 0), 0);
      
      // Get labor allocation percentages from settings
      const cashieringPercent = settings.cashieringPercent ?? 40;
      const donationPricingPercent = settings.donationPricingPercent ?? 35;
      const donorGreetingPercent = settings.donorGreetingPercent ?? 25;
      
      // Validate percentages sum to 100 (normalize if not)
      const totalPercent = cashieringPercent + donationPricingPercent + donorGreetingPercent;
      const normalizedCashiering = totalPercent > 0 ? cashieringPercent / totalPercent : 0.4;
      const normalizedDonationPricing = totalPercent > 0 ? donationPricingPercent / totalPercent : 0.35;
      const normalizedDonorGreeting = totalPercent > 0 ? donorGreetingPercent / totalPercent : 0.25;
      
      // Calculate weekly hours per labor category based on percentages
      const cashieringHours = Math.floor(totalAvailableHours * normalizedCashiering);
      const donationPricingHours = Math.floor(totalAvailableHours * normalizedDonationPricing);
      const donorGreetingHours = Math.floor(totalAvailableHours * normalizedDonorGreeting);
      
      // Map labor categories to job codes
      // Cashiering: CASHSLS
      // Donation Pricing: DONPRI, APPROC
      // Donor Greeting: DONDOOR
      const laborCategories = [
        { 
          name: 'Cashiering', 
          jobCodes: ['CASHSLS'], 
          weeklyHours: cashieringHours,
          assignedHours: 0
        },
        { 
          name: 'Donation Pricing', 
          jobCodes: ['DONPRI', 'APPROC'], 
          weeklyHours: donationPricingHours,
          assignedHours: 0
        },
        { 
          name: 'Donor Greeting', 
          jobCodes: ['DONDOOR'], 
          weeklyHours: donorGreetingHours,
          assignedHours: 0
        }
      ];
      
      // Group employees by job code and track their weekly hours
      const employeeHours: Record<number, number> = {};
      employees.forEach(emp => { employeeHours[emp.id] = 0; });
      
      // Manager job codes for coverage (STSUPER = Store Manager)
      const managerCodes = ['STSUPER', 'STASSTSP', 'STLDWKR'];
      const managers = employees.filter(emp => 
        managerCodes.includes(emp.jobTitle) && emp.isActive
      );
      
      // Shift durations (8.5 hours clock time - 0.5 unpaid lunch = 8 paid hours)
      const SHIFT_HOURS = 8;
      
      // Track days worked per employee (for 2 days off requirement)
      const employeeDaysWorked: Record<number, number> = {};
      employees.forEach(emp => { employeeDaysWorked[emp.id] = 0; });

      // Helper to check if employee is on approved time off
      const isOnTimeOff = (empId: number, day: Date) => {
        return timeOff.some(to => 
          to.employeeId === empId && 
          to.status === "approved" && 
          new Date(to.startDate) <= day && 
          new Date(to.endDate) >= day
        );
      };
      
      // Helper to check if employee can work (has capacity for 2 days off)
      const canWorkMoreDays = (empId: number) => {
        // Max 5 days worked = minimum 2 days off
        return employeeDaysWorked[empId] < 5;
      };

      // Day-by-day generation
      for (let i = 0; i < 7; i++) {
        const currentDayMs = startDate.getTime() + i * 24 * 60 * 60 * 1000;
        const currentDay = new Date(currentDayMs);

        // 1. Manager Coverage (opening and closing shifts)
        const managersRequired = settings.managersRequired ?? 1;
        
        // Opening shift (08:00 - 16:30 EST)
        const morningStart = createESTTime(currentDay, 8, 0);
        const morningEnd = createESTTime(currentDay, 16, 30);
        
        // Closing shift (12:00 - 20:30 EST)
        const eveningStart = createESTTime(currentDay, 12, 0);
        const eveningEnd = createESTTime(currentDay, 20, 30);
        
        const assignedMorningManagers: number[] = [];
        const assignedEveningManagers: number[] = [];
        
        // Track who worked today to increment days counter once per day
        const workedToday = new Set<number>();
        
        // Assign morning managers
        for (const mgr of managers) {
          if (assignedMorningManagers.length >= managersRequired) break;
          if (isOnTimeOff(mgr.id, currentDay)) continue;
          if (employeeHours[mgr.id] + SHIFT_HOURS > mgr.maxWeeklyHours) continue;
          if (!canWorkMoreDays(mgr.id)) continue; // 2 days off requirement
          
          const shift = await storage.createShift({ 
            employeeId: mgr.id, 
            startTime: morningStart, 
            endTime: morningEnd 
          });
          generatedShifts.push(shift);
          employeeHours[mgr.id] += SHIFT_HOURS;
          assignedMorningManagers.push(mgr.id);
          workedToday.add(mgr.id);
        }
        
        // Assign evening managers (different from morning)
        for (const mgr of managers) {
          if (assignedEveningManagers.length >= managersRequired) break;
          if (assignedMorningManagers.includes(mgr.id)) continue; // Not same as morning
          if (isOnTimeOff(mgr.id, currentDay)) continue;
          if (employeeHours[mgr.id] + SHIFT_HOURS > mgr.maxWeeklyHours) continue;
          if (!canWorkMoreDays(mgr.id)) continue; // 2 days off requirement
          
          const shift = await storage.createShift({ 
            employeeId: mgr.id, 
            startTime: eveningStart, 
            endTime: eveningEnd 
          });
          generatedShifts.push(shift);
          employeeHours[mgr.id] += SHIFT_HOURS;
          assignedEveningManagers.push(mgr.id);
          workedToday.add(mgr.id);
        }

        // 2. Mandatory Donor Greeter Coverage (one opening, one closing)
        const donorGreeters = employees.filter(emp => 
          emp.jobTitle === 'DONDOOR' && emp.isActive
        );
        const donorGreetingCategory = laborCategories.find(c => c.name === 'Donor Greeting');
        
        let openingGreeterId: number | null = null;
        let closingGreeterAssigned = false;
        
        // Assign opening donor greeter
        for (const greeter of donorGreeters) {
          if (openingGreeterId !== null) break;
          if (isOnTimeOff(greeter.id, currentDay)) continue;
          if (employeeHours[greeter.id] + SHIFT_HOURS > greeter.maxWeeklyHours) continue;
          if (!canWorkMoreDays(greeter.id)) continue; // 2 days off requirement
          
          const shift = await storage.createShift({ 
            employeeId: greeter.id, 
            startTime: morningStart, 
            endTime: morningEnd 
          });
          generatedShifts.push(shift);
          employeeHours[greeter.id] += SHIFT_HOURS;
          if (donorGreetingCategory) donorGreetingCategory.assignedHours += SHIFT_HOURS;
          openingGreeterId = greeter.id;
          workedToday.add(greeter.id);
        }
        
        // Assign closing donor greeter (prefer different employee than opening)
        // First pass: try to find a different employee
        for (const greeter of donorGreeters) {
          if (closingGreeterAssigned) break;
          if (greeter.id === openingGreeterId) continue; // Skip opening greeter first
          if (isOnTimeOff(greeter.id, currentDay)) continue;
          if (employeeHours[greeter.id] + SHIFT_HOURS > greeter.maxWeeklyHours) continue;
          if (!canWorkMoreDays(greeter.id)) continue; // 2 days off requirement
          
          const shift = await storage.createShift({ 
            employeeId: greeter.id, 
            startTime: eveningStart, 
            endTime: eveningEnd 
          });
          generatedShifts.push(shift);
          employeeHours[greeter.id] += SHIFT_HOURS;
          if (donorGreetingCategory) donorGreetingCategory.assignedHours += SHIFT_HOURS;
          closingGreeterAssigned = true;
          workedToday.add(greeter.id);
        }
        
        // Second pass: if no closing greeter yet, allow opening greeter to also close
        if (!closingGreeterAssigned) {
          for (const greeter of donorGreeters) {
            if (closingGreeterAssigned) break;
            if (isOnTimeOff(greeter.id, currentDay)) continue;
            if (employeeHours[greeter.id] + SHIFT_HOURS > greeter.maxWeeklyHours) continue;
            if (!canWorkMoreDays(greeter.id)) continue; // 2 days off requirement
            
            const shift = await storage.createShift({ 
              employeeId: greeter.id, 
              startTime: eveningStart, 
              endTime: eveningEnd 
            });
            generatedShifts.push(shift);
            employeeHours[greeter.id] += SHIFT_HOURS;
            if (donorGreetingCategory) donorGreetingCategory.assignedHours += SHIFT_HOURS;
            closingGreeterAssigned = true;
            workedToday.add(greeter.id);
          }
        }

        // 3. Staff Coverage - Schedule ALL active retail employees
        const openersRequired = settings.openersRequired ?? 2;
        const closersRequired = settings.closersRequired ?? 2;
        
        // Define all shift times
        const allShifts = [
          { type: 'opener', start: morningStart, end: morningEnd },
          { type: 'mid1', start: createESTTime(currentDay, 9, 0), end: createESTTime(currentDay, 17, 30) },
          { type: 'mid2', start: createESTTime(currentDay, 10, 0), end: createESTTime(currentDay, 18, 30) },
          { type: 'mid3', start: createESTTime(currentDay, 11, 0), end: createESTTime(currentDay, 19, 30) },
          { type: 'closer', start: eveningStart, end: eveningEnd }
        ];
        
        // Get ALL active retail employees (not just by category)
        const retailJobCodes = ['CASHSLS', 'DONPRI', 'APPROC', 'DONDOOR'];
        const retailEmployees = employees.filter(emp => 
          retailJobCodes.includes(emp.jobTitle) && emp.isActive
        );
        
        // Shuffle employees to distribute shifts more evenly
        const shuffledEmployees = [...retailEmployees].sort(() => Math.random() - 0.5);
        
        let shiftTypeIndex = 0;
        let openersAssigned = 0;
        let closersAssigned = 0;
        
        for (const emp of shuffledEmployees) {
          // Skip if already worked today (assigned earlier as manager/greeter)
          if (workedToday.has(emp.id)) continue;
          if (isOnTimeOff(emp.id, currentDay)) continue;
          if (employeeHours[emp.id] + SHIFT_HOURS > emp.maxWeeklyHours) continue;
          if (!canWorkMoreDays(emp.id)) continue; // 2 days off requirement
          
          // Pick shift type - prioritize coverage needs
          let shiftStart, shiftEnd;
          if (openersAssigned < openersRequired) {
            shiftStart = allShifts[0].start;
            shiftEnd = allShifts[0].end;
            openersAssigned++;
          } else if (closersAssigned < closersRequired) {
            shiftStart = allShifts[4].start;
            shiftEnd = allShifts[4].end;
            closersAssigned++;
          } else {
            // Rotate through mid-shifts
            const midShiftIdx = (shiftTypeIndex % 3) + 1; // 1, 2, or 3
            shiftStart = allShifts[midShiftIdx].start;
            shiftEnd = allShifts[midShiftIdx].end;
            shiftTypeIndex++;
          }
          
          const shift = await storage.createShift({ 
            employeeId: emp.id, 
            startTime: shiftStart, 
            endTime: shiftEnd 
          });
          generatedShifts.push(shift);
          employeeHours[emp.id] += SHIFT_HOURS;
          workedToday.add(emp.id);
        }
        
        // Increment days worked for each employee who worked today
        Array.from(workedToday).forEach(empId => {
          employeeDaysWorked[empId]++;
        });
      }

      res.status(201).json(generatedShifts);
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
      
      const existingShifts = await storage.getShifts(startDate, endDate);
      let deletedCount = 0;
      
      for (const shift of existingShifts) {
        await storage.deleteShift(shift.id);
        deletedCount++;
      }
      
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
