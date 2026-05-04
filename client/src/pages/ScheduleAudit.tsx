import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PieChart, TrendingUp, Clock } from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import { isSchedulableLocation, getCanonicalJobCode, getJobTitle } from "@/lib/utils";
import type { Location } from "@shared/schema";

const JOB_COLORS: Record<string, string> = {
  STSUPER: "#9333EA",
  STASSTSP: "#F97316",
  STLDWKR: "#84CC16",
  CASHSLS: "#EC4899",
  APPROC: "#3B82F6",
  DONPRI: "#22C55E",
  DONDOOR: "#F472B6",
  SLSFLR: "#0EA5E9",
  ALTSTLD: "#A855F7",
  EBCLK: "#14B8A6",
  OUTCP: "#3B82F6",
  OUTMH: "#F59E0B",
  OUTSHS: "#8B5CF6",
  OUTAM: "#F97316",
  OUTMGR: "#9333EA",
  ECOMDIR: "#9333EA",
  ECMCOMLD: "#F97316",
  EASSIS: "#84CC16",
  ECOMSL: "#06B6D4",
  ECSHIP: "#8B5CF6",
  ECOMCOMP: "#14B8A6",
  ECOMJSE: "#F59E0B",
  ECOMJSO: "#EF4444",
  ECQCS: "#10B981",
  EPROCOOR: "#6366F1",
  ECCUST: "#78716C",
  ECOPAS: "#D946EF",
};

const PRODUCTION_CODES = new Set(["APPROC", "DONPRI"]);

function isProductionCode(code: string): boolean {
  return PRODUCTION_CODES.has(getCanonicalJobCode(code));
}

function getJobColor(code: string): string {
  const canonical = getCanonicalJobCode(code);
  return JOB_COLORS[canonical] ?? "#6B7280";
}

function getLabel(code: string): string {
  return getJobTitle(code) || code;
}

function getSundayStart(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return format(d, "yyyy-MM-dd");
}

interface JobCodeData {
  code: string;
  hours: number;
  percentage: number;
}

interface WeekData {
  weekStart: string;
  totalHours: number;
  jobCodes: JobCodeData[];
}

interface AuditResponse {
  weeks: WeekData[];
}

export default function ScheduleAudit() {
  const { user, role } = usePermissions();

  const defaultWeekStart = useMemo(() => {
    const now = new Date();
    const day = now.getDay();
    const sunday = new Date(now);
    sunday.setDate(now.getDate() - day);
    return format(sunday, "yyyy-MM-dd");
  }, []);

  const [weekStartInput, setWeekStartInput] = useState(defaultWeekStart);
  const [weekCount, setWeekCount] = useState("1");
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");

  const selectedWeekStart = useMemo(() => getSundayStart(weekStartInput), [weekStartInput]);
  const numWeeks = parseInt(weekCount);

  const weekStarts = useMemo(() => {
    const starts: string[] = [];
    const base = new Date(selectedWeekStart + "T12:00:00");
    for (let i = 0; i < numWeeks; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i * 7);
      starts.push(format(d, "yyyy-MM-dd"));
    }
    return starts;
  }, [selectedWeekStart, numWeeks]);

  const { data: locations = [] } = useQuery<Location[]>({ queryKey: ["/api/locations"] });

  const isAdmin = role === "admin";
  const userLocationIds = user?.locationIds ?? [];

  const visibleLocations = useMemo(() => {
    const filtered = isAdmin
      ? locations.filter(isSchedulableLocation)
      : locations.filter(l => isSchedulableLocation(l) && userLocationIds.includes(String(l.id)));
    return filtered.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [locations, isAdmin, userLocationIds]);

  useEffect(() => {
    if (visibleLocations.length > 0 && !selectedLocationId) {
      setSelectedLocationId(String(visibleLocations[0].id));
    }
  }, [visibleLocations, selectedLocationId]);

  const selectedLocation = useMemo(() => {
    const loc = locations.find(l => String(l.id) === selectedLocationId);
    return loc?.name ?? "";
  }, [locations, selectedLocationId]);

  const queryParams = useMemo(() => {
    if (!selectedLocation || weekStarts.length === 0) return "";
    const params = new URLSearchParams({
      weekStarts: weekStarts.join(","),
      location: selectedLocation,
    });
    return params.toString();
  }, [weekStarts, selectedLocation]);

  const { data: auditData, isLoading } = useQuery<AuditResponse>({
    queryKey: ["/api/reports/schedule-audit", queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/reports/schedule-audit?${queryParams}`);
      if (!res.ok) throw new Error("Failed to fetch schedule audit");
      return res.json();
    },
    enabled: !!queryParams,
  });

  const { allJobCodes, codeColorMap } = useMemo(() => {
    if (!auditData?.weeks?.length) return { allJobCodes: [] as string[], codeColorMap: {} as Record<string, string> };

    const totalByCode: Record<string, number> = {};
    for (const week of auditData.weeks) {
      for (const jc of week.jobCodes) {
        totalByCode[jc.code] = (totalByCode[jc.code] || 0) + jc.hours;
      }
    }

    const sorted = Object.entries(totalByCode)
      .sort(([, a], [, b]) => b - a)
      .map(([code]) => code);

    const colorMap: Record<string, string> = {};
    sorted.forEach((code) => {
      colorMap[code] = getJobColor(code);
    });

    return { allJobCodes: sorted, codeColorMap: colorMap };
  }, [auditData]);

  const averageData = useMemo((): WeekData | null => {
    if (!auditData?.weeks?.length || auditData.weeks.length <= 1) return null;

    const hoursByCode: Record<string, number[]> = {};
    const totals: number[] = [];

    for (const week of auditData.weeks) {
      totals.push(week.totalHours);
      for (const jc of week.jobCodes) {
        if (!hoursByCode[jc.code]) hoursByCode[jc.code] = [];
        hoursByCode[jc.code].push(jc.hours);
      }
    }

    const n = auditData.weeks.length;
    const avgTotal = totals.reduce((s, v) => s + v, 0) / n;

    const jobCodes: JobCodeData[] = Object.entries(hoursByCode)
      .map(([code, hours]) => {
        const avg = hours.reduce((s, v) => s + v, 0) / n;
        return {
          code,
          hours: Math.round(avg * 100) / 100,
          percentage: avgTotal > 0 ? Math.round((avg / avgTotal) * 10000) / 100 : 0,
        };
      })
      .sort((a, b) => b.hours - a.hours);

    return { weekStart: "average", totalHours: Math.round(avgTotal * 100) / 100, jobCodes };
  }, [auditData]);

  const displayRows = useMemo(() => {
    if (!auditData?.weeks?.length) return [];
    const rows = [...auditData.weeks];
    if (averageData) rows.push(averageData);
    return rows;
  }, [auditData, averageData]);

  const hasData = displayRows.length > 0 && displayRows.some(r => r.totalHours > 0);

  return (
    <div className="p-3 sm:p-6 lg:p-10 space-y-4 sm:space-y-6 max-w-[1200px] mx-auto">
      <div>
        <h1 className="text-xl sm:text-3xl font-bold font-display flex items-center gap-2 sm:gap-3" data-testid="text-page-title">
          <PieChart className="w-5 h-5 sm:w-8 sm:h-8 text-blue-500" />
          Schedule Audit
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          Labor allocation by job code — see how scheduled hours are distributed across roles.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 sm:gap-4">
        <div className="col-span-2 sm:w-64">
          <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
            <SelectTrigger data-testid="select-location">
              <SelectValue placeholder="Select store..." />
            </SelectTrigger>
            <SelectContent>
              {visibleLocations.map(loc => (
                <SelectItem key={loc.id} value={String(loc.id)} data-testid={`select-location-${loc.id}`}>
                  {loc.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          <label className="text-xs sm:text-sm font-medium text-muted-foreground whitespace-nowrap">Week of:</label>
          <Input
            type="date"
            value={weekStartInput}
            onChange={(e) => setWeekStartInput(e.target.value)}
            className="sm:w-40"
            data-testid="input-week-start"
          />
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          <label className="text-xs sm:text-sm font-medium text-muted-foreground whitespace-nowrap">Weeks:</label>
          <Select value={weekCount} onValueChange={setWeekCount}>
            <SelectTrigger className="w-20" data-testid="select-week-count">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1</SelectItem>
              <SelectItem value="2">2</SelectItem>
              <SelectItem value="4">4</SelectItem>
              <SelectItem value="8">8</SelectItem>
              <SelectItem value="13">13</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading && (
        <Card>
          <CardContent className="p-6">
            <div className="space-y-4">
              {Array.from({ length: numWeeks }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && !hasData && selectedLocation && (
        <Card>
          <CardContent className="p-10 text-center">
            <PieChart className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-muted-foreground">No scheduled shifts found for the selected period.</p>
          </CardContent>
        </Card>
      )}

      {hasData && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base sm:text-lg flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Labor Allocation
              {numWeeks > 1 && (
                <span className="text-xs text-muted-foreground font-normal ml-1">
                  ({numWeeks} weeks{averageData ? " + average" : ""})
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {displayRows.map((row) => {
              const isAverage = row.weekStart === "average";
              const label = isAverage
                ? "Average"
                : `Wk of ${format(new Date(row.weekStart + "T12:00:00"), "M/d")}`;

              return (
                <div
                  key={row.weekStart}
                  className={`flex items-center gap-3 ${isAverage ? "pt-3 border-t-2 border-dashed" : ""}`}
                  data-testid={`chart-row-${row.weekStart}`}
                >
                  <div className="w-20 sm:w-24 text-xs sm:text-sm shrink-0">
                    {isAverage ? (
                      <span className="text-foreground font-semibold">{label}</span>
                    ) : (
                      <span className="text-muted-foreground font-medium">{label}</span>
                    )}
                  </div>
                  <div className="flex flex-1 h-9 sm:h-10 rounded-lg overflow-hidden bg-muted/30">
                    {row.jobCodes.map((jc) => (
                      <div
                        key={jc.code}
                        style={{
                          width: `${jc.percentage}%`,
                          backgroundColor: codeColorMap[jc.code] || "#94a3b8",
                        }}
                        className="flex items-center justify-center text-[10px] sm:text-xs text-white font-medium overflow-hidden transition-opacity hover:opacity-80 cursor-default"
                        title={`${getLabel(jc.code)}: ${jc.hours.toFixed(1)}h (${jc.percentage.toFixed(1)}%)`}
                        data-testid={`bar-segment-${row.weekStart}-${jc.code}`}
                      >
                        {jc.percentage >= 10
                          ? `${jc.percentage.toFixed(0)}%`
                          : jc.percentage >= 5
                          ? `${jc.percentage.toFixed(0)}`
                          : ""}
                      </div>
                    ))}
                  </div>
                  <div
                    className="w-14 sm:w-16 text-xs sm:text-sm text-right font-medium shrink-0 tabular-nums"
                    data-testid={`text-total-hours-${row.weekStart}`}
                  >
                    {row.totalHours.toFixed(0)}h
                  </div>
                </div>
              );
            })}

            <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-3 border-t">
              {allJobCodes.map((code) => (
                <div key={code} className="flex items-center gap-1.5 text-xs" data-testid={`legend-${code}`}>
                  <div
                    className="w-3 h-3 rounded-sm shrink-0"
                    style={{ backgroundColor: codeColorMap[code] }}
                  />
                  <span className="text-muted-foreground">{getLabel(code)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {hasData && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base sm:text-lg flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Detail Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[140px]">Job Code</TableHead>
                    {displayRows.map(row => (
                      <TableHead key={row.weekStart} className="text-right min-w-[100px]">
                        {row.weekStart === "average"
                          ? "Average"
                          : `Wk ${format(new Date(row.weekStart + "T12:00:00"), "M/d")}`}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allJobCodes.map(code => (
                    <TableRow key={code} data-testid={`row-job-${code}`}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2.5 h-2.5 rounded-sm shrink-0"
                            style={{ backgroundColor: codeColorMap[code] }}
                          />
                          {getLabel(code)}
                        </div>
                      </TableCell>
                      {displayRows.map(row => {
                        const jc = row.jobCodes.find(j => j.code === code);
                        return (
                          <TableCell key={row.weekStart} className="text-right tabular-nums">
                            {jc ? (
                              <span>
                                {jc.hours.toFixed(1)}h
                                <span className="text-muted-foreground ml-1 text-xs">
                                  ({jc.percentage.toFixed(1)}%)
                                </span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 bg-muted/40 font-semibold" data-testid="row-production-subtotal">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-sm shrink-0 bg-gradient-to-r from-[#3B82F6] to-[#22C55E]" />
                        Production %
                      </div>
                    </TableCell>
                    {displayRows.map(row => {
                      const prodHours = row.jobCodes
                        .filter(jc => isProductionCode(jc.code))
                        .reduce((sum, jc) => sum + jc.hours, 0);
                      const prodPct = row.totalHours > 0
                        ? Math.round((prodHours / row.totalHours) * 10000) / 100
                        : 0;
                      return (
                        <TableCell
                          key={row.weekStart}
                          className="text-right tabular-nums"
                          data-testid={`text-production-pct-${row.weekStart}`}
                        >
                          {prodHours.toFixed(1)}h
                          <span className="text-muted-foreground ml-1 text-xs">
                            ({prodPct.toFixed(1)}%)
                          </span>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                  <TableRow className="border-t-2 font-semibold">
                    <TableCell>Total</TableCell>
                    {displayRows.map(row => (
                      <TableCell
                        key={row.weekStart}
                        className="text-right tabular-nums"
                        data-testid={`text-table-total-${row.weekStart}`}
                      >
                        {row.totalHours.toFixed(1)}h
                      </TableCell>
                    ))}
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
