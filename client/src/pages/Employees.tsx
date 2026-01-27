import { useEmployees, useCreateEmployee, useUpdateEmployee, useDeleteEmployee } from "@/hooks/use-employees";
import { useRoleRequirements } from "@/hooks/use-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { Plus, Search, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import type { Employee, InsertEmployee, RoleRequirement } from "@shared/schema";

export default function Employees() {
  const { data: employees, isLoading } = useEmployees();
  const { data: roles } = useRoleRequirements();
  const [search, setSearch] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);

  const filteredEmployees = employees?.filter(e => 
    e.name.toLowerCase().includes(search.toLowerCase()) || 
    e.jobTitle.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 lg:p-10 space-y-8 max-w-[1600px] mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-display">Employees</h1>
          <p className="text-muted-foreground mt-1">Manage your team members and roles.</p>
        </div>
        <Button onClick={() => { setEditingEmployee(null); setIsDialogOpen(true); }} className="bg-primary shadow-lg shadow-primary/25 hover:shadow-xl hover:-translate-y-0.5 transition-all">
          <Plus className="w-4 h-4 mr-2" />
          Add Employee
        </Button>
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
          <div className="hidden sm:grid sm:grid-cols-[1fr_1fr_120px_100px_100px_60px] gap-4 px-6 py-3 bg-muted/50 border-b text-sm font-medium text-muted-foreground">
            <div>Name</div>
            <div>Email</div>
            <div>Job Title</div>
            <div>Max Hours</div>
            <div>Status</div>
            <div></div>
          </div>
          <div className="divide-y">
            {filteredEmployees?.map(employee => (
              <EmployeeRow 
                key={employee.id} 
                employee={employee} 
                roles={roles || []}
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

function EmployeeRow({ employee, roles, onEdit }: { employee: Employee; roles: RoleRequirement[]; onEdit: () => void }) {
  const deleteEmployee = useDeleteEmployee();
  const { toast } = useToast();

  const handleDelete = async () => {
    if (confirm("Are you sure? This will delete all shifts for this employee.")) {
      await deleteEmployee.mutateAsync(employee.id);
      toast({ title: "Employee deleted" });
    }
  };

  const roleColor = roles.find(r => r.jobTitle.toLowerCase() === employee.jobTitle.toLowerCase())?.color || employee.color;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_120px_100px_100px_60px] gap-2 sm:gap-4 px-6 py-4 items-center hover-elevate" data-testid={`row-employee-${employee.id}`}>
      <div className="flex items-center gap-3">
        <div 
          className="w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold text-white flex-shrink-0" 
          style={{ backgroundColor: roleColor }}
        >
          {employee.name.substring(0, 2).toUpperCase()}
        </div>
        <span className="font-medium truncate">{employee.name}</span>
      </div>
      <div className="text-sm text-muted-foreground truncate">{employee.email}</div>
      <div className="text-sm truncate">{employee.jobTitle}</div>
      <div className="text-sm">{employee.maxWeeklyHours}h</div>
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

  const [formData, setFormData] = useState<Partial<InsertEmployee>>({
    name: "",
    email: "",
    jobTitle: "",
    maxWeeklyHours: 40,
    color: "#3b82f6",
    isActive: true
  });

  // Reset form when dialog opens/closes or employee changes
  useState(() => {
    if (employee) {
      setFormData(employee);
    } else {
      setFormData({
        name: "",
        email: "",
        jobTitle: "",
        maxWeeklyHours: 40,
        color: "#3b82f6",
        isActive: true
      });
    }
  });

  // Need useEffect to update state when prop changes
  if (open && employee && formData.id !== employee.id) {
     setFormData(employee);
  }
  if (open && !employee && formData.id) {
    setFormData({
      name: "",
      email: "",
      jobTitle: "",
      maxWeeklyHours: 40,
      color: "#3b82f6",
      isActive: true
    });
  }

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
              <Input 
                value={formData.color} 
                onChange={e => setFormData({...formData, color: e.target.value})} 
                className="flex-1"
              />
            </div>
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
