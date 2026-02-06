import { useState, useMemo, useEffect, useCallback } from "react";
import { format, addDays, isSameDay, addWeeks, subWeeks, getISOWeek, startOfWeek as startOfWeekDate, setHours, setMinutes, differenceInMinutes, addMinutes } from "date-fns";
import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";
import { ChevronLeft, ChevronRight, Plus, MapPin, ChevronDown, ChevronRight as ChevronRightIcon, GripVertical, Trash2, CalendarClock, Copy, Save, FileDown, Droplets, Thermometer, Send, EyeOff, AlertTriangle, Printer } from "lucide-react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { cn, getJobTitle, isHoliday, getCanonicalJobCode } from "@/lib/utils";
import { useShifts } from "@/hooks/use-shifts";
import { useEmployees } from "@/hooks/use-employees";
import { useLocations } from "@/hooks/use-locations";
import { useGlobalSettings, useUpdateGlobalSettings } from "@/hooks/use-settings";
import { ShiftDialog } from "@/components/ShiftDialog";
import { OccurrenceDialog } from "@/components/OccurrenceDialog";
import { ShiftTradeDialog } from "@/components/ShiftTradeDialog";
import { ScheduleValidator, RemediationData } from "@/components/ScheduleValidator";
import { DailyGanttModal } from "@/components/DailyGanttModal";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import type { Shift, ScheduleTemplate } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import fanfareSound from "@assets/zelda-tp-item-fanfare_1769708907750.mp3";
import goodwillLogo from "@/assets/goodwill-logo.png";
import latoRegularUrl from "@/assets/Lato-Regular.ttf";
import latoBoldUrl from "@/assets/Lato-Bold.ttf";

interface AuthStatus {
  isAuthenticated: boolean;
  user: { id: number; name: string; email: string; role: string; locationIds: string[] | null } | null;
  ssoConfigured: boolean;
}

const TIMEZONE = "America/New_York";

// Play a fanfare sound when schedule generation completes
const playFanfare = () => {
  try {
    const audio = new Audio(fanfareSound);
    audio.volume = 0.5;
    audio.play().catch(() => {
      console.log('Audio playback not supported or blocked');
    });
  } catch (e) {
    console.log('Audio playback not supported');
  }
};

// Job title priority order for schedule display (STSUPER first)
const JOB_PRIORITY: Record<string, number> = {
  "STSUPER": 1,
  "STASSTSP": 2,
  "STLDWKR": 3,
  "CASHSLS": 4,
  "APPROC": 5,
  "DONPRI": 6,
  "DONDOOR": 7,
};

// Job-specific colors for schedule display
const JOB_COLORS: Record<string, string> = {
  "STSUPER": "#9333EA",   // Purple
  "STASSTSP": "#F97316",  // Orange
  "STLDWKR": "#84CC16",   // Lime green
  "CASHSLS": "#EC4899",   // Hot pink
  "APPROC": "#3B82F6",    // Electric blue
  "DONPRI": "#22C55E",    // Green
  "DONDOOR": "#F472B6",   // Pink
};

function getJobColor(jobTitle: string): string {
  // Use canonical job code to ensure WV variants get the same color
  const canonical = getCanonicalJobCode(jobTitle);
  return JOB_COLORS[canonical] ?? "#6B7280"; // Default gray
}

function getJobPriority(jobTitle: string): number {
  // Use canonical job code to ensure WV variants get the same priority
  const canonical = getCanonicalJobCode(jobTitle);
  return JOB_PRIORITY[canonical] ?? 99;
}

// Calculate paid hours (subtract 30-min unpaid lunch for shifts 6+ hours)
function calculatePaidHours(startTime: Date, endTime: Date): number {
  const clockHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
  // If 6+ hours, subtract 0.5 hours for unpaid lunch
  return clockHours >= 6 ? clockHours - 0.5 : clockHours;
}

// Calculate effective work hours (excluding all breaks and lunches)
// For production calculations - hours actually worked without breaks
function calculateEffectiveHours(startTime: Date, endTime: Date): number {
  const clockHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
  const paidHours = clockHours >= 6 ? clockHours - 0.5 : clockHours; // Subtract unpaid lunch
  
  // Now calculate effective hours based on paid hours:
  // 8+ hours: 7 hours effective (2x15min breaks + 30min lunch = 1 hour total break time)
  // 6-7.99 hours: paid - 0.25 (one 15-min break, lunch already subtracted)
  // 5-5.99 hours: paid - 0.25 (one 15-min break)
  // Less than 5 hours: no breaks
  if (paidHours >= 8) {
    return 7; // 8h paid - 2x15min breaks = 7h effective
  } else if (paidHours >= 6) {
    return paidHours - 0.25; // Subtract one 15-min break
  } else if (paidHours >= 5) {
    return paidHours - 0.25; // Subtract one 15-min break
  }
  return paidHours; // No breaks for under 5 hours
}

// Production rate: 60 pieces per effective hour
const PIECES_PER_EFFECTIVE_HOUR = 60;

// Compute start of week in EST timezone (Sunday = 0)
function getESTWeekStart(date: Date): Date {
  const zonedDate = toZonedTime(date, TIMEZONE);
  const weekStartZoned = startOfWeekDate(zonedDate, { weekStartsOn: 0 });
  return fromZonedTime(weekStartZoned, TIMEZONE);
}

export default function Schedule() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  
  const getInitialDate = () => {
    const params = new URLSearchParams(window.location.search);
    const weekParam = params.get("week");
    if (weekParam) {
      const parsed = new Date(weekParam);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    return new Date();
  };
  
  const [currentDate, setCurrentDate] = useState(getInitialDate);
  
  // Get auth status for location-based filtering
  const { data: authStatus } = useQuery<AuthStatus>({
    queryKey: ["/api/auth/status"],
  });
  
  // Calculate week boundaries in EST
  const weekStart = useMemo(() => getESTWeekStart(currentDate), [currentDate]);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  
  const weekDays = useMemo(() => Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i)), [weekStart]);

  const { data: shifts, isLoading: shiftsLoading } = useShifts(
    weekStart.toISOString(),
    weekEnd.toISOString()
  );
  
  // Only fetch employees with retail job codes for scheduling
  const { data: employees, isLoading: empLoading } = useEmployees({ retailOnly: true });
  
  // Get locations for hours tracking
  const { data: locations, isLoading: locLoading } = useLocations();
  
  // Get global settings for staffing requirements
  const { data: settings } = useGlobalSettings();
  const updateSettings = useUpdateGlobalSettings();

  // Fetch time clock data for the current week
  const weekStartStr = format(weekStart, "yyyy-MM-dd");
  const weekEndStr = format(addDays(weekStart, 6), "yyyy-MM-dd");
  
  interface TimeClockEntry {
    employeeId: string;
    date: string;
    clockIn: string;
    clockOut: string;
    regularHours: number;
    overtimeHours: number;
    totalHours: number;
  }
  
  const { data: timeClockData, isLoading: timeClockLoading } = useQuery<{ entries: TimeClockEntry[]; error: string | null }>({
    queryKey: ["/api/ukg/timeclock", weekStartStr, weekEndStr],
    queryFn: async () => {
      const res = await fetch(`/api/ukg/timeclock?startDate=${weekStartStr}&endDate=${weekEndStr}`, {
        credentials: "include", // Include auth cookies
      });
      if (!res.ok) {
        return { entries: [], error: "Failed to fetch time clock data" };
      }
      return res.json();
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    retry: 1, // Only retry once
  });

  // PAL (Paid Annual Leave) entries from UKG time clock data
  interface PALEntry {
    id: number;
    ukgEmployeeId: string;
    workDate: string;
    totalHours: number; // In minutes
    hoursDecimal: number; // In hours
    employeeId: number | null;
    employeeName: string;
  }
  
  const { data: palEntries } = useQuery<PALEntry[]>({
    queryKey: ["/api/pal-entries", weekStartStr, weekEndStr],
    queryFn: async () => {
      const res = await fetch(`/api/pal-entries?start=${weekStartStr}&end=${weekEndStr}`, {
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
  
  // Create a lookup map for PAL entries by employee ID and date
  const palByEmpDate = useMemo(() => {
    const map = new Map<string, PALEntry>();
    if (!palEntries) return map;
    
    for (const entry of palEntries) {
      if (entry.employeeId) {
        // Key is "employeeId-date"
        const key = `${entry.employeeId}-${entry.workDate}`;
        map.set(key, entry);
      }
    }
    return map;
  }, [palEntries]);

  // Unpaid Time Off entries from UKG time clock data (paycodeId = 4)
  interface UnpaidTimeOffEntry {
    id: number;
    ukgEmployeeId: string;
    workDate: string;
    totalHours: number; // In minutes
    hoursDecimal: number; // In hours
    employeeId: number | null;
    employeeName: string;
  }
  
  const { data: unpaidTimeOffEntries } = useQuery<UnpaidTimeOffEntry[]>({
    queryKey: ["/api/unpaid-time-off-entries", weekStartStr, weekEndStr],
    queryFn: async () => {
      const res = await fetch(`/api/unpaid-time-off-entries?start=${weekStartStr}&end=${weekEndStr}`, {
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
  
  // Create a lookup map for Unpaid Time Off entries by employee ID and date
  const unpaidByEmpDate = useMemo(() => {
    const map = new Map<string, UnpaidTimeOffEntry>();
    if (!unpaidTimeOffEntries) return map;
    
    for (const entry of unpaidTimeOffEntries) {
      if (entry.employeeId) {
        // Key is "employeeId-date"
        const key = `${entry.employeeId}-${entry.workDate}`;
        map.set(key, entry);
      }
    }
    return map;
  }, [unpaidTimeOffEntries]);

  // Weather forecast data
  interface WeatherForecast {
    date: string;
    highTemp: number;
    lowTemp: number;
    precipitationChance: number;
  }
  
  const { data: weatherData } = useQuery<WeatherForecast[]>({
    queryKey: ["/api/weather/forecast"],
    staleTime: 60 * 60 * 1000, // Cache for 1 hour
  });
  
  // Create a lookup map for weather by date
  const weatherByDate = useMemo(() => {
    const map = new Map<string, WeatherForecast>();
    if (!weatherData) return map;
    for (const forecast of weatherData) {
      map.set(forecast.date, forecast);
    }
    return map;
  }, [weatherData]);

  // Check if current week's schedule is published (for viewer access control)
  const { data: publishStatus, refetch: refetchPublishStatus } = useQuery<{ weekStart: string; isPublished: boolean }>({
    queryKey: ["/api/schedule/published", weekStartStr],
    queryFn: async () => {
      const res = await fetch(`/api/schedule/published/${weekStartStr}`);
      if (!res.ok) throw new Error("Failed to check publish status");
      return res.json();
    },
  });

  const isSchedulePublished = publishStatus?.isPublished ?? false;
  const userRole = authStatus?.user?.role ?? "viewer";
  const canViewSchedule = userRole === "admin" || userRole === "manager" || isSchedulePublished;

  // Create a lookup map for time clock entries by employee UKG ID and date
  const timeClockByEmpDate = useMemo(() => {
    const map = new Map<string, TimeClockEntry>();
    if (!timeClockData?.entries) return map;
    
    for (const entry of timeClockData.entries) {
      // Key is "employeeId-date"
      const key = `${entry.employeeId}-${entry.date}`;
      // Aggregate hours if multiple entries for same day
      const existing = map.get(key);
      if (existing) {
        map.set(key, {
          ...existing,
          regularHours: existing.regularHours + entry.regularHours,
          overtimeHours: existing.overtimeHours + entry.overtimeHours,
          totalHours: existing.totalHours + entry.totalHours,
        });
      } else {
        map.set(key, entry);
      }
    }
    return map;
  }, [timeClockData]);

  const [isGenerating, setIsGenerating] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [draggedShift, setDraggedShift] = useState<Shift | null>(null);
  const [dropTarget, setDropTarget] = useState<{ empId: number; dayKey: string } | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("location") || "all";
  });
  const [isCopyMode, setIsCopyMode] = useState(false);
  
  // Determine if user is admin
  const isAdmin = authStatus?.user?.role === "admin";
  
  // For non-admins, default to their first assigned location
  // Get the user's accessible locations (filter out "Location XX" fallback names)
  const userLocationIds = authStatus?.user?.locationIds || [];
  const userLocations = useMemo(() => {
    if (!locations) return [];
    const isValidLocation = (l: { name: string; isActive: boolean }) => 
      l.isActive && !/^Location \d+$/.test(l.name);
    if (isAdmin) {
      return locations.filter(isValidLocation);
    }
    // Non-admins only see their assigned locations
    return locations.filter(l => 
      isValidLocation(l) && userLocationIds.includes(String(l.id))
    );
  }, [locations, isAdmin, userLocationIds]);
  
  // Set default location for non-admins when data loads
  useEffect(() => {
    if (!isAdmin && userLocations.length > 0 && selectedLocation === "all") {
      setSelectedLocation(userLocations[0].name);
    }
  }, [isAdmin, userLocations, selectedLocation]);
  
  useEffect(() => {
    const weekKey = format(weekStart, "yyyy-MM-dd");
    const params = new URLSearchParams(window.location.search);
    let changed = false;
    if (params.get("week") !== weekKey) {
      params.set("week", weekKey);
      changed = true;
    }
    if (selectedLocation && selectedLocation !== "all" && params.get("location") !== selectedLocation) {
      params.set("location", selectedLocation);
      changed = true;
    } else if (selectedLocation === "all" && params.has("location")) {
      params.delete("location");
      changed = true;
    }
    if (changed) {
      window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    }
  }, [weekStart, selectedLocation]);
  
  const toggleGroupCollapse = (jobTitle: string) => {
    setCollapsedGroups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(jobTitle)) {
        newSet.delete(jobTitle);
      } else {
        newSet.add(jobTitle);
      }
      return newSet;
    });
  };
  
  // Track modifier key for copy mode during drag - use both global listeners and event properties for robustness
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key === "Meta") {
        setIsCopyMode(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key === "Meta") {
        setIsCopyMode(false);
      }
    };
    const handleBlur = () => {
      // Reset copy mode if window loses focus to prevent stuck state
      setIsCopyMode(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  // Handle drag and drop
  const handleDragStart = (e: React.DragEvent, shift: Shift) => {
    e.dataTransfer.setData("text/plain", JSON.stringify(shift));
    e.dataTransfer.effectAllowed = "copyMove";
    setDraggedShift(shift);
  };
  
  const handleDragEnd = () => {
    setDraggedShift(null);
    setDropTarget(null);
    setIsCopyMode(false); // Reset copy mode to prevent stuck state
  };
  
  const handleDragOver = (e: React.DragEvent, empId: number, dayKey: string) => {
    e.preventDefault();
    // Use event properties for robust modifier detection
    const copyMode = e.ctrlKey || e.metaKey;
    e.dataTransfer.dropEffect = copyMode ? "copy" : "move";
    // Sync state with event in case key events were missed
    if (copyMode !== isCopyMode) {
      setIsCopyMode(copyMode);
    }
    setDropTarget({ empId, dayKey });
  };
  
  const handleDragLeave = () => {
    setDropTarget(null);
  };
  
  const handleDrop = async (e: React.DragEvent, targetEmployeeId: number, targetDate: Date) => {
    e.preventDefault();
    if (!draggedShift) return;
    
    const shift = draggedShift;
    // Use event properties for robust detection - more reliable than state
    const shouldCopy = e.ctrlKey || e.metaKey;
    
    // Convert original times to timezone-aware dates to get correct wall-clock times
    const originalStartTZ = toZonedTime(new Date(shift.startTime), TIMEZONE);
    const originalEndTZ = toZonedTime(new Date(shift.endTime), TIMEZONE);
    
    // Calculate shift duration in minutes (handles overnight shifts)
    const durationMinutes = differenceInMinutes(originalEndTZ, originalStartTZ);
    
    // Get wall-clock start time (hours and minutes in local timezone)
    const startHours = originalStartTZ.getHours();
    const startMinutes = originalStartTZ.getMinutes();
    
    // Create new start time on target day with same wall-clock time
    const targetDateInTZ = toZonedTime(targetDate, TIMEZONE);
    const newStart = setMinutes(setHours(targetDateInTZ, startHours), startMinutes);
    
    // Add duration to get correct end time (handles overnight shifts)
    const newEnd = addMinutes(newStart, durationMinutes);
    
    // Convert back to UTC for storage
    const newStartUTC = fromZonedTime(newStart, TIMEZONE);
    const newEndUTC = fromZonedTime(newEnd, TIMEZONE);
    
    // Optimistic update: immediately update the cache
    const previousShifts = queryClient.getQueryData<Shift[]>(["/api/shifts"]);
    
    setDraggedShift(null);
    setDropTarget(null);
    
    if (shouldCopy) {
      // Copy mode: create a new shift
      const tempId = -Date.now(); // Temporary negative ID for optimistic update
      const newShiftOptimistic: Shift = {
        id: tempId,
        employeeId: targetEmployeeId,
        startTime: newStartUTC,
        endTime: newEndUTC,
      };
      
      if (previousShifts) {
        queryClient.setQueryData(["/api/shifts"], [...previousShifts, newShiftOptimistic]);
      }
      
      try {
        await apiRequest("POST", "/api/shifts", {
          employeeId: targetEmployeeId,
          startTime: newStartUTC.toISOString(),
          endTime: newEndUTC.toISOString(),
        });
        queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
        toast({ title: "Shift Copied", description: "Shift has been copied successfully." });
      } catch (error) {
        if (previousShifts) {
          queryClient.setQueryData(["/api/shifts"], previousShifts);
        }
        toast({ variant: "destructive", title: "Error", description: "Failed to copy shift. Changes have been reverted." });
      }
    } else {
      // Move mode: update the existing shift
      if (previousShifts) {
        const optimisticShifts = previousShifts.map(s => 
          s.id === shift.id 
            ? { ...s, employeeId: targetEmployeeId, startTime: newStartUTC, endTime: newEndUTC }
            : s
        );
        queryClient.setQueryData(["/api/shifts"], optimisticShifts);
      }
      
      try {
        await apiRequest("PUT", `/api/shifts/${shift.id}`, {
          employeeId: targetEmployeeId,
          startTime: newStartUTC.toISOString(),
          endTime: newEndUTC.toISOString(),
        });
        queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
        toast({ title: "Shift Moved", description: "Shift has been moved successfully." });
      } catch (error) {
        if (previousShifts) {
          queryClient.setQueryData(["/api/shifts"], previousShifts);
        }
        toast({ variant: "destructive", title: "Error", description: "Failed to move shift. Changes have been reverted." });
      }
    }
  };
  
  // Calculate scheduled hours per location for the current week (including PAL)
  const locationHoursUsed = useMemo(() => {
    const hours: Record<string, number> = {};
    if (!shifts || !employees) return hours;
    
    // Add shift hours
    shifts.forEach(shift => {
      const employee = employees.find(e => e.id === shift.employeeId);
      if (employee?.location) {
        const duration = (new Date(shift.endTime).getTime() - new Date(shift.startTime).getTime()) / (1000 * 60 * 60);
        hours[employee.location] = (hours[employee.location] || 0) + duration;
      }
    });
    
    // Add PAL hours
    if (palEntries) {
      palEntries.forEach(palEntry => {
        const employee = employees.find(e => e.id === palEntry.employeeId);
        if (employee?.location) {
          hours[employee.location] = (hours[employee.location] || 0) + palEntry.hoursDecimal;
        }
      });
    }
    
    return hours;
  }, [shifts, employees, palEntries]);
  
  // Note: userLocations is defined earlier in the component

  const handleAutoGenerate = async () => {
    setIsGenerating(true);
    try {
      await apiRequest("POST", "/api/schedule/generate", { weekStart: weekStart.toISOString() });
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      toast({ title: "Schedule Generated", description: "Successfully generated a week's schedule." });
    } catch (error) {
      toast({ variant: "destructive", title: "Generation Failed", description: "Could not automatically generate schedule." });
    } finally {
      setIsGenerating(false);
    }
  };

  const [isManualGenerating, setIsManualGenerating] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [ganttModalOpen, setGanttModalOpen] = useState(false);
  const [ganttSelectedDate, setGanttSelectedDate] = useState<Date | null>(null);
  const [isCopying, setIsCopying] = useState(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [saveTemplateDialogOpen, setSaveTemplateDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");

  // Fetch schedule templates
  const { data: templates = [] } = useQuery<ScheduleTemplate[]>({
    queryKey: ["/api/schedule-templates"],
  });

  const handleCopyToNextWeek = async () => {
    setIsCopying(true);
    try {
      const response = await apiRequest("POST", "/api/schedule/copy-to-next-week", { weekStart: weekStart.toISOString() });
      const result = await response.json();
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      toast({ title: "Schedule Copied", description: result.message });
    } catch (error: any) {
      const message = error?.message || "Could not copy schedule.";
      toast({ variant: "destructive", title: "Copy Failed", description: message });
    } finally {
      setIsCopying(false);
    }
  };

  const handleExportPDF = async () => {
    if (!shifts || !employees) {
      toast({ variant: "destructive", title: "Export Failed", description: "Schedule data is not loaded yet." });
      return;
    }

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "letter" });
    const pageWidth = doc.internal.pageSize.getWidth();
    
    // Load and register Lato fonts
    try {
      const [latoRegularData, latoBoldData] = await Promise.all([
        fetch(latoRegularUrl).then(r => r.arrayBuffer()),
        fetch(latoBoldUrl).then(r => r.arrayBuffer())
      ]);
      
      // Convert ArrayBuffer to base64
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
      doc.setFont("Lato");
    } catch (e) {
      console.warn("Could not load Lato font, using default");
    }
    
    // Page dimensions and margins
    const margin = 10; // Equal left/right margins
    
    // Add logo with correct aspect ratio (Goodwill logo is approximately 3:1)
    const logoHeight = 10;
    const logoWidth = 30; // 3:1 aspect ratio
    doc.addImage(goodwillLogo, "PNG", margin, 6, logoWidth, logoHeight);
    
    // Title (positioned after logo)
    const locationName = selectedLocation || "All Locations";
    const weekRange = `${format(weekStart, "MMM d")} - ${format(addDays(weekStart, 6), "MMM d, yyyy")}`;
    doc.setFont("Lato", "bold");
    doc.setFontSize(16);
    doc.text(`Weekly Schedule - ${locationName}`, margin + logoWidth + 4, 12);
    doc.setFont("Lato", "normal");
    doc.setFontSize(11);
    doc.text(weekRange, margin + logoWidth + 4, 18);
    
    // Filter employees by location if selected and exclude hidden employees
    const filteredEmployees = employees.filter(emp => {
      if (emp.isHiddenFromSchedule) return false;
      if (!selectedLocation || selectedLocation === "all") return true;
      return emp.location === selectedLocation;
    }).sort((a, b) => {
      const priorityA = getJobPriority(a.jobTitle);
      const priorityB = getJobPriority(b.jobTitle);
      if (priorityA !== priorityB) return priorityA - priorityB;
      return a.name.localeCompare(b.name);
    });
    
    if (filteredEmployees.length === 0) {
      toast({ variant: "destructive", title: "No Employees", description: "No employees found for the selected location." });
      return;
    }
    
    // Build table data
    const dayHeaders = weekDays.map(day => format(day, "EEE M/d"));
    const tableHead = [["Employee", "Role", ...dayHeaders, "Total"]];
    const totalColumnIndex = 2 + dayHeaders.length; // Employee + Role + days
    
    const tableBody = filteredEmployees.map(emp => {
      const empShifts = shifts.filter(s => s.employeeId === emp.id);
      let weeklyHours = 0;
      
      const dayData = weekDays.map(day => {
        const dayShift = empShifts.find(s => isSameDay(new Date(s.startTime), day));
        const dateStr = format(day, "yyyy-MM-dd");
        const palKey = `${emp.id}-${dateStr}`;
        const palEntry = palByEmpDate.get(palKey);
        
        if (dayShift) {
          const start = new Date(dayShift.startTime);
          const end = new Date(dayShift.endTime);
          const hours = calculatePaidHours(start, end);
          weeklyHours += hours;
          const startStr = format(start, "ha").toLowerCase().replace(":00", "");
          const endStr = format(end, "h:mma").toLowerCase();
          return `${startStr}-${endStr}`;
        }
        if (palEntry) {
          weeklyHours += palEntry.hoursDecimal;
          return "PAL";
        }
        return "-";
      });
      
      return [emp.name, getJobTitle(emp.jobTitle), ...dayData, `${weeklyHours.toFixed(1)}h`];
    });
    
    // Generate table with autoTable - use equal margins
    autoTable(doc, {
      head: tableHead,
      body: tableBody,
      startY: 24,
      theme: "grid",
      margin: { left: margin, right: margin },
      styles: { fontSize: 7, cellPadding: 1.5, overflow: "linebreak", font: "Lato" },
      headStyles: { fillColor: [0, 83, 159], textColor: 255, fontStyle: "bold", fontSize: 7, font: "Lato" }, // Brand blue #00539F
      columnStyles: {
        0: { cellWidth: 35 }, // Employee name
        1: { cellWidth: 25 }, // Role
        2: { cellWidth: 25 }, // Sun
        3: { cellWidth: 25 }, // Mon
        4: { cellWidth: 25 }, // Tue
        5: { cellWidth: 25 }, // Wed
        6: { cellWidth: 25 }, // Thu
        7: { cellWidth: 25 }, // Fri
        8: { cellWidth: 25 }, // Sat
        [totalColumnIndex]: { cellWidth: 15, halign: "center" } // Total
      },
      alternateRowStyles: { fillColor: [245, 247, 250] }
    });
    
    // Add summary at bottom - safely get finalY with fallback
    const lastAutoTable = (doc as any).lastAutoTable;
    const finalY = lastAutoTable?.finalY ? lastAutoTable.finalY + 10 : 150;
    
    const totalScheduledHours = shifts.reduce((sum, s) => {
      const emp = employees.find(e => e.id === s.employeeId);
      if (selectedLocation && selectedLocation !== "all" && emp?.location !== selectedLocation) return sum;
      return sum + calculatePaidHours(new Date(s.startTime), new Date(s.endTime));
    }, 0);
    
    doc.setFontSize(10);
    doc.text(`Total Scheduled Hours: ${totalScheduledHours.toFixed(1)}h`, 14, finalY);
    doc.text(`Generated: ${format(new Date(), "MMM d, yyyy h:mm a")}`, pageWidth - 70, finalY);
    
    // Save PDF
    const filename = `schedule_${format(weekStart, "yyyy-MM-dd")}_${locationName.replace(/\s+/g, '_')}.pdf`;
    doc.save(filename);
    toast({ title: "PDF Exported", description: `Schedule saved as ${filename}` });
  };

  const handleSaveTemplate = async () => {
    if (!templateName.trim()) {
      toast({ variant: "destructive", title: "Name Required", description: "Please enter a template name." });
      return;
    }
    setIsSavingTemplate(true);
    try {
      await apiRequest("POST", "/api/schedule-templates", {
        name: templateName,
        description: templateDescription || null,
        weekStart: weekStart.toISOString(),
        createdBy: authStatus?.user?.id || null,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-templates"] });
      toast({ title: "Template Saved", description: `Template "${templateName}" saved successfully.` });
      setSaveTemplateDialogOpen(false);
      setTemplateName("");
      setTemplateDescription("");
    } catch (error: any) {
      toast({ variant: "destructive", title: "Save Failed", description: error?.message || "Could not save template." });
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const handleApplyTemplate = async (templateId: number, templateName: string) => {
    try {
      const response = await apiRequest("POST", `/api/schedule-templates/${templateId}/apply`, { weekStart: weekStart.toISOString() });
      const result = await response.json();
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      toast({ title: "Template Applied", description: `Applied "${templateName}": ${result.message}` });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Apply Failed", description: error?.message || "Could not apply template." });
    }
  };

  const handleDeleteTemplate = async (templateId: number, templateName: string) => {
    try {
      await apiRequest("DELETE", `/api/schedule-templates/${templateId}`);
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-templates"] });
      toast({ title: "Template Deleted", description: `Template "${templateName}" deleted.` });
    } catch (error) {
      toast({ variant: "destructive", title: "Delete Failed", description: "Could not delete template." });
    }
  };

  const [isPublishing, setIsPublishing] = useState(false);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);

  const handlePublishSchedule = async () => {
    setPublishConfirmOpen(false);
    setIsPublishing(true);
    try {
      await apiRequest("POST", "/api/schedule/publish", { weekStart: weekStartStr });
      refetchPublishStatus();
      toast({ title: "Schedule Published", description: "This week's schedule is now visible to all employees. Email notifications are being sent." });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Publish Failed", description: error?.message || "Could not publish schedule." });
    } finally {
      setIsPublishing(false);
    }
  };

  const handleUnpublishSchedule = async () => {
    setIsPublishing(true);
    try {
      await apiRequest("DELETE", `/api/schedule/publish/${weekStartStr}`);
      refetchPublishStatus();
      toast({ title: "Schedule Unpublished", description: "This week's schedule is now hidden from employees." });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Unpublish Failed", description: error?.message || "Could not unpublish schedule." });
    } finally {
      setIsPublishing(false);
    }
  };

  const handleManualGenerate = async () => {
    setIsManualGenerating(true);
    try {
      const payload: { weekStart: string; location?: string } = { weekStart: weekStart.toISOString() };
      if (selectedLocation !== "all") {
        payload.location = selectedLocation;
      }
      await apiRequest("POST", "/api/schedule/generate", payload);
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      playFanfare();
      toast({ 
        title: "Schedule Generated", 
        description: selectedLocation === "all" 
          ? "Standard schedule created based on coverage rules."
          : `Schedule created for ${selectedLocation}.`
      });
    } catch (error) {
      toast({ variant: "destructive", title: "Generation Failed", description: "Could not generate schedule." });
    } finally {
      setIsManualGenerating(false);
    }
  };

  const handleClearSchedule = async () => {
    if (!confirm("Are you sure you want to clear all shifts for this week? This cannot be undone.")) {
      return;
    }
    setIsClearing(true);
    try {
      await apiRequest("POST", "/api/schedule/clear", { weekStart: weekStart.toISOString() });
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      toast({ title: "Schedule Cleared", description: "All shifts for this week have been removed." });
    } catch (error) {
      toast({ variant: "destructive", title: "Clear Failed", description: "Could not clear the schedule." });
    } finally {
      setIsClearing(false);
    }
  };

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedShift, setSelectedShift] = useState<Shift | undefined>(undefined);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedEmpId, setSelectedEmpId] = useState<number | undefined>(undefined);
  
  // Occurrence dialog state
  const [occurrenceDialogOpen, setOccurrenceDialogOpen] = useState(false);
  const [occurrenceEmpId, setOccurrenceEmpId] = useState<number | undefined>(undefined);
  const [occurrenceEmpName, setOccurrenceEmpName] = useState<string>("");
  const [occurrenceDate, setOccurrenceDate] = useState<string>("");
  
  // Shift trade dialog state
  const [tradeDialogOpen, setTradeDialogOpen] = useState(false);
  const [tradeTargetShift, setTradeTargetShift] = useState<Shift | null>(null);
  const [tradeTargetEmployee, setTradeTargetEmployee] = useState<any>(null);
  
  // Find the current user's employee record (for viewers to identify their shifts)
  const currentEmployee = useMemo(() => {
    if (!authStatus?.user?.email || !employees) return null;
    return employees.find(e => e.email.toLowerCase() === authStatus.user!.email.toLowerCase()) || null;
  }, [authStatus, employees]);
  
  // Get the current user's shifts for this week
  const myShifts = useMemo(() => {
    if (!currentEmployee || !shifts) return [];
    return shifts.filter(s => s.employeeId === currentEmployee.id);
  }, [currentEmployee, shifts]);

  const handlePrevWeek = () => setCurrentDate(subWeeks(currentDate, 1));
  const handleNextWeek = () => setCurrentDate(addWeeks(currentDate, 1));

  const handleAddShift = (date: Date, empId?: number) => {
    setSelectedShift(undefined);
    setSelectedDate(date);
    setSelectedEmpId(empId);
    setDialogOpen(true);
  };

  const handleEditShift = (shift: Shift, shiftEmployee?: any) => {
    // Viewers: if clicking someone else's shift, open trade dialog
    if (userRole === "viewer" && currentEmployee && shift.employeeId !== currentEmployee.id && shiftEmployee) {
      // Check job title match
      if (currentEmployee.jobTitle === shiftEmployee.jobTitle) {
        setTradeTargetShift(shift);
        setTradeTargetEmployee(shiftEmployee);
        setTradeDialogOpen(true);
        return;
      }
    }
    setSelectedShift(shift);
    setDialogOpen(true);
  };

  const handleAddOccurrence = (empId: number, empName: string, date: Date) => {
    setOccurrenceEmpId(empId);
    setOccurrenceEmpName(empName);
    setOccurrenceDate(format(date, "yyyy-MM-dd"));
    setOccurrenceDialogOpen(true);
  };

  // Handle remediation from validation issues
  const handleRemediation = async (remediation: RemediationData) => {
    const { day, jobTitle, shiftType } = remediation;
    
    // Find an available employee with the right job title
    const availableEmployees = (employees || []).filter(emp => {
      if (emp.jobTitle !== jobTitle && !isManagerJobCode(emp.jobTitle, jobTitle)) return false;
      if (!emp.isActive) return false;
      if (emp.isHiddenFromSchedule) return false;
      
      // Check if already scheduled that day
      const empShiftsOnDay = (shifts || []).filter(s => 
        s.employeeId === emp.id && isSameDay(new Date(s.startTime), day)
      );
      if (empShiftsOnDay.length > 0) return false;
      
      return true;
    });
    
    if (availableEmployees.length === 0) {
      toast({ 
        variant: "destructive", 
        title: "No Available Employee", 
        description: `No ${jobTitle} employees available for ${format(day, "EEE, MMM d")}`
      });
      return;
    }
    
    // Pick the first available employee
    const employee = availableEmployees[0];
    
    // Use global settings for shift times (with defaults matching the validation)
    const morningStart = settings?.managerMorningStart || "08:00";
    const morningEnd = settings?.managerMorningEnd || "16:30";
    const eveningStart = settings?.managerEveningStart || "12:00";
    const eveningEnd = settings?.managerEveningEnd || "20:30";
    
    // Parse time strings to hours/minutes
    const parseTime = (timeStr: string) => {
      const [hours, minutes] = timeStr.split(":").map(Number);
      return { hours, minutes };
    };
    
    // Determine shift times based on shiftType and settings
    // First convert day to EST timezone, then set hours
    const isSunday = day.getDay() === 0;
    const dayInEST = toZonedTime(day, TIMEZONE);
    let startTime: Date, endTime: Date;
    
    if (shiftType === "opener") {
      const start = parseTime(morningStart);
      const end = parseTime(morningEnd);
      startTime = setMinutes(setHours(dayInEST, start.hours), start.minutes);
      endTime = setMinutes(setHours(dayInEST, end.hours), end.minutes);
    } else if (shiftType === "closer") {
      if (isSunday) {
        // Sunday: 11:00-19:30 (store closes at 7:30pm)
        startTime = setMinutes(setHours(dayInEST, 11), 0);
        endTime = setMinutes(setHours(dayInEST, 19), 30);
      } else {
        const start = parseTime(eveningStart);
        const end = parseTime(eveningEnd);
        startTime = setMinutes(setHours(dayInEST, start.hours), start.minutes);
        endTime = setMinutes(setHours(dayInEST, end.hours), end.minutes);
      }
    } else {
      // mid shift: 10:00-18:30
      startTime = setMinutes(setHours(dayInEST, 10), 0);
      endTime = setMinutes(setHours(dayInEST, 18), 30);
    }
    
    try {
      await apiRequest("POST", "/api/shifts", {
        employeeId: employee.id,
        startTime: fromZonedTime(startTime, TIMEZONE).toISOString(),
        endTime: fromZonedTime(endTime, TIMEZONE).toISOString(),
      });
      
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      
      toast({ 
        title: "Shift Created", 
        description: `Scheduled ${employee.name} as ${shiftType} on ${format(day, "EEE, MMM d")}`
      });
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to create shift" });
    }
  };
  
  // Helper to check if employee job matches for manager roles
  const isManagerJobCode = (empJob: string, targetJob: string): boolean => {
    const managerCodes = ["STSUPER", "STASSTSP", "STLDWKR"];
    if (targetJob === "STSUPER" && managerCodes.includes(empJob)) return true;
    return false;
  };

  if (shiftsLoading || empLoading || locLoading) {
    return <div className="p-8 space-y-4">
      <Skeleton className="h-12 w-64" />
      <div className="grid grid-cols-8 gap-4">
        {Array.from({ length: 16 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded" />
        ))}
      </div>
    </div>;
  }

  return (
    <div className="p-6 lg:p-10 space-y-8 max-w-[1600px] mx-auto">
      <div className="flex flex-col items-center gap-4">
        <div className="flex flex-col md:flex-row items-center gap-4">
          {/* Location dropdown: Admins can switch between all locations, others see their assigned location */}
          {isAdmin ? (
            <Select value={selectedLocation} onValueChange={setSelectedLocation}>
              <SelectTrigger className="w-[200px]" data-testid="select-location-filter">
                <MapPin className="w-4 h-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="All Locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {(locations || [])
                  .filter(l => l.isActive && !/^Location \d+$/.test(l.name))
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map(loc => (
                    <SelectItem key={loc.id} value={loc.name}>{loc.name}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2 border rounded-md bg-muted/30">
              <MapPin className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium" data-testid="text-assigned-location">
                {selectedLocation !== "all" ? selectedLocation : userLocations[0]?.name || "No location assigned"}
              </span>
            </div>
          )}
          <div className="flex items-center gap-2 bg-card border p-1 rounded shadow-sm">
            <Button variant="ghost" size="icon" onClick={handlePrevWeek} data-testid="button-prev-week">
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <div className="px-4 font-medium min-w-[200px] text-center">
              <div className="text-sm font-semibold">Week {getISOWeek(toZonedTime(currentDate, TIMEZONE))}</div>
              <div className="text-xs text-muted-foreground">{formatInTimeZone(weekStart, TIMEZONE, "MMM d")} - {formatInTimeZone(weekEnd, TIMEZONE, "MMM d, yyyy")}</div>
            </div>
            <Button variant="ghost" size="icon" onClick={handleNextWeek} data-testid="button-next-week">
              <ChevronRight className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Actions Bar - managers and admins only */}
      {(userRole === "admin" || userRole === "manager") && (
        <div className="flex items-center justify-center gap-2 flex-wrap" data-testid="actions-bar">
          {/* Publish/Unpublish Button */}
          {isSchedulePublished ? (
            <Button
              variant="outline"
              onClick={handleUnpublishSchedule}
              disabled={isPublishing}
              data-testid="button-unpublish-schedule"
            >
              <EyeOff className="w-4 h-4 mr-2" />
              {isPublishing ? "Unpublishing..." : "Unpublish"}
            </Button>
          ) : (
            <Button
              onClick={() => setPublishConfirmOpen(true)}
              disabled={isPublishing}
              data-testid="button-publish-schedule"
            >
              <Send className="w-4 h-4 mr-2" />
              {isPublishing ? "Publishing..." : "Publish"}
            </Button>
          )}
          
          <Button 
            variant="outline" 
            onClick={handleManualGenerate} 
            disabled={isManualGenerating}
            data-testid="button-generate-schedule"
            className="border-purple-500 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950 animate-[pulse-glow_2s_ease-in-out_infinite] hover:animate-none"
            style={{
              animation: isManualGenerating ? 'none' : 'pulse-glow 2s ease-in-out infinite',
            }}
          >
            <span className="mr-2">✨</span>
            {isManualGenerating ? "Generating..." : "Generate"}
          </Button>
          
          <Button 
            variant="outline" 
            onClick={handleCopyToNextWeek} 
            disabled={isCopying}
            data-testid="button-copy-to-next-week"
          >
            <Copy className={cn("w-4 h-4 mr-2", isCopying && "animate-pulse")} />
            {isCopying ? "Copying..." : "Copy to Next"}
          </Button>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" data-testid="button-templates">
                <FileDown className="w-4 h-4 mr-2" />
                Templates
                <ChevronDown className="w-4 h-4 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem 
                onClick={() => setSaveTemplateDialogOpen(true)}
                data-testid="menuitem-save-template"
              >
                <Save className="w-4 h-4 mr-2" />
                Save Current Week as Template
              </DropdownMenuItem>
              {templates.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                    Apply Template
                  </div>
                  {templates.map((template) => (
                    <DropdownMenuItem
                      key={template.id}
                      onClick={() => handleApplyTemplate(template.id, template.name)}
                      data-testid={`menuitem-apply-template-${template.id}`}
                    >
                      <FileDown className="w-4 h-4 mr-2" />
                      {template.name}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                    Delete Template
                  </div>
                  {templates.map((template) => (
                    <DropdownMenuItem
                      key={`delete-${template.id}`}
                      onClick={() => handleDeleteTemplate(template.id, template.name)}
                      className="text-destructive focus:text-destructive"
                      data-testid={`menuitem-delete-template-${template.id}`}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete "{template.name}"
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          
          <Button 
            variant="outline" 
            onClick={handleExportPDF}
            data-testid="button-export-pdf"
          >
            <Printer className="w-4 h-4 mr-2" />
            Export PDF
          </Button>
          
          <Button 
            variant="outline" 
            onClick={handleClearSchedule} 
            disabled={isClearing}
            className="border-destructive/50 hover:border-destructive text-destructive hover:bg-destructive/10"
            data-testid="button-clear-schedule"
          >
            <Trash2 className={cn("w-4 h-4 mr-2", isClearing && "animate-pulse")} />
            {isClearing ? "Clearing..." : "Clear Week"}
          </Button>
        </div>
      )}

      {/* Show message for viewers when schedule is not published */}
      {!canViewSchedule && (
        <div className="flex flex-col items-center justify-center py-20 px-8 bg-card rounded border">
          <EyeOff className="w-16 h-16 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Schedule Not Available</h2>
          <p className="text-muted-foreground text-center max-w-md">
            The schedule for this week hasn't been published yet. Please check back later or contact your manager.
          </p>
        </div>
      )}

      {canViewSchedule && (
      <div className="flex gap-6">
        {/* Left Sidebar */}
        <div className="w-64 shrink-0 space-y-4" data-testid="left-sidebar">
          {/* Location Hours Panel */}
          {(() => {
            const displayLocations = selectedLocation === "all" 
              ? userLocations 
              : userLocations.filter(l => l.name === selectedLocation);
            
            if (displayLocations.length === 0) return null;
            
            return (
              <Card>
                <CardHeader className="pb-2 px-3 pt-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-primary" />
                    Store Hours
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 px-3 pb-3">
                  {displayLocations.map(location => {
                    const used = locationHoursUsed[location.name] || 0;
                    const limit = location.weeklyHoursLimit;
                    const percentage = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
                    const isOverBudget = used > limit;
                    
                    return (
                      <div key={location.id} className="space-y-1" data-testid={`location-hours-${location.id}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium truncate">{location.name}</span>
                          <div className="flex items-center gap-1">
                            <span className={cn(
                              "text-xs font-mono",
                              isOverBudget ? "text-destructive font-bold" : "text-muted-foreground"
                            )}>
                              {used.toFixed(1)} / {limit}
                            </span>
                            {isOverBudget && (
                              <Badge variant="destructive" className="text-[10px] px-1 py-0">
                                Over
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Progress 
                          value={percentage} 
                          className={cn(
                            "h-1.5",
                            isOverBudget && "[&>[data-state=complete]]:bg-destructive [&>div]:bg-destructive"
                          )}
                        />
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })()}
          
          {/* Schedule Validator */}
          <ScheduleValidator weekStart={weekStart} onRemediate={handleRemediation} selectedLocation={selectedLocation} />
          
        </div>
        
        {/* Main Content Area */}
        <div className="flex-1">
        {/* Main Schedule Grid */}
        <div className="bg-card rounded border shadow-sm overflow-hidden relative">
          {/* Generation Loading Overlay - positioned at top */}
          {isManualGenerating && (
            <div className="absolute top-0 left-0 right-0 bg-primary/95 backdrop-blur-sm z-50 flex items-center justify-center gap-4 py-4 px-6 shadow-lg" data-testid="overlay-generating">
              <div className="relative">
                <div className="w-8 h-8 border-3 border-primary-foreground/30 rounded-full"></div>
                <div className="absolute inset-0 w-8 h-8 border-3 border-primary-foreground border-t-transparent rounded-full animate-spin"></div>
              </div>
              <div className="text-center">
                <p className="text-base font-semibold text-primary-foreground">
                  Generating Schedule...
                </p>
                <p className="text-xs text-primary-foreground/80">
                  Creating schedule based on coverage rules and employee constraints...
                </p>
              </div>
            </div>
          )}
          
          <div className="overflow-x-auto">
            <div className="min-w-[800px]">
              {/* Header Row */}
              <div className="grid border-b bg-muted/30" style={{ gridTemplateColumns: "200px repeat(7, 120px) 80px" }}>
                <div className="p-4 border-r font-medium text-muted-foreground sticky left-0 bg-muted/30 backdrop-blur z-10">
                  Employee
                </div>
                {weekDays.map(day => {
                  const todayEST = toZonedTime(new Date(), TIMEZONE);
                  const dayEST = toZonedTime(day, TIMEZONE);
                  const isToday = isSameDay(todayEST, dayEST);
                  // Calculate daily paid hours (subtract lunch for 6+ hour shifts)
                  // Compare using formatted date strings to avoid timezone issues
                  const dayDateStr = formatInTimeZone(day, TIMEZONE, "yyyy-MM-dd");
                  const dayHours = shifts?.reduce((sum, shift) => {
                    const shiftDateStr = formatInTimeZone(shift.startTime, TIMEZONE, "yyyy-MM-dd");
                    if (shiftDateStr !== dayDateStr) return sum;
                    if (selectedLocation !== "all") {
                      const emp = employees?.find(e => e.id === shift.employeeId);
                      if (emp?.location !== selectedLocation) return sum;
                    }
                    const startTime = new Date(shift.startTime);
                    const endTime = new Date(shift.endTime);
                    return sum + calculatePaidHours(startTime, endTime);
                  }, 0) || 0;
                  
                  // Calculate estimated production for pricers (APPROC and DONPRI)
                  const dayShifts = shifts?.filter(s => {
                    const shiftDateStr = formatInTimeZone(s.startTime, TIMEZONE, "yyyy-MM-dd");
                    if (shiftDateStr !== dayDateStr) return false;
                    if (selectedLocation !== "all") {
                      const emp = employees?.find(e => e.id === s.employeeId);
                      if (emp?.location !== selectedLocation) return false;
                    }
                    return true;
                  }) || [];
                  
                  // Get apparel pricer production (APPROC, APWV for WV)
                  const apparelPricerShifts = dayShifts.filter(s => {
                    const emp = employees?.find(e => e.id === s.employeeId);
                    return emp?.jobTitle === 'APPROC' || emp?.jobTitle === 'APWV';
                  });
                  const apparelEffectiveHours = apparelPricerShifts.reduce((sum, shift) => {
                    return sum + calculateEffectiveHours(new Date(shift.startTime), new Date(shift.endTime));
                  }, 0);
                  const apparelProduction = Math.round(apparelEffectiveHours * PIECES_PER_EFFECTIVE_HOUR);
                  
                  // Get donation pricer production (DONPRI, DONPRWV for WV)
                  const donationPricerShifts = dayShifts.filter(s => {
                    const emp = employees?.find(e => e.id === s.employeeId);
                    return emp?.jobTitle === 'DONPRI' || emp?.jobTitle === 'DONPRWV';
                  });
                  const donationEffectiveHours = donationPricerShifts.reduce((sum, shift) => {
                    return sum + calculateEffectiveHours(new Date(shift.startTime), new Date(shift.endTime));
                  }, 0);
                  const donationProduction = Math.round(donationEffectiveHours * PIECES_PER_EFFECTIVE_HOUR);
                  
                  // Get weather for this day
                  const dateKey = formatInTimeZone(day, TIMEZONE, "yyyy-MM-dd");
                  const weather = weatherByDate.get(dateKey);
                  
                  // Check if this day is a holiday
                  const holidayName = isHoliday(dayEST);
                  
                  return (
                    <div 
                      key={day.toString()} 
                      className={cn(
                        "p-2 text-center border-r cursor-pointer hover-elevate transition-colors",
                        holidayName && "bg-destructive/10"
                      )}
                      onClick={() => {
                        setGanttSelectedDate(day);
                        setGanttModalOpen(true);
                      }}
                      data-testid={`day-header-${formatInTimeZone(day, TIMEZONE, "EEE")}`}
                      title="Click to view daily coverage"
                    >
                      <div className="text-sm font-semibold text-foreground">{formatInTimeZone(day, TIMEZONE, "EEE")}</div>
                      <div className={cn(
                        "text-xs w-7 h-7 flex items-center justify-center rounded-full mx-auto",
                        isToday ? "bg-primary text-primary-foreground font-bold" : "text-muted-foreground"
                      )}>
                        {formatInTimeZone(day, TIMEZONE, "d")}
                      </div>
                      {/* Holiday indicator */}
                      {holidayName && (
                        <div className="mt-1 text-[10px] font-semibold text-destructive" data-testid={`holiday-${formatInTimeZone(day, TIMEZONE, "EEE")}`}>
                          CLOSED - {holidayName}
                        </div>
                      )}
                      {/* Weather forecast */}
                      {weather && (
                        <div className="mt-1 flex flex-col items-center gap-0.5" data-testid={`weather-${formatInTimeZone(day, TIMEZONE, "EEE")}`}>
                          <div className="flex items-center gap-1 text-[10px]" title="High / Low Temperature">
                            <Thermometer className="w-3 h-3 text-orange-500" />
                            <span className="text-orange-600 dark:text-orange-400">{weather.highTemp}°</span>
                            <span className="text-muted-foreground">/</span>
                            <span className="text-blue-600 dark:text-blue-400">{weather.lowTemp}°</span>
                          </div>
                          {weather.precipitationChance > 0 && (
                            <div className="flex items-center gap-0.5 text-[10px] text-sky-600 dark:text-sky-400" title="Precipitation Chance">
                              <Droplets className="w-3 h-3" />
                              <span>{weather.precipitationChance}%</span>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="text-xs font-medium text-muted-foreground mt-1" data-testid={`text-daily-hours-${formatInTimeZone(day, TIMEZONE, "EEE")}`}>
                        {dayHours.toFixed(1)}h
                      </div>
                      {/* Estimated Production */}
                      {(apparelProduction > 0 || donationProduction > 0) && (
                        <div className="mt-1 space-y-0.5 text-[10px]" data-testid={`production-${formatInTimeZone(day, TIMEZONE, "EEE")}`}>
                          {apparelProduction > 0 && (
                            <div className="text-lime-600 dark:text-lime-400" title="Apparel Pricer Production">
                              Apparel: {apparelProduction.toLocaleString()}
                            </div>
                          )}
                          {donationProduction > 0 && (
                            <div className="text-orange-600 dark:text-orange-400" title="Donation Pricer Production">
                              Wares: {donationProduction.toLocaleString()}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="p-3 text-center font-medium text-muted-foreground" data-testid="header-hours">
                  Hours
                </div>
              </div>

              {/* Grouped Employee Rows - sorted by job priority */}
              {Object.entries(
                (employees || [])
                  .filter(emp => !emp.isHiddenFromSchedule && (selectedLocation === "all" || emp.location === selectedLocation))
                  .reduce((acc, emp) => {
                    if (!acc[emp.jobTitle]) acc[emp.jobTitle] = [];
                    acc[emp.jobTitle].push(emp);
                    return acc;
                  }, {} as Record<string, NonNullable<typeof employees>>)
              )
              .sort(([a], [b]) => getJobPriority(a) - getJobPriority(b))
              .map(([jobTitle, groupEmployees]) => {
                const isCollapsed = collapsedGroups.has(jobTitle);
                const groupShifts = shifts?.filter(s => 
                  groupEmployees.some(e => e.id === s.employeeId)
                ) || [];
                const groupTotalHours = groupShifts.reduce((sum, shift) => {
                  const startTime = new Date(shift.startTime);
                  const endTime = new Date(shift.endTime);
                  return sum + calculatePaidHours(startTime, endTime);
                }, 0);
                
                const groupDailyHours = weekDays.map(day => {
                  const dayEST = toZonedTime(day, TIMEZONE);
                  let dayTotal = 0;
                  for (const shift of groupShifts) {
                    const shiftStartEST = toZonedTime(shift.startTime, TIMEZONE);
                    if (isSameDay(shiftStartEST, dayEST)) {
                      dayTotal += calculatePaidHours(new Date(shift.startTime), new Date(shift.endTime));
                    }
                  }
                  for (const emp of groupEmployees) {
                    const dateStr = format(day, "yyyy-MM-dd");
                    const palKey = `${emp.id}-${dateStr}`;
                    const palEntry = palByEmpDate.get(palKey);
                    if (palEntry) {
                      dayTotal += palEntry.hoursDecimal;
                    }
                  }
                  return dayTotal;
                });
                
                return (
                  <div key={jobTitle} className="border-b last:border-b-0">
                    <div className="bg-muted/20 border-b">
                      <button
                        onClick={() => toggleGroupCollapse(jobTitle)}
                        className="w-full px-4 py-2 font-bold text-xs uppercase tracking-wider text-muted-foreground flex items-center justify-between gap-2 hover:bg-muted/30 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50"
                        data-testid={`button-toggle-group-${jobTitle}`}
                      >
                        <div className="flex items-center gap-2">
                          {isCollapsed ? <ChevronRightIcon className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          <span>{getJobTitle(jobTitle)}</span>
                          <Badge variant="secondary" className="ml-2">{groupEmployees.length}</Badge>
                        </div>
                        {groupTotalHours > 0 && (
                          <Badge variant="outline">{groupTotalHours.toFixed(1)} hrs</Badge>
                        )}
                      </button>
                      <div className="grid" style={{ gridTemplateColumns: "200px repeat(7, 120px) 80px" }}>
                        <div />
                        {groupDailyHours.map((dayHrs, i) => (
                          <div 
                            key={i} 
                            className="px-2 pb-1.5 text-center text-[10px] font-semibold text-muted-foreground"
                            data-testid={`group-daily-hours-${jobTitle}-${i}`}
                          >
                            {dayHrs > 0 ? `${dayHrs.toFixed(1)}h` : ""}
                          </div>
                        ))}
                        <div />
                      </div>
                    </div>
                    
                    {!isCollapsed && (groupEmployees || []).map(emp => {
                      // Calculate total paid hours for this employee (subtract lunch for 6+ hour shifts)
                      const empShifts = shifts?.filter(s => s.employeeId === emp.id) || [];
                      const shiftHours = empShifts.reduce((sum, shift) => {
                        const startTime = new Date(shift.startTime);
                        const endTime = new Date(shift.endTime);
                        return sum + calculatePaidHours(startTime, endTime);
                      }, 0);
                      
                      // Add PAL hours for this employee (check each day in the week)
                      let palHoursForEmp = 0;
                      weekDays.forEach(day => {
                        const dateStr = format(day, "yyyy-MM-dd");
                        const palKey = `${emp.id}-${dateStr}`;
                        const palEntry = palByEmpDate.get(palKey);
                        if (palEntry) {
                          palHoursForEmp += palEntry.hoursDecimal;
                        }
                      });
                      
                      const totalHours = shiftHours + palHoursForEmp;
                      const isFT = (emp.maxWeeklyHours || 40) >= 32;
                      const isMaxed = totalHours >= (emp.maxWeeklyHours || 40);
                      
                      return (
                      <div key={emp.id} className="grid border-b last:border-b-0 hover:bg-muted/10 transition-colors group" style={{ gridTemplateColumns: "200px repeat(7, 120px) 80px" }}>
                        <div className="p-3 border-r sticky left-0 bg-card group-hover:bg-muted/10 z-10 flex items-center gap-3">
                          <div 
                            className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-sm flex-shrink-0"
                            style={{ backgroundColor: getJobColor(emp.jobTitle) }}
                          >
                            {emp.name.substring(0, 2).toUpperCase()}
                          </div>
                          <div className="overflow-hidden min-w-0">
                            <p 
                              className="font-semibold truncate text-sm cursor-pointer hover:text-primary hover:underline transition-colors"
                              data-testid={`link-employee-${emp.id}`}
                              onClick={() => setLocation(`/employees?search=${encodeURIComponent(emp.name)}`)}
                            >{emp.name}</p>
                            <span className="text-xs text-muted-foreground" data-testid={`text-max-hours-${emp.id}`}>
                              {emp.maxWeeklyHours || 40}h max, {isFT ? "FT" : "PT"}
                            </span>
                          </div>
                        </div>
                        
                        {weekDays.map(day => {
                          const dayEST = toZonedTime(day, TIMEZONE);
                          const dayKey = day.toISOString();
                          const dayShifts = shifts?.filter(s => {
                            const shiftStartEST = toZonedTime(s.startTime, TIMEZONE);
                            return s.employeeId === emp.id && isSameDay(shiftStartEST, dayEST);
                          });
                          
                          const isDropTarget = dropTarget?.empId === emp.id && dropTarget?.dayKey === dayKey;

                          return (
                            <div 
                              key={dayKey} 
                              className={cn(
                                "p-2 border-r h-[100px] relative transition-colors",
                                isDropTarget && "bg-primary/10 ring-2 ring-primary/30 ring-inset"
                              )}
                              onDragOver={(e) => handleDragOver(e, emp.id, dayKey)}
                              onDragLeave={handleDragLeave}
                              onDrop={(e) => handleDrop(e, emp.id, day)}
                            >
                              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="w-full h-full pointer-events-auto rounded-none opacity-0 hover:opacity-10 hover:bg-black"
                                  onClick={() => handleAddShift(day, emp.id)}
                                />
                              </div>

                              <div className="space-y-1 relative z-10">
                                {dayShifts?.map(shift => {
                                  // Look up actual hours worked from time clock data
                                  const shiftDate = formatInTimeZone(shift.startTime, TIMEZONE, "yyyy-MM-dd");
                                  const ukgId = emp.ukgEmployeeId;
                                  const timeClockKey = ukgId ? `${ukgId}-${shiftDate}` : null;
                                  const actualHours = timeClockKey ? timeClockByEmpDate.get(timeClockKey) : null;
                                  
                                  return (
                                    <ContextMenu key={shift.id}>
                                      <ContextMenuTrigger>
                                        <div 
                                          draggable
                                          onDragStart={(e) => handleDragStart(e, shift)}
                                          onDragEnd={handleDragEnd}
                                          onClick={(e) => { e.stopPropagation(); handleEditShift(shift, emp); }}
                                          className={`p-1.5 rounded text-[10px] font-medium border border-transparent hover:border-black/10 hover:shadow-md transition-all text-white flex items-center gap-1 ${
                                            userRole === "viewer" && currentEmployee && shift.employeeId !== currentEmployee.id && currentEmployee.jobTitle === emp.jobTitle
                                              ? "cursor-pointer ring-1 ring-white/30 hover:ring-white/60"
                                              : "cursor-grab active:cursor-grabbing"
                                          }`}
                                          style={{ backgroundColor: getJobColor(emp.jobTitle) }}
                                          data-testid={`shift-${shift.id}`}
                                        >
                                          {isCopyMode && draggedShift?.id === shift.id ? (
                                            <Copy className="w-3 h-3 flex-shrink-0" />
                                          ) : (
                                            <GripVertical className="w-3 h-3 opacity-50 flex-shrink-0" />
                                          )}
                                          <div className="flex flex-col leading-tight">
                                            <span>{formatInTimeZone(shift.startTime, TIMEZONE, "h:mma")}</span>
                                            <span>{formatInTimeZone(shift.endTime, TIMEZONE, "h:mma")}</span>
                                            {actualHours && (
                                              <span className="text-[9px] opacity-80 mt-0.5 border-t border-white/30 pt-0.5">
                                                Worked: {actualHours.totalHours.toFixed(1)}h
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      </ContextMenuTrigger>
                                      <ContextMenuContent>
                                        <ContextMenuItem 
                                          onClick={() => handleEditShift(shift, emp)}
                                          data-testid={`context-edit-shift-${shift.id}`}
                                        >
                                          Edit Shift
                                        </ContextMenuItem>
                                        {(userRole === 'admin' || userRole === 'manager') && (
                                          <ContextMenuItem 
                                            onClick={() => handleAddOccurrence(emp.id, emp.name, day)}
                                            className="text-orange-600"
                                            data-testid={`context-add-occurrence-${shift.id}`}
                                          >
                                            <AlertTriangle className="w-4 h-4 mr-2" />
                                            Add Occurrence
                                          </ContextMenuItem>
                                        )}
                                      </ContextMenuContent>
                                    </ContextMenu>
                                  );
                                })}
                                
                                {/* PAL (Paid Annual Leave) block - shows when employee has PAL on this day */}
                                {(() => {
                                  const dateStr = format(day, "yyyy-MM-dd");
                                  const palKey = `${emp.id}-${dateStr}`;
                                  const palEntry = palByEmpDate.get(palKey);
                                  
                                  if (palEntry) {
                                    return (
                                      <div 
                                        className="p-1.5 rounded text-[10px] font-bold text-white flex items-center justify-center"
                                        style={{ backgroundColor: "#000000" }}
                                        data-testid={`pal-${emp.id}-${dateStr}`}
                                      >
                                        <div className="flex flex-col leading-tight items-center">
                                          <span>PAL</span>
                                          <span className="text-[9px] opacity-80">{palEntry.hoursDecimal.toFixed(1)}h</span>
                                        </div>
                                      </div>
                                    );
                                  }
                                  return null;
                                })()}
                                
                                {/* Unpaid Time Off block - shows when employee has unpaid time off on this day */}
                                {(() => {
                                  const dateStr = format(day, "yyyy-MM-dd");
                                  const unpaidKey = `${emp.id}-${dateStr}`;
                                  const unpaidEntry = unpaidByEmpDate.get(unpaidKey);
                                  
                                  if (unpaidEntry) {
                                    return (
                                      <div 
                                        className="p-1.5 rounded text-[10px] font-bold text-white flex items-center justify-center"
                                        style={{ backgroundColor: "#6b7280" }}
                                        data-testid={`unpaid-${emp.id}-${dateStr}`}
                                      >
                                        <div className="flex flex-col leading-tight items-center">
                                          <span>UTO</span>
                                          <span className="text-[9px] opacity-80">{unpaidEntry.hoursDecimal.toFixed(1)}h</span>
                                        </div>
                                      </div>
                                    );
                                  }
                                  return null;
                                })()}
                              </div>
                            </div>
                          );
                        })}
                        
                        {/* Total Hours Column */}
                        <div 
                          className={cn(
                            "p-3 flex items-center justify-center font-semibold text-sm",
                            isMaxed ? "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30" : "text-muted-foreground"
                          )}
                          data-testid={`cell-total-hours-${emp.id}`}
                        >
                          {totalHours.toFixed(1)}
                        </div>
                      </div>
                    );})}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

      </div>
      </div>
      )}

      <ShiftDialog 
        isOpen={dialogOpen} 
        onClose={() => setDialogOpen(false)} 
        shift={selectedShift}
        defaultDate={selectedDate}
        defaultEmployeeId={selectedEmpId}
      />

      {occurrenceEmpId && (
        <OccurrenceDialog
          isOpen={occurrenceDialogOpen}
          onClose={() => setOccurrenceDialogOpen(false)}
          employeeId={occurrenceEmpId}
          employeeName={occurrenceEmpName}
          occurrenceDate={occurrenceDate}
        />
      )}

      {ganttSelectedDate && (
        <DailyGanttModal
          open={ganttModalOpen}
          onClose={() => {
            setGanttModalOpen(false);
            setGanttSelectedDate(null);
          }}
          selectedDate={ganttSelectedDate}
          shifts={shifts || []}
          employees={employees || []}
          selectedLocation={selectedLocation}
        />
      )}

      <ShiftTradeDialog
        open={tradeDialogOpen}
        onOpenChange={setTradeDialogOpen}
        targetShift={tradeTargetShift}
        targetEmployee={tradeTargetEmployee}
        currentEmployee={currentEmployee}
        myShifts={myShifts}
        weekStart={weekStart}
        weekEnd={weekEnd}
      />

      <Dialog open={publishConfirmOpen} onOpenChange={setPublishConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish Schedule</DialogTitle>
            <DialogDescription>
              This will notify ALL scheduled employees that a new schedule has been posted. Are you sure you want to publish?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishConfirmOpen(false)} data-testid="button-cancel-publish">
              Cancel
            </Button>
            <Button onClick={handlePublishSchedule} data-testid="button-confirm-publish">
              Yes, Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={saveTemplateDialogOpen} onOpenChange={setSaveTemplateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Schedule as Template</DialogTitle>
            <DialogDescription>
              Save this week's schedule as a reusable template that can be applied to future weeks.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="template-name">Template Name</Label>
              <Input
                id="template-name"
                placeholder="e.g., Standard Week, Holiday Week"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                data-testid="input-template-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="template-description">Description (optional)</Label>
              <Input
                id="template-description"
                placeholder="Brief description of this template"
                value={templateDescription}
                onChange={(e) => setTemplateDescription(e.target.value)}
                data-testid="input-template-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveTemplateDialogOpen(false)} data-testid="button-cancel-template">
              Cancel
            </Button>
            <Button onClick={handleSaveTemplate} disabled={isSavingTemplate} data-testid="button-save-template">
              {isSavingTemplate ? "Saving..." : "Save Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
