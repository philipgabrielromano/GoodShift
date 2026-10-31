/**
 * Unit tests for Eastern Time date helpers used by scheduling.
 *
 * Regression coverage for AUDIT_REPORT.md SCHED-01 / SCHED-06 / HOL-02:
 * stepping through a week must land on the right ET calendar day even in a
 * DST week, paid holidays are not store closures, and a holiday on the next
 * Sunday belongs to the next week.
 *
 * Run with:   npx tsx --test test/date-logic.test.ts
 * No database needed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";

import { addDaysInET, createESTTime, TIMEZONE } from "../server/middleware";
import { isClosedHoliday, isHoliday, getPaidHolidaysInRange } from "../server/holidays";

const etMidnight = (ymd: string) => fromZonedTime(`${ymd}T00:00:00`, TIMEZONE);
const fmt = (d: Date) => formatInTimeZone(d, TIMEZONE, "EEE yyyy-MM-dd HH:mm");

for (const [label, weekStart] of [
  ["fall-back week", "2026-11-01"],
  ["spring-forward week", "2026-03-08"],
  ["normal week", "2026-10-25"],
] as const) {
  test(`addDaysInET lands on consecutive ET days (${label})`, () => {
    const start = etMidnight(weekStart);
    const days = Array.from({ length: 7 }, (_, d) => fmt(createESTTime(addDaysInET(start, d), 8)));
    const expectedDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    days.forEach((s, d) => {
      assert.equal(s.slice(0, 3), expectedDays[d], `day ${d} -> ${s}`);
      assert.ok(s.endsWith("08:00"), `day ${d} should be 08:00 ET, got ${s}`);
    });
  });
}

test("addDaysInET keeps wall-clock time across DST (copy a week forward)", () => {
  const sundayOpener = fromZonedTime("2026-10-25T10:00:00", TIMEZONE); // EDT
  assert.equal(fmt(addDaysInET(sundayOpener, 7)), "Sun 2026-11-01 10:00"); // EST
  const marchOpener = fromZonedTime("2026-03-02T08:00:00", TIMEZONE); // EST
  assert.equal(fmt(addDaysInET(marchOpener, 7)), "Mon 2026-03-09 08:00"); // EDT
});

test("paid holidays are not closures; closed holidays are", () => {
  const memorialDay = etMidnight("2026-05-25");
  assert.equal(isHoliday(memorialDay) !== null, true);
  assert.equal(isClosedHoliday(memorialDay), null);
  assert.notEqual(isClosedHoliday(etMidnight("2026-12-25")), null);
});

test("holiday ranges are half-open and use ET calendar dates", () => {
  // July 4 2027 is a Sunday: it belongs to the week starting that day only.
  const prevWeek = etMidnight("2027-06-27");
  const holidayWeek = etMidnight("2027-07-04");
  const names = (start: Date) => getPaidHolidaysInRange(start, addDaysInET(start, 7)).map(h => h.name);
  assert.ok(!names(prevWeek).some(n => /Independence/i.test(n)), "not credited to the previous week");
  assert.ok(names(holidayWeek).some(n => /Independence/i.test(n)), "credited to its own week");
});
