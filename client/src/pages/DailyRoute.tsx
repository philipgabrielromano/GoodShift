import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { getCsrfToken, queryClient } from "@/lib/queryClient";
import { WAREHOUSES, WAREHOUSE_LABELS } from "@shared/schema";
import { Loader2, Download, Calendar as CalendarIcon, MapPin, Truck } from "lucide-react";

// Mirror of server FIELD_TO_MANIFEST_ITEM. Kept here only so the dialog
// can show a live preview of which items will be pre-filled. The server is
// the source of truth for what actually gets written.
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

// Today in America/New_York, formatted YYYY-MM-DD. We default the picker to
// the operator's local "today" rather than UTC so a 10pm-EST visit doesn't
// flip to tomorrow.
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
  const [, setNavLocation] = useLocation();
  const { can } = usePermissions();
  const canCreateManifests = can("trailer_manifest.edit");

  // "Create manifest" dialog state. Stores which route the user clicked so
  // the dialog can read its quantities + show a preview without re-querying.
  const [manifestDialog, setManifestDialog] = useState<
    | null
    | { routeId: number; routeName: string; itemTotals: Record<string, number>; stopCount: number }
  >(null);
  const [manifestFromLocation, setManifestFromLocation] = useState("");

  // Origin must be a warehouse (Cleveland or Canton). Stores never originate
  // a manifest — the route is always Warehouse → stops, so the dropdown is
  // intentionally limited to the two warehouses.
  const warehouseOptions = WAREHOUSES.map(w => ({ value: WAREHOUSE_LABELS[w], label: WAREHOUSE_LABELS[w] }));

  const { data, isLoading, isFetching, error } = useQuery<DailyRouteData>({
    queryKey: ["/api/daily-route", { date }],
    queryFn: async () => {
      const res = await fetch(`/api/daily-route?date=${encodeURIComponent(date)}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Failed to load (${res.status})`);
      }
      return res.json();
    },
  });

  // Flatten stops once for column rendering and also build the per-row totals.
  const flat = useMemo(() => {
    if (!data) return { stops: [] as Array<{ groupIdx: number; stop: DailyStop }>, groups: [] };
    const stops: Array<{ groupIdx: number; stop: DailyStop }> = [];
    data.groups.forEach((g, gi) => g.stops.forEach(s => stops.push({ groupIdx: gi, stop: s })));
    return { stops, groups: data.groups };
  }, [data]);

  const totalCols = flat.stops.length;
  // The page always renders the routes structure once loaded, but "has data"
  // is gated on whether any approved orders exist for this date — that's
  // what controls the empty-state copy and the export button. Without this
  // check, a day with zero orders would still show a populated grid of
  // route stops (all blanks) and let the user export an empty workbook.
  const hasOrders = (data?.totalOrders ?? 0) > 0;
  const hasAny = totalCols > 0 && hasOrders;

  // Group fields by category to render section headers in the table.
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

  // Submit the "Create manifest" dialog. Uses raw fetch (rather than
  // apiRequest) so we can read the body of a 409 response and surface the
  // existing manifest's id to the operator instead of just an error string.
  const createManifest = useMutation({
    mutationFn: async (payload: { date: string; routeId: number; fromLocation: string }) => {
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
      if (result.kind === "duplicate") {
        const id = result.existingManifestId;
        toast({
          title: "Manifest already exists for this route and date",
          description: "Opening the existing manifest…",
        });
        setManifestDialog(null);
        setManifestFromLocation("");
        if (id) setNavLocation(`/trailer-manifests/${id}`);
        return;
      }
      toast({ title: "Trailer manifest created", description: "Item counts pre-filled from today's daily route." });
      setManifestDialog(null);
      setManifestFromLocation("");
      setNavLocation(`/trailer-manifests/${result.id}`);
    },
    onError: (err: any) => {
      toast({
        title: "Could not create manifest",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    },
  });

  const openManifestDialog = (group: DailyRouteGroup) => {
    if (group.routeId === null) return;
    const itemTotals = aggregateGroupAsItems(group);
    setManifestDialog({
      routeId: group.routeId,
      routeName: group.routeName,
      itemTotals,
      stopCount: group.stops.length,
    });
    setManifestFromLocation("");
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
            Approved Transfer-and-Receive orders for the selected date, grouped by route.
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
                    {g.routeId !== null && canCreateManifests && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        disabled={!canCreate || createManifest.isPending}
                        onClick={() => openManifestDialog(g)}
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
                  {/* Route band */}
                  <tr className="bg-muted">
                    <th
                      className="sticky left-0 bg-muted z-20 text-left px-3 py-2 border-b border-r min-w-[12rem]"
                      rowSpan={2}
                    >
                      Item
                    </th>
                    {flat.groups.map((g) => {
                      if (g.stops.length === 0) return null;
                      return (
                        <th
                          key={`grp-${g.routeId ?? "u"}`}
                          colSpan={g.stops.length}
                          className={`text-center px-3 py-2 border-b border-l font-semibold ${g.routeId === null ? "bg-destructive/10 text-destructive" : ""}`}
                          data-testid={`header-route-${g.routeId ?? "unrouted"}`}
                        >
                          {g.routeName}
                        </th>
                      );
                    })}
                    <th
                      className="sticky right-0 bg-muted z-20 text-center px-3 py-2 border-b border-l min-w-[5rem]"
                      rowSpan={2}
                    >
                      Total
                    </th>
                  </tr>
                  {/* Store names */}
                  <tr className="bg-muted/60">
                    {flat.stops.map((entry) => (
                      <th
                        key={`stop-${entry.groupIdx}-${entry.stop.locationName}-${entry.stop.orderId ?? "x"}`}
                        className="text-center px-3 py-2 border-b border-l font-medium text-xs whitespace-nowrap"
                        data-testid={`header-store-${entry.stop.locationName}`}
                      >
                        {entry.stop.locationName}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sections.map(section => (
                    <SectionRows key={section.category} section={section} flatStops={flat.stops} totalCols={totalCols} />
                  ))}
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

      <Dialog
        open={manifestDialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setManifestDialog(null);
            setManifestFromLocation("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md" data-testid="dialog-create-manifest">
          <DialogHeader>
            <DialogTitle>Create manifest from route</DialogTitle>
            <DialogDescription>
              {manifestDialog
                ? `Pre-fills item counts from ${manifestDialog.stopCount} stop${manifestDialog.stopCount === 1 ? "" : "s"} on ${manifestDialog.routeName} for ${date}. Trailer and driver are left blank for you to fill in later.`
                : ""}
            </DialogDescription>
          </DialogHeader>

          {manifestDialog && (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="manifest-from-location">From location *</Label>
                <Select value={manifestFromLocation} onValueChange={setManifestFromLocation}>
                  <SelectTrigger id="manifest-from-location" data-testid="select-manifest-from-location">
                    <SelectValue placeholder="Select warehouse" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouseOptions.map(opt => (
                      <SelectItem
                        key={opt.value}
                        value={opt.value}
                        data-testid={`select-manifest-from-option-${opt.value.toLowerCase()}`}
                      >
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">To</Label>
                <p className="text-sm" data-testid="text-manifest-to-preview">
                  {manifestDialog.routeName}{" "}
                  <span className="text-muted-foreground">(route)</span>
                </p>
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Items being pre-filled</Label>
                {Object.keys(manifestDialog.itemTotals).length === 0 ? (
                  <p className="text-sm text-muted-foreground" data-testid="text-manifest-no-items">
                    No equipment quantities on this route — nothing to pre-fill.
                  </p>
                ) : (
                  <ul className="text-sm border rounded-md divide-y" data-testid="list-manifest-items-preview">
                    {Object.entries(manifestDialog.itemTotals)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([itemName, qty]) => (
                        <li
                          key={itemName}
                          className="flex justify-between px-3 py-1.5"
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
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setManifestDialog(null);
                setManifestFromLocation("");
              }}
              data-testid="button-cancel-create-manifest"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!manifestDialog) return;
                if (!manifestFromLocation.trim()) {
                  toast({
                    title: "Pick a From location",
                    description: "We need to know which warehouse the trailer is leaving from.",
                    variant: "destructive",
                  });
                  return;
                }
                createManifest.mutate({
                  date,
                  routeId: manifestDialog.routeId,
                  fromLocation: manifestFromLocation.trim(),
                });
              }}
              disabled={
                !manifestDialog ||
                !manifestFromLocation ||
                createManifest.isPending ||
                Object.keys(manifestDialog?.itemTotals ?? {}).length === 0
              }
              data-testid="button-confirm-create-manifest"
            >
              {createManifest.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Truck className="w-4 h-4 mr-2" />
              )}
              Create manifest
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SectionRows({
  section,
  flatStops,
  totalCols,
}: {
  section: { category: string; fields: DailyField[] };
  flatStops: Array<{ groupIdx: number; stop: DailyStop }>;
  totalCols: number;
}) {
  return (
    <>
      <tr className="bg-muted/30">
        <td
          className="sticky left-0 bg-muted/30 z-10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b"
          colSpan={totalCols + 2}
        >
          {section.category}
        </td>
      </tr>
      {section.fields.map(field => {
        let rowTotal = 0;
        const cells = flatStops.map(entry => {
          const v = entry.stop.values[field.key] ?? 0;
          rowTotal += v;
          return v;
        });
        return (
          <tr key={field.key} className="hover:bg-muted/20" data-testid={`row-item-${field.key}`}>
            <td className="sticky left-0 bg-card z-10 px-3 py-1.5 border-b border-r font-medium whitespace-nowrap">
              {field.label}
            </td>
            {flatStops.map((entry, i) => {
              const v = cells[i];
              return (
                <td
                  key={`cell-${field.key}-${entry.groupIdx}-${entry.stop.locationName}-${entry.stop.orderId ?? i}`}
                  className={`text-right px-3 py-1.5 border-b border-l tabular-nums ${v === 0 ? "text-muted-foreground/40" : ""}`}
                  data-testid={`cell-${field.key}-${entry.stop.locationName}`}
                >
                  {v === 0 ? "" : v}
                </td>
              );
            })}
            <td
              className={`sticky right-0 bg-card z-10 text-right px-3 py-1.5 border-b border-l font-semibold tabular-nums ${rowTotal === 0 ? "text-muted-foreground/40" : ""}`}
              data-testid={`total-${field.key}`}
            >
              {rowTotal === 0 ? "" : rowTotal}
            </td>
          </tr>
        );
      })}
    </>
  );
}
