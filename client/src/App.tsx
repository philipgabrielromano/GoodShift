import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Navigation } from "@/components/Navigation";
import NotFound from "@/pages/not-found";
import Schedule from "@/pages/Schedule";
import Employees from "@/pages/Employees";
import TimeOffRequests from "@/pages/TimeOffRequests";
import Settings from "@/pages/Settings";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Schedule} />
      <Route path="/employees" component={Employees} />
      <Route path="/requests" component={TimeOffRequests} />
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="min-h-screen bg-background text-foreground flex">
          <Navigation />
          <main className="flex-1 lg:ml-64 pt-16 lg:pt-0 min-h-screen bg-muted/10">
            <Router />
          </main>
        </div>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
