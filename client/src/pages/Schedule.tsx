import { useState, useMemo, useEffect } from "react";
import { format, addDays, isSameDay, addWeeks, subWeeks, getISOWeek, startOfWeek as startOfWeekDate, setHours, setMinutes, differenceInMinutes, addMinutes } from "date-fns";
import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";
import { ChevronLeft, ChevronRight, Plus, MapPin, ChevronDown, ChevronRight as ChevronRightIcon, GripVertical, Sparkles, Trash2, CalendarClock } from "lucide-react";
import goodwillLogo from "@/assets/goodwill-logo.png";
import { cn } from "@/lib/utils";
import { useShifts } from "@/hooks/use-shifts";
import { useEmployees } from "@/hooks/use-employees";
import { useLocations } from "@/hooks/use-locations";
import { useGlobalSettings, useUpdateGlobalSettings } from "@/hooks/use-settings";
import { ShiftDialog } from "@/components/ShiftDialog";
import { ScheduleValidator } from "@/components/ScheduleValidator";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Shift } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";

interface AuthStatus {
  isAuthenticated: boolean;
  user: { id: number; name: string; email: string; role: string; locationIds: string[] | null } | null;
  ssoConfigured: boolean;
}

const TIMEZONE = "America/New_York";

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
  return JOB_COLORS[jobTitle] ?? "#6B7280"; // Default gray
}

function getJobPriority(jobTitle: string): number {
  return JOB_PRIORITY[jobTitle] ?? 99;
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
  const [currentDate, setCurrentDate] = useState(new Date());
  
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
  const [selectedLocation, setSelectedLocation] = useState<string>("all");
  
  // Determine if user is admin
  const isAdmin = authStatus?.user?.role === "admin";
  
  // For non-admins, default to their first assigned location
  // Get the user's accessible locations
  const userLocationIds = authStatus?.user?.locationIds || [];
  const userLocations = useMemo(() => {
    if (!locations) return [];
    if (isAdmin) {
      return locations.filter(l => l.isActive);
    }
    // Non-admins only see their assigned locations
    return locations.filter(l => 
      l.isActive && userLocationIds.includes(String(l.id))
    );
  }, [locations, isAdmin, userLocationIds]);
  
  // Set default location for non-admins when data loads
  useEffect(() => {
    if (!isAdmin && userLocations.length > 0 && selectedLocation === "all") {
      // Default to first assigned location for non-admins
      setSelectedLocation(userLocations[0].name);
    }
  }, [isAdmin, userLocations, selectedLocation]);
  
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
  
  // Handle drag and drop
  const handleDragStart = (e: React.DragEvent, shift: Shift) => {
    e.dataTransfer.setData("text/plain", JSON.stringify(shift));
    e.dataTransfer.effectAllowed = "move";
    setDraggedShift(shift);
  };
  
  const handleDragEnd = () => {
    setDraggedShift(null);
    setDropTarget(null);
  };
  
  const handleDragOver = (e: React.DragEvent, empId: number, dayKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget({ empId, dayKey });
  };
  
  const handleDragLeave = () => {
    setDropTarget(null);
  };
  
  const handleDrop = async (e: React.DragEvent, targetEmployeeId: number, targetDate: Date) => {
    e.preventDefault();
    if (!draggedShift) return;
    
    const shift = draggedShift;
    
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
    
    try {
      await apiRequest("PUT", `/api/shifts/${shift.id}`, {
        employeeId: targetEmployeeId,
        startTime: newStartUTC.toISOString(),
        endTime: newEndUTC.toISOString(),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      toast({ title: "Shift Moved", description: "Shift has been moved successfully." });
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to move shift." });
    }
    
    setDraggedShift(null);
    setDropTarget(null);
  };
  
  // Calculate scheduled hours per location for the current week
  const locationHoursUsed = useMemo(() => {
    const hours: Record<string, number> = {};
    if (!shifts || !employees) return hours;
    
    shifts.forEach(shift => {
      const employee = employees.find(e => e.id === shift.employeeId);
      if (employee?.location) {
        const duration = (new Date(shift.endTime).getTime() - new Date(shift.startTime).getTime()) / (1000 * 60 * 60);
        hours[employee.location] = (hours[employee.location] || 0) + duration;
      }
    });
    
    return hours;
  }, [shifts, employees]);
  
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

  const [isAIGenerating, setIsAIGenerating] = useState(false);
  const [isManualGenerating, setIsManualGenerating] = useState(false);
  const [aiReasoning, setAIReasoning] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);

  const handleManualGenerate = async () => {
    setIsManualGenerating(true);
    try {
      const payload: { weekStart: string; location?: string } = { weekStart: weekStart.toISOString() };
      if (selectedLocation !== "all") {
        payload.location = selectedLocation;
      }
      await apiRequest("POST", "/api/schedule/generate", payload);
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
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

  const handleAIGenerate = async () => {
    setIsAIGenerating(true);
    setAIReasoning(null);
    try {
      const response = await apiRequest("POST", "/api/schedule/generate-ai", { weekStart: weekStart.toISOString() });
      const result = await response.json();
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      setAIReasoning(result.reasoning);
      toast({ 
        title: "AI Schedule Generated", 
        description: result.warnings?.length > 0 
          ? `Generated with ${result.warnings.length} warning(s)` 
          : "AI optimized schedule created successfully."
      });
    } catch (error) {
      toast({ variant: "destructive", title: "AI Generation Failed", description: "Could not generate AI schedule. Try the standard scheduler." });
    } finally {
      setIsAIGenerating(false);
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

  const handlePrevWeek = () => setCurrentDate(subWeeks(currentDate, 1));
  const handleNextWeek = () => setCurrentDate(addWeeks(currentDate, 1));

  const handleAddShift = (date: Date, empId?: number) => {
    setSelectedShift(undefined);
    setSelectedDate(date);
    setSelectedEmpId(empId);
    setDialogOpen(true);
  };

  const handleEditShift = (shift: Shift) => {
    setSelectedShift(shift);
    setDialogOpen(true);
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
      <div className="flex flex-col items-center mb-6">
        <img src={goodwillLogo} alt="Goodwill" className="h-16 w-auto" data-testid="img-goodwill-logo" />
        <h2 className="text-2xl font-bold text-foreground mt-2" style={{ fontFamily: "'Lato', sans-serif" }} data-testid="text-goodshift-title">GoodShift</h2>
      </div>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground" style={{ fontFamily: "'Lato', sans-serif" }}>Weekly Schedule</h1>
            <p className="text-muted-foreground mt-1">
              Week {getISOWeek(toZonedTime(currentDate, TIMEZONE))} • {formatInTimeZone(weekStart, TIMEZONE, "MMM d")} - {formatInTimeZone(weekEnd, TIMEZONE, "MMM d, yyyy")}
            </p>
          </div>
          {/* Location dropdown: Admins can switch between all locations, others see their assigned location */}
          {isAdmin ? (
            <Select value={selectedLocation} onValueChange={setSelectedLocation}>
              <SelectTrigger className="w-[200px]" data-testid="select-location-filter">
                <MapPin className="w-4 h-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="All Locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {(locations || []).filter(l => l.isActive).map(loc => (
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
        </div>
        
        <div className="flex items-center gap-2 bg-card border p-1 rounded shadow-sm">
          <Button variant="ghost" size="icon" onClick={handlePrevWeek}>
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <div className="px-4 font-medium min-w-[120px] text-center">
            {formatInTimeZone(currentDate, TIMEZONE, "MMMM yyyy")}
          </div>
          <Button variant="ghost" size="icon" onClick={handleNextWeek}>
            <ChevronRight className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex gap-3">
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
          <Button 
            variant="outline" 
            onClick={handleManualGenerate} 
            disabled={isManualGenerating || isAIGenerating}
            className="border-primary/50 hover:border-primary"
            data-testid="button-generate-schedule"
          >
            <CalendarClock className={cn("w-4 h-4 mr-2", isManualGenerating && "animate-spin")} />
            {isManualGenerating ? "Generating..." : "Generate Schedule"}
          </Button>
          {/* AI Generate button hidden - infrastructure kept for future use */}
          <Button onClick={() => handleAddShift(new Date())} className="bg-primary shadow-lg shadow-primary/25 hover:shadow-xl hover:-translate-y-0.5 transition-all" data-testid="button-add-shift">
            <Plus className="w-4 h-4 mr-2" />
            Add Shift
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
        {/* Main Schedule Grid */}
        <div className="xl:col-span-3 bg-card rounded border shadow-sm overflow-hidden relative">
          {/* Generation Loading Overlay - positioned at top */}
          {(isAIGenerating || isManualGenerating) && (
            <div className="absolute top-0 left-0 right-0 bg-primary/95 backdrop-blur-sm z-50 flex items-center justify-center gap-4 py-4 px-6 shadow-lg" data-testid="overlay-generating">
              <div className="relative">
                <div className="w-8 h-8 border-3 border-primary-foreground/30 rounded-full"></div>
                <div className="absolute inset-0 w-8 h-8 border-3 border-primary-foreground border-t-transparent rounded-full animate-spin"></div>
              </div>
              <div className="text-center">
                <p className="text-base font-semibold text-primary-foreground">
                  {isAIGenerating ? "AI Generating Schedule..." : "Generating Schedule..."}
                </p>
                <p className="text-xs text-primary-foreground/80">
                  {isAIGenerating 
                    ? "AI is analyzing employee availability, coverage requirements, and labor allocation..." 
                    : "Creating schedule based on coverage rules and employee constraints..."}
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
                    if (shiftDateStr === dayDateStr) {
                      const startTime = new Date(shift.startTime);
                      const endTime = new Date(shift.endTime);
                      return sum + calculatePaidHours(startTime, endTime);
                    }
                    return sum;
                  }, 0) || 0;
                  
                  // Calculate estimated production for pricers (APPROC and DONPRI)
                  const dayShifts = shifts?.filter(s => {
                    const shiftDateStr = formatInTimeZone(s.startTime, TIMEZONE, "yyyy-MM-dd");
                    return shiftDateStr === dayDateStr;
                  }) || [];
                  
                  // Get apparel pricer production (APPROC)
                  const apparelPricerShifts = dayShifts.filter(s => {
                    const emp = employees?.find(e => e.id === s.employeeId);
                    return emp?.jobTitle === 'APPROC';
                  });
                  const apparelEffectiveHours = apparelPricerShifts.reduce((sum, shift) => {
                    return sum + calculateEffectiveHours(new Date(shift.startTime), new Date(shift.endTime));
                  }, 0);
                  const apparelProduction = Math.round(apparelEffectiveHours * PIECES_PER_EFFECTIVE_HOUR);
                  
                  // Get donation pricer production (DONPRI)
                  const donationPricerShifts = dayShifts.filter(s => {
                    const emp = employees?.find(e => e.id === s.employeeId);
                    return emp?.jobTitle === 'DONPRI';
                  });
                  const donationEffectiveHours = donationPricerShifts.reduce((sum, shift) => {
                    return sum + calculateEffectiveHours(new Date(shift.startTime), new Date(shift.endTime));
                  }, 0);
                  const donationProduction = Math.round(donationEffectiveHours * PIECES_PER_EFFECTIVE_HOUR);
                  
                  return (
                    <div key={day.toString()} className="p-2 text-center border-r">
                      <div className="text-sm font-semibold text-foreground">{formatInTimeZone(day, TIMEZONE, "EEE")}</div>
                      <div className={cn(
                        "text-xs w-7 h-7 flex items-center justify-center rounded-full mx-auto",
                        isToday ? "bg-primary text-primary-foreground font-bold" : "text-muted-foreground"
                      )}>
                        {formatInTimeZone(day, TIMEZONE, "d")}
                      </div>
                      <div className="text-xs font-medium text-muted-foreground mt-1" data-testid={`text-daily-hours-${formatInTimeZone(day, TIMEZONE, "EEE")}`}>
                        {dayHours.toFixed(1)}h
                      </div>
                      {/* Estimated Production */}
                      {(apparelProduction > 0 || donationProduction > 0) && (
                        <div className="mt-1 space-y-0.5 text-[10px]" data-testid={`production-${formatInTimeZone(day, TIMEZONE, "EEE")}`}>
                          {apparelProduction > 0 && (
                            <div className="text-lime-600 dark:text-lime-400" title="Apparel Pricer Production">
                              AP: {apparelProduction.toLocaleString()}
                            </div>
                          )}
                          {donationProduction > 0 && (
                            <div className="text-orange-600 dark:text-orange-400" title="Donation Pricer Production">
                              DP: {donationProduction.toLocaleString()}
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
                  .filter(emp => selectedLocation === "all" || emp.location === selectedLocation)
                  .reduce((acc, emp) => {
                    if (!acc[emp.jobTitle]) acc[emp.jobTitle] = [];
                    acc[emp.jobTitle].push(emp);
                    return acc;
                  }, {} as Record<string, NonNullable<typeof employees>>)
              )
              .sort(([a], [b]) => getJobPriority(a) - getJobPriority(b))
              .map(([jobTitle, groupEmployees]) => {
                const isCollapsed = collapsedGroups.has(jobTitle);
                const groupShiftCount = shifts?.filter(s => 
                  groupEmployees.some(e => e.id === s.employeeId)
                ).length || 0;
                
                return (
                  <div key={jobTitle} className="border-b last:border-b-0">
                    <button
                      onClick={() => toggleGroupCollapse(jobTitle)}
                      className="w-full bg-muted/20 px-4 py-2 font-bold text-xs uppercase tracking-wider text-muted-foreground border-b flex items-center justify-between gap-2 hover:bg-muted/30 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50"
                      data-testid={`button-toggle-group-${jobTitle}`}
                    >
                      <div className="flex items-center gap-2">
                        {isCollapsed ? <ChevronRightIcon className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        <span>{jobTitle}</span>
                        <Badge variant="secondary" className="ml-2">{groupEmployees.length}</Badge>
                      </div>
                      {groupShiftCount > 0 && (
                        <Badge variant="outline">{groupShiftCount} shifts</Badge>
                      )}
                    </button>
                    
                    {!isCollapsed && (groupEmployees || []).map(emp => {
                      // Calculate total paid hours for this employee (subtract lunch for 6+ hour shifts)
                      const empShifts = shifts?.filter(s => s.employeeId === emp.id) || [];
                      const totalHours = empShifts.reduce((sum, shift) => {
                        const startTime = new Date(shift.startTime);
                        const endTime = new Date(shift.endTime);
                        return sum + calculatePaidHours(startTime, endTime);
                      }, 0);
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
                            <p className="font-semibold truncate text-sm">{emp.name}</p>
                            <div className="flex items-center gap-2">
                              <Badge variant={isFT ? "default" : "secondary"} className="text-[10px] px-1 py-0" data-testid={`badge-status-${emp.id}`}>
                                {isFT ? "FT" : "PT"}
                              </Badge>
                              <span className="text-xs text-muted-foreground" data-testid={`text-max-hours-${emp.id}`}>{emp.maxWeeklyHours || 40}h max</span>
                            </div>
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
                                    <div 
                                      key={shift.id}
                                      draggable
                                      onDragStart={(e) => handleDragStart(e, shift)}
                                      onDragEnd={handleDragEnd}
                                      onClick={(e) => { e.stopPropagation(); handleEditShift(shift); }}
                                      className="cursor-grab active:cursor-grabbing p-1.5 rounded text-[10px] font-medium border border-transparent hover:border-black/10 hover:shadow-md transition-all text-white flex items-center gap-1"
                                      style={{ backgroundColor: getJobColor(emp.jobTitle) }}
                                      data-testid={`shift-${shift.id}`}
                                    >
                                      <GripVertical className="w-3 h-3 opacity-50 flex-shrink-0" />
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
                                  );
                                })}
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

        {/* Sidebar */}
        <div className="space-y-6">
          <ScheduleValidator />
          
          {/* AI Reasoning Display */}
          {aiReasoning && (
            <Card className="border-accent/30 bg-accent/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-accent" />
                  AI Schedule Reasoning
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{aiReasoning}</p>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="mt-2 text-xs"
                  onClick={() => setAIReasoning(null)}
                  data-testid="button-dismiss-reasoning"
                >
                  Dismiss
                </Button>
              </CardContent>
            </Card>
          )}
          
          {/* Staffing Requirements Panel */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Staffing Requirements</CardTitle>
              <CardDescription>Configure daily shift coverage needs</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="openers" className="text-sm">
                  Openers Required <span className="text-muted-foreground">(8:00am - 4:30pm)</span>
                </Label>
                <Input
                  id="openers"
                  type="number"
                  min="0"
                  value={settings?.openersRequired ?? 2}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    if (settings) {
                      updateSettings.mutate({ ...settings, openersRequired: val });
                    }
                  }}
                  className="w-full"
                  data-testid="input-openers-required"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="closers" className="text-sm">
                  Closers Required <span className="text-muted-foreground">(12:00pm - 8:30pm)</span>
                </Label>
                <Input
                  id="closers"
                  type="number"
                  min="0"
                  value={settings?.closersRequired ?? 2}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    if (settings) {
                      updateSettings.mutate({ ...settings, closersRequired: val });
                    }
                  }}
                  className="w-full"
                  data-testid="input-closers-required"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="managers" className="text-sm">
                  Managers Required <span className="text-muted-foreground">(per shift)</span>
                </Label>
                <Input
                  id="managers"
                  type="number"
                  min="0"
                  value={settings?.managersRequired ?? 1}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    if (settings) {
                      updateSettings.mutate({ ...settings, managersRequired: val });
                    }
                  }}
                  className="w-full"
                  data-testid="input-managers-required"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Changes are saved automatically.
              </p>
            </CardContent>
          </Card>
          
          {/* Location Hours Panel - shows only selected location or user's locations */}
          {(() => {
            // Filter locations based on selection
            const displayLocations = selectedLocation === "all" 
              ? userLocations 
              : userLocations.filter(l => l.name === selectedLocation);
            
            if (displayLocations.length === 0) return null;
            
            return (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <MapPin className="w-5 h-5 text-primary" />
                    Store Hours Budget
                  </CardTitle>
                  <CardDescription>
                    {selectedLocation === "all" ? "Weekly hours by location" : `Weekly hours for ${selectedLocation}`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {displayLocations.map(location => {
                    const used = locationHoursUsed[location.name] || 0;
                    const limit = location.weeklyHoursLimit;
                    const percentage = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
                    const isOverBudget = used > limit;
                    
                    return (
                      <div key={location.id} className="space-y-2" data-testid={`location-hours-${location.id}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium truncate">{location.name}</span>
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              "text-sm font-mono",
                              isOverBudget ? "text-destructive font-bold" : "text-muted-foreground"
                            )}>
                              {used.toFixed(1)} / {limit}
                            </span>
                            {isOverBudget && (
                              <Badge variant="destructive" className="text-xs">
                                Over
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Progress 
                          value={percentage} 
                          className={cn(
                            "h-2",
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
          
          <div className="bg-card rounded border p-6 shadow-sm">
            <h3 className="font-bold text-lg mb-4">Quick Stats</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-sm">Total Shifts</span>
                <span className="font-mono font-bold">{shifts?.length || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-sm">Active Employees</span>
                <span className="font-mono font-bold">{employees?.length || 0}</span>
              </div>
              <div className="h-px bg-border my-2" />
              <div className="text-xs text-muted-foreground leading-relaxed">
                Changes are automatically saved. Warnings will appear above if constraints are violated.
              </div>
            </div>
          </div>
        </div>
      </div>

      <ShiftDialog 
        isOpen={dialogOpen} 
        onClose={() => setDialogOpen(false)} 
        shift={selectedShift}
        defaultDate={selectedDate}
        defaultEmployeeId={selectedEmpId}
      />
    </div>
  );
}
