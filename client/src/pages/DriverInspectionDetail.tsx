import { useState } from "react";
import { useParams, Link, useLocation as useWouterLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft, Loader2, CheckCircle2, AlertCircle, Truck, Camera, Wrench, Trash2, RotateCcw,
} from "lucide-react";
import type { DriverInspection, DriverInspectionItem } from "@shared/schema";

interface AuthStatus {
  user: { id: number; name: string } | null;
  accessibleFeatures?: string[];
}

export default function DriverInspectionDetail() {
  const { id } = useParams<{ id: string }>();
  const inspectionId = Number(id);
  const [, navigate] = useWouterLocation();
  const { toast } = useToast();

  const { data: authStatus } = useQuery<AuthStatus>({ queryKey: ["/api/auth/status"] });
  const features = authStatus?.accessibleFeatures || [];
  const canResolve = features.includes("driver_inspection.resolve_repairs");
  const canDelete = features.includes("driver_inspection.delete");

  const { data: inspection, isLoading } = useQuery<DriverInspection>({
    queryKey: ["/api/driver-inspections", inspectionId],
    enabled: !isNaN(inspectionId),
  });

  const [resolvingKey, setResolvingKey] = useState<string | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState("");

  const resolveMutation = useMutation({
    mutationFn: async (params: { key: string; resolved: boolean; resolutionNotes?: string }) => {
      const res = await apiRequest("PATCH", `/api/driver-inspections/${inspectionId}/items/${encodeURIComponent(params.key)}`, {
        resolved: params.resolved,
        resolutionNotes: params.resolutionNotes || null,
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver-inspections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/driver-inspections/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/driver-inspections", inspectionId] });
      setResolvingKey(null);
      setResolutionNotes("");
      toast({ title: "Updated" });
    },
    onError: (err: any) => toast({ title: "Update failed", description: err?.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", `/api/driver-inspections/${inspectionId}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver-inspections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/driver-inspections/summary"] });
      toast({ title: "Inspection deleted" });
      navigate("/driver-inspections");
    },
    onError: (err: any) => toast({ title: "Delete failed", description: err?.message, variant: "destructive" }),
  });

  if (isLoading || !inspection) {
    return (
      <div className="container max-w-4xl py-12 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const items = (inspection.items as DriverInspectionItem[]) || [];
  const repairItems = items.filter(i => i.status === "repair");
  const openRepairs = repairItems.filter(i => !i.resolved);
  const resolvedRepairs = repairItems.filter(i => i.resolved);
  const okItems = items.filter(i => i.status === "ok");

  const vehicleLabel = inspection.inspectionType === "tractor"
    ? (inspection.tractorNumber || "—")
    : (inspection.trailerNumber || "—");

  return (
    <div className="container max-w-4xl py-8 px-4">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/driver-inspections">
          <Button variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
        </Link>
      </div>

      <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded bg-primary/10 flex items-center justify-center">
            <Truck className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold capitalize" data-testid="heading-inspection">
              {inspection.inspectionType} Inspection
            </h1>
            <p className="text-sm text-muted-foreground">
              {inspection.driverName || "Unknown driver"} • {new Date(inspection.createdAt).toLocaleString()}
            </p>
          </div>
        </div>
        {canDelete && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" data-testid="button-delete">
                <Trash2 className="w-4 h-4 mr-2" /> Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this inspection?</AlertDialogTitle>
                <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => deleteMutation.mutate()} data-testid="button-confirm-delete">
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <Info label={inspection.inspectionType === "tractor" ? "Tractor/Truck #" : "Trailer #"} value={vehicleLabel} testid="text-primary-vehicle" />
          {inspection.inspectionType === "tractor" && inspection.trailerNumber && (
            <Info label="Trailer #" value={inspection.trailerNumber} />
          )}
          <Info label="Route" value={inspection.routeNumber || "—"} />
          <Info label="Starting Mileage" value={inspection.startingMileage != null ? inspection.startingMileage.toLocaleString() : "—"} />
          <Info
            label="Status"
            value={
              openRepairs.length > 0
                ? `${openRepairs.length} open repair${openRepairs.length === 1 ? "" : "s"}`
                : repairItems.length > 0
                ? "All repairs resolved"
                : "No issues"
            }
          />
          <Info label="Items" value={`${okItems.length} OK • ${repairItems.length} Repair`} />
        </CardContent>
      </Card>

      {openRepairs.length > 0 && (
        <Card className="mb-6 border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-destructive">
              <AlertCircle className="w-4 h-4" /> Open Repair Items ({openRepairs.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {openRepairs.map(item => (
              <div key={item.key} className="p-3 border rounded" data-testid={`row-open-${item.key}`}>
                <div className="flex items-start justify-between flex-wrap gap-2">
                  <div>
                    <div className="font-medium">{item.label}</div>
                    <div className="text-xs text-muted-foreground capitalize">{item.section.replace("_", " ")}</div>
                  </div>
                  {canResolve && resolvingKey !== item.key && (
                    <Button size="sm" variant="outline" onClick={() => { setResolvingKey(item.key); setResolutionNotes(""); }} data-testid={`button-resolve-${item.key}`}>
                      <Wrench className="w-4 h-4 mr-2" /> Mark Resolved
                    </Button>
                  )}
                </div>
                {resolvingKey === item.key && (
                  <div className="mt-3 space-y-2">
                    <Label htmlFor={`notes-${item.key}`} className="text-xs">Resolution notes (optional)</Label>
                    <Textarea
                      id={`notes-${item.key}`}
                      value={resolutionNotes}
                      onChange={(e) => setResolutionNotes(e.target.value)}
                      rows={2}
                      placeholder="Brake pads replaced by shop..."
                      data-testid={`textarea-resolution-${item.key}`}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => resolveMutation.mutate({ key: item.key, resolved: true, resolutionNotes })} disabled={resolveMutation.isPending} data-testid={`button-confirm-resolve-${item.key}`}>
                        {resolveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        Confirm Resolve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setResolvingKey(null); setResolutionNotes(""); }}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {resolvedRepairs.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600" /> Resolved Repairs ({resolvedRepairs.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {resolvedRepairs.map(item => (
              <div key={item.key} className="p-3 border rounded bg-muted/30" data-testid={`row-resolved-${item.key}`}>
                <div className="flex items-start justify-between flex-wrap gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">{item.label}</div>
                    <div className="text-xs text-muted-foreground">
                      Resolved {item.resolvedAt ? new Date(item.resolvedAt).toLocaleString() : ""}
                      {item.resolvedByName ? ` by ${item.resolvedByName}` : ""}
                    </div>
                    {item.resolutionNotes && (
                      <div className="text-sm mt-1 italic text-muted-foreground">"{item.resolutionNotes}"</div>
                    )}
                  </div>
                  {canResolve && (
                    <Button size="sm" variant="ghost" onClick={() => resolveMutation.mutate({ key: item.key, resolved: false })} disabled={resolveMutation.isPending} data-testid={`button-reopen-${item.key}`}>
                      <RotateCcw className="w-4 h-4 mr-2" /> Reopen
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Full Checklist</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {["engine_off", "engine_on"].map(section => (
            <div key={section} className="mb-4">
              <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                {section === "engine_off" ? "Engine Off" : "Engine On"}
              </div>
              <div className="space-y-1">
                {items.filter(i => i.section === section).map(item => (
                  <div key={item.key} className="flex items-center justify-between py-1.5 border-b last:border-0 text-sm">
                    <span>{item.label}</span>
                    {item.status === "repair" ? (
                      <Badge variant={item.resolved ? "secondary" : "destructive"} className="gap-1">
                        {item.resolved ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                        {item.resolved ? "Resolved" : "Repair"}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="gap-1 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                        <CheckCircle2 className="w-3 h-3" /> OK
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {inspection.notes && (
        <Card className="mb-6">
          <CardHeader><CardTitle className="text-base">Notes</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap" data-testid="text-notes">{inspection.notes}</p>
          </CardContent>
        </Card>
      )}

      {inspection.photoUrl && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Camera className="w-4 h-4" /> Photo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <a href={inspection.photoUrl} target="_blank" rel="noreferrer">
              <img
                src={inspection.photoUrl}
                alt="Inspection"
                className="max-h-96 rounded border"
                data-testid="img-photo"
              />
            </a>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Info({ label, value, testid }: { label: string; value: string; testid?: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium" data-testid={testid}>{value}</div>
    </div>
  );
}
