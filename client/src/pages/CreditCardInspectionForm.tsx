import { useState, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation as useWouterLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocations } from "@/hooks/use-locations";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CreditCard, Loader2, Upload, X, CheckCircle2, AlertCircle } from "lucide-react";

type TerminalState = {
  terminalNumber: number;
  present: boolean;
  issueFound: boolean | null;
  issueDescription: string;
  photoUrl: string | null;
  photoName: string | null;
  uploading: boolean;
};

function makeInitialTerminals(): TerminalState[] {
  return [1, 2, 3, 4, 5].map(n => ({
    terminalNumber: n,
    present: true,
    issueFound: null,
    issueDescription: "",
    photoUrl: null,
    photoName: null,
    uploading: false,
  }));
}

export default function CreditCardInspectionForm() {
  const { toast } = useToast();
  const [, navigate] = useWouterLocation();
  const { data: locations = [] } = useLocations();

  const { data: authStatus } = useQuery<{
    user: { locationIds: string[] | null } | null;
    accessibleFeatures?: string[];
  }>({ queryKey: ["/api/auth/status"] });

  const canViewList = (authStatus?.accessibleFeatures || []).includes("credit_card_inspection.view_all");

  const [locationId, setLocationId] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [terminals, setTerminals] = useState<TerminalState[]>(makeInitialTerminals());
  const fileInputsRef = useRef<Record<number, HTMLInputElement | null>>({});

  const updateTerminal = (idx: number, patch: Partial<TerminalState>) => {
    setTerminals(prev => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  };

  const uploadPhoto = async (idx: number, file: File) => {
    updateTerminal(idx, { uploading: true });
    try {
      const urlRes = await apiRequest("POST", "/api/credit-card-inspections/upload-url", {
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
      updateTerminal(idx, { photoUrl: objectPath, photoName: file.name, uploading: false });
      toast({ title: "Photo uploaded" });
    } catch (err) {
      updateTerminal(idx, { uploading: false });
      toast({ title: "Upload failed", description: "Could not upload the photo. Please try again.", variant: "destructive" });
    }
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      const locationName = locations.find(l => String(l.id) === locationId)?.name ?? null;
      const payload = {
        locationId: locationId || null,
        locationName,
        notes: notes.trim() ? notes.trim() : null,
        terminals: terminals.map(t => ({
          terminalNumber: t.terminalNumber,
          present: t.present,
          issueFound: t.present ? !!t.issueFound : false,
          issueDescription: t.present && t.issueFound ? t.issueDescription.trim() : null,
          photoUrl: t.photoUrl,
          photoName: t.photoName,
        })),
      };
      const res = await apiRequest("POST", "/api/credit-card-inspections", payload);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/credit-card-inspections"] });
      toast({ title: "Inspection submitted", description: "Thanks — your inspection was recorded." });
      if (canViewList) {
        navigate("/credit-card-inspections");
      } else {
        setTerminals(makeInitialTerminals());
        setNotes("");
      }
    },
    onError: (err: any) => {
      toast({
        title: "Unable to submit",
        description: err?.message || "Something went wrong. Please check the form and try again.",
        variant: "destructive",
      });
    },
  });

  const canSubmit = (() => {
    for (const t of terminals) {
      if (!t.present) continue;
      if (t.issueFound === null) return false;
      if (t.issueFound && t.issueDescription.trim().length === 0) return false;
    }
    // At least terminals 1 and 2 must be present (3,4,5 optional)
    if (!terminals[0].present || !terminals[1].present) return false;
    return true;
  })();

  return (
    <div className="container max-w-4xl py-8 px-4">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded bg-primary/10 flex items-center justify-center">
          <CreditCard className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold" data-testid="heading-credit-card-inspection">Credit Card Inspection</h1>
          <p className="text-sm text-muted-foreground">
            Confirm each credit card terminal is free of tampering.
          </p>
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Inspection Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger id="location" data-testid="select-location">
                  <SelectValue placeholder="Select a location" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map(l => (
                    <SelectItem key={l.id} value={String(l.id)} data-testid={`option-location-${l.id}`}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {terminals.map((t, idx) => {
          const canBeAbsent = t.terminalNumber >= 3;
          return (
            <Card key={t.terminalNumber} data-testid={`card-terminal-${t.terminalNumber}`}>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle className="text-base">Terminal {t.terminalNumber}</CardTitle>
                {canBeAbsent && (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`absent-${t.terminalNumber}`}
                      checked={!t.present}
                      onCheckedChange={(v) => updateTerminal(idx, {
                        present: !v,
                        issueFound: null,
                        issueDescription: "",
                        photoUrl: null,
                        photoName: null,
                      })}
                      data-testid={`checkbox-no-terminal-${t.terminalNumber}`}
                    />
                    <Label htmlFor={`absent-${t.terminalNumber}`} className="text-sm font-normal cursor-pointer">
                      We don't have a Terminal {t.terminalNumber}
                    </Label>
                  </div>
                )}
              </CardHeader>

              {t.present && (
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Was an issue found on this terminal?</Label>
                    <RadioGroup
                      value={t.issueFound === null ? "" : t.issueFound ? "yes" : "no"}
                      onValueChange={(v) => updateTerminal(idx, {
                        issueFound: v === "yes",
                        issueDescription: v === "yes" ? t.issueDescription : "",
                      })}
                      className="flex gap-6"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="no" id={`issue-no-${t.terminalNumber}`} data-testid={`radio-no-issue-${t.terminalNumber}`} />
                        <Label htmlFor={`issue-no-${t.terminalNumber}`} className="flex items-center gap-1.5 cursor-pointer font-normal">
                          <CheckCircle2 className="w-4 h-4 text-green-600" /> No issue
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="yes" id={`issue-yes-${t.terminalNumber}`} data-testid={`radio-issue-found-${t.terminalNumber}`} />
                        <Label htmlFor={`issue-yes-${t.terminalNumber}`} className="flex items-center gap-1.5 cursor-pointer font-normal">
                          <AlertCircle className="w-4 h-4 text-destructive" /> Issue found
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  {t.issueFound && (
                    <div className="space-y-2">
                      <Label htmlFor={`desc-${t.terminalNumber}`}>Describe the issue *</Label>
                      <Textarea
                        id={`desc-${t.terminalNumber}`}
                        placeholder="What did you find? (tampering, damage, foreign device, etc.)"
                        value={t.issueDescription}
                        onChange={(e) => updateTerminal(idx, { issueDescription: e.target.value })}
                        rows={3}
                        data-testid={`textarea-issue-description-${t.terminalNumber}`}
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Photo (optional)</Label>
                    <input
                      ref={el => (fileInputsRef.current[t.terminalNumber] = el)}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadPhoto(idx, f);
                        e.target.value = "";
                      }}
                      data-testid={`input-file-terminal-${t.terminalNumber}`}
                    />
                    {t.photoUrl ? (
                      <div className="flex items-center gap-3 p-3 border rounded bg-muted/30">
                        <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                        <span className="text-sm flex-1 truncate">{t.photoName}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => updateTerminal(idx, { photoUrl: null, photoName: null })}
                          data-testid={`button-remove-photo-${t.terminalNumber}`}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => fileInputsRef.current[t.terminalNumber]?.click()}
                        disabled={t.uploading}
                        data-testid={`button-upload-photo-${t.terminalNumber}`}
                      >
                        {t.uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                        {t.uploading ? "Uploading..." : "Upload photo"}
                      </Button>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="Any additional notes about this inspection..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            data-testid="textarea-notes"
          />
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3 mt-6">
        {canViewList && (
          <Button variant="outline" onClick={() => navigate("/credit-card-inspections")} data-testid="button-cancel">
            Cancel
          </Button>
        )}
        <Button
          onClick={() => submitMutation.mutate()}
          disabled={!canSubmit || submitMutation.isPending || terminals.some(t => t.uploading)}
          data-testid="button-submit-inspection"
        >
          {submitMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Submit Inspection
        </Button>
      </div>
    </div>
  );
}
