import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Snowflake } from "lucide-react";

interface SeasonBalance {
  season: string;
  label: string;
  onDeposit: number;
  pendingRequested: number;
  available: number;
}

interface LocationBalance {
  location: string;
  seasons: SeasonBalance[];
}

interface BalancesResponse {
  balances: LocationBalance[];
}

const SEASON_ORDER = ["winter", "summer", "halloween", "christmas"] as const;
const SEASON_LABELS: Record<string, string> = {
  winter: "Winter",
  summer: "Summer",
  halloween: "Halloween",
  christmas: "Christmas",
};

export default function SeasonalInventory() {
  const { data, isLoading, error } = useQuery<BalancesResponse>({
    queryKey: ["/api/orders/seasonal-balances", ""],
    queryFn: async () => {
      const res = await fetch("/api/orders/seasonal-balances", { credentials: "include" });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
      return res.json();
    },
  });

  const locations = data?.balances ?? [];

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Snowflake className="w-7 h-7 text-primary" />
        <h1 className="text-2xl font-bold" data-testid="text-seasonal-inventory-title">Seasonal Inventory</h1>
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-lg">How this works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p><strong>On Deposit</strong> — total seasonal items each store has sent in across all order submissions.</p>
          <p><strong>Pending Requested</strong> — total seasonal items each store has asked back across all submitted orders.</p>
          <p><strong>Available</strong> — what the store can still request before being blocked. New requests cannot exceed this number.</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-destructive" data-testid="text-seasonal-inventory-error">
              Error loading balances: {error.message}
            </div>
          ) : locations.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground" data-testid="text-no-seasonal-balances">
              No seasonal activity recorded yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Location</TableHead>
                  {SEASON_ORDER.map(s => (
                    <TableHead key={s} className="text-right">{SEASON_LABELS[s]}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {locations.map(loc => {
                  const bySeason = new Map(loc.seasons.map(s => [s.season, s]));
                  return (
                    <TableRow key={loc.location} data-testid={`row-seasonal-${loc.location.toLowerCase().replace(/\s+/g, "-")}`}>
                      <TableCell className="font-medium">{loc.location}</TableCell>
                      {SEASON_ORDER.map(season => {
                        const b = bySeason.get(season);
                        if (!b) {
                          return <TableCell key={season} className="text-right text-muted-foreground">—</TableCell>;
                        }
                        const negative = b.available < 0;
                        return (
                          <TableCell key={season} className="text-right" data-testid={`cell-${loc.location.toLowerCase().replace(/\s+/g, "-")}-${season}`}>
                            <div className={`font-semibold ${negative ? "text-destructive" : ""}`}>
                              {b.available} available
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {b.onDeposit} on deposit · {b.pendingRequested} pending
                            </div>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
