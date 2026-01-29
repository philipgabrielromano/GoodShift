import { Link, useLocation } from "wouter";
import { LayoutDashboard, Users, Settings, Menu, Shield, MapPin, Clock, AlertTriangle } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import goodwillLogo from "@/assets/goodwill-logo.png";
import { NotificationBell } from "./NotificationBell";

interface AuthStatus {
  isAuthenticated: boolean;
  user: { id: number; name: string; email: string; role: string } | null;
  ssoConfigured: boolean;
}

// Items shown to all authenticated users
const viewerNavItems = [
  { href: "/", label: "Schedule", icon: LayoutDashboard },
  { href: "/attendance", label: "Attendance", icon: AlertTriangle },
];

// Items shown to managers and admins only
const managerNavItems = [
  { href: "/employees", label: "Employees", icon: Users },
];

// Items shown to admins only
const adminNavItems = [
  { href: "/users", label: "Users", icon: Shield },
  { href: "/locations", label: "Locations", icon: MapPin },
  { href: "/shifts", label: "Shifts", icon: Clock },
  { href: "/settings", label: "Settings", icon: Settings },
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

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 h-screen border-r bg-card fixed left-0 top-0 z-50">
        <div className="p-4 border-b flex flex-col items-center relative">
          <img src={goodwillLogo} alt="Goodwill" className="h-12 w-auto" data-testid="img-logo-sidebar" />
          <span className="text-lg font-bold text-foreground mt-1" style={{ fontFamily: "'Lato', sans-serif" }} data-testid="text-brand-sidebar">GoodShift</span>
          <div className="absolute right-3 top-3">
            <NotificationBell />
          </div>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              <div 
                data-testid={`link-nav-${item.label.toLowerCase()}`}
                className={clsx(
                  "flex items-center gap-3 px-4 py-3 rounded transition-all duration-200 cursor-pointer group",
                  location === item.href 
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/25 font-medium" 
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <item.icon className={clsx("w-5 h-5", location === item.href ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground")} />
                {item.label}
              </div>
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t">
          <div className="bg-muted/50 rounded p-4">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">Current User</p>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-purple-600"></div>
              <div>
                <p className="text-sm font-semibold">{authStatus?.user?.name || "Guest"}</p>
                <p className="text-xs text-muted-foreground capitalize">{authStatus?.user?.role || "Viewer"}</p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 h-16 border-b bg-card/80 backdrop-blur-md z-50 flex items-center px-4 justify-between">
        <img src={goodwillLogo} alt="Goodwill" className="h-8 w-auto" />
        
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
              <img src={goodwillLogo} alt="Goodwill" className="h-12 w-auto" data-testid="img-logo-mobile" />
              <span className="text-lg font-bold text-foreground mt-1" style={{ fontFamily: "'Lato', sans-serif" }} data-testid="text-brand-mobile">GoodShift</span>
            </div>
            <nav className="flex-1 p-4 space-y-2">
              {navItems.map((item) => (
                <Link key={item.href} href={item.href}>
                  <div 
                    onClick={() => setMobileOpen(false)}
                    data-testid={`link-mobile-nav-${item.label.toLowerCase()}`}
                    className={clsx(
                      "flex items-center gap-3 px-4 py-3 rounded transition-all duration-200 cursor-pointer",
                      location === item.href 
                        ? "bg-primary text-primary-foreground shadow-md shadow-primary/25 font-medium" 
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <item.icon className="w-5 h-5" />
                    {item.label}
                  </div>
                </Link>
              ))}
            </nav>
          </SheetContent>
        </Sheet>
        </div>
      </header>
    </>
  );
}
