
import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { ukgClient } from "./ukg";
import { RETAIL_JOB_CODES } from "@shared/schema";
import { formatInTimeZone } from "date-fns-tz";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { sendOccurrenceAlertEmail, sendSchedulePublishEmail, testOutlookConnection, type OccurrenceAlertEmailData } from "./outlook";
import { TIMEZONE, getNotificationEmails, requireAuth, requireAdmin, requireManager, checkAndSendHRNotification } from "./middleware";
import { generateSchedule } from "./schedule-generator";
import { registerUKGRoutes } from "./routes/ukg";
import { registerOccurrenceRoutes } from "./routes/occurrences";
import { registerShiftTradeRoutes } from "./routes/shift-trades";
import { registerReportRoutes } from "./routes/reports";
import { registerCoachingRoutes } from "./routes/coaching";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Register object storage routes for PDF document uploads
  registerObjectStorageRoutes(app);

  // Load UKG credentials from database settings (overrides env vars if set)
  try {
    const settings = await storage.getGlobalSettings();
    if (settings.ukgApiUrl && settings.ukgUsername && settings.ukgPassword) {
      ukgClient.updateCredentials(settings.ukgApiUrl, settings.ukgUsername, settings.ukgPassword);
      console.log("[UKG] Loaded credentials from database settings");
    }
  } catch (err) {
    console.error("[UKG] Failed to load credentials from database:", err);
  }

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
      const startTime = new Date(req.body.startTime);
      const endTime = new Date(req.body.endTime);
      if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
        return res.status(400).json({ message: "Invalid shift timestamps" });
      }
      if (endTime.getTime() <= startTime.getTime()) {
        return res.status(400).json({ message: "Shift end time must be after start time" });
      }
      const input = api.shifts.create.input.parse({
        ...req.body,
        startTime,
        endTime
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
       if (body.startTime && body.endTime && body.endTime.getTime() <= body.startTime.getTime()) {
         return res.status(400).json({ message: "Shift end time must be after start time" });
       }

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
        const shiftDate = new Date(targetWeekStart);
        const currentDay = shiftDate.getDay();
        const daysToAdd = pattern.dayOfWeek - currentDay;
        shiftDate.setDate(shiftDate.getDate() + daysToAdd);
        
        const startTime = new Date(shiftDate);
        startTime.setHours(pattern.startHour, pattern.startMinute, 0, 0);
        
        const endTime = new Date(shiftDate);
        endTime.setHours(pattern.endHour, pattern.endMinute, 0, 0);
        
        if (endTime <= startTime) {
          endTime.setDate(endTime.getDate() + 1);
        }
        
        return {
          employeeId: pattern.employeeId,
          startTime,
          endTime,
        };
      });
      
      console.log(`[Template Apply] Template "${template.name}" has ${patterns.length} patterns, generated ${newShifts.length} shifts (${newShifts.filter((s: any) => new Date(s.endTime) > new Date(s.startTime)).length} valid)`);
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

  app.get("/api/email-logs", requireAuth, requireAdmin, async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    const logs = await storage.getEmailLogs(Math.min(limit, 500));
    res.json(logs);
  });

  app.post(api.schedule.generate.path, async (req, res) => {
    try {
      const { weekStart, location } = api.schedule.generate.input.parse(req.body);
      const insertedShifts = await generateSchedule(weekStart, location);
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

  // Clear schedule for a week (optionally filtered by location)
  app.post("/api/schedule/clear", async (req, res) => {
    try {
      const parsed = api.schedule.generate.input.parse(req.body);
      const location = parsed.location;
      const startDate = new Date(parsed.weekStart);
      const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);
      
      console.log(`[Clear Schedule] Clearing shifts for week ${parsed.weekStart}, location: ${location || "ALL"}`);
      
      const deletedCount = await storage.deleteShiftsByDateRange(startDate, endDate, location);
      
      console.log(`[Clear Schedule] Deleted ${deletedCount} shifts`);
      
      // Auto-unpublish the schedule when clearing
      // Use formatInTimeZone to get consistent date format
      const weekStartDate = formatInTimeZone(startDate, TIMEZONE, "yyyy-MM-dd");
      const wasPublished = await storage.isSchedulePublished(weekStartDate);
      if (wasPublished) {
        await storage.unpublishSchedule(weekStartDate);
        console.log(`[Clear Schedule] Auto-unpublished schedule for week ${weekStartDate}`);
      }
      
      const locationLabel = location || "all locations";
      res.json({ 
        message: `Cleared ${deletedCount} shifts for ${locationLabel}`, 
        deletedCount,
        unpublished: wasPublished
      });
    } catch (err) {
      console.error("Clear schedule error:", err);
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: "Failed to clear schedule" });
    }
  });

  registerUKGRoutes(app);

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

      // Send email notifications asynchronously (don't block the response)
      (async () => {
        try {
          const allShifts = await storage.getShifts();
          const employees = await storage.getEmployees();

          // Find shifts for this week using startTime
          const weekStartDate = new Date(weekStart);
          const weekEndDate = new Date(weekStartDate);
          weekEndDate.setDate(weekEndDate.getDate() + 7);

          const weekShifts = allShifts.filter(s => {
            const shiftStart = new Date(s.startTime);
            return shiftStart >= weekStartDate && shiftStart < weekEndDate;
          });

          // Get unique employee IDs with shifts this week
          const scheduledEmployeeIds = Array.from(new Set(weekShifts.map(s => s.employeeId)));

          // Format the week start for display
          const displayDate = formatInTimeZone(weekStartDate, TIMEZONE, "MMMM d, yyyy");
          const appUrl = "https://goodshift.goodwillgoodskills.org";

          let emailsSent = 0;
          for (const empId of scheduledEmployeeIds) {
            const emp = employees.find(e => e.id === empId);
            if (!emp) continue;

            const emails = await getNotificationEmails(emp);
            const locationName = emp.location || "your store";

            for (const email of emails) {
              await sendSchedulePublishEmail(email, {
                recipientName: emp.name.split(",").reverse().join(" ").trim(),
                weekStartDate: displayDate,
                locationName,
                appUrl,
              });
              emailsSent++;
            }
          }
          console.log(`[Schedule Publish] Sent ${emailsSent} notification emails for week of ${weekStart}`);
        } catch (emailError) {
          console.error("[Schedule Publish] Error sending notification emails:", emailError);
        }
      })();
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

  // PATCH /api/my-employee/alternate-email - Employee updates their own alternate notification email
  app.patch("/api/my-employee/alternate-email", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req.session as any)?.user;
      if (!user?.email) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const { alternateEmail } = req.body;
      const employees = await storage.getEmployees();
      const linkedEmployee = employees.find(e => e.email && e.email.toLowerCase() === user.email.toLowerCase());

      if (!linkedEmployee) {
        return res.status(404).json({ message: "No linked employee found for your account" });
      }

      const emailValue = alternateEmail?.trim() || null;
      if (emailValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
        return res.status(400).json({ message: "Invalid email format" });
      }

      const updated = await storage.updateEmployee(linkedEmployee.id, { alternateEmail: emailValue });
      res.json(updated);
    } catch (error) {
      console.error("Error updating alternate email:", error);
      res.status(500).json({ message: "Failed to update alternate email" });
    }
  });

  registerOccurrenceRoutes(app);

  registerShiftTradeRoutes(app);

  registerReportRoutes(app);

  registerCoachingRoutes(app);

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
