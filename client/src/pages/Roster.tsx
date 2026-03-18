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
import { Loader2, Users, Target, BarChart3, TrendingUp, TrendingDown, Minus } from "lucide-react";
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
  targetCount: number;
  actualCount: number;
  variance: number;
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

export default function Roster() {
  const { toast } = useToast();
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [targetDrafts, setTargetDrafts] = useState<Record<string, string>>({});

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

  useEffect(() => {
    const drafts: Record<string, string> = {};
    for (const t of targets) {
      drafts[t.jobCode] = String(t.targetCount);
    }
    setTargetDrafts(drafts);
  }, [targets]);

  const upsertMutation = useMutation({
    mutationFn: async (data: { locationId: number; jobCode: string; targetCount: number }) => {
      return apiRequest("POST", "/api/roster-targets", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roster-targets", selectedLocationId] });
      queryClient.invalidateQueries({ queryKey: ["/api/roster-report", selectedLocationId] });
    },
  });

  const handleSaveAll = async () => {
    if (!selectedLocationId) return;
    const entries = Object.entries(targetDrafts).filter(([, v]) => v !== "" && !isNaN(Number(v)));
    let saved = 0;
    let failed = 0;
    for (const [jobCode, val] of entries) {
      try {
        await upsertMutation.mutateAsync({
          locationId: selectedLocationId,
          jobCode,
          targetCount: parseInt(val, 10),
        });
        saved++;
      } catch {
        failed++;
      }
    }
    if (failed === 0) {
      toast({ title: "Targets saved", description: `${saved} target${saved !== 1 ? "s" : ""} saved successfully.` });
    } else {
      toast({ title: "Partial save", description: `${saved} saved, ${failed} failed.`, variant: "destructive" });
    }
  };

  const allJobCodesInReport = reportRows.map(r => r.jobCode);
  const knownCodes = Object.keys(JOB_CODE_LABELS);
  const targetJobCodes = sortByCodes(Array.from(new Set([...knownCodes, ...allJobCodesInReport])));
  const sortedReportRows = sortByCodes(reportRows.map(r => r.jobCode)).map(
    code => reportRows.find(r => r.jobCode === code)!
  ).filter(Boolean);

  const selectedLocationName = visibleLocations.find(l => l.id === selectedLocationId)?.name ?? "";

  const totalTarget = reportRows.reduce((sum, r) => sum + r.targetCount, 0);
  const totalActual = reportRows.reduce((sum, r) => sum + r.actualCount, 0);
  const totalVariance = totalActual - totalTarget;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-roster-title">Roster Targets</h1>
        <p className="text-muted-foreground mt-1">Set expected headcount per job title and compare against active employees.</p>
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
            Select a location to manage roster targets.
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
              Report
            </TabsTrigger>
          </TabsList>

          <TabsContent value="targets" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Headcount Targets</CardTitle>
                <CardDescription>
                  Set the expected number of active employees for each job title at {selectedLocationName}.
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
                            <th className="px-4 py-3 text-left font-medium text-muted-foreground w-36">Target Count</th>
                          </tr>
                        </thead>
                        <tbody>
                          {targetJobCodes.map((code, i) => (
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
                                  className="w-24 h-8"
                                  data-testid={`input-target-${code}`}
                                  value={targetDrafts[code] ?? ""}
                                  onChange={(e) => setTargetDrafts(prev => ({ ...prev, [code]: e.target.value }))}
                                  placeholder="0"
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

          <TabsContent value="report" className="mt-4">
            <div className="grid grid-cols-3 gap-4 mb-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                    <Target className="w-4 h-4" />
                    Total Target
                  </div>
                  <div className="text-2xl font-bold" data-testid="text-total-target">{totalTarget}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                    <Users className="w-4 h-4" />
                    Total Active
                  </div>
                  <div className="text-2xl font-bold" data-testid="text-total-actual">{totalActual}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                    {totalVariance > 0 ? <TrendingUp className="w-4 h-4 text-green-500" /> :
                      totalVariance < 0 ? <TrendingDown className="w-4 h-4 text-red-500" /> :
                      <Minus className="w-4 h-4 text-muted-foreground" />}
                    Overall Variance
                  </div>
                  <div
                    className={`text-2xl font-bold ${totalVariance > 0 ? "text-green-600 dark:text-green-400" : totalVariance < 0 ? "text-red-600 dark:text-red-400" : ""}`}
                    data-testid="text-total-variance"
                  >
                    {totalVariance > 0 ? `+${totalVariance}` : totalVariance}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Roster Comparison Report</CardTitle>
                <CardDescription>
                  Target vs. actual active headcount by job title at {selectedLocationName}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {reportLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : reportRows.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    No data yet. Set targets on the Targets tab or ensure employees are synced for this location.
                  </p>
                ) : (
                  <div className="rounded-md border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium text-muted-foreground">Job Title</th>
                          <th className="px-4 py-3 text-right font-medium text-muted-foreground">Target</th>
                          <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actual</th>
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
                            <td className="px-4 py-2 text-right" data-testid={`text-report-target-${row.jobCode}`}>
                              {row.targetCount > 0 ? row.targetCount : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-4 py-2 text-right font-medium" data-testid={`text-report-actual-${row.jobCode}`}>
                              {row.actualCount}
                            </td>
                            <td
                              className={`px-4 py-2 text-right font-semibold ${
                                row.targetCount === 0 ? "text-muted-foreground" :
                                row.variance >= 0 ? "text-green-600 dark:text-green-400" :
                                "text-red-600 dark:text-red-400"
                              }`}
                              data-testid={`text-report-variance-${row.jobCode}`}
                            >
                              {row.targetCount === 0 ? "—" : row.variance > 0 ? `+${row.variance}` : row.variance}
                            </td>
                            <td className="px-4 py-2 text-center">
                              {row.targetCount === 0 ? (
                                <Badge variant="outline" className="text-xs">No Target</Badge>
                              ) : row.variance >= 0 ? (
                                <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-xs border-0">
                                  On Track
                                </Badge>
                              ) : (
                                <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-xs border-0">
                                  Understaffed
                                </Badge>
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
        </Tabs>
      )}
    </div>
  );
}
