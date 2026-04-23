import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Palette, Save, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useGlobalSettings, useUpdateGlobalSettings } from "@/hooks/use-settings";

type Swatch = { id: string; name: string; hex: string };
type EmailType = { id: string; label: string; description: string; defaultHeaderColor: string };
type EmailBrandingDefaults = {
  fontFamily: string;
  dynamicValueColor: string;
  dynamicValueWeight: "normal" | "bold";
  dynamicValueItalic: boolean;
  headerColors: Record<string, string>;
};

type Options = { palette: Swatch[]; types: EmailType[]; defaults: EmailBrandingDefaults };

type BrandingState = EmailBrandingDefaults;

const FONTS = [
  { value: "Lato, Arial, sans-serif", label: "Lato" },
  { value: "Arial, Helvetica, sans-serif", label: "Arial" },
  { value: "Helvetica, Arial, sans-serif", label: "Helvetica" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "Times New Roman, Times, serif", label: "Times New Roman" },
  { value: "Verdana, Geneva, sans-serif", label: "Verdana" },
  { value: "Tahoma, Geneva, sans-serif", label: "Tahoma" },
  { value: "Trebuchet MS, sans-serif", label: "Trebuchet MS" },
];

function ColorSwatchPicker({
  palette,
  value,
  onChange,
  testIdPrefix,
}: {
  palette: Swatch[];
  value: string;
  onChange: (hex: string) => void;
  testIdPrefix: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {palette.map((sw) => {
        const selected = sw.hex.toLowerCase() === value.toLowerCase();
        return (
          <button
            key={sw.id}
            type="button"
            title={`${sw.name} (${sw.hex})`}
            onClick={() => onChange(sw.hex)}
            data-testid={`${testIdPrefix}-${sw.id}`}
            className={`relative w-9 h-9 rounded-md border-2 transition-all hover-elevate active-elevate-2 ${
              selected ? "border-foreground ring-2 ring-offset-1 ring-foreground" : "border-border"
            }`}
            style={{ backgroundColor: sw.hex }}
            aria-label={`Select ${sw.name}`}
            aria-pressed={selected}
          />
        );
      })}
    </div>
  );
}

export function EmailBrandingCard() {
  const { toast } = useToast();
  const { data: settings } = useGlobalSettings();
  const updateSettings = useUpdateGlobalSettings();

  const { data: options } = useQuery<Options>({
    queryKey: ["/api/email-branding/options"],
  });

  const [state, setState] = useState<BrandingState | null>(null);
  const [activeType, setActiveType] = useState<string>("occurrence_alert");

  // Hydrate from server settings + defaults whenever they load.
  useEffect(() => {
    if (!options) return;
    const saved = (settings as any)?.emailBranding as Partial<BrandingState> | null | undefined;
    const merged: BrandingState = {
      fontFamily: saved?.fontFamily || options.defaults.fontFamily,
      dynamicValueColor: saved?.dynamicValueColor || options.defaults.dynamicValueColor,
      dynamicValueWeight: (saved?.dynamicValueWeight as any) || options.defaults.dynamicValueWeight,
      dynamicValueItalic: saved?.dynamicValueItalic ?? options.defaults.dynamicValueItalic,
      headerColors: { ...options.defaults.headerColors, ...(saved?.headerColors || {}) },
    };
    setState(merged);
  }, [settings, options]);

  // Live preview HTML
  const brandingJson = useMemo(() => (state ? JSON.stringify(state) : ""), [state]);
  const { data: previewData, isFetching: previewLoading } = useQuery<{ html: string }>({
    queryKey: ["/api/outlook/email-preview", activeType, brandingJson],
    queryFn: async () => {
      const url = `/api/outlook/email-preview/${activeType}?branding=${encodeURIComponent(brandingJson)}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Preview failed");
      return res.json();
    },
    enabled: !!state && !!options,
  });

  if (!options || !state) {
    return (
      <Card data-testid="card-email-branding-loading">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="w-5 h-5" />
            Email Branding
          </CardTitle>
          <CardDescription>Loading branding options...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const activeTypeMeta = options.types.find((t) => t.id === activeType)!;
  const activeHeader = state.headerColors[activeType] || activeTypeMeta.defaultHeaderColor;

  const setHeaderColor = (hex: string) => {
    setState({
      ...state,
      headerColors: { ...state.headerColors, [activeType]: hex },
    });
  };

  const handleSave = () => {
    updateSettings.mutate(
      { ...(settings as any), emailBranding: state },
      {
        onSuccess: () => toast({ title: "Email branding saved" }),
        onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
      }
    );
  };

  const handleResetType = () => {
    setState({
      ...state,
      headerColors: { ...state.headerColors, [activeType]: activeTypeMeta.defaultHeaderColor },
    });
  };

  const handleResetAll = () => {
    setState({
      fontFamily: options.defaults.fontFamily,
      dynamicValueColor: options.defaults.dynamicValueColor,
      dynamicValueWeight: options.defaults.dynamicValueWeight,
      dynamicValueItalic: options.defaults.dynamicValueItalic,
      headerColors: { ...options.defaults.headerColors },
    });
  };

  return (
    <Card data-testid="card-email-branding">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Palette className="w-5 h-5" />
              Email Branding
            </CardTitle>
            <CardDescription>
              Customize colors and typography for the 9 emails GoodShift sends. Changes apply on save.
            </CardDescription>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={handleResetAll} data-testid="button-reset-all-branding">
              <RotateCcw className="w-4 h-4 mr-1" /> Reset all
            </Button>
            <Button size="sm" onClick={handleSave} disabled={updateSettings.isPending} data-testid="button-save-email-branding">
              <Save className="w-4 h-4 mr-1" /> {updateSettings.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Global settings */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label>Font</Label>
            <Select
              value={state.fontFamily}
              onValueChange={(v) => setState({ ...state, fontFamily: v })}
            >
              <SelectTrigger data-testid="select-email-font"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FONTS.map((f) => (
                  <SelectItem key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Used throughout every email body.</p>
          </div>

          <div className="space-y-2">
            <Label>Dynamic value color</Label>
            <ColorSwatchPicker
              palette={options.palette}
              value={state.dynamicValueColor}
              onChange={(hex) => setState({ ...state, dynamicValueColor: hex })}
              testIdPrefix="swatch-dynamic"
            />
            <p className="text-xs text-muted-foreground">
              Applied to data values inside each email (names, dates, counts, locations, etc.).
            </p>
          </div>

          <div className="flex items-center justify-between rounded-md border px-4 py-3">
            <div>
              <Label className="text-sm">Bold dynamic values</Label>
              <p className="text-xs text-muted-foreground">Render dynamic data values in bold weight.</p>
            </div>
            <Switch
              checked={state.dynamicValueWeight === "bold"}
              onCheckedChange={(c) => setState({ ...state, dynamicValueWeight: c ? "bold" : "normal" })}
              data-testid="switch-dynamic-bold"
            />
          </div>

          <div className="flex items-center justify-between rounded-md border px-4 py-3">
            <div>
              <Label className="text-sm">Italic dynamic values</Label>
              <p className="text-xs text-muted-foreground">Render dynamic data values in italics.</p>
            </div>
            <Switch
              checked={state.dynamicValueItalic}
              onCheckedChange={(c) => setState({ ...state, dynamicValueItalic: c })}
              data-testid="switch-dynamic-italic"
            />
          </div>
        </div>

        <Separator />

        {/* Per-type controls */}
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 md:items-end">
            <div className="space-y-2">
              <Label>Email template</Label>
              <Select value={activeType} onValueChange={setActiveType}>
                <SelectTrigger data-testid="select-email-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {options.types.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{activeTypeMeta.description}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={handleResetType} data-testid="button-reset-type">
              <RotateCcw className="w-4 h-4 mr-1" /> Reset to default
            </Button>
          </div>

          <div className="space-y-2">
            <Label>Header color</Label>
            <ColorSwatchPicker
              palette={options.palette}
              value={activeHeader}
              onChange={setHeaderColor}
              testIdPrefix={`swatch-header-${activeType}`}
            />
            <p className="text-xs text-muted-foreground">
              Note: the Attendance Alert and Shift Trade emails override this header color based on severity / action type.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Live preview</Label>
            <div className="border rounded-md overflow-hidden bg-muted/30" style={{ minHeight: 480 }}>
              {previewLoading && !previewData ? (
                <div className="p-8 text-sm text-muted-foreground">Rendering preview...</div>
              ) : (
                <iframe
                  title="Email preview"
                  srcDoc={previewData?.html || ""}
                  className="w-full"
                  style={{ height: 600, border: "none", backgroundColor: "white" }}
                  data-testid={`iframe-email-preview-${activeType}`}
                />
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
