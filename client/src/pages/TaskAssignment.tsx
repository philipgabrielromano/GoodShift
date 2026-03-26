import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, ChevronRight, Trash2, Copy, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { TASK_LIST } from "@shared/schema";
import type { TaskAssignment as TaskAssignmentType } from "@shared/schema";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { useCurrentUser } from "@/hooks/use-users";
import { useLocation } from "wouter";

const TIMEZONE = "America/New_York";

const JOB_COLORS: Record<string, string> = {
  "STSUPER": "#9333EA",
  "STRSUPER": "#9333EA",
  "STASSTSP": "#F97316",
  "STLDWKR": "#84CC16",
  "CASHSLS": "#EC4899",
  "APPROC": "#3B82F6",
  "DONPRI": "#22C55E",
  "DONDOOR": "#F472B6",
  "ECOMDIR": "#9333EA",
  "ECMCOMLD": "#F97316",
  "EASSIS": "#84CC16",
  "ECOMSL": "#06B6D4",
  "ECSHIP": "#8B5CF6",
  "ECOMCOMP": "#14B8A6",
  "ECOMJSE": "#F59E0B",
  "ECOMJSO": "#EF4444",
  "ECQCS": "#10B981",
  "EPROCOOR": "#6366F1",
  "ECCUST": "#78716C",
  "ECOPAS": "#D946EF",
  "SLSFLR": "#0EA5E9",
  "CUST": "#A3A3A3",
  "PART": "#6B7280",
  "APWV": "#3B82F6",
  "WVDON": "#F472B6",
  "CSHSLSWV": "#EC4899",
  "DONPRWV": "#22C55E",
  "WVSTMNG": "#9333EA",
  "WVSTAST": "#F97316",
  "WVLDWRK": "#84CC16",
};

const TASK_COLORS: Record<string, string> = {
  "Complete Pulls": "#3B82F6",
  "Run Register": "#EC4899",
  "Run Rack": "#F97316",
  "Process Clothes": "#8B5CF6",
  "Process Wares": "#22C55E",
  "Process Shoes": "#06B6D4",
  "Process Accessories": "#F59E0B",
  "Complete eCommerce": "#9333EA",
  "Clean Women's Restroom": "#14B8A6",
  "Clean Men's Restroom": "#0EA5E9",
  "Use the Dust Mop": "#A3A3A3",
  "Run the Floor Machine": "#78716C",
  "Stock New Goods": "#84CC16",
  "Flex Assigned Clothing Racks": "#EF4444",
};

interface Employee {
  id: number;
  name: string;
  jobTitle: string;
  isActive: boolean;
  location: string | null;
  isHiddenFromSchedule: boolean;
}

interface Shift {
  id: number;
  employeeId: number;
  startTime: string;
  endTime: string;
}

interface Location {
  id: number;
  name: string;
  isActive: boolean;
}

const HOUR_START = 7;
const HOUR_END = 22;
const TOTAL_HOURS = HOUR_END - HOUR_START;
const MINUTES_PER_PIXEL = 2;
const ROW_HEIGHT = 52;
const TIMELINE_WIDTH = TOTAL_HOURS * 60 / MINUTES_PER_PIXEL;
const LABEL_WIDTH = 180;

function minuteToX(minute: number): number {
  return (minute - HOUR_START * 60) / MINUTES_PER_PIXEL;
}

function xToMinute(x: number): number {
  return Math.round((x * MINUTES_PER_PIXEL + HOUR_START * 60) / 15) * 15;
}

function formatMinute(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${min.toString().padStart(2, "0")} ${ampm}`;
}

function calculateEffectiveHours(startTime: Date, endTime: Date): number {
  if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) return 0;
  const clockHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
  if (clockHours < 0) return 0;
  const paidHours = clockHours >= 6 ? clockHours - 0.5 : clockHours;
  if (paidHours >= 8) return 7;
  if (paidHours >= 5) return paidHours - 0.25;
  return paidHours;
}

const PIECES_PER_EFFECTIVE_HOUR = 60;

function getDateString(date: Date): string {
  return formatInTimeZone(date, TIMEZONE, "yyyy-MM-dd");
}

export default function TaskAssignment() {
  const { data: currentUser } = useCurrentUser();
  const [, navigate] = useLocation();
  const userRole = currentUser?.user?.role;
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date();
    return getDateString(now);
  });
  const [selectedLocation, setSelectedLocation] = useState<string>("all");
  const [selectedTask, setSelectedTask] = useState<string>(TASK_LIST[0]);
  const [dragState, setDragState] = useState<{
    type: "move" | "resize-start" | "resize-end" | "create" | "copy";
    assignmentId?: number;
    employeeId: number;
    targetEmployeeId: number;
    startX: number;
    originalStartMinute: number;
    originalDuration: number;
    currentMinute: number;
    currentDuration: number;
  } | null>(null);
  const [hoveredEmployeeId, setHoveredEmployeeId] = useState<number | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const dateObj = useMemo(() => {
    const [y, m, d] = selectedDate.split("-").map(Number);
    return new Date(y, m - 1, d);
  }, [selectedDate]);

  const weekStart = useMemo(() => {
    const d = new Date(dateObj);
    d.setDate(d.getDate() - d.getDay());
    return d;
  }, [dateObj]);

  const weekEnd = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    return d;
  }, [weekStart]);

  const { data: shifts = [] } = useQuery<Shift[]>({
    queryKey: ["/api/shifts", { start: weekStart.toISOString(), end: weekEnd.toISOString() }],
    queryFn: async () => {
      const res = await fetch(`/api/shifts?start=${weekStart.toISOString()}&end=${weekEnd.toISOString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch shifts");
      return res.json();
    },
  });

  const { data: assignments = [], isLoading: assignmentsLoading } = useQuery<TaskAssignmentType[]>({
    queryKey: ["/api/task-assignments", selectedDate, selectedLocation],
    queryFn: async () => {
      const params = new URLSearchParams({ date: selectedDate });
      if (selectedLocation !== "all") params.set("location", selectedLocation);
      const res = await fetch(`/api/task-assignments?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch task assignments");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: { employeeId: number; taskName: string; date: string; startMinute: number; durationMinutes: number }) => {
      const res = await apiRequest("POST", "/api/task-assignments", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/task-assignments", selectedDate] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number; startMinute?: number; durationMinutes?: number; taskName?: string; employeeId?: number }) => {
      const res = await apiRequest("PUT", `/api/task-assignments/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/task-assignments", selectedDate] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/task-assignments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/task-assignments", selectedDate] });
    },
  });

  const clearDayMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/task-assignments?date=${selectedDate}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/task-assignments", selectedDate] });
      toast({ title: "Cleared", description: "All task assignments for this day have been removed." });
    },
  });

  const copyDayMutation = useMutation({
    mutationFn: async () => {
      const prevDate = new Date(selectedDate + "T12:00:00");
      prevDate.setDate(prevDate.getDate() - 1);
      const sourceDate = getDateString(prevDate);
      await apiRequest("POST", "/api/task-assignments/copy-day", {
        sourceDate,
        targetDate: selectedDate,
        location: selectedLocation,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/task-assignments", selectedDate] });
      toast({ title: "Copied", description: "Task assignments copied from previous day." });
    },
    onError: (err: Error) => {
      toast({ title: "Copy failed", description: err.message, variant: "destructive" });
    },
  });

  const todaysShifts = useMemo(() => {
    return shifts.filter(s => {
      const shiftDate = getDateString(new Date(s.startTime));
      return shiftDate === selectedDate;
    });
  }, [shifts, selectedDate]);

  const scheduledEmployees = useMemo(() => {
    const empIds = new Set(todaysShifts.map(s => s.employeeId));
    let filtered = employees
      .filter(e => e.isActive && !e.isHiddenFromSchedule && empIds.has(e.id));

    if (selectedLocation && selectedLocation !== "all") {
      filtered = filtered.filter(e => e.location === selectedLocation);
    }

    filtered.sort((a, b) => a.name.localeCompare(b.name));
    return filtered;
  }, [employees, todaysShifts, selectedLocation]);

  const shiftByEmployee = useMemo(() => {
    const map = new Map<number, Shift>();
    for (const s of todaysShifts) {
      if (!map.has(s.employeeId)) {
        map.set(s.employeeId, s);
      }
    }
    return map;
  }, [todaysShifts]);

  const assignmentsByEmployee = useMemo(() => {
    const map = new Map<number, TaskAssignmentType[]>();
    for (const a of assignments) {
      const list = map.get(a.employeeId) || [];
      list.push(a);
      map.set(a.employeeId, list);
    }
    return map;
  }, [assignments]);

  const apparelJobCodes = useMemo(() => new Set(["APPROC", "APWV"]), []);
  const waresJobCodes = useMemo(() => new Set(["DONPRI", "DONPRWV"]), []);

  const productionEstimates = useMemo(() => {
    let apparelHours = 0;
    let waresHours = 0;

    for (const emp of scheduledEmployees) {
      const shift = shiftByEmployee.get(emp.id);
      if (!shift) continue;
      const eff = calculateEffectiveHours(new Date(shift.startTime), new Date(shift.endTime));
      if (apparelJobCodes.has(emp.jobTitle)) apparelHours += eff;
      if (waresJobCodes.has(emp.jobTitle)) waresHours += eff;
    }

    return {
      apparel: Math.round(apparelHours * PIECES_PER_EFFECTIVE_HOUR),
      wares: Math.round(waresHours * PIECES_PER_EFFECTIVE_HOUR),
    };
  }, [scheduledEmployees, shiftByEmployee, apparelJobCodes, waresJobCodes]);

  const navigateDate = (offset: number) => {
    const d = new Date(dateObj);
    d.setDate(d.getDate() + offset);
    setSelectedDate(getDateString(d));
  };

  const handleTimelineMouseDown = useCallback((e: React.MouseEvent, employeeId: number) => {
    if (e.button !== 0) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const minute = xToMinute(x);
    if (minute < HOUR_START * 60 || minute >= HOUR_END * 60) return;

    setDragState({
      type: "create",
      employeeId,
      targetEmployeeId: employeeId,
      startX: e.clientX,
      originalStartMinute: minute,
      originalDuration: 15,
      currentMinute: minute,
      currentDuration: 15,
    });
  }, []);

  const handleBlockMouseDown = useCallback((e: React.MouseEvent, assignment: TaskAssignmentType) => {
    e.stopPropagation();
    if (e.button !== 0) return;

    const isCopy = e.ctrlKey || e.metaKey;

    setDragState({
      type: isCopy ? "copy" : "move",
      assignmentId: assignment.id,
      employeeId: assignment.employeeId,
      targetEmployeeId: assignment.employeeId,
      startX: e.clientX,
      originalStartMinute: assignment.startMinute,
      originalDuration: assignment.durationMinutes,
      currentMinute: assignment.startMinute,
      currentDuration: assignment.durationMinutes,
    });
  }, []);

  const handleResizeEndMouseDown = useCallback((e: React.MouseEvent, assignment: TaskAssignmentType) => {
    e.stopPropagation();
    if (e.button !== 0) return;

    setDragState({
      type: "resize-end",
      assignmentId: assignment.id,
      employeeId: assignment.employeeId,
      targetEmployeeId: assignment.employeeId,
      startX: e.clientX,
      originalStartMinute: assignment.startMinute,
      originalDuration: assignment.durationMinutes,
      currentMinute: assignment.startMinute,
      currentDuration: assignment.durationMinutes,
    });
  }, []);

  const handleResizeStartMouseDown = useCallback((e: React.MouseEvent, assignment: TaskAssignmentType) => {
    e.stopPropagation();
    if (e.button !== 0) return;

    setDragState({
      type: "resize-start",
      assignmentId: assignment.id,
      employeeId: assignment.employeeId,
      targetEmployeeId: assignment.employeeId,
      startX: e.clientX,
      originalStartMinute: assignment.startMinute,
      originalDuration: assignment.durationMinutes,
      currentMinute: assignment.startMinute,
      currentDuration: assignment.durationMinutes,
    });
  }, []);

  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragState.startX;
      const dMinutes = Math.round((dx * MINUTES_PER_PIXEL) / 15) * 15;

      if (dragState.type === "resize-end") {
        const newDuration = Math.max(15, dragState.originalDuration + dMinutes);
        const maxDuration = HOUR_END * 60 - dragState.originalStartMinute;
        setDragState(prev => prev ? { ...prev, currentDuration: Math.min(newDuration, maxDuration) } : null);
      } else if (dragState.type === "resize-start") {
        const newStart = dragState.originalStartMinute + dMinutes;
        const clampedStart = Math.max(HOUR_START * 60, Math.min(newStart, dragState.originalStartMinute + dragState.originalDuration - 15));
        const newDuration = dragState.originalDuration - (clampedStart - dragState.originalStartMinute);
        setDragState(prev => prev ? { ...prev, currentMinute: clampedStart, currentDuration: newDuration } : null);
      } else if (dragState.type === "move" || dragState.type === "copy") {
        const newMinute = dragState.originalStartMinute + dMinutes;
        const clampedMinute = Math.max(HOUR_START * 60, Math.min(newMinute, HOUR_END * 60 - dragState.originalDuration));
        const targetEmp = hoveredEmployeeId ?? dragState.employeeId;
        setDragState(prev => prev ? { ...prev, currentMinute: clampedMinute, targetEmployeeId: targetEmp } : null);
      } else if (dragState.type === "create") {
        const endMinute = dragState.originalStartMinute + dMinutes + 15;
        const clampedEnd = Math.max(dragState.originalStartMinute + 15, Math.min(endMinute, HOUR_END * 60));
        setDragState(prev => prev ? { ...prev, currentDuration: clampedEnd - dragState.originalStartMinute } : null);
      }
    };

    const handleMouseUp = () => {
      if (!dragState) return;

      if (dragState.type === "create") {
        if (dragState.currentDuration >= 15) {
          createMutation.mutate({
            employeeId: dragState.targetEmployeeId,
            taskName: selectedTask,
            date: selectedDate,
            startMinute: dragState.currentMinute,
            durationMinutes: dragState.currentDuration,
          });
        }
      } else if (dragState.type === "move" && dragState.assignmentId) {
        const changed = dragState.currentMinute !== dragState.originalStartMinute || dragState.targetEmployeeId !== dragState.employeeId;
        if (changed) {
          updateMutation.mutate({
            id: dragState.assignmentId,
            startMinute: dragState.currentMinute,
            employeeId: dragState.targetEmployeeId,
          });
        }
      } else if ((dragState.type === "resize-end" || dragState.type === "resize-start") && dragState.assignmentId) {
        const startChanged = dragState.currentMinute !== dragState.originalStartMinute;
        const durationChanged = dragState.currentDuration !== dragState.originalDuration;
        if (startChanged || durationChanged) {
          updateMutation.mutate({
            id: dragState.assignmentId,
            startMinute: dragState.currentMinute,
            durationMinutes: dragState.currentDuration,
          });
        }
      } else if (dragState.type === "copy") {
        const origAssignment = assignments.find(a => a.id === dragState.assignmentId);
        if (origAssignment) {
          createMutation.mutate({
            employeeId: dragState.targetEmployeeId,
            taskName: origAssignment.taskName,
            date: selectedDate,
            startMinute: dragState.currentMinute,
            durationMinutes: dragState.currentDuration,
          });
        }
      }

      setDragState(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragState, selectedTask, selectedDate, assignments, createMutation, updateMutation, hoveredEmployeeId]);

  const dayLabel = useMemo(() => {
    return formatInTimeZone(dateObj, TIMEZONE, "EEEE, MMMM d, yyyy");
  }, [dateObj]);

  const activeLocations = useMemo(() => {
    return locations.filter(l => l.isActive).sort((a, b) => a.name.localeCompare(b.name));
  }, [locations]);

  if (currentUser && userRole !== "manager" && userRole !== "admin") {
    navigate("/");
    return null;
  }

  return (
    <div className="p-4 lg:p-6 space-y-4" data-testid="page-task-assignment">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Task Assignment</h1>
          <p className="text-sm text-muted-foreground">Assign daily tasks to scheduled employees</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {productionEstimates.apparel > 0 && (
            <div className="text-xs px-2 py-1 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300" data-testid="text-apparel-production">
              Apparel: {productionEstimates.apparel.toLocaleString()} pcs
            </div>
          )}
          {productionEstimates.wares > 0 && (
            <div className="text-xs px-2 py-1 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300" data-testid="text-wares-production">
              Wares: {productionEstimates.wares.toLocaleString()} pcs
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => navigateDate(-1)} data-testid="button-prev-day">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div className="relative">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
              className="opacity-0 absolute inset-0 w-full h-full cursor-pointer z-10"
              data-testid="input-date-picker"
            />
            <div className="px-3 py-1.5 text-sm font-medium min-w-[200px] text-center cursor-pointer hover:bg-muted/50 rounded transition-colors" data-testid="text-selected-date">
              {dayLabel}
            </div>
          </div>
          <Button variant="outline" size="icon" onClick={() => navigateDate(1)} data-testid="button-next-day">
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSelectedDate(getDateString(new Date()))} data-testid="button-today">
            Today
          </Button>
        </div>

        <Select value={selectedLocation} onValueChange={setSelectedLocation}>
          <SelectTrigger className="w-[180px]" data-testid="select-location">
            <SelectValue placeholder="All Locations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Locations</SelectItem>
            {activeLocations.map(loc => (
              <SelectItem key={loc.id} value={loc.name}>{loc.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectedTask} onValueChange={setSelectedTask}>
          <SelectTrigger className="w-[220px]" data-testid="select-task">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TASK_LIST.map(task => (
              <SelectItem key={task} value={task}>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: TASK_COLORS[task] || "#6B7280" }} />
                  {task}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          onClick={() => copyDayMutation.mutate()}
          disabled={copyDayMutation.isPending}
          data-testid="button-copy-previous-day"
        >
          <Copy className="w-4 h-4 mr-1" />
          Copy Previous Day
        </Button>

        <Button
          variant="destructive"
          size="sm"
          onClick={() => clearDayMutation.mutate()}
          disabled={clearDayMutation.isPending || assignments.length === 0}
          data-testid="button-clear-day"
        >
          <Trash2 className="w-4 h-4 mr-1" />
          Clear Day
        </Button>
      </div>

      <div className="text-xs text-muted-foreground flex flex-wrap gap-4">
        <span>Click + drag on timeline to create a task block</span>
        <span>Drag block to move (across employees too)</span>
        <span>Drag left or right edge to resize</span>
        <span>Ctrl+drag to copy</span>
        <span>Right-click to delete</span>
        <span>Click date to use date picker</span>
      </div>

      {assignmentsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : scheduledEmployees.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground" data-testid="text-no-employees">
          No employees scheduled for this day.
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden bg-card">
          <div className="overflow-x-auto" ref={timelineRef}>
            <div style={{ minWidth: LABEL_WIDTH + TIMELINE_WIDTH + 20 }}>
              <div className="flex border-b bg-muted/50 sticky top-0 z-10">
                <div className="shrink-0 border-r px-3 py-2 font-medium text-xs text-muted-foreground" style={{ width: LABEL_WIDTH }}>
                  Employee
                </div>
                <div className="relative" style={{ width: TIMELINE_WIDTH }}>
                  {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => {
                    const hour = HOUR_START + i;
                    return (
                      <div
                        key={hour}
                        className="absolute top-0 bottom-0 border-l border-border/50 text-[10px] text-muted-foreground pl-1 pt-1"
                        style={{ left: minuteToX(hour * 60) }}
                      >
                        {hour === 0 ? "12 AM" : hour <= 12 ? `${hour} ${hour === 12 ? "PM" : "AM"}` : `${hour - 12} PM`}
                      </div>
                    );
                  })}
                </div>
              </div>

              {scheduledEmployees.map((emp) => {
                const shift = shiftByEmployee.get(emp.id);
                const empAssignments = assignmentsByEmployee.get(emp.id) || [];
                const jobColor = JOB_COLORS[emp.jobTitle] || "#6B7280";
                const isProductionWorker = ["APPROC", "APWV", "DONPRI", "DONPRWV"].includes(emp.jobTitle);

                let shiftStartMin = 0;
                let shiftEndMin = 0;
                if (shift) {
                  const stLocal = toZonedTime(new Date(shift.startTime), TIMEZONE);
                  const etLocal = toZonedTime(new Date(shift.endTime), TIMEZONE);
                  shiftStartMin = stLocal.getHours() * 60 + stLocal.getMinutes();
                  shiftEndMin = etLocal.getHours() * 60 + etLocal.getMinutes();
                }

                let empEstimate = 0;
                if (isProductionWorker && shift) {
                  const effectiveHours = calculateEffectiveHours(new Date(shift.startTime), new Date(shift.endTime));
                  empEstimate = Math.round(effectiveHours * PIECES_PER_EFFECTIVE_HOUR);
                }

                const isDropTarget = dragState && (dragState.type === "move" || dragState.type === "copy") && dragState.targetEmployeeId === emp.id && dragState.employeeId !== emp.id;

                return (
                  <div key={emp.id} className={cn("flex border-b hover:bg-muted/20 transition-colors", isDropTarget && "bg-primary/5")} style={{ height: ROW_HEIGHT, borderLeft: `3px solid ${jobColor}` }}>
                    <div
                      className="shrink-0 border-r px-3 flex items-center gap-2 text-sm"
                      style={{ width: LABEL_WIDTH, backgroundColor: `${jobColor}08` }}
                      data-testid={`text-employee-name-${emp.id}`}
                    >
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="truncate font-medium leading-tight">{emp.name}</span>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-muted-foreground truncate">{emp.jobTitle}</span>
                          {isProductionWorker && empEstimate >= 0 && shift && (
                            <span className="text-[10px] font-semibold text-primary" data-testid={`text-production-estimate-${emp.id}`}>
                              ({empEstimate} pcs)
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div
                      className="relative select-none"
                      style={{ width: TIMELINE_WIDTH, height: ROW_HEIGHT }}
                      onMouseDown={(e) => handleTimelineMouseDown(e, emp.id)}
                      onMouseEnter={() => setHoveredEmployeeId(emp.id)}
                    >
                      {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                        <div
                          key={i}
                          className="absolute top-0 bottom-0 border-l border-border/20"
                          style={{ left: minuteToX((HOUR_START + i) * 60) }}
                        />
                      ))}

                      {shift && shiftStartMin > 0 && shiftEndMin > 0 && (
                        <div
                          className="absolute top-1 bottom-1 rounded opacity-10 bg-foreground"
                          style={{
                            left: minuteToX(shiftStartMin),
                            width: Math.max(0, minuteToX(shiftEndMin) - minuteToX(shiftStartMin)),
                          }}
                          data-testid={`shift-bg-${emp.id}`}
                        />
                      )}

                      {empAssignments.map((a) => {
                        const isDragging = dragState?.assignmentId === a.id;
                        const isBeingMovedAway = isDragging && (dragState.type === "move" || dragState.type === "copy") && dragState.targetEmployeeId !== emp.id;
                        const displayMinute = isDragging && (dragState.type === "move" || dragState.type === "copy" || dragState.type === "resize-start")
                          ? dragState.currentMinute : a.startMinute;
                        const displayDuration = isDragging && (dragState.type === "resize-end" || dragState.type === "resize-start")
                          ? dragState.currentDuration : a.durationMinutes;
                        const taskColor = TASK_COLORS[a.taskName] || "#6B7280";
                        const left = minuteToX(displayMinute);
                        const width = displayDuration / MINUTES_PER_PIXEL;

                        if (isBeingMovedAway && dragState.type === "move") return null;

                        return (
                          <div
                            key={a.id}
                            className={cn(
                              "absolute top-1 bottom-1 rounded-md flex items-center px-1.5 cursor-grab active:cursor-grabbing transition-shadow",
                              isDragging && "opacity-80 shadow-lg ring-2 ring-white/50 z-20",
                              !isDragging && "hover:shadow-md hover:brightness-110 z-10"
                            )}
                            style={{
                              left,
                              width: Math.max(width, 20),
                              backgroundColor: taskColor,
                            }}
                            onMouseDown={(e) => handleBlockMouseDown(e, a)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              deleteMutation.mutate(a.id);
                            }}
                            title={`${a.taskName}\n${formatMinute(a.startMinute)} - ${formatMinute(a.startMinute + a.durationMinutes)}\nRight-click to delete | Ctrl+drag to copy | Drag edges to resize`}
                            data-testid={`task-block-${a.id}`}
                          >
                            <div
                              className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/30 rounded-l-md"
                              onMouseDown={(e) => handleResizeStartMouseDown(e, a)}
                              data-testid={`resize-start-handle-${a.id}`}
                            />
                            <span className="text-[10px] font-semibold text-white truncate leading-tight drop-shadow-sm">
                              {a.taskName}
                            </span>
                            <div
                              className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/30 rounded-r-md"
                              onMouseDown={(e) => handleResizeEndMouseDown(e, a)}
                              data-testid={`resize-end-handle-${a.id}`}
                            />
                          </div>
                        );
                      })}

                      {dragState && (dragState.type === "move" || dragState.type === "copy") && dragState.targetEmployeeId === emp.id && dragState.employeeId !== emp.id && (
                        <div
                          className="absolute top-1 bottom-1 rounded-md opacity-60 z-20 border-2 border-dashed border-white"
                          style={{
                            left: minuteToX(dragState.currentMinute),
                            width: Math.max(dragState.currentDuration / MINUTES_PER_PIXEL, 10),
                            backgroundColor: TASK_COLORS[assignments.find(a => a.id === dragState.assignmentId)?.taskName || ""] || "#6B7280",
                          }}
                        >
                          <span className="text-[10px] font-semibold text-white px-1 truncate">
                            {assignments.find(a => a.id === dragState.assignmentId)?.taskName}
                          </span>
                        </div>
                      )}

                      {dragState?.type === "create" && dragState.employeeId === emp.id && (
                        <div
                          className="absolute top-1 bottom-1 rounded-md opacity-60 z-20"
                          style={{
                            left: minuteToX(dragState.currentMinute),
                            width: Math.max(dragState.currentDuration / MINUTES_PER_PIXEL, 10),
                            backgroundColor: TASK_COLORS[selectedTask] || "#6B7280",
                          }}
                        >
                          <span className="text-[10px] font-semibold text-white px-1 truncate">
                            {selectedTask}
                          </span>
                        </div>
                      )}

                      {dragState?.type === "copy" && dragState.assignmentId && dragState.employeeId === emp.id && (
                        <div
                          className="absolute top-1 bottom-1 rounded-md opacity-50 border-2 border-dashed border-white z-20"
                          style={{
                            left: minuteToX(dragState.currentMinute),
                            width: Math.max(dragState.currentDuration / MINUTES_PER_PIXEL, 10),
                            backgroundColor: TASK_COLORS[assignments.find(a => a.id === dragState.assignmentId)?.taskName || ""] || "#6B7280",
                          }}
                        >
                          <div className="flex items-center gap-1 px-1">
                            <Copy className="w-2.5 h-2.5 text-white" />
                            <span className="text-[10px] font-semibold text-white truncate">Copy</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-2">
        {TASK_LIST.map(task => {
          const count = assignments.filter(a => a.taskName === task).length;
          return (
            <div
              key={task}
              className={cn(
                "flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border cursor-pointer transition-all",
                selectedTask === task
                  ? "ring-2 ring-primary border-primary font-semibold"
                  : "border-border hover:border-primary/50"
              )}
              onClick={() => setSelectedTask(task)}
              data-testid={`legend-task-${task.replace(/\s+/g, '-').toLowerCase()}`}
            >
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: TASK_COLORS[task] || "#6B7280" }} />
              <span>{task}</span>
              {count > 0 && (
                <span className="ml-0.5 text-[10px] bg-muted rounded-full px-1.5 font-medium">{count}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
