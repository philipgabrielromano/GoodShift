import { useState, useMemo } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { ArrowLeftRight, Check, X, Clock, User, Filter } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getJobTitle } from "@/lib/utils";
import type { ShiftTrade, Employee, Shift } from "@shared/schema";

const TIMEZONE = "America/New_York";

interface AuthStatus {
  isAuthenticated: boolean;
  user: { id: number; name: string; email: string; role: string; locationIds: string[] | null } | null;
  ssoConfigured: boolean;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "pending_peer":
      return <Badge className="bg-blue-500 text-white" data-testid="badge-status-pending-peer">Waiting for Peer</Badge>;
    case "pending_manager":
      return <Badge className="bg-amber-500 text-white" data-testid="badge-status-pending-manager">Waiting for Manager</Badge>;
    case "approved":
      return <Badge className="bg-green-600 text-white" data-testid="badge-status-approved">Approved</Badge>;
    case "declined_peer":
      return <Badge className="bg-red-500 text-white" data-testid="badge-status-declined-peer">Declined by Peer</Badge>;
    case "declined_manager":
      return <Badge className="bg-red-600 text-white" data-testid="badge-status-declined-manager">Declined by Manager</Badge>;
    case "cancelled":
      return <Badge variant="outline" data-testid="badge-status-cancelled">Cancelled</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function ShiftTrades() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [respondDialogOpen, setRespondDialogOpen] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState<ShiftTrade | null>(null);
  const [respondNote, setRespondNote] = useState("");
  const [isResponding, setIsResponding] = useState(false);
  const [respondAction, setRespondAction] = useState<"approve" | "decline">("approve");
  const [respondType, setRespondType] = useState<"peer" | "manager">("peer");

  const { data: authStatus } = useQuery<AuthStatus>({ queryKey: ["/api/auth/status"] });
  const { data: trades = [], isLoading: tradesLoading } = useQuery<ShiftTrade[]>({
    queryKey: ["/api/shift-trades"],
    refetchInterval: 15000,
  });
  const { data: employees = [] } = useQuery<Employee[]>({ queryKey: ["/api/employees"] });
  const { data: allShifts = [] } = useQuery<Shift[]>({
    queryKey: ["/api/shifts"],
  });

  const userRole = authStatus?.user?.role ?? "viewer";
  const isManagerOrAdmin = userRole === "manager" || userRole === "admin";

  const currentEmployee = useMemo(() => {
    if (!authStatus?.user?.email) return null;
    return employees.find(e => e.email.toLowerCase() === authStatus.user!.email.toLowerCase()) || null;
  }, [authStatus, employees]);

  const getEmployee = (id: number) => employees.find(e => e.id === id);
  const getShift = (id: number) => allShifts.find(s => s.id === id);

  const filteredTrades = useMemo(() => {
    let result = trades;
    if (statusFilter !== "all") {
      result = result.filter(t => t.status === statusFilter);
    }
    if (!isManagerOrAdmin && currentEmployee) {
      result = result.filter(t => t.requesterId === currentEmployee.id || t.responderId === currentEmployee.id);
    }
    return result;
  }, [trades, statusFilter, isManagerOrAdmin, currentEmployee]);

  const pendingManagerTrades = useMemo(() => 
    trades.filter(t => t.status === "pending_manager"), [trades]);

  const pendingPeerTrades = useMemo(() => {
    if (!currentEmployee) return [];
    return trades.filter(t => t.status === "pending_peer" && t.responderId === currentEmployee.id);
  }, [trades, currentEmployee]);

  const handleOpenRespond = (trade: ShiftTrade, action: "approve" | "decline", type: "peer" | "manager") => {
    setSelectedTrade(trade);
    setRespondAction(action);
    setRespondType(type);
    setRespondNote("");
    setRespondDialogOpen(true);
  };

  const handleRespond = async () => {
    if (!selectedTrade) return;
    setIsResponding(true);
    try {
      const endpoint = respondType === "peer" 
        ? `/api/shift-trades/${selectedTrade.id}/respond`
        : `/api/shift-trades/${selectedTrade.id}/manager-respond`;
      
      await apiRequest("PATCH", endpoint, {
        approved: respondAction === "approve",
        ...(respondType === "peer" ? { responderNote: respondNote || null } : { managerNote: respondNote || null }),
      });

      toast({
        title: respondAction === "approve" ? "Trade Approved" : "Trade Declined",
        description: respondAction === "approve" 
          ? (respondType === "manager" ? "The shifts have been swapped on the schedule." : "The trade is now waiting for manager approval.")
          : "The trade request has been declined.",
      });

      queryClient.invalidateQueries({ queryKey: ["/api/shift-trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      setRespondDialogOpen(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.message || "Failed to respond to trade",
        variant: "destructive",
      });
    } finally {
      setIsResponding(false);
    }
  };

  const handleCancel = async (tradeId: number) => {
    try {
      await apiRequest("DELETE", `/api/shift-trades/${tradeId}`);
      toast({ title: "Trade Cancelled" });
      queryClient.invalidateQueries({ queryKey: ["/api/shift-trades"] });
    } catch (error: any) {
      toast({ title: "Error", description: error?.message || "Failed to cancel", variant: "destructive" });
    }
  };

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <ArrowLeftRight className="w-6 h-6" />
            Shift Trades
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isManagerOrAdmin ? "Review and manage shift trade requests" : "View your shift trade requests"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44" data-testid="select-status-filter">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Trades</SelectItem>
              <SelectItem value="pending_peer">Waiting for Peer</SelectItem>
              <SelectItem value="pending_manager">Waiting for Manager</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="declined_peer">Declined by Peer</SelectItem>
              <SelectItem value="declined_manager">Declined by Manager</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isManagerOrAdmin && pendingManagerTrades.length > 0 && (
        <Card className="border-amber-300 dark:border-amber-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Badge className="bg-amber-500 text-white">{pendingManagerTrades.length}</Badge>
              Trades Awaiting Your Approval
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingManagerTrades.map(trade => {
              const requester = getEmployee(trade.requesterId);
              const responder = getEmployee(trade.responderId);
              const rShift = getShift(trade.requesterShiftId);
              const oShift = getShift(trade.responderShiftId);
              
              return (
                <div key={trade.id} className="flex items-center gap-4 p-3 rounded-lg bg-muted/50 flex-wrap" data-testid={`trade-pending-manager-${trade.id}`}>
                  <div className="flex-1 min-w-48">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <User className="w-4 h-4" />
                      {requester?.name || "Unknown"}
                    </div>
                    {rShift && (
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatInTimeZone(rShift.startTime, TIMEZONE, "EEE MMM d, h:mm a")} - {formatInTimeZone(rShift.endTime, TIMEZONE, "h:mm a")}
                      </div>
                    )}
                  </div>
                  <ArrowLeftRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-48">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <User className="w-4 h-4" />
                      {responder?.name || "Unknown"}
                    </div>
                    {oShift && (
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatInTimeZone(oShift.startTime, TIMEZONE, "EEE MMM d, h:mm a")} - {formatInTimeZone(oShift.endTime, TIMEZONE, "h:mm a")}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button 
                      size="sm" 
                      onClick={() => handleOpenRespond(trade, "approve", "manager")}
                      data-testid={`button-manager-approve-${trade.id}`}
                    >
                      <Check className="w-4 h-4 mr-1" /> Approve
                    </Button>
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => handleOpenRespond(trade, "decline", "manager")}
                      data-testid={`button-manager-decline-${trade.id}`}
                    >
                      <X className="w-4 h-4 mr-1" /> Decline
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {pendingPeerTrades.length > 0 && (
        <Card className="border-blue-300 dark:border-blue-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Badge className="bg-blue-500 text-white">{pendingPeerTrades.length}</Badge>
              Trade Requests for You
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingPeerTrades.map(trade => {
              const requester = getEmployee(trade.requesterId);
              const rShift = getShift(trade.requesterShiftId);
              const oShift = getShift(trade.responderShiftId);
              
              return (
                <div key={trade.id} className="flex items-center gap-4 p-3 rounded-lg bg-muted/50 flex-wrap" data-testid={`trade-pending-peer-${trade.id}`}>
                  <div className="flex-1 min-w-48">
                    <p className="text-sm font-medium">{requester?.name} wants your shift:</p>
                    {oShift && (
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatInTimeZone(oShift.startTime, TIMEZONE, "EEE MMM d, h:mm a")} - {formatInTimeZone(oShift.endTime, TIMEZONE, "h:mm a")}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">In exchange for:</p>
                    {rShift && (
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatInTimeZone(rShift.startTime, TIMEZONE, "EEE MMM d, h:mm a")} - {formatInTimeZone(rShift.endTime, TIMEZONE, "h:mm a")}
                      </div>
                    )}
                    {trade.requesterNote && (
                      <p className="text-xs text-muted-foreground mt-1 italic">"{trade.requesterNote}"</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button 
                      size="sm" 
                      onClick={() => handleOpenRespond(trade, "approve", "peer")}
                      data-testid={`button-peer-approve-${trade.id}`}
                    >
                      <Check className="w-4 h-4 mr-1" /> Accept
                    </Button>
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => handleOpenRespond(trade, "decline", "peer")}
                      data-testid={`button-peer-decline-${trade.id}`}
                    >
                      <X className="w-4 h-4 mr-1" /> Decline
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {statusFilter === "all" ? "All Trade Requests" : `Trade Requests (${statusFilter.replace(/_/g, " ")})`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tradesLoading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
          ) : filteredTrades.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No trade requests found
            </p>
          ) : (
            <div className="space-y-3">
              {filteredTrades.map(trade => {
                const requester = getEmployee(trade.requesterId);
                const responder = getEmployee(trade.responderId);
                const rShift = getShift(trade.requesterShiftId);
                const oShift = getShift(trade.responderShiftId);
                const canCancel = (trade.status === "pending_peer" || trade.status === "pending_manager") &&
                  (currentEmployee?.id === trade.requesterId || isManagerOrAdmin);
                
                return (
                  <div key={trade.id} className="p-4 rounded-lg border flex flex-col gap-3" data-testid={`trade-item-${trade.id}`}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-3 flex-wrap">
                        {getStatusBadge(trade.status)}
                        {requester && (
                          <Badge variant="outline" className="text-xs">
                            {getJobTitle(requester.jobTitle)}
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {trade.createdAt ? formatInTimeZone(new Date(trade.createdAt), TIMEZONE, "MMM d, yyyy h:mm a") : ""}
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-4 flex-wrap">
                      <div className="flex-1 min-w-40">
                        <div className="text-sm font-medium">{requester?.name || "Unknown"}</div>
                        {rShift && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {formatInTimeZone(rShift.startTime, TIMEZONE, "EEE MMM d, h:mm a")} - {formatInTimeZone(rShift.endTime, TIMEZONE, "h:mm a")}
                          </div>
                        )}
                      </div>
                      <ArrowLeftRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-40">
                        <div className="text-sm font-medium">{responder?.name || "Unknown"}</div>
                        {oShift && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {formatInTimeZone(oShift.startTime, TIMEZONE, "EEE MMM d, h:mm a")} - {formatInTimeZone(oShift.endTime, TIMEZONE, "h:mm a")}
                          </div>
                        )}
                      </div>
                    </div>

                    {(trade.requesterNote || trade.responderNote || trade.managerNote) && (
                      <div className="text-xs text-muted-foreground space-y-1">
                        {trade.requesterNote && <p>Requester: "{trade.requesterNote}"</p>}
                        {trade.responderNote && <p>Peer: "{trade.responderNote}"</p>}
                        {trade.managerNote && <p>Manager: "{trade.managerNote}"</p>}
                      </div>
                    )}

                    {canCancel && (
                      <div className="flex justify-end">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => handleCancel(trade.id)}
                          data-testid={`button-cancel-trade-${trade.id}`}
                        >
                          Cancel Trade
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={respondDialogOpen} onOpenChange={setRespondDialogOpen}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-respond-trade">
          <DialogHeader>
            <DialogTitle>
              {respondAction === "approve" ? "Approve" : "Decline"} Shift Trade
            </DialogTitle>
            <DialogDescription>
              {respondType === "manager" 
                ? (respondAction === "approve" 
                    ? "Approving will swap the shifts on the schedule automatically."
                    : "Please provide a reason for declining this trade.")
                : (respondAction === "approve"
                    ? "After you accept, the trade will need manager approval before the shifts are swapped."
                    : "Let the requester know why you're declining.")
              }
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="respond-note" className="text-xs text-muted-foreground uppercase tracking-wider">
                Note (optional)
              </Label>
              <Textarea
                id="respond-note"
                value={respondNote}
                onChange={e => setRespondNote(e.target.value)}
                placeholder={respondAction === "decline" ? "Reason for declining..." : "Any comments..."}
                className="mt-1 resize-none"
                rows={2}
                data-testid="input-respond-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRespondDialogOpen(false)} data-testid="button-cancel-respond">
              Cancel
            </Button>
            <Button 
              onClick={handleRespond} 
              disabled={isResponding}
              variant={respondAction === "decline" ? "destructive" : "default"}
              data-testid="button-confirm-respond"
            >
              {isResponding ? "Processing..." : (respondAction === "approve" ? "Approve" : "Decline")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
