import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ClipboardCheck, Plus, AlertCircle, CheckCircle2, Wrench, Truck, Loader2, Camera,
} from "lucide-react";
import type { DriverInspection } from "@shared/schema";

interface AuthStatus {
  user: { id: number; name: string; role: string } | null;
  accessibleFeatures?: string[];
}
interface Summary {
  totalInspections: number;
  inspectionsWithRepairs: number;
  totalOpenRepairItems: number;
  inspectionsWithOpenRepairs: number;
}

export default function DriverInspections() {
  const { data: authStatus } = useQuery<AuthStatus>({ queryKey: ["/api/auth/status"] });
  const features = authStatus?.accessibleFeatures || [];
  const canSubmit = features.includes("driver_inspection.submit");

  const [tab, setTab] = useState<"all" | "open">("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [vehicleQuery, setVehicleQuery] = useState("");
  const [routeQuery, setRouteQuery] = useState("");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (tab === "open") p.set("openRepairsOnly", "true");
    if (typeFilter !== "all") p.set("inspectionType", typeFilter);
    if (fromDate) p.set("fromDate", new Date(fromDate).toISOString());
    if (toDate) p.set("toDate", new Date(`${toDate}T23:59:59`).toISOString());
    const s = p.toString();
    return s ? `?${s}` : "";
  }, [tab, typeFilter, fromDate, toDate]);

  const { data: inspections = [], isLoading } = useQuery<DriverInspection[]>({
    queryKey: ["/api/driver-inspections", queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/driver-inspections${queryParams}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load inspections");
      return await res.json();
    },
  });

  const { data: summary } = useQuery<Summary>({ queryKey: ["/api/driver-inspections/summary"] });

  // Client-side text filters (vehicle # / route) for responsiveness
  const filtered = useMemo(() => {
    const v = vehicleQuery.trim().toLowerCase();
    const r = routeQuery.trim().toLowerCase();
    return inspections.filter(row => {
      if (v) {
        const match =
          (row.tractorNumber?.toLowerCase().includes(v) ?? false) ||
          (row.trailerNumber?.toLowerCase().includes(v) ?? false);
        if (!match) return false;
      }
      if (r && !(row.routeNumber?.toLowerCase().includes(r) ?? false)) return false;
      return true;
    });
  }, [inspections, vehicleQuery, routeQuery]);

  return (
    <div className="container mx-auto max-w-7xl py-8 px-4">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded bg-primary/10 flex items-center justify-center">
            <ClipboardCheck className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" data-testid="heading-driver-inspections">Driver Inspections</h1>
            <p className="text-sm text-muted-foreground">Pre-trip tractor &amp; trailer inspection records.</p>
          </div>
        </div>
        {canSubmit && (
          <Link href="/driver-inspection/new">
            <Button data-testid="button-new-inspection">
              <Plus className="w-4 h-4 mr-2" /> New Inspection
            </Button>
          </Link>
        )}
      </div>

      {/* Summary stats */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard label="Total Inspections" value={summary.totalInspections} testid="stat-total" />
          <StatCard label="With Repairs" value={summary.inspectionsWithRepairs} testid="stat-with-repairs" />
          <StatCard label="Open Repair Items" value={summary.totalOpenRepairItems} tone={summary.totalOpenRepairItems > 0 ? "warn" : "ok"} testid="stat-open-items" />
          <StatCard label="Vehicles Needing Attention" value={summary.inspectionsWithOpenRepairs} tone={summary.inspectionsWithOpenRepairs > 0 ? "warn" : "ok"} testid="stat-vehicles-attention" />
        </div>
      )}

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="py-4 space-y-3">
          <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
            <TabsList>
              <TabsTrigger value="all" data-testid="tab-all">All</TabsTrigger>
              <TabsTrigger value="open" data-testid="tab-open-repairs">Open Repairs Only</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Type</Label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger data-testid="select-type-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="tractor">Tractor</SelectItem>
                  <SelectItem value="trailer">Trailer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Vehicle # contains</Label>
              <Input value={vehicleQuery} onChange={(e) => setVehicleQuery(e.target.value)} placeholder="T-203" data-testid="input-vehicle-filter" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Route contains</Label>
              <Input value={routeQuery} onChange={(e) => setRouteQuery(e.target.value)} placeholder="Route 12" data-testid="input-route-filter" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} data-testid="input-from-date" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} data-testid="input-to-date" />
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No inspections match the current filters.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(row => (
            <Link key={row.id} href={`/driver-inspections/${row.id}`}>
              <Card
                className="cursor-pointer hover-elevate"
                data-testid={`row-inspection-${row.id}`}
              >
                <CardContent className="py-4">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <Truck className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold capitalize">{row.inspectionType}</span>
                          <span className="text-muted-foreground">•</span>
                          <span data-testid={`text-vehicle-${row.id}`}>
                            {row.inspectionType === "tractor" ? (row.tractorNumber || "—") : (row.trailerNumber || "—")}
                          </span>
                          {row.routeNumber && (
                            <>
                              <span className="text-muted-foreground">•</span>
                              <span className="text-sm text-muted-foreground">{row.routeNumber}</span>
                            </>
                          )}
                          {row.photoUrl && <Camera className="w-4 h-4 text-muted-foreground" />}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {row.driverName || "Unknown driver"} • {new Date(row.createdAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {(row.openRepairCount ?? 0) > 0 ? (
                        <Badge variant="destructive" className="gap-1" data-testid={`badge-open-${row.id}`}>
                          <Wrench className="w-3 h-3" /> {row.openRepairCount} open
                        </Badge>
                      ) : row.anyRepairsNeeded ? (
                        <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                          <CheckCircle2 className="w-3 h-3" /> Repairs resolved
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                          <CheckCircle2 className="w-3 h-3" /> No issues
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, tone, testid }: { label: string; value: number; tone?: "ok" | "warn"; testid?: string }) {
  const color =
    tone === "warn"
      ? "text-destructive"
      : tone === "ok"
      ? "text-green-600"
      : "text-foreground";
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className={`text-2xl font-bold ${color}`} data-testid={testid}>{value}</div>
      </CardContent>
    </Card>
  );
}
