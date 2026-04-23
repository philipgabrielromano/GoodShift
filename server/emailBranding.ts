import type { EmailBrandingConfig, EmailTypeId, GlobalSettings } from "@shared/schema";

export const GOODWILL_BRAND_PALETTE = [
  { id: "blue",       name: "Goodwill Blue", hex: "#00539F" },
  { id: "light-blue", name: "Light Blue",    hex: "#4F87C6" },
  { id: "sky",        name: "Sky Blue",      hex: "#7CC1E8" },
  { id: "orange",     name: "Orange",        hex: "#E9992F" },
  { id: "yellow",     name: "Yellow",        hex: "#FFD600" },
  { id: "lime",       name: "Lime Green",    hex: "#B2D235" },
  { id: "green",      name: "Green",         hex: "#4FBC86" },
  { id: "magenta",    name: "Magenta",       hex: "#A95678" },
  { id: "red",        name: "Red",           hex: "#DF4E51" },
  { id: "grey",       name: "Grey",          hex: "#52585A" },
] as const;

export interface EmailTypeMeta {
  id: EmailTypeId;
  label: string;
  description: string;
  defaultHeaderColor: string;
}

export const EMAIL_TYPES: EmailTypeMeta[] = [
  { id: "occurrence_alert",    label: "Attendance Alert",          description: "Sent to HR when an employee reaches a points threshold (5/7/8). Severity overrides this header color.", defaultHeaderColor: "#DF4E51" },
  { id: "order_submitted",     label: "Order Submitted",           description: "Sent to warehouse recipients when a store submits an order.",      defaultHeaderColor: "#00539F" },
  { id: "order_confirmation",  label: "Order Confirmation",        description: "Receipt sent to the submitter after their order is recorded.",    defaultHeaderColor: "#4FBC86" },
  { id: "order_fulfilled",     label: "Order Fulfilled",           description: "Sent to the requesting store when warehouse marks an order fulfilled.", defaultHeaderColor: "#4FBC86" },
  { id: "shift_trade",         label: "Shift Trade",               description: "Sent at each step of a shift trade. The action color overrides this header.", defaultHeaderColor: "#7CC1E8" },
  { id: "schedule_published",  label: "Schedule Published",        description: "Sent to employees when a new schedule is posted.",                defaultHeaderColor: "#00539F" },
  { id: "trailer_in_transit",  label: "Trailer In Transit",        description: "Sent to destination stores when a trailer manifest departs.",     defaultHeaderColor: "#E9992F" },
  { id: "driver_inspection",   label: "Driver Inspection Alert",   description: "Sent to maintenance when a driver flags repair items.",            defaultHeaderColor: "#DF4E51" },
  { id: "warehouse_variance",  label: "Warehouse Variance CSV",    description: "Sent to ops/audit with the variance CSV from a warehouse count.", defaultHeaderColor: "#00539F" },
];

const DEFAULT_HEADER_COLORS: Record<EmailTypeId, string> = EMAIL_TYPES.reduce((acc, t) => {
  acc[t.id] = t.defaultHeaderColor;
  return acc;
}, {} as Record<EmailTypeId, string>);

export const DEFAULT_EMAIL_BRANDING = {
  fontFamily: "Lato, 'Helvetica Neue', Arial, sans-serif",
  dynamicValueColor: "#00539F",
  dynamicValueWeight: "bold" as "normal" | "bold",
  dynamicValueItalic: false,
  headerColors: DEFAULT_HEADER_COLORS,
};

export interface ResolvedBranding {
  fontFamily: string;
  dynamicValueColor: string;
  dynamicValueWeight: "normal" | "bold";
  dynamicValueItalic: boolean;
  headerColors: Record<EmailTypeId, string>;
}

export function resolveBranding(override?: EmailBrandingConfig | null): ResolvedBranding {
  const headerColors = { ...DEFAULT_HEADER_COLORS };
  if (override?.headerColors) {
    for (const t of EMAIL_TYPES) {
      const v = override.headerColors[t.id];
      if (v) headerColors[t.id] = v;
    }
  }
  return {
    fontFamily: override?.fontFamily || DEFAULT_EMAIL_BRANDING.fontFamily,
    dynamicValueColor: override?.dynamicValueColor || DEFAULT_EMAIL_BRANDING.dynamicValueColor,
    dynamicValueWeight: override?.dynamicValueWeight ?? DEFAULT_EMAIL_BRANDING.dynamicValueWeight,
    dynamicValueItalic: override?.dynamicValueItalic ?? DEFAULT_EMAIL_BRANDING.dynamicValueItalic,
    headerColors,
  };
}

export function brandingFromSettings(settings: Pick<GlobalSettings, "emailBranding"> | null | undefined): ResolvedBranding {
  return resolveBranding(settings?.emailBranding ?? null);
}

/**
 * Escape user-originating text so it can be safely interpolated into HTML
 * email bodies. Templates rely on this through `dv()` and `htmlEscape()`.
 */
export function htmlEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Wrap a dynamic value (employee name, location, totals, etc.) in a span styled
 * with the configured dynamic-value color, weight, and italics. Use sparingly —
 * only on the actual variable content, not on labels. The value is HTML-escaped.
 */
export function dv(value: string | number | null | undefined, branding: ResolvedBranding): string {
  const weight = branding.dynamicValueWeight === "bold" ? "700" : "400";
  const style = branding.dynamicValueItalic ? "italic" : "normal";
  return `<span style="color:${branding.dynamicValueColor};font-weight:${weight};font-style:${style};">${htmlEscape(value)}</span>`;
}

export interface RenderLayoutArgs {
  type: EmailTypeId;
  title: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaHref?: string;
  branding: ResolvedBranding;
  /** Optional override for header color (e.g. occurrence_alert varies by threshold). */
  headerColorOverride?: string;
  /** Override the standard footer text. */
  footerText?: string;
  maxWidthPx?: number;
}

export function renderEmailLayout(args: RenderLayoutArgs): string {
  const headerColor = args.headerColorOverride || args.branding.headerColors[args.type];
  const ctaColor = args.headerColorOverride || args.branding.headerColors[args.type];
  const safeTitle = htmlEscape(args.title);
  const safeFooter = htmlEscape(args.footerText ?? "This is an automated notification from GoodShift. Please do not reply to this email.");
  const cta = args.ctaLabel && args.ctaHref
    ? `<p style="margin: 24px 0 0;">
        <a href="${htmlEscape(args.ctaHref)}" style="display:inline-block;background-color:${ctaColor};color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:4px;font-weight:bold;font-family:${args.branding.fontFamily};">${htmlEscape(args.ctaLabel)}</a>
      </p>`
    : "";
  const maxWidth = args.maxWidthPx ?? 640;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <link href="https://fonts.googleapis.com/css2?family=Lato:wght@400;700&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:${args.branding.fontFamily};line-height:1.6;color:#333;">
  <div style="max-width:${maxWidth}px;margin:0 auto;padding:20px;font-family:${args.branding.fontFamily};">
    <div style="background-color:${headerColor};color:#ffffff;padding:16px 20px;border-radius:4px 4px 0 0;">
      <h2 style="margin:0;font-family:${args.branding.fontFamily};font-weight:700;">${safeTitle}</h2>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;padding:20px;background-color:#ffffff;border-radius:0 0 4px 4px;">
      ${args.bodyHtml}
      ${cta}
      <p style="color:#6b7280;font-size:12px;margin-top:30px;font-family:${args.branding.fontFamily};">${safeFooter}</p>
    </div>
  </div>
</body>
</html>`;
}
