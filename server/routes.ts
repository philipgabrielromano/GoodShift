
import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { ukgClient } from "./ukg";
import { RETAIL_JOB_CODES } from "@shared/schema";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { isHoliday, getPaidHolidaysInRange, isEligibleForPaidHoliday } from "./holidays";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { sendOccurrenceAlertEmail, testOutlookConnection, type OccurrenceAlertEmailData } from "./outlook";

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

// Middleware to require manager or admin role
function requireManager(req: Request, res: Response, next: NextFunction) {
  const user = (req.session as any)?.user;
  if (!user || (user.role !== "admin" && user.role !== "manager")) {
    return res.status(403).json({ message: "Manager access required" });
  }
  next();
}

// Helper function to check if HR notification should be sent for occurrence thresholds
// Sends emails to managers assigned to the employee's store location
// addedOccurrenceValue: the value of the occurrence just added (used to detect crossing vs already over)
async function checkAndSendHRNotification(
  employeeId: number, 
  addedOccurrenceValue: number, 
  appUrl: string
): Promise<void> {
  try {
    const employee = await storage.getEmployee(employeeId);
    if (!employee) {
      return;
    }

    // Calculate current occurrence tally (rolling 12-month window)
    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const startDate = oneYearAgo.toISOString().split('T')[0];
    const endDate = now.toISOString().split('T')[0];
    const currentYear = now.getFullYear();

    // Get occurrences and adjustments
    const occurrences = await storage.getOccurrences(employeeId, startDate, endDate);
    const adjustments = await storage.getOccurrenceAdjustmentsForYear(employeeId, currentYear);
    const correctiveActions = await storage.getCorrectiveActions(employeeId);

    // Calculate net tally (includes the newly added occurrence)
    const activeOccurrences = occurrences.filter(o => o.status === 'active');
    const countableOccurrences = activeOccurrences.filter(o => !o.isFmla && !o.isConsecutiveSickness);
    const totalPoints = countableOccurrences.reduce((sum, o) => sum + o.occurrenceValue, 0) / 100;

    const activeAdjustments = adjustments.filter(a => a.status === 'active');
    const manualAdjustments = activeAdjustments.filter(a => a.adjustmentType !== 'perfect_attendance');
    const manualAdjustmentTotal = manualAdjustments.reduce((sum, a) => sum + a.adjustmentValue, 0) / 100;

    // Note: Perfect attendance bonus calculation is complex and depends on timing
    // For threshold crossing detection, we use a simplified calculation without the bonus
    // since adding an occurrence would typically invalidate perfect attendance anyway
    const adjustmentTotal = manualAdjustmentTotal;
    const netTally = Math.max(0, totalPoints + adjustmentTotal);
    
    // Calculate what the tally was BEFORE this occurrence was added
    const addedPoints = addedOccurrenceValue / 100;
    const previousTally = Math.max(0, netTally - addedPoints);

    // Helper to check if threshold was JUST crossed (not already over)
    const justCrossedThreshold = (thresholdValue: number): boolean => {
      return previousTally < thresholdValue && netTally >= thresholdValue;
    };

    // Check if a threshold was JUST crossed (previousTally < threshold <= netTally)
    let threshold: 5 | 7 | 8 | null = null;
    if (justCrossedThreshold(8)) {
      const hasTerminationAction = correctiveActions.some(a => a.actionType === 'termination');
      if (!hasTerminationAction) threshold = 8;
    } else if (justCrossedThreshold(7)) {
      const hasFinalWarning = correctiveActions.some(a => a.actionType === 'final_warning');
      if (!hasFinalWarning) threshold = 7;
    } else if (justCrossedThreshold(5)) {
      const hasWarning = correctiveActions.some(a => a.actionType === 'warning');
      if (!hasWarning) threshold = 5;
    }

    if (threshold) {
      console.log(`[HR Notification] Employee ${employee.name} crossed ${threshold}-point threshold (${previousTally.toFixed(1)} -> ${netTally.toFixed(1)})`);
      
      // Find the managers for this employee's store location
      const managerEmails: string[] = [];
      
      if (employee.location) {
        // Get all locations to find the location ID by name
        const locations = await storage.getLocations();
        const employeeLocation = locations.find(loc => loc.name === employee.location);
        
        if (employeeLocation) {
          // Get all users and find managers assigned to this location
          const users = await storage.getUsers();
          const storeManagers = users.filter(user => 
            user.isActive && 
            (user.role === 'manager' || user.role === 'admin') &&
            user.locationIds?.includes(String(employeeLocation.id))
          );
          
          storeManagers.forEach(manager => {
            if (manager.email) {
              managerEmails.push(manager.email);
            }
          });
          
          console.log(`[HR Notification] Found ${storeManagers.length} managers for location "${employee.location}": ${managerEmails.join(', ') || 'none'}`);
        } else {
          console.log(`[HR Notification] Could not find location ID for "${employee.location}"`);
        }
      }
      
      // If no store managers found, fall back to global HR email from settings
      if (managerEmails.length === 0) {
        const settings = await storage.getGlobalSettings();
        if (settings?.hrNotificationEmail) {
          managerEmails.push(settings.hrNotificationEmail);
          console.log(`[HR Notification] No store managers found, falling back to HR email: ${settings.hrNotificationEmail}`);
        }
      }
      
      if (managerEmails.length === 0) {
        console.log('[HR Notification] No recipients configured, skipping email');
        return;
      }
      
      const emailData: OccurrenceAlertEmailData = {
        employeeId: employee.id,
        employeeName: employee.name,
        employeeEmail: employee.email || undefined,
        jobTitle: employee.jobTitle || 'Unknown',
        location: employee.location || 'Unknown',
        netTally,
        threshold,
        appUrl
      };

      // Send email to each manager
      for (const email of managerEmails) {
        await sendOccurrenceAlertEmail(email, emailData);
      }
    }
  } catch (error) {
    console.error('[HR Notification] Failed to check/send notification:', error);
  }
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
      
      console.log(`[API] Employee filter - User: ${user.email}, Role: ${user.role}, LocationIds: ${JSON.stringify(user.locationIds)}, Resolved location names: ${JSON.stringify(userLocationNames)}`);
      
      const beforeCount = employees.length;
      employees = employees.filter(emp => 
        emp.location && userLocationNames.includes(emp.location)
      );
      console.log(`[API] Employee filter - Before: ${beforeCount}, After: ${employees.length}`);
    }
    
    // Viewers can only see employees for published schedules
    // They get limited employee data (just what's needed for schedule viewing)
    // Also filter out hidden employees for viewers
    if (user?.role === "viewer") {
      // Filter out hidden employees for viewers
      employees = employees.filter(emp => !emp.isHiddenFromSchedule);
      
      // Return limited employee data for schedule viewing
      const limitedEmployees = employees.map(emp => ({
        id: emp.id,
        name: emp.name,
        jobTitle: emp.jobTitle,
        location: emp.location,
        employmentType: emp.employmentType,
        maxWeeklyHours: emp.maxWeeklyHours,
        isActive: emp.isActive,
        isHiddenFromSchedule: emp.isHiddenFromSchedule,
        color: emp.color,
        // Exclude sensitive fields like email, ukgId, etc.
        email: "",
        ukgEmployeeId: null,
        hireDate: null,
        preferredDaysPerWeek: emp.preferredDaysPerWeek,
        nonWorkingDays: emp.nonWorkingDays,
      }));
      return res.json(limitedEmployees);
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

  app.put(api.employees.update.path, requireManager, async (req, res) => {
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

  // Toggle employee schedule visibility (for managers to hide terminated employees pending UKG update)
  app.post(api.employees.toggleScheduleVisibility.path, requireManager, async (req, res) => {
    try {
      const input = api.employees.toggleScheduleVisibility.input.parse(req.body);
      const employee = await storage.updateEmployee(Number(req.params.id), {
        isHiddenFromSchedule: input.isHiddenFromSchedule,
      });
      if (!employee) {
        return res.status(404).json({ message: "Employee not found" });
      }
      res.json(employee);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      return res.status(404).json({ message: "Employee not found" });
    }
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

  // Test Outlook connection for HR notifications
  app.get("/api/outlook/test", requireAuth, requireAdmin, async (req, res) => {
    try {
      const result = await testOutlookConnection();
      if (result.success) {
        res.json({ success: true, message: "Outlook connection is working" });
      } else {
        res.status(500).json({ success: false, message: result.error || "Outlook connection failed" });
      }
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to test Outlook connection" });
    }
  });

  // Send test HR notification email
  app.post("/api/outlook/test-email", requireAuth, requireAdmin, async (req, res) => {
    try {
      const settings = await storage.getGlobalSettings();
      if (!settings?.hrNotificationEmail) {
        return res.status(400).json({ success: false, message: "No HR notification email configured in settings" });
      }

      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host || 'localhost:5000';
      const appUrl = `${protocol}://${host}`;

      const testData: OccurrenceAlertEmailData = {
        employeeId: 0,
        employeeName: "Test Employee",
        jobTitle: "Test Position",
        location: "Test Location",
        netTally: 5.0,
        threshold: 5,
        appUrl
      };

      const sent = await sendOccurrenceAlertEmail(settings.hrNotificationEmail, testData);
      if (sent) {
        res.json({ success: true, message: `Test email sent to ${settings.hrNotificationEmail}` });
      } else {
        res.status(500).json({ success: false, message: "Failed to send test email" });
      }
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to send test email" });
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
      
      // Get station limits from the selected location (0 = unlimited, use reasonable defaults)
      const selectedLocation = location ? locations.find(l => l.name === location) : null;
      const apparelStationLimit = selectedLocation?.apparelProcessorStations || 0; // 0 = unlimited
      const pricerStationLimit = selectedLocation?.donationPricingStations || 0; // 0 = unlimited
      // Use limit if set (>0), otherwise default to 2 for apparel, 1 for pricers
      const maxApparelStations = apparelStationLimit > 0 ? apparelStationLimit : 2;
      const maxPricerStations = pricerStationLimit > 0 ? pricerStationLimit : 1;
      console.log(`[Scheduler] Station limits for ${location || 'all locations'}: Apparel=${maxApparelStations}, Pricers=${maxPricerStations}`);
      
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

      // Get existing shifts for the week - we'll preserve these and only fill gaps
      const existingShifts = await storage.getShifts(startDate, weekEndDate);
      console.log(`[Scheduler] Found ${existingShifts.length} existing shifts to preserve`);
      
      // Track which employee-day combinations already have shifts
      const existingShiftsByEmpDay = new Set<string>();
      const existingHoursByEmployee = new Map<number, number>();
      const existingDaysByEmployee = new Map<number, Set<number>>();
      
      // Use timezone-aware calculation for weekStart to match how days are computed elsewhere
      const weekStartZoned = toZonedTime(startDate, TIMEZONE);
      const weekStartDay = weekStartZoned.getDate();
      const weekStartMonth = weekStartZoned.getMonth();
      const weekStartYear = weekStartZoned.getFullYear();
      
      for (const shift of existingShifts) {
        // Convert shift start time to Eastern timezone for accurate day calculation
        const shiftStartZoned = toZonedTime(new Date(shift.startTime), TIMEZONE);
        
        // Calculate day index based on calendar day in Eastern timezone
        // This is more accurate than raw millisecond math which can be off due to DST
        const shiftDay = shiftStartZoned.getDate();
        const shiftMonth = shiftStartZoned.getMonth();
        const shiftYear = shiftStartZoned.getFullYear();
        
        // Calculate days since week start
        const weekStartDate = new Date(weekStartYear, weekStartMonth, weekStartDay);
        const shiftDateOnly = new Date(shiftYear, shiftMonth, shiftDay);
        const dayIndex = Math.round((shiftDateOnly.getTime() - weekStartDate.getTime()) / (24 * 60 * 60 * 1000));
        
        if (dayIndex >= 0 && dayIndex < 7) {
          const key = `${shift.employeeId}-${dayIndex}`;
          existingShiftsByEmpDay.add(key);
          
          // Calculate hours for this shift
          const hours = (new Date(shift.endTime).getTime() - new Date(shift.startTime).getTime()) / (1000 * 60 * 60);
          const paidHours = hours >= 6 ? hours - 0.5 : hours; // Subtract unpaid lunch for 6+ hour shifts
          
          const currentHours = existingHoursByEmployee.get(shift.employeeId) || 0;
          existingHoursByEmployee.set(shift.employeeId, currentHours + paidHours);
          
          const currentDays = existingDaysByEmployee.get(shift.employeeId) || new Set<number>();
          currentDays.add(dayIndex);
          existingDaysByEmployee.set(shift.employeeId, currentDays);
        }
      }
      
      // Helper to count existing shifts for a role on a specific day
      // Used to recognize template-applied shifts as coverage
      const countExistingShiftsForRole = (roleEmployeeIds: number[], dayIndex: number): number => {
        let count = 0;
        for (const empId of roleEmployeeIds) {
          const key = `${empId}-${dayIndex}`;
          if (existingShiftsByEmpDay.has(key)) {
            count++;
          }
        }
        return count;
      };
      
      // Collect shifts in memory first, then batch insert at the end for performance
      const pendingShifts: { employeeId: number; startTime: Date; endTime: Date }[] = [];

      // ========== RANDOMIZATION FOR SHIFT VARIETY ==========
      // Helper to pick a random element from an array
      const randomPick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

      // Fisher-Yates shuffle to randomize employee order each generation
      // This ensures employees don't always get the same shifts (opener vs closer)
      const shuffleArray = <T>(array: T[]): T[] => {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
      };

      const FULL_SHIFT_HOURS = 8; // 8.5 clock hours - 0.5 unpaid lunch = 8 paid hours
      const SHORT_SHIFT_HOURS = 5.5; // 5.5 clock hours - NO lunch deduction (less than 6 hours)
      const GAP_SHIFT_HOURS = 5; // 5 clock hours = 5 paid hours (under 6h, no lunch deduction)
      const PROD_AFTERNOON_HOURS = 4; // 4 clock hours = 4 paid hours (production afternoon shift)
      
      // ========== EMPLOYEE STATE TRACKING ==========
      const employeeState: Record<number, {
        hoursScheduled: number;
        daysWorked: number;
        daysWorkedOn: Set<number>; // Track which day indices they work
      }> = {};
      
      // Calculate PAL hours per employee for the week (PAID leave only)
      // Note: totalHours in the database is stored in MINUTES, so we convert to hours
      // IMPORTANT: UTO (unpaid time off) does NOT count toward weekly hours - those days are just blocked
      const palHoursByEmployee = new Map<number, number>();
      palEntries.forEach(entry => {
        const employee = employeeByUkgId.get(entry.ukgEmployeeId);
        if (employee && entry.totalHours) {
          const current = palHoursByEmployee.get(employee.id) || 0;
          const hoursFromMinutes = entry.totalHours / 60; // Convert minutes to hours
          palHoursByEmployee.set(employee.id, current + hoursFromMinutes);
        }
      });
      
      // Calculate paid holidays in the scheduling week
      const paidHolidaysInWeek = getPaidHolidaysInRange(startDate, weekEndDate);
      if (paidHolidaysInWeek.length > 0) {
        console.log(`[Scheduler] Paid holidays in week: ${paidHolidaysInWeek.map(h => h.name).join(', ')}`);
      }
      
      employees.forEach(emp => {
        // Initialize with PAL hours already counted toward weekly total
        const palHours = palHoursByEmployee.get(emp.id) || 0;
        
        // Calculate paid holiday hours for eligible full-time employees (30+ days service)
        let paidHolidayHours = 0;
        for (const holiday of paidHolidaysInWeek) {
          if (isEligibleForPaidHoliday(emp.hireDate, holiday.date, emp.employmentType)) {
            paidHolidayHours += 8;
          }
        }
        
        // Include existing shift hours and days in the pre-counted totals
        const existingHours = existingHoursByEmployee.get(emp.id) || 0;
        const existingDays = existingDaysByEmployee.get(emp.id) || new Set<number>();
        
        // Pre-count PAL hours, paid holiday hours, AND existing shift hours
        const preCountedHours = palHours + paidHolidayHours + existingHours;
        employeeState[emp.id] = { 
          hoursScheduled: preCountedHours, 
          daysWorked: existingDays.size, 
          daysWorkedOn: new Set(existingDays) 
        };
        
        const parts = [];
        if (palHours > 0) parts.push(`${palHours.toFixed(1)} PAL`);
        if (paidHolidayHours > 0) parts.push(`${paidHolidayHours} holiday`);
        if (existingHours > 0) parts.push(`${existingHours.toFixed(1)} existing`);
        if (parts.length > 0) {
          console.log(`[Scheduler] ${emp.name}: ${parts.join(' + ')} hours pre-counted (total: ${preCountedHours.toFixed(1)})`);
        }
      });

      // ========== HELPER FUNCTIONS ==========
      // Day names array: index 0 = Sunday (matching dayIndex from weekStart which is always Sunday)
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      
      const isOnTimeOff = (empId: number, day: Date, dayIndex: number) => {
        // Check if employee already has an existing shift on this day (preserve manual assignments)
        const existingKey = `${empId}-${dayIndex}`;
        if (existingShiftsByEmpDay.has(existingKey)) return true;
        
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
      
      // Check if employee can work a 4-hour production afternoon shift
      const canWorkProdAfternoonShift = (emp: typeof employees[0], day: Date, dayIndex: number) => {
        const state = employeeState[emp.id];
        if (!emp.isActive) return false;
        if (isOnTimeOff(emp.id, day, dayIndex)) return false;
        if (state.hoursScheduled + PROD_AFTERNOON_HOURS > emp.maxWeeklyHours) return false;
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
        // Uses job code constants defined in the outer scope
        const getFullShift = () => {
          if (donationPricerCodes.includes(emp.jobTitle)) return shifts.opener;
          else if (donorGreeterCodes.includes(emp.jobTitle)) return shifts.closer;
          else return shifts.mid10;
        };
        
        const getShortShift = () => {
          if (donationPricerCodes.includes(emp.jobTitle)) return shifts.shortMorning;
          else if (donorGreeterCodes.includes(emp.jobTitle)) {
            // Rotate greeter short shifts for variety: 10-3:30, 12-5:30, 3-8:30
            const greeterShortOptions = [shifts.shortMid10, shifts.shortMid12, shifts.shortEvening];
            const rotationIndex = (state.daysWorked + emp.id) % greeterShortOptions.length;
            return greeterShortOptions[rotationIndex];
          }
          else return shifts.shortMid;
        };
        
        const getGapShift = () => {
          if (donationPricerCodes.includes(emp.jobTitle)) return shifts.gapMorning;
          else if (donorGreeterCodes.includes(emp.jobTitle)) return shifts.gapEvening;
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
      // Include both standard and WV (Weirton) job codes
      // Leadership positions are tiered for flexible coverage:
      // - Tier 1: Store Manager (STSUPER/WVSTMNG) - highest priority
      // - Tier 2: Assistant Manager (STASSTSP/WVSTAST) - second priority
      // - Tier 3: Team Lead (STLDWKR/WVLDWRK) - can fill in when higher tiers unavailable
      const storeManagerCodes = ['STSUPER', 'WVSTMNG'];
      const assistantManagerCodes = ['STASSTSP', 'WVSTAST'];
      const teamLeadCodes = ['STLDWKR', 'WVLDWRK'];
      const allLeadershipCodes = [...storeManagerCodes, ...assistantManagerCodes, ...teamLeadCodes];
      
      const donorGreeterCodes = ['DONDOOR', 'WVDON'];
      const donationPricerCodes = ['DONPRI', 'DONPRWV']; // Donation pricers only
      const apparelProcessorCodes = ['APPROC', 'APWV']; // Apparel processors only
      const cashierCodes = ['CASHSLS', 'CSHSLSWV'];
      
      // Categorize leadership by tier
      const storeManagers = employees.filter(emp => storeManagerCodes.includes(emp.jobTitle) && emp.isActive);
      const assistantManagers = employees.filter(emp => assistantManagerCodes.includes(emp.jobTitle) && emp.isActive);
      const teamLeads = employees.filter(emp => teamLeadCodes.includes(emp.jobTitle) && emp.isActive);
      
      // Combined leadership pool (all tiers) - used for flexible coverage
      const managers = employees.filter(emp => allLeadershipCodes.includes(emp.jobTitle) && emp.isActive);
      const donorGreeters = employees.filter(emp => donorGreeterCodes.includes(emp.jobTitle) && emp.isActive);
      const donationPricers = employees.filter(emp => donationPricerCodes.includes(emp.jobTitle) && emp.isActive);
      const apparelProcessors = employees.filter(emp => apparelProcessorCodes.includes(emp.jobTitle) && emp.isActive);
      const cashiers = employees.filter(emp => cashierCodes.includes(emp.jobTitle) && emp.isActive);
      
      console.log(`[Scheduler] Total employees: ${employees.length}`);
      console.log(`[Scheduler] Leadership breakdown - Store Mgrs: ${storeManagers.length}, Asst Mgrs: ${assistantManagers.length}, Team Leads: ${teamLeads.length}`);
      console.log(`[Scheduler] Other roles - Greeters: ${donorGreeters.length}, Pricers: ${donationPricers.length}, Apparel: ${apparelProcessors.length}, Cashiers: ${cashiers.length}`);
      
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
          // Greeter short shift varieties for better coverage spread
          shortMid10: { start: createESTTime(day, 10, 0), end: createESTTime(day, 15, 30) }, // 10-3:30
          shortMid12: isSunday
            ? { start: createESTTime(day, 12, 0), end: createESTTime(day, 17, 30) } // 12-5:30 (fits Sunday close)
            : { start: createESTTime(day, 12, 0), end: createESTTime(day, 17, 30) }, // 12-5:30
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
            : { start: createESTTime(day, 15, 30), end: createESTTime(day, 20, 30) },
          // Production Afternoon Shift (4 clock hours = 4 paid hours, no lunch)
          // Used for production workers to cover stations after morning person leaves
          prodAfternoon: isSunday
            ? { start: createESTTime(day, 15, 30), end: createESTTime(day, 19, 30) } // Sunday closes at 7:30
            : { start: createESTTime(day, 16, 30), end: createESTTime(day, 20, 30) }
        };
      };

      // ========== DAILY COVERAGE REQUIREMENTS ==========
      const managersRequired = settings.managersRequired ?? 1;
      const openersRequired = settings.openersRequired ?? 2;
      const closersRequired = settings.closersRequired ?? 2;

      // Day weights: Sat/Fri get more staff, but all days get coverage
      // RANDOMIZE day order to prevent same managers always working same days
      // This ensures managers don't always hit their max hours before Wed/Thu
      const baseDayOrder = [0, 1, 2, 3, 4, 5, 6]; // Sun through Sat
      const dayOrder = shuffleArray(baseDayOrder); // Randomize processing order
      console.log(`[Scheduler] Day processing order (randomized): ${dayOrder.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}`);

      const dayMultiplier: Record<number, number> = {
        6: 1.3, // Saturday - 30% more staff
        5: 1.3, // Friday - 30% more staff  
        0: 1.0, 1: 1.0, 2: 1.0, 3: 1.0, 4: 1.0 // Weekdays - baseline
      };
      
      // Standard day order for priority scheduling: Saturday first (busiest), then Fri, Sun, Mon...
      const saturdayFirstOrder = [6, 5, 0, 1, 2, 3, 4];
      
      // Short day names for logging (distinct from dayNames used for nonWorkingDays matching)
      const shortDayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

      // ========== PHASE 1: MANDATORY COVERAGE (All 7 days except holidays) ==========
      // First pass: ensure every day has minimum required coverage
      // IMPORTANT: Use ROUND-ROBIN for cashiers to ensure Wed/Thu get coverage before employees hit max days
      // Process managers/greeters/pricers in priority order (Sat/Fri first)
      // Process cashiers using round-robin across all days

      // Helper to sort employees: full-timers first, then by priority
      // Note: We use shuffleArray BEFORE sorting to randomize among equal-priority employees
      // This provides shift variety - employees won't always get the same shifts
      const sortFullTimersFirst = (a: typeof employees[0], b: typeof employees[0]) => {
        // Full-timers (>= 32h) should come before part-timers
        const aIsFullTime = a.maxWeeklyHours >= 32;
        const bIsFullTime = b.maxWeeklyHours >= 32;
        if (aIsFullTime && !bIsFullTime) return -1;
        if (!aIsFullTime && bIsFullTime) return 1;
        // If same type, sort by priority
        const priorityDiff = getEmployeePriority(a) - getEmployeePriority(b);
        return priorityDiff;
        // No tie-breaker - the pre-shuffle provides randomness for equal priority employees
      };
      
      // Helper to shuffle and then sort - provides variety while respecting priorities
      const shuffleAndSort = (empList: typeof employees) => {
        return shuffleArray(empList).sort(sortFullTimersFirst);
      };

      // ========== LEADERSHIP SCHEDULING - TWO-PASS APPROACH ==========
      // Pass 1: Ensure EVERY day gets at least one higher-tier manager (store mgr or asst mgr)
      // Pass 2: Add second manager and team leads for full coverage
      // This prevents managers from hitting their 5-day max before all days are covered
      // IMPORTANT: Recognize existing template shifts as fulfilling coverage requirements
      
      // Track coverage per day for leadership
      const leadershipCoverage: Record<number, { opener: boolean; closer: boolean; mid: boolean; hasHigherTier: boolean }> = {};
      for (let d = 0; d < 7; d++) {
        leadershipCoverage[d] = { opener: false, closer: false, mid: false, hasHigherTier: false };
      }
      
      // Get all higher-tier managers (store managers and assistant managers)
      const allHigherTierManagers = shuffleArray(
        managers.filter(m => 
          (storeManagerCodes.includes(m.jobTitle) || assistantManagerCodes.includes(m.jobTitle)) && m.isActive
        )
      );
      const allTeamLeads = shuffleArray(
        managers.filter(m => teamLeadCodes.includes(m.jobTitle) && m.isActive)
      );
      
      // Build ID arrays for existing shift lookup
      const higherTierIds = allHigherTierManagers.map(m => m.id);
      const teamLeadIds = allTeamLeads.map(m => m.id);
      const allManagerIds = managers.map(m => m.id);
      
      // Check for existing leadership shifts from templates
      for (let d = 0; d < 7; d++) {
        const existingHigherTier = countExistingShiftsForRole(higherTierIds, d);
        const existingTeamLeads = countExistingShiftsForRole(teamLeadIds, d);
        const totalExistingLeadership = existingHigherTier + existingTeamLeads;
        
        if (existingHigherTier > 0) {
          leadershipCoverage[d].hasHigherTier = true;
          // Mark opener/closer as covered if we have existing shifts (we don't know which slot, so be conservative)
          leadershipCoverage[d].opener = true;
          console.log(`[Scheduler] Day ${d}: Found ${existingHigherTier} existing higher-tier manager shift(s) from template`);
        }
        if (existingTeamLeads > 0) {
          console.log(`[Scheduler] Day ${d}: Found ${existingTeamLeads} existing team lead shift(s) from template`);
        }
      }
      
      console.log(`[Scheduler] Leadership pool - Higher-tier: ${allHigherTierManagers.length}, Team Leads: ${allTeamLeads.length}`);
      
      // PASS 1: Ensure every day gets at least ONE higher-tier manager
      // Process days in order, but spread managers across all days first
      const pass1DayOrder = shuffleArray([0, 1, 2, 3, 4, 5, 6]);
      console.log(`[Scheduler] Pass 1 day order: ${pass1DayOrder.map(d => shortDayNames[d]).join(', ')}`);
      
      for (const dayIndex of pass1DayOrder) {
        const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
        
        // Skip holidays
        const holidayName = isHoliday(currentDay);
        if (holidayName) {
          console.log(`[Scheduler] Skipping ${holidayName} - store is closed`);
          continue;
        }
        
        const shifts = getShiftTimes(currentDay);
        
        // Skip if this day already has higher-tier coverage from template
        if (leadershipCoverage[dayIndex].hasHigherTier) {
          console.log(`[Scheduler] Pass 1 - Day ${dayIndex}: Already covered by template shift(s)`);
          continue;
        }
        
        // Find available higher-tier managers for this day (re-shuffle for variety)
        const availableHigherTier = shuffleArray(allHigherTierManagers.filter(m => canWorkFullShift(m, currentDay, dayIndex)));
        
        if (availableHigherTier.length > 0) {
          const shiftType = Math.random() < 0.5 ? 'opener' : 'closer';
          const shift = shiftType === 'opener' ? shifts.opener : shifts.closer;
          const manager = availableHigherTier[0];
          
          scheduleShift(manager, shift.start, shift.end, dayIndex);
          leadershipCoverage[dayIndex][shiftType] = true;
          leadershipCoverage[dayIndex].hasHigherTier = true;
          console.log(`[Scheduler] Pass 1 - Day ${dayIndex}: ${manager.name} as ${shiftType}`);
        } else {
          console.log(`[Scheduler] Pass 1 - Day ${dayIndex}: No higher-tier managers available`);
        }
      }
      
      // PASS 2: Fill gaps and add additional coverage
      // Process days that NEED coverage first (days without higher-tier managers)
      const uncoveredDays = [0, 1, 2, 3, 4, 5, 6].filter(d => !leadershipCoverage[d].hasHigherTier);
      const coveredDays = [0, 1, 2, 3, 4, 5, 6].filter(d => leadershipCoverage[d].hasHigherTier);
      const pass2DayOrder = [...shuffleArray(uncoveredDays), ...shuffleArray(coveredDays)];
      
      console.log(`[Scheduler] Pass 2 - Uncovered days: ${uncoveredDays.map(d => shortDayNames[d]).join(', ') || 'none'}`);
      
      for (const dayIndex of pass2DayOrder) {
        const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
        
        // Skip holidays
        if (isHoliday(currentDay)) continue;
        
        const shifts = getShiftTimes(currentDay);
        const coverage = leadershipCoverage[dayIndex];
        
        // Find available higher-tier managers for this day (re-shuffle for variety)
        const availableHigherTier = shuffleArray(allHigherTierManagers.filter(m => canWorkFullShift(m, currentDay, dayIndex)));
        
        // FIRST: If this day has no higher-tier coverage, try to add one now
        if (!coverage.hasHigherTier && availableHigherTier.length > 0) {
          const shiftType = Math.random() < 0.5 ? 'opener' : 'closer';
          const shift = shiftType === 'opener' ? shifts.opener : shifts.closer;
          const manager = availableHigherTier[0];
          
          scheduleShift(manager, shift.start, shift.end, dayIndex);
          coverage[shiftType] = true;
          coverage.hasHigherTier = true;
          console.log(`[Scheduler] Pass 2 - Day ${dayIndex}: ${manager.name} as ${shiftType} (filling gap)`);
        }
        
        // Re-filter and re-shuffle after potential scheduling
        const stillAvailableHigherTier = shuffleArray(allHigherTierManagers.filter(m => canWorkFullShift(m, currentDay, dayIndex)));
        
        // Add second higher-tier manager for the opposite shift if available
        if (stillAvailableHigherTier.length > 0) {
          if (coverage.opener && !coverage.closer) {
            const manager = stillAvailableHigherTier[0];
            scheduleShift(manager, shifts.closer.start, shifts.closer.end, dayIndex);
            coverage.closer = true;
            console.log(`[Scheduler] Pass 2 - Day ${dayIndex}: ${manager.name} as closer`);
          } else if (coverage.closer && !coverage.opener) {
            const manager = stillAvailableHigherTier[0];
            scheduleShift(manager, shifts.opener.start, shifts.opener.end, dayIndex);
            coverage.opener = true;
            console.log(`[Scheduler] Pass 2 - Day ${dayIndex}: ${manager.name} as opener`);
          } else if (!coverage.opener && !coverage.closer) {
            // Neither slot filled yet - randomly pick one
            const shiftType = Math.random() < 0.5 ? 'opener' : 'closer';
            const manager = stillAvailableHigherTier[0];
            const shift = shiftType === 'opener' ? shifts.opener : shifts.closer;
            scheduleShift(manager, shift.start, shift.end, dayIndex);
            coverage[shiftType] = true;
            console.log(`[Scheduler] Pass 2 - Day ${dayIndex}: ${manager.name} as ${shiftType}`);
          }
        }
        
        // Add third higher-tier manager for mid shift if still available
        const availableForMid = shuffleArray(allHigherTierManagers.filter(m => canWorkFullShift(m, currentDay, dayIndex)));
        if (availableForMid.length > 0 && !coverage.mid && coverage.opener && coverage.closer) {
          const midShift = randomPick([shifts.mid10, shifts.mid11, shifts.early9]);
          const manager = availableForMid[0];
          scheduleShift(manager, midShift.start, midShift.end, dayIndex);
          coverage.mid = true;
          console.log(`[Scheduler] Pass 2 - Day ${dayIndex}: ${manager.name} as mid`);
        }
        
        // Add team leads ONLY if there's higher-tier coverage
        if (coverage.hasHigherTier) {
          const availableTeamLeads = shuffleArray(allTeamLeads.filter(m => canWorkFullShift(m, currentDay, dayIndex)));
          
          for (const teamLead of availableTeamLeads) {
            // Build list of unfilled slots, then randomly pick one
            const openSlots: string[] = [];
            if (!coverage.opener) openSlots.push('opener');
            if (!coverage.closer) openSlots.push('closer');
            if (!coverage.mid) openSlots.push('mid');
            
            if (openSlots.length === 0) break;
            
            const chosenSlot = randomPick(openSlots);
            if (chosenSlot === 'opener') {
              scheduleShift(teamLead, shifts.opener.start, shifts.opener.end, dayIndex);
              coverage.opener = true;
              console.log(`[Scheduler] Pass 2 - Day ${dayIndex}: Team lead ${teamLead.name} as opener`);
            } else if (chosenSlot === 'closer') {
              scheduleShift(teamLead, shifts.closer.start, shifts.closer.end, dayIndex);
              coverage.closer = true;
              console.log(`[Scheduler] Pass 2 - Day ${dayIndex}: Team lead ${teamLead.name} as closer`);
            } else {
              const midShift = randomPick([shifts.mid10, shifts.mid11, shifts.early9]);
              scheduleShift(teamLead, midShift.start, midShift.end, dayIndex);
              coverage.mid = true;
              console.log(`[Scheduler] Pass 2 - Day ${dayIndex}: Team lead ${teamLead.name} as mid`);
            }
          }
        }
        
        // Log warning if missing coverage
        if (!coverage.opener || !coverage.closer) {
          console.log(`[Scheduler] WARNING: Day ${dayIndex} missing coverage - opener: ${coverage.opener}, closer: ${coverage.closer}`);
        }
      }
      
      // Final summary and validation of leadership coverage
      console.log(`[Scheduler] Leadership coverage summary:`);
      const uncoveredDaysAfterPass2: string[] = [];
      let totalLeadershipShifts = 0;
      for (let d = 0; d < 7; d++) {
        const c = leadershipCoverage[d];
        const currentDay = new Date(startDate.getTime() + d * 24 * 60 * 60 * 1000);
        const isHolidayDay = isHoliday(currentDay);
        
        if (isHolidayDay) {
          console.log(`[Scheduler]   ${shortDayNames[d]}: HOLIDAY - store closed`);
          continue;
        }
        
        console.log(`[Scheduler]   ${shortDayNames[d]}: opener=${c.opener}, closer=${c.closer}, mid=${c.mid}, hasHigherTier=${c.hasHigherTier}`);
        
        if (!c.hasHigherTier) {
          uncoveredDaysAfterPass2.push(shortDayNames[d]);
        }
        if (c.opener) totalLeadershipShifts++;
        if (c.closer) totalLeadershipShifts++;
        if (c.mid) totalLeadershipShifts++;
      }
      
      if (uncoveredDaysAfterPass2.length > 0) {
        console.log(`[Scheduler] ERROR: ${uncoveredDaysAfterPass2.length} days have NO higher-tier manager coverage: ${uncoveredDaysAfterPass2.join(', ')}`);
        console.log(`[Scheduler] This may indicate insufficient store managers/assistant managers, or too many time-off conflicts`);
      } else {
        console.log(`[Scheduler] SUCCESS: All days have higher-tier manager coverage (${totalLeadershipShifts} leadership shifts scheduled)`);
      }
      
      // Phase 1a: Schedule pricers and apparel processors with MORNING PRIORITY
      // STRATEGY: First fill station seats with fulltime workers on OPENER shifts (8-4:30)
      // Then schedule part-timers on AFTERNOON shifts (4:30-8:30) to extend coverage
      // IMPORTANT: Recognize existing template shifts as fulfilling coverage requirements
      
      // Track morning production coverage per day for afternoon scheduling
      const morningPricerByDay = new Map<number, number>(); // Count of morning pricers
      const morningApparelByDay = new Map<number, number>(); // Count of morning apparel processors
      
      // Build arrays of employee IDs by role for efficient lookup
      const pricerIds = donationPricers.map(p => p.id);
      const apparelIds = apparelProcessors.map(p => p.id);
      
      // ========== TWO-PHASE PRODUCTION SCHEDULING ==========
      // PHASE 1: Ensure MINIMUM coverage (1 pricer + 1 apparel) for ALL days first
      // PHASE 2: Add EXTRA staff prioritizing Fri/Sat/Sun (busiest days) before Mon-Thu
      
      // Day order for Phase 2: Fri(4), Sat(5), Sun(6) FIRST, then Mon-Thu
      // Indexes: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
      const busyDayOrder = [5, 6, 0, 1, 2, 3, 4]; // Fri, Sat, Sun first, then Mon, Tue, Wed, Thu
      
      // Use fixed order for Phase 1 to ensure ALL days get minimum coverage before anyone hits max hours
      const phase1DayOrder = [0, 1, 2, 3, 4, 5, 6]; // Fixed order for minimum coverage
      
      console.log(`[Scheduler] Production scheduling: Phase 1 - Minimum coverage for all days`);
      
      // Initialize counts from existing template shifts
      for (const dayIndex of [0, 1, 2, 3, 4, 5, 6]) {
        const existingPricerShifts = countExistingShiftsForRole(pricerIds, dayIndex);
        const existingApparelShifts = countExistingShiftsForRole(apparelIds, dayIndex);
        morningPricerByDay.set(dayIndex, existingPricerShifts);
        morningApparelByDay.set(dayIndex, existingApparelShifts);
        if (existingPricerShifts > 0) {
          console.log(`[Scheduler] Day ${dayIndex}: Found ${existingPricerShifts} existing pricer shift(s) from template`);
        }
        if (existingApparelShifts > 0) {
          console.log(`[Scheduler] Day ${dayIndex}: Found ${existingApparelShifts} existing apparel shift(s) from template`);
        }
      }
      
      // PHASE 1: Minimum coverage (1 of each) for ALL days
      // Use fixed day order to ensure all days get minimum before anyone hits max hours
      for (const dayIndex of phase1DayOrder) {
        const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
        
        // Skip holidays - store is closed on Easter, Thanksgiving, Christmas
        const holidayName = isHoliday(currentDay);
        if (holidayName) continue;
        
        const shifts = getShiftTimes(currentDay);
        
        // ========== DONATION/WARES PRICERS - MINIMUM 1 ==========
        let pricerCount = morningPricerByDay.get(dayIndex) || 0;
        const minPricers = 1;
        
        if (pricerCount < minPricers) {
          // STEP 1: Try fulltime pricers first
          const fulltimePricers = shuffleAndSort(
            donationPricers.filter(p => !isPartTime(p) && canWorkFullShift(p, currentDay, dayIndex))
          );
          
          for (const pricer of fulltimePricers) {
            if (pricerCount >= minPricers) break;
            scheduleShift(pricer, shifts.opener.start, shifts.opener.end, dayIndex);
            pricerCount++;
            console.log(`[Scheduler] Phase 1 Day ${dayIndex}: FT Pricer ${pricer.name} scheduled as opener (minimum coverage)`);
          }
          
          // STEP 2: If still need minimum, try part-timers with full shifts
          if (pricerCount < minPricers) {
            const parttimePricers = shuffleAndSort(
              donationPricers.filter(p => isPartTime(p) && canWorkFullShift(p, currentDay, dayIndex))
            );
            
            for (const pricer of parttimePricers) {
              if (pricerCount >= minPricers) break;
              scheduleShift(pricer, shifts.opener.start, shifts.opener.end, dayIndex);
              pricerCount++;
              console.log(`[Scheduler] Phase 1 Day ${dayIndex}: PT Pricer ${pricer.name} scheduled as opener (minimum coverage)`);
            }
          }
          
          if (pricerCount < minPricers) {
            console.log(`[Scheduler] WARNING: Day ${dayIndex} could not meet minimum pricer coverage`);
          }
        }
        morningPricerByDay.set(dayIndex, pricerCount);
        
        // ========== APPAREL PROCESSORS - MINIMUM 1 ==========
        let apparelCount = morningApparelByDay.get(dayIndex) || 0;
        const minApparel = 1;
        
        if (apparelCount < minApparel) {
          // STEP 1: Try fulltime processors first
          const fulltimeApparel = shuffleAndSort(
            apparelProcessors.filter(p => !isPartTime(p) && canWorkFullShift(p, currentDay, dayIndex))
          );
          
          for (const processor of fulltimeApparel) {
            if (apparelCount >= minApparel) break;
            scheduleShift(processor, shifts.opener.start, shifts.opener.end, dayIndex);
            apparelCount++;
            console.log(`[Scheduler] Phase 1 Day ${dayIndex}: FT Apparel ${processor.name} scheduled as opener (minimum coverage)`);
          }
          
          // STEP 2: If still need minimum, try part-timers with full shifts
          if (apparelCount < minApparel) {
            const parttimeApparel = shuffleAndSort(
              apparelProcessors.filter(p => isPartTime(p) && canWorkFullShift(p, currentDay, dayIndex))
            );
            
            for (const processor of parttimeApparel) {
              if (apparelCount >= minApparel) break;
              scheduleShift(processor, shifts.opener.start, shifts.opener.end, dayIndex);
              apparelCount++;
              console.log(`[Scheduler] Phase 1 Day ${dayIndex}: PT Apparel ${processor.name} scheduled as opener (minimum coverage)`);
            }
          }
          
          if (apparelCount < minApparel) {
            console.log(`[Scheduler] WARNING: Day ${dayIndex} could not meet minimum apparel coverage`);
          }
        }
        morningApparelByDay.set(dayIndex, apparelCount);
      }
      
      console.log(`[Scheduler] Production scheduling: Phase 2 - Extra staff (Fri/Sat/Sun first)`);
      
      // PHASE 2: Add EXTRA staff prioritizing busy days (Fri/Sat/Sun)
      for (const dayIndex of busyDayOrder) {
        const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
        
        // Skip holidays
        const holidayName = isHoliday(currentDay);
        if (holidayName) continue;
        
        const shifts = getShiftTimes(currentDay);
        const isBusyDay = [4, 5, 6].includes(dayIndex); // Fri, Sat, Sun
        
        // ========== EXTRA PRICERS ==========
        let pricerCount = morningPricerByDay.get(dayIndex) || 0;
        const targetPricers = maxPricerStations; // Station limit
        
        if (pricerCount < targetPricers) {
          // STEP 1: Try fulltime pricers first
          const fulltimePricers = shuffleAndSort(
            donationPricers.filter(p => !isPartTime(p) && canWorkFullShift(p, currentDay, dayIndex))
          );
          
          for (const pricer of fulltimePricers) {
            if (pricerCount >= targetPricers) break;
            scheduleShift(pricer, shifts.opener.start, shifts.opener.end, dayIndex);
            pricerCount++;
            console.log(`[Scheduler] Phase 2 Day ${dayIndex}: FT Pricer ${pricer.name} scheduled as opener (extra - ${isBusyDay ? 'BUSY DAY' : 'weekday'})`);
          }
          
          // STEP 2: Part-timers with full shifts
          if (pricerCount < targetPricers) {
            const parttimePricers = shuffleAndSort(
              donationPricers.filter(p => isPartTime(p) && canWorkFullShift(p, currentDay, dayIndex))
            );
            
            for (const pricer of parttimePricers) {
              if (pricerCount >= targetPricers) break;
              scheduleShift(pricer, shifts.opener.start, shifts.opener.end, dayIndex);
              pricerCount++;
              console.log(`[Scheduler] Phase 2 Day ${dayIndex}: PT Pricer ${pricer.name} scheduled as opener (extra - ${isBusyDay ? 'BUSY DAY' : 'weekday'})`);
            }
          }
          
          if (pricerCount < targetPricers && isBusyDay) {
            console.log(`[Scheduler] WARNING: Busy day ${dayIndex} only has ${pricerCount}/${targetPricers} pricers`);
          }
        }
        morningPricerByDay.set(dayIndex, pricerCount);
        
        // ========== EXTRA APPAREL PROCESSORS ==========
        let apparelCount = morningApparelByDay.get(dayIndex) || 0;
        const targetApparel = maxApparelStations; // Station limit
        
        if (apparelCount < targetApparel) {
          // STEP 1: Try fulltime processors first
          const fulltimeApparel = shuffleAndSort(
            apparelProcessors.filter(p => !isPartTime(p) && canWorkFullShift(p, currentDay, dayIndex))
          );
          
          for (const processor of fulltimeApparel) {
            if (apparelCount >= targetApparel) break;
            const shift = apparelCount % 2 === 0 ? shifts.opener : shifts.early9;
            scheduleShift(processor, shift.start, shift.end, dayIndex);
            apparelCount++;
            console.log(`[Scheduler] Phase 2 Day ${dayIndex}: FT Apparel ${processor.name} scheduled (extra - ${isBusyDay ? 'BUSY DAY' : 'weekday'})`);
          }
          
          // STEP 2: Part-timers with full shifts
          if (apparelCount < targetApparel) {
            const parttimeApparel = shuffleAndSort(
              apparelProcessors.filter(p => isPartTime(p) && canWorkFullShift(p, currentDay, dayIndex))
            );
            
            for (const processor of parttimeApparel) {
              if (apparelCount >= targetApparel) break;
              const shift = apparelCount % 2 === 0 ? shifts.opener : shifts.early9;
              scheduleShift(processor, shift.start, shift.end, dayIndex);
              apparelCount++;
              console.log(`[Scheduler] Phase 2 Day ${dayIndex}: PT Apparel ${processor.name} scheduled (extra - ${isBusyDay ? 'BUSY DAY' : 'weekday'})`);
            }
          }
          
          if (apparelCount < targetApparel && isBusyDay) {
            console.log(`[Scheduler] WARNING: Busy day ${dayIndex} only has ${apparelCount}/${targetApparel} apparel processors`);
          }
        }
        morningApparelByDay.set(dayIndex, apparelCount);
      }
      
      // Log final production coverage
      console.log(`[Scheduler] Production coverage summary:`);
      for (const d of [0, 1, 2, 3, 4, 5, 6]) {
        const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d];
        const isBusy = [4, 5, 6].includes(d) ? ' (BUSY)' : '';
        console.log(`[Scheduler]   ${dayName}${isBusy}: Pricers=${morningPricerByDay.get(d) || 0}, Apparel=${morningApparelByDay.get(d) || 0}`);
      }
      
      // Phase 1a-afternoon: Schedule AFTERNOON production shifts to extend station coverage
      // After morning fulltime workers leave (4:30pm), part-timers cover remaining hours
      console.log(`[Scheduler] Phase 1a-afternoon: Scheduling afternoon production coverage (4:30-8:30 PM)`);
      
      for (const dayIndex of dayOrder) {
        const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
        if (isHoliday(currentDay)) continue;
        
        const shifts = getShiftTimes(currentDay);
        
        // Only schedule afternoon shifts if we had morning coverage (station was used)
        const morningPricerCount = morningPricerByDay.get(dayIndex) || 0;
        const morningApparelCount = morningApparelByDay.get(dayIndex) || 0;
        
        // AFTERNOON PRICER: If morning pricer was scheduled, try to add afternoon coverage
        if (morningPricerCount > 0) {
          const afternoonPricers = shuffleAndSort(
            donationPricers.filter(p => 
              isPartTime(p) && canWorkProdAfternoonShift(p, currentDay, dayIndex)
            )
          );
          
          if (afternoonPricers.length > 0) {
            const pricer = afternoonPricers[0];
            scheduleShift(pricer, shifts.prodAfternoon.start, shifts.prodAfternoon.end, dayIndex);
            console.log(`[Scheduler] Day ${dayIndex}: PT Pricer ${pricer.name} scheduled for afternoon (${shifts.prodAfternoon.start.getHours()}:${shifts.prodAfternoon.start.getMinutes().toString().padStart(2, '0')}-close)`);
          }
        }
        
        // AFTERNOON APPAREL: For each morning apparel processor, try to add afternoon coverage
        if (morningApparelCount > 0) {
          const afternoonApparel = shuffleAndSort(
            apparelProcessors.filter(p => 
              isPartTime(p) && canWorkProdAfternoonShift(p, currentDay, dayIndex)
            )
          );
          
          // Try to match morning coverage with afternoon coverage (up to station limits)
          let afternoonApparelCount = 0;
          for (const processor of afternoonApparel) {
            if (afternoonApparelCount >= morningApparelCount) break; // Match morning coverage
            scheduleShift(processor, shifts.prodAfternoon.start, shifts.prodAfternoon.end, dayIndex);
            afternoonApparelCount++;
            console.log(`[Scheduler] Day ${dayIndex}: PT Apparel ${processor.name} scheduled for afternoon (${shifts.prodAfternoon.start.getHours()}:${shifts.prodAfternoon.start.getMinutes().toString().padStart(2, '0')}-close)`);
          }
        }
      }

      // Phase 1a-greeter: Schedule DONOR GREETERS with Saturday priority
      // Saturday is the busiest donation day - MUST have more greeters than Sunday
      // Process Saturday FIRST, then other days in priority order
      // IMPORTANT: Recognize existing template shifts as fulfilling coverage requirements
      const greeterDayOrder = saturdayFirstOrder; // Sat first, then Fri, Sun, Mon...
      
      // Build array of greeter IDs for existing shift lookup
      const greeterIds = donorGreeters.map(g => g.id);
      
      // Determine targets based on pool size - if limited, reduce targets to ensure coverage across all days
      const totalGreeterPool = donorGreeters.length;
      const workDaysCount = 6; // Assuming 6 working days per week
      
      // Calculate adaptive targets based on pool size
      // With 2 greeters doing 5 days each = 10 greeter-days available
      // We want to spread coverage so all days get at least 1 greeter if possible
      // When 4+ greeters: allow 3+ on busy days for mid-shift coverage
      const greeterTargets: Record<number, number> = totalGreeterPool >= 4 ? {
        6: Math.min(4, totalGreeterPool), // Saturday - busiest donation day, allow 4 for opener/mid/mid/closer
        5: 3, // Friday - allow mid-shift
        0: 3, // Sunday - must not exceed Saturday, allow mid-shift
        1: 3, 2: 3, 3: 3, 4: 3 // Weekdays - allow mid-shift when available
      } : totalGreeterPool >= 3 ? {
        // 3 greeters: opener + closer + mid on Saturday
        6: 3, // Saturday gets full coverage
        5: 2, // Friday
        0: 2, // Sunday
        1: 2, 2: 2, 3: 2, 4: 2 // Weekdays
      } : {
        // Limited pool: prioritize having coverage every day with opener+closer on Saturday
        6: Math.min(2, totalGreeterPool), // Saturday gets opener+closer if 2+ greeters
        5: 1, // Friday - 1 greeter
        0: 1, // Sunday - 1 greeter (will be capped to Saturday's count)
        1: 1, 2: 1, 3: 1, 4: 1 // Weekdays - 1 greeter each
      };
      
      // Track scheduled greeters per day to ensure Saturday >= Sunday
      // Initialize with existing template shifts counted
      const greetersByDay: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
      for (let d = 0; d < 7; d++) {
        const existingCount = countExistingShiftsForRole(greeterIds, d);
        greetersByDay[d] = existingCount;
        if (existingCount > 0) {
          console.log(`[Scheduler] Day ${d}: Found ${existingCount} existing greeter shift(s) from template`);
        }
      }
      
      console.log(`[Scheduler] Total donor greeters available: ${totalGreeterPool}, using ${totalGreeterPool >= 4 ? 'standard' : 'limited pool'} targets`);
      
      for (const dayIndex of greeterDayOrder) {
        const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
        const dayName = shortDayNames[dayIndex];
        
        // Skip holidays
        if (isHoliday(currentDay)) {
          console.log(`[Scheduler] Greeter ${dayName}: Skipping - holiday`);
          continue;
        }
        
        const shifts = getShiftTimes(currentDay);
        const target = greeterTargets[dayIndex] || 1;
        const isSunday = dayIndex === 0;
        
        // For Sunday: don't schedule more greeters than Saturday has
        const maxForDay = isSunday ? Math.min(target, greetersByDay[6]) : target;
        
        // Check if existing shifts already meet the target
        if (greetersByDay[dayIndex] >= maxForDay) {
          console.log(`[Scheduler] Greeter ${dayName}: Target ${maxForDay} already met by ${greetersByDay[dayIndex]} existing template shift(s)`);
          continue;
        }
        
        // Calculate how many more greeters we need
        const stillNeeded = maxForDay - greetersByDay[dayIndex];
        
        // Get available greeters for this day (shuffled for variety)
        const availableGreeters = shuffleAndSort(
          donorGreeters.filter(g => canWorkFullShift(g, currentDay, dayIndex))
        );
        
        console.log(`[Scheduler] Greeter ${dayName}: target=${target}, maxForDay=${maxForDay}, existing=${greetersByDay[dayIndex]}, stillNeeded=${stillNeeded}, available=${availableGreeters.length}, satCount=${greetersByDay[6]}`);
        
        // For Saturday with 2+ available greeters and need 2+ more: explicitly schedule opener + closer
        if (dayIndex === 6 && availableGreeters.length >= 2 && stillNeeded >= 2) {
          // Schedule first greeter as opener
          scheduleShift(availableGreeters[0], shifts.opener.start, shifts.opener.end, dayIndex);
          greetersByDay[dayIndex]++;
          console.log(`[Scheduler] Greeter ${dayName}: Scheduled ${availableGreeters[0].name} as opener`);
          
          // Schedule second greeter as closer
          scheduleShift(availableGreeters[1], shifts.closer.start, shifts.closer.end, dayIndex);
          greetersByDay[dayIndex]++;
          console.log(`[Scheduler] Greeter ${dayName}: Scheduled ${availableGreeters[1].name} as closer`);
          
          // If 3+ greeters and target allows, schedule additional
          if (availableGreeters.length >= 3 && maxForDay >= 3) {
            scheduleShift(availableGreeters[2], shifts.mid10.start, shifts.mid10.end, dayIndex);
            greetersByDay[dayIndex]++;
            console.log(`[Scheduler] Greeter ${dayName}: Scheduled ${availableGreeters[2].name} as mid`);
          }
          console.log(`[Scheduler] Greeter ${dayName}: Scheduled ${greetersByDay[dayIndex]} greeters (opener+closer mode)`);
          continue;
        }
        
        // For other days or Saturday with only 1 available: schedule what we can
        // Use stillNeeded to account for existing template shifts
        const actualTarget = Math.min(stillNeeded, availableGreeters.length);
        
        if (actualTarget === 0) {
          console.log(`[Scheduler] Greeter ${dayName}: No available greeters to fill remaining ${stillNeeded} slots`);
          continue;
        }
        
        // When 3+ greeters: 1 opener, 1 closer, 1+ mid-shift (like managers)
        // When 2 greeters: 1 opener, 1 closer
        // When 1 greeter: 1 opener
        if (actualTarget >= 3) {
          // Schedule 1 opener
          scheduleShift(availableGreeters[0], shifts.opener.start, shifts.opener.end, dayIndex);
          greetersByDay[dayIndex]++;
          console.log(`[Scheduler] Greeter ${dayName}: Scheduled ${availableGreeters[0].name} as opener`);
          
          // Schedule 1 closer
          scheduleShift(availableGreeters[1], shifts.closer.start, shifts.closer.end, dayIndex);
          greetersByDay[dayIndex]++;
          console.log(`[Scheduler] Greeter ${dayName}: Scheduled ${availableGreeters[1].name} as closer`);
          
          // Schedule remaining as mid-shift (10-6:30) for coverage across all hours
          for (let i = 2; i < actualTarget && i < availableGreeters.length; i++) {
            scheduleShift(availableGreeters[i], shifts.mid10.start, shifts.mid10.end, dayIndex);
            greetersByDay[dayIndex]++;
            console.log(`[Scheduler] Greeter ${dayName}: Scheduled ${availableGreeters[i].name} as mid-shift (10-6:30)`);
          }
          
          console.log(`[Scheduler] Greeter ${dayName}: Scheduled 1 opener, 1 closer, ${actualTarget - 2} mid-shift, total=${greetersByDay[dayIndex]}`);
        } else {
          // Schedule opening greeters (half of target, rounded up)
          const openingTarget = Math.ceil(actualTarget / 2);
          let openersScheduled = 0;
          for (let i = 0; i < openingTarget && i < availableGreeters.length; i++) {
            scheduleShift(availableGreeters[i], shifts.opener.start, shifts.opener.end, dayIndex);
            greetersByDay[dayIndex]++;
            openersScheduled++;
            console.log(`[Scheduler] Greeter ${dayName}: Scheduled ${availableGreeters[i].name} as opener`);
          }
          
          // Get remaining available greeters for closing (re-filter after scheduling openers, shuffled)
          const closingGreeters = shuffleAndSort(
            donorGreeters.filter(g => canWorkFullShift(g, currentDay, dayIndex))
          );
          
          // Schedule closing greeters
          const closingTarget = actualTarget - openersScheduled;
          let closersScheduled = 0;
          for (let i = 0; i < closingTarget && i < closingGreeters.length; i++) {
            scheduleShift(closingGreeters[i], shifts.closer.start, shifts.closer.end, dayIndex);
            greetersByDay[dayIndex]++;
            closersScheduled++;
            console.log(`[Scheduler] Greeter ${dayName}: Scheduled ${closingGreeters[i].name} as closer`);
          }
          
          console.log(`[Scheduler] Greeter ${dayName}: Scheduled ${openersScheduled} openers, ${closersScheduled} closers, total=${greetersByDay[dayIndex]}`);
        }
      }
      
      console.log(`[Scheduler] FINAL Donor greeters by day: Sat=${greetersByDay[6]}, Sun=${greetersByDay[0]}, Fri=${greetersByDay[5]}, Wed=${greetersByDay[3]}, Thu=${greetersByDay[4]}`);

      // Phase 1b: Schedule CASHIERS with Saturday priority
      // Saturday is the busiest sales day - MUST have more cashiers than Sunday
      // Process Saturday FIRST, then other days
      // IMPORTANT: Recognize existing template shifts as fulfilling coverage requirements
      const cashierDayOrder = saturdayFirstOrder; // Sat first, then Fri, Sun, Mon...
      const cashierTargets: Record<number, number> = {
        6: Math.max(openersRequired + 1, 3), // Saturday - busiest, needs extra cashiers
        5: openersRequired, // Friday
        0: openersRequired, // Sunday - will be capped to Saturday's count
        1: openersRequired, 2: openersRequired, 3: openersRequired, 4: openersRequired
      };
      
      // Build array of cashier IDs for existing shift lookup
      const cashierIds = cashiers.map(c => c.id);
      
      // Track scheduled cashiers per day to ensure Saturday >= Sunday
      // Initialize with existing template shifts counted
      const cashiersByDay: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
      for (let d = 0; d < 7; d++) {
        const existingCount = countExistingShiftsForRole(cashierIds, d);
        cashiersByDay[d] = existingCount;
        if (existingCount > 0) {
          console.log(`[Scheduler] Day ${d}: Found ${existingCount} existing cashier shift(s) from template`);
        }
      }
      
      console.log(`[Scheduler] Total cashiers available: ${cashiers.length}`);
      
      for (const dayIndex of cashierDayOrder) {
        const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
        const dayName = shortDayNames[dayIndex];
        
        // Skip holidays
        if (isHoliday(currentDay)) {
          console.log(`[Scheduler] Cashier ${dayName}: Skipping - holiday`);
          continue;
        }
        
        const shifts = getShiftTimes(currentDay);
        const baseTarget = cashierTargets[dayIndex] || openersRequired;
        const isSunday = dayIndex === 0;
        
        // For Sunday: don't schedule more cashiers than Saturday has
        const maxForDay = isSunday ? Math.min(baseTarget, cashiersByDay[6]) : baseTarget;
        
        // Check if existing shifts already meet the target
        if (cashiersByDay[dayIndex] >= maxForDay) {
          console.log(`[Scheduler] Cashier ${dayName}: Target ${maxForDay} already met by ${cashiersByDay[dayIndex]} existing template shift(s)`);
          continue;
        }
        
        // Calculate how many more cashiers we need
        const stillNeeded = maxForDay - cashiersByDay[dayIndex];
        
        console.log(`[Scheduler] Cashier ${dayName}: baseTarget=${baseTarget}, maxForDay=${maxForDay}, existing=${cashiersByDay[dayIndex]}, stillNeeded=${stillNeeded}, satCount=${cashiersByDay[6]}`);
        
        // Schedule opening cashiers (shuffled for variety)
        const openingTarget = Math.ceil(stillNeeded / 2);
        const availableOpeners = shuffleAndSort(
          cashiers.filter(c => canWorkFullShift(c, currentDay, dayIndex))
        );
        
        console.log(`[Scheduler] Cashier ${dayName}: openingTarget=${openingTarget}, availableOpeners=${availableOpeners.length}`);
        
        let openersScheduled = 0;
        for (let i = 0; i < openingTarget && i < availableOpeners.length; i++) {
          scheduleShift(availableOpeners[i], shifts.opener.start, shifts.opener.end, dayIndex);
          cashiersByDay[dayIndex]++;
          openersScheduled++;
          console.log(`[Scheduler] Cashier ${dayName}: Scheduled ${availableOpeners[i].name} as opener`);
        }
        
        // Schedule closing cashiers (shuffled for variety)
        // Use stillNeeded minus openers we already scheduled
        const closingTarget = stillNeeded - openersScheduled;
        const availableClosers = shuffleAndSort(
          cashiers.filter(c => canWorkFullShift(c, currentDay, dayIndex))
        );
        
        console.log(`[Scheduler] Cashier ${dayName}: closingTarget=${closingTarget}, availableClosers=${availableClosers.length}`);
        
        let closersScheduled = 0;
        for (let i = 0; i < closingTarget && i < availableClosers.length; i++) {
          scheduleShift(availableClosers[i], shifts.closer.start, shifts.closer.end, dayIndex);
          cashiersByDay[dayIndex]++;
          closersScheduled++;
          console.log(`[Scheduler] Cashier ${dayName}: Scheduled ${availableClosers[i].name} as closer`);
        }
        
        console.log(`[Scheduler] Cashier ${dayName}: Scheduled ${openersScheduled} openers, ${closersScheduled} closers, total=${cashiersByDay[dayIndex]}`);
      }
      
      console.log(`[Scheduler] FINAL Cashiers by day: Sat=${cashiersByDay[6]}, Sun=${cashiersByDay[0]}, Fri=${cashiersByDay[5]}`);
      
      // Log any days that couldn't get full cashier coverage
      for (const dayIndex of cashierDayOrder) {
        const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
        if (isHoliday(currentDay)) continue;
        
        const dayName = shortDayNames[dayIndex];
        const target = cashierTargets[dayIndex] || openersRequired;
        const isSunday = dayIndex === 0;
        const maxForDay = isSunday ? Math.min(target, cashiersByDay[6]) : target;
        
        if (cashiersByDay[dayIndex] < maxForDay) {
          console.log(`[Scheduler] WARNING: ${dayName} is short ${maxForDay - cashiersByDay[dayIndex]} cashier(s)`);
        }
      }

      console.log(`[Scheduler] After Phase 1: ${pendingShifts.length} shifts scheduled`);

      // ========== PHASE 2: FILL REMAINING CAPACITY (Saturday-first for priority staffing) ==========
      // Process Saturday first, then other weekend days, then weekdays
      // This ensures Saturday and Friday get adequate staffing before weekdays
      // Part-timers get flexible shift selection (full or short based on what maximizes hours)
      
      // Track how many additional shifts we want per day (Sat/Fri get 30% more)
      const additionalTargets: Record<number, number> = {};
      const additionalAssigned: Record<number, number> = {};
      const baseAdditionalShifts = 4;
      for (let d = 0; d < 7; d++) {
        additionalTargets[d] = Math.ceil(baseAdditionalShifts * (dayMultiplier[d] || 1.0));
        additionalAssigned[d] = 0;
      }
      
      // Saturday-first day order for Phase 2 (matching Phase 1)
      const phase2DayOrder = saturdayFirstOrder; // Sat, Fri, Sun, Mon, Tue, Wed, Thu
      
      // Round-robin: keep cycling through days until all targets are met or no progress
      let phase2Progress = true;
      while (phase2Progress) {
        phase2Progress = false;
        
        // Process days in Saturday-first order
        for (const dayIndex of phase2DayOrder) {
          if (additionalAssigned[dayIndex] >= additionalTargets[dayIndex]) continue;
          
          const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
          
          // Skip holidays
          if (isHoliday(currentDay)) continue;
          
          const shifts = getShiftTimes(currentDay);
          
          // Get all available employees who can work any shift today (shuffled for variety)
          // Sort by fewest days worked first (to spread evenly), then by priority
          // Include donor greeters for Saturday-priority additional staffing
          const allAvailable = shuffleArray([...donorGreeters, ...donationPricers, ...apparelProcessors, ...cashiers])
            .filter(e => canWorkShortShift(e, currentDay, dayIndex) || canWorkFullShift(e, currentDay, dayIndex))
            .sort((a, b) => {
              // Prefer employees who have worked fewer days (spread coverage evenly)
              const daysWorkedDiff = employeeState[a.id].daysWorked - employeeState[b.id].daysWorked;
              if (daysWorkedDiff !== 0) return daysWorkedDiff;
              // Then by priority (pre-shuffle provides randomness for equal priority)
              return getEmployeePriority(a) - getEmployeePriority(b);
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
              if (['DONPRI', 'DONPRWV', 'APPROC', 'APWV'].includes(emp.jobTitle)) {
                shift = randomPick([shifts.opener, shifts.early9]);
              } else if (['DONDOOR', 'WVDON'].includes(emp.jobTitle)) {
                shift = randomPick([shifts.closer, shifts.mid11]);
              } else {
                shift = randomPick(shiftRotation);
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
      // IMPORTANT: Use Saturday-first ordering to maintain Saturday >= Sunday for greeters/cashiers
      
      // Track greeter/cashier counts per day for Phase 3 (continuing from Phase 1)
      // Initialize from existing shifts
      const phase3GreetersByDay: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
      const phase3CashiersByDay: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
      
      // Count existing shifts from Phase 1
      for (const shift of pendingShifts) {
        const shiftDate = new Date(shift.startTime);
        const dayOfWeek = shiftDate.getDay();
        const emp = employees.find(e => e.id === shift.employeeId);
        if (emp) {
          if (donorGreeterCodes.includes(emp.jobTitle)) {
            phase3GreetersByDay[dayOfWeek]++;
          } else if (cashierCodes.includes(emp.jobTitle)) {
            phase3CashiersByDay[dayOfWeek]++;
          }
        }
      }
      
      console.log(`[Scheduler] Phase 3 starting - Greeters: Sat=${phase3GreetersByDay[6]}, Sun=${phase3GreetersByDay[0]}`);
      console.log(`[Scheduler] Phase 3 starting - Cashiers: Sat=${phase3CashiersByDay[6]}, Sun=${phase3CashiersByDay[0]}`);
      
      // Keep filling until no one can take more shifts
      let madeProgress = true;
      let iterations = 0;
      const maxIterations = 50; // Prevent infinite loops
      
      // Use Saturday-first day order to ensure Saturday gets priority
      const phase3DayOrder = saturdayFirstOrder; // Sat first, then Fri, Sun, Mon...
      
      while (madeProgress && iterations < maxIterations) {
        madeProgress = false;
        iterations++;
        
        // Process each day in Saturday-first order
        for (const dayIndex of phase3DayOrder) {
          const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
          
          // Skip holidays
          if (isHoliday(currentDay)) continue;
          
          const shifts = getShiftTimes(currentDay);
          const isSunday = dayIndex === 0;

          // Find employees who can still work (either full or short shifts)
          // Shuffle first, then sort by fewest days worked for even distribution with variety
          const underScheduled = shuffleArray([...managers, ...donorGreeters, ...donationPricers, ...apparelProcessors, ...cashiers])
            .filter(e => {
              const canWork = canWorkShortShift(e, currentDay, dayIndex) || canWorkFullShift(e, currentDay, dayIndex);
              if (!canWork) return false;
              
              // For Sunday: enforce Saturday >= Sunday constraint for greeters and cashiers
              if (isSunday) {
                if (donorGreeterCodes.includes(e.jobTitle)) {
                  // Only allow greeter on Sunday if Sunday count < Saturday count
                  if (phase3GreetersByDay[0] >= phase3GreetersByDay[6]) {
                    return false;
                  }
                }
                if (cashierCodes.includes(e.jobTitle)) {
                  // Only allow cashier on Sunday if Sunday count < Saturday count
                  if (phase3CashiersByDay[0] >= phase3CashiersByDay[6]) {
                    return false;
                  }
                }
              }
              return true;
            })
            .sort((a, b) => {
              // Prefer employees who have worked fewer days (spread coverage evenly)
              const daysWorkedDiff = employeeState[a.id].daysWorked - employeeState[b.id].daysWorked;
              if (daysWorkedDiff !== 0) return daysWorkedDiff;
              // Then by priority (pre-shuffle provides randomness for equal priority)
              return getEmployeePriority(a) - getEmployeePriority(b);
            });

          // Assign ONE employee per day per iteration (round-robin)
          for (const emp of underScheduled) {
            // Managers always get full shifts (opener or closer only)
            if (allLeadershipCodes.includes(emp.jobTitle)) {
              if (!canWorkFullShift(emp, currentDay, dayIndex)) continue;
              // Randomize opener vs closer for variety
              const shift = Math.random() < 0.5 ? shifts.opener : shifts.closer;
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
                // Update tracking for greeters/cashiers
                if (donorGreeterCodes.includes(emp.jobTitle)) {
                  phase3GreetersByDay[dayIndex]++;
                } else if (cashierCodes.includes(emp.jobTitle)) {
                  phase3CashiersByDay[dayIndex]++;
                }
                break; // Move to next day (round-robin)
              }
            }
            // Full-timers get full shifts only
            else if (canWorkFullShift(emp, currentDay, dayIndex)) {
              let shift;
              if (['DONPRI', 'DONPRWV', 'APPROC', 'APWV'].includes(emp.jobTitle)) {
                shift = randomPick([shifts.opener, shifts.early9]);
              } else if (['DONDOOR', 'WVDON'].includes(emp.jobTitle)) {
                shift = randomPick([shifts.closer, shifts.mid11]);
              } else {
                shift = randomPick([shifts.opener, shifts.early9, shifts.mid10, shifts.mid11, shifts.closer]);
              }
              scheduleShift(emp, shift.start, shift.end, dayIndex);
              madeProgress = true;
              // Update tracking for greeters/cashiers
              if (donorGreeterCodes.includes(emp.jobTitle)) {
                phase3GreetersByDay[dayIndex]++;
              } else if (cashierCodes.includes(emp.jobTitle)) {
                phase3CashiersByDay[dayIndex]++;
              }
              break; // Move to next day (round-robin)
            }
          }
        }
      }
      
      console.log(`[Scheduler] Phase 3 complete - Greeters: Sat=${phase3GreetersByDay[6]}, Sun=${phase3GreetersByDay[0]}`);
      console.log(`[Scheduler] Phase 3 complete - Cashiers: Sat=${phase3CashiersByDay[6]}, Sun=${phase3CashiersByDay[0]}`);

      console.log(`[Scheduler] After Phase 3: ${pendingShifts.length} shifts, ${getTotalScheduledHours()} hours`);

      // ========== PHASE 4: FILL REMAINING HOURS WITH GAP/SHORT SHIFTS ==========
      // For part-time employees who have remaining hours, add appropriate shifts to reach max
      // - 5h gap shift for employees with exactly 5h remaining (e.g., 24h + 5h = 29h)
      // - 5.5h short shift for employees with 5.5h+ remaining
      // Note: Managers are excluded - they should only work full opener/closer shifts for coverage
      // IMPORTANT: Use Saturday-first ordering to maintain Saturday >= Sunday for greeters/cashiers
      const allRetailEmployees = [...donorGreeters, ...donationPricers, ...apparelProcessors, ...cashiers];
      
      // Track greeter/cashier counts for Phase 4 (continuing from Phase 3)
      const phase4GreetersByDay = { ...phase3GreetersByDay };
      const phase4CashiersByDay = { ...phase3CashiersByDay };
      
      // Use Saturday-first day order
      const phase4DayOrder = saturdayFirstOrder;
      
      // Shuffle first, then sort by employees who are closest to max (smallest gap first)
      // This provides variety for employees with similar remaining hours
      const sortedForPhase4 = shuffleArray([...allRetailEmployees]).sort((a, b) => {
        const gapA = getRemainingHours(a);
        const gapB = getRemainingHours(b);
        return gapA - gapB; // Smallest gap first, pre-shuffle provides randomness for ties
      });
      
      for (const emp of sortedForPhase4) {
        const remaining = getRemainingHours(emp);
        const state = employeeState[emp.id];
        
        // Skip if they can't work more days
        if (state.daysWorked >= getMaxDays(emp)) continue;
        
        // Use gap shift (5h) if remaining is exactly 5h or close to it
        if (remaining >= 5 && remaining <= 5.5) {
          for (const dayIndex of phase4DayOrder) { // Saturday-first distribution
            if (state.daysWorkedOn.has(dayIndex)) continue;
            
            const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
            if (isOnTimeOff(emp.id, currentDay, dayIndex)) continue;
            if (!canWorkGapShift(emp, currentDay, dayIndex)) continue;
            
            // For Sunday: enforce Saturday >= Sunday constraint
            const isSunday = dayIndex === 0;
            if (isSunday) {
              if (donorGreeterCodes.includes(emp.jobTitle) && phase4GreetersByDay[0] >= phase4GreetersByDay[6]) continue;
              if (cashierCodes.includes(emp.jobTitle) && phase4CashiersByDay[0] >= phase4CashiersByDay[6]) continue;
            }
            
            const shifts = getShiftTimes(currentDay);
            
            // Assign gap shift based on role with randomness
            let gapShift;
            if (['DONPRI', 'DONPRWV', 'APPROC', 'APWV'].includes(emp.jobTitle)) {
              gapShift = shifts.gapMorning;
            } else if (['DONDOOR', 'WVDON'].includes(emp.jobTitle)) {
              gapShift = randomPick([shifts.gapMid, shifts.gapEvening]);
            } else {
              gapShift = randomPick([shifts.gapMorning, shifts.gapMid, shifts.gapEvening]);
            }
            
            scheduleShift(emp, gapShift.start, gapShift.end, dayIndex);
            // Update tracking
            if (donorGreeterCodes.includes(emp.jobTitle)) phase4GreetersByDay[dayIndex]++;
            if (cashierCodes.includes(emp.jobTitle)) phase4CashiersByDay[dayIndex]++;
            break;
          }
        }
        // Use short shift (5.5h) if remaining is more than 5.5h but less than 8h
        else if (remaining >= SHORT_SHIFT_HOURS && remaining < FULL_SHIFT_HOURS) {
          for (const dayIndex of phase4DayOrder) { // Saturday-first distribution
            if (state.daysWorkedOn.has(dayIndex)) continue;
            
            const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
            if (isOnTimeOff(emp.id, currentDay, dayIndex)) continue;
            if (!canWorkShortShift(emp, currentDay, dayIndex)) continue;
            
            // For Sunday: enforce Saturday >= Sunday constraint
            const isSunday = dayIndex === 0;
            if (isSunday) {
              if (donorGreeterCodes.includes(emp.jobTitle) && phase4GreetersByDay[0] >= phase4GreetersByDay[6]) continue;
              if (cashierCodes.includes(emp.jobTitle) && phase4CashiersByDay[0] >= phase4CashiersByDay[6]) continue;
            }
            
            const shifts = getShiftTimes(currentDay);
            
            // Assign short shift based on role with randomness
            let shortShift;
            if (['DONPRI', 'DONPRWV', 'APPROC', 'APWV'].includes(emp.jobTitle)) {
              shortShift = randomPick([shifts.shortMorning, shifts.shortMid10]);
            } else if (['DONDOOR', 'WVDON'].includes(emp.jobTitle)) {
              shortShift = randomPick([shifts.shortMid10, shifts.shortMid12, shifts.shortEvening]);
            } else {
              shortShift = randomPick([shifts.shortMorning, shifts.shortMid, shifts.shortMid10]);
            }
            
            scheduleShift(emp, shortShift.start, shortShift.end, dayIndex);
            // Update tracking
            if (donorGreeterCodes.includes(emp.jobTitle)) phase4GreetersByDay[dayIndex]++;
            if (cashierCodes.includes(emp.jobTitle)) phase4CashiersByDay[dayIndex]++;
            break;
          }
        }
      }
      
      console.log(`[Scheduler] Phase 4 complete - Greeters: Sat=${phase4GreetersByDay[6]}, Sun=${phase4GreetersByDay[0]}`);
      console.log(`[Scheduler] Phase 4 complete - Cashiers: Sat=${phase4CashiersByDay[6]}, Sun=${phase4CashiersByDay[0]}`);

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

  app.put(api.locations.update.path, requireAuth, async (req, res) => {
    try {
      const user = (req.session as any)?.user as { id: number; role: string; locationIds?: string[] };
      const locationId = Number(req.params.id);
      const input = api.locations.update.input.parse(req.body);
      
      // Managers can only update their assigned locations
      if (user.role === "manager") {
        const userLocationIds = user.locationIds || [];
        if (!userLocationIds.includes(String(locationId))) {
          return res.status(403).json({ message: "You can only update your assigned locations" });
        }
        // Managers cannot change isActive status
        if (input.isActive !== undefined) {
          return res.status(403).json({ message: "Only admins can enable or disable locations" });
        }
      } else if (user.role !== "admin") {
        // Viewers cannot update locations at all
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      const location = await storage.updateLocation(locationId, input);
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
  // Managers need read access to use quick shifts when adding shifts
  app.get(api.shiftPresets.list.path, requireManager, async (req, res) => {
    const presets = await storage.getShiftPresets();
    res.json(presets);
  });

  app.get(api.shiftPresets.get.path, requireManager, async (req, res) => {
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
      
      // Check if HR notification should be sent for crossing thresholds
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host || 'localhost:5000';
      const appUrl = `${protocol}://${host}`;
      checkAndSendHRNotification(employeeId, occurrenceValue, appUrl).catch(err => 
        console.error('[HR Notification] Background error:', err)
      );
      
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

  // Retract an adjustment
  app.post("/api/occurrence-adjustments/:id/retract", requireAuth, async (req, res) => {
    try {
      const user = (req.session as any)?.user;
      if (user.role !== "admin" && user.role !== "manager") {
        return res.status(403).json({ message: "Only managers and admins can retract adjustments" });
      }
      
      const id = Number(req.params.id);
      const { reason } = req.body;
      
      if (!reason) {
        return res.status(400).json({ message: "Retraction reason is required" });
      }
      
      const adjustment = await storage.retractAdjustment(id, reason, user.id);
      if (!adjustment) {
        return res.status(404).json({ message: "Adjustment not found" });
      }
      res.json(adjustment);
    } catch (error) {
      console.error("Error retracting adjustment:", error);
      res.status(500).json({ message: "Failed to retract adjustment" });
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
      // FMLA and consecutive sickness occurrences do NOT count toward the total
      const countableOccurrences = activeOccurrences.filter(o => !o.isFmla && !o.isConsecutiveSickness);
      const totalPoints = countableOccurrences.reduce((sum, o) => sum + o.occurrenceValue, 0) / 100;
      
      // Get adjustments for the current calendar year
      const currentYear = now.getFullYear();
      const adjustments = await storage.getOccurrenceAdjustmentsForYear(employeeId, currentYear);
      
      // Separate manual adjustments (unscheduled_shift) from perfect attendance adjustments
      // Active adjustments are used for tallies
      const activeManualAdjustments = adjustments.filter(a => a.adjustmentType !== 'perfect_attendance' && a.status === 'active');
      const activePerfectAttendanceAdjustments = adjustments.filter(a => a.adjustmentType === 'perfect_attendance' && a.status === 'active');
      const manualAdjustmentTotal = activeManualAdjustments.reduce((sum, a) => sum + a.adjustmentValue, 0) / 100;
      
      // Perfect attendance: can only happen once per calendar year
      const perfectAttendanceUsedThisYear = activePerfectAttendanceAdjustments.length > 0;
      const perfectAttendanceValue = perfectAttendanceUsedThisYear 
        ? activePerfectAttendanceAdjustments.reduce((sum, a) => sum + a.adjustmentValue, 0) / 100
        : 0;
      
      // Check eligibility for perfect attendance (90 days without occurrences)
      const yearStart = `${currentYear}-01-01`;
      const yearOccurrences = await storage.getOccurrences(employeeId, yearStart, endDate);
      const activeYearOccurrences = yearOccurrences.filter(o => o.status === 'active');
      
      let perfectAttendanceEligible = false;
      
      if (!perfectAttendanceUsedThisYear) {
        if (activeYearOccurrences.length === 0) {
          // No occurrences this calendar year - check if 90 days have passed since Jan 1
          const yearStartDate = new Date(`${currentYear}-01-01T00:00:00`);
          const daysSinceYearStart = Math.floor((now.getTime() - yearStartDate.getTime()) / (1000 * 60 * 60 * 24));
          if (daysSinceYearStart >= 90) {
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
            perfectAttendanceEligible = true;
          }
        }
      }
      
      // Total adjustment = manual adjustments + perfect attendance (if used)
      const totalAdjustment = manualAdjustmentTotal + perfectAttendanceValue;
      
      // Net tally = total occurrences + adjustments (adjustments are negative values)
      const netTally = Math.max(0, totalPoints + totalAdjustment);
      
      // Sort all occurrences by date (most recent first) for display
      const sortedOccurrences = [...allOccurrences].sort((a, b) => 
        new Date(b.occurrenceDate).getTime() - new Date(a.occurrenceDate).getTime()
      );
      
      // Determine if perfect attendance would be wasted (no occurrences to reduce)
      const hasOccurrencesToReduce = totalPoints > 0;
      
      res.json({
        employeeId,
        periodStart: startDate,
        periodEnd: endDate,
        totalOccurrences: totalPoints,
        adjustmentsThisYear: totalAdjustment,
        adjustmentsRemaining: 2 - activeManualAdjustments.length, // Only count active manual adjustments toward limit
        netTally,
        occurrenceCount: activeOccurrences.length,
        occurrences: sortedOccurrences, // Include all occurrences (active + retracted) for history
        adjustments: adjustments, // Include all adjustments (active + retracted) for display
        perfectAttendanceBonus: perfectAttendanceUsedThisYear,
        perfectAttendanceBonusValue: perfectAttendanceValue,
        perfectAttendanceUsed: perfectAttendanceUsedThisYear ? 1 : 0,
        perfectAttendanceEligible,
        perfectAttendanceWouldBeWasted: perfectAttendanceEligible && !hasOccurrencesToReduce
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

      // OPTIMIZATION: Fetch all data in bulk with just 3 queries instead of 4 per employee
      const [allOccurrences, allAdjustments, allCorrectiveActions] = await Promise.all([
        storage.getAllOccurrencesInDateRange(startDate, endDate),
        storage.getAllOccurrenceAdjustmentsForYear(currentYear),
        storage.getAllCorrectiveActions()
      ]);

      // Group data by employee ID for fast lookups
      const occurrencesByEmployee = new Map<number, typeof allOccurrences>();
      for (const occ of allOccurrences) {
        const list = occurrencesByEmployee.get(occ.employeeId) || [];
        list.push(occ);
        occurrencesByEmployee.set(occ.employeeId, list);
      }

      const adjustmentsByEmployee = new Map<number, typeof allAdjustments>();
      for (const adj of allAdjustments) {
        const list = adjustmentsByEmployee.get(adj.employeeId) || [];
        list.push(adj);
        adjustmentsByEmployee.set(adj.employeeId, list);
      }

      const correctiveByEmployee = new Map<number, typeof allCorrectiveActions>();
      for (const action of allCorrectiveActions) {
        const list = correctiveByEmployee.get(action.employeeId) || [];
        list.push(action);
        correctiveByEmployee.set(action.employeeId, list);
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

      // Calculate occurrence totals for each employee using pre-fetched data
      for (const emp of allEmployees) {
        const empOccurrences = occurrencesByEmployee.get(emp.id) || [];
        const activeOccurrences = empOccurrences.filter(o => o.status === 'active');
        // FMLA and consecutive sickness occurrences do NOT count toward the total
        const countableOccurrences = activeOccurrences.filter(o => !o.isFmla && !o.isConsecutiveSickness);
        const totalPoints = countableOccurrences.reduce((sum, o) => sum + o.occurrenceValue, 0) / 100;

        // Get adjustments for this year (only count active adjustments)
        const empAdjustments = adjustmentsByEmployee.get(emp.id) || [];
        const activeAdjustments = empAdjustments.filter(a => a.status === 'active');
        const manualAdjustments = activeAdjustments.filter(a => a.adjustmentType !== 'perfect_attendance');
        const manualAdjustmentTotal = manualAdjustments.reduce((sum, a) => sum + a.adjustmentValue, 0) / 100;

        // Check for perfect attendance bonus - filter occurrences to this year only
        const activeYearOccurrences = activeOccurrences.filter(o => o.occurrenceDate >= yearStart);
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

        // Get corrective actions for this employee to check if action already taken
        const empCorrective = correctiveByEmployee.get(emp.id) || [];
        const hasWarning = empCorrective.some(a => a.actionType === 'warning');
        const hasFinalWarning = empCorrective.some(a => a.actionType === 'final_warning');
        const hasTermination = empCorrective.some(a => a.actionType === 'termination');

        // Check thresholds (using netTally for accurate count)
        // Only show alert if the appropriate corrective action hasn't been recorded
        // 5 = warning, 7 = final warning, 8 = termination
        if (netTally >= 8 && !hasTermination) {
          alerts.push({
            employeeId: emp.id,
            employeeName: emp.name,
            location: emp.location,
            jobTitle: emp.jobTitle,
            occurrenceTotal: totalPoints,
            netTally,
            threshold: 8,
            message: `${emp.name} has reached ${netTally.toFixed(1)} occurrences. Termination.`
          });
        } else if (netTally >= 7 && !hasFinalWarning) {
          alerts.push({
            employeeId: emp.id,
            employeeName: emp.name,
            location: emp.location,
            jobTitle: emp.jobTitle,
            occurrenceTotal: totalPoints,
            netTally,
            threshold: 7,
            message: `${emp.name} is at ${netTally.toFixed(1)} occurrences. Final warning.`
          });
        } else if (netTally >= 5 && !hasWarning) {
          alerts.push({
            employeeId: emp.id,
            employeeName: emp.name,
            location: emp.location,
            jobTitle: emp.jobTitle,
            occurrenceTotal: totalPoints,
            netTally,
            threshold: 5,
            message: `${emp.name} is at ${netTally.toFixed(1)} occurrences. Warning.`
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
      
      const now = new Date();
      const year = calendarYear || now.getFullYear();
      
      // Get existing adjustments for the year
      const existingAdjustments = await storage.getOccurrenceAdjustmentsForYear(employeeId, year);
      const activeAdjustments = existingAdjustments.filter(a => a.status === 'active');
      
      // Special validation for perfect_attendance adjustments
      if (adjustmentType === 'perfect_attendance') {
        // Check if already used perfect attendance this year
        const existingPerfectAttendance = activeAdjustments.filter(a => a.adjustmentType === 'perfect_attendance');
        if (existingPerfectAttendance.length > 0) {
          return res.status(400).json({ message: "Perfect attendance bonus has already been used this year (limit: 1 per year)" });
        }
        
        // Check if employee has occurrences to reduce (don't waste the bonus)
        const oneYearAgo = new Date(now);
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        const startDate = oneYearAgo.toISOString().split('T')[0];
        const endDate = now.toISOString().split('T')[0];
        const occurrences = await storage.getOccurrences(employeeId, startDate, endDate);
        const activeOccurrences = occurrences.filter(o => o.status === 'active');
        const totalPoints = activeOccurrences.reduce((sum, o) => sum + o.occurrenceValue, 0) / 100;
        
        if (totalPoints === 0) {
          return res.status(400).json({ message: "Cannot grant perfect attendance bonus - employee has no occurrences to reduce" });
        }
      } else {
        // Check if employee already has 2 manual adjustments this year
        const manualAdjustments = activeAdjustments.filter(a => a.adjustmentType !== 'perfect_attendance');
        if (manualAdjustments.length >= 2) {
          return res.status(400).json({ message: "Employee has already used maximum 2 adjustments for this year" });
        }
      }
      
      const adjustment = await storage.createOccurrenceAdjustment({
        employeeId,
        adjustmentDate: now.toISOString().split('T')[0],
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

  // === CORRECTIVE ACTIONS ===
  
  // Get corrective actions for an employee
  app.get("/api/corrective-actions/:employeeId", requireAuth, async (req, res) => {
    try {
      const employeeId = Number(req.params.employeeId);
      const user = (req.session as any)?.user;
      
      // Only managers and admins can view corrective actions
      if (user.role !== "admin" && user.role !== "manager") {
        return res.status(403).json({ message: "Only managers and admins can view corrective actions" });
      }
      
      const actions = await storage.getCorrectiveActions(employeeId);
      res.json(actions);
    } catch (error) {
      console.error("Error fetching corrective actions:", error);
      res.status(500).json({ message: "Failed to fetch corrective actions" });
    }
  });

  // Create a corrective action
  app.post("/api/corrective-actions", requireAuth, async (req, res) => {
    try {
      const user = (req.session as any)?.user;
      if (user.role !== "admin" && user.role !== "manager") {
        return res.status(403).json({ message: "Only managers and admins can create corrective actions" });
      }
      
      const { employeeId, actionType, actionDate, occurrenceCount, notes } = req.body;
      
      if (!employeeId || !actionType || !actionDate || occurrenceCount === undefined) {
        return res.status(400).json({ message: "employeeId, actionType, actionDate, and occurrenceCount are required" });
      }
      
      // Validate action type
      const validTypes = ['warning', 'final_warning', 'termination'];
      if (!validTypes.includes(actionType)) {
        return res.status(400).json({ message: "actionType must be 'warning', 'final_warning', or 'termination'" });
      }
      
      // Get existing actions to validate the progression
      const existingActions = await storage.getCorrectiveActions(employeeId);
      
      // Validate progression: warning -> final_warning -> termination
      if (actionType === 'final_warning') {
        const hasWarning = existingActions.some(a => a.actionType === 'warning');
        if (!hasWarning) {
          return res.status(400).json({ message: "A warning must be recorded before a final warning" });
        }
      }
      
      if (actionType === 'termination') {
        const hasWarning = existingActions.some(a => a.actionType === 'warning');
        const hasFinalWarning = existingActions.some(a => a.actionType === 'final_warning');
        if (!hasWarning || !hasFinalWarning) {
          return res.status(400).json({ message: "Both warning and final warning must be recorded before termination" });
        }
      }
      
      // Prevent duplicate actions of the same type
      const alreadyExists = existingActions.some(a => a.actionType === actionType);
      if (alreadyExists) {
        return res.status(400).json({ message: `A ${actionType.replace('_', ' ')} has already been recorded` });
      }
      
      const action = await storage.createCorrectiveAction({
        employeeId,
        actionType,
        actionDate,
        occurrenceCount,
        notes: notes || null,
        createdBy: user.id
      });
      
      res.status(201).json(action);
    } catch (error) {
      console.error("Error creating corrective action:", error);
      res.status(500).json({ message: "Failed to create corrective action" });
    }
  });

  // Delete a corrective action
  app.delete("/api/corrective-actions/:id", requireAuth, async (req, res) => {
    try {
      const user = (req.session as any)?.user;
      if (user.role !== "admin" && user.role !== "manager") {
        return res.status(403).json({ message: "Only managers and admins can delete corrective actions" });
      }
      
      const id = Number(req.params.id);
      await storage.deleteCorrectiveAction(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting corrective action:", error);
      res.status(500).json({ message: "Failed to delete corrective action" });
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
