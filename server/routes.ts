
import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { api } from "@shared/routes";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { ukgClient } from "./ukg";
import { RETAIL_JOB_CODES, featurePermissions, SYSTEM_FEATURES, DEFAULT_FEATURE_PERMISSIONS, LEGACY_FEATURE_EXPANSIONS } from "@shared/schema";
import { inArray } from "drizzle-orm";
import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { sendOccurrenceAlertEmail, sendSchedulePublishEmail, generateSchedulePublishEmailHtml, testOutlookConnection, type OccurrenceAlertEmailData } from "./outlook";
import { TIMEZONE, getNotificationEmails, requireAuth, requireAdmin, requireManager, checkAndSendHRNotification, getFeaturePermissions, invalidatePermissionsCache, requireFeatureAccess, userHasFeature } from "./middleware";
import { generateSchedule } from "./schedule-generator";
import { registerUKGRoutes } from "./routes/ukg";
import { registerOccurrenceRoutes } from "./routes/occurrences";
import { registerShiftTradeRoutes } from "./routes/shift-trades";
import { registerReportRoutes } from "./routes/reports";
import { registerCoachingRoutes } from "./routes/coaching";
import { registerRosterRoutes } from "./routes/roster";
import { registerTaskAssignmentRoutes } from "./routes/task-assignments";
import { registerOptimizationRoutes } from "./routes/optimization";
import { registerOrderRoutes } from "./routes/orders";
import { registerTrailerManifestRoutes } from "./routes/trailerManifests";
import { registerWarehouseInventoryRoutes } from "./routes/warehouseInventory";
import { registerCreditCardInspectionRoutes } from "./routes/creditCardInspections";
import { registerDriverInspectionRoutes } from "./routes/driverInspections";
import { initOrdersTable } from "./mysql";

function deduplicateShifts(shifts: { employeeId: number; startTime: Date; endTime: Date }[]) {
  const seen = new Set<string>();
  return shifts.filter(s => {
    const key = `${s.employeeId}-${new Date(s.startTime).getTime()}-${new Date(s.endTime).getTime()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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
  app.get(api.employees.list.path, requireAuth, async (req, res) => {
    const user = (req.session as any)?.user;
    
    let employees = await storage.getEmployees();
    
    // Filter by active/inactive status (inactive only available to managers/admins)
    const showInactive = req.query.showInactive === "true";
    if (showInactive && (user?.role === "admin" || user?.role === "manager")) {
      employees = employees.filter(emp => !emp.isActive);
    } else {
      employees = employees.filter(emp => emp.isActive);
    }
    
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

  app.get(api.employees.get.path, requireAuth, async (req, res) => {
    const employee = await storage.getEmployee(Number(req.params.id));
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    res.json(employee);
  });

  app.post(api.employees.create.path, requireFeatureAccess("employees.edit"), async (req, res) => {
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

  app.put(api.employees.update.path, requireFeatureAccess("employees.edit"), async (req, res) => {
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

  app.delete(api.employees.delete.path, requireFeatureAccess("employees.delete"), async (req, res) => {
    await storage.deleteEmployee(Number(req.params.id));
    res.status(204).send();
  });

  // Toggle employee schedule visibility (for managers to hide terminated employees pending UKG update)
  app.post(api.employees.toggleScheduleVisibility.path, requireFeatureAccess("employees.edit"), async (req, res) => {
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
  app.get(api.shifts.list.path, requireAuth, async (req, res) => {
    const user = (req.session as any)?.user;
    const start = req.query.start ? new Date(req.query.start as string) : undefined;
    const end = req.query.end ? new Date(req.query.end as string) : undefined;
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
    
    let shifts = await storage.getShifts(start, end, employeeId);

    if (user?.role === "viewer") {
      const publishedWeeks = new Set<string>();
      for (const shift of shifts) {
        const shiftDate = new Date(shift.startTime);
        const day = shiftDate.getUTCDay();
        const weekStartDate = new Date(shiftDate);
        weekStartDate.setUTCDate(weekStartDate.getUTCDate() - day);
        const weekKey = formatInTimeZone(weekStartDate, TIMEZONE, "yyyy-MM-dd");
        publishedWeeks.add(weekKey);
      }
      const publishedSet = new Set<string>();
      for (const wk of publishedWeeks) {
        if (await storage.isSchedulePublished(wk)) {
          publishedSet.add(wk);
        }
      }
      shifts = shifts.filter(shift => {
        const shiftDate = new Date(shift.startTime);
        const day = shiftDate.getUTCDay();
        const weekStartDate = new Date(shiftDate);
        weekStartDate.setUTCDate(weekStartDate.getUTCDate() - day);
        const weekKey = formatInTimeZone(weekStartDate, TIMEZONE, "yyyy-MM-dd");
        return publishedSet.has(weekKey);
      });
    }

    res.json(shifts);
  });

  app.post(api.shifts.create.path, requireFeatureAccess("schedule.edit"), async (req, res) => {
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

  app.put(api.shifts.update.path, requireFeatureAccess("schedule.edit"), async (req, res) => {
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

  app.delete(api.shifts.delete.path, requireFeatureAccess("schedule.edit"), async (req, res) => {
    await storage.deleteShift(Number(req.params.id));
    res.status(204).send();
  });

  // === PAL (Paid Annual Leave) Entries ===
  // Get PAL entries from UKG time clock data (paycodeId = 2) for a date range
  app.get("/api/pal-entries", requireAuth, async (req, res) => {
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
  app.get("/api/unpaid-time-off-entries", requireAuth, async (req, res) => {
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
      const { weekStart, location } = req.body;
      if (!weekStart) {
        return res.status(400).json({ message: "weekStart is required" });
      }
      
      if (!isValidDate(weekStart)) {
        return res.status(400).json({ message: "Invalid weekStart date" });
      }
      
      const currentWeekStart = new Date(weekStart);
      const currentWeekEnd = new Date(currentWeekStart);
      currentWeekEnd.setDate(currentWeekEnd.getDate() + 7);
      currentWeekEnd.setUTCHours(11, 0, 0, 0);
      
      const shifts = await storage.getShifts(currentWeekStart, currentWeekEnd);
      
      let filteredShifts = shifts;
      if (location && location !== "all") {
        const allEmployees = await storage.getEmployees();
        const locationEmpIds = new Set(allEmployees.filter(e => e.location === location).map(e => e.id));
        filteredShifts = shifts.filter(s => locationEmpIds.has(s.employeeId));
      }
      
      if (filteredShifts.length === 0) {
        return res.status(400).json({ message: "No shifts to copy in the current week" });
      }
      
      const nextWeekStart = new Date(currentWeekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      const nextWeekEnd = new Date(nextWeekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      
      const loc = location && location !== "all" ? location : undefined;
      const cleared = await storage.deleteShiftsByDateRange(nextWeekStart, nextWeekEnd, loc);
      if (cleared > 0) {
        console.log(`[Copy Schedule] Cleared ${cleared} existing shifts for next week (${loc || "all locations"})`);
      }
      
      const newShifts = filteredShifts.map(shift => ({
        employeeId: shift.employeeId,
        startTime: new Date(new Date(shift.startTime).getTime() + 7 * 24 * 60 * 60 * 1000),
        endTime: new Date(new Date(shift.endTime).getTime() + 7 * 24 * 60 * 60 * 1000),
      }));
      
      const deduped = deduplicateShifts(newShifts);
      if (deduped.length < newShifts.length) {
        console.log(`[Copy Schedule] Removed ${newShifts.length - deduped.length} duplicate shift(s)`);
      }
      const created = await storage.createShiftsBatch(deduped);
      res.json({ message: `Copied ${created.length} shifts to next week`, count: created.length });
    } catch (err) {
      console.error("Error copying schedule:", err);
      res.status(500).json({ message: "Failed to copy schedule" });
    }
  });
  
  app.get("/api/schedule-templates", requireAuth, async (req, res) => {
    const user = (req.session as any)?.user;
    const templates = await storage.getScheduleTemplates();
    const userTemplates = templates.filter(t => t.createdBy === user?.id);
    res.json(userTemplates);
  });
  
  // Save current week as a template
  app.post("/api/schedule-templates", requireAuth, async (req, res) => {
    try {
      const { name, description, weekStart, createdBy, location } = req.body;
      if (!name || !weekStart) {
        return res.status(400).json({ message: "name and weekStart are required" });
      }
      
      if (!isValidDate(weekStart)) {
        return res.status(400).json({ message: "Invalid weekStart date" });
      }
      
      const currentWeekStart = new Date(weekStart);
      const currentWeekEnd = new Date(currentWeekStart);
      currentWeekEnd.setDate(currentWeekEnd.getDate() + 7);
      currentWeekEnd.setUTCHours(11, 0, 0, 0);
      
      let shifts = await storage.getShifts(currentWeekStart, currentWeekEnd);
      
      if (location && location !== "all") {
        const allEmployees = await storage.getEmployees();
        const locationEmpIds = new Set(allEmployees.filter(e => e.location === location).map(e => e.id));
        shifts = shifts.filter(s => locationEmpIds.has(s.employeeId));
      }
      
      if (shifts.length === 0) {
        return res.status(400).json({ message: "No shifts to save as template" });
      }
      
      const patterns = shifts.map(shift => {
        const startTime = new Date(shift.startTime);
        const endTime = new Date(shift.endTime);
        const startET = toZonedTime(startTime, TIMEZONE);
        const endET = toZonedTime(endTime, TIMEZONE);
        return {
          employeeId: shift.employeeId,
          dayOfWeek: startET.getDay(),
          startHour: startET.getHours(),
          startMinute: startET.getMinutes(),
          endHour: endET.getHours(),
          endMinute: endET.getMinutes(),
        };
      });
      
      const template = await storage.createScheduleTemplate({
        name,
        description: description || null,
        createdBy: createdBy || null,
        shiftPatterns: JSON.stringify(patterns),
      });
      
      console.log(`[Template Save] Saved "${name}" with ${patterns.length} patterns (location: ${location || "all"})`);
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
      const { weekStart, location } = req.body;
      
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
      const targetWeekEnd = new Date(targetWeekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      const targetWeekStartET = toZonedTime(targetWeekStart, TIMEZONE);
      
      const loc = location && location !== "all" ? location : undefined;
      
      let filteredPatterns = patterns;
      let locationEmpIds: Set<number> | null = null;
      if (loc) {
        const allEmployees = await storage.getEmployees();
        locationEmpIds = new Set(allEmployees.filter(e => e.location === loc).map(e => e.id));
        filteredPatterns = patterns.filter((p: any) => locationEmpIds!.has(p.employeeId));
      }
      
      const cleared = await storage.deleteShiftsByDateRange(targetWeekStart, targetWeekEnd, loc);
      if (cleared > 0) {
        console.log(`[Template Apply] Cleared ${cleared} existing shifts for week (${loc || "all locations"})`);
      }
      
      const newShifts = filteredPatterns.map((pattern: any) => {
        const shiftDateET = new Date(targetWeekStartET);
        const currentDay = shiftDateET.getDay();
        const daysToAdd = pattern.dayOfWeek - currentDay;
        shiftDateET.setDate(shiftDateET.getDate() + daysToAdd);
        
        const startET = new Date(shiftDateET);
        startET.setHours(pattern.startHour, pattern.startMinute, 0, 0);
        
        const endET = new Date(shiftDateET);
        endET.setHours(pattern.endHour, pattern.endMinute, 0, 0);
        
        if (endET <= startET) {
          endET.setDate(endET.getDate() + 1);
        }
        
        const startTime = fromZonedTime(startET, TIMEZONE);
        const endTime = fromZonedTime(endET, TIMEZONE);
        
        return {
          employeeId: pattern.employeeId,
          startTime,
          endTime,
        };
      });
      
      const validShifts = newShifts.filter((s: any) => new Date(s.endTime) > new Date(s.startTime));
      
      const deduped = deduplicateShifts(validShifts);
      console.log(`[Template Apply] Template "${template.name}" has ${patterns.length} total patterns, ${filteredPatterns.length} for location, ${validShifts.length} valid, ${deduped.length} after dedup`);
      const created = await storage.createShiftsBatch(deduped);
      res.json({ message: `Applied template with ${created.length} shifts`, count: created.length });
    } catch (err) {
      console.error("Error applying template:", err);
      res.status(500).json({ message: "Failed to apply template" });
    }
  });
  
  app.delete("/api/schedule-templates/:id", requireAuth, async (req, res) => {
    const user = (req.session as any)?.user;
    const template = await storage.getScheduleTemplate(Number(req.params.id));
    if (!template) return res.status(404).json({ message: "Template not found" });
    if (template.createdBy !== user?.id) return res.status(403).json({ message: "You can only delete your own templates" });
    await storage.deleteScheduleTemplate(template.id);
    res.status(204).send();
  });

  // === Role Requirements ===
  app.get(api.roleRequirements.list.path, requireAuth, async (req, res) => {
    const reqs = await storage.getRoleRequirements();
    res.json(reqs);
  });

  app.post(api.roleRequirements.create.path, requireFeatureAccess("schedule.roster_targets"), async (req, res) => {
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

  app.put(api.roleRequirements.update.path, requireFeatureAccess("schedule.roster_targets"), async (req, res) => {
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

  app.delete(api.roleRequirements.delete.path, requireFeatureAccess("schedule.roster_targets"), async (req, res) => {
    await storage.deleteRoleRequirement(Number(req.params.id));
    res.status(204).send();
  });

  // === Global Settings ===
  app.get(api.globalSettings.get.path, requireAuth, async (req, res) => {
    const settings = await storage.getGlobalSettings();
    res.json(settings);
  });

  app.post(api.globalSettings.update.path, requireFeatureAccess("settings.global_config"), async (req, res) => {
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

  app.get("/api/outlook/schedule-email-preview", requireAuth, requireAdmin, async (req, res) => {
    try {
      const appUrl = "https://goodshift.goodwillgoodskills.org";
      const html = generateSchedulePublishEmailHtml({
        recipientName: "Jane Smith",
        weekStartDate: "February 16, 2026",
        locationName: "Wheeling Store",
        appUrl,
      });
      res.json({ html });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to generate preview" });
    }
  });

  app.post("/api/outlook/test-schedule-email", requireAuth, requireAdmin, async (req, res) => {
    try {
      const settings = await storage.getGlobalSettings();
      if (!settings?.hrNotificationEmail) {
        return res.status(400).json({ success: false, message: "No HR notification email configured in settings" });
      }

      const appUrl = "https://goodshift.goodwillgoodskills.org";
      const sent = await sendSchedulePublishEmail(settings.hrNotificationEmail, {
        recipientName: "Test Employee",
        weekStartDate: "February 16, 2026",
        locationName: "Test Location",
        appUrl,
      });

      if (sent) {
        res.json({ success: true, message: `Test schedule email sent to ${settings.hrNotificationEmail}` });
      } else {
        res.status(500).json({ success: false, message: "Failed to send test schedule email" });
      }
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || "Failed to send test email" });
    }
  });

  app.get("/api/email-logs", requireAuth, requireFeatureAccess("settings.email_audit"), async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    const logs = await storage.getEmailLogs(Math.min(limit, 500));
    res.json(logs);
  });

  app.post(api.schedule.generate.path, requireFeatureAccess("schedule.generate"), async (req, res) => {
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
  app.post("/api/schedule/generate-ai", requireFeatureAccess("schedule.generate"), async (req, res) => {
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
  app.post("/api/schedule/clear", requireFeatureAccess("schedule.edit"), async (req, res) => {
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
  app.get(api.users.list.path, requireFeatureAccess("users.view"), async (req, res) => {
    const users = await storage.getUsers();
    res.json(users);
  });

  app.get(api.users.get.path, requireFeatureAccess("users.view"), async (req, res) => {
    const user = await storage.getUser(Number(req.params.id));
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  });

  app.post(api.users.create.path, requireFeatureAccess("users.edit_profile"), async (req, res) => {
    try {
      const sessionUser = (req.session as any)?.user;
      const input = api.users.create.input.parse(req.body) as Record<string, unknown>;
      const settingRole = input.role !== undefined && input.role !== null;
      const settingLocations = Array.isArray(input.locationIds) && (input.locationIds as unknown[]).length > 0;
      if (settingRole && !(await userHasFeature(sessionUser, "users.assign_roles"))) {
        return res.status(403).json({ message: "You don't have permission to assign user roles." });
      }
      if (settingLocations && !(await userHasFeature(sessionUser, "users.assign_locations"))) {
        return res.status(403).json({ message: "You don't have permission to assign locations to users." });
      }
      if (input.role) {
        const validRoles = await storage.getRoles();
        if (!validRoles.some(r => r.name === input.role)) {
          return res.status(400).json({ message: `Invalid role: ${input.role}` });
        }
      }
      const user = await storage.createUser(input as any);
      res.status(201).json(user);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // Field-level granular enforcement: build a whitelisted update from only the
  // fields the caller is actually allowed to change. Extra fields like
  // microsoftId / lastLoginAt are never settable through this endpoint.
  app.put(api.users.update.path, requireFeatureAccess("users.view"), async (req, res) => {
    try {
      const sessionUser = (req.session as any)?.user;
      const input = api.users.update.input.parse(req.body) as Record<string, unknown>;

      const existing = await storage.getUser(Number(req.params.id));
      if (!existing) return res.status(404).json({ message: "User not found" });

      const canEditProfile = await userHasFeature(sessionUser, "users.edit_profile");
      const canAssignRoles = await userHasFeature(sessionUser, "users.assign_roles");
      const canAssignLocations = await userHasFeature(sessionUser, "users.assign_locations");

      const arraysEqual = (a: unknown[] = [], b: unknown[] = []) =>
        a.length === b.length && a.every((v, i) => v === b[i]);

      // Detect which fields the caller actually wants to change (vs just
      // echoing current values). Ignore no-op changes so UIs that resend the
      // full object don't get spurious 403s.
      const wantsProfile = ["name", "email", "isActive"].some(
        k =>
          Object.prototype.hasOwnProperty.call(input, k) &&
          (input as any)[k] !== undefined &&
          (input as any)[k] !== (existing as any)[k]
      );
      const wantsRole =
        Object.prototype.hasOwnProperty.call(input, "role") &&
        input.role !== undefined &&
        input.role !== (existing as any).role;
      const wantsLocations =
        Object.prototype.hasOwnProperty.call(input, "locationIds") &&
        Array.isArray(input.locationIds) &&
        !arraysEqual(input.locationIds as unknown[], ((existing as any).locationIds as unknown[]) || []);

      if (wantsProfile && !canEditProfile) {
        return res.status(403).json({ message: "You don't have permission to edit user profiles." });
      }
      if (wantsRole && !canAssignRoles) {
        return res.status(403).json({ message: "You don't have permission to change user roles." });
      }
      if (wantsLocations && !canAssignLocations) {
        return res.status(403).json({ message: "You don't have permission to change store assignments." });
      }
      if (!wantsProfile && !wantsRole && !wantsLocations) {
        return res.json(existing);
      }

      if (wantsRole) {
        const validRoles = await storage.getRoles();
        if (!validRoles.some(r => r.name === input.role)) {
          return res.status(400).json({ message: `Invalid role: ${input.role}` });
        }
      }

      const patch: Record<string, unknown> = {};
      if (wantsProfile) {
        for (const k of ["name", "email", "isActive"]) {
          if (Object.prototype.hasOwnProperty.call(input, k)) patch[k] = (input as any)[k];
        }
      }
      if (wantsRole) patch.role = input.role;
      if (wantsLocations) patch.locationIds = input.locationIds;

      const user = await storage.updateUser(Number(req.params.id), patch as any);
      res.json(user);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      return res.status(404).json({ message: "User not found" });
    }
  });

  app.delete(api.users.delete.path, requireFeatureAccess("users.delete"), async (req, res) => {
    await storage.deleteUser(Number(req.params.id));
    res.status(204).send();
  });

  // === Retail Job Codes ===
  app.get("/api/retail-job-codes", requireAuth, (req, res) => {
    res.json(RETAIL_JOB_CODES);
  });

  // === Locations ===
  // List locations is accessible by authenticated users (managers need it for scheduling)
  app.get(api.locations.list.path, requireAuth, async (req, res) => {
    const locations = await storage.getLocations();
    res.json(locations);
  });

  // Get single location requires admin
  app.get(api.locations.get.path, requireFeatureAccess("locations.view"), async (req, res) => {
    const location = await storage.getLocation(Number(req.params.id));
    if (!location) return res.status(404).json({ message: "Location not found" });
    res.json(location);
  });

  app.post(api.locations.create.path, requireFeatureAccess("locations.edit"), async (req, res) => {
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
        // Managers cannot change Order Form catalog fields
        if (input.availableForOrderForm !== undefined || input.formOnly !== undefined || input.orderFormName !== undefined) {
          return res.status(403).json({ message: "Only admins can change Order Form settings for a location" });
        }
        // Managers cannot toggle a location off for scheduling
        if (input.availableForScheduling !== undefined) {
          return res.status(403).json({ message: "Only admins can change scheduling availability for a location" });
        }
        // Warehouse routing affects on-hand calculations across all warehouses;
        // restrict to admins only.
        if (input.warehouseAssignment !== undefined) {
          return res.status(403).json({ message: "Only admins can change warehouse assignment for a location" });
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

  app.delete(api.locations.delete.path, requireFeatureAccess("locations.edit"), async (req, res) => {
    await storage.deleteLocation(Number(req.params.id));
    res.status(204).send();
  });

  // === Shift Presets ===
  // Managers need read access to use quick shifts when adding shifts
  app.get(api.shiftPresets.list.path, requireFeatureAccess("schedule.templates"), async (req, res) => {
    const presets = await storage.getShiftPresets();
    res.json(presets);
  });

  app.get(api.shiftPresets.get.path, requireFeatureAccess("schedule.templates"), async (req, res) => {
    const preset = await storage.getShiftPreset(Number(req.params.id));
    if (!preset) return res.status(404).json({ message: "Shift preset not found" });
    res.json(preset);
  });

  app.post(api.shiftPresets.create.path, requireFeatureAccess("schedule.templates"), async (req, res) => {
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

  app.put(api.shiftPresets.update.path, requireFeatureAccess("schedule.templates"), async (req, res) => {
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

  app.delete(api.shiftPresets.delete.path, requireFeatureAccess("schedule.templates"), async (req, res) => {
    await storage.deleteShiftPreset(Number(req.params.id));
    res.status(204).send();
  });

  // === Published Schedules ===
  app.get("/api/schedule/published/:weekStart", requireAuth, async (req, res) => {
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

      const { location } = req.body;

      (async () => {
        try {
          const weekStartDate = new Date(weekStart);
          const weekEndDate = new Date(weekStartDate);
          weekEndDate.setDate(weekEndDate.getDate() + 7);

          const allShifts = await storage.getShifts(weekStartDate, weekEndDate);
          const employees = await storage.getEmployees();

          let weekShifts = allShifts;
          if (location && location !== "all") {
            const locationEmpIds = new Set(employees.filter(e => e.location === location).map(e => e.id));
            weekShifts = allShifts.filter(s => locationEmpIds.has(s.employeeId));
          }

          const scheduledEmployeeIds = Array.from(new Set(weekShifts.map(s => s.employeeId)));

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
          console.log(`[Schedule Publish] Sent ${emailsSent} notification emails for week of ${weekStart} (${location || "all locations"})`);
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

  app.get("/api/weather/forecast", requireAuth, async (req, res) => {
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

  registerRosterRoutes(app);

  registerTaskAssignmentRoutes(app);

  registerOptimizationRoutes(app);

  registerOrderRoutes(app);
  registerTrailerManifestRoutes(app);
  registerWarehouseInventoryRoutes(app);
  registerCreditCardInspectionRoutes(app);
  registerDriverInspectionRoutes(app);

  // Public login info (no auth required) — tagline shown on login page
  app.get("/api/public/login-info", async (_req, res) => {
    try {
      const settings = await storage.getGlobalSettings();
      res.json({
        tagline: settings?.loginTagline || "Changing lives through the power of work.",
      });
    } catch {
      res.json({ tagline: "Changing lives through the power of work." });
    }
  });

  initOrdersTable().catch((err) => {
    console.error("[MySQL] Failed to initialize orders table:", err);
  });

  // === PERMISSIONS MANAGEMENT ===

  app.get("/api/permissions", requireFeatureAccess("settings.permissions"), async (_req, res) => {
    try {
      const perms = await getFeaturePermissions();
      const result = SYSTEM_FEATURES.map(f => ({
        feature: f.feature,
        label: f.label,
        description: f.description,
        category: (f as any).category,
        allowedRoles: perms[f.feature] || DEFAULT_FEATURE_PERMISSIONS[f.feature] || [],
      }));
      res.json(result);
    } catch (err) {
      console.error("[Permissions] Error fetching:", err);
      res.status(500).json({ message: "Failed to fetch permissions" });
    }
  });

  app.put("/api/permissions", requireFeatureAccess("settings.permissions"), async (req, res) => {
    try {
      const allRoles = await storage.getRoles();
      const validRoleNames = new Set(allRoles.map(r => r.name));
      const schema = z.array(z.object({
        feature: z.string(),
        allowedRoles: z.array(z.string()),
      }));
      const updates = schema.parse(req.body);
      const validFeatures = SYSTEM_FEATURES.map(f => f.feature);
      const legacyKeysToRetire = new Set<string>();

      for (const update of updates) {
        if (!validFeatures.includes(update.feature)) continue;
        const featureInfo = SYSTEM_FEATURES.find(f => f.feature === update.feature);
        if (!featureInfo) continue;

        const filteredRoles = update.allowedRoles.filter(r => validRoleNames.has(r));
        const rolesWithAdmin = filteredRoles.includes("admin")
          ? filteredRoles
          : ["admin", ...filteredRoles];

        await db.insert(featurePermissions)
          .values({
            feature: update.feature,
            label: featureInfo.label,
            description: featureInfo.description,
            allowedRoles: rolesWithAdmin,
          })
          .onConflictDoUpdate({
            target: featurePermissions.feature,
            set: { allowedRoles: rolesWithAdmin },
          });

        // If this granular feature is a child of a legacy lumped key, mark
        // that legacy row for retirement so it can no longer override the
        // admin's explicit granular settings on the next read.
        for (const [legacy, children] of Object.entries(LEGACY_FEATURE_EXPANSIONS)) {
          if (children.includes(update.feature)) {
            legacyKeysToRetire.add(legacy);
          }
        }
      }

      if (legacyKeysToRetire.size > 0) {
        // Materialize each legacy row's allowedRoles onto every granular child
        // that wasn't part of this update batch and doesn't already have its
        // own row, so existing implicit grants are preserved.
        const updatedFeatures = new Set(updates.map(u => u.feature));
        const existingRows = await db.select().from(featurePermissions);
        const existingByFeature = new Map(existingRows.map(r => [r.feature, r.allowedRoles]));

        for (const legacy of legacyKeysToRetire) {
          const legacyRoles = existingByFeature.get(legacy);
          if (!legacyRoles) continue;
          const children = LEGACY_FEATURE_EXPANSIONS[legacy] || [];
          for (const child of children) {
            if (updatedFeatures.has(child)) continue;
            if (existingByFeature.has(child)) continue;
            const childInfo = SYSTEM_FEATURES.find(f => f.feature === child);
            if (!childInfo) continue;
            const filtered = legacyRoles.filter(r => validRoleNames.has(r));
            const withAdmin = filtered.includes("admin") ? filtered : ["admin", ...filtered];
            await db.insert(featurePermissions)
              .values({
                feature: child,
                label: childInfo.label,
                description: childInfo.description,
                allowedRoles: withAdmin,
              })
              .onConflictDoNothing({ target: featurePermissions.feature });
          }
        }

        await db.delete(featurePermissions)
          .where(inArray(featurePermissions.feature, Array.from(legacyKeysToRetire)));
      }

      invalidatePermissionsCache();
      res.json({ message: "Permissions updated successfully" });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      console.error("[Permissions] Error updating:", err);
      res.status(500).json({ message: "Failed to update permissions" });
    }
  });

  // === ROLES MANAGEMENT ===

  app.get("/api/roles", requireAuth, async (_req, res) => {
    try {
      const allRoles = await storage.getRoles();
      res.json(allRoles);
    } catch (err) {
      console.error("[Roles] Error fetching:", err);
      res.status(500).json({ message: "Failed to fetch roles" });
    }
  });

  app.post("/api/roles", requireAdmin, async (req, res) => {
    try {
      const schema = z.object({
        name: z.string().regex(/^[a-z0-9_]+$/, "Name must use lowercase letters, numbers, and underscores only").min(2).max(40),
        label: z.string().min(1).max(80),
      });
      const input = schema.parse(req.body);
      const existing = await storage.getRoles();
      if (existing.some(r => r.name === input.name)) {
        return res.status(409).json({ message: "A role with that name already exists" });
      }
      const created = await storage.createRole({ name: input.name, label: input.label, isBuiltIn: false });
      res.status(201).json(created);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      console.error("[Roles] Error creating:", err);
      res.status(500).json({ message: "Failed to create role" });
    }
  });

  app.patch("/api/roles/:name", requireAdmin, async (req, res) => {
    try {
      const schema = z.object({ label: z.string().min(1).max(80) });
      const { label } = schema.parse(req.body);
      const existing = await storage.getRoles();
      const target = existing.find(r => r.name === req.params.name);
      if (!target) return res.status(404).json({ message: "Role not found" });
      const updated = await storage.updateRoleLabel(target.name, label.trim());
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      console.error("[Roles] Error updating:", err);
      res.status(500).json({ message: "Failed to update role" });
    }
  });

  // === MANAGER → DIRECT-REPORT ASSIGNMENTS ===

  app.get("/api/users/:id/direct-reports", requireAdmin, async (req, res) => {
    try {
      const userId = Number(req.params.id);
      if (!Number.isFinite(userId)) return res.status(400).json({ message: "Invalid user id" });
      const employeeIds = await storage.getDirectReportsForManager(userId);
      res.json({ employeeIds });
    } catch (err) {
      console.error("[DirectReports] Error fetching:", err);
      res.status(500).json({ message: "Failed to fetch direct reports" });
    }
  });

  app.put("/api/users/:id/direct-reports", requireAdmin, async (req, res) => {
    try {
      const userId = Number(req.params.id);
      if (!Number.isFinite(userId)) return res.status(400).json({ message: "Invalid user id" });

      const targetUser = await storage.getUser(userId);
      if (!targetUser) return res.status(404).json({ message: "User not found" });
      if (targetUser.role !== "manager" && targetUser.role !== "optimizer") {
        return res.status(400).json({ message: "Direct reports can only be assigned to manager or optimizer users" });
      }

      const schema = z.object({ employeeIds: z.array(z.number().int().positive()) });
      const { employeeIds } = schema.parse(req.body);

      const uniqueIds = Array.from(new Set(employeeIds));
      if (uniqueIds.length > 0) {
        const allEmployees = await storage.getEmployees();
        const validIds = new Set(allEmployees.map(e => e.id));
        const missing = uniqueIds.filter(id => !validIds.has(id));
        if (missing.length > 0) {
          return res.status(400).json({ message: `Unknown employee id(s): ${missing.join(", ")}` });
        }
      }

      await storage.setDirectReportsForManager(userId, uniqueIds);
      res.json({ message: "Direct reports updated", employeeIds: uniqueIds });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error("[DirectReports] Error updating:", err);
      res.status(500).json({ message: "Failed to update direct reports" });
    }
  });

  app.get("/api/direct-reports", requireAdmin, async (_req, res) => {
    try {
      const all = await storage.getAllDirectReportAssignments();
      res.json(all);
    } catch (err) {
      console.error("[DirectReports] Error fetching all:", err);
      res.status(500).json({ message: "Failed to fetch direct-report assignments" });
    }
  });

  // === PER-JOB-TITLE VISIBILITY ===

  // List of distinct job titles currently in use (any authenticated user can read).
  app.get("/api/job-titles", async (req, res) => {
    try {
      const user = (req.session as any)?.user;
      if (!user) return res.status(401).json({ message: "Authentication required" });
      const all = await storage.getEmployees();
      const set = new Set<string>();
      for (const e of all) {
        if (e.jobTitle && e.jobTitle.trim()) set.add(e.jobTitle.trim());
      }
      res.json(Array.from(set).sort((a, b) => a.localeCompare(b)));
    } catch (err) {
      console.error("[JobTitles] Error fetching:", err);
      res.status(500).json({ message: "Failed to fetch job titles" });
    }
  });

  app.get("/api/job-title-visibility", requireAdmin, async (_req, res) => {
    try {
      const map = await storage.getJobTitleVisibilityMap();
      res.json(map);
    } catch (err) {
      console.error("[JobTitleVisibility] Error fetching:", err);
      res.status(500).json({ message: "Failed to fetch job title visibility" });
    }
  });

  app.put("/api/job-title-visibility/:viewerJobTitle", requireAdmin, async (req, res) => {
    try {
      const viewerJobTitle = String(req.params.viewerJobTitle || "").trim();
      if (!viewerJobTitle) return res.status(400).json({ message: "Viewer job title required" });

      const schema = z.object({ visibleJobTitles: z.array(z.string().trim().min(1)) });
      const { visibleJobTitles } = schema.parse(req.body);

      await storage.setVisibleJobTitlesFor(viewerJobTitle, visibleJobTitles);
      const saved = await storage.getVisibleJobTitlesFor(viewerJobTitle);
      res.json({ message: "Visibility updated", viewerJobTitle, visibleJobTitles: saved });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error("[JobTitleVisibility] Error updating:", err);
      res.status(500).json({ message: "Failed to update job title visibility" });
    }
  });

  app.delete("/api/roles/:name", requireAdmin, async (req, res) => {
    try {
      const name = req.params.name;
      const existing = await storage.getRoles();
      const target = existing.find(r => r.name === name);
      if (!target) return res.status(404).json({ message: "Role not found" });
      if (target.isBuiltIn) return res.status(400).json({ message: "Built-in roles cannot be deleted" });

      // Check if any users have this role
      const allUsers = await storage.getUsers();
      const usersWithRole = allUsers.filter(u => u.role === name);
      if (usersWithRole.length > 0) {
        return res.status(400).json({
          message: `Cannot delete role: ${usersWithRole.length} user(s) currently have this role. Reassign them first.`,
        });
      }

      await storage.deleteRoleByName(name);

      // Also remove from feature_permissions
      const allPerms = await db.select().from(featurePermissions);
      for (const p of allPerms) {
        if (p.allowedRoles.includes(name)) {
          await db.update(featurePermissions)
            .set({ allowedRoles: p.allowedRoles.filter(r => r !== name) })
            .where(eq(featurePermissions.feature, p.feature));
        }
      }
      invalidatePermissionsCache();

      res.status(204).send();
    } catch (err) {
      console.error("[Roles] Error deleting:", err);
      res.status(500).json({ message: "Failed to delete role" });
    }
  });

  // === SEED DATA ===
  await storage.seedBuiltInRoles();
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

    console.log("Database seeded successfully!");
  }
}
