import { useState } from "react";
import { format, startOfWeek, addDays, isSameDay, addWeeks, subWeeks, getISOWeek } from "date-fns";
import { ChevronLeft, ChevronRight, Plus, UserCircle, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useShifts } from "@/hooks/use-shifts";
import { useEmployees } from "@/hooks/use-employees";
import { ShiftDialog } from "@/components/ShiftDialog";
import { ScheduleValidator } from "@/components/ScheduleValidator";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Shift } from "@shared/routes";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function Schedule() {
  const { toast } = useToast();
  const [currentDate, setCurrentDate] = useState(new Date());
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i));

  const { data: shifts, isLoading: shiftsLoading } = useShifts(
    weekStart.toISOString(),
    addDays(weekStart, 6).toISOString()
  );
  
  const { data: employees, isLoading: empLoading } = useEmployees();

  const [isGenerating, setIsGenerating] = useState(false);

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

  if (shiftsLoading || empLoading) {
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
            Week {getISOWeek(currentDate)} • {format(weekStart, "MMM d")} - {format(addDays(weekStart, 6), "MMM d, yyyy")}
          </p>
        </div>
        
        <div className="flex items-center gap-2 bg-card border p-1 rounded-lg shadow-sm">
          <Button variant="ghost" size="icon" onClick={handlePrevWeek}>
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <div className="px-4 font-medium min-w-[120px] text-center">
            {format(currentDate, "MMMM yyyy")}
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
                {weekDays.map(day => (
                  <div key={day.toString()} className="p-3 text-center border-r last:border-r-0">
                    <div className="text-sm font-semibold text-foreground">{format(day, "EEE")}</div>
                    <div className={cn(
                      "text-xs mt-1 w-8 h-8 flex items-center justify-center rounded-full mx-auto",
                      isSameDay(day, new Date()) ? "bg-primary text-primary-foreground font-bold" : "text-muted-foreground"
                    )}>
                      {format(day, "d")}
                    </div>
                  </div>
                ))}
              </div>

              {/* Grouped Employee Rows */}
              {Object.entries(
                (employees || []).reduce((acc, emp) => {
                  if (!acc[emp.jobTitle]) acc[emp.jobTitle] = [];
                  acc[emp.jobTitle].push(emp);
                  return acc;
                }, {} as Record<string, typeof employees>)
              ).map(([jobTitle, groupEmployees]) => (
                <div key={jobTitle} className="border-b last:border-b-0">
                  <div className="bg-muted/10 px-4 py-2 font-bold text-xs uppercase tracking-wider text-muted-foreground border-b">
                    {jobTitle}s
                  </div>
                  {groupEmployees.map(emp => (
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
                        const dayShifts = shifts?.filter(s => 
                          s.employeeId === emp.id && isSameDay(s.startTime, day)
                        );

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
                                    <span>{format(shift.startTime, "HH:mm")}</span>
                                    <span className="opacity-70">-</span>
                                    <span>{format(shift.endTime, "HH:mm")}</span>
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
