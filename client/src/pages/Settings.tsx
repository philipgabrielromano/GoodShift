import { useGlobalSettings, useUpdateGlobalSettings, useRoleRequirements, useCreateRoleRequirement, useDeleteRoleRequirement } from "@/hooks/use-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Plus, Trash2, Save } from "lucide-react";

export default function Settings() {
  const { data: settings } = useGlobalSettings();
  const updateSettings = useUpdateGlobalSettings();
  const { data: roles } = useRoleRequirements();
  const createRole = useCreateRoleRequirement();
  const deleteRole = useDeleteRoleRequirement();
  const { toast } = useToast();

  const [weeklyLimit, setWeeklyLimit] = useState<number | undefined>(undefined);
  const [newRole, setNewRole] = useState({ jobTitle: "", requiredWeeklyHours: 40 });

  // Init state from data
  if (weeklyLimit === undefined && settings) {
    setWeeklyLimit(settings.totalWeeklyHoursLimit);
  }

  const handleSaveGlobal = async () => {
    if (!weeklyLimit) return;
    try {
      await updateSettings.mutateAsync({ totalWeeklyHoursLimit: weeklyLimit });
      toast({ title: "Settings saved" });
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: "Failed to save settings" });
    }
  };

  const handleAddRole = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createRole.mutateAsync(newRole);
      setNewRole({ jobTitle: "", requiredWeeklyHours: 40 });
      toast({ title: "Role requirement added" });
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: "Failed to add role requirement" });
    }
  };

  const handleDeleteRole = async (id: number) => {
    try {
      await deleteRole.mutateAsync(id);
      toast({ title: "Role requirement deleted" });
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: "Failed to delete" });
    }
  };

  return (
    <div className="p-6 lg:p-10 space-y-8 max-w-[1200px] mx-auto">
      <div>
        <h1 className="text-3xl font-bold font-display">Settings</h1>
        <p className="text-muted-foreground mt-1">Configure global constraints and requirements.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <Card>
          <CardHeader>
            <CardTitle>Global Constraints</CardTitle>
            <CardDescription>Limits that apply to the entire schedule.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Total Weekly Hours Limit</Label>
              <div className="flex gap-2">
                <Input 
                  type="number" 
                  value={weeklyLimit || ""} 
                  onChange={e => setWeeklyLimit(parseInt(e.target.value))}
                />
                <Button onClick={handleSaveGlobal} disabled={updateSettings.isPending}>
                  <Save className="w-4 h-4 mr-2" /> Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                The scheduler will show a warning if the total hours across all employees exceeds this value.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Role Requirements</CardTitle>
            <CardDescription>Minimum coverage needed for each job title.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <form onSubmit={handleAddRole} className="flex gap-2 items-end">
              <div className="space-y-2 flex-1">
                <Label>Job Title</Label>
                <Input 
                  placeholder="e.g. Chef" 
                  value={newRole.jobTitle}
                  onChange={e => setNewRole({...newRole, jobTitle: e.target.value})}
                  required
                />
              </div>
              <div className="space-y-2 w-32">
                <Label>Min Hours</Label>
                <Input 
                  type="number" 
                  value={newRole.requiredWeeklyHours}
                  onChange={e => setNewRole({...newRole, requiredWeeklyHours: parseInt(e.target.value)})}
                  required
                />
              </div>
              <Button type="submit" disabled={createRole.isPending}>
                <Plus className="w-4 h-4" />
              </Button>
            </form>

            <div className="space-y-2">
              {roles?.map(role => (
                <div key={role.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border">
                  <div>
                    <p className="font-semibold">{role.jobTitle}</p>
                    <p className="text-sm text-muted-foreground">Min {role.requiredWeeklyHours}h / week</p>
                  </div>
                  <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDeleteRole(role.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              {roles?.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No role requirements set.</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
