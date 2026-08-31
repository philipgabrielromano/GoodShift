import type { Occurrence, OccurrenceAdjustment } from "@shared/schema";

// ============================================================================
// Single source of truth for the attendance "net tally" math.
//
// Used by all four tally call sites:
//   1. HR threshold emails        (server/middleware.ts  checkAndSendHRNotification)
//   2. In-app occurrence alerts   (server/routes/occurrences.ts  GET /api/occurrence-alerts)
//   3. Attendance summary         (server/routes/occurrences.ts  GET /api/occurrences/:employeeId/summary)
//   4. Occurrence report          (server/routes/reports.ts  GET /api/reports/occurrences)
//
// Unified rules:
// - A rolling 12-month window applies to BOTH occurrence dates and adjustment
//   dates. (Some call sites previously filtered adjustments by calendar year,
//   which made them disagree with the summary near year boundaries.)
// - Only active occurrences count. FMLA, other-leave, and consecutive-sickness
//   occurrences are exempt (zero points).
// - Only active adjustments count. Stored perfect_attendance adjustment
//   records count like any other adjustment: the bonus reduces the tally only
//   when it has actually been applied (the 1-per-year button flow in the
//   summary view). No call site may auto-apply a computed -1 bonus based on
//   eligibility alone — that previously made the in-app alerts show one point
//   less than the HR threshold email for the same employee.
// - The net tally is floored at zero.
// ============================================================================

export interface TallyWindow {
  /** Inclusive start date, YYYY-MM-DD */
  startDate: string;
  /** Inclusive end date, YYYY-MM-DD */
  endDate: string;
}

/** Rolling 12-month window ending today (matches all tally call sites). */
export function getRollingTallyWindow(now: Date = new Date()): TallyWindow {
  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  return {
    startDate: oneYearAgo.toISOString().split("T")[0],
    endDate: now.toISOString().split("T")[0],
  };
}

/** True when the occurrence adds points (active + not exempt). */
export function isCountableOccurrence(o: Occurrence): boolean {
  return (
    o.status === "active" &&
    !o.isFmla &&
    !o.isOtherLeave &&
    !o.isConsecutiveSickness
  );
}

export interface NetTallyResult {
  /** Points from countable occurrences in the window (already /100). */
  totalPoints: number;
  /** Sum of active non-perfect-attendance adjustments in the window (already /100, typically negative). */
  manualAdjustmentTotal: number;
  /** Sum of active stored perfect_attendance adjustments in the window (already /100, typically negative). */
  perfectAttendanceValue: number;
  /** manualAdjustmentTotal + perfectAttendanceValue */
  totalAdjustment: number;
  /** max(0, totalPoints + totalAdjustment) */
  netTally: number;
  /** Active occurrences inside the window (includes exempt ones). */
  activeOccurrences: Occurrence[];
  /** Active, non-exempt occurrences inside the window (these carry the points). */
  countableOccurrences: Occurrence[];
}

/**
 * Compute an employee's net occurrence tally.
 *
 * Pass any superset of the employee's occurrences/adjustments — rows outside
 * the window, retracted rows, and exempt occurrences are filtered here so
 * every caller applies identical rules.
 */
export function computeNetTally(
  occurrences: Occurrence[],
  adjustments: OccurrenceAdjustment[],
  window: TallyWindow,
): NetTallyResult {
  const activeOccurrences = occurrences.filter(
    (o) =>
      o.status === "active" &&
      o.occurrenceDate >= window.startDate &&
      o.occurrenceDate <= window.endDate,
  );
  const countableOccurrences = activeOccurrences.filter(
    (o) => !o.isFmla && !o.isOtherLeave && !o.isConsecutiveSickness,
  );
  const totalPoints =
    countableOccurrences.reduce((sum, o) => sum + o.occurrenceValue, 0) / 100;

  const activeWindowAdjustments = adjustments.filter(
    (a) =>
      a.status === "active" &&
      a.adjustmentDate >= window.startDate &&
      a.adjustmentDate <= window.endDate,
  );
  const manualAdjustmentTotal =
    activeWindowAdjustments
      .filter((a) => a.adjustmentType !== "perfect_attendance")
      .reduce((sum, a) => sum + a.adjustmentValue, 0) / 100;
  const perfectAttendanceValue =
    activeWindowAdjustments
      .filter((a) => a.adjustmentType === "perfect_attendance")
      .reduce((sum, a) => sum + a.adjustmentValue, 0) / 100;

  const totalAdjustment = manualAdjustmentTotal + perfectAttendanceValue;
  const netTally = Math.max(0, totalPoints + totalAdjustment);

  return {
    totalPoints,
    manualAdjustmentTotal,
    perfectAttendanceValue,
    totalAdjustment,
    netTally,
    activeOccurrences,
    countableOccurrences,
  };
}
