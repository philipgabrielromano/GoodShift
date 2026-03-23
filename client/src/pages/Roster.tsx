import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { isValidLocation } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, Target, BarChart3, TrendingUp, TrendingDown, Minus, Globe } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { RosterTarget } from "@shared/schema";

interface AuthStatus {
  isAuthenticated: boolean;
  user: { id: number; name: string; email: string; role: string; locationIds: string[] | null } | null;
}

interface Location {
  id: number;
  name: string;
  isActive: boolean;
}

interface RosterReportRow {
  jobCode: string;
  targetFte: number | null;
  actualFte: number | null;
  fteVariance: number | null;
}

interface ConsolidatedRow {
  locationId: number;
  locationName: string;
  totalTargetFte: number | null;
  totalActualFte: number | null;
  fteVariance: number | null;
  vacancyRate: number | null;
}

const JOB_CODE_LABELS: Record<string, string> = {
  APPROC: "Apparel Processor",
  CASHSLS: "Cashier",
  DONDOOR: "Donor Greeter",
  DONPRI: "Donation Pricing Associate",
  SLSFLR: "Sales Floor Associate",
  ALTSTLD: "Alt. Store Lead",
  STLDWKR: "Team Lead",
  STASSTSP: "Assistant Manager",
  STSUPER: "Store Manager",
  APWV: "Apparel Processor (WV)",
  CSHSLSWV: "Cashier (WV)",
  WVDON: "Donor Greeter (WV)",
  DONPRWV: "Donation Pricing Associate (WV)",
  WVLDWRK: "Team Lead (WV)",
  WVSTAST: "Assistant Manager (WV)",
  WVSTMNG: "Store Manager (WV)",
  OUTCP: "Outlet Clothing Processor",
  OUTMH: "Outlet Material Handler",
  OUTSHS: "Outlet Sales/Softlines",
  OUTAM: "Outlet Asst. Manager",
  OUTMGR: "Outlet Manager",
};

const JOB_CODE_ORDER = Object.keys(JOB_CODE_LABELS);

function sortByCodes(codes: string[]): string[] {
  return codes.slice().sort((a, b) => {
    const ai = JOB_CODE_ORDER.indexOf(a);
    const bi = JOB_CODE_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
}

function getLabel(code: string): string {
  return JOB_CODE_LABELS[code] ?? code;
}

function fmtFte(val: number | null | undefined): string {
  if (val == null) return "—";
  return val.toFixed(2);
}

function VarianceBadge({ v }: { v: number | null }) {
  if (v === null) return <span className="text-muted-foreground">—</span>;
  const cls = v > 0
    ? "text-green-600 dark:text-green-400"
    : v < 0
    ? "text-red-600 dark:text-red-400"
    : "text-muted-foreground";
  return <span className={`font-semibold ${cls}`}>{v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)}</span>;
}

export default function Roster() {
  const { toast } = useToast();
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [targetFteDrafts, setTargetFteDrafts] = useState<Record<string, string>>({});

  const { data: authStatus } = useQuery<AuthStatus>({ queryKey: ["/api/auth/status"] });
  const { data: locations = [] } = useQuery<Location[]>({ queryKey: ["/api/locations"] });

  const isAdmin = authStatus?.user?.role === "admin";
  const userLocationIds = authStatus?.user?.locationIds ?? [];

  const visibleLocations = useMemo(() => {
    const filtered = isAdmin
      ? locations.filter(isValidLocation)
      : locations.filter(l => isValidLocation(l) && userLocationIds.includes(String(l.id)));
    return filtered.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [locations, isAdmin, userLocationIds]);

  useEffect(() => {
    if (visibleLocations.length > 0 && selectedLocationId === null) {
      setSelectedLocationId(visibleLocations[0].id);
    }
  }, [visibleLocations, selectedLocationId]);

  const { data: targets = [], isLoading: targetsLoading } = useQuery<RosterTarget[]>({
    queryKey: ["/api/roster-targets", selectedLocationId],
    queryFn: async () => {
      if (!selectedLocationId) return [];
      const res = await fetch(`/api/roster-targets?locationId=${selectedLocationId}`);
      if (!res.ok) throw new Error("Failed to fetch targets");
      return res.json();
    },
    enabled: !!selectedLocationId,
  });

  const { data: reportRows = [], isLoading: reportLoading } = useQuery<RosterReportRow[]>({
    queryKey: ["/api/roster-report", selectedLocationId],
    queryFn: async () => {
      if (!selectedLocationId) return [];
      const res = await fetch(`/api/roster-report?locationId=${selectedLocationId}`);
      if (!res.ok) throw new Error("Failed to fetch report");
      return res.json();
    },
    enabled: !!selectedLocationId,
  });

  const { data: consolidatedRows = [], isLoading: consolidatedLoading } = useQuery<ConsolidatedRow[]>({
    queryKey: ["/api/roster-consolidated"],
    queryFn: async () => {
      const res = await fetch("/api/roster-consolidated");
      if (!res.ok) throw new Error("Failed to fetch consolidated report");
      return res.json();
    },
  });

  // Sync drafts from saved targets
  useEffect(() => {
    const tDrafts: Record<string, string> = {};
    for (const t of targets) {
      if (t.targetFte != null) tDrafts[t.jobCode] = String(t.targetFte);
    }
    setTargetFteDrafts(tDrafts);
  }, [targets]);

  const upsertMutation = useMutation({
    mutationFn: async (data: { locationId: number; jobCode: string; targetCount: number; targetFte?: number | null; fteValue?: number | null }) => {
      return apiRequest("POST", "/api/roster-targets", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roster-targets", selectedLocationId] });
      queryClient.invalidateQueries({ queryKey: ["/api/roster-report", selectedLocationId] });
      queryClient.invalidateQueries({ queryKey: ["/api/roster-consolidated"] });
    },
  });

  const handleSaveAll = async () => {
    if (!selectedLocationId) return;
    const allCodes = Object.keys(targetFteDrafts).filter(code => targetFteDrafts[code]);

    let saved = 0;
    let failed = 0;
    for (const jobCode of allCodes) {
      const tVal = targetFteDrafts[jobCode];
      const targetFte = tVal && !isNaN(Number(tVal)) ? parseFloat(tVal) : null;
      try {
        await upsertMutation.mutateAsync({ locationId: selectedLocationId, jobCode, targetCount: 0, targetFte, fteValue: null });
        saved++;
      } catch {
        failed++;
      }
    }
    if (failed === 0) {
      toast({ title: "Targets saved", description: `${saved} position${saved !== 1 ? "s" : ""} saved successfully.` });
    } else {
      toast({ title: "Partial save", description: `${saved} saved, ${failed} failed.`, variant: "destructive" });
    }
  };

  const sortedReportRows = sortByCodes(reportRows.map(r => r.jobCode)).map(
    code => reportRows.find(r => r.jobCode === code)!
  ).filter(Boolean);

  const selectedLocationName = visibleLocations.find(l => l.id === selectedLocationId)?.name ?? "";

  // Report summary totals
  const totalTargetFte = sortedReportRows.some(r => r.targetFte !== null)
    ? Math.round(sortedReportRows.reduce((s, r) => s + (r.targetFte ?? 0), 0) * 100) / 100
    : null;
  const totalActualFte = sortedReportRows.some(r => r.actualFte !== null)
    ? Math.round(sortedReportRows.reduce((s, r) => s + (r.actualFte ?? 0), 0) * 100) / 100
    : null;
  const totalFteVariance = totalActualFte !== null && totalTargetFte !== null
    ? Math.round((totalActualFte - totalTargetFte) * 100) / 100
    : null;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-roster-title">Roster FTE Targets</h1>
        <p className="text-muted-foreground mt-1">Set FTE targets and rates per job title to track staffing levels across locations.</p>
      </div>

      <div className="flex items-center gap-4">
        <div className="w-72">
          <Select
            value={selectedLocationId ? String(selectedLocationId) : ""}
            onValueChange={(v) => setSelectedLocationId(Number(v))}
          >
            <SelectTrigger data-testid="select-roster-location">
              <SelectValue placeholder="Select a location" />
            </SelectTrigger>
            <SelectContent>
              {visibleLocations.map(loc => (
                <SelectItem key={loc.id} value={String(loc.id)} data-testid={`option-location-${loc.id}`}>
                  {loc.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {selectedLocationName && (
          <span className="text-sm text-muted-foreground" data-testid="text-selected-location">{selectedLocationName}</span>
        )}
      </div>

      {!selectedLocationId ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Select a location to manage FTE targets.
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="targets">
          <TabsList>
            <TabsTrigger value="targets" data-testid="tab-targets">
              <Target className="w-4 h-4 mr-2" />
              Targets
            </TabsTrigger>
            <TabsTrigger value="report" data-testid="tab-report">
              <BarChart3 className="w-4 h-4 mr-2" />
              FTE Report
            </TabsTrigger>
            <TabsTrigger value="consolidated" data-testid="tab-consolidated">
              <Globe className="w-4 h-4 mr-2" />
              All Locations
            </TabsTrigger>
          </TabsList>

          {/* ── TARGETS TAB ─────────────────────────────────────── */}
          <TabsContent value="targets" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>FTE Targets</CardTitle>
                <CardDescription>
                  Set the <strong>Target FTE</strong> for each job title at {selectedLocationName}.
                  Actual FTE is calculated automatically from each employee's configured max weekly hours (max hours ÷ 40).
                </CardDescription>
              </CardHeader>
              <CardContent>
                {targetsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    <div className="rounded-md border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Job Title</th>
                            <th className="px-4 py-3 text-left font-medium text-muted-foreground w-44">Target FTE</th>
                          </tr>
                        </thead>
                        <tbody>
                          {JOB_CODE_ORDER.map((code, i) => (
                            <tr
                              key={code}
                              className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}
                              data-testid={`row-target-${code}`}
                            >
                              <td className="px-4 py-2">{getLabel(code)}</td>
                              <td className="px-4 py-2">
                                <Input
                                  type="number"
                                  min={0}
                                  step={0.01}
                                  className="w-32 h-8"
                                  data-testid={`input-target-fte-${code}`}
                                  value={targetFteDrafts[code] ?? ""}
                                  onChange={(e) => setTargetFteDrafts(prev => ({ ...prev, [code]: e.target.value }))}
                                  placeholder="e.g. 12.50"
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex justify-end mt-4">
                      <Button
                        data-testid="button-save-targets"
                        onClick={handleSaveAll}
                        disabled={upsertMutation.isPending}
                      >
                        {upsertMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        Save All Targets
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── FTE REPORT TAB ───────────────────────────────────── */}
          <TabsContent value="report" className="mt-4">
            <div className="grid grid-cols-3 gap-4 mb-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                    <Target className="w-4 h-4" />
                    Target FTE
                  </div>
                  <div className="text-2xl font-bold" data-testid="text-total-target-fte">{fmtFte(totalTargetFte)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                    <BarChart3 className="w-4 h-4" />
                    Actual FTE
                  </div>
                  <div className="text-2xl font-bold" data-testid="text-total-actual-fte">{fmtFte(totalActualFte)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                    {(totalFteVariance ?? 0) >= 0
                      ? <TrendingUp className="w-4 h-4 text-green-500" />
                      : <TrendingDown className="w-4 h-4 text-red-500" />}
                    FTE Variance
                  </div>
                  <div
                    className={`text-2xl font-bold ${(totalFteVariance ?? 0) > 0 ? "text-green-600 dark:text-green-400" : (totalFteVariance ?? 0) < 0 ? "text-red-600 dark:text-red-400" : ""}`}
                    data-testid="text-total-fte-variance"
                  >
                    {totalFteVariance === null ? "—" : totalFteVariance > 0 ? `+${totalFteVariance.toFixed(2)}` : totalFteVariance.toFixed(2)}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>FTE Report — {selectedLocationName}</CardTitle>
                <CardDescription>Target FTE vs. actual FTE (sum of max weekly hours ÷ 40 per active employee) by job title.</CardDescription>
              </CardHeader>
              <CardContent>
                {reportLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : sortedReportRows.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    No FTE data yet. Set Target FTE and FTE Rate on the Targets tab.
                  </p>
                ) : (
                  <div className="rounded-md border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium text-muted-foreground">Job Title</th>
                          <th className="px-4 py-3 text-right font-medium text-muted-foreground">Target FTE</th>
                          <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actual FTE</th>
                          <th className="px-4 py-3 text-right font-medium text-muted-foreground">Variance</th>
                          <th className="px-4 py-3 text-center font-medium text-muted-foreground">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedReportRows.map((row, i) => (
                          <tr
                            key={row.jobCode}
                            className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}
                            data-testid={`row-report-${row.jobCode}`}
                          >
                            <td className="px-4 py-2">{getLabel(row.jobCode)}</td>
                            <td className="px-4 py-2 text-right">{fmtFte(row.targetFte)}</td>
                            <td className="px-4 py-2 text-right font-medium">{fmtFte(row.actualFte)}</td>
                            <td className="px-4 py-2 text-right"><VarianceBadge v={row.fteVariance} /></td>
                            <td className="px-4 py-2 text-center">
                              {row.targetFte === null ? (
                                <Badge variant="outline" className="text-xs">No Target</Badge>
                              ) : (row.fteVariance ?? 0) >= 0 ? (
                                <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-xs border-0">On Track</Badge>
                              ) : (
                                <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-xs border-0">Below Target</Badge>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── CONSOLIDATED TAB ─────────────────────────────────── */}
          <TabsContent value="consolidated" className="mt-4">
            {(() => {
              const withData = consolidatedRows.filter(r => r.totalTargetFte !== null || r.totalActualFte !== null);
              const grandTargetFte = Math.round(withData.reduce((s, r) => s + (r.totalTargetFte ?? 0), 0) * 100) / 100;
              const grandActualFte = Math.round(withData.reduce((s, r) => s + (r.totalActualFte ?? 0), 0) * 100) / 100;
              const grandVariance = Math.round((grandActualFte - grandTargetFte) * 100) / 100;
              const grandVacancyRate = grandTargetFte > 0
                ? Math.round((grandTargetFte - grandActualFte) / grandTargetFte * 10000) / 100
                : null;

              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <Card>
                      <CardContent className="pt-6">
                        <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Target className="w-3 h-3" /> Total Target FTE</div>
                        <div className="text-2xl font-bold" data-testid="text-grand-target-fte">{fmtFte(grandTargetFte)}</div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-6">
                        <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><BarChart3 className="w-3 h-3" /> Total Actual FTE</div>
                        <div className="text-2xl font-bold" data-testid="text-grand-actual-fte">{fmtFte(grandActualFte)}</div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-6">
                        <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                          {grandVariance >= 0 ? <TrendingUp className="w-3 h-3 text-green-500" /> : <TrendingDown className="w-3 h-3 text-red-500" />}
                          FTE Variance
                        </div>
                        <div className={`text-2xl font-bold ${grandVariance > 0 ? "text-green-600 dark:text-green-400" : grandVariance < 0 ? "text-red-600 dark:text-red-400" : ""}`} data-testid="text-grand-fte-variance">
                          {grandVariance > 0 ? `+${grandVariance.toFixed(2)}` : grandVariance.toFixed(2)}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-6">
                        <div className="text-xs text-muted-foreground mb-1">Overall Vacancy Rate</div>
                        <div
                          className={`text-2xl font-bold ${grandVacancyRate !== null && grandVacancyRate > 0 ? "text-red-600 dark:text-red-400" : grandVacancyRate !== null && grandVacancyRate < 0 ? "text-green-600 dark:text-green-400" : ""}`}
                          data-testid="text-grand-vacancy-rate"
                        >
                          {grandVacancyRate === null ? "—" : `${grandVacancyRate.toFixed(1)}%`}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {grandVacancyRate !== null && grandVacancyRate > 0 ? "FTE below target" :
                           grandVacancyRate !== null && grandVacancyRate < 0 ? "FTE above target" : "At target"}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader>
                      <CardTitle>All Locations — Consolidated FTE Report</CardTitle>
                      <CardDescription>
                        FTE summary per location. Vacancy rate = (Target FTE − Actual FTE) ÷ Target FTE × 100. Positive = below target.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {consolidatedLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                      ) : (
                        <div className="rounded-md border overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                              <tr>
                                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Location</th>
                                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Target FTE</th>
                                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actual FTE</th>
                                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Variance</th>
                                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Vacancy Rate</th>
                                <th className="px-4 py-3 text-center font-medium text-muted-foreground">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {consolidatedRows.map((row, i) => (
                                <tr
                                  key={row.locationId}
                                  className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}
                                  data-testid={`row-consolidated-${row.locationId}`}
                                >
                                  <td className="px-4 py-2 font-medium">{row.locationName}</td>
                                  <td className="px-4 py-2 text-right" data-testid={`text-con-target-${row.locationId}`}>{fmtFte(row.totalTargetFte)}</td>
                                  <td className="px-4 py-2 text-right font-medium" data-testid={`text-con-actual-${row.locationId}`}>{fmtFte(row.totalActualFte)}</td>
                                  <td className="px-4 py-2 text-right" data-testid={`text-con-variance-${row.locationId}`}><VarianceBadge v={row.fteVariance} /></td>
                                  <td
                                    className={`px-4 py-2 text-right font-semibold ${
                                      row.vacancyRate === null ? "text-muted-foreground" :
                                      row.vacancyRate > 0 ? "text-red-600 dark:text-red-400" :
                                      row.vacancyRate < 0 ? "text-green-600 dark:text-green-400" :
                                      "text-muted-foreground"
                                    }`}
                                    data-testid={`text-con-vacancy-${row.locationId}`}
                                  >
                                    {row.vacancyRate === null ? "—" : `${row.vacancyRate.toFixed(1)}%`}
                                  </td>
                                  <td className="px-4 py-2 text-center">
                                    {row.totalTargetFte === null ? (
                                      <Badge variant="outline" className="text-xs">No Targets</Badge>
                                    ) : (row.vacancyRate ?? 0) > 5 ? (
                                      <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-xs border-0">Below Target</Badge>
                                    ) : (row.vacancyRate ?? 0) <= 0 ? (
                                      <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-xs border-0">On Track</Badge>
                                    ) : (
                                      <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 text-xs border-0">Near Target</Badge>
                                    )}
                                  </td>
                                </tr>
                              ))}
                              {consolidatedRows.length > 0 && (
                                <tr className="bg-muted/60 border-t-2 font-semibold" data-testid="row-grand-total">
                                  <td className="px-4 py-3">Grand Total</td>
                                  <td className="px-4 py-3 text-right">{fmtFte(grandTargetFte)}</td>
                                  <td className="px-4 py-3 text-right">{fmtFte(grandActualFte)}</td>
                                  <td className="px-4 py-3 text-right"><VarianceBadge v={grandVariance} /></td>
                                  <td className={`px-4 py-3 text-right ${grandVacancyRate !== null && grandVacancyRate > 0 ? "text-red-600 dark:text-red-400" : grandVacancyRate !== null && grandVacancyRate < 0 ? "text-green-600 dark:text-green-400" : ""}`}>
                                    {grandVacancyRate === null ? "—" : `${grandVacancyRate.toFixed(1)}%`}
                                  </td>
                                  <td />
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              );
            })()}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
