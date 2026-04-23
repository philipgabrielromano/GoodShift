import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { RefreshCw, CheckCircle2, XCircle, Building2, LogIn, LogOut, Shield, Mail, Send, Save, Bell, Activity, Database, Clock, Wifi, WifiOff, ChevronDown, ChevronUp, Eye, User, Info, Truck } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TrailersManager } from "@/components/fleet/TrailersManager";
import { TractorsManager } from "@/components/fleet/TractorsManager";
import { TruckRoutesManager } from "@/components/fleet/TruckRoutesManager";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useGlobalSettings, useUpdateGlobalSettings } from "@/hooks/use-settings";
import type { Employee } from "@shared/schema";
import { Link } from "wouter";
import { APP_VERSION, changelog } from "@/lib/changelog";
import { EmailBrandingCard } from "@/components/settings/EmailBrandingCard";

interface DiagnosticApiCall {
  timestamp: string;
  method: string;
  url: string;
  status: number;
  durationMs: number;
  error?: string;
  responseSize?: number;
}

interface SyncResult {
  timestamp: string;
  type: string;
  success: boolean;
  error?: string;
  durationMs: number;
  employeesFetched?: number;
  employeesProcessed?: number;
  timeRecordsFetched?: number;
  timeRecordsProcessed?: number;
}

interface EmailLogEntry {
  id: number;
  type: string;
  recipientEmail: string;
  subject: string;
  status: string;
  error: string | null;
  employeeName: string | null;
  relatedId: number | null;
  sentAt: string;
}

interface UKGDiagnostics {
  configured: boolean;
  apiUrl: string | null;
  username: string | null;
  lastError: string | null;
  lastSuccessfulSync: string | null;
  lastFailedSync: string | null;
  recentApiCalls: DiagnosticApiCall[];
  syncHistory: SyncResult[];
  database: {
    employeeCount: number;
    timeClockEntryCount: number;
  };
}

export default function Settings() {
  const { toast } = useToast();
  const { data: settings } = useGlobalSettings();
  const updateSettings = useUpdateGlobalSettings();
  
  const [selectedStore, setSelectedStore] = useState<string>("");
  const [hrEmail, setHrEmail] = useState<string>("");
  const [orderEmails, setOrderEmails] = useState<string>("");
  const [driverInspectionEmails, setDriverInspectionEmails] = useState<string>("");
  const [warehouseVarianceEmailsCleveland, setWarehouseVarianceEmailsCleveland] = useState<string>("");
  const [warehouseVarianceEmailsCanton, setWarehouseVarianceEmailsCanton] = useState<string>("");
  const [loginTagline, setLoginTagline] = useState<string>("");
  const [altEmail, setAltEmail] = useState("");
  const [altEmailSaving, setAltEmailSaving] = useState(false);
  const [altEmailInitialized, setAltEmailInitialized] = useState(false);
  
  useEffect(() => {
    if (settings?.hrNotificationEmail) {
      setHrEmail(settings.hrNotificationEmail);
    }
  }, [settings?.hrNotificationEmail]);

  useEffect(() => {
    if (settings?.orderNotificationEmails) {
      setOrderEmails(settings.orderNotificationEmails);
    }
  }, [settings?.orderNotificationEmails]);

  useEffect(() => {
    if (settings?.driverInspectionEmails) {
      setDriverInspectionEmails(settings.driverInspectionEmails);
    }
  }, [settings?.driverInspectionEmails]);

  useEffect(() => {
    if (settings?.warehouseVarianceEmailsCleveland) {
      setWarehouseVarianceEmailsCleveland(settings.warehouseVarianceEmailsCleveland);
    }
  }, [settings?.warehouseVarianceEmailsCleveland]);

  useEffect(() => {
    if (settings?.warehouseVarianceEmailsCanton) {
      setWarehouseVarianceEmailsCanton(settings.warehouseVarianceEmailsCanton);
    }
  }, [settings?.warehouseVarianceEmailsCanton]);

  useEffect(() => {
    if (settings?.loginTagline !== undefined && settings?.loginTagline !== null) {
      setLoginTagline(settings.loginTagline);
    }
  }, [settings?.loginTagline]);

  const { data: authStatus } = useQuery<{ isAuthenticated: boolean; user: { id: string; name: string; email: string; role: string } | null; ssoConfigured: boolean }>({
    queryKey: ["/api/auth/status"],
  });

  const { data: myEmployeeData } = useQuery<{ employee: Employee | null }>({
    queryKey: ["/api/my-employee"],
  });

  const currentEmployee = myEmployeeData?.employee || null;
  const userRole = authStatus?.user?.role ?? "viewer";
  const features = authStatus?.accessibleFeatures || [];
  const can = (f: string) => features.includes(f);
  const canGlobalConfig = can("settings.global_config");
  const canUkgConfig = can("settings.ukg_config");
  const canUkgSync = can("settings.ukg_sync");
  const canEmailAudit = can("settings.email_audit");
  const isAdmin = userRole === "admin";
  const showAdminArea = canGlobalConfig || canUkgConfig || canUkgSync || canEmailAudit;

  useEffect(() => {
    if (currentEmployee && !altEmailInitialized) {
      setAltEmail(currentEmployee.alternateEmail || "");
      setAltEmailInitialized(true);
    }
  }, [currentEmployee, altEmailInitialized]);

  const handleSaveAltEmail = async () => {
    setAltEmailSaving(true);
    try {
      await apiRequest("PATCH", "/api/my-employee/alternate-email", { alternateEmail: altEmail });
      toast({ title: "Saved", description: "Alternate notification email updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-employee"] });
    } catch (error: any) {
      toast({ title: "Error", description: error?.message || "Failed to save email", variant: "destructive" });
    } finally {
      setAltEmailSaving(false);
    }
  };

  const { data: ukgStatus } = useQuery<{ configured: boolean; connected: boolean }>({
    queryKey: ["/api/ukg/status"],
  });

  const logout = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/status"] });
      toast({ title: "Logged Out" });
    },
  });

  const { data: ukgStores } = useQuery<{ id: string; name: string; code: string }[]>({
    queryKey: ["/api/ukg/stores"],
    enabled: ukgStatus?.configured,
  });

  const [ukgApiError, setUkgApiError] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showEmailLogs, setShowEmailLogs] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);
  const [ukgApiUrl, setUkgApiUrl] = useState("");
  const [ukgUsername, setUkgUsername] = useState("");
  const [ukgPassword, setUkgPassword] = useState("");

  const { data: ukgCredentials } = useQuery<{ ukgApiUrl: string; ukgUsername: string; hasPassword: boolean }>({
    queryKey: ["/api/ukg/credentials"],
    enabled: canUkgConfig,
  });

  useEffect(() => {
    if (ukgCredentials) {
      setUkgApiUrl(ukgCredentials.ukgApiUrl);
      setUkgUsername(ukgCredentials.ukgUsername);
    }
  }, [ukgCredentials]);

  const saveCredentials = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ukg/credentials", { ukgApiUrl, ukgUsername, ukgPassword });
      return res.json();
    },
    onSuccess: (data: { success: boolean; message: string }) => {
      toast({ title: "Credentials Saved", description: data.message });
      setUkgPassword("");
      queryClient.invalidateQueries({ queryKey: ["/api/ukg/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ukg/credentials"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ukg/stores"] });
    },
    onError: () => {
      toast({ variant: "destructive", title: "Save Failed", description: "Could not save UKG credentials" });
    },
  });

  const { data: ukgDiagnostics, refetch: refetchDiagnostics } = useQuery<UKGDiagnostics>({
    queryKey: ["/api/ukg/diagnostics"],
    enabled: canUkgSync && showDiagnostics,
    refetchInterval: showDiagnostics ? 30000 : false,
  });

  const { data: emailLogs, refetch: refetchEmailLogs } = useQuery<EmailLogEntry[]>({
    queryKey: ["/api/email-logs"],
    enabled: canEmailAudit && showEmailLogs,
  });

  const testConnection = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ukg/test-connection", {});
      return res.json();
    },
    onSuccess: (data: { success: boolean; message: string; employeeCount?: number; durationMs?: number }) => {
      refetchDiagnostics();
      if (data.success) {
        toast({ title: "Connection Test Passed", description: data.message });
      } else {
        toast({ variant: "destructive", title: "Connection Test Failed", description: data.message });
      }
    },
    onError: () => {
      toast({ variant: "destructive", title: "Test Failed", description: "Could not test UKG connection" });
    },
  });

  const syncUkg = useMutation({
    mutationFn: async (storeId?: string) => {
      const res = await apiRequest("POST", "/api/ukg/sync", { storeId });
      return res.json();
    },
    onSuccess: (data: { imported: number; updated: number; errors: number; apiError?: string | null }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      if (data.apiError) {
        setUkgApiError(data.apiError);
        toast({ 
          variant: "destructive",
          title: "UKG API Error", 
          description: "See error details below" 
        });
      } else {
        setUkgApiError(null);
        toast({ 
          title: "UKG Sync Complete", 
          description: `Imported: ${data.imported}, Updated: ${data.updated}, Errors: ${data.errors}` 
        });
      }
    },
    onError: () => {
      toast({ variant: "destructive", title: "Sync Failed", description: "Could not sync with UKG" });
    },
  });

  const testOutlook = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/outlook/test");
      return res.json();
    },
    onSuccess: (data: { success: boolean; message: string }) => {
      if (data.success) {
        toast({ title: "Connection Successful", description: data.message });
      } else {
        toast({ variant: "destructive", title: "Connection Failed", description: data.message });
      }
    },
    onError: () => {
      toast({ variant: "destructive", title: "Test Failed", description: "Could not test Outlook connection" });
    },
  });

  const sendTestEmail = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/outlook/test-email", {});
      return res.json();
    },
    onSuccess: (data: { success: boolean; message: string }) => {
      if (data.success) {
        toast({ title: "Test Email Sent", description: data.message });
      } else {
        toast({ variant: "destructive", title: "Email Failed", description: data.message });
      }
    },
    onError: () => {
      toast({ variant: "destructive", title: "Email Failed", description: "Could not send test email" });
    },
  });

  const saveHrEmail = () => {
    if (settings) {
      updateSettings.mutate(
        { ...settings, hrNotificationEmail: hrEmail || null },
        {
          onSuccess: () => {
            toast({ title: "Settings Saved", description: "HR notification email updated" });
          },
          onError: () => {
            toast({ variant: "destructive", title: "Save Failed", description: "Could not save settings" });
          }
        }
      );
    }
  };

  const saveOrderEmails = () => {
    if (settings) {
      updateSettings.mutate(
        { ...settings, orderNotificationEmails: orderEmails || null },
        {
          onSuccess: () => {
            toast({ title: "Settings Saved", description: "Order notification emails updated" });
          },
          onError: () => {
            toast({ variant: "destructive", title: "Save Failed", description: "Could not save settings" });
          }
        }
      );
    }
  };

  const saveLoginTagline = () => {
    if (settings) {
      updateSettings.mutate(
        { ...settings, loginTagline: loginTagline.trim() || null },
        {
          onSuccess: () => {
            toast({ title: "Settings Saved", description: "Login tagline updated" });
          },
          onError: () => {
            toast({ variant: "destructive", title: "Save Failed", description: "Could not save settings" });
          }
        }
      );
    }
  };

  const saveWarehouseVarianceEmails = () => {
    if (settings) {
      updateSettings.mutate(
        {
          ...settings,
          warehouseVarianceEmailsCleveland: warehouseVarianceEmailsCleveland || null,
          warehouseVarianceEmailsCanton: warehouseVarianceEmailsCanton || null,
        },
        {
          onSuccess: () => {
            toast({ title: "Settings Saved", description: "Warehouse variance email recipients updated" });
          },
          onError: () => {
            toast({ variant: "destructive", title: "Save Failed", description: "Could not save settings" });
          }
        }
      );
    }
  };

  type SectionId = "preferences" | "email" | "ukg" | "fleet" | "about";
  const SECTION_IDS = ["preferences", "email", "ukg", "fleet", "about"] as const;
  const [activeSection, setActiveSection] = useState<SectionId>(() => {
    if (typeof window === "undefined") return "preferences";
    const h = window.location.hash.replace("#", "") as SectionId;
    return SECTION_IDS.includes(h as any) ? h : "preferences";
  });

  useEffect(() => {
    const handler = () => {
      const h = window.location.hash.replace("#", "") as SectionId;
      if (SECTION_IDS.includes(h as any)) {
        setActiveSection(h);
      }
    };
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  const goToSection = (id: SectionId) => {
    setActiveSection(id);
    if (typeof window !== "undefined" && window.location.hash !== `#${id}`) {
      window.history.replaceState(null, "", `#${id}`);
    }
  };

  const saveDriverInspectionEmails = () => {
    if (settings) {
      updateSettings.mutate(
        { ...settings, driverInspectionEmails: driverInspectionEmails || null },
        {
          onSuccess: () => {
            toast({ title: "Settings Saved", description: "Driver inspection alert emails updated" });
          },
          onError: () => {
            toast({ variant: "destructive", title: "Save Failed", description: "Could not save settings" });
          }
        }
      );
    }
  };

  const showEmailSection = canGlobalConfig || canEmailAudit;
  const showUkgSection = canUkgConfig || canUkgSync;
  const canViewTrailers = can("trailers.view");
  const canViewTractors = can("tractors.view");
  const canViewRoutes = can("truck_routes.view");
  const showFleetSection = canViewTrailers || canViewTractors || canViewRoutes;

  const sections: { id: SectionId; label: string; icon: typeof User; visible: boolean; description: string }[] = [
    { id: "preferences", label: "My Preferences", icon: User, visible: true, description: "Your personal notification settings and account info." },
    { id: "email", label: "Email & Notifications", icon: Mail, visible: showEmailSection, description: "Recipient lists, email templates, and the activity log." },
    { id: "ukg", label: "UKG Integration", icon: Building2, visible: showUkgSection, description: "Connect, sync, and diagnose the UKG employee data feed." },
    { id: "fleet", label: "Fleet & Routes", icon: Truck, visible: showFleetSection, description: "Trailers, tractors / box trucks, and delivery routes used by manifests and inspections." },
    { id: "about", label: "About", icon: Info, visible: true, description: "Version and release information." },
  ];
  const visibleSections = sections.filter(s => s.visible);

  // If the current section isn't visible to this user, fall back to the first visible one
  useEffect(() => {
    if (!visibleSections.find(s => s.id === activeSection) && visibleSections[0]) {
      goToSection(visibleSections[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, showEmailSection, showUkgSection]);

  const currentSection = visibleSections.find(s => s.id === activeSection) ?? visibleSections[0];

  return (
    <div className="p-6 lg:p-10 max-w-[1200px] mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold font-display">Settings</h1>
        <p className="text-muted-foreground mt-1">
          {isAdmin ? "Configure global constraints and requirements." : "Manage your notification preferences."}
        </p>
      </div>

      {/* Mobile section picker */}
      <div className="lg:hidden mb-4">
        <Select value={activeSection} onValueChange={(v) => goToSection(v as SectionId)}>
          <SelectTrigger data-testid="select-settings-section-mobile">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {visibleSections.map(s => (
              <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6 items-start">
        {/* Left rail */}
        <nav
          className="hidden lg:flex flex-col gap-1 sticky top-6"
          aria-label="Settings sections"
          data-testid="nav-settings-sections"
        >
          {visibleSections.map(s => {
            const Icon = s.icon;
            const isActive = s.id === activeSection;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => goToSection(s.id)}
                className={`flex items-center gap-2 text-sm text-left px-3 py-2 rounded-md transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "hover-elevate active-elevate-2"
                }`}
                data-testid={`button-settings-section-${s.id}`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="font-medium">{s.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Right pane */}
        <div className="space-y-8 min-w-0">
          {currentSection && (
            <div>
              <h2 className="text-xl font-semibold flex items-center gap-2" data-testid="text-section-title">
                <currentSection.icon className="w-5 h-5" />
                {currentSection.label}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">{currentSection.description}</p>
            </div>
          )}

          {activeSection === "preferences" && <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5" />
            Notification Preferences
          </CardTitle>
          <CardDescription>
            Choose where you receive notifications from GoodShift.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {currentEmployee ? (
            <div className="space-y-4">
              <div className="p-3 bg-muted/30 rounded border space-y-1">
                <p className="text-sm font-medium">Sign-in email</p>
                <p className="text-sm text-muted-foreground">{authStatus?.user?.email}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="alt-email">Alternate notification email</Label>
                <div className="flex gap-2">
                  <Input
                    id="alt-email"
                    type="email"
                    placeholder="Enter an additional email address"
                    value={altEmail}
                    onChange={e => setAltEmail(e.target.value)}
                    className="flex-1"
                    data-testid="input-alternate-email"
                  />
                  <Button
                    onClick={handleSaveAltEmail}
                    disabled={altEmailSaving}
                    data-testid="button-save-alternate-email"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {altEmailSaving ? "Saving..." : "Save"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Notifications (schedule updates, shift trades, etc.) will be sent to both your sign-in email and this alternate email.
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Your sign-in email ({authStatus?.user?.email}) is not linked to an employee record yet. Once your account is linked, you'll be able to set an alternate notification email here.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Microsoft 365 SSO
          </CardTitle>
          <CardDescription>Single sign-on with Microsoft 365 for your organization.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">Status:</span>
            {authStatus?.ssoConfigured ? (
              authStatus.isAuthenticated ? (
                <Badge variant="outline" className="text-green-600 border-green-600">
                  <CheckCircle2 className="w-3 h-3 mr-1" /> Signed In
                </Badge>
              ) : (
                <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                  <XCircle className="w-3 h-3 mr-1" /> Not Signed In
                </Badge>
              )
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                <XCircle className="w-3 h-3 mr-1" /> Not Configured
              </Badge>
            )}
          </div>

          {authStatus?.ssoConfigured && authStatus.isAuthenticated && authStatus.user && (
            <div className="p-3 bg-muted/30 rounded border space-y-1">
              <p className="font-medium">{authStatus.user.name}</p>
              <p className="text-sm text-muted-foreground">{authStatus.user.email}</p>
            </div>
          )}

          {authStatus?.ssoConfigured && (
            <div className="flex gap-2">
              {authStatus.isAuthenticated ? (
                <Button variant="outline" onClick={() => logout.mutate()} disabled={logout.isPending} data-testid="button-logout">
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </Button>
              ) : (
                <Button onClick={() => window.location.href = "/api/auth/login"} data-testid="button-login">
                  <LogIn className="w-4 h-4 mr-2" />
                  Sign In with Microsoft
                </Button>
              )}
            </div>
          )}

          {!authStatus?.ssoConfigured && (
            <p className="text-sm text-muted-foreground">
              To enable Microsoft 365 SSO, configure AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, and AZURE_TENANT_ID in your environment variables.
            </p>
          )}
        </CardContent>
      </Card>

          </>}

          {activeSection === "ukg" && <>
      {(canUkgConfig || canUkgSync) && <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            UKG Integration
          </CardTitle>
          <CardDescription>Import employee data from UKG Workforce Management.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">Status:</span>
            {ukgStatus?.configured ? (
              ukgStatus.connected ? (
                <Badge variant="outline" className="text-green-600 border-green-600">
                  <CheckCircle2 className="w-3 h-3 mr-1" /> Connected
                </Badge>
              ) : (
                <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                  <XCircle className="w-3 h-3 mr-1" /> Configured but Not Connected
                </Badge>
              )
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                <XCircle className="w-3 h-3 mr-1" /> Not Configured
              </Badge>
            )}
          </div>

          {ukgStatus?.configured && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Select Store</Label>
                <Select value={selectedStore} onValueChange={setSelectedStore}>
                  <SelectTrigger data-testid="select-ukg-store">
                    <SelectValue placeholder="All stores" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Stores</SelectItem>
                    {ukgStores?.map(store => (
                      <SelectItem key={store.id} value={store.id}>
                        {store.name} ({store.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button 
                onClick={() => syncUkg.mutate(selectedStore === "all" ? undefined : selectedStore)} 
                disabled={syncUkg.isPending}
                data-testid="button-sync-ukg"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${syncUkg.isPending ? "animate-spin" : ""}`} />
                {syncUkg.isPending ? "Syncing..." : "Sync Employees from UKG"}
              </Button>

              {ukgApiError && (
                <div className="p-3 bg-destructive/10 border border-destructive/30 rounded">
                  <p className="text-sm font-medium text-destructive">UKG API Error:</p>
                  <p className="text-xs text-destructive/80 mt-1 font-mono break-all">{ukgApiError}</p>
                </div>
              )}
            </div>
          )}

          {!ukgStatus?.configured && !isAdmin && (
            <p className="text-sm text-muted-foreground">
              UKG integration is not configured. Contact an administrator to set up credentials.
            </p>
          )}

          {isAdmin && (
            <div className="space-y-3 pt-2 border-t">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-sm font-medium">API Credentials</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCredentials(!showCredentials)}
                  data-testid="button-toggle-ukg-credentials"
                >
                  {showCredentials ? <ChevronUp className="w-4 h-4 mr-1" /> : <ChevronDown className="w-4 h-4 mr-1" />}
                  {showCredentials ? "Hide" : "Edit Credentials"}
                </Button>
              </div>

              {showCredentials && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="ukg-api-url">API URL</Label>
                    <Input
                      id="ukg-api-url"
                      data-testid="input-ukg-api-url"
                      placeholder="https://your-ukg-instance.com/api"
                      value={ukgApiUrl}
                      onChange={(e) => setUkgApiUrl(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ukg-username">Username</Label>
                    <Input
                      id="ukg-username"
                      data-testid="input-ukg-username"
                      placeholder="API username"
                      value={ukgUsername}
                      onChange={(e) => setUkgUsername(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ukg-password">Password</Label>
                    <Input
                      id="ukg-password"
                      data-testid="input-ukg-password"
                      type="password"
                      placeholder={ukgCredentials?.hasPassword ? "Leave blank to keep current password" : "API password"}
                      value={ukgPassword}
                      onChange={(e) => setUkgPassword(e.target.value)}
                    />
                    {ukgCredentials?.hasPassword && !ukgPassword && (
                      <p className="text-xs text-muted-foreground">A password is already saved. Enter a new one only if you want to change it.</p>
                    )}
                  </div>
                  <Button
                    onClick={() => saveCredentials.mutate()}
                    disabled={saveCredentials.isPending || !ukgApiUrl || !ukgUsername || (!ukgPassword && !ukgCredentials?.hasPassword)}
                    data-testid="button-save-ukg-credentials"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {saveCredentials.isPending ? "Saving..." : "Save Credentials"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>}

      {canUkgSync && <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5" />
              UKG Diagnostics
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              data-testid="button-toggle-diagnostics"
            >
              {showDiagnostics ? <ChevronUp className="w-4 h-4 mr-1" /> : <ChevronDown className="w-4 h-4 mr-1" />}
              {showDiagnostics ? "Hide" : "Show"}
            </Button>
          </div>
          <CardDescription>API connection status, sync history, and recent API calls.</CardDescription>
        </CardHeader>
        {showDiagnostics && (
          <CardContent className="space-y-6">
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => testConnection.mutate()}
                disabled={testConnection.isPending}
                data-testid="button-test-ukg-connection"
              >
                <Wifi className={`w-4 h-4 mr-1 ${testConnection.isPending ? "animate-pulse" : ""}`} />
                {testConnection.isPending ? "Testing..." : "Test Connection"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchDiagnostics()}
                data-testid="button-refresh-diagnostics"
              >
                <RefreshCw className="w-4 h-4 mr-1" />
                Refresh
              </Button>
            </div>

            {ukgDiagnostics && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="p-3 bg-muted/30 rounded border space-y-1">
                    <p className="text-xs text-muted-foreground font-medium">Connection</p>
                    <div className="flex items-center gap-1.5">
                      {ukgDiagnostics.configured ? (
                        <Wifi className="w-4 h-4 text-green-600" />
                      ) : (
                        <WifiOff className="w-4 h-4 text-muted-foreground" />
                      )}
                      <span className="text-sm font-medium" data-testid="text-ukg-connection-status">
                        {ukgDiagnostics.configured ? "Configured" : "Not Configured"}
                      </span>
                    </div>
                  </div>
                  <div className="p-3 bg-muted/30 rounded border space-y-1">
                    <p className="text-xs text-muted-foreground font-medium">Employees in DB</p>
                    <div className="flex items-center gap-1.5">
                      <Database className="w-4 h-4 text-blue-500" />
                      <span className="text-sm font-medium" data-testid="text-employee-count">
                        {ukgDiagnostics.database.employeeCount.toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <div className="p-3 bg-muted/30 rounded border space-y-1">
                    <p className="text-xs text-muted-foreground font-medium">Time Clock Entries</p>
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-blue-500" />
                      <span className="text-sm font-medium" data-testid="text-timeclock-count">
                        {ukgDiagnostics.database.timeClockEntryCount.toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <div className="p-3 bg-muted/30 rounded border space-y-1">
                    <p className="text-xs text-muted-foreground font-medium">Last Successful Sync</p>
                    <span className="text-sm font-medium" data-testid="text-last-sync">
                      {ukgDiagnostics.lastSuccessfulSync
                        ? new Date(ukgDiagnostics.lastSuccessfulSync).toLocaleString()
                        : "Never"}
                    </span>
                  </div>
                </div>

                {ukgDiagnostics.configured && (
                  <div className="p-3 bg-muted/30 rounded border space-y-1">
                    <p className="text-xs text-muted-foreground font-medium">API Endpoint</p>
                    <p className="text-sm font-mono break-all" data-testid="text-api-url">{ukgDiagnostics.apiUrl}</p>
                    <p className="text-xs text-muted-foreground mt-1">Username: <span className="font-mono">{ukgDiagnostics.username}</span></p>
                  </div>
                )}

                {ukgDiagnostics.lastError && (
                  <div className="p-3 bg-destructive/10 border border-destructive/30 rounded space-y-1">
                    <p className="text-xs font-medium text-destructive">Last Error</p>
                    <p className="text-sm font-mono text-destructive/80 break-all" data-testid="text-last-error">
                      {ukgDiagnostics.lastError}
                    </p>
                  </div>
                )}

                {ukgDiagnostics.syncHistory.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Sync History</p>
                    <div className="border rounded overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/30">
                            <th className="text-left p-2 font-medium">Time</th>
                            <th className="text-left p-2 font-medium">Type</th>
                            <th className="text-left p-2 font-medium">Status</th>
                            <th className="text-left p-2 font-medium">Details</th>
                            <th className="text-right p-2 font-medium">Duration</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ukgDiagnostics.syncHistory.map((sync, i) => (
                            <tr key={i} className="border-b last:border-0" data-testid={`row-sync-${i}`}>
                              <td className="p-2 text-muted-foreground whitespace-nowrap">
                                {new Date(sync.timestamp).toLocaleString()}
                              </td>
                              <td className="p-2">
                                <Badge variant="outline" className="text-xs">
                                  {sync.type === "employee" ? "Employees" : "Time Clock"}
                                </Badge>
                              </td>
                              <td className="p-2">
                                {sync.success ? (
                                  <Badge variant="outline" className="text-green-600 border-green-600 text-xs">
                                    <CheckCircle2 className="w-3 h-3 mr-1" /> OK
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-destructive border-destructive text-xs">
                                    <XCircle className="w-3 h-3 mr-1" /> Failed
                                  </Badge>
                                )}
                              </td>
                              <td className="p-2 text-xs text-muted-foreground">
                                {sync.success ? (
                                  sync.type === "employee"
                                    ? `${sync.employeesFetched} fetched, ${sync.employeesProcessed} processed`
                                    : `${sync.timeRecordsFetched} fetched, ${sync.timeRecordsProcessed} processed`
                                ) : (
                                  <span className="text-destructive">{sync.error}</span>
                                )}
                              </td>
                              <td className="p-2 text-right text-muted-foreground whitespace-nowrap">
                                {sync.durationMs ? `${(sync.durationMs / 1000).toFixed(1)}s` : "-"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {ukgDiagnostics.recentApiCalls.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Recent API Calls</p>
                    <div className="border rounded overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/30">
                            <th className="text-left p-2 font-medium">Time</th>
                            <th className="text-left p-2 font-medium">Method</th>
                            <th className="text-left p-2 font-medium">URL</th>
                            <th className="text-center p-2 font-medium">Status</th>
                            <th className="text-right p-2 font-medium">Duration</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ukgDiagnostics.recentApiCalls.map((call, i) => (
                            <tr key={i} className="border-b last:border-0" data-testid={`row-api-call-${i}`}>
                              <td className="p-2 text-muted-foreground whitespace-nowrap">
                                {new Date(call.timestamp).toLocaleTimeString()}
                              </td>
                              <td className="p-2">
                                <Badge variant="outline" className="text-xs">{call.method}</Badge>
                              </td>
                              <td className="p-2 font-mono text-xs break-all max-w-[300px]">{call.url}</td>
                              <td className="p-2 text-center">
                                <Badge
                                  variant="outline"
                                  className={`text-xs ${
                                    call.status >= 200 && call.status < 300
                                      ? "text-green-600 border-green-600"
                                      : call.status >= 400
                                        ? "text-destructive border-destructive"
                                        : "text-yellow-600 border-yellow-600"
                                  }`}
                                >
                                  {call.status}
                                </Badge>
                              </td>
                              <td className="p-2 text-right text-muted-foreground whitespace-nowrap">
                                {call.durationMs ? `${call.durationMs}ms` : "-"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}

            {!ukgDiagnostics && (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Loading diagnostics...
              </div>
            )}
          </CardContent>
        )}
      </Card>}

          </>}

          {activeSection === "email" && <>
      {canGlobalConfig && <EmailBrandingCard />}
      {canGlobalConfig && <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5" />
            HR Email Notifications
          </CardTitle>
          <CardDescription>
            Automatically send email alerts to HR when employees reach occurrence thresholds (5, 7, or 8 points).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="hr-email">HR Notification Emails</Label>
            <div className="flex gap-2">
              <Input
                id="hr-email"
                type="text"
                placeholder="hr@company.com, manager@company.com"
                value={hrEmail}
                onChange={(e) => setHrEmail(e.target.value)}
                className="flex-1"
                data-testid="input-hr-email"
              />
              <Button 
                onClick={saveHrEmail} 
                disabled={updateSettings.isPending}
                data-testid="button-save-hr-email"
              >
                {updateSettings.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              When an employee reaches 5, 7, or 8 occurrence points, an email will be sent to these addresses. Separate multiple emails with commas.
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <Button 
              variant="outline"
              onClick={() => testOutlook.mutate()}
              disabled={testOutlook.isPending}
              data-testid="button-test-outlook"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${testOutlook.isPending ? "animate-spin" : ""}`} />
              {testOutlook.isPending ? "Testing..." : "Test Connection"}
            </Button>
            <Button 
              variant="outline"
              onClick={() => sendTestEmail.mutate()}
              disabled={sendTestEmail.isPending || !hrEmail}
              data-testid="button-send-test-email"
            >
              <Send className={`w-4 h-4 mr-2 ${sendTestEmail.isPending ? "animate-pulse" : ""}`} />
              {sendTestEmail.isPending ? "Sending..." : "Send Test Email"}
            </Button>
          </div>

          {settings?.hrNotificationEmail && (
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <span className="text-muted-foreground">
                Notifications configured for: <span className="font-medium text-foreground">{settings.hrNotificationEmail.split(',').map(e => e.trim()).filter(e => e).join(', ')}</span>
              </span>
            </div>
          )}
        </CardContent>
      </Card>}

      {canGlobalConfig && <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5" />
            Order Submission Notifications
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Send an email notification whenever a new order is submitted. Configure who should receive these notifications below.
          </p>
          <div className="space-y-2">
            <Label htmlFor="order-emails">Notification recipients</Label>
            <div className="flex gap-2">
              <Input
                id="order-emails"
                type="text"
                placeholder="logistics@company.com, manager@company.com"
                value={orderEmails}
                onChange={(e) => setOrderEmails(e.target.value)}
                className="flex-1"
                data-testid="input-order-notification-emails"
              />
              <Button
                onClick={saveOrderEmails}
                disabled={updateSettings.isPending}
                data-testid="button-save-order-emails"
              >
                {updateSettings.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Separate multiple email addresses with commas. These recipients will be notified each time an order is submitted.
            </p>
          </div>

          {settings?.orderNotificationEmails && (
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <span className="text-muted-foreground">
                Order notifications configured for: <span className="font-medium text-foreground">{settings.orderNotificationEmails.split(',').map(e => e.trim()).filter(e => e).join(', ')}</span>
              </span>
            </div>
          )}

          <div className="pt-6 border-t space-y-2">
            <Label htmlFor="driver-inspection-emails">Driver Inspection Repair Alerts</Label>
            <p className="text-sm text-muted-foreground">
              Send an email notification when a driver flags any pre-trip inspection item as needing repair.
            </p>
            <div className="flex gap-2">
              <Input
                id="driver-inspection-emails"
                type="text"
                placeholder="logistics@company.com, shop@company.com"
                value={driverInspectionEmails}
                onChange={(e) => setDriverInspectionEmails(e.target.value)}
                className="flex-1"
                data-testid="input-driver-inspection-emails"
              />
              <Button
                onClick={saveDriverInspectionEmails}
                disabled={updateSettings.isPending}
                data-testid="button-save-driver-inspection-emails"
              >
                {updateSettings.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Separate multiple email addresses with commas.
            </p>
            {settings?.driverInspectionEmails && (
              <div className="flex items-center gap-2 text-sm pt-1">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <span className="text-muted-foreground">
                  Repair alerts configured for: <span className="font-medium text-foreground">{settings.driverInspectionEmails.split(',').map(e => e.trim()).filter(e => e).join(', ')}</span>
                </span>
              </div>
            )}
          </div>

          <div className="pt-6 border-t space-y-2">
            <Label>Warehouse Variance CSV Recipients</Label>
            <p className="text-sm text-muted-foreground">
              Recipients for the "Email CSV" action on warehouse count detail pages. The same CSV (with metadata header) leaders can download manually is sent as an attachment, per warehouse.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="warehouse-variance-emails-cleveland" className="text-xs uppercase tracking-wider text-muted-foreground">Cleveland</Label>
                <Input
                  id="warehouse-variance-emails-cleveland"
                  type="text"
                  placeholder="ops-cleveland@company.com, audit@company.com"
                  value={warehouseVarianceEmailsCleveland}
                  onChange={(e) => setWarehouseVarianceEmailsCleveland(e.target.value)}
                  data-testid="input-warehouse-variance-emails-cleveland"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="warehouse-variance-emails-canton" className="text-xs uppercase tracking-wider text-muted-foreground">Canton</Label>
                <Input
                  id="warehouse-variance-emails-canton"
                  type="text"
                  placeholder="ops-canton@company.com, audit@company.com"
                  value={warehouseVarianceEmailsCanton}
                  onChange={(e) => setWarehouseVarianceEmailsCanton(e.target.value)}
                  data-testid="input-warehouse-variance-emails-canton"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={saveWarehouseVarianceEmails}
                disabled={updateSettings.isPending}
                data-testid="button-save-warehouse-variance-emails"
              >
                {updateSettings.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Separate multiple email addresses with commas. Leave a warehouse blank to disable the Email CSV button for that warehouse.
            </p>
          </div>

          <div className="pt-6 border-t space-y-2">
            <Label htmlFor="login-tagline">Login Page Tagline</Label>
            <p className="text-sm text-muted-foreground">
              Message shown under the logo on the sign-in page.
            </p>
            <div className="flex gap-2">
              <Input
                id="login-tagline"
                type="text"
                placeholder="Changing lives through the power of work."
                value={loginTagline}
                onChange={(e) => setLoginTagline(e.target.value)}
                className="flex-1"
                data-testid="input-login-tagline"
              />
              <Button
                onClick={saveLoginTagline}
                disabled={updateSettings.isPending}
                data-testid="button-save-login-tagline"
              >
                {updateSettings.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Leave blank to restore the default tagline.
            </p>
          </div>
        </CardContent>
      </Card>}

      {canGlobalConfig && <ScheduleEmailPreview hrEmail={hrEmail} />}

      {canEmailAudit && <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5" />
              Email Activity Log
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowEmailLogs(!showEmailLogs)}
              data-testid="button-toggle-email-logs"
            >
              {showEmailLogs ? <ChevronUp className="w-4 h-4 mr-1" /> : <ChevronDown className="w-4 h-4 mr-1" />}
              {showEmailLogs ? "Hide" : "Show"}
            </Button>
          </div>
          <CardDescription>History of all emails sent, attempted, and failed.</CardDescription>
        </CardHeader>
        {showEmailLogs && (
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchEmailLogs()}
                data-testid="button-refresh-email-logs"
              >
                <RefreshCw className="w-4 h-4 mr-1" />
                Refresh
              </Button>
            </div>

            {!emailLogs ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Loading email logs...
              </div>
            ) : emailLogs.length > 0 ? (
              <div className="border rounded overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left p-2 font-medium">Time</th>
                      <th className="text-left p-2 font-medium">Type</th>
                      <th className="text-left p-2 font-medium">Recipient</th>
                      <th className="text-left p-2 font-medium">Subject</th>
                      <th className="text-center p-2 font-medium">Status</th>
                      <th className="text-left p-2 font-medium">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emailLogs.map((log) => (
                      <tr key={log.id} className="border-b last:border-0" data-testid={`row-email-log-${log.id}`}>
                        <td className="p-2 text-muted-foreground whitespace-nowrap">
                          {new Date(log.sentAt).toLocaleString()}
                        </td>
                        <td className="p-2">
                          <Badge variant="outline" className="text-xs whitespace-nowrap">
                            {log.type === "occurrence_alert" ? "Occurrence Alert" :
                             log.type === "shift_trade" ? "Shift Trade" :
                             log.type === "schedule_publish" ? "Schedule Publish" :
                             log.type === "test" ? "Test" : log.type}
                          </Badge>
                        </td>
                        <td className="p-2 text-xs font-mono break-all max-w-[200px]">
                          {log.recipientEmail}
                          {log.employeeName && (
                            <span className="block text-muted-foreground">{log.employeeName}</span>
                          )}
                        </td>
                        <td className="p-2 text-xs max-w-[250px] truncate" title={log.subject}>
                          {log.subject}
                        </td>
                        <td className="p-2 text-center">
                          {log.status === "sent" ? (
                            <Badge variant="outline" className="text-green-600 border-green-600 text-xs">
                              <CheckCircle2 className="w-3 h-3 mr-1" /> Sent
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-destructive border-destructive text-xs">
                              <XCircle className="w-3 h-3 mr-1" /> Failed
                            </Badge>
                          )}
                        </td>
                        <td className="p-2 text-xs text-destructive max-w-[200px] truncate" title={log.error || ""}>
                          {log.error || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No email activity recorded yet.</p>
            )}
          </CardContent>
        )}
      </Card>}
          </>}

          {activeSection === "fleet" && showFleetSection && (
            <Card data-testid="card-fleet">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Truck className="w-5 h-5" />
                  Fleet & Routes
                </CardTitle>
                <CardDescription>
                  These dropdowns power the trailer manifest and driver inspection forms. Pick a tab below to manage each list.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue={canViewTrailers ? "trailers" : canViewTractors ? "tractors" : "routes"} className="w-full">
                  <TabsList className="grid w-full grid-cols-3" data-testid="tabs-fleet">
                    <TabsTrigger value="trailers" disabled={!canViewTrailers} data-testid="tab-trailers">Trailers</TabsTrigger>
                    <TabsTrigger value="tractors" disabled={!canViewTractors} data-testid="tab-tractors">Tractors / Box Trucks</TabsTrigger>
                    <TabsTrigger value="routes" disabled={!canViewRoutes} data-testid="tab-routes">Routes</TabsTrigger>
                  </TabsList>
                  {canViewTrailers && (
                    <TabsContent value="trailers" className="mt-4">
                      <TrailersManager />
                    </TabsContent>
                  )}
                  {canViewTractors && (
                    <TabsContent value="tractors" className="mt-4">
                      <TractorsManager />
                    </TabsContent>
                  )}
                  {canViewRoutes && (
                    <TabsContent value="routes" className="mt-4">
                      <TruckRoutesManager />
                    </TabsContent>
                  )}
                </Tabs>
              </CardContent>
            </Card>
          )}

          {activeSection === "about" && (
            <Card data-testid="card-about">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Info className="w-5 h-5" />
                  About GoodShift
                </CardTitle>
                <CardDescription>Version and release information.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-muted/30 rounded border space-y-1">
                    <p className="text-xs text-muted-foreground font-medium">Current Version</p>
                    <p className="text-sm font-medium" data-testid="text-app-version">{APP_VERSION}</p>
                  </div>
                  <div className="p-3 bg-muted/30 rounded border space-y-1">
                    <p className="text-xs text-muted-foreground font-medium">Released</p>
                    <p className="text-sm font-medium" data-testid="text-release-date">
                      {changelog[0]?.date
                        ? new Date(changelog[0].date).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
                        : "—"}
                    </p>
                  </div>
                </div>
                {changelog[0]?.title && (
                  <div className="p-3 bg-muted/30 rounded border space-y-1">
                    <p className="text-xs text-muted-foreground font-medium">Latest release</p>
                    <p className="text-sm font-medium" data-testid="text-latest-release-title">{changelog[0].title}</p>
                  </div>
                )}
                <div>
                  <Link
                    href="/changelog"
                    className="text-sm text-primary hover:underline"
                    data-testid="link-view-changelog"
                  >
                    View full changelog →
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function ScheduleEmailPreview({ hrEmail }: { hrEmail: string }) {
  const { toast } = useToast();
  const [showPreview, setShowPreview] = useState(false);

  const { data: previewData } = useQuery<{ html: string }>({
    queryKey: ["/api/outlook/schedule-email-preview"],
    enabled: showPreview,
  });

  const sendTestScheduleEmail = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/outlook/test-schedule-email", {});
      return res.json();
    },
    onSuccess: (data: { success: boolean; message: string }) => {
      if (data.success) {
        toast({ title: "Test Schedule Email Sent", description: data.message });
      } else {
        toast({ variant: "destructive", title: "Email Failed", description: data.message });
      }
    },
    onError: () => {
      toast({ variant: "destructive", title: "Email Failed", description: "Could not send test schedule email" });
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2">
            <Eye className="w-5 h-5" />
            Schedule Update Email Preview
          </CardTitle>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowPreview(!showPreview)}
              data-testid="button-toggle-schedule-preview"
            >
              {showPreview ? <ChevronUp className="w-4 h-4 mr-1" /> : <ChevronDown className="w-4 h-4 mr-1" />}
              {showPreview ? "Hide" : "Preview"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => sendTestScheduleEmail.mutate()}
              disabled={sendTestScheduleEmail.isPending || !hrEmail}
              data-testid="button-send-test-schedule-email"
            >
              <Send className={`w-4 h-4 mr-2 ${sendTestScheduleEmail.isPending ? "animate-pulse" : ""}`} />
              {sendTestScheduleEmail.isPending ? "Sending..." : "Send Test"}
            </Button>
          </div>
        </div>
        <CardDescription>Preview what employees receive when a schedule is published.</CardDescription>
      </CardHeader>
      {showPreview && (
        <CardContent>
          {previewData?.html ? (
            <div className="border rounded overflow-hidden">
              <iframe
                srcDoc={previewData.html}
                className="w-full border-0"
                style={{ minHeight: "400px" }}
                title="Schedule Email Preview"
                data-testid="iframe-schedule-email-preview"
              />
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">Loading preview...</div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
