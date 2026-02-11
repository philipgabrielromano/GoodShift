import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocations } from "@/hooks/use-locations";
import { format, startOfWeek, endOfWeek } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Clock, ChevronDown, ChevronRight } from "lucide-react";

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

interface VarianceData {
  earlyClockIns: EarlyClockIn[];
  lateClockOuts: LateClockOut[];
  longLunches: LongLunch[];
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

  const { data: locations, isLoading: locationsLoading } = useLocations();

  const queryEnabled = !!startDate && !!endDate;
  const varianceParams = new URLSearchParams({ startDate, endDate });
  if (selectedLocation !== "all") varianceParams.set("location", selectedLocation);
  const varianceUrl = `/api/reports/variance?${varianceParams.toString()}`;

  const { data: variance, isLoading: dataLoading } = useQuery<VarianceData>({
    queryKey: [varianceUrl],
    enabled: queryEnabled,
  });

  return (
    <div className="p-6 lg:p-10 space-y-8 max-w-[1200px] mx-auto">
      <div>
        <h1 className="text-3xl font-bold font-display flex items-center gap-3" data-testid="text-page-title">
          <Clock className="w-8 h-8 text-blue-500" />
          Variance Report
        </h1>
        <p className="text-muted-foreground mt-1">View shift time variances including early clock-ins, late clock-outs, and long lunches.</p>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">Start:</label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-40"
            data-testid="input-start-date"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">End:</label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-40"
            data-testid="input-end-date"
          />
        </div>
        <div className="w-64">
          {locationsLoading ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <Select value={selectedLocation} onValueChange={setSelectedLocation}>
              <SelectTrigger data-testid="select-location">
                <SelectValue placeholder="All Locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {locations?.map((loc) => (
                  <SelectItem key={loc.id} value={loc.name} data-testid={`select-location-option-${loc.id}`}>
                    {loc.name}
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
        <div className="space-y-4">
          <Collapsible open={earlyOpen} onOpenChange={setEarlyOpen}>
            <Card>
              <CardHeader className="cursor-pointer" data-testid="section-early-clock-ins">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-start gap-2 p-0 h-auto" data-testid="button-toggle-early-clock-ins">
                    {earlyOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                    <CardTitle className="flex items-center gap-2">
                      Early Clock-Ins
                      <Badge variant="secondary" data-testid="badge-early-count">{variance.earlyClockIns.length}</Badge>
                    </CardTitle>
                  </Button>
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent>
                  {variance.earlyClockIns.length === 0 ? (
                    <p className="text-muted-foreground text-sm" data-testid="text-no-early">No early clock-ins found.</p>
                  ) : (
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
                          <TableRow key={index} data-testid={`row-early-${index}`}>
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
                  )}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          <Collapsible open={lateOpen} onOpenChange={setLateOpen}>
            <Card>
              <CardHeader className="cursor-pointer" data-testid="section-late-clock-outs">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-start gap-2 p-0 h-auto" data-testid="button-toggle-late-clock-outs">
                    {lateOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                    <CardTitle className="flex items-center gap-2">
                      Late Clock-Outs
                      <Badge variant="secondary" data-testid="badge-late-count">{variance.lateClockOuts.length}</Badge>
                    </CardTitle>
                  </Button>
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent>
                  {variance.lateClockOuts.length === 0 ? (
                    <p className="text-muted-foreground text-sm" data-testid="text-no-late">No late clock-outs found.</p>
                  ) : (
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
                          <TableRow key={index} data-testid={`row-late-${index}`}>
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
                  )}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          <Collapsible open={lunchOpen} onOpenChange={setLunchOpen}>
            <Card>
              <CardHeader className="cursor-pointer" data-testid="section-long-lunches">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-start gap-2 p-0 h-auto" data-testid="button-toggle-long-lunches">
                    {lunchOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                    <CardTitle className="flex items-center gap-2">
                      Long Lunches
                      <Badge variant="secondary" data-testid="badge-lunch-count">{variance.longLunches.length}</Badge>
                    </CardTitle>
                  </Button>
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent>
                  {variance.longLunches.length === 0 ? (
                    <p className="text-muted-foreground text-sm" data-testid="text-no-lunch">No long lunches found.</p>
                  ) : (
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
                          <TableRow key={index} data-testid={`row-lunch-${index}`}>
                            <TableCell className="font-medium" data-testid={`text-lunch-employee-${index}`}>{row.employeeName}</TableCell>
                            <TableCell data-testid={`text-lunch-location-${index}`}>{row.location}</TableCell>
                            <TableCell data-testid={`text-lunch-date-${index}`}>{formatDate(row.date)}</TableCell>
                            <TableCell data-testid={`text-lunch-duration-${index}`}>{row.lunchDurationMinutes} min</TableCell>
                            <TableCell className="text-right font-bold" data-testid={`text-lunch-variance-${index}`}>{row.varianceMinutes} min</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
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
