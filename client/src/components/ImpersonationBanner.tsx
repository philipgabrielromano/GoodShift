import { useQuery, useMutation } from "@tanstack/react-query";
import { Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type AuthStatus = {
  user?: { id: number; name: string; email: string; role: string } | null;
  impersonating?: boolean;
  realUser?: { id: number; name: string; email: string; role: string } | null;
};

export function ImpersonationBanner() {
  const { toast } = useToast();
  const { data } = useQuery<AuthStatus>({ queryKey: ["/api/auth/status"] });

  const stopMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/view-as/stop");
    },
    onSuccess: () => {
      queryClient.clear();
      toast({ title: "Stopped viewing as", description: "Restored your admin session." });
      setTimeout(() => window.location.assign("/"), 100);
    },
    onError: (err: any) => {
      toast({
        variant: "destructive",
        title: "Could not stop",
        description: err?.message || "Please refresh the page.",
      });
    },
  });

  if (!data?.impersonating || !data.user || !data.realUser) return null;

  return (
    <div
      className="sticky top-0 z-40 w-full bg-amber-500 text-amber-950 dark:bg-amber-600 dark:text-amber-50 border-b border-amber-700"
      data-testid="banner-impersonation"
    >
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-2 min-w-0">
          <Eye className="w-4 h-4 shrink-0" />
          <span className="truncate">
            Viewing as <strong data-testid="text-impersonating-name">{data.user.name}</strong>
            <span className="opacity-80"> ({data.user.role}) — your admin session is paused</span>
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="bg-white/90 hover:bg-white text-amber-950 border-amber-700"
          onClick={() => stopMutation.mutate()}
          disabled={stopMutation.isPending}
          data-testid="button-stop-impersonation"
        >
          <X className="w-3.5 h-3.5 mr-1.5" />
          {stopMutation.isPending ? "Stopping..." : "Stop viewing"}
        </Button>
      </div>
    </div>
  );
}
