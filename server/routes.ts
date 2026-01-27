
import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { ukgClient } from "./ukg";
import { RETAIL_JOB_CODES } from "@shared/schema";
import { toZonedTime, fromZonedTime } from "date-fns-tz";

const TIMEZONE = "America/New_York";

// Create a date with specific time in EST timezone
function createESTTime(baseDate: Date, hours: number, minutes: number = 0): Date {
  const zonedDate = toZonedTime(baseDate, TIMEZONE);
  zonedDate.setHours(hours, minutes, 0, 0);
  return fromZonedTime(zonedDate, TIMEZONE);
}

// Middleware to require authentication (uses session user like rest of codebase)
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = (req.session as any)?.user;
  if (!user) {
    return res.status(401).json({ message: "Authentication required" });
  }
  next();
}

// Middleware to require admin role
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req.session as any)?.user;
  if (!user || user.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // === Employees ===
  app.get(api.employees.list.path, async (req, res) => {
    let employees = await storage.getEmployees();
    
    // Filter by retail job codes if requested
    const retailOnly = req.query.retailOnly === "true";
    if (retailOnly) {
      employees = employees.filter(emp => 
        RETAIL_JOB_CODES.some(code => emp.jobTitle.toUpperCase().includes(code))
      );
    }
    
    // Filter by location for users with assigned locations (applies to all roles including admin)
    // user.locationIds contains location IDs (as strings), but emp.location contains location NAMES
    // We need to look up the location names from the IDs
    const user = (req.session as any)?.user;
    if (user && user.locationIds && user.locationIds.length > 0) {
      const allLocations = await storage.getLocations();
      const userLocationNames = allLocations
        .filter(loc => user.locationIds.includes(String(loc.id)))
        .map(loc => loc.name);
      
      employees = employees.filter(emp => 
        emp.location && userLocationNames.includes(emp.location)
      );
    }
    
    res.json(employees);
  });

  app.get(api.employees.get.path, async (req, res) => {
    const employee = await storage.getEmployee(Number(req.params.id));
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    res.json(employee);
  });

  app.post(api.employees.create.path, async (req, res) => {
    try {
      const input = api.employees.create.input.parse(req.body);
      const employee = await storage.createEmployee(input);
      res.status(201).json(employee);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.put(api.employees.update.path, async (req, res) => {
    try {
      const input = api.employees.update.input.parse(req.body);
      const employee = await storage.updateEmployee(Number(req.params.id), input);
      res.json(employee);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      return res.status(404).json({ message: "Employee not found" });
    }
  });

  app.delete(api.employees.delete.path, async (req, res) => {
    await storage.deleteEmployee(Number(req.params.id));
    res.status(204).send();
  });

  // === Shifts ===
  app.get(api.shifts.list.path, async (req, res) => {
    // Parse query params for filtering
    const start = req.query.start ? new Date(req.query.start as string) : undefined;
    const end = req.query.end ? new Date(req.query.end as string) : undefined;
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
    
    const shifts = await storage.getShifts(start, end, employeeId);
    res.json(shifts);
  });

  app.post(api.shifts.create.path, async (req, res) => {
    try {
      // Coerce dates from strings if necessary (though Zod usually handles this if schema is set up right)
      // The schema expects dates/timestamps.
      const input = api.shifts.create.input.parse({
        ...req.body,
        startTime: new Date(req.body.startTime),
        endTime: new Date(req.body.endTime)
      });
      const shift = await storage.createShift(input);
      res.status(201).json(shift);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.put(api.shifts.update.path, async (req, res) => {
    try {
       const body = { ...req.body };
       if (body.startTime) body.startTime = new Date(body.startTime);
       if (body.endTime) body.endTime = new Date(body.endTime);

      const input = api.shifts.update.input.parse(body);
      const shift = await storage.updateShift(Number(req.params.id), input);
      res.json(shift);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      return res.status(404).json({ message: "Shift not found" });
    }
  });

  app.delete(api.shifts.delete.path, async (req, res) => {
    await storage.deleteShift(Number(req.params.id));
    res.status(204).send();
  });

  // === Time Off Requests ===
  app.get(api.timeOffRequests.list.path, async (req, res) => {
    const requests = await storage.getTimeOffRequests();
    res.json(requests);
  });

  app.post(api.timeOffRequests.create.path, async (req, res) => {
    try {
      const input = api.timeOffRequests.create.input.parse(req.body);
      const request = await storage.createTimeOffRequest(input);
      res.status(201).json(request);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.put(api.timeOffRequests.update.path, async (req, res) => {
    try {
      const input = api.timeOffRequests.update.input.parse(req.body);
      const request = await storage.updateTimeOffRequest(Number(req.params.id), input);
      res.json(request);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      return res.status(404).json({ message: "Request not found" });
    }
  });

  // === Role Requirements ===
  app.get(api.roleRequirements.list.path, async (req, res) => {
    const reqs = await storage.getRoleRequirements();
    res.json(reqs);
  });

  app.post(api.roleRequirements.create.path, async (req, res) => {
    try {
      const input = api.roleRequirements.create.input.parse(req.body);
      const reqs = await storage.createRoleRequirement(input);
      res.status(201).json(reqs);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.put(api.roleRequirements.update.path, async (req, res) => {
    try {
      const input = api.roleRequirements.update.input.parse(req.body);
      const reqs = await storage.updateRoleRequirement(Number(req.params.id), input);
      res.json(reqs);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      return res.status(404).json({ message: "Role requirement not found" });
    }
  });

  app.delete(api.roleRequirements.delete.path, async (req, res) => {
    await storage.deleteRoleRequirement(Number(req.params.id));
    res.status(204).send();
  });

  // === Global Settings ===
  app.get(api.globalSettings.get.path, async (req, res) => {
    const settings = await storage.getGlobalSettings();
    res.json(settings);
  });

  app.post(api.globalSettings.update.path, async (req, res) => {
    try {
      const input = api.globalSettings.update.input.parse(req.body);
      const settings = await storage.updateGlobalSettings(input);
      res.json(settings);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.post(api.schedule.generate.path, async (req, res) => {
    try {
      const { weekStart, location } = api.schedule.generate.input.parse(req.body);
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

      // Clear existing shifts for the week
      const weekEndMs = startDate.getTime() + 7 * 24 * 60 * 60 * 1000;
      const weekEndDate = new Date(weekEndMs);
      const existingShifts = await storage.getShifts(startDate, weekEndDate);
      for (const shift of existingShifts) {
        await storage.deleteShift(shift.id);
      }

      const generatedShifts: any[] = [];
      const FULL_SHIFT_HOURS = 8; // 8.5 clock hours - 0.5 unpaid lunch = 8 paid hours
      const SHORT_SHIFT_HOURS = 5.5; // 5.5 clock hours - NO lunch deduction (less than 6 hours)
      
      // ========== EMPLOYEE STATE TRACKING ==========
      const employeeState: Record<number, {
        hoursScheduled: number;
        daysWorked: number;
        daysWorkedOn: Set<number>; // Track which day indices they work
      }> = {};
      
      employees.forEach(emp => {
        employeeState[emp.id] = { hoursScheduled: 0, daysWorked: 0, daysWorkedOn: new Set() };
      });

      // ========== HELPER FUNCTIONS ==========
      const isOnTimeOff = (empId: number, day: Date) => {
        return timeOff.some(to => 
          to.employeeId === empId && 
          to.status === "approved" && 
          new Date(to.startDate) <= day && 
          new Date(to.endDate) >= day
        );
      };
      
      // Check if employee can work a full 8-hour shift
      const canWorkFullShift = (emp: typeof employees[0], day: Date, dayIndex: number) => {
        const state = employeeState[emp.id];
        if (!emp.isActive) return false;
        if (isOnTimeOff(emp.id, day)) return false;
        if (state.hoursScheduled + FULL_SHIFT_HOURS > emp.maxWeeklyHours) return false;
        if (state.daysWorked >= 5) return false; // Max 5 days = minimum 2 days off
        if (state.daysWorkedOn.has(dayIndex)) return false; // Already working this day
        return true;
      };
      
      // Check if employee can work a short 5.5-hour shift
      const canWorkShortShift = (emp: typeof employees[0], day: Date, dayIndex: number) => {
        const state = employeeState[emp.id];
        if (!emp.isActive) return false;
        if (isOnTimeOff(emp.id, day)) return false;
        if (state.hoursScheduled + SHORT_SHIFT_HOURS > emp.maxWeeklyHours) return false;
        if (state.daysWorked >= 5) return false;
        if (state.daysWorkedOn.has(dayIndex)) return false;
        return true;
      };
      
      // Check if employee can work ANY shift (including shorter shifts to fill remaining hours)
      const canWorkAnyShift = (emp: typeof employees[0], day: Date, dayIndex: number) => {
        const state = employeeState[emp.id];
        if (!emp.isActive) return false;
        if (isOnTimeOff(emp.id, day)) return false;
        if (state.hoursScheduled >= emp.maxWeeklyHours) return false; // Already maxed
        if (state.daysWorked >= 5) return false;
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
      // For 29 max hours: 5 short shifts (27.5h) > 3 full shifts (24h)
      // Strategy: part-timers with <= 29 max hours should always use short shifts
      // because 5 short = 27.5h beats any mix with full shifts
      const getBestShiftForPartTimer = (emp: typeof employees[0], day: Date, dayIndex: number, shifts: ReturnType<typeof getShiftTimes>) => {
        const remaining = getRemainingHours(emp);
        
        // For employees with 29 or fewer max hours, short shifts are always better
        // 5 short shifts = 27.5h (best for 29 max)
        // Only use full shifts if they can't fit a short shift but can fit a full
        const preferShort = emp.maxWeeklyHours <= 29;
        
        // Get appropriate shift based on role
        if (preferShort && canWorkShortShift(emp, day, dayIndex)) {
          if (['DONPRI', 'APPROC'].includes(emp.jobTitle)) {
            return shifts.shortMorning;
          } else if (emp.jobTitle === 'DONDOOR') {
            return shifts.shortEvening;
          } else {
            return shifts.shortMid;
          }
        } else if (canWorkFullShift(emp, day, dayIndex)) {
          if (['DONPRI', 'APPROC'].includes(emp.jobTitle)) {
            return shifts.opener;
          } else if (emp.jobTitle === 'DONDOOR') {
            return shifts.closer;
          } else {
            return shifts.mid10;
          }
        } else if (canWorkShortShift(emp, day, dayIndex)) {
          // Fallback: if can't do full shift but can do short, do short
          if (['DONPRI', 'APPROC'].includes(emp.jobTitle)) {
            return shifts.shortMorning;
          } else if (emp.jobTitle === 'DONDOOR') {
            return shifts.shortEvening;
          } else {
            return shifts.shortMid;
          }
        }
        return null;
      };
      
      // Priority score: lower = should schedule first (employees needing more hours)
      const getEmployeePriority = (emp: typeof employees[0]) => {
        const state = employeeState[emp.id];
        const hoursRemaining = emp.maxWeeklyHours - state.hoursScheduled;
        const daysRemaining = 5 - state.daysWorked;
        // Prioritize: more hours remaining, fewer days already worked
        return -(hoursRemaining * 10 + daysRemaining);
      };

      // Calculate paid hours from a shift (subtract 0.5 for lunch if 6+ hours)
      const calculateShiftPaidHours = (startTime: Date, endTime: Date) => {
        const clockHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
        return clockHours >= 6 ? clockHours - 0.5 : clockHours;
      };

      const scheduleShift = async (emp: typeof employees[0], startTime: Date, endTime: Date, dayIndex: number) => {
        const paidHours = calculateShiftPaidHours(startTime, endTime);
        const shift = await storage.createShift({ 
          employeeId: emp.id, 
          startTime, 
          endTime 
        });
        generatedShifts.push(shift);
        employeeState[emp.id].hoursScheduled += paidHours;
        employeeState[emp.id].daysWorked++;
        employeeState[emp.id].daysWorkedOn.add(dayIndex);
        return { shift, paidHours };
      };

      // ========== CATEGORIZE EMPLOYEES ==========
      const managerCodes = ['STSUPER', 'STASSTSP', 'STLDWKR'];
      const managers = employees.filter(emp => managerCodes.includes(emp.jobTitle) && emp.isActive);
      const donorGreeters = employees.filter(emp => emp.jobTitle === 'DONDOOR' && emp.isActive);
      const donationPricers = employees.filter(emp => ['DONPRI', 'APPROC'].includes(emp.jobTitle) && emp.isActive);
      const cashiers = employees.filter(emp => emp.jobTitle === 'CASHSLS' && emp.isActive);
      
      console.log(`[Scheduler] Total employees: ${employees.length}`);
      console.log(`[Scheduler] Managers: ${managers.length}, Greeters: ${donorGreeters.length}, Pricers: ${donationPricers.length}, Cashiers: ${cashiers.length}`);

      // ========== SHIFT TIME DEFINITIONS ==========
      const getShiftTimes = (day: Date) => {
        const dayOfWeek = day.getDay(); // 0 = Sunday
        const isSunday = dayOfWeek === 0;
        
        return {
          // Full 8-hour shifts (8.5 clock hours)
          opener: { start: createESTTime(day, 8, 0), end: createESTTime(day, 16, 30) },
          early9: { start: createESTTime(day, 9, 0), end: createESTTime(day, 17, 30) },
          mid10: { start: createESTTime(day, 10, 0), end: createESTTime(day, 18, 30) },
          mid11: { start: createESTTime(day, 11, 0), end: createESTTime(day, 19, 30) },
          // Sunday closes at 7:30pm, so closer is 11am-7:30pm instead of 12pm-8:30pm
          closer: isSunday 
            ? { start: createESTTime(day, 11, 0), end: createESTTime(day, 19, 30) }
            : { start: createESTTime(day, 12, 0), end: createESTTime(day, 20, 30) },
          // Short 5-hour shifts (5.5 clock hours) for filling remaining PT hours
          shortMorning: { start: createESTTime(day, 8, 0), end: createESTTime(day, 13, 30) },
          shortMid: { start: createESTTime(day, 11, 0), end: createESTTime(day, 16, 30) },
          // Sunday short evening ends at 7:30pm
          shortEvening: isSunday
            ? { start: createESTTime(day, 14, 0), end: createESTTime(day, 19, 30) }
            : { start: createESTTime(day, 15, 0), end: createESTTime(day, 20, 30) }
        };
      };

      // ========== DAILY COVERAGE REQUIREMENTS ==========
      const managersRequired = settings.managersRequired ?? 1;
      const openersRequired = settings.openersRequired ?? 2;
      const closersRequired = settings.closersRequired ?? 2;

      // Day weights: Sat/Fri get more staff, but all days get coverage
      // Process in order: Sat, Fri, then Sun-Thu to fill priority days first
      const dayOrder = [6, 5, 0, 1, 2, 3, 4]; // Sat, Fri, Sun, Mon, Tue, Wed, Thu
      const dayMultiplier: Record<number, number> = {
        6: 1.3, // Saturday - 30% more staff
        5: 1.3, // Friday - 30% more staff  
        0: 1.0, 1: 1.0, 2: 1.0, 3: 1.0, 4: 1.0 // Weekdays - baseline
      };

      // ========== PHASE 1: MANDATORY COVERAGE (All 7 days) ==========
      // First pass: ensure every day has minimum required coverage
      // IMPORTANT: Prefer full-timers for coverage positions to maximize part-timer flexibility
      for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
        const shifts = getShiftTimes(currentDay);

        // Helper to sort employees: full-timers first, then by priority
        const sortFullTimersFirst = (a: typeof employees[0], b: typeof employees[0]) => {
          // Full-timers (>= 32h) should come before part-timers
          const aIsFullTime = a.maxWeeklyHours >= 32;
          const bIsFullTime = b.maxWeeklyHours >= 32;
          if (aIsFullTime && !bIsFullTime) return -1;
          if (!aIsFullTime && bIsFullTime) return 1;
          // If same type, sort by priority
          return getEmployeePriority(a) - getEmployeePriority(b);
        };

        // 1a. Morning Manager - sort by priority (who needs hours most)
        const availableManagers = managers
          .filter(m => canWorkFullShift(m, currentDay, dayIndex))
          .sort(sortFullTimersFirst);
        
        for (let i = 0; i < managersRequired && i < availableManagers.length; i++) {
          await scheduleShift(availableManagers[i], shifts.opener.start, shifts.opener.end, dayIndex);
        }

        // 1b. Evening Manager (different from morning)
        const eveningManagers = managers
          .filter(m => canWorkFullShift(m, currentDay, dayIndex))
          .sort(sortFullTimersFirst);
        
        for (let i = 0; i < managersRequired && i < eveningManagers.length; i++) {
          await scheduleShift(eveningManagers[i], shifts.closer.start, shifts.closer.end, dayIndex);
        }

        // 1c. Opening Donor Greeter - prefer full-timers
        const availableGreeters = donorGreeters
          .filter(g => canWorkFullShift(g, currentDay, dayIndex))
          .sort(sortFullTimersFirst);
        
        if (availableGreeters.length > 0) {
          await scheduleShift(availableGreeters[0], shifts.opener.start, shifts.opener.end, dayIndex);
        }

        // 1d. Closing Donor Greeter - prefer full-timers
        const closingGreeters = donorGreeters
          .filter(g => canWorkFullShift(g, currentDay, dayIndex))
          .sort(sortFullTimersFirst);
        
        if (closingGreeters.length > 0) {
          await scheduleShift(closingGreeters[0], shifts.closer.start, shifts.closer.end, dayIndex);
        }

        // 1e. Opening cashiers - prefer full-timers
        const availableCashiers = cashiers
          .filter(c => canWorkFullShift(c, currentDay, dayIndex))
          .sort(sortFullTimersFirst);
        
        for (let i = 0; i < openersRequired && i < availableCashiers.length; i++) {
          await scheduleShift(availableCashiers[i], shifts.opener.start, shifts.opener.end, dayIndex);
        }

        // 1f. Closing cashiers - prefer full-timers
        const closingCashiers = cashiers
          .filter(c => canWorkFullShift(c, currentDay, dayIndex))
          .sort(sortFullTimersFirst);
        
        for (let i = 0; i < closersRequired && i < closingCashiers.length; i++) {
          await scheduleShift(closingCashiers[i], shifts.closer.start, shifts.closer.end, dayIndex);
        }

        // 1g. Donation Pricers - use short morning shifts for part-timers, full for full-timers
        // Pricers don't need to be there all day, just early morning for pricing
        const availablePricers = donationPricers
          .filter(p => canWorkShortShift(p, currentDay, dayIndex) || canWorkFullShift(p, currentDay, dayIndex))
          .sort(sortFullTimersFirst);
        
        // Schedule at least 2 pricers per day on early shifts
        const minPricers = Math.min(2, availablePricers.length);
        for (let i = 0; i < minPricers; i++) {
          const pricer = availablePricers[i];
          // Part-timers (<=29h) get short morning shifts to maximize their weekly hours
          if (pricer.maxWeeklyHours <= 29 && canWorkShortShift(pricer, currentDay, dayIndex)) {
            await scheduleShift(pricer, shifts.shortMorning.start, shifts.shortMorning.end, dayIndex);
          } else if (canWorkFullShift(pricer, currentDay, dayIndex)) {
            const shift = i % 2 === 0 ? shifts.opener : shifts.early9;
            await scheduleShift(pricer, shift.start, shift.end, dayIndex);
          }
        }
      }

      console.log(`[Scheduler] After Phase 1: ${generatedShifts.length} shifts scheduled`);

      // ========== PHASE 2: FILL REMAINING CAPACITY (Priority days first) ==========
      // Now fill additional shifts, prioritizing Sat/Fri
      // Part-timers get flexible shift selection (full or short based on what maximizes hours)
      for (const dayIndex of dayOrder) {
        const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
        const shifts = getShiftTimes(currentDay);
        const multiplier = dayMultiplier[dayIndex] || 1.0;

        // Calculate how many more shifts we can add based on day priority
        const baseAdditionalShifts = 4; // Base additional staff per day
        const additionalTarget = Math.ceil(baseAdditionalShifts * multiplier);

        // Get all available employees who can work any shift today
        const allAvailable = [...donationPricers, ...cashiers]
          .filter(e => canWorkShortShift(e, currentDay, dayIndex) || canWorkFullShift(e, currentDay, dayIndex))
          .sort((a, b) => getEmployeePriority(a) - getEmployeePriority(b));

        // Distribute across shift types
        const shiftRotation = [shifts.early9, shifts.mid10, shifts.mid11, shifts.closer];
        let assigned = 0;

        for (const emp of allAvailable) {
          if (assigned >= additionalTarget) break;
          
          // Part-timers: use flexible shift selection
          if (isPartTime(emp)) {
            const bestShift = getBestShiftForPartTimer(emp, currentDay, dayIndex, shifts);
            if (bestShift) {
              await scheduleShift(emp, bestShift.start, bestShift.end, dayIndex);
              assigned++;
            }
          } else if (canWorkFullShift(emp, currentDay, dayIndex)) {
            // Full-timers: use full shifts only
            let shift;
            if (['DONPRI', 'APPROC'].includes(emp.jobTitle)) {
              shift = assigned % 2 === 0 ? shifts.opener : shifts.early9;
            } else {
              shift = shiftRotation[assigned % shiftRotation.length];
            }
            await scheduleShift(emp, shift.start, shift.end, dayIndex);
            assigned++;
          }
        }
      }

      console.log(`[Scheduler] After Phase 2: ${generatedShifts.length} shifts scheduled`);

      // ========== CALCULATE BUDGET (DISABLED - Maximize employee hours instead) ==========
      // const activeLocations = locations.filter(l => l.isActive);
      // const totalBudgetHours = activeLocations.reduce((sum, loc) => sum + (loc.weeklyHoursLimit || 0), 0);
      // console.log(`[Scheduler] Budget: ${totalBudgetHours} hours from ${activeLocations.length} active locations`);
      
      // Instead of budget, calculate total capacity from employee max hours
      const totalEmployeeCapacity = employees.reduce((sum, e) => sum + (e.maxWeeklyHours || 40), 0);
      console.log(`[Scheduler] Total employee capacity: ${totalEmployeeCapacity} hours from ${employees.length} employees`);
      
      // Calculate current total scheduled hours using actual shift times
      const getTotalScheduledHours = () => {
        return generatedShifts.reduce((sum, shift) => {
          return sum + calculateShiftPaidHours(new Date(shift.startTime), new Date(shift.endTime));
        }, 0);
      };
      
      // Calculate hours per day using actual shift times
      const getHoursPerDay = () => {
        const dayHours: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
        for (const shift of generatedShifts) {
          const shiftDate = new Date(shift.startTime);
          const dayOfWeek = shiftDate.getDay();
          const paidHours = calculateShiftPaidHours(new Date(shift.startTime), new Date(shift.endTime));
          dayHours[dayOfWeek] += paidHours;
        }
        return dayHours;
      };

      // ========== PHASE 3: MAXIMIZE EMPLOYEE HOURS ==========
      // Fill each employee to their max hours (ignore budget constraints)
      // Part-timers get flexible shift selection to maximize their hours
      
      // Priority order for filling: Sat, Fri, then others
      const fillOrder = [6, 5, 0, 1, 2, 3, 4];
      
      // Keep filling until no one can take more shifts
      let madeProgress = true;
      let iterations = 0;
      const maxIterations = 20; // Prevent infinite loops
      
      while (madeProgress && iterations < maxIterations) {
        madeProgress = false;
        iterations++;
        
        for (const dayIndex of fillOrder) {
          const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
          const shifts = getShiftTimes(currentDay);

          // Find employees who can still work (either full or short shifts)
          const underScheduled = [...managers, ...donorGreeters, ...donationPricers, ...cashiers]
            .filter(e => canWorkShortShift(e, currentDay, dayIndex) || canWorkFullShift(e, currentDay, dayIndex))
            .sort((a, b) => getEmployeePriority(a) - getEmployeePriority(b));

          for (const emp of underScheduled) {
            // Managers always get full shifts (opener or closer only)
            if (managerCodes.includes(emp.jobTitle)) {
              if (!canWorkFullShift(emp, currentDay, dayIndex)) continue;
              const shift = Math.random() > 0.5 ? shifts.opener : shifts.closer;
              await scheduleShift(emp, shift.start, shift.end, dayIndex);
              madeProgress = true;
            } 
            // Part-timers get flexible shift selection
            else if (isPartTime(emp)) {
              const bestShift = getBestShiftForPartTimer(emp, currentDay, dayIndex, shifts);
              if (bestShift) {
                await scheduleShift(emp, bestShift.start, bestShift.end, dayIndex);
                madeProgress = true;
              }
            }
            // Full-timers get full shifts only
            else if (canWorkFullShift(emp, currentDay, dayIndex)) {
              let shift;
              if (['DONPRI', 'APPROC'].includes(emp.jobTitle)) {
                shift = shifts.opener;
              } else if (emp.jobTitle === 'DONDOOR') {
                shift = shifts.closer;
              } else {
                shift = shifts.mid10;
              }
              await scheduleShift(emp, shift.start, shift.end, dayIndex);
              madeProgress = true;
            }
          }
        }
      }

      console.log(`[Scheduler] After Phase 3: ${generatedShifts.length} shifts, ${getTotalScheduledHours()} hours`);

      // ========== PHASE 4: FILL REMAINING HOURS WITH SHORT SHIFTS ==========
      // For part-time employees (29 hrs max) who have 3 full shifts (24 hrs),
      // add a short 5-hour shift to reach their max
      // Note: Managers are excluded - they should only work full opener/closer shifts for coverage
      const allRetailEmployees = [...donorGreeters, ...donationPricers, ...cashiers];
      
      for (const emp of allRetailEmployees) {
        const remaining = getRemainingHours(emp);
        const state = employeeState[emp.id];
        
        // Only add short shift if they have at least 5.5 hours remaining (don't exceed max)
        if (remaining >= SHORT_SHIFT_HOURS && remaining < FULL_SHIFT_HOURS && state.daysWorked < 5) {
          // Find a day they can work
          for (const dayIndex of [6, 5, 0, 1, 2, 3, 4]) { // Priority order
            if (state.daysWorkedOn.has(dayIndex)) continue;
            
            const currentDay = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
            if (isOnTimeOff(emp.id, currentDay)) continue;
            
            const shifts = getShiftTimes(currentDay);
            
            // Assign short shift based on role
            let shortShift;
            if (['DONPRI', 'APPROC'].includes(emp.jobTitle)) {
              shortShift = shifts.shortMorning; // Early short shift for pricers
            } else if (emp.jobTitle === 'DONDOOR') {
              shortShift = shifts.shortEvening; // Evening short for greeters
            } else {
              shortShift = shifts.shortMid; // Mid-day short for others
            }
            
            await scheduleShift(emp, shortShift.start, shortShift.end, dayIndex);
            break; // Only add one short shift per employee
          }
        }
      }

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

      console.log(`[Scheduler] COMPLETE: ${generatedShifts.length} shifts, ${getTotalScheduledHours()} total hours`);
      res.status(201).json(generatedShifts);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // AI-Powered Schedule Generation
  app.post("/api/schedule/generate-ai", async (req, res) => {
    try {
      const { weekStart } = api.schedule.generate.input.parse(req.body);
      
      // Get user's location filter
      const user = (req.session as any)?.user;
      let locationIds: string[] | undefined;
      if (user && user.locationIds && user.locationIds.length > 0) {
        locationIds = user.locationIds;
      }
      
      const { generateAISchedule } = await import("./ai-scheduler");
      const result = await generateAISchedule(weekStart, locationIds);
      
      res.status(201).json({
        shifts: result.shifts,
        reasoning: result.reasoning,
        warnings: result.warnings,
        aiGenerated: true,
      });
    } catch (err) {
      console.error("AI Schedule generation error:", err);
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ 
        message: "Failed to generate AI schedule. Try the standard scheduler instead.",
        error: err instanceof Error ? err.message : "Unknown error"
      });
    }
  });

  // Clear schedule for a week
  app.post("/api/schedule/clear", async (req, res) => {
    try {
      const { weekStart } = api.schedule.generate.input.parse(req.body);
      const startDate = new Date(weekStart);
      const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);
      
      const existingShifts = await storage.getShifts(startDate, endDate);
      let deletedCount = 0;
      
      for (const shift of existingShifts) {
        await storage.deleteShift(shift.id);
        deletedCount++;
      }
      
      res.json({ message: `Cleared ${deletedCount} shifts`, deletedCount });
    } catch (err) {
      console.error("Clear schedule error:", err);
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: "Failed to clear schedule" });
    }
  });

  // === UKG INTEGRATION ===
  app.get(api.ukg.status.path, async (req, res) => {
    const configured = ukgClient.isConfigured();
    let connected = false;
    if (configured) {
      try {
        await ukgClient.getAllEmployees();
        connected = true;
      } catch {
        connected = false;
      }
    }
    res.json({ configured, connected });
  });

  app.get(api.ukg.stores.path, async (req, res) => {
    if (!ukgClient.isConfigured()) {
      return res.json([]);
    }
    const locations = await ukgClient.getLocations();
    res.json(locations);
  });

  app.get(api.ukg.employees.path, async (req, res) => {
    if (!ukgClient.isConfigured()) {
      return res.json([]);
    }
    const storeId = req.query.storeId as string | undefined;
    const employees = storeId 
      ? await ukgClient.getEmployeesByLocation(storeId)
      : await ukgClient.getAllEmployees();
    res.json(employees);
  });

  app.post(api.ukg.sync.path, async (req, res) => {
    try {
      if (!ukgClient.isConfigured()) {
        return res.status(400).json({ message: "UKG is not configured", apiError: null });
      }

      const { storeId } = api.ukg.sync.input.parse(req.body);
      const ukgEmployees = storeId 
        ? await ukgClient.getEmployeesByLocation(storeId)
        : await ukgClient.getAllEmployees();

      const apiError = ukgClient.getLastError();
      if (apiError) {
        return res.json({ imported: 0, updated: 0, errors: 0, skipped: 0, apiError });
      }

      const activeEmployees = ukgEmployees.filter(emp => emp.isActive);
      const skipped = ukgEmployees.length - activeEmployees.length;
      console.log(`UKG: Processing ${activeEmployees.length} active employees (skipping ${skipped} terminated)`);

      let imported = 0;
      let updated = 0;
      let errors = 0;

      for (const ukgEmp of activeEmployees) {
        try {
          const appEmployee = ukgClient.convertToAppEmployee(ukgEmp);
          
          const existingByUkgId = await storage.getEmployeeByUkgId(String(ukgEmp.ukgId));
          
          if (existingByUkgId) {
            await storage.updateEmployee(existingByUkgId.id, appEmployee);
            updated++;
          } else {
            await storage.createEmployee(appEmployee);
            imported++;
          }
        } catch (err) {
          console.error("Error syncing employee:", err);
          errors++;
        }
      }

      console.log(`UKG Sync complete: ${imported} imported, ${updated} updated, ${skipped} skipped (terminated), ${errors} errors`);
      res.json({ imported, updated, skipped, errors, apiError: null });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // === Users ===
  app.get(api.users.list.path, requireAdmin, async (req, res) => {
    const users = await storage.getUsers();
    res.json(users);
  });

  app.get(api.users.get.path, requireAdmin, async (req, res) => {
    const user = await storage.getUser(Number(req.params.id));
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  });

  app.post(api.users.create.path, requireAdmin, async (req, res) => {
    try {
      const input = api.users.create.input.parse(req.body);
      const user = await storage.createUser(input);
      res.status(201).json(user);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.put(api.users.update.path, requireAdmin, async (req, res) => {
    try {
      const input = api.users.update.input.parse(req.body);
      const user = await storage.updateUser(Number(req.params.id), input);
      res.json(user);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      return res.status(404).json({ message: "User not found" });
    }
  });

  app.delete(api.users.delete.path, requireAdmin, async (req, res) => {
    await storage.deleteUser(Number(req.params.id));
    res.status(204).send();
  });

  // === Retail Job Codes ===
  app.get("/api/retail-job-codes", (req, res) => {
    res.json(RETAIL_JOB_CODES);
  });

  // === Locations ===
  // List locations is accessible by authenticated users (managers need it for scheduling)
  app.get(api.locations.list.path, requireAuth, async (req, res) => {
    const locations = await storage.getLocations();
    res.json(locations);
  });

  // Get single location requires admin
  app.get(api.locations.get.path, requireAdmin, async (req, res) => {
    const location = await storage.getLocation(Number(req.params.id));
    if (!location) return res.status(404).json({ message: "Location not found" });
    res.json(location);
  });

  app.post(api.locations.create.path, requireAdmin, async (req, res) => {
    try {
      const input = api.locations.create.input.parse(req.body);
      const location = await storage.createLocation(input);
      res.status(201).json(location);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.put(api.locations.update.path, requireAdmin, async (req, res) => {
    try {
      const input = api.locations.update.input.parse(req.body);
      const location = await storage.updateLocation(Number(req.params.id), input);
      res.json(location);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      return res.status(404).json({ message: "Location not found" });
    }
  });

  app.delete(api.locations.delete.path, requireAdmin, async (req, res) => {
    await storage.deleteLocation(Number(req.params.id));
    res.status(204).send();
  });

  // === SEED DATA ===
  await seedDatabase();

  return httpServer;
}

async function seedDatabase() {
  const employees = await storage.getEmployees();
  if (employees.length === 0) {
    console.log("Seeding database...");
    
    // Create Role Requirements
    await storage.createRoleRequirement({ jobTitle: "Chef", requiredWeeklyHours: 40 });
    await storage.createRoleRequirement({ jobTitle: "Waiter", requiredWeeklyHours: 80 });
    await storage.createRoleRequirement({ jobTitle: "Bartender", requiredWeeklyHours: 40 });
    await storage.createRoleRequirement({ jobTitle: "Manager", requiredWeeklyHours: 40 });

    // Create Employees
    const chef = await storage.createEmployee({ 
      name: "Gordon Ramsay", 
      email: "gordon@kitchen.com", 
      jobTitle: "Chef", 
      maxWeeklyHours: 50,
      color: "#ef4444" // Red
    });

    const manager1 = await storage.createEmployee({ 
      name: "Tony Soprano", 
      email: "tony@management.com", 
      jobTitle: "Manager", 
      maxWeeklyHours: 45,
      color: "#8b5cf6" // Purple
    });

    const manager2 = await storage.createEmployee({ 
      name: "Carmela Soprano", 
      email: "carmela@management.com", 
      jobTitle: "Manager", 
      maxWeeklyHours: 45,
      color: "#d946ef" // Pink
    });

    const waiter1 = await storage.createEmployee({ 
      name: "John Doe", 
      email: "john@kitchen.com", 
      jobTitle: "Waiter", 
      maxWeeklyHours: 40,
      color: "#3b82f6" // Blue
    });

    const waiter2 = await storage.createEmployee({ 
      name: "Jane Smith", 
      email: "jane@kitchen.com", 
      jobTitle: "Waiter", 
      maxWeeklyHours: 30,
      color: "#60a5fa" // Lighter Blue
    });

    const bartender = await storage.createEmployee({ 
      name: "Moe Szyslak", 
      email: "moe@bar.com", 
      jobTitle: "Bartender", 
      maxWeeklyHours: 45,
      color: "#10b981" // Green
    });

    // Create some initial shifts for the current week
    const now = new Date();
    // Monday 9am-5pm
    const mondayStart = new Date(now);
    mondayStart.setHours(9, 0, 0, 0);
    const mondayEnd = new Date(now);
    mondayEnd.setHours(17, 0, 0, 0);

    await storage.createShift({
      employeeId: chef.id,
      startTime: mondayStart,
      endTime: mondayEnd
    });

    await storage.createShift({
      employeeId: waiter1.id,
      startTime: mondayStart,
      endTime: mondayEnd
    });

    // Create a time off request
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);
    
    await storage.createTimeOffRequest({
      employeeId: waiter2.id,
      startDate: nextWeek.toISOString().split('T')[0],
      endDate: nextWeek.toISOString().split('T')[0],
      reason: "Doctor's appointment",
      status: "pending"
    });

    console.log("Database seeded successfully!");
  }
}
