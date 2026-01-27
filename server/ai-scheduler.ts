import OpenAI from "openai";
import { storage } from "./storage";
import { toZonedTime, fromZonedTime } from "date-fns-tz";

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
  
  let employees = await storage.getEmployees();
  const settings = await storage.getGlobalSettings();
  const timeOff = await storage.getTimeOffRequests();
  const locations = await storage.getLocations();

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

  const activeEmployees = employees.filter(e => e.isActive);
  
  const approvedTimeOff = timeOff.filter(t => t.status === "approved");

  const totalEmployeeCapacity = activeEmployees.reduce((sum, e) => sum + (e.maxWeeklyHours || 40), 0);
  const targetHours = Math.min(totalAvailableHours, totalEmployeeCapacity);

  const prompt = `You are an expert retail store scheduler. Generate a FULL weekly schedule that MAXIMIZES hour usage.

## CRITICAL GOAL
**MAXIMIZE EACH EMPLOYEE'S HOURS** - Schedule every employee as close to their maxWeeklyHours as possible
**SCHEDULE EVERY EMPLOYEE** - You have ${activeEmployees.length} employees. Each should get shifts up to their max hours.

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
- At least 1 Donor Greeter (DONDOOR) on opening shift
- At least 1 Donor Greeter (DONDOOR) on closing shift
- At least 1 Cashier (CASHSLS) on opening shift
- At least 1 Cashier (CASHSLS) on closing shift
- Fill mid-shifts to maximize coverage and hour usage

## Labor Allocation (percentage of hours by category)
- Cashiering (CASHSLS): ${settings.cashieringPercent ?? 40}%
- Donation Pricing (DONPRI, APPROC): ${settings.donationPricingPercent ?? 35}%
- Donor Greeting (DONDOOR): ${settings.donorGreetingPercent ?? 25}%

## Manager Job Codes
- STSUPER (Store Manager)
- STASSTSP (Assistant Manager)
- STLDWKR (Team Lead)

## ALL EMPLOYEES - SCHEDULE EACH ONE (${activeEmployees.length} total)

${activeEmployees.map(e => `- ID: ${e.id}, Name: ${e.name}, Job: ${e.jobTitle}, Max Hours/Week: ${e.maxWeeklyHours || 40}`).join('\n')}

## APPROVED TIME OFF (Do NOT schedule these employees on these days)

${approvedTimeOff.length > 0 ? approvedTimeOff.map(t => {
  const emp = employees.find(e => e.id === t.employeeId);
  return `- ${emp?.name || 'Unknown'} (ID: ${t.employeeId}): ${t.startDate} to ${t.endDate}`;
}).join('\n') : 'None'}

## SCHEDULING RULES
1. Full shifts = 8 PAID hours, Short shifts = 5.5 PAID hours, Gap shifts = 5 PAID hours
2. **MAXIMIZE each employee's hours** - Get as close to their maxWeeklyHours as possible!
3. **FULL-TIME EMPLOYEES (maxWeeklyHours >= 32) MUST GET EXACTLY 5 FULL SHIFTS = 40 paid hours**
4. **PART-TIME EMPLOYEES** can work up to 5 days with flexible 5+ hour shifts:
   - Use any combination of full (8h), short (5.5h), and gap (5h) shifts to reach maxWeeklyHours
   - Examples for 29h max: 3x8h + 1x5h = 29h, or 5x5.5h = 27.5h (close to max)
   - Examples for 24h max: 3x8h = 24h, or 4x5.5h + 1x2h = 24h
   - Part-timers don't have to work 4 days with full shifts - they can spread hours across 5 days
   - NEVER exceed maxWeeklyHours - pick the closest combination that stays at or under the limit
5. **EVERY employee MUST have AT LEAST 2 days off per week** - This is mandatory
7. An employee can only work ONE shift per day (no doubles)
8. Never exceed an employee's maxWeeklyHours
9. Never schedule someone on approved time off days
10. Generate shifts for ALL 7 days (Sunday=0 through Saturday=6)
11. STSUPER (Store Manager) counts as manager coverage for opener/closer requirements

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
1. **FULL-TIME (maxWeeklyHours >= 32) = EXACTLY 5 FULL SHIFTS = 40 hours** - No exceptions!
2. **PART-TIMERS**: Flexible scheduling - can work 3-5 days with various shift lengths:
   - Use full (8h), short (5.5h), or gap (5h) shifts to reach their maxWeeklyHours
   - Spreading hours across 5 shorter days is allowed and sometimes preferred
3. Never exceed an employee's maxWeeklyHours
4. **Minimum 2 days off per employee** - No exceptions
6. Never schedule an employee on a day they have approved time off
7. STSUPER (Store Manager) counts as manager for opening/closing coverage
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
