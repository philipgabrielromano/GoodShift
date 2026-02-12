import { Link, useLocation } from "wouter";
import { LayoutDashboard, Users, Settings, Menu, Shield, MapPin, Clock, AlertTriangle, LogOut, ScrollText, ArrowLeftRight, FileBarChart, ClipboardList, MessageSquare } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useState } from "react";
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
}

// Items shown to all authenticated users
const viewerNavItems = [
  { href: "/", label: "Schedule", icon: LayoutDashboard },
  { href: "/trades", label: "Shift Trades", icon: ArrowLeftRight },
  { href: "/attendance", label: "Attendance", icon: AlertTriangle },
  { href: "/coaching", label: "Coaching", icon: MessageSquare },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/changelog", label: "Changelog", icon: ScrollText },
];

// Items shown to managers and admins only
const managerNavItems = [
  { href: "/employees", label: "Employees", icon: Users },
  { href: "/locations", label: "Locations", icon: MapPin },
];

// Report items shown to managers and admins
const reportNavItems = [
  { href: "/reports/occurrences", label: "Occurrence Report", icon: ClipboardList },
  { href: "/reports/variance", label: "Variance Report", icon: FileBarChart },
];

// Items shown to admins only
const adminNavItems = [
  { href: "/users", label: "Users", icon: Shield },
  { href: "/shifts", label: "Shifts", icon: Clock },
];

export function Navigation() {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const { data: authStatus } = useQuery<AuthStatus>({
    queryKey: ["/api/auth/status"],
  });

  const isAdmin = authStatus?.user?.role === "admin";
  const isManager = authStatus?.user?.role === "manager";
  const isManagerOrAdmin = isAdmin || isManager;
  
  const navItems = [
    ...viewerNavItems,
    ...(isManagerOrAdmin ? managerNavItems : []),
    ...(isAdmin ? adminNavItems : []),
  ];

  const renderNavItem = (item: typeof viewerNavItems[0], prefix: string = "nav") => (
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
          {navItems.map((item) => renderNavItem(item, "nav"))}
          {isManagerOrAdmin && (
            <>
              <div className="pt-3 pb-1 px-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider" data-testid="text-reports-heading">Reports</p>
              </div>
              {reportNavItems.map((item) => renderNavItem(item, "nav"))}
            </>
          )}
        </nav>

        <div className="p-4 border-t space-y-3">
          <div className="text-center">
            <span className="text-xs text-muted-foreground" data-testid="text-version-sidebar">v{APP_VERSION}</span>
          </div>
          <div className="bg-muted/50 rounded p-4">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">Current User</p>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-primary"></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{authStatus?.user?.name || "Guest"}</p>
                <p className="text-xs text-muted-foreground capitalize">{authStatus?.user?.role || "Viewer"}</p>
              </div>
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
                <LogOut className="w-4 h-4 text-muted-foreground" />
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 h-16 border-b bg-card/80 backdrop-blur-md z-50 flex items-center px-4 justify-between">
        <img src={goodshiftLogo} alt="GoodShift" className="h-12 w-auto" />
        
        <div className="flex items-center gap-2">
          <NotificationBell />
        
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon">
              <Menu className="w-5 h-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <div className="p-4 border-b flex flex-col items-center">
              <img src={goodshiftLogo} alt="GoodShift" className="w-48 h-auto" data-testid="img-logo-mobile" />
            </div>
            <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
              {navItems.map((item) => (
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
              ))}
              {isManagerOrAdmin && (
                <>
                  <div className="pt-3 pb-1 px-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Reports</p>
                  </div>
                  {reportNavItems.map((item) => (
                    <Link key={item.href} href={item.href}>
                      <div 
                        onClick={() => setMobileOpen(false)}
                        data-testid={`link-mobile-nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                        className={clsx(
                          "flex items-center gap-3 px-4 py-3 rounded transition-all duration-200 cursor-pointer",
                          location.startsWith(item.href)
                            ? "bg-primary text-primary-foreground shadow-md shadow-primary/25 font-medium" 
                            : "text-muted-foreground hover-elevate"
                        )}
                      >
                        <item.icon className="w-5 h-5" />
                        {item.label}
                      </div>
                    </Link>
                  ))}
                </>
              )}
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
                <p className="text-xs text-muted-foreground capitalize">{authStatus?.user?.role || "Viewer"}</p>
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
      </header>
    </>
  );
}
