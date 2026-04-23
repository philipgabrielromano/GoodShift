import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Loader2, Plus, Route as RouteIcon, MapPin, Trash2, ArrowUp, ArrowDown, Mail, MailX } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { TruckRoute, TruckRouteWithStops } from "@shared/schema";
import { useLocations } from "@/hooks/use-locations";
import { isValidLocation } from "@/lib/utils";
import { usePermissions } from "@/hooks/use-permissions";

const ROUTES_KEY = ["/api/truck-routes"];

export default function TruckRoutes() {
  const { toast } = useToast();
  const { can } = usePermissions();
  const canEdit = can("trailer_manifest.edit");
  const canDelete = can("trailer_manifest.delete");

  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);

  const { data: routes = [], isLoading } = useQuery<TruckRoute[]>({ queryKey: ROUTES_KEY });
  const { data: locations = [] } = useLocations();
  const sortedLocations = useMemo(
    () => locations.slice().filter(isValidLocation).sort((a, b) => a.name.localeCompare(b.name)),
    [locations],
  );

  const { data: detail } = useQuery<TruckRouteWithStops>({
    queryKey: ["/api/truck-routes", editId],
    enabled: editId !== null,
  });

  const resetForm = () => {
    setName("");
    setDescription("");
    setIsActive(true);
  };

  const openCreate = () => { resetForm(); setCreateOpen(true); };

  const openEdit = (r: TruckRoute) => {
    setEditId(r.id);
    setName(r.name);
    setDescription(r.description ?? "");
    setIsActive(r.isActive);
  };

  const closeEdit = () => setEditId(null);

  const createMutation = useMutation({
    mutationFn: async () =>
      await apiRequest("POST", "/api/truck-routes", {
        name: name.trim(),
        description: description.trim() || null,
        isActive,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ROUTES_KEY });
      toast({ title: "Route created" });
      setCreateOpen(false);
      resetForm();
    },
    onError: (err: any) => toast({ title: "Failed to create route", description: err?.message || "", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (editId === null) return null;
      return await apiRequest("PUT", `/api/truck-routes/${editId}`, {
        name: name.trim(),
        description: description.trim() || null,
        isActive,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ROUTES_KEY });
      if (editId !== null) queryClient.invalidateQueries({ queryKey: ["/api/truck-routes", editId] });
      toast({ title: "Route updated" });
    },
    onError: (err: any) => toast({ title: "Failed to update route", description: err?.message || "", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => await apiRequest("DELETE", `/api/truck-routes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ROUTES_KEY });
      toast({ title: "Route deleted" });
      closeEdit();
    },
    onError: (err: any) => toast({ title: "Failed to delete route", description: err?.message || "", variant: "destructive" }),
  });

  const stopsMutation = useMutation({
    mutationFn: async ({ id, locationIds }: { id: number; locationIds: number[] }) =>
      await apiRequest("PUT", `/api/truck-routes/${id}/stops`, { locationIds }),
    onSuccess: () => {
      if (editId !== null) queryClient.invalidateQueries({ queryKey: ["/api/truck-routes", editId] });
      queryClient.invalidateQueries({ queryKey: ROUTES_KEY });
    },
    onError: (err: any) => toast({ title: "Failed to update stops", description: err?.message || "", variant: "destructive" }),
  });

  const stopIds = detail?.stops.map(s => s.locationId) ?? [];

  const updateStops = (next: number[]) => {
    if (editId === null) return;
    stopsMutation.mutate({ id: editId, locationIds: next });
  };

  const addStop = (locationId: number) => {
    if (stopIds.includes(locationId)) return;
    updateStops([...stopIds, locationId]);
  };

  const removeStop = (locationId: number) => {
    updateStops(stopIds.filter(id => id !== locationId));
  };

  const moveStop = (idx: number, dir: -1 | 1) => {
    const next = stopIds.slice();
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    updateStops(next);
  };

  return (
    <div className="p-4 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-truck-routes-title">
            <RouteIcon className="w-6 h-6" />
            Truck Routes
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure delivery routes. When a trailer manifest tied to a route goes In Transit, every stop on the route is notified.
          </p>
        </div>
        {canEdit && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreate} data-testid="button-new-route">
                <Plus className="w-4 h-4 mr-2" />
                New Route
              </Button>
            </DialogTrigger>
            <DialogContent data-testid="dialog-new-route">
              <DialogHeader>
                <DialogTitle>New Route</DialogTitle>
                <DialogDescription>Give the route a memorable name. You can add stops after it's created.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="space-y-2">
                  <Label>Route name *</Label>
                  <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Route 3" data-testid="input-route-name" />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional notes about this route" data-testid="input-route-description" />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="route-active">Active</Label>
                  <Switch id="route-active" checked={isActive} onCheckedChange={setIsActive} data-testid="switch-route-active" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)} data-testid="button-cancel-create">Cancel</Button>
                <Button onClick={() => createMutation.mutate()} disabled={!name.trim() || createMutation.isPending} data-testid="button-confirm-create">
                  {createMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configured Routes</CardTitle>
          <CardDescription>Click a route to edit its stops.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : routes.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground" data-testid="text-empty-routes">
              No routes configured yet.
            </div>
          ) : (
            <div className="divide-y">
              {routes.map(r => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => openEdit(r)}
                  className="w-full text-left flex items-center gap-3 py-3 px-2 hover-elevate"
                  data-testid={`row-route-${r.id}`}
                >
                  <RouteIcon className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium" data-testid={`text-route-name-${r.id}`}>{r.name}</span>
                  {!r.isActive && <Badge variant="outline" data-testid={`badge-inactive-${r.id}`}>Inactive</Badge>}
                  {r.description && <span className="text-sm text-muted-foreground truncate">{r.description}</span>}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={editId !== null} onOpenChange={(open) => { if (!open) closeEdit(); }}>
        <DialogContent className="sm:max-w-2xl" data-testid="dialog-edit-route">
          <DialogHeader>
            <DialogTitle>Edit Route</DialogTitle>
            <DialogDescription>
              Notifications go to each stop's store notification email. Stops without a configured email are still listed but won't receive a message.
            </DialogDescription>
          </DialogHeader>
          {!detail ? (
            <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : (
            <div className="grid gap-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Route name *</Label>
                  <Input value={name} onChange={e => setName(e.target.value)} disabled={!canEdit} data-testid="input-edit-route-name" />
                </div>
                <div className="flex items-end justify-end gap-3 pb-2">
                  <Label htmlFor="route-active-edit">Active</Label>
                  <Switch id="route-active-edit" checked={isActive} onCheckedChange={setIsActive} disabled={!canEdit} data-testid="switch-edit-route-active" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea value={description} onChange={e => setDescription(e.target.value)} disabled={!canEdit} data-testid="input-edit-route-description" />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Stops (in order)</Label>
                  {canEdit && (
                    <select
                      className="text-sm border rounded px-2 py-1 bg-background"
                      value=""
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (v) addStop(v);
                        e.currentTarget.value = "";
                      }}
                      data-testid="select-add-stop"
                    >
                      <option value="">+ Add stop…</option>
                      {sortedLocations
                        .filter(l => !stopIds.includes(l.id))
                        .map(l => (
                          <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                    </select>
                  )}
                </div>
                {detail.stops.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4 text-center border rounded">No stops added yet.</div>
                ) : (
                  <ol className="border rounded divide-y">
                    {detail.stops.map((s, idx) => (
                      <li
                        key={s.id}
                        className="flex items-center gap-2 px-3 py-2"
                        data-testid={`row-stop-${s.locationId}`}
                      >
                        <span className="text-xs text-muted-foreground w-5 text-right">{idx + 1}.</span>
                        <MapPin className="w-4 h-4 text-muted-foreground" />
                        <span className="font-medium">{s.locationName}</span>
                        {s.notificationEmail ? (
                          <span className="text-xs text-muted-foreground inline-flex items-center gap-1" title={s.notificationEmail}>
                            <Mail className="w-3 h-3" /> {s.notificationEmail}
                          </span>
                        ) : (
                          <span className="text-xs text-destructive inline-flex items-center gap-1">
                            <MailX className="w-3 h-3" /> No notification email
                          </span>
                        )}
                        {canEdit && (
                          <div className="ml-auto flex items-center gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => moveStop(idx, -1)}
                              disabled={idx === 0 || stopsMutation.isPending}
                              data-testid={`button-move-up-${s.locationId}`}
                            >
                              <ArrowUp className="w-4 h-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => moveStop(idx, 1)}
                              disabled={idx === detail.stops.length - 1 || stopsMutation.isPending}
                              data-testid={`button-move-down-${s.locationId}`}
                            >
                              <ArrowDown className="w-4 h-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => removeStop(s.locationId)}
                              disabled={stopsMutation.isPending}
                              data-testid={`button-remove-stop-${s.locationId}`}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            {canDelete && editId !== null && (
              <Button
                variant="destructive"
                onClick={() => { if (confirm("Delete this route?")) deleteMutation.mutate(editId); }}
                disabled={deleteMutation.isPending}
                className="mr-auto"
                data-testid="button-delete-route"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Route
              </Button>
            )}
            <Button variant="outline" onClick={closeEdit} data-testid="button-close-edit">Close</Button>
            {canEdit && (
              <Button
                onClick={() => updateMutation.mutate()}
                disabled={!name.trim() || updateMutation.isPending}
                data-testid="button-save-route"
              >
                {updateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Save Details
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
