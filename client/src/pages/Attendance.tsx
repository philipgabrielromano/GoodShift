import { useState, useEffect, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { useOccurrenceSummary, useRetractOccurrence, useRetractAdjustment, useCreateOccurrenceAdjustment, useCorrectiveActions, useCreateCorrectiveAction, useDeleteCorrectiveAction } from "@/hooks/use-occurrences";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { AlertTriangle, MinusCircle, Undo2, Award, Loader2, FileText, User, CheckSquare, Trash2, Download, PlusCircle } from "lucide-react";
import { getJobTitle } from "@/lib/utils";
import { OccurrenceDialog } from "@/components/OccurrenceDialog";
import type { Employee } from "@shared/schema";
import { ABSENCE_REASONS } from "@shared/schema";

// Helper to get the display label for an absence reason
function getReasonLabel(reasonValue: string | null | undefined): string {
  if (!reasonValue) return "";
  const reason = ABSENCE_REASONS.find(r => r.value === reasonValue);
  return reason?.label || reasonValue;
}

interface AuthStatus {
  isAuthenticated: boolean;
  user: { id: number; name: string; email: string; role: string } | null;
  ssoConfigured: boolean;
}

interface MyEmployeeResponse {
  employee: Employee | null;
}

interface AttendanceEmployee {
  id: number;
  name: string;
  jobTitle: string;
  location: string | null;
  isActive: boolean;
  employmentType: string;
}

export default function Attendance() {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [showOccurrenceDialog, setShowOccurrenceDialog] = useState(false);
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const searchString = useSearch();
  
  const urlEmployeeId = useMemo(() => {
    const params = new URLSearchParams(searchString);
    const empId = params.get("employeeId");
    return empId ? parseInt(empId, 10) : null;
  }, [searchString]);
  
  const { data: authStatus } = useQuery<AuthStatus>({
    queryKey: ["/api/auth/status"],
  });
  
  const isViewer = authStatus?.user?.role === "viewer";
  const canManageOccurrences = authStatus?.user?.role === "admin" || authStatus?.user?.role === "manager";
  
  const attendanceUrl = showInactive ? "/api/attendance/employees?showInactive=true" : "/api/attendance/employees";
  const { data: employees, isLoading: employeesLoading } = useQuery<AttendanceEmployee[]>({
    queryKey: [attendanceUrl],
    enabled: !isViewer,
  });
  
  const { data: myEmployeeData, isLoading: myEmployeeLoading } = useQuery<MyEmployeeResponse>({
    queryKey: ["/api/my-employee"],
    enabled: isViewer,
  });
  
  useEffect(() => {
    if (urlEmployeeId && employees?.some(e => e.id === urlEmployeeId)) {
      setSelectedEmployeeId(urlEmployeeId);
      navigate("/attendance", { replace: true });
    } else if (isViewer && myEmployeeData?.employee) {
      setSelectedEmployeeId(myEmployeeData.employee.id);
    }
  }, [urlEmployeeId, employees, isViewer, myEmployeeData, navigate]);

  // Only fetch summary when we have a valid employee ID
  const { data: summary, isLoading: summaryLoading } = useOccurrenceSummary(selectedEmployeeId ?? 0, { enabled: !!selectedEmployeeId });
  const { data: correctiveActions, isLoading: correctiveLoading } = useCorrectiveActions(selectedEmployeeId ?? 0, { enabled: !!selectedEmployeeId });
  const retractOccurrence = useRetractOccurrence();
  const retractAdjustment = useRetractAdjustment();
  const createAdjustment = useCreateOccurrenceAdjustment();
  const createCorrectiveAction = useCreateCorrectiveAction();
  const deleteCorrectiveAction = useDeleteCorrectiveAction();

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

  const [correctiveDialogOpen, setCorrectiveDialogOpen] = useState(false);
  const [correctiveActionType, setCorrectiveActionType] = useState<'warning' | 'final_warning' | 'termination' | null>(null);
  const [correctiveActionDate, setCorrectiveActionDate] = useState<string>("");

  // Helper to check if corrective actions exist
  const hasWarning = correctiveActions?.some(a => a.actionType === 'warning') ?? false;
  const hasFinalWarning = correctiveActions?.some(a => a.actionType === 'final_warning') ?? false;
  const hasTermination = correctiveActions?.some(a => a.actionType === 'termination') ?? false;

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

  const handleCorrectiveAction = async () => {
    if (!selectedEmployeeId || !correctiveActionType || !correctiveActionDate || !summary) return;
    
    try {
      await createCorrectiveAction.mutateAsync({
        employeeId: selectedEmployeeId,
        actionType: correctiveActionType,
        actionDate: correctiveActionDate,
        occurrenceCount: Math.round(summary.netTally * 100)
      });
      const actionLabel = correctiveActionType === 'warning' ? 'Warning' : correctiveActionType === 'final_warning' ? 'Final Warning' : 'Termination';
      toast({ title: `${actionLabel} Recorded`, description: `The ${actionLabel.toLowerCase()} has been logged.` });
      setCorrectiveDialogOpen(false);
      setCorrectiveActionType(null);
      setCorrectiveActionDate("");
    } catch (error: any) {
      toast({ 
        title: "Error", 
        description: error?.message || "Failed to record corrective action", 
        variant: "destructive" 
      });
    }
  };

  const handleDeleteCorrectiveAction = async (id: number, actionType: string) => {
    if (!selectedEmployeeId) return;
    
    try {
      await deleteCorrectiveAction.mutateAsync({ id, employeeId: selectedEmployeeId });
      toast({ title: "Action Removed", description: `The ${actionType.replace('_', ' ')} record has been removed.` });
    } catch (error: any) {
      toast({ 
        title: "Error", 
        description: error?.message || "Failed to remove corrective action", 
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

  const sortedEmployees = employees?.sort((a, b) => a.name.localeCompare(b.name)) || [];

  const selectedEmployee = employees?.find(e => e.id === selectedEmployeeId);

  function exportOccurrencePDF() {
    if (!summary || !selectedEmployeeId) return;
    const emp = employees?.find(e => e.id === selectedEmployeeId);
    const empName = emp?.name || "Employee";
    const empTitle = emp?.jobTitle ? getJobTitle(emp.jobTitle) : "";
    const empLocation = emp?.location || "";

    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Occurrence Record", 14, 18);
    doc.setFontSize(10);
    doc.text(`Employee: ${empName}`, 14, 28);
    doc.text(`Job Title: ${empTitle}   Location: ${empLocation}`, 14, 34);
    doc.text(`Period: ${summary.periodStart} to ${summary.periodEnd}`, 14, 40);
    doc.text(`Generated: ${format(new Date(), "MMM d, yyyy h:mm a")}`, 14, 46);

    doc.setFontSize(11);
    doc.text(`Total Occurrences: ${summary.totalOccurrences.toFixed(1)}`, 14, 56);
    doc.text(`Adjustments: ${summary.adjustmentsThisYear.toFixed(1)}`, 14, 62);
    doc.text(`Net Tally: ${summary.netTally.toFixed(1)}`, 14, 68);

    let startY = 78;

    const allOccs = summary.occurrences || [];
    if (allOccs.length > 0) {
      doc.setFontSize(12);
      doc.text("Occurrences", 14, startY);
      autoTable(doc, {
        startY: startY + 4,
        head: [["Date", "Type", "Points", "Reason", "Status", "Notes"]],
        body: allOccs.map((o: any) => [
          o.occurrenceDate,
          o.occurrenceType === "half" ? "Half (0.5)" : o.occurrenceType === "ncns" ? "NCNS (1.0)" : "Full (1.0)",
          (o.occurrenceValue / 100).toFixed(1),
          getReasonLabel(o.reason),
          o.status === "retracted" ? "Retracted" : "Active",
          o.notes || "",
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [41, 128, 185] },
        bodyStyles: { textColor: [0, 0, 0] },
        didParseCell: (data: any) => {
          if (data.section === 'body') {
            const row = allOccs[data.row.index];
            if (row?.status === 'retracted') {
              data.cell.styles.textColor = [150, 150, 150];
              data.cell.styles.fontStyle = 'italic';
            }
          }
        },
      });
      startY = (doc as any).lastAutoTable.finalY + 10;
    }

    const allAdj = summary.adjustments || [];
    if (allAdj.length > 0) {
      doc.setFontSize(12);
      doc.text("Adjustments / Reductions", 14, startY);
      autoTable(doc, {
        startY: startY + 4,
        head: [["Date", "Type", "Value", "Status", "Notes"]],
        body: allAdj.map((a: any) => [
          a.adjustmentDate,
          a.adjustmentType === "perfect_attendance" ? "Perfect Attendance" : a.adjustmentType,
          (a.adjustmentValue / 100).toFixed(1),
          a.status === "retracted" ? "Retracted" : "Active",
          a.notes || "",
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [39, 174, 96] },
        bodyStyles: { textColor: [0, 0, 0] },
        didParseCell: (data: any) => {
          if (data.section === 'body') {
            const row = allAdj[data.row.index];
            if (row?.status === 'retracted') {
              data.cell.styles.textColor = [150, 150, 150];
              data.cell.styles.fontStyle = 'italic';
            }
          }
        },
      });
      startY = (doc as any).lastAutoTable.finalY + 10;
    }

    if (correctiveActions && correctiveActions.length > 0) {
      doc.setFontSize(12);
      doc.text("Corrective Actions", 14, startY);
      autoTable(doc, {
        startY: startY + 4,
        head: [["Date", "Action", "Occ. Count"]],
        body: correctiveActions.map((a: any) => [
          a.actionDate,
          a.actionType === "warning" ? "Warning" : a.actionType === "final_warning" ? "Final Warning" : "Termination",
          (a.occurrenceCount / 100).toFixed(1),
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [231, 76, 60] },
      });
    }

    doc.save(`${empName.replace(/\s+/g, "_")}_Occurrences.pdf`);
  }

  return (
    <div className="p-3 sm:p-6 lg:p-10 space-y-4 sm:space-y-8 max-w-[1200px] mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-3xl font-bold font-display flex items-center gap-2 sm:gap-3">
            <AlertTriangle className="w-5 h-5 sm:w-8 sm:h-8 text-orange-500" />
            Attendance
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">Track and manage employee attendance records.</p>
        </div>
        {canManageOccurrences && selectedEmployeeId && summary && (
          <div className="flex gap-2">
            <Button variant="default" size="sm" onClick={() => setShowOccurrenceDialog(true)} data-testid="button-add-occurrence">
              <PlusCircle className="w-4 h-4 mr-2" />
              Add Occurrence
            </Button>
            <Button variant="outline" size="sm" onClick={exportOccurrencePDF} data-testid="button-export-pdf">
              <Download className="w-4 h-4 mr-2" />
              Export PDF
            </Button>
          </div>
        )}
      </div>

      {isViewer ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5" />
              My Attendance History
            </CardTitle>
            <CardDescription>View your personal attendance record.</CardDescription>
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
            <CardDescription>Choose an employee to view their attendance history.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
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
                  {sortedEmployees.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id.toString()}>
                      {emp.name} - {getJobTitle(emp.jobTitle)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {canManageOccurrences && (
              <div className="flex items-center gap-2">
                <Switch
                  id="show-inactive"
                  checked={showInactive}
                  onCheckedChange={(checked) => {
                    setShowInactive(checked);
                    setSelectedEmployeeId(null);
                  }}
                  data-testid="switch-show-inactive"
                />
                <Label htmlFor="show-inactive" className="text-sm text-muted-foreground cursor-pointer">
                  Show inactive employees
                </Label>
              </div>
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
              <div className="grid grid-cols-2 gap-2 sm:gap-4 md:grid-cols-3">
                <Card>
                  <CardHeader className="p-3 sm:p-6 pb-1 sm:pb-2">
                    <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                      Rolling 12-Month Total
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 sm:p-6 pt-0">
                    <div className="flex items-end gap-1 sm:gap-2">
                      <span className="text-2xl sm:text-4xl font-bold" data-testid="text-total-occurrences">
                        {summary.totalOccurrences.toFixed(1)}
                      </span>
                      <span className="text-xs sm:text-base text-muted-foreground mb-0.5 sm:mb-1">occ.</span>
                    </div>
                    <Progress 
                      value={(summary.totalOccurrences / 8) * 100} 
                      className="mt-2 sm:mt-3 h-1.5 sm:h-2"
                    />
                    <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">5 = warn, 7 = final, 8 = term</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="p-3 sm:p-6 pb-1 sm:pb-2">
                    <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                      Adjustments This Year
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 sm:p-6 pt-0">
                    <div className="flex items-end gap-1 sm:gap-2">
                      <span className="text-2xl sm:text-4xl font-bold" data-testid="text-adjustments-used">
                        {summary.adjustments.length}
                      </span>
                      <span className="text-xs sm:text-base text-muted-foreground mb-0.5 sm:mb-1">/ 1 used</span>
                    </div>
                    <p className="text-xs sm:text-sm text-muted-foreground mt-2">
                      {summary.adjustmentsRemaining > 0 
                        ? `${summary.adjustmentsRemaining} remaining` 
                        : "None remaining"}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="p-3 sm:p-6 pb-1 sm:pb-2">
                    <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                      Net Tally
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 sm:p-6 pt-0">
                    <div className="flex items-end gap-1 sm:gap-2">
                      <span 
                        className={`text-2xl sm:text-4xl font-bold ${summary.netTally >= 7 ? 'text-red-600' : summary.netTally >= 5 ? 'text-orange-500' : ''}`}
                        data-testid="text-net-tally"
                      >
                        {summary.netTally.toFixed(1)}
                      </span>
                      <span className="text-xs sm:text-base text-muted-foreground mb-0.5 sm:mb-1">net</span>
                    </div>
                    {summary.netTally >= 8 ? (
                      <Badge variant="destructive" className="mt-2">Termination</Badge>
                    ) : summary.netTally >= 7 ? (
                      <Badge variant="destructive" className="mt-2">Final Warning</Badge>
                    ) : summary.netTally >= 5 ? (
                      <Badge className="mt-2 bg-orange-500 hover:bg-orange-600">Warning</Badge>
                    ) : null}
                  </CardContent>
                </Card>

                <Card className={summary.perfectAttendanceBonus ? "border-green-300 dark:border-green-700" : ""}>
                  <CardHeader className="p-3 sm:p-6 pb-1 sm:pb-2">
                    <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                      Perfect Attendance
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 sm:p-6 pt-0">
                    <div className="flex items-end gap-1 sm:gap-2">
                      <span 
                        className={`text-2xl sm:text-4xl font-bold ${summary.perfectAttendanceBonus ? 'text-green-600' : 'text-muted-foreground'}`}
                        data-testid="text-perfect-attendance-bonus"
                      >
                        {summary.perfectAttendanceUsed || 0}/1
                      </span>
                      <span className="text-xs sm:text-base text-muted-foreground mb-0.5 sm:mb-1">used</span>
                    </div>
                    <p className="text-xs sm:text-sm text-muted-foreground mt-2">
                      {summary.perfectAttendanceBonus 
                        ? `Bonus: ${summary.perfectAttendanceBonusValue?.toFixed(1) || "-1.0"}`
                        : summary.perfectAttendanceEligible
                          ? summary.perfectAttendanceWouldBeWasted
                            ? "Eligible but nothing to reduce"
                            : "Eligible (-1.0)"
                          : "Requires 90 days clean"}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {canManageOccurrences && (
                <div className="flex gap-2 sm:gap-4 flex-wrap">
                  {summary.adjustmentsRemaining > 0 && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => setAdjustmentDialogOpen(true)}
                      data-testid="button-add-adjustment"
                    >
                      <Award className="w-4 h-4 mr-1 sm:mr-2" />
                      <span className="hidden sm:inline">Add </span>Adjustment (-1.0)
                    </Button>
                  )}
                  {summary.perfectAttendanceEligible && !summary.perfectAttendanceBonus && !summary.perfectAttendanceWouldBeWasted && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      className="border-green-300 text-green-600"
                      onClick={() => {
                        setPerfectAttendanceDialogOpen(true);
                      }}
                      data-testid="button-grant-perfect-attendance"
                    >
                      <Award className="w-4 h-4 mr-1 sm:mr-2" />
                      <span className="hidden sm:inline">Grant </span>Perfect Attend. (-1.0)
                    </Button>
                  )}
                </div>
              )}

              {/* Corrective Actions Card */}
              {canManageOccurrences && summary.netTally >= 5 && (
                <Card className="border-orange-200 dark:border-orange-800">
                  <CardHeader className="p-3 sm:p-6 pb-2 sm:pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
                      <CheckSquare className="w-4 h-4 sm:w-5 sm:h-5 text-orange-500" />
                      Corrective Actions
                    </CardTitle>
                    <CardDescription className="text-xs sm:text-sm">
                      Track progressive discipline. Actions must be recorded in order.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-3 sm:p-6 pt-0 space-y-2 sm:space-y-4">
                    {/* Warning - available at 5+ occurrences */}
                    <div className="flex items-center justify-between gap-2 p-2 sm:p-3 rounded border bg-muted/50">
                      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                        <Checkbox 
                          id="warning" 
                          checked={hasWarning}
                          disabled={hasWarning || summary.netTally < 5}
                          onCheckedChange={(checked) => {
                            if (checked && !hasWarning) {
                              setCorrectiveActionType('warning');
                              setCorrectiveActionDate(format(new Date(), 'yyyy-MM-dd'));
                              setCorrectiveDialogOpen(true);
                            }
                          }}
                          data-testid="checkbox-warning"
                        />
                        <Label htmlFor="warning" className="flex flex-col gap-0.5 min-w-0">
                          <span className="font-medium text-sm">Warning</span>
                          <span className="text-[10px] sm:text-xs text-muted-foreground">At 5+ occurrences</span>
                        </Label>
                      </div>
                      {hasWarning && (
                        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                          <Badge variant="secondary" className="text-[10px] sm:text-xs bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
                            {format(new Date(correctiveActions?.find(a => a.actionType === 'warning')?.actionDate + "T12:00:00"), "M/d/yy")}
                          </Badge>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              const action = correctiveActions?.find(a => a.actionType === 'warning');
                              if (action) handleDeleteCorrectiveAction(action.id, action.actionType);
                            }}
                            data-testid="button-delete-warning"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* Final Warning - available at 7+ occurrences, requires warning */}
                    <div className="flex items-center justify-between gap-2 p-2 sm:p-3 rounded border bg-muted/50">
                      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                        <Checkbox 
                          id="final_warning" 
                          checked={hasFinalWarning}
                          disabled={hasFinalWarning || summary.netTally < 7 || !hasWarning}
                          onCheckedChange={(checked) => {
                            if (checked && !hasFinalWarning && hasWarning) {
                              setCorrectiveActionType('final_warning');
                              setCorrectiveActionDate(format(new Date(), 'yyyy-MM-dd'));
                              setCorrectiveDialogOpen(true);
                            }
                          }}
                          data-testid="checkbox-final-warning"
                        />
                        <Label htmlFor="final_warning" className="flex flex-col gap-0.5 min-w-0">
                          <span className="font-medium text-sm">Final Warning</span>
                          <span className="text-[10px] sm:text-xs text-muted-foreground">
                            At 7+ occ. {!hasWarning && "(need Warning)"}
                          </span>
                        </Label>
                      </div>
                      {hasFinalWarning && (
                        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                          <Badge variant="secondary" className="text-[10px] sm:text-xs bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                            {format(new Date(correctiveActions?.find(a => a.actionType === 'final_warning')?.actionDate + "T12:00:00"), "M/d/yy")}
                          </Badge>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              const action = correctiveActions?.find(a => a.actionType === 'final_warning');
                              if (action) handleDeleteCorrectiveAction(action.id, action.actionType);
                            }}
                            data-testid="button-delete-final-warning"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* Termination - available at 8+ occurrences, requires both warning and final warning */}
                    <div className="flex items-center justify-between gap-2 p-2 sm:p-3 rounded border bg-muted/50">
                      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                        <Checkbox 
                          id="termination" 
                          checked={hasTermination}
                          disabled={hasTermination || summary.netTally < 8 || !hasWarning || !hasFinalWarning}
                          onCheckedChange={(checked) => {
                            if (checked && !hasTermination && hasWarning && hasFinalWarning) {
                              setCorrectiveActionType('termination');
                              setCorrectiveActionDate(format(new Date(), 'yyyy-MM-dd'));
                              setCorrectiveDialogOpen(true);
                            }
                          }}
                          data-testid="checkbox-termination"
                        />
                        <Label htmlFor="termination" className="flex flex-col gap-0.5 min-w-0">
                          <span className="font-medium text-sm">Termination</span>
                          <span className="text-[10px] sm:text-xs text-muted-foreground">
                            At 8+ occ. {(!hasWarning || !hasFinalWarning) && "(need both)"}
                          </span>
                        </Label>
                      </div>
                      {hasTermination && (
                        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                          <Badge variant="destructive" className="text-[10px] sm:text-xs">
                            {format(new Date(correctiveActions?.find(a => a.actionType === 'termination')?.actionDate + "T12:00:00"), "M/d/yy")}
                          </Badge>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              const action = correctiveActions?.find(a => a.actionType === 'termination');
                              if (action) handleDeleteCorrectiveAction(action.id, action.actionType);
                            }}
                            data-testid="button-delete-termination"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
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
                            className={`p-2 sm:p-3 rounded border ${isRetracted ? 'bg-muted/30 opacity-60' : 'bg-muted/50'}`}
                            data-testid={`occurrence-${occurrence.id}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 flex-wrap min-w-0">
                                <div className="flex items-center gap-2">
                                  <div className={`text-xs sm:text-sm font-medium ${isRetracted ? 'line-through text-muted-foreground' : ''}`}>
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
                                </div>
                                {occurrence.reason && !isRetracted && (
                                  <span className="text-xs sm:text-sm text-muted-foreground">
                                    {getReasonLabel(occurrence.reason)}
                                    {occurrence.notes && (
                                      <span className="italic ml-1">— {occurrence.notes}</span>
                                    )}
                                  </span>
                                )}
                                {isRetracted && occurrence.retractedReason && (
                                  <span className="text-xs sm:text-sm text-muted-foreground italic">
                                    Reason: {occurrence.retractedReason}
                                  </span>
                                )}
                                {occurrence.documentUrl && (
                                  <a 
                                    href={occurrence.documentUrl} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline"
                                    data-testid={`link-document-${occurrence.id}`}
                                  >
                                    <FileText className="h-3 w-3" />
                                    View PDF
                                  </a>
                                )}
                              </div>
                              <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                                <span className={`text-xs sm:text-sm font-medium ${isRetracted ? 'line-through text-muted-foreground' : ''}`}>
                                  {(occurrence.occurrenceValue / 100).toFixed(1)}
                                </span>
                                {canManageOccurrences && !isRetracted && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
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
                            className={`p-2 sm:p-3 rounded border ${isRetracted ? 'bg-muted/30 opacity-60' : 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800'}`}
                            data-testid={`adjustment-${adjustment.id}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 min-w-0">
                                <div className="flex items-center gap-2">
                                  <div className={`text-xs sm:text-sm font-medium ${isRetracted ? 'line-through text-muted-foreground' : ''}`}>
                                    {format(new Date(adjustment.adjustmentDate + "T12:00:00"), "MMM d, yyyy")}
                                  </div>
                                  <Badge 
                                    variant={isRetracted ? "outline" : "outline"} 
                                    className={isRetracted ? 'line-through' : 'text-green-600 border-green-600'}
                                  >
                                    {adjustment.adjustmentType === 'perfect_attendance' ? 'Perfect Attend.' : 'Covered Shift'}
                                  </Badge>
                                  {isRetracted && (
                                    <Badge variant="secondary" className="text-xs">
                                      Retracted
                                    </Badge>
                                  )}
                                </div>
                                {adjustment.notes && !isRetracted && (
                                  <span className="text-xs sm:text-sm text-muted-foreground">{adjustment.notes}</span>
                                )}
                                {isRetracted && adjustment.retractedReason && (
                                  <span className="text-xs sm:text-sm text-muted-foreground italic">
                                    Reason: {adjustment.retractedReason}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                                <span className={`text-xs sm:text-sm font-medium ${isRetracted ? 'line-through text-muted-foreground' : 'text-green-600'}`}>
                                  {(adjustment.adjustmentValue / 100).toFixed(1)}
                                </span>
                                {canManageOccurrences && !isRetracted && (
                                  <Button 
                                    variant="ghost" 
                                    size="icon"
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
              An adjustment reduces the employee's occurrence tally by 1.0. Employees can earn up to 1 adjustment per calendar year.
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

      {/* Corrective Action Date Dialog */}
      <Dialog open={correctiveDialogOpen} onOpenChange={(open) => {
        setCorrectiveDialogOpen(open);
        if (!open) {
          setCorrectiveActionType(null);
          setCorrectiveActionDate("");
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckSquare className="w-5 h-5 text-orange-500" />
              Record {correctiveActionType === 'warning' ? 'Warning' : correctiveActionType === 'final_warning' ? 'Final Warning' : 'Termination'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {correctiveActionType === 'warning' && "Record that a warning was delivered to this employee."}
              {correctiveActionType === 'final_warning' && "Record that a final warning was delivered to this employee."}
              {correctiveActionType === 'termination' && "Record that termination was processed for this employee."}
            </p>
            <div className="space-y-2">
              <Label htmlFor="action-date">Date Delivered</Label>
              <Input
                id="action-date"
                type="date"
                value={correctiveActionDate}
                onChange={(e) => setCorrectiveActionDate(e.target.value)}
                data-testid="input-corrective-date"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCorrectiveDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleCorrectiveAction} 
              disabled={!correctiveActionDate || createCorrectiveAction.isPending}
              variant={correctiveActionType === 'termination' ? 'destructive' : 'default'}
              data-testid="button-confirm-corrective"
            >
              {createCorrectiveAction.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedEmployeeId && selectedEmployee && (
        <OccurrenceDialog
          isOpen={showOccurrenceDialog}
          onClose={() => setShowOccurrenceDialog(false)}
          employeeId={selectedEmployeeId}
          employeeName={selectedEmployee.name}
          occurrenceDate={format(new Date(), "yyyy-MM-dd")}
        />
      )}
    </div>
  );
}
