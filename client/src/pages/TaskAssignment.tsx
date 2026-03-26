import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, ChevronRight, ChevronDown, Trash2, Copy, Loader2, FileDown, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, getJobTitle, getCanonicalJobCode } from "@/lib/utils";
import { TASK_LIST } from "@shared/schema";
import type { TaskAssignment as TaskAssignmentType, CustomTask } from "@shared/schema";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { useCurrentUser } from "@/hooks/use-users";
import { useLocation } from "wouter";
import { jsPDF } from "jspdf";
import goodwillLogo from "@assets/goodshift_1770590279218.png";
import latoRegularUrl from "@/assets/Lato-Regular.ttf";
import latoBoldUrl from "@/assets/Lato-Bold.ttf";

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

const JOB_PRIORITY: Record<string, number> = {
  "STSUPER": 1,
  "STASSTSP": 2,
  "STLDWKR": 3,
  "CASHSLS": 4,
  "APPROC": 5,
  "DONPRI": 6,
  "DONDOOR": 7,
  "ECOMDIR": 8,
  "ECMCOMLD": 9,
  "EASSIS": 10,
  "ECOMSL": 11,
  "ECSHIP": 12,
  "ECOMCOMP": 13,
  "ECOMJSE": 14,
  "ECOMJSO": 15,
  "ECQCS": 16,
  "EPROCOOR": 17,
  "ECCUST": 18,
  "ECOPAS": 19,
};

function getJobPriority(jobTitle: string): number {
  const canonical = getCanonicalJobCode(jobTitle);
  return JOB_PRIORITY[canonical] ?? 99;
}

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
const TOTAL_MINUTES = TOTAL_HOURS * 60;
const ROW_HEIGHT = 52;
const LABEL_WIDTH = 180;
const MIN_TIMELINE_WIDTH = 600;

function formatMinute(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${min.toString().padStart(2, "0")} ${ampm}`;
}

const PIECES_PER_EFFECTIVE_HOUR = 60;

const APPAREL_PRODUCTION_TASKS = new Set(["Process Clothes", "Process Shoes", "Process Accessories", "Complete Pulls"]);
const WARES_PRODUCTION_TASKS = new Set(["Process Wares"]);

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
    clickMinute?: number;
    didDrag?: boolean;
  } | null>(null);
  const [hoveredEmployeeId, setHoveredEmployeeId] = useState<number | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [timelineWidth, setTimelineWidth] = useState(MIN_TIMELINE_WIDTH);
  const timelineRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const availableWidth = entry.contentRect.width - LABEL_WIDTH - 20;
        setTimelineWidth(Math.max(availableWidth, MIN_TIMELINE_WIDTH));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const minutesPerPixel = TOTAL_MINUTES / timelineWidth;

  const minuteToX = useCallback((minute: number): number => {
    return (minute - HOUR_START * 60) / minutesPerPixel;
  }, [minutesPerPixel]);

  const xToMinute = useCallback((x: number): number => {
    return Math.round((x * minutesPerPixel + HOUR_START * 60) / 15) * 15;
  }, [minutesPerPixel]);

  const toggleGroupCollapse = useCallback((jobTitle: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(jobTitle)) next.delete(jobTitle);
      else next.add(jobTitle);
      return next;
    });
  }, []);

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

  const { data: customTasksList = [] } = useQuery<CustomTask[]>({
    queryKey: ["/api/custom-tasks"],
    queryFn: async () => {
      const res = await fetch("/api/custom-tasks", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const allTasks = useMemo(() => {
    const predefined = TASK_LIST.map(name => ({ name, color: TASK_COLORS[name] || "#6B7280", isCustom: false, id: 0 }));
    const custom = customTasksList.map(ct => ({ name: ct.taskName, color: ct.color, isCustom: true, id: ct.id }));
    return [...predefined, ...custom];
  }, [customTasksList]);

  const allTaskColors = useMemo(() => {
    const colors: Record<string, string> = { ...TASK_COLORS };
    for (const ct of customTasksList) {
      colors[ct.taskName] = ct.color;
    }
    return colors;
  }, [customTasksList]);

  const createCustomTaskMutation = useMutation({
    mutationFn: async (data: { taskName: string; color: string }) => {
      const res = await apiRequest("POST", "/api/custom-tasks", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-tasks"] });
      toast({ title: "Custom Task Added", description: "Your custom task is now available in the task list." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteCustomTaskMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/custom-tasks/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-tasks"] });
      toast({ title: "Custom Task Removed" });
    },
  });

  const [newTaskName, setNewTaskName] = useState("");
  const [newTaskColor, setNewTaskColor] = useState("#6B7280");
  const [showCustomTaskDialog, setShowCustomTaskDialog] = useState(false);

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

  const groupedEmployees = useMemo(() => {
    return Object.entries(
      scheduledEmployees.reduce((acc, emp) => {
        const canonical = getCanonicalJobCode(emp.jobTitle);
        if (!acc[canonical]) acc[canonical] = [];
        acc[canonical].push(emp);
        return acc;
      }, {} as Record<string, Employee[]>)
    ).sort(([a], [b]) => getJobPriority(a) - getJobPriority(b));
  }, [scheduledEmployees]);

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

  const shiftMinutesByEmployee = useMemo(() => {
    const map = new Map<number, { start: number; end: number }>();
    for (const [empId, shift] of shiftByEmployee) {
      const stLocal = toZonedTime(new Date(shift.startTime), TIMEZONE);
      const etLocal = toZonedTime(new Date(shift.endTime), TIMEZONE);
      map.set(empId, {
        start: stLocal.getHours() * 60 + stLocal.getMinutes(),
        end: etLocal.getHours() * 60 + etLocal.getMinutes(),
      });
    }
    return map;
  }, [shiftByEmployee]);

  const productionEstimates = useMemo(() => {
    let apparelMinutes = 0;
    let waresMinutes = 0;

    for (const a of assignments) {
      if (APPAREL_PRODUCTION_TASKS.has(a.taskName)) {
        apparelMinutes += a.durationMinutes;
      } else if (WARES_PRODUCTION_TASKS.has(a.taskName)) {
        waresMinutes += a.durationMinutes;
      }
    }

    const apparelHours = apparelMinutes / 60;
    const waresHours = waresMinutes / 60;

    return {
      apparel: Math.round(apparelHours * PIECES_PER_EFFECTIVE_HOUR),
      wares: Math.round(waresHours * PIECES_PER_EFFECTIVE_HOUR),
      totalPieces: Math.round(apparelHours * PIECES_PER_EFFECTIVE_HOUR) + Math.round(waresHours * PIECES_PER_EFFECTIVE_HOUR),
    };
  }, [assignments]);

  const navigateDate = (offset: number) => {
    const d = new Date(dateObj);
    d.setDate(d.getDate() + offset);
    setSelectedDate(getDateString(d));
  };

  const handleTimelineMouseDown = useCallback((e: React.MouseEvent, employeeId: number) => {
    if (e.button !== 0) return;
    const shiftBounds = shiftMinutesByEmployee.get(employeeId);
    if (!shiftBounds) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const minute = xToMinute(x);
    if (minute < shiftBounds.start || minute >= shiftBounds.end) return;

    setDragState({
      type: "create",
      employeeId,
      targetEmployeeId: employeeId,
      startX: e.clientX,
      originalStartMinute: shiftBounds.start,
      originalDuration: shiftBounds.end - shiftBounds.start,
      currentMinute: shiftBounds.start,
      currentDuration: shiftBounds.end - shiftBounds.start,
      clickMinute: minute,
      didDrag: false,
    } as any);
  }, [xToMinute, shiftMinutesByEmployee]);

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
      const dMinutes = Math.round((dx * minutesPerPixel) / 15) * 15;
      const shiftBounds = shiftMinutesByEmployee.get(dragState.employeeId);
      const shiftStart = shiftBounds?.start ?? HOUR_START * 60;
      const shiftEnd = shiftBounds?.end ?? HOUR_END * 60;

      if (dragState.type === "resize-end") {
        const newDuration = Math.max(15, dragState.originalDuration + dMinutes);
        const maxDuration = shiftEnd - dragState.originalStartMinute;
        setDragState(prev => prev ? { ...prev, currentDuration: Math.min(newDuration, maxDuration) } : null);
      } else if (dragState.type === "resize-start") {
        const newStart = dragState.originalStartMinute + dMinutes;
        const clampedStart = Math.max(shiftStart, Math.min(newStart, dragState.originalStartMinute + dragState.originalDuration - 15));
        const newDuration = dragState.originalDuration - (clampedStart - dragState.originalStartMinute);
        setDragState(prev => prev ? { ...prev, currentMinute: clampedStart, currentDuration: newDuration } : null);
      } else if (dragState.type === "move" || dragState.type === "copy") {
        const targetEmp = hoveredEmployeeId ?? dragState.employeeId;
        const targetBounds = shiftMinutesByEmployee.get(targetEmp);
        const tStart = targetBounds?.start ?? HOUR_START * 60;
        const tEnd = targetBounds?.end ?? HOUR_END * 60;
        const newMinute = dragState.originalStartMinute + dMinutes;
        const clampedMinute = Math.max(tStart, Math.min(newMinute, tEnd - dragState.originalDuration));
        setDragState(prev => prev ? { ...prev, currentMinute: clampedMinute, targetEmployeeId: targetEmp } : null);
      } else if (dragState.type === "create") {
        if (!dragState.didDrag && Math.abs(dx) > 5) {
          const clickMin = dragState.clickMinute ?? shiftStart;
          const snappedClick = Math.round(clickMin / 15) * 15;
          setDragState(prev => prev ? { ...prev, didDrag: true, originalStartMinute: snappedClick, currentMinute: snappedClick, currentDuration: 15 } : null);
        } else if (dragState.didDrag) {
          const dragStartMin = dragState.originalStartMinute;
          const endMinute = dragStartMin + dMinutes + 15;
          const clampedEnd = Math.max(dragStartMin + 15, Math.min(endMinute, shiftEnd));
          setDragState(prev => prev ? { ...prev, currentDuration: clampedEnd - dragStartMin } : null);
        }
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
  }, [dragState, selectedTask, selectedDate, assignments, createMutation, updateMutation, hoveredEmployeeId, minutesPerPixel, shiftMinutesByEmployee]);

  const dayLabel = useMemo(() => {
    return formatInTimeZone(dateObj, TIMEZONE, "EEEE, MMMM d, yyyy");
  }, [dateObj]);

  const activeLocations = useMemo(() => {
    return locations.filter(l => l.isActive).sort((a, b) => a.name.localeCompare(b.name));
  }, [locations]);

  const handleExportPDF = async () => {
    if (scheduledEmployees.length === 0) {
      toast({ variant: "destructive", title: "No Data", description: "No scheduled employees to export." });
      return;
    }

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "letter" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    let fontFamily = "helvetica";
    try {
      const [latoRegularData, latoBoldData] = await Promise.all([
        fetch(latoRegularUrl).then(r => r.arrayBuffer()),
        fetch(latoBoldUrl).then(r => r.arrayBuffer())
      ]);
      const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
      };
      doc.addFileToVFS("Lato-Regular.ttf", arrayBufferToBase64(latoRegularData));
      doc.addFont("Lato-Regular.ttf", "Lato", "normal");
      doc.addFileToVFS("Lato-Bold.ttf", arrayBufferToBase64(latoBoldData));
      doc.addFont("Lato-Bold.ttf", "Lato", "bold");
      fontFamily = "Lato";
    } catch {
      console.warn("Could not load Lato font, using default helvetica");
    }
    doc.setFont(fontFamily);

    const margin = 10;
    const labelColWidth = 42;
    const timelineStartX = margin + labelColWidth;
    const timelineWidth = pageWidth - timelineStartX - margin;
    const rowHeight = 6;
    const headerHeight = 8;

    const logoHeight = 10;
    const logoWidth = 30;
    try {
      doc.addImage(goodwillLogo, "PNG", margin, 6, logoWidth, logoHeight);
    } catch {
      console.warn("Could not load logo image");
    }

    const locationName = selectedLocation === "all" ? "All Locations" : selectedLocation;
    doc.setFont(fontFamily, "bold");
    doc.setFontSize(14);
    doc.text(`Task Assignments - ${locationName}`, margin + logoWidth + 4, 12);
    doc.setFont(fontFamily, "normal");
    doc.setFontSize(10);
    doc.text(dayLabel, margin + logoWidth + 4, 18);

    let summaryParts: string[] = [];
    if (productionEstimates.totalPieces > 0) summaryParts.push(`Total: ${productionEstimates.totalPieces.toLocaleString()} pcs`);
    if (productionEstimates.apparel > 0) summaryParts.push(`Apparel: ${productionEstimates.apparel.toLocaleString()} pcs`);
    if (productionEstimates.wares > 0) summaryParts.push(`Wares: ${productionEstimates.wares.toLocaleString()} pcs`);
    if (summaryParts.length > 0) {
      doc.setFontSize(9);
      doc.text(summaryParts.join("  |  "), pageWidth - margin, 12, { align: "right" });
    }

    const minuteToTimelineX = (minute: number) => {
      const fraction = (minute - HOUR_START * 60) / (TOTAL_HOURS * 60);
      return timelineStartX + fraction * timelineWidth;
    };

    const hexToRgb = (hex: string): [number, number, number] => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return [r, g, b];
    };

    const drawPage = (emps: typeof scheduledEmployees, startY: number) => {
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.2);

      doc.setFillColor(0, 83, 159);
      doc.rect(margin, startY, pageWidth - 2 * margin, headerHeight, "F");

      doc.setFont(fontFamily, "bold");
      doc.setFontSize(7);
      doc.setTextColor(255, 255, 255);
      doc.text("Employee", margin + 2, startY + headerHeight / 2 + 1);

      for (let h = HOUR_START; h <= HOUR_END; h++) {
        const x = minuteToTimelineX(h * 60);
        const label = h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`;
        doc.text(label, x, startY + headerHeight / 2 + 1);
      }

      doc.setTextColor(0, 0, 0);
      let y = startY + headerHeight;

      emps.forEach((emp, idx) => {
        if (idx % 2 === 0) {
          doc.setFillColor(245, 247, 250);
          doc.rect(margin, y, pageWidth - 2 * margin, rowHeight, "F");
        }

        const jobColor = JOB_COLORS[emp.jobTitle] || "#6B7280";
        const [jr, jg, jb] = hexToRgb(jobColor);
        doc.setFillColor(jr, jg, jb);
        doc.rect(margin, y, 1, rowHeight, "F");

        doc.setFont(fontFamily, "bold");
        doc.setFontSize(6);
        doc.setTextColor(0, 0, 0);
        doc.text(emp.name, margin + 2.5, y + rowHeight / 2 + 0.5, { maxWidth: 28 });

        const pdfEmpAssignments = assignmentsByEmployee.get(emp.id) || [];
        let pdfProdMinutes = 0;
        pdfEmpAssignments.forEach(a => {
          if (APPAREL_PRODUCTION_TASKS.has(a.taskName) || WARES_PRODUCTION_TASKS.has(a.taskName)) {
            pdfProdMinutes += a.durationMinutes;
          }
        });
        const pdfEmpEstimate = Math.round((pdfProdMinutes / 60) * PIECES_PER_EFFECTIVE_HOUR);
        doc.setFont(fontFamily, "normal");
        doc.setFontSize(5);
        doc.setTextColor(100, 100, 100);
        if (pdfEmpEstimate > 0) {
          doc.text(`${getJobTitle(emp.jobTitle)} (${pdfEmpEstimate}pcs)`, margin + 2.5, y + rowHeight - 0.8);
        } else {
          doc.text(getJobTitle(emp.jobTitle), margin + 2.5, y + rowHeight - 0.8);
        }

        if (shift) {
          const stLocal = toZonedTime(new Date(shift.startTime), TIMEZONE);
          const etLocal = toZonedTime(new Date(shift.endTime), TIMEZONE);
          const shiftStartMin = stLocal.getHours() * 60 + stLocal.getMinutes();
          const shiftEndMin = etLocal.getHours() * 60 + etLocal.getMinutes();
          const sx = minuteToTimelineX(Math.max(shiftStartMin, HOUR_START * 60));
          const ex = minuteToTimelineX(Math.min(shiftEndMin, HOUR_END * 60));
          doc.setFillColor(230, 240, 250);
          doc.rect(sx, y + 0.5, ex - sx, rowHeight - 1, "F");
        }

        const empAssignments = assignmentsByEmployee.get(emp.id) || [];
        empAssignments.forEach((a) => {
          const taskColor = allTaskColors[a.taskName] || "#6B7280";
          const [tr, tg, tb] = hexToRgb(taskColor);
          const clampedStart = Math.max(a.startMinute, HOUR_START * 60);
          const clampedEnd = Math.min(a.startMinute + a.durationMinutes, HOUR_END * 60);
          if (clampedEnd <= clampedStart) return;
          const ax = minuteToTimelineX(clampedStart);
          const aw = minuteToTimelineX(clampedEnd) - ax;

          doc.setFillColor(tr, tg, tb);
          doc.roundedRect(ax, y + 0.8, Math.max(aw, 2), rowHeight - 1.6, 0.5, 0.5, "F");

          doc.setFont(fontFamily, "bold");
          doc.setFontSize(4.5);
          doc.setTextColor(255, 255, 255);
          if (aw > 10) {
            doc.text(a.taskName, ax + 0.8, y + rowHeight / 2 + 0.5, { maxWidth: aw - 1.5 });
          }
        });

        for (let h = HOUR_START; h <= HOUR_END; h++) {
          const x = minuteToTimelineX(h * 60);
          doc.setDrawColor(220, 220, 220);
          doc.setLineWidth(0.1);
          doc.line(x, y, x, y + rowHeight);
        }

        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.1);
        doc.line(margin, y + rowHeight, pageWidth - margin, y + rowHeight);

        y += rowHeight;
      });

      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.2);
      doc.rect(margin, startY, pageWidth - 2 * margin, y - startY);
      doc.line(timelineStartX, startY, timelineStartX, y);

      return y;
    };

    const startY = 24;
    const maxRowsPerPage = Math.floor((pageHeight - startY - 20) / rowHeight);
    const sortedEmployees = groupedEmployees.flatMap(([, emps]) => emps);

    for (let i = 0; i < sortedEmployees.length; i += maxRowsPerPage) {
      if (i > 0) doc.addPage();
      const pageEmps = sortedEmployees.slice(i, i + maxRowsPerPage);
      const finalY = drawPage(pageEmps, startY);

      doc.setFont(fontFamily, "normal");
      doc.setFontSize(7);
      doc.setTextColor(100, 100, 100);
      doc.text(`Generated: ${formatInTimeZone(new Date(), TIMEZONE, "MMM d, yyyy h:mm a")}`, pageWidth - margin, finalY + 5, { align: "right" });
      doc.text(`Total employees: ${sortedEmployees.length}  |  Assignments: ${assignments.length}`, margin, finalY + 5);
    }

    if (scheduledEmployees.length > 0) {
      const lastPageCount = scheduledEmployees.length - (Math.ceil(scheduledEmployees.length / maxRowsPerPage) - 1) * maxRowsPerPage;
      const lastPageEndY = startY + headerHeight + lastPageCount * rowHeight + 12;

      if (lastPageEndY + 30 > pageHeight) {
        doc.addPage();
      }

      const legendStartY = lastPageEndY + 30 > pageHeight ? startY : lastPageEndY;
      doc.setFont(fontFamily, "bold");
      doc.setFontSize(8);
      doc.setTextColor(0, 0, 0);
      doc.text("Task Legend", margin, legendStartY);

      const cols = 3;
      const colWidth = (pageWidth - 2 * margin) / cols;
      const allTaskNames = [...TASK_LIST, ...customTasksList.map(ct => ct.taskName)];
      allTaskNames.forEach((taskName, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const lx = margin + col * colWidth;
        const ly = legendStartY + 4 + row * 5;
        const color = allTaskColors[taskName] || "#6B7280";
        const [lr, lg, lb] = hexToRgb(color);
        doc.setFillColor(lr, lg, lb);
        doc.roundedRect(lx, ly - 2.5, 3, 3, 0.5, 0.5, "F");
        doc.setFont(fontFamily, "normal");
        doc.setFontSize(6);
        doc.setTextColor(0, 0, 0);
        doc.text(taskName, lx + 4, ly);
      });
    }

    const filename = `task_assignments_${selectedDate}_${locationName.replace(/\s+/g, '_')}.pdf`;
    doc.save(filename);
    toast({ title: "PDF Exported", description: `Task assignments saved as ${filename}` });
  };

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
          {productionEstimates.totalPieces > 0 && (
            <div className="text-sm px-3 py-1.5 rounded-md bg-primary/10 text-primary font-bold border border-primary/20" data-testid="text-total-production">
              Planned Production: {productionEstimates.totalPieces.toLocaleString()} pcs
            </div>
          )}
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
              ref={dateInputRef}
              type="date"
              value={selectedDate}
              onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
              className="sr-only"
              data-testid="input-date-picker"
            />
            <div
              className="px-3 py-1.5 text-sm font-medium min-w-[200px] text-center cursor-pointer hover:bg-muted/50 rounded transition-colors"
              data-testid="text-selected-date"
              onClick={() => dateInputRef.current?.showPicker()}
            >
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
            {allTasks.map(task => (
              <SelectItem key={task.name} value={task.name}>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: task.color }} />
                  {task.name}
                  {task.isCustom && <span className="text-[10px] text-muted-foreground ml-1">(custom)</span>}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Dialog open={showCustomTaskDialog} onOpenChange={setShowCustomTaskDialog}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" data-testid="button-manage-custom-tasks">
              <Plus className="w-4 h-4 mr-1" />
              Custom Task
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Manage Custom Tasks</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Task name..."
                  value={newTaskName}
                  onChange={(e) => setNewTaskName(e.target.value)}
                  className="flex-1"
                  maxLength={100}
                  data-testid="input-custom-task-name"
                />
                <input
                  type="color"
                  value={newTaskColor}
                  onChange={(e) => setNewTaskColor(e.target.value)}
                  className="w-10 h-10 rounded border cursor-pointer"
                  data-testid="input-custom-task-color"
                />
                <Button
                  size="sm"
                  onClick={() => {
                    if (newTaskName.trim()) {
                      createCustomTaskMutation.mutate({ taskName: newTaskName.trim(), color: newTaskColor });
                      setNewTaskName("");
                      setNewTaskColor("#6B7280");
                    }
                  }}
                  disabled={!newTaskName.trim() || createCustomTaskMutation.isPending}
                  data-testid="button-add-custom-task"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              {customTasksList.length > 0 ? (
                <div className="space-y-2">
                  {customTasksList.map(ct => (
                    <div key={ct.id} className="flex items-center justify-between gap-2 p-2 rounded border">
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-sm" style={{ backgroundColor: ct.color }} />
                        <span className="text-sm font-medium">{ct.taskName}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => deleteCustomTaskMutation.mutate(ct.id)}
                        disabled={deleteCustomTaskMutation.isPending}
                        data-testid={`button-delete-custom-task-${ct.id}`}
                      >
                        <X className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No custom tasks yet. Add one above and it will appear in your task list.
                </p>
              )}
            </div>
          </DialogContent>
        </Dialog>

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
          variant="outline"
          size="sm"
          onClick={handleExportPDF}
          disabled={scheduledEmployees.length === 0}
          data-testid="button-export-pdf"
        >
          <FileDown className="w-4 h-4 mr-1" />
          Export PDF
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
        <span>Click to assign full shift, drag to set custom duration</span>
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
        <div className="border rounded-lg overflow-hidden bg-card" ref={containerRef}>
          <div className="overflow-x-auto" ref={timelineRef}>
            <div style={{ minWidth: LABEL_WIDTH + MIN_TIMELINE_WIDTH + 20 }}>
              <div className="flex border-b bg-muted/50 sticky top-0 z-10">
                <div className="shrink-0 border-r px-3 py-2 font-medium text-xs text-muted-foreground" style={{ width: LABEL_WIDTH }}>
                  Employee
                </div>
                <div className="relative flex-1" style={{ minWidth: MIN_TIMELINE_WIDTH }}>
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

              {groupedEmployees.map(([jobTitle, groupEmps]) => {
                const isCollapsed = collapsedGroups.has(jobTitle);
                const groupColor = JOB_COLORS[jobTitle] || "#6B7280";

                return (
                  <div key={jobTitle} className="border-b last:border-b-0">
                    <button
                      onClick={() => toggleGroupCollapse(jobTitle)}
                      className="w-full px-4 py-1.5 font-bold text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2 hover:bg-muted/30 transition-colors focus:outline-none bg-muted/20 border-b"
                      data-testid={`button-toggle-group-${jobTitle}`}
                      style={{ borderLeft: `3px solid ${groupColor}` }}
                    >
                      {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      <span>{getJobTitle(jobTitle)}</span>
                      <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">{groupEmps.length}</Badge>
                    </button>

                    {!isCollapsed && groupEmps.map((emp) => {
                const shift = shiftByEmployee.get(emp.id);
                const empAssignments = assignmentsByEmployee.get(emp.id) || [];
                const jobColor = JOB_COLORS[emp.jobTitle] || "#6B7280";
                const shiftBounds = shiftMinutesByEmployee.get(emp.id);
                const shiftStartMin = shiftBounds?.start ?? 0;
                const shiftEndMin = shiftBounds?.end ?? 0;

                let empProductionMinutes = 0;
                empAssignments.forEach(a => {
                  if (APPAREL_PRODUCTION_TASKS.has(a.taskName) || WARES_PRODUCTION_TASKS.has(a.taskName)) {
                    empProductionMinutes += a.durationMinutes;
                  }
                });
                const empEstimate = Math.round((empProductionMinutes / 60) * PIECES_PER_EFFECTIVE_HOUR);

                const isDropTarget = dragState && (dragState.type === "move" || dragState.type === "copy") && dragState.targetEmployeeId === emp.id && dragState.employeeId !== emp.id;

                return (
                  <div key={emp.id} className={cn("flex border-b last:border-b-0 hover:bg-muted/20 transition-colors", isDropTarget && "bg-primary/5")} style={{ height: ROW_HEIGHT, borderLeft: `3px solid ${jobColor}` }}>
                    <div
                      className="shrink-0 border-r px-3 flex items-center gap-2 text-sm"
                      style={{ width: LABEL_WIDTH, backgroundColor: `${jobColor}08` }}
                      data-testid={`text-employee-name-${emp.id}`}
                    >
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="truncate font-medium leading-tight">{emp.name}</span>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-muted-foreground truncate">{getJobTitle(emp.jobTitle)}</span>
                          {empEstimate > 0 && (
                            <span className="text-[10px] font-semibold text-primary" data-testid={`text-production-estimate-${emp.id}`}>
                              ({empEstimate} pcs)
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div
                      className="relative select-none flex-1"
                      style={{ minWidth: MIN_TIMELINE_WIDTH, height: ROW_HEIGHT }}
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
                        const taskColor = allTaskColors[a.taskName] || "#6B7280";
                        const left = minuteToX(displayMinute);
                        const width = displayDuration / minutesPerPixel;

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
                              className="absolute left-0 top-0 bottom-0 w-3 cursor-ew-resize hover:bg-black/20 rounded-l-md flex items-center justify-center"
                              onMouseDown={(e) => handleResizeStartMouseDown(e, a)}
                              data-testid={`resize-start-handle-${a.id}`}
                            >
                              <span className="text-[8px] text-black/70 select-none">◀</span>
                            </div>
                            <span className="text-[10px] font-semibold text-white truncate leading-tight drop-shadow-sm">
                              {a.taskName}
                            </span>
                            <div
                              className="absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize hover:bg-black/20 rounded-r-md flex items-center justify-center"
                              onMouseDown={(e) => handleResizeEndMouseDown(e, a)}
                              data-testid={`resize-end-handle-${a.id}`}
                            >
                              <span className="text-[8px] text-black/70 select-none">▶</span>
                            </div>
                          </div>
                        );
                      })}

                      {dragState && (dragState.type === "move" || dragState.type === "copy") && dragState.targetEmployeeId === emp.id && dragState.employeeId !== emp.id && (
                        <div
                          className="absolute top-1 bottom-1 rounded-md opacity-60 z-20 border-2 border-dashed border-white"
                          style={{
                            left: minuteToX(dragState.currentMinute),
                            width: Math.max(dragState.currentDuration / minutesPerPixel, 10),
                            backgroundColor: allTaskColors[assignments.find(a => a.id === dragState.assignmentId)?.taskName || ""] || "#6B7280",
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
                            width: Math.max(dragState.currentDuration / minutesPerPixel, 10),
                            backgroundColor: allTaskColors[selectedTask] || "#6B7280",
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
                            width: Math.max(dragState.currentDuration / minutesPerPixel, 10),
                            backgroundColor: allTaskColors[assignments.find(a => a.id === dragState.assignmentId)?.taskName || ""] || "#6B7280",
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
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-2">
        {allTasks.map(task => {
          const count = assignments.filter(a => a.taskName === task.name).length;
          return (
            <div
              key={task.name}
              className={cn(
                "flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border cursor-pointer transition-all",
                selectedTask === task.name
                  ? "ring-2 ring-primary border-primary font-semibold"
                  : "border-border hover:border-primary/50"
              )}
              onClick={() => setSelectedTask(task.name)}
              data-testid={`legend-task-${task.name.replace(/\s+/g, '-').toLowerCase()}`}
            >
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: task.color }} />
              <span>{task.name}</span>
              {task.isCustom && <span className="text-[9px] text-muted-foreground italic">custom</span>}
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
