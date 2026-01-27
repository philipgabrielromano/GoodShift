import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useEmployees } from "@/hooks/use-employees";
import { useShifts } from "@/hooks/use-shifts";
import { useRoleRequirements, useGlobalSettings } from "@/hooks/use-settings";
import { useTimeOffRequests } from "@/hooks/use-time-off";
import { isSameDay, differenceInHours, startOfWeek, endOfWeek, parseISO } from "date-fns";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useMemo } from "react";
import clsx from "clsx";

interface Issue {
  type: "error" | "warning";
  message: string;
}

export function ScheduleValidator() {
  // Use a fixed week for now or context-aware week
  const start = startOfWeek(new Date(), { weekStartsOn: 1 }).toISOString();
  const end = endOfWeek(new Date(), { weekStartsOn: 1 }).toISOString();

  const { data: employees } = useEmployees();
  const { data: shifts } = useShifts(start, end);
  const { data: roles } = useRoleRequirements();
  const { data: settings } = useGlobalSettings();
  const { data: timeOff } = useTimeOffRequests();

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }).map((_, i) => addDays(parseISO(start), i));
  }, [start]);

  const issues = useMemo(() => {
    if (!employees || !shifts || !roles || !settings || !timeOff) return [];
    
    const newIssues: Issue[] = [];
    let totalWeeklyHours = 0;
    
    // Check 1: Employee max hours
    employees.forEach(emp => {
      const empShifts = shifts.filter(s => s.employeeId === emp.id);
      const hours = empShifts.reduce((acc, s) => acc + differenceInHours(s.endTime, s.startTime), 0);
      
      totalWeeklyHours += hours;
      
      if (hours > emp.maxWeeklyHours) {
        newIssues.push({
          type: "error",
          message: `${emp.name} is scheduled for ${hours}h (Max: ${emp.maxWeeklyHours}h)`
        });
      }
    });

    // Check 2: Total weekly limit
    if (totalWeeklyHours > settings.totalWeeklyHoursLimit) {
      newIssues.push({
        type: "error",
        message: `Total scheduled hours (${totalWeeklyHours}) exceeds limit (${settings.totalWeeklyHoursLimit})`
      });
    }

    // Check 3: Role requirements
    roles.forEach(role => {
      const roleEmployees = employees.filter(e => e.jobTitle === role.jobTitle);
      const roleIds = roleEmployees.map(e => e.id);
      
      const roleShifts = shifts.filter(s => roleIds.includes(s.employeeId));
      const roleHours = roleShifts.reduce((acc, s) => acc + differenceInHours(s.endTime, s.startTime), 0);

      if (roleHours < role.requiredWeeklyHours) {
        newIssues.push({
          type: "warning",
          message: `${role.jobTitle} coverage is ${roleHours}h (Required: ${role.requiredWeeklyHours}h)`
        });
      }
    });

    // Check 4: Manager Coverage
    weekDays.forEach(day => {
      const dayShifts = shifts.filter(s => isSameDay(s.startTime, day));
      const managerShifts = dayShifts.filter(s => {
        const emp = employees.find(e => e.id === s.employeeId);
        return emp?.jobTitle === "Manager";
      });

      // Morning shift: 08:00 - 16:30
      // Evening shift: 12:00 - 20:30
      const hasMorningManager = managerShifts.some(s => {
        const startStr = format(s.startTime, "HH:mm");
        const endStr = format(s.endTime, "HH:mm");
        return startStr === (settings.managerMorningStart || "08:00") && 
               endStr === (settings.managerMorningEnd || "16:30");
      });

      const hasEveningManager = managerShifts.some(s => {
        const startStr = format(s.startTime, "HH:mm");
        const endStr = format(s.endTime, "HH:mm");
        return startStr === (settings.managerEveningStart || "12:00") && 
               endStr === (settings.managerEveningEnd || "20:30");
      });

      if (!hasMorningManager) {
        newIssues.push({
          type: "error",
          message: `Missing Morning Manager on ${format(day, "EEEE, MMM d")}`
        });
      }
      if (!hasEveningManager) {
        newIssues.push({
          type: "error",
          message: `Missing Evening Manager on ${format(day, "EEEE, MMM d")}`
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

    return newIssues;
  }, [employees, shifts, roles, settings, timeOff]);

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
              className={clsx(
                "p-3 rounded-lg text-sm border flex items-start gap-3",
                issue.type === "error" ? "bg-red-50 border-red-200 text-red-800" : "bg-orange-50 border-orange-200 text-orange-800"
              )}
            >
               <div className={clsx("w-2 h-2 rounded-full mt-1.5 shrink-0", issue.type === "error" ? "bg-red-500" : "bg-orange-500")} />
               {issue.message}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
