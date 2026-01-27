import { ukgClient } from "./ukg";
import { storage } from "./storage";

let syncInterval: NodeJS.Timeout | null = null;

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

export function startDailySync(): void {
  if (syncInterval) {
    console.log("[Scheduler] Daily sync already running");
    return;
  }

  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

  console.log("[Scheduler] Starting daily UKG sync scheduler");
  
  setTimeout(() => {
    console.log("[Scheduler] Running initial startup sync...");
    syncEmployeesFromUKG().catch(err => {
      console.error("[Scheduler] Initial sync failed:", err);
    });
  }, 5000);

  syncInterval = setInterval(() => {
    syncEmployeesFromUKG().catch(err => {
      console.error("[Scheduler] Scheduled sync failed:", err);
    });
  }, TWENTY_FOUR_HOURS);

  console.log("[Scheduler] Daily sync scheduled. Initial sync in 5 seconds, then every 24 hours.");
}

export function stopDailySync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log("[Scheduler] Daily sync stopped");
  }
}

export async function runManualSync(): Promise<void> {
  await syncEmployeesFromUKG();
}
