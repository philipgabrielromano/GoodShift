import { ukgClient } from "./ukg";
import { storage } from "./storage";
import type { InsertTimeClockEntry } from "@shared/schema";

let employeeSyncInterval: NodeJS.Timeout | null = null;
let timeClockSyncInterval: NodeJS.Timeout | null = null;

// Initial date to start syncing time clock data from
const TIME_CLOCK_START_DATE = "2026-01-01";

async function syncEmployeesFromUKG(): Promise<void> {
  console.log("[Scheduler] Starting daily UKG employee sync...");
  const syncStart = Date.now();
  
  if (!ukgClient.isConfigured()) {
    console.log("[Scheduler] UKG not configured, skipping sync");
    return;
  }

  try {
    ukgClient.clearCache();
    const ukgEmployees = await ukgClient.getAllEmployees();
    
    const apiError = ukgClient.getLastError();
    if (apiError) {
      console.error("[Scheduler] UKG API error:", apiError);
      ukgClient.addSyncResult({
        timestamp: new Date().toISOString(),
        type: "employee",
        success: false,
        error: apiError,
        durationMs: Date.now() - syncStart,
      });
      return;
    }

    const activeEmployees = ukgEmployees.filter(emp => emp.isActive);
    console.log(`[Scheduler] Processing ${activeEmployees.length} active employees (skipping ${ukgEmployees.length - activeEmployees.length} terminated)`);
    
    let imported = 0;
    let updated = 0;
    let errors = 0;

    // Track unique locations to auto-create
    const locationsSeen = new Set<string>();

    for (const ukgEmp of activeEmployees) {
      try {
        const appEmployee = ukgClient.convertToAppEmployee(ukgEmp);
        
        // Auto-create location if employee has one
        if (appEmployee.location && !locationsSeen.has(appEmployee.location)) {
          await storage.ensureLocationExists(appEmployee.location);
          locationsSeen.add(appEmployee.location);
        }
        
        // Use employeeId (EmpId string like "000950588-Q2VBU") for matching, not ukgId
        const existingByUkgId = await storage.getEmployeeByUkgId(ukgEmp.employeeId);
        
        if (existingByUkgId) {
          await storage.updateEmployee(existingByUkgId.id, appEmployee);
          updated++;
        } else {
          await storage.createEmployee(appEmployee);
          imported++;
        }
      } catch (err) {
        console.error("[Scheduler] Error syncing employee:", err);
        errors++;
      }
    }
    
    console.log(`[Scheduler] Auto-discovered ${locationsSeen.size} unique locations`);

    console.log(`[Scheduler] UKG Sync complete: ${imported} imported, ${updated} updated, ${errors} errors`);
    ukgClient.addSyncResult({
      timestamp: new Date().toISOString(),
      type: "employee",
      success: true,
      employeesFetched: ukgEmployees.length,
      employeesProcessed: imported + updated,
      durationMs: Date.now() - syncStart,
    });
  } catch (err) {
    console.error("[Scheduler] Failed to sync from UKG:", err);
    ukgClient.addSyncResult({
      timestamp: new Date().toISOString(),
      type: "employee",
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - syncStart,
    });
  }
}

async function syncTimeClockFromUKG(): Promise<void> {
  console.log("[Scheduler] Starting time clock sync from UKG...");
  const syncStart = Date.now();
  
  if (!ukgClient.isConfigured()) {
    console.log("[Scheduler] UKG not configured, skipping time clock sync");
    return;
  }

  try {
    // Get today's date in YYYY-MM-DD format
    const today = new Date();
    
    // Fetch up to 60 days in the future to capture PAL/time off entries that are scheduled ahead
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 60);
    const endDate = futureDate.toISOString().split("T")[0];
    
    // Start from 2026-01-01 for initial sync, or from today if already synced
    // For regular syncs, just fetch last 7 days to catch any updates
    const lastSyncDate = await storage.getLastTimeClockSyncDate();
    
    let startDate: string;
    if (!lastSyncDate) {
      // First sync - get all historical data from beginning of 2026
      startDate = TIME_CLOCK_START_DATE;
      console.log(`[Scheduler] First time clock sync - fetching from ${startDate} to ${endDate} (including 60 days future)`);
    } else {
      // Subsequent syncs - fetch last 7 days plus 60 days ahead to catch PAL/time off updates
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      startDate = sevenDaysAgo.toISOString().split("T")[0];
      console.log(`[Scheduler] Incremental time clock sync - fetching from ${startDate} to ${endDate}`);
    }

    // Fetch time clock data from UKG
    const timeClockData = await ukgClient.getTimeClockData(startDate, endDate);
    
    const apiError = ukgClient.getLastError();
    if (apiError) {
      console.error("[Scheduler] UKG time clock API error:", apiError);
      ukgClient.addSyncResult({
        timestamp: new Date().toISOString(),
        type: "timeclock",
        success: false,
        error: apiError,
        durationMs: Date.now() - syncStart,
      });
      return;
    }

    if (timeClockData.length === 0) {
      console.log("[Scheduler] No time clock data to sync");
      ukgClient.addSyncResult({
        timestamp: new Date().toISOString(),
        type: "timeclock",
        success: true,
        timeRecordsFetched: 0,
        timeRecordsProcessed: 0,
        durationMs: Date.now() - syncStart,
      });
      return;
    }

    console.log(`[Scheduler] Processing ${timeClockData.length} time clock entries...`);

    // Aggregate multiple punches for the same employee/date before storing
    // UKG returns separate entries for each punch (e.g., clock in, lunch out, lunch in, clock out)
    // We need to sum the hours for each employee/date combination
    const aggregatedMap = new Map<string, {
      ukgEmployeeId: string;
      workDate: string;
      clockIn: string | null;
      clockOut: string | null;
      regularHours: number;
      overtimeHours: number;
      totalHours: number;
      locationId: number | null;
      jobId: number | null;
      paycodeId: number;
    }>();

    for (const entry of timeClockData) {
      const key = `${entry.employeeId}-${entry.date}`;
      const existing = aggregatedMap.get(key);
      
      if (existing) {
        // Add hours to existing entry
        existing.regularHours += Math.round((entry.regularHours || 0) * 60);
        existing.overtimeHours += Math.round((entry.overtimeHours || 0) * 60);
        existing.totalHours += Math.round((entry.totalHours || 0) * 60);
        // Keep the earliest clock-in and latest clock-out
        if (entry.clockIn && (!existing.clockIn || entry.clockIn < existing.clockIn)) {
          existing.clockIn = entry.clockIn;
        }
        if (entry.clockOut && (!existing.clockOut || entry.clockOut > existing.clockOut)) {
          existing.clockOut = entry.clockOut;
        }
      } else {
        // First entry for this employee/date
        aggregatedMap.set(key, {
          ukgEmployeeId: entry.employeeId,
          workDate: entry.date,
          clockIn: entry.clockIn || null,
          clockOut: entry.clockOut || null,
          regularHours: Math.round((entry.regularHours || 0) * 60), // Convert hours to minutes
          overtimeHours: Math.round((entry.overtimeHours || 0) * 60),
          totalHours: Math.round((entry.totalHours || 0) * 60),
          locationId: entry.locationId || null,
          jobId: entry.jobId || null,
          paycodeId: entry.paycodeId || 0, // 2 = PAL (Paid Annual Leave), 4 = Unpaid Time Off
        });
      }
    }

    // Convert aggregated map to array for storage
    const entries: InsertTimeClockEntry[] = Array.from(aggregatedMap.values());
    console.log(`[Scheduler] Aggregated to ${entries.length} unique employee/date combinations`);

    const upserted = await storage.upsertTimeClockEntries(entries);
    console.log(`[Scheduler] Time clock sync complete: ${upserted} entries processed`);
    ukgClient.addSyncResult({
      timestamp: new Date().toISOString(),
      type: "timeclock",
      success: true,
      timeRecordsFetched: timeClockData.length,
      timeRecordsProcessed: upserted,
      durationMs: Date.now() - syncStart,
    });
  } catch (err) {
    console.error("[Scheduler] Failed to sync time clock data:", err);
    ukgClient.addSyncResult({
      timestamp: new Date().toISOString(),
      type: "timeclock",
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - syncStart,
    });
  }
}

export function startDailySync(): void {
  if (employeeSyncInterval) {
    console.log("[Scheduler] Daily sync already running");
    return;
  }

  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  const FOUR_HOURS = 4 * 60 * 60 * 1000;

  console.log("[Scheduler] Starting daily UKG sync scheduler");
  
  // Run initial employee sync after 5 seconds
  setTimeout(() => {
    console.log("[Scheduler] Running initial startup sync...");
    syncEmployeesFromUKG().catch(err => {
      console.error("[Scheduler] Initial employee sync failed:", err);
    });
  }, 5000);

  // Run initial time clock sync after 10 seconds (give employee sync time to complete)
  setTimeout(() => {
    console.log("[Scheduler] Running initial time clock sync...");
    syncTimeClockFromUKG().catch(err => {
      console.error("[Scheduler] Initial time clock sync failed:", err);
    });
  }, 10000);

  // Schedule employee sync every 24 hours
  employeeSyncInterval = setInterval(() => {
    syncEmployeesFromUKG().catch(err => {
      console.error("[Scheduler] Scheduled employee sync failed:", err);
    });
  }, TWENTY_FOUR_HOURS);

  // Schedule time clock sync every 4 hours
  timeClockSyncInterval = setInterval(() => {
    syncTimeClockFromUKG().catch(err => {
      console.error("[Scheduler] Scheduled time clock sync failed:", err);
    });
  }, FOUR_HOURS);

  console.log("[Scheduler] Daily sync scheduled. Initial sync in 5 seconds, then every 24 hours.");
  console.log("[Scheduler] Time clock sync scheduled. Initial sync in 10 seconds, then every 4 hours.");
}

export function stopDailySync(): void {
  if (employeeSyncInterval) {
    clearInterval(employeeSyncInterval);
    employeeSyncInterval = null;
    console.log("[Scheduler] Employee sync stopped");
  }
  if (timeClockSyncInterval) {
    clearInterval(timeClockSyncInterval);
    timeClockSyncInterval = null;
    console.log("[Scheduler] Time clock sync stopped");
  }
}

export async function runManualSync(): Promise<void> {
  await syncEmployeesFromUKG();
}

export async function runManualTimeClockSync(): Promise<void> {
  await syncTimeClockFromUKG();
}
