import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Save, ShieldCheck, RotateCcw, Plus, Trash2, Lock } from "lucide-react";
import { DEFAULT_FEATURE_PERMISSIONS, type Role } from "@shared/schema";

interface FeaturePermission {
  feature: string;
  label: string;
  description: string;
  allowedRoles: string[];
}

export default function Permissions() {
  const { toast } = useToast();
  const [localPerms, setLocalPerms] = useState<FeaturePermission[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleLabel, setNewRoleLabel] = useState("");
  const [roleToDelete, setRoleToDelete] = useState<Role | null>(null);

  const { data: permissions, isLoading } = useQuery<FeaturePermission[]>({
    queryKey: ["/api/permissions"],
  });

  const { data: roles = [], isLoading: rolesLoading } = useQuery<Role[]>({
    queryKey: ["/api/roles"],
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

  const createRoleMutation = useMutation({
    mutationFn: async (input: { name: string; label: string }) => {
      return await apiRequest("POST", "/api/roles", input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      toast({ title: "Role created", description: "The new role is now available." });
      setCreateOpen(false);
      setNewRoleName("");
      setNewRoleLabel("");
    },
    onError: (err: any) => {
      toast({
        title: "Error creating role",
        description: err?.message || "Failed to create role.",
        variant: "destructive",
      });
    },
  });

  const deleteRoleMutation = useMutation({
    mutationFn: async (name: string) => {
      await apiRequest("DELETE", `/api/roles/${name}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/permissions"] });
      toast({ title: "Role deleted" });
      setRoleToDelete(null);
    },
    onError: (err: any) => {
      toast({
        title: "Cannot delete role",
        description: err?.message || "Failed to delete role.",
        variant: "destructive",
      });
      setRoleToDelete(null);
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

  const handleCreateRole = () => {
    const name = newRoleName.trim().toLowerCase();
    const label = newRoleLabel.trim();
    if (!name || !label) {
      toast({ title: "Missing fields", description: "Name and label are required.", variant: "destructive" });
      return;
    }
    if (!/^[a-z0-9_]+$/.test(name)) {
      toast({ title: "Invalid name", description: "Use only lowercase letters, numbers, and underscores.", variant: "destructive" });
      return;
    }
    createRoleMutation.mutate({ name, label });
  };

  if (isLoading || rolesLoading) {
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
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Roles</CardTitle>
            <CardDescription>
              Built-in roles cannot be deleted. Custom roles only control page-level feature access.
            </CardDescription>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-create-role">
                <Plus className="w-4 h-4 mr-2" />
                Add Role
              </Button>
            </DialogTrigger>
            <DialogContent data-testid="dialog-create-role">
              <DialogHeader>
                <DialogTitle>Create custom role</DialogTitle>
                <DialogDescription>
                  Give the role a system name (lowercase, no spaces) and a display label.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="role-name">System name</Label>
                  <Input
                    id="role-name"
                    placeholder="e.g. donations_lead"
                    value={newRoleName}
                    onChange={e => setNewRoleName(e.target.value)}
                    data-testid="input-role-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role-label">Display label</Label>
                  <Input
                    id="role-label"
                    placeholder="e.g. Donations Lead"
                    value={newRoleLabel}
                    onChange={e => setNewRoleLabel(e.target.value)}
                    data-testid="input-role-label"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)} data-testid="button-cancel-role">
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateRole}
                  disabled={createRoleMutation.isPending}
                  data-testid="button-confirm-create-role"
                >
                  {createRoleMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Create Role
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {roles.map(role => (
              <div
                key={role.id}
                className="flex items-center gap-2 border rounded px-3 py-1.5 text-sm"
                data-testid={`chip-role-${role.name}`}
              >
                <span className="font-medium">{role.label}</span>
                <span className="text-xs text-muted-foreground">({role.name})</span>
                {role.isBuiltIn ? (
                  <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                ) : (
                  <button
                    type="button"
                    onClick={() => setRoleToDelete(role)}
                    className="text-muted-foreground hover:text-destructive"
                    data-testid={`button-delete-role-${role.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

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
                  <th className="text-left py-3 px-4 font-semibold text-sm w-[30%]">Feature</th>
                  {roles.map(role => (
                    <th key={role.name} className="text-center py-3 px-4 font-semibold text-sm">
                      {role.label}
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
                    {roles.map(role => (
                      <td key={role.name} className="text-center py-3 px-4">
                        <Checkbox
                          checked={perm.allowedRoles.includes(role.name)}
                          disabled={role.name === "admin"}
                          onCheckedChange={() => toggleRole(perm.feature, role.name)}
                          data-testid={`checkbox-${perm.feature}-${role.name}`}
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

      <AlertDialog open={!!roleToDelete} onOpenChange={open => !open && setRoleToDelete(null)}>
        <AlertDialogContent data-testid="dialog-confirm-delete-role">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete role "{roleToDelete?.label}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the role from the system and revoke its feature access.
              Users currently assigned to this role must be reassigned first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-role">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => roleToDelete && deleteRoleMutation.mutate(roleToDelete.name)}
              data-testid="button-confirm-delete-role"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
