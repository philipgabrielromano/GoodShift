import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Truck, MapPin, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { TrailerManifest, TrailerManifestStatus, TruckRoute, TruckRouteWithStops, Trailer } from "@shared/schema";
import { TRAILER_MANIFEST_STATUSES } from "@shared/schema";
import { useLocations } from "@/hooks/use-locations";
import { isValidLocation } from "@/lib/utils";
import { useCurrentUser } from "@/hooks/use-users";

const STATUS_LABELS: Record<TrailerManifestStatus, string> = {
  loading: "Loading",
  in_transit: "In Transit",
  delivered: "Delivered",
  closed: "Closed",
};

const STATUS_BADGE: Record<TrailerManifestStatus, "default" | "secondary" | "outline" | "destructive"> = {
  loading: "secondary",
  in_transit: "default",
  delivered: "outline",
  closed: "outline",
};

export default function TrailerManifests() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    fromLocation: "",
    toLocation: "",
    routeId: "" as string, // empty = no configured route attached
    trailerNumber: "",
    driverName: "",
    notes: "",
  });

  const { data: locations = [] } = useLocations();
  const sortedLocations = locations.slice().filter(isValidLocation).sort((a, b) => a.name.localeCompare(b.name));

  const { data: routes = [] } = useQuery<TruckRoute[]>({ queryKey: ["/api/truck-routes"] });
  const activeRoutes = routes.filter(r => r.isActive);
  const selectedRouteId = form.routeId ? Number(form.routeId) : null;
  const { data: selectedRoute } = useQuery<TruckRouteWithStops>({
    queryKey: ["/api/truck-routes", selectedRouteId],
    enabled: selectedRouteId !== null,
  });

  const { data: trailers = [] } = useQuery<Trailer[]>({ queryKey: ["/api/trailers"] });
  const activeTrailers = trailers.filter(t => t.isActive);

  const { data: currentUser } = useCurrentUser();
  const currentUserName = currentUser?.user?.name || "";

  // Default driver to logged-in user when opening the create dialog (only if blank).
  useEffect(() => {
    if (createOpen && currentUserName && !form.driverName) {
      setForm(f => ({ ...f, driverName: currentUserName }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createOpen, currentUserName]);

  const { data: manifests = [], isLoading, isError, error } = useQuery<TrailerManifest[]>({
    queryKey: ["/api/trailer-manifests", statusFilter],
    queryFn: async () => {
      const url = statusFilter === "all"
        ? "/api/trailer-manifests"
        : `/api/trailer-manifests?status=${encodeURIComponent(statusFilter)}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load manifests");
      return res.json();
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: TrailerManifestStatus }) => {
      return await apiRequest("POST", `/api/trailer-manifests/${id}/status`, { status });
    },
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/trailer-manifests"] });
      toast({ title: "Status updated", description: `Manifest #${vars.id} set to ${STATUS_LABELS[vars.status]}` });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update status", description: err?.message || "", variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (input: typeof form) => {
      const payload = {
        fromLocation: input.fromLocation,
        toLocation: input.toLocation,
        routeId: input.routeId ? Number(input.routeId) : null,
        trailerNumber: input.trailerNumber || null,
        driverName: input.driverName || null,
        notes: input.notes || null,
      };
      return await apiRequest("POST", "/api/trailer-manifests", payload);
    },
    onSuccess: async (res: any) => {
      const created = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/trailer-manifests"] });
      toast({ title: "Manifest created" });
      setCreateOpen(false);
      setForm({ fromLocation: "", toLocation: "", routeId: "", trailerNumber: "", driverName: "", notes: "" });
      setLocation(`/trailer-manifests/${created.id}`);
    },
    onError: (err: any) => {
      toast({ title: "Failed to create manifest", description: err?.message || "", variant: "destructive" });
    },
  });

  const handleCreate = () => {
    if (!form.fromLocation.trim() || !form.toLocation.trim()) {
      toast({ title: "From and To locations are required", variant: "destructive" });
      return;
    }
    createMutation.mutate(form);
  };

  return (
    <div className="p-4 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-trailer-manifests-title">
            <Truck className="w-6 h-6" />
            Trailer Manifest
          </h1>
          <p className="text-muted-foreground mt-1">
            Track exactly what is on each truck in real time. Edit live, with full change history.
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]" data-testid="select-status-filter">
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {TRAILER_MANIFEST_STATUSES.map(s => (
                <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-manifest">
                <Plus className="w-4 h-4 mr-2" />
                New Manifest
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg" data-testid="dialog-new-manifest">
              <DialogHeader>
                <DialogTitle>Start a new trailer manifest</DialogTitle>
                <DialogDescription>
                  Capture route info now. You can edit item counts on the next screen.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>From location *</Label>
                    <Select value={form.fromLocation} onValueChange={v => setForm({ ...form, fromLocation: v })}>
                      <SelectTrigger data-testid="select-from-location">
                        <SelectValue placeholder="Select origin" />
                      </SelectTrigger>
                      <SelectContent>
                        {sortedLocations.map(l => (
                          <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>To location *</Label>
                    <Select value={form.toLocation} onValueChange={v => setForm({ ...form, toLocation: v })}>
                      <SelectTrigger data-testid="select-to-location">
                        <SelectValue placeholder="Select destination" />
                      </SelectTrigger>
                      <SelectContent>
                        {sortedLocations.map(l => (
                          <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Route</Label>
                  <Select
                    value={form.routeId || "none"}
                    onValueChange={(v) => {
                      if (v === "none") {
                        setForm({ ...form, routeId: "" });
                      } else {
                        setForm({ ...form, routeId: v });
                      }
                    }}
                  >
                    <SelectTrigger data-testid="select-route">
                      <SelectValue placeholder="No configured route" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No configured route</SelectItem>
                      {activeRoutes.map(r => (
                        <SelectItem key={r.id} value={String(r.id)} data-testid={`select-route-option-${r.id}`}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedRoute && selectedRoute.stops.length > 0 && (
                    <p className="text-xs text-muted-foreground" data-testid="text-route-stops-preview">
                      Notifies: {selectedRoute.stops.map(s => s.locationName).join(", ")}
                    </p>
                  )}
                  {selectedRoute && selectedRoute.stops.length === 0 && (
                    <p className="text-xs text-destructive">This route has no stops yet — no one will be notified.</p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Trailer</Label>
                    <Select
                      value={form.trailerNumber || "none"}
                      onValueChange={(v) => setForm({ ...form, trailerNumber: v === "none" ? "" : v })}
                    >
                      <SelectTrigger data-testid="select-trailer-number">
                        <SelectValue placeholder={activeTrailers.length === 0 ? "No trailers configured" : "Select trailer"} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— None —</SelectItem>
                        {activeTrailers.map(t => (
                          <SelectItem key={t.id} value={t.number} data-testid={`select-trailer-option-${t.id}`}>
                            {t.number}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {activeTrailers.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        Add trailers under Trailers (in Ordering &amp; Logging) to enable this dropdown.
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Driver</Label>
                    <Input
                      value={form.driverName}
                      onChange={e => setForm({ ...form, driverName: e.target.value })}
                      placeholder="Driver name"
                      data-testid="input-driver-name"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Input
                    value={form.notes}
                    onChange={e => setForm({ ...form, notes: e.target.value })}
                    placeholder="Optional"
                    data-testid="input-notes"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)} data-testid="button-cancel-create">
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={createMutation.isPending} data-testid="button-confirm-create">
                  {createMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                  Create & Open
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active and Recent Manifests</CardTitle>
          <CardDescription>Click a row to open the live manifest.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : isError ? (
            <div className="py-12 text-center text-destructive" data-testid="text-list-error">
              Could not load manifests: {(error as any)?.message || "unknown error"}
            </div>
          ) : manifests.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground" data-testid="text-empty-manifests">
              No manifests yet. Create one to start tracking a trailer.
            </div>
          ) : (
            <div className="divide-y">
              {manifests.map(m => (
                <Link
                  key={m.id}
                  href={`/trailer-manifests/${m.id}`}
                  data-testid={`row-manifest-${m.id}`}
                >
                  <a className="flex flex-wrap items-center gap-3 py-3 px-2 hover-elevate cursor-pointer">
                    <div className="flex items-center gap-2 min-w-[280px]">
                      <MapPin className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium" data-testid={`text-from-${m.id}`}>{m.fromLocation}</span>
                      <ArrowRight className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium" data-testid={`text-to-${m.id}`}>{m.toLocation}</span>
                    </div>
                    <div className="text-sm text-muted-foreground flex-1 min-w-[200px]">
                      {m.trailerNumber && <span className="mr-3">Trailer #{m.trailerNumber}</span>}
                      {m.driverName && <span>Driver: {m.driverName}</span>}
                    </div>
                    <div
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      className="shrink-0"
                    >
                      <Select
                        value={m.status}
                        onValueChange={(v) => statusMutation.mutate({ id: m.id, status: v as TrailerManifestStatus })}
                        disabled={statusMutation.isPending}
                      >
                        <SelectTrigger
                          className="h-8 w-[140px]"
                          data-testid={`select-status-${m.id}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TRAILER_MANIFEST_STATUSES.map(s => (
                            <SelectItem key={s} value={s} data-testid={`select-status-option-${m.id}-${s}`}>
                              {STATUS_LABELS[s]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="text-xs text-muted-foreground w-[140px] text-right">
                      {new Date(m.updatedAt).toLocaleString()}
                    </div>
                  </a>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
