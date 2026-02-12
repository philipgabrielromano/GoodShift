import { useState } from "react";
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
import { MessageSquare, Plus, Filter } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";

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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailLog, setDetailLog] = useState<(CoachingLog & { employeeName: string; employeeJobTitle: string; employeeLocation: string }) | null>(null);

  const [formEmployee, setFormEmployee] = useState<string>("");
  const [formCategory, setFormCategory] = useState<string>("");
  const [formReason, setFormReason] = useState("");
  const [formAction, setFormAction] = useState("");
  const [formResponse, setFormResponse] = useState("");

  const { toast } = useToast();

  const { data: authStatus } = useQuery<AuthStatus>({
    queryKey: ["/api/auth/status"],
  });

  const isManagerOrAdmin = authStatus?.user?.role === "admin" || authStatus?.user?.role === "manager";

  const { data: employees, isLoading: employeesLoading } = useQuery<CoachingEmployee[]>({
    queryKey: ["/api/coaching/employees"],
    enabled: isManagerOrAdmin,
  });

  const logParams = new URLSearchParams();
  if (filterEmployee !== "all") logParams.set("employeeId", filterEmployee);
  if (filterCategory !== "all") logParams.set("category", filterCategory);
  const logUrl = `/api/coaching/logs${logParams.toString() ? `?${logParams.toString()}` : ""}`;

  const { data: logs, isLoading: logsLoading } = useQuery<CoachingLog[]>({
    queryKey: [logUrl],
  });

  const createLogMutation = useMutation({
    mutationFn: async (data: { employeeId: number; category: string; reason: string; actionTaken: string; employeeResponse: string }) => {
      const res = await apiRequest("POST", "/api/coaching/logs", data);
      return res.json();
    },
    onSuccess: () => {
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

  function resetForm() {
    setFormEmployee("");
    setFormCategory("");
    setFormReason("");
    setFormAction("");
    setFormResponse("");
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
    });
  }

  const employeeMap = new Map<number, CoachingEmployee>();
  employees?.forEach(e => employeeMap.set(e.id, e));

  const enrichedLogs = (logs || []).map(log => ({
    ...log,
    employeeName: employeeMap.get(log.employeeId)?.name || "Unknown",
    employeeJobTitle: employeeMap.get(log.employeeId)?.jobTitle || "",
    employeeLocation: employeeMap.get(log.employeeId)?.location || "",
  }));

  return (
    <div className="p-6 lg:p-10 space-y-8 max-w-[1200px] mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold font-display flex items-center gap-3" data-testid="text-page-title">
            <MessageSquare className="w-8 h-8 text-primary" />
            Coaching Logs
          </h1>
          <p className="text-muted-foreground mt-1">
            {isManagerOrAdmin ? "Document feedback conversations with team members." : "View your coaching history."}
          </p>
        </div>
        {isManagerOrAdmin && (
          <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-coaching-log">
                <Plus className="w-4 h-4 mr-2" />
                New Coaching Log
              </Button>
            </DialogTrigger>
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
                      {employees?.map(e => (
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
        )}
      </div>

      {isManagerOrAdmin && (
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Filters:</span>
          </div>
          <div className="w-56">
            {employeesLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Select value={filterEmployee} onValueChange={setFilterEmployee}>
                <SelectTrigger data-testid="select-filter-employee">
                  <SelectValue placeholder="All Employees" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Employees</SelectItem>
                  {employees?.map(e => (
                    <SelectItem key={e.id} value={String(e.id)} data-testid={`select-filter-employee-${e.id}`}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="w-44">
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
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
          <CardTitle data-testid="text-log-count">
            {logsLoading ? "Loading..." : `${enrichedLogs.length} Coaching Log${enrichedLogs.length !== 1 ? "s" : ""}`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {logsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : enrichedLogs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground" data-testid="text-no-logs">
              <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No coaching logs found.</p>
              {isManagerOrAdmin && <p className="text-sm mt-1">Click "New Coaching Log" to create one.</p>}
            </div>
          ) : (
            <div className="overflow-x-auto">
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enrichedLogs.map(log => (
                    <TableRow
                      key={log.id}
                      data-testid={`row-coaching-log-${log.id}`}
                      className="cursor-pointer hover-elevate"
                      onClick={() => setDetailLog(log)}
                    >
                      <TableCell className="whitespace-nowrap text-sm">
                        {format(new Date(log.createdAt), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm" data-testid={`text-employee-name-${log.id}`}>{log.employeeName}</p>
                          <p className="text-xs text-muted-foreground">{getJobTitleDisplay(log.employeeJobTitle)}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={`no-default-hover-elevate no-default-active-elevate ${categoryColors[log.category] || ""}`} data-testid={`badge-category-${log.id}`}>
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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
                    <p className="font-medium">{format(new Date(detailLog.createdAt), "MMM d, yyyy")}</p>
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
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
