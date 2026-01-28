import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateOccurrence } from "@/hooks/use-occurrences";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { format } from "date-fns";
import { Loader2, AlertTriangle } from "lucide-react";

interface OccurrenceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  employeeId: number;
  employeeName: string;
  occurrenceDate: string;
}

const OCCURRENCE_TYPES = [
  { value: "half", label: "Half Occurrence (0.5)", points: 50 },
  { value: "full", label: "Full Occurrence (1.0)", points: 100 },
  { value: "ncns", label: "No Call/No Show (1.0 + Warning)", points: 100 },
];

export function OccurrenceDialog({ isOpen, onClose, employeeId, employeeName, occurrenceDate }: OccurrenceDialogProps) {
  const createOccurrence = useCreateOccurrence();
  const { toast } = useToast();

  const [occurrenceType, setOccurrenceType] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  useEffect(() => {
    if (isOpen) {
      setOccurrenceType("");
      setReason("");
      setNotes("");
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!occurrenceType) {
      toast({ title: "Error", description: "Please select an occurrence type", variant: "destructive" });
      return;
    }

    const typeInfo = OCCURRENCE_TYPES.find(t => t.value === occurrenceType);
    if (!typeInfo) return;

    try {
      await createOccurrence.mutateAsync({
        employeeId,
        occurrenceDate,
        occurrenceType,
        occurrenceValue: typeInfo.points,
        isNcns: occurrenceType === "ncns",
        reason: reason || undefined,
        notes: notes || undefined
      });

      toast({ 
        title: "Occurrence recorded", 
        description: `${typeInfo.label} recorded for ${employeeName}.` 
      });
      onClose();
    } catch (error) {
      toast({ 
        title: "Error", 
        description: "Failed to record occurrence", 
        variant: "destructive" 
      });
    }
  };

  const formattedDate = format(new Date(occurrenceDate + "T12:00:00"), "EEEE, MMMM d, yyyy");

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-occurrence">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            Record Occurrence
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Employee</Label>
            <div className="text-sm font-medium" data-testid="text-employee-name">{employeeName}</div>
          </div>

          <div className="space-y-2">
            <Label>Date</Label>
            <div className="text-sm text-muted-foreground" data-testid="text-occurrence-date">{formattedDate}</div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="occurrenceType">Occurrence Type</Label>
            <Select value={occurrenceType} onValueChange={setOccurrenceType}>
              <SelectTrigger data-testid="select-occurrence-type">
                <SelectValue placeholder="Select type..." />
              </SelectTrigger>
              <SelectContent>
                {OCCURRENCE_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value} data-testid={`option-${type.value}`}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {occurrenceType === "ncns" && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3">
              <p className="text-sm text-red-800">
                <strong>Warning:</strong> A No Call/No Show results in 1.0 occurrence plus a final written warning. 
                A second NCNS within 12 months results in termination.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="reason">Reason</Label>
            <Textarea
              id="reason"
              placeholder="Describe what happened..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              data-testid="input-reason"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Additional Notes (optional)</Label>
            <Textarea
              id="notes"
              placeholder="Any additional notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              data-testid="input-notes"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel">
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={createOccurrence.isPending || !occurrenceType}
              data-testid="button-submit"
            >
              {createOccurrence.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Record Occurrence
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
