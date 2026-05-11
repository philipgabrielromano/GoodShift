import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Names to exclude from all location dropdowns / lists. The actual rules live
// in @shared/locationFilters so the server can apply the same exclusions
// (e.g. /api/reports/locations). Re-exported here so existing client imports
// of `isValidLocationName` from "@/lib/utils" continue to work unchanged.
import { isValidLocationName } from "@shared/locationFilters";
export { isValidLocationName };

export function isValidLocation(loc: { name: string; isActive?: boolean; formOnly?: boolean }): boolean {
  if (loc.isActive === false) return false;
  if (loc.formOnly === true) return false;
  return isValidLocationName(loc.name);
}

// Stricter check for scheduling-related dropdowns (Schedule, Roster, Task Assignment, Optimization).
// Excludes locations that are toggled off for scheduling but kept active for ordering.
export function isSchedulableLocation(loc: { name: string; isActive?: boolean; formOnly?: boolean; availableForScheduling?: boolean }): boolean {
  if (!isValidLocation(loc)) return false;
  if (loc.availableForScheduling === false) return false;
  return true;
}

// Stricter check for the Roster Targets page dropdown.
// A location must already be schedulable, and the per-location Roster Targets
// flag must not be explicitly turned off. Defaults to true when undefined so
// existing locations remain visible after the column is added.
export function isRosterTargetLocation(loc: { name: string; isActive?: boolean; formOnly?: boolean; availableForScheduling?: boolean; availableForRosterTargets?: boolean }): boolean {
  if (!isSchedulableLocation(loc)) return false;
  if (loc.availableForRosterTargets === false) return false;
  return true;
}

// Check for order-form-related dropdowns (OrderForm location picker, OrderSubmissions
// location filter, anywhere else a user picks a destination for an order).
// Mirrors `isSchedulableLocation` for the order side: must be active, must have the
// per-location order-form flag turned on, and must not be a placeholder name.
// Note: `formOnly` is intentionally NOT excluded here — those locations (e.g. ADCs
// and warehouse-only entries) exist precisely so they can be picked on the order form.
export function isOrderFormLocation(loc: { name: string; isActive?: boolean; availableForOrderForm?: boolean }): boolean {
  if (!loc.isActive) return false;
  if (!loc.availableForOrderForm) return false;
  return isValidLocationName(loc.name);
}

// Holiday calculations
//
// Two kinds of holidays:
//  - Closed: store is closed (Easter, Thanksgiving, Christmas).
//  - Paid:   store is OPEN, but full-time employees with 30+ days of service
//            receive 8 hours of holiday pay (New Year's, MLK, Memorial Day,
//            Juneteenth, Independence Day, Labor Day, Thanksgiving Day, Day
//            After Thanksgiving, Christmas Day). Thanksgiving and Christmas
//            appear in BOTH lists — closed AND paid.
// Keep this in sync with server/holidays.ts.
export interface Holiday {
  date: Date;
  name: string;
  isClosed?: boolean;
  isPaid?: boolean;
}

// Calculate Easter Sunday using the Anonymous Gregorian algorithm
function calculateEaster(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// Calculate Thanksgiving (4th Thursday of November)
function calculateThanksgiving(year: number): Date {
  const november = new Date(year, 10, 1); // November 1st
  const dayOfWeek = november.getDay();
  // Find first Thursday: Thursday is day 4
  // If Nov 1 is Sunday (0), first Thursday is Nov 5 (4 days later)
  // If Nov 1 is Thursday (4), first Thursday is Nov 1
  // Formula: ((4 - dayOfWeek + 7) % 7) gives days until Thursday, then +1 for date
  const daysUntilThursday = (4 - dayOfWeek + 7) % 7;
  const firstThursday = 1 + daysUntilThursday;
  // Add 3 weeks to get 4th Thursday
  return new Date(year, 10, firstThursday + 21);
}

// Get nth occurrence of a day of week in a month (1-indexed)
function getNthDayOfWeekInMonth(year: number, month: number, dayOfWeek: number, n: number): Date {
  const firstOfMonth = new Date(year, month, 1);
  const firstDayOfWeek = firstOfMonth.getDay();
  let daysUntilTarget = dayOfWeek - firstDayOfWeek;
  if (daysUntilTarget < 0) daysUntilTarget += 7;
  const nthOccurrence = 1 + daysUntilTarget + (n - 1) * 7;
  return new Date(year, month, nthOccurrence);
}

// Get last occurrence of a day of week in a month
function getLastDayOfWeekInMonth(year: number, month: number, dayOfWeek: number): Date {
  const lastOfMonth = new Date(year, month + 1, 0);
  const lastDayOfWeek = lastOfMonth.getDay();
  let daysDiff = lastDayOfWeek - dayOfWeek;
  if (daysDiff < 0) daysDiff += 7;
  return new Date(year, month, lastOfMonth.getDate() - daysDiff);
}

// Get all holidays for a given year, merged so a date that's both closed AND
// paid (Thanksgiving, Christmas) appears once with both flags set.
export function getHolidaysForYear(year: number): Holiday[] {
  const thanksgiving = calculateThanksgiving(year);
  const dayAfterThanksgiving = new Date(year, 10, thanksgiving.getDate() + 1);
  const merged = new Map<string, Holiday>();
  const add = (h: Holiday) => {
    const key = `${h.date.getFullYear()}-${h.date.getMonth()}-${h.date.getDate()}`;
    const existing = merged.get(key);
    if (existing) {
      merged.set(key, {
        ...existing,
        isClosed: existing.isClosed || h.isClosed,
        isPaid: existing.isPaid || h.isPaid,
      });
    } else {
      merged.set(key, h);
    }
  };
  // Closed
  add({ date: calculateEaster(year), name: "Easter", isClosed: true });
  add({ date: thanksgiving, name: "Thanksgiving", isClosed: true, isPaid: true });
  add({ date: new Date(year, 11, 25), name: "Christmas", isClosed: true, isPaid: true });
  // Paid (store open, holiday pay for eligible full-time)
  add({ date: new Date(year, 0, 1), name: "New Year's Day", isPaid: true });
  add({ date: getNthDayOfWeekInMonth(year, 0, 1, 3), name: "MLK Jr. Birthday", isPaid: true });
  add({ date: getLastDayOfWeekInMonth(year, 4, 1), name: "Memorial Day", isPaid: true });
  add({ date: new Date(year, 5, 19), name: "Juneteenth", isPaid: true });
  add({ date: new Date(year, 6, 4), name: "Independence Day", isPaid: true });
  add({ date: getNthDayOfWeekInMonth(year, 8, 1, 1), name: "Labor Day", isPaid: true });
  add({ date: dayAfterThanksgiving, name: "Day After Thanksgiving", isPaid: true });
  return Array.from(merged.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
}

// Look up the holiday object for a given date (or null). Use this when the
// caller needs to know whether the store is closed vs. just a paid holiday.
export function getHolidayInfo(date: Date): Holiday | null {
  const holidays = getHolidaysForYear(date.getFullYear());
  for (const holiday of holidays) {
    if (
      holiday.date.getFullYear() === date.getFullYear() &&
      holiday.date.getMonth() === date.getMonth() &&
      holiday.date.getDate() === date.getDate()
    ) {
      return holiday;
    }
  }
  return null;
}

// Check if a date is a holiday (returns name or null). Returns ANY holiday —
// closed or paid. Callers that need to differentiate should use
// getHolidayInfo() instead.
export function isHoliday(date: Date): string | null {
  return getHolidayInfo(date)?.name ?? null;
}

// Check if a date is a CLOSED holiday (store closed). Returns name or null.
// Use this for "store is closed" UI banners and validator coverage checks.
export function isClosedHoliday(date: Date): string | null {
  const info = getHolidayInfo(date);
  return info?.isClosed ? info.name : null;
}

// Get all holidays that fall within a date range
export function getHolidaysInRange(startDate: Date, endDate: Date): Holiday[] {
  const holidays: Holiday[] = [];
  const startYear = startDate.getFullYear();
  const endYear = endDate.getFullYear();
  
  for (let year = startYear; year <= endYear; year++) {
    const yearHolidays = getHolidaysForYear(year);
    for (const holiday of yearHolidays) {
      if (holiday.date >= startDate && holiday.date <= endDate) {
        holidays.push(holiday);
      }
    }
  }
  return holidays;
}

export const JOB_CODE_TITLES: Record<string, string> = {
  // Standard job codes
  APPROC: "Apparel Processor",
  DONDOOR: "Donor Greeter",
  CASHSLS: "Cashier",
  DONPRI: "Donation Pricing",
  STSUPER: "Store Manager",
  STRSUPER: "Store Manager",
  STASSTSP: "Assistant Manager",
  STLDWKR: "Team Lead",
  PART: "Part-Time Staff",
  CUST: "Custodian",
  // West Virginia (Weirton) job codes
  APWV: "Apparel Processor",
  WVDON: "Donor Greeter",
  CSHSLSWV: "Cashier",
  DONPRWV: "Donation Pricing",
  WVSTMNG: "Store Manager",
  WVSTAST: "Assistant Manager",
  WVLDWRK: "Team Lead",
  SLSFLR: "Sales Floor",
  ECOMDIR: "eCommerce Director",
  ECMCOMLD: "eCommerce Lead",
  EASSIS: "eCommerce Assistant",
  ECOMSL: "eCommerce Seller",
  ECSHIP: "eCommerce Shipper",
  ECOMCOMP: "Computer & Electronics Lead",
  ECOMJSE: "eCommerce Jewelry Seller",
  ECOMJSO: "eCommerce Jewelry Sorter",
  ECQCS: "eCommerce QC Specialist",
  EPROCOOR: "eCommerce Coordinator",
  ECCUST: "eCommerce Customer Service",
  ECOPAS: "eCommerce Operations Asst",
  WIRELD: "Wired Up Lead",
  ALTSTRLD: "Alternative Store Lead",
  EBCLK: "eBooks Clerk",
};

// Mapping of equivalent job codes (WV variants map to standard codes)
export const JOB_CODE_EQUIVALENTS: Record<string, string> = {
  APWV: "APPROC",
  WVDON: "DONDOOR",
  CSHSLSWV: "CASHSLS",
  DONPRWV: "DONPRI",
  WVSTMNG: "STSUPER",
  WVSTAST: "STASSTSP",
  WVLDWRK: "STLDWKR",
};

// Get the canonical job code (normalize WV variants to standard codes)
export function getCanonicalJobCode(code: string): string {
  if (!code) return "";
  const upperCode = code.toUpperCase();
  return JOB_CODE_EQUIVALENTS[upperCode] || upperCode;
}

// Check if a job code matches (considering WV equivalents)
export function jobCodeMatches(code: string, targetCode: string): boolean {
  const canonical = getCanonicalJobCode(code);
  const targetCanonical = getCanonicalJobCode(targetCode);
  return canonical === targetCanonical;
}

// Get all job codes that are equivalent to the given code
export function getEquivalentJobCodes(code: string): string[] {
  const canonical = getCanonicalJobCode(code);
  const equivalents = [canonical];
  for (const [wvCode, standardCode] of Object.entries(JOB_CODE_EQUIVALENTS)) {
    if (standardCode === canonical) {
      equivalents.push(wvCode);
    }
  }
  return equivalents;
}

export function getJobTitle(code: string): string {
  if (!code) return "";
  const upperCode = code.toUpperCase();
  return JOB_CODE_TITLES[upperCode] || code;
}
