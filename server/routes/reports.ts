import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { requireAuth, requireManager, TIMEZONE } from "../middleware";

// Helper to resolve user's locationIds (numeric IDs) to location names
async function getAllowedLocationNames(user: any): Promise<Set<string> | null> {
  if (user.role === "admin") return null; // admins see all
  if (!user.locationIds || user.locationIds.length === 0) return null;
  const allLocations = await storage.getLocations();
  const idSet = new Set(user.locationIds.map((id: any) => String(id)));
  const names = new Set<string>();
  for (const loc of allLocations) {
    if (idSet.has(String(loc.id))) names.add(loc.name);
  }
  return names.size > 0 ? names : null;
}

export function registerReportRoutes(app: Express) {

  // ========== REPORT LOCATIONS ==========
  // Returns only locations that have active employees (for report filter dropdowns)
  app.get("/api/reports/locations", requireAuth, requireManager, async (req: Request, res: Response) => {
    try {
      const user = (req.session as any)?.user;
      const allEmployees = await storage.getEmployees();
      const activeEmployees = allEmployees.filter(e => e.isActive);

      const locationSet = new Set<string>();
      for (const emp of activeEmployees) {
        if (emp.location) locationSet.add(emp.location);
      }

      let locationNames = Array.from(locationSet).sort();

      const allowedNames = await getAllowedLocationNames(user);
      if (allowedNames) {
        locationNames = locationNames.filter(loc => allowedNames.has(loc));
      }

      res.json(locationNames);
    } catch (err) {
      console.error("Error fetching report locations:", err);
      res.status(500).json({ error: "Failed to fetch report locations" });
    }
  });

  // ========== OCCURRENCE REPORT ==========
  // Returns employees with their total occurrence points for a location
  app.get("/api/reports/occurrences", requireAuth, requireManager, async (req: Request, res: Response) => {
    try {
      const locationFilter = req.query.location as string | undefined;
      const user = (req.session as any)?.user;

      // Get all employees
      const allEmployees = await storage.getEmployees();

      // Filter by location - managers can only see their location(s)
      let filteredEmployees = allEmployees.filter(e => e.isActive);
      if (locationFilter) {
        filteredEmployees = filteredEmployees.filter(e => e.location === locationFilter);
      } else {
        const allowedNames = await getAllowedLocationNames(user);
        if (allowedNames) {
          filteredEmployees = filteredEmployees.filter(e =>
            e.location && allowedNames.has(e.location)
          );
        }
      }

      // Calculate rolling 12-month window
      const now = new Date();
      const twelveMonthsAgo = new Date(now);
      twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
      const startDate = twelveMonthsAgo.toISOString().split("T")[0];
      const endDate = now.toISOString().split("T")[0];
      const currentYear = now.getFullYear();

      // Get all occurrences and adjustments in the date range
      const allOccurrences = await storage.getAllOccurrencesInDateRange(startDate, endDate);
      const allAdjustments = await storage.getAllOccurrenceAdjustmentsForYear(currentYear);

      // Build map of employee ID -> total points
      const employeePoints: Record<number, number> = {};

      for (const occ of allOccurrences) {
        if (occ.status !== "active") continue;
        if (occ.isFmla || occ.isConsecutiveSickness) continue;
        if (!employeePoints[occ.employeeId]) employeePoints[occ.employeeId] = 0;
        employeePoints[occ.employeeId] += occ.occurrenceValue;
      }

      for (const adj of allAdjustments) {
        if (adj.status !== "active") continue;
        if (!employeePoints[adj.employeeId]) employeePoints[adj.employeeId] = 0;
        employeePoints[adj.employeeId] += adj.adjustmentValue;
      }

      // Build result
      const result = filteredEmployees.map(emp => ({
        employeeId: emp.id,
        employeeName: emp.name,
        location: emp.location || "Unknown",
        jobTitle: emp.jobTitle,
        totalPoints: Math.max(0, (employeePoints[emp.id] || 0) / 100), // Convert from x100 to actual
        employmentType: emp.employmentType,
      })).sort((a, b) => b.totalPoints - a.totalPoints);

      res.json(result);
    } catch (err) {
      console.error("Error generating occurrence report:", err);
      res.status(500).json({ error: "Failed to generate occurrence report" });
    }
  });

  // ========== VARIANCE REPORT ==========
  // Compares scheduled shifts against actual clock punches
  app.get("/api/reports/variance", requireAuth, requireManager, async (req: Request, res: Response) => {
    try {
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;
      const locationFilter = req.query.location as string | undefined;
      const user = (req.session as any)?.user;

      if (!startDate || !endDate) {
        return res.status(400).json({ error: "startDate and endDate are required" });
      }

      // Get all employees
      const allEmployees = await storage.getEmployees();
      const employeeMap = new Map(allEmployees.map(e => [e.id, e]));
      const ukgIdToEmployee = new Map(allEmployees.filter(e => e.ukgEmployeeId).map(e => [e.ukgEmployeeId!, e]));

      // Filter employees by location
      const allowedNames = locationFilter ? null : await getAllowedLocationNames(user);
      let allowedEmployeeIds = new Set<number>();
      for (const emp of allEmployees) {
        if (!emp.isActive) continue;
        if (locationFilter) {
          if (emp.location === locationFilter) allowedEmployeeIds.add(emp.id);
        } else if (allowedNames) {
          if (emp.location && allowedNames.has(emp.location)) allowedEmployeeIds.add(emp.id);
        } else {
          allowedEmployeeIds.add(emp.id);
        }
      }

      // Get scheduled shifts for the date range
      const allShifts = await storage.getShifts();
      const shiftsInRange = allShifts.filter(s => {
        if (!allowedEmployeeIds.has(s.employeeId)) return false;
        const shiftDate = new Date(s.startTime).toISOString().split("T")[0];
        return shiftDate >= startDate && shiftDate <= endDate;
      });

      // Get raw punch data
      const punches = await storage.getTimeClockPunches(startDate, endDate);

      // Group punches by employee+date
      const punchMap = new Map<string, Array<{ clockIn: string | null; clockOut: string | null }>>();
      for (const punch of punches) {
        const emp = ukgIdToEmployee.get(punch.ukgEmployeeId);
        if (!emp || !allowedEmployeeIds.has(emp.id)) continue;
        if (punch.paycodeId !== 0) continue; // Skip PAL/UTO entries
        const key = `${emp.id}-${punch.workDate}`;
        if (!punchMap.has(key)) punchMap.set(key, []);
        punchMap.get(key)!.push({ clockIn: punch.clockIn, clockOut: punch.clockOut });
      }

      const earlyClockIns: Array<{
        employeeName: string;
        location: string;
        date: string;
        scheduledStart: string;
        actualClockIn: string;
        varianceMinutes: number;
      }> = [];

      const lateClockOuts: Array<{
        employeeName: string;
        location: string;
        date: string;
        scheduledEnd: string;
        actualClockOut: string;
        varianceMinutes: number;
      }> = [];

      const longLunches: Array<{
        employeeName: string;
        location: string;
        date: string;
        lunchDurationMinutes: number;
        varianceMinutes: number;
      }> = [];

      for (const shift of shiftsInRange) {
        const emp = employeeMap.get(shift.employeeId);
        if (!emp) continue;

        const shiftStart = new Date(shift.startTime);
        const shiftEnd = new Date(shift.endTime);
        const shiftDate = shiftStart.toISOString().split("T")[0];
        const key = `${emp.id}-${shiftDate}`;
        const dayPunches = punchMap.get(key);
        if (!dayPunches || dayPunches.length === 0) continue;

        // Sort punches by clock-in time
        const sortedPunches = dayPunches
          .filter(p => p.clockIn)
          .sort((a, b) => (a.clockIn || "").localeCompare(b.clockIn || ""));

        if (sortedPunches.length === 0) continue;

        // Check early clock-in (first punch)
        const firstPunchIn = sortedPunches[0].clockIn;
        if (firstPunchIn) {
          const punchInTime = new Date(firstPunchIn);
          const diffMs = shiftStart.getTime() - punchInTime.getTime();
          const diffMinutes = Math.round(diffMs / 60000);
          if (diffMinutes > 5) {
            earlyClockIns.push({
              employeeName: emp.name,
              location: emp.location || "Unknown",
              date: shiftDate,
              scheduledStart: shiftStart.toISOString(),
              actualClockIn: firstPunchIn,
              varianceMinutes: diffMinutes,
            });
          }
        }

        // Check late clock-out (last punch)
        const lastPunchWithOut = [...sortedPunches].reverse().find(p => p.clockOut);
        if (lastPunchWithOut?.clockOut) {
          const punchOutTime = new Date(lastPunchWithOut.clockOut);
          const diffMs = punchOutTime.getTime() - shiftEnd.getTime();
          const diffMinutes = Math.round(diffMs / 60000);
          if (diffMinutes > 5) {
            lateClockOuts.push({
              employeeName: emp.name,
              location: emp.location || "Unknown",
              date: shiftDate,
              scheduledEnd: shiftEnd.toISOString(),
              actualClockOut: lastPunchWithOut.clockOut,
              varianceMinutes: diffMinutes,
            });
          }
        }

        // Check lunch duration (gap between first punch out and second punch in)
        if (sortedPunches.length >= 2) {
          const firstPunchOut = sortedPunches[0].clockOut;
          const secondPunchIn = sortedPunches[1].clockIn;
          if (firstPunchOut && secondPunchIn) {
            const lunchStart = new Date(firstPunchOut);
            const lunchEnd = new Date(secondPunchIn);
            const lunchMs = lunchEnd.getTime() - lunchStart.getTime();
            const lunchMinutes = Math.round(lunchMs / 60000);
            if (lunchMinutes >= 35) {
              longLunches.push({
                employeeName: emp.name,
                location: emp.location || "Unknown",
                date: shiftDate,
                lunchDurationMinutes: lunchMinutes,
                varianceMinutes: lunchMinutes - 30,
              });
            }
          }
        }
      }

      res.json({
        earlyClockIns: earlyClockIns.sort((a, b) => b.varianceMinutes - a.varianceMinutes),
        lateClockOuts: lateClockOuts.sort((a, b) => b.varianceMinutes - a.varianceMinutes),
        longLunches: longLunches.sort((a, b) => b.varianceMinutes - a.varianceMinutes),
      });
    } catch (err) {
      console.error("Error generating variance report:", err);
      res.status(500).json({ error: "Failed to generate variance report" });
    }
  });
}
