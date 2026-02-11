
import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { ukgClient } from "../ukg";
import { requireAuth, requireAdmin } from "../middleware";

export function registerUKGRoutes(app: Express) {
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

  app.get("/api/ukg/diagnostics", requireAdmin, async (req, res) => {
    const diagnostics = ukgClient.getDiagnostics();
    const employeeCount = await storage.getEmployeeCount();
    const timeClockCount = await storage.getTimeClockEntryCount();
    res.json({
      ...diagnostics,
      database: {
        employeeCount,
        timeClockEntryCount: timeClockCount,
      },
    });
  });

  app.post("/api/ukg/test-connection", requireAdmin, async (req, res) => {
    if (!ukgClient.isConfigured()) {
      return res.json({ success: false, message: "UKG is not configured" });
    }
    try {
      const startTime = Date.now();
      const employees = await ukgClient.getAllEmployees();
      const durationMs = Date.now() - startTime;
      const lastError = ukgClient.getLastError();
      if (lastError) {
        return res.json({ success: false, message: lastError, durationMs });
      }
      return res.json({ 
        success: true, 
        message: `Connection successful. Fetched ${employees.length} employees.`,
        employeeCount: employees.length,
        durationMs,
      });
    } catch (err) {
      return res.json({ 
        success: false, 
        message: err instanceof Error ? err.message : String(err) 
      });
    }
  });

  app.get("/api/ukg/credentials", requireAdmin, async (req, res) => {
    const settings = await storage.getGlobalSettings();
    res.json({
      ukgApiUrl: settings.ukgApiUrl || process.env.UKG_API_URL || "",
      ukgUsername: settings.ukgUsername || process.env.UKG_USERNAME || "",
      hasPassword: !!(settings.ukgPassword || process.env.UKG_PASSWORD),
    });
  });

  app.post("/api/ukg/credentials", requireAdmin, async (req, res) => {
    try {
      const { ukgApiUrl, ukgUsername, ukgPassword } = req.body;
      if (!ukgApiUrl || !ukgUsername) {
        return res.status(400).json({ message: "API URL and username are required" });
      }
      const settings = await storage.getGlobalSettings();
      const effectivePassword = ukgPassword || settings.ukgPassword || process.env.UKG_PASSWORD || "";
      if (!effectivePassword) {
        return res.status(400).json({ message: "Password is required" });
      }
      const updateData: any = { ukgApiUrl, ukgUsername };
      if (ukgPassword) {
        updateData.ukgPassword = ukgPassword;
      }
      await storage.updateGlobalSettings(updateData);
      ukgClient.updateCredentials(ukgApiUrl, ukgUsername, effectivePassword);
      res.json({ success: true, message: "UKG credentials updated successfully" });
    } catch (err) {
      console.error("Failed to update UKG credentials:", err);
      res.status(500).json({ message: "Failed to update credentials" });
    }
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
}
