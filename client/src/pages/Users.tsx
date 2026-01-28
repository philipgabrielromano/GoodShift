import { useUsers, useCreateUser, useUpdateUser, useDeleteUser, useCurrentUser } from "@/hooks/use-users";
import { useLocations } from "@/hooks/use-locations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useState } from "react";
import { Plus, MoreHorizontal, Pencil, Trash2, Users as UsersIcon, ShieldAlert } from "lucide-react";
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

export default function Users() {
  const { data: currentUser } = useCurrentUser();
  const { data: users, isLoading } = useUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const { toast } = useToast();

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

  if (!isAdmin) {
    return (
      <div className="p-6 lg:p-10 max-w-[1200px] mx-auto">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <ShieldAlert className="w-12 h-12 text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">Admin Access Required</h2>
            <p className="text-muted-foreground text-center">
              You need administrator privileges to manage users.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-10 space-y-6 max-w-[1200px] mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold font-display flex items-center gap-3">
            <UsersIcon className="w-8 h-8" />
            User Administration
          </h1>
          <p className="text-muted-foreground mt-1">Manage user access and roles.</p>
        </div>
        <Button onClick={() => openDialog()} data-testid="button-add-user">
          <Plus className="w-4 h-4 mr-2" /> Add User
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            Configure user roles and location access. Managers can only view employees from their assigned locations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-12 text-center text-muted-foreground">Loading...</div>
          ) : users?.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">No users found</div>
          ) : (
            <div className="divide-y">
              {users?.map(user => (
                <div 
                  key={user.id} 
                  className="flex items-center justify-between gap-4 py-4 hover-elevate px-2 rounded"
                  data-testid={`row-user-${user.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{user.name}</span>
                      <Badge 
                        variant={user.role === "admin" ? "default" : user.role === "manager" ? "secondary" : "outline"}
                      >
                        {user.role}
                      </Badge>
                      {!user.isActive && (
                        <Badge variant="destructive">Inactive</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                    {user.locationIds && user.locationIds.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Locations: {user.locationIds.map(id => {
                          const loc = locations?.find(l => String(l.id) === id);
                          return loc?.name || id;
                        }).join(", ")}
                      </p>
                    )}
                  </div>
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
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingUser ? "Edit User" : "Add User"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
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
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Admins have full access. Managers can only see employees from their locations. Viewers have read-only access.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Assigned Locations</Label>
              <div className="max-h-40 overflow-y-auto border rounded-md p-2 space-y-1">
                {locations
                  ?.slice()
                  .filter(loc => !/^Location \d+$/.test(loc.name))
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
                {formData.role === "manager" 
                  ? "Managers will only see employees from their assigned locations."
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
              />
              <Label htmlFor="isActive" className="cursor-pointer">Active</Label>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
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
