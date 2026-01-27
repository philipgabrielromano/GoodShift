import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useCreateShift, useUpdateShift, useDeleteShift } from "@/hooks/use-shifts";
import { useEmployees } from "@/hooks/use-employees";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { format, parseISO } from "date-fns";
import { type Shift } from "@shared/routes";
import { Trash2, Loader2 } from "lucide-react";

interface ShiftDialogProps {
  isOpen: boolean;
  onClose: () => void;
  shift?: Shift; // If provided, we're editing
  defaultDate?: Date; // If creating new, default start date
  defaultEmployeeId?: number;
}

export function ShiftDialog({ isOpen, onClose, shift, defaultDate, defaultEmployeeId }: ShiftDialogProps) {
  const { data: employees } = useEmployees();
  const createShift = useCreateShift();
  const updateShift = useUpdateShift();
  const deleteShift = useDeleteShift();
  const { toast } = useToast();

  const [employeeId, setEmployeeId] = useState<string>("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [date, setDate] = useState("");

  useEffect(() => {
    if (isOpen) {
      if (shift) {
        setEmployeeId(shift.employeeId.toString());
        setDate(format(shift.startTime, "yyyy-MM-dd"));
        setStartTime(format(shift.startTime, "HH:mm"));
        setEndTime(format(shift.endTime, "HH:mm"));
      } else {
        setEmployeeId(defaultEmployeeId?.toString() || "");
        setDate(defaultDate ? format(defaultDate, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd"));
        setStartTime("09:00");
        setEndTime("17:00");
      }
    }
  }, [isOpen, shift, defaultDate, defaultEmployeeId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const startDateTime = new Date(`${date}T${startTime}`);
    const endDateTime = new Date(`${date}T${endTime}`);

    // Handle overnight shifts if needed (simple check if end < start)
    if (endDateTime < startDateTime) {
      endDateTime.setDate(endDateTime.getDate() + 1);
    }

    try {
      if (shift) {
        await updateShift.mutateAsync({
          id: shift.id,
          employeeId: parseInt(employeeId),
          startTime: startDateTime.toISOString(),
          endTime: endDateTime.toISOString(),
        });
        toast({ title: "Shift updated", description: "The schedule has been updated." });
      } else {
        await createShift.mutateAsync({
          employeeId: parseInt(employeeId),
          startTime: startDateTime.toISOString(),
          endTime: endDateTime.toISOString(),
        });
        toast({ title: "Shift created", description: "New shift added to schedule." });
      }
      onClose();
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to save shift." });
    }
  };

  const handleDelete = async () => {
    if (!shift) return;
    try {
      await deleteShift.mutateAsync(shift.id);
      toast({ title: "Shift deleted" });
      onClose();
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to delete shift." });
    }
  };

  const isSaving = createShift.isPending || updateShift.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{shift ? "Edit Shift" : "Add Shift"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label>Employee</Label>
            <Select value={employeeId} onValueChange={setEmployeeId} required>
              <SelectTrigger>
                <SelectValue placeholder="Select employee" />
              </SelectTrigger>
              <SelectContent>
                {employees?.map((emp) => (
                  <SelectItem key={emp.id} value={emp.id.toString()}>
                    {emp.name} ({emp.jobTitle})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Start Time</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>End Time</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
            </div>
          </div>

          <DialogFooter className="flex items-center justify-between mt-6">
            {shift && (
              <Button 
                type="button" 
                variant="destructive" 
                size="icon" 
                onClick={handleDelete}
                disabled={deleteShift.isPending}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
            <div className="flex gap-2 ml-auto">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {shift ? "Update Shift" : "Create Shift"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
