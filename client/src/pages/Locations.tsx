import { useState } from "react";
import { MapPin, Plus, Pencil, Save, X, Trash2 } from "lucide-react";
import { useLocations, useUpdateLocation, useCreateLocation, useDeleteLocation } from "@/hooks/use-locations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { Location } from "@shared/schema";

export default function Locations() {
  const { toast } = useToast();
  const { data: locations, isLoading } = useLocations();
  const updateLocation = useUpdateLocation();
  const createLocation = useCreateLocation();
  const deleteLocation = useDeleteLocation();
  
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingHours, setEditingHours] = useState<string>("");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newLocationName, setNewLocationName] = useState("");
  const [newLocationHours, setNewLocationHours] = useState("0");

  const handleEdit = (location: Location) => {
    setEditingId(location.id);
    setEditingHours(location.weeklyHoursLimit.toString());
  };

  const handleSave = async (id: number) => {
    const hours = parseInt(editingHours);
    if (isNaN(hours) || hours < 0) {
      toast({ variant: "destructive", title: "Invalid hours", description: "Please enter a valid number of hours." });
      return;
    }
    
    try {
      await updateLocation.mutateAsync({ id, weeklyHoursLimit: hours });
      toast({ title: "Hours updated", description: "Store hours have been saved." });
      setEditingId(null);
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to update store hours." });
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditingHours("");
  };

  const handleAddLocation = async () => {
    if (!newLocationName.trim()) {
      toast({ variant: "destructive", title: "Name required", description: "Please enter a location name." });
      return;
    }
    
    const hours = parseInt(newLocationHours);
    if (isNaN(hours) || hours < 0) {
      toast({ variant: "destructive", title: "Invalid hours", description: "Please enter a valid number of hours." });
      return;
    }

    try {
      await createLocation.mutateAsync({ 
        name: newLocationName.trim(), 
        weeklyHoursLimit: hours,
        isActive: true 
      });
      toast({ title: "Location added", description: "New store location has been created." });
      setShowAddDialog(false);
      setNewLocationName("");
      setNewLocationHours("0");
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to add location." });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteLocation.mutateAsync(id);
      toast({ title: "Location deleted", description: "Store location has been removed." });
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to delete location." });
    }
  };

  const totalHours = locations?.reduce((sum, loc) => sum + loc.weeklyHoursLimit, 0) || 0;
  const activeLocations = locations?.filter(loc => loc.isActive).length || 0;

  if (isLoading) {
    return (
      <div className="p-6 lg:p-10 space-y-6 max-w-[1200px] mx-auto">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-10 space-y-8 max-w-[1200px] mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <MapPin className="w-8 h-8 text-primary" />
            Store Locations
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage weekly hours allocation for each store
          </p>
        </div>
        
        <Button 
          onClick={() => setShowAddDialog(true)}
          className="bg-primary shadow-lg shadow-primary/25"
          data-testid="button-add-location"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Location
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Locations</CardDescription>
            <CardTitle className="text-2xl">{locations?.length || 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active Locations</CardDescription>
            <CardTitle className="text-2xl">{activeLocations}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Allocated Hours</CardDescription>
            <CardTitle className="text-2xl">{totalHours.toLocaleString()}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Store Hours Allocation</CardTitle>
          <CardDescription>
            Set the weekly hours budget for each store location. Managers will see these hours when scheduling.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store Name</TableHead>
                <TableHead>Weekly Hours</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {locations?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    No locations found. Locations will be added automatically when employees are synced from UKG.
                  </TableCell>
                </TableRow>
              ) : (
                locations?.map((location) => (
                  <TableRow key={location.id} data-testid={`row-location-${location.id}`}>
                    <TableCell className="font-medium">{location.name}</TableCell>
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
                      <Badge variant={location.isActive ? "default" : "secondary"}>
                        {location.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
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
                        <div className="flex justify-end gap-2">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleEdit(location)}
                            data-testid={`button-edit-${location.id}`}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleDelete(location.id)}
                            disabled={deleteLocation.isPending}
                            data-testid={`button-delete-${location.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Location</DialogTitle>
            <DialogDescription>
              Create a new store location and set its weekly hours allocation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Location Name</Label>
              <Input
                id="name"
                value={newLocationName}
                onChange={(e) => setNewLocationName(e.target.value)}
                placeholder="Enter store name"
                data-testid="input-new-location-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hours">Weekly Hours</Label>
              <Input
                id="hours"
                type="number"
                value={newLocationHours}
                onChange={(e) => setNewLocationHours(e.target.value)}
                min="0"
                data-testid="input-new-location-hours"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleAddLocation}
              disabled={createLocation.isPending}
              data-testid="button-confirm-add-location"
            >
              Add Location
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
