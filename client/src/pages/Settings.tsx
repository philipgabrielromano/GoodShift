import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { RefreshCw, CheckCircle2, XCircle, Building2, LogIn, LogOut, Shield, Mail, Send, Save, Bell, Activity, Database, Clock, Wifi, WifiOff, ChevronDown, ChevronUp } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useGlobalSettings, useUpdateGlobalSettings } from "@/hooks/use-settings";
import type { Employee } from "@shared/schema";

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
  const [altEmail, setAltEmail] = useState("");
  const [altEmailSaving, setAltEmailSaving] = useState(false);
  const [altEmailInitialized, setAltEmailInitialized] = useState(false);
  
  useEffect(() => {
    if (settings?.hrNotificationEmail) {
      setHrEmail(settings.hrNotificationEmail);
    }
  }, [settings?.hrNotificationEmail]);

  const { data: authStatus } = useQuery<{ isAuthenticated: boolean; user: { id: string; name: string; email: string; role: string } | null; ssoConfigured: boolean }>({
    queryKey: ["/api/auth/status"],
  });

  const { data: myEmployeeData } = useQuery<{ employee: Employee | null }>({
    queryKey: ["/api/my-employee"],
  });

  const currentEmployee = myEmployeeData?.employee || null;
  const userRole = authStatus?.user?.role ?? "viewer";
  const isAdmin = userRole === "admin";

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

  const { data: ukgDiagnostics, refetch: refetchDiagnostics } = useQuery<UKGDiagnostics>({
    queryKey: ["/api/ukg/diagnostics"],
    enabled: isAdmin && showDiagnostics,
    refetchInterval: showDiagnostics ? 30000 : false,
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

  return (
    <div className="p-6 lg:p-10 space-y-8 max-w-[1200px] mx-auto">
      <div>
        <h1 className="text-3xl font-bold font-display">Settings</h1>
        <p className="text-muted-foreground mt-1">
          {isAdmin ? "Configure global constraints and requirements." : "Manage your notification preferences."}
        </p>
      </div>

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

      {isAdmin && <>
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

      <Card>
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

          {!ukgStatus?.configured && (
            <p className="text-sm text-muted-foreground">
              To enable UKG integration, please configure the UKG service account credentials in your environment variables (UKG_API_URL, UKG_USERNAME, UKG_PASSWORD, UKG_API_KEY).
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
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
      </Card>

      <Card>
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
            <Label htmlFor="hr-email">HR Notification Email</Label>
            <div className="flex gap-2">
              <Input
                id="hr-email"
                type="email"
                placeholder="hr@company.com"
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
              When an employee reaches 5, 7, or 8 occurrence points, an email will be sent to this address with details and a link to their attendance record.
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
                Notifications configured for: <span className="font-medium text-foreground">{settings.hrNotificationEmail}</span>
              </span>
            </div>
          )}
        </CardContent>
      </Card>
      </>}
    </div>
  );
}
