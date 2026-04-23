import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Loader2, Plus, Truck, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Trailer } from "@shared/schema";
import { usePermissions } from "@/hooks/use-permissions";

const TRAILERS_KEY = ["/api/trailers"];

export default function Trailers() {
  const { toast } = useToast();
  const { can } = usePermissions();
  const canEdit = can("trailers.edit");
  const canDelete = can("trailers.delete");

  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [number, setNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);

  const { data: trailers = [], isLoading } = useQuery<Trailer[]>({ queryKey: TRAILERS_KEY });

  const resetForm = () => {
    setNumber("");
    setNotes("");
    setIsActive(true);
  };

  const openCreate = () => { resetForm(); setCreateOpen(true); };

  const openEdit = (t: Trailer) => {
    setEditId(t.id);
    setNumber(t.number);
    setNotes(t.notes ?? "");
    setIsActive(t.isActive);
  };

  const closeEdit = () => setEditId(null);

  const createMutation = useMutation({
    mutationFn: async () =>
      await apiRequest("POST", "/api/trailers", {
        number: number.trim(),
        notes: notes.trim() || null,
        isActive,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TRAILERS_KEY });
      toast({ title: "Trailer added" });
      setCreateOpen(false);
      resetForm();
    },
    onError: (err: any) => toast({ title: "Failed to add trailer", description: err?.message || "", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (editId === null) return null;
      return await apiRequest("PUT", `/api/trailers/${editId}`, {
        number: number.trim(),
        notes: notes.trim() || null,
        isActive,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TRAILERS_KEY });
      toast({ title: "Trailer updated" });
      closeEdit();
    },
    onError: (err: any) => toast({ title: "Failed to update trailer", description: err?.message || "", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => await apiRequest("DELETE", `/api/trailers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TRAILERS_KEY });
      toast({ title: "Trailer deleted" });
      closeEdit();
    },
    onError: (err: any) => toast({ title: "Failed to delete trailer", description: err?.message || "", variant: "destructive" }),
  });

  return (
    <div className="p-4 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-trailers-title">
            <Truck className="w-6 h-6" />
            Trailers
          </h1>
          <p className="text-muted-foreground mt-1">
            Maintain the fleet of trailers. Numbers added here become the dropdown choices when creating a trailer manifest.
          </p>
        </div>
        {canEdit && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreate} data-testid="button-new-trailer">
                <Plus className="w-4 h-4 mr-2" />
                New Trailer
              </Button>
            </DialogTrigger>
            <DialogContent data-testid="dialog-new-trailer">
              <DialogHeader>
                <DialogTitle>New Trailer</DialogTitle>
                <DialogDescription>Add a trailer to the fleet so it can be picked on a manifest.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="space-y-2">
                  <Label>Trailer number *</Label>
                  <Input value={number} onChange={e => setNumber(e.target.value)} placeholder="e.g. T-7821" data-testid="input-trailer-number" />
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes (size, condition, etc.)" data-testid="input-trailer-notes" />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="trailer-active">Active</Label>
                  <Switch id="trailer-active" checked={isActive} onCheckedChange={setIsActive} data-testid="switch-trailer-active" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)} data-testid="button-cancel-create">Cancel</Button>
                <Button onClick={() => createMutation.mutate()} disabled={!number.trim() || createMutation.isPending} data-testid="button-confirm-create">
                  {createMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                  Add Trailer
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configured Trailers</CardTitle>
          <CardDescription>Click a trailer to edit it.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : trailers.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground" data-testid="text-empty-trailers">
              No trailers added yet.
            </div>
          ) : (
            <div className="divide-y">
              {trailers.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => openEdit(t)}
                  className="w-full text-left flex items-center gap-3 py-3 px-2 hover-elevate"
                  data-testid={`row-trailer-${t.id}`}
                >
                  <Truck className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium" data-testid={`text-trailer-number-${t.id}`}>{t.number}</span>
                  {!t.isActive && <Badge variant="outline" data-testid={`badge-inactive-${t.id}`}>Inactive</Badge>}
                  {t.notes && <span className="text-sm text-muted-foreground truncate">{t.notes}</span>}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={editId !== null} onOpenChange={(open) => { if (!open) closeEdit(); }}>
        <DialogContent data-testid="dialog-edit-trailer">
          <DialogHeader>
            <DialogTitle>Edit Trailer</DialogTitle>
            <DialogDescription>Update the trailer's number, notes, or active state.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Trailer number *</Label>
              <Input value={number} onChange={e => setNumber(e.target.value)} disabled={!canEdit} data-testid="input-edit-trailer-number" />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} disabled={!canEdit} data-testid="input-edit-trailer-notes" />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="trailer-active-edit">Active</Label>
              <Switch id="trailer-active-edit" checked={isActive} onCheckedChange={setIsActive} disabled={!canEdit} data-testid="switch-edit-trailer-active" />
            </div>
          </div>
          <DialogFooter>
            {canDelete && editId !== null && (
              <Button
                variant="destructive"
                onClick={() => { if (confirm("Delete this trailer? It will no longer appear in the manifest dropdown.")) deleteMutation.mutate(editId); }}
                disabled={deleteMutation.isPending}
                className="mr-auto"
                data-testid="button-delete-trailer"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
            )}
            <Button variant="outline" onClick={closeEdit} data-testid="button-close-edit">Close</Button>
            {canEdit && (
              <Button
                onClick={() => updateMutation.mutate()}
                disabled={!number.trim() || updateMutation.isPending}
                data-testid="button-save-trailer"
              >
                {updateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Save
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
