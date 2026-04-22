import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import {
  ArrowLeft, Loader2, Save, CheckCircle2, Lock, Unlock, Trash2,
  TrendingUp, TrendingDown, Minus, AlertTriangle, Warehouse as WarehouseIcon,
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
}
interface AuthStatus { user: { id: number; name: string; role: string } | null; }

function titleCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
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

  const { data, isLoading, isError, error, refetch } = useQuery<Detail>({
    queryKey: ["/api/warehouse-inventory", id],
  });

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

  const priorMap = useMemo(() => {
    const m: Record<string, number> = {};
    (data?.priorItems || []).forEach(it => { m[it.itemName] = it.qty; });
    return m;
  }, [data]);

  const isFinal = data?.count.status === "final";
  const readOnly = isFinal;

  const totals = useMemo(() => {
    const byGroup: Record<string, number> = {};
    let total = 0;
    (data?.categories || []).forEach(cat => {
      cat.items.forEach(item => {
        const n = Number(qty[item] ?? 0) || 0;
        byGroup[cat.group] = (byGroup[cat.group] || 0) + n;
        total += n;
      });
    });
    return { byGroup, total };
  }, [qty, data]);

  const priorTotal = (data?.priorItems || []).reduce((a, b) => a + b.qty, 0);

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
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse-inventory/dashboard"] });
    },
    onError: (err: any) => toast({ title: "Finalize failed", description: err?.message || "Error", variant: "destructive" }),
  });

  const reopenMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/warehouse-inventory/${id}/reopen`),
    onSuccess: () => {
      toast({ title: "Reopened", description: "Count is editable again." });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse-inventory", id] });
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
          {isFinal && (role === "admin" || role === "manager") && (
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
          {Object.entries(totals.byGroup).map(([g, qty]) => (
            <div key={g}>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">{g}</div>
              <div className="text-lg font-semibold" data-testid={`text-group-total-${g}`}>{qty}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Entry form by category */}
      {data.categories.map(cat => (
        <Card key={cat.group}>
          <CardHeader>
            <CardTitle data-testid={`title-group-${cat.group}`}>{cat.group}</CardTitle>
            <CardDescription>
              {cat.items.length} items · current group total:
              {" "}<span className="font-semibold text-foreground">{totals.byGroup[cat.group] || 0}</span>
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
              {cat.items.map(item => {
                const value = qty[item] ?? "";
                const prior = priorMap[item] ?? 0;
                const currentNum = Number(value) || 0;
                const delta = currentNum - prior;
                // Variance: actual counted (qty) vs system-expected (expectedQty).
                // For finalized counts we use the snapshotted expectedQty; for
                // in-progress counts there is no snapshot yet, so we fall back
                // to the live engine value carried on data.expectedMap.
                const itemRow = data.items.find(i => i.itemName === item);
                const expected = isFinal
                  ? (itemRow?.expectedQty ?? null)
                  : (data.expectedMap?.[item] ?? null);
                const variance = expected != null ? currentNum - expected : null;
                return (
                  <div
                    key={item}
                    className="flex items-center justify-between gap-3 px-4 py-2"
                    data-testid={`row-item-${item}`}
                  >
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
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}

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
          {(role === "admin" || role === "manager") && <> Use Reopen to make corrections.</>}
        </div>
      )}
    </div>
  );
}
