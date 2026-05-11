import { ukgClient } from "./ukg";
import { storage } from "./storage";
import type { InsertTimeClockEntry, InsertTimeClockPunch } from "@shared/schema";

let employeeSyncInterval: NodeJS.Timeout | null = null;
let timeClockSyncInterval: NodeJS.Timeout | null = null;
let timeClockTodaySyncInterval: NodeJS.Timeout | null = null;

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
    const inactiveEmployees = ukgEmployees.filter(emp => !emp.isActive);
    console.log(`[Scheduler] Processing ${activeEmployees.length} active and ${inactiveEmployees.length} inactive employees`);
    
    let imported = 0;
    let updated = 0;
    let deactivated = 0;
    let errors = 0;

    const locationsSeen = new Set<string>();

    for (const ukgEmp of activeEmployees) {
      try {
        const appEmployee = ukgClient.convertToAppEmployee(ukgEmp);
        
        if (appEmployee.location && !locationsSeen.has(appEmployee.location)) {
          await storage.ensureLocationExists(appEmployee.location);
          locationsSeen.add(appEmployee.location);
        }
        
        const existingByUkgId = await storage.getEmployeeByUkgId(ukgEmp.employeeId);
        
        if (existingByUkgId) {
          // Do not overwrite location if UKG returned null/empty — this happens when
          // OrgLevel1 data is missing or partially loaded, and would erase manually
          // assigned store locations from the database.
          // Preserve maxWeeklyHours unless the employee's employment type changed
          // (e.g. part-time → full-time), in which case apply UKG's new default.
          const updateData = { ...appEmployee };
          if (!updateData.location) {
            delete updateData.location;
          }
          const employmentTypeChanged = updateData.employmentType &&
            existingByUkgId.employmentType &&
            updateData.employmentType !== existingByUkgId.employmentType;
          if (!employmentTypeChanged) {
            delete updateData.maxWeeklyHours;
          }
          await storage.updateEmployee(existingByUkgId.id, updateData);
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

    for (const ukgEmp of inactiveEmployees) {
      try {
        const existingByUkgId = await storage.getEmployeeByUkgId(ukgEmp.employeeId);
        if (existingByUkgId && existingByUkgId.isActive) {
          await storage.updateEmployee(existingByUkgId.id, { isActive: false });
          deactivated++;
        }
      } catch (err) {
        console.error("[Scheduler] Error deactivating employee:", err);
        errors++;
      }
    }
    
    console.log(`[Scheduler] Auto-discovered ${locationsSeen.size} unique locations`);

    console.log(`[Scheduler] UKG Sync complete: ${imported} imported, ${updated} updated, ${deactivated} deactivated, ${errors} errors`);
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

// Result returned by runTimeClockSync so callers (the scheduler AND now the
// admin "manual sync" route) can surface counts to the UI / logs.
export interface TimeClockSyncResult {
  success: boolean;
  fetched: number;
  processed: number;
  startDate: string;
  endDate: string;
  durationMs: number;
  error?: string;
  skippedDelete?: boolean;
}

// Shared core: fetch and upsert time clock data for the given date range.
export async function runTimeClockSync(startDate: string, endDate: string, label: string): Promise<TimeClockSyncResult> {
  console.log(`[Scheduler] Time clock sync (${label}): ${startDate} → ${endDate}`);
  const syncStart = Date.now();

  const timeClockData = await ukgClient.getTimeClockData(startDate, endDate);

  const apiError = ukgClient.getLastError();
  if (apiError) {
    console.error(`[Scheduler] UKG time clock API error (${label}):`, apiError);
    const durationMs = Date.now() - syncStart;
    ukgClient.addSyncResult({
      timestamp: new Date().toISOString(),
      type: "timeclock",
      success: false,
      error: apiError,
      durationMs,
    });
    return { success: false, fetched: 0, processed: 0, startDate, endDate, durationMs, error: apiError };
  }

  if (timeClockData.length === 0) {
    console.log(`[Scheduler] No time clock data for ${label}`);
    const durationMs = Date.now() - syncStart;
    ukgClient.addSyncResult({
      timestamp: new Date().toISOString(),
      type: "timeclock",
      success: true,
      timeRecordsFetched: 0,
      timeRecordsProcessed: 0,
      durationMs,
    });
    return { success: true, fetched: 0, processed: 0, startDate, endDate, durationMs };
  }

  console.log(`[Scheduler] Processing ${timeClockData.length} time clock entries (${label})...`);

  // Log all unique Status values seen — helps identify what values UKG uses for rescinded entries
  const statusValues = new Set(timeClockData.map(e => e.status));
  console.log(`[Scheduler] UKG Status values seen (${label}):`, [...statusValues].sort((a, b) => (a ?? -1) - (b ?? -1)));

  // Aggregate multiple punches for the same employee/date before storing
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
    ukgStatus: number | null;
  }>();

  for (const entry of timeClockData) {
    const key = `${entry.employeeId}-${entry.date}`;
    const existing = aggregatedMap.get(key);

    if (existing) {
      existing.regularHours += Math.round((entry.regularHours || 0) * 60);
      existing.overtimeHours += Math.round((entry.overtimeHours || 0) * 60);
      existing.totalHours += Math.round((entry.totalHours || 0) * 60);
      if (entry.clockIn && (!existing.clockIn || entry.clockIn < existing.clockIn)) {
        existing.clockIn = entry.clockIn;
      }
      if (entry.clockOut && (!existing.clockOut || entry.clockOut > existing.clockOut)) {
        existing.clockOut = entry.clockOut;
      }
      // Keep the lowest status value across punches for this day — lower values may indicate voided/cancelled
      if (entry.status !== null && (existing.ukgStatus === null || entry.status < existing.ukgStatus)) {
        existing.ukgStatus = entry.status;
      }
    } else {
      aggregatedMap.set(key, {
        ukgEmployeeId: entry.employeeId,
        workDate: entry.date,
        clockIn: entry.clockIn || null,
        clockOut: entry.clockOut || null,
        regularHours: Math.round((entry.regularHours || 0) * 60),
        overtimeHours: Math.round((entry.overtimeHours || 0) * 60),
        totalHours: Math.round((entry.totalHours || 0) * 60),
        locationId: entry.locationId || null,
        jobId: entry.jobId || null,
        paycodeId: entry.paycodeId || 0,
        ukgStatus: entry.status ?? null,
      });
    }
  }

  // Store individual punch records for variance report
  const rawPunches: InsertTimeClockPunch[] = timeClockData
    .filter(entry => entry.clockIn || entry.clockOut)
    .map(entry => ({
      ukgEmployeeId: entry.employeeId,
      workDate: entry.date,
      clockIn: entry.clockIn || null,
      clockOut: entry.clockOut || null,
      regularHours: Math.round((entry.regularHours || 0) * 60),
      overtimeHours: Math.round((entry.overtimeHours || 0) * 60),
      totalHours: Math.round((entry.totalHours || 0) * 60),
      locationId: entry.locationId || null,
      jobId: entry.jobId || null,
      paycodeId: entry.paycodeId || 0,
      ukgStatus: entry.status ?? null,
    }));

  const incomingPaycodeIds = [...new Set(timeClockData.map(e => e.paycodeId || 0))];
  console.log(`[Scheduler] Paycode IDs in incoming data (${label}):`, incomingPaycodeIds);

  const entries: InsertTimeClockEntry[] = Array.from(aggregatedMap.values());
  console.log(`[Scheduler] Aggregated to ${entries.length} unique employee/date combinations (${label})`);

  // NOTE: We intentionally do NOT delete time_clock_entries by date range.
  // The table has a UNIQUE INDEX on (ukg_employee_id, work_date) and the
  // upsert below uses onConflictDoUpdate against that key, so existing rows
  // for the same (employee, date) are correctly replaced. A range-based
  // delete would destroy any (employee, date) row that UKG transiently
  // omits from its paginated response — for example a terminated employee's
  // historical punch — which previously caused total time-clock counts to
  // drift downward by thousands of rows per sync.
  //
  // For time_clock_punches we DO need to delete — that table has no unique
  // key and individual punches need replacement when UKG revises a day's
  // punches — but we now scope the delete to ONLY the (employee, date)
  // pairs actually present in the new batch, never the full date range.
  //
  // Important: derive keys from the aggregated employee/date set, not from
  // rawPunches. If UKG now reports a day for an employee with NO punches
  // (e.g. a paycode correction that removed clock punches, or a PTO-only
  // day), we still need to clear that day's stale punches — but rawPunches
  // alone wouldn't include the key.
  const incomingPunchKeys = Array.from(aggregatedMap.values()).map(e => ({
    ukgEmployeeId: e.ukgEmployeeId,
    workDate: e.workDate,
  }));

  if (incomingPunchKeys.length > 0) {
    const deletedPunches = await storage.deleteTimeClockPunchesByKeys(incomingPunchKeys);
    console.log(`[Scheduler] Replaced punches for ${incomingPunchKeys.length} employee/date pairs (deleted ${deletedPunches} stale rows) (${label})`);
  }
  if (rawPunches.length > 0) {
    const punchCount = await storage.insertTimeClockPunches(rawPunches);
    console.log(`[Scheduler] Stored ${punchCount} individual punch records (${label})`);
  }

  const upserted = await storage.upsertTimeClockEntries(entries);
  console.log(`[Scheduler] Time clock sync complete (${label}): ${upserted} entries upserted (existing rows for absent employee/dates preserved)`);
  const durationMs = Date.now() - syncStart;
  ukgClient.addSyncResult({
    timestamp: new Date().toISOString(),
    type: "timeclock",
    success: true,
    timeRecordsFetched: timeClockData.length,
    timeRecordsProcessed: upserted,
    durationMs,
  });
  return {
    success: true,
    fetched: timeClockData.length,
    processed: upserted,
    startDate,
    endDate,
    durationMs,
    skippedDelete: false,
  };
}

// Daily sync: 30-day lookback + 60 days future (catches retroactive edits)
async function syncTimeClockFromUKG(): Promise<void> {
  if (!ukgClient.isConfigured()) {
    console.log("[Scheduler] UKG not configured, skipping time clock sync");
    return;
  }

  try {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 60);
    const endDate = futureDate.toISOString().split("T")[0];

    const lastSyncDate = await storage.getLastTimeClockSyncDate();
    let startDate: string;
    if (!lastSyncDate) {
      startDate = TIME_CLOCK_START_DATE;
    } else {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      startDate = thirtyDaysAgo.toISOString().split("T")[0];
    }

    await runTimeClockSync(startDate, endDate, "30-day lookback");
  } catch (err) {
    console.error("[Scheduler] Failed to sync time clock data:", err);
    ukgClient.addSyncResult({
      timestamp: new Date().toISOString(),
      type: "timeclock",
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: 0,
    });
  }
}

// Hourly sync: today only (keeps current-day punches up to the minute)
async function syncTodayTimeClockFromUKG(): Promise<void> {
  if (!ukgClient.isConfigured()) return;

  try {
    const today = new Date().toISOString().split("T")[0];
    await runTimeClockSync(today, today, "today");
  } catch (err) {
    console.error("[Scheduler] Failed to sync today's time clock data:", err);
  }
}

export function startDailySync(): void {
  if (employeeSyncInterval) {
    console.log("[Scheduler] Daily sync already running");
    return;
  }

  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

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

  // Schedule full time clock sync every 24 hours (30-day lookback)
  timeClockSyncInterval = setInterval(() => {
    syncTimeClockFromUKG().catch(err => {
      console.error("[Scheduler] Scheduled time clock sync failed:", err);
    });
  }, TWENTY_FOUR_HOURS);

  // Schedule today-only time clock sync every hour
  const ONE_HOUR = 60 * 60 * 1000;
  timeClockTodaySyncInterval = setInterval(() => {
    syncTodayTimeClockFromUKG().catch(err => {
      console.error("[Scheduler] Hourly today sync failed:", err);
    });
  }, ONE_HOUR);

  console.log("[Scheduler] Employee sync scheduled: every 24 hours.");
  console.log("[Scheduler] Time clock sync scheduled: 30-day lookback every 24 hours + today-only every 1 hour.");
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
  if (timeClockTodaySyncInterval) {
    clearInterval(timeClockTodaySyncInterval);
    timeClockTodaySyncInterval = null;
    console.log("[Scheduler] Today time clock sync stopped");
  }
}

export async function runManualSync(): Promise<void> {
  await syncEmployeesFromUKG();
}

export async function runManualTimeClockSync(): Promise<void> {
  await syncTimeClockFromUKG();
}
