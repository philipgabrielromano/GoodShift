import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format } from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { getCanonicalJobCode, getJobTitle } from "@/lib/utils";
import type { Shift, Employee } from "@shared/schema";

const TIMEZONE = "America/New_York";

const JOB_COLORS: Record<string, string> = {
  "STSUPER": "#9333EA",
  "STASSTSP": "#F97316",
  "STLDWKR": "#84CC16",
  "CASHSLS": "#EC4899",
  "APPROC": "#3B82F6",
  "DONPRI": "#22C55E",
  "DONDOOR": "#F472B6",
};

function getJobColor(jobTitle: string): string {
  const canonical = getCanonicalJobCode(jobTitle);
  return JOB_COLORS[canonical] ?? "#6B7280";
}

const JOB_PRIORITY: Record<string, number> = {
  "STSUPER": 0,
  "STASSTSP": 1,
  "STLDWKR": 3,
  "CASHSLS": 4,
  "APPROC": 5,
  "DONPRI": 6,
  "DONDOOR": 7,
};

function getJobPriority(jobTitle: string): number {
  const canonical = getCanonicalJobCode(jobTitle);
  return JOB_PRIORITY[canonical] ?? 99;
}

interface DailyGanttModalProps {
  open: boolean;
  onClose: () => void;
  selectedDate: Date;
  shifts: Shift[];
  employees: Employee[];
  selectedLocation?: string;
}

export function DailyGanttModal({ open, onClose, selectedDate, shifts, employees, selectedLocation }: DailyGanttModalProps) {
  const START_HOUR = 7;
  const END_HOUR = 20;
  const TOTAL_HOURS = END_HOUR - START_HOUR;
  
  const dayShifts = shifts.filter(s => {
    const shiftDate = formatInTimeZone(s.startTime, TIMEZONE, "yyyy-MM-dd");
    const selectedDateStr = formatInTimeZone(selectedDate, TIMEZONE, "yyyy-MM-dd");
    if (shiftDate !== selectedDateStr) return false;
    if (selectedLocation && selectedLocation !== "all") {
      const emp = employees.find(e => e.id === s.employeeId);
      if (emp?.location !== selectedLocation) return false;
    }
    return true;
  });

  const shiftsWithEmployees = dayShifts
    .map(shift => {
      const employee = employees.find(e => e.id === shift.employeeId);
      return { shift, employee };
    })
    .filter(item => item.employee)
    .sort((a, b) => {
      const priorityA = getJobPriority(a.employee!.jobTitle || "");
      const priorityB = getJobPriority(b.employee!.jobTitle || "");
      if (priorityA !== priorityB) return priorityA - priorityB;
      return (a.employee!.name || "").localeCompare(b.employee!.name || "");
    });

  const getShiftPosition = (shift: Shift) => {
    const startTime = toZonedTime(new Date(shift.startTime), TIMEZONE);
    const endTime = toZonedTime(new Date(shift.endTime), TIMEZONE);
    
    const startHour = startTime.getHours() + startTime.getMinutes() / 60;
    const endHour = endTime.getHours() + endTime.getMinutes() / 60;
    
    const clampedStart = Math.max(startHour, START_HOUR);
    const clampedEnd = Math.min(endHour, END_HOUR);
    
    const leftPercent = ((clampedStart - START_HOUR) / TOTAL_HOURS) * 100;
    const widthPercent = ((clampedEnd - clampedStart) / TOTAL_HOURS) * 100;
    
    return { left: `${leftPercent}%`, width: `${Math.max(widthPercent, 1)}%` };
  };

  const formatShiftTime = (shift: Shift) => {
    const start = formatInTimeZone(shift.startTime, TIMEZONE, "h:mm a");
    const end = formatInTimeZone(shift.endTime, TIMEZONE, "h:mm a");
    return `${start} - ${end}`;
  };

  const timeMarkers: { hour: number; label: string; left: string }[] = [];
  for (let hour = START_HOUR; hour <= END_HOUR; hour++) {
    const label = hour === 12 ? "12pm" : hour < 12 ? `${hour}am` : `${hour - 12}pm`;
    const leftPercent = ((hour - START_HOUR) / TOTAL_HOURS) * 100;
    timeMarkers.push({ hour, label, left: `${leftPercent}%` });
  }

  const dateStr = formatInTimeZone(selectedDate, TIMEZONE, "EEEE, MMMM d, yyyy");

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle data-testid="gantt-modal-title">Daily Coverage - {dateStr}</DialogTitle>
        </DialogHeader>
        
        <div className="flex-1 overflow-auto">
          {shiftsWithEmployees.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground">
              No shifts scheduled for this day
            </div>
          ) : (
            <div className="min-w-[700px]">
              <div className="relative border-b mb-2 pb-1">
                <div className="h-6 relative ml-[140px]">
                  {timeMarkers.map(({ hour, label, left }) => (
                    <div
                      key={hour}
                      className="absolute text-xs text-muted-foreground transform -translate-x-1/2"
                      style={{ left }}
                    >
                      {label}
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                {shiftsWithEmployees.map(({ shift, employee }) => {
                  const position = getShiftPosition(shift);
                  const color = getJobColor(employee!.jobTitle || "");
                  const jobTitle = getJobTitle(employee!.jobTitle || "");
                  
                  return (
                    <div key={shift.id} className="flex items-center h-8 gap-2" data-testid={`gantt-row-${shift.id}`}>
                      <div className="w-[140px] flex-shrink-0 truncate text-sm font-medium pr-2">
                        {employee!.name}
                      </div>
                      <div className="flex-1 relative h-full bg-muted/30 rounded">
                        {timeMarkers.map(({ hour, left }) => (
                          <div
                            key={hour}
                            className="absolute top-0 bottom-0 border-l border-muted-foreground/10"
                            style={{ left }}
                          />
                        ))}
                        <div
                          className="absolute top-1 bottom-1 rounded-sm flex items-center justify-center text-white text-[10px] font-medium overflow-hidden shadow-sm"
                          style={{
                            left: position.left,
                            width: position.width,
                            backgroundColor: color,
                          }}
                          title={`${employee!.name} - ${jobTitle}\n${formatShiftTime(shift)}`}
                          data-testid={`gantt-bar-${shift.id}`}
                        >
                          <span className="truncate px-1">{jobTitle}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 pt-4 border-t">
                <p className="text-xs text-muted-foreground mb-2 font-medium">Legend</p>
                <div className="flex flex-wrap gap-3">
                  {Object.entries(JOB_COLORS).map(([code, color]) => (
                    <div key={code} className="flex items-center gap-1.5">
                      <div
                        className="w-3 h-3 rounded-sm"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-xs text-muted-foreground">{getJobTitle(code)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
