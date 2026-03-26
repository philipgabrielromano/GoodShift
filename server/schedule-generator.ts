import { storage } from "./storage";
import { TIMEZONE, createESTTime } from "./middleware";
import { toZonedTime, fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { isHoliday, getPaidHolidaysInRange, isEligibleForPaidHoliday } from "./holidays";
import { RETAIL_JOB_CODES } from "@shared/schema";

export async function generateSchedule(weekStart: string, location?: string): Promise<any[]> {
      const startDate = new Date(weekStart);
      
      const allEmployees = await storage.getEmployees();
      // Filter employees by location if specified
      const employees = location 
        ? allEmployees.filter(e => e.location === location)
        : allEmployees;
      
      console.log(`[Scheduler] Location filter: ${location || 'none'}, Employees: ${employees.length} of ${allEmployees.length}`);
      
      const settings = await storage.getGlobalSettings();
      const timeOff = await storage.getTimeOffRequests();
      const locations = await storage.getLocations();
      
      const selectedLocation = location ? locations.find(l => l.name === location) : null;
      
      // Fetch PAL (Paid Annual Leave) and UTO (Unpaid Time Off) entries for the week
      const weekEndDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = weekEndDate.toISOString().split('T')[0];
      const palEntries = await storage.getPALEntries(startDateStr, endDateStr);
      const utoEntries = await storage.getUnpaidTimeOffEntries(startDateStr, endDateStr);
      
      // Create a map of employeeId -> dates with PAL/UTO for quick lookup
      const employeeByUkgId = new Map(
        allEmployees.filter(e => e.ukgEmployeeId).map(e => [e.ukgEmployeeId, e])
      );
      const paidLeaveByEmpDate = new Set<string>();
      [...palEntries, ...utoEntries].forEach(entry => {
        const employee = employeeByUkgId.get(entry.ukgEmployeeId);
        if (employee) {
          paidLeaveByEmpDate.add(`${employee.id}-${entry.workDate}`);
        }
      });
      console.log(`[Scheduler] Found ${palEntries.length} PAL entries and ${utoEntries.length} UTO entries for the week`);

      // Get existing shifts for the week - we'll preserve these and only fill gaps
      const existingShifts = await storage.getShifts(startDate, weekEndDate);
      console.log(`[Scheduler] Found ${existingShifts.length} existing shifts to preserve`);
      
      // Track which employee-day combinations already have shifts
      const existingShiftsByEmpDay = new Set<string>();
      const existingHoursByEmployee = new Map<number, number>();
      const existingDaysByEmployee = new Map<number, Set<number>>();
      
      // Use timezone-aware calculation for weekStart to match how days are computed elsewhere
      const weekStartZoned = toZonedTime(startDate, TIMEZONE);
      const weekStartDay = weekStartZoned.getDate();
      const weekStartMonth = weekStartZoned.getMonth();
      const weekStartYear = weekStartZoned.getFullYear();
      
      for (const shift of existingShifts) {
        // Convert shift start time to Eastern timezone for accurate day calculation
        const shiftStartZoned = toZonedTime(new Date(shift.startTime), TIMEZONE);
        
        // Calculate day index based on calendar day in Eastern timezone
        // This is more accurate than raw millisecond math which can be off due to DST
        const shiftDay = shiftStartZoned.getDate();
        const shiftMonth = shiftStartZoned.getMonth();
        const shiftYear = shiftStartZoned.getFullYear();
        
        // Calculate days since week start
        const weekStartDate = new Date(weekStartYear, weekStartMonth, weekStartDay);
        const shiftDateOnly = new Date(shiftYear, shiftMonth, shiftDay);
        const dayIndex = Math.round((shiftDateOnly.getTime() - weekStartDate.getTime()) / (24 * 60 * 60 * 1000));
        
        if (dayIndex >= 0 && dayIndex < 7) {
          const key = `${shift.employeeId}-${dayIndex}`;
          existingShiftsByEmpDay.add(key);
          
          // Calculate hours for this shift
          const hours = (new Date(shift.endTime).getTime() - new Date(shift.startTime).getTime()) / (1000 * 60 * 60);
          const paidHours = hours >= 6 ? hours - 0.5 : hours; // Subtract unpaid lunch for 6+ hour shifts
          
          const currentHours = existingHoursByEmployee.get(shift.employeeId) || 0;
          existingHoursByEmployee.set(shift.employeeId, currentHours + paidHours);
          
          const currentDays = existingDaysByEmployee.get(shift.employeeId) || new Set<number>();
          currentDays.add(dayIndex);
          existingDaysByEmployee.set(shift.employeeId, currentDays);
        }
      }
      
      // Helper to count existing shifts for a role on a specific day
      // Used to recognize template-applied shifts as coverage
      const countExistingShiftsForRole = (roleEmployeeIds: number[], dayIndex: number): number => {
        let count = 0;
        for (const empId of roleEmployeeIds) {
          const key = `${empId}-${dayIndex}`;
          if (existingShiftsByEmpDay.has(key)) {
            count++;
          }
        }
        return count;
      };
      
      // Collect shifts in memory first, then batch insert at the end for performance
      const pendingShifts: { employeeId: number; startTime: Date; endTime: Date }[] = [];

      // ========== RANDOMIZATION FOR SHIFT VARIETY ==========
      // Helper to pick a random element from an array
      const randomPick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

      // Fisher-Yates shuffle to randomize employee order each generation
      // This ensures employees don't always get the same shifts (opener vs closer)
      const shuffleArray = <T>(array: T[]): T[] => {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
      };

      const FULL_SHIFT_HOURS = 8; // 8.5 clock hours - 0.5 unpaid lunch = 8 paid hours
      const SHORT_SHIFT_HOURS = 5.5; // 5.5 clock hours - NO lunch deduction (less than 6 hours)
      const GAP_SHIFT_HOURS = 5; // 5 clock hours = 5 paid hours (under 6h, no lunch deduction)
      const PROD_AFTERNOON_HOURS = 4; // 4 clock hours = 4 paid hours (production afternoon shift)
      
      // ========== EMPLOYEE STATE TRACKING ==========
      const employeeState: Record<number, {
        hoursScheduled: number;
        daysWorked: number;
        daysWorkedOn: Set<number>; // Track which day indices they work
      }> = {};
      
      // Calculate PAL hours per employee for the week (PAID leave only)
      // Note: totalHours in the database is stored in MINUTES, so we convert to hours
      // IMPORTANT: UTO (unpaid time off) does NOT count toward weekly hours - those days are just blocked
      const palHoursByEmployee = new Map<number, number>();
      palEntries.forEach(entry => {
        const employee = employeeByUkgId.get(entry.ukgEmployeeId);
        if (employee && entry.totalHours) {
          const current = palHoursByEmployee.get(employee.id) || 0;
          const hoursFromMinutes = entry.totalHours / 60; // Convert minutes to hours
          palHoursByEmployee.set(employee.id, current + hoursFromMinutes);
        }
      });
      
      // Calculate paid holidays in the scheduling week
      const paidHolidaysInWeek = getPaidHolidaysInRange(startDate, weekEndDate);
      if (paidHolidaysInWeek.length > 0) {
        console.log(`[Scheduler] Paid holidays in week: ${paidHolidaysInWeek.map(h => h.name).join(', ')}`);
      }
      
      employees.forEach(emp => {
        // Initialize with PAL hours already counted toward weekly total
        const palHours = palHoursByEmployee.get(emp.id) || 0;
        
        // Calculate paid holiday hours for eligible full-time employees (30+ days service)
        let paidHolidayHours = 0;
        for (const holiday of paidHolidaysInWeek) {
          if (isEligibleForPaidHoliday(emp.hireDate, holiday.date, emp.employmentType)) {
            paidHolidayHours += 8;
          }
        }
        
        // Include existing shift hours and days in the pre-counted totals
        const existingHours = existingHoursByEmployee.get(emp.id) || 0;
        const existingDays = existingDaysByEmployee.get(emp.id) || new Set<number>();
        
        // Pre-count PAL hours, paid holiday hours, AND existing shift hours
        const preCountedHours = palHours + paidHolidayHours + existingHours;
        employeeState[emp.id] = { 
          hoursScheduled: preCountedHours, 
          daysWorked: existingDays.size, 
          daysWorkedOn: new Set(existingDays) 
        };
        
        const parts = [];
        if (palHours > 0) parts.push(`${palHours.toFixed(1)} PAL`);
        if (paidHolidayHours > 0) parts.push(`${paidHolidayHours} holiday`);
        if (existingHours > 0) parts.push(`${existingHours.toFixed(1)} existing`);
        if (parts.length > 0) {
          console.log(`[Scheduler] ${emp.name}: ${parts.join(' + ')} hours pre-counted (total: ${preCountedHours.toFixed(1)})`);
        }
      });

      // ========== HELPER FUNCTIONS ==========
      // Day names array: index 0 = Sunday (matching dayIndex from weekStart which is always Sunday)
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      
      const isOnTimeOff = (empId: number, day: Date, dayIndex: number) => {
        // Check if employee already has an existing shift on this day (preserve manual assignments)
        const existingKey = `${empId}-${dayIndex}`;
        if (existingShiftsByEmpDay.has(existingKey)) return true;
        
        // Check approved time-off requests
        const hasApprovedTimeOff = timeOff.some(to => 
          to.employeeId === empId && 
          to.status === "approved" && 
          new Date(to.startDate) <= day && 
          new Date(to.endDate) >= day
        );
        if (hasApprovedTimeOff) return true;
        
        // Check PAL/UTO entries from UKG
        const dayStr = day.toISOString().split('T')[0];
        const hasPaidLeave = paidLeaveByEmpDate.has(`${empId}-${dayStr}`);
        if (hasPaidLeave) return true;
        
        // Check non-working days configuration using dayIndex (0=Sunday, 1=Monday, etc.)
        // This avoids timezone issues with day.getDay() since weekStart is always a Sunday
        const emp = employees.find(e => e.id === empId);
        if (emp?.nonWorkingDays && emp.nonWorkingDays.length > 0) {
          const dayName = dayNames[dayIndex];
          if (emp.nonWorkingDays.includes(dayName)) return true;
        }
        
        return false;
      };
      
      // Get max days per week for an employee (uses preferred setting, defaults to 5)
      const getMaxDays = (emp: typeof employees[0]) => emp.preferredDaysPerWeek || 5;
      
      // Check if employee can work a full 8-hour shift
      const canWorkFullShift = (emp: typeof employees[0], day: Date, dayIndex: number) => {
        const state = employeeState[emp.id];
        if (!emp.isActive) return false;
        if (isOnTimeOff(emp.id, day, dayIndex)) return false;
        if (state.hoursScheduled + FULL_SHIFT_HOURS > emp.maxWeeklyHours) return false;
        if (state.daysWorked >= getMaxDays(emp)) return false; // Respect preferred days setting
        if (state.daysWorkedOn.has(dayIndex)) return false; // Already working this day
        return true;
      };
      
      // Check if employee can work a short 5.5-hour shift
      const canWorkShortShift = (emp: typeof employees[0], day: Date, dayIndex: number) => {
        const state = employeeState[emp.id];
        if (!emp.isActive) return false;
        if (isOnTimeOff(emp.id, day, dayIndex)) return false;
        if (state.hoursScheduled + SHORT_SHIFT_HOURS > emp.maxWeeklyHours) return false;
        if (state.daysWorked >= getMaxDays(emp)) return false;
        if (state.daysWorkedOn.has(dayIndex)) return false;
        return true;
      };
      
      // Check if employee can work ANY shift (including shorter shifts to fill remaining hours)
      const canWorkAnyShift = (emp: typeof employees[0], day: Date, dayIndex: number) => {
        const state = employeeState[emp.id];
        if (!emp.isActive) return false;
        if (isOnTimeOff(emp.id, day, dayIndex)) return false;
        if (state.hoursScheduled >= emp.maxWeeklyHours) return false; // Already maxed
        if (state.daysWorked >= getMaxDays(emp)) return false;
        if (state.daysWorkedOn.has(dayIndex)) return false;
        return true;
      };
      
      // Check if employee can work a 5-hour gap shift (for filling remaining hours)
      const canWorkGapShift = (emp: typeof employees[0], day: Date, dayIndex: number) => {
        const state = employeeState[emp.id];
        if (!emp.isActive) return false;
        if (isOnTimeOff(emp.id, day, dayIndex)) return false;
        if (state.hoursScheduled + GAP_SHIFT_HOURS > emp.maxWeeklyHours) return false;
        if (state.daysWorked >= getMaxDays(emp)) return false;
        if (state.daysWorkedOn.has(dayIndex)) return false;
        return true;
      };
      
      // Check if employee can work a 4-hour production afternoon shift
      const canWorkProdAfternoonShift = (emp: typeof employees[0], day: Date, dayIndex: number) => {
        const state = employeeState[emp.id];
        if (!emp.isActive) return false;
        if (isOnTimeOff(emp.id, day, dayIndex)) return false;
        if (state.hoursScheduled + PROD_AFTERNOON_HOURS > emp.maxWeeklyHours) return false;
        if (state.daysWorked >= getMaxDays(emp)) return false;
        if (state.daysWorkedOn.has(dayIndex)) return false;
        return true;
      };
      
      // Is this employee a part-timer? (less than 32 max hours)
      const isPartTime = (emp: typeof employees[0]) => emp.maxWeeklyHours < 32;
      
      // Get remaining hours an employee can work
      const getRemainingHours = (emp: typeof employees[0]) => {
        return emp.maxWeeklyHours - employeeState[emp.id].hoursScheduled;
      };
      
      // Calculate best shift type for part-timer to maximize hours
      // OPTIMAL STRATEGY: Calculate what shift combination maximizes total hours
      // Then use that to guide each day's decision
      const getBestShiftForPartTimer = (emp: typeof employees[0], day: Date, dayIndex: number, shifts: ReturnType<typeof getShiftTimes>) => {
        const remaining = getRemainingHours(emp);
        const state = employeeState[emp.id];
        const maxDays = getMaxDays(emp);
        const daysRemaining = maxDays - state.daysWorked;
        
        // Helper to get appropriate shift time based on job
        // Uses job code constants defined in the outer scope
        const getFullShift = () => {
          if (donationPricerCodes.includes(emp.jobTitle)) return shifts.opener;
          else if (donorGreeterCodes.includes(emp.jobTitle)) return shifts.closer;
          else return shifts.mid10;
        };
        
        const getShortShift = () => {
          if (donationPricerCodes.includes(emp.jobTitle)) return shifts.shortMorning;
          else if (donorGreeterCodes.includes(emp.jobTitle)) {
            // Rotate greeter short shifts for variety: 10-3:30, 12-5:30, 3-8:30
            const greeterShortOptions = [shifts.shortMid10, shifts.shortMid12, shifts.shortEvening];
            const rotationIndex = (state.daysWorked + emp.id) % greeterShortOptions.length;
            return greeterShortOptions[rotationIndex];
          }
          else return shifts.shortMid;
        };
        
        const getGapShift = () => {
          if (donationPricerCodes.includes(emp.jobTitle)) return shifts.gapMorning;
          else if (donorGreeterCodes.includes(emp.jobTitle)) return shifts.gapEvening;
          else return shifts.gapMid;
        };
        
        // OPTIMAL SHIFT CALCULATION
        // Find the best combination of full (8h), short (5.5h), and gap (5h) shifts
        // that maximizes hours while respecting days limit
        const calculateOptimalPlan = (hours: number, days: number) => {
          let bestPlan = { full: 0, short: 0, gap: 0, total: 0 };
          
          // Try all combinations of full shifts (0 to maxFull)
          const maxFull = Math.min(days, Math.floor(hours / FULL_SHIFT_HOURS));
          
          for (let fullCount = 0; fullCount <= maxFull; fullCount++) {
            const hoursAfterFull = hours - (fullCount * FULL_SHIFT_HOURS);
            const daysAfterFull = days - fullCount;
            
            // Try all combinations of short shifts with remaining days
            const maxShort = Math.min(daysAfterFull, Math.floor(hoursAfterFull / SHORT_SHIFT_HOURS));
            
            for (let shortCount = 0; shortCount <= maxShort; shortCount++) {
              const hoursAfterShort = hoursAfterFull - (shortCount * SHORT_SHIFT_HOURS);
              const daysAfterShort = daysAfterFull - shortCount;
              
              // Use gap shifts for remainder if possible
              const maxGap = Math.min(daysAfterShort, Math.floor(hoursAfterShort / GAP_SHIFT_HOURS));
              const gapCount = maxGap;
              
              const total = (fullCount * FULL_SHIFT_HOURS) + 
                           (shortCount * SHORT_SHIFT_HOURS) + 
                           (gapCount * GAP_SHIFT_HOURS);
              
              if (total > bestPlan.total && total <= hours) {
                bestPlan = { full: fullCount, short: shortCount, gap: gapCount, total };
              }
            }
          }
          
          return bestPlan;
        };
        
        const optimalPlan = calculateOptimalPlan(remaining, daysRemaining);
        
        // Based on optimal plan, decide what shift to use NOW
        // Priority: If we still need full shifts in the plan, use full shift
        // Then short shifts, then gap shifts
        
        const fullsStillNeeded = optimalPlan.full;
        const shortsStillNeeded = optimalPlan.short;
        const gapsStillNeeded = optimalPlan.gap;
        
        // Use full shift if plan calls for it and we can
        if (fullsStillNeeded > 0 && canWorkFullShift(emp, day, dayIndex)) {
          return getFullShift();
        }
        
        // Use short shift if plan calls for it and we can
        if (shortsStillNeeded > 0 && canWorkShortShift(emp, day, dayIndex)) {
          return getShortShift();
        }
        
        // Use gap shift if plan calls for it and we can
        if (gapsStillNeeded > 0 && canWorkGapShift(emp, day, dayIndex)) {
          return getGapShift();
        }
        
        // Fallback: try any available shift type in order of efficiency
        if (remaining >= FULL_SHIFT_HOURS && canWorkFullShift(emp, day, dayIndex)) {
          return getFullShift();
        }
        
        if (remaining >= SHORT_SHIFT_HOURS && canWorkShortShift(emp, day, dayIndex)) {
          return getShortShift();
        }
        
        if (remaining >= GAP_SHIFT_HOURS && canWorkGapShift(emp, day, dayIndex)) {
          return getGapShift();
        }
        
        return null;
      };
      
      // Priority score: lower = should schedule first (employees needing more hours)
      const getEmployeePriority = (emp: typeof employees[0]) => {
        const state = employeeState[emp.id];
        const hoursRemaining = emp.maxWeeklyHours - state.hoursScheduled;
        const daysRemaining = getMaxDays(emp) - state.daysWorked;
        // Prioritize: more hours remaining, fewer days already worked
        return -(hoursRemaining * 10 + daysRemaining);
      };

      // Calculate paid hours from a shift (subtract 0.5 for lunch if 6+ hours)
      const calculateShiftPaidHours = (startTime: Date, endTime: Date) => {
        const clockHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
        return clockHours >= 6 ? clockHours - 0.5 : clockHours;
      };

      const scheduleShift = (emp: typeof employees[0], startTime: Date, endTime: Date, dayIndex: number) => {
        const paidHours = calculateShiftPaidHours(startTime, endTime);
        // Collect shift data in memory (will batch insert at the end)
        pendingShifts.push({ 
          employeeId: emp.id, 
          startTime, 
          endTime 
        });
        employeeState[emp.id].hoursScheduled += paidHours;
        employeeState[emp.id].daysWorked++;
        employeeState[emp.id].daysWorkedOn.add(dayIndex);
        return { paidHours };
      };

      // ========== CATEGORIZE EMPLOYEES ==========
      // Include both standard and WV (Weirton) job codes
      // Leadership positions are tiered for flexible coverage:
      // - Tier 1: Store Manager (STSUPER/WVSTMNG) - highest priority
      // - Tier 2: Assistant Manager (STASSTSP/WVSTAST) - second priority
      // - Tier 3: Team Lead (STLDWKR/WVLDWRK) - can fill in when higher tiers unavailable
      const storeManagerCodes = ['STSUPER', 'WVSTMNG'];
      const assistantManagerCodes = ['STASSTSP', 'WVSTAST'];
      const teamLeadCodes = ['STLDWKR', 'WVLDWRK'];
      const allLeadershipCodes = [...storeManagerCodes, ...assistantManagerCodes, ...teamLeadCodes];
      
      const donorGreeterCodes = ['DONDOOR', 'WVDON'];
      const donationPricerCodes = ['DONPRI', 'DONPRWV']; // Donation pricers only
      const apparelProcessorCodes = ['APPROC', 'APWV']; // Apparel processors only
      const cashierCodes = ['CASHSLS', 'CSHSLSWV', 'SLSFLR'];
      
      // Categorize leadership by tier
      const storeManagers = employees.filter(emp => storeManagerCodes.includes(emp.jobTitle) && emp.isActive);
      const assistantManagers = employees.filter(emp => assistantManagerCodes.includes(emp.jobTitle) && emp.isActive);
      const teamLeads = employees.filter(emp => teamLeadCodes.includes(emp.jobTitle) && emp.isActive);
      
      // Combined leadership pool (all tiers) - used for flexible coverage
      const managers = employees.filter(emp => allLeadershipCodes.includes(emp.jobTitle) && emp.isActive);
      const donorGreeters = employees.filter(emp => donorGreeterCodes.includes(emp.jobTitle) && emp.isActive);
      const donationPricers = employees.filter(emp => donationPricerCodes.includes(emp.jobTitle) && emp.isActive);
      const apparelProcessors = employees.filter(emp => apparelProcessorCodes.includes(emp.jobTitle) && emp.isActive);
      const cashiers = employees.filter(emp => cashierCodes.includes(emp.jobTitle) && emp.isActive);
      
      console.log(`[Scheduler] Total employees: ${employees.length}`);
      console.log(`[Scheduler] Leadership breakdown - Store Mgrs: ${storeManagers.length}, Asst Mgrs: ${assistantManagers.length}, Team Leads: ${teamLeads.length}`);
      console.log(`[Scheduler] Other roles - Greeters: ${donorGreeters.length}, Pricers: ${donationPricers.length}, Apparel: ${apparelProcessors.length}, Cashiers: ${cashiers.length}`);
      
      // ========== SHIFT TIME DEFINITIONS ==========
      const getShiftTimes = (day: Date) => {
        const dayOfWeek = day.getDay(); // 0 = Sunday
        const isSunday = dayOfWeek === 0;
        
        // Sunday openers start at 10am instead of 8am
        const openerStart = isSunday ? 10 : 8;
        
        return {
          // Full 8-hour shifts (8.5 clock hours)
          opener: { start: createESTTime(day, openerStart, 0), end: createESTTime(day, openerStart + 8, 30) },
          early9: isSunday
            ? { start: createESTTime(day, 10, 0), end: createESTTime(day, 18, 30) }
            : { start: createESTTime(day, 9, 0), end: createESTTime(day, 17, 30) },
          mid10: { start: createESTTime(day, 10, 0), end: createESTTime(day, 18, 30) },
          mid11: { start: createESTTime(day, 11, 0), end: createESTTime(day, 19, 30) },
          // Sunday closes at 7:30pm, so closer is 11am-7:30pm instead of 12pm-8:30pm
          closer: isSunday 
            ? { start: createESTTime(day, 11, 0), end: createESTTime(day, 19, 30) }
            : { start: createESTTime(day, 12, 0), end: createESTTime(day, 20, 30) },
          // Short 5.5-hour shifts (5.5 clock hours) for PT employees
          shortMorning: { start: createESTTime(day, openerStart, 0), end: createESTTime(day, openerStart + 5, 30) },
          shortMid: { start: createESTTime(day, 11, 0), end: createESTTime(day, 16, 30) },
          // Greeter short shift varieties for better coverage spread
          shortMid10: { start: createESTTime(day, 10, 0), end: createESTTime(day, 15, 30) }, // 10-3:30
          shortMid12: isSunday
            ? { start: createESTTime(day, 12, 0), end: createESTTime(day, 17, 30) } // 12-5:30 (fits Sunday close)
            : { start: createESTTime(day, 12, 0), end: createESTTime(day, 17, 30) }, // 12-5:30
          // Sunday short evening ends at 7:30pm
          shortEvening: isSunday
            ? { start: createESTTime(day, 14, 0), end: createESTTime(day, 19, 30) }
            : { start: createESTTime(day, 15, 0), end: createESTTime(day, 20, 30) },
          // Gap-filling 5-hour shifts (5 clock hours = 5 paid hours, no lunch)
          gapMorning: { start: createESTTime(day, openerStart, 0), end: createESTTime(day, openerStart + 5, 0) },
          gapMid: { start: createESTTime(day, 11, 0), end: createESTTime(day, 16, 0) },
          gapEvening: isSunday
            ? { start: createESTTime(day, 14, 30), end: createESTTime(day, 19, 30) }
            : { start: createESTTime(day, 15, 30), end: createESTTime(day, 20, 30) },
          // Production Afternoon Shift (4 clock hours = 4 paid hours, no lunch)
          prodAfternoon: isSunday
            ? { start: createESTTime(day, 15, 30), end: createESTTime(day, 19, 30) } // Sunday closes at 7:30
            : { start: createESTTime(day, 16, 30), end: createESTTime(day, 20, 30) }
        };
      };

      // ========== DAILY COVERAGE REQUIREMENTS ==========
      const managersRequired = settings.managersRequired ?? 1;
      const openersRequired = settings.openersRequired ?? 2;
      const closersRequired = settings.closersRequired ?? 2;

      // Day weights: Sat/Fri get more staff, but all days get coverage
      // RANDOMIZE day order to prevent same managers always working same days
      // This ensures managers don't always hit their max hours before Wed/Thu
      const baseDayOrder = [0, 1, 2, 3, 4, 5, 6]; // Sun through Sat
      const dayOrder = shuffleArray(baseDayOrder); // Randomize processing order
      console.log(`[Scheduler] Day processing order (randomized): ${dayOrder.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}`);

      const dayMultiplier: Record<number, number> = {
        6: 1.3, // Saturday - 30% more staff
        5: 1.3, // Friday - 30% more staff  
        0: 1.0, 1: 1.0, 2: 1.0, 3: 1.0, 4: 1.0 // Weekdays - baseline
      };
      
      // Standard day order for priority scheduling: Saturday first (busiest), then Fri, Sun, Mon...
      const saturdayFirstOrder = [6, 5, 0, 1, 2, 3, 4];
      
      // Short day names for logging (distinct from dayNames used for nonWorkingDays matching)
      const shortDayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

      // ========== PHASE 1: MANDATORY COVERAGE (All 7 days except holidays) ==========
      // First pass: ensure every day has minimum required coverage
      // IMPORTANT: Use ROUND-ROBIN for cashiers to ensure Wed/Thu get coverage before employees hit max days
      // Process managers/greeters/pricers in priority order (Sat/Fri first)
      // Process cashiers using round-robin across all days

      // Helper to sort employees: full-timers first, then by priority
      // Note: We use shuffleArray BEFORE sorting to randomize among equal-priority employees
      // This provides shift variety - employees won't always get the same shifts
      const sortFullTimersFirst = (a: typeof employees[0], b: typeof employees[0]) => {
        // Full-timers (>= 32h) should come before part-timers
        const aIsFullTime = a.maxWeeklyHours >= 32;
        const bIsFullTime = b.maxWeeklyHours >= 32;
        if (aIsFullTime && !bIsFullTime) return -1;
        if (!aIsFullTime && bIsFullTime) return 1;
        // If same type, sort by priority
        const priorityDiff = getEmployeePriority(a) - getEmployeePriority(b);
        return priorityDiff;
        // No tie-breaker - the pre-shuffle provides randomness for equal priority employees
      };
      
      // Helper to shuffle and then sort - provides variety while respecting priorities
      const shuffleAndSort = (empList: typeof employees) => {
        return shuffleArray(empList).sort(sortFullTimersFirst);
      };

      // For production workers: sort by fewest days already scheduled this week so that
      // shifts are distributed as evenly as possible across all 7 days.
      // Tiebreaker: full-timers before part-timers.
      const sortByFewestProdShifts = (empList: typeof employees) => {
        return empList.slice().sort((a, b) => {
          const aDays = employeeState[a.id].daysWorked;
          const bDays = employeeState[b.id].daysWorked;
          if (aDays !== bDays) return aDays - bDays;
          return sortFullTimersFirst(a, b);
        });
      };

      // Shift preference enforcement:
      //   morning_only  → shift must start at 8 or 9 AM on weekdays (opener/early9),
      //                   or 10 AM on Sundays (the earliest possible Sunday slot).
      //   evening_only  → shift must start at 10 AM or later (mid10, mid11, closer).
      //   null / no_preference → no restriction.
      const matchesShiftPreference = (emp: typeof employees[0], shiftStart: Date, dayIndex: number): boolean => {
        const pref = emp.shiftPreference;
        if (!pref || pref === 'no_preference') return true;
        const startHour = shiftStart.getHours();
        if (pref === 'morning_only') {
          // Allow opener (8am) and early9 (9am) on weekdays; allow Sunday opener (10am = earliest)
          return startHour <= 9 || (dayIndex === 0 && startHour === 10);
        }
        if (pref === 'evening_only') {
          // Allow mid10 (10am), mid11 (11am), closer (12pm), Sunday closer (11am)
          return startHour >= 10;
        }
        // 'fixed_shift' employees are excluded from all regular pools (handled in the pre-pass above)
        return true;
      };

      // ========== PRE-PASS: FIXED-SHIFT EMPLOYEES ==========
      // These employees always get their exact configured start/end times.
      // We write into existingShiftsByEmpDay after each scheduled day so that:
      //   (a) isOnTimeOff() prevents any regular pass from double-booking them
      //   (b) the leadership coverage tracker below can see their days and
      //       determine the correct opener/closer/mid slot they fill.
      {
        const fixedEmps = employees.filter(
          e => e.shiftPreference === 'fixed_shift' && e.fixedShiftStart && e.fixedShiftEnd && e.isActive
        );
        if (fixedEmps.length > 0) {
          console.log(`[Scheduler] Pre-pass: scheduling ${fixedEmps.length} fixed-shift employee(s)`);
          for (const emp of fixedEmps) {
            const [fStartH, fStartM] = emp.fixedShiftStart!.split(':').map(Number);
            const [fEndH, fEndM] = emp.fixedShiftEnd!.split(':').map(Number);
            const fixedShiftPaidHours = calculateShiftPaidHours(
              createESTTime(startDate, fStartH, fStartM),
              createESTTime(startDate, fEndH, fEndM)
            );
            let daysScheduled = 0;
            for (let d = 0; d < 7; d++) {
              if (daysScheduled >= getMaxDays(emp)) break;
              if (employeeState[emp.id].hoursScheduled + fixedShiftPaidHours > emp.maxWeeklyHours) {
                console.log(`[Scheduler] Fixed-shift: ${emp.name} → Day ${d} SKIPPED (would exceed ${emp.maxWeeklyHours}h max)`);
                break;
              }
              const currentDay = new Date(startDate.getTime() + d * 24 * 60 * 60 * 1000);
              if (isHoliday(currentDay)) continue;
              if (isOnTimeOff(emp.id, currentDay, d)) continue;
              scheduleShift(emp, createESTTime(currentDay, fStartH, fStartM), createESTTime(currentDay, fEndH, fEndM), d);
              existingShiftsByEmpDay.add(`${emp.id}-${d}`);
              daysScheduled++;
              console.log(`[Scheduler] Fixed-shift: ${emp.name} → Day ${d} ${emp.fixedShiftStart}–${emp.fixedShiftEnd} (${employeeState[emp.id].hoursScheduled.toFixed(1)}h total)`);
            }
          }
        }
      }

      // ========== LEADERSHIP SCHEDULING - TWO-PASS APPROACH ==========
      // Pass 1: Ensure EVERY day gets at least one higher-tier manager (store mgr or asst mgr)
      // Pass 2: Add second manager and team leads for full coverage
      // This prevents managers from hitting their 5-day max before all days are covered
      // IMPORTANT: Recognize existing template shifts as fulfilling coverage requirements
      
      // Track coverage per day for leadership
      // openerTier/closerTier: 'higher' = store mgr or asst mgr, 'teamlead' = team lead only, false = unfilled
      const leadershipCoverage: Record<number, { 
        opener: boolean; closer: boolean; mid: boolean; hasHigherTier: boolean;
        openerTier: 'higher' | 'teamlead' | false;
        closerTier: 'higher' | 'teamlead' | false;
      }> = {};
      for (let d = 0; d < 7; d++) {
        leadershipCoverage[d] = { opener: false, closer: false, mid: false, hasHigherTier: false, openerTier: false, closerTier: false };
      }
      
      // Get all higher-tier managers (store managers and assistant managers)
      const allHigherTierManagers = shuffleArray(
        managers.filter(m => 
          (storeManagerCodes.includes(m.jobTitle) || assistantManagerCodes.includes(m.jobTitle)) && m.isActive
        )
      );
      const allTeamLeads = shuffleArray(
        managers.filter(m => teamLeadCodes.includes(m.jobTitle) && m.isActive)
      );
      
      // Build ID arrays for existing shift lookup
      const higherTierIds = allHigherTierManagers.map(m => m.id);
      const teamLeadIds = allTeamLeads.map(m => m.id);
      const allManagerIds = managers.map(m => m.id);

      // Fixed-shift managers are handled separately below with their actual slot times.
      // Exclude them from the generic template coverage check so we don't accidentally
      // mark the wrong slot as covered.
      const fixedShiftMgrIds = new Set(
        [...allHigherTierManagers, ...allTeamLeads]
          .filter(m => m.shiftPreference === 'fixed_shift' && m.fixedShiftStart)
          .map(m => m.id)
      );
      const nonFixedHigherTierIds = higherTierIds.filter(id => !fixedShiftMgrIds.has(id));
      const nonFixedTeamLeadIds = teamLeadIds.filter(id => !fixedShiftMgrIds.has(id));
      
      // Check for existing leadership shifts from manually placed (template) shifts
      for (let d = 0; d < 7; d++) {
        const existingHigherTier = countExistingShiftsForRole(nonFixedHigherTierIds, d);
        const existingTeamLeads = countExistingShiftsForRole(nonFixedTeamLeadIds, d);
        
        if (existingHigherTier > 0) {
          leadershipCoverage[d].hasHigherTier = true;
          // We don't know the exact slot from a template shift, so conservatively mark opener
          leadershipCoverage[d].opener = true;
          leadershipCoverage[d].openerTier = 'higher';
          console.log(`[Scheduler] Day ${d}: Found ${existingHigherTier} existing higher-tier template shift(s)`);
        }
        if (existingTeamLeads > 0) {
          // Infer slot from actual shift start times in the template data
          for (const empId of nonFixedTeamLeadIds) {
            if (!existingShiftsByEmpDay.has(`${empId}-${d}`)) continue;
            const shift = existingShifts.find(s => {
              if (s.employeeId !== empId) return false;
              const sZoned = toZonedTime(new Date(s.startTime), TIMEZONE);
              const sDate = new Date(sZoned.getFullYear(), sZoned.getMonth(), sZoned.getDate());
              const wDate = new Date(weekStartYear, weekStartMonth, weekStartDay);
              return Math.round((sDate.getTime() - wDate.getTime()) / (24*60*60*1000)) === d;
            });
            if (shift) {
              const startH = toZonedTime(new Date(shift.startTime), TIMEZONE).getHours();
              if (startH <= 9 || (d === 0 && startH === 10)) {
                if (!leadershipCoverage[d].opener) {
                  leadershipCoverage[d].opener = true;
                  if (leadershipCoverage[d].openerTier !== 'higher') leadershipCoverage[d].openerTier = 'teamlead';
                }
              } else if (startH >= 11) {
                if (!leadershipCoverage[d].closer) {
                  leadershipCoverage[d].closer = true;
                  if (leadershipCoverage[d].closerTier !== 'higher') leadershipCoverage[d].closerTier = 'teamlead';
                }
              }
            } else {
              // Can't determine slot, mark opener conservatively
              if (!leadershipCoverage[d].opener) {
                leadershipCoverage[d].opener = true;
                if (leadershipCoverage[d].openerTier !== 'higher') leadershipCoverage[d].openerTier = 'teamlead';
              }
            }
          }
          console.log(`[Scheduler] Day ${d}: Found ${existingTeamLeads} existing team-lead template shift(s) → inferred slots`);
        }
      }

      // For fixed-shift managers we know the exact start time, so mark the correct slot.
      // This ensures Pass 2 looks for the right complementary slot (e.g. a closer when
      // the fixed-shift manager is an opener, and vice versa).
      for (let d = 0; d < 7; d++) {
        for (const emp of [...allHigherTierManagers, ...allTeamLeads]) {
          if (!fixedShiftMgrIds.has(emp.id)) continue;
          if (!existingShiftsByEmpDay.has(`${emp.id}-${d}`)) continue; // not working this day

          const isHigherTier = storeManagerCodes.includes(emp.jobTitle) || assistantManagerCodes.includes(emp.jobTitle);
          const tier: 'higher' | 'teamlead' = isHigherTier ? 'higher' : 'teamlead';
          const fStartH = parseInt(emp.fixedShiftStart!.split(':')[0], 10);

          if (isHigherTier) leadershipCoverage[d].hasHigherTier = true;

          if (fStartH <= 9) {
            // Early/opening shift
            leadershipCoverage[d].opener = true;
            if (leadershipCoverage[d].openerTier !== 'higher') leadershipCoverage[d].openerTier = tier;
            console.log(`[Scheduler] Day ${d}: Fixed-shift ${emp.name} covers OPENER slot`);
          } else if (fStartH >= 11) {
            // Mid-day or closing shift
            leadershipCoverage[d].closer = true;
            if (leadershipCoverage[d].closerTier !== 'higher') leadershipCoverage[d].closerTier = tier;
            console.log(`[Scheduler] Day ${d}: Fixed-shift ${emp.name} covers CLOSER slot`);
          } else {
            // 10am — treat as mid
            leadershipCoverage[d].mid = true;
            console.log(`[Scheduler] Day ${d}: Fixed-shift ${emp.name} covers MID slot`);
          }
        }
      }
      
      console.log(`[Scheduler] Leadership pool - Higher-tier: ${allHigherTierManagers.length}, Team Leads: ${allTeamLeads.length}`);
      
      // Identify days where team leads are scheduled but no higher-tier manager exists.
      // Higher-tier managers should NOT be randomly given these days off.
      const teamLeadDependentDays = new Set<number>();
      for (let d = 0; d < 7; d++) {
        const c = leadershipCoverage[d];
        if ((c.openerTier === 'teamlead' || c.closerTier === 'teamlead') && !c.hasHigherTier) {
          teamLeadDependentDays.add(d);
        }
      }
      if (teamLeadDependentDays.size > 0) {
        console.log(`[Scheduler] Team-lead-dependent days (need higher-tier): ${Array.from(teamLeadDependentDays).map(d => shortDayNames[d]).join(', ')}`);
      }
      
      // ========== PRE-SELECT RANDOM DAYS OFF FOR EACH MANAGER ==========
      // This ensures managers don't always end up on the same days each generation.
      // For each manager, randomly pick which days they'll be "off" (up to 7 - maxDays).
      // Only picks from days that aren't already blocked by time-off, non-working days, etc.
      // IMPORTANT: Higher-tier managers are protected from random off days on
      // team-lead-dependent days so team leads never open/close alone.
      const managerRandomOffDays = new Map<number, Set<number>>();
      
      for (const mgr of [...allHigherTierManagers, ...allTeamLeads]) {
        const isHigherTier = higherTierIds.includes(mgr.id);
        const maxDays = getMaxDays(mgr);
        const potentialDays: number[] = [];
        for (let d = 0; d < 7; d++) {
          const currentDay = new Date(startDate.getTime() + d * 24 * 60 * 60 * 1000);
          if (isHoliday(currentDay)) continue;
          if (isOnTimeOff(mgr.id, currentDay, d)) continue;
          potentialDays.push(d);
        }
        
        const daysToRemove = potentialDays.length - maxDays;
        const offDays = new Set<number>();
        if (daysToRemove > 0) {
          // For higher-tier managers, prefer to remove days that are NOT team-lead-dependent
          const removableDays = isHigherTier
            ? potentialDays.filter(d => !teamLeadDependentDays.has(d))
            : potentialDays;
          const protectedDays = isHigherTier
            ? potentialDays.filter(d => teamLeadDependentDays.has(d))
            : [];
          
          const shuffledRemovable = shuffleArray(removableDays);
          for (let i = 0; i < daysToRemove && i < shuffledRemovable.length; i++) {
            offDays.add(shuffledRemovable[i]);
          }
          // Only use protected days as last resort if not enough removable days
          const remaining = daysToRemove - offDays.size;
          if (remaining > 0) {
            const shuffledProtected = shuffleArray(protectedDays);
            for (let i = 0; i < remaining && i < shuffledProtected.length; i++) {
              offDays.add(shuffledProtected[i]);
            }
          }
        }
        managerRandomOffDays.set(mgr.id, offDays);
        if (offDays.size > 0) {
          console.log(`[Scheduler] ${mgr.name}: Random days off = ${Array.from(offDays).map(d => shortDayNames[d]).join(', ')}`);
        }
      }
      
      // Enhanced availability check for managers that includes random days off
      const canManagerWorkDay = (mgr: typeof employees[0], currentDay: Date, dayIndex: number) => {
        const offDays = managerRandomOffDays.get(mgr.id);
        if (offDays && offDays.has(dayIndex)) return false;
        return canWorkFullShift(mgr, currentDay, dayIndex);
      };
      
      // PASS 1: Ensure every day gets at least ONE higher-tier manager
      // PRIORITY: Days where team leads already exist (from fixed-shift or template) go FIRST
      // so higher-tier managers are guaranteed to cover the opposite slot.
      const tlNeedsDays = [0,1,2,3,4,5,6].filter(d => teamLeadDependentDays.has(d));
      const otherPass1Days = [0,1,2,3,4,5,6].filter(d => !teamLeadDependentDays.has(d));
      const pass1DayOrder = [...shuffleArray(tlNeedsDays), ...shuffleArray(otherPass1Days)];
      console.log(`[Scheduler] Pass 1 day order: ${pass1DayOrder.map(d => shortDayNames[d]).join(', ')} (team-lead-dependent days first)`);
      
      for (const dayIndex of pass1DayOrder) {
        const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
        
        // Skip holidays
        const holidayName = isHoliday(currentDay);
        if (holidayName) {
          console.log(`[Scheduler] Skipping ${holidayName} - store is closed`);
          continue;
        }
        
        const shifts = getShiftTimes(currentDay);
        const coverage = leadershipCoverage[dayIndex];
        
        // Skip if this day already has higher-tier coverage from template
        if (coverage.hasHigherTier) {
          console.log(`[Scheduler] Pass 1 - Day ${dayIndex}: Already covered by template shift(s)`);
          continue;
        }
        
        // Find available higher-tier managers for this day using random off days
        const availableHigherTier = shuffleArray(allHigherTierManagers.filter(m => canManagerWorkDay(m, currentDay, dayIndex)));
        
        if (availableHigherTier.length > 0) {
          // Smart slot selection: if a team lead already covers one slot,
          // put the higher-tier in the OPPOSITE slot (not random).
          // If BOTH slots are team leads, prefer closer (team leads opening alone
          // is the primary constraint violation to avoid).
          let shiftType: 'opener' | 'closer';
          if (coverage.openerTier === 'teamlead' && coverage.closerTier === 'teamlead') {
            shiftType = 'closer';
          } else if (coverage.openerTier === 'teamlead' && !coverage.closer) {
            shiftType = 'closer';
          } else if (coverage.closerTier === 'teamlead' && !coverage.opener) {
            shiftType = 'opener';
          } else {
            shiftType = randomPick(['opener', 'closer'] as const);
          }
          const shift = shiftType === 'opener' ? shifts.opener : shifts.closer;
          const manager = availableHigherTier[0];
          
          scheduleShift(manager, shift.start, shift.end, dayIndex);
          coverage[shiftType] = true;
          coverage.hasHigherTier = true;
          coverage[shiftType === 'opener' ? 'openerTier' : 'closerTier'] = 'higher';
          console.log(`[Scheduler] Pass 1 - Day ${dayIndex}: ${manager.name} as ${shiftType}${teamLeadDependentDays.has(dayIndex) ? ' (complementing team lead)' : ''}`);
        } else {
          console.log(`[Scheduler] Pass 1 - Day ${dayIndex}: No higher-tier managers available`);
        }
      }
      
      // PASS 2: Fill gaps and add additional coverage
      // Process days that NEED coverage first: team-lead-dependent, then uncovered, then covered
      const stillUncoveredDays = [0, 1, 2, 3, 4, 5, 6].filter(d => !leadershipCoverage[d].hasHigherTier);
      const stillTlDependent = stillUncoveredDays.filter(d => teamLeadDependentDays.has(d));
      const plainUncovered = stillUncoveredDays.filter(d => !teamLeadDependentDays.has(d));
      const coveredDays = [0, 1, 2, 3, 4, 5, 6].filter(d => leadershipCoverage[d].hasHigherTier);
      const pass2DayOrder = [...shuffleArray(stillTlDependent), ...shuffleArray(plainUncovered), ...shuffleArray(coveredDays)];
      
      console.log(`[Scheduler] Pass 2 - TL-dependent: ${stillTlDependent.map(d => shortDayNames[d]).join(', ') || 'none'}, Other uncovered: ${plainUncovered.map(d => shortDayNames[d]).join(', ') || 'none'}`);
      
      for (const dayIndex of pass2DayOrder) {
        const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
        
        // Skip holidays
        if (isHoliday(currentDay)) continue;
        
        const shifts = getShiftTimes(currentDay);
        const coverage = leadershipCoverage[dayIndex];
        
        // Find available higher-tier managers for this day using random off days
        const availableHigherTier = shuffleArray(allHigherTierManagers.filter(m => canManagerWorkDay(m, currentDay, dayIndex)));
        
        // FIRST: If this day has no higher-tier coverage, try to add one now
        if (!coverage.hasHigherTier && availableHigherTier.length > 0) {
          // Smart slot: complement team lead if one exists
          // If BOTH slots are team leads, prefer closer.
          let shiftType: 'opener' | 'closer';
          if (coverage.openerTier === 'teamlead' && coverage.closerTier === 'teamlead') {
            shiftType = 'closer';
          } else if (coverage.openerTier === 'teamlead' && !coverage.closer) {
            shiftType = 'closer';
          } else if (coverage.closerTier === 'teamlead' && !coverage.opener) {
            shiftType = 'opener';
          } else {
            shiftType = randomPick(['opener', 'closer'] as const);
          }
          const shift = shiftType === 'opener' ? shifts.opener : shifts.closer;
          const manager = availableHigherTier[0];
          
          scheduleShift(manager, shift.start, shift.end, dayIndex);
          coverage[shiftType] = true;
          coverage.hasHigherTier = true;
          coverage[shiftType === 'opener' ? 'openerTier' : 'closerTier'] = 'higher';
          console.log(`[Scheduler] Pass 2 - Day ${dayIndex}: ${manager.name} as ${shiftType} (filling gap)`);
        }
        
        // Re-filter and re-shuffle after potential scheduling
        const stillAvailableHigherTier = shuffleArray(allHigherTierManagers.filter(m => canManagerWorkDay(m, currentDay, dayIndex)));
        
        // Add second higher-tier manager for the opposite shift if available
        if (stillAvailableHigherTier.length > 0) {
          if (coverage.opener && !coverage.closer) {
            const manager = stillAvailableHigherTier[0];
            scheduleShift(manager, shifts.closer.start, shifts.closer.end, dayIndex);
            coverage.closer = true;
            coverage.closerTier = 'higher';
            console.log(`[Scheduler] Pass 2 - Day ${dayIndex}: ${manager.name} as closer`);
          } else if (coverage.closer && !coverage.opener) {
            const manager = stillAvailableHigherTier[0];
            scheduleShift(manager, shifts.opener.start, shifts.opener.end, dayIndex);
            coverage.opener = true;
            coverage.openerTier = 'higher';
            console.log(`[Scheduler] Pass 2 - Day ${dayIndex}: ${manager.name} as opener`);
          } else if (!coverage.opener && !coverage.closer) {
            const shiftType = randomPick(['opener', 'closer'] as const);
            const manager = stillAvailableHigherTier[0];
            const shift = shiftType === 'opener' ? shifts.opener : shifts.closer;
            scheduleShift(manager, shift.start, shift.end, dayIndex);
            coverage[shiftType] = true;
            coverage.hasHigherTier = true;
            coverage[shiftType === 'opener' ? 'openerTier' : 'closerTier'] = 'higher';
            console.log(`[Scheduler] Pass 2 - Day ${dayIndex}: ${manager.name} as ${shiftType}`);
          }
        }
        
        // Add third higher-tier manager for mid shift if still available
        // BUT only if every other day already has at least one higher-tier manager,
        // otherwise save the capacity for days that still need an opener or closer.
        const availableForMid = shuffleArray(allHigherTierManagers.filter(m => canManagerWorkDay(m, currentDay, dayIndex)));
        if (availableForMid.length > 0 && !coverage.mid && coverage.opener && coverage.closer) {
          const allDaysCoveredByHigherTier = [0,1,2,3,4,5,6].every(d => {
            const cd = new Date(startDate.getTime() + d * 24 * 60 * 60 * 1000);
            return isHoliday(cd) || leadershipCoverage[d].hasHigherTier;
          });
          if (allDaysCoveredByHigherTier) {
            const midShift = randomPick([shifts.mid10, shifts.mid11, shifts.early9]);
            const manager = availableForMid[0];
            scheduleShift(manager, midShift.start, midShift.end, dayIndex);
            coverage.mid = true;
            console.log(`[Scheduler] Pass 2 - Day ${dayIndex}: ${manager.name} as mid`);
          } else {
            console.log(`[Scheduler] Pass 2 - Day ${dayIndex}: Skipping mid shift — saving higher-tier capacity for uncovered days`);
          }
        }
        
        // Add team leads - enforce constraint: team lead can open only if higher-tier closes,
        // and team lead can close only if higher-tier opens. Team leads can't be sole leadership
        // on either the opening or closing shift.
        if (coverage.hasHigherTier) {
          const availableTeamLeads = shuffleArray(allTeamLeads.filter(m => canManagerWorkDay(m, currentDay, dayIndex)));
          
          for (const teamLead of availableTeamLeads) {
            const openSlots: string[] = [];
            // Team lead can open ONLY if a higher-tier manager is closing (or will close)
            if (!coverage.opener && coverage.closerTier === 'higher') openSlots.push('opener');
            // Team lead can close ONLY if a higher-tier manager is opening (or has opened)
            if (!coverage.closer && coverage.openerTier === 'higher') openSlots.push('closer');
            // Mid shift is always okay if higher-tier is present somewhere that day
            if (!coverage.mid) openSlots.push('mid');
            
            if (openSlots.length === 0) break;
            
            const chosenSlot = randomPick(openSlots);
            if (chosenSlot === 'opener') {
              scheduleShift(teamLead, shifts.opener.start, shifts.opener.end, dayIndex);
              coverage.opener = true;
              coverage.openerTier = 'teamlead';
              console.log(`[Scheduler] Pass 2 - Day ${dayIndex}: Team lead ${teamLead.name} as opener (higher-tier has closer)`);
            } else if (chosenSlot === 'closer') {
              scheduleShift(teamLead, shifts.closer.start, shifts.closer.end, dayIndex);
              coverage.closer = true;
              coverage.closerTier = 'teamlead';
              console.log(`[Scheduler] Pass 2 - Day ${dayIndex}: Team lead ${teamLead.name} as closer (higher-tier has opener)`);
            } else {
              const midShift = randomPick([shifts.mid10, shifts.mid11, shifts.early9]);
              scheduleShift(teamLead, midShift.start, midShift.end, dayIndex);
              coverage.mid = true;
              console.log(`[Scheduler] Pass 2 - Day ${dayIndex}: Team lead ${teamLead.name} as mid`);
            }
          }
        }
        
        // Log warning if missing coverage
        if (!coverage.opener || !coverage.closer) {
          console.log(`[Scheduler] WARNING: Day ${dayIndex} missing coverage - opener: ${coverage.opener}, closer: ${coverage.closer}`);
        }
      }
      
      // PASS 3 (FALLBACK): If any day is still missing opener or closer,
      // override random off days to guarantee coverage - coverage is more important than variety
      // IMPORTANT: Try higher-tier managers first, then team leads only for slots where
      // the opposite slot already has higher-tier coverage
      for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
        if (isHoliday(currentDay)) continue;
        
        const coverage = leadershipCoverage[dayIndex];
        if (coverage.opener && coverage.closer) continue;
        
        const shifts = getShiftTimes(currentDay);
        
        // First try higher-tier managers (they can fill any slot)
        const availHigher = shuffleArray(allHigherTierManagers.filter(m => canWorkFullShift(m, currentDay, dayIndex)));
        for (const mgr of availHigher) {
          if (coverage.opener && coverage.closer) break;
          if (!coverage.opener) {
            scheduleShift(mgr, shifts.opener.start, shifts.opener.end, dayIndex);
            coverage.opener = true;
            coverage.hasHigherTier = true;
            coverage.openerTier = 'higher';
            console.log(`[Scheduler] Pass 3 FALLBACK - Day ${dayIndex}: ${mgr.name} as opener`);
          } else if (!coverage.closer) {
            scheduleShift(mgr, shifts.closer.start, shifts.closer.end, dayIndex);
            coverage.closer = true;
            coverage.hasHigherTier = true;
            coverage.closerTier = 'higher';
            console.log(`[Scheduler] Pass 3 FALLBACK - Day ${dayIndex}: ${mgr.name} as closer`);
          }
        }
        
        // Then try team leads for slots where the opposite has higher-tier
        if (coverage.opener && coverage.closer) continue;
        const availLeads = shuffleArray(allTeamLeads.filter(m => canWorkFullShift(m, currentDay, dayIndex)));
        for (const lead of availLeads) {
          if (coverage.opener && coverage.closer) break;
          if (!coverage.opener && coverage.closerTier === 'higher') {
            scheduleShift(lead, shifts.opener.start, shifts.opener.end, dayIndex);
            coverage.opener = true;
            coverage.openerTier = 'teamlead';
            console.log(`[Scheduler] Pass 3 FALLBACK - Day ${dayIndex}: Team lead ${lead.name} as opener (higher-tier has closer)`);
          } else if (!coverage.closer && coverage.openerTier === 'higher') {
            scheduleShift(lead, shifts.closer.start, shifts.closer.end, dayIndex);
            coverage.closer = true;
            coverage.closerTier = 'teamlead';
            console.log(`[Scheduler] Pass 3 FALLBACK - Day ${dayIndex}: Team lead ${lead.name} as closer (higher-tier has opener)`);
          }
        }
      }
      
      // PASS 4 (LAST RESORT): If any day STILL lacks coverage and no higher-tier is available,
      // allow team leads to fill slots alone. A team lead with no store/assistant manager
      // is not ideal, but it's better than zero leadership coverage for the day.
      for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
        if (isHoliday(currentDay)) continue;
        
        const coverage = leadershipCoverage[dayIndex];
        if (coverage.opener && coverage.closer) continue;
        
        const shifts = getShiftTimes(currentDay);
        const availLeads = shuffleArray(allTeamLeads.filter(m => canWorkFullShift(m, currentDay, dayIndex)));
        
        for (const lead of availLeads) {
          if (coverage.opener && coverage.closer) break;
          if (!coverage.opener) {
            scheduleShift(lead, shifts.opener.start, shifts.opener.end, dayIndex);
            coverage.opener = true;
            coverage.openerTier = 'teamlead';
            console.log(`[Scheduler] Pass 4 LAST RESORT - Day ${dayIndex}: Team lead ${lead.name} as opener (NO higher-tier available)`);
          } else if (!coverage.closer) {
            scheduleShift(lead, shifts.closer.start, shifts.closer.end, dayIndex);
            coverage.closer = true;
            coverage.closerTier = 'teamlead';
            console.log(`[Scheduler] Pass 4 LAST RESORT - Day ${dayIndex}: Team lead ${lead.name} as closer (NO higher-tier available)`);
          }
        }
        
        if (!coverage.opener || !coverage.closer) {
          console.log(`[Scheduler] WARNING: Day ${dayIndex} (${shortDayNames[dayIndex]}) STILL has gaps after all passes — not enough managers available`);
        }
      }
      
      // Final summary and validation of leadership coverage
      console.log(`[Scheduler] Leadership coverage summary:`);
      const uncoveredDaysAfterPass2: string[] = [];
      let totalLeadershipShifts = 0;
      for (let d = 0; d < 7; d++) {
        const c = leadershipCoverage[d];
        const currentDay = new Date(startDate.getTime() + d * 24 * 60 * 60 * 1000);
        const isHolidayDay = isHoliday(currentDay);
        
        if (isHolidayDay) {
          console.log(`[Scheduler]   ${shortDayNames[d]}: HOLIDAY - store closed`);
          continue;
        }
        
        console.log(`[Scheduler]   ${shortDayNames[d]}: opener=${c.opener}, closer=${c.closer}, mid=${c.mid}, hasHigherTier=${c.hasHigherTier}`);
        
        if (!c.hasHigherTier) {
          uncoveredDaysAfterPass2.push(shortDayNames[d]);
        }
        if (c.opener) totalLeadershipShifts++;
        if (c.closer) totalLeadershipShifts++;
        if (c.mid) totalLeadershipShifts++;
      }
      
      if (uncoveredDaysAfterPass2.length > 0) {
        console.log(`[Scheduler] ERROR: ${uncoveredDaysAfterPass2.length} days have NO higher-tier manager coverage: ${uncoveredDaysAfterPass2.join(', ')}`);
        console.log(`[Scheduler] This may indicate insufficient store managers/assistant managers, or too many time-off conflicts`);
      } else {
        console.log(`[Scheduler] SUCCESS: All days have higher-tier manager coverage (${totalLeadershipShifts} leadership shifts scheduled)`);
      }
      
      // Phase 1a: Schedule pricers and apparel processors with MORNING PRIORITY
      // STRATEGY: First fill station seats with fulltime workers on OPENER shifts (8-4:30)
      // Then schedule part-timers on AFTERNOON shifts (4:30-8:30) to extend coverage
      // IMPORTANT: Recognize existing template shifts as fulfilling coverage requirements
      
      // Track morning production coverage per day for afternoon scheduling
      const morningPricerByDay = new Map<number, number>(); // Count of morning pricers
      const morningApparelByDay = new Map<number, number>(); // Count of morning apparel processors
      
      // Build arrays of employee IDs by role for efficient lookup
      const pricerIds = donationPricers.map(p => p.id);
      const apparelIds = apparelProcessors.map(p => p.id);
      
      // ========== PRODUCTION SCHEDULING – ROUND-ROBIN (no station cap) ==========
      // Schedule as many production staff as are available, spread evenly across
      // the week. Saturday gets first pick each round so the busiest day is never
      // left short when employees hit their days-per-week limit.
      //
      // Round-robin: add ONE person per day per pass (Sat-first), then repeat until
      // no more staff can be added anywhere.

      const prodDayOrder = [6, 5, 0, 1, 2, 3, 4]; // Sat, Fri, Sun, then weekdays

      console.log(`[Scheduler] Production scheduling: round-robin across all days (Sat-first, no station cap)`);
      
      // Initialize counts from existing template shifts
      for (const dayIndex of [0, 1, 2, 3, 4, 5, 6]) {
        const existingPricerShifts = countExistingShiftsForRole(pricerIds, dayIndex);
        const existingApparelShifts = countExistingShiftsForRole(apparelIds, dayIndex);
        morningPricerByDay.set(dayIndex, existingPricerShifts);
        morningApparelByDay.set(dayIndex, existingApparelShifts);
        if (existingPricerShifts > 0) {
          console.log(`[Scheduler] Day ${dayIndex}: Found ${existingPricerShifts} existing pricer shift(s) from template`);
        }
        if (existingApparelShifts > 0) {
          console.log(`[Scheduler] Day ${dayIndex}: Found ${existingApparelShifts} existing apparel shift(s) from template`);
        }
      }

      let prodProgress = true;
      while (prodProgress) {
        prodProgress = false;
        for (const dayIndex of prodDayOrder) {
          const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
          if (isHoliday(currentDay)) continue;
          const shifts = getShiftTimes(currentDay);

          // ── PRICERS ────────────────────────────────────────────────────────
          {
            const available = sortByFewestProdShifts(
              donationPricers.filter(p =>
                canWorkFullShift(p, currentDay, dayIndex) &&
                matchesShiftPreference(p, shifts.opener.start, dayIndex)
              )
            );
            if (available.length > 0) {
              const pricer = available[0];
              scheduleShift(pricer, shifts.opener.start, shifts.opener.end, dayIndex);
              const count = (morningPricerByDay.get(dayIndex) || 0) + 1;
              morningPricerByDay.set(dayIndex, count);
              const ft = isPartTime(pricer) ? 'PT' : 'FT';
              console.log(`[Scheduler] Pricer Day ${dayIndex}: ${ft} ${pricer.name} (total=${count}, days_so_far=${employeeState[pricer.id].daysWorked})`);
              prodProgress = true;
            }
          }

          // ── APPAREL PROCESSORS ─────────────────────────────────────────────
          {
            const available = sortByFewestProdShifts(
              apparelProcessors.filter(p =>
                canWorkFullShift(p, currentDay, dayIndex) &&
                matchesShiftPreference(p, shifts.opener.start, dayIndex)
              )
            );
            if (available.length > 0) {
              const processor = available[0];
              const count = morningApparelByDay.get(dayIndex) || 0;
              const shift = count % 2 === 0 ? shifts.opener : shifts.early9;
              scheduleShift(processor, shift.start, shift.end, dayIndex);
              morningApparelByDay.set(dayIndex, count + 1);
              const ft = isPartTime(processor) ? 'PT' : 'FT';
              console.log(`[Scheduler] Apparel Day ${dayIndex}: ${ft} ${processor.name} (total=${count + 1}, days_so_far=${employeeState[processor.id].daysWorked})`);
              prodProgress = true;
            }
          }
        }
      }
      
      // Log final production coverage
      console.log(`[Scheduler] Production coverage summary:`);
      for (const d of [0, 1, 2, 3, 4, 5, 6]) {
        const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d];
        const isBusy = [4, 5, 6].includes(d) ? ' (BUSY)' : '';
        console.log(`[Scheduler]   ${dayName}${isBusy}: Pricers=${morningPricerByDay.get(d) || 0}, Apparel=${morningApparelByDay.get(d) || 0}`);
      }
      
      // Phase 1a-afternoon: Schedule AFTERNOON production shifts to extend station coverage
      // After morning fulltime workers leave (4:30pm), part-timers cover remaining hours
      console.log(`[Scheduler] Phase 1a-afternoon: Scheduling afternoon production coverage (4:30-8:30 PM)`);
      
      for (const dayIndex of dayOrder) {
        const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
        if (isHoliday(currentDay)) continue;
        
        const shifts = getShiftTimes(currentDay);
        
        // Only schedule afternoon shifts if we had morning coverage (station was used)
        const morningPricerCount = morningPricerByDay.get(dayIndex) || 0;
        const morningApparelCount = morningApparelByDay.get(dayIndex) || 0;
        
        // AFTERNOON PRICER: If morning pricer was scheduled, try to add afternoon coverage
        if (morningPricerCount > 0) {
          const afternoonPricers = shuffleAndSort(
            donationPricers.filter(p => 
              isPartTime(p) && canWorkProdAfternoonShift(p, currentDay, dayIndex)
            )
          );
          
          if (afternoonPricers.length > 0) {
            const pricer = afternoonPricers[0];
            scheduleShift(pricer, shifts.prodAfternoon.start, shifts.prodAfternoon.end, dayIndex);
            console.log(`[Scheduler] Day ${dayIndex}: PT Pricer ${pricer.name} scheduled for afternoon (${shifts.prodAfternoon.start.getHours()}:${shifts.prodAfternoon.start.getMinutes().toString().padStart(2, '0')}-close)`);
          }
        }
        
        // AFTERNOON APPAREL: For each morning apparel processor, try to add afternoon coverage
        if (morningApparelCount > 0) {
          const afternoonApparel = shuffleAndSort(
            apparelProcessors.filter(p => 
              isPartTime(p) && canWorkProdAfternoonShift(p, currentDay, dayIndex)
            )
          );
          
          // Try to match morning coverage with afternoon coverage (up to station limits)
          let afternoonApparelCount = 0;
          for (const processor of afternoonApparel) {
            if (afternoonApparelCount >= morningApparelCount) break; // Match morning coverage
            scheduleShift(processor, shifts.prodAfternoon.start, shifts.prodAfternoon.end, dayIndex);
            afternoonApparelCount++;
            console.log(`[Scheduler] Day ${dayIndex}: PT Apparel ${processor.name} scheduled for afternoon (${shifts.prodAfternoon.start.getHours()}:${shifts.prodAfternoon.start.getMinutes().toString().padStart(2, '0')}-close)`);
          }
        }
      }

      // Phase 1a-greeter: Schedule DONOR GREETERS with Saturday priority
      // Saturday is the busiest donation day - MUST have more greeters than Sunday
      // Process Saturday FIRST, then other days in priority order
      // IMPORTANT: Recognize existing template shifts as fulfilling coverage requirements
      const greeterDayOrder = saturdayFirstOrder; // Sat first, then Fri, Sun, Mon...
      
      // Build array of greeter IDs for existing shift lookup
      const greeterIds = donorGreeters.map(g => g.id);
      
      // Determine targets based on pool size
      // PRIORITY: Every day should have opener + closer coverage before adding mid-shifts
      const totalGreeterPool = donorGreeters.length;
      
      // Calculate total available greeter-days
      const greeterMaxDays = donorGreeters.reduce((sum, g) => sum + getMaxDays(g), 0);
      console.log(`[Scheduler] Greeter capacity: ${totalGreeterPool} greeters × avg ${(greeterMaxDays / Math.max(totalGreeterPool, 1)).toFixed(1)} days = ${greeterMaxDays} greeter-days`);
      
      // Calculate adaptive targets: every day gets 2 (opener+closer) if capacity allows
      // Then add mid-shifts for busy days with remaining capacity
      const nonHolidayDays = [0,1,2,3,4,5,6].filter(d => {
        const day = new Date(startDate.getTime() + d * 24 * 60 * 60 * 1000);
        return !isHoliday(day);
      });
      const baseNeeded = nonHolidayDays.length * 2; // opener+closer for every day
      const extraCapacity = Math.max(0, greeterMaxDays - baseNeeded);
      
      const greeterTargets: Record<number, number> = {};
      for (const d of nonHolidayDays) {
        // Base: 2 per day (opener + closer) if we have enough capacity, else 1
        greeterTargets[d] = greeterMaxDays >= baseNeeded ? 2 : Math.max(1, Math.floor(greeterMaxDays / nonHolidayDays.length));
      }
      // Add mid-shifts on busy days if extra capacity exists
      if (extraCapacity >= 1) greeterTargets[6] = (greeterTargets[6] || 2) + 1; // Saturday
      if (extraCapacity >= 2) greeterTargets[5] = (greeterTargets[5] || 2) + 1; // Friday
      if (extraCapacity >= 3) greeterTargets[0] = (greeterTargets[0] || 2) + 1; // Sunday
      // Distribute remaining extra to weekdays
      if (extraCapacity >= 4) {
        const weekdays = [1, 2, 3, 4];
        for (let i = 0; i < Math.min(extraCapacity - 3, weekdays.length); i++) {
          greeterTargets[weekdays[i]] = (greeterTargets[weekdays[i]] || 2) + 1;
        }
      }
      
      // ── Fixed-shift slot helper ──────────────────────────────────────────────
      // Returns the slot a fixed-shift employee fills on a given day, or null if
      // they have no fixed shift or are not scheduled that day.
      const getFixedShiftSlot = (emp: typeof employees[0], dayIndex: number): 'opener' | 'mid' | 'closer' | null => {
        if (emp.shiftPreference !== 'fixed_shift' || !emp.fixedShiftStart) return null;
        if (!existingShiftsByEmpDay.has(`${emp.id}-${dayIndex}`)) return null;
        const h = parseInt(emp.fixedShiftStart.split(':')[0], 10);
        if (h <= 9) return 'opener';
        if (h >= 11) return 'closer';
        return 'mid';
      };

      // Per-day opener/closer counts by role (fixed-shift employees whose slot we know)
      const buildFixedSlotCounts = (pool: typeof employees) => {
        const openers: Record<number, number> = {};
        const closers: Record<number, number> = {};
        for (let d = 0; d < 7; d++) {
          openers[d] = 0; closers[d] = 0;
          for (const emp of pool) {
            const slot = getFixedShiftSlot(emp, d);
            if (slot === 'opener') openers[d]++;
            else if (slot === 'closer') closers[d]++;
          }
        }
        return { openers, closers };
      };

      const greeterFixed = buildFixedSlotCounts(donorGreeters);
      const cashierFixed = buildFixedSlotCounts(cashiers);

      // Track scheduled greeters per day to ensure Saturday >= Sunday
      // Initialize with existing template shifts counted
      const greetersByDay: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
      for (let d = 0; d < 7; d++) {
        const existingCount = countExistingShiftsForRole(greeterIds, d);
        greetersByDay[d] = existingCount;
        if (existingCount > 0) {
          console.log(`[Scheduler] Day ${d}: Found ${existingCount} existing greeter shift(s) (fixed openers=${greeterFixed.openers[d]}, fixed closers=${greeterFixed.closers[d]})`);
        }
      }
      
      console.log(`[Scheduler] Total donor greeters available: ${totalGreeterPool}, targets: ${JSON.stringify(greeterTargets)}`);
      
      // ROUND-ROBIN APPROACH: Ensures every day gets coverage before any day gets extras
      // Round 1: Every day gets an OPENER (Saturday-first)
      // Round 2: Every day gets a CLOSER (Saturday-first)
      // Round 3: Add mid-shifts where targets allow (Saturday-first)
      
      // Round 1: Schedule 1 opener per day
      for (const dayIndex of greeterDayOrder) {
        const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
        const dayName = shortDayNames[dayIndex];
        if (isHoliday(currentDay)) continue;

        // Skip if opener slot is already filled:
        //   a) a fixed-shift greeter is confirmed as an opener, OR
        //   b) there are existing greeters and none of them are known fixed closers
        //      (template/unknown shifts → assume they fill the opener slot)
        const hasConfirmedOpener = greeterFixed.openers[dayIndex] >= 1;
        const hasUnknownExisting = greetersByDay[dayIndex] > 0 && greeterFixed.closers[dayIndex] === 0;
        if (hasConfirmedOpener || hasUnknownExisting) {
          console.log(`[Scheduler] Greeter R1 ${dayName}: Opener already covered (confirmed=${hasConfirmedOpener})`);
          continue;
        }
        
        const shifts = getShiftTimes(currentDay);
        const availableGreeters = shuffleAndSort(
          donorGreeters.filter(g => canWorkFullShift(g, currentDay, dayIndex) && matchesShiftPreference(g, shifts.opener.start, dayIndex))
        );
        
        if (availableGreeters.length > 0) {
          scheduleShift(availableGreeters[0], shifts.opener.start, shifts.opener.end, dayIndex);
          greetersByDay[dayIndex]++;
          greeterFixed.openers[dayIndex]++; // treat newly scheduled opener as confirmed
          console.log(`[Scheduler] Greeter R1 ${dayName}: ${availableGreeters[0].name} as opener`);
        } else {
          console.log(`[Scheduler] Greeter R1 ${dayName}: No greeters available for opener`);
        }
      }
      
      // Round 2: Schedule 1 closer per day (to ensure opener+closer coverage everywhere)
      for (const dayIndex of greeterDayOrder) {
        const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
        const dayName = shortDayNames[dayIndex];
        if (isHoliday(currentDay)) continue;
        
        const isSunday = dayIndex === 0;
        // For Sunday: don't exceed Saturday's greeter count
        if (isSunday && greetersByDay[0] >= greetersByDay[6]) continue;

        // Skip if closer slot is already filled:
        //   a) a fixed-shift greeter is confirmed as a closer, OR
        //   b) total count meets target AND at least one greeter is not a fixed opener
        //      (implying a template/unknown shift is covering the closer)
        const hasConfirmedCloser = greeterFixed.closers[dayIndex] >= 1;
        const totalMet = greetersByDay[dayIndex] >= (greeterTargets[dayIndex] || 2);
        const hasNonOpener = greetersByDay[dayIndex] > greeterFixed.openers[dayIndex];
        if (hasConfirmedCloser || (totalMet && hasNonOpener)) {
          console.log(`[Scheduler] Greeter R2 ${dayName}: Closer already covered (confirmed=${hasConfirmedCloser})`);
          continue;
        }
        // Also skip if total target is fully met by all-opener fixed shifts (we'll warn instead)
        if (totalMet) continue;
        
        const shifts = getShiftTimes(currentDay);
        const availableGreeters = shuffleAndSort(
          donorGreeters.filter(g => canWorkFullShift(g, currentDay, dayIndex) && matchesShiftPreference(g, shifts.closer.start, dayIndex))
        );
        
        if (availableGreeters.length > 0) {
          scheduleShift(availableGreeters[0], shifts.closer.start, shifts.closer.end, dayIndex);
          greetersByDay[dayIndex]++;
          greeterFixed.closers[dayIndex]++; // treat newly scheduled closer as confirmed
          console.log(`[Scheduler] Greeter R2 ${dayName}: ${availableGreeters[0].name} as closer`);
        } else {
          console.log(`[Scheduler] Greeter R2 ${dayName}: No greeters available for closer`);
        }
      }
      
      // Round 3: Add mid-shifts where targets allow (Saturday-first priority)
      for (const dayIndex of greeterDayOrder) {
        const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
        const dayName = shortDayNames[dayIndex];
        if (isHoliday(currentDay)) continue;
        
        const target = greeterTargets[dayIndex] || 2;
        const isSunday = dayIndex === 0;
        if (isSunday && greetersByDay[0] >= greetersByDay[6]) continue;
        
        while (greetersByDay[dayIndex] < target) {
          const shifts = getShiftTimes(currentDay);
          const availableGreeters = shuffleAndSort(
            donorGreeters.filter(g => canWorkFullShift(g, currentDay, dayIndex) && matchesShiftPreference(g, shifts.mid10.start, dayIndex))
          );
          
          if (availableGreeters.length === 0) break;
          
          scheduleShift(availableGreeters[0], shifts.mid10.start, shifts.mid10.end, dayIndex);
          greetersByDay[dayIndex]++;
          console.log(`[Scheduler] Greeter R3 ${dayName}: ${availableGreeters[0].name} as mid-shift`);
        }
      }
      
      console.log(`[Scheduler] FINAL Donor greeters by day: Sat=${greetersByDay[6]}, Sun=${greetersByDay[0]}, Fri=${greetersByDay[5]}, Mon=${greetersByDay[1]}, Tue=${greetersByDay[2]}, Wed=${greetersByDay[3]}, Thu=${greetersByDay[4]}`);

      // Phase 1b: Schedule CASHIERS with Saturday priority
      // Saturday is the busiest sales day - MUST have more cashiers than Sunday
      // Process Saturday FIRST, then other days
      // IMPORTANT: Recognize existing template shifts as fulfilling coverage requirements
      const cashierDayOrder = saturdayFirstOrder; // Sat first, then Fri, Sun, Mon...
      const cashierTargets: Record<number, number> = {
        6: Math.max(openersRequired + 1, 3), // Saturday - busiest, needs extra cashiers
        5: openersRequired, // Friday
        0: openersRequired, // Sunday - will be capped to Saturday's count
        1: openersRequired, 2: openersRequired, 3: openersRequired, 4: openersRequired
      };
      
      // Build array of cashier IDs for existing shift lookup
      const cashierIds = cashiers.map(c => c.id);
      
      // Track scheduled cashiers per day to ensure Saturday >= Sunday
      // Initialize with existing template shifts counted
      const cashiersByDay: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
      for (let d = 0; d < 7; d++) {
        const existingCount = countExistingShiftsForRole(cashierIds, d);
        cashiersByDay[d] = existingCount;
        if (existingCount > 0) {
          console.log(`[Scheduler] Day ${d}: Found ${existingCount} existing cashier shift(s) from template`);
        }
      }
      
      console.log(`[Scheduler] Total cashiers available: ${cashiers.length}`);
      
      for (const dayIndex of cashierDayOrder) {
        const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
        const dayName = shortDayNames[dayIndex];
        
        // Skip holidays
        if (isHoliday(currentDay)) {
          console.log(`[Scheduler] Cashier ${dayName}: Skipping - holiday`);
          continue;
        }
        
        const shifts = getShiftTimes(currentDay);
        const baseTarget = cashierTargets[dayIndex] || openersRequired;
        const isSunday = dayIndex === 0;
        
        // For Sunday: don't schedule more cashiers than Saturday has
        const maxForDay = isSunday ? Math.min(baseTarget, cashiersByDay[6]) : baseTarget;
        
        // Check if existing shifts already meet the target
        if (cashiersByDay[dayIndex] >= maxForDay) {
          console.log(`[Scheduler] Cashier ${dayName}: Target ${maxForDay} already met by ${cashiersByDay[dayIndex]} existing shift(s)`);
          continue;
        }
        
        // Calculate how many more cashiers we need in total
        const stillNeeded = maxForDay - cashiersByDay[dayIndex];

        // Determine desired opener/closer split for the full day,
        // then subtract fixed-shift employees already filling those slots so we
        // don't over-schedule one side and under-schedule the other.
        const desiredOpeners = Math.ceil(maxForDay / 2);
        const desiredClosers = maxForDay - desiredOpeners;
        const fixedOpenersToday = cashierFixed.openers[dayIndex] || 0;
        const fixedClosersToday = cashierFixed.closers[dayIndex] || 0;
        const openingTarget = Math.max(0, desiredOpeners - fixedOpenersToday);
        // Closing target: how many more closers we still need, bounded by what's still needed overall
        const closingTarget = Math.min(Math.max(0, desiredClosers - fixedClosersToday), stillNeeded - openingTarget);
        
        console.log(`[Scheduler] Cashier ${dayName}: maxForDay=${maxForDay}, existing=${cashiersByDay[dayIndex]}, stillNeeded=${stillNeeded}, fixedOpeners=${fixedOpenersToday}, fixedClosers=${fixedClosersToday}, openingTarget=${openingTarget}, closingTarget=${closingTarget}`);
        
        // Schedule opening cashiers (shuffled for variety)
        const availableOpeners = shuffleAndSort(
          cashiers.filter(c => canWorkFullShift(c, currentDay, dayIndex) && matchesShiftPreference(c, shifts.opener.start, dayIndex))
        );
        
        let openersScheduled = 0;
        for (let i = 0; i < openingTarget && i < availableOpeners.length; i++) {
          scheduleShift(availableOpeners[i], shifts.opener.start, shifts.opener.end, dayIndex);
          cashiersByDay[dayIndex]++;
          openersScheduled++;
          console.log(`[Scheduler] Cashier ${dayName}: Scheduled ${availableOpeners[i].name} as opener`);
        }
        
        // Schedule closing cashiers
        const availableClosers = shuffleAndSort(
          cashiers.filter(c => canWorkFullShift(c, currentDay, dayIndex) && matchesShiftPreference(c, shifts.closer.start, dayIndex))
        );
        
        let closersScheduled = 0;
        for (let i = 0; i < closingTarget && i < availableClosers.length; i++) {
          scheduleShift(availableClosers[i], shifts.closer.start, shifts.closer.end, dayIndex);
          cashiersByDay[dayIndex]++;
          closersScheduled++;
          console.log(`[Scheduler] Cashier ${dayName}: Scheduled ${availableClosers[i].name} as closer`);
        }
        
        console.log(`[Scheduler] Cashier ${dayName}: Scheduled ${openersScheduled} openers, ${closersScheduled} closers, total=${cashiersByDay[dayIndex]}`);
      }
      
      console.log(`[Scheduler] FINAL Cashiers by day: Sat=${cashiersByDay[6]}, Sun=${cashiersByDay[0]}, Fri=${cashiersByDay[5]}`);
      
      // Log any days that couldn't get full cashier coverage
      for (const dayIndex of cashierDayOrder) {
        const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
        if (isHoliday(currentDay)) continue;
        
        const dayName = shortDayNames[dayIndex];
        const target = cashierTargets[dayIndex] || openersRequired;
        const isSunday = dayIndex === 0;
        const maxForDay = isSunday ? Math.min(target, cashiersByDay[6]) : target;
        
        if (cashiersByDay[dayIndex] < maxForDay) {
          console.log(`[Scheduler] WARNING: ${dayName} is short ${maxForDay - cashiersByDay[dayIndex]} cashier(s)`);
        }
      }

      console.log(`[Scheduler] After Phase 1: ${pendingShifts.length} shifts scheduled`);

      // ========== PHASE 2: FILL REMAINING CAPACITY (Saturday-first for priority staffing) ==========
      // Process Saturday first, then other weekend days, then weekdays
      // This ensures Saturday and Friday get adequate staffing before weekdays
      // Part-timers get flexible shift selection (full or short based on what maximizes hours)
      
      // Track how many additional shifts we want per day (Sat/Fri get 30% more)
      const additionalTargets: Record<number, number> = {};
      const additionalAssigned: Record<number, number> = {};
      const baseAdditionalShifts = 4;
      for (let d = 0; d < 7; d++) {
        additionalTargets[d] = Math.ceil(baseAdditionalShifts * (dayMultiplier[d] || 1.0));
        additionalAssigned[d] = 0;
      }
      
      // Saturday-first day order for Phase 2 (matching Phase 1)
      const phase2DayOrder = saturdayFirstOrder; // Sat, Fri, Sun, Mon, Tue, Wed, Thu
      
      // Round-robin: keep cycling through days until all targets are met or no progress
      let phase2Progress = true;
      while (phase2Progress) {
        phase2Progress = false;
        
        // Process days in Saturday-first order
        for (const dayIndex of phase2DayOrder) {
          if (additionalAssigned[dayIndex] >= additionalTargets[dayIndex]) continue;
          
          const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
          
          // Skip holidays
          if (isHoliday(currentDay)) continue;
          
          const shifts = getShiftTimes(currentDay);
          
          // Get all available employees who can work any shift today (shuffled for variety)
          // Sort by fewest days worked first (to spread evenly), then by priority
          // Include donor greeters for Saturday-priority additional staffing
          const allAvailable = shuffleArray([...donorGreeters, ...donationPricers, ...apparelProcessors, ...cashiers])
            .filter(e => canWorkShortShift(e, currentDay, dayIndex) || canWorkFullShift(e, currentDay, dayIndex))
            .sort((a, b) => {
              // Prefer employees who have worked fewer days (spread coverage evenly)
              const daysWorkedDiff = employeeState[a.id].daysWorked - employeeState[b.id].daysWorked;
              if (daysWorkedDiff !== 0) return daysWorkedDiff;
              // Then by priority (pre-shuffle provides randomness for equal priority)
              return getEmployeePriority(a) - getEmployeePriority(b);
            });
          
          // Try to assign just ONE shift per day per cycle (round-robin)
          for (const emp of allAvailable) {
            const shiftRotation = [shifts.early9, shifts.mid10, shifts.mid11, shifts.closer];
            
            if (isPartTime(emp)) {
              const bestShift = getBestShiftForPartTimer(emp, currentDay, dayIndex, shifts);
              if (bestShift && matchesShiftPreference(emp, bestShift.start, dayIndex)) {
                scheduleShift(emp, bestShift.start, bestShift.end, dayIndex);
                additionalAssigned[dayIndex]++;
                phase2Progress = true;
                break; // Move to next day
              }
            } else if (canWorkFullShift(emp, currentDay, dayIndex)) {
              let shiftOptions: { start: Date; end: Date }[];
              if (['DONPRI', 'DONPRWV', 'APPROC', 'APWV'].includes(emp.jobTitle)) {
                shiftOptions = [shifts.opener, shifts.early9];
              } else if (['DONDOOR', 'WVDON'].includes(emp.jobTitle)) {
                shiftOptions = [shifts.closer, shifts.mid11];
              } else {
                shiftOptions = shiftRotation;
              }
              // Respect shift preference — only pick from slots that match
              const validOptions = shiftOptions.filter(s => matchesShiftPreference(emp, s.start, dayIndex));
              if (validOptions.length === 0) continue;
              const shift = randomPick(validOptions);
              scheduleShift(emp, shift.start, shift.end, dayIndex);
              additionalAssigned[dayIndex]++;
              phase2Progress = true;
              break; // Move to next day
            }
          }
        }
      }

      console.log(`[Scheduler] After Phase 2: ${pendingShifts.length} shifts scheduled`);

      // ========== CALCULATE BUDGET (DISABLED - Maximize employee hours instead) ==========
      // const activeLocations = locations.filter(l => l.isActive);
      // const totalBudgetHours = activeLocations.reduce((sum, loc) => sum + (loc.weeklyHoursLimit || 0), 0);
      // console.log(`[Scheduler] Budget: ${totalBudgetHours} hours from ${activeLocations.length} active locations`);
      
      // Instead of budget, calculate total capacity from employee max hours
      const totalEmployeeCapacity = employees.reduce((sum, e) => sum + (e.maxWeeklyHours || 40), 0);
      console.log(`[Scheduler] Total employee capacity: ${totalEmployeeCapacity} hours from ${employees.length} employees`);
      
      // Calculate current total scheduled hours using pending shift times
      const getTotalScheduledHours = () => {
        return pendingShifts.reduce((sum, shift) => {
          return sum + calculateShiftPaidHours(shift.startTime, shift.endTime);
        }, 0);
      };
      
      // Calculate hours per day using pending shift times
      const getHoursPerDay = () => {
        const dayHours: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
        for (const shift of pendingShifts) {
          const shiftDate = new Date(shift.startTime);
          const dayOfWeek = shiftDate.getDay();
          const paidHours = calculateShiftPaidHours(shift.startTime, shift.endTime);
          dayHours[dayOfWeek] += paidHours;
        }
        return dayHours;
      };

      // ========== PHASE 3: MAXIMIZE EMPLOYEE HOURS (Round-robin) ==========
      // Fill each employee to their max hours using round-robin across days
      // This ensures even distribution of hours across all 7 days
      // IMPORTANT: Use Saturday-first ordering to maintain Saturday >= Sunday for greeters/cashiers
      
      // Track greeter/cashier counts per day for Phase 3 (continuing from Phase 1)
      // Initialize from existing shifts
      const phase3GreetersByDay: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
      const phase3CashiersByDay: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
      
      // Count existing shifts from Phase 1
      for (const shift of pendingShifts) {
        const shiftDate = new Date(shift.startTime);
        const dayOfWeek = shiftDate.getDay();
        const emp = employees.find(e => e.id === shift.employeeId);
        if (emp) {
          if (donorGreeterCodes.includes(emp.jobTitle)) {
            phase3GreetersByDay[dayOfWeek]++;
          } else if (cashierCodes.includes(emp.jobTitle)) {
            phase3CashiersByDay[dayOfWeek]++;
          }
        }
      }
      
      console.log(`[Scheduler] Phase 3 starting - Greeters: Sat=${phase3GreetersByDay[6]}, Sun=${phase3GreetersByDay[0]}`);
      console.log(`[Scheduler] Phase 3 starting - Cashiers: Sat=${phase3CashiersByDay[6]}, Sun=${phase3CashiersByDay[0]}`);
      
      // Keep filling until no one can take more shifts
      let madeProgress = true;
      let iterations = 0;
      const maxIterations = 50; // Prevent infinite loops
      
      // Use Saturday-first day order to ensure Saturday gets priority
      const phase3DayOrder = saturdayFirstOrder; // Sat first, then Fri, Sun, Mon...
      
      while (madeProgress && iterations < maxIterations) {
        madeProgress = false;
        iterations++;
        
        // Process each day in Saturday-first order
        for (const dayIndex of phase3DayOrder) {
          const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
          
          // Skip holidays
          if (isHoliday(currentDay)) continue;
          
          const shifts = getShiftTimes(currentDay);
          const isSunday = dayIndex === 0;

          // Find employees who can still work (either full or short shifts)
          // Shuffle first, then sort by fewest days worked for even distribution with variety
          // IMPORTANT: Leadership employees must respect their random off days
          const underScheduled = shuffleArray([...managers, ...donorGreeters, ...donationPricers, ...apparelProcessors, ...cashiers])
            .filter(e => {
              // Leadership must respect random off days
              if (allLeadershipCodes.includes(e.jobTitle)) {
                if (!canManagerWorkDay(e, currentDay, dayIndex)) return false;
              }
              const canWork = canWorkShortShift(e, currentDay, dayIndex) || canWorkFullShift(e, currentDay, dayIndex);
              if (!canWork) return false;
              
              // For Sunday: enforce Saturday >= Sunday constraint for greeters and cashiers
              if (isSunday) {
                if (donorGreeterCodes.includes(e.jobTitle)) {
                  // Only allow greeter on Sunday if Sunday count < Saturday count
                  if (phase3GreetersByDay[0] >= phase3GreetersByDay[6]) {
                    return false;
                  }
                }
                if (cashierCodes.includes(e.jobTitle)) {
                  // Only allow cashier on Sunday if Sunday count < Saturday count
                  if (phase3CashiersByDay[0] >= phase3CashiersByDay[6]) {
                    return false;
                  }
                }
              }
              return true;
            })
            .sort((a, b) => {
              // Prefer employees who have worked fewer days (spread coverage evenly)
              const daysWorkedDiff = employeeState[a.id].daysWorked - employeeState[b.id].daysWorked;
              if (daysWorkedDiff !== 0) return daysWorkedDiff;
              // Then by priority (pre-shuffle provides randomness for equal priority)
              return getEmployeePriority(a) - getEmployeePriority(b);
            });

          // Assign ONE employee per day per iteration (round-robin)
          for (const emp of underScheduled) {
            // Managers always get full shifts with random shift types
            if (allLeadershipCodes.includes(emp.jobTitle)) {
              if (!canManagerWorkDay(emp, currentDay, dayIndex)) continue;
              // Randomize shift type for variety (opener, closer, or mid)
              const shiftType = randomPick(['opener', 'closer', 'mid'] as const);
              let shift;
              if (shiftType === 'opener') {
                shift = shifts.opener;
              } else if (shiftType === 'closer') {
                shift = shifts.closer;
              } else {
                shift = randomPick([shifts.mid10, shifts.mid11, shifts.early9]);
              }
              scheduleShift(emp, shift.start, shift.end, dayIndex);
              madeProgress = true;
              break; // Move to next day (round-robin)
            } 
            // Part-timers get flexible shift selection
            else if (isPartTime(emp)) {
              const bestShift = getBestShiftForPartTimer(emp, currentDay, dayIndex, shifts);
              if (bestShift) {
                scheduleShift(emp, bestShift.start, bestShift.end, dayIndex);
                madeProgress = true;
                // Update tracking for greeters/cashiers
                if (donorGreeterCodes.includes(emp.jobTitle)) {
                  phase3GreetersByDay[dayIndex]++;
                } else if (cashierCodes.includes(emp.jobTitle)) {
                  phase3CashiersByDay[dayIndex]++;
                }
                break; // Move to next day (round-robin)
              }
            }
            // Full-timers get full shifts only
            else if (canWorkFullShift(emp, currentDay, dayIndex)) {
              let shift;
              if (['DONPRI', 'DONPRWV', 'APPROC', 'APWV'].includes(emp.jobTitle)) {
                shift = randomPick([shifts.opener, shifts.early9]);
              } else if (['DONDOOR', 'WVDON'].includes(emp.jobTitle)) {
                shift = randomPick([shifts.closer, shifts.mid11]);
              } else {
                shift = randomPick([shifts.opener, shifts.early9, shifts.mid10, shifts.mid11, shifts.closer]);
              }
              scheduleShift(emp, shift.start, shift.end, dayIndex);
              madeProgress = true;
              // Update tracking for greeters/cashiers
              if (donorGreeterCodes.includes(emp.jobTitle)) {
                phase3GreetersByDay[dayIndex]++;
              } else if (cashierCodes.includes(emp.jobTitle)) {
                phase3CashiersByDay[dayIndex]++;
              }
              break; // Move to next day (round-robin)
            }
          }
        }
      }
      
      console.log(`[Scheduler] Phase 3 complete - Greeters: Sat=${phase3GreetersByDay[6]}, Sun=${phase3GreetersByDay[0]}`);
      console.log(`[Scheduler] Phase 3 complete - Cashiers: Sat=${phase3CashiersByDay[6]}, Sun=${phase3CashiersByDay[0]}`);

      console.log(`[Scheduler] After Phase 3: ${pendingShifts.length} shifts, ${getTotalScheduledHours()} hours`);

      // ========== PHASE 4: FILL REMAINING HOURS WITH GAP/SHORT SHIFTS ==========
      // For part-time employees who have remaining hours, add appropriate shifts to reach max
      // - 5h gap shift for employees with exactly 5h remaining (e.g., 24h + 5h = 29h)
      // - 5.5h short shift for employees with 5.5h+ remaining
      // Note: Managers are excluded - they should only work full opener/closer shifts for coverage
      // IMPORTANT: Use Saturday-first ordering to maintain Saturday >= Sunday for greeters/cashiers
      const allRetailEmployees = [...donorGreeters, ...donationPricers, ...apparelProcessors, ...cashiers];
      
      // Track greeter/cashier counts for Phase 4 (continuing from Phase 3)
      const phase4GreetersByDay = { ...phase3GreetersByDay };
      const phase4CashiersByDay = { ...phase3CashiersByDay };
      
      // Use Saturday-first day order
      const phase4DayOrder = saturdayFirstOrder;
      
      // Shuffle first, then sort by employees who are closest to max (smallest gap first)
      // This provides variety for employees with similar remaining hours
      const sortedForPhase4 = shuffleArray([...allRetailEmployees]).sort((a, b) => {
        const gapA = getRemainingHours(a);
        const gapB = getRemainingHours(b);
        return gapA - gapB; // Smallest gap first, pre-shuffle provides randomness for ties
      });
      
      for (const emp of sortedForPhase4) {
        const remaining = getRemainingHours(emp);
        const state = employeeState[emp.id];
        
        // Skip if they can't work more days
        if (state.daysWorked >= getMaxDays(emp)) continue;
        
        // Use gap shift (5h) if remaining is exactly 5h or close to it
        if (remaining >= 5 && remaining <= 5.5) {
          for (const dayIndex of phase4DayOrder) { // Saturday-first distribution
            if (state.daysWorkedOn.has(dayIndex)) continue;
            
            const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
            if (isOnTimeOff(emp.id, currentDay, dayIndex)) continue;
            if (!canWorkGapShift(emp, currentDay, dayIndex)) continue;
            
            // For Sunday: enforce Saturday >= Sunday constraint
            const isSunday = dayIndex === 0;
            if (isSunday) {
              if (donorGreeterCodes.includes(emp.jobTitle) && phase4GreetersByDay[0] >= phase4GreetersByDay[6]) continue;
              if (cashierCodes.includes(emp.jobTitle) && phase4CashiersByDay[0] >= phase4CashiersByDay[6]) continue;
            }
            
            const shifts = getShiftTimes(currentDay);
            
            // Assign gap shift based on role with randomness
            let gapShift;
            if (['DONPRI', 'DONPRWV', 'APPROC', 'APWV'].includes(emp.jobTitle)) {
              gapShift = shifts.gapMorning;
            } else if (['DONDOOR', 'WVDON'].includes(emp.jobTitle)) {
              gapShift = randomPick([shifts.gapMid, shifts.gapEvening]);
            } else {
              gapShift = randomPick([shifts.gapMorning, shifts.gapMid, shifts.gapEvening]);
            }
            
            scheduleShift(emp, gapShift.start, gapShift.end, dayIndex);
            // Update tracking
            if (donorGreeterCodes.includes(emp.jobTitle)) phase4GreetersByDay[dayIndex]++;
            if (cashierCodes.includes(emp.jobTitle)) phase4CashiersByDay[dayIndex]++;
            break;
          }
        }
        // Use short shift (5.5h) if remaining is more than 5.5h but less than 8h
        else if (remaining >= SHORT_SHIFT_HOURS && remaining < FULL_SHIFT_HOURS) {
          for (const dayIndex of phase4DayOrder) { // Saturday-first distribution
            if (state.daysWorkedOn.has(dayIndex)) continue;
            
            const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
            if (isOnTimeOff(emp.id, currentDay, dayIndex)) continue;
            if (!canWorkShortShift(emp, currentDay, dayIndex)) continue;
            
            // For Sunday: enforce Saturday >= Sunday constraint
            const isSunday = dayIndex === 0;
            if (isSunday) {
              if (donorGreeterCodes.includes(emp.jobTitle) && phase4GreetersByDay[0] >= phase4GreetersByDay[6]) continue;
              if (cashierCodes.includes(emp.jobTitle) && phase4CashiersByDay[0] >= phase4CashiersByDay[6]) continue;
            }
            
            const shifts = getShiftTimes(currentDay);
            
            // Assign short shift based on role with randomness
            let shortShift;
            if (['DONPRI', 'DONPRWV', 'APPROC', 'APWV'].includes(emp.jobTitle)) {
              shortShift = randomPick([shifts.shortMorning, shifts.shortMid10]);
            } else if (['DONDOOR', 'WVDON'].includes(emp.jobTitle)) {
              shortShift = randomPick([shifts.shortMid10, shifts.shortMid12, shifts.shortEvening]);
            } else {
              shortShift = randomPick([shifts.shortMorning, shifts.shortMid, shifts.shortMid10]);
            }
            
            scheduleShift(emp, shortShift.start, shortShift.end, dayIndex);
            // Update tracking
            if (donorGreeterCodes.includes(emp.jobTitle)) phase4GreetersByDay[dayIndex]++;
            if (cashierCodes.includes(emp.jobTitle)) phase4CashiersByDay[dayIndex]++;
            break;
          }
        }
      }
      
      console.log(`[Scheduler] Phase 4 complete - Greeters: Sat=${phase4GreetersByDay[6]}, Sun=${phase4GreetersByDay[0]}`);
      console.log(`[Scheduler] Phase 4 complete - Cashiers: Sat=${phase4CashiersByDay[6]}, Sun=${phase4CashiersByDay[0]}`);

      // Debug: Log part-timer hours allocation
      const partTimerSummary = employees
        .filter(e => e.maxWeeklyHours <= 29 && e.isActive)
        .map(e => ({
          name: e.name,
          maxHours: e.maxWeeklyHours,
          scheduled: employeeState[e.id].hoursScheduled,
          daysWorked: employeeState[e.id].daysWorked,
          gap: e.maxWeeklyHours - employeeState[e.id].hoursScheduled
        }))
        .filter(e => e.scheduled > 0) // Only show those with shifts
        .sort((a, b) => b.gap - a.gap); // Sort by largest gap first
      
      console.log(`[Scheduler] Part-timer summary (showing top 10 with gaps):`);
      partTimerSummary.slice(0, 10).forEach(pt => {
        console.log(`  ${pt.name}: ${pt.scheduled}h / ${pt.maxHours}h max (${pt.daysWorked} days, gap: ${pt.gap.toFixed(1)}h)`);
      });

      // ========== BATCH INSERT ALL SHIFTS ==========
      const validShifts = pendingShifts.filter(s => {
        const start = new Date(s.startTime).getTime();
        const end = new Date(s.endTime).getTime();
        if (isNaN(start) || isNaN(end) || end <= start) {
          console.error(`[Scheduler] Discarding invalid shift: employee=${s.employeeId}, start=${s.startTime}, end=${s.endTime}`);
          return false;
        }
        return true;
      });
      if (validShifts.length !== pendingShifts.length) {
        console.warn(`[Scheduler] Filtered out ${pendingShifts.length - validShifts.length} invalid shifts`);
      }
      console.log(`[Scheduler] Batch inserting ${validShifts.length} shifts...`);
      const insertedShifts = await storage.createShiftsBatch(validShifts);
      
      console.log(`[Scheduler] COMPLETE: ${insertedShifts.length} shifts, ${getTotalScheduledHours()} total hours`);
      return insertedShifts;
}
