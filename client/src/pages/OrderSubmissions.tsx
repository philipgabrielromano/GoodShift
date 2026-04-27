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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2,
  FileText,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Pencil,
  PackageCheck,
  PackageX,
  CheckCircle2,
  XCircle,
  Clock,
  History,
} from "lucide-react";
import { useLocation as useWouterLocation } from "wouter";
import { useLocations } from "@/hooks/use-locations";
import { usePermissions } from "@/hooks/use-permissions";
import { ADJUSTABLE_ORDER_FIELDS, type OrderEvent, type OrderStatus } from "@shared/schema";

const ORDER_TYPES = [
  "Transfer and Receive",
  "End of Day/Equipment Count",
  "Donors",
  "Supplemental production",
];

const ORDER_TYPE_COLORS: Record<string, string> = {
  "Transfer and Receive": "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  "End of Day/Equipment Count": "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  "Donors": "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  "Supplemental production": "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

const STATUS_META: Record<OrderStatus, { label: string; className: string; Icon: typeof Clock }> = {
  submitted: {
    label: "Submitted",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
    Icon: Clock,
  },
  approved: {
    label: "Approved",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    Icon: CheckCircle2,
  },
  denied: {
    label: "Denied",
    className: "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200",
    Icon: XCircle,
  },
  received: {
    label: "Received",
    className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    Icon: PackageCheck,
  },
  closed: {
    label: "Closed",
    className: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
    Icon: PackageCheck,
  },
};

interface Order {
  id: number;
  orderDate: string;
  orderType: string;
  location: string;
  submittedBy: string;
  submittedAt: string;
  fulfilledAt: string | null;
  fulfilledBy: string | null;
  status: OrderStatus;
  approvedAt: string | null;
  approvedBy: string | null;
  deniedAt: string | null;
  deniedBy: string | null;
  denialReason: string | null;
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
  furnitureGaylordsRequested: "Furniture Gaylords Requested",
  furnitureGaylordsReturned: "Furniture Gaylords Returned",
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
  isCentralProcessing: "Central Processing",
  apparelProduction: "Apparel Production",
  waresProduction: "Wares Production",
};

// Fields shown in the header section of the dialog. Everything else (the
// hundreds of equipment columns) is rendered in the details grid below.
const SKIP_KEYS = new Set([
  "id",
  "orderDate",
  "orderType",
  "location",
  "submittedBy",
  "submittedAt",
  "fulfilledAt",
  "fulfilledBy",
  "notes",
  "status",
  "approvedAt",
  "approvedBy",
  "deniedAt",
  "deniedBy",
  "denialReason",
]);

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.submitted;
  const { Icon } = meta;
  return (
    <Badge variant="secondary" className={`${meta.className} inline-flex items-center gap-1`} data-testid={`badge-status-${status}`}>
      <Icon className="w-3 h-3" />
      {meta.label}
    </Badge>
  );
}

const EVENT_LABELS: Record<string, string> = {
  created: "Submitted",
  modified: "Modified",
  approved: "Approved",
  denied: "Denied",
  received: "Received",
  unreceived: "Reverted to Approved",
  deleted: "Deleted",
};

function AuditLog({ orderId }: { orderId: number }) {
  const { data, isLoading, error } = useQuery<OrderEvent[]>({
    queryKey: ["/api/orders", orderId, "events"],
    queryFn: async () => {
      const res = await fetch(`/api/orders/${orderId}/events`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading history…
      </div>
    );
  }
  if (error) {
    return <div className="text-sm text-destructive">Couldn't load history.</div>;
  }
  if (!data || data.length === 0) {
    return <div className="text-sm text-muted-foreground">No history yet.</div>;
  }
  return (
    <ul className="space-y-2" data-testid={`list-audit-${orderId}`}>
      {data.map((e) => {
        const changes = e.changes as { before?: Record<string, any>; after?: Record<string, any> } | null;
        const changedKeys = changes?.after ? Object.keys(changes.after) : [];
        return (
          <li key={e.id} className="rounded border bg-muted/30 p-2 text-sm" data-testid={`event-${e.id}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">
                {EVENT_LABELS[e.eventType] || e.eventType}
                {e.fromStatus && e.toStatus && e.fromStatus !== e.toStatus
                  ? ` (${e.fromStatus} → ${e.toStatus})`
                  : ""}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatDateTime(e.createdAt as unknown as string)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">by {e.byUserName}</div>
            {e.note && <div className="mt-1 text-sm">{e.note}</div>}
            {changedKeys.length > 0 && (
              <div className="mt-1 text-xs">
                <span className="text-muted-foreground">Changed: </span>
                {changedKeys.map((k, i) => {
                  const before = changes?.before?.[k];
                  const after = changes?.after?.[k];
                  return (
                    <span key={k}>
                      {i > 0 ? ", " : ""}
                      <span className="font-medium">{FIELD_LABELS[k] || k}</span>
                      {" "}
                      <span className="text-muted-foreground">
                        ({before ?? "—"} → {after ?? "—"})
                      </span>
                    </span>
                  );
                })}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function OrderSubmissions() {
  const { toast } = useToast();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "">("");
  const [page, setPage] = useState(0);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [denyOpen, setDenyOpen] = useState(false);
  const [denyReason, setDenyReason] = useState("");
  // Adjust-on-approve dialog: pre-filled with the original requested values,
  // operator can edit any line up or down, optional reason text gets appended
  // to the audit-log note.
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustValues, setAdjustValues] = useState<Record<string, number>>({});
  const [adjustReason, setAdjustReason] = useState("");
  const pageSize = 25;

  const { can } = usePermissions();
  const canEdit = can("orders.edit");
  const canDelete = can("orders.delete");
  const canApprove = can("orders.approve");
  const canReceive = can("orders.receive");
  const [, navigate] = useWouterLocation();

  const { data: dbLocations } = useLocations();
  // Pull locationIds out of the existing auth status query (already cached
  // by usePermissions). Store-scoped users see only their stores in the
  // filter dropdown; the server enforces the same rule on /api/orders.
  const { data: authStatus } = useQuery<{ user?: { role?: string; locationIds?: string[] | null } | null }>({
    queryKey: ["/api/auth/status"],
  });
  const isStoreScoped = !canApprove && authStatus?.user?.role !== "admin";
  const userLocIdSet = new Set((authStatus?.user?.locationIds ?? []).map(String));
  const orderFormLocationNames = (dbLocations ?? [])
    .filter((l: any) => l.isActive && l.availableForOrderForm)
    .filter((l: any) => !isStoreScoped || userLocIdSet.has(String(l.id)))
    .map((l: any) => (l.orderFormName ?? l.name) as string)
    .sort((a, b) => a.localeCompare(b));

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
    queryClient.invalidateQueries({ queryKey: ["/api/orders/seasonal-balances"] });
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/orders/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Order deleted" });
      setSelectedOrder(null);
      invalidateAll();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete order", description: err.message, variant: "destructive" });
    },
  });

  const receiveMutation = useMutation({
    mutationFn: async ({ id, received }: { id: number; received: boolean }) => {
      const path = received ? "receive" : "unreceive";
      await apiRequest("POST", `/api/orders/${id}/${path}`);
    },
    onSuccess: (_data, vars) => {
      toast({ title: vars.received ? "Order marked as received" : "Order moved back to approved" });
      setSelectedOrder(null);
      invalidateAll();
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't update receive status", description: err.message, variant: "destructive" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (vars: { id: number; adjustments?: Record<string, number>; reason?: string }) => {
      const body: Record<string, unknown> = {};
      if (vars.adjustments && Object.keys(vars.adjustments).length > 0) body.adjustments = vars.adjustments;
      if (vars.reason && vars.reason.trim()) body.reason = vars.reason.trim();
      await apiRequest("POST", `/api/orders/${vars.id}/approve`, body);
    },
    onSuccess: (_data, vars) => {
      toast({
        title: vars.adjustments && Object.keys(vars.adjustments).length > 0
          ? "Order approved with adjustments"
          : "Order approved",
      });
      setSelectedOrder(null);
      setAdjustOpen(false);
      setAdjustValues({});
      setAdjustReason("");
      invalidateAll();
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't approve order", description: err.message, variant: "destructive" });
    },
  });

  const denyMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => {
      await apiRequest("POST", `/api/orders/${id}/deny`, { reason });
    },
    onSuccess: () => {
      toast({ title: "Order denied" });
      setDenyOpen(false);
      setDenyReason("");
      setSelectedOrder(null);
      invalidateAll();
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't deny order", description: err.message, variant: "destructive" });
    },
  });

  const queryParams = new URLSearchParams();
  if (startDate) queryParams.set("startDate", startDate);
  if (endDate) queryParams.set("endDate", endDate);
  if (locationFilter) queryParams.set("location", locationFilter);
  if (typeFilter) queryParams.set("orderType", typeFilter);
  if (statusFilter) queryParams.set("status", statusFilter);
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

  const statusForRow = (o: Order): OrderStatus => (o.status as OrderStatus) || "submitted";

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
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
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
                  {orderFormLocationNames.map((loc) => (
                    <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Order Type</Label>
              <Select value={typeFilter || "all"} onValueChange={(val) => { setTypeFilter(val === "all" ? "" : val); setPage(0); }}>
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
            <div className="space-y-1">
              <Label className="text-sm">Status</Label>
              <Select
                value={statusFilter || "all"}
                onValueChange={(val) => { setStatusFilter(val === "all" ? "" : (val as OrderStatus)); setPage(0); }}
              >
                <SelectTrigger data-testid="select-filter-status">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {(Object.keys(STATUS_META) as OrderStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
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
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => {
                    const st = statusForRow(order);
                    return (
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
                        <TableCell data-testid={`cell-status-${order.id}`}>
                          <StatusBadge status={st} />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSelectedOrder(order)}
                              data-testid={`button-view-order-${order.id}`}
                            >
                              View
                            </Button>
                            {canEdit && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => navigate(`/orders/edit/${order.id}`)}
                                data-testid={`button-edit-order-row-${order.id}`}
                              >
                                <Pencil className="w-4 h-4 mr-1" />
                                Edit
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
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

      <Dialog open={!!selectedOrder} onOpenChange={() => { setSelectedOrder(null); setDenyOpen(false); setDenyReason(""); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Order #{selectedOrder?.id} Details
              {selectedOrder && <StatusBadge status={statusForRow(selectedOrder)} />}
            </DialogTitle>
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

                {selectedOrder.approvedAt && (
                  <>
                    <div className="text-muted-foreground">Approved</div>
                    <div data-testid={`text-approved-${selectedOrder.id}`}>
                      {formatDateTime(selectedOrder.approvedAt)}
                      {selectedOrder.approvedBy ? ` by ${selectedOrder.approvedBy}` : ""}
                    </div>
                  </>
                )}
                {selectedOrder.deniedAt && (
                  <>
                    <div className="text-muted-foreground">Denied</div>
                    <div data-testid={`text-denied-${selectedOrder.id}`}>
                      {formatDateTime(selectedOrder.deniedAt)}
                      {selectedOrder.deniedBy ? ` by ${selectedOrder.deniedBy}` : ""}
                    </div>
                  </>
                )}
                {selectedOrder.fulfilledAt && (
                  <>
                    <div className="text-muted-foreground">Received</div>
                    <div data-testid={`text-received-${selectedOrder.id}`}>
                      {formatDateTime(selectedOrder.fulfilledAt)}
                      {selectedOrder.fulfilledBy ? ` by ${selectedOrder.fulfilledBy}` : ""}
                    </div>
                  </>
                )}
              </div>

              {selectedOrder.denialReason && (
                <div className="rounded border-l-4 border-rose-500 bg-rose-50 dark:bg-rose-950/40 p-3 text-sm" data-testid={`text-denial-reason-${selectedOrder.id}`}>
                  <div className="font-medium mb-1">Denial reason</div>
                  <div className="whitespace-pre-wrap">{selectedOrder.denialReason}</div>
                </div>
              )}

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
                    <p className="text-sm whitespace-pre-wrap">{selectedOrder.notes}</p>
                  </div>
                </>
              )}

              <hr />
              <div>
                <div className="flex items-center gap-2 text-sm font-medium mb-2">
                  <History className="w-4 h-4" />
                  History
                </div>
                <AuditLog orderId={selectedOrder.id} />
              </div>

              {(canEdit || canDelete || canApprove || canReceive) && (
                <>
                  <hr />
                  <div className="flex flex-col gap-2">
                    {canApprove && statusForRow(selectedOrder) === "submitted" && (
                      <>
                        <Button
                          variant="default"
                          size="sm"
                          className="w-full"
                          disabled={approveMutation.isPending || denyMutation.isPending}
                          onClick={() => approveMutation.mutate({ id: selectedOrder.id })}
                          data-testid={`button-approve-order-${selectedOrder.id}`}
                        >
                          {approveMutation.isPending && !adjustOpen ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                          Approve as requested
                        </Button>
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={approveMutation.isPending || denyMutation.isPending}
                            onClick={() => {
                              // Pre-fill the form with the requested values for
                              // every adjustable field that has a non-zero
                              // request — those are the only lines worth showing.
                              const initial: Record<string, number> = {};
                              for (const f of ADJUSTABLE_ORDER_FIELDS) {
                                const v = Number((selectedOrder as any)[f] ?? 0) || 0;
                                if (v > 0) initial[f] = v;
                              }
                              setAdjustValues(initial);
                              setAdjustReason("");
                              setAdjustOpen(true);
                            }}
                            data-testid={`button-adjust-order-${selectedOrder.id}`}
                          >
                            <Pencil className="w-4 h-4 mr-2" />
                            Adjust & approve
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={approveMutation.isPending || denyMutation.isPending}
                            onClick={() => { setDenyReason(""); setDenyOpen(true); }}
                            data-testid={`button-deny-order-${selectedOrder.id}`}
                          >
                            <XCircle className="w-4 h-4 mr-2" />
                            Deny
                          </Button>
                        </div>
                      </>
                    )}
                    {canReceive && statusForRow(selectedOrder) === "approved" && (
                      <Button
                        variant="default"
                        size="sm"
                        className="w-full"
                        disabled={receiveMutation.isPending}
                        onClick={() => receiveMutation.mutate({ id: selectedOrder.id, received: true })}
                        data-testid={`button-receive-order-${selectedOrder.id}`}
                      >
                        {receiveMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PackageCheck className="w-4 h-4 mr-2" />}
                        Mark as Received
                      </Button>
                    )}
                    {canReceive && (statusForRow(selectedOrder) === "received" || statusForRow(selectedOrder) === "closed") && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        disabled={receiveMutation.isPending}
                        onClick={() => receiveMutation.mutate({ id: selectedOrder.id, received: false })}
                        data-testid={`button-unreceive-order-${selectedOrder.id}`}
                      >
                        {receiveMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PackageX className="w-4 h-4 mr-2" />}
                        Undo Receive
                      </Button>
                    )}
                    {canEdit && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => navigate(`/orders/edit/${selectedOrder.id}`)}
                        data-testid={`button-edit-order-${selectedOrder.id}`}
                      >
                        <Pencil className="w-4 h-4 mr-2" />
                        Edit Order
                      </Button>
                    )}
                    {canDelete && (
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

      <Dialog open={denyOpen} onOpenChange={(open) => { setDenyOpen(open); if (!open) setDenyReason(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deny order #{selectedOrder?.id}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="deny-reason">Reason (visible to the submitter)</Label>
            <Textarea
              id="deny-reason"
              value={denyReason}
              onChange={(e) => setDenyReason(e.target.value)}
              rows={4}
              placeholder="Explain why this order is being denied so the submitter can correct and re-submit."
              data-testid="input-deny-reason"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDenyOpen(false); setDenyReason(""); }} data-testid="button-deny-cancel">
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={denyMutation.isPending || denyReason.trim().length === 0}
              onClick={() => selectedOrder && denyMutation.mutate({ id: selectedOrder.id, reason: denyReason.trim() })}
              data-testid="button-deny-confirm"
            >
              {denyMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Deny order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={adjustOpen}
        onOpenChange={(open) => {
          setAdjustOpen(open);
          if (!open) { setAdjustValues({}); setAdjustReason(""); }
        }}
      >
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Adjust quantities &amp; approve</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Edit any line where transportation is sending a different quantity than the store requested. Lines you don't change will be approved as-is.
            </p>
            {selectedOrder && Object.keys(adjustValues).length === 0 && (
              <p className="text-sm text-muted-foreground italic" data-testid="text-no-adjustable">
                This order has no adjustable line items — use "Approve as requested" instead.
              </p>
            )}
            <div className="space-y-2">
              {selectedOrder && ADJUSTABLE_ORDER_FIELDS.filter(f => f in adjustValues).map(field => {
                const original = Number((selectedOrder as any)[field] ?? 0) || 0;
                const current = adjustValues[field];
                const changed = current !== original;
                return (
                  <div key={field} className="flex items-center justify-between gap-3">
                    <Label htmlFor={`adjust-${field}`} className="text-sm flex-1">
                      {FIELD_LABELS[field] || field}
                      <span className="ml-2 text-xs text-muted-foreground">requested {original}</span>
                    </Label>
                    <Input
                      id={`adjust-${field}`}
                      type="number"
                      min={0}
                      step={1}
                      className={`w-24 ${changed ? "border-amber-500 focus-visible:ring-amber-500" : ""}`}
                      value={Number.isFinite(current) ? current : 0}
                      onChange={(e) => {
                        const v = Math.max(0, Math.floor(Number(e.target.value) || 0));
                        setAdjustValues(prev => ({ ...prev, [field]: v }));
                      }}
                      data-testid={`input-adjust-${field}`}
                    />
                  </div>
                );
              })}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adjust-reason" className="text-sm">
                Reason (optional)
              </Label>
              <Input
                id="adjust-reason"
                placeholder="e.g. Apparel gaylord short on hand"
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                data-testid="input-adjust-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setAdjustOpen(false); setAdjustValues({}); setAdjustReason(""); }}
              data-testid="button-adjust-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="default"
              disabled={approveMutation.isPending || !selectedOrder || Object.keys(adjustValues).length === 0}
              onClick={() => {
                if (!selectedOrder) return;
                // Only send the lines whose value actually differs from the
                // original — server treats no-op entries as a status-only
                // approval anyway, but trimming keeps the audit note clean.
                const diffs: Record<string, number> = {};
                for (const [field, value] of Object.entries(adjustValues)) {
                  const original = Number((selectedOrder as any)[field] ?? 0) || 0;
                  if (value !== original) diffs[field] = value;
                }
                approveMutation.mutate({ id: selectedOrder.id, adjustments: diffs, reason: adjustReason });
              }}
              data-testid="button-adjust-approve"
            >
              {approveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Approve order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
