import { Link, useLocation } from "wouter";
import { LayoutDashboard, Users, Settings, Menu, Shield, MapPin, Clock, AlertTriangle, LogOut, ScrollText, ArrowLeftRight, FileBarChart, ClipboardList, MessageSquare, UsersRound, ListTodo, Target, PackageOpen, FileText, ShieldCheck, Truck, Warehouse, CreditCard } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useState, useMemo } from "react";
import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import goodshiftLogo from "@assets/goodshift_1770590279218.png";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "./ThemeToggle";
import { queryClient } from "@/lib/queryClient";
import { APP_VERSION } from "@/lib/changelog";

interface AuthStatus {
  isAuthenticated: boolean;
  user: { id: number; name: string; email: string; role: string } | null;
  ssoConfigured: boolean;
  accessibleFeatures?: string[];
}

const changelogItem = { href: "/changelog", label: "Changelog", icon: ScrollText };

export function Navigation() {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const { data: authStatus } = useQuery<AuthStatus>({
    queryKey: ["/api/auth/status"],
  });

  const features = authStatus?.accessibleFeatures || [];
  const can = (feature: string) => features.includes(feature);
  const isAdmin = authStatus?.user?.role === "admin";

  type NavItem = { href: string; label: string; icon: any };

  const renderNavItem = (item: NavItem, prefix: string = "nav") => (
    <Link key={item.href} href={item.href}>
      <div 
        data-testid={`link-${prefix}-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
        className={clsx(
          "flex items-center gap-3 px-4 py-3 rounded transition-all duration-200 cursor-pointer group",
          location === item.href
            ? "bg-primary text-primary-foreground shadow-md shadow-primary/25 font-medium" 
            : "text-muted-foreground hover-elevate"
        )}
      >
        <item.icon className={clsx("w-5 h-5", location === item.href ? "text-primary-foreground" : "text-muted-foreground")} />
        {item.label}
      </div>
    </Link>
  );

  const renderMobileNavItem = (item: NavItem) => (
    <Link key={item.href} href={item.href}>
      <div 
        onClick={() => setMobileOpen(false)}
        data-testid={`link-mobile-nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
        className={clsx(
          "flex items-center gap-3 px-4 py-3 rounded transition-all duration-200 cursor-pointer",
          location === item.href
            ? "bg-primary text-primary-foreground shadow-md shadow-primary/25 font-medium" 
            : "text-muted-foreground hover-elevate"
        )}
      >
        <item.icon className="w-5 h-5" />
        {item.label}
      </div>
    </Link>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 h-screen border-r bg-card fixed left-0 top-0 z-50">
        <div className="p-4 border-b flex flex-col items-center">
          <img src={goodshiftLogo} alt="GoodShift" className="w-48 h-auto" data-testid="img-logo-sidebar" />
          <div className="mt-3 w-full">
            <NotificationBell showLabel />
          </div>
        </div>
        
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <div className="pt-1 pb-1 px-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider" data-testid="text-scheduling-heading">Scheduling</p>
          </div>
          {can("schedule.view") && renderNavItem({ href: "/", label: "Schedule", icon: LayoutDashboard }, "nav")}
          {can("shift_trades.view") && renderNavItem({ href: "/trades", label: "Shift Trades", icon: ArrowLeftRight }, "nav")}
          {can("attendance.view") && renderNavItem({ href: "/attendance", label: "Attendance", icon: AlertTriangle }, "nav")}
          {can("task_assignment.view") && renderNavItem({ href: "/tasks", label: "Task Assignment", icon: ListTodo }, "nav")}
          <div className="pt-3 pb-1 px-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider" data-testid="text-development-heading">Development</p>
          </div>
          {can("coaching.view") && renderNavItem({ href: "/coaching", label: "Coaching", icon: MessageSquare }, "nav")}

          {can("optimization.view") && (
            <>
              <div className="pt-3 pb-1 px-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider" data-testid="text-optimization-heading">Optimization</p>
              </div>
              {renderNavItem({ href: "/optimization", label: "Store Optimization", icon: Target }, "nav")}
            </>
          )}

          {(can("employees.view") || can("locations.view") || can("settings.global_config") || can("settings.ukg_config") || can("settings.ukg_sync") || can("settings.email_audit")) && (
            <>
              <div className="pt-3 pb-1 px-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider" data-testid="text-configuration-heading">Configuration</p>
              </div>
              {can("employees.view") && renderNavItem({ href: "/employees", label: "Employees", icon: Users }, "nav")}
              {can("locations.view") && renderNavItem({ href: "/locations", label: "Locations", icon: MapPin }, "nav")}
              {renderNavItem({ href: "/settings", label: "Settings", icon: Settings }, "nav")}
            </>
          )}

          {(can("orders.submit") || can("orders.view_all") || can("trailer_manifest.view") || can("warehouse_inventory.view") || can("credit_card_inspection.submit") || can("credit_card_inspection.view_all")) && (
            <>
              <div className="pt-3 pb-1 px-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider" data-testid="text-orders-heading">Orders</p>
              </div>
              {can("orders.submit") && renderNavItem({ href: "/orders/new", label: "Order Form", icon: PackageOpen }, "nav")}
              {can("orders.view_all") && renderNavItem({ href: "/orders", label: "Order Submissions", icon: FileText }, "nav")}
              {can("trailer_manifest.view") && renderNavItem({ href: "/trailer-manifests", label: "Trailer Manifest", icon: Truck }, "nav")}
              {can("warehouse_inventory.view") && renderNavItem({ href: "/warehouse-inventory", label: "Warehouse Inventory", icon: Warehouse }, "nav")}
              {can("credit_card_inspection.submit") && renderNavItem({ href: "/credit-card-inspection/new", label: "CC Inspection Form", icon: CreditCard }, "nav")}
              {can("credit_card_inspection.view_all") && renderNavItem({ href: "/credit-card-inspections", label: "CC Inspections", icon: CreditCard }, "nav")}
            </>
          )}

          {(can("reports.occurrences") || can("reports.variance") || can("reports.roster")) && (
            <>
              <div className="pt-3 pb-1 px-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider" data-testid="text-reports-heading">Reports</p>
              </div>
              {can("reports.occurrences") && renderNavItem({ href: "/reports/occurrences", label: "Occurrence Report", icon: ClipboardList }, "nav")}
              {can("reports.variance") && renderNavItem({ href: "/reports/variance", label: "Variance Report", icon: FileBarChart }, "nav")}
              {can("reports.roster") && renderNavItem({ href: "/roster", label: "Roster Targets", icon: UsersRound }, "nav")}
            </>
          )}

          {(can("users.view") || can("raw_shifts.view") || can("settings.permissions")) && (
            <>
              <div className="pt-3 pb-1 px-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider" data-testid="text-admin-heading">Admin</p>
              </div>
              {can("users.view") && renderNavItem({ href: "/users", label: "Users", icon: Shield }, "nav")}
              {can("raw_shifts.view") && renderNavItem({ href: "/shifts", label: "Shifts", icon: Clock }, "nav")}
              {can("settings.permissions") && renderNavItem({ href: "/permissions", label: "Permissions", icon: ShieldCheck }, "nav")}
            </>
          )}

          {renderNavItem(changelogItem, "nav")}
        </nav>

        <div className="p-4 border-t space-y-3">
          <div className="text-center">
            <span className="text-xs text-muted-foreground" data-testid="text-version-sidebar">v{APP_VERSION}</span>
          </div>
          <div className="bg-muted/50 rounded p-4">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">Current User</p>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 shrink-0 rounded-full bg-gradient-to-br from-accent to-primary"></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold break-words">{authStatus?.user?.name || "Guest"}</p>
                <p className="text-xs text-muted-foreground capitalize">{authStatus?.user?.role === "optimizer" ? "Store Optimizer" : authStatus?.user?.role || "Viewer"}</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-1">
              <ThemeToggle />
              <Button
                variant="ghost"
                size="icon"
                data-testid="button-logout-sidebar"
                onClick={() => {
                  window.location.href = "/api/auth/logout";
                }}
                title="Log out"
              >
                <LogOut className="w-5 h-5 text-muted-foreground" />
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 h-16 border-b bg-card/80 backdrop-blur-md z-50 flex items-center px-4 justify-between">
        <div className="flex items-center gap-2">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" data-testid="button-mobile-menu">
              <Menu className="w-5 h-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <div className="p-4 border-b flex flex-col items-center">
              <img src={goodshiftLogo} alt="GoodShift" className="w-48 h-auto" data-testid="img-logo-mobile" />
            </div>
            <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
              <div className="pt-1 pb-1 px-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Scheduling</p>
              </div>
              {can("schedule.view") && renderMobileNavItem({ href: "/", label: "Schedule", icon: LayoutDashboard })}
              {can("shift_trades.view") && renderMobileNavItem({ href: "/trades", label: "Shift Trades", icon: ArrowLeftRight })}
              {can("attendance.view") && renderMobileNavItem({ href: "/attendance", label: "Attendance", icon: AlertTriangle })}
              {can("task_assignment.view") && renderMobileNavItem({ href: "/tasks", label: "Task Assignment", icon: ListTodo })}
              <div className="pt-3 pb-1 px-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Development</p>
              </div>
              {can("coaching.view") && renderMobileNavItem({ href: "/coaching", label: "Coaching", icon: MessageSquare })}

              {can("optimization.view") && (
                <>
                  <div className="pt-3 pb-1 px-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Optimization</p>
                  </div>
                  {renderMobileNavItem({ href: "/optimization", label: "Store Optimization", icon: Target })}
                </>
              )}

              {(can("employees.view") || can("locations.view") || can("settings.global_config") || can("settings.ukg_config") || can("settings.ukg_sync") || can("settings.email_audit")) && (
                <>
                  <div className="pt-3 pb-1 px-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Configuration</p>
                  </div>
                  {can("employees.view") && renderMobileNavItem({ href: "/employees", label: "Employees", icon: Users })}
                  {can("locations.view") && renderMobileNavItem({ href: "/locations", label: "Locations", icon: MapPin })}
                  {(can("settings.global_config") || can("settings.ukg_config") || can("settings.ukg_sync") || can("settings.email_audit")) && renderMobileNavItem({ href: "/settings", label: "Settings", icon: Settings })}
                </>
              )}

              {(can("orders.submit") || can("orders.view_all") || can("trailer_manifest.view") || can("warehouse_inventory.view") || can("credit_card_inspection.submit") || can("credit_card_inspection.view_all")) && (
                <>
                  <div className="pt-3 pb-1 px-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Orders</p>
                  </div>
                  {can("orders.submit") && renderMobileNavItem({ href: "/orders/new", label: "Order Form", icon: PackageOpen })}
                  {can("orders.view_all") && renderMobileNavItem({ href: "/orders", label: "Order Submissions", icon: FileText })}
                  {can("trailer_manifest.view") && renderMobileNavItem({ href: "/trailer-manifests", label: "Trailer Manifest", icon: Truck })}
                  {can("warehouse_inventory.view") && renderMobileNavItem({ href: "/warehouse-inventory", label: "Warehouse Inventory", icon: Warehouse })}
                  {can("credit_card_inspection.submit") && renderMobileNavItem({ href: "/credit-card-inspection/new", label: "CC Inspection Form", icon: CreditCard })}
                  {can("credit_card_inspection.view_all") && renderMobileNavItem({ href: "/credit-card-inspections", label: "CC Inspections", icon: CreditCard })}
                </>
              )}

              {(can("reports.occurrences") || can("reports.variance") || can("reports.roster")) && (
                <>
                  <div className="pt-3 pb-1 px-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Reports</p>
                  </div>
                  {can("reports.occurrences") && renderMobileNavItem({ href: "/reports/occurrences", label: "Occurrence Report", icon: ClipboardList })}
                  {can("reports.variance") && renderMobileNavItem({ href: "/reports/variance", label: "Variance Report", icon: FileBarChart })}
                  {can("reports.roster") && renderMobileNavItem({ href: "/roster", label: "Roster Targets", icon: UsersRound })}
                </>
              )}

              {(can("users.view") || can("raw_shifts.view") || can("settings.permissions")) && (
                <>
                  <div className="pt-3 pb-1 px-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Admin</p>
                  </div>
                  {can("users.view") && renderMobileNavItem({ href: "/users", label: "Users", icon: Shield })}
                  {can("raw_shifts.view") && renderMobileNavItem({ href: "/shifts", label: "Shifts", icon: Clock })}
                  {can("settings.permissions") && renderMobileNavItem({ href: "/permissions", label: "Permissions", icon: ShieldCheck })}
                </>
              )}

              {renderMobileNavItem(changelogItem)}
            </nav>
            <div className="p-4 border-t mt-auto space-y-3">
              <div className="text-center">
                <span className="text-xs text-muted-foreground" data-testid="text-version-mobile">v{APP_VERSION}</span>
              </div>
              <div className="bg-muted/50 rounded p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Current User</p>
                  <ThemeToggle />
                </div>
                <p className="text-sm font-semibold truncate">{authStatus?.user?.name || "Guest"}</p>
                <p className="text-xs text-muted-foreground capitalize">{authStatus?.user?.role === "optimizer" ? "Store Optimizer" : authStatus?.user?.role || "Viewer"}</p>
              </div>
              <Button
                variant="outline"
                className="w-full"
                data-testid="button-logout-mobile"
                onClick={() => {
                  window.location.href = "/api/auth/logout";
                }}
              >
                <LogOut className="w-4 h-4 mr-2" />
                Log out
              </Button>
            </div>
          </SheetContent>
        </Sheet>
        </div>

        <img src={goodshiftLogo} alt="GoodShift" className="h-12 w-auto" />
        
        <div className="flex items-center gap-2">
          <NotificationBell />
        </div>
      </header>
    </>
  );
}
