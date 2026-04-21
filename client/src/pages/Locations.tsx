import { useState } from "react";
import { MapPin, Pencil, Save, X } from "lucide-react";
import { useLocations, useUpdateLocation } from "@/hooks/use-locations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import type { Location } from "@shared/schema";
import { isValidLocation } from "@/lib/utils";

interface AuthStatus {
  isAuthenticated: boolean;
  user: { id: number; name: string; email: string; role: string; locationIds?: string[] } | null;
}

export default function Locations() {
  const { toast } = useToast();
  const { data: locations, isLoading } = useLocations();
  const updateLocation = useUpdateLocation();
  
  const { data: authStatus } = useQuery<AuthStatus>({
    queryKey: ["/api/auth/status"],
  });
  
  const isAdmin = authStatus?.user?.role === "admin";
  const userLocationIds = authStatus?.user?.locationIds || [];
  
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingHours, setEditingHours] = useState<string>("");
  const [editingEmail, setEditingEmail] = useState<string>("");
  const [editingOrderFormName, setEditingOrderFormName] = useState<string>("");

  const handleEdit = (location: Location) => {
    setEditingId(location.id);
    setEditingHours(location.weeklyHoursLimit.toString());
    setEditingEmail(location.notificationEmail ?? "");
    setEditingOrderFormName(location.orderFormName ?? "");
  };

  const handleSave = async (id: number) => {
    const hours = parseInt(editingHours);
    
    if (isNaN(hours) || hours < 0) {
      toast({ variant: "destructive", title: "Invalid value", description: "Please enter a valid number of hours (0 or greater)." });
      return;
    }

    const trimmedEmail = editingEmail.trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      toast({ variant: "destructive", title: "Invalid email", description: "Please enter a valid email address." });
      return;
    }

    const trimmedOrderFormName = editingOrderFormName.trim();

    try {
      await updateLocation.mutateAsync({
        id,
        weeklyHoursLimit: hours,
        notificationEmail: trimmedEmail || null,
        orderFormName: trimmedOrderFormName || null,
      });
      toast({ title: "Settings updated", description: "Store settings have been saved." });
      setEditingId(null);
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to update store settings." });
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditingHours("");
    setEditingEmail("");
    setEditingOrderFormName("");
  };

  const handleToggleScheduling = async (location: Location) => {
    try {
      await updateLocation.mutateAsync({
        id: location.id,
        availableForScheduling: !location.availableForScheduling,
      });
      toast({
        title: location.availableForScheduling ? "Removed from Scheduling" : "Added to Scheduling",
        description: `${location.name} is now ${location.availableForScheduling ? "hidden from" : "shown in"} scheduling, roster, and task assignment.`,
      });
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to update scheduling availability." });
    }
  };

  const handleToggleOrderForm = async (location: Location) => {
    try {
      await updateLocation.mutateAsync({
        id: location.id,
        availableForOrderForm: !location.availableForOrderForm,
      });
      toast({
        title: location.availableForOrderForm ? "Removed from Order Form" : "Added to Order Form",
        description: `${location.orderFormName || location.name} is now ${location.availableForOrderForm ? "hidden from" : "shown in"} the Order Form.`,
      });
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to update Order Form availability." });
    }
  };

  const handleToggleActive = async (location: Location) => {
    try {
      await updateLocation.mutateAsync({ 
        id: location.id, 
        isActive: !location.isActive 
      });
      toast({ 
        title: location.isActive ? "Location disabled" : "Location enabled", 
        description: `${location.name} is now ${location.isActive ? "disabled" : "enabled"}.` 
      });
    } catch (error) {
      toast({ 
        variant: "destructive", 
        title: "Error", 
        description: "Failed to update location status." 
      });
    }
  };

  // Filter out invalid/excluded locations; managers further restricted to their assigned locations
  // Admins can see inactive locations (to re-enable them), but excluded names are always hidden
  const displayedLocations = (locations?.filter(l => {
    if (isAdmin) {
      return isValidLocation({ ...l, isActive: true });
    }
    if (!isValidLocation(l)) return false;
    return userLocationIds.includes(String(l.id));
  }) || []);
  
  const totalHours = displayedLocations.reduce((sum, loc) => sum + loc.weeklyHoursLimit, 0);
  const activeLocations = displayedLocations.filter(loc => loc.isActive).length;

  if (isLoading) {
    return (
      <div className="p-3 sm:p-6 lg:p-10 space-y-4 sm:space-y-6 max-w-[1200px] mx-auto">
        <Skeleton className="h-8 sm:h-12 w-48 sm:w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 lg:p-10 space-y-4 sm:space-y-8 max-w-[1200px] mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-3xl font-bold text-foreground flex items-center gap-2 sm:gap-3">
            <MapPin className="w-5 h-5 sm:w-8 sm:h-8 text-primary" />
            Store Locations
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Set the weekly hours budget for each store.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <Card>
          <CardHeader className="p-3 sm:p-6 pb-2">
            <CardDescription className="text-[10px] sm:text-sm">Total Locations</CardDescription>
            <CardTitle className="text-xl sm:text-2xl">{displayedLocations.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="p-3 sm:p-6 pb-2">
            <CardDescription className="text-[10px] sm:text-sm">Active</CardDescription>
            <CardTitle className="text-xl sm:text-2xl">{activeLocations}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="p-3 sm:p-6 pb-2">
            <CardDescription className="text-[10px] sm:text-sm">Total Hours</CardDescription>
            <CardTitle className="text-xl sm:text-2xl">{totalHours.toLocaleString()}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader className="p-3 sm:p-6 pb-2 sm:pb-4">
          <CardTitle className="text-sm sm:text-base">Store Settings</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Configure the weekly hours budget per store.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-3 sm:p-6 pt-0">
          {displayedLocations.length === 0 ? (
            <div className="text-center text-muted-foreground py-8 text-sm">
              No locations found. Locations will be added automatically when employees are synced.
            </div>
          ) : (
            <>
              {/* Mobile card layout */}
              <div className="sm:hidden space-y-2">
                {displayedLocations
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((location) => (
                  <div
                    key={location.id}
                    className="p-2.5 rounded border bg-muted/50"
                    data-testid={`row-location-${location.id}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-sm truncate">{location.name}</span>
                        {isAdmin && (
                          <Badge variant={location.isActive ? "default" : "secondary"} className="text-[10px] shrink-0">
                            {location.isActive ? "Active" : "Off"}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {isAdmin && (
                          <Switch
                            checked={location.isActive}
                            onCheckedChange={() => handleToggleActive(location)}
                            disabled={updateLocation.isPending}
                            data-testid={`switch-active-${location.id}`}
                          />
                        )}
                        {editingId === location.id ? (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleSave(location.id)}
                              disabled={updateLocation.isPending}
                              data-testid={`button-save-${location.id}`}
                            >
                              <Save className="w-4 h-4 text-green-600" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={handleCancel}
                              data-testid={`button-cancel-${location.id}`}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleEdit(location)}
                            data-testid={`button-edit-${location.id}`}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                    {editingId === location.id ? (
                      <div className="space-y-2">
                        <div className="space-y-1">
                          <p className="text-[10px] text-muted-foreground">Weekly Hrs</p>
                          <Input
                            type="number"
                            value={editingHours}
                            onChange={(e) => setEditingHours(e.target.value)}
                            min="0"
                            className="h-8 text-sm w-28"
                            data-testid={`input-hours-${location.id}`}
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] text-muted-foreground">Notification Email</p>
                          <Input
                            type="email"
                            value={editingEmail}
                            onChange={(e) => setEditingEmail(e.target.value)}
                            placeholder="store@goodwill.org"
                            className="h-8 text-sm"
                            data-testid={`input-email-${location.id}`}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs space-y-1">
                        <div>
                          <p className="text-[10px] text-muted-foreground">Weekly Hrs</p>
                          <p className="font-mono font-medium">{location.weeklyHoursLimit}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground">Notification Email</p>
                          <p className="font-medium truncate" data-testid={`text-email-${location.id}`}>{location.notificationEmail || <span className="text-muted-foreground italic">none</span>}</p>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Desktop table layout */}
              <div className="hidden sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Store Name</TableHead>
                      <TableHead>Weekly Hours</TableHead>
                      <TableHead>Notification Email</TableHead>
                      <TableHead>Order Form Name</TableHead>
                      {isAdmin && <TableHead>In Order Form</TableHead>}
                      {isAdmin && <TableHead>In Scheduling</TableHead>}
                      {isAdmin && <TableHead>Status</TableHead>}
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedLocations
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((location) => (
                      <TableRow key={location.id} data-testid={`row-location-desktop-${location.id}`}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <span>{location.name}</span>
                            {location.formOnly && (
                              <Badge variant="outline" className="text-[10px]" data-testid={`badge-form-only-${location.id}`}>
                                Order Form Only
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {editingId === location.id ? (
                            <Input
                              type="number"
                              value={editingHours}
                              onChange={(e) => setEditingHours(e.target.value)}
                              className="w-24"
                              min="0"
                              data-testid={`input-hours-${location.id}`}
                            />
                          ) : (
                            <span className="font-mono">{location.weeklyHoursLimit}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {editingId === location.id ? (
                            <Input
                              type="email"
                              value={editingEmail}
                              onChange={(e) => setEditingEmail(e.target.value)}
                              placeholder="store@goodwill.org"
                              className="w-64"
                              data-testid={`input-email-${location.id}`}
                            />
                          ) : (
                            <span className="text-sm" data-testid={`text-email-${location.id}`}>
                              {location.notificationEmail || <span className="text-muted-foreground italic">none</span>}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {editingId === location.id ? (
                            <Input
                              type="text"
                              value={editingOrderFormName}
                              onChange={(e) => setEditingOrderFormName(e.target.value)}
                              placeholder={location.name}
                              className="w-48"
                              data-testid={`input-order-form-name-${location.id}`}
                            />
                          ) : (
                            <span className="text-sm" data-testid={`text-order-form-name-${location.id}`}>
                              {location.orderFormName || <span className="text-muted-foreground italic">{location.name}</span>}
                            </span>
                          )}
                        </TableCell>
                        {isAdmin && (
                          <TableCell>
                            <Switch
                              checked={location.availableForOrderForm}
                              onCheckedChange={() => handleToggleOrderForm(location)}
                              disabled={updateLocation.isPending}
                              data-testid={`switch-order-form-${location.id}`}
                            />
                          </TableCell>
                        )}
                        {isAdmin && (
                          <TableCell>
                            <Switch
                              checked={location.availableForScheduling}
                              onCheckedChange={() => handleToggleScheduling(location)}
                              disabled={updateLocation.isPending}
                              data-testid={`switch-scheduling-${location.id}`}
                            />
                          </TableCell>
                        )}
                        {isAdmin && (
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={location.isActive}
                                onCheckedChange={() => handleToggleActive(location)}
                                disabled={updateLocation.isPending}
                                data-testid={`switch-active-${location.id}`}
                              />
                              <Badge variant={location.isActive ? "default" : "secondary"}>
                                {location.isActive ? "Active" : "Disabled"}
                              </Badge>
                            </div>
                          </TableCell>
                        )}
                        <TableCell className="text-right">
                          {editingId === location.id ? (
                            <div className="flex justify-end gap-2">
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => handleSave(location.id)}
                                disabled={updateLocation.isPending}
                                data-testid={`button-save-${location.id}`}
                              >
                                <Save className="w-4 h-4 text-green-600" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={handleCancel}
                                data-testid={`button-cancel-${location.id}`}
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleEdit(location)}
                              data-testid={`button-edit-${location.id}`}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                          )}
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
    </div>
  );
}
