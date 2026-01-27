import { ukgClient } from "./ukg";
import { storage } from "./storage";
import type { InsertTimeClockEntry } from "@shared/schema";

let employeeSyncInterval: NodeJS.Timeout | null = null;
let timeClockSyncInterval: NodeJS.Timeout | null = null;

// Initial date to start syncing time clock data from
const TIME_CLOCK_START_DATE = "2026-01-01";

async function syncEmployeesFromUKG(): Promise<void> {
  console.log("[Scheduler] Starting daily UKG employee sync...");
  
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
        
        const existingByUkgId = await storage.getEmployeeByUkgId(String(ukgEmp.ukgId));
        
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
  } catch (err) {
    console.error("[Scheduler] Failed to sync from UKG:", err);
  }
}

async function syncTimeClockFromUKG(): Promise<void> {
  console.log("[Scheduler] Starting time clock sync from UKG...");
  
  if (!ukgClient.isConfigured()) {
    console.log("[Scheduler] UKG not configured, skipping time clock sync");
    return;
  }

  try {
    // Get today's date in YYYY-MM-DD format
    const today = new Date();
    const endDate = today.toISOString().split("T")[0];
    
    // Start from 2026-01-01 for initial sync, or from today if already synced
    // For regular syncs, just fetch last 7 days to catch any updates
    const lastSyncDate = await storage.getLastTimeClockSyncDate();
    
    let startDate: string;
    if (!lastSyncDate) {
      // First sync - get all historical data from beginning of 2026
      startDate = TIME_CLOCK_START_DATE;
      console.log(`[Scheduler] First time clock sync - fetching from ${startDate} to ${endDate}`);
    } else {
      // Subsequent syncs - fetch last 7 days to catch updates
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
      return;
    }

    if (timeClockData.length === 0) {
      console.log("[Scheduler] No time clock data to sync");
      return;
    }

    console.log(`[Scheduler] Processing ${timeClockData.length} time clock entries...`);

    // Convert to database entries (store hours as integer minutes for precision)
    const entries: InsertTimeClockEntry[] = timeClockData.map(entry => ({
      ukgEmployeeId: entry.employeeId,
      workDate: entry.date,
      clockIn: entry.clockIn || null,
      clockOut: entry.clockOut || null,
      regularHours: Math.round((entry.regularHours || 0) * 60), // Convert hours to minutes
      overtimeHours: Math.round((entry.overtimeHours || 0) * 60),
      totalHours: Math.round((entry.totalHours || 0) * 60),
      locationId: entry.locationId || null,
      jobId: entry.jobId || null,
    }));

    const upserted = await storage.upsertTimeClockEntries(entries);
    console.log(`[Scheduler] Time clock sync complete: ${upserted} entries processed`);
  } catch (err) {
    console.error("[Scheduler] Failed to sync time clock data:", err);
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
