import { AlertCircle, CheckCircle2, Wand2, ChevronDown, ChevronRight, Clock, Users, Calendar, AlertTriangle } from "lucide-react";
import { useEmployees } from "@/hooks/use-employees";
import { useShifts } from "@/hooks/use-shifts";
import { useRoleRequirements, useGlobalSettings } from "@/hooks/use-settings";
import { useTimeOffRequests } from "@/hooks/use-time-off";
import { useLocations } from "@/hooks/use-locations";
import { isSameDay, startOfWeek, endOfWeek, parseISO, addDays, subDays, format, differenceInCalendarDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

const TIMEZONE = "America/New_York";

function getETHoursMinutes(date: Date): { hours: number; minutes: number; totalMinutes: number } {
  const timeStr = formatInTimeZone(date, TIMEZONE, "HH:mm");
  const [h, m] = timeStr.split(":").map(Number);
  return { hours: h, minutes: m, totalMinutes: h * 60 + m };
}

function formatTimeET(date: Date): string {
  return formatInTimeZone(date, TIMEZONE, "HH:mm");
}
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMemo, useState } from "react";
import { cn, getJobTitle, isHoliday } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

// Calculate paid hours (subtract 30-min unpaid lunch for shifts 6+ hours)
function calculatePaidHours(startTime: Date, endTime: Date): number {
  const clockHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
  return clockHours >= 6 ? clockHours - 0.5 : clockHours;
}

// Issue categories for grouping
type IssueCategory = "hours" | "staffing" | "quality" | "conflicts";

const categoryConfig: Record<IssueCategory, { 
  label: string; 
  icon: typeof Clock;
  bgColor: string;
  borderColor: string;
  textColor: string;
  headerBg: string;
}> = {
  hours: { 
    label: "Hours & Limits", 
    icon: Clock,
    bgColor: "bg-blue-50 dark:bg-blue-950/50",
    borderColor: "border-blue-200 dark:border-blue-800",
    textColor: "text-blue-800 dark:text-blue-300",
    headerBg: "bg-blue-100 dark:bg-blue-900/50"
  },
  staffing: { 
    label: "Staffing Coverage", 
    icon: Users,
    bgColor: "bg-purple-50 dark:bg-purple-950/50",
    borderColor: "border-purple-200 dark:border-purple-800",
    textColor: "text-purple-800 dark:text-purple-300",
    headerBg: "bg-purple-100 dark:bg-purple-900/50"
  },
  quality: { 
    label: "Schedule Quality", 
    icon: AlertTriangle,
    bgColor: "bg-amber-50 dark:bg-amber-950/50",
    borderColor: "border-amber-200 dark:border-amber-800",
    textColor: "text-amber-800 dark:text-amber-300",
    headerBg: "bg-amber-100 dark:bg-amber-900/50"
  },
  conflicts: { 
    label: "Conflicts & Holidays", 
    icon: Calendar,
    bgColor: "bg-red-50 dark:bg-red-950/50",
    borderColor: "border-red-200 dark:border-red-800",
    textColor: "text-red-800 dark:text-red-300",
    headerBg: "bg-red-100 dark:bg-red-900/50"
  }
};

// Remediation metadata for clickable issues
export interface RemediationData {
  day: Date;
  jobTitle: string;
  shiftType: "opener" | "closer" | "mid";
}

interface Issue {
  type: "error" | "warning";
  message: string;
  category: IssueCategory;
  remediation?: RemediationData;
}

interface ScheduleValidatorProps {
  onRemediate?: (remediation: RemediationData) => void;
  weekStart?: Date;
  selectedLocation?: string;
}

export function ScheduleValidator({ onRemediate, weekStart, selectedLocation }: ScheduleValidatorProps) {
  // Memoize date calculations to ensure stable values when weekStart changes
  const { start, end, prevWeekStart, prevWeekEnd, weekDays } = useMemo(() => {
    const baseDate = weekStart || new Date();
    const weekStartDate = startOfWeek(baseDate, { weekStartsOn: 0 });
    const weekEndDate = endOfWeek(baseDate, { weekStartsOn: 0 });
    
    const startStr = weekStartDate.toISOString();
    const endStr = weekEndDate.toISOString();
    
    // Calculate previous week for consecutive days check across schedule boundaries
    const prevStart = subDays(weekStartDate, 7).toISOString();
    const prevEnd = subDays(weekEndDate, 7).toISOString();
    
    // Calculate week days array
    const days = Array.from({ length: 7 }).map((_, i) => addDays(weekStartDate, i));
    
    return {
      start: startStr,
      end: endStr,
      prevWeekStart: prevStart,
      prevWeekEnd: prevEnd,
      weekDays: days
    };
  }, [weekStart?.getTime()]);

  const { data: employees } = useEmployees();
  const { data: shifts } = useShifts(start, end);
  const { data: prevWeekShifts } = useShifts(prevWeekStart, prevWeekEnd);
  const { data: roles } = useRoleRequirements();
  const { data: settings } = useGlobalSettings();
  const { data: timeOff } = useTimeOffRequests();
  const { data: locations } = useLocations();

  const issues = useMemo(() => {
    if (!employees || !shifts || !roles || !settings || !timeOff || !prevWeekShifts || !locations) return [];
    
    const newIssues: Issue[] = [];
    let totalWeeklyHours = 0;
    
    // Filter employees and shifts by selected location
    const filteredEmployees = selectedLocation && selectedLocation !== "all"
      ? employees.filter(emp => emp.location === selectedLocation)
      : employees;
    
    const filteredEmployeeIds = new Set(filteredEmployees.map(e => e.id));
    
    const filteredShifts = selectedLocation && selectedLocation !== "all"
      ? shifts.filter(s => filteredEmployeeIds.has(s.employeeId))
      : shifts;
    
    const filteredPrevWeekShifts = selectedLocation && selectedLocation !== "all"
      ? prevWeekShifts.filter(s => filteredEmployeeIds.has(s.employeeId))
      : prevWeekShifts;
    
    // Check 1: Employee max hours
    filteredEmployees.forEach(emp => {
      const empShifts = filteredShifts.filter(s => s.employeeId === emp.id);
      const hours = empShifts.reduce((acc, s) => {
        const start = new Date(s.startTime);
        const end = new Date(s.endTime);
        return acc + calculatePaidHours(start, end);
      }, 0);
      
      totalWeeklyHours += hours;
      
      if (hours > emp.maxWeeklyHours) {
        newIssues.push({
          type: "error",
          category: "hours",
          message: `${emp.name} is scheduled for ${hours.toFixed(1)}h (Max: ${emp.maxWeeklyHours}h)`
        });
      }
    });

    // Check 2: Total weekly limit - DISABLED (user wants max hours per employee instead)
    // if (totalWeeklyHours > settings.totalWeeklyHoursLimit) {
    //   newIssues.push({
    //     type: "error",
    //     message: `Total scheduled hours (${totalWeeklyHours}) exceeds limit (${settings.totalWeeklyHoursLimit})`
    //   });
    // }

    // Check 3: Role requirements
    roles.forEach(role => {
      const roleEmployees = filteredEmployees.filter(e => e.jobTitle === role.jobTitle);
      const roleIds = roleEmployees.map(e => e.id);
      
      const roleShifts = filteredShifts.filter(s => roleIds.includes(s.employeeId));
      const roleHours = roleShifts.reduce((acc, s) => {
        const start = new Date(s.startTime);
        const end = new Date(s.endTime);
        return acc + calculatePaidHours(start, end);
      }, 0);

      if (roleHours < role.requiredWeeklyHours) {
        newIssues.push({
          type: "warning",
          category: "staffing",
          message: `${getJobTitle(role.jobTitle)} coverage is ${roleHours.toFixed(1)}h (Required: ${role.requiredWeeklyHours}h)`
        });
      }
    });

    // Check 4: Staffing Coverage (Openers, Closers, Managers)
    const openersRequired = settings.openersRequired ?? 2;
    const closersRequired = settings.closersRequired ?? 2;
    const managersRequired = settings.managersRequired ?? 1;
    
    weekDays.forEach(day => {
      // Skip coverage checks on holidays - store is closed
      const holidayName = isHoliday(day);
      if (holidayName) return;
      
      const dayShifts = filteredShifts.filter(s => isSameDay(s.startTime, day));
      const isSunday = day.getDay() === 0;
      
      // Closing shift times differ on Sunday (store closes at 7:30pm)
      // Sunday: 11:00-19:30, Other days: 12:00-20:30
      const closerStartTime = isSunday ? "11:00" : (settings.managerEveningStart || "12:00");
      const closerEndTime = isSunday ? "19:30" : (settings.managerEveningEnd || "20:30");
      
      // Count openers - on Sunday, any shift starting at 10am or before counts as an opener
      // On other days, must match exact opener times (default 8:00-16:30)
      const openerShifts = dayShifts.filter(s => {
        if (isSunday) {
          const { totalMinutes } = getETHoursMinutes(s.startTime);
          return totalMinutes <= 10 * 60;
        }
        const startStr = formatTimeET(s.startTime);
        const endStr = formatTimeET(s.endTime);
        return startStr === (settings.managerMorningStart || "08:00") && 
               endStr === (settings.managerMorningEnd || "16:30");
      });
      
      // Count closers (Sunday: 11:00-19:30, Other days: 12:00-20:30)
      const closerShifts = dayShifts.filter(s => {
        const startStr = formatTimeET(s.startTime);
        const endStr = formatTimeET(s.endTime);
        return startStr === closerStartTime && endStr === closerEndTime;
      });
      
      // Count managers on opening and closing shifts (must match full shift times)
      // Manager job codes: STSUPER (Store Manager), STASSTSP (Assistant Manager), STLDWKR (Team Lead)
      // Include WV (Weirton) variants: WVSTMNG, WVSTAST, WVLDWRK
      const managerCodes = ['STSUPER', 'STASSTSP', 'STLDWKR', 'WVSTMNG', 'WVSTAST', 'WVLDWRK'];
      const managerShifts = dayShifts.filter(s => {
        const emp = filteredEmployees.find(e => e.id === s.employeeId);
        return emp && managerCodes.includes(emp.jobTitle);
      });
      
      const openingManagers = managerShifts.filter(s => {
        if (isSunday) {
          const { totalMinutes } = getETHoursMinutes(s.startTime);
          return totalMinutes <= 10 * 60;
        }
        const startStr = formatTimeET(s.startTime);
        const endStr = formatTimeET(s.endTime);
        return startStr === (settings.managerMorningStart || "08:00") && 
               endStr === (settings.managerMorningEnd || "16:30");
      }).length;
      
      const closingManagers = managerShifts.filter(s => {
        const startStr = formatTimeET(s.startTime);
        const endStr = formatTimeET(s.endTime);
        return startStr === closerStartTime && endStr === closerEndTime;
      }).length;

      const dayLabel = format(day, "EEE, MMM d");
      
      if (openerShifts.length < openersRequired) {
        newIssues.push({
          type: "warning",
          category: "staffing",
          message: `${dayLabel}: ${openerShifts.length}/${openersRequired} openers scheduled`
        });
      }
      
      if (closerShifts.length < closersRequired) {
        newIssues.push({
          type: "warning",
          category: "staffing",
          message: `${dayLabel}: ${closerShifts.length}/${closersRequired} closers scheduled`
        });
      }
      
      if (openingManagers < managersRequired) {
        newIssues.push({
          type: "error",
          category: "staffing",
          message: `${dayLabel}: Need ${managersRequired} opening manager(s), have ${openingManagers}`,
          remediation: { day, jobTitle: "STSUPER", shiftType: "opener" }
        });
      }
      
      if (closingManagers < managersRequired) {
        newIssues.push({
          type: "error",
          category: "staffing",
          message: `${dayLabel}: Need ${managersRequired} closing manager(s), have ${closingManagers}`,
          remediation: { day, jobTitle: "STSUPER", shiftType: "closer" }
        });
      }
      
      // Check donor greeter coverage (one opening, one closing)
      // Include WV variant: WVDON
      const donorGreeterCodes = ['DONDOOR', 'WVDON'];
      const donorGreeterShifts = dayShifts.filter(s => {
        const emp = filteredEmployees.find(e => e.id === s.employeeId);
        return emp && donorGreeterCodes.includes(emp.jobTitle);
      });
      
      const openingGreeter = donorGreeterShifts.some(s => {
        const { totalMinutes } = getETHoursMinutes(s.startTime);
        if (isSunday) {
          return totalMinutes <= 10 * 60;
        }
        return totalMinutes <= 8 * 60 + 45;
      });
      
      // Donor greeter closing shift uses same Sunday-adjusted times as closerStartTime/closerEndTime
      const closingGreeter = donorGreeterShifts.some(s => {
        const startStr = formatTimeET(s.startTime);
        const endStr = formatTimeET(s.endTime);
        return startStr === closerStartTime && endStr === closerEndTime;
      });
      
      if (!openingGreeter) {
        newIssues.push({
          type: "error",
          category: "staffing",
          message: `${dayLabel}: Missing opening donor greeter`,
          remediation: { day, jobTitle: "DONDOOR", shiftType: "opener" }
        });
      }
      
      if (!closingGreeter) {
        newIssues.push({
          type: "error",
          category: "staffing",
          message: `${dayLabel}: Missing closing donor greeter`,
          remediation: { day, jobTitle: "DONDOOR", shiftType: "closer" }
        });
      }
      
      // Check cashier coverage (one opening, one closing)
      // Include WV variant: CSHSLSWV
      const cashierCodes = ['CASHSLS', 'CSHSLSWV'];
      const cashierShifts = dayShifts.filter(s => {
        const emp = filteredEmployees.find(e => e.id === s.employeeId);
        return emp && cashierCodes.includes(emp.jobTitle);
      });
      
      const openingCashier = cashierShifts.some(s => {
        const { totalMinutes } = getETHoursMinutes(s.startTime);
        if (isSunday) {
          return totalMinutes <= 10 * 60;
        }
        return totalMinutes <= 8 * 60 + 45;
      });
      
      // Cashier closing shift uses same Sunday-adjusted times as closerStartTime/closerEndTime
      const closingCashier = cashierShifts.some(s => {
        const startStr = formatTimeET(s.startTime);
        const endStr = formatTimeET(s.endTime);
        return startStr === closerStartTime && endStr === closerEndTime;
      });
      
      if (!openingCashier) {
        newIssues.push({
          type: "error",
          category: "staffing",
          message: `${dayLabel}: Missing opening cashier`,
          remediation: { day, jobTitle: "CASHSLS", shiftType: "opener" }
        });
      }
      
      if (!closingCashier) {
        newIssues.push({
          type: "error",
          category: "staffing",
          message: `${dayLabel}: Missing closing cashier`,
          remediation: { day, jobTitle: "CASHSLS", shiftType: "closer" }
        });
      }
      
      // Check for mid-shift coverage (9-5:30, 10-6:30, 11-7:30)
      const midShiftTimes = [
        { start: "09:00", end: "17:30" },
        { start: "10:00", end: "18:30" },
        { start: "11:00", end: "19:30" }
      ];
      
      const midShiftsScheduled = dayShifts.filter(s => {
        const startStr = formatTimeET(s.startTime);
        const endStr = formatTimeET(s.endTime);
        return midShiftTimes.some(mid => startStr === mid.start && endStr === mid.end);
      });
      
      if (midShiftsScheduled.length === 0) {
        newIssues.push({
          type: "warning",
          category: "staffing",
          message: `${dayLabel}: No mid-shifts scheduled (9-5:30, 10-6:30, 11-7:30)`
        });
      }
    });

    // Check 4b: Saturday vs Sunday donor greeter comparison
    // Saturday is the busiest day for donations - should have >= greeters as Sunday
    const donorGreeterCodes = ['DONDOOR', 'WVDON'];
    const saturdayDate = weekDays.find(d => d.getDay() === 6);
    const sundayDate = weekDays.find(d => d.getDay() === 0);
    
    if (saturdayDate && sundayDate) {
      const satShifts = filteredShifts.filter(s => isSameDay(s.startTime, saturdayDate));
      const sunShifts = filteredShifts.filter(s => isSameDay(s.startTime, sundayDate));
      
      const satGreeters = satShifts.filter(s => {
        const emp = filteredEmployees.find(e => e.id === s.employeeId);
        return emp && donorGreeterCodes.includes(emp.jobTitle);
      }).length;
      
      const sunGreeters = sunShifts.filter(s => {
        const emp = filteredEmployees.find(e => e.id === s.employeeId);
        return emp && donorGreeterCodes.includes(emp.jobTitle);
      }).length;
      
      if (sunGreeters > satGreeters && satGreeters > 0) {
        newIssues.push({
          type: "warning",
          category: "staffing",
          message: `Sunday has more donor greeters (${sunGreeters}) than Saturday (${satGreeters}) - Saturday is the busiest donation day`
        });
      }
      
      // Also check cashiers - Saturday should have >= cashiers as Sunday
      const cashierCodes = ['CASHSLS', 'CSHSLSWV'];
      const satCashiers = satShifts.filter(s => {
        const emp = filteredEmployees.find(e => e.id === s.employeeId);
        return emp && cashierCodes.includes(emp.jobTitle);
      }).length;
      
      const sunCashiers = sunShifts.filter(s => {
        const emp = filteredEmployees.find(e => e.id === s.employeeId);
        return emp && cashierCodes.includes(emp.jobTitle);
      }).length;
      
      if (sunCashiers > satCashiers && satCashiers > 0) {
        newIssues.push({
          type: "warning",
          category: "staffing",
          message: `Sunday has more cashiers (${sunCashiers}) than Saturday (${satCashiers}) - Saturday is the busiest sales day`
        });
      }
    }

    // Check 5: Time off conflicts
    filteredShifts.forEach(shift => {
      const emp = filteredEmployees.find(e => e.id === shift.employeeId);
      if (!emp) return;

      const conflicts = timeOff.filter(req => 
        req.employeeId === shift.employeeId && 
        req.status === "approved" &&
        isSameDay(req.startDate, shift.startTime) // Simplified conflict check
      );

      if (conflicts.length > 0) {
        newIssues.push({
          type: "error",
          category: "conflicts",
          message: `${emp.name} has a shift during approved time off`
        });
      }
    });

    // Check 5b: Production Station Limits (per day)
    // Apparel Processor job codes: APPROC, APWV
    // Donation Pricing job codes: DONPRI, DONPRWV
    const apparelProcessorCodes = ['APPROC', 'APWV'];
    const donationPricerCodes = ['DONPRI', 'DONPRWV'];
    
    weekDays.forEach(day => {
      // Skip holidays
      const holidayName = isHoliday(day);
      if (holidayName) return;
      
      const dayShifts = filteredShifts.filter(s => isSameDay(s.startTime, day));
      const dayLabel = format(day, "EEE, MMM d");
      
      // Count apparel processors and donation pricers for this day
      const apparelProcessorCount = dayShifts.filter(s => {
        const emp = filteredEmployees.find(e => e.id === s.employeeId);
        return emp && apparelProcessorCodes.includes(emp.jobTitle);
      }).length;
      
      const donationPricerCount = dayShifts.filter(s => {
        const emp = filteredEmployees.find(e => e.id === s.employeeId);
        return emp && donationPricerCodes.includes(emp.jobTitle);
      }).length;
      
      // Get employees scheduled for this day to find their location
      const employeesOnDay = dayShifts.map(s => filteredEmployees.find(e => e.id === s.employeeId)).filter(Boolean);
      const locationSet = new Set(employeesOnDay.map(e => e?.location).filter((loc): loc is string => typeof loc === 'string'));
      const uniqueLocations = Array.from(locationSet);
      
      // Check each location's limits
      uniqueLocations.forEach(locationName => {
        const location = locations.find(l => l.name === locationName);
        if (!location) return;
        
        const apparelLimit = location.apparelProcessorStations ?? 0;
        const donationLimit = location.donationPricingStations ?? 0;
        
        // Count employees for this specific location
        const locationApparelCount = dayShifts.filter(s => {
          const emp = filteredEmployees.find(e => e.id === s.employeeId);
          return emp && emp.location === locationName && apparelProcessorCodes.includes(emp.jobTitle);
        }).length;
        
        const locationDonationCount = dayShifts.filter(s => {
          const emp = filteredEmployees.find(e => e.id === s.employeeId);
          return emp && emp.location === locationName && donationPricerCodes.includes(emp.jobTitle);
        }).length;
        
        // Check apparel processor limit
        if (apparelLimit > 0 && locationApparelCount > apparelLimit) {
          newIssues.push({
            type: "warning",
            category: "staffing",
            message: `${dayLabel}: ${locationName} has ${locationApparelCount} apparel processors (max ${apparelLimit} stations)`
          });
        }
        
        // Check wares/shoes pricer limit
        if (donationLimit > 0 && locationDonationCount > donationLimit) {
          newIssues.push({
            type: "warning",
            category: "staffing",
            message: `${dayLabel}: ${locationName} has ${locationDonationCount} wares/shoes pricers (max ${donationLimit} stations)`
          });
        }
      });
    });

    // Check 6: Clopening detection (closing shift followed by opening shift next day)
    filteredEmployees.forEach(emp => {
      const empShifts = filteredShifts
        .filter(s => s.employeeId === emp.id)
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      
      for (let i = 0; i < empShifts.length - 1; i++) {
        const currentShift = empShifts[i];
        const nextShift = empShifts[i + 1];
        
        const currentEnd = new Date(currentShift.endTime);
        const nextStart = new Date(nextShift.startTime);
        
        const currentEndET = getETHoursMinutes(currentEnd);
        const nextStartET = getETHoursMinutes(nextStart);
        
        const isClosingShift = (currentEndET.hours > 19) || (currentEndET.hours === 19 && currentEndET.minutes >= 30);
        const isOpeningShift = nextStartET.hours >= 8 && nextStartET.hours <= 10;
        
        // Check if they're on consecutive calendar days (not just 24h apart)
        const currentDate = new Date(currentShift.startTime);
        const nextDate = new Date(nextShift.startTime);
        const calendarDaysDiff = differenceInCalendarDays(nextDate, currentDate);
        
        if (isClosingShift && isOpeningShift && calendarDaysDiff === 1) {
          const closeDay = format(currentDate, "EEE");
          const openDay = format(nextDate, "EEE");
          newIssues.push({
            type: "warning",
            category: "quality",
            message: `${emp.name} has a clopening: closes ${closeDay} then opens ${openDay}`
          });
        }
      }
    });

    // Check 7: Donor greeter shift variety (must have mix of opening and closing shifts)
    // This applies to both part-time and full-time employees
    // Include WV variant: WVDON
    const donorGreeterJobCodes = ['DONDOOR', 'WVDON'];
    const donorGreeters = filteredEmployees.filter(emp => donorGreeterJobCodes.includes(emp.jobTitle) && emp.isActive);
    
    donorGreeters.forEach(greeter => {
      const greeterShifts = filteredShifts.filter(s => s.employeeId === greeter.id);
      
      if (greeterShifts.length < 2) return; // Need at least 2 shifts to check variety
      
      let openingCount = 0;
      let closingCount = 0;
      let midShiftCount = 0;
      
      greeterShifts.forEach(shift => {
        const startStr = formatTimeET(shift.startTime);
        const endStr = formatTimeET(shift.endTime);
        const shiftDay = new Date(shift.startTime);
        const isSunday = shiftDay.getDay() === 0;
        
        const openerStart = settings.managerMorningStart || "08:00";
        const openerEnd = settings.managerMorningEnd || "16:30";
        const closerStart = isSunday ? "11:00" : (settings.managerEveningStart || "12:00");
        const closerEnd = isSunday ? "19:30" : (settings.managerEveningEnd || "20:30");
        
        if (startStr === openerStart && endStr === openerEnd) {
          openingCount++;
        } else if (startStr === closerStart && endStr === closerEnd) {
          closingCount++;
        } else {
          // Mid-shifts and other shifts count as variety
          midShiftCount++;
        }
      });
      
      // Warn if all opening/closing shifts are the same type
      // Mid-shifts count as variety, so only flag if there are 0 mid-shifts AND all are same type
      const totalShifts = openingCount + closingCount + midShiftCount;
      if (totalShifts >= 2 && midShiftCount === 0) {
        if (openingCount === 0 && closingCount >= 2) {
          newIssues.push({
            type: "warning",
            category: "quality",
            message: `${greeter.name} (Donor Greeter) has ${closingCount} closing shifts but no opening shifts - needs variety`
          });
        } else if (closingCount === 0 && openingCount >= 2) {
          newIssues.push({
            type: "warning",
            category: "quality",
            message: `${greeter.name} (Donor Greeter) has ${openingCount} opening shifts but no closing shifts - needs variety`
          });
        }
      }
    });

    // Check 8: Manager closing shift limit (max 3 closes per week)
    // Include WV variants: WVSTMNG, WVSTAST, WVLDWRK
    const managerJobCodes = ['STSUPER', 'STASSTSP', 'STLDWRK', 'WVSTMNG', 'WVSTAST', 'WVLDWRK'];
    const managers = filteredEmployees.filter(emp => managerJobCodes.includes(emp.jobTitle) && emp.isActive);
    
    managers.forEach(manager => {
      const managerShifts = filteredShifts.filter(s => s.employeeId === manager.id);
      
      let closingCount = 0;
      
      managerShifts.forEach(shift => {
        const startStr = formatTimeET(shift.startTime);
        const endStr = formatTimeET(shift.endTime);
        const shiftDay = new Date(shift.startTime);
        const isSunday = shiftDay.getDay() === 0;
        
        const closerStart = isSunday ? "11:00" : (settings.managerEveningStart || "12:00");
        const closerEnd = isSunday ? "19:30" : (settings.managerEveningEnd || "20:30");
        
        if (startStr === closerStart && endStr === closerEnd) {
          closingCount++;
        }
      });
      
      if (closingCount > 3) {
        newIssues.push({
          type: "warning",
          category: "quality",
          message: `${manager.name} (${getJobTitle(manager.jobTitle)}) has ${closingCount} closing shifts this week (max 3 recommended)`
        });
      }
    });

    // Check 9: Holiday shifts (store is closed on Easter, Thanksgiving, Christmas)
    filteredShifts.forEach(shift => {
      const shiftDate = new Date(shift.startTime);
      const holidayName = isHoliday(shiftDate);
      if (holidayName) {
        const emp = filteredEmployees.find(e => e.id === shift.employeeId);
        const empName = emp?.name || "Unknown";
        newIssues.push({
          type: "error",
          category: "conflicts",
          message: `${empName} is scheduled on ${holidayName} (store is closed)`
        });
      }
    });

    // Check 10: Consecutive days worked (more than 5 days in a row)
    // This checks across schedule boundaries by looking at previous week's shifts
    filteredEmployees.forEach(emp => {
      // Get all shift dates for this employee from both weeks
      const currentWeekDates = filteredShifts
        .filter(s => s.employeeId === emp.id)
        .map(s => format(new Date(s.startTime), 'yyyy-MM-dd'));
      
      const prevWeekDates = filteredPrevWeekShifts
        .filter(s => s.employeeId === emp.id)
        .map(s => format(new Date(s.startTime), 'yyyy-MM-dd'));
      
      // Combine and deduplicate dates
      const allDatesSet = new Set([...prevWeekDates, ...currentWeekDates]);
      const allDates = Array.from(allDatesSet).sort();
      
      if (allDates.length === 0) return;
      
      // Find consecutive day streaks
      let currentStreak = 1;
      let maxStreak = 1;
      let streakStartDate = allDates[0];
      let maxStreakStart = allDates[0];
      let maxStreakEnd = allDates[0];
      
      for (let i = 1; i < allDates.length; i++) {
        const prevDate = new Date(allDates[i - 1]);
        const currDate = new Date(allDates[i]);
        const daysDiff = differenceInCalendarDays(currDate, prevDate);
        
        if (daysDiff === 1) {
          currentStreak++;
          if (currentStreak > maxStreak) {
            maxStreak = currentStreak;
            maxStreakStart = streakStartDate;
            maxStreakEnd = allDates[i];
          }
        } else {
          currentStreak = 1;
          streakStartDate = allDates[i];
        }
      }
      
      // Flag if more than 5 consecutive days
      if (maxStreak > 5) {
        // Check if any part of this streak is in the current week
        const currentWeekStartDate = format(parseISO(start), 'yyyy-MM-dd');
        const currentWeekEndDate = format(parseISO(end), 'yyyy-MM-dd');
        
        // Only show warning if the streak includes current week days
        if (maxStreakEnd >= currentWeekStartDate && maxStreakStart <= currentWeekEndDate) {
          const startLabel = format(new Date(maxStreakStart), "EEE M/d");
          const endLabel = format(new Date(maxStreakEnd), "EEE M/d");
          newIssues.push({
            type: "warning",
            category: "hours",
            message: `${emp.name} is scheduled ${maxStreak} days in a row (${startLabel} - ${endLabel})`
          });
        }
      }
    });

    return newIssues;
  }, [employees, shifts, prevWeekShifts, roles, settings, timeOff, locations, start, end, selectedLocation]);

  // Track expanded state for each category
  const [expandedCategories, setExpandedCategories] = useState<Record<IssueCategory, boolean>>({
    hours: true,
    staffing: true,
    quality: true,
    conflicts: true
  });

  const toggleCategory = (category: IssueCategory) => {
    setExpandedCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  };

  // Group issues by category
  const groupedIssues = useMemo(() => {
    const groups: Record<IssueCategory, Issue[]> = {
      hours: [],
      staffing: [],
      quality: [],
      conflicts: []
    };
    
    issues.forEach(issue => {
      groups[issue.category].push(issue);
    });
    
    return groups;
  }, [issues]);

  // Order of categories to display
  const categoryOrder: IssueCategory[] = ["conflicts", "hours", "staffing", "quality"];

  if (!issues.length) {
    return (
      <div className="sticky top-4 z-40">
        <Card className="border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/50">
          <CardContent className="pt-6 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center text-green-600 dark:text-green-400">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <p className="font-semibold text-green-900 dark:text-green-100">Schedule Valid</p>
              <p className="text-sm text-green-700 dark:text-green-400">All constraints met.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="sticky top-4 z-40">
      <Card className="border-border shadow-sm max-h-[calc(100vh-6rem)] overflow-y-auto">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-orange-500" />
          Validation Issues
          <span className="text-sm font-normal text-muted-foreground">
            ({issues.length} {issues.length === 1 ? 'issue' : 'issues'})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {categoryOrder.map(category => {
            const categoryIssues = groupedIssues[category];
            if (categoryIssues.length === 0) return null;
            
            const config = categoryConfig[category];
            const Icon = config.icon;
            const errorCount = categoryIssues.filter(i => i.type === "error").length;
            const warningCount = categoryIssues.filter(i => i.type === "warning").length;
            const isExpanded = expandedCategories[category];
            
            return (
              <Collapsible 
                key={category} 
                open={isExpanded} 
                onOpenChange={() => toggleCategory(category)}
              >
                <CollapsibleTrigger asChild>
                  <button
                    className={cn(
                      "w-full flex items-center justify-between p-3 rounded border transition-colors",
                      config.headerBg,
                      config.borderColor,
                      config.textColor,
                      "hover:opacity-90 cursor-pointer"
                    )}
                    data-testid={`button-toggle-${category}`}
                  >
                    <div className="flex items-center gap-2">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                      <Icon className="w-4 h-4" />
                      <span className="font-medium">{config.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {errorCount > 0 && (
                        <span className="px-2 py-0.5 text-xs font-medium rounded bg-red-500 text-white">
                          {errorCount} error{errorCount !== 1 ? 's' : ''}
                        </span>
                      )}
                      {warningCount > 0 && (
                        <span className="px-2 py-0.5 text-xs font-medium rounded bg-orange-500 text-white">
                          {warningCount} warning{warningCount !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className={cn("mt-1 space-y-1 pl-2 border-l-2", config.borderColor)}>
                    {categoryIssues.map((issue, idx) => (
                      <div 
                        key={idx} 
                        className={cn(
                          "p-2 rounded text-sm flex items-start gap-2 ml-2",
                          config.bgColor,
                          config.textColor
                        )}
                        data-testid={`validation-issue-${category}-${idx}`}
                      >
                        <div className={cn(
                          "w-2 h-2 rounded-full mt-1.5 shrink-0",
                          issue.type === "error" ? "bg-red-500" : "bg-orange-500"
                        )} />
                        <span className="flex-1">{issue.message}</span>
                        {issue.remediation && onRemediate && (
                          <Button 
                            size="sm" 
                            variant="outline"
                            className="shrink-0 h-6 px-2 text-xs gap-1"
                            onClick={() => onRemediate(issue.remediation!)}
                            data-testid={`button-fix-issue-${category}-${idx}`}
                          >
                            <Wand2 className="w-3 h-3" />
                            Fix
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      </CardContent>
    </Card>
    </div>
  );
}
