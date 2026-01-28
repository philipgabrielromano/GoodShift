import { useState } from "react";
import { Clock, Plus, Pencil, Trash2, Save, X } from "lucide-react";
import { useShiftPresets, useCreateShiftPreset, useUpdateShiftPreset, useDeleteShiftPreset } from "@/hooks/use-shift-presets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { ShiftPreset, InsertShiftPreset } from "@shared/schema";

function formatTime(time: string): string {
  const [hours, minutes] = time.split(":");
  const h = parseInt(hours);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

function calculateDuration(startTime: string, endTime: string): string {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  let totalMinutes = (eh * 60 + em) - (sh * 60 + sm);
  if (totalMinutes < 0) totalMinutes += 24 * 60;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

export default function Shifts() {
  const { toast } = useToast();
  const { data: presets, isLoading } = useShiftPresets();
  const createPreset = useCreateShiftPreset();
  const updatePreset = useUpdateShiftPreset();
  const deletePreset = useDeleteShiftPreset();
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPreset, setEditingPreset] = useState<ShiftPreset | null>(null);
  const [formData, setFormData] = useState<InsertShiftPreset>({
    name: "",
    startTime: "08:00",
    endTime: "16:30",
    color: "#3b82f6",
    isActive: true,
    sortOrder: 0,
  });

  const handleOpenCreate = () => {
    setEditingPreset(null);
    setFormData({
      name: "",
      startTime: "08:00",
      endTime: "16:30",
      color: "#3b82f6",
      isActive: true,
      sortOrder: (presets?.length || 0) + 1,
    });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (preset: ShiftPreset) => {
    setEditingPreset(preset);
    setFormData({
      name: preset.name,
      startTime: preset.startTime,
      endTime: preset.endTime,
      color: preset.color,
      isActive: preset.isActive,
      sortOrder: preset.sortOrder,
    });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast({ variant: "destructive", title: "Error", description: "Shift name is required" });
      return;
    }
    
    try {
      if (editingPreset) {
        await updatePreset.mutateAsync({ id: editingPreset.id, ...formData });
        toast({ title: "Shift updated", description: "The shift preset has been updated." });
      } else {
        await createPreset.mutateAsync(formData);
        toast({ title: "Shift created", description: "The shift preset has been created." });
      }
      setIsDialogOpen(false);
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to save shift preset." });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deletePreset.mutateAsync(id);
      toast({ title: "Shift deleted", description: "The shift preset has been removed." });
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to delete shift preset." });
    }
  };

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
            <Clock className="w-8 h-8 text-primary" />
            Shift Presets
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure predefined shifts that can be quickly applied when scheduling employees.
          </p>
        </div>
        <Button onClick={handleOpenCreate} data-testid="button-create-shift">
          <Plus className="w-4 h-4 mr-2" />
          Add Shift
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Available Shifts</CardTitle>
          <CardDescription>
            Click on a shift to edit it. These shifts will appear when scheduling employees.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Start Time</TableHead>
                <TableHead>End Time</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {presets?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No shift presets configured. Click "Add Shift" to create one.
                  </TableCell>
                </TableRow>
              ) : (
                presets?.map((preset) => (
                  <TableRow key={preset.id} data-testid={`row-shift-${preset.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: preset.color }}
                        />
                        <span className="font-medium">{preset.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono">{formatTime(preset.startTime)}</TableCell>
                    <TableCell className="font-mono">{formatTime(preset.endTime)}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {calculateDuration(preset.startTime, preset.endTime)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={preset.isActive ? "default" : "secondary"}>
                        {preset.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleOpenEdit(preset)}
                          data-testid={`button-edit-shift-${preset.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleDelete(preset.id)}
                          disabled={deletePreset.isPending}
                          data-testid={`button-delete-shift-${preset.id}`}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingPreset ? "Edit Shift" : "Create Shift"}</DialogTitle>
            <DialogDescription>
              {editingPreset 
                ? "Modify the shift preset settings below." 
                : "Define a new shift preset that can be quickly applied when scheduling."}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Shift Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Morning Shift, Evening Shift"
                data-testid="input-shift-name"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startTime">Start Time</Label>
                <Input
                  id="startTime"
                  type="time"
                  value={formData.startTime}
                  onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                  data-testid="input-shift-start"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endTime">End Time</Label>
                <Input
                  id="endTime"
                  type="time"
                  value={formData.endTime}
                  onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                  data-testid="input-shift-end"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="color">Color</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="color"
                  type="color"
                  value={formData.color}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  className="w-16 h-10 p-1 cursor-pointer"
                  data-testid="input-shift-color"
                />
                <span className="text-sm text-muted-foreground">
                  Duration: {calculateDuration(formData.startTime, formData.endTime)}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} data-testid="button-cancel">
              Cancel
            </Button>
            <Button 
              onClick={handleSave} 
              disabled={createPreset.isPending || updatePreset.isPending}
              data-testid="button-save-shift"
            >
              <Save className="w-4 h-4 mr-2" />
              {editingPreset ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
