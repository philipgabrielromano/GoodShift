import { useState } from "react";
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowRight, Download, Loader2, Plus, TrendingDown, TrendingUp, Minus, History, AlertTriangle, Warehouse as WarehouseIcon,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

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

  const { data: meta } = useQuery<Meta>({ queryKey: ["/api/warehouse-inventory/meta"] });
  const { data: dashboard, isLoading, isError, error, refetch } = useQuery<Dashboard>({
    queryKey: ["/api/warehouse-inventory/dashboard"],
  });

  // Set defaults once meta loads
  if (meta && !form.countDate) {
    setForm(f => ({ ...f, countDate: meta.today }));
  }
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
              {w.latest && (
                <Badge variant={w.latest.status === "final" ? "default" : "secondary"} data-testid={`badge-status-${w.warehouse}`}>
                  {w.latest.status === "final" ? "Finalized" : "Draft"}
                </Badge>
              )}
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
                  <div className="flex items-baseline gap-3">
                    <div className="text-4xl font-bold" data-testid={`text-total-${w.warehouse}`}>{w.totals.total.toLocaleString()}</div>
                    <div className="text-sm text-muted-foreground">total items</div>
                    {w.prior && <DeltaPill value={w.delta.total} />}
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
    </div>
  );
}
