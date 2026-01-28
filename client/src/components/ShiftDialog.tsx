import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useCreateShift, useUpdateShift, useDeleteShift } from "@/hooks/use-shifts";
import { useEmployees } from "@/hooks/use-employees";
import { useShiftPresets } from "@/hooks/use-shift-presets";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { format } from "date-fns";
import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";
import { type Shift } from "@shared/schema";
import { Trash2, Loader2, Clock } from "lucide-react";
import { getJobTitle } from "@/lib/utils";

const TIMEZONE = "America/New_York";

interface ShiftDialogProps {
  isOpen: boolean;
  onClose: () => void;
  shift?: Shift; // If provided, we're editing
  defaultDate?: Date; // If creating new, default start date
  defaultEmployeeId?: number;
}

export function ShiftDialog({ isOpen, onClose, shift, defaultDate, defaultEmployeeId }: ShiftDialogProps) {
  const { data: employees } = useEmployees();
  const { data: shiftPresets } = useShiftPresets();
  const createShift = useCreateShift();
  const updateShift = useUpdateShift();
  const deleteShift = useDeleteShift();
  const { toast } = useToast();

  const [employeeId, setEmployeeId] = useState<string>("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [date, setDate] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<string>("");

  useEffect(() => {
    if (isOpen) {
      setSelectedPreset("");
      if (shift) {
        setEmployeeId(shift.employeeId.toString());
        setDate(formatInTimeZone(shift.startTime, TIMEZONE, "yyyy-MM-dd"));
        setStartTime(formatInTimeZone(shift.startTime, TIMEZONE, "HH:mm"));
        setEndTime(formatInTimeZone(shift.endTime, TIMEZONE, "HH:mm"));
      } else {
        setEmployeeId(defaultEmployeeId?.toString() || "");
        setDate(defaultDate ? formatInTimeZone(defaultDate, TIMEZONE, "yyyy-MM-dd") : formatInTimeZone(new Date(), TIMEZONE, "yyyy-MM-dd"));
        setStartTime("09:00");
        setEndTime("17:00");
      }
    }
  }, [isOpen, shift, defaultDate, defaultEmployeeId]);

  const handlePresetChange = (presetId: string) => {
    setSelectedPreset(presetId);
    const preset = shiftPresets?.find(p => p.id.toString() === presetId);
    if (preset) {
      setStartTime(preset.startTime);
      setEndTime(preset.endTime);
    }
  };

  const activePresets = shiftPresets?.filter(p => p.isActive).sort((a, b) => a.sortOrder - b.sortOrder) || [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Create dates in EST timezone
    const startDateTime = fromZonedTime(`${date}T${startTime}:00`, TIMEZONE);
    let endDateTime = fromZonedTime(`${date}T${endTime}:00`, TIMEZONE);

    // Handle overnight shifts if needed (simple check if end < start)
    if (endDateTime < startDateTime) {
      endDateTime = new Date(endDateTime.getTime() + 24 * 60 * 60 * 1000);
    }

    try {
      if (shift) {
        await updateShift.mutateAsync({
          id: shift.id,
          employeeId: parseInt(employeeId),
          startTime: startDateTime,
          endTime: endDateTime,
        });
        toast({ title: "Shift updated", description: "The schedule has been updated." });
      } else {
        await createShift.mutateAsync({
          employeeId: parseInt(employeeId),
          startTime: startDateTime,
          endTime: endDateTime,
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
                    {emp.name} ({getJobTitle(emp.jobTitle)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required data-testid="input-shift-date" />
          </div>

          {activePresets.length > 0 && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Shift Preset
              </Label>
              <Select value={selectedPreset} onValueChange={handlePresetChange}>
                <SelectTrigger data-testid="select-shift-preset">
                  <SelectValue placeholder="Quick select shift times..." />
                </SelectTrigger>
                <SelectContent>
                  {activePresets.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id.toString()} data-testid={`preset-${preset.id}`}>
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-2.5 h-2.5 rounded-full" 
                          style={{ backgroundColor: preset.color }} 
                        />
                        <span>{preset.name}</span>
                        <span className="text-muted-foreground text-xs ml-1">
                          ({preset.startTime} - {preset.endTime})
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Start Time</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required data-testid="input-start-time" />
            </div>
            <div className="space-y-2">
              <Label>End Time</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required data-testid="input-end-time" />
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
