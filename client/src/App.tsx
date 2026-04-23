import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Navigation } from "@/components/Navigation";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";
import NotFound from "@/pages/not-found";
import Schedule from "@/pages/Schedule";
import Employees from "@/pages/Employees";
import Settings from "@/pages/Settings";
import Users from "@/pages/Users";
import Locations from "@/pages/Locations";
import Shifts from "@/pages/Shifts";
import Login from "@/pages/Login";
import Attendance from "@/pages/Attendance";
import Changelog from "@/pages/Changelog";
import ShiftTrades from "@/pages/ShiftTrades";
import OccurrenceReport from "@/pages/OccurrenceReport";
import VarianceReport from "@/pages/VarianceReport";
import Coaching from "@/pages/Coaching";
import Roster from "@/pages/Roster";
import TaskAssignment from "@/pages/TaskAssignment";
import Optimization from "@/pages/Optimization";
import OrderForm from "@/pages/OrderForm";
import OrderSubmissions from "@/pages/OrderSubmissions";
import SeasonalInventory from "@/pages/SeasonalInventory";
import TrailerManifests from "@/pages/TrailerManifests";
import TrailerManifestDetail from "@/pages/TrailerManifestDetail";
import TruckRoutes from "@/pages/TruckRoutes";
import Trailers from "@/pages/Trailers";
import Tractors from "@/pages/Tractors";
import WarehouseInventory from "@/pages/WarehouseInventory";
import WarehouseInventoryList from "@/pages/WarehouseInventoryList";
import WarehouseInventoryDetail from "@/pages/WarehouseInventoryDetail";
import Permissions from "@/pages/Permissions";
import JobTitleHierarchy from "@/pages/JobTitleHierarchy";
import CreditCardInspectionForm from "@/pages/CreditCardInspectionForm";
import CreditCardInspections from "@/pages/CreditCardInspections";
import DriverInspectionForm from "@/pages/DriverInspectionForm";
import DriverInspections from "@/pages/DriverInspections";
import DriverInspectionDetail from "@/pages/DriverInspectionDetail";
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
      <Route path="/attendance" component={Attendance} />
      <Route path="/users" component={Users} />
      <Route path="/locations" component={Locations} />
      <Route path="/shifts" component={Shifts} />
      <Route path="/settings" component={Settings} />
      <Route path="/changelog" component={Changelog} />
      <Route path="/trades" component={ShiftTrades} />
      <Route path="/reports/occurrences" component={OccurrenceReport} />
      <Route path="/reports/variance" component={VarianceReport} />
      <Route path="/coaching" component={Coaching} />
      <Route path="/roster" component={Roster} />
      <Route path="/tasks" component={TaskAssignment} />
      <Route path="/optimization" component={Optimization} />
      <Route path="/orders/new" component={OrderForm} />
      <Route path="/orders/edit/:id" component={OrderForm} />
      <Route path="/orders" component={OrderSubmissions} />
      <Route path="/seasonal-inventory" component={SeasonalInventory} />
      <Route path="/trailer-manifests/:id" component={TrailerManifestDetail} />
      <Route path="/trailer-manifests" component={TrailerManifests} />
      <Route path="/truck-routes" component={TruckRoutes} />
      <Route path="/trailers" component={Trailers} />
      <Route path="/tractors" component={Tractors} />
      <Route path="/warehouse-inventory/list" component={WarehouseInventoryList} />
      <Route path="/warehouse-inventory/:id" component={WarehouseInventoryDetail} />
      <Route path="/warehouse-inventory" component={WarehouseInventory} />
      <Route path="/permissions" component={Permissions} />
      <Route path="/job-title-hierarchy" component={JobTitleHierarchy} />
      <Route path="/credit-card-inspection/new" component={CreditCardInspectionForm} />
      <Route path="/credit-card-inspections" component={CreditCardInspections} />
      <Route path="/driver-inspection/new" component={DriverInspectionForm} />
      <Route path="/driver-inspections" component={DriverInspections} />
      <Route path="/driver-inspections/:id" component={DriverInspectionDetail} />
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
      <main className="flex-1 lg:ml-64 pt-16 lg:pt-0 min-h-screen bg-background">
        <ImpersonationBanner />
        <Router />
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <AuthenticatedApp />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
