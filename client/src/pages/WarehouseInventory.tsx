import { Fragment, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowRight, Download, Loader2, Plus, TrendingDown, TrendingUp, Minus, History, AlertTriangle, Warehouse as WarehouseIcon, ArrowLeftRight, Trash2, Pencil, ChevronDown, ChevronRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { classifyVariance } from "@/lib/warehouseVariance";

type AdjustmentReason = "salvage_pickup" | "adjustment" | "other";
const ADJUSTMENT_REASONS: AdjustmentReason[] = ["salvage_pickup", "adjustment", "other"];

interface Meta {
  warehouses: string[];
  categories: { group: string; items: string[] }[];
  today: string;
}

interface DashboardWarehouse {
  warehouse: string;
  latest: { id: number; countDate: string; status: string; createdByName: string | null; notes: string | null } | null;
  prior: { id: number; countDate: string } | null;
  items: { itemName: string; groupName: string; qty: number }[];
  priorItems: { itemName: string; qty: number }[];
  totals: { total: number; byGroup: Record<string, number> };
  priorTotals: { total: number; byGroup: Record<string, number> };
  delta: { total: number; byGroup: Record<string, number> };
  variance: { net: number; abs: number; expectedTotal: number; hasExpected: boolean };
  staleDays: number | null;
  onHand: {
    warehouse: string;
    baselineDate: string | null;
    asOfDate: string;
    items: { itemName: string; groupName: string; baseline: number; ordersDelta: number; transfersDelta: number; onHand: number }[];
    totals: {
      onHand: number;
      baseline: number;
      ordersDelta: number;
      transfersDelta: number;
      byGroup: Record<string, { onHand: number; baseline: number; ordersDelta: number; transfersDelta: number }>;
    };
  };
}

interface Dashboard {
  warehouses: DashboardWarehouse[];
  today: string;
}

function DeltaPill({ value }: { value: number }) {
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus;
  const color = value > 0 ? "text-green-600" : value < 0 ? "text-red-600" : "text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-medium ${color}`} data-testid={`text-delta-${value}`}>
      <Icon className="w-3.5 h-3.5" />
      {value > 0 ? "+" : ""}{value}
    </span>
  );
}

function titleCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function WarehouseInventory() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    warehouse: "cleveland",
    countDate: "",
    notes: "",
    copyFromLatest: true,
    prefillFromEngine: true,
  });
  const [trendWarehouse, setTrendWarehouse] = useState("cleveland");
  const [trendItem, setTrendItem] = useState<string>("");

  // Transfer recording UI state
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferMode, setTransferMode] = useState<"paired" | "adjustment">("paired");
  const [editingTransfer, setEditingTransfer] = useState<{ id: number; notes: string; transferDate: string; isPaired: boolean } | null>(null);
  const [expandedHistory, setExpandedHistory] = useState<Set<number>>(new Set());
  const [transferForm, setTransferForm] = useState({
    fromWarehouse: "cleveland",
    toWarehouse: "canton",
    warehouse: "cleveland",
    itemName: "",
    qty: "",
    reason: "adjustment" as AdjustmentReason,
    transferDate: "",
    notes: "",
  });

  const { data: auth } = useQuery<{ user: { id: number; name: string; role: string } | null }>({
    queryKey: ["/api/auth/status"],
  });
  const isAdmin = auth?.user?.role === "admin";

  const { data: meta } = useQuery<Meta>({ queryKey: ["/api/warehouse-inventory/meta"] });
  const { data: dashboard, isLoading, isError, error, refetch } = useQuery<Dashboard>({
    queryKey: ["/api/warehouse-inventory/dashboard"],
  });

  // Set defaults once meta loads
  if (meta && !form.countDate) {
    setForm(f => ({ ...f, countDate: meta.today }));
  }
  if (meta && !transferForm.transferDate) {
    setTransferForm(f => ({ ...f, transferDate: meta.today, itemName: meta.categories[0]?.items[0] || "" }));
  }

  const [transferFilters, setTransferFilters] = useState({
    warehouse: "all",
    createdByName: "all",
    from: "",
    to: "",
  });

  // Unfiltered query used to populate the "Recorded by" dropdown so the list of
  // names doesn't shrink as users apply filters. Limited to a generous slice of
  // recent rows (matches the list endpoint default cap).
  const allTransfersQuery = useQuery<Array<{ createdByName: string | null }>>({
    queryKey: ["/api/warehouse-transfers", "all-names"],
    queryFn: async () => {
      const res = await fetch("/api/warehouse-transfers?limit=500", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load transfers");
      return res.json();
    },
  });
  const recordedByOptions = Array.from(new Set(
    (allTransfersQuery.data || [])
      .map(t => t.createdByName)
      .filter((n): n is string => !!n && n.trim().length > 0),
  )).sort((a, b) => a.localeCompare(b));

  const transfersQuery = useQuery<Array<{ id: number; warehouse: string; transferDate: string; itemName: string; qty: number; reason: string; counterpartyWarehouse: string | null; transferGroupId: string | null; notes: string | null; createdByName: string | null; createdAt: string | null; updatedByName: string | null; updatedAt: string | null }>>({
    queryKey: ["/api/warehouse-transfers", transferFilters],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", "100");
      if (transferFilters.warehouse !== "all") params.set("warehouse", transferFilters.warehouse);
      if (transferFilters.createdByName !== "all") params.set("createdByName", transferFilters.createdByName);
      if (transferFilters.from) params.set("from", transferFilters.from);
      if (transferFilters.to) params.set("to", transferFilters.to);
      const res = await fetch(`/api/warehouse-transfers?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load transfers");
      return res.json();
    },
  });
  const hasActiveFilters = transferFilters.warehouse !== "all"
    || transferFilters.createdByName !== "all"
    || !!transferFilters.from
    || !!transferFilters.to;

  const transferMutation = useMutation({
    mutationFn: async () => {
      const qtyNum = parseInt(transferForm.qty, 10);
      if (!Number.isFinite(qtyNum) || qtyNum === 0) throw new Error("Quantity must be a non-zero number");
      if (transferMode === "paired") {
        if (transferForm.fromWarehouse === transferForm.toWarehouse) {
          throw new Error("Source and destination warehouses must be different");
        }
        if (qtyNum <= 0) throw new Error("Quantity must be positive for inter-warehouse transfers");
        const cat = meta?.categories.find(c => c.items.includes(transferForm.itemName));
        return await apiRequest("POST", "/api/warehouse-transfers", {
          mode: "paired",
          fromWarehouse: transferForm.fromWarehouse,
          toWarehouse: transferForm.toWarehouse,
          itemName: transferForm.itemName,
          groupName: cat?.group || "",
          qty: qtyNum,
          transferDate: transferForm.transferDate,
          notes: transferForm.notes || null,
        });
      }
      // Adjustment mode (single-sided, signed qty allowed)
      const cat = meta?.categories.find(c => c.items.includes(transferForm.itemName));
      return await apiRequest("POST", "/api/warehouse-transfers", {
        warehouse: transferForm.warehouse,
        itemName: transferForm.itemName,
        groupName: cat?.group || "",
        qty: qtyNum,
        reason: transferForm.reason,
        transferDate: transferForm.transferDate,
        notes: transferForm.notes || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse-inventory/dashboard"] });
      setTransferOpen(false);
      setTransferForm(f => ({ ...f, qty: "", notes: "" }));
      toast({ title: "Transfer recorded", description: "Live on-hand updated." });
    },
    onError: async (err: any) => {
      let msg = err?.message || "Failed to record transfer";
      try {
        const text = err?.message?.split(": ").slice(1).join(": ");
        if (text) { const j = JSON.parse(text); msg = j.message || msg; }
      } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const updateTransferMutation = useMutation({
    mutationFn: async ({ id, notes, transferDate }: { id: number; notes: string | null; transferDate?: string }) =>
      apiRequest("PATCH", `/api/warehouse-transfers/${id}`, { notes, transferDate }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse-inventory/dashboard"] });
      // Refresh any open history panel so the new audit row shows immediately
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse-transfers", vars.id, "history"] });
      setEditingTransfer(null);
      toast({ title: "Transfer updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err?.message || "Failed to update", variant: "destructive" }),
  });

  // Admin: audit-log export filters + retention purge
  const [auditExport, setAuditExport] = useState({ warehouse: "all", from: "", to: "" });
  const [purgeRetention, setPurgeRetention] = useState<string>("365");
  const [purgePreview, setPurgePreview] = useState<{ deleted: number; cutoff: string; olderThanDays: number } | null>(null);

  const purgePreviewMutation = useMutation({
    mutationFn: async (olderThanDays: number) => {
      const res = await apiRequest("POST", "/api/warehouse-transfer-audits/purge", { olderThanDays, dryRun: true });
      return res.json() as Promise<{ deleted: number; cutoff: string; olderThanDays: number }>;
    },
    onSuccess: (data) => setPurgePreview(data),
    onError: (err: any) => toast({ title: "Error", description: err?.message || "Failed to preview purge", variant: "destructive" }),
  });

  const purgeMutation = useMutation({
    mutationFn: async (olderThanDays: number) => {
      const res = await apiRequest("POST", "/api/warehouse-transfer-audits/purge", { olderThanDays });
      return res.json() as Promise<{ deleted: number; cutoff: string; olderThanDays: number }>;
    },
    onSuccess: (data) => {
      setPurgePreview(null);
      toast({ title: "Audit log purged", description: `Removed ${data.deleted} row(s) older than ${data.olderThanDays} days.` });
    },
    onError: (err: any) => toast({ title: "Error", description: err?.message || "Failed to purge", variant: "destructive" }),
  });

  const handleAuditExport = () => {
    const params = new URLSearchParams();
    if (auditExport.warehouse !== "all") params.set("warehouse", auditExport.warehouse);
    if (auditExport.from) params.set("from", auditExport.from);
    if (auditExport.to) params.set("to", auditExport.to);
    const qs = params.toString();
    window.location.href = `/api/warehouse-transfer-audits/export.csv${qs ? `?${qs}` : ""}`;
  };

  const deleteTransferMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/warehouse-transfers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse-inventory/dashboard"] });
      toast({ title: "Transfer deleted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err?.message || "Failed to delete", variant: "destructive" }),
  });
  if (meta && !trendItem && meta.categories[0]?.items[0]) {
    setTrendItem(meta.categories[0].items[0]);
  }

  const { data: trend } = useQuery<{ warehouse: string; item: string; series: { date: string; qty: number; status: string }[] }>({
    queryKey: ["/api/warehouse-inventory/trend", trendWarehouse, trendItem],
    queryFn: async () => {
      const url = `/api/warehouse-inventory/trend?warehouse=${encodeURIComponent(trendWarehouse)}&item=${encodeURIComponent(trendItem)}&limit=30`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load trend");
      return res.json();
    },
    enabled: !!trendItem,
  });

  const createMutation = useMutation({
    mutationFn: async (input: typeof form) => {
      const payload = {
        warehouse: input.warehouse,
        countDate: input.countDate,
        notes: input.notes || null,
        copyFromLatest: input.copyFromLatest,
        prefillFromEngine: input.prefillFromEngine,
      };
      return await apiRequest("POST", "/api/warehouse-inventory", payload);
    },
    onSuccess: async (res: any) => {
      const created = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse-inventory/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse-inventory"] });
      setCreateOpen(false);
      toast({ title: "Count started", description: "Prior counts copied in. Adjust and save." });
      setLocation(`/warehouse-inventory/${created.id}`);
    },
    onError: async (err: any) => {
      let msg = err?.message || "Failed to create count";
      try {
        const text = err?.message?.split(": ").slice(1).join(": ");
        if (text) { const j = JSON.parse(text); msg = j.message || msg; }
      } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const handleExport = () => {
    window.location.href = `/api/warehouse-inventory/export.csv`;
  };

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6 flex items-center gap-3 text-destructive">
            <AlertTriangle className="w-5 h-5" />
            <div>
              <p className="font-semibold">Failed to load warehouse dashboard</p>
              <p className="text-sm">{(error as Error)?.message}</p>
            </div>
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => refetch()} data-testid="button-retry">Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-page-title">Warehouse Inventory</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Daily counts across Cleveland and Canton — at-a-glance totals, deltas, and trends for leadership.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href="/warehouse-inventory/list">
            <Button variant="outline" data-testid="button-history">
              <History className="w-4 h-4 mr-2" /> History
            </Button>
          </Link>
          <Button variant="outline" onClick={handleExport} data-testid="button-export">
            <Download className="w-4 h-4 mr-2" /> Export CSV
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-count">
                <Plus className="w-4 h-4 mr-2" /> New Count
              </Button>
            </DialogTrigger>
            <DialogContent data-testid="dialog-new-count">
              <DialogHeader>
                <DialogTitle>Start a New Count</DialogTitle>
                <DialogDescription>
                  Pick the warehouse and date. Values pre-fill from the most recent count for fast entry.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Warehouse</Label>
                  <Select value={form.warehouse} onValueChange={v => setForm(f => ({ ...f, warehouse: v }))}>
                    <SelectTrigger data-testid="select-warehouse"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(meta?.warehouses || []).map(w => (
                        <SelectItem key={w} value={w} data-testid={`option-warehouse-${w}`}>{titleCase(w)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={form.countDate}
                    onChange={e => setForm(f => ({ ...f, countDate: e.target.value }))}
                    data-testid="input-count-date"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Notes (optional)</Label>
                  <Textarea
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="Anything leadership should know about today's count?"
                    data-testid="input-notes"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.prefillFromEngine}
                    onChange={e => setForm(f => ({ ...f, prefillFromEngine: e.target.checked }))}
                    data-testid="checkbox-prefill-engine"
                  />
                  Pre-fill from running on-hand (recommended) — last count + orders + transfers
                </label>
                {!form.prefillFromEngine && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.copyFromLatest}
                      onChange={e => setForm(f => ({ ...f, copyFromLatest: e.target.checked }))}
                      data-testid="checkbox-copy-prior"
                    />
                    Otherwise, copy quantities verbatim from the most recent prior count
                  </label>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)} data-testid="button-cancel">Cancel</Button>
                <Button
                  onClick={() => createMutation.mutate(form)}
                  disabled={createMutation.isPending || !form.countDate}
                  data-testid="button-create-count"
                >
                  {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Start Count
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Leadership cards */}
      <div className="grid md:grid-cols-2 gap-4">
        {dashboard?.warehouses.map(w => (
          <Card key={w.warehouse} className="overflow-hidden" data-testid={`card-warehouse-${w.warehouse}`}>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <WarehouseIcon className="w-5 h-5 text-primary" />
                  {titleCase(w.warehouse)}
                </CardTitle>
                <CardDescription>
                  {w.latest
                    ? <>Latest count: <span data-testid={`text-latest-date-${w.warehouse}`}>{w.latest.countDate}</span> {w.staleDays != null && w.staleDays > 1 && (
                        <Badge variant="destructive" className="ml-2" data-testid={`badge-stale-${w.warehouse}`}>Stale · {w.staleDays}d</Badge>
                      )}</>
                    : "No counts recorded yet"}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {w.latest && (() => {
                  const level = classifyVariance(w.variance);
                  if (level === "high") {
                    return (
                      <Badge variant="destructive" data-testid={`badge-variance-${w.warehouse}`}>
                        <AlertTriangle className="w-3.5 h-3.5 mr-1" /> High variance ±{w.variance.abs}
                      </Badge>
                    );
                  }
                  if (level === "moderate") {
                    return (
                      <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400" data-testid={`badge-variance-${w.warehouse}`}>
                        Variance ±{w.variance.abs}
                      </Badge>
                    );
                  }
                  return null;
                })()}
                {w.latest && (
                  <Badge variant={w.latest.status === "final" ? "default" : "secondary"} data-testid={`badge-status-${w.warehouse}`}>
                    {w.latest.status === "final" ? "Finalized" : "Draft"}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {!w.latest ? (
                <Button
                  onClick={() => {
                    setForm(f => ({ ...f, warehouse: w.warehouse }));
                    setCreateOpen(true);
                  }}
                  data-testid={`button-start-${w.warehouse}`}
                >
                  <Plus className="w-4 h-4 mr-2" /> Start first count
                </Button>
              ) : (
                <>
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <div className="text-4xl font-bold" data-testid={`text-total-${w.warehouse}`}>{w.totals.total.toLocaleString()}</div>
                    <div className="text-sm text-muted-foreground">total items</div>
                    {w.prior && <DeltaPill value={w.delta.total} />}
                    <div className="text-xs text-muted-foreground" data-testid={`text-variance-${w.warehouse}`}>
                      variance vs system:{" "}
                      {w.variance.hasExpected ? (
                        <span className={
                          classifyVariance(w.variance) === "high"
                            ? "text-red-600 dark:text-red-400 font-semibold"
                            : classifyVariance(w.variance) === "moderate"
                              ? "text-amber-600 dark:text-amber-400 font-medium"
                              : "text-foreground"
                        }>
                          {w.variance.net > 0 ? "+" : ""}{w.variance.net} net · ±{w.variance.abs} abs
                          {w.variance.expectedTotal > 0 && (
                            <> ({Math.round((w.variance.abs / w.variance.expectedTotal) * 1000) / 10}% off)</>
                          )}
                        </span>
                      ) : (
                        <span>—</span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {Object.entries(w.totals.byGroup).map(([g, qty]) => (
                      <div key={g} className="flex items-center justify-between border rounded-none px-3 py-2 bg-muted/30" data-testid={`row-group-${w.warehouse}-${g}`}>
                        <span className="font-medium">{g}</span>
                        <span className="flex items-center gap-2">
                          <span className="font-semibold">{qty}</span>
                          {w.prior && <DeltaPill value={w.delta.byGroup[g] || 0} />}
                        </span>
                      </div>
                    ))}
                  </div>
                  {w.onHand && (
                    <div className="border-t pt-3 mt-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Live On-Hand (today)
                        </div>
                        <div className="text-xs text-muted-foreground" data-testid={`text-onhand-baseline-${w.warehouse}`}>
                          baseline {w.onHand.baselineDate || "—"}
                        </div>
                      </div>
                      <div className="flex items-baseline gap-3">
                        <div className="text-2xl font-bold" data-testid={`text-onhand-total-${w.warehouse}`}>
                          {w.onHand.totals.onHand.toLocaleString()}
                        </div>
                        <div className="flex gap-3 text-xs text-muted-foreground">
                          <span>orders <span className={w.onHand.totals.ordersDelta > 0 ? "text-green-600" : w.onHand.totals.ordersDelta < 0 ? "text-red-600" : ""}>
                            {w.onHand.totals.ordersDelta > 0 ? "+" : ""}{w.onHand.totals.ordersDelta}
                          </span></span>
                          <span>transfers <span className={w.onHand.totals.transfersDelta > 0 ? "text-green-600" : w.onHand.totals.transfersDelta < 0 ? "text-red-600" : ""}>
                            {w.onHand.totals.transfersDelta > 0 ? "+" : ""}{w.onHand.totals.transfersDelta}
                          </span></span>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="flex justify-between items-center pt-2">
                    <div className="text-xs text-muted-foreground">
                      {w.prior ? <>vs {w.prior.countDate} ({w.priorTotals.total.toLocaleString()} items)</> : "No prior count to compare"}
                    </div>
                    <Link href={`/warehouse-inventory/${w.latest.id}`}>
                      <Button variant="ghost" size="sm" data-testid={`button-open-${w.warehouse}`}>
                        Open <ArrowRight className="w-4 h-4 ml-1" />
                      </Button>
                    </Link>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Transfers */}
      <Card data-testid="card-transfers">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ArrowLeftRight className="w-5 h-5 text-primary" />
              Warehouse Transfers
            </CardTitle>
            <CardDescription>
              Move stock between Cleveland and Canton, or post adjustments and salvage pickups. Inter-warehouse moves post both sides at once.
            </CardDescription>
          </div>
          <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-record-transfer">
                <Plus className="w-4 h-4 mr-2" /> Record Transfer
              </Button>
            </DialogTrigger>
            <DialogContent data-testid="dialog-transfer">
              <DialogHeader>
                <DialogTitle>Record a Warehouse Transfer</DialogTitle>
                <DialogDescription>
                  Choose inter-warehouse to move stock between Cleveland & Canton (both sides post atomically), or adjustment for salvage/write-offs.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={transferMode === "paired" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTransferMode("paired")}
                    data-testid="button-mode-paired"
                  >
                    Inter-warehouse
                  </Button>
                  <Button
                    type="button"
                    variant={transferMode === "adjustment" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTransferMode("adjustment")}
                    data-testid="button-mode-adjustment"
                  >
                    Adjustment / Salvage
                  </Button>
                </div>

                {transferMode === "paired" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>From</Label>
                      <Select
                        value={transferForm.fromWarehouse}
                        onValueChange={v => setTransferForm(f => ({ ...f, fromWarehouse: v }))}
                      >
                        <SelectTrigger data-testid="select-from-warehouse"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(meta?.warehouses || []).map(w => (
                            <SelectItem key={w} value={w}>{titleCase(w)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>To</Label>
                      <Select
                        value={transferForm.toWarehouse}
                        onValueChange={v => setTransferForm(f => ({ ...f, toWarehouse: v }))}
                      >
                        <SelectTrigger data-testid="select-to-warehouse"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(meta?.warehouses || []).map(w => (
                            <SelectItem key={w} value={w}>{titleCase(w)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Warehouse</Label>
                      <Select
                        value={transferForm.warehouse}
                        onValueChange={v => setTransferForm(f => ({ ...f, warehouse: v }))}
                      >
                        <SelectTrigger data-testid="select-adjust-warehouse"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(meta?.warehouses || []).map(w => (
                            <SelectItem key={w} value={w}>{titleCase(w)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Reason</Label>
                      <Select
                        value={transferForm.reason}
                        onValueChange={v => {
                          const r = ADJUSTMENT_REASONS.find(ar => ar === v);
                          if (r) setTransferForm(f => ({ ...f, reason: r }));
                        }}
                      >
                        <SelectTrigger data-testid="select-reason"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="adjustment">Adjustment</SelectItem>
                          <SelectItem value="salvage_pickup">Salvage Pickup</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Item</Label>
                    <Select
                      value={transferForm.itemName}
                      onValueChange={v => setTransferForm(f => ({ ...f, itemName: v }))}
                    >
                      <SelectTrigger data-testid="select-transfer-item"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(meta?.categories || []).map(cat => (
                          <div key={cat.group}>
                            <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">{cat.group}</div>
                            {cat.items.map(item => (
                              <SelectItem key={item} value={item}>{item}</SelectItem>
                            ))}
                          </div>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>{transferMode === "paired" ? "Quantity (positive)" : "Quantity (signed: +in / −out)"}</Label>
                    <Input
                      type="number"
                      value={transferForm.qty}
                      onChange={e => setTransferForm(f => ({ ...f, qty: e.target.value }))}
                      placeholder={transferMode === "paired" ? "e.g. 50" : "e.g. -10"}
                      data-testid="input-transfer-qty"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={transferForm.transferDate}
                    onChange={e => setTransferForm(f => ({ ...f, transferDate: e.target.value }))}
                    data-testid="input-transfer-date"
                  />
                </div>

                <div className="space-y-1">
                  <Label>Notes (optional)</Label>
                  <Textarea
                    value={transferForm.notes}
                    onChange={e => setTransferForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="Why this transfer? Reference, driver, etc."
                    data-testid="input-transfer-notes"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setTransferOpen(false)} data-testid="button-transfer-cancel">Cancel</Button>
                <Button
                  onClick={() => transferMutation.mutate()}
                  disabled={transferMutation.isPending || !transferForm.itemName || !transferForm.qty || !transferForm.transferDate}
                  data-testid="button-transfer-submit"
                >
                  {transferMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Record Transfer
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3 mb-4 pb-4 border-b">
            <div className="space-y-1">
              <Label className="text-xs">Warehouse</Label>
              <Select
                value={transferFilters.warehouse}
                onValueChange={v => setTransferFilters(f => ({ ...f, warehouse: v }))}
              >
                <SelectTrigger className="w-40 h-9" data-testid="select-filter-warehouse"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All warehouses</SelectItem>
                  {(meta?.warehouses || []).map(w => (
                    <SelectItem key={w} value={w} data-testid={`option-filter-warehouse-${w}`}>{titleCase(w)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Recorded by</Label>
              <Select
                value={transferFilters.createdByName}
                onValueChange={v => setTransferFilters(f => ({ ...f, createdByName: v }))}
              >
                <SelectTrigger className="w-52 h-9" data-testid="select-filter-created-by"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Anyone</SelectItem>
                  {recordedByOptions.map(name => (
                    <SelectItem key={name} value={name} data-testid={`option-filter-created-by-${name}`}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                className="w-40 h-9"
                value={transferFilters.from}
                onChange={e => setTransferFilters(f => ({ ...f, from: e.target.value }))}
                data-testid="input-filter-from"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                className="w-40 h-9"
                value={transferFilters.to}
                onChange={e => setTransferFilters(f => ({ ...f, to: e.target.value }))}
                data-testid="input-filter-to"
              />
            </div>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setTransferFilters({ warehouse: "all", createdByName: "all", from: "", to: "" })}
                data-testid="button-clear-filters"
              >
                Clear
              </Button>
            )}
          </div>
          {transfersQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading transfers…</div>
          ) : !transfersQuery.data || transfersQuery.data.length === 0 ? (
            <div className="text-sm text-muted-foreground" data-testid="text-no-transfers">
              {hasActiveFilters ? "No transfers match these filters." : "No transfers recorded yet."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Warehouse</th>
                    <th className="py-2 pr-3">Item</th>
                    <th className="py-2 pr-3 text-right">Qty</th>
                    <th className="py-2 pr-3">Reason</th>
                    <th className="py-2 pr-3">By</th>
                    <th className="py-2 pr-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {transfersQuery.data.map(t => {
                    const isExpanded = expandedHistory.has(t.id);
                    return (
                  <Fragment key={t.id}>
                    <tr className="border-b last:border-0 hover-elevate" data-testid={`row-transfer-${t.id}`}>
                      <td className="py-2 pr-3">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:underline"
                          onClick={() => setExpandedHistory(s => {
                            const n = new Set(s);
                            if (n.has(t.id)) n.delete(t.id); else n.add(t.id);
                            return n;
                          })}
                          data-testid={`button-toggle-history-${t.id}`}
                          aria-expanded={isExpanded}
                          aria-label="Toggle edit history"
                        >
                          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          {t.transferDate}
                        </button>
                      </td>
                      <td className="py-2 pr-3">
                        {titleCase(t.warehouse)}
                        {t.counterpartyWarehouse && (
                          <span className="text-muted-foreground"> ↔ {titleCase(t.counterpartyWarehouse)}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">{t.itemName}</td>
                      <td className={`py-2 pr-3 text-right font-mono ${t.qty > 0 ? "text-green-600" : "text-red-600"}`}>
                        {t.qty > 0 ? "+" : ""}{t.qty}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">{t.reason.replace(/_/g, " ")}</td>
                      <td className="py-2 pr-3 text-muted-foreground" data-testid={`text-transfer-by-${t.id}`}>
                        <div>{t.createdByName || "—"}</div>
                        {t.updatedByName && t.updatedAt && (
                          <div
                            className="text-xs italic"
                            title={`Edited ${new Date(t.updatedAt).toLocaleString()}`}
                            data-testid={`text-transfer-edited-by-${t.id}`}
                          >
                            edited by {t.updatedByName}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right space-x-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingTransfer({
                            id: t.id,
                            notes: t.notes ?? "",
                            transferDate: t.transferDate,
                            isPaired: !!t.transferGroupId,
                          })}
                          data-testid={`button-edit-transfer-${t.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (confirm(t.transferGroupId
                              ? "This is one half of a paired inter-warehouse transfer. Deleting it will also remove the matching row on the other warehouse. Continue?"
                              : "Delete this transfer? Live on-hand will recalculate.")) {
                              deleteTransferMutation.mutate(t.id);
                            }
                          }}
                          disabled={deleteTransferMutation.isPending}
                          data-testid={`button-delete-transfer-${t.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b last:border-0 bg-muted/20" data-testid={`row-history-${t.id}`}>
                        <td colSpan={7} className="py-3 px-3">
                          <TransferHistory transferId={t.id} createdByName={t.createdByName} createdAt={t.createdAt} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                  );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Admin: Transfer Audit Log management */}
      {isAdmin && (
        <Card data-testid="card-audit-log-admin">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="w-5 h-5 text-primary" />
              Transfer Audit Log
            </CardTitle>
            <CardDescription>
              Export the full edit/delete history of warehouse transfers, or trim rows older than a chosen retention window. Admin only.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Export to CSV</Label>
              <div className="flex flex-wrap gap-3 items-end">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Warehouse</Label>
                  <Select value={auditExport.warehouse} onValueChange={v => setAuditExport(s => ({ ...s, warehouse: v }))}>
                    <SelectTrigger className="w-40" data-testid="select-audit-export-warehouse"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All warehouses</SelectItem>
                      {(meta?.warehouses || []).map(w => (
                        <SelectItem key={w} value={w}>{titleCase(w)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <Input type="date" className="w-40" value={auditExport.from} onChange={e => setAuditExport(s => ({ ...s, from: e.target.value }))} data-testid="input-audit-export-from" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <Input type="date" className="w-40" value={auditExport.to} onChange={e => setAuditExport(s => ({ ...s, to: e.target.value }))} data-testid="input-audit-export-to" />
                </div>
                <Button variant="outline" onClick={handleAuditExport} data-testid="button-audit-export">
                  <Download className="w-4 h-4 mr-2" /> Download CSV
                </Button>
              </div>
            </div>
            <div className="space-y-2 border-t pt-4">
              <Label>Purge old entries</Label>
              <div className="flex flex-wrap gap-3 items-end">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Retention (days)</Label>
                  <Input
                    type="number"
                    min={30}
                    max={3650}
                    className="w-32"
                    value={purgeRetention}
                    onChange={e => { setPurgeRetention(e.target.value); setPurgePreview(null); }}
                    data-testid="input-purge-days"
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    const n = parseInt(purgeRetention, 10);
                    if (!Number.isFinite(n) || n < 30) {
                      toast({ title: "Retention too short", description: "Use at least 30 days.", variant: "destructive" });
                      return;
                    }
                    purgePreviewMutation.mutate(n);
                  }}
                  disabled={purgePreviewMutation.isPending}
                  data-testid="button-purge-preview"
                >
                  {purgePreviewMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Preview
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="destructive"
                      disabled={!purgePreview || purgePreview.deleted === 0 || purgeMutation.isPending}
                      data-testid="button-purge-confirm-open"
                    >
                      {purgeMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                      Purge {purgePreview?.deleted ?? 0} row(s)
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Purge audit log?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete {purgePreview?.deleted ?? 0} audit row(s) older than {purgePreview?.olderThanDays ?? 0} days
                        (cutoff {purgePreview ? new Date(purgePreview.cutoff).toLocaleString() : ""}). This cannot be undone — export to CSV first if you need a copy.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          if (purgePreview) purgeMutation.mutate(purgePreview.olderThanDays);
                        }}
                        data-testid="button-purge-confirm"
                      >
                        Purge
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
              {purgePreview && (
                <p className="text-sm text-muted-foreground" data-testid="text-purge-preview">
                  {purgePreview.deleted === 0
                    ? `No audit rows older than ${purgePreview.olderThanDays} days.`
                    : `${purgePreview.deleted} row(s) older than ${purgePreview.olderThanDays} days will be removed (cutoff ${new Date(purgePreview.cutoff).toLocaleString()}).`}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Trend chart */}
      <Card>
        <CardHeader>
          <CardTitle>Trend</CardTitle>
          <CardDescription>Track one item across recent counts.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="space-y-1">
              <Label>Warehouse</Label>
              <Select value={trendWarehouse} onValueChange={setTrendWarehouse}>
                <SelectTrigger className="w-40" data-testid="select-trend-warehouse"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(meta?.warehouses || []).map(w => (
                    <SelectItem key={w} value={w}>{titleCase(w)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Item</Label>
              <Select value={trendItem} onValueChange={setTrendItem}>
                <SelectTrigger className="w-64" data-testid="select-trend-item"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(meta?.categories || []).map(cat => (
                    <div key={cat.group}>
                      <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">{cat.group}</div>
                      {cat.items.map(item => (
                        <SelectItem key={item} value={item}>{item}</SelectItem>
                      ))}
                    </div>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="h-64 w-full" data-testid="chart-trend">
            {trend && trend.series.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend.series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 0,
                    }}
                  />
                  <Line type="monotone" dataKey="qty" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Not enough data yet.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Edit transfer dialog */}
      <Dialog open={!!editingTransfer} onOpenChange={(o) => !o && setEditingTransfer(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Transfer</DialogTitle>
            <DialogDescription>
              {editingTransfer?.isPaired
                ? "This is a paired inter-warehouse transfer. Notes and date will update on BOTH halves."
                : "Update notes or date for this transfer. Quantity/item are immutable — delete and re-record to change them."}
            </DialogDescription>
          </DialogHeader>
          {editingTransfer && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={editingTransfer.transferDate}
                  onChange={e => setEditingTransfer(t => t ? { ...t, transferDate: e.target.value } : t)}
                  data-testid="input-edit-transfer-date"
                />
              </div>
              <div className="space-y-1">
                <Label>Notes</Label>
                <Textarea
                  rows={3}
                  value={editingTransfer.notes}
                  onChange={e => setEditingTransfer(t => t ? { ...t, notes: e.target.value } : t)}
                  data-testid="input-edit-transfer-notes"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingTransfer(null)} data-testid="button-cancel-edit-transfer">Cancel</Button>
            <Button
              onClick={() => editingTransfer && updateTransferMutation.mutate({
                id: editingTransfer.id,
                notes: editingTransfer.notes.trim() || null,
                transferDate: editingTransfer.transferDate,
              })}
              disabled={updateTransferMutation.isPending}
              data-testid="button-save-edit-transfer"
            >
              {updateTransferMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface AuditEntry {
  id: number;
  transferId: number;
  transferGroupId: string | null;
  action: "update" | "delete" | string;
  changedById: number | null;
  changedByName: string | null;
  changedAt: string;
  changes: Record<string, { before: unknown; after: unknown }>;
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

const FIELD_LABELS: Record<string, string> = {
  notes: "Notes",
  transferDate: "Date",
  warehouse: "Warehouse",
  itemName: "Item",
  qty: "Qty",
  reason: "Reason",
};

function TransferHistory({
  transferId,
  createdByName,
  createdAt,
}: {
  transferId: number;
  createdByName: string | null;
  createdAt: string | null;
}) {
  const { data, isLoading, isError } = useQuery<AuditEntry[]>({
    queryKey: ["/api/warehouse-transfers", transferId, "history"],
    queryFn: async () => {
      const res = await fetch(`/api/warehouse-transfers/${transferId}/history`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load history");
      return res.json();
    },
  });
  if (isLoading) {
    return <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading edit history…</div>;
  }
  if (isError) {
    return <div className="text-xs text-destructive">Failed to load edit history.</div>;
  }
  return (
    <div className="space-y-2" data-testid={`history-list-${transferId}`}>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Edit History</div>
      {(data || []).length === 0 ? (
        <div className="text-xs text-muted-foreground" data-testid={`history-empty-${transferId}`}>
          No edits recorded — only the original entry exists.
        </div>
      ) : (
        <ul className="space-y-2">
          {(data || []).map(a => (
            <li key={a.id} className="border-l-2 border-border pl-3 text-xs" data-testid={`history-entry-${a.id}`}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium capitalize">{a.action}</span>
                <span className="text-muted-foreground">
                  by {a.changedByName || "—"} · {new Date(a.changedAt).toLocaleString()}
                </span>
                {a.transferId !== transferId && (
                  <span className="text-muted-foreground italic">(paired side #{a.transferId})</span>
                )}
              </div>
              <ul className="mt-1 space-y-0.5">
                {Object.entries(a.changes).map(([field, diff]) => (
                  <li key={field} className="font-mono text-[11px]">
                    <span className="text-muted-foreground">{FIELD_LABELS[field] || field}:</span>{" "}
                    <span className="line-through text-red-600 dark:text-red-400">{fmtVal(diff.before)}</span>
                    {a.action !== "delete" && (
                      <>
                        {" → "}
                        <span className="text-green-600 dark:text-green-400">{fmtVal(diff.after)}</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <div className="text-xs text-muted-foreground pt-1 border-t" data-testid={`history-created-${transferId}`}>
        Originally recorded by {createdByName || "—"}
        {createdAt ? ` on ${new Date(createdAt).toLocaleString()}` : ""}.
      </div>
    </div>
  );
}
