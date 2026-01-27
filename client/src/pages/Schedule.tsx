import { useState, useMemo } from "react";
import { format, addDays, isSameDay, addWeeks, subWeeks, getISOWeek, startOfWeek as startOfWeekDate } from "date-fns";
import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";
import { ChevronLeft, ChevronRight, Plus, UserCircle, Wand2, MapPin, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useShifts } from "@/hooks/use-shifts";
import { useEmployees } from "@/hooks/use-employees";
import { useLocations } from "@/hooks/use-locations";
import { ShiftDialog } from "@/components/ShiftDialog";
import { ScheduleValidator } from "@/components/ScheduleValidator";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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

// Compute start of week in EST timezone
function getESTWeekStart(date: Date): Date {
  const zonedDate = toZonedTime(date, TIMEZONE);
  const weekStartZoned = startOfWeekDate(zonedDate, { weekStartsOn: 1 });
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

  const [isGenerating, setIsGenerating] = useState(false);
  
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
  
  // Get user's assigned locations (managers see only their locations, admins see all)
  const userLocations = useMemo(() => {
    if (!locations) return [];
    const user = authStatus?.user;
    if (!user) return [];
    
    if (user.role === "admin") {
      return locations.filter(l => l.isActive);
    }
    
    if (user.locationIds && user.locationIds.length > 0) {
      // locationIds contains location IDs as strings, compare with location.id
      return locations.filter(l => l.isActive && user.locationIds!.includes(String(l.id)));
    }
    
    return [];
  }, [locations, authStatus]);

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
          <Skeleton key={i} className="h-32 w-full rounded-xl" />
        ))}
      </div>
    </div>;
  }

  return (
    <div className="p-6 lg:p-10 space-y-8 max-w-[1600px] mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Weekly Schedule</h1>
          <p className="text-muted-foreground mt-1">
            Week {getISOWeek(toZonedTime(currentDate, TIMEZONE))} • {formatInTimeZone(weekStart, TIMEZONE, "MMM d")} - {formatInTimeZone(weekEnd, TIMEZONE, "MMM d, yyyy")}
          </p>
        </div>
        
        <div className="flex items-center gap-2 bg-card border p-1 rounded-lg shadow-sm">
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
            onClick={handleAutoGenerate} 
            disabled={isGenerating}
            className="border-primary/20 hover:border-primary/50"
          >
            <Wand2 className={cn("w-4 h-4 mr-2", isGenerating && "animate-spin")} />
            {isGenerating ? "Generating..." : "Auto-Generate"}
          </Button>
          <Button onClick={() => handleAddShift(new Date())} className="bg-primary shadow-lg shadow-primary/25 hover:shadow-xl hover:-translate-y-0.5 transition-all">
            <Plus className="w-4 h-4 mr-2" />
            Add Shift
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
        {/* Main Schedule Grid */}
        <div className="xl:col-span-3 bg-card rounded-2xl border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-[800px]">
              {/* Header Row */}
              <div className="grid grid-cols-8 border-b bg-muted/30">
                <div className="p-4 border-r font-medium text-muted-foreground sticky left-0 bg-muted/30 backdrop-blur z-10">
                  Employee
                </div>
                {weekDays.map(day => {
                  const todayEST = toZonedTime(new Date(), TIMEZONE);
                  const dayEST = toZonedTime(day, TIMEZONE);
                  const isToday = isSameDay(todayEST, dayEST);
                  return (
                    <div key={day.toString()} className="p-3 text-center border-r last:border-r-0">
                      <div className="text-sm font-semibold text-foreground">{formatInTimeZone(day, TIMEZONE, "EEE")}</div>
                      <div className={cn(
                        "text-xs mt-1 w-8 h-8 flex items-center justify-center rounded-full mx-auto",
                        isToday ? "bg-primary text-primary-foreground font-bold" : "text-muted-foreground"
                      )}>
                        {formatInTimeZone(day, TIMEZONE, "d")}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Grouped Employee Rows */}
              {Object.entries(
                (employees || []).reduce((acc, emp) => {
                  if (!acc[emp.jobTitle]) acc[emp.jobTitle] = [];
                  acc[emp.jobTitle].push(emp);
                  return acc;
                }, {} as Record<string, NonNullable<typeof employees>>)
              ).map(([jobTitle, groupEmployees]) => (
                <div key={jobTitle} className="border-b last:border-b-0">
                  <div className="bg-muted/10 px-4 py-2 font-bold text-xs uppercase tracking-wider text-muted-foreground border-b">
                    {jobTitle}s
                  </div>
                  {(groupEmployees || []).map(emp => (
                    <div key={emp.id} className="grid grid-cols-8 border-b last:border-b-0 hover:bg-muted/10 transition-colors group">
                      <div className="p-4 border-r sticky left-0 bg-card group-hover:bg-muted/10 z-10 flex items-center gap-3">
                        <div 
                          className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-sm"
                          style={{ backgroundColor: emp.color }}
                        >
                          {emp.name.substring(0, 2).toUpperCase()}
                        </div>
                        <div className="overflow-hidden">
                          <p className="font-semibold truncate text-sm">{emp.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{emp.jobTitle}</p>
                        </div>
                      </div>
                      
                      {weekDays.map(day => {
                        // Compare dates in EST timezone
                        const dayEST = toZonedTime(day, TIMEZONE);
                        const dayShifts = shifts?.filter(s => {
                          const shiftStartEST = toZonedTime(s.startTime, TIMEZONE);
                          return s.employeeId === emp.id && isSameDay(shiftStartEST, dayEST);
                        });

                        return (
                          <div key={day.toString()} className="p-2 border-r last:border-r-0 min-h-[100px] relative">
                            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                className="w-full h-full pointer-events-auto rounded-none opacity-0 hover:opacity-10 hover:bg-black"
                                onClick={() => handleAddShift(day, emp.id)}
                              />
                            </div>

                            <div className="space-y-2 relative z-10 pointer-events-none">
                              {dayShifts?.map(shift => (
                                <div 
                                  key={shift.id}
                                  onClick={(e) => { e.stopPropagation(); handleEditShift(shift); }}
                                  className="pointer-events-auto cursor-pointer p-2 rounded-lg text-xs font-medium border border-transparent hover:border-black/10 hover:shadow-sm transition-all text-white"
                                  style={{ backgroundColor: emp.color }}
                                >
                                  <div className="flex justify-between items-center">
                                    <span>{formatInTimeZone(shift.startTime, TIMEZONE, "HH:mm")}</span>
                                    <span className="opacity-70">-</span>
                                    <span>{formatInTimeZone(shift.endTime, TIMEZONE, "HH:mm")}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <ScheduleValidator />
          
          {/* Location Hours Panel */}
          {userLocations.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-primary" />
                  Store Hours Budget
                </CardTitle>
                <CardDescription>Weekly hours by location</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {userLocations.map(location => {
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
                
                {userLocations.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-2">
                    No locations assigned
                  </p>
                )}
              </CardContent>
            </Card>
          )}
          
          <div className="bg-card rounded-2xl border p-6 shadow-sm">
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
