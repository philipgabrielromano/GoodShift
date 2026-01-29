import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Holiday calculations
export interface Holiday {
  date: Date;
  name: string;
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

// Get all holidays for a given year
export function getHolidaysForYear(year: number): Holiday[] {
  return [
    { date: calculateEaster(year), name: "Easter" },
    { date: calculateThanksgiving(year), name: "Thanksgiving" },
    { date: new Date(year, 11, 25), name: "Christmas" },
  ];
}

// Check if a date is a holiday (returns holiday name or null)
export function isHoliday(date: Date): string | null {
  const year = date.getFullYear();
  const holidays = getHolidaysForYear(year);
  
  for (const holiday of holidays) {
    if (
      holiday.date.getFullYear() === date.getFullYear() &&
      holiday.date.getMonth() === date.getMonth() &&
      holiday.date.getDate() === date.getDate()
    ) {
      return holiday.name;
    }
  }
  return null;
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

const JOB_CODE_TITLES: Record<string, string> = {
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
