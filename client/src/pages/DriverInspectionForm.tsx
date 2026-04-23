import { useState, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation as useWouterLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DRIVER_INSPECTION_ITEMS,
  DRIVER_INSPECTION_TYPES,
  type DriverInspectionType,
  type Trailer,
  type Tractor,
  type TruckRoute,
} from "@shared/schema";
import { ClipboardCheck, Loader2, Upload, X, CheckCircle2, AlertCircle, Truck } from "lucide-react";

type ItemStatus = "ok" | "repair" | null;

type ItemState = {
  key: string;
  label: string;
  section: "engine_off" | "engine_on";
  status: ItemStatus;
};

function initialItems(): ItemState[] {
  return DRIVER_INSPECTION_ITEMS.map(i => ({
    key: i.key,
    label: i.label,
    section: i.section as "engine_off" | "engine_on",
    status: null,
  }));
}

export default function DriverInspectionForm() {
  const { toast } = useToast();
  const [, navigate] = useWouterLocation();

  const [inspectionType, setInspectionType] = useState<DriverInspectionType>("tractor");
  const [startingMileage, setStartingMileage] = useState<string>("");
  const [routeNumber, setRouteNumber] = useState<string>("");
  const [tractorNumber, setTractorNumber] = useState<string>("");
  const [trailerNumber, setTrailerNumber] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [items, setItems] = useState<ItemState[]>(initialItems());

  // Configurable fleet + routes for the dropdowns.
  const { data: trailers = [] } = useQuery<Trailer[]>({ queryKey: ["/api/trailers"] });
  const { data: tractors = [] } = useQuery<Tractor[]>({ queryKey: ["/api/tractors"] });
  const { data: routes = [] } = useQuery<TruckRoute[]>({ queryKey: ["/api/truck-routes"] });
  const activeTrailers = trailers.filter(t => t.isActive);
  const activeTractors = tractors.filter(t => t.isActive);
  const activeRoutes = routes.filter(r => r.isActive);

  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const setItemStatus = (key: string, status: "ok" | "repair") => {
    setItems(prev => prev.map(i => (i.key === key ? { ...i, status } : i)));
  };

  const uploadPhoto = async (file: File) => {
    setUploading(true);
    try {
      const urlRes = await apiRequest("POST", "/api/driver-inspections/upload-url", {
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type,
      });
      const { uploadURL, objectPath } = await urlRes.json();
      const putRes = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!putRes.ok) throw new Error("upload failed");
      setPhotoUrl(objectPath);
      setPhotoName(file.name);
      toast({ title: "Photo uploaded" });
    } catch {
      toast({ title: "Upload failed", description: "Could not upload the photo. Please try again.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        inspectionType,
        startingMileage: startingMileage ? Number(startingMileage) : null,
        routeNumber: routeNumber.trim() || null,
        tractorNumber: tractorNumber.trim() || null,
        trailerNumber: trailerNumber.trim() || null,
        notes: notes.trim() || null,
        photoUrl,
        photoName,
        items: items.map(i => ({
          key: i.key,
          label: i.label,
          section: i.section,
          status: i.status,
          resolved: false,
        })),
      };
      const res = await apiRequest("POST", "/api/driver-inspections", payload);
      return await res.json();
    },
    onSuccess: (created: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver-inspections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/driver-inspections/summary"] });
      const repairCount = (created?.openRepairCount as number) ?? 0;
      toast({
        title: "Inspection submitted",
        description: repairCount > 0
          ? `${repairCount} repair item${repairCount === 1 ? "" : "s"} flagged. A notification has been sent to the logistics team.`
          : "No repairs needed. Safe travels!",
      });
      navigate("/driver-inspections");
    },
    onError: (err: any) => {
      toast({
        title: "Unable to submit",
        description: err?.message || "Please check the form and try again.",
        variant: "destructive",
      });
    },
  });

  const allAnswered = items.every(i => i.status !== null);
  const vehicleNumberMissing =
    (inspectionType === "tractor" && !tractorNumber.trim()) ||
    (inspectionType === "trailer" && !trailerNumber.trim());
  const canSubmit = allAnswered && !vehicleNumberMissing && !uploading;

  const repairCount = items.filter(i => i.status === "repair").length;
  const engineOffItems = items.filter(i => i.section === "engine_off");
  const engineOnItems = items.filter(i => i.section === "engine_on");

  const renderItem = (item: ItemState) => {
    const okSelected = item.status === "ok";
    const repairSelected = item.status === "repair";
    // peer-focus-visible:* surfaces a visible focus ring on the pill when the
    // sr-only radio receives keyboard focus.
    const basePill =
      "flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm font-medium cursor-pointer transition-colors hover-elevate active-elevate-2 " +
      "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background ";
    const okPillClass =
      basePill +
      (okSelected
        ? "bg-green-100 dark:bg-green-950/40 border-green-600 text-green-700 dark:text-green-400"
        : "bg-background border-border text-muted-foreground");
    const repairPillClass =
      basePill +
      (repairSelected
        ? "bg-destructive/10 border-destructive text-destructive"
        : "bg-background border-border text-muted-foreground");
    return (
      <div
        key={item.key}
        className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-3 border rounded hover-elevate"
        data-testid={`row-item-${item.key}`}
      >
        <div className="flex items-start gap-2 flex-1">
          <span className="text-sm text-muted-foreground font-mono pt-1">*</span>
          <Label className="text-sm font-normal leading-snug">{item.label}</Label>
        </div>
        {/* shadcn RadioGroup gives us native keyboard nav + ARIA semantics; we
            visually hide the radio dial and make the entire label the click
            target via peer-* utilities. */}
        <RadioGroup
          value={item.status ?? ""}
          onValueChange={(v) => setItemStatus(item.key, v as "ok" | "repair")}
          className="flex gap-2 flex-shrink-0"
          aria-label={`Status for ${item.label}`}
        >
          <div>
            <RadioGroupItem
              value="ok"
              id={`ok-${item.key}`}
              data-testid={`radio-ok-${item.key}`}
              className="sr-only peer"
            />
            <Label htmlFor={`ok-${item.key}`} className={okPillClass}>
              <CheckCircle2 className={"w-4 h-4 " + (okSelected ? "text-green-600" : "text-muted-foreground")} />
              OK
            </Label>
          </div>
          <div>
            <RadioGroupItem
              value="repair"
              id={`repair-${item.key}`}
              data-testid={`radio-repair-${item.key}`}
              className="sr-only peer"
            />
            <Label htmlFor={`repair-${item.key}`} className={repairPillClass}>
              <AlertCircle className={"w-4 h-4 " + (repairSelected ? "text-destructive" : "text-muted-foreground")} />
              Repair
            </Label>
          </div>
        </RadioGroup>
      </div>
    );
  };

  return (
    <div className="p-4 lg:p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded bg-primary/10 flex items-center justify-center">
          <ClipboardCheck className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold" data-testid="heading-driver-inspection">Driver Inspection</h1>
          <p className="text-sm text-muted-foreground">Pre-trip tractor / trailer inspection checklist.</p>
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Vehicle &amp; Trip</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Inspection Type</Label>
            <RadioGroup
              value={inspectionType}
              onValueChange={(v) => setInspectionType(v as DriverInspectionType)}
              className="flex gap-6"
            >
              {DRIVER_INSPECTION_TYPES.map(t => (
                <div key={t} className="flex items-center gap-2">
                  <RadioGroupItem value={t} id={`type-${t}`} data-testid={`radio-type-${t}`} />
                  <Label htmlFor={`type-${t}`} className="cursor-pointer font-normal capitalize flex items-center gap-1.5">
                    <Truck className="w-4 h-4" /> {t === "tractor" ? "Tractor / Box Truck" : "Trailer"}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="mileage">Starting Mileage</Label>
              <Input
                id="mileage"
                type="number"
                min={0}
                inputMode="numeric"
                value={startingMileage}
                onChange={(e) => setStartingMileage(e.target.value)}
                placeholder="e.g. 125430"
                data-testid="input-starting-mileage"
              />
            </div>
            <div className="space-y-2">
              <Label>Route Number</Label>
              <Select
                value={routeNumber || "none"}
                onValueChange={(v) => setRouteNumber(v === "none" ? "" : v)}
              >
                <SelectTrigger data-testid="select-route-number">
                  <SelectValue placeholder="Select a route" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {/* Show the saved route even if it was later renamed/deactivated. */}
                  {routeNumber && !activeRoutes.some(r => r.name === routeNumber) && (
                    <SelectItem value={routeNumber} data-testid="select-route-legacy">
                      {routeNumber} (not in routes)
                    </SelectItem>
                  )}
                  {activeRoutes.map(r => (
                    <SelectItem key={r.id} value={r.name} data-testid={`select-route-option-${r.id}`}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>
                Tractor / Box Truck # {inspectionType === "tractor" && <span className="text-destructive">*</span>}
              </Label>
              <Select
                value={tractorNumber || "none"}
                onValueChange={(v) => setTractorNumber(v === "none" ? "" : v)}
              >
                <SelectTrigger data-testid="select-tractor-number">
                  <SelectValue placeholder="Select a tractor / box truck" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {tractorNumber && !activeTractors.some(t => t.number === tractorNumber) && (
                    <SelectItem value={tractorNumber} data-testid="select-tractor-legacy">
                      {tractorNumber} (not in fleet)
                    </SelectItem>
                  )}
                  {activeTractors.map(t => (
                    <SelectItem key={t.id} value={t.number} data-testid={`select-tractor-option-${t.id}`}>
                      {t.number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>
                Trailer # {inspectionType === "trailer" && <span className="text-destructive">*</span>}
              </Label>
              <Select
                value={trailerNumber || "none"}
                onValueChange={(v) => setTrailerNumber(v === "none" ? "" : v)}
              >
                <SelectTrigger data-testid="select-trailer-number">
                  <SelectValue placeholder="Select a trailer" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {trailerNumber && !activeTrailers.some(t => t.number === trailerNumber) && (
                    <SelectItem value={trailerNumber} data-testid="select-trailer-legacy">
                      {trailerNumber} (not in fleet)
                    </SelectItem>
                  )}
                  {activeTrailers.map(t => (
                    <SelectItem key={t.id} value={t.number} data-testid={`select-trailer-option-${t.id}`}>
                      {t.number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            Engine Off Criteria
            <span className="text-xs font-normal text-muted-foreground">({engineOffItems.filter(i => i.status).length}/{engineOffItems.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {engineOffItems.map(renderItem)}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            Engine On Criteria
            <span className="text-xs font-normal text-muted-foreground">({engineOnItems.filter(i => i.status).length}/{engineOnItems.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {engineOnItems.map(renderItem)}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Notes &amp; Photo</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional detail about issues found or overall condition..."
              rows={4}
              data-testid="textarea-notes"
            />
          </div>
          <div className="space-y-2">
            <Label>Photo (optional)</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadPhoto(f);
                e.target.value = "";
              }}
              data-testid="input-file-photo"
            />
            {photoUrl ? (
              <div className="flex items-center gap-3 p-3 border rounded bg-muted/30">
                <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                <span className="text-sm flex-1 truncate">{photoName}</span>
                <Button
                  type="button" variant="ghost" size="sm"
                  onClick={() => { setPhotoUrl(null); setPhotoName(null); }}
                  data-testid="button-remove-photo"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <Button
                type="button" variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                data-testid="button-upload-photo"
              >
                {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                {uploading ? "Uploading..." : "Upload photo"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {repairCount > 0 && (
        <div className="mb-4 p-3 border border-destructive/40 bg-destructive/5 rounded text-sm flex items-start gap-2" data-testid="banner-repair-count">
          <AlertCircle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
          <span>
            <strong>{repairCount}</strong> item{repairCount === 1 ? "" : "s"} marked for repair. A notification will be sent to logistics upon submission.
          </span>
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        <Button variant="outline" onClick={() => navigate("/driver-inspections")} data-testid="button-cancel">
          Cancel
        </Button>
        <Button
          onClick={() => submitMutation.mutate()}
          disabled={!canSubmit || submitMutation.isPending}
          data-testid="button-submit-inspection"
        >
          {submitMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Submit Inspection
        </Button>
      </div>
    </div>
  );
}
