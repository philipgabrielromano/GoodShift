import { Link, useLocation } from "wouter";
import { LayoutDashboard, Users, Settings, Menu, Shield, MapPin, Clock, AlertTriangle, LogOut, ScrollText, ArrowLeftRight, FileBarChart, ClipboardList, MessageSquare, UsersRound, ListTodo, Target, PackageOpen, FileText, ShieldCheck } from "lucide-react";
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
          (location === item.href || (item.href !== "/" && location.startsWith(item.href)))
            ? "bg-primary text-primary-foreground shadow-md shadow-primary/25 font-medium" 
            : "text-muted-foreground hover-elevate"
        )}
      >
        <item.icon className={clsx("w-5 h-5", (location === item.href || (item.href !== "/" && location.startsWith(item.href))) ? "text-primary-foreground" : "text-muted-foreground")} />
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
          (location === item.href || (item.href !== "/" && location.startsWith(item.href)))
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
          {can("schedule") && renderNavItem({ href: "/", label: "Schedule", icon: LayoutDashboard }, "nav")}
          {can("shift_trades") && renderNavItem({ href: "/trades", label: "Shift Trades", icon: ArrowLeftRight }, "nav")}
          {can("attendance") && renderNavItem({ href: "/attendance", label: "Attendance", icon: AlertTriangle }, "nav")}
          {can("task_assignment") && renderNavItem({ href: "/tasks", label: "Task Assignment", icon: ListTodo }, "nav")}
          <div className="pt-3 pb-1 px-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider" data-testid="text-development-heading">Development</p>
          </div>
          {can("coaching") && renderNavItem({ href: "/coaching", label: "Coaching", icon: MessageSquare }, "nav")}

          {can("optimization") && (
            <>
              <div className="pt-3 pb-1 px-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider" data-testid="text-optimization-heading">Optimization</p>
              </div>
              {renderNavItem({ href: "/optimization", label: "Store Optimization", icon: Target }, "nav")}
            </>
          )}

          {(can("employees") || can("locations") || can("settings")) && (
            <>
              <div className="pt-3 pb-1 px-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider" data-testid="text-configuration-heading">Configuration</p>
              </div>
              {can("employees") && renderNavItem({ href: "/employees", label: "Employees", icon: Users }, "nav")}
              {can("locations") && renderNavItem({ href: "/locations", label: "Locations", icon: MapPin }, "nav")}
              {can("settings") && renderNavItem({ href: "/settings", label: "Settings", icon: Settings }, "nav")}
            </>
          )}

          {can("orders") && (
            <>
              <div className="pt-3 pb-1 px-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider" data-testid="text-orders-heading">Orders</p>
              </div>
              {renderNavItem({ href: "/orders/new", label: "Order Form", icon: PackageOpen }, "nav")}
              {renderNavItem({ href: "/orders", label: "Order Submissions", icon: FileText }, "nav")}
            </>
          )}

          {can("reports") && (
            <>
              <div className="pt-3 pb-1 px-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider" data-testid="text-reports-heading">Reports</p>
              </div>
              {renderNavItem({ href: "/reports/occurrences", label: "Occurrence Report", icon: ClipboardList }, "nav")}
              {renderNavItem({ href: "/reports/variance", label: "Variance Report", icon: FileBarChart }, "nav")}
              {renderNavItem({ href: "/roster", label: "Roster Targets", icon: UsersRound }, "nav")}
            </>
          )}

          {(can("users") || can("raw_shifts")) && (
            <>
              <div className="pt-3 pb-1 px-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider" data-testid="text-admin-heading">Admin</p>
              </div>
              {can("users") && renderNavItem({ href: "/users", label: "Users", icon: Shield }, "nav")}
              {can("raw_shifts") && renderNavItem({ href: "/shifts", label: "Shifts", icon: Clock }, "nav")}
              {isAdmin && renderNavItem({ href: "/permissions", label: "Permissions", icon: ShieldCheck }, "nav")}
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
              {can("schedule") && renderMobileNavItem({ href: "/", label: "Schedule", icon: LayoutDashboard })}
              {can("shift_trades") && renderMobileNavItem({ href: "/trades", label: "Shift Trades", icon: ArrowLeftRight })}
              {can("attendance") && renderMobileNavItem({ href: "/attendance", label: "Attendance", icon: AlertTriangle })}
              {can("task_assignment") && renderMobileNavItem({ href: "/tasks", label: "Task Assignment", icon: ListTodo })}
              <div className="pt-3 pb-1 px-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Development</p>
              </div>
              {can("coaching") && renderMobileNavItem({ href: "/coaching", label: "Coaching", icon: MessageSquare })}

              {can("optimization") && (
                <>
                  <div className="pt-3 pb-1 px-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Optimization</p>
                  </div>
                  {renderMobileNavItem({ href: "/optimization", label: "Store Optimization", icon: Target })}
                </>
              )}

              {(can("employees") || can("locations") || can("settings")) && (
                <>
                  <div className="pt-3 pb-1 px-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Configuration</p>
                  </div>
                  {can("employees") && renderMobileNavItem({ href: "/employees", label: "Employees", icon: Users })}
                  {can("locations") && renderMobileNavItem({ href: "/locations", label: "Locations", icon: MapPin })}
                  {can("settings") && renderMobileNavItem({ href: "/settings", label: "Settings", icon: Settings })}
                </>
              )}

              {can("orders") && (
                <>
                  <div className="pt-3 pb-1 px-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Orders</p>
                  </div>
                  {renderMobileNavItem({ href: "/orders/new", label: "Order Form", icon: PackageOpen })}
                  {renderMobileNavItem({ href: "/orders", label: "Order Submissions", icon: FileText })}
                </>
              )}

              {can("reports") && (
                <>
                  <div className="pt-3 pb-1 px-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Reports</p>
                  </div>
                  {renderMobileNavItem({ href: "/reports/occurrences", label: "Occurrence Report", icon: ClipboardList })}
                  {renderMobileNavItem({ href: "/reports/variance", label: "Variance Report", icon: FileBarChart })}
                  {renderMobileNavItem({ href: "/roster", label: "Roster Targets", icon: UsersRound })}
                </>
              )}

              {(can("users") || can("raw_shifts")) && (
                <>
                  <div className="pt-3 pb-1 px-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Admin</p>
                  </div>
                  {can("users") && renderMobileNavItem({ href: "/users", label: "Users", icon: Shield })}
                  {can("raw_shifts") && renderMobileNavItem({ href: "/shifts", label: "Shifts", icon: Clock })}
                  {isAdmin && renderMobileNavItem({ href: "/permissions", label: "Permissions", icon: ShieldCheck })}
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
