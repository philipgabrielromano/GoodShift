import { useMemo, useState } from "react";
import { MapPin, Pencil, Search } from "lucide-react";
import { useLocations, useUpdateLocation } from "@/hooks/use-locations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import type { Location } from "@shared/schema";
import { isValidLocation } from "@/lib/utils";
import { cn } from "@/lib/utils";

type SurfaceKey = "availableForOrderForm" | "availableForScheduling" | "availableForRosterTargets";

const SURFACES: { key: SurfaceKey; label: string; short: string; description: string }[] = [
  { key: "availableForOrderForm",    label: "Order Form",    short: "Order",  description: "Appears in the Order Form location dropdown." },
  { key: "availableForScheduling",   label: "Scheduling",    short: "Sched",  description: "Appears in Schedule, Task Assignment, and Optimization pickers." },
  { key: "availableForRosterTargets", label: "Roster Targets", short: "Roster", description: "Appears in the Roster Targets page dropdown." },
];

// Surface flags default to true on legacy rows where the column is undefined.
// Keep this in sync with the helpers in client/src/lib/utils.ts so the UI
// matches runtime filter behavior.
function isSurfaceOn(loc: Location, key: SurfaceKey): boolean {
  return loc[key] !== false;
}

export default function Locations({ embedded = false }: { embedded?: boolean } = {}) {
  const { toast } = useToast();
  const { data: locations, isLoading } = useLocations();
  const updateLocation = useUpdateLocation();

  const { user, role } = usePermissions();
  const isAdmin = role === "admin";
  const userLocationIds = user?.locationIds ?? [];

  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftHours, setDraftHours] = useState("");
  const [draftEmail, setDraftEmail] = useState("");
  const [draftOrderFormName, setDraftOrderFormName] = useState("");
  const [draftSchedulingName, setDraftSchedulingName] = useState("");

  const editingLocation = useMemo(
    () => (editingId == null ? null : locations?.find(l => l.id === editingId) ?? null),
    [editingId, locations],
  );

  const openEditor = (location: Location) => {
    setEditingId(location.id);
    setDraftHours(String(location.weeklyHoursLimit));
    setDraftEmail(location.notificationEmail ?? "");
    setDraftOrderFormName(location.orderFormName ?? "");
    setDraftSchedulingName(location.schedulingName ?? "");
  };

  const closeEditor = () => setEditingId(null);

  const saveDetails = async () => {
    if (!editingLocation) return;
    const hours = parseInt(draftHours, 10);
    if (isNaN(hours) || hours < 0) {
      toast({ variant: "destructive", title: "Invalid value", description: "Please enter a valid number of hours (0 or greater)." });
      return;
    }
    const trimmedEmail = draftEmail.trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      toast({ variant: "destructive", title: "Invalid email", description: "Please enter a valid email address." });
      return;
    }
    try {
      await updateLocation.mutateAsync({
        id: editingLocation.id,
        weeklyHoursLimit: hours,
        notificationEmail: trimmedEmail || null,
        orderFormName: draftOrderFormName.trim() || null,
        schedulingName: draftSchedulingName.trim() || null,
      });
      toast({ title: "Location updated", description: `${editingLocation.name} settings saved.` });
      closeEditor();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to update location settings." });
    }
  };

  const toggleSurface = async (location: Location, key: SurfaceKey) => {
    const next = !isSurfaceOn(location, key);
    try {
      await updateLocation.mutateAsync({ id: location.id, [key]: next });
      const meta = SURFACES.find(s => s.key === key)!;
      toast({
        title: next ? `Added to ${meta.label}` : `Removed from ${meta.label}`,
        description: `${location.name} is now ${next ? "shown in" : "hidden from"} ${meta.label}.`,
      });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to update visibility." });
    }
  };

  const handleSetWarehouse = async (location: Location, value: string) => {
    const next = value === "none" ? null : value;
    try {
      await updateLocation.mutateAsync({ id: location.id, warehouseAssignment: next });
      toast({
        title: "Warehouse assignment updated",
        description: next
          ? `${location.name} now feeds the ${next.charAt(0).toUpperCase() + next.slice(1)} warehouse.`
          : `${location.name} is no longer assigned to a warehouse.`,
      });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to update warehouse assignment." });
    }
  };

  const handleToggleActive = async (location: Location) => {
    try {
      await updateLocation.mutateAsync({ id: location.id, isActive: !location.isActive });
      toast({
        title: location.isActive ? "Location disabled" : "Location enabled",
        description: `${location.name} is now ${location.isActive ? "disabled" : "enabled"}.`,
      });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to update location status." });
    }
  };

  // Filter out invalid/excluded locations; managers further restricted to their assigned locations
  // Admins can see inactive locations (to re-enable them), but excluded names are always hidden
  const allDisplayed = useMemo(() => (locations?.filter(l => {
    if (isAdmin) return isValidLocation({ ...l, isActive: true });
    if (!isValidLocation(l)) return false;
    return userLocationIds.includes(String(l.id));
  }) || []), [locations, isAdmin, userLocationIds]);

  const displayedLocations = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? allDisplayed.filter(l => l.name.toLowerCase().includes(q)) : allDisplayed;
    return list.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [allDisplayed, search]);

  const totalHours = allDisplayed.reduce((sum, loc) => sum + loc.weeklyHoursLimit, 0);
  const activeLocations = allDisplayed.filter(loc => loc.isActive).length;

  if (isLoading) {
    return (
      <div className={embedded ? "space-y-4 sm:space-y-6" : "p-3 sm:p-6 lg:p-10 space-y-4 sm:space-y-6 max-w-[1200px] mx-auto"}>
        <Skeleton className="h-8 sm:h-12 w-48 sm:w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className={embedded ? "space-y-4 sm:space-y-8" : "p-3 sm:p-6 lg:p-10 space-y-4 sm:space-y-8 max-w-[1200px] mx-auto"}>
      {!embedded && (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 sm:gap-4">
          <div>
            <h1 className="text-xl sm:text-3xl font-bold text-foreground flex items-center gap-2 sm:gap-3">
              <MapPin className="w-5 h-5 sm:w-8 sm:h-8 text-primary" />
              Store Locations
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              Configure each store's hours, warehouse routing, and where it appears in the app.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <Card>
          <CardHeader className="p-3 sm:p-6 pb-2">
            <CardDescription className="text-[10px] sm:text-sm">Total Locations</CardDescription>
            <CardTitle className="text-xl sm:text-2xl" data-testid="stat-total-locations">{allDisplayed.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="p-3 sm:p-6 pb-2">
            <CardDescription className="text-[10px] sm:text-sm">Active</CardDescription>
            <CardTitle className="text-xl sm:text-2xl" data-testid="stat-active-locations">{activeLocations}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="p-3 sm:p-6 pb-2">
            <CardDescription className="text-[10px] sm:text-sm">Total Hours</CardDescription>
            <CardTitle className="text-xl sm:text-2xl" data-testid="stat-total-hours">{totalHours.toLocaleString()}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader className="p-3 sm:p-6 pb-2 sm:pb-4 gap-3">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
            <div>
              <CardTitle className="text-sm sm:text-base">Store Settings</CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Click a row's <span className="font-medium">Edit</span> button to configure hours, alternate names, and notification email.
              </CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search locations..."
                className="pl-8 h-9"
                data-testid="input-locations-search"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-3 sm:p-6 pt-0">
          {displayedLocations.length === 0 ? (
            <div className="text-center text-muted-foreground py-8 text-sm">
              {search.trim()
                ? `No locations match "${search.trim()}".`
                : "No locations found. Locations will be added automatically when employees are synced."}
            </div>
          ) : (
            <>
              {/* Mobile card layout */}
              <div className="sm:hidden space-y-2">
                {displayedLocations.map((location) => (
                  <div
                    key={location.id}
                    className="p-2.5 rounded border bg-muted/50 space-y-2"
                    data-testid={`row-location-${location.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-sm truncate">{location.name}</span>
                        {isAdmin && (
                          <Badge variant={location.isActive ? "default" : "secondary"} className="text-[10px] shrink-0">
                            {location.isActive ? "Active" : "Off"}
                          </Badge>
                        )}
                        {location.formOnly && (
                          <Badge variant="outline" className="text-[10px] shrink-0">Order Form Only</Badge>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEditor(location)}
                        className="shrink-0 h-8 px-2"
                        data-testid={`button-edit-${location.id}`}
                      >
                        <Pencil className="w-3.5 h-3.5 mr-1" />
                        Edit
                      </Button>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Weekly Hrs</span>
                      <span className="font-mono font-medium">{location.weeklyHoursLimit}</span>
                    </div>
                    {isAdmin && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {SURFACES.map(({ key, short }) => (
                          <SurfaceChip
                            key={key}
                            on={isSurfaceOn(location, key)}
                            label={short}
                            onClick={() => toggleSurface(location, key)}
                            disabled={updateLocation.isPending}
                            testId={`chip-${key}-${location.id}`}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Desktop table — slim, scannable, no horizontal scroll */}
              <div className="hidden sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Store Name</TableHead>
                      <TableHead className="w-[100px]">Weekly Hrs</TableHead>
                      {isAdmin && <TableHead className="w-[140px]">Warehouse</TableHead>}
                      {isAdmin && <TableHead className="w-[110px]">Status</TableHead>}
                      {isAdmin && <TableHead>Where it appears</TableHead>}
                      <TableHead className="text-right w-[90px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedLocations.map((location) => (
                      <TableRow key={location.id} data-testid={`row-location-desktop-${location.id}`}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span>{location.name}</span>
                            {location.formOnly && (
                              <Badge variant="outline" className="text-[10px]" data-testid={`badge-form-only-${location.id}`}>
                                Order Form Only
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono">{location.weeklyHoursLimit}</TableCell>
                        {isAdmin && (
                          <TableCell>
                            <Select
                              value={location.warehouseAssignment || "none"}
                              onValueChange={(v) => handleSetWarehouse(location, v)}
                              disabled={updateLocation.isPending}
                            >
                              <SelectTrigger className="w-32 h-8" data-testid={`select-warehouse-${location.id}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">— None —</SelectItem>
                                <SelectItem value="cleveland">Cleveland</SelectItem>
                                <SelectItem value="canton">Canton</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                        )}
                        {isAdmin && (
                          <TableCell>
                            <button
                              type="button"
                              onClick={() => handleToggleActive(location)}
                              disabled={updateLocation.isPending}
                              className="cursor-pointer disabled:cursor-not-allowed"
                              data-testid={`button-active-${location.id}`}
                              aria-label={location.isActive ? "Disable location" : "Enable location"}
                            >
                              <Badge
                                variant={location.isActive ? "default" : "secondary"}
                                className={cn(
                                  "transition-opacity",
                                  updateLocation.isPending && "opacity-50",
                                )}
                              >
                                {location.isActive ? "Active" : "Disabled"}
                              </Badge>
                            </button>
                          </TableCell>
                        )}
                        {isAdmin && (
                          <TableCell>
                            <div className="flex flex-wrap gap-1.5">
                              {SURFACES.map(({ key, short, description }) => (
                                <SurfaceChip
                                  key={key}
                                  on={isSurfaceOn(location, key)}
                                  label={short}
                                  title={description}
                                  onClick={() => toggleSurface(location, key)}
                                  disabled={updateLocation.isPending}
                                  testId={`chip-${key}-${location.id}`}
                                />
                              ))}
                            </div>
                          </TableCell>
                        )}
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEditor(location)}
                            data-testid={`button-edit-${location.id}`}
                            className="h-8 px-2"
                          >
                            <Pencil className="w-3.5 h-3.5 mr-1" />
                            Edit
                          </Button>
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

      {/* Side drawer — full configuration of a single location */}
      <Sheet open={editingLocation != null} onOpenChange={(open) => { if (!open) closeEditor(); }}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          {editingLocation && (
            <>
              <SheetHeader className="text-left">
                <SheetTitle data-testid="text-edit-location-name">{editingLocation.name}</SheetTitle>
                <SheetDescription>
                  Configure hours, alternate names, and notifications for this store. Visibility toggles and warehouse can also be changed here.
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-5 py-6">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-hours">Weekly Hours Budget</Label>
                  <Input
                    id="edit-hours"
                    type="number"
                    min="0"
                    value={draftHours}
                    onChange={(e) => setDraftHours(e.target.value)}
                    data-testid="input-edit-hours"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="edit-email">Notification Email</Label>
                  <Input
                    id="edit-email"
                    type="email"
                    value={draftEmail}
                    onChange={(e) => setDraftEmail(e.target.value)}
                    placeholder="store@goodwill.org"
                    data-testid="input-edit-email"
                  />
                  <p className="text-xs text-muted-foreground">
                    Destination address for trailer-in-transit notifications.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="edit-order-form-name">Order Form Name</Label>
                  <Input
                    id="edit-order-form-name"
                    type="text"
                    value={draftOrderFormName}
                    onChange={(e) => setDraftOrderFormName(e.target.value)}
                    placeholder={editingLocation.name}
                    data-testid="input-edit-order-form-name"
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional alias shown in the Order Form dropdown.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="edit-scheduling-name">Scheduling Name</Label>
                  <Input
                    id="edit-scheduling-name"
                    type="text"
                    value={draftSchedulingName}
                    onChange={(e) => setDraftSchedulingName(e.target.value)}
                    placeholder={editingLocation.name}
                    data-testid="input-edit-scheduling-name"
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional alias shown in scheduling, roster, and task assignment.
                  </p>
                </div>

                {isAdmin && (
                  <div className="space-y-3 rounded-md border p-3">
                    <div>
                      <p className="text-sm font-medium">Where it appears</p>
                      <p className="text-xs text-muted-foreground">
                        Toggle which sections of the app list this location.
                      </p>
                    </div>
                    {SURFACES.map(({ key, label, description }) => (
                      <div key={key} className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Label htmlFor={`switch-edit-${key}`} className="text-sm">{label}</Label>
                          <p className="text-xs text-muted-foreground">{description}</p>
                        </div>
                        <Switch
                          id={`switch-edit-${key}`}
                          checked={isSurfaceOn(editingLocation, key)}
                          onCheckedChange={() => toggleSurface(editingLocation, key)}
                          disabled={updateLocation.isPending}
                          data-testid={`switch-edit-${key}`}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {isAdmin && (
                  <div className="space-y-3 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">Active</p>
                        <p className="text-xs text-muted-foreground">
                          Disabled locations are hidden from all dropdowns.
                        </p>
                      </div>
                      <Switch
                        checked={editingLocation.isActive}
                        onCheckedChange={() => handleToggleActive(editingLocation)}
                        disabled={updateLocation.isPending}
                        data-testid="switch-edit-active"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-warehouse">Warehouse</Label>
                      <Select
                        value={editingLocation.warehouseAssignment || "none"}
                        onValueChange={(v) => handleSetWarehouse(editingLocation, v)}
                        disabled={updateLocation.isPending}
                      >
                        <SelectTrigger id="edit-warehouse" data-testid="select-edit-warehouse">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— None —</SelectItem>
                          <SelectItem value="cleveland">Cleveland</SelectItem>
                          <SelectItem value="canton">Canton</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Which warehouse this store's orders draw from / return to.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <SheetFooter className="flex-row gap-2">
                <Button variant="outline" onClick={closeEditor} className="flex-1" data-testid="button-cancel-edit">
                  Cancel
                </Button>
                <Button onClick={saveDetails} disabled={updateLocation.isPending} className="flex-1" data-testid="button-save-edit">
                  {updateLocation.isPending ? "Saving..." : "Save changes"}
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

interface SurfaceChipProps {
  on: boolean;
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}

function SurfaceChip({ on, label, title, onClick, disabled, testId }: SurfaceChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-testid={testId}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition",
        "disabled:cursor-not-allowed disabled:opacity-50",
        on
          ? "bg-primary/10 text-primary border-primary/30 hover-elevate"
          : "bg-muted text-muted-foreground border-border hover-elevate",
      )}
      aria-pressed={on}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block w-1.5 h-1.5 rounded-full",
          on ? "bg-primary" : "bg-muted-foreground/40",
        )}
      />
      {label}
    </button>
  );
}
