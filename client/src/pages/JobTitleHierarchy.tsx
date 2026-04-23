import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Network, Pencil, Search, Loader2, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type AuthStatus = { authenticated?: boolean; user?: { id: number; role: string } };

function titleLabel(code: string): string {
  return code;
}

export default function JobTitleHierarchy({ embedded = false }: { embedded?: boolean } = {}) {
  const { toast } = useToast();
  const { data: auth } = useQuery<AuthStatus>({ queryKey: ["/api/auth/status"] });
  const isAdmin = auth?.user?.role === "admin";

  const { data: jobTitles = [], isLoading: titlesLoading } = useQuery<string[]>({
    queryKey: ["/api/job-titles"],
    enabled: isAdmin,
  });

  const { data: visibilityMap = {}, isLoading: mapLoading } = useQuery<Record<string, string[]>>({
    queryKey: ["/api/job-title-visibility"],
    enabled: isAdmin,
  });

  const [search, setSearch] = useState("");
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [editSelected, setEditSelected] = useState<Set<string>>(new Set());
  const [editSearch, setEditSearch] = useState("");

  const sortedTitles = useMemo(() => {
    const list = [...jobTitles];
    list.sort((a, b) => titleLabel(a).localeCompare(titleLabel(b)));
    return list;
  }, [jobTitles]);

  const filteredTitles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedTitles;
    return sortedTitles.filter(t =>
      t.toLowerCase().includes(q) || titleLabel(t).toLowerCase().includes(q),
    );
  }, [sortedTitles, search]);

  const openEditor = (title: string) => {
    setEditingTitle(title);
    setEditSearch("");
    setEditSelected(new Set(visibilityMap[title] || []));
  };

  const closeEditor = () => {
    setEditingTitle(null);
    setEditSearch("");
    setEditSelected(new Set());
  };

  useEffect(() => {
    if (editingTitle && visibilityMap[editingTitle]) {
      setEditSelected(new Set(visibilityMap[editingTitle]));
    }
  }, [editingTitle, visibilityMap]);

  const saveMutation = useMutation({
    mutationFn: async ({ viewer, visible }: { viewer: string; visible: string[] }) => {
      return apiRequest(
        "PUT",
        `/api/job-title-visibility/${encodeURIComponent(viewer)}`,
        { visibleJobTitles: visible },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/job-title-visibility"] });
      toast({ title: "Visibility updated" });
      closeEditor();
    },
    onError: () => {
      toast({ variant: "destructive", title: "Error", description: "Failed to save visibility" });
    },
  });

  const editorOtherTitles = useMemo(() => {
    if (!editingTitle) return [] as string[];
    return sortedTitles.filter(t => t !== editingTitle);
  }, [sortedTitles, editingTitle]);

  const filteredEditorTitles = useMemo(() => {
    const q = editSearch.trim().toLowerCase();
    if (!q) return editorOtherTitles;
    return editorOtherTitles.filter(t =>
      t.toLowerCase().includes(q) || titleLabel(t).toLowerCase().includes(q),
    );
  }, [editorOtherTitles, editSearch]);

  const toggleEdit = (title: string) => {
    const next = new Set(editSelected);
    if (next.has(title)) next.delete(title);
    else next.add(title);
    setEditSelected(next);
  };

  const selectAllEditor = () => {
    setEditSelected(new Set(editorOtherTitles));
  };
  const clearEditor = () => setEditSelected(new Set());

  if (!isAdmin) {
    return (
      <div className={embedded ? "" : "container mx-auto p-6"}>
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-destructive" />
              <CardTitle>Admin access required</CardTitle>
            </div>
            <CardDescription>Only admins can configure the job title hierarchy.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className={embedded ? "space-y-4" : "container mx-auto p-6 space-y-4"}>
      {!embedded && (
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Network className="w-6 h-6" /> Job Title Hierarchy
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              For each job title, choose which other job titles a person with that title is allowed to see in coaching and attendance.
              Titles with nothing configured fall back to the built-in level rules (District/Store Mgr see everyone in their stores; Asst Mgr / Team Lead see lower levels).
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Job titles in use</CardTitle>
          <CardDescription>Click a row to configure who that job title can see.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative max-w-sm">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search job titles"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8"
              data-testid="input-search-titles"
            />
          </div>

          {(titlesLoading || mapLoading) ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredTitles.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground" data-testid="text-no-titles">
              No job titles found. Job titles appear here once employees are loaded.
            </div>
          ) : (
            <div className="border rounded-md divide-y" data-testid="list-job-titles">
              {filteredTitles.map(title => {
                const configured = visibilityMap[title] || [];
                return (
                  <div
                    key={title}
                    className="flex items-center justify-between gap-3 px-3 py-2 hover-elevate"
                    data-testid={`row-title-${title}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate" data-testid={`text-title-label-${title}`}>
                          {titleLabel(title)}
                        </span>
                        <span className="text-xs text-muted-foreground font-mono">{title}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5" data-testid={`text-title-summary-${title}`}>
                        {configured.length === 0 ? (
                          <span className="italic">Using default level rules</span>
                        ) : (
                          <span>Can see {configured.length} job title{configured.length === 1 ? "" : "s"}</span>
                        )}
                      </div>
                      {configured.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {configured.slice(0, 8).map(c => (
                            <Badge key={c} variant="secondary" className="text-[10px]" data-testid={`badge-visible-${title}-${c}`}>
                              {titleLabel(c)}
                            </Badge>
                          ))}
                          {configured.length > 8 && (
                            <Badge variant="outline" className="text-[10px]">
                              +{configured.length - 8} more
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditor(title)}
                      data-testid={`button-edit-title-${title}`}
                    >
                      <Pencil className="w-3.5 h-3.5 mr-1.5" /> Configure
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editingTitle} onOpenChange={(o) => { if (!o) closeEditor(); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Configure visibility for {editingTitle ? titleLabel(editingTitle) : ""}
            </DialogTitle>
            <DialogDescription>
              Select which job titles a person with this title is allowed to see. Selecting nothing falls back to the built-in level rules.
              The viewer's own title is always excluded.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search job titles"
                  value={editSearch}
                  onChange={e => setEditSearch(e.target.value)}
                  className="pl-8"
                  data-testid="input-edit-search"
                />
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span data-testid="text-edit-selected-count">{editSelected.size} selected</span>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={selectAllEditor} data-testid="button-edit-select-all">
                  Select all
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={clearEditor} data-testid="button-edit-clear">
                  Clear all
                </Button>
              </div>
            </div>

            <ScrollArea className="h-72 border rounded-md">
              {filteredEditorTitles.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground" data-testid="text-edit-empty">
                  No matching job titles.
                </div>
              ) : (
                <div className="divide-y">
                  {filteredEditorTitles.map(t => (
                    <label
                      key={t}
                      htmlFor={`vis-${t}`}
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer hover-elevate"
                      data-testid={`row-edit-${t}`}
                    >
                      <Checkbox
                        id={`vis-${t}`}
                        checked={editSelected.has(t)}
                        onCheckedChange={() => toggleEdit(t)}
                        data-testid={`checkbox-edit-${t}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{titleLabel(t)}</div>
                        <div className="text-xs text-muted-foreground font-mono">{t}</div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeEditor} data-testid="button-edit-cancel">
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => editingTitle && saveMutation.mutate({ viewer: editingTitle, visible: Array.from(editSelected) })}
              disabled={saveMutation.isPending}
              data-testid="button-edit-save"
            >
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
