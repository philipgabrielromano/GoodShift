// Single source of truth for an employee's attendance (occurrence) tally.
//
// The employee page, the alert bell, the occurrence report and the HR
// threshold email used to compute this four different ways (calendar-year vs
// rolling-window adjustments, plus a synthetic −1.0 perfect-attendance bonus
// in the alerts only), so the same employee could be over a discipline
// threshold on one screen and under it on another.
//
// Rules:
// - Rolling 12-month window, inclusive at both ends, in Eastern Time.
// - Only active occurrences count; FMLA, other leave and consecutive-sickness
//   occurrences never count.
// - Active adjustments dated inside the window count (manual and recorded
//   perfect-attendance alike). No adjustment is ever inferred.
// - Values are stored ×100; the tally is floored at 0.

import { formatInTimeZone } from "date-fns-tz";
import type { Occurrence, OccurrenceAdjustment } from "@shared/schema";

// Same value as TIMEZONE in ./middleware (kept local so this module stays dependency-free)
const TIMEZONE = "America/New_York";

export interface TallyWindow {
  startDate: string; // YYYY-MM-DD, inclusive
  endDate: string;   // YYYY-MM-DD (today in ET), inclusive
}

export function getTallyWindow(now: Date = new Date()): TallyWindow {
  const endDate = formatInTimeZone(now, TIMEZONE, "yyyy-MM-dd");
  // Same month/day one year earlier. Feb 29 → "YYYY-02-29" of a non-leap year,
  // which still compares correctly as a string (between 02-28 and 03-01).
  const startDate = `${Number(endDate.slice(0, 4)) - 1}${endDate.slice(4)}`;
  return { startDate, endDate };
}

export function inWindow(date: string, window: TallyWindow): boolean {
  return date >= window.startDate && date <= window.endDate;
}

export function isCountableOccurrence(o: Occurrence): boolean {
  return o.status === "active" && !o.isFmla && !o.isOtherLeave && !o.isConsecutiveSickness;
}

export interface Tally {
  totalPoints: number;
  adjustmentTotal: number;
  netTally: number;
}

// `occurrences` and `adjustments` may include rows outside the window or for
// other statuses; they are filtered here.
export function computeNetTally(
  occurrences: Occurrence[],
  adjustments: OccurrenceAdjustment[],
  window: TallyWindow,
): Tally {
  const totalPoints = occurrences
    .filter(o => isCountableOccurrence(o) && inWindow(o.occurrenceDate, window))
    .reduce((sum, o) => sum + o.occurrenceValue, 0) / 100;
  const adjustmentTotal = adjustments
    .filter(a => a.status === "active" && inWindow(a.adjustmentDate, window))
    .reduce((sum, a) => sum + a.adjustmentValue, 0) / 100;
  return { totalPoints, adjustmentTotal, netTally: Math.max(0, totalPoints + adjustmentTotal) };
}
