import { useUsers, useCreateUser, useUpdateUser, useDeleteUser, useCurrentUser } from "@/hooks/use-users";
import { useLocations } from "@/hooks/use-locations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { useState, useMemo } from "react";
import { Plus, MoreHorizontal, Pencil, Trash2, Users as UsersIcon, ShieldAlert, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import type { User, InsertUser } from "@shared/schema";
import { isValidLocation } from "@/lib/utils";

function formatLastLogin(date: string | Date | null | undefined): string {
  if (!date) return "Never";
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function Users() {
  const { data: currentUser } = useCurrentUser();
  const { data: users, isLoading } = useUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const { toast } = useToast();

  type SortColumn = "name" | "email" | "role" | "stores" | "lastLogin";
  type SortDir = "asc" | "desc";
  const [sortColumn, setSortColumn] = useState<SortColumn>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState<Partial<InsertUser>>({
    name: "",
    email: "",
    role: "viewer",
    locationIds: [],
    isActive: true,
  });

  const { data: locations } = useLocations();

  const isAdmin = currentUser?.user?.role === "admin";

  const openDialog = (user?: User) => {
    if (user) {
      setEditingUser(user);
      setFormData({
        name: user.name,
        email: user.email,
        role: user.role,
        locationIds: user.locationIds || [],
        isActive: user.isActive,
      });
    } else {
      setEditingUser(null);
      setFormData({
        name: "",
        email: "",
        role: "viewer",
        locationIds: [],
        isActive: true,
      });
    }
    setIsDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingUser) {
        await updateUser.mutateAsync({ id: editingUser.id, ...formData });
        toast({ title: "User updated" });
      } else {
        await createUser.mutateAsync(formData as InsertUser);
        toast({ title: "User created" });
      }
      setIsDialogOpen(false);
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: "Failed to save user" });
    }
  };

  const handleDelete = async (user: User) => {
    if (user.id === currentUser?.user?.id) {
      toast({ variant: "destructive", title: "Error", description: "Cannot delete your own account" });
      return;
    }
    if (confirm("Are you sure you want to delete this user?")) {
      try {
        await deleteUser.mutateAsync(user.id);
        toast({ title: "User deleted" });
      } catch (err) {
        toast({ variant: "destructive", title: "Error", description: "Failed to delete user" });
      }
    }
  };

  const toggleLocationId = (locationId: string) => {
    const current = formData.locationIds || [];
    if (current.includes(locationId)) {
      setFormData({ ...formData, locationIds: current.filter(id => id !== locationId) });
    } else {
      setFormData({ ...formData, locationIds: [...current, locationId] });
    }
  };

  const getLocationName = (id: string) => {
    const loc = locations?.find(l => String(l.id) === id);
    return loc?.name || id;
  };

  const handleSort = (col: SortColumn) => {
    if (sortColumn === col) {
      setSortDir(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(col);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ col }: { col: SortColumn }) => {
    if (sortColumn !== col) return <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground/50" />;
    return sortDir === "asc" ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />;
  };

  const roleOrder: Record<string, number> = { admin: 0, manager: 1, optimizer: 2, viewer: 3 };

  const sortedUsers = useMemo(() => {
    if (!users) return [];
    return [...users].sort((a, b) => {
      let cmp = 0;
      switch (sortColumn) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "email":
          cmp = a.email.localeCompare(b.email);
          break;
        case "role":
          cmp = (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9);
          if (cmp === 0) cmp = a.name.localeCompare(b.name);
          break;
        case "stores": {
          const aCount = a.role === "admin" ? 999 : (a.locationIds?.length || 0);
          const bCount = b.role === "admin" ? 999 : (b.locationIds?.length || 0);
          cmp = aCount - bCount;
          if (cmp === 0) cmp = a.name.localeCompare(b.name);
          break;
        }
        case "lastLogin": {
          const aTime = a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0;
          const bTime = b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0;
          cmp = aTime - bTime;
          break;
        }
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [users, sortColumn, sortDir]);

  if (!isAdmin) {
    return (
      <div className="p-6 lg:p-10 max-w-[1200px] mx-auto">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <ShieldAlert className="w-12 h-12 text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2" data-testid="text-admin-required">Admin Access Required</h2>
            <p className="text-muted-foreground text-center" data-testid="text-admin-required-description">
              You need administrator privileges to manage users.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 lg:p-10 space-y-4 sm:space-y-6 max-w-[1200px] mx-auto">
      <div className="flex items-center justify-between gap-2 sm:gap-4 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-3xl font-bold font-display flex items-center gap-2 sm:gap-3" data-testid="text-page-title">
            <UsersIcon className="w-5 h-5 sm:w-8 sm:h-8" />
            User Administration
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">Manage user access and roles.</p>
        </div>
        <Button onClick={() => openDialog()} data-testid="button-add-user">
          <Plus className="w-4 h-4 mr-2" /> Add User
        </Button>
      </div>

      <Card>
        <CardHeader className="p-3 sm:p-6 pb-2 sm:pb-4">
          <CardTitle className="text-sm sm:text-base">Users</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Configure user roles and location access.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-3 sm:p-6 pt-0">
          {isLoading ? (
            <div className="py-12 text-center text-muted-foreground" data-testid="text-loading">Loading...</div>
          ) : users?.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground" data-testid="text-no-users">No users found</div>
          ) : (
            <>
              {/* Mobile card layout */}
              <div className="sm:hidden space-y-2">
                {sortedUsers.map(user => (
                  <div key={user.id} className="p-2.5 rounded border" data-testid={`row-user-${user.id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium text-sm" data-testid={`text-user-name-${user.id}`}>{user.name}</span>
                          <Badge
                            variant={user.role === "admin" ? "default" : user.role === "manager" ? "secondary" : user.role === "optimizer" ? "secondary" : "outline"}
                            className="text-[10px] capitalize"
                            data-testid={`badge-user-role-${user.id}`}
                          >
                            {user.role === "optimizer" ? "Store Optimizer" : user.role}
                          </Badge>
                          {!user.isActive && (
                            <Badge variant="destructive" className="text-[10px]" data-testid={`badge-user-inactive-${user.id}`}>
                              Inactive
                            </Badge>
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground truncate" data-testid={`text-user-email-${user.id}`}>
                          {user.email}
                        </p>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="shrink-0" data-testid={`button-user-menu-${user.id}`}>
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openDialog(user)} data-testid={`button-edit-user-${user.id}`}>
                            <Pencil className="w-4 h-4 mr-2" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleDelete(user)}
                            className="text-destructive focus:text-destructive"
                            disabled={user.id === currentUser?.user?.id}
                            data-testid={`button-delete-user-${user.id}`}
                          >
                            <Trash2 className="w-4 h-4 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <div className="text-[10px] text-muted-foreground" data-testid={`text-user-stores-${user.id}`}>
                        {user.role === "admin" ? (
                          <span className="italic">All stores</span>
                        ) : user.locationIds && user.locationIds.length > 0 ? (
                          <span>{user.locationIds.map(id => getLocationName(id)).join(", ")}</span>
                        ) : (
                          <span>No stores</span>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0" data-testid={`text-user-last-login-${user.id}`}>
                        {formatLastLogin(user.lastLoginAt)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop table layout */}
              <div className="hidden sm:block">
                <Table data-testid="table-users">
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <button onClick={() => handleSort("name")} className="flex items-center gap-1.5 hover-elevate px-1 py-0.5 rounded" data-testid="button-sort-name">
                          Name <SortIcon col="name" />
                        </button>
                      </TableHead>
                      <TableHead>
                        <button onClick={() => handleSort("role")} className="flex items-center gap-1.5 hover-elevate px-1 py-0.5 rounded" data-testid="button-sort-role">
                          Role <SortIcon col="role" />
                        </button>
                      </TableHead>
                      <TableHead>
                        <button onClick={() => handleSort("email")} className="flex items-center gap-1.5 hover-elevate px-1 py-0.5 rounded" data-testid="button-sort-email">
                          Login Email <SortIcon col="email" />
                        </button>
                      </TableHead>
                      <TableHead>
                        <button onClick={() => handleSort("stores")} className="flex items-center gap-1.5 hover-elevate px-1 py-0.5 rounded" data-testid="button-sort-stores">
                          Accessible Stores <SortIcon col="stores" />
                        </button>
                      </TableHead>
                      <TableHead className="text-right">
                        <button onClick={() => handleSort("lastLogin")} className="flex items-center gap-1.5 hover-elevate px-1 py-0.5 rounded ml-auto" data-testid="button-sort-last-login">
                          Last Login <SortIcon col="lastLogin" />
                        </button>
                      </TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedUsers.map(user => (
                      <TableRow key={user.id} data-testid={`row-user-desktop-${user.id}`}>
                        <TableCell>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium" data-testid={`text-user-name-${user.id}`}>{user.name}</span>
                            {!user.isActive && (
                              <Badge variant="destructive" className="text-xs" data-testid={`badge-user-inactive-${user.id}`}>
                                Inactive
                              </Badge>
                            )}
                          </div>
                        </TableCell>

                        <TableCell>
                          <Badge
                            variant={user.role === "admin" ? "default" : user.role === "manager" ? "secondary" : user.role === "optimizer" ? "secondary" : "outline"}
                            className="text-xs capitalize"
                            data-testid={`badge-user-role-${user.id}`}
                          >
                            {user.role === "optimizer" ? "Store Optimizer" : user.role}
                          </Badge>
                        </TableCell>

                        <TableCell>
                          <span className="text-muted-foreground" data-testid={`text-user-email-${user.id}`}>
                            {user.email}
                          </span>
                        </TableCell>

                        <TableCell>
                          {user.role === "admin" ? (
                            <span className="text-muted-foreground italic" data-testid={`text-user-stores-${user.id}`}>All stores</span>
                          ) : user.locationIds && user.locationIds.length > 0 ? (
                            <div className="flex flex-wrap gap-1" data-testid={`text-user-stores-${user.id}`}>
                              {user.locationIds.map(id => (
                                <Badge key={id} variant="outline" className="text-xs font-normal" data-testid={`badge-user-location-${user.id}-${id}`}>
                                  {getLocationName(id)}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground" data-testid={`text-user-stores-${user.id}`}>None assigned</span>
                          )}
                        </TableCell>

                        <TableCell className="text-right">
                          <span className="text-muted-foreground" data-testid={`text-user-last-login-${user.id}`}>
                            {formatLastLogin(user.lastLoginAt)}
                          </span>
                        </TableCell>

                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" data-testid={`button-user-menu-${user.id}`}>
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openDialog(user)} data-testid={`button-edit-user-${user.id}`}>
                                <Pencil className="w-4 h-4 mr-2" /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleDelete(user)}
                                className="text-destructive focus:text-destructive"
                                disabled={user.id === currentUser?.user?.id}
                                data-testid={`button-delete-user-${user.id}`}
                              >
                                <Trash2 className="w-4 h-4 mr-2" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle data-testid="text-dialog-title">{editingUser ? "Edit User" : "Add User"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4" data-testid="form-user">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={formData.name || ""}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                required
                data-testid="input-user-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={formData.email || ""}
                onChange={e => setFormData({ ...formData, email: e.target.value })}
                required
                data-testid="input-user-email"
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={formData.role || "viewer"}
                onValueChange={v => setFormData({ ...formData, role: v })}
              >
                <SelectTrigger data-testid="select-user-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin" data-testid="option-role-admin">Admin</SelectItem>
                  <SelectItem value="manager" data-testid="option-role-manager">Manager</SelectItem>
                  <SelectItem value="optimizer" data-testid="option-role-optimizer">Store Optimizer</SelectItem>
                  <SelectItem value="viewer" data-testid="option-role-viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Admins have full access. Managers can only see employees from their locations. Viewers have read-only access.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Assigned Locations</Label>
              <div className="max-h-40 overflow-y-auto border rounded-md p-2 space-y-1" data-testid="list-locations">
                {locations
                  ?.slice()
                  .filter(isValidLocation)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map(loc => (
                    <label
                      key={loc.id}
                      className="flex items-center gap-2 p-2 hover:bg-muted/50 rounded cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={(formData.locationIds || []).includes(String(loc.id))}
                        onChange={() => toggleLocationId(String(loc.id))}
                        className="rounded"
                        data-testid={`checkbox-location-${loc.id}`}
                      />
                      <span className="text-sm">{loc.name}</span>
                    </label>
                  ))}
                {(!locations || locations.length === 0) && (
                  <p className="text-sm text-muted-foreground p-2">No locations available</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {formData.role === "manager" || formData.role === "optimizer"
                  ? formData.role === "optimizer" 
                    ? "Store Optimizers can only access the Store Optimization section."
                    : "Managers will only see employees from their assigned locations."
                  : "Users are automatically assigned locations based on their employee record."}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isActive"
                checked={formData.isActive !== false}
                onChange={e => setFormData({ ...formData, isActive: e.target.checked })}
                className="rounded"
                data-testid="checkbox-user-active"
              />
              <Label htmlFor="isActive" className="cursor-pointer">Active</Label>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} data-testid="button-cancel-user">
                Cancel
              </Button>
              <Button type="submit" disabled={createUser.isPending || updateUser.isPending} data-testid="button-save-user">
                {editingUser ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
