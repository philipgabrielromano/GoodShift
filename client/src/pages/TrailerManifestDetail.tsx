import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { Trailer } from "@shared/schema";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2, Truck, ArrowLeft, ArrowRight, MapPin, Plus, Minus, Save,
  Camera, Trash2, Printer, History, ImageIcon,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type {
  TrailerManifest, TrailerManifestItem, TrailerManifestEvent, TrailerManifestPhoto,
  TrailerManifestStatus,
} from "@shared/schema";
import { TRAILER_MANIFEST_STATUSES } from "@shared/schema";
import { useUpload } from "@/hooks/use-upload";

interface ManifestDetail {
  manifest: TrailerManifest;
  items: TrailerManifestItem[];
  events: TrailerManifestEvent[];
  photos: TrailerManifestPhoto[];
  categories: { group: string; items: string[] }[];
}

const STATUS_LABELS: Record<TrailerManifestStatus, string> = {
  loading: "Loading",
  in_transit: "In Transit",
  delivered: "Delivered",
  closed: "Closed",
};

const GROUP_COLORS: Record<string, string> = {
  RAW: "border-l-blue-500",
  OUTLET: "border-l-amber-500",
  SALVAGE: "border-l-purple-500",
  EQUIPMENT: "border-l-emerald-500",
  TRASH: "border-l-zinc-500",
};

export default function TrailerManifestDetail() {
  const { id } = useParams<{ id: string }>();
  const manifestId = Number(id);
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, isError, error } = useQuery<ManifestDetail>({
    queryKey: ["/api/trailer-manifests", manifestId],
  });

  const [headerForm, setHeaderForm] = useState({
    fromLocation: "",
    toLocation: "",
    trailerNumber: "",
    driverName: "",
    notes: "",
  });
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const { data: trailers = [] } = useQuery<Trailer[]>({ queryKey: ["/api/trailers"] });
  const activeTrailers = trailers.filter(t => t.isActive);

  useEffect(() => {
    if (data?.manifest) {
      setHeaderForm({
        fromLocation: data.manifest.fromLocation || "",
        toLocation: data.manifest.toLocation || "",
        trailerNumber: data.manifest.trailerNumber || "",
        driverName: data.manifest.driverName || "",
        notes: data.manifest.notes || "",
      });
    }
  }, [data?.manifest?.id]);

  const itemMap = useMemo(() => {
    const m = new Map<string, TrailerManifestItem>();
    data?.items.forEach(i => m.set(i.itemName, i));
    return m;
  }, [data?.items]);

  const grandTotals = useMemo(() => {
    const groups: Record<string, number> = {};
    let total = 0;
    data?.items.forEach(i => {
      groups[i.groupName] = (groups[i.groupName] || 0) + i.qty;
      total += i.qty;
    });
    return { groups, total };
  }, [data?.items]);

  const adjustMutation = useMutation({
    mutationFn: async (input: { itemName: string; delta: number; note?: string }) => {
      return await apiRequest("POST", `/api/trailer-manifests/${manifestId}/adjust`, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trailer-manifests", manifestId] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to adjust", description: err?.message || "", variant: "destructive" });
    },
  });

  const setQtyMutation = useMutation({
    mutationFn: async (input: { itemName: string; newQty: number; note?: string }) => {
      return await apiRequest("POST", `/api/trailer-manifests/${manifestId}/set-qty`, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trailer-manifests", manifestId] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to set qty", description: err?.message || "", variant: "destructive" });
    },
  });

  const updateHeaderMutation = useMutation({
    mutationFn: async (input: typeof headerForm) => {
      return await apiRequest("PUT", `/api/trailer-manifests/${manifestId}`, {
        ...input,
        trailerNumber: input.trailerNumber || null,
        driverName: input.driverName || null,
        notes: input.notes || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trailer-manifests", manifestId] });
      queryClient.invalidateQueries({ queryKey: ["/api/trailer-manifests"] });
      toast({ title: "Manifest updated" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update", description: err?.message || "", variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (status: TrailerManifestStatus) => {
      return await apiRequest("POST", `/api/trailer-manifests/${manifestId}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trailer-manifests", manifestId] });
      queryClient.invalidateQueries({ queryKey: ["/api/trailer-manifests"] });
      toast({ title: "Status updated" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update status", description: err?.message || "", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/trailer-manifests/${manifestId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trailer-manifests"] });
      toast({ title: "Manifest deleted" });
      window.location.href = "/trailer-manifests";
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete", description: err?.message || "", variant: "destructive" });
    },
  });

  const upload = useUpload({
    onSuccess: async (resp) => {
      try {
        await apiRequest("POST", `/api/trailer-manifests/${manifestId}/photos`, {
          objectPath: resp.objectPath,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/trailer-manifests", manifestId] });
        toast({ title: "Photo uploaded" });
      } catch (e: any) {
        toast({ title: "Photo metadata save failed", description: e?.message || "", variant: "destructive" });
      }
    },
    onError: (err) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  const deletePhotoMutation = useMutation({
    mutationFn: async (photoId: number) => {
      await apiRequest("DELETE", `/api/trailer-manifests/${manifestId}/photos/${photoId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trailer-manifests", manifestId] });
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <Link href="/trailer-manifests">
          <a className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4" data-testid="link-back-error">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to manifests
          </a>
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>Could not load this manifest</CardTitle>
            <CardDescription data-testid="text-load-error">
              {(error as any)?.message || "The manifest may have been deleted, or you may not have access."}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const m = data.manifest;
  const isClosed = m.status === "closed";
  const isReadOnly = isClosed;

  const handlePrint = () => window.print();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await upload.uploadFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <Link href="/trailer-manifests">
          <a className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground" data-testid="link-back">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to manifests
          </a>
        </Link>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handlePrint} data-testid="button-print">
            <Printer className="w-4 h-4 mr-2" /> Print snapshot
          </Button>
          <Select
            value={m.status}
            onValueChange={(v) => statusMutation.mutate(v as TrailerManifestStatus)}
            disabled={statusMutation.isPending}
          >
            <SelectTrigger className="w-[160px]" data-testid="select-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRAILER_MANIFEST_STATUSES.map(s => (
                <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="destructive" onClick={() => setDeleteConfirmOpen(true)} data-testid="button-delete-manifest">
            <Trash2 className="w-4 h-4 mr-2" /> Delete
          </Button>
        </div>
      </div>

      {/* Header / Snapshot */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 flex-wrap" data-testid="text-manifest-title">
                <Truck className="w-5 h-5" />
                <span>{m.fromLocation}</span>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
                <span>{m.toLocation}</span>
                <Badge variant={isClosed ? "outline" : "default"} data-testid="badge-status">
                  {STATUS_LABELS[m.status as TrailerManifestStatus] || m.status}
                </Badge>
              </CardTitle>
              <CardDescription className="mt-1">
                Created by {m.createdByName || "Unknown"} • {new Date(m.createdAt).toLocaleString()}
                {m.departedAt && <> • Departed {new Date(m.departedAt).toLocaleString()}</>}
                {m.arrivedAt && <> • Arrived {new Date(m.arrivedAt).toLocaleString()}</>}
              </CardDescription>
            </div>
            <div className="flex gap-3 text-right">
              <div>
                <div className="text-xs text-muted-foreground uppercase">Total Items</div>
                <div className="text-3xl font-bold" data-testid="text-grand-total">{grandTotals.total}</div>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {Object.entries(grandTotals.groups).map(([group, count]) => (
              <div
                key={group}
                className={`border-l-4 ${GROUP_COLORS[group] || "border-l-zinc-500"} bg-muted/30 px-3 py-2 rounded`}
                data-testid={`summary-group-${group}`}
              >
                <div className="text-xs text-muted-foreground">{group}</div>
                <div className="text-xl font-semibold">{count}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="items" className="print:block">
        <TabsList className="print:hidden">
          <TabsTrigger value="items" data-testid="tab-items">Live Counts</TabsTrigger>
          <TabsTrigger value="info" data-testid="tab-info">Trip Info</TabsTrigger>
          <TabsTrigger value="photos" data-testid="tab-photos">
            Photos {data.photos.length > 0 && <Badge variant="secondary" className="ml-2">{data.photos.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">
            History {data.events.length > 0 && <Badge variant="secondary" className="ml-2">{data.events.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        {/* === LIVE COUNTS === */}
        <TabsContent value="items" className="space-y-4 print:!block">
          {data.categories.map(cat => (
            <Card key={cat.group} className={`border-l-4 ${GROUP_COLORS[cat.group] || ""}`}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>{cat.group}</span>
                  <span className="text-sm text-muted-foreground font-normal">
                    Subtotal: <span className="font-semibold text-foreground">{grandTotals.groups[cat.group] || 0}</span>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {cat.items.map(name => {
                    const item = itemMap.get(name);
                    const qty = item?.qty ?? 0;
                    return (
                      <div
                        key={name}
                        className="flex items-center justify-between gap-2 p-2 rounded border"
                        data-testid={`row-item-${name.replace(/[^a-z0-9]/gi, "_")}`}
                      >
                        <span className="text-sm flex-1 truncate" title={name}>{name}</span>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-9 w-9"
                            disabled={isReadOnly || qty <= 0 || adjustMutation.isPending}
                            onClick={() => adjustMutation.mutate({ itemName: name, delta: -1 })}
                            data-testid={`button-minus-${name.replace(/[^a-z0-9]/gi, "_")}`}
                          >
                            <Minus className="w-4 h-4" />
                          </Button>
                          <Input
                            type="number"
                            min={0}
                            value={qty}
                            disabled={isReadOnly}
                            onChange={(e) => {
                              const v = parseInt(e.target.value, 10);
                              if (!Number.isNaN(v) && v >= 0 && v !== qty) {
                                setQtyMutation.mutate({ itemName: name, newQty: v });
                              }
                            }}
                            className="w-16 text-center h-9"
                            data-testid={`input-qty-${name.replace(/[^a-z0-9]/gi, "_")}`}
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-9 w-9"
                            disabled={isReadOnly || adjustMutation.isPending}
                            onClick={() => adjustMutation.mutate({ itemName: name, delta: 1 })}
                            data-testid={`button-plus-${name.replace(/[^a-z0-9]/gi, "_")}`}
                          >
                            <Plus className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* === TRIP INFO === */}
        <TabsContent value="info" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Trip Information</CardTitle>
              <CardDescription>Edit trailer and route details. Save when done.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>From location</Label>
                <Input
                  value={headerForm.fromLocation}
                  onChange={e => setHeaderForm({ ...headerForm, fromLocation: e.target.value })}
                  disabled={isReadOnly}
                  data-testid="input-edit-from"
                />
              </div>
              <div className="space-y-2">
                <Label>To location</Label>
                <Input
                  value={headerForm.toLocation}
                  onChange={e => setHeaderForm({ ...headerForm, toLocation: e.target.value })}
                  disabled={isReadOnly}
                  data-testid="input-edit-to"
                />
              </div>
              <div className="space-y-2">
                <Label>Trailer</Label>
                <Select
                  value={headerForm.trailerNumber || "none"}
                  onValueChange={(v) => setHeaderForm({ ...headerForm, trailerNumber: v === "none" ? "" : v })}
                  disabled={isReadOnly}
                >
                  <SelectTrigger data-testid="select-edit-trailer">
                    <SelectValue placeholder="No trailer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {/* Always show the currently-saved value, even if it isn't (anymore) in the active fleet. */}
                    {headerForm.trailerNumber &&
                      !activeTrailers.some(t => t.number === headerForm.trailerNumber) && (
                        <SelectItem value={headerForm.trailerNumber} data-testid="select-edit-trailer-legacy">
                          {headerForm.trailerNumber} (not in fleet)
                        </SelectItem>
                      )}
                    {activeTrailers.map(t => (
                      <SelectItem key={t.id} value={t.number} data-testid={`select-edit-trailer-option-${t.id}`}>
                        {t.number}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Driver</Label>
                <Input
                  value={headerForm.driverName}
                  onChange={e => setHeaderForm({ ...headerForm, driverName: e.target.value })}
                  disabled={isReadOnly}
                  data-testid="input-edit-driver"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Notes</Label>
                <Textarea
                  rows={3}
                  value={headerForm.notes}
                  onChange={e => setHeaderForm({ ...headerForm, notes: e.target.value })}
                  disabled={isReadOnly}
                  data-testid="input-edit-notes"
                />
              </div>
              <div className="md:col-span-2">
                <Button
                  onClick={() => updateHeaderMutation.mutate(headerForm)}
                  disabled={isReadOnly || updateHeaderMutation.isPending}
                  data-testid="button-save-header"
                >
                  {updateHeaderMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  Save changes
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* === PHOTOS === */}
        <TabsContent value="photos" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <CardTitle>Photos</CardTitle>
                <CardDescription>
                  Document load condition, seals, damage, or anything else worth keeping a record of.
                </CardDescription>
              </div>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handleFileChange}
                  data-testid="input-photo-file"
                />
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={upload.isUploading || isReadOnly}
                  data-testid="button-add-photo"
                >
                  {upload.isUploading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Camera className="w-4 h-4 mr-2" />
                  )}
                  Add photo
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {data.photos.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <ImageIcon className="w-10 h-10 mx-auto mb-2 opacity-40" />
                  No photos yet.
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {data.photos.map(p => (
                    <div key={p.id} className="relative border rounded overflow-hidden group" data-testid={`photo-${p.id}`}>
                      <a href={p.objectPath} target="_blank" rel="noreferrer">
                        <img
                          src={p.objectPath}
                          alt={p.caption || `Photo ${p.id}`}
                          className="w-full h-32 object-cover"
                        />
                      </a>
                      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs px-2 py-1">
                        {p.uploadedByName || "Unknown"} • {new Date(p.createdAt).toLocaleDateString()}
                      </div>
                      <Button
                        variant="destructive"
                        size="icon"
                        className="absolute top-1 right-1 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => deletePhotoMutation.mutate(p.id)}
                        data-testid={`button-delete-photo-${p.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* === HISTORY === */}
        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><History className="w-5 h-5" /> Change History</CardTitle>
              <CardDescription>Every add, removal, and adjustment, with the user who made it.</CardDescription>
            </CardHeader>
            <CardContent>
              {data.events.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No changes recorded yet.</div>
              ) : (
                <div className="divide-y">
                  {data.events.map(ev => (
                    <div key={ev.id} className="py-2 flex items-start gap-3 text-sm" data-testid={`event-${ev.id}`}>
                      <div className={`mt-0.5 px-2 py-0.5 rounded text-xs font-mono ${ev.delta >= 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"}`}>
                        {ev.delta >= 0 ? `+${ev.delta}` : ev.delta}
                      </div>
                      <div className="flex-1">
                        <div>
                          <span className="font-medium">{ev.itemName}</span>
                          <span className="text-muted-foreground"> ({ev.groupName})</span>
                          <span className="text-muted-foreground"> · {ev.prevQty} → {ev.newQty}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {ev.userName || "Unknown"} • {new Date(ev.createdAt).toLocaleString()}
                          {ev.note && <> • <em>{ev.note}</em></>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this manifest?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the manifest, all item counts, history events, and photos.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              data-testid="button-confirm-delete"
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
