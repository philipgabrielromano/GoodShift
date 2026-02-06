import { useState, useMemo } from "react";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { ArrowLeftRight, Clock, User, Check } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Shift, Employee } from "@shared/schema";

const TIMEZONE = "America/New_York";

interface ShiftTradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetShift: Shift | null;
  targetEmployee: Employee | null;
  currentEmployee: Employee | null;
  myShifts: Shift[];
  weekStart: Date;
  weekEnd: Date;
}

export function ShiftTradeDialog({
  open,
  onOpenChange,
  targetShift,
  targetEmployee,
  currentEmployee,
  myShifts,
  weekStart,
  weekEnd,
}: ShiftTradeDialogProps) {
  const [selectedMyShiftId, setSelectedMyShiftId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const eligibleShifts = useMemo(() => {
    if (!targetShift) return [];
    return myShifts.filter(s => {
      const shiftDate = new Date(s.startTime);
      return shiftDate >= weekStart && shiftDate <= weekEnd;
    });
  }, [myShifts, targetShift, weekStart, weekEnd]);

  const handleSubmit = async () => {
    if (!selectedMyShiftId || !targetShift) return;

    setIsSubmitting(true);
    try {
      await apiRequest("POST", "/api/shift-trades", {
        requesterShiftId: selectedMyShiftId,
        responderShiftId: targetShift.id,
        requesterNote: note || null,
      });

      toast({
        title: "Trade Request Sent",
        description: `Your trade request has been sent to ${targetEmployee?.name}. They'll need to approve it first.`,
      });

      queryClient.invalidateQueries({ queryKey: ["/api/shift-trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      onOpenChange(false);
      setSelectedMyShiftId(null);
      setNote("");
    } catch (error: any) {
      const message = error?.message || "Failed to create trade request";
      toast({
        title: "Trade Request Failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!targetShift || !targetEmployee) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-shift-trade">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="w-5 h-5" />
            Request Shift Trade
          </DialogTitle>
          <DialogDescription>
            Select one of your shifts to offer in exchange for {targetEmployee.name}'s shift.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-muted">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Their Shift</Label>
            <div className="flex items-center gap-2 mt-1">
              <User className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium">{targetEmployee.name}</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm">
                {formatInTimeZone(targetShift.startTime, TIMEZONE, "EEE, MMM d")} &middot;{" "}
                {formatInTimeZone(targetShift.startTime, TIMEZONE, "h:mm a")} -{" "}
                {formatInTimeZone(targetShift.endTime, TIMEZONE, "h:mm a")}
              </span>
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Your Shift to Offer</Label>
            {eligibleShifts.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-2">
                You have no shifts this week to trade.
              </p>
            ) : (
              <ScrollArea className="max-h-48 mt-2">
                <div className="space-y-2">
                  {eligibleShifts.map(shift => (
                    <div
                      key={shift.id}
                      onClick={() => setSelectedMyShiftId(shift.id)}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedMyShiftId === shift.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover-elevate"
                      }`}
                      data-testid={`trade-my-shift-${shift.id}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm font-medium">
                            {formatInTimeZone(shift.startTime, TIMEZONE, "EEE, MMM d")}
                          </span>
                        </div>
                        {selectedMyShiftId === shift.id && (
                          <Check className="w-4 h-4 text-primary" />
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1 ml-6">
                        {formatInTimeZone(shift.startTime, TIMEZONE, "h:mm a")} -{" "}
                        {formatInTimeZone(shift.endTime, TIMEZONE, "h:mm a")}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>

          <div>
            <Label htmlFor="trade-note" className="text-xs text-muted-foreground uppercase tracking-wider">
              Note (optional)
            </Label>
            <Textarea
              id="trade-note"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Why do you want to trade?"
              className="mt-1 resize-none"
              rows={2}
              data-testid="input-trade-note"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-trade">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!selectedMyShiftId || isSubmitting}
            data-testid="button-submit-trade"
          >
            {isSubmitting ? "Sending..." : "Request Trade"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
