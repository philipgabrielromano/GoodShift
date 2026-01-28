import { useState, useEffect } from "react";
import { useEmployees } from "@/hooks/use-employees";
import { useOccurrenceSummary, useRetractOccurrence, useRetractAdjustment, useCreateOccurrenceAdjustment } from "@/hooks/use-occurrences";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, MinusCircle, Undo2, Award, Loader2, FileText, User } from "lucide-react";
import { getJobTitle } from "@/lib/utils";
import type { Employee } from "@shared/schema";

interface AuthStatus {
  isAuthenticated: boolean;
  user: { id: number; name: string; email: string; role: string } | null;
  ssoConfigured: boolean;
}

interface MyEmployeeResponse {
  employee: Employee | null;
}

export default function Occurrences() {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const { toast } = useToast();
  
  const { data: authStatus } = useQuery<AuthStatus>({
    queryKey: ["/api/auth/status"],
  });
  
  const isViewer = authStatus?.user?.role === "viewer";
  const canManageOccurrences = authStatus?.user?.role === "admin" || authStatus?.user?.role === "manager";
  
  // Only fetch employees list for managers/admins (not viewers)
  const { data: employees, isLoading: employeesLoading } = useEmployees({ enabled: !isViewer });
  
  // For viewers, fetch their linked employee
  const { data: myEmployeeData, isLoading: myEmployeeLoading } = useQuery<MyEmployeeResponse>({
    queryKey: ["/api/my-employee"],
    enabled: isViewer,
  });
  
  // Auto-select linked employee for viewers
  useEffect(() => {
    if (isViewer && myEmployeeData?.employee) {
      setSelectedEmployeeId(myEmployeeData.employee.id);
    }
  }, [isViewer, myEmployeeData]);

  // Only fetch summary when we have a valid employee ID
  const { data: summary, isLoading: summaryLoading } = useOccurrenceSummary(selectedEmployeeId ?? 0, { enabled: !!selectedEmployeeId });
  const retractOccurrence = useRetractOccurrence();
  const retractAdjustment = useRetractAdjustment();
  const createAdjustment = useCreateOccurrenceAdjustment();

  const [retractDialogOpen, setRetractDialogOpen] = useState(false);
  const [retractOccurrenceId, setRetractOccurrenceId] = useState<number | null>(null);
  const [retractReason, setRetractReason] = useState("");

  const [retractAdjustmentDialogOpen, setRetractAdjustmentDialogOpen] = useState(false);
  const [retractAdjustmentId, setRetractAdjustmentId] = useState<number | null>(null);
  const [retractAdjustmentReason, setRetractAdjustmentReason] = useState("");

  const [adjustmentDialogOpen, setAdjustmentDialogOpen] = useState(false);
  const [adjustmentType, setAdjustmentType] = useState<string>("");
  const [adjustmentNotes, setAdjustmentNotes] = useState("");
  
  const [perfectAttendanceDialogOpen, setPerfectAttendanceDialogOpen] = useState(false);

  const selectedEmployee = employees?.find(e => e.id === selectedEmployeeId);

  const handleRetract = async () => {
    if (!retractOccurrenceId || !selectedEmployeeId || !retractReason) return;
    
    try {
      await retractOccurrence.mutateAsync({
        id: retractOccurrenceId,
        reason: retractReason,
        employeeId: selectedEmployeeId
      });
      toast({ title: "Occurrence retracted", description: "The occurrence has been retracted successfully." });
      setRetractDialogOpen(false);
      setRetractReason("");
    } catch (error) {
      toast({ title: "Error", description: "Failed to retract occurrence", variant: "destructive" });
    }
  };

  const handleRetractAdjustment = async () => {
    if (!retractAdjustmentId || !selectedEmployeeId || !retractAdjustmentReason) return;
    
    try {
      await retractAdjustment.mutateAsync({
        id: retractAdjustmentId,
        reason: retractAdjustmentReason,
        employeeId: selectedEmployeeId
      });
      toast({ title: "Adjustment retracted", description: "The adjustment has been retracted successfully." });
      setRetractAdjustmentDialogOpen(false);
      setRetractAdjustmentReason("");
    } catch (error) {
      toast({ title: "Error", description: "Failed to retract adjustment", variant: "destructive" });
    }
  };

  const handleAddAdjustment = async () => {
    if (!selectedEmployeeId || !adjustmentType) return;
    
    try {
      await createAdjustment.mutateAsync({
        employeeId: selectedEmployeeId,
        adjustmentValue: -100,
        adjustmentType,
        notes: adjustmentNotes || undefined
      });
      toast({ title: "Adjustment added", description: "The adjustment has been recorded." });
      setAdjustmentDialogOpen(false);
      setAdjustmentType("");
      setAdjustmentNotes("");
    } catch (error: any) {
      toast({ 
        title: "Error", 
        description: error?.message || "Failed to add adjustment", 
        variant: "destructive" 
      });
    }
  };

  const handleGrantPerfectAttendance = async () => {
    if (!selectedEmployeeId) return;
    
    try {
      await createAdjustment.mutateAsync({
        employeeId: selectedEmployeeId,
        adjustmentValue: -100,
        adjustmentType: 'perfect_attendance',
        notes: '90-day perfect attendance bonus'
      });
      toast({ title: "Perfect Attendance Granted", description: "The -1.0 perfect attendance bonus has been applied." });
      setPerfectAttendanceDialogOpen(false);
    } catch (error: any) {
      toast({ 
        title: "Error", 
        description: error?.message || "Failed to grant perfect attendance", 
        variant: "destructive" 
      });
    }
  };

  const getOccurrenceTypeLabel = (type: string) => {
    switch (type) {
      case "half": return "Half (0.5)";
      case "full": return "Full (1.0)";
      case "ncns": return "NCNS (1.0)";
      default: return type;
    }
  };

  const activeEmployees = employees?.filter(e => e.isActive).sort((a, b) => a.name.localeCompare(b.name)) || [];

  return (
    <div className="p-6 lg:p-10 space-y-8 max-w-[1200px] mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-display flex items-center gap-3">
            <AlertTriangle className="w-8 h-8 text-orange-500" />
            Occurrences
          </h1>
          <p className="text-muted-foreground mt-1">Track and manage employee attendance occurrences.</p>
        </div>
      </div>

      {isViewer ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5" />
              My Occurrence History
            </CardTitle>
            <CardDescription>View your personal attendance occurrence record.</CardDescription>
          </CardHeader>
          <CardContent>
            {myEmployeeLoading ? (
              <Skeleton className="h-6 w-48" />
            ) : myEmployeeData?.employee ? (
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{myEmployeeData.employee.name}</Badge>
                <span className="text-sm text-muted-foreground">
                  {getJobTitle(myEmployeeData.employee.jobTitle)}
                </span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No employee record is linked to your account. Please contact your manager.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Select Employee</CardTitle>
            <CardDescription>Choose an employee to view their occurrence history.</CardDescription>
          </CardHeader>
          <CardContent>
            {employeesLoading ? (
              <Skeleton className="h-10 w-full max-w-md" />
            ) : (
              <Select 
                value={selectedEmployeeId?.toString() || ""} 
                onValueChange={(v) => setSelectedEmployeeId(v ? Number(v) : null)}
              >
                <SelectTrigger className="max-w-md" data-testid="select-employee">
                  <SelectValue placeholder="Select an employee..." />
                </SelectTrigger>
                <SelectContent>
                  {activeEmployees.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id.toString()}>
                      {emp.name} - {getJobTitle(emp.jobTitle)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardContent>
        </Card>
      )}

      {selectedEmployeeId && (
        <>
          {summaryLoading ? (
            <Card>
              <CardContent className="py-8">
                <div className="flex items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Loading occurrence data...</span>
                </div>
              </CardContent>
            </Card>
          ) : summary ? (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Rolling 12-Month Total
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-end gap-2">
                      <span className="text-4xl font-bold" data-testid="text-total-occurrences">
                        {summary.totalOccurrences.toFixed(1)}
                      </span>
                      <span className="text-muted-foreground mb-1">occurrences</span>
                    </div>
                    <Progress 
                      value={(summary.totalOccurrences / 7) * 100} 
                      className="mt-3 h-2"
                    />
                    <p className="text-xs text-muted-foreground mt-1">7.0 = termination threshold</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Adjustments This Year
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-end gap-2">
                      <span className="text-4xl font-bold" data-testid="text-adjustments-used">
                        {summary.adjustments.length}
                      </span>
                      <span className="text-muted-foreground mb-1">/ 2 used</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-2">
                      {summary.adjustmentsRemaining > 0 
                        ? `${summary.adjustmentsRemaining} adjustment(s) remaining` 
                        : "No adjustments remaining this year"}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Net Tally
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-end gap-2">
                      <span 
                        className={`text-4xl font-bold ${summary.netTally >= 6 ? 'text-red-600' : summary.netTally >= 4 ? 'text-orange-500' : ''}`}
                        data-testid="text-net-tally"
                      >
                        {summary.netTally.toFixed(1)}
                      </span>
                      <span className="text-muted-foreground mb-1">after adjustments</span>
                    </div>
                    {summary.netTally >= 6 && (
                      <Badge variant="destructive" className="mt-2">Final Warning</Badge>
                    )}
                  </CardContent>
                </Card>

                <Card className={summary.perfectAttendanceBonus ? "border-green-300 dark:border-green-700" : ""}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      90-Day Perfect Attendance
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-end gap-2">
                      <span 
                        className={`text-4xl font-bold ${summary.perfectAttendanceBonus ? 'text-green-600' : 'text-muted-foreground'}`}
                        data-testid="text-perfect-attendance-bonus"
                      >
                        {summary.perfectAttendanceUsed || 0}/1
                      </span>
                      <span className="text-muted-foreground mb-1">used this year</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-2">
                      {summary.perfectAttendanceBonus 
                        ? `Bonus earned: ${summary.perfectAttendanceBonusValue?.toFixed(1) || "-1.0"}`
                        : summary.perfectAttendanceEligible
                          ? summary.perfectAttendanceWouldBeWasted
                            ? "Eligible but no occurrences to reduce"
                            : "Eligible for bonus (-1.0)"
                          : "Requires 90 days without occurrences"}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {canManageOccurrences && (
                <div className="flex gap-4 flex-wrap">
                  {summary.adjustmentsRemaining > 0 && (
                    <Button 
                      variant="outline" 
                      onClick={() => setAdjustmentDialogOpen(true)}
                      data-testid="button-add-adjustment"
                    >
                      <Award className="w-4 h-4 mr-2" />
                      Add Adjustment (-1.0)
                    </Button>
                  )}
                  {summary.perfectAttendanceEligible && !summary.perfectAttendanceBonus && !summary.perfectAttendanceWouldBeWasted && (
                    <Button 
                      variant="outline" 
                      className="border-green-300 text-green-600 hover:bg-green-50 dark:hover:bg-green-950/20"
                      onClick={() => {
                        setPerfectAttendanceDialogOpen(true);
                      }}
                      data-testid="button-grant-perfect-attendance"
                    >
                      <Award className="w-4 h-4 mr-2" />
                      Grant Perfect Attendance (-1.0)
                    </Button>
                  )}
                </div>
              )}

              <Card>
                <CardHeader>
                  <CardTitle>Occurrence History</CardTitle>
                  <CardDescription>
                    {format(new Date(summary.periodStart), "MMM d, yyyy")} - {format(new Date(summary.periodEnd), "MMM d, yyyy")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {summary.occurrences.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">
                      No occurrences in the last 12 months.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {summary.occurrences.map((occurrence) => {
                        const isRetracted = occurrence.status === 'retracted';
                        return (
                          <div 
                            key={occurrence.id} 
                            className={`flex items-center justify-between p-3 rounded border ${isRetracted ? 'bg-muted/30 opacity-60' : 'bg-muted/50'}`}
                            data-testid={`occurrence-${occurrence.id}`}
                          >
                            <div className="flex items-center gap-4 flex-wrap">
                              <div className={`text-sm font-medium w-24 ${isRetracted ? 'line-through text-muted-foreground' : ''}`}>
                                {format(new Date(occurrence.occurrenceDate + "T12:00:00"), "MMM d, yyyy")}
                              </div>
                              <Badge 
                                variant={isRetracted ? "outline" : (occurrence.isNcns ? "destructive" : "secondary")}
                                className={isRetracted ? 'line-through' : ''}
                              >
                                {getOccurrenceTypeLabel(occurrence.occurrenceType)}
                              </Badge>
                              {isRetracted && (
                                <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                                  Retracted
                                </Badge>
                              )}
                              {occurrence.reason && !isRetracted && (
                                <span className="text-sm text-muted-foreground">{occurrence.reason}</span>
                              )}
                              {isRetracted && occurrence.retractedReason && (
                                <span className="text-sm text-muted-foreground italic">
                                  Reason: {occurrence.retractedReason}
                                </span>
                              )}
                              {occurrence.documentUrl && (
                                <a 
                                  href={occurrence.documentUrl} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                                  data-testid={`link-document-${occurrence.id}`}
                                >
                                  <FileText className="h-3 w-3" />
                                  View PDF
                                </a>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-medium ${isRetracted ? 'line-through text-muted-foreground' : ''}`}>
                                {(occurrence.occurrenceValue / 100).toFixed(1)}
                              </span>
                              {canManageOccurrences && !isRetracted && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setRetractOccurrenceId(occurrence.id);
                                    setRetractDialogOpen(true);
                                  }}
                                  data-testid={`button-retract-${occurrence.id}`}
                                >
                                  <Undo2 className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {summary.adjustments.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Adjustments</CardTitle>
                    <CardDescription>Occurrence reductions earned this year.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {summary.adjustments.map((adjustment) => {
                        const isRetracted = adjustment.status === 'retracted';
                        return (
                          <div 
                            key={adjustment.id} 
                            className={`flex items-center justify-between p-3 rounded border ${isRetracted ? 'bg-muted/30 opacity-60' : 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800'}`}
                            data-testid={`adjustment-${adjustment.id}`}
                          >
                            <div className="flex items-center gap-4">
                              <div className={`text-sm font-medium w-24 ${isRetracted ? 'line-through text-muted-foreground' : ''}`}>
                                {format(new Date(adjustment.adjustmentDate + "T12:00:00"), "MMM d, yyyy")}
                              </div>
                              <Badge 
                                variant={isRetracted ? "outline" : "outline"} 
                                className={isRetracted ? 'line-through' : 'text-green-600 border-green-600'}
                              >
                                {adjustment.adjustmentType === 'perfect_attendance' ? 'Perfect Attendance' : 'Covered Shift'}
                              </Badge>
                              {isRetracted && (
                                <Badge variant="secondary" className="text-xs">
                                  Retracted
                                </Badge>
                              )}
                              {adjustment.notes && !isRetracted && (
                                <span className="text-sm text-muted-foreground">{adjustment.notes}</span>
                              )}
                              {isRetracted && adjustment.retractedReason && (
                                <span className="text-sm text-muted-foreground italic">
                                  Reason: {adjustment.retractedReason}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-medium ${isRetracted ? 'line-through text-muted-foreground' : 'text-green-600'}`}>
                                {(adjustment.adjustmentValue / 100).toFixed(1)}
                              </span>
                              {canManageOccurrences && !isRetracted && (
                                <Button 
                                  variant="ghost" 
                                  size="sm"
                                  onClick={() => {
                                    setRetractAdjustmentId(adjustment.id);
                                    setRetractAdjustmentDialogOpen(true);
                                  }}
                                  data-testid={`button-retract-adjustment-${adjustment.id}`}
                                >
                                  <Undo2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : null}
        </>
      )}

      <Dialog open={retractDialogOpen} onOpenChange={setRetractDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Undo2 className="w-5 h-5" />
              Retract Occurrence
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Retracting an occurrence will remove it from the employee's tally. This should only be done if the occurrence was recorded in error.
            </p>
            <div className="space-y-2">
              <Label htmlFor="retractReason">Reason for retraction</Label>
              <Textarea
                id="retractReason"
                value={retractReason}
                onChange={(e) => setRetractReason(e.target.value)}
                placeholder="e.g., Shift was unscheduled, Documentation provided..."
                data-testid="input-retract-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRetractDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleRetract} 
              disabled={!retractReason || retractOccurrence.isPending}
              data-testid="button-confirm-retract"
            >
              {retractOccurrence.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Retract Occurrence
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={retractAdjustmentDialogOpen} onOpenChange={(open) => {
        setRetractAdjustmentDialogOpen(open);
        if (!open) {
          setRetractAdjustmentId(null);
          setRetractAdjustmentReason("");
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Undo2 className="w-5 h-5" />
              Retract Adjustment
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Retracting an adjustment will restore it to the employee's tally. This should only be done if the adjustment was recorded in error.
            </p>
            <div className="space-y-2">
              <Label htmlFor="retractAdjustmentReason">Reason for retraction</Label>
              <Textarea
                id="retractAdjustmentReason"
                value={retractAdjustmentReason}
                onChange={(e) => setRetractAdjustmentReason(e.target.value)}
                placeholder="e.g., Adjustment was granted in error, Documentation invalid..."
                data-testid="input-retract-adjustment-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRetractAdjustmentDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleRetractAdjustment} 
              disabled={!retractAdjustmentReason || retractAdjustment.isPending}
              data-testid="button-confirm-retract-adjustment"
            >
              {retractAdjustment.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Retract Adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={adjustmentDialogOpen} onOpenChange={setAdjustmentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Award className="w-5 h-5 text-green-500" />
              Add Occurrence Adjustment
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              An adjustment reduces the employee's occurrence tally by 1.0. Employees can earn up to 2 adjustments per calendar year.
            </p>
            <div className="space-y-2">
              <Label>Adjustment Type</Label>
              <Select value={adjustmentType} onValueChange={setAdjustmentType}>
                <SelectTrigger data-testid="select-adjustment-type">
                  <SelectValue placeholder="Select type..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unscheduled_shift">Covered Unscheduled Shift</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                For perfect attendance (90 days), use the separate "Grant Perfect Attendance" button when eligible.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjustmentNotes">Notes (optional)</Label>
              <Textarea
                id="adjustmentNotes"
                value={adjustmentNotes}
                onChange={(e) => setAdjustmentNotes(e.target.value)}
                placeholder="Any additional notes..."
                data-testid="input-adjustment-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustmentDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleAddAdjustment} 
              disabled={!adjustmentType || createAdjustment.isPending}
              data-testid="button-confirm-adjustment"
            >
              {createAdjustment.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Add Adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={perfectAttendanceDialogOpen} onOpenChange={setPerfectAttendanceDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Award className="w-5 h-5 text-green-500" />
              Grant Perfect Attendance Bonus
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This employee has achieved 90 days of perfect attendance and is eligible for a -1.0 adjustment to their occurrence tally.
            </p>
            <p className="text-sm text-muted-foreground">
              This can only be granted once per calendar year.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPerfectAttendanceDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleGrantPerfectAttendance} 
              disabled={createAdjustment.isPending}
              className="bg-green-600 hover:bg-green-700"
              data-testid="button-confirm-perfect-attendance"
            >
              {createAdjustment.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Grant Bonus (-1.0)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
