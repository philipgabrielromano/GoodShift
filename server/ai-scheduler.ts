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
  shiftType: "opener" | "mid1" | "mid2" | "mid3" | "closer";
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
**USE AS MANY HOURS AS POSSIBLE** - Target: ${targetHours} hours (Budget: ${totalAvailableHours} hours available)
**SCHEDULE EVERY EMPLOYEE** - You have ${activeEmployees.length} employees. Each should get shifts up to their max hours.

## Shift Types (all shifts are 8.5 hours)
- **Opener**: 8:00 AM - 4:30 PM
- **Mid-Shift 1**: 9:00 AM - 5:30 PM  
- **Mid-Shift 2**: 10:00 AM - 6:30 PM
- **Mid-Shift 3**: 11:00 AM - 7:30 PM
- **Closer**: 12:00 PM - 8:30 PM

## Daily Coverage Requirements (EVERY DAY, 7 days)
- Openers Required: ${settings.openersRequired ?? 2}
- Closers Required: ${settings.closersRequired ?? 2}
- Managers Required: ${settings.managersRequired ?? 1} (one opener, one closer)
- At least 1 Donor Greeter (DONDOOR) on opening shift
- At least 1 Donor Greeter (DONDOOR) on closing shift
- Fill mid-shifts to maximize coverage and hour usage

## Labor Allocation (percentage of hours by category)
- Cashiering (CASHSLS): ${settings.cashieringPercent ?? 40}%
- Donation Pricing (DONPRI, APPROC): ${settings.donationPricingPercent ?? 35}%
- Donor Greeting (DONDOOR): ${settings.donorGreetingPercent ?? 25}%

## Manager Job Codes
- STRSUPER (Store Manager)
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
1. Each shift is 8.5 hours
2. Schedule EVERY employee for shifts up to their maxWeeklyHours
3. Full-time employees (maxWeeklyHours >= 32): Schedule 4-5 shifts per week
4. Part-time employees (maxWeeklyHours < 32): Schedule 2-3 shifts per week
5. An employee can only work ONE shift per day (no doubles)
6. Never exceed an employee's maxWeeklyHours
7. Never schedule someone on approved time off days
8. Generate shifts for ALL 7 days (Sunday=0 through Saturday=6)

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
1. Never exceed an employee's maxWeeklyHours
2. Never schedule an employee on a day they have approved time off
3. Prioritize manager coverage (opening and closing managers each day)
4. Ensure donor greeter coverage (one opening, one closing each day)
5. Distribute shifts fairly among employees
6. Respect labor allocation percentages when possible
7. An employee should not work both opener AND closer on the same day
8. Prefer giving employees consistent shift times when possible`;

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
