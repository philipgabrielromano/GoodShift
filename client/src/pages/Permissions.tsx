import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Loader2, Save, ShieldCheck, RotateCcw, Plus, Trash2, Lock, Pencil, Search,
  ChevronDown, ChevronRight, Circle,
} from "lucide-react";
import { DEFAULT_FEATURE_PERMISSIONS, FEATURE_CATEGORIES, type Role } from "@shared/schema";

interface FeaturePermission {
  feature: string;
  label: string;
  description: string;
  category?: string;
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
  const [roleToRename, setRoleToRename] = useState<Role | null>(null);
  const [renameLabel, setRenameLabel] = useState("");
  const [selectedRole, setSelectedRole] = useState<string>("admin");
  const [search, setSearch] = useState("");
  const [collapsedCats, setCollapsedCats] = useState<Record<string, boolean>>({});

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

  // Track which roles have unsaved changes (for the unsaved indicator on the rail)
  const dirtyRoles = useMemo(() => {
    if (!permissions) return new Set<string>();
    const baseline = new Map(permissions.map(p => [p.feature, new Set(p.allowedRoles)]));
    const dirty = new Set<string>();
    for (const p of localPerms) {
      const base = baseline.get(p.feature);
      if (!base) continue;
      const current = new Set(p.allowedRoles);
      const changedRoles = new Set<string>();
      base.forEach(r => { if (!current.has(r)) changedRoles.add(r); });
      current.forEach(r => { if (!base.has(r)) changedRoles.add(r); });
      changedRoles.forEach(r => dirty.add(r));
    }
    return dirty;
  }, [permissions, localPerms]);

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

  const renameRoleMutation = useMutation({
    mutationFn: async ({ name, label }: { name: string; label: string }) => {
      return await apiRequest("PATCH", `/api/roles/${name}`, { label });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/status"] });
      toast({ title: "Role renamed", description: "The display name has been updated." });
      setRoleToRename(null);
      setRenameLabel("");
    },
    onError: (err: any) => {
      toast({
        title: "Error renaming role",
        description: err?.message || "Failed to rename role.",
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
      if (roleToDelete && roleToDelete.name === selectedRole) {
        setSelectedRole("admin");
      }
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

  // Bulk: grant or revoke an entire category for the selected role
  const bulkSetCategory = (cat: string, grant: boolean) => {
    if (selectedRole === "admin") return;
    setLocalPerms(prev =>
      prev.map(p => {
        if ((p.category || "Other") !== cat) return p;
        if (!matchesSearch(p)) return p;
        const has = p.allowedRoles.includes(selectedRole);
        if (grant && !has) {
          return { ...p, allowedRoles: [...p.allowedRoles, selectedRole] };
        }
        if (!grant && has) {
          return { ...p, allowedRoles: p.allowedRoles.filter(r => r !== selectedRole) };
        }
        return p;
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

  const matchesSearch = (p: FeaturePermission) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return p.label.toLowerCase().includes(q) || (p.category || "").toLowerCase().includes(q);
  };

  const groupedFiltered = useMemo(() => {
    const grouped: Record<string, FeaturePermission[]> = {};
    for (const p of localPerms) {
      if (!matchesSearch(p)) continue;
      const cat = p.category || "Other";
      (grouped[cat] ||= []).push(p);
    }
    const orderedCats = [...FEATURE_CATEGORIES, "Other"].filter(c => grouped[c]?.length);
    return { grouped, orderedCats };
  }, [localPerms, search]);

  const grantedCountFor = (roleName: string) =>
    localPerms.reduce((n, p) => n + (p.allowedRoles.includes(roleName) ? 1 : 0), 0);

  if (isLoading || rolesLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" data-testid="loading-permissions">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const selectedRoleObj = roles.find(r => r.name === selectedRole);
  const isAdminSelected = selectedRole === "admin";
  const totalPerms = localPerms.length;

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-permissions-title">
            <ShieldCheck className="w-6 h-6" />
            Permissions
          </h1>
          <p className="text-muted-foreground mt-1">
            Pick a role on the left, then toggle the features it can use. Admin always has full access.
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

      {/* Role management (rename / delete / add) */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Manage Roles</CardTitle>
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
                <button
                  type="button"
                  onClick={() => {
                    setRoleToRename(role);
                    setRenameLabel(role.label);
                  }}
                  className="text-muted-foreground hover:text-foreground"
                  title="Rename"
                  data-testid={`button-rename-role-${role.name}`}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
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

      {/* Role-centric configuration */}
      <Card>
        <CardContent className="p-0">
          <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] min-h-[500px]">
            {/* Left rail: role list */}
            <div className="border-b lg:border-b-0 lg:border-r bg-muted/30">
              <div className="p-4 border-b">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Choose a role
                </div>
              </div>
              <ScrollArea className="lg:h-[calc(100vh-22rem)] max-h-[60vh]">
                <div className="p-2 flex flex-col gap-1">
                  {roles.map(role => {
                    const isSelected = role.name === selectedRole;
                    const granted = role.name === "admin" ? totalPerms : grantedCountFor(role.name);
                    const isDirty = dirtyRoles.has(role.name);
                    return (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => setSelectedRole(role.name)}
                        className={`w-full text-left px-3 py-2 rounded-md flex items-center justify-between gap-2 transition-colors ${
                          isSelected
                            ? "bg-primary text-primary-foreground"
                            : "hover-elevate active-elevate-2"
                        }`}
                        data-testid={`button-select-role-${role.name}`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {isDirty && (
                            <Circle
                              className={`w-2 h-2 fill-current flex-shrink-0 ${
                                isSelected ? "text-primary-foreground" : "text-amber-500"
                              }`}
                              data-testid={`indicator-unsaved-${role.name}`}
                            />
                          )}
                          <span className="font-medium truncate">{role.label}</span>
                          {role.name === "admin" && (
                            <Lock className={`w-3 h-3 flex-shrink-0 ${isSelected ? "text-primary-foreground/70" : "text-muted-foreground"}`} />
                          )}
                        </div>
                        <Badge
                          variant={isSelected ? "outline" : "secondary"}
                          className={`text-xs flex-shrink-0 ${
                            isSelected ? "bg-primary-foreground/10 text-primary-foreground border-primary-foreground/30" : ""
                          }`}
                          data-testid={`badge-count-${role.name}`}
                        >
                          {granted}/{totalPerms}
                        </Badge>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>

            {/* Right pane: permissions for the selected role */}
            <div className="flex flex-col">
              <div className="p-4 border-b flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <h3 className="text-base font-semibold" data-testid="text-selected-role-label">
                    {selectedRoleObj?.label || selectedRole}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {isAdminSelected
                      ? "Admin has full access to every feature and cannot be modified."
                      : `${grantedCountFor(selectedRole)} of ${totalPerms} features granted`}
                  </p>
                </div>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Filter features…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-8"
                    data-testid="input-search-permissions"
                  />
                </div>
              </div>

              <ScrollArea className="lg:h-[calc(100vh-22rem)] max-h-[60vh]">
                <div className="p-2">
                  {groupedFiltered.orderedCats.length === 0 ? (
                    <div className="text-center text-sm text-muted-foreground py-12" data-testid="text-no-results">
                      No features match "{search}".
                    </div>
                  ) : (
                    groupedFiltered.orderedCats.map(cat => {
                      const perms = groupedFiltered.grouped[cat];
                      const allOn = !isAdminSelected && perms.every(p => p.allowedRoles.includes(selectedRole));
                      const noneOn = !isAdminSelected && perms.every(p => !p.allowedRoles.includes(selectedRole));
                      const collapsed = collapsedCats[cat];
                      return (
                        <Collapsible
                          key={cat}
                          open={!collapsed}
                          onOpenChange={open => setCollapsedCats(s => ({ ...s, [cat]: !open }))}
                          className="mb-2"
                        >
                          <div
                            className="flex items-center justify-between gap-2 px-2 py-2 rounded-md hover-elevate"
                            data-testid={`category-header-${cat.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                          >
                            <CollapsibleTrigger asChild>
                              <button
                                type="button"
                                className="flex items-center gap-2 flex-1 text-left"
                                data-testid={`button-toggle-category-${cat.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                              >
                                {collapsed ? (
                                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                ) : (
                                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                )}
                                <span className="font-semibold text-sm">{cat}</span>
                                <Badge variant="secondary" className="text-xs ml-1">
                                  {isAdminSelected
                                    ? perms.length
                                    : perms.filter(p => p.allowedRoles.includes(selectedRole)).length}
                                  /{perms.length}
                                </Badge>
                              </button>
                            </CollapsibleTrigger>
                            {!isAdminSelected && (
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs"
                                  disabled={allOn}
                                  onClick={() => bulkSetCategory(cat, true)}
                                  data-testid={`button-grant-all-${cat.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                                >
                                  Grant all
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs"
                                  disabled={noneOn}
                                  onClick={() => bulkSetCategory(cat, false)}
                                  data-testid={`button-revoke-all-${cat.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                                >
                                  Revoke all
                                </Button>
                              </div>
                            )}
                          </div>
                          <CollapsibleContent>
                            <div className="pl-6 pr-2 py-1 flex flex-col">
                              {perms.map(perm => {
                                const checked = isAdminSelected
                                  ? true
                                  : perm.allowedRoles.includes(selectedRole);
                                return (
                                  <label
                                    key={perm.feature}
                                    className="flex items-center justify-between gap-3 py-2 px-2 rounded-md hover-elevate cursor-pointer"
                                    data-testid={`row-permission-${perm.feature}`}
                                  >
                                    <span
                                      className="text-sm"
                                      data-testid={`text-feature-label-${perm.feature}`}
                                    >
                                      {perm.label}
                                    </span>
                                    <Switch
                                      checked={checked}
                                      disabled={isAdminSelected}
                                      onCheckedChange={() => toggleRole(perm.feature, selectedRole)}
                                      data-testid={`switch-${perm.feature}-${selectedRole}`}
                                    />
                                  </label>
                                );
                              })}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!roleToRename} onOpenChange={open => { if (!open) { setRoleToRename(null); setRenameLabel(""); } }}>
        <DialogContent data-testid="dialog-rename-role">
          <DialogHeader>
            <DialogTitle>Rename role</DialogTitle>
            <DialogDescription>
              Change the display name for this role. The internal identifier stays the same so existing assignments continue to work.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="rename-role-label">Display name</Label>
            <Input
              id="rename-role-label"
              value={renameLabel}
              onChange={e => setRenameLabel(e.target.value)}
              placeholder="e.g. Store Manager"
              data-testid="input-rename-role-label"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setRoleToRename(null); setRenameLabel(""); }}
              data-testid="button-cancel-rename-role"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!roleToRename) return;
                const trimmed = renameLabel.trim();
                if (!trimmed) {
                  toast({ title: "Display name required", variant: "destructive" });
                  return;
                }
                renameRoleMutation.mutate({ name: roleToRename.name, label: trimmed });
              }}
              disabled={renameRoleMutation.isPending}
              data-testid="button-save-rename-role"
            >
              {renameRoleMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
