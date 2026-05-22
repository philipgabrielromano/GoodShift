import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Mail, Save, Lock, ExternalLink, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";

type GlobalSettings = {
  hrNotificationEmail: string | null;
  orderNotificationEmails: string | null;
  firstAidNotificationEmails: string | null;
  driverInspectionEmails: string | null;
  warehouseVarianceEmailsCleveland: string | null;
  warehouseVarianceEmailsCanton: string | null;
  [k: string]: unknown;
};

type EditableField =
  | "hrNotificationEmail"
  | "orderNotificationEmails"
  | "firstAidNotificationEmails"
  | "driverInspectionEmails"
  | "warehouseVarianceEmailsCleveland"
  | "warehouseVarianceEmailsCanton";

type Row =
  | {
      kind: "editable";
      id: string;
      title: string;
      trigger: string;
      field: EditableField;
      help?: string;
    }
  | {
      kind: "fixed";
      id: string;
      title: string;
      trigger: string;
      recipients: string;
      help?: string;
      configHref?: { label: string; href: string };
    };

const ROWS: Row[] = [
  {
    kind: "editable",
    id: "order-notify",
    title: "Order notification",
    trigger: "A new Transfer & Receive or End of Day / Equipment Count order is submitted (End of Day is now auto-approved, so this only fires for Transfer & Receive).",
    field: "orderNotificationEmails",
    help: "Comma-separated list of warehouse / dispatch recipients.",
  },
  {
    kind: "editable",
    id: "first-aid",
    title: "First Aid order",
    trigger: "A new First Aid order is submitted.",
    field: "firstAidNotificationEmails",
    help: "Comma-separated list of safety / facilities recipients.",
  },
  {
    kind: "editable",
    id: "driver-insp",
    title: "Driver inspection alert",
    trigger: "A driver pre-trip inspection is submitted with any item flagged for Repair.",
    field: "driverInspectionEmails",
    help: "Comma-separated list of fleet / maintenance recipients.",
  },
  {
    kind: "editable",
    id: "wh-var-cle",
    title: "Warehouse variance (Cleveland)",
    trigger: "A Cleveland warehouse count is finalized with variance over threshold.",
    field: "warehouseVarianceEmailsCleveland",
    help: "Comma-separated list of leadership recipients for the Cleveland CSV.",
  },
  {
    kind: "editable",
    id: "wh-var-can",
    title: "Warehouse variance (Canton)",
    trigger: "A Canton warehouse count is finalized with variance over threshold.",
    field: "warehouseVarianceEmailsCanton",
    help: "Comma-separated list of leadership recipients for the Canton CSV.",
  },
  {
    kind: "editable",
    id: "hr-notify",
    title: "HR occurrence notification",
    trigger: "A store-manager-level occurrence is added or modified, or any occurrence reaches the HR threshold.",
    field: "hrNotificationEmail",
    help: "Comma-separated HR recipients.",
  },
  {
    kind: "fixed",
    id: "order-confirm",
    title: "Order submission confirmation",
    trigger: "Any order is submitted (including auto-approved Donors / Supplemental Production / End of Day).",
    recipients: "Submitter (their account email).",
  },
  {
    kind: "fixed",
    id: "order-approved",
    title: "Order approved",
    trigger: "A warehouse approver approves a pending order.",
    recipients: "Submitter (their account email).",
  },
  {
    kind: "fixed",
    id: "order-denied",
    title: "Order denied",
    trigger: "A warehouse approver denies a pending order.",
    recipients: "Submitter (their account email).",
  },
  {
    kind: "fixed",
    id: "order-fulfilled",
    title: "Order fulfilled",
    trigger: "An order is marked received / fulfilled.",
    recipients: "Submitter + the destination store distro.",
  },
  {
    kind: "fixed",
    id: "occurrence-alert",
    title: "Occurrence alert (store manager)",
    trigger: "An occurrence is created or edited for an employee.",
    recipients: "Store manager(s) for the employee's assigned location.",
  },
  {
    kind: "fixed",
    id: "trade-notify",
    title: "Shift trade notification",
    trigger: "A shift-trade request is created, accepted, approved, or denied.",
    recipients: "The counterparty employee and the approving manager.",
  },
  {
    kind: "fixed",
    id: "schedule-publish",
    title: "Schedule publish",
    trigger: "A weekly schedule is published.",
    recipients: "Every scheduled employee with a notification email on file (per-employee opt-in).",
  },
  {
    kind: "fixed",
    id: "trailer-transit",
    title: "Trailer in-transit",
    trigger: "A trailer manifest moves into the In Transit status.",
    recipients: "The destination location's notification email + per-stop notification emails.",
    configHref: { label: "Configure on Locations", href: "/settings#locations" },
  },
];

function splitEmails(value: string | null): string[] {
  return (value || "")
    .split(",")
    .map(e => e.trim())
    .filter(Boolean);
}

function EditableRow({
  row,
  settings,
}: {
  row: Extract<Row, { kind: "editable" }>;
  settings: GlobalSettings;
}) {
  const initial = (settings[row.field] as string | null) || "";
  const [value, setValue] = useState(initial);
  const { toast } = useToast();

  useEffect(() => {
    setValue(initial);
  }, [initial]);

  const mutation = useMutation({
    mutationFn: async (next: string) => {
      // Use the freshest cached settings (not the snapshot captured at render time)
      // so that a save from another row that already refetched doesn't get clobbered.
      const latest = queryClient.getQueryData<GlobalSettings>(["/api/global-settings"]) || settings;
      const body = { ...latest, [row.field]: next.trim() || null };
      const res = await apiRequest("POST", "/api/global-settings", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/global-settings"] });
      toast({ title: "Saved", description: `${row.title} recipients updated.` });
    },
    onError: () => {
      toast({ variant: "destructive", title: "Save failed", description: "Could not update recipients." });
    },
  });

  const dirty = value.trim() !== (initial || "").trim();
  const currentList = splitEmails(initial);

  return (
    <div className="space-y-2" data-testid={`row-email-${row.id}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="font-semibold text-sm" data-testid={`text-email-title-${row.id}`}>{row.title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{row.trigger}</p>
        </div>
        <Badge variant="secondary" className="shrink-0">
          {currentList.length} recipient{currentList.length === 1 ? "" : "s"}
        </Badge>
      </div>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="email1@example.com, email2@example.com"
        rows={2}
        className="text-sm font-mono"
        data-testid={`input-email-${row.id}`}
      />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-muted-foreground">{row.help}</p>
        <Button
          size="sm"
          disabled={!dirty || mutation.isPending}
          onClick={() => mutation.mutate(value)}
          data-testid={`button-save-email-${row.id}`}
        >
          {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
          Save
        </Button>
      </div>
    </div>
  );
}

function FixedRow({ row }: { row: Extract<Row, { kind: "fixed" }> }) {
  return (
    <div className="space-y-1.5" data-testid={`row-email-${row.id}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="font-semibold text-sm" data-testid={`text-email-title-${row.id}`}>{row.title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{row.trigger}</p>
        </div>
        <Badge variant="outline" className="shrink-0 gap-1">
          <Lock className="w-3 h-3" />
          Fixed
        </Badge>
      </div>
      <div className="rounded border bg-muted/40 px-3 py-2 text-xs">
        <span className="text-muted-foreground">Recipients: </span>
        <span className="font-medium">{row.recipients}</span>
      </div>
      {row.configHref && (
        <Link href={row.configHref.href}>
          <a className="inline-flex items-center gap-1 text-xs text-primary hover:underline" data-testid={`link-config-${row.id}`}>
            {row.configHref.label}
            <ExternalLink className="w-3 h-3" />
          </a>
        </Link>
      )}
    </div>
  );
}

export default function EmailMatrix() {
  const { can } = usePermissions();
  const canConfig = can("settings.global_config");

  const { data: settings, isLoading, isError, refetch } = useQuery<GlobalSettings>({
    queryKey: ["/api/global-settings"],
    enabled: canConfig,
  });

  if (canConfig && isLoading) {
    return (
      <div className="p-3 sm:p-6 lg:p-10 max-w-[1100px] mx-auto space-y-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!canConfig) {
    return (
      <div className="p-3 sm:p-6 lg:p-10 max-w-[800px] mx-auto">
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Lock className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">You don't have access to the email configuration.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isError || !settings) {
    return (
      <div className="p-3 sm:p-6 lg:p-10 max-w-[800px] mx-auto">
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <p className="text-sm text-muted-foreground">Couldn't load global settings.</p>
            <Button size="sm" variant="outline" onClick={() => refetch()} data-testid="button-retry-settings">
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const editable = ROWS.filter(r => r.kind === "editable") as Extract<Row, { kind: "editable" }>[];
  const fixed = ROWS.filter(r => r.kind === "fixed") as Extract<Row, { kind: "fixed" }>[];

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-[1100px] mx-auto space-y-6">
      <div>
        <h1 className="text-xl sm:text-3xl font-bold font-display flex items-center gap-2 sm:gap-3" data-testid="text-page-title">
          <Mail className="w-5 h-5 sm:w-8 sm:h-8 text-primary" />
          Email Configuration
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          Every email GoodShift sends, what triggers it, and who gets it. Edit the list-based recipients inline. Fixed rows are sent to roles the app determines automatically (submitter, store manager, scheduled employees, etc.) and aren't editable here.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base sm:text-lg">Editable recipient lists</CardTitle>
          <CardDescription>
            Comma-separated email addresses. Saving updates the global setting immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {editable.map((row, i) => (
            <div key={row.id} className={i === 0 ? "pb-5" : "py-5 last:pb-0"}>
              <EditableRow row={row} settings={settings} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base sm:text-lg">Automatic recipients</CardTitle>
          <CardDescription>
            These emails resolve their recipients from app data (submitter, employee record, manager hierarchy, scheduled shifts, route stops). Change the underlying records to change who gets the email.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {fixed.map((row, i) => (
            <div key={row.id} className={i === 0 ? "pb-5" : "py-5 last:pb-0"}>
              <FixedRow row={row} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
