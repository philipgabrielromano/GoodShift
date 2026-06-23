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
  CheckCheck,
  X,
} from "lucide-react";
import { useLocation as useWouterLocation } from "wouter";
import { useLocations } from "@/hooks/use-locations";
import { usePermissions } from "@/hooks/use-permissions";
import { isOrderFormLocation } from "@/lib/utils";
import {
  ADJUSTABLE_ORDER_FIELDS,
  ORDER_CONFIRMATION_KIND,
  RECEIPT_CONFIRM_FIELDS,
  EXPORT_CONFIRM_FIELDS,
  type OrderEvent,
  type OrderStatus,
} from "@shared/schema";

const ORDER_TYPES = [
  "Transfer and Receive",
  "End of Day/Equipment Count",
  "Donors",
  "Supplemental production",
  "First Aid",
];

const ORDER_TYPE_COLORS: Record<string, string> = {
  "Transfer and Receive": "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  "End of Day/Equipment Count": "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  "Donors": "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  "Supplemental production": "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  "First Aid": "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200",
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
  confirmedAt: string | null;
  confirmedBy: string | null;
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
  // First Aid items
  firstAidGuide: "First Aid Guide",
  cprMask: "CPR Mask (disposable)",
  scissors: "Scissors",
  tweezers: "Tweezers",
  medicalExamGloves: "Medical Exam Gloves",
  antibioticTreatment: "Antibiotic Treatment",
  antiseptic: "Antiseptic (no alcohol)",
  burnTreatment: "Burn Treatment",
  sterileBandaids: "Sterile Band-Aids",
  medicalTape: "Medical Tape",
  triangularSling: "Triangular Sling",
  absorbentCompress: "Absorbent Compress",
  sterilePads: "Sterile Pads",
  stingBiteAmpules: "Sting & Bite Ampules",
  stopBleedKit: "Stop the Bleed Kit",
  instantColdPack: "Instant Cold Pack",
  spillKit: "Spill Kit (BBP/Vomit)",
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
  "confirmedAt",
  "confirmedBy",
]);

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  // order_date is a calendar date (MySQL DATE column), not a moment in time.
  // mysql2 hands it back as a JS Date set to midnight UTC, which serializes
  // as "2026-04-27T00:00:00.000Z". If we feed that to `new Date(...)` and
  // then `.toLocaleDateString()`, midnight-UTC gets shifted into the
  // previous calendar day in any negative-offset timezone (e.g. Eastern),
  // so April 27 displays as April 26. Parse the YYYY-MM-DD prefix as
  // local-time components instead so the displayed date matches what the
  // user picked, regardless of viewer timezone.
  const ymd = dateStr.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) {
    // Fallback for any unexpected format
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
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

// The reconciliation kind for an order type, or null for order types that don't
// move warehouse goods (Donors / Supplemental / First Aid).
function confirmKindFor(orderType: string): "receipt" | "export" | null {
  return ORDER_CONFIRMATION_KIND[orderType] ?? null;
}

// The mapped lines that were planned (> 0) on this order for the given
// confirmation flow. These are the lines the confirmer must enter an actual
// for. Lines planned at 0 aren't shown by default; the confirm dialog offers a
// picker to add one as an overage (something arrived/left that wasn't ordered).
function plannedConfirmLines(order: Record<string, any>, kind: "receipt" | "export") {
  const fields = kind === "receipt" ? RECEIPT_CONFIRM_FIELDS : EXPORT_CONFIRM_FIELDS;
  return fields
    .map((field) => ({ field, planned: Number(order[field] ?? 0) || 0 }))
    .filter((l) => l.planned > 0);
}

// Order-aware status badge. Goods-moving orders surface their reconciliation
// state ("Pending confirmation" once approved-but-unconfirmed, "Reconciled"
// once the actuals are typed) on top of the raw DB status. Everything else
// falls back to the plain status badge.
function OrderStatusBadge({ order }: { order: { status: OrderStatus; orderType: string; confirmedAt: string | null } }) {
  const status = (order.status as OrderStatus) || "submitted";
  const kind = confirmKindFor(order.orderType);
  if (kind && status === "approved" && !order.confirmedAt) {
    return (
      <Badge variant="secondary" className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 inline-flex items-center gap-1" data-testid="badge-status-pending-confirmation">
        <Clock className="w-3 h-3" />
        Pending confirmation
      </Badge>
    );
  }
  if (kind && order.confirmedAt) {
    // Any confirmed goods-moving order is reconciled, whatever its raw status.
    // This also covers historical backfilled rows that were confirmed while
    // still in "approved" (they count toward inventory, so "approved" alone
    // would be misleading).
    return (
      <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 inline-flex items-center gap-1" data-testid="badge-status-reconciled">
        <PackageCheck className="w-3 h-3" />
        Reconciled
      </Badge>
    );
  }
  return <StatusBadge status={status} />;
}

const EVENT_LABELS: Record<string, string> = {
  created: "Submitted",
  modified: "Modified",
  approved: "Approved",
  denied: "Denied",
  received: "Received",
  unreceived: "Reverted to Approved",
  confirmed_receipt: "Receipt confirmed",
  confirmed_export: "Export confirmed",
  deleted: "Deleted",
};

// Confirmation events store their variance as { planned, actual } maps instead
// of the { before, after } shape used by edit/adjust events.
const CONFIRMATION_EVENT_TYPES = new Set([
  "confirmed_receipt",
  "confirmed_export",
]);

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
        const isConfirmation = CONFIRMATION_EVENT_TYPES.has(e.eventType);
        const changes = e.changes as {
          before?: Record<string, any>;
          after?: Record<string, any>;
          planned?: Record<string, any>;
          actual?: Record<string, any>;
        } | null;
        // Confirmation events carry { planned, actual }; everything else carries
        // { before, after }. Normalize both into a from/to pair for display.
        const fromMap = isConfirmation ? changes?.planned : changes?.before;
        const toMap = isConfirmation ? changes?.actual : changes?.after;
        const changedKeys = toMap ? Object.keys(toMap) : [];
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
                <span className="text-muted-foreground">{isConfirmation ? "Planned → actual: " : "Changed: "}</span>
                {changedKeys.map((k, i) => {
                  const from = fromMap?.[k];
                  const to = toMap?.[k];
                  const variance = isConfirmation ? Number(to ?? 0) - Number(from ?? 0) : 0;
                  return (
                    <span key={k}>
                      {i > 0 ? ", " : ""}
                      <span className="font-medium">{FIELD_LABELS[k] || k}</span>
                      {" "}
                      <span className="text-muted-foreground">
                        ({from ?? "—"} → {to ?? "—"})
                      </span>
                      {isConfirmation && variance !== 0 && (
                        <span className={variance > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
                          {" "}{variance > 0 ? `+${variance}` : variance}
                        </span>
                      )}
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
  // Reconciliation confirm dialog: the responsible side types the actual
  // quantities that physically moved before a goods-moving order leaves
  // "pending confirmation". Inputs start blank (no one-click) and every
  // planned-nonzero line must be filled in.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmKind, setConfirmKind] = useState<"receipt" | "export">("receipt");
  const [confirmValues, setConfirmValues] = useState<Record<string, string>>({});
  // Extra (planned-0) lines the confirmer chose to add to record an overage —
  // something arrived/left that wasn't on the original order.
  const [confirmExtra, setConfirmExtra] = useState<string[]>([]);
  // Bulk-approve state. We open a confirmation dialog showing the count of
  // currently-visible submitted orders before any DB writes happen.
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkResult, setBulkResult] = useState<null | {
    approved: number;
    attempted: number;
    skipped: Array<{ id: number; location?: string; reason: string }>;
  }>(null);
  const pageSize = 25;

  const { can } = usePermissions();
  const canEdit = can("orders.edit");
  const canDelete = can("orders.delete");
  const canApprove = can("orders.approve");
  const canReceive = can("orders.receive");
  const canConfirmExport = can("orders.confirm_export");
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
    .filter(isOrderFormLocation)
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

  // Confirm a goods-moving order with the typed actual quantities.
  const confirmMutation = useMutation({
    mutationFn: async ({ id, kind, actuals }: { id: number; kind: "receipt" | "export"; actuals: Record<string, number> }) => {
      const path = kind === "receipt" ? "confirm-receipt" : "confirm-export";
      await apiRequest("POST", `/api/orders/${id}/${path}`, { actuals });
    },
    onSuccess: (_data, vars) => {
      toast({ title: vars.kind === "receipt" ? "Receipt confirmed" : "Export confirmed" });
      setConfirmOpen(false);
      setConfirmValues({});
      setConfirmExtra([]);
      setSelectedOrder(null);
      invalidateAll();
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't confirm order", description: err.message, variant: "destructive" });
    },
  });

  // Undo a confirmation — clears the typed actuals and reverts to approved.
  const unconfirmMutation = useMutation({
    mutationFn: async ({ id, kind }: { id: number; kind: "receipt" | "export" }) => {
      const path = kind === "receipt" ? "unconfirm-receipt" : "unconfirm-export";
      await apiRequest("POST", `/api/orders/${id}/${path}`);
    },
    onSuccess: () => {
      toast({ title: "Confirmation undone — order moved back to approved" });
      setSelectedOrder(null);
      invalidateAll();
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't undo confirmation", description: err.message, variant: "destructive" });
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

  // Bulk approve all currently-visible submitted orders. The frontend
  // sends explicit IDs (not filter params) so what the user is approving
  // matches exactly what they see — no "you also approved 200 orders on
  // page 2" surprises.
  const bulkApproveMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await apiRequest("POST", "/api/orders/bulk-approve", { ids });
      return res.json() as Promise<{
        approved: number;
        attempted: number;
        approvedIds: number[];
        skipped: Array<{ id: number; location?: string; reason: string }>;
      }>;
    },
    onSuccess: (data) => {
      setBulkConfirmOpen(false);
      setBulkResult({ approved: data.approved, attempted: data.attempted, skipped: data.skipped });
      const skippedCount = data.skipped.length;
      toast({
        title: skippedCount === 0
          ? `Approved ${data.approved} order${data.approved === 1 ? "" : "s"}`
          : `Approved ${data.approved} of ${data.attempted}`,
        description: skippedCount > 0
          ? `${skippedCount} skipped — details open in a dialog.`
          : undefined,
      });
      invalidateAll();
    },
    onError: (err: Error) => {
      toast({ title: "Bulk approve failed", description: err.message, variant: "destructive" });
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

  const statusForRow = (o: Order): OrderStatus => (o.status as OrderStatus) || "submitted";

  const orders = data?.orders || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize);
  // The bulk-approve button only acts on the orders currently visible on
  // this page so the operator's intent matches what they see. If they
  // want to approve more than one page worth, they paginate and click
  // again (or widen the page size in the future).
  const visibleSubmittedIds = orders.filter(o => statusForRow(o) === "submitted").map(o => o.id);
  const canBulkApprove = canApprove && visibleSubmittedIds.length > 0;

  const nonNullFields = (order: Order) => {
    return Object.entries(order)
      .filter(([key, val]) => !SKIP_KEYS.has(key) && !key.endsWith("Actual") && val !== null && val !== undefined && val !== 0)
      .map(([key, val]) => ({
        label: FIELD_LABELS[key] || key,
        value: key === "isCentralProcessing" ? (val ? "Yes" : "No") : val,
      }));
  };

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <FileText className="w-7 h-7 text-primary" />
        <h1 className="text-2xl font-bold" data-testid="text-order-submissions-title">Order Submissions</h1>
        {canApprove && (
          <div className="ml-auto">
            <Button
              variant="default"
              onClick={() => setBulkConfirmOpen(true)}
              disabled={!canBulkApprove || bulkApproveMutation.isPending}
              data-testid="button-bulk-approve"
            >
              <CheckCheck className="w-4 h-4 mr-2" />
              Approve all submitted on this page
              {visibleSubmittedIds.length > 0 && (
                <span className="ml-2 inline-flex items-center justify-center rounded-full bg-primary-foreground/20 px-2 py-0.5 text-xs font-semibold">
                  {visibleSubmittedIds.length}
                </span>
              )}
            </Button>
          </div>
        )}
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
                          <OrderStatusBadge order={order} />
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
              {selectedOrder && <OrderStatusBadge order={selectedOrder} />}
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
                {selectedOrder.confirmedAt && (
                  <>
                    <div className="text-muted-foreground">
                      {confirmKindFor(selectedOrder.orderType) === "export" ? "Export confirmed" : "Receipt confirmed"}
                    </div>
                    <div data-testid={`text-confirmed-${selectedOrder.id}`}>
                      {formatDateTime(selectedOrder.confirmedAt)}
                      {selectedOrder.confirmedBy ? ` by ${selectedOrder.confirmedBy}` : ""}
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

              {(() => {
                const kind = confirmKindFor(selectedOrder.orderType);
                if (!kind || !selectedOrder.confirmedAt) return null;
                const lines = plannedConfirmLines(selectedOrder, kind)
                  .map((l) => {
                    const actual = Number((selectedOrder as any)[`${l.field}Actual`] ?? 0) || 0;
                    return { ...l, actual, variance: actual - l.planned };
                  });
                if (lines.length === 0) return null;
                return (
                  <>
                    <hr />
                    <div>
                      <p className="text-sm font-medium mb-2">Confirmed quantities (planned → actual)</p>
                      <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm" data-testid={`variance-${selectedOrder.id}`}>
                        {lines.map((l) => (
                          <div key={l.field} className="contents">
                            <div className="text-muted-foreground">{FIELD_LABELS[l.field] || l.field}</div>
                            <div className="font-medium tabular-nums text-right">
                              {l.planned} → {l.actual}
                              {l.variance !== 0 && (
                                <span className={l.variance > 0 ? "ml-2 text-emerald-600 dark:text-emerald-400" : "ml-2 text-rose-600 dark:text-rose-400"}>
                                  {l.variance > 0 ? `+${l.variance}` : l.variance}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                );
              })()}

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

              {(canEdit || canDelete || canApprove || canReceive || canConfirmExport) && (
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
                    {(() => {
                      const kind = confirmKindFor(selectedOrder.orderType);
                      const st = statusForRow(selectedOrder);
                      const isConfirmed = !!selectedOrder.confirmedAt;
                      // Whoever may act on THIS order's confirmation: the store
                      // (orders.receive) for Transfer & Receive, transportation
                      // (orders.confirm_export) for End of Day.
                      const canConfirmThis = kind === "receipt" ? canReceive : kind === "export" ? canConfirmExport : false;

                      // Non-goods-moving order types keep the plain one-click
                      // receive / undo — there's nothing to reconcile.
                      if (kind === null) {
                        return (
                          <>
                            {canReceive && st === "approved" && (
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
                            {canReceive && (st === "received" || st === "closed") && (
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
                          </>
                        );
                      }

                      // Goods-moving orders require typed actuals.
                      return (
                        <>
                          {canConfirmThis && st === "approved" && !isConfirmed && (
                            <Button
                              variant="default"
                              size="sm"
                              className="w-full"
                              disabled={confirmMutation.isPending}
                              onClick={() => { setConfirmKind(kind); setConfirmValues({}); setConfirmExtra([]); setConfirmOpen(true); }}
                              data-testid={`button-confirm-order-${selectedOrder.id}`}
                            >
                              <PackageCheck className="w-4 h-4 mr-2" />
                              {kind === "receipt" ? "Confirm receipt…" : "Confirm export…"}
                            </Button>
                          )}
                          {/* Undo is only offered while the order is "received".
                              The server keeps "closed" terminal (a closed
                              confirmation can't be reverted), so we don't show
                              the button there to avoid a guaranteed error. */}
                          {canConfirmThis && isConfirmed && st === "received" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full"
                              disabled={unconfirmMutation.isPending}
                              onClick={() => unconfirmMutation.mutate({ id: selectedOrder.id, kind })}
                              data-testid={`button-unconfirm-order-${selectedOrder.id}`}
                            >
                              {unconfirmMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PackageX className="w-4 h-4 mr-2" />}
                              Undo confirmation
                            </Button>
                          )}
                        </>
                      );
                    })()}
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

      {/* Bulk approve confirmation. Shows the exact count being approved
          and warns that emails will go out. Result details (skipped
          orders) are shown below the table once the request returns. */}
      <Dialog open={bulkConfirmOpen} onOpenChange={(open) => { if (!bulkApproveMutation.isPending) setBulkConfirmOpen(open); }}>
        <DialogContent data-testid="dialog-bulk-approve-confirm">
          <DialogHeader>
            <DialogTitle>Approve {visibleSubmittedIds.length} submitted order{visibleSubmittedIds.length === 1 ? "" : "s"}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              Each order will be approved with the quantities the store originally requested. The submitter of each order will be emailed.
            </p>
            <p className="text-muted-foreground">
              Only orders currently visible on this page will be approved. Anything that fails seasonal-inventory validation will be skipped and listed for you afterward.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkConfirmOpen(false)} disabled={bulkApproveMutation.isPending} data-testid="button-bulk-approve-cancel">
              Cancel
            </Button>
            <Button
              onClick={() => bulkApproveMutation.mutate(visibleSubmittedIds)}
              disabled={bulkApproveMutation.isPending || visibleSubmittedIds.length === 0}
              data-testid="button-bulk-approve-confirm"
            >
              {bulkApproveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <CheckCheck className="w-4 h-4 mr-2" />
              Approve {visibleSubmittedIds.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Result detail dialog: only opened automatically if there were
          skipped orders so the operator can see exactly why each one
          failed. A clean run just shows the toast and goes away. */}
      <Dialog
        open={!!bulkResult && bulkResult.skipped.length > 0}
        onOpenChange={(open) => { if (!open) setBulkResult(null); }}
      >
        <DialogContent data-testid="dialog-bulk-approve-result">
          <DialogHeader>
            <DialogTitle>
              Approved {bulkResult?.approved} of {bulkResult?.attempted} — {bulkResult?.skipped.length} skipped
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            <p className="text-sm text-muted-foreground">These orders were not approved:</p>
            <ul className="space-y-2 text-sm" data-testid="list-bulk-skipped">
              {bulkResult?.skipped.map((s) => (
                <li key={s.id} className="rounded border bg-muted/40 p-2" data-testid={`skipped-${s.id}`}>
                  <div className="font-medium">
                    Order #{s.id}
                    {s.location ? ` — ${s.location}` : ""}
                  </div>
                  <div className="text-muted-foreground">{s.reason}</div>
                </li>
              ))}
            </ul>
          </div>
          <DialogFooter>
            <Button onClick={() => setBulkResult(null)} data-testid="button-bulk-result-close">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm receipt / export. Goods-moving orders only count toward
          inventory once the responsible side TYPES the actual quantities that
          physically moved — there is no one-click "received". The planned
          amount is shown as the input placeholder so the confirmer can see
          what was expected, but they must enter every line explicitly (0 is a
          valid actual). Planned-positive lines are shown by default; a picker
          lets the confirmer add an overage line for an item that arrived but
          wasn't on the original order (planned 0). */}
      {(() => {
        const order = selectedOrder;
        const confirmLines = order ? plannedConfirmLines(order, confirmKind) : [];
        // Every field this flow allows, minus the planned-positive lines already
        // shown and minus any overage lines already added. These are offered in
        // the "record an overage" picker so the confirmer can log an item that
        // wasn't on the original order (planned 0).
        const flowFields = confirmKind === "receipt" ? RECEIPT_CONFIRM_FIELDS : EXPORT_CONFIRM_FIELDS;
        const plannedFieldSet = new Set(confirmLines.map((l) => l.field));
        const addableFields = flowFields.filter((f) => !plannedFieldSet.has(f) && !confirmExtra.includes(f));
        const extraLines = confirmExtra.map((field) => ({ field, planned: 0 }));
        const allLines = [...confirmLines, ...extraLines];
        const allFilled = allLines.every((l) => {
          const v = confirmValues[l.field];
          return v !== undefined && v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0;
        });
        const submit = () => {
          if (!order) return;
          const actuals: Record<string, number> = {};
          for (const l of allLines) {
            actuals[l.field] = Math.max(0, Math.trunc(Number(confirmValues[l.field])));
          }
          confirmMutation.mutate({ id: order.id, kind: confirmKind, actuals });
        };
        return (
          <Dialog open={confirmOpen} onOpenChange={(open) => { if (!confirmMutation.isPending) setConfirmOpen(open); }}>
            <DialogContent data-testid="dialog-confirm-actuals">
              <DialogHeader>
                <DialogTitle>
                  {confirmKind === "receipt" ? "Confirm what you received" : "Confirm what was sent"}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  {confirmKind === "receipt"
                    ? "Type the actual quantity that arrived for each line. This is what counts toward warehouse inventory — not the requested amount."
                    : "Type the actual quantity that left for each line. This is what counts toward inventory — not the planned amount."}
                </p>
                {allLines.length === 0 ? (
                  <p className="text-muted-foreground">
                    Nothing was ordered on this order. If something still arrived,
                    add it below and type the actual quantity. Otherwise leave it
                    unconfirmed — there's nothing to count.
                  </p>
                ) : (
                  <div className="grid grid-cols-[1fr_7rem] items-center gap-x-4 gap-y-2">
                    {confirmLines.map((l) => (
                      <div key={l.field} className="contents">
                        <label htmlFor={`confirm-${l.field}`} className="text-muted-foreground">
                          {FIELD_LABELS[l.field] || l.field}
                          <span className="ml-1 text-xs">(planned {l.planned})</span>
                        </label>
                        <Input
                          id={`confirm-${l.field}`}
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          placeholder={String(l.planned)}
                          value={confirmValues[l.field] ?? ""}
                          onChange={(e) => setConfirmValues((prev) => ({ ...prev, [l.field]: e.target.value }))}
                          className="text-right tabular-nums"
                          data-testid={`input-confirm-${l.field}`}
                        />
                      </div>
                    ))}
                    {extraLines.map((l) => (
                      <div key={l.field} className="contents">
                        <label htmlFor={`confirm-${l.field}`} className="text-muted-foreground inline-flex items-center gap-1">
                          {FIELD_LABELS[l.field] || l.field}
                          <span className="ml-1 text-xs">(overage — not ordered)</span>
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => {
                              setConfirmExtra((prev) => prev.filter((f) => f !== l.field));
                              setConfirmValues((prev) => { const next = { ...prev }; delete next[l.field]; return next; });
                            }}
                            data-testid={`button-remove-overage-${l.field}`}
                            aria-label="Remove line"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </label>
                        <Input
                          id={`confirm-${l.field}`}
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          placeholder="0"
                          value={confirmValues[l.field] ?? ""}
                          onChange={(e) => setConfirmValues((prev) => ({ ...prev, [l.field]: e.target.value }))}
                          className="text-right tabular-nums"
                          data-testid={`input-confirm-${l.field}`}
                        />
                      </div>
                    ))}
                  </div>
                )}
                {addableFields.length > 0 && (
                  <div className="pt-1">
                    <Select
                      value=""
                      onValueChange={(field) => {
                        setConfirmExtra((prev) => (prev.includes(field) ? prev : [...prev, field]));
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs" data-testid="select-add-overage">
                        <SelectValue placeholder="+ Received something not on the order?" />
                      </SelectTrigger>
                      <SelectContent>
                        {addableFields.map((f) => (
                          <SelectItem key={f} value={f} data-testid={`option-overage-${f}`}>
                            {FIELD_LABELS[f] || f}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={confirmMutation.isPending} data-testid="button-confirm-cancel">
                  Cancel
                </Button>
                <Button
                  onClick={submit}
                  disabled={confirmMutation.isPending || !allFilled || allLines.length === 0}
                  data-testid="button-confirm-submit"
                >
                  {confirmMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PackageCheck className="w-4 h-4 mr-2" />}
                  {confirmKind === "receipt" ? "Confirm receipt" : "Confirm export"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}
    </div>
  );
}
