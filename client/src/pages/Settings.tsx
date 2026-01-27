import { useGlobalSettings, useUpdateGlobalSettings, useRoleRequirements, useCreateRoleRequirement, useDeleteRoleRequirement } from "@/hooks/use-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Plus, Trash2, Save, RefreshCw, CheckCircle2, XCircle, Building2, LogIn, LogOut, Shield } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

export default function Settings() {
  const { data: settings } = useGlobalSettings();
  const updateSettings = useUpdateGlobalSettings();
  const { data: roles } = useRoleRequirements();
  const createRole = useCreateRoleRequirement();
  const deleteRole = useDeleteRoleRequirement();
  const { toast } = useToast();

  const [weeklyLimit, setWeeklyLimit] = useState<number | undefined>(undefined);
  const [newRole, setNewRole] = useState({ jobTitle: "", requiredWeeklyHours: 40 });
  const [selectedStore, setSelectedStore] = useState<string>("");

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

  const syncUkg = useMutation({
    mutationFn: async (storeId?: string) => {
      const res = await apiRequest("POST", "/api/ukg/sync", { storeId });
      return res.json();
    },
    onSuccess: (data: { imported: number; updated: number; errors: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      toast({ 
        title: "UKG Sync Complete", 
        description: `Imported: ${data.imported}, Updated: ${data.updated}, Errors: ${data.errors}` 
      });
    },
    onError: () => {
      toast({ variant: "destructive", title: "Sync Failed", description: "Could not sync with UKG" });
    },
  });

  // Init state from data
  if (weeklyLimit === undefined && settings) {
    setWeeklyLimit(settings.totalWeeklyHoursLimit);
  }

  const handleSaveGlobal = async () => {
    if (!weeklyLimit) return;
    try {
      await updateSettings.mutateAsync({ totalWeeklyHoursLimit: weeklyLimit });
      toast({ title: "Settings saved" });
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: "Failed to save settings" });
    }
  };

  const handleAddRole = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createRole.mutateAsync(newRole);
      setNewRole({ jobTitle: "", requiredWeeklyHours: 40 });
      toast({ title: "Role requirement added" });
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: "Failed to add role requirement" });
    }
  };

  const handleDeleteRole = async (id: number) => {
    try {
      await deleteRole.mutateAsync(id);
      toast({ title: "Role requirement deleted" });
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: "Failed to delete" });
    }
  };

  return (
    <div className="p-6 lg:p-10 space-y-8 max-w-[1200px] mx-auto">
      <div>
        <h1 className="text-3xl font-bold font-display">Settings</h1>
        <p className="text-muted-foreground mt-1">Configure global constraints and requirements.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <Card>
          <CardHeader>
            <CardTitle>Global Constraints</CardTitle>
            <CardDescription>Limits that apply to the entire schedule.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Total Weekly Hours Limit</Label>
              <div className="flex gap-2">
                <Input 
                  type="number" 
                  value={weeklyLimit || ""} 
                  onChange={e => setWeeklyLimit(parseInt(e.target.value))}
                />
                <Button onClick={handleSaveGlobal} disabled={updateSettings.isPending}>
                  <Save className="w-4 h-4 mr-2" /> Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                The scheduler will show a warning if the total hours across all employees exceeds this value.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Role Requirements</CardTitle>
            <CardDescription>Minimum coverage needed for each job title.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <form onSubmit={handleAddRole} className="flex gap-2 items-end">
              <div className="space-y-2 flex-1">
                <Label>Job Title</Label>
                <Input 
                  placeholder="e.g. Chef" 
                  value={newRole.jobTitle}
                  onChange={e => setNewRole({...newRole, jobTitle: e.target.value})}
                  required
                />
              </div>
              <div className="space-y-2 w-32">
                <Label>Min Hours</Label>
                <Input 
                  type="number" 
                  value={newRole.requiredWeeklyHours}
                  onChange={e => setNewRole({...newRole, requiredWeeklyHours: parseInt(e.target.value)})}
                  required
                />
              </div>
              <Button type="submit" disabled={createRole.isPending}>
                <Plus className="w-4 h-4" />
              </Button>
            </form>

            <div className="space-y-2">
              {roles?.map(role => (
                <div key={role.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border">
                  <div>
                    <p className="font-semibold">{role.jobTitle}</p>
                    <p className="text-sm text-muted-foreground">Min {role.requiredWeeklyHours}h / week</p>
                  </div>
                  <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDeleteRole(role.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              {roles?.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No role requirements set.</p>}
            </div>
          </CardContent>
        </Card>
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
            <div className="p-3 bg-muted/30 rounded-lg border space-y-1">
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
            </div>
          )}

          {!ukgStatus?.configured && (
            <p className="text-sm text-muted-foreground">
              To enable UKG integration, please configure the UKG API credentials in your environment variables (UKG_API_URL, UKG_CLIENT_ID, UKG_CLIENT_SECRET, UKG_API_KEY).
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
