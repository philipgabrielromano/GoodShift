/**
 * Unit tests for the shared attendance tally (server/occurrenceTally.ts).
 *
 * Regression coverage for AUDIT_REPORT.md OCC-02 / OCC-03: every screen uses
 * the same rolling-window formula, no perfect-attendance bonus is inferred,
 * and "today" is the Eastern Time date.
 *
 * Run with:   npx tsx --test test/occurrence-tally.test.ts
 * No database needed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { fromZonedTime } from "date-fns-tz";

import { getRollingTallyWindow, computeNetTally } from "../server/occurrenceTally";
import type { Occurrence, OccurrenceAdjustment } from "../shared/schema";

const occ = (date: string, value: number, extra: Partial<Occurrence> = {}) =>
  ({ occurrenceDate: date, occurrenceValue: value, status: "active", isFmla: false, isOtherLeave: false, isConsecutiveSickness: false, ...extra }) as Occurrence;
const adj = (date: string, value: number, extra: Partial<OccurrenceAdjustment> = {}) =>
  ({ adjustmentDate: date, adjustmentValue: value, status: "active", adjustmentType: "manual", ...extra }) as OccurrenceAdjustment;

// The audit's example: 6 occurrences totalling 5.5, last one 2026-06-01,
// one -1.0 adjustment on 2026-11-15.
const occurrences = [
  occ("2026-01-10", 100), occ("2026-02-10", 100), occ("2026-03-10", 100),
  occ("2026-04-10", 100), occ("2026-05-10", 100), occ("2026-06-01", 50),
];
const adjustments = [adj("2026-11-15", -100)];

test("adjustments count by rolling window, not calendar year (no Jan 1 jump)", () => {
  const dec = computeNetTally(occurrences, adjustments, getRollingTallyWindow(new Date("2026-12-15T17:00:00Z")));
  const jan = computeNetTally(occurrences, adjustments, getRollingTallyWindow(new Date("2027-01-10T17:00:00Z")));
  assert.equal(dec.netTally, 4.5);
  assert.equal(jan.netTally, 4.5);
});

test("no perfect-attendance bonus is inferred from clean days", () => {
  // >90 days since the last occurrence, no recorded adjustment: tally is the raw total.
  const t = computeNetTally(occurrences, [], getRollingTallyWindow(new Date("2026-12-15T17:00:00Z")));
  assert.equal(t.netTally, 5.5);
});

test("FMLA / other leave / consecutive sickness and retracted rows don't count", () => {
  const w = getRollingTallyWindow(new Date("2026-12-15T17:00:00Z"));
  const t = computeNetTally([
    occ("2026-12-01", 100, { isFmla: true }),
    occ("2026-12-02", 100, { isOtherLeave: true }),
    occ("2026-12-03", 100, { isConsecutiveSickness: true }),
    occ("2026-12-04", 100, { status: "retracted" }),
    occ("2026-12-05", 100),
  ], [adj("2026-12-06", -100, { status: "retracted" })], w);
  assert.equal(t.netTally, 1);
});

test("window uses the Eastern Time date and floors at zero", () => {
  // 9:30pm EDT Oct 31 is already Nov 1 in UTC; the window must end Oct 31.
  const w = getRollingTallyWindow(fromZonedTime("2026-10-31T21:30:00", "America/New_York"));
  assert.deepEqual(w, { startDate: "2025-10-31", endDate: "2026-10-31" });
  assert.equal(computeNetTally([], [adj("2026-10-01", -300)], w).netTally, 0);
});
