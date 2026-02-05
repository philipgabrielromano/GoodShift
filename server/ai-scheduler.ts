import OpenAI from "openai";
import { storage } from "./storage";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { isHoliday, getHolidaysInRange } from "./holidays";

const TIMEZONE = "America/New_York";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

function createESTTime(baseDate: Date, hours: number, minutes: number = 0): Date {
  const zonedDate = toZonedTime(baseDate, TIMEZONE);
  zonedDate.setHours(hours, minutes, 0, 0);
  return fromZonedTime(zonedDate, TIMEZONE);
}

interface ScheduleShift {
  employeeId: number;
  employeeName: string;
  jobTitle: string;
  shiftType: "opener" | "mid1" | "mid2" | "mid3" | "closer" | "short_open" | "short_close" | "gap_open" | "gap_close" | "prod_afternoon";
  dayIndex: number;
}

interface AIScheduleResponse {
  shifts: ScheduleShift[];
  reasoning: string;
  warnings: string[];
}

export async function generateAISchedule(weekStart: string, userLocationIds?: string[]): Promise<{ shifts: any[]; reasoning: string; warnings: string[] }> {
  const startDate = new Date(weekStart);
  const weekEndDate = new Date(startDate.getTime() + 6 * 24 * 60 * 60 * 1000);
  const weekStartStr = startDate.toISOString().split('T')[0];
  const weekEndStr = weekEndDate.toISOString().split('T')[0];
  
  let employees = await storage.getEmployees();
  const settings = await storage.getGlobalSettings();
  const timeOff = await storage.getTimeOffRequests();
  const locations = await storage.getLocations();
  
  // Fetch PAL and UTO entries for the week
  const palEntries = await storage.getPALEntries(weekStartStr, weekEndStr);
  const utoEntries = await storage.getUnpaidTimeOffEntries(weekStartStr, weekEndStr);

  // Filter by user's assigned locations if provided
  let activeLocations = locations.filter(l => l.isActive);
  if (userLocationIds && userLocationIds.length > 0) {
    // Get location names for user's location IDs
    const userLocationNames = locations
      .filter(loc => userLocationIds.includes(String(loc.id)))
      .map(loc => loc.name);
    
    // Filter employees by location
    employees = employees.filter(emp => 
      emp.location && userLocationNames.includes(emp.location)
    );
    
    // Also filter locations for hours calculation
    activeLocations = activeLocations.filter(loc => userLocationIds.includes(String(loc.id)));
  }

  const totalAvailableHours = activeLocations.reduce((sum, loc) => sum + (loc.weeklyHoursLimit || 0), 0);

  // Filter out inactive employees and those hidden from schedule
  const activeEmployees = employees.filter(e => e.isActive && !e.isHiddenFromSchedule);
  
  const approvedTimeOff = timeOff.filter(t => t.status === "approved");

  // Build PAL hours per employee (keyed by ukgEmployeeId) and PAL days
  // Hours stored in minutes in database, convert to hours
  const palHoursByEmployee = new Map<number, number>();
  const palDaysByEmployee = new Map<number, { date: string; hours: number; dayIndex: number }[]>();
  
  for (const pal of palEntries) {
    // Find employee by ukgEmployeeId
    const emp = employees.find(e => e.ukgEmployeeId === pal.ukgEmployeeId);
    if (!emp) continue;
    
    const hoursDecimal = (pal.totalHours || 0) / 60; // Convert minutes to hours
    const currentHours = palHoursByEmployee.get(emp.id) || 0;
    palHoursByEmployee.set(emp.id, currentHours + hoursDecimal);
    
    // Calculate day index (0-6, Sunday-Saturday)
    const palDate = new Date(pal.workDate);
    const dayDiff = Math.floor((palDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
    if (dayDiff >= 0 && dayDiff < 7) {
      const days = palDaysByEmployee.get(emp.id) || [];
      days.push({ date: pal.workDate, hours: hoursDecimal, dayIndex: dayDiff });
      palDaysByEmployee.set(emp.id, days);
    }
  }
  
  // Build UTO days per employee (UTO doesn't count toward hours but blocks scheduling)
  const utoDaysByEmployee = new Map<number, { date: string; hours: number; dayIndex: number }[]>();
  
  for (const uto of utoEntries) {
    const emp = employees.find(e => e.ukgEmployeeId === uto.ukgEmployeeId);
    if (!emp) continue;
    
    const hoursDecimal = (uto.totalHours || 0) / 60;
    const utoDate = new Date(uto.workDate);
    const dayDiff = Math.floor((utoDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
    if (dayDiff >= 0 && dayDiff < 7) {
      const days = utoDaysByEmployee.get(emp.id) || [];
      days.push({ date: uto.workDate, hours: hoursDecimal, dayIndex: dayDiff });
      utoDaysByEmployee.set(emp.id, days);
    }
  }

  const totalEmployeeCapacity = activeEmployees.reduce((sum, e) => sum + (e.maxWeeklyHours || 40), 0);
  const targetHours = Math.min(totalAvailableHours, totalEmployeeCapacity);

  // Fetch existing shifts for the week to respect manually-entered shifts
  // Use 8 days to ensure we capture all Saturday shifts (which may end past midnight UTC)
  const weekEnd = new Date(startDate.getTime() + 8 * 24 * 60 * 60 * 1000);
  const existingShifts = await storage.getShifts(startDate, weekEnd);
  
  // Build maps of existing shift hours and days per employee
  const existingHoursByEmployee = new Map<number, number>();
  const existingDaysByEmployee = new Map<number, { dayIndex: number; shiftType: string; hours: number }[]>();
  
  // Helper to classify shift type based on start time
  function classifyShiftType(startTime: Date, endTime: Date): string {
    const startHour = startTime.getHours();
    const duration = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
    
    if (duration >= 7.5) {
      if (startHour <= 8) return 'opener';
      if (startHour <= 9) return 'mid1';
      if (startHour <= 10) return 'mid2';
      if (startHour <= 11) return 'mid3';
      return 'closer';
    } else if (duration >= 5) {
      if (startHour <= 10) return 'short_open';
      return 'short_close';
    }
    return 'custom';
  }
  
  for (const shift of existingShifts) {
    const shiftStart = new Date(shift.startTime);
    const shiftEnd = new Date(shift.endTime);
    
    // Calculate hours (paid hours, subtracting 30 min lunch for 8+ hour shifts)
    const clockHours = (shiftEnd.getTime() - shiftStart.getTime()) / (1000 * 60 * 60);
    const paidHours = clockHours >= 6 ? clockHours - 0.5 : clockHours;
    
    // Add to employee's existing hours
    const currentHours = existingHoursByEmployee.get(shift.employeeId) || 0;
    existingHoursByEmployee.set(shift.employeeId, currentHours + paidHours);
    
    // Calculate day index (0-6)
    const dayDiff = Math.floor((shiftStart.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
    if (dayDiff >= 0 && dayDiff < 7) {
      const days = existingDaysByEmployee.get(shift.employeeId) || [];
      days.push({ 
        dayIndex: dayDiff, 
        shiftType: classifyShiftType(shiftStart, shiftEnd),
        hours: paidHours 
      });
      existingDaysByEmployee.set(shift.employeeId, days);
    }
  }
  
  // Log existing shifts for debugging
  console.log(`[AI Scheduler] Found ${existingShifts.length} existing shifts for week starting ${weekStartStr}`);
  if (existingShifts.length > 0) {
    existingShifts.forEach(shift => {
      const emp = employees.find(e => e.id === shift.employeeId);
      const shiftDate = new Date(shift.startTime);
      const dayDiff = Math.floor((shiftDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
      console.log(`  - ${emp?.name || 'Unknown'} (ID: ${shift.employeeId}): Day ${dayDiff}, ${shift.startTime} - ${shift.endTime}`);
    });
  }
  
  // Build summary of existing shifts for the AI prompt
  const existingShiftsSummary = (() => {
    const entries: string[] = [];
    existingDaysByEmployee.forEach((days, empId) => {
      const emp = employees.find(e => e.id === empId);
      if (!emp) return;
      const totalHours = existingHoursByEmployee.get(empId) || 0;
      const daysList = days.map(d => `Day ${d.dayIndex} (${d.shiftType}, ${d.hours}h)`).join(', ');
      entries.push(`- ${emp.name} (ID: ${empId}): Pre-filled ${totalHours}h total on: ${daysList}`);
    });
    return entries.length > 0 ? entries.join('\n') : 'None - no pre-filled shifts';
  })();
  
  console.log(`[AI Scheduler] Existing shifts summary for AI:\n${existingShiftsSummary}`);

  const prompt = `You are an expert retail store scheduler. Generate a FULL weekly schedule that MAXIMIZES hour usage.

## CRITICAL GOAL
**MAXIMIZE EACH EMPLOYEE'S HOURS** - Schedule every employee as close to their maxWeeklyHours as possible
**SCHEDULE EVERY EMPLOYEE** - You have ${activeEmployees.length} employees. Each should get shifts up to their max hours.
**PROVIDE VARIETY** - Rotate shift types (opener/mid/closer) among employees. Don't always assign the same person to the same shift type. This ensures fairness - nobody should always get closing shifts.

## Shift Types
### Full Shifts (8.5 clock hours = 8 PAID hours, includes 30-min unpaid lunch)
- **Opener**: 8:00 AM - 4:30 PM (8 paid hours)
- **Mid-Shift 1**: 9:00 AM - 5:30 PM (8 paid hours)
- **Mid-Shift 2**: 10:00 AM - 6:30 PM (8 paid hours)
- **Mid-Shift 3**: 11:00 AM - 7:30 PM (8 paid hours)
- **Closer**: 12:00 PM - 8:30 PM (8 paid hours)

### Short Shifts (5.5 clock hours = 5.5 PAID hours, no lunch break under 6 hours)
- **short_open**: 8:00 AM - 1:30 PM (5.5 paid hours)
- **short_close**: 3:00 PM - 8:30 PM (5.5 paid hours)

### Gap Shifts (5 clock hours = 5 PAID hours, no lunch break)
- **gap_open**: 8:00 AM - 1:00 PM (5 paid hours)
- **gap_close**: 3:30 PM - 8:30 PM (5 paid hours)

### Production Afternoon Shift (4 clock hours = 4 PAID hours, no lunch break)
- **prod_afternoon**: 4:30 PM - 8:30 PM (4 paid hours)
  - Use this for PRODUCTION roles (APPROC, APWV, DONPRI, DONPRWV) to extend station coverage after the morning person leaves
  - Ideal for part-timers who can cover the afternoon at a production station

**PART-TIMER FLEXIBILITY**: Part-timers can work up to 5 days with flexible 4-5.5 hour shifts.
Available shift lengths: Full (8h), Short (5.5h), Gap (5h), Production Afternoon (4h)

## Daily Coverage Requirements (EVERY DAY, 7 days)
- Openers Required: ${settings.openersRequired ?? 2}
- Closers Required: ${settings.closersRequired ?? 2}
- Managers Required: ${settings.managersRequired ?? 1} (one opener, one closer)
- At least 1 Donor Greeter (DONDOOR or WVDON) on opening shift
- At least 1 Donor Greeter (DONDOOR or WVDON) on closing shift
- At least 1 Cashier (CASHSLS or CSHSLSWV) on opening shift
- At least 1 Cashier (CASHSLS or CSHSLSWV) on closing shift
- Fill mid-shifts to maximize coverage and hour usage

## Production Station Limits (MAX employees per day by role)
${(() => {
  // Get station limits from locations being scheduled
  const stationLimits: { location: string; apparelMax: number; donationMax: number }[] = [];
  for (const loc of activeLocations) {
    const apparelMax = loc.apparelProcessorStations ?? 0;
    const donationMax = loc.donationPricingStations ?? 0;
    if (apparelMax > 0 || donationMax > 0) {
      stationLimits.push({ location: loc.name, apparelMax, donationMax });
    }
  }
  if (stationLimits.length === 0) {
    return 'No station limits configured - schedule freely based on hours and coverage needs.';
  }
  return stationLimits.map(s => {
    const limits: string[] = [];
    if (s.apparelMax > 0) limits.push(`Apparel Processors: max ${s.apparelMax}/day`);
    if (s.donationMax > 0) limits.push(`Donation Pricing: max ${s.donationMax}/day`);
    return `- ${s.location}: ${limits.join(', ')}`;
  }).join('\n');
})()}

**IMPORTANT PRODUCTION STATION SCHEDULING STRATEGY**:

## CRITICAL: FRIDAY, SATURDAY, SUNDAY ARE BUSIEST DAYS
These three days (dayIndex 4=Friday, 5=Saturday, 6=Sunday) require MORE production staff than other days of the week. Always schedule more processors on Fri/Sat/Sun.

## TWO-PHASE SCHEDULING FOR PRODUCTION WORKERS:

### PHASE 1: MINIMUM COVERAGE (ALL DAYS)
First, ensure EVERY day of the week (Mon-Sun) has minimum station coverage:
- Schedule at least 1 fulltime Apparel Processor per day (opener shift 8:00 AM - 4:30 PM)
- Schedule at least 1 fulltime Donation Pricer per day (opener shift 8:00 AM - 4:30 PM)
- Cover all 7 days at this minimum level BEFORE adding extra shifts

### PHASE 2: PRIORITY STAFFING (BUSY DAYS FIRST)
After all days have minimum coverage, add additional production shifts in this priority order:
1. **FRIDAY (dayIndex 4)** - Add more processors up to station limit
2. **SATURDAY (dayIndex 5)** - Add more processors up to station limit  
3. **SUNDAY (dayIndex 6)** - Add more processors up to station limit
4. **Monday-Thursday** - Add remaining processors if hours/stations available

### SHIFT TYPES FOR PRODUCTION:
- **Fulltime workers**: OPENER shifts (8:00 AM - 4:30 PM) for morning station coverage
- **Part-time workers**: 
  - OPENER shifts if they can work full shifts
  - **prod_afternoon** shifts (4:30 PM - 8:30 PM) to extend station coverage after fulltime workers leave

### STATION LIMIT RULES:
- Station limit applies to simultaneous workers at any given time, NOT total per day
- A station can be covered by one opener (8-4:30) AND one prod_afternoon worker (4:30-8:30)
- Do NOT schedule more Apparel Processors (APPROC, APWV) than the station limit at the same time
- Do NOT schedule more Donation Pricing/Wares/Shoes Associates (DONPRI, DONPRWV) than the station limit at the same time
- If station limit is 0 or not set, there is no limit

### EXPECTED RESULT:
- Fri/Sat/Sun should have MORE production workers than Mon-Thu
- All days should have at least minimum coverage before any day gets extra staff

## Labor Allocation (percentage of hours by category)
- Cashiering (CASHSLS, CSHSLSWV): ${settings.cashieringPercent ?? 40}%
- Donation Pricing (DONPRI, DONPRWV, APPROC, APWV): ${settings.donationPricingPercent ?? 35}%
- Donor Greeting (DONDOOR, WVDON): ${settings.donorGreetingPercent ?? 25}%

## Job Code Equivalents (West Virginia Weirton variants - treat identically)
- APWV = APPROC (Apparel Processor)
- WVDON = DONDOOR (Donor Greeter)
- CSHSLSWV = CASHSLS (Cashier)
- DONPRWV = DONPRI (Donation Pricing)
- WVSTMNG = STSUPER (Store Manager)
- WVSTAST = STASSTSP (Assistant Manager)
- WVLDWRK = STLDWKR (Team Lead)

## Manager Job Codes
- STSUPER, WVSTMNG (Store Manager)
- STASSTSP, WVSTAST (Assistant Manager)
- STLDWKR, WVLDWRK (Team Lead)

## ALL EMPLOYEES - SCHEDULE EACH ONE (${activeEmployees.length} total)
Note: "Available Hours" = Max Hours minus PAL hours minus Pre-filled hours. Schedule only the Available Hours.

${activeEmployees.map(e => {
  const maxHours = e.maxWeeklyHours || 40;
  const palHours = palHoursByEmployee.get(e.id) || 0;
  const prefilledHours = existingHoursByEmployee.get(e.id) || 0;
  const availableHours = Math.max(0, maxHours - palHours - prefilledHours);
  const existingDays = existingDaysByEmployee.get(e.id) || [];
  const blockedDays = existingDays.map(d => d.dayIndex);
  let notes = '';
  if (palHours > 0) notes += `, PAL: ${palHours}h`;
  if (prefilledHours > 0) notes += `, Pre-filled: ${prefilledHours}h (Days: ${blockedDays.join(',')})`;
  if (notes || palHours > 0 || prefilledHours > 0) notes += `, Available: ${availableHours}h`;
  return `- ID: ${e.id}, Name: ${e.name}, Job: ${e.jobTitle}, Max: ${maxHours}h${notes}, Pref Days: ${e.preferredDaysPerWeek || 5}`;
}).join('\n')}

## APPROVED TIME OFF (Do NOT schedule these employees on these days)

${approvedTimeOff.length > 0 ? approvedTimeOff.map(t => {
  const emp = employees.find(e => e.id === t.employeeId);
  return `- ${emp?.name || 'Unknown'} (ID: ${t.employeeId}): ${t.startDate} to ${t.endDate}`;
}).join('\n') : 'None'}

## PAL (Paid Annual Leave) - Do NOT schedule these employees on these days
PAL hours count toward the employee's weekly hours, so reduce their scheduled work hours accordingly.

${(() => {
  const palEntryList: string[] = [];
  palDaysByEmployee.forEach((days, empId) => {
    const emp = employees.find(e => e.id === empId);
    if (!emp) return;
    days.forEach(d => {
      palEntryList.push(`- ${emp.name} (ID: ${empId}): Day ${d.dayIndex} (${d.date}) - ${d.hours}h PAL - DO NOT SCHEDULE`);
    });
  });
  return palEntryList.length > 0 ? palEntryList.join('\n') : 'None';
})()}

## UNPAID TIME OFF (UTO) - Do NOT schedule these employees on these days
UTO hours do NOT count toward weekly hours, but the employee is unavailable on these days.

${(() => {
  const utoEntryList: string[] = [];
  utoDaysByEmployee.forEach((days, empId) => {
    const emp = employees.find(e => e.id === empId);
    if (!emp) return;
    days.forEach(d => {
      utoEntryList.push(`- ${emp.name} (ID: ${empId}): Day ${d.dayIndex} (${d.date}) - ${d.hours}h UTO - DO NOT SCHEDULE`);
    });
  });
  return utoEntryList.length > 0 ? utoEntryList.join('\n') : 'None';
})()}

## HOLIDAYS (STORE IS CLOSED - DO NOT SCHEDULE ANYONE)
${(() => {
  const weekEnd = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);
  const holidays = getHolidaysInRange(startDate, weekEnd);
  if (holidays.length === 0) return 'None this week';
  return holidays.map(h => {
    const dayIndex = Math.floor((h.date.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
    return `- Day ${dayIndex} (${h.name}): STORE CLOSED - Do NOT schedule anyone`;
  }).join('\n');
})()}

## PRE-FILLED SHIFTS (Already scheduled - DO NOT DUPLICATE or OVERRIDE)
These shifts were manually entered and must be respected. The employee is already scheduled for these shifts.
DO NOT schedule these employees on days they already have shifts. Count their pre-filled hours toward their weekly total.

${existingShiftsSummary}

## SCHEDULING RULES
1. Full shifts = 8 PAID hours, Short shifts = 5.5 PAID hours, Gap shifts = 5 PAID hours
2. **RESPECT PRE-FILLED SHIFTS** - Do NOT schedule employees who already have a shift on a given day
3. **COUNT PRE-FILLED HOURS** - Pre-filled shift hours count toward the employee's weekly total
4. **MAXIMIZE each employee's hours** - Get as close to their Available Hours (maxWeeklyHours minus PAL minus pre-filled hours) as possible!
5. **FULL-TIME EMPLOYEES (maxWeeklyHours >= 32)**: Schedule to fill their Available Hours
   - Example: If employee has 8h PAL and 16h pre-filled shifts, schedule only 16h more work (2 full shifts)
6. **PART-TIME EMPLOYEES** can work up to 5 days with flexible 5+ hour shifts:
   - Use any combination of full (8h), short (5.5h), and gap (5h) shifts to reach Available Hours
   - NEVER exceed Available Hours (maxWeeklyHours minus PAL minus pre-filled)
7. **EVERY employee MUST have AT LEAST 2 days off per week** - This is mandatory (pre-filled days count as work days)
8. **RESPECT preferred days per week** - Each employee has a preferredDaysPerWeek (4 or 5). Pre-filled days count toward this limit.
9. An employee can only work ONE shift per day (no doubles)
10. Never exceed an employee's Available Hours (maxWeeklyHours minus PAL hours minus pre-filled hours)
11. Never schedule someone on approved time off days
12. **NEVER schedule on PAL days** - Employee is on Paid Annual Leave, counts as paid time
13. **NEVER schedule on UTO days** - Employee is on Unpaid Time Off, unavailable
14. **NEVER schedule ANYONE on holidays** - Store is closed on Easter, Thanksgiving, and Christmas
15. Generate shifts for ALL 7 days EXCEPT holidays (Sunday=0 through Saturday=6)
16. STSUPER and WVSTMNG (Store Manager) count as manager coverage for opener/closer requirements

## OUTPUT FORMAT

Respond with a JSON object:
{
  "shifts": [
    {"employeeId": 1, "employeeName": "John Doe", "jobTitle": "CASHSLS", "shiftType": "opener", "dayIndex": 0},
    {"employeeId": 1, "employeeName": "John Doe", "jobTitle": "CASHSLS", "shiftType": "opener", "dayIndex": 1},
    ...
  ],
  "reasoning": "Brief explanation",
  "warnings": ["Any issues"],
  "totalHoursScheduled": 850
}

## IMPORTANT RULES (SUMMARY)
1. **Available Hours = maxWeeklyHours minus PAL hours minus Pre-filled hours**
   - If employee has 8h PAL and 16h pre-filled, schedule only 16h more (2 full shifts)
2. **NEVER schedule employees on days they already have a pre-filled shift** - One shift per day only
3. **FULL-TIME (maxWeeklyHours >= 32)**: Schedule to their Available Hours
4. **PART-TIMERS**: Flexible scheduling - can work 3-5 days with various shift lengths
5. Never exceed an employee's Available Hours
6. **Minimum 2 days off per employee** (pre-filled days count as work days) - No exceptions
7. Never schedule on approved time off, PAL, or UTO days
8. STSUPER and WVSTMNG (Store Manager) count as manager for opening/closing coverage
9. Prioritize manager coverage (one manager opening, one closing each day)
10. Ensure donor greeter and cashier coverage (one opening, one closing each day)
11. An employee should not work both opener AND closer on the same day
12. **RESPECT STATION LIMITS** - Do NOT schedule more Apparel Processors or Donation Pricing Associates per day than the configured station limits
13. **PRODUCTION SCHEDULING PRIORITY** - Fri/Sat/Sun are busiest days. First ensure all days have minimum production coverage, then add extra processors to Fri/Sat/Sun before Mon-Thu`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        { 
          role: "system", 
          content: "You are an expert retail workforce scheduler. You optimize schedules for coverage, fairness, and labor allocation. Always respond with valid JSON."
        },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content || "{}";
    const aiResponse: AIScheduleResponse = JSON.parse(content);

    // Build a set of (employeeId, dayIndex) pairs that already have shifts
    // We will NOT delete existing shifts - only add new ones around them
    const existingShiftDays = new Set<string>();
    for (const shift of existingShifts) {
      const shiftDate = new Date(shift.startTime);
      const dayDiff = Math.floor((shiftDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
      if (dayDiff >= 0 && dayDiff < 7) {
        existingShiftDays.add(`${shift.employeeId}-${dayDiff}`);
      }
    }

    const shiftTimes: Record<string, { startHour: number; startMin: number; endHour: number; endMin: number }> = {
      opener: { startHour: 8, startMin: 0, endHour: 16, endMin: 30 },
      mid1: { startHour: 9, startMin: 0, endHour: 17, endMin: 30 },
      mid2: { startHour: 10, startMin: 0, endHour: 18, endMin: 30 },
      mid3: { startHour: 11, startMin: 0, endHour: 19, endMin: 30 },
      closer: { startHour: 12, startMin: 0, endHour: 20, endMin: 30 },
      short_open: { startHour: 8, startMin: 0, endHour: 13, endMin: 30 },
      short_close: { startHour: 15, startMin: 0, endHour: 20, endMin: 30 },
      gap_open: { startHour: 8, startMin: 0, endHour: 13, endMin: 0 },
      gap_close: { startHour: 15, startMin: 30, endHour: 20, endMin: 30 },
      prod_afternoon: { startHour: 16, startMin: 30, endHour: 20, endMin: 30 },
    };

    const createdShifts = [];
    let skippedDuplicates = 0;
    
    console.log(`[AI Scheduler] existingShiftDays set contains ${existingShiftDays.size} entries:`, Array.from(existingShiftDays));
    
    for (const shift of aiResponse.shifts) {
      // Skip if employee already has a shift on this day (pre-filled)
      const shiftKey = `${shift.employeeId}-${shift.dayIndex}`;
      if (existingShiftDays.has(shiftKey)) {
        const emp = employees.find(e => e.id === shift.employeeId);
        console.log(`[AI Scheduler] Skipping duplicate: ${emp?.name || 'Unknown'} (${shiftKey}) - already has pre-filled shift`);
        skippedDuplicates++;
        continue;
      }
      
      const dayMs = startDate.getTime() + shift.dayIndex * 24 * 60 * 60 * 1000;
      const currentDay = new Date(dayMs);
      
      const times = shiftTimes[shift.shiftType];
      if (!times) continue;

      const shiftStart = createESTTime(currentDay, times.startHour, times.startMin);
      const shiftEnd = createESTTime(currentDay, times.endHour, times.endMin);

      const createdShift = await storage.createShift({
        employeeId: shift.employeeId,
        startTime: shiftStart,
        endTime: shiftEnd,
      });
      createdShifts.push(createdShift);
      
      // Mark this day as now having a shift to prevent duplicates within AI response
      existingShiftDays.add(shiftKey);
    }
    
    if (skippedDuplicates > 0) {
      console.log(`[AI Scheduler] Skipped ${skippedDuplicates} duplicate shifts for employees with pre-filled days`);
    }

    // Include info about preserved pre-filled shifts
    const preservedCount = existingShifts.length;
    let reasoning = aiResponse.reasoning || "Schedule generated successfully";
    if (preservedCount > 0) {
      reasoning = `Preserved ${preservedCount} pre-filled shift(s) and scheduled around them. ${reasoning}`;
    }
    
    return {
      shifts: createdShifts,
      reasoning,
      warnings: aiResponse.warnings || [],
    };
  } catch (error) {
    console.error("AI Scheduler error:", error);
    throw new Error("Failed to generate AI-powered schedule");
  }
}
