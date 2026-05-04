import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { useCurrentUser, useUsersBasic } from "@/hooks/use-users";
import { getCsrfToken, queryClient } from "@/lib/queryClient";
import { WAREHOUSES, WAREHOUSE_LABELS } from "@shared/schema";
import type { Trailer } from "@shared/schema";
import { Loader2, Download, Calendar as CalendarIcon, MapPin, Truck, ExternalLink, Check } from "lucide-react";

const FIELD_TO_MANIFEST_ITEM: Record<string, string> = {
  totesRequested:               "Empty Totes",
  durosRequested:               "Empty Duros",
  blueBinsRequested:            "Empty Blue Bins",
  gaylordsRequested:            "Empty Gaylords",
  palletsRequested:             "Empty Pallets",
  containersRequested:          "Empty Containers",
  apparelGaylordsRequested:     "Empty Gaylords",
  waresGaylordsRequested:       "Empty Gaylords",
  electricalGaylordsRequested:  "Empty Gaylords",
  accessoriesGaylordsRequested: "Empty Gaylords",
  booksGaylordsRequested:       "Empty Gaylords",
  shoesGaylordsRequested:       "Empty Gaylords",
  furnitureGaylordsRequested:   "Empty Gaylords",
};

function aggregateGroupAsItems(group: { stops: { values: Record<string, number> }[] }): Record<string, number> {
  const out: Record<string, number> = {};
  for (const stop of group.stops) {
    for (const [field, item] of Object.entries(FIELD_TO_MANIFEST_ITEM)) {
      const v = Number(stop.values[field] ?? 0);
      if (!Number.isFinite(v) || v <= 0) continue;
      out[item] = (out[item] ?? 0) + v;
    }
  }
  return out;
}

interface DailyField {
  key: string;
  snake: string;
  label: string;
  category: string;
}

interface DailyStop {
  locationId: number | null;
  locationName: string;
  orderId: number | null;
  values: Record<string, number>;
  notes?: string;
}

interface DailyRouteGroup {
  routeId: number | null;
  routeName: string;
  stops: DailyStop[];
}

interface DailyRouteData {
  date: string;
  fields: DailyField[];
  groups: DailyRouteGroup[];
  totalOrders: number;
}

interface ExistingManifest {
  id: number;
  routeId: number | null;
  status: string;
  trailerNumber: string | null;
  driverName: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  loading: "Loading",
  in_transit: "In Transit",
  delivered: "Delivered",
  closed: "Closed",
};

function todayInNY(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function DailyRoute() {
  const [date, setDate] = useState<string>(todayInNY());
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();
  const { can } = usePermissions();
  const canCreateManifests = can("trailer_manifest.edit");

  const [drawerRoute, setDrawerRoute] = useState<DailyRouteGroup | null>(null);
  const [formWarehouse, setFormWarehouse] = useState("");
  const [formTrailer, setFormTrailer] = useState("");
  const [formDriver, setFormDriver] = useState("");

  const warehouseOptions = WAREHOUSES.map(w => ({ value: WAREHOUSE_LABELS[w], label: WAREHOUSE_LABELS[w] }));

  const { data: trailers = [] } = useQuery<Trailer[]>({ queryKey: ["/api/trailers"], enabled: canCreateManifests });
  const activeTrailers = trailers.filter(t => t.isActive);

  const { data: currentUser } = useCurrentUser();
  const currentUserId = currentUser?.user?.id;
  const { data: pickerUsers = [] } = useUsersBasic();

  const { data, isLoading, isFetching, error } = useQuery<DailyRouteData>({
    queryKey: ["/api/daily-route", { date }],
    queryFn: async () => {
      const res = await fetch(`/api/daily-route?date=${encodeURIComponent(date)}`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Failed to load (${res.status})`);
      }
      return res.json();
    },
  });

  const { data: existingManifests = [] } = useQuery<ExistingManifest[]>({
    queryKey: ["/api/daily-route/manifests", { date }],
    queryFn: async () => {
      const res = await fetch(`/api/daily-route/manifests?date=${encodeURIComponent(date)}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const manifestByRouteId = useMemo(() => {
    const map = new Map<number, ExistingManifest>();
    for (const m of existingManifests) {
      if (m.routeId != null) map.set(m.routeId, m);
    }
    return map;
  }, [existingManifests]);

  useEffect(() => {
    if (drawerRoute && currentUserId && !formDriver) {
      setFormDriver(String(currentUserId));
    }
  }, [drawerRoute, currentUserId, formDriver]);

  type LocRow = { locationName: string; values: Record<string, number>; notes: string[] };
  const locationRows = useMemo<LocRow[]>(() => {
    if (!data) return [];
    const byName = new Map<string, LocRow>();
    const order: string[] = [];
    for (const g of data.groups) {
      for (const stop of g.stops) {
        const existing = byName.get(stop.locationName);
        const stopNote = (stop.notes ?? "").trim();
        if (existing) {
          for (const [k, v] of Object.entries(stop.values)) {
            existing.values[k] = (existing.values[k] ?? 0) + Number(v ?? 0);
          }
          if (stopNote && !existing.notes.includes(stopNote)) existing.notes.push(stopNote);
        } else {
          byName.set(stop.locationName, {
            locationName: stop.locationName,
            values: { ...stop.values },
            notes: stopNote ? [stopNote] : [],
          });
          order.push(stop.locationName);
        }
      }
    }
    return order.map(n => byName.get(n)!);
  }, [data]);

  const hasOrders = (data?.totalOrders ?? 0) > 0;
  const hasAny = locationRows.length > 0 && hasOrders;

  const sections = useMemo(() => {
    if (!data) return [] as Array<{ category: string; fields: DailyField[] }>;
    const out: Array<{ category: string; fields: DailyField[] }> = [];
    let current: { category: string; fields: DailyField[] } | null = null;
    for (const f of data.fields) {
      if (!current || current.category !== f.category) {
        current = { category: f.category, fields: [f] };
        out.push(current);
      } else {
        current.fields.push(f);
      }
    }
    return out;
  }, [data]);

  const allFields = useMemo(() => sections.flatMap(s => s.fields), [sections]);

  const drawerItemTotals = useMemo(() => {
    if (!drawerRoute) return {};
    return aggregateGroupAsItems(drawerRoute);
  }, [drawerRoute]);

  const openDrawer = (group: DailyRouteGroup) => {
    if (group.routeId === null) return;
    setDrawerRoute(group);
    setFormWarehouse("");
    setFormTrailer("");
    setFormDriver(currentUserId ? String(currentUserId) : "");
  };

  const closeDrawer = () => {
    setDrawerRoute(null);
    setFormWarehouse("");
    setFormTrailer("");
    setFormDriver("");
  };

  const createManifest = useMutation({
    mutationFn: async (payload: {
      date: string;
      routeId: number;
      fromLocation: string;
      trailerNumber?: string | null;
      driverUserId?: number | null;
    }) => {
      const csrf = await getCsrfToken();
      const res = await fetch("/api/daily-route/create-manifest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrf ? { "CSRF-Token": csrf } : {}),
        },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        return { kind: "duplicate" as const, existingManifestId: body.existingManifestId as number };
      }
      if (!res.ok) {
        throw new Error(body?.message || `Create failed (${res.status})`);
      }
      return { kind: "created" as const, id: body.id as number };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/trailer-manifests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-route/manifests", { date }] });
      if (result.kind === "duplicate") {
        toast({
          title: "Manifest already exists",
          description: (
            <span>
              A manifest for this route and date already exists.{" "}
              <a href={`/trailer-manifests/${result.existingManifestId}`} className="underline font-medium">
                Open it →
              </a>
            </span>
          ),
        });
        closeDrawer();
        return;
      }
      toast({
        title: "Manifest created",
        description: (
          <span>
            Items pre-filled from today's route.{" "}
            <a href={`/trailer-manifests/${result.id}`} className="underline font-medium">
              Open manifest →
            </a>
          </span>
        ),
      });
      closeDrawer();
    },
    onError: (err: any) => {
      toast({
        title: "Could not create manifest",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    },
  });

  const handleCreateManifest = () => {
    if (!drawerRoute || drawerRoute.routeId === null) return;
    if (!formWarehouse.trim()) {
      toast({
        title: "Pick a From location",
        description: "We need to know which warehouse the trailer is leaving from.",
        variant: "destructive",
      });
      return;
    }
    createManifest.mutate({
      date,
      routeId: drawerRoute.routeId,
      fromLocation: formWarehouse.trim(),
      trailerNumber: formTrailer && formTrailer !== "__none__" ? formTrailer.trim() : null,
      driverUserId: formDriver && formDriver !== "__none__" ? Number(formDriver) : null,
    });
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/daily-route/export?date=${encodeURIComponent(date)}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `daily-route-${date}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({
        title: "Export failed",
        description: err?.message || "Unable to download the daily route Excel.",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-daily-route-title">
            <MapPin className="w-6 h-6" />
            Daily Route
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Approved Transfer-and-Receive orders for the selected date, by location.
          </p>
        </div>
        <div className="flex items-end gap-3">
          <div>
            <Label htmlFor="daily-route-date" className="text-xs">Date</Label>
            <div className="relative">
              <CalendarIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                id="daily-route-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="pl-9 w-44"
                data-testid="input-daily-route-date"
              />
            </div>
          </div>
          <Button
            onClick={handleExport}
            disabled={exporting || isLoading || !hasAny}
            data-testid="button-export-daily-route"
          >
            {exporting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Download className="w-4 h-4 mr-2" />
            )}
            Export to Excel
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">
              {data ? (
                <span data-testid="text-daily-route-summary">
                  {data.totalOrders} approved order{data.totalOrders === 1 ? "" : "s"} on {data.date}
                </span>
              ) : (
                <span>Loading…</span>
              )}
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              {data?.groups.map(g => {
                const existing = g.routeId != null ? manifestByRouteId.get(g.routeId) : undefined;
                const itemTotals = g.routeId === null ? {} : aggregateGroupAsItems(g);
                const totalQty = Object.values(itemTotals).reduce((s, n) => s + n, 0);
                const canCreate = g.routeId !== null && totalQty > 0;
                return (
                  <div
                    key={`${g.routeId ?? "unrouted"}`}
                    className="inline-flex items-center gap-1.5"
                  >
                    <Badge
                      variant={g.routeId === null ? "destructive" : "secondary"}
                      data-testid={`badge-route-${g.routeId ?? "unrouted"}`}
                    >
                      {g.routeName} · {g.stops.length}
                    </Badge>
                    {existing ? (
                      <Link
                        href={`/trailer-manifests/${existing.id}`}
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 hover:underline"
                        data-testid={`link-manifest-${g.routeId}`}
                      >
                        <Check className="w-3 h-3" />
                        Manifest: {STATUS_LABELS[existing.status] ?? existing.status}
                        {existing.trailerNumber && ` · #${existing.trailerNumber}`}
                        <ExternalLink className="w-2.5 h-2.5 ml-0.5" />
                      </Link>
                    ) : (
                      g.routeId !== null && canCreateManifests && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          disabled={!canCreate || createManifest.isPending}
                          onClick={() => openDrawer(g)}
                          title={
                            canCreate
                              ? "Create a trailer manifest pre-filled with this route's totals"
                              : "No equipment quantities on this route to put on a manifest"
                          }
                          data-testid={`button-create-manifest-route-${g.routeId}`}
                        >
                          <Truck className="w-3 h-3 mr-1" />
                          Create manifest
                        </Button>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Loading daily route…
            </div>
          ) : error ? (
            <div className="py-12 text-center text-sm text-destructive" data-testid="text-daily-route-error">
              {(error as Error).message}
            </div>
          ) : !hasAny ? (
            <div className="py-12 text-center text-sm text-muted-foreground" data-testid="text-daily-route-empty">
              No approved Transfer-and-Receive orders for {data?.date}.
            </div>
          ) : (
            <div className="overflow-auto border rounded-md">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-muted">
                    <th className="sticky left-0 bg-muted z-20 text-left px-3 py-1 border-b border-r min-w-[14rem] text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Location
                    </th>
                    {sections.map(section => (
                      <th
                        key={`cat-${section.category}`}
                        colSpan={section.fields.length}
                        className="text-center px-3 py-1 border-b border-l font-semibold"
                        data-testid={`header-category-${section.category}`}
                      >
                        {section.category}
                      </th>
                    ))}
                    <th className="bg-muted text-center px-3 py-1 border-b border-l min-w-[5rem] text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Total
                    </th>
                    <th className="sticky right-0 bg-muted z-20 text-left px-3 py-1 border-b border-l min-w-[16rem] text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Notes
                    </th>
                  </tr>
                  <tr className="bg-muted/60">
                    <th className="sticky left-0 bg-muted/60 z-20 border-b border-r" aria-hidden="true" />
                    {allFields.map(field => (
                      <th
                        key={`field-${field.key}`}
                        className="text-center px-3 py-2 border-b border-l font-medium text-xs whitespace-nowrap"
                        data-testid={`header-field-${field.key}`}
                      >
                        {field.label}
                      </th>
                    ))}
                    <th className="bg-muted/60 border-b border-l" aria-hidden="true" />
                    <th className="sticky right-0 bg-muted/60 z-20 border-b border-l" aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {locationRows.map(row => {
                    let rowTotal = 0;
                    return (
                      <tr
                        key={`loc-${row.locationName}`}
                        className="hover:bg-muted/20"
                        data-testid={`row-location-${row.locationName}`}
                      >
                        <td className="sticky left-0 bg-card z-10 px-3 py-1.5 border-b border-r font-medium whitespace-nowrap">
                          {row.locationName}
                        </td>
                        {allFields.map(field => {
                          const v = Number(row.values[field.key] ?? 0);
                          rowTotal += v;
                          return (
                            <td
                              key={`cell-${row.locationName}-${field.key}`}
                              className="text-right tabular-nums px-3 py-1.5 border-b border-l"
                              data-testid={`cell-${row.locationName}-${field.key}`}
                            >
                              {v === 0 ? "" : v}
                            </td>
                          );
                        })}
                        <td
                          className="bg-card text-right tabular-nums font-semibold px-3 py-1.5 border-b border-l"
                          data-testid={`cell-total-${row.locationName}`}
                        >
                          {rowTotal === 0 ? "" : rowTotal}
                        </td>
                        <td
                          className="sticky right-0 bg-card z-10 text-left text-xs px-3 py-1.5 border-b border-l align-top whitespace-pre-wrap break-words min-w-[16rem] max-w-[24rem]"
                          data-testid={`cell-notes-${row.locationName}`}
                        >
                          {row.notes.length > 0 ? row.notes.join(" | ") : ""}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-muted/60 font-semibold">
                    <td className="sticky left-0 bg-muted/60 z-10 px-3 py-2 border-t border-r">
                      Total
                    </td>
                    {(() => {
                      let grand = 0;
                      const cells = allFields.map(field => {
                        const sum = locationRows.reduce(
                          (s, r) => s + Number(r.values[field.key] ?? 0),
                          0,
                        );
                        grand += sum;
                        return (
                          <td
                            key={`foot-${field.key}`}
                            className="text-right tabular-nums px-3 py-2 border-t border-l"
                            data-testid={`footer-total-${field.key}`}
                          >
                            {sum === 0 ? "" : sum}
                          </td>
                        );
                      });
                      return (
                        <>
                          {cells}
                          <td
                            className="bg-muted/60 text-right tabular-nums px-3 py-2 border-t border-l"
                            data-testid="footer-total-grand"
                          >
                            {grand === 0 ? "" : grand}
                          </td>
                          <td
                            className="sticky right-0 bg-muted/60 z-10 px-3 py-2 border-t border-l"
                            aria-hidden="true"
                          />
                        </>
                      );
                    })()}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {data && isFetching && !isLoading && (
            <div className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Refreshing…
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={drawerRoute !== null} onOpenChange={(open) => { if (!open) closeDrawer(); }}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          {drawerRoute && (
            <>
              <SheetHeader className="text-left">
                <SheetTitle data-testid="text-manifest-drawer-title">
                  Create manifest — {drawerRoute.routeName}
                </SheetTitle>
                <SheetDescription>
                  Pre-fills item counts from {drawerRoute.stops.length} stop{drawerRoute.stops.length === 1 ? "" : "s"} on {date}. Fill in the trailer and driver, then hit Create.
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-5 py-6">
                <div className="space-y-1.5">
                  <Label htmlFor="manifest-warehouse">From warehouse *</Label>
                  <Select value={formWarehouse} onValueChange={setFormWarehouse}>
                    <SelectTrigger id="manifest-warehouse" data-testid="select-manifest-warehouse">
                      <SelectValue placeholder="Select warehouse" />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouseOptions.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="manifest-trailer">Trailer</Label>
                  <Select value={formTrailer} onValueChange={setFormTrailer}>
                    <SelectTrigger id="manifest-trailer" data-testid="select-manifest-trailer">
                      <SelectValue placeholder="Select trailer (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— None —</SelectItem>
                      {activeTrailers.map(t => (
                        <SelectItem key={t.id} value={t.number}>
                          {t.number}{t.notes ? ` — ${t.notes}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Can be assigned later on the manifest detail page.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="manifest-driver">Driver</Label>
                  <Select value={formDriver} onValueChange={setFormDriver}>
                    <SelectTrigger id="manifest-driver" data-testid="select-manifest-driver">
                      <SelectValue placeholder="Select driver (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— None —</SelectItem>
                      {pickerUsers.map(u => (
                        <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Defaults to you. Can be changed later.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <p className="text-sm" data-testid="text-manifest-to">
                    {drawerRoute.routeName}{" "}
                    <span className="text-muted-foreground">(route)</span>
                  </p>
                </div>

                <div className="rounded-md border">
                  <div className="px-3 py-2 border-b bg-muted/50">
                    <Label className="text-xs font-medium text-muted-foreground">Items being pre-filled</Label>
                  </div>
                  {Object.keys(drawerItemTotals).length === 0 ? (
                    <p className="text-sm text-muted-foreground px-3 py-3" data-testid="text-manifest-no-items">
                      No equipment quantities on this route.
                    </p>
                  ) : (
                    <ul className="divide-y" data-testid="list-manifest-items-preview">
                      {Object.entries(drawerItemTotals)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([itemName, qty]) => (
                          <li
                            key={itemName}
                            className="flex justify-between px-3 py-1.5 text-sm"
                            data-testid={`row-manifest-item-${itemName}`}
                          >
                            <span>{itemName}</span>
                            <span className="font-medium tabular-nums">{qty}</span>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              </div>

              <SheetFooter className="flex-row gap-2">
                <Button variant="outline" onClick={closeDrawer} className="flex-1" data-testid="button-cancel-create-manifest">
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateManifest}
                  disabled={
                    !formWarehouse ||
                    createManifest.isPending ||
                    Object.keys(drawerItemTotals).length === 0
                  }
                  className="flex-1"
                  data-testid="button-confirm-create-manifest"
                >
                  {createManifest.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Truck className="w-4 h-4 mr-2" />
                  )}
                  Create manifest
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
