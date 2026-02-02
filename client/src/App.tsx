import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Navigation } from "@/components/Navigation";
import NotFound from "@/pages/not-found";
import Schedule from "@/pages/Schedule";
import Employees from "@/pages/Employees";
import TimeOffRequests from "@/pages/TimeOffRequests";
import Settings from "@/pages/Settings";
import Users from "@/pages/Users";
import Locations from "@/pages/Locations";
import Shifts from "@/pages/Shifts";
import Login from "@/pages/Login";
import Attendance from "@/pages/Attendance";
import Changelog from "@/pages/Changelog";
import { Loader2 } from "lucide-react";

interface AuthStatus {
  isAuthenticated: boolean;
  user: { id: number; name: string; email: string; role: string; locationIds: string[] | null } | null;
  ssoConfigured: boolean;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Schedule} />
      <Route path="/employees" component={Employees} />
      <Route path="/requests" component={TimeOffRequests} />
      <Route path="/attendance" component={Attendance} />
      <Route path="/users" component={Users} />
      <Route path="/locations" component={Locations} />
      <Route path="/shifts" component={Shifts} />
      <Route path="/settings" component={Settings} />
      <Route path="/changelog" component={Changelog} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedApp() {
  const { data: authStatus, isLoading } = useQuery<AuthStatus>({
    queryKey: ["/api/auth/status"],
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (authStatus?.ssoConfigured && !authStatus?.isAuthenticated) {
    return <Login />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <Navigation />
      <main className="flex-1 lg:ml-64 pt-16 lg:pt-0 min-h-screen bg-muted/10">
        <Router />
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthenticatedApp />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
