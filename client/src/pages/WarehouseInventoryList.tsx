import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Download, ArrowLeft, AlertTriangle, Warehouse as WarehouseIcon } from "lucide-react";

interface Meta { warehouses: string[]; today: string; }
interface Row {
  id: number;
  warehouse: string;
  countDate: string;
  status: string;
  createdByName: string | null;
  notes: string | null;
  totalItems: number;
}

function titleCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function WarehouseInventoryList() {
  const { data: meta } = useQuery<Meta>({ queryKey: ["/api/warehouse-inventory/meta"] });
  const [warehouse, setWarehouse] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const params = new URLSearchParams();
  if (warehouse !== "all") params.set("warehouse", warehouse);
  if (status !== "all") params.set("status", status);
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  const { data, isLoading, isError, error, refetch } = useQuery<Row[]>({
    queryKey: ["/api/warehouse-inventory", warehouse, status, from, to],
    queryFn: async () => {
      const res = await fetch(`/api/warehouse-inventory?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load counts");
      return res.json();
    },
  });

  const exportUrl = `/api/warehouse-inventory/export.csv${params.toString() ? "?" + params.toString() : ""}`;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/warehouse-inventory">
            <Button variant="outline" size="sm" data-testid="button-back">
              <ArrowLeft className="w-4 h-4 mr-1" /> Dashboard
            </Button>
          </Link>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Count History</h1>
        </div>
        <a href={exportUrl}>
          <Button variant="outline" data-testid="button-export">
            <Download className="w-4 h-4 mr-2" /> Export CSV
          </Button>
        </a>
      </div>

      <Card>
        <CardContent className="p-4 grid md:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label>Warehouse</Label>
            <Select value={warehouse} onValueChange={setWarehouse}>
              <SelectTrigger data-testid="select-filter-warehouse"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {(meta?.warehouses || []).map(w => (
                  <SelectItem key={w} value={w}>{titleCase(w)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger data-testid="select-filter-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="final">Finalized</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>From</Label>
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} data-testid="input-filter-from" />
          </div>
          <div className="space-y-1">
            <Label>To</Label>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} data-testid="input-filter-to" />
          </div>
        </CardContent>
      </Card>

      {isError && (
        <Card>
          <CardContent className="p-6 flex items-center gap-3 text-destructive">
            <AlertTriangle className="w-5 h-5" />
            <div>
              <p className="font-semibold">Failed to load counts</p>
              <p className="text-sm">{(error as Error)?.message}</p>
            </div>
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => refetch()} data-testid="button-retry">Retry</Button>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : (
        <Card>
          <CardHeader><CardTitle>Counts ({data?.length ?? 0})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {(data || []).length === 0 && (
                <div className="p-6 text-center text-muted-foreground text-sm">No counts match the current filters.</div>
              )}
              {(data || []).map(row => (
                <Link key={row.id} href={`/warehouse-inventory/${row.id}`}>
                  <div
                    className="flex items-center justify-between gap-3 p-4 hover-elevate cursor-pointer"
                    data-testid={`row-count-${row.id}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <WarehouseIcon className="w-5 h-5 text-primary shrink-0" />
                      <div className="min-w-0">
                        <div className="font-semibold truncate">
                          {titleCase(row.warehouse)} · {row.countDate}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {row.createdByName || "—"}{row.notes ? ` · ${row.notes}` : ""}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div className="font-semibold" data-testid={`text-total-${row.id}`}>{row.totalItems.toLocaleString()}</div>
                        <div className="text-xs text-muted-foreground">items</div>
                      </div>
                      <Badge variant={row.status === "final" ? "default" : "secondary"} data-testid={`badge-status-${row.id}`}>
                        {row.status === "final" ? "Finalized" : "Draft"}
                      </Badge>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
