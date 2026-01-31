import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { RefreshCw, CheckCircle2, XCircle, Building2, LogIn, LogOut, Shield, Mail, Send } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useGlobalSettings, useUpdateGlobalSettings } from "@/hooks/use-settings";

export default function Settings() {
  const { toast } = useToast();
  const { data: settings } = useGlobalSettings();
  const updateSettings = useUpdateGlobalSettings();
  
  const [selectedStore, setSelectedStore] = useState<string>("");
  const [hrEmail, setHrEmail] = useState<string>("");
  
  useEffect(() => {
    if (settings?.hrNotificationEmail) {
      setHrEmail(settings.hrNotificationEmail);
    }
  }, [settings?.hrNotificationEmail]);

  const { data: authStatus } = useQuery<{ isAuthenticated: boolean; user: { id: string; name: string; email: string } | null; ssoConfigured: boolean }>({
    queryKey: ["/api/auth/status"],
  });

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
        <p className="text-muted-foreground mt-1">Configure global constraints and requirements.</p>
      </div>

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
    </div>
  );
}
