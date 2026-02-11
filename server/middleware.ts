
import type { Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { sendOccurrenceAlertEmail, type OccurrenceAlertEmailData } from "./outlook";

export const TIMEZONE = "America/New_York";

export async function getNotificationEmails(employee: { email: string; alternateEmail?: string | null }): Promise<string[]> {
  const emails = new Set<string>();
  const user = await storage.getUserByEmail(employee.email);
  if (user?.email) emails.add(user.email.toLowerCase());
  if (employee.alternateEmail) emails.add(employee.alternateEmail.toLowerCase());
  if (emails.size === 0 && employee.email) emails.add(employee.email.toLowerCase());
  return Array.from(emails);
}

// Create a date with specific time in EST timezone
export function createESTTime(baseDate: Date, hours: number, minutes: number = 0): Date {
  const zonedDate = toZonedTime(baseDate, TIMEZONE);
  zonedDate.setHours(hours, minutes, 0, 0);
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

// Middleware to require manager or admin role
export function requireManager(req: Request, res: Response, next: NextFunction) {
  const user = (req.session as any)?.user;
  if (!user || (user.role !== "admin" && user.role !== "manager")) {
    return res.status(403).json({ message: "Manager access required" });
  }
  next();
}

// Helper function to check if HR notification should be sent for occurrence thresholds
// Sends emails to managers assigned to the employee's store location
// addedOccurrenceValue: the value of the occurrence just added (used to detect crossing vs already over)
export async function checkAndSendHRNotification(
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
