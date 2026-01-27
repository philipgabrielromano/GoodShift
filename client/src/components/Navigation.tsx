import { Link, useLocation } from "wouter";
import { LayoutDashboard, Users, Settings, Menu, Shield, MapPin } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import goodwillLogo from "@/assets/goodwill-logo.png";

interface AuthStatus {
  isAuthenticated: boolean;
  user: { id: number; name: string; email: string; role: string } | null;
  ssoConfigured: boolean;
}

const baseNavItems = [
  { href: "/", label: "Schedule", icon: LayoutDashboard },
  { href: "/employees", label: "Employees", icon: Users },
];

const adminNavItems = [
  { href: "/users", label: "Users", icon: Shield },
  { href: "/locations", label: "Locations", icon: MapPin },
];

const settingsNavItems = [
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Navigation() {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const { data: authStatus } = useQuery<AuthStatus>({
    queryKey: ["/api/auth/status"],
  });

  const isAdmin = authStatus?.user?.role === "admin";
  const navItems = [
    ...baseNavItems,
    ...(isAdmin ? adminNavItems : []),
    ...settingsNavItems,
  ];

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 h-screen border-r bg-card fixed left-0 top-0 z-50">
        <div className="p-4 border-b">
          <img src={goodwillLogo} alt="Goodwill" className="h-10 w-auto" />
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              <div 
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
        
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon">
              <Menu className="w-5 h-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <div className="p-4 border-b">
              <img src={goodwillLogo} alt="Goodwill" className="h-10 w-auto" />
            </div>
            <nav className="flex-1 p-4 space-y-2">
              {navItems.map((item) => (
                <Link key={item.href} href={item.href}>
                  <div 
                    onClick={() => setMobileOpen(false)}
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
      </header>
    </>
  );
}
