import { useEmployees, useCreateEmployee, useUpdateEmployee, useDeleteEmployee, useToggleScheduleVisibility } from "@/hooks/use-employees";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useState, useEffect } from "react";
import { Search, MoreHorizontal, Pencil, Trash2, MapPin, CalendarOff, EyeOff, Eye } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { getJobTitle } from "@/lib/utils";
import type { Employee, InsertEmployee } from "@shared/schema";

export default function Employees() {
  const { data: employees, isLoading } = useEmployees();
  const [search, setSearch] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);

  const filteredEmployees = employees?.filter(e => 
    e.name.toLowerCase().includes(search.toLowerCase()) || 
    e.jobTitle.toLowerCase().includes(search.toLowerCase()) ||
    (e.location && e.location.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="p-6 lg:p-10 space-y-8 max-w-[1600px] mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-display">Employees</h1>
          <p className="text-muted-foreground mt-1">Employees are imported automatically from UKG.</p>
        </div>
      </div>

      <div className="flex items-center gap-4 bg-card p-2 rounded border shadow-sm max-w-md">
        <Search className="w-5 h-5 text-muted-foreground ml-2" />
        <Input 
          placeholder="Search by name or title..." 
          className="border-0 shadow-none focus-visible:ring-0 bg-transparent"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="bg-card rounded border shadow-sm">
          {[1,2,3,4].map(i => <div key={i} className="h-16 bg-muted/20 animate-pulse border-b last:border-b-0" />)}
        </div>
      ) : (
        <div className="bg-card rounded border shadow-sm overflow-hidden">
          <div className="hidden sm:grid sm:grid-cols-[minmax(180px,2fr)_120px_120px_80px_80px_80px_60px] gap-4 px-6 py-3 bg-muted/50 border-b text-sm font-medium text-muted-foreground">
            <div>Name</div>
            <div>Job Title</div>
            <div>Location</div>
            <div>Hours</div>
            <div>Days/Wk</div>
            <div>Status</div>
            <div></div>
          </div>
          <div className="divide-y">
            {filteredEmployees?.map(employee => (
              <EmployeeRow 
                key={employee.id} 
                employee={employee} 
                onEdit={() => { setEditingEmployee(employee); setIsDialogOpen(true); }}
              />
            ))}
          </div>
          {filteredEmployees?.length === 0 && (
            <div className="px-6 py-12 text-center text-muted-foreground">
              No employees found
            </div>
          )}
        </div>
      )}

      <EmployeeDialog 
        open={isDialogOpen} 
        onOpenChange={setIsDialogOpen} 
        employee={editingEmployee}
      />
    </div>
  );
}

function EmployeeRow({ employee, onEdit }: { employee: Employee; onEdit: () => void }) {
  const deleteEmployee = useDeleteEmployee();
  const updateEmployee = useUpdateEmployee();
  const toggleScheduleVisibility = useToggleScheduleVisibility();
  const { toast } = useToast();
  const isPartTime = (employee.maxWeeklyHours || 40) < 32;

  const handleDelete = async () => {
    if (confirm("Are you sure? This will delete all shifts for this employee.")) {
      await deleteEmployee.mutateAsync(employee.id);
      toast({ title: "Employee deleted" });
    }
  };

  const handleDaysChange = async (value: string) => {
    try {
      await updateEmployee.mutateAsync({ id: employee.id, preferredDaysPerWeek: parseInt(value) });
      toast({ title: "Updated", description: "Preferred days updated." });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to update." });
    }
  };

  const handleToggleScheduleVisibility = async () => {
    try {
      await toggleScheduleVisibility.mutateAsync({ 
        id: employee.id, 
        isHiddenFromSchedule: !employee.isHiddenFromSchedule 
      });
      toast({ 
        title: employee.isHiddenFromSchedule ? "Now visible on schedule" : "Hidden from schedule",
        description: employee.isHiddenFromSchedule 
          ? `${employee.name} will appear on the schedule.`
          : `${employee.name} will not appear on the schedule or in AI scheduling.`
      });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to update visibility." });
    }
  };

  return (
    <div className={`grid grid-cols-1 sm:grid-cols-[minmax(180px,2fr)_120px_120px_80px_80px_80px_60px] gap-2 sm:gap-4 px-6 py-4 items-center hover-elevate ${employee.isHiddenFromSchedule ? 'opacity-60' : ''}`} data-testid={`row-employee-${employee.id}`}>
      <div className="flex items-center gap-3 min-w-0">
        <div 
          className="w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold text-white flex-shrink-0 relative" 
          style={{ backgroundColor: employee.color }}
        >
          {employee.name.substring(0, 2).toUpperCase()}
          {employee.isHiddenFromSchedule && (
            <div className="absolute -top-1 -right-1 w-4 h-4 bg-muted-foreground rounded-full flex items-center justify-center">
              <EyeOff className="w-2.5 h-2.5 text-background" />
            </div>
          )}
        </div>
        <div className="flex flex-col min-w-0">
          <span className="font-medium">{employee.name}</span>
          {employee.isHiddenFromSchedule && (
            <span className="text-xs text-muted-foreground">Hidden from schedule</span>
          )}
        </div>
      </div>
      <div className="text-sm truncate">{getJobTitle(employee.jobTitle)}</div>
      <div className="text-sm text-muted-foreground truncate flex items-center gap-1">
        {employee.location ? (
          <>
            <MapPin className="w-3 h-3 flex-shrink-0" />
            {employee.location}
          </>
        ) : (
          <span className="text-muted-foreground/50">-</span>
        )}
      </div>
      <div className="text-sm flex items-center gap-1">
        {employee.maxWeeklyHours}h
        {employee.nonWorkingDays && employee.nonWorkingDays.length > 0 && (
          <span className="text-muted-foreground" title={`Off: ${employee.nonWorkingDays.join(', ')}`}>
            <CalendarOff className="w-3 h-3" />
          </span>
        )}
      </div>
      <div className="text-sm">
        {isPartTime ? (
          <Select 
            value={String(employee.preferredDaysPerWeek || 5)} 
            onValueChange={handleDaysChange}
          >
            <SelectTrigger className="h-7 w-16 text-xs" data-testid={`select-days-${employee.id}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="4">4</SelectItem>
              <SelectItem value="5">5</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </div>
      <div>
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${employee.isActive ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400'}`}>
          {employee.isActive ? "Active" : "Inactive"}
        </span>
      </div>
      <div className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground" data-testid={`button-employee-menu-${employee.id}`}>
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit} data-testid={`button-edit-employee-${employee.id}`}>
              <Pencil className="w-4 h-4 mr-2" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleToggleScheduleVisibility} data-testid={`button-toggle-schedule-visibility-${employee.id}`}>
              {employee.isHiddenFromSchedule ? (
                <><Eye className="w-4 h-4 mr-2" /> Show on Schedule</>
              ) : (
                <><EyeOff className="w-4 h-4 mr-2" /> Hide from Schedule</>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={handleDelete} data-testid={`button-delete-employee-${employee.id}`}>
              <Trash2 className="w-4 h-4 mr-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function EmployeeDialog({ open, onOpenChange, employee }: { open: boolean; onOpenChange: (v: boolean) => void; employee: Employee | null }) {
  const createEmployee = useCreateEmployee();
  const updateEmployee = useUpdateEmployee();
  const { toast } = useToast();

  const [formData, setFormData] = useState<Partial<InsertEmployee> & { id?: number }>({
    name: "",
    email: "",
    jobTitle: "",
    maxWeeklyHours: 40,
    color: "#3b82f6",
    isActive: true,
    preferredDaysPerWeek: 5,
    nonWorkingDays: []
  });

  const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // Update state when dialog opens or employee changes
  useEffect(() => {
    if (open) {
      if (employee) {
        setFormData({
          ...employee,
          nonWorkingDays: employee.nonWorkingDays || []
        });
      } else {
        setFormData({
          name: "",
          email: "",
          jobTitle: "",
          maxWeeklyHours: 40,
          color: "#3b82f6",
          isActive: true,
          preferredDaysPerWeek: 5,
          nonWorkingDays: []
        });
      }
    }
  }, [open, employee]);

  const toggleDay = (day: string) => {
    const currentDays = formData.nonWorkingDays || [];
    if (currentDays.includes(day)) {
      setFormData({...formData, nonWorkingDays: currentDays.filter(d => d !== day)});
    } else {
      setFormData({...formData, nonWorkingDays: [...currentDays, day]});
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (employee) {
        await updateEmployee.mutateAsync({ id: employee.id, ...formData });
        toast({ title: "Updated", description: "Employee details updated." });
      } else {
        await createEmployee.mutateAsync(formData as InsertEmployee);
        toast({ title: "Created", description: "New employee added." });
      }
      onOpenChange(false);
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: "Operation failed." });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{employee ? "Edit Employee" : "New Employee"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label>Full Name</Label>
            <Input 
              required 
              value={formData.name} 
              onChange={e => setFormData({...formData, name: e.target.value})} 
            />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input 
              type="email" 
              required 
              value={formData.email} 
              onChange={e => setFormData({...formData, email: e.target.value})} 
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Job Title</Label>
              <Input 
                required 
                value={formData.jobTitle} 
                onChange={e => setFormData({...formData, jobTitle: e.target.value})} 
              />
            </div>
            <div className="space-y-2">
              <Label>Max Hours/Week</Label>
              <Input 
                type="number" 
                required 
                value={formData.maxWeeklyHours} 
                onChange={e => setFormData({...formData, maxWeeklyHours: parseInt(e.target.value)})} 
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Color Tag</Label>
            <div className="flex gap-2">
              <Input 
                type="color" 
                value={formData.color} 
                onChange={e => setFormData({...formData, color: e.target.value})} 
                className="w-12 h-10 p-1"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <CalendarOff className="w-4 h-4" />
              Days Off (Not Available to Work)
            </Label>
            <div className="grid grid-cols-4 gap-2">
              {DAYS_OF_WEEK.map(day => (
                <label 
                  key={day} 
                  className="flex items-center gap-2 cursor-pointer p-2 rounded-md border bg-muted/30 has-[:checked]:bg-primary/10 has-[:checked]:border-primary/50"
                  data-testid={`checkbox-day-${day.toLowerCase()}`}
                >
                  <Checkbox 
                    checked={(formData.nonWorkingDays || []).includes(day)}
                    onCheckedChange={() => toggleDay(day)}
                  />
                  <span className="text-sm">{day.slice(0, 3)}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Scheduler will not assign shifts on these days.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit">{employee ? "Save Changes" : "Create Employee"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
