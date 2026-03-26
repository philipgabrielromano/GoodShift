import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfWeek, endOfWeek } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Clock, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";

interface EarlyClockIn {
  employeeName: string;
  location: string;
  date: string;
  scheduledStart: string;
  actualClockIn: string;
  varianceMinutes: number;
}

interface LateClockOut {
  employeeName: string;
  location: string;
  date: string;
  scheduledEnd: string;
  actualClockOut: string;
  varianceMinutes: number;
}

interface LongLunch {
  employeeName: string;
  location: string;
  date: string;
  lunchDurationMinutes: number;
  varianceMinutes: number;
}

interface MissedPunch {
  employeeName: string;
  location: string;
  date: string;
  scheduledHours: number;
  expectedPunches: number;
  actualPunches: number;
  missingCount: number;
}

interface VarianceData {
  earlyClockIns: EarlyClockIn[];
  lateClockOuts: LateClockOut[];
  longLunches: LongLunch[];
  missedPunches: MissedPunch[];
}

function formatTime(isoString: string) {
  try {
    return format(new Date(isoString), "h:mm a");
  } catch {
    return isoString;
  }
}

function formatDate(dateString: string) {
  try {
    const d = new Date(dateString + "T12:00:00");
    return format(d, "EEE, MMM d");
  } catch {
    return dateString;
  }
}

function formatDateShort(dateString: string) {
  try {
    const d = new Date(dateString + "T12:00:00");
    return format(d, "M/d");
  } catch {
    return dateString;
  }
}

function getDefaultWeekRange() {
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 0 });
  return {
    startDate: format(weekStart, "yyyy-MM-dd"),
    endDate: format(weekEnd, "yyyy-MM-dd"),
  };
}

export default function VarianceReport() {
  const defaultRange = getDefaultWeekRange();
  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);
  const [selectedLocation, setSelectedLocation] = useState<string>("all");
  const [earlyOpen, setEarlyOpen] = useState(true);
  const [lateOpen, setLateOpen] = useState(true);
  const [lunchOpen, setLunchOpen] = useState(true);
  const [missedOpen, setMissedOpen] = useState(true);

  const { data: reportLocations, isLoading: locationsLoading } = useQuery<string[]>({
    queryKey: ["/api/reports/locations"],
  });

  const queryEnabled = !!startDate && !!endDate;
  const varianceParams = new URLSearchParams({ startDate, endDate });
  if (selectedLocation !== "all") varianceParams.set("location", selectedLocation);
  const varianceUrl = `/api/reports/variance?${varianceParams.toString()}`;

  const { data: variance, isLoading: dataLoading } = useQuery<VarianceData>({
    queryKey: [varianceUrl],
    enabled: queryEnabled,
  });

  return (
    <div className="p-3 sm:p-6 lg:p-10 space-y-4 sm:space-y-8 max-w-[1200px] mx-auto">
      <div>
        <h1 className="text-xl sm:text-3xl font-bold font-display flex items-center gap-2 sm:gap-3" data-testid="text-page-title">
          <Clock className="w-5 h-5 sm:w-8 sm:h-8 text-blue-500" />
          Variance Report
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">Shift time variances: early clock-ins, late clock-outs, long lunches, missed punches.</p>
      </div>

      <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 sm:gap-4">
        <div className="flex items-center gap-1 sm:gap-2">
          <label className="text-xs sm:text-sm font-medium text-muted-foreground whitespace-nowrap">Start:</label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="sm:w-40"
            data-testid="input-start-date"
          />
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          <label className="text-xs sm:text-sm font-medium text-muted-foreground whitespace-nowrap">End:</label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="sm:w-40"
            data-testid="input-end-date"
          />
        </div>
        <div className="col-span-2 sm:w-64">
          {locationsLoading ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <Select value={selectedLocation} onValueChange={setSelectedLocation}>
              <SelectTrigger data-testid="select-location">
                <SelectValue placeholder="All Locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {reportLocations?.map((name) => (
                  <SelectItem key={name} value={name} data-testid={`select-location-option-${name}`}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {dataLoading ? (
        <div className="space-y-4" data-testid="loading-skeleton">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="py-6">
                <Skeleton className="h-8 w-48 mb-4" />
                <Skeleton className="h-32 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : variance ? (
        <div className="space-y-3 sm:space-y-4">
          {/* Early Clock-Ins */}
          <Collapsible open={earlyOpen} onOpenChange={setEarlyOpen}>
            <Card>
              <CardHeader className="p-3 sm:p-6 cursor-pointer" data-testid="section-early-clock-ins">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-start gap-2 p-0 h-auto" data-testid="button-toggle-early-clock-ins">
                    {earlyOpen ? <ChevronDown className="w-4 h-4 sm:w-5 sm:h-5" /> : <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />}
                    <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
                      Early Clock-Ins
                      <Badge variant="secondary" data-testid="badge-early-count">{variance.earlyClockIns.length}</Badge>
                    </CardTitle>
                  </Button>
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="p-3 sm:p-6 pt-0">
                  {variance.earlyClockIns.length === 0 ? (
                    <p className="text-muted-foreground text-sm" data-testid="text-no-early">No early clock-ins found.</p>
                  ) : (
                    <>
                      {/* Mobile cards */}
                      <div className="sm:hidden space-y-2">
                        {variance.earlyClockIns.map((row, index) => (
                          <div key={index} className="p-2.5 rounded border bg-muted/50" data-testid={`row-early-${index}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-medium text-sm truncate" data-testid={`text-early-employee-${index}`}>{row.employeeName}</p>
                                <p className="text-[10px] text-muted-foreground">{row.location} &middot; {formatDateShort(row.date)}</p>
                              </div>
                              <Badge variant="secondary" className="shrink-0 text-[10px]" data-testid={`text-early-variance-${index}`}>
                                {row.varianceMinutes}m early
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                              <span>Sched: {formatTime(row.scheduledStart)}</span>
                              <span>&rarr;</span>
                              <span>Actual: {formatTime(row.actualClockIn)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                      {/* Desktop table */}
                      <div className="hidden sm:block">
                        <Table data-testid="table-early-clock-ins">
                          <TableHeader>
                            <TableRow>
                              <TableHead>Employee</TableHead>
                              <TableHead>Location</TableHead>
                              <TableHead>Date</TableHead>
                              <TableHead>Scheduled Start</TableHead>
                              <TableHead>Actual Clock-In</TableHead>
                              <TableHead className="text-right">Variance (min)</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {variance.earlyClockIns.map((row, index) => (
                              <TableRow key={index} data-testid={`row-early-desktop-${index}`}>
                                <TableCell className="font-medium" data-testid={`text-early-employee-${index}`}>{row.employeeName}</TableCell>
                                <TableCell data-testid={`text-early-location-${index}`}>{row.location}</TableCell>
                                <TableCell data-testid={`text-early-date-${index}`}>{formatDate(row.date)}</TableCell>
                                <TableCell data-testid={`text-early-scheduled-${index}`}>{formatTime(row.scheduledStart)}</TableCell>
                                <TableCell data-testid={`text-early-actual-${index}`}>{formatTime(row.actualClockIn)}</TableCell>
                                <TableCell className="text-right font-bold" data-testid={`text-early-variance-${index}`}>{row.varianceMinutes}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* Late Clock-Outs */}
          <Collapsible open={lateOpen} onOpenChange={setLateOpen}>
            <Card>
              <CardHeader className="p-3 sm:p-6 cursor-pointer" data-testid="section-late-clock-outs">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-start gap-2 p-0 h-auto" data-testid="button-toggle-late-clock-outs">
                    {lateOpen ? <ChevronDown className="w-4 h-4 sm:w-5 sm:h-5" /> : <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />}
                    <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
                      Late Clock-Outs
                      <Badge variant="secondary" data-testid="badge-late-count">{variance.lateClockOuts.length}</Badge>
                    </CardTitle>
                  </Button>
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="p-3 sm:p-6 pt-0">
                  {variance.lateClockOuts.length === 0 ? (
                    <p className="text-muted-foreground text-sm" data-testid="text-no-late">No late clock-outs found.</p>
                  ) : (
                    <>
                      {/* Mobile cards */}
                      <div className="sm:hidden space-y-2">
                        {variance.lateClockOuts.map((row, index) => (
                          <div key={index} className="p-2.5 rounded border bg-muted/50" data-testid={`row-late-${index}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-medium text-sm truncate" data-testid={`text-late-employee-${index}`}>{row.employeeName}</p>
                                <p className="text-[10px] text-muted-foreground">{row.location} &middot; {formatDateShort(row.date)}</p>
                              </div>
                              <Badge variant="secondary" className="shrink-0 text-[10px]" data-testid={`text-late-variance-${index}`}>
                                {row.varianceMinutes}m late
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                              <span>Sched: {formatTime(row.scheduledEnd)}</span>
                              <span>&rarr;</span>
                              <span>Actual: {formatTime(row.actualClockOut)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                      {/* Desktop table */}
                      <div className="hidden sm:block">
                        <Table data-testid="table-late-clock-outs">
                          <TableHeader>
                            <TableRow>
                              <TableHead>Employee</TableHead>
                              <TableHead>Location</TableHead>
                              <TableHead>Date</TableHead>
                              <TableHead>Scheduled End</TableHead>
                              <TableHead>Actual Clock-Out</TableHead>
                              <TableHead className="text-right">Variance (min)</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {variance.lateClockOuts.map((row, index) => (
                              <TableRow key={index} data-testid={`row-late-desktop-${index}`}>
                                <TableCell className="font-medium" data-testid={`text-late-employee-${index}`}>{row.employeeName}</TableCell>
                                <TableCell data-testid={`text-late-location-${index}`}>{row.location}</TableCell>
                                <TableCell data-testid={`text-late-date-${index}`}>{formatDate(row.date)}</TableCell>
                                <TableCell data-testid={`text-late-scheduled-${index}`}>{formatTime(row.scheduledEnd)}</TableCell>
                                <TableCell data-testid={`text-late-actual-${index}`}>{formatTime(row.actualClockOut)}</TableCell>
                                <TableCell className="text-right font-bold" data-testid={`text-late-variance-${index}`}>{row.varianceMinutes}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* Long Lunches */}
          <Collapsible open={lunchOpen} onOpenChange={setLunchOpen}>
            <Card>
              <CardHeader className="p-3 sm:p-6 cursor-pointer" data-testid="section-long-lunches">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-start gap-2 p-0 h-auto" data-testid="button-toggle-long-lunches">
                    {lunchOpen ? <ChevronDown className="w-4 h-4 sm:w-5 sm:h-5" /> : <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />}
                    <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
                      Long Lunches
                      <Badge variant="secondary" data-testid="badge-lunch-count">{variance.longLunches.length}</Badge>
                    </CardTitle>
                  </Button>
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="p-3 sm:p-6 pt-0">
                  {variance.longLunches.length === 0 ? (
                    <p className="text-muted-foreground text-sm" data-testid="text-no-lunch">No long lunches found.</p>
                  ) : (
                    <>
                      {/* Mobile cards */}
                      <div className="sm:hidden space-y-2">
                        {variance.longLunches.map((row, index) => (
                          <div key={index} className="p-2.5 rounded border bg-muted/50" data-testid={`row-lunch-${index}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-medium text-sm truncate" data-testid={`text-lunch-employee-${index}`}>{row.employeeName}</p>
                                <p className="text-[10px] text-muted-foreground">{row.location} &middot; {formatDateShort(row.date)}</p>
                              </div>
                              <Badge variant="secondary" className="shrink-0 text-[10px]" data-testid={`text-lunch-variance-${index}`}>
                                +{row.varianceMinutes}m over
                              </Badge>
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-1" data-testid={`text-lunch-duration-${index}`}>
                              Lunch: {row.lunchDurationMinutes} min (30 min allowed)
                            </p>
                          </div>
                        ))}
                      </div>
                      {/* Desktop table */}
                      <div className="hidden sm:block">
                        <Table data-testid="table-long-lunches">
                          <TableHeader>
                            <TableRow>
                              <TableHead>Employee</TableHead>
                              <TableHead>Location</TableHead>
                              <TableHead>Date</TableHead>
                              <TableHead>Lunch Duration</TableHead>
                              <TableHead className="text-right">Variance Over 30min</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {variance.longLunches.map((row, index) => (
                              <TableRow key={index} data-testid={`row-lunch-desktop-${index}`}>
                                <TableCell className="font-medium" data-testid={`text-lunch-employee-${index}`}>{row.employeeName}</TableCell>
                                <TableCell data-testid={`text-lunch-location-${index}`}>{row.location}</TableCell>
                                <TableCell data-testid={`text-lunch-date-${index}`}>{formatDate(row.date)}</TableCell>
                                <TableCell data-testid={`text-lunch-duration-${index}`}>{row.lunchDurationMinutes} min</TableCell>
                                <TableCell className="text-right font-bold" data-testid={`text-lunch-variance-${index}`}>{row.varianceMinutes} min</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* Missed Punches */}
          <Collapsible open={missedOpen} onOpenChange={setMissedOpen}>
            <Card>
              <CardHeader className="p-3 sm:p-6 cursor-pointer" data-testid="section-missed-punches">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-start gap-2 p-0 h-auto" data-testid="button-toggle-missed-punches">
                    {missedOpen ? <ChevronDown className="w-4 h-4 sm:w-5 sm:h-5" /> : <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />}
                    <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                      Missed Punches
                      <Badge variant="secondary" data-testid="badge-missed-count">{variance.missedPunches?.length || 0}</Badge>
                    </CardTitle>
                  </Button>
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="p-3 sm:p-6 pt-0">
                  {!variance.missedPunches || variance.missedPunches.length === 0 ? (
                    <p className="text-muted-foreground text-sm" data-testid="text-no-missed">No missed punches found.</p>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground mb-3">
                        Shifts of 6 hours or more require 4 punches (IN, OUT, IN, OUT) due to mandatory lunch. Shifts under 6 hours require 2 punches (IN, OUT).
                      </p>
                      {/* Mobile cards */}
                      <div className="sm:hidden space-y-2">
                        {variance.missedPunches.map((row, index) => (
                          <div key={index} className="p-2.5 rounded border bg-muted/50" data-testid={`row-missed-${index}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-medium text-sm truncate" data-testid={`text-missed-employee-${index}`}>{row.employeeName}</p>
                                <p className="text-[10px] text-muted-foreground">{row.location} &middot; {formatDateShort(row.date)}</p>
                              </div>
                              <Badge variant="destructive" className="shrink-0 text-[10px]" data-testid={`text-missed-count-${index}`}>
                                {row.missingCount} missing
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                              <span>{row.scheduledHours}h shift</span>
                              <span>&middot;</span>
                              <span>Expected: {row.expectedPunches}</span>
                              <span>&middot;</span>
                              <span>Actual: {row.actualPunches}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                      {/* Desktop table */}
                      <div className="hidden sm:block">
                        <Table data-testid="table-missed-punches">
                          <TableHeader>
                            <TableRow>
                              <TableHead>Employee</TableHead>
                              <TableHead>Location</TableHead>
                              <TableHead>Date</TableHead>
                              <TableHead>Shift Length</TableHead>
                              <TableHead>Expected</TableHead>
                              <TableHead>Actual</TableHead>
                              <TableHead className="text-right">Missing</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {variance.missedPunches.map((row, index) => (
                              <TableRow key={index} data-testid={`row-missed-desktop-${index}`}>
                                <TableCell className="font-medium" data-testid={`text-missed-employee-${index}`}>{row.employeeName}</TableCell>
                                <TableCell data-testid={`text-missed-location-${index}`}>{row.location}</TableCell>
                                <TableCell data-testid={`text-missed-date-${index}`}>{formatDate(row.date)}</TableCell>
                                <TableCell data-testid={`text-missed-hours-${index}`}>{row.scheduledHours}h</TableCell>
                                <TableCell data-testid={`text-missed-expected-${index}`}>{row.expectedPunches}</TableCell>
                                <TableCell data-testid={`text-missed-actual-${index}`}>{row.actualPunches}</TableCell>
                                <TableCell className="text-right" data-testid={`text-missed-missing-${index}`}>
                                  <Badge variant="destructive">{row.missingCount}</Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </div>
      ) : (
        <Card>
          <CardContent className="py-8">
            <p className="text-muted-foreground text-sm text-center" data-testid="text-select-prompt">
              Select a date range to view variance data.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
