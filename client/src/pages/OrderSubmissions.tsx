import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText, ChevronLeft, ChevronRight, Trash2, Pencil } from "lucide-react";
import { useLocation as useWouterLocation } from "wouter";

interface AuthStatus {
  isAuthenticated: boolean;
  user: { id: number; name: string; email: string; role: string } | null;
  accessibleFeatures?: string[];
}

const ORDER_TYPES = [
  "Transfer and Receive",
  "End of Day/Equipment Count",
  "Donors",
  "Supplemental production",
];

const LOCATIONS = [
  "Alliance", "Carrollton", "Chardon", "Foxboro", "Massillon",
  "Mayfield", "Middleburg", "New Philly", "North Canton", "North Olmsted",
  "Outlet Canton", "Outlet Cleveland", "Painesville", "Perry", "Route 62",
  "Snow Road", "Strongsville", "University", "Weirton", "Wintersville",
  "Willowick", "Transportation",
  "Home Pickups ADC", "Hillsdale ADC", "Corporate Campus ADC",
  "Washington Square ADC", "Uniontown ADC", "Tanglewood ADC",
  "Shuffel ADC", "Pepper Pike ADC", "North Royalton ADC",
  "Lyndhurst ADC", "Lincoln Way ADC", "Westlake ADC",
  "Jackson ADC", "Chesterland ADC",
  "Washington Square", "Westlake", "Gordon Square",
  "Donation Station", "City Mission",
  "Wired Up", "eCommerce",
];

const ORDER_TYPE_COLORS: Record<string, string> = {
  "Transfer and Receive": "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  "End of Day/Equipment Count": "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  "Donors": "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  "Supplemental production": "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

interface Order {
  id: number;
  orderDate: string;
  orderType: string;
  location: string;
  submittedBy: string;
  submittedAt: string;
  notes: string | null;
  [key: string]: string | number | boolean | null;
}

interface OrdersResponse {
  orders: Order[];
  total: number;
  limit: number;
  offset: number;
}

const FIELD_LABELS: Record<string, string> = {
  totesRequested: "Totes Requested",
  totesReturned: "Totes Returned",
  durosRequested: "Duros Requested",
  durosReturned: "Duros Returned",
  blueBinsRequested: "Blue Bins Requested",
  blueBinsReturned: "Blue Bins Returned",
  gaylordsRequested: "Gaylords Requested",
  gaylordsReturned: "Gaylords Returned",
  palletsRequested: "Pallets Requested",
  palletsReturned: "Pallets Returned",
  containersRequested: "Containers Requested",
  containersReturned: "Containers Returned",
  apparelGaylordsRequested: "Apparel Gaylords Requested",
  apparelGaylordsReturned: "Apparel Gaylords Returned",
  waresGaylordsRequested: "Wares Gaylords Requested",
  waresGaylordsReturned: "Wares Gaylords Returned",
  electricalGaylordsRequested: "Electrical Gaylords Requested",
  electricalGaylordsReturned: "Electrical Gaylords Returned",
  accessoriesGaylordsRequested: "Accessories Gaylords Requested",
  accessoriesGaylordsReturned: "Accessories Gaylords Returned",
  booksGaylordsRequested: "Books Gaylords Requested",
  booksGaylordsReturned: "Books Gaylords Returned",
  shoesGaylordsRequested: "Shoes Gaylords Requested",
  shoesGaylordsReturned: "Shoes Gaylords Returned",
  savedWinterRequested: "Saved Winter Requested",
  savedWinterReturned: "Saved Winter Returned",
  savedSummerRequested: "Saved Summer Requested",
  savedSummerReturned: "Saved Summer Returned",
  savedHalloweenRequested: "Saved Halloween Requested",
  savedHalloweenReturned: "Saved Halloween Returned",
  savedChristmasRequested: "Saved Christmas Requested",
  savedChristmasReturned: "Saved Christmas Returned",
  fullTotes: "Full Totes",
  emptyTotes: "Empty Totes",
  fullGaylords: "Full Gaylords",
  emptyGaylords: "Empty Gaylords",
  fullDuros: "Full Duros",
  emptyDuros: "Empty Duros",
  fullContainers: "Full Containers",
  emptyContainers: "Empty Containers",
  fullBlueBins: "Full Blue Bins",
  emptyBlueBins: "Empty Blue Bins",
  emptyPallets: "Empty Pallets",
  outletApparel: "Outlet Apparel",
  outletShoes: "Outlet Shoes",
  outletMetal: "Outlet Metal",
  outletWares: "Outlet Wares",
  outletAccessories: "Outlet Accessories",
  outletElectrical: "Outlet Electrical",
  ecomContainersSent: "eCom Containers Sent",
  rotatedApparel: "Rotated Apparel",
  rotatedShoes: "Rotated Shoes",
  rotatedBooks: "Rotated Books",
  rotatedWares: "Rotated Wares",
  apparelGaylordsUsed: "Apparel Gaylords Used",
  waresGaylordsUsed: "Wares Gaylords Used",
  bookGaylordsUsed: "Book Gaylords Used",
  shoeGaylordsUsed: "Shoe Gaylords Used",
  donors: "Donors",
  isCentralProcessing: "Central Processing/Lee Harvard",
  apparelProduction: "Apparel Production",
  waresProduction: "Wares Production",
};

const SKIP_KEYS = new Set(["id", "orderDate", "orderType", "location", "submittedBy", "submittedAt", "notes"]);

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function OrderSubmissions() {
  const { toast } = useToast();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(0);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const pageSize = 25;

  const { data: authStatus } = useQuery<AuthStatus>({ queryKey: ["/api/auth/status"] });
  const isAdmin = authStatus?.user?.role === "admin";
  const canEdit = !!authStatus?.accessibleFeatures?.includes("orders.edit");
  const [, navigate] = useWouterLocation();

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/orders/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Order deleted" });
      setSelectedOrder(null);
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete order", description: err.message, variant: "destructive" });
    },
  });

  const queryParams = new URLSearchParams();
  if (startDate) queryParams.set("startDate", startDate);
  if (endDate) queryParams.set("endDate", endDate);
  if (locationFilter) queryParams.set("location", locationFilter);
  if (typeFilter) queryParams.set("orderType", typeFilter);
  queryParams.set("limit", String(pageSize));
  queryParams.set("offset", String(page * pageSize));

  const ordersQueryString = queryParams.toString();
  const { data, isLoading, error } = useQuery<OrdersResponse>({
    queryKey: ["/api/orders", ordersQueryString],
    queryFn: async () => {
      const url = `/api/orders?${ordersQueryString}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
      return res.json();
    },
  });

  const orders = data?.orders || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize);

  const nonNullFields = (order: Order) => {
    return Object.entries(order)
      .filter(([key, val]) => !SKIP_KEYS.has(key) && val !== null && val !== undefined && val !== 0)
      .map(([key, val]) => ({
        label: FIELD_LABELS[key] || key,
        value: key === "isCentralProcessing" ? (val ? "Yes" : "No") : val,
      }));
  };

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <FileText className="w-7 h-7 text-primary" />
        <h1 className="text-2xl font-bold" data-testid="text-order-submissions-title">Order Submissions</h1>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <Label className="text-sm">Start Date</Label>
              <Input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPage(0); }} data-testid="input-filter-start-date" />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">End Date</Label>
              <Input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setPage(0); }} data-testid="input-filter-end-date" />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Location</Label>
              <Select value={locationFilter || "all"} onValueChange={(val) => { setLocationFilter(val === "all" ? "" : val); setPage(0); }}>
                <SelectTrigger data-testid="select-filter-location">
                  <SelectValue placeholder="All Locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {LOCATIONS.map((loc) => (
                    <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Order Type</Label>
              <Select value={typeFilter} onValueChange={(val) => { setTypeFilter(val === "all" ? "" : val); setPage(0); }}>
                <SelectTrigger data-testid="select-filter-order-type">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {ORDER_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-destructive" data-testid="text-orders-error">
              Error loading orders: {error.message}
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground" data-testid="text-no-orders">
              No orders found
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Submitted By</TableHead>
                    <TableHead>Submitted At</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => (
                    <TableRow key={order.id} data-testid={`row-order-${order.id}`}>
                      <TableCell>{formatDate(order.orderDate)}</TableCell>
                      <TableCell>
                        <Badge className={ORDER_TYPE_COLORS[order.orderType] || ""} variant="secondary">
                          {order.orderType}
                        </Badge>
                      </TableCell>
                      <TableCell>{order.location}</TableCell>
                      <TableCell>{order.submittedBy}</TableCell>
                      <TableCell>{formatDateTime(order.submittedAt)}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedOrder(order)}
                          data-testid={`button-view-order-${order.id}`}
                        >
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex items-center justify-between px-4 py-3 border-t">
                <p className="text-sm text-muted-foreground" data-testid="text-order-count">
                  Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                    data-testid="button-prev-page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {page + 1} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                    data-testid="button-next-page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Order Details</DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="text-muted-foreground">Date</div>
                <div>{formatDate(selectedOrder.orderDate)}</div>
                <div className="text-muted-foreground">Type</div>
                <div>
                  <Badge className={ORDER_TYPE_COLORS[selectedOrder.orderType] || ""} variant="secondary">
                    {selectedOrder.orderType}
                  </Badge>
                </div>
                <div className="text-muted-foreground">Location</div>
                <div>{selectedOrder.location}</div>
                <div className="text-muted-foreground">Submitted By</div>
                <div>{selectedOrder.submittedBy}</div>
                <div className="text-muted-foreground">Submitted At</div>
                <div>{formatDateTime(selectedOrder.submittedAt)}</div>
              </div>

              {nonNullFields(selectedOrder).length > 0 && (
                <>
                  <hr />
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {nonNullFields(selectedOrder).map(({ label, value }) => (
                      <div key={label} className="contents">
                        <div className="text-muted-foreground">{label}</div>
                        <div className="font-medium">{value}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {selectedOrder.notes && (
                <>
                  <hr />
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Notes</p>
                    <p className="text-sm">{selectedOrder.notes}</p>
                  </div>
                </>
              )}

              {(canEdit || isAdmin) && (
                <>
                  <hr />
                  <div className="flex flex-col gap-2">
                    {canEdit && (
                      <Button
                        variant="default"
                        size="sm"
                        className="w-full"
                        onClick={() => navigate(`/orders/edit/${selectedOrder.id}`)}
                        data-testid={`button-edit-order-${selectedOrder.id}`}
                      >
                        <Pencil className="w-4 h-4 mr-2" />
                        Edit Order
                      </Button>
                    )}
                    {isAdmin && (
                      <Button
                        variant="destructive"
                        size="sm"
                        className="w-full"
                        disabled={deleteMutation.isPending}
                        onClick={() => {
                          if (window.confirm("Are you sure you want to delete this order?")) {
                            deleteMutation.mutate(selectedOrder.id);
                          }
                        }}
                        data-testid={`button-delete-order-${selectedOrder.id}`}
                      >
                        {deleteMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        ) : (
                          <Trash2 className="w-4 h-4 mr-2" />
                        )}
                        Delete Order
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
