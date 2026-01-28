// Holiday utilities for server-side scheduling
//
// Two types of holidays:
// 1. Closed holidays (store is closed): Easter, Thanksgiving, Christmas
// 2. Paid holidays (employees get 8 hours pay, but store is open):
//    - New Year's Day (January 1)
//    - MLK Jr. Birthday (3rd Monday in January)
//    - Memorial Day (Last Monday in May)
//    - Juneteenth (June 19)
//    - Independence Day (July 4)
//    - Labor Day (1st Monday in September)
//    - Thanksgiving Day (4th Thursday in November)
//    - Day After Thanksgiving (4th Friday in November)
//    - Christmas Day (December 25)
//
// Full-time employees with 30+ days of service receive 8 hours holiday pay.

export interface Holiday {
  date: Date;
  name: string;
  isPaid?: boolean; // Whether this is a paid holiday
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
  const daysUntilThursday = (4 - dayOfWeek + 7) % 7;
  const firstThursday = 1 + daysUntilThursday;
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

// Get all closed holidays (store is closed) for a year
export function getClosedHolidaysForYear(year: number): Holiday[] {
  return [
    { date: calculateEaster(year), name: "Easter" },
    { date: calculateThanksgiving(year), name: "Thanksgiving" },
    { date: new Date(year, 11, 25), name: "Christmas" },
  ];
}

// Get all paid holidays for a year
export function getPaidHolidaysForYear(year: number): Holiday[] {
  const thanksgiving = calculateThanksgiving(year);
  return [
    { date: new Date(year, 0, 1), name: "New Year's Day", isPaid: true },
    { date: getNthDayOfWeekInMonth(year, 0, 1, 3), name: "MLK Jr. Birthday", isPaid: true },
    { date: getLastDayOfWeekInMonth(year, 4, 1), name: "Memorial Day", isPaid: true },
    { date: new Date(year, 5, 19), name: "Juneteenth", isPaid: true },
    { date: new Date(year, 6, 4), name: "Independence Day", isPaid: true },
    { date: getNthDayOfWeekInMonth(year, 8, 1, 1), name: "Labor Day", isPaid: true },
    { date: thanksgiving, name: "Thanksgiving Day", isPaid: true },
    { date: new Date(year, 10, thanksgiving.getDate() + 1), name: "Day After Thanksgiving", isPaid: true },
    { date: new Date(year, 11, 25), name: "Christmas Day", isPaid: true },
  ];
}

// Get all holidays for a given year (closed + paid)
export function getHolidaysForYear(year: number): Holiday[] {
  return [
    ...getClosedHolidaysForYear(year),
    ...getPaidHolidaysForYear(year),
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

// Get paid holidays that fall within a date range
export function getPaidHolidaysInRange(startDate: Date, endDate: Date): Holiday[] {
  const holidays: Holiday[] = [];
  const startYear = startDate.getFullYear();
  const endYear = endDate.getFullYear();
  
  for (let year = startYear; year <= endYear; year++) {
    const yearHolidays = getPaidHolidaysForYear(year);
    for (const holiday of yearHolidays) {
      if (holiday.date >= startDate && holiday.date <= endDate) {
        holidays.push(holiday);
      }
    }
  }
  return holidays;
}

// Check if an employee is eligible for paid holiday (full-time with 30+ days of service)
export function isEligibleForPaidHoliday(
  hireDate: string | Date | null | undefined,
  holidayDate: Date,
  employmentType: string | null | undefined
): boolean {
  // Must be full-time
  if (employmentType !== "Full-Time") {
    return false;
  }
  
  // Must have hire date
  if (!hireDate) {
    return false;
  }
  
  // Calculate days of service
  const hireDateObj = typeof hireDate === 'string' ? new Date(hireDate + 'T00:00:00') : hireDate;
  const daysSinceHire = Math.floor(
    (holidayDate.getTime() - hireDateObj.getTime()) / (1000 * 60 * 60 * 24)
  );
  
  // Must have 30+ days of service
  return daysSinceHire >= 30;
}

// Calculate total paid holiday hours for an employee in a given week
export function getPaidHolidayHoursInWeek(
  weekStart: Date,
  weekEnd: Date,
  hireDate: string | Date | null | undefined,
  employmentType: string | null | undefined
): number {
  const holidays = getPaidHolidaysInRange(weekStart, weekEnd);
  
  let totalHours = 0;
  for (const holiday of holidays) {
    if (isEligibleForPaidHoliday(hireDate, holiday.date, employmentType)) {
      totalHours += 8;
    }
  }
  
  return totalHours;
}
