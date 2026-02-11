import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { requireAuth } from "../middleware";
import { checkAndSendHRNotification } from "../middleware";

export function registerOccurrenceRoutes(app: Express) {
  // === Occurrences ===
  // Get occurrences for an employee within a date range
  app.get("/api/occurrences/:employeeId", requireAuth, async (req, res) => {
    try {
      const employeeId = Number(req.params.employeeId);
      const { startDate, endDate } = req.query;
      const user = (req.session as any)?.user;
      
      // Viewers can only see their own occurrences
      if (user.role === "viewer") {
        const employees = await storage.getEmployees();
        const linkedEmployee = employees.find(e => e.email && e.email.toLowerCase() === user.email.toLowerCase());
        if (!linkedEmployee || linkedEmployee.id !== employeeId) {
          return res.status(403).json({ message: "You can only view your own occurrence history" });
        }
      }
      
      if (!startDate || !endDate) {
        return res.status(400).json({ message: "startDate and endDate query parameters are required" });
      }
      
      const occurrenceList = await storage.getOccurrences(employeeId, String(startDate), String(endDate));
      res.json(occurrenceList);
    } catch (error) {
      console.error("Error fetching occurrences:", error);
      res.status(500).json({ message: "Failed to fetch occurrences" });
    }
  });

  // Create a new occurrence
  app.post("/api/occurrences", requireAuth, async (req, res) => {
    try {
      const user = (req.session as any)?.user;
      if (user.role !== "admin" && user.role !== "manager") {
        return res.status(403).json({ message: "Only managers and admins can create occurrences" });
      }
      
      const { employeeId, occurrenceDate, occurrenceType, occurrenceValue, illnessGroupId, notes, isNcns, reason, documentUrl } = req.body;
      
      if (!employeeId || !occurrenceDate || !occurrenceType || occurrenceValue === undefined) {
        return res.status(400).json({ message: "employeeId, occurrenceDate, occurrenceType, and occurrenceValue are required" });
      }
      
      const occurrence = await storage.createOccurrence({
        employeeId,
        occurrenceDate,
        occurrenceType,
        occurrenceValue,
        illnessGroupId: illnessGroupId || null,
        notes: notes || null,
        isNcns: isNcns || false,
        reason: reason || null,
        documentUrl: documentUrl || null,
        createdBy: user.id
      });
      
      // Check if HR notification should be sent for crossing thresholds
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host || 'localhost:5000';
      const appUrl = `${protocol}://${host}`;
      checkAndSendHRNotification(employeeId, occurrenceValue, appUrl).catch(err => 
        console.error('[HR Notification] Background error:', err)
      );
      
      res.status(201).json(occurrence);
    } catch (error) {
      console.error("Error creating occurrence:", error);
      res.status(500).json({ message: "Failed to create occurrence" });
    }
  });

  // Retract an occurrence
  app.post("/api/occurrences/:id/retract", requireAuth, async (req, res) => {
    try {
      const user = (req.session as any)?.user;
      if (user.role !== "admin" && user.role !== "manager") {
        return res.status(403).json({ message: "Only managers and admins can retract occurrences" });
      }
      
      const id = Number(req.params.id);
      const { reason } = req.body;
      
      if (!reason) {
        return res.status(400).json({ message: "Retraction reason is required" });
      }
      
      const occurrence = await storage.retractOccurrence(id, reason, user.id);
      res.json(occurrence);
    } catch (error) {
      console.error("Error retracting occurrence:", error);
      res.status(500).json({ message: "Failed to retract occurrence" });
    }
  });

  // Retract an adjustment
  app.post("/api/occurrence-adjustments/:id/retract", requireAuth, async (req, res) => {
    try {
      const user = (req.session as any)?.user;
      if (user.role !== "admin" && user.role !== "manager") {
        return res.status(403).json({ message: "Only managers and admins can retract adjustments" });
      }
      
      const id = Number(req.params.id);
      const { reason } = req.body;
      
      if (!reason) {
        return res.status(400).json({ message: "Retraction reason is required" });
      }
      
      const adjustment = await storage.retractAdjustment(id, reason, user.id);
      if (!adjustment) {
        return res.status(404).json({ message: "Adjustment not found" });
      }
      res.json(adjustment);
    } catch (error) {
      console.error("Error retracting adjustment:", error);
      res.status(500).json({ message: "Failed to retract adjustment" });
    }
  });

  // Get occurrence summary (rolling 12-month tally) for an employee
  app.get("/api/occurrences/:employeeId/summary", requireAuth, async (req, res) => {
    try {
      const employeeId = Number(req.params.employeeId);
      const user = (req.session as any)?.user;
      
      // Viewers can only see their own occurrence summary
      if (user.role === "viewer") {
        const employees = await storage.getEmployees();
        const linkedEmployee = employees.find(e => e.email && e.email.toLowerCase() === user.email.toLowerCase());
        if (!linkedEmployee || linkedEmployee.id !== employeeId) {
          return res.status(403).json({ message: "You can only view your own occurrence history" });
        }
      }
      
      const now = new Date();
      const oneYearAgo = new Date(now);
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      
      const startDate = oneYearAgo.toISOString().split('T')[0];
      const endDate = now.toISOString().split('T')[0];
      
      // Get active (non-retracted) occurrences in the rolling 12-month window
      const allOccurrences = await storage.getOccurrences(employeeId, startDate, endDate);
      const activeOccurrences = allOccurrences.filter(o => o.status === 'active');
      
      // Calculate total points (stored as integers x100, so divide by 100)
      // FMLA and consecutive sickness occurrences do NOT count toward the total
      const countableOccurrences = activeOccurrences.filter(o => !o.isFmla && !o.isConsecutiveSickness);
      const totalPoints = countableOccurrences.reduce((sum, o) => sum + o.occurrenceValue, 0) / 100;
      
      // Get adjustments for the current calendar year
      const currentYear = now.getFullYear();
      const adjustments = await storage.getOccurrenceAdjustmentsForYear(employeeId, currentYear);
      
      // Separate manual adjustments (unscheduled_shift) from perfect attendance adjustments
      // Active adjustments are used for tallies
      const activeManualAdjustments = adjustments.filter(a => a.adjustmentType !== 'perfect_attendance' && a.status === 'active');
      const activePerfectAttendanceAdjustments = adjustments.filter(a => a.adjustmentType === 'perfect_attendance' && a.status === 'active');
      const manualAdjustmentTotal = activeManualAdjustments.reduce((sum, a) => sum + a.adjustmentValue, 0) / 100;
      
      // Perfect attendance: can only happen once per calendar year
      const perfectAttendanceUsedThisYear = activePerfectAttendanceAdjustments.length > 0;
      const perfectAttendanceValue = perfectAttendanceUsedThisYear 
        ? activePerfectAttendanceAdjustments.reduce((sum, a) => sum + a.adjustmentValue, 0) / 100
        : 0;
      
      // Check eligibility for perfect attendance (90 days without occurrences)
      const yearStart = `${currentYear}-01-01`;
      const yearOccurrences = await storage.getOccurrences(employeeId, yearStart, endDate);
      const activeYearOccurrences = yearOccurrences.filter(o => o.status === 'active');
      
      let perfectAttendanceEligible = false;
      
      if (!perfectAttendanceUsedThisYear) {
        if (activeYearOccurrences.length === 0) {
          // No occurrences this calendar year - check if 90 days have passed since Jan 1
          const yearStartDate = new Date(`${currentYear}-01-01T00:00:00`);
          const daysSinceYearStart = Math.floor((now.getTime() - yearStartDate.getTime()) / (1000 * 60 * 60 * 24));
          if (daysSinceYearStart >= 90) {
            perfectAttendanceEligible = true;
          }
        } else {
          // Has occurrences - check for 90 consecutive days after the most recent occurrence
          const sortedOccurrences = [...activeYearOccurrences].sort((a, b) => 
            new Date(b.occurrenceDate).getTime() - new Date(a.occurrenceDate).getTime()
          );
          const mostRecentOccurrence = sortedOccurrences[0];
          const mostRecentDate = new Date(mostRecentOccurrence.occurrenceDate + 'T00:00:00');
          const daysSinceLastOccurrence = Math.floor((now.getTime() - mostRecentDate.getTime()) / (1000 * 60 * 60 * 24));
          if (daysSinceLastOccurrence >= 90) {
            perfectAttendanceEligible = true;
          }
        }
      }
      
      // Total adjustment = manual adjustments + perfect attendance (if used)
      const totalAdjustment = manualAdjustmentTotal + perfectAttendanceValue;
      
      // Net tally = total occurrences + adjustments (adjustments are negative values)
      const netTally = Math.max(0, totalPoints + totalAdjustment);
      
      // Sort all occurrences by date (most recent first) for display
      const sortedOccurrences = [...allOccurrences].sort((a, b) => 
        new Date(b.occurrenceDate).getTime() - new Date(a.occurrenceDate).getTime()
      );
      
      // Determine if perfect attendance would be wasted (no occurrences to reduce)
      const hasOccurrencesToReduce = totalPoints > 0;
      
      res.json({
        employeeId,
        periodStart: startDate,
        periodEnd: endDate,
        totalOccurrences: totalPoints,
        adjustmentsThisYear: totalAdjustment,
        adjustmentsRemaining: 2 - activeManualAdjustments.length, // Only count active manual adjustments toward limit
        netTally,
        occurrenceCount: activeOccurrences.length,
        occurrences: sortedOccurrences, // Include all occurrences (active + retracted) for history
        adjustments: adjustments, // Include all adjustments (active + retracted) for display
        perfectAttendanceBonus: perfectAttendanceUsedThisYear,
        perfectAttendanceBonusValue: perfectAttendanceValue,
        perfectAttendanceUsed: perfectAttendanceUsedThisYear ? 1 : 0,
        perfectAttendanceEligible,
        perfectAttendanceWouldBeWasted: perfectAttendanceEligible && !hasOccurrencesToReduce
      });
    } catch (error) {
      console.error("Error fetching occurrence summary:", error);
      res.status(500).json({ message: "Failed to fetch occurrence summary" });
    }
  });

  // Get occurrence alerts - employees at 5, 7, or 8+ occurrences
  app.get("/api/occurrence-alerts", requireAuth, async (req, res) => {
    try {
      const user = (req.session as any)?.user;
      if (user.role !== "admin" && user.role !== "manager") {
        return res.status(403).json({ message: "Only managers and admins can view occurrence alerts" });
      }

      const now = new Date();
      const oneYearAgo = new Date(now);
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      
      const startDate = oneYearAgo.toISOString().split('T')[0];
      const endDate = now.toISOString().split('T')[0];
      const currentYear = now.getFullYear();
      const yearStart = `${currentYear}-01-01`;

      // Get all active employees
      let allEmployees = await storage.getEmployees();
      allEmployees = allEmployees.filter(e => e.isActive);
      
      // Filter by manager's locations if not admin
      if (user.role === "manager" && user.locationIds && user.locationIds.length > 0) {
        const allLocations = await storage.getLocations();
        const userLocationNames = allLocations
          .filter(loc => user.locationIds.includes(String(loc.id)))
          .map(loc => loc.name);
        allEmployees = allEmployees.filter(emp => 
          emp.location && userLocationNames.includes(emp.location)
        );
      }

      // OPTIMIZATION: Fetch all data in bulk with just 3 queries instead of 4 per employee
      const [allOccurrences, allAdjustments, allCorrectiveActions] = await Promise.all([
        storage.getAllOccurrencesInDateRange(startDate, endDate),
        storage.getAllOccurrenceAdjustmentsForYear(currentYear),
        storage.getAllCorrectiveActions()
      ]);

      // Group data by employee ID for fast lookups
      const occurrencesByEmployee = new Map<number, typeof allOccurrences>();
      for (const occ of allOccurrences) {
        const list = occurrencesByEmployee.get(occ.employeeId) || [];
        list.push(occ);
        occurrencesByEmployee.set(occ.employeeId, list);
      }

      const adjustmentsByEmployee = new Map<number, typeof allAdjustments>();
      for (const adj of allAdjustments) {
        const list = adjustmentsByEmployee.get(adj.employeeId) || [];
        list.push(adj);
        adjustmentsByEmployee.set(adj.employeeId, list);
      }

      const correctiveByEmployee = new Map<number, typeof allCorrectiveActions>();
      for (const action of allCorrectiveActions) {
        const list = correctiveByEmployee.get(action.employeeId) || [];
        list.push(action);
        correctiveByEmployee.set(action.employeeId, list);
      }

      const alerts: Array<{
        employeeId: number;
        employeeName: string;
        location: string | null;
        jobTitle: string;
        occurrenceTotal: number;
        netTally: number;
        threshold: 5 | 7 | 8;
        message: string;
      }> = [];

      // Calculate occurrence totals for each employee using pre-fetched data
      for (const emp of allEmployees) {
        const empOccurrences = occurrencesByEmployee.get(emp.id) || [];
        const activeOccurrences = empOccurrences.filter(o => o.status === 'active');
        // FMLA and consecutive sickness occurrences do NOT count toward the total
        const countableOccurrences = activeOccurrences.filter(o => !o.isFmla && !o.isConsecutiveSickness);
        const totalPoints = countableOccurrences.reduce((sum, o) => sum + o.occurrenceValue, 0) / 100;

        // Get adjustments for this year (only count active adjustments)
        const empAdjustments = adjustmentsByEmployee.get(emp.id) || [];
        const activeAdjustments = empAdjustments.filter(a => a.status === 'active');
        const manualAdjustments = activeAdjustments.filter(a => a.adjustmentType !== 'perfect_attendance');
        const manualAdjustmentTotal = manualAdjustments.reduce((sum, a) => sum + a.adjustmentValue, 0) / 100;

        // Check for perfect attendance bonus - filter occurrences to this year only
        const activeYearOccurrences = activeOccurrences.filter(o => o.occurrenceDate >= yearStart);
        let perfectAttendanceBonus = 0;

        if (activeYearOccurrences.length === 0) {
          const yearStartDate = new Date(`${currentYear}-01-01T00:00:00`);
          const daysSinceYearStart = Math.floor((now.getTime() - yearStartDate.getTime()) / (1000 * 60 * 60 * 24));
          if (daysSinceYearStart >= 90) perfectAttendanceBonus = -1.0;
        } else {
          const sortedOccurrences = [...activeYearOccurrences].sort((a, b) => 
            new Date(b.occurrenceDate).getTime() - new Date(a.occurrenceDate).getTime()
          );
          const mostRecentDate = new Date(sortedOccurrences[0].occurrenceDate + 'T00:00:00');
          const daysSinceLastOccurrence = Math.floor((now.getTime() - mostRecentDate.getTime()) / (1000 * 60 * 60 * 24));
          if (daysSinceLastOccurrence >= 90) perfectAttendanceBonus = -1.0;
        }

        const totalAdjustment = manualAdjustmentTotal + perfectAttendanceBonus;
        const netTally = Math.max(0, totalPoints + totalAdjustment);

        // Get corrective actions for this employee to check if action already taken
        const empCorrective = correctiveByEmployee.get(emp.id) || [];
        const hasWarning = empCorrective.some(a => a.actionType === 'warning');
        const hasFinalWarning = empCorrective.some(a => a.actionType === 'final_warning');
        const hasTermination = empCorrective.some(a => a.actionType === 'termination');

        // Check thresholds (using netTally for accurate count)
        // Only show alert if the appropriate corrective action hasn't been recorded
        // 5 = warning, 7 = final warning, 8 = termination
        if (netTally >= 8 && !hasTermination) {
          alerts.push({
            employeeId: emp.id,
            employeeName: emp.name,
            location: emp.location,
            jobTitle: emp.jobTitle,
            occurrenceTotal: totalPoints,
            netTally,
            threshold: 8,
            message: `${emp.name} has reached ${netTally.toFixed(1)} occurrences. Termination.`
          });
        } else if (netTally >= 7 && !hasFinalWarning) {
          alerts.push({
            employeeId: emp.id,
            employeeName: emp.name,
            location: emp.location,
            jobTitle: emp.jobTitle,
            occurrenceTotal: totalPoints,
            netTally,
            threshold: 7,
            message: `${emp.name} is at ${netTally.toFixed(1)} occurrences. Final warning.`
          });
        } else if (netTally >= 5 && !hasWarning) {
          alerts.push({
            employeeId: emp.id,
            employeeName: emp.name,
            location: emp.location,
            jobTitle: emp.jobTitle,
            occurrenceTotal: totalPoints,
            netTally,
            threshold: 5,
            message: `${emp.name} is at ${netTally.toFixed(1)} occurrences. Warning.`
          });
        }
      }

      // Sort by severity (8 first, then 7, then 5) and then by netTally descending
      alerts.sort((a, b) => {
        if (a.threshold !== b.threshold) return b.threshold - a.threshold;
        return b.netTally - a.netTally;
      });

      res.json(alerts);
    } catch (error) {
      console.error("Error fetching occurrence alerts:", error);
      res.status(500).json({ message: "Failed to fetch occurrence alerts" });
    }
  });

  // Create an occurrence adjustment
  app.post("/api/occurrence-adjustments", requireAuth, async (req, res) => {
    try {
      const user = (req.session as any)?.user;
      if (user.role !== "admin" && user.role !== "manager") {
        return res.status(403).json({ message: "Only managers and admins can create adjustments" });
      }
      
      const { employeeId, adjustmentValue, adjustmentType, notes, calendarYear } = req.body;
      
      if (!employeeId || adjustmentValue === undefined || !adjustmentType) {
        return res.status(400).json({ message: "employeeId, adjustmentValue, and adjustmentType are required" });
      }
      
      const now = new Date();
      const year = calendarYear || now.getFullYear();
      
      // Get existing adjustments for the year
      const existingAdjustments = await storage.getOccurrenceAdjustmentsForYear(employeeId, year);
      const activeAdjustments = existingAdjustments.filter(a => a.status === 'active');
      
      // Special validation for perfect_attendance adjustments
      if (adjustmentType === 'perfect_attendance') {
        // Check if already used perfect attendance this year
        const existingPerfectAttendance = activeAdjustments.filter(a => a.adjustmentType === 'perfect_attendance');
        if (existingPerfectAttendance.length > 0) {
          return res.status(400).json({ message: "Perfect attendance bonus has already been used this year (limit: 1 per year)" });
        }
        
        // Check if employee has occurrences to reduce (don't waste the bonus)
        const oneYearAgo = new Date(now);
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        const startDate = oneYearAgo.toISOString().split('T')[0];
        const endDate = now.toISOString().split('T')[0];
        const occurrences = await storage.getOccurrences(employeeId, startDate, endDate);
        const activeOccurrences = occurrences.filter(o => o.status === 'active');
        const totalPoints = activeOccurrences.reduce((sum, o) => sum + o.occurrenceValue, 0) / 100;
        
        if (totalPoints === 0) {
          return res.status(400).json({ message: "Cannot grant perfect attendance bonus - employee has no occurrences to reduce" });
        }
      } else {
        // Check if employee already has 2 manual adjustments this year
        const manualAdjustments = activeAdjustments.filter(a => a.adjustmentType !== 'perfect_attendance');
        if (manualAdjustments.length >= 2) {
          return res.status(400).json({ message: "Employee has already used maximum 2 adjustments for this year" });
        }
      }
      
      const adjustment = await storage.createOccurrenceAdjustment({
        employeeId,
        adjustmentDate: now.toISOString().split('T')[0],
        adjustmentValue,
        adjustmentType,
        notes: notes || null,
        calendarYear: year,
        createdBy: user.id
      });
      
      res.status(201).json(adjustment);
    } catch (error) {
      console.error("Error creating adjustment:", error);
      res.status(500).json({ message: "Failed to create adjustment" });
    }
  });

  // === CORRECTIVE ACTIONS ===
  
  // Get corrective actions for an employee
  app.get("/api/corrective-actions/:employeeId", requireAuth, async (req, res) => {
    try {
      const employeeId = Number(req.params.employeeId);
      const user = (req.session as any)?.user;
      
      // Only managers and admins can view corrective actions
      if (user.role !== "admin" && user.role !== "manager") {
        return res.status(403).json({ message: "Only managers and admins can view corrective actions" });
      }
      
      const actions = await storage.getCorrectiveActions(employeeId);
      res.json(actions);
    } catch (error) {
      console.error("Error fetching corrective actions:", error);
      res.status(500).json({ message: "Failed to fetch corrective actions" });
    }
  });

  // Create a corrective action
  app.post("/api/corrective-actions", requireAuth, async (req, res) => {
    try {
      const user = (req.session as any)?.user;
      if (user.role !== "admin" && user.role !== "manager") {
        return res.status(403).json({ message: "Only managers and admins can create corrective actions" });
      }
      
      const { employeeId, actionType, actionDate, occurrenceCount, notes } = req.body;
      
      if (!employeeId || !actionType || !actionDate || occurrenceCount === undefined) {
        return res.status(400).json({ message: "employeeId, actionType, actionDate, and occurrenceCount are required" });
      }
      
      // Validate action type
      const validTypes = ['warning', 'final_warning', 'termination'];
      if (!validTypes.includes(actionType)) {
        return res.status(400).json({ message: "actionType must be 'warning', 'final_warning', or 'termination'" });
      }
      
      // Get existing actions to validate the progression
      const existingActions = await storage.getCorrectiveActions(employeeId);
      
      // Validate progression: warning -> final_warning -> termination
      if (actionType === 'final_warning') {
        const hasWarning = existingActions.some(a => a.actionType === 'warning');
        if (!hasWarning) {
          return res.status(400).json({ message: "A warning must be recorded before a final warning" });
        }
      }
      
      if (actionType === 'termination') {
        const hasWarning = existingActions.some(a => a.actionType === 'warning');
        const hasFinalWarning = existingActions.some(a => a.actionType === 'final_warning');
        if (!hasWarning || !hasFinalWarning) {
          return res.status(400).json({ message: "Both warning and final warning must be recorded before termination" });
        }
      }
      
      // Prevent duplicate actions of the same type
      const alreadyExists = existingActions.some(a => a.actionType === actionType);
      if (alreadyExists) {
        return res.status(400).json({ message: `A ${actionType.replace('_', ' ')} has already been recorded` });
      }
      
      const action = await storage.createCorrectiveAction({
        employeeId,
        actionType,
        actionDate,
        occurrenceCount,
        notes: notes || null,
        createdBy: user.id
      });
      
      res.status(201).json(action);
    } catch (error) {
      console.error("Error creating corrective action:", error);
      res.status(500).json({ message: "Failed to create corrective action" });
    }
  });

  // Delete a corrective action
  app.delete("/api/corrective-actions/:id", requireAuth, async (req, res) => {
    try {
      const user = (req.session as any)?.user;
      if (user.role !== "admin" && user.role !== "manager") {
        return res.status(403).json({ message: "Only managers and admins can delete corrective actions" });
      }
      
      const id = Number(req.params.id);
      await storage.deleteCorrectiveAction(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting corrective action:", error);
      res.status(500).json({ message: "Failed to delete corrective action" });
    }
  });
}
