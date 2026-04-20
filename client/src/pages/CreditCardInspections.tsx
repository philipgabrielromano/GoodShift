import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { CreditCard, Plus, CheckCircle2, AlertCircle, ImageIcon, Loader2, Trash2 } from "lucide-react";
import type { CreditCardInspection, CreditCardInspectionTerminal } from "@shared/schema";

interface AuthStatus {
  user: { id: number; name: string; role: string } | null;
  accessibleFeatures?: string[];
}

export default function CreditCardInspections() {
  const { toast } = useToast();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: authStatus } = useQuery<AuthStatus>({ queryKey: ["/api/auth/status"] });
  const features = authStatus?.accessibleFeatures || [];
  const canSubmit = features.includes("credit_card_inspection.submit");
  const canDelete = features.includes("credit_card_inspection.delete");

  const { data: inspections = [], isLoading } = useQuery<CreditCardInspection[]>({
    queryKey: ["/api/credit-card-inspections"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/credit-card-inspections/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/credit-card-inspections"] });
      toast({ title: "Inspection deleted" });
    },
    onError: () => {
      toast({ title: "Delete failed", variant: "destructive" });
    },
  });

  return (
    <div className="container max-w-6xl py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded bg-primary/10 flex items-center justify-center">
            <CreditCard className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" data-testid="heading-credit-card-inspections">Credit Card Inspections</h1>
            <p className="text-sm text-muted-foreground">
              Record of credit card terminal tampering checks.
            </p>
          </div>
        </div>
        {canSubmit && (
          <Link href="/credit-card-inspection/new">
            <Button data-testid="button-new-inspection">
              <Plus className="w-4 h-4 mr-2" /> New Inspection
            </Button>
          </Link>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : inspections.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No inspections submitted yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {inspections.map(ins => {
            const expanded = expandedId === ins.id;
            const terminals = (ins.terminals as CreditCardInspectionTerminal[]) || [];
            return (
              <Card key={ins.id} data-testid={`card-inspection-${ins.id}`}>
                <CardHeader
                  className="cursor-pointer hover-elevate"
                  onClick={() => setExpandedId(expanded ? null : ins.id)}
                >
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                      {ins.anyIssuesFound ? (
                        <Badge variant="destructive" className="gap-1">
                          <AlertCircle className="w-3 h-3" /> Issues found
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                          <CheckCircle2 className="w-3 h-3" /> No issues
                        </Badge>
                      )}
                      <CardTitle className="text-base" data-testid={`text-location-${ins.id}`}>
                        {ins.locationName || "—"}
                      </CardTitle>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span data-testid={`text-submitted-by-${ins.id}`}>{ins.submittedByName || "Unknown"}</span>
                      <span>•</span>
                      <span data-testid={`text-created-at-${ins.id}`}>
                        {new Date(ins.createdAt).toLocaleString()}
                      </span>
                      {canDelete && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => e.stopPropagation()}
                              data-testid={`button-delete-${ins.id}`}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete this inspection?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently remove this inspection record.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteMutation.mutate(ins.id)}
                                data-testid={`button-confirm-delete-${ins.id}`}
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </div>
                </CardHeader>
                {expanded && (
                  <CardContent className="space-y-4 border-t pt-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {terminals.map(t => (
                        <div
                          key={t.terminalNumber}
                          className="border rounded p-3 space-y-2"
                          data-testid={`terminal-detail-${ins.id}-${t.terminalNumber}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-sm">Terminal {t.terminalNumber}</span>
                            {!t.present ? (
                              <Badge variant="outline" className="text-xs">Not present</Badge>
                            ) : t.issueFound ? (
                              <Badge variant="destructive" className="text-xs gap-1">
                                <AlertCircle className="w-3 h-3" /> Issue
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs gap-1 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                                <CheckCircle2 className="w-3 h-3" /> OK
                              </Badge>
                            )}
                          </div>
                          {t.present && t.issueFound && t.issueDescription && (
                            <p className="text-sm text-muted-foreground">{t.issueDescription}</p>
                          )}
                          {t.present && t.photoUrl && (
                            <a
                              href={t.photoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                              data-testid={`link-photo-${ins.id}-${t.terminalNumber}`}
                            >
                              <ImageIcon className="w-3 h-3" /> View photo
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                    {ins.notes && (
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Notes</p>
                        <p className="text-sm whitespace-pre-wrap" data-testid={`text-notes-${ins.id}`}>{ins.notes}</p>
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
