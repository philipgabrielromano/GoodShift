import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle } from "lucide-react";

interface OccurrenceRow {
  employeeId: number;
  employeeName: string;
  location: string;
  jobTitle: string;
  totalPoints: number;
  employmentType: string;
}

function getThresholdBadge(points: number) {
  if (points >= 8) return <Badge variant="destructive" data-testid={`badge-termination`}>Termination</Badge>;
  if (points >= 7) return <Badge variant="destructive" data-testid={`badge-final-warning`}>Final Warning</Badge>;
  if (points >= 5) return <Badge className="bg-orange-500" data-testid={`badge-warning`}>Warning</Badge>;
  return null;
}

function getRowHighlight(points: number) {
  if (points >= 8) return "bg-red-50 dark:bg-red-950/20";
  if (points >= 7) return "bg-orange-50 dark:bg-orange-950/20";
  if (points >= 5) return "bg-yellow-50 dark:bg-yellow-950/20";
  return "";
}

export default function OccurrenceReport() {
  const [selectedLocation, setSelectedLocation] = useState<string>("all");
  const { data: reportLocations, isLoading: locationsLoading } = useQuery<string[]>({
    queryKey: ["/api/reports/locations"],
  });

  const queryUrl = selectedLocation !== "all"
    ? `/api/reports/occurrences?location=${encodeURIComponent(selectedLocation)}`
    : "/api/reports/occurrences";

  const { data: occurrences, isLoading: dataLoading } = useQuery<OccurrenceRow[]>({
    queryKey: [queryUrl],
  });

  const sortedData = occurrences
    ? [...occurrences].sort((a, b) => b.totalPoints - a.totalPoints)
    : [];

  return (
    <div className="p-3 sm:p-6 lg:p-10 space-y-4 sm:space-y-8 max-w-[1200px] mx-auto">
      <div>
        <h1 className="text-xl sm:text-3xl font-bold font-display flex items-center gap-2 sm:gap-3" data-testid="text-page-title">
          <AlertTriangle className="w-5 h-5 sm:w-8 sm:h-8 text-orange-500" />
          Occurrence Report
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">Employee occurrence points by location.</p>
      </div>

      <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
        <div className="w-full sm:w-64">
          {locationsLoading ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <Select value={selectedLocation} onValueChange={setSelectedLocation}>
              <SelectTrigger data-testid="select-location">
                <SelectValue placeholder="Select a location..." />
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

      <Card>
        <CardHeader className="p-3 sm:p-6 pb-2 sm:pb-4">
          <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
            Occurrence Summary
            {sortedData.length > 0 && (
              <Badge variant="secondary" data-testid="badge-total-count">{sortedData.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-6 pt-0">
          {dataLoading ? (
            <div className="space-y-3" data-testid="loading-skeleton">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : sortedData.length === 0 ? (
            <p className="text-muted-foreground text-sm" data-testid="text-no-data">
              No occurrence data found for this location.
            </p>
          ) : (
            <>
              {/* Mobile card layout */}
              <div className="sm:hidden space-y-2">
                {sortedData.map((row) => (
                  <div
                    key={row.employeeId}
                    className={`p-2.5 rounded border ${getRowHighlight(row.totalPoints)}`}
                    data-testid={`row-occurrence-${row.employeeId}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate" data-testid={`text-employee-name-${row.employeeId}`}>
                          {row.employeeName}
                        </p>
                        <p className="text-[10px] text-muted-foreground" data-testid={`text-job-title-${row.employeeId}`}>
                          {row.jobTitle} &middot; {row.location}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {getThresholdBadge(row.totalPoints)}
                        <span className="font-bold text-sm" data-testid={`text-total-points-${row.employeeId}`}>
                          {row.totalPoints.toFixed(1)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop table layout */}
              <div className="hidden sm:block">
                <Table data-testid="table-occurrences">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee Name</TableHead>
                      <TableHead>Job Title</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Employment Type</TableHead>
                      <TableHead className="text-right">Total Points</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedData.map((row) => (
                      <TableRow
                        key={row.employeeId}
                        className={getRowHighlight(row.totalPoints)}
                        data-testid={`row-occurrence-desktop-${row.employeeId}`}
                      >
                        <TableCell className="font-medium" data-testid={`text-employee-name-${row.employeeId}`}>
                          {row.employeeName}
                        </TableCell>
                        <TableCell data-testid={`text-job-title-${row.employeeId}`}>
                          {row.jobTitle}
                        </TableCell>
                        <TableCell data-testid={`text-location-${row.employeeId}`}>
                          {row.location}
                        </TableCell>
                        <TableCell data-testid={`text-employment-type-${row.employeeId}`}>
                          {row.employmentType}
                        </TableCell>
                        <TableCell className="text-right" data-testid={`text-total-points-${row.employeeId}`}>
                          <div className="flex items-center justify-end gap-2">
                            {getThresholdBadge(row.totalPoints)}
                            <span className="font-bold">{row.totalPoints.toFixed(1)}</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
