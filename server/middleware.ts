
import type { Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { sendOccurrenceAlertEmail, type OccurrenceAlertEmailData } from "./outlook";
import { STORE_MANAGER_TITLES } from "./hierarchy";
import { getTallyWindow, computeNetTally, inWindow } from "./occurrenceTally";

export const TIMEZONE = "America/New_York";

export async function getNotificationEmails(employee: { email: string; alternateEmail?: string | null }): Promise<string[]> {
  const emails = new Set<string>();
  const user = await storage.getUserByEmail(employee.email);
  if (user?.lastLoginAt) {
    emails.add(user.email.toLowerCase());
  }
  if (employee.alternateEmail) {
    emails.add(employee.alternateEmail.toLowerCase());
  }
  return Array.from(emails);
}

// Create a date with specific time in EST timezone
export function createESTTime(baseDate: Date, hours: number, minutes: number = 0): Date {
  const zonedDate = toZonedTime(baseDate, TIMEZONE);
  zonedDate.setHours(hours, minutes, 0, 0);
  return fromZonedTime(zonedDate, TIMEZONE);
}

// Move a date forward by whole calendar days in EST timezone, keeping its
// wall-clock time. Unlike adding 24h multiples, this stays on the right day
// across DST transitions (a fall-back week has one 25-hour day).
export function addDaysInET(baseDate: Date, days: number): Date {
  const zonedDate = toZonedTime(baseDate, TIMEZONE);
  zonedDate.setDate(zonedDate.getDate() + days);
  return fromZonedTime(zonedDate, TIMEZONE);
}

// Middleware to require authentication (uses session user like rest of codebase)
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = (req.session as any)?.user;
  if (!user) {
    return res.status(401).json({ message: "Authentication required" });
  }
  next();
}

// Middleware to require admin role
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req.session as any)?.user;
  if (!user || user.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

// Middleware to require manager, optimizer, or admin role
export function requireManager(req: Request, res: Response, next: NextFunction) {
  const user = (req.session as any)?.user;
  if (!user || (user.role !== "admin" && user.role !== "manager" && user.role !== "optimizer")) {
    return res.status(403).json({ message: "Manager access required" });
  }
  next();
}

// Middleware to require optimizer or admin role
export function requireOptimizer(req: Request, res: Response, next: NextFunction) {
  const user = (req.session as any)?.user;
  if (!user || (user.role !== "admin" && user.role !== "optimizer")) {
    return res.status(403).json({ message: "Optimizer access required" });
  }
  next();
}

// Dynamic feature-based permission middleware
// Checks the feature_permissions table to see if the user's role has access
import { db } from "./db";
import { featurePermissions, DEFAULT_FEATURE_PERMISSIONS, LEGACY_FEATURE_EXPANSIONS } from "@shared/schema";
import { eq } from "drizzle-orm";

let permissionsCache: Record<string, string[]> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30_000;

export async function getFeaturePermissions(): Promise<Record<string, string[]>> {
  const now = Date.now();
  if (permissionsCache && now - cacheTimestamp < CACHE_TTL) {
    return permissionsCache;
  }
  try {
    const rows = await db.select().from(featurePermissions);
    const perms: Record<string, string[]> = {};
    for (const row of rows) {
      perms[row.feature] = row.allowedRoles;
    }
    for (const [feature, roles] of Object.entries(DEFAULT_FEATURE_PERMISSIONS)) {
      if (!perms[feature]) {
        perms[feature] = roles;
      }
    }
    // Legacy expansion: if a DB row exists for an old lumped feature key,
    // union those roles into each granular child key so existing admin
    // customizations continue to apply until they're re-saved with new keys.
    for (const [legacy, children] of Object.entries(LEGACY_FEATURE_EXPANSIONS)) {
      const legacyRoles = perms[legacy];
      if (!legacyRoles) continue;
      for (const child of children) {
        const merged = new Set(perms[child] ?? []);
        for (const r of legacyRoles) merged.add(r);
        perms[child] = Array.from(merged);
      }
    }
    permissionsCache = perms;
    cacheTimestamp = now;
    return perms;
  } catch (err) {
    // Never fall back to the code defaults: they would restore grants an
    // admin removed. Use the last good read if there is one, else fail.
    if (permissionsCache) {
      console.error("[Permissions] Read failed; using last cached permissions:", err);
      return permissionsCache;
    }
    console.error("[Permissions] Read failed and nothing is cached:", err);
    throw new PermissionsUnavailableError();
  }
}

export class PermissionsUnavailableError extends Error {
  constructor() {
    super("Permissions are temporarily unavailable");
    this.name = "PermissionsUnavailableError";
  }
}

async function getFeaturePermissionsOr503(res: Response): Promise<Record<string, string[]> | null> {
  try {
    return await getFeaturePermissions();
  } catch {
    res.status(503).json({ message: "Permissions are temporarily unavailable. Please try again." });
    return null;
  }
}

// Programmatic access check (no Express middleware). Use in route handlers
// that need to gate part of a request (e.g. only validate a specific field).
export async function userHasFeature(user: { role?: string } | undefined | null, feature: string): Promise<boolean> {
  if (!user || !user.role) return false;
  if (user.role === "admin") return true;
  const perms = await getFeaturePermissions();
  const allowed = perms[feature] || [];
  return allowed.includes(user.role);
}

export function invalidatePermissionsCache() {
  permissionsCache = null;
  cacheTimestamp = 0;
}

export function requireFeatureAccess(feature: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req.session as any)?.user;
    if (!user) {
      return res.status(401).json({ message: "Authentication required" });
    }
    if (user.role === "admin") {
      return next();
    }
    const perms = await getFeaturePermissionsOr503(res);
    if (!perms) return;
    const allowedRoles = perms[feature] || [];
    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }
    next();
  };
}

// Allow access if the user has ANY of the listed features. Useful for shared
// read endpoints (e.g. fleet lookups consumed by both fleet managers and
// drivers filling out an inspection).
export function requireFeatureAccessAny(features: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req.session as any)?.user;
    if (!user) {
      return res.status(401).json({ message: "Authentication required" });
    }
    if (user.role === "admin") {
      return next();
    }
    const perms = await getFeaturePermissionsOr503(res);
    if (!perms) return;
    for (const f of features) {
      const allowedRoles = perms[f] || [];
      if (allowedRoles.includes(user.role)) {
        return next();
      }
    }
    return res.status(403).json({ message: "Access denied" });
  };
}

// Helper function to check if HR notification should be sent for occurrence thresholds
// Sends emails to managers assigned to the employee's store location
// addedOccurrenceValue: how much the change raised the tally (×100) — an
// occurrence's value, or minus the value of a retracted adjustment.
export async function checkAndSendHRNotification(
  employeeId: number, 
  addedOccurrenceValue: number,
  appUrl: string,
  addedOccurrenceDate?: string,
): Promise<void> {
  try {
    const employee = await storage.getEmployee(employeeId);
    if (!employee) {
      return;
    }

    // Current tally — same window and formula as the employee page, alerts
    // and occurrence report (server/occurrenceTally.ts).
    const tallyWindow = getTallyWindow();
    const occurrences = await storage.getOccurrences(employeeId, tallyWindow.startDate, tallyWindow.endDate);
    const adjustments = await storage.getOccurrenceAdjustments(employeeId, tallyWindow.startDate, tallyWindow.endDate);
    const correctiveActions = await storage.getCorrectiveActions(employeeId);
    const { totalPoints, adjustmentTotal, netTally } = computeNetTally(occurrences, adjustments, tallyWindow);

    // The tally BEFORE this change, from the same data with the change taken
    // out (before the floor at 0 is applied). A backdated or future-dated
    // change outside the window didn't move the tally, so it can't have
    // crossed a threshold.
    const addedCounts = !addedOccurrenceDate || inWindow(addedOccurrenceDate, tallyWindow);
    const addedPoints = addedCounts ? addedOccurrenceValue / 100 : 0;
    const previousTally = Math.max(0, totalPoints + adjustmentTotal - addedPoints);

    // Helper to check if threshold was JUST crossed (not already over)
    const justCrossedThreshold = (thresholdValue: number): boolean => {
      return previousTally < thresholdValue && netTally >= thresholdValue;
    };

    // The highest threshold just crossed whose corrective action isn't on
    // record yet (crossing 8 with a termination already recorded still
    // reports a missing final warning at 7).
    const requiredAction = { 8: "termination", 7: "final_warning", 5: "warning" } as const;
    let threshold: 5 | 7 | 8 | null = null;
    for (const t of [8, 7, 5] as const) {
      if (justCrossedThreshold(t) && !correctiveActions.some(a => a.actionType === requiredAction[t])) {
        threshold = t;
        break;
      }
    }

    if (threshold) {
      console.log(`[HR Notification] Employee ${employee.name} crossed ${threshold}-point threshold (${previousTally.toFixed(1)} -> ${netTally.toFixed(1)})`);
      
      const recipientEmails = new Set<string>();
      
      const settings = await storage.getGlobalSettings();
      if (settings?.hrNotificationEmail) {
        const emails = settings.hrNotificationEmail.split(',').map(e => e.trim().toLowerCase()).filter(e => e);
        emails.forEach(e => recipientEmails.add(e));
        console.log(`[HR Notification] Including HR email(s): ${emails.join(', ')}`);
      }
      
      // Find the Store Manager for this employee's store location.
      // Title list comes from the shared hierarchy module (single source of truth).
      if (employee.location) {
        const allEmployees = await storage.getEmployees();
        const storeManagerEmployees = allEmployees.filter(emp =>
          emp.isActive &&
          emp.location === employee.location &&
          STORE_MANAGER_TITLES.includes(emp.jobTitle || '')
        );

        for (const mgrEmp of storeManagerEmployees) {
          if (mgrEmp.email) {
            const mgrUser = await storage.getUserByEmail(mgrEmp.email);
            if (mgrUser?.email) {
              recipientEmails.add(mgrUser.email.toLowerCase());
            }
          }
        }

        console.log(`[HR Notification] Found ${storeManagerEmployees.length} Store Manager(s) for location "${employee.location}": ${storeManagerEmployees.map(m => m.name).join(', ') || 'none'}`);
      }
      
      const managerEmails = Array.from(recipientEmails);
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
