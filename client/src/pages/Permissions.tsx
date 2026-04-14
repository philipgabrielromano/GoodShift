import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Save, ShieldCheck, RotateCcw } from "lucide-react";
import { DEFAULT_FEATURE_PERMISSIONS } from "@shared/schema";

interface FeaturePermission {
  feature: string;
  label: string;
  description: string;
  allowedRoles: string[];
}

const ALL_ROLES = ["admin", "manager", "optimizer", "viewer"] as const;

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  manager: "Manager",
  optimizer: "Store Optimizer",
  viewer: "Viewer",
};

export default function Permissions() {
  const { toast } = useToast();
  const [localPerms, setLocalPerms] = useState<FeaturePermission[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  const { data: permissions, isLoading } = useQuery<FeaturePermission[]>({
    queryKey: ["/api/permissions"],
  });

  useEffect(() => {
    if (permissions) {
      setLocalPerms(permissions);
      setHasChanges(false);
    }
  }, [permissions]);

  const saveMutation = useMutation({
    mutationFn: async (perms: { feature: string; allowedRoles: string[] }[]) => {
      await apiRequest("PUT", "/api/permissions", perms);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/permissions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/status"] });
      toast({ title: "Permissions saved", description: "Role access has been updated." });
      setHasChanges(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save permissions.", variant: "destructive" });
    },
  });

  const toggleRole = (feature: string, role: string) => {
    if (role === "admin") return;
    setLocalPerms(prev =>
      prev.map(p => {
        if (p.feature !== feature) return p;
        const has = p.allowedRoles.includes(role);
        return {
          ...p,
          allowedRoles: has
            ? p.allowedRoles.filter(r => r !== role)
            : [...p.allowedRoles, role],
        };
      })
    );
    setHasChanges(true);
  };

  const handleSave = () => {
    saveMutation.mutate(
      localPerms.map(p => ({ feature: p.feature, allowedRoles: p.allowedRoles }))
    );
  };

  const handleReset = () => {
    const resetPerms = localPerms.map(p => ({
      ...p,
      allowedRoles: DEFAULT_FEATURE_PERMISSIONS[p.feature] || ["admin"],
    }));
    setLocalPerms(resetPerms);
    setHasChanges(true);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" data-testid="loading-permissions">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
      <div className="p-4 lg:p-8 max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-permissions-title">
              <ShieldCheck className="w-6 h-6" />
              Permissions
            </h1>
            <p className="text-muted-foreground mt-1">
              Control which roles can access each feature. Admin always has full access.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={saveMutation.isPending}
              data-testid="button-reset-defaults"
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Reset to Defaults
            </Button>
            <Button
              onClick={handleSave}
              disabled={!hasChanges || saveMutation.isPending}
              data-testid="button-save-permissions"
            >
              {saveMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Save Changes
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Feature Access Matrix</CardTitle>
            <CardDescription>
              Check or uncheck to grant or revoke access for each role. Changes take effect after saving.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-semibold text-sm w-[40%]">Feature</th>
                    {ALL_ROLES.map(role => (
                      <th key={role} className="text-center py-3 px-4 font-semibold text-sm">
                        {ROLE_LABELS[role]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {localPerms.map(perm => (
                    <tr key={perm.feature} className="border-b last:border-0 hover:bg-muted/50" data-testid={`row-permission-${perm.feature}`}>
                      <td className="py-3 px-4">
                        <div className="font-medium text-sm" data-testid={`text-feature-label-${perm.feature}`}>{perm.label}</div>
                        <div className="text-xs text-muted-foreground">{perm.description}</div>
                      </td>
                      {ALL_ROLES.map(role => (
                        <td key={role} className="text-center py-3 px-4">
                          <Checkbox
                            checked={perm.allowedRoles.includes(role)}
                            disabled={role === "admin"}
                            onCheckedChange={() => toggleRole(perm.feature, role)}
                            data-testid={`checkbox-${perm.feature}-${role}`}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
  );
}
