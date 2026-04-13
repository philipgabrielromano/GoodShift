import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { MessageSquare, Plus, Filter, Download, Paperclip, FileText, X, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

interface AuthStatus {
  isAuthenticated: boolean;
  user: { id: number; name: string; email: string; role: string } | null;
  ssoConfigured: boolean;
}

interface CoachingEmployee {
  id: number;
  name: string;
  jobTitle: string;
  location: string | null;
}

interface CoachingLog {
  id: number;
  employeeId: number;
  managerId: number;
  managerName: string;
  category: string;
  reason: string;
  actionTaken: string;
  employeeResponse: string;
  date: string | null;
  attachmentUrl: string | null;
  attachmentName: string | null;
  createdAt: string;
}

const CATEGORIES = ["Attendance", "Safety", "Training", "Recognition", "Coaching"];

const categoryColors: Record<string, string> = {
  Attendance: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  Safety: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  Training: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  Recognition: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  Coaching: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
};

function getJobTitleDisplay(code: string): string {
  const map: Record<string, string> = {
    STSUPER: "Store Manager", WVSTMNG: "Store Manager",
    STASSTSP: "Asst Manager", WVSTAST: "Asst Manager",
    STLDWKR: "Team Lead", WVLDWRK: "Team Lead",
    CASHSLS: "Cashier/Sales", CSHSLSWV: "Cashier/Sales",
    APPROC: "Apparel Proc", APWV: "Apparel Proc",
    DONDOOR: "Donation Door", WVDON: "Donation Door",
    DONPRI: "Donation Pricer", DONPRWV: "Donation Pricer",
  };
  return map[code?.toUpperCase()] || code || "Staff";
}

export default function Coaching() {
  const [filterEmployee, setFilterEmployee] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterLocation, setFilterLocation] = useState<string>("all");
  const [showInactive, setShowInactive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailLog, setDetailLog] = useState<(CoachingLog & { employeeName: string; employeeJobTitle: string; employeeLocation: string }) | null>(null);

  const [formEmployee, setFormEmployee] = useState<string>("");
  const [formCategory, setFormCategory] = useState<string>("");
  const [formReason, setFormReason] = useState("");
  const [formAction, setFormAction] = useState("");
  const [formResponse, setFormResponse] = useState("");
  const [formDate, setFormDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [formFile, setFormFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { toast } = useToast();

  const { data: authStatus } = useQuery<AuthStatus>({
    queryKey: ["/api/auth/status"],
  });

  const isManagerOrAdmin = authStatus?.user?.role === "admin" || authStatus?.user?.role === "manager" || authStatus?.user?.role === "optimizer";

  const coachingEmployeesUrl = showInactive ? "/api/coaching/employees?showInactive=true" : "/api/coaching/employees";
  const { data: employees, isLoading: employeesLoading } = useQuery<CoachingEmployee[]>({
    queryKey: [coachingEmployeesUrl],
    enabled: isManagerOrAdmin,
  });

  const logParams = new URLSearchParams();
  if (filterEmployee !== "all") logParams.set("employeeId", filterEmployee);
  if (filterCategory !== "all") logParams.set("category", filterCategory);
  if (showInactive) logParams.set("includeInactive", "true");
  const logUrl = `/api/coaching/logs${logParams.toString() ? `?${logParams.toString()}` : ""}`;

  const { data: logs, isLoading: logsLoading } = useQuery<CoachingLog[]>({
    queryKey: [logUrl],
  });

  const createLogMutation = useMutation({
    mutationFn: async (data: { employeeId: number; category: string; reason: string; actionTaken: string; employeeResponse: string; date: string }) => {
      const res = await apiRequest("POST", "/api/coaching/logs", data);
      return res.json();
    },
    onSuccess: async (newLog: CoachingLog) => {
      if (formFile) {
        await uploadAttachment(newLog.id, formFile);
      }
      queryClient.invalidateQueries({ predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === "string" && key.startsWith("/api/coaching/logs");
      }});
      toast({ title: "Coaching log created", description: "The coaching conversation has been recorded." });
      setDialogOpen(false);
      resetForm();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create coaching log.", variant: "destructive" });
    },
  });

  async function uploadAttachment(logId: number, file: File): Promise<void> {
    try {
      const urlRes = await apiRequest("POST", "/api/coaching/upload-url", {
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type,
      });
      const { uploadURL, objectPath } = await urlRes.json();

      await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });

      await apiRequest("PATCH", `/api/coaching/logs/${logId}/attachment`, {
        attachmentUrl: objectPath,
        attachmentName: file.name,
      });
    } catch (err) {
      console.error("Error uploading attachment:", err);
      toast({ title: "Warning", description: "Coaching log saved but PDF attachment failed to upload.", variant: "destructive" });
    }
  }

  const uploadToExistingMutation = useMutation({
    mutationFn: async ({ logId, file }: { logId: number; file: File }) => {
      setIsUploading(true);
      await uploadAttachment(logId, file);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === "string" && key.startsWith("/api/coaching/logs");
      }});
      toast({ title: "Attachment uploaded" });
      setIsUploading(false);
    },
    onError: () => {
      setIsUploading(false);
      toast({ title: "Error", description: "Failed to upload attachment.", variant: "destructive" });
    },
  });

  const removeAttachmentMutation = useMutation({
    mutationFn: async (logId: number) => {
      await apiRequest("PATCH", `/api/coaching/logs/${logId}/attachment`, {
        attachmentUrl: null,
        attachmentName: null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === "string" && key.startsWith("/api/coaching/logs");
      }});
      if (detailLog) {
        setDetailLog({ ...detailLog, attachmentUrl: null, attachmentName: null });
      }
      toast({ title: "Attachment removed" });
    },
  });

  function resetForm() {
    setFormEmployee("");
    setFormCategory("");
    setFormReason("");
    setFormAction("");
    setFormResponse("");
    setFormDate(new Date().toISOString().split("T")[0]);
    setFormFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleSubmit() {
    if (!formEmployee || !formCategory || !formReason.trim() || !formAction.trim() || !formResponse.trim()) {
      toast({ title: "Missing fields", description: "Please fill in all fields.", variant: "destructive" });
      return;
    }
    createLogMutation.mutate({
      employeeId: Number(formEmployee),
      category: formCategory,
      reason: formReason.trim(),
      actionTaken: formAction.trim(),
      employeeResponse: formResponse.trim(),
      date: formDate,
    });
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      toast({ title: "Invalid file", description: "Only PDF files are allowed.", variant: "destructive" });
      e.target.value = "";
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum file size is 10MB.", variant: "destructive" });
      e.target.value = "";
      return;
    }

    setFormFile(file);
  }

  const employeeMap = new Map<number, CoachingEmployee>();
  employees?.forEach(e => employeeMap.set(e.id, e));

  const locations = Array.from(new Set(employees?.map(e => e.location).filter(Boolean) as string[])).sort();

  const enrichedLogs = (logs || []).map(log => ({
    ...log,
    employeeName: employeeMap.get(log.employeeId)?.name || "Unknown",
    employeeJobTitle: employeeMap.get(log.employeeId)?.jobTitle || "",
    employeeLocation: employeeMap.get(log.employeeId)?.location || "",
  })).filter(log => filterLocation === "all" || log.employeeLocation === filterLocation);

  const filteredFormEmployees = employees?.filter(e => filterLocation === "all" || e.location === filterLocation);

  function exportCoachingPDF() {
    if (enrichedLogs.length === 0) return;
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(16);
    doc.text("Coaching Logs", 14, 18);
    doc.setFontSize(10);

    const filters: string[] = [];
    if (filterLocation !== "all") filters.push(`Location: ${filterLocation}`);
    if (filterEmployee !== "all") {
      const emp = employeeMap.get(Number(filterEmployee));
      filters.push(`Employee: ${emp?.name || filterEmployee}`);
    }
    if (filterCategory !== "all") filters.push(`Category: ${filterCategory}`);
    doc.text(filters.length > 0 ? `Filters: ${filters.join(", ")}` : "All records", 14, 26);
    doc.text(`Generated: ${format(new Date(), "MMM d, yyyy h:mm a")}`, 14, 32);
    doc.text(`Total: ${enrichedLogs.length} log${enrichedLogs.length !== 1 ? "s" : ""}`, 14, 38);

    autoTable(doc, {
      startY: 44,
      head: [["Date", "Employee", "Title", "Category", "Reason", "Action Taken", "Response", "Manager"]],
      body: enrichedLogs.map(log => [
        format(log.date ? new Date(log.date + "T00:00:00") : new Date(log.createdAt), "MMM d, yyyy"),
        log.employeeName,
        getJobTitleDisplay(log.employeeJobTitle),
        log.category,
        log.reason,
        log.actionTaken,
        log.employeeResponse,
        log.managerName,
      ]),
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [88, 80, 236] },
      columnStyles: {
        4: { cellWidth: 50 },
        5: { cellWidth: 50 },
        6: { cellWidth: 40 },
      },
    });

    doc.save("Coaching_Logs.pdf");
  }

  return (
    <div className="p-3 sm:p-6 lg:p-10 space-y-4 sm:space-y-8 max-w-[1200px] mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2 sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-3xl font-bold font-display flex items-center gap-2 sm:gap-3" data-testid="text-page-title">
            <MessageSquare className="w-5 h-5 sm:w-8 sm:h-8 text-primary" />
            Coaching Logs
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            {isManagerOrAdmin ? "Document feedback conversations with team members." : "View your coaching history."}
          </p>
        </div>
        {isManagerOrAdmin && (
          <div className="flex items-center gap-2">
          <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-coaching-log">
                <Plus className="w-4 h-4 mr-2" />
                New Coaching Log
              </Button>
            </DialogTrigger>
            {enrichedLogs.length > 0 && (
              <Button variant="outline" size="sm" onClick={exportCoachingPDF} data-testid="button-export-coaching-pdf">
                <Download className="w-4 h-4 mr-2" />
                <span className="hidden sm:inline">Export </span>PDF
              </Button>
            )}
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>New Coaching Log</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Employee</Label>
                  <Select value={formEmployee} onValueChange={setFormEmployee}>
                    <SelectTrigger data-testid="select-form-employee">
                      <SelectValue placeholder="Select employee..." />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredFormEmployees?.map(e => (
                        <SelectItem key={e.id} value={String(e.id)} data-testid={`select-form-employee-${e.id}`}>
                          {e.name} - {getJobTitleDisplay(e.jobTitle)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={formCategory} onValueChange={setFormCategory}>
                    <SelectTrigger data-testid="select-form-category">
                      <SelectValue placeholder="Select category..." />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(c => (
                        <SelectItem key={c} value={c} data-testid={`select-form-category-${c.toLowerCase()}`}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    data-testid="input-date"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Reason / Topic</Label>
                  <Textarea
                    value={formReason}
                    onChange={(e) => setFormReason(e.target.value)}
                    placeholder="Describe the reason for this coaching conversation..."
                    data-testid="input-reason"
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Action Taken</Label>
                  <Textarea
                    value={formAction}
                    onChange={(e) => setFormAction(e.target.value)}
                    placeholder="What steps or actions were discussed or taken..."
                    data-testid="input-action-taken"
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Employee Response</Label>
                  <Textarea
                    value={formResponse}
                    onChange={(e) => setFormResponse(e.target.value)}
                    placeholder="How did the employee respond to the coaching..."
                    data-testid="input-employee-response"
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Attach PDF (optional)</Label>
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/pdf"
                      onChange={handleFileSelect}
                      className="hidden"
                      data-testid="input-file"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      data-testid="button-attach-pdf"
                    >
                      <Paperclip className="w-4 h-4 mr-2" />
                      {formFile ? "Change File" : "Choose PDF"}
                    </Button>
                    {formFile && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-1 min-w-0">
                        <FileText className="w-4 h-4 shrink-0 text-red-500" />
                        <span className="truncate">{formFile.name}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0"
                          onClick={() => { setFormFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                          data-testid="button-remove-form-file"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">PDF only, max 10MB</p>
                </div>
              </div>
              <DialogFooter className="gap-2">
                <DialogClose asChild>
                  <Button variant="outline" data-testid="button-cancel-coaching">Cancel</Button>
                </DialogClose>
                <Button
                  onClick={handleSubmit}
                  disabled={createLogMutation.isPending}
                  data-testid="button-submit-coaching"
                >
                  {createLogMutation.isPending ? "Saving..." : "Save Log"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        )}
      </div>

      {isManagerOrAdmin && (
        <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs sm:text-sm text-muted-foreground">Filters:</span>
          </div>
          <div className="w-full sm:w-56">
            {employeesLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Select value={filterEmployee} onValueChange={setFilterEmployee}>
                <SelectTrigger data-testid="select-filter-employee">
                  <SelectValue placeholder="All Employees" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Employees</SelectItem>
                  {filteredFormEmployees?.map(e => (
                    <SelectItem key={e.id} value={String(e.id)} data-testid={`select-filter-employee-${e.id}`}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {locations.length > 1 && (
            <div className="w-[calc(50%-0.25rem)] sm:w-48">
              <Select value={filterLocation} onValueChange={(val) => { setFilterLocation(val); setFilterEmployee("all"); }}>
                <SelectTrigger data-testid="select-filter-location">
                  <SelectValue placeholder="All Locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {locations.map(loc => (
                    <SelectItem key={loc} value={loc} data-testid={`select-filter-location-${loc}`}>{loc}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Switch
              id="coaching-show-inactive"
              checked={showInactive}
              onCheckedChange={(checked) => {
                setShowInactive(checked);
                setFilterEmployee("all");
              }}
              data-testid="switch-coaching-show-inactive"
            />
            <Label htmlFor="coaching-show-inactive" className="text-sm text-muted-foreground cursor-pointer">
              Inactive
            </Label>
          </div>
          <div className="w-[calc(50%-0.25rem)] sm:w-44">
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger data-testid="select-filter-category">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {CATEGORIES.map(c => (
                  <SelectItem key={c} value={c} data-testid={`select-filter-category-${c.toLowerCase()}`}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 sm:gap-4 space-y-0 p-3 sm:p-6 pb-2 sm:pb-4">
          <CardTitle className="text-sm sm:text-base" data-testid="text-log-count">
            {logsLoading ? "Loading..." : `${enrichedLogs.length} Coaching Log${enrichedLogs.length !== 1 ? "s" : ""}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-6 pt-0">
          {logsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : enrichedLogs.length === 0 ? (
            <div className="text-center py-8 sm:py-12 text-muted-foreground" data-testid="text-no-logs">
              <MessageSquare className="w-8 h-8 sm:w-12 sm:h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No coaching logs found.</p>
              {isManagerOrAdmin && <p className="text-xs sm:text-sm mt-1">Tap "New Coaching Log" to create one.</p>}
            </div>
          ) : (
            <>
              {/* Mobile card layout */}
              <div className="sm:hidden space-y-2">
                {enrichedLogs.map(log => (
                  <div
                    key={log.id}
                    data-testid={`row-coaching-log-${log.id}`}
                    className="p-2.5 rounded border bg-muted/50 cursor-pointer hover-elevate"
                    onClick={() => setDetailLog(log)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate" data-testid={`text-employee-name-${log.id}`}>{log.employeeName}</p>
                        <p className="text-[10px] text-muted-foreground">{getJobTitleDisplay(log.employeeJobTitle)}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {log.attachmentUrl && <Paperclip className="w-3 h-3 text-muted-foreground" />}
                        <Badge className={`no-default-hover-elevate no-default-active-elevate text-[10px] ${categoryColors[log.category] || ""}`} data-testid={`badge-category-${log.id}`}>
                          {log.category}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {format(log.date ? new Date(log.date + "T00:00:00") : new Date(log.createdAt), "M/d/yy")}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{log.reason}</p>
                  </div>
                ))}
              </div>

              {/* Desktop table layout */}
              <div className="hidden sm:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Employee</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Action Taken</TableHead>
                      <TableHead>Response</TableHead>
                      <TableHead>Manager</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {enrichedLogs.map(log => (
                      <TableRow
                        key={log.id}
                        data-testid={`row-coaching-log-desktop-${log.id}`}
                        className="cursor-pointer hover-elevate"
                        onClick={() => setDetailLog(log)}
                      >
                        <TableCell className="whitespace-nowrap text-sm">
                          {format(log.date ? new Date(log.date + "T00:00:00") : new Date(log.createdAt), "MMM d, yyyy")}
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium text-sm">{log.employeeName}</p>
                            <p className="text-xs text-muted-foreground">{getJobTitleDisplay(log.employeeJobTitle)}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={`no-default-hover-elevate no-default-active-elevate ${categoryColors[log.category] || ""}`}>
                            {log.category}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[250px]">
                          <p className="text-sm line-clamp-2">{log.reason}</p>
                        </TableCell>
                        <TableCell className="max-w-[250px]">
                          <p className="text-sm line-clamp-2">{log.actionTaken}</p>
                        </TableCell>
                        <TableCell className="max-w-[250px]">
                          <p className="text-sm line-clamp-2">{log.employeeResponse}</p>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {log.managerName}
                        </TableCell>
                        <TableCell>
                          {log.attachmentUrl && (
                            <Paperclip className="w-4 h-4 text-muted-foreground" data-testid={`icon-attachment-${log.id}`} />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!detailLog} onOpenChange={(open) => { if (!open) setDetailLog(null); }}>
        <DialogContent className="max-w-lg">
          {detailLog && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3 flex-wrap">
                  Coaching Log
                  <Badge className={`no-default-hover-elevate no-default-active-elevate ${categoryColors[detailLog.category] || ""}`}>
                    {detailLog.category}
                  </Badge>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4 flex-wrap text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Employee</p>
                    <p className="font-medium" data-testid="text-detail-employee">{detailLog.employeeName}</p>
                    <p className="text-xs text-muted-foreground">{getJobTitleDisplay(detailLog.employeeJobTitle)}{detailLog.employeeLocation ? ` - ${detailLog.employeeLocation}` : ""}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-muted-foreground text-xs">Date</p>
                    <p className="font-medium">{format(detailLog.date ? new Date(detailLog.date + "T00:00:00") : new Date(detailLog.createdAt), "MMM d, yyyy")}</p>
                    <p className="text-xs text-muted-foreground">by {detailLog.managerName}</p>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Reason / Topic</p>
                  <p className="text-sm whitespace-pre-wrap" data-testid="text-detail-reason">{detailLog.reason}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Action Taken</p>
                  <p className="text-sm whitespace-pre-wrap" data-testid="text-detail-action">{detailLog.actionTaken}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Employee Response</p>
                  <p className="text-sm whitespace-pre-wrap" data-testid="text-detail-response">{detailLog.employeeResponse}</p>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Attachment</p>
                  {detailLog.attachmentUrl ? (
                    <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30">
                      <FileText className="w-5 h-5 text-red-500 shrink-0" />
                      <a
                        href={detailLog.attachmentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary hover:underline truncate flex-1"
                        onClick={(e) => e.stopPropagation()}
                        data-testid="link-attachment"
                      >
                        {detailLog.attachmentName || "Download PDF"}
                      </a>
                      {isManagerOrAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeAttachmentMutation.mutate(detailLog.id);
                          }}
                          data-testid="button-remove-attachment"
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  ) : isManagerOrAdmin ? (
                    <div>
                      <input
                        type="file"
                        accept="application/pdf"
                        className="hidden"
                        id="detail-file-input"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          if (file.type !== "application/pdf") {
                            toast({ title: "Invalid file", description: "Only PDF files are allowed.", variant: "destructive" });
                            return;
                          }
                          if (file.size > 10 * 1024 * 1024) {
                            toast({ title: "File too large", description: "Maximum file size is 10MB.", variant: "destructive" });
                            return;
                          }
                          uploadToExistingMutation.mutate({ logId: detailLog.id, file });
                          setDetailLog({ ...detailLog, attachmentUrl: "pending", attachmentName: file.name });
                          e.target.value = "";
                        }}
                        data-testid="input-detail-file"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isUploading}
                        onClick={() => document.getElementById("detail-file-input")?.click()}
                        data-testid="button-attach-to-existing"
                      >
                        {isUploading ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Uploading...
                          </>
                        ) : (
                          <>
                            <Paperclip className="w-4 h-4 mr-2" />
                            Attach PDF
                          </>
                        )}
                      </Button>
                      <p className="text-xs text-muted-foreground mt-1">PDF only, max 10MB</p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">No attachment</p>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
