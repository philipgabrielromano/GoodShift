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
  shiftType: "opener" | "mid1" | "mid2" | "mid3" | "closer" | "short_open" | "short_close" | "gap_open" | "gap_close";
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

**PART-TIMER FLEXIBILITY**: Part-timers can work up to 5 days with flexible 5+ hour shifts.
Available shift lengths: Full (8h), Short (5.5h), Gap (5h)

## Daily Coverage Requirements (EVERY DAY, 7 days)
- Openers Required: ${settings.openersRequired ?? 2}
- Closers Required: ${settings.closersRequired ?? 2}
- Managers Required: ${settings.managersRequired ?? 1} (one opener, one closer)
- At least 1 Donor Greeter (DONDOOR or WVDON) on opening shift
- At least 1 Donor Greeter (DONDOOR or WVDON) on closing shift
- At least 1 Cashier (CASHSLS or CSHSLSWV) on opening shift
- At least 1 Cashier (CASHSLS or CSHSLSWV) on closing shift
- Fill mid-shifts to maximize coverage and hour usage

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
Note: "Available Hours" = Max Hours minus PAL hours (PAL counts as paid time). Schedule only the Available Hours.

${activeEmployees.map(e => {
  const maxHours = e.maxWeeklyHours || 40;
  const palHours = palHoursByEmployee.get(e.id) || 0;
  const availableHours = Math.max(0, maxHours - palHours);
  const palNote = palHours > 0 ? `, PAL Hours: ${palHours}, Available Hours: ${availableHours}` : '';
  return `- ID: ${e.id}, Name: ${e.name}, Job: ${e.jobTitle}, Max Hours/Week: ${maxHours}${palNote}, Preferred Days/Week: ${e.preferredDaysPerWeek || 5}`;
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

## SCHEDULING RULES
1. Full shifts = 8 PAID hours, Short shifts = 5.5 PAID hours, Gap shifts = 5 PAID hours
2. **MAXIMIZE each employee's hours** - Get as close to their Available Hours (maxWeeklyHours minus PAL) as possible!
3. **FULL-TIME EMPLOYEES (maxWeeklyHours >= 32)**: Schedule to fill their Available Hours (40 minus any PAL hours)
   - Example: If employee has 8h PAL, schedule 32h of regular work (4 full shifts)
4. **PART-TIME EMPLOYEES** can work up to 5 days with flexible 5+ hour shifts:
   - Use any combination of full (8h), short (5.5h), and gap (5h) shifts to reach Available Hours
   - NEVER exceed Available Hours (maxWeeklyHours minus PAL)
5. **EVERY employee MUST have AT LEAST 2 days off per week** - This is mandatory
6. **RESPECT preferred days per week** - Each employee has a preferredDaysPerWeek (4 or 5). Do not exceed this limit.
7. An employee can only work ONE shift per day (no doubles)
8. Never exceed an employee's Available Hours (maxWeeklyHours minus PAL hours)
9. Never schedule someone on approved time off days
10. **NEVER schedule on PAL days** - Employee is on Paid Annual Leave, counts as paid time
11. **NEVER schedule on UTO days** - Employee is on Unpaid Time Off, unavailable
12. **NEVER schedule ANYONE on holidays** - Store is closed on Easter, Thanksgiving, and Christmas
13. Generate shifts for ALL 7 days EXCEPT holidays (Sunday=0 through Saturday=6)
14. STSUPER and WVSTMNG (Store Manager) count as manager coverage for opener/closer requirements

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

## IMPORTANT RULES
1. **FULL-TIME (maxWeeklyHours >= 32)**: Schedule to their Available Hours (40 minus PAL hours)
   - If employee has 8h PAL, schedule only 32h (4 full shifts), NOT 40h
2. **PART-TIMERS**: Flexible scheduling - can work 3-5 days with various shift lengths:
   - Use full (8h), short (5.5h), or gap (5h) shifts to reach their Available Hours
   - Spreading hours across 5 shorter days is allowed and sometimes preferred
3. Never exceed an employee's Available Hours (maxWeeklyHours minus PAL)
4. **Minimum 2 days off per employee** - No exceptions
5. Never schedule an employee on a day they have approved time off
6. **NEVER schedule on PAL or UTO days** - These are blocked days
7. STSUPER and WVSTMNG (Store Manager) count as manager for opening/closing coverage
8. Prioritize manager coverage (one manager opening, one closing each day)
9. Ensure donor greeter coverage (one opening, one closing each day)
10. Ensure cashier coverage (one opening, one closing each day)
11. An employee should not work both opener AND closer on the same day`;

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

    const weekEndMs = startDate.getTime() + 7 * 24 * 60 * 60 * 1000;
    const weekEndDate = new Date(weekEndMs);
    const existingShifts = await storage.getShifts(startDate, weekEndDate);
    for (const shift of existingShifts) {
      await storage.deleteShift(shift.id);
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
    };

    const createdShifts = [];
    for (const shift of aiResponse.shifts) {
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
    }

    return {
      shifts: createdShifts,
      reasoning: aiResponse.reasoning || "Schedule generated successfully",
      warnings: aiResponse.warnings || [],
    };
  } catch (error) {
    console.error("AI Scheduler error:", error);
    throw new Error("Failed to generate AI-powered schedule");
  }
}
