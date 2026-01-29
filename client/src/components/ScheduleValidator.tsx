import { AlertCircle, CheckCircle2, Wand2, ChevronDown, ChevronRight, Clock, Users, Calendar, AlertTriangle } from "lucide-react";
import { useEmployees } from "@/hooks/use-employees";
import { useShifts } from "@/hooks/use-shifts";
import { useRoleRequirements, useGlobalSettings } from "@/hooks/use-settings";
import { useTimeOffRequests } from "@/hooks/use-time-off";
import { isSameDay, startOfWeek, endOfWeek, parseISO, addDays, subDays, format, differenceInCalendarDays } from "date-fns";
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
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
    textColor: "text-blue-800",
    headerBg: "bg-blue-100"
  },
  staffing: { 
    label: "Staffing Coverage", 
    icon: Users,
    bgColor: "bg-purple-50",
    borderColor: "border-purple-200",
    textColor: "text-purple-800",
    headerBg: "bg-purple-100"
  },
  quality: { 
    label: "Schedule Quality", 
    icon: AlertTriangle,
    bgColor: "bg-amber-50",
    borderColor: "border-amber-200",
    textColor: "text-amber-800",
    headerBg: "bg-amber-100"
  },
  conflicts: { 
    label: "Conflicts & Holidays", 
    icon: Calendar,
    bgColor: "bg-red-50",
    borderColor: "border-red-200",
    textColor: "text-red-800",
    headerBg: "bg-red-100"
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
}

export function ScheduleValidator({ onRemediate, weekStart }: ScheduleValidatorProps) {
  // Use provided weekStart or default to current week (Sunday = 0)
  const baseDate = weekStart || new Date();
  const start = startOfWeek(baseDate, { weekStartsOn: 0 }).toISOString();
  const end = endOfWeek(baseDate, { weekStartsOn: 0 }).toISOString();

  // Calculate previous week for consecutive days check across schedule boundaries
  const prevWeekStart = subDays(parseISO(start), 7).toISOString();
  const prevWeekEnd = subDays(parseISO(end), 7).toISOString();

  const { data: employees } = useEmployees();
  const { data: shifts } = useShifts(start, end);
  const { data: prevWeekShifts } = useShifts(prevWeekStart, prevWeekEnd);
  const { data: roles } = useRoleRequirements();
  const { data: settings } = useGlobalSettings();
  const { data: timeOff } = useTimeOffRequests();

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }).map((_, i) => addDays(parseISO(start), i));
  }, [start]);

  const issues = useMemo(() => {
    if (!employees || !shifts || !roles || !settings || !timeOff || !prevWeekShifts) return [];
    
    const newIssues: Issue[] = [];
    let totalWeeklyHours = 0;
    
    // Check 1: Employee max hours
    employees.forEach(emp => {
      const empShifts = shifts.filter(s => s.employeeId === emp.id);
      const hours = empShifts.reduce((acc, s) => {
        const start = new Date(s.startTime);
        const end = new Date(s.endTime);
        return acc + calculatePaidHours(start, end);
      }, 0);
      
      totalWeeklyHours += hours;
      
      if (hours > emp.maxWeeklyHours) {
        newIssues.push({
          type: "error",
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
      const roleEmployees = employees.filter(e => e.jobTitle === role.jobTitle);
      const roleIds = roleEmployees.map(e => e.id);
      
      const roleShifts = shifts.filter(s => roleIds.includes(s.employeeId));
      const roleHours = roleShifts.reduce((acc, s) => {
        const start = new Date(s.startTime);
        const end = new Date(s.endTime);
        return acc + calculatePaidHours(start, end);
      }, 0);

      if (roleHours < role.requiredWeeklyHours) {
        newIssues.push({
          type: "warning",
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
      
      const dayShifts = shifts.filter(s => isSameDay(s.startTime, day));
      const isSunday = day.getDay() === 0;
      
      // Closing shift times differ on Sunday (store closes at 7:30pm)
      // Sunday: 11:00-19:30, Other days: 12:00-20:30
      const closerStartTime = isSunday ? "11:00" : (settings.managerEveningStart || "12:00");
      const closerEndTime = isSunday ? "19:30" : (settings.managerEveningEnd || "20:30");
      
      // Count openers (8:00am - 4:30pm shifts)
      const openerShifts = dayShifts.filter(s => {
        const startStr = format(s.startTime, "HH:mm");
        const endStr = format(s.endTime, "HH:mm");
        return startStr === (settings.managerMorningStart || "08:00") && 
               endStr === (settings.managerMorningEnd || "16:30");
      });
      
      // Count closers (Sunday: 11:00-19:30, Other days: 12:00-20:30)
      const closerShifts = dayShifts.filter(s => {
        const startStr = format(s.startTime, "HH:mm");
        const endStr = format(s.endTime, "HH:mm");
        return startStr === closerStartTime && endStr === closerEndTime;
      });
      
      // Count managers on opening and closing shifts (must match full shift times)
      // Manager job codes: STSUPER (Store Manager), STASSTSP (Assistant Manager), STLDWKR (Team Lead)
      const managerCodes = ['STSUPER', 'STASSTSP', 'STLDWKR'];
      const managerShifts = dayShifts.filter(s => {
        const emp = employees.find(e => e.id === s.employeeId);
        return emp && managerCodes.includes(emp.jobTitle);
      });
      
      const openingManagers = managerShifts.filter(s => {
        const startStr = format(s.startTime, "HH:mm");
        const endStr = format(s.endTime, "HH:mm");
        return startStr === (settings.managerMorningStart || "08:00") && 
               endStr === (settings.managerMorningEnd || "16:30");
      }).length;
      
      const closingManagers = managerShifts.filter(s => {
        const startStr = format(s.startTime, "HH:mm");
        const endStr = format(s.endTime, "HH:mm");
        return startStr === closerStartTime && endStr === closerEndTime;
      }).length;

      const dayLabel = format(day, "EEE, MMM d");
      
      if (openerShifts.length < openersRequired) {
        newIssues.push({
          type: "warning",
          message: `${dayLabel}: ${openerShifts.length}/${openersRequired} openers scheduled`
        });
      }
      
      if (closerShifts.length < closersRequired) {
        newIssues.push({
          type: "warning",
          message: `${dayLabel}: ${closerShifts.length}/${closersRequired} closers scheduled`
        });
      }
      
      if (openingManagers < managersRequired) {
        newIssues.push({
          type: "error",
          message: `${dayLabel}: Need ${managersRequired} opening manager(s), have ${openingManagers}`,
          remediation: { day, jobTitle: "STSUPER", shiftType: "opener" }
        });
      }
      
      if (closingManagers < managersRequired) {
        newIssues.push({
          type: "error",
          message: `${dayLabel}: Need ${managersRequired} closing manager(s), have ${closingManagers}`,
          remediation: { day, jobTitle: "STSUPER", shiftType: "closer" }
        });
      }
      
      // Check donor greeter coverage (one opening, one closing)
      const donorGreeterShifts = dayShifts.filter(s => {
        const emp = employees.find(e => e.id === s.employeeId);
        return emp?.jobTitle === 'DONDOOR';
      });
      
      const openingGreeter = donorGreeterShifts.some(s => {
        const startStr = format(s.startTime, "HH:mm");
        const endStr = format(s.endTime, "HH:mm");
        return startStr === (settings.managerMorningStart || "08:00") && 
               endStr === (settings.managerMorningEnd || "16:30");
      });
      
      // Donor greeter closing shift uses same Sunday-adjusted times as closerStartTime/closerEndTime
      const closingGreeter = donorGreeterShifts.some(s => {
        const startStr = format(s.startTime, "HH:mm");
        const endStr = format(s.endTime, "HH:mm");
        return startStr === closerStartTime && endStr === closerEndTime;
      });
      
      if (!openingGreeter) {
        newIssues.push({
          type: "error",
          message: `${dayLabel}: Missing opening donor greeter`,
          remediation: { day, jobTitle: "DONDOOR", shiftType: "opener" }
        });
      }
      
      if (!closingGreeter) {
        newIssues.push({
          type: "error",
          message: `${dayLabel}: Missing closing donor greeter`,
          remediation: { day, jobTitle: "DONDOOR", shiftType: "closer" }
        });
      }
      
      // Check cashier coverage (one opening, one closing)
      const cashierShifts = dayShifts.filter(s => {
        const emp = employees.find(e => e.id === s.employeeId);
        return emp?.jobTitle === 'CASHSLS';
      });
      
      const openingCashier = cashierShifts.some(s => {
        const startStr = format(s.startTime, "HH:mm");
        const endStr = format(s.endTime, "HH:mm");
        return startStr === (settings.managerMorningStart || "08:00") && 
               endStr === (settings.managerMorningEnd || "16:30");
      });
      
      // Cashier closing shift uses same Sunday-adjusted times as closerStartTime/closerEndTime
      const closingCashier = cashierShifts.some(s => {
        const startStr = format(s.startTime, "HH:mm");
        const endStr = format(s.endTime, "HH:mm");
        return startStr === closerStartTime && endStr === closerEndTime;
      });
      
      if (!openingCashier) {
        newIssues.push({
          type: "error",
          message: `${dayLabel}: Missing opening cashier`,
          remediation: { day, jobTitle: "CASHSLS", shiftType: "opener" }
        });
      }
      
      if (!closingCashier) {
        newIssues.push({
          type: "error",
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
        const startStr = format(s.startTime, "HH:mm");
        const endStr = format(s.endTime, "HH:mm");
        return midShiftTimes.some(mid => startStr === mid.start && endStr === mid.end);
      });
      
      if (midShiftsScheduled.length === 0) {
        newIssues.push({
          type: "warning",
          message: `${dayLabel}: No mid-shifts scheduled (9-5:30, 10-6:30, 11-7:30)`
        });
      }
    });

    // Check 5: Time off conflicts
    shifts.forEach(shift => {
      const emp = employees.find(e => e.id === shift.employeeId);
      if (!emp) return;

      const conflicts = timeOff.filter(req => 
        req.employeeId === shift.employeeId && 
        req.status === "approved" &&
        isSameDay(req.startDate, shift.startTime) // Simplified conflict check
      );

      if (conflicts.length > 0) {
        newIssues.push({
          type: "error",
          message: `${emp.name} has a shift during approved time off`
        });
      }
    });

    // Check 6: Clopening detection (closing shift followed by opening shift next day)
    employees.forEach(emp => {
      const empShifts = shifts
        .filter(s => s.employeeId === emp.id)
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      
      for (let i = 0; i < empShifts.length - 1; i++) {
        const currentShift = empShifts[i];
        const nextShift = empShifts[i + 1];
        
        const currentEnd = new Date(currentShift.endTime);
        const nextStart = new Date(nextShift.startTime);
        
        // Check if current shift ends late (7:30pm or later) and next shift starts early (8am-9am)
        const currentEndHour = currentEnd.getHours();
        const currentEndMinute = currentEnd.getMinutes();
        const nextStartHour = nextStart.getHours();
        
        const isClosingShift = (currentEndHour > 19) || (currentEndHour === 19 && currentEndMinute >= 30);
        const isOpeningShift = nextStartHour >= 8 && nextStartHour <= 9;
        
        // Check if they're on consecutive calendar days (not just 24h apart)
        const currentDate = new Date(currentShift.startTime);
        const nextDate = new Date(nextShift.startTime);
        const calendarDaysDiff = differenceInCalendarDays(nextDate, currentDate);
        
        if (isClosingShift && isOpeningShift && calendarDaysDiff === 1) {
          const closeDay = format(currentDate, "EEE");
          const openDay = format(nextDate, "EEE");
          newIssues.push({
            type: "warning",
            message: `${emp.name} has a clopening: closes ${closeDay} then opens ${openDay}`
          });
        }
      }
    });

    // Check 7: Donor greeter shift variety (must have mix of opening and closing shifts)
    // This applies to both part-time and full-time employees
    const donorGreeters = employees.filter(emp => emp.jobTitle === 'DONDOOR' && emp.isActive);
    
    donorGreeters.forEach(greeter => {
      const greeterShifts = shifts.filter(s => s.employeeId === greeter.id);
      
      if (greeterShifts.length < 2) return; // Need at least 2 shifts to check variety
      
      let openingCount = 0;
      let closingCount = 0;
      let midShiftCount = 0;
      
      greeterShifts.forEach(shift => {
        const startStr = format(shift.startTime, "HH:mm");
        const endStr = format(shift.endTime, "HH:mm");
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
            message: `${greeter.name} (Donor Greeter) has ${closingCount} closing shifts but no opening shifts - needs variety`
          });
        } else if (closingCount === 0 && openingCount >= 2) {
          newIssues.push({
            type: "warning",
            message: `${greeter.name} (Donor Greeter) has ${openingCount} opening shifts but no closing shifts - needs variety`
          });
        }
      }
    });

    // Check 8: Manager closing shift limit (max 3 closes per week)
    const managerJobCodes = ['STSUPER', 'STASSTSP', 'STLDWKR'];
    const managers = employees.filter(emp => managerJobCodes.includes(emp.jobTitle) && emp.isActive);
    
    managers.forEach(manager => {
      const managerShifts = shifts.filter(s => s.employeeId === manager.id);
      
      let closingCount = 0;
      
      managerShifts.forEach(shift => {
        const startStr = format(shift.startTime, "HH:mm");
        const endStr = format(shift.endTime, "HH:mm");
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
          message: `${manager.name} (${getJobTitle(manager.jobTitle)}) has ${closingCount} closing shifts this week (max 3 recommended)`
        });
      }
    });

    // Check 9: Holiday shifts (store is closed on Easter, Thanksgiving, Christmas)
    shifts.forEach(shift => {
      const shiftDate = new Date(shift.startTime);
      const holidayName = isHoliday(shiftDate);
      if (holidayName) {
        const emp = employees.find(e => e.id === shift.employeeId);
        const empName = emp?.name || "Unknown";
        newIssues.push({
          type: "error",
          message: `${empName} is scheduled on ${holidayName} (store is closed)`
        });
      }
    });

    // Check 10: Consecutive days worked (more than 5 days in a row)
    // This checks across schedule boundaries by looking at previous week's shifts
    employees.forEach(emp => {
      // Get all shift dates for this employee from both weeks
      const currentWeekDates = shifts
        .filter(s => s.employeeId === emp.id)
        .map(s => format(new Date(s.startTime), 'yyyy-MM-dd'));
      
      const prevWeekDates = prevWeekShifts
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
            message: `${emp.name} is scheduled ${maxStreak} days in a row (${startLabel} - ${endLabel})`
          });
        }
      }
    });

    return newIssues;
  }, [employees, shifts, prevWeekShifts, roles, settings, timeOff, start, end]);

  if (!issues.length) {
    return (
      <Card className="border-green-200 bg-green-50/50">
        <CardContent className="pt-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center text-green-600">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <p className="font-semibold text-green-900">Schedule Valid</p>
            <p className="text-sm text-green-700">All constraints met.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-orange-500" />
          Validation Issues
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {issues.map((issue, idx) => (
            <div 
              key={idx} 
              className={cn(
                "p-3 rounded text-sm border flex items-start gap-3",
                issue.type === "error" ? "bg-red-50 border-red-200 text-red-800" : "bg-orange-50 border-orange-200 text-orange-800"
              )}
              data-testid={`validation-issue-${idx}`}
            >
               <div className={cn("w-2 h-2 rounded-full mt-1.5 shrink-0", issue.type === "error" ? "bg-red-500" : "bg-orange-500")} />
               <span className="flex-1">{issue.message}</span>
               {issue.remediation && onRemediate && (
                 <Button 
                   size="sm" 
                   variant="outline"
                   className="shrink-0 h-7 px-2 text-xs gap-1"
                   onClick={() => onRemediate(issue.remediation!)}
                   data-testid={`button-fix-issue-${idx}`}
                 >
                   <Wand2 className="w-3 h-3" />
                   Fix
                 </Button>
               )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
