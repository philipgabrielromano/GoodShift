import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePermissions } from "@/hooks/use-permissions";
import { Link, useParams, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import {
  ArrowLeft, Loader2, Save, CheckCircle2, Lock, Unlock, Trash2,
  TrendingUp, TrendingDown, Minus, AlertTriangle, Warehouse as WarehouseIcon,
  Info, Download, Mail, History as HistoryIcon, ChevronDown, ChevronRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface CountRow { id: number; warehouse: string; countDate: string; status: string; notes: string | null; createdByName: string | null; finalizedByName: string | null; finalizedAt: string | null; }
interface Item { id: number; groupName: string; itemName: string; qty: number; expectedQty: number | null; }
interface Detail {
  count: CountRow;
  items: Item[];
  prior: CountRow | null;
  priorItems: Item[];
  categories: { group: string; items: string[] }[];
  // Live system-expected on-hand per item (only present for non-final counts).
  // For finalized counts, use Item.expectedQty (snapshotted at finalize time).
  expectedMap?: Record<string, number>;
  // True when per-warehouse variance email recipients are configured in
  // Settings; gates the "Email CSV" button.
  hasEmailRecipients?: boolean;
}
interface AuthStatus { user: { id: number; name: string; role: string } | null; }

function titleCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface CountAuditEntry {
  id: number;
  countId: number;
  itemName: string | null;
  action: "update" | "finalize" | "reopen" | string;
  changedById: number | null;
  changedByName: string | null;
  changedAt: string;
  changes: Record<string, { before: unknown; after: unknown }>;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMo = Math.round(diffDay / 30);
  if (diffMo < 12) return `${diffMo}mo ago`;
  return `${Math.round(diffMo / 12)}y ago`;
}

const HISTORY_QUERY_FN = async ({ queryKey }: { queryKey: readonly unknown[] }): Promise<CountAuditEntry[]> => {
  const countId = queryKey[1];
  const res = await fetch(`/api/warehouse-inventory/${countId}/history`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load history");
  return res.json();
};

function Delta({ value }: { value: number }) {
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus;
  const color = value > 0 ? "text-green-600" : value < 0 ? "text-red-600" : "text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${color}`}>
      <Icon className="w-3 h-3" />{value > 0 ? "+" : ""}{value}
    </span>
  );
}

export default function WarehouseInventoryDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: auth } = useQuery<AuthStatus>({ queryKey: ["/api/auth/status"] });
  const role = auth?.user?.role;
  const { can } = usePermissions();
  const canReopen = can("warehouse_inventory.finalize");

  const { data, isLoading, isError, error, refetch } = useQuery<Detail>({
    queryKey: ["/api/warehouse-inventory", id],
  });

  const { data: history } = useQuery<CountAuditEntry[]>({
    queryKey: ["/api/warehouse-inventory", id, "history"],
    queryFn: HISTORY_QUERY_FN,
    enabled: Number.isFinite(id),
  });

  const itemEditsMap = useMemo(() => {
    const m: Record<string, CountAuditEntry[]> = {};
    (history || []).forEach(e => {
      if (e.action === "update" && e.itemName) {
        (m[e.itemName] ||= []).push(e);
      }
    });
    Object.values(m).forEach(list =>
      list.sort((a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime())
    );
    return m;
  }, [history]);

  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  // Local editable state for quantities and notes
  const [qty, setQty] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<string>("");
  const [hydratedForId, setHydratedForId] = useState<number | null>(null);

  useEffect(() => {
    if (data && data.count.id !== hydratedForId) {
      const next: Record<string, string> = {};
      data.items.forEach(it => { next[it.itemName] = String(it.qty); });
      setQty(next);
      setNotes(data.count.notes || "");
      setHydratedForId(data.count.id);
    }
  }, [data, hydratedForId]);

  const [varianceOnly, setVarianceOnly] = useState(false);

  const priorMap = useMemo(() => {
    const m: Record<string, number> = {};
    (data?.priorItems || []).forEach(it => { m[it.itemName] = it.qty; });
    return m;
  }, [data]);

  const isFinal = data?.count.status === "final";
  const readOnly = isFinal;

  // Map of system-expected per item (snapshotted on finalize, live otherwise).
  const expectedMap = useMemo(() => {
    const m: Record<string, number | null> = {};
    (data?.items || []).forEach(it => {
      m[it.itemName] = isFinal
        ? (it.expectedQty ?? null)
        : (data?.expectedMap?.[it.itemName] ?? null);
    });
    return m;
  }, [data, isFinal]);

  const totals = useMemo(() => {
    const byGroup: Record<string, number> = {};
    const expectedByGroup: Record<string, number> = {};
    const varianceByGroup: Record<string, number> = {};
    const hasExpectedByGroup: Record<string, boolean> = {};
    let total = 0;
    let expectedTotal = 0;
    let varianceTotal = 0;
    let hasAnyExpected = false;
    (data?.categories || []).forEach(cat => {
      cat.items.forEach(item => {
        const n = Number(qty[item] ?? 0) || 0;
        byGroup[cat.group] = (byGroup[cat.group] || 0) + n;
        total += n;
        const exp = expectedMap[item];
        if (exp != null) {
          expectedByGroup[cat.group] = (expectedByGroup[cat.group] || 0) + exp;
          varianceByGroup[cat.group] = (varianceByGroup[cat.group] || 0) + (n - exp);
          expectedTotal += exp;
          varianceTotal += n - exp;
          hasExpectedByGroup[cat.group] = true;
          hasAnyExpected = true;
        }
      });
    });
    return {
      byGroup, total,
      expectedByGroup, expectedTotal,
      varianceByGroup, varianceTotal,
      hasExpectedByGroup, hasAnyExpected,
    };
  }, [qty, data, expectedMap]);

  const itemsWithVarianceCount = useMemo(() => {
    let n = 0;
    (data?.categories || []).forEach(cat => {
      cat.items.forEach(item => {
        const exp = expectedMap[item];
        const cur = Number(qty[item] ?? 0) || 0;
        if (exp != null && cur - exp !== 0) n++;
      });
    });
    return n;
  }, [data, qty, expectedMap]);

  const priorTotal = (data?.priorItems || []).reduce((a, b) => a + b.qty, 0);

  const handleExportEditLog = async () => {
    if (!data) return;
    const c = data.count;
    const esc = (v: unknown) => {
      let s = v == null ? "" : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    let entries: CountAuditEntry[] = [];
    try {
      entries = await queryClient.fetchQuery<CountAuditEntry[]>({
        queryKey: ["/api/warehouse-inventory", id, "history"],
        queryFn: HISTORY_QUERY_FN,
      });
    } catch (err: any) {
      toast({ title: "Download failed", description: err?.message || "Could not load edit log", variant: "destructive" });
      return;
    }
    // Oldest-first reads more naturally as an audit trail.
    const ordered = [...entries].sort(
      (a, b) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime(),
    );
    const lines: string[] = [];
    lines.push(`# Warehouse count edit log`);
    lines.push(`# Warehouse,${esc(titleCase(c.warehouse))}`);
    lines.push(`# Count date,${esc(c.countDate)}`);
    lines.push(`# Count id,${esc(c.id)}`);
    lines.push(`# Exported at,${esc(new Date().toISOString())}`);
    lines.push("");
    lines.push(["Date/Time", "User", "Action", "Item", "Qty before", "Qty after"].join(","));
    ordered.forEach(a => {
      const qtyDiff = a.changes?.qty as { before: unknown; after: unknown } | undefined;
      lines.push([
        esc(new Date(a.changedAt).toISOString()),
        esc(a.changedByName || ""),
        esc(a.action),
        esc(a.itemName || ""),
        qtyDiff?.before == null ? "" : esc(String(qtyDiff.before)),
        qtyDiff?.after == null ? "" : esc(String(qtyDiff.after)),
      ].join(","));
    });
    const csv = lines.join("\r\n") + "\r\n";
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeWarehouse = c.warehouse.replace(/[^a-z0-9-]+/gi, "-");
    a.download = `warehouse-count-edit-log-${safeWarehouse}-${c.countDate}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportCsv = () => {
    if (!data) return;
    const c = data.count;
    const esc = (v: unknown) => {
      let s = v == null ? "" : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines: string[] = [];
    lines.push(`# Warehouse count export`);
    lines.push(`# Warehouse,${esc(titleCase(c.warehouse))}`);
    lines.push(`# Count date,${esc(c.countDate)}`);
    lines.push(`# Status,${esc(isFinal ? "Finalized" : "Draft")}`);
    lines.push(`# Started by,${esc(c.createdByName || "")}`);
    lines.push(`# Finalized by,${esc(c.finalizedByName || "")}`);
    lines.push(`# Finalized at,${esc(c.finalizedAt || "")}`);
    lines.push(`# Expected source,${esc(isFinal ? "snapshot at finalize" : "live system")}`);
    lines.push(`# Exported at,${esc(new Date().toISOString())}`);
    lines.push("");
    lines.push(["Group", "Item", "Expected", "Counted", "Variance"].join(","));
    data.categories.forEach(cat => {
      cat.items.forEach(item => {
        const counted = Math.max(0, Math.floor(Number(qty[item] ?? 0) || 0));
        const expected = expectedMap[item];
        const variance = expected != null ? counted - expected : null;
        lines.push([
          esc(cat.group),
          esc(item),
          expected == null ? "" : String(expected),
          String(counted),
          variance == null ? "" : String(variance),
        ].join(","));
      });
    });
    const csv = lines.join("\r\n") + "\r\n";
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeWarehouse = c.warehouse.replace(/[^a-z0-9-]+/gi, "-");
    a.download = `warehouse-count-${safeWarehouse}-${c.countDate}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const items = Object.entries(qty).map(([itemName, v]) => ({
        itemName,
        qty: Math.max(0, Math.floor(Number(v) || 0)),
      }));
      await apiRequest("PUT", `/api/warehouse-inventory/${id}/items`, { items });
      await apiRequest("PUT", `/api/warehouse-inventory/${id}`, { notes: notes || null });
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "Count updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse-inventory", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse-inventory", id, "history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse-inventory/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse-inventory"] });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err?.message || "Error", variant: "destructive" }),
  });

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      // Save first, then finalize
      const items = Object.entries(qty).map(([itemName, v]) => ({
        itemName, qty: Math.max(0, Math.floor(Number(v) || 0)),
      }));
      await apiRequest("PUT", `/api/warehouse-inventory/${id}/items`, { items });
      await apiRequest("PUT", `/api/warehouse-inventory/${id}`, { notes: notes || null });
      await apiRequest("POST", `/api/warehouse-inventory/${id}/finalize`);
    },
    onSuccess: () => {
      toast({ title: "Finalized", description: "Count is now locked." });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse-inventory", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse-inventory", id, "history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse-inventory/dashboard"] });
    },
    onError: (err: any) => toast({ title: "Finalize failed", description: err?.message || "Error", variant: "destructive" }),
  });

  const emailCsvMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/warehouse-inventory/${id}/email-csv`, {});
      return (await res.json()) as { success: boolean; recipients: string[] };
    },
    onSuccess: (resp) => {
      const list = resp?.recipients?.join(", ") || "";
      toast({ title: "CSV emailed", description: list ? `Sent to ${list}` : "Recipients notified." });
    },
    onError: (err: any) =>
      toast({ title: "Email failed", description: err?.message || "Error", variant: "destructive" }),
  });

  const reopenMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/warehouse-inventory/${id}/reopen`),
    onSuccess: () => {
      toast({ title: "Reopened", description: "Count is editable again." });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse-inventory", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse-inventory", id, "history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse-inventory/dashboard"] });
    },
    onError: (err: any) => toast({ title: "Reopen failed", description: err?.message || "Error", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => apiRequest("DELETE", `/api/warehouse-inventory/${id}`),
    onSuccess: () => {
      toast({ title: "Deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse-inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse-inventory/dashboard"] });
      setLocation("/warehouse-inventory/list");
    },
    onError: (err: any) => toast({ title: "Delete failed", description: err?.message || "Error", variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="p-6 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (isError || !data) {
    return (
      <div className="p-6">
        <Link href="/warehouse-inventory">
          <Button variant="outline" size="sm" className="mb-4"><ArrowLeft className="w-4 h-4 mr-1" /> Dashboard</Button>
        </Link>
        <Card>
          <CardContent className="p-6 flex items-center gap-3 text-destructive">
            <AlertTriangle className="w-5 h-5" />
            <div>
              <p className="font-semibold">Failed to load count</p>
              <p className="text-sm">{(error as Error)?.message || "Unknown error"}</p>
            </div>
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => refetch()} data-testid="button-retry">Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const c = data.count;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/warehouse-inventory">
            <Button variant="outline" size="sm" data-testid="button-back">
              <ArrowLeft className="w-4 h-4 mr-1" /> Dashboard
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-title">
              <WarehouseIcon className="w-6 h-6 text-primary" />
              {titleCase(c.warehouse)} · {c.countDate}
            </h1>
            <p className="text-xs text-muted-foreground">
              {c.createdByName ? <>Started by {c.createdByName}</> : null}
              {c.finalizedByName ? <> · Finalized by {c.finalizedByName}</> : null}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={isFinal ? "default" : "secondary"} data-testid="badge-status">
            {isFinal ? "Finalized" : "Draft"}
          </Badge>
          <Button variant="outline" onClick={handleExportCsv} data-testid="button-export-csv">
            <Download className="w-4 h-4 mr-2" />
            Download CSV
          </Button>
          <Button
            variant="outline"
            onClick={handleExportEditLog}
            data-testid="button-export-edit-log"
            title="Download the audit trail of edits, finalize, and reopen events for this count"
          >
            <HistoryIcon className="w-4 h-4 mr-2" />
            Download edit log
          </Button>
          {(() => {
            const hasRecipients = data.hasEmailRecipients !== false;
            const tooltip = hasRecipients
              ? `Email the variance CSV to the configured ${titleCase(c.warehouse)} recipients`
              : `No variance email recipients configured for the ${titleCase(c.warehouse)} warehouse. Add them in Settings → Notifications.`;
            return (
              <Button
                variant="outline"
                onClick={() => emailCsvMutation.mutate()}
                disabled={emailCsvMutation.isPending || !hasRecipients}
                data-testid="button-email-csv"
                title={tooltip}
              >
                {emailCsvMutation.isPending
                  ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  : <Mail className="w-4 h-4 mr-2" />}
                Email CSV
              </Button>
            );
          })()}
          {!readOnly && (
            <>
              <Button variant="outline" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save">
                {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save Draft
              </Button>
              <Button onClick={() => finalizeMutation.mutate()} disabled={finalizeMutation.isPending} data-testid="button-finalize">
                {finalizeMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                Finalize
              </Button>
            </>
          )}
          {isFinal && canReopen && (
            <Button variant="outline" onClick={() => reopenMutation.mutate()} disabled={reopenMutation.isPending} data-testid="button-reopen">
              {reopenMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Unlock className="w-4 h-4 mr-2" />}
              Reopen
            </Button>
          )}
          {role === "admin" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="icon" data-testid="button-delete"><Trash2 className="w-4 h-4" /></Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this count?</AlertDialogTitle>
                  <AlertDialogDescription>This cannot be undone. All items for this count will be removed.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => deleteMutation.mutate()} data-testid="button-confirm-delete">Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* Totals summary */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-baseline gap-6">
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Total items</div>
            <div className="text-3xl font-bold" data-testid="text-total">{totals.total.toLocaleString()}</div>
          </div>
          {data.prior && (
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">vs {data.prior.countDate}</div>
              <div className="text-lg font-semibold flex items-center gap-2">
                {priorTotal.toLocaleString()}
                <Delta value={totals.total - priorTotal} />
              </div>
            </div>
          )}
          {totals.hasAnyExpected && (
            <>
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider">System expected</div>
                <div className="text-lg font-semibold" data-testid="text-expected-total">
                  {totals.expectedTotal.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider">Variance</div>
                <div
                  className={`text-lg font-semibold ${
                    totals.varianceTotal === 0
                      ? "text-muted-foreground"
                      : totals.varianceTotal > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                  }`}
                  data-testid="text-variance-total"
                >
                  {totals.varianceTotal > 0 ? "+" : ""}{totals.varianceTotal.toLocaleString()}
                </div>
              </div>
            </>
          )}
          {Object.entries(totals.byGroup).map(([g, qty]) => (
            <div key={g}>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">{g}</div>
              <div className="text-lg font-semibold" data-testid={`text-group-total-${g}`}>{qty}</div>
              {totals.hasExpectedByGroup[g] && (
                <div className="text-xs text-muted-foreground">
                  exp {totals.expectedByGroup[g]} ·{" "}
                  <span
                    className={
                      totals.varianceByGroup[g] === 0
                        ? "text-muted-foreground"
                        : totals.varianceByGroup[g] > 0
                          ? "text-emerald-600 dark:text-emerald-400 font-medium"
                          : "text-red-600 dark:text-red-400 font-medium"
                    }
                    data-testid={`text-group-variance-${g}`}
                  >
                    {totals.varianceByGroup[g] > 0 ? "+" : ""}{totals.varianceByGroup[g]}
                  </span>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Variance filter / legacy notice */}
      {totals.hasAnyExpected ? (
        <div className="flex items-center justify-between gap-3 px-1">
          <div className="text-xs text-muted-foreground" data-testid="text-variance-summary">
            {itemsWithVarianceCount === 0
              ? "All counted items match system expected."
              : `${itemsWithVarianceCount} item${itemsWithVarianceCount === 1 ? "" : "s"} differ from system expected.`}
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <span>Variance only</span>
            <Switch
              checked={varianceOnly}
              onCheckedChange={setVarianceOnly}
              data-testid="switch-variance-only"
            />
          </label>
        </div>
      ) : (
        <div
          className="flex items-start gap-2 text-xs text-muted-foreground px-1"
          data-testid="text-no-expected"
        >
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            No system-expected snapshot is available for this count
            {isFinal ? " (it was finalized before snapshotting was enabled)" : ""}.
            Variance comparison isn't available.
          </span>
        </div>
      )}

      {/* Entry form by category */}
      {data.categories.map(cat => {
        const visibleItems = varianceOnly
          ? cat.items.filter(item => {
              const exp = expectedMap[item];
              const cur = Number(qty[item] ?? 0) || 0;
              return exp != null && cur - exp !== 0;
            })
          : cat.items;
        if (varianceOnly && visibleItems.length === 0) return null;
        return (
        <Card key={cat.group}>
          <CardHeader>
            <CardTitle data-testid={`title-group-${cat.group}`}>{cat.group}</CardTitle>
            <CardDescription>
              {varianceOnly
                ? `${visibleItems.length} of ${cat.items.length} items with variance`
                : `${cat.items.length} items`} · current group total:
              {" "}<span className="font-semibold text-foreground">{totals.byGroup[cat.group] || 0}</span>
              {totals.hasExpectedByGroup[cat.group] && (
                <>
                  {" · vs system: "}
                  <span
                    className={
                      totals.varianceByGroup[cat.group] === 0
                        ? "text-muted-foreground"
                        : totals.varianceByGroup[cat.group] > 0
                          ? "text-emerald-600 dark:text-emerald-400 font-medium"
                          : "text-red-600 dark:text-red-400 font-medium"
                    }
                  >
                    {totals.varianceByGroup[cat.group] > 0 ? "+" : ""}{totals.varianceByGroup[cat.group]}
                  </span>
                </>
              )}
              {data.prior && (
                <>
                  {" · vs prior: "}
                  <Delta value={(totals.byGroup[cat.group] || 0) - (data.priorItems.filter(p => cat.items.includes(p.itemName)).reduce((a, b) => a + b.qty, 0))} />
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {visibleItems.map(item => {
                const value = qty[item] ?? "";
                const prior = priorMap[item] ?? 0;
                const currentNum = Number(value) || 0;
                const delta = currentNum - prior;
                const expected = expectedMap[item];
                const variance = expected != null ? currentNum - expected : null;
                const itemEdits = itemEditsMap[item] || [];
                const lastEdit = itemEdits[0];
                const isExpanded = expandedItem === item;
                return (
                  <div
                    key={item}
                    className="px-4 py-2"
                    data-testid={`row-item-${item}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{item}</div>
                        {data.prior && (
                          <div className="text-xs text-muted-foreground">
                            Prior ({data.prior.countDate}): {prior} <Delta value={delta} />
                          </div>
                        )}
                        {expected != null && (
                          <div className="text-xs text-muted-foreground" data-testid={`text-variance-${item}`}>
                            {isFinal ? "System expected" : "System (live)"}: {expected}
                            {variance != null && (
                              <>
                                {" · variance: "}
                                <span className={variance === 0 ? "text-muted-foreground" : variance > 0 ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-red-600 dark:text-red-400 font-medium"}>
                                  {variance > 0 ? `+${variance}` : variance}
                                </span>
                              </>
                            )}
                          </div>
                        )}
                        {lastEdit && (
                          <button
                            type="button"
                            onClick={() => setExpandedItem(isExpanded ? null : item)}
                            className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover-elevate active-elevate-2 rounded -mx-1 px-1 py-0.5"
                            aria-expanded={isExpanded}
                            data-testid={`button-item-history-${item}`}
                            title={`${itemEdits.length} edit${itemEdits.length === 1 ? "" : "s"} — click to ${isExpanded ? "hide" : "show"}`}
                          >
                            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            <HistoryIcon className="w-3 h-3" />
                            <span data-testid={`text-item-last-edit-${item}`}>
                              Edited by {lastEdit.changedByName || "—"} · {formatRelative(lastEdit.changedAt)}
                              {itemEdits.length > 1 ? ` · ${itemEdits.length} edits` : ""}
                            </span>
                          </button>
                        )}
                      </div>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        className="w-24 text-right"
                        value={value}
                        disabled={readOnly}
                        onChange={e => setQty(q => ({ ...q, [item]: e.target.value }))}
                        onFocus={e => e.currentTarget.select()}
                        data-testid={`input-qty-${item}`}
                      />
                    </div>
                    {isExpanded && lastEdit && (
                      <ul className="mt-2 ml-5 space-y-1.5 border-l-2 border-border pl-3" data-testid={`list-item-history-${item}`}>
                        {itemEdits.map(a => {
                          const qtyDiff = a.changes?.qty as { before: unknown; after: unknown } | undefined;
                          return (
                            <li key={a.id} className="text-xs" data-testid={`item-history-entry-${a.id}`}>
                              <div className="text-muted-foreground">
                                {a.changedByName || "—"} · {new Date(a.changedAt).toLocaleString()}
                              </div>
                              {qtyDiff && (
                                <div className="font-mono text-[11px]">
                                  <span className="text-muted-foreground">Qty:</span>{" "}
                                  <span className="line-through text-red-600 dark:text-red-400">{fmtVal(qtyDiff.before)}</span>
                                  {" → "}
                                  <span className="text-green-600 dark:text-green-400">{fmtVal(qtyDiff.after)}</span>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
        );
      })}

      {varianceOnly && itemsWithVarianceCount === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground" data-testid="text-empty-variance">
            No items differ from system expected.
          </CardContent>
        </Card>
      )}

      {/* Notes */}
      <Card>
        <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
        <CardContent>
          <Textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            disabled={readOnly}
            placeholder="Anything leadership should know about this count?"
            rows={3}
            data-testid="input-notes"
          />
        </CardContent>
      </Card>

      {readOnly && (
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <Lock className="w-3 h-3" /> This count is finalized.
          {canReopen && <> Use Reopen to make corrections.</>}
        </div>
      )}

      {/* Edit history (per-item qty edits + finalize/reopen events) */}
      <CountHistory countId={id} createdByName={c.createdByName} />
    </div>
  );
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function CountHistory({ countId, createdByName }: { countId: number; createdByName: string | null }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useQuery<CountAuditEntry[]>({
    queryKey: ["/api/warehouse-inventory", countId, "history"],
    queryFn: HISTORY_QUERY_FN,
  });
  const total = data?.length ?? null;
  return (
    <Card data-testid="card-history">
      <CardHeader className="pb-2">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2 text-left w-full hover-elevate active-elevate-2 rounded-md -mx-1 px-1 py-1"
          data-testid="button-toggle-history"
          aria-expanded={open}
        >
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <HistoryIcon className="w-4 h-4 text-primary" />
          <CardTitle className="text-base">Edit log</CardTitle>
          {total !== null && (
            <span className="text-xs text-muted-foreground" data-testid="text-history-count">
              · {total} {total === 1 ? "entry" : "entries"}
            </span>
          )}
        </button>
      </CardHeader>
      {open && (
        <CardContent className="pt-0">
          {isLoading && (
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" /> Loading edit history…
            </div>
          )}
          {isError && (
            <div className="text-xs text-destructive">Failed to load edit history.</div>
          )}
          {data && data.length === 0 && (
            <div className="text-xs text-muted-foreground" data-testid="text-history-empty">
              No edits recorded yet — only the original entry exists.
            </div>
          )}
          {data && data.length > 0 && (
            <ul className="space-y-2" data-testid="list-history">
              {data.map(a => {
                const isItemEdit = a.action === "update" && a.itemName;
                const qtyDiff = a.changes?.qty as { before: unknown; after: unknown } | undefined;
                return (
                  <li key={a.id} className="border-l-2 border-border pl-3 text-xs" data-testid={`history-entry-${a.id}`}>
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium capitalize">
                        {a.action === "finalize" ? "Finalized" :
                         a.action === "reopen" ? "Reopened" :
                         isItemEdit ? `Edited ${a.itemName}` : a.action}
                      </span>
                      <span className="text-muted-foreground">
                        by {a.changedByName || "—"} · {new Date(a.changedAt).toLocaleString()}
                      </span>
                    </div>
                    {isItemEdit && qtyDiff && (
                      <div className="mt-0.5 font-mono text-[11px]">
                        <span className="text-muted-foreground">Qty:</span>{" "}
                        <span className="line-through text-red-600 dark:text-red-400">{fmtVal(qtyDiff.before)}</span>
                        {" → "}
                        <span className="text-green-600 dark:text-green-400">{fmtVal(qtyDiff.after)}</span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="text-xs text-muted-foreground pt-2 mt-2 border-t" data-testid="text-history-created">
            Originally started by {createdByName || "—"}.
          </div>
        </CardContent>
      )}
    </Card>
  );
}
