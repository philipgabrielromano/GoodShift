import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Download, Calendar as CalendarIcon, MapPin } from "lucide-react";

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
              {data?.groups.map(g => (
                <Badge
                  key={`${g.routeId ?? "unrouted"}`}
                  variant={g.routeId === null ? "destructive" : "secondary"}
                  data-testid={`badge-route-${g.routeId ?? "unrouted"}`}
                >
                  {g.routeName} · {g.stops.length}
                </Badge>
              ))}
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
