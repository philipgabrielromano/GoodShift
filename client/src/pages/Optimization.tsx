import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { isSchedulableLocation } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Plus, ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, Star, ClipboardList, BarChart3, MessageSquare, Trash2, StickyNote, Clock, Check } from "lucide-react";
import { OPTIMIZATION_CHECKLIST, OPTIMIZATION_SURVEY_QUESTIONS } from "@shared/schema";
import type { OptimizationEvent, OptimizationChecklistItem, OptimizationSurveyResponse } from "@shared/schema";

interface Location {
  id: number;
  name: string;
  isActive: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  planning: "Planning",
  in_progress: "In Progress",
  completed: "Completed",
  follow_up: "Follow-up",
};

const STATUS_COLORS: Record<string, string> = {
  planning: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  follow_up: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

function ChecklistItemRow({ item, dbItem, onToggle, onNotesChange }: {
  item: { key: string; label: string };
  dbItem: OptimizationChecklistItem;
  onToggle: (id: number, completed: boolean) => void;
  onNotesChange: (id: number, notes: string) => void;
}) {
  const [showNotes, setShowNotes] = useState(!!dbItem.notes);
  const [localNotes, setLocalNotes] = useState(dbItem.notes || "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalNotes(dbItem.notes || "");
  }, [dbItem.notes]);

  const handleNotesChange = useCallback((value: string) => {
    setLocalNotes(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onNotesChange(dbItem.id, value);
    }, 800);
  }, [dbItem.id, onNotesChange]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div
      className={`p-3 rounded-lg border transition-colors ${dbItem.completed ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800" : "bg-card border-border"}`}
      data-testid={`checklist-item-${item.key}`}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          checked={dbItem.completed}
          onCheckedChange={(checked) => onToggle(dbItem.id, !!checked)}
          className="mt-0.5 h-6 w-6"
          data-testid={`checkbox-${item.key}`}
        />
        <div className="flex-1 min-w-0">
          <p className={`text-sm lg:text-base ${dbItem.completed ? "line-through text-muted-foreground" : ""}`}>
            {item.label}
          </p>
          {dbItem.completed && dbItem.completedBy && (
            <p className="text-xs text-muted-foreground mt-1">
              Completed by {dbItem.completedBy}
              {dbItem.completedAt && ` on ${format(new Date(dbItem.completedAt), "MMM d, yyyy")}`}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className={`h-8 w-8 shrink-0 ${showNotes || dbItem.notes ? "text-primary" : "text-muted-foreground"}`}
          onClick={() => setShowNotes(!showNotes)}
          data-testid={`button-notes-${item.key}`}
        >
          <StickyNote className="w-4 h-4" />
        </Button>
      </div>
      {showNotes && (
        <div className="mt-2 ml-9">
          <Textarea
            value={localNotes}
            onChange={(e) => handleNotesChange(e.target.value)}
            placeholder="Add notes..."
            className="min-h-[60px] text-sm"
            data-testid={`notes-${item.key}`}
          />
          {dbItem.notes !== localNotes && localNotes !== "" && (
            <p className="text-xs text-muted-foreground mt-1 italic">Saving...</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function Optimization() {
  const { toast } = useToast();
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [surveyDialogOpen, setSurveyDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"checklist" | "survey">("checklist");
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set());
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);

  const [formLocation, setFormLocation] = useState("");
  const [formStartDate, setFormStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [formEndDate, setFormEndDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [formNotes, setFormNotes] = useState("");

  const [surveyName, setSurveyName] = useState("");
  const [surveyAnswers, setSurveyAnswers] = useState<Record<number, number>>({});

  const { data: locations } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
  const { data: events, isLoading: eventsLoading } = useQuery<OptimizationEvent[]>({
    queryKey: ["/api/optimization/events"],
  });

  const { data: eventDetail, isLoading: detailLoading } = useQuery<{
    event: OptimizationEvent;
    checklist: OptimizationChecklistItem[];
    surveys: OptimizationSurveyResponse[];
  }>({
    queryKey: ["/api/optimization/events", selectedEventId],
    enabled: !!selectedEventId,
  });

  const createEventMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/optimization/events", data);
      return res.json();
    },
    onSuccess: (newEvent: OptimizationEvent) => {
      queryClient.invalidateQueries({ queryKey: ["/api/optimization/events"] });
      setCreateDialogOpen(false);
      setFormLocation("");
      setFormNotes("");
      setSelectedEventId(newEvent.id);
      toast({ title: "Event created", description: "Your checklist is ready. Start checking off items!" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create event", variant: "destructive" });
    },
  });

  const updateEventMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const res = await apiRequest("PATCH", `/api/optimization/events/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/optimization/events"] });
      if (selectedEventId) queryClient.invalidateQueries({ queryKey: ["/api/optimization/events", selectedEventId] });
    },
  });

  const deleteEventMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/optimization/events/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/optimization/events"] });
      setSelectedEventId(null);
      toast({ title: "Event deleted" });
    },
  });

  const toggleChecklistMutation = useMutation({
    mutationFn: async ({ id, completed, notes }: { id: number; completed?: boolean; notes?: string }) => {
      const res = await apiRequest("PATCH", `/api/optimization/checklist/${id}`, { completed, notes });
      return res.json();
    },
    onSuccess: () => {
      if (selectedEventId) queryClient.invalidateQueries({ queryKey: ["/api/optimization/events", selectedEventId] });
    },
  });

  const submitSurveyMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", `/api/optimization/events/${selectedEventId}/survey`, data);
      return res.json();
    },
    onSuccess: () => {
      if (selectedEventId) queryClient.invalidateQueries({ queryKey: ["/api/optimization/events", selectedEventId] });
      setSurveyDialogOpen(false);
      setSurveyName("");
      setSurveyAnswers({});
      toast({ title: "Survey submitted" });
    },
  });

  const deleteSurveyMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/optimization/survey/${id}`);
    },
    onSuccess: () => {
      if (selectedEventId) queryClient.invalidateQueries({ queryKey: ["/api/optimization/events", selectedEventId] });
      toast({ title: "Survey response deleted" });
    },
  });

  function handleCreateEvent() {
    if (!formLocation) {
      toast({ title: "Missing fields", description: "Please select a location.", variant: "destructive" });
      return;
    }
    const loc = locations?.find(l => String(l.id) === formLocation);
    createEventMutation.mutate({
      locationId: Number(formLocation),
      locationName: loc?.name || "Unknown",
      startDate: formStartDate,
      endDate: formEndDate,
      notes: formNotes || null,
    });
  }

  function handleSubmitSurvey() {
    if (Object.keys(surveyAnswers).length < OPTIMIZATION_SURVEY_QUESTIONS.length) {
      toast({ title: "Incomplete", description: "Please answer all questions.", variant: "destructive" });
      return;
    }
    submitSurveyMutation.mutate({
      respondentName: surveyName || null,
      responses: surveyAnswers,
    });
  }

  function handleMarkComplete() {
    if (!selectedEventId) return;
    updateEventMutation.mutate({ id: selectedEventId, status: "completed" });
    setCompleteDialogOpen(false);
    toast({ title: "Event marked complete", description: "All checklist progress has been saved." });
  }

  function togglePhase(phase: string) {
    setCollapsedPhases(prev => {
      const next = new Set(prev);
      if (next.has(phase)) next.delete(phase);
      else next.add(phase);
      return next;
    });
  }

  const handleToggleItem = useCallback((id: number, completed: boolean) => {
    toggleChecklistMutation.mutate({ id, completed });
  }, [toggleChecklistMutation]);

  const handleNotesChange = useCallback((id: number, notes: string) => {
    toggleChecklistMutation.mutate({ id, notes });
  }, [toggleChecklistMutation]);

  const checklistByPhase = useMemo(() => {
    if (!eventDetail?.checklist) return {};
    const map: Record<string, OptimizationChecklistItem[]> = {};
    for (const item of eventDetail.checklist) {
      if (!map[item.phase]) map[item.phase] = [];
      map[item.phase].push(item);
    }
    return map;
  }, [eventDetail?.checklist]);

  const phaseProgress = useMemo(() => {
    const progress: Record<string, { done: number; total: number }> = {};
    for (const [phase, items] of Object.entries(checklistByPhase)) {
      progress[phase] = {
        done: items.filter(i => i.completed).length,
        total: items.length,
      };
    }
    return progress;
  }, [checklistByPhase]);

  const totalProgress = useMemo(() => {
    const items = eventDetail?.checklist || [];
    return { done: items.filter(i => i.completed).length, total: items.length };
  }, [eventDetail?.checklist]);

  const surveyAverages = useMemo(() => {
    if (!eventDetail?.surveys?.length) return null;
    const sums: number[] = new Array(OPTIMIZATION_SURVEY_QUESTIONS.length).fill(0);
    let count = 0;
    for (const survey of eventDetail.surveys) {
      try {
        const resp = JSON.parse(survey.responses);
        count++;
        for (let i = 0; i < OPTIMIZATION_SURVEY_QUESTIONS.length; i++) {
          sums[i] += resp[i] || 0;
        }
      } catch {}
    }
    if (count === 0) return null;
    return sums.map(s => (s / count).toFixed(1));
  }, [eventDetail?.surveys]);

  const inProgressEvents = useMemo(() => {
    return events?.filter(e => e.status === "in_progress") || [];
  }, [events]);

  const otherEvents = useMemo(() => {
    return events?.filter(e => e.status !== "in_progress")
      .sort((a, b) => {
        const order: Record<string, number> = { planning: 0, follow_up: 1, completed: 2 };
        const oa = order[a.status] ?? 3;
        const ob = order[b.status] ?? 3;
        if (oa !== ob) return oa - ob;
        return new Date(b.startDate).getTime() - new Date(a.startDate).getTime();
      }) || [];
  }, [events]);

  if (selectedEventId && eventDetail) {
    const ev = eventDetail.event;
    const isCompleted = ev.status === "completed";
    const allDone = totalProgress.done === totalProgress.total && totalProgress.total > 0;

    return (
      <div className="p-4 lg:p-8 space-y-4 max-w-[1200px] mx-auto">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setSelectedEventId(null)} data-testid="button-back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl lg:text-2xl font-bold truncate" data-testid="text-event-title">{ev.locationName}</h1>
            <p className="text-sm text-muted-foreground">
              {format(new Date(ev.startDate + "T00:00:00"), "MMM d")} – {format(new Date(ev.endDate + "T00:00:00"), "MMM d, yyyy")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={ev.status}
              onValueChange={(val) => updateEventMutation.mutate({ id: ev.id, status: val })}
            >
              <SelectTrigger className="w-[140px]" data-testid="select-event-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABELS).map(([val, label]) => (
                  <SelectItem key={val} value={val}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive"
              onClick={() => {
                if (confirm("Delete this event and all its data?")) {
                  deleteEventMutation.mutate(ev.id);
                }
              }}
              data-testid="button-delete-event"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {ev.notes && (
          <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
            {ev.notes}
          </div>
        )}

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Progress: {totalProgress.done}/{totalProgress.total}</span>
          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${allDone ? "bg-green-500" : "bg-primary"}`}
              style={{ width: totalProgress.total ? `${(totalProgress.done / totalProgress.total) * 100}%` : "0%" }}
            />
          </div>
          <span>{totalProgress.total ? Math.round((totalProgress.done / totalProgress.total) * 100) : 0}%</span>
        </div>

        {!isCompleted && (
          <div className="flex gap-2">
            {ev.status === "planning" && totalProgress.done > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => updateEventMutation.mutate({ id: ev.id, status: "in_progress" })}
                data-testid="button-start-event"
              >
                <Clock className="w-4 h-4 mr-2" />
                Mark In Progress
              </Button>
            )}
            <Dialog open={completeDialogOpen} onOpenChange={setCompleteDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  variant={allDone ? "default" : "outline"}
                  size="sm"
                  className={allDone ? "bg-green-600 hover:bg-green-700" : ""}
                  data-testid="button-mark-complete"
                >
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Mark Complete
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle>Mark Event Complete?</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {allDone
                      ? "All checklist items are finished. Ready to mark this event as complete?"
                      : `${totalProgress.total - totalProgress.done} of ${totalProgress.total} checklist items are still incomplete. Are you sure you want to mark this event as complete?`}
                  </p>
                  {!allDone && (
                    <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-800 dark:text-amber-200">
                      Incomplete items will keep their current state. You can reopen this event later if needed.
                    </div>
                  )}
                </div>
                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={() => setCompleteDialogOpen(false)} data-testid="button-cancel-complete">
                    Cancel
                  </Button>
                  <Button onClick={handleMarkComplete} className="bg-green-600 hover:bg-green-700" data-testid="button-confirm-complete">
                    <Check className="w-4 h-4 mr-2" />
                    Mark Complete
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}

        <div className="flex gap-2 border-b">
          <button
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === "checklist" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
            onClick={() => setActiveTab("checklist")}
            data-testid="tab-checklist"
          >
            <ClipboardList className="w-4 h-4 inline mr-2" />
            Checklist
          </button>
          <button
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === "survey" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
            onClick={() => setActiveTab("survey")}
            data-testid="tab-survey"
          >
            <MessageSquare className="w-4 h-4 inline mr-2" />
            Survey ({eventDetail.surveys?.length || 0})
          </button>
        </div>

        {activeTab === "checklist" && (
          <div className="space-y-3">
            {Object.entries(OPTIMIZATION_CHECKLIST).map(([phase, items]) => {
              const progress = phaseProgress[phase] || { done: 0, total: items.length };
              const isCollapsed = collapsedPhases.has(phase);
              const isPhaseComplete = progress.done === progress.total;

              return (
                <Card key={phase}>
                  <button
                    className="w-full px-4 py-4 lg:px-6 flex items-center gap-3 text-left"
                    onClick={() => togglePhase(phase)}
                    data-testid={`button-phase-${phase.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`}
                  >
                    {isCollapsed ? <ChevronRight className="w-5 h-5 shrink-0" /> : <ChevronDown className="w-5 h-5 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm lg:text-base">{phase}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${isPhaseComplete ? "bg-green-500" : "bg-primary"}`}
                            style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">{progress.done}/{progress.total}</span>
                      </div>
                    </div>
                    {isPhaseComplete && <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />}
                  </button>
                  {!isCollapsed && (
                    <CardContent className="pt-0 px-4 lg:px-6 pb-4 space-y-1">
                      {items.map((item) => {
                        const dbItem = checklistByPhase[phase]?.find(ci => ci.itemKey === item.key);
                        if (!dbItem) return null;
                        return (
                          <ChecklistItemRow
                            key={item.key}
                            item={item}
                            dbItem={dbItem}
                            onToggle={handleToggleItem}
                            onNotesChange={handleNotesChange}
                          />
                        );
                      })}
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )}

        {activeTab === "survey" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold">Post-Event Survey Responses</h3>
              <Dialog open={surveyDialogOpen} onOpenChange={setSurveyDialogOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="button-add-survey">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Response
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Post-Event Survey</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Respondent Name (optional)</Label>
                      <Input
                        value={surveyName}
                        onChange={(e) => setSurveyName(e.target.value)}
                        placeholder="Anonymous if left blank"
                        data-testid="input-survey-name"
                      />
                    </div>
                    {OPTIMIZATION_SURVEY_QUESTIONS.map((question, idx) => (
                      <div key={idx} className="space-y-2">
                        <Label className="text-sm">{question}</Label>
                        <div className="flex gap-1">
                          {[1, 2, 3, 4, 5].map((rating) => (
                            <button
                              key={rating}
                              type="button"
                              className={`p-2 rounded-lg border-2 transition-all flex-1 text-center ${surveyAnswers[idx] === rating ? "border-primary bg-primary/10 font-bold" : "border-muted hover:border-primary/50"}`}
                              onClick={() => setSurveyAnswers(prev => ({ ...prev, [idx]: rating }))}
                              data-testid={`rating-q${idx}-${rating}`}
                            >
                              <Star className={`w-5 h-5 mx-auto ${surveyAnswers[idx] !== undefined && surveyAnswers[idx] >= rating ? "text-amber-500 fill-amber-500" : "text-muted-foreground"}`} />
                              <span className="text-xs block mt-0.5">{rating}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <DialogFooter>
                    <Button onClick={handleSubmitSurvey} disabled={submitSurveyMutation.isPending} data-testid="button-submit-survey">
                      Submit Survey
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            {surveyAverages && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" />
                    Average Ratings ({eventDetail.surveys.length} responses)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {OPTIMIZATION_SURVEY_QUESTIONS.map((q, idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{q}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                        <span className="font-bold text-sm w-8 text-right">{surveyAverages[idx]}</span>
                        <span className="text-xs text-muted-foreground">/ 5</span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {eventDetail.surveys?.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No survey responses yet.</p>
                <p className="text-xs mt-1">Tap "Add Response" to collect feedback from participants.</p>
              </div>
            )}

            {eventDetail.surveys?.map((survey) => {
              let responses: Record<string, number> = {};
              try { responses = JSON.parse(survey.responses); } catch {}
              return (
                <Card key={survey.id} data-testid={`survey-response-${survey.id}`}>
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="font-medium text-sm">{survey.respondentName || "Anonymous"}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {survey.createdAt && format(new Date(survey.createdAt), "MMM d, yyyy")}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteSurveyMutation.mutate(survey.id)}
                        data-testid={`button-delete-survey-${survey.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    <div className="space-y-1">
                      {OPTIMIZATION_SURVEY_QUESTIONS.map((q, idx) => (
                        <div key={idx} className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground truncate mr-2">{q}</span>
                          <div className="flex gap-0.5 shrink-0">
                            {[1, 2, 3, 4, 5].map(r => (
                              <Star key={r} className={`w-3.5 h-3.5 ${(responses[idx] || 0) >= r ? "text-amber-500 fill-amber-500" : "text-muted-foreground/30"}`} />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (selectedEventId && detailLoading) {
    return (
      <div className="p-4 lg:p-8 space-y-4 max-w-[1200px] mx-auto">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-[1200px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold" data-testid="text-page-title">Store Optimization</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Continuous improvement program events and documentation.
          </p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button size="lg" className="h-12 px-6 text-base" data-testid="button-new-event">
              <Plus className="w-5 h-5 mr-2" />
              New Event
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create Optimization Event</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Store Location</Label>
                <Select value={formLocation} onValueChange={setFormLocation}>
                  <SelectTrigger data-testid="select-event-location">
                    <SelectValue placeholder="Select store..." />
                  </SelectTrigger>
                  <SelectContent>
                    {locations?.filter(isSchedulableLocation).sort((a, b) => a.name.localeCompare(b.name)).map(loc => (
                      <SelectItem key={loc.id} value={String(loc.id)}>{loc.schedulingName ?? loc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input type="date" value={formStartDate} onChange={(e) => setFormStartDate(e.target.value)} data-testid="input-start-date" />
                </div>
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <Input type="date" value={formEndDate} onChange={(e) => setFormEndDate(e.target.value)} data-testid="input-end-date" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Notes (optional)</Label>
                <Textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} placeholder="Event objectives, key participants..." data-testid="input-event-notes" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleCreateEvent} disabled={createEventMutation.isPending} data-testid="button-create-event">
                Create Event
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {eventsLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : events?.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <ClipboardList className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-lg font-medium">No optimization events yet</p>
          <p className="text-sm mt-1">Create your first event to get started.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {inProgressEvents.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <h2 className="text-sm font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wider" data-testid="text-in-progress-heading">
                  In Progress ({inProgressEvents.length})
                </h2>
              </div>
              <div className="grid gap-3">
                {inProgressEvents.map(event => (
                  <Card
                    key={event.id}
                    className="cursor-pointer hover-elevate transition-all border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20"
                    onClick={() => setSelectedEventId(event.id)}
                    data-testid={`card-event-${event.id}`}
                  >
                    <CardContent className="p-4 lg:p-6">
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-base lg:text-lg">{event.locationName}</h3>
                            <Badge className={`text-xs ${STATUS_COLORS[event.status] || ""}`}>
                              {STATUS_LABELS[event.status] || event.status}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            {format(new Date(event.startDate + "T00:00:00"), "MMM d")} – {format(new Date(event.endDate + "T00:00:00"), "MMM d, yyyy")}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Created by {event.createdByName}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Resume</span>
                          <ChevronRight className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {otherEvents.length > 0 && (
            <div className="space-y-3">
              {inProgressEvents.length > 0 && (
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider" data-testid="text-all-events-heading">
                  All Events
                </h2>
              )}
              <div className="grid gap-3">
                {otherEvents.map(event => (
                  <Card
                    key={event.id}
                    className="cursor-pointer hover-elevate transition-all"
                    onClick={() => setSelectedEventId(event.id)}
                    data-testid={`card-event-${event.id}`}
                  >
                    <CardContent className="p-4 lg:p-6">
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-base lg:text-lg">{event.locationName}</h3>
                            <Badge className={`text-xs ${STATUS_COLORS[event.status] || ""}`}>
                              {STATUS_LABELS[event.status] || event.status}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            {format(new Date(event.startDate + "T00:00:00"), "MMM d")} – {format(new Date(event.endDate + "T00:00:00"), "MMM d, yyyy")}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Created by {event.createdByName}
                          </p>
                        </div>
                        <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
