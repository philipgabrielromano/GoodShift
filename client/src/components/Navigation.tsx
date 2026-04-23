import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Users, Settings, Menu, Shield, MapPin, Clock, AlertTriangle,
  LogOut, ScrollText, ArrowLeftRight, FileBarChart, ClipboardList, MessageSquare,
  UsersRound, ListTodo, Target, PackageOpen, FileText, ShieldCheck, Truck,
  Warehouse, CreditCard, Package, Boxes, ExternalLink, Search, ChevronRight, Network,
} from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { useState, useMemo, useEffect, useCallback } from "react";
import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import goodshiftLogo from "@assets/goodshift_1770590279218.png";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "./ThemeToggle";
import { APP_VERSION } from "@/lib/changelog";

interface AuthStatus {
  isAuthenticated: boolean;
  user: { id: number; name: string; email: string; role: string } | null;
  ssoConfigured: boolean;
  accessibleFeatures?: string[];
}

type NavItem = { href: string; label: string; icon: any; external?: boolean };
type NavSection = { id: string; label: string; items: NavItem[] };

const STORAGE_KEY = "goodshift.nav.sectionState.v1";

function loadSectionState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSectionState(state: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function Navigation() {
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const { data: authStatus } = useQuery<AuthStatus>({
    queryKey: ["/api/auth/status"],
  });

  const features = authStatus?.accessibleFeatures || [];
  const can = useCallback((feature: string) => features.includes(feature), [features]);

  // Build nav sections from permissions
  const sections: NavSection[] = useMemo(() => {
    const built: NavSection[] = [];

    const scheduling: NavItem[] = [];
    if (can("schedule.view")) scheduling.push({ href: "/", label: "Schedule", icon: LayoutDashboard });
    if (can("shift_trades.view")) scheduling.push({ href: "/trades", label: "Shift Trades", icon: ArrowLeftRight });
    if (can("attendance.view")) scheduling.push({ href: "/attendance", label: "Attendance", icon: AlertTriangle });
    if (can("task_assignment.view")) scheduling.push({ href: "/tasks", label: "Task Assignment", icon: ListTodo });
    if (scheduling.length) built.push({ id: "scheduling", label: "Scheduling", items: scheduling });

    const development: NavItem[] = [];
    if (can("coaching.view")) development.push({ href: "/coaching", label: "Coaching", icon: MessageSquare });
    if (can("optimization.view")) development.push({ href: "/optimization", label: "Store Optimization", icon: Target });
    if (development.length) built.push({ id: "development", label: "Development", items: development });

    const orders: NavItem[] = [];
    if (can("orders.submit")) orders.push({ href: "/orders/new", label: "Order Form", icon: PackageOpen });
    if (can("orders.view_all")) orders.push({ href: "/orders", label: "Order Submissions", icon: FileText });
    if (can("seasonal_inventory.view")) orders.push({ href: "/seasonal-inventory", label: "Seasonal Inventory", icon: PackageOpen });
    if (can("trailer_manifest.view")) orders.push({ href: "/trailer-manifests", label: "Trailer Manifest", icon: Truck });
    if (can("truck_routes.edit")) orders.push({ href: "/truck-routes", label: "Truck Routes", icon: Truck });
    if (can("warehouse_inventory.view")) orders.push({ href: "/warehouse-inventory", label: "Warehouse Inventory", icon: Warehouse });
    if (can("credit_card_inspection.submit")) orders.push({ href: "/credit-card-inspection/new", label: "CC Inspection Form", icon: CreditCard });
    if (can("credit_card_inspection.view_all")) orders.push({ href: "/credit-card-inspections", label: "CC Inspections", icon: CreditCard });
    if (can("driver_inspection.submit")) orders.push({ href: "/driver-inspection/new", label: "Driver Inspection", icon: ClipboardList });
    if (can("driver_inspection.view_all")) orders.push({ href: "/driver-inspections", label: "Driver Inspections", icon: Truck });
    if (orders.length) built.push({ id: "orders", label: "Ordering and Logging", items: orders });

    // Inventory (always visible — external links)
    built.push({
      id: "inventory",
      label: "Inventory",
      items: [
        { href: "https://showroom.inflowinventory.com/9deec6d6-bb02-42a4-a37f-3f50f8ad71f5", label: "New Goods and Supplies Showroom", icon: Package, external: true },
        { href: "https://app.inflowinventory.com/", label: "Stock Count", icon: Boxes, external: true },
      ],
    });

    const reports: NavItem[] = [];
    if (can("reports.occurrences")) reports.push({ href: "/reports/occurrences", label: "Occurrence Report", icon: ClipboardList });
    if (can("reports.variance")) reports.push({ href: "/reports/variance", label: "Variance Report", icon: FileBarChart });
    if (can("reports.roster")) reports.push({ href: "/roster", label: "Roster Targets", icon: UsersRound });
    if (reports.length) built.push({ id: "reports", label: "Reports", items: reports });

    const configuration: NavItem[] = [];
    if (can("employees.view")) configuration.push({ href: "/employees", label: "Employees", icon: Users });
    if (can("locations.view")) configuration.push({ href: "/locations", label: "Locations", icon: MapPin });
    const settingsAccess = can("settings.global_config") || can("settings.ukg_config") || can("settings.ukg_sync") || can("settings.email_audit");
    if (settingsAccess || configuration.length) {
      configuration.push({ href: "/settings", label: "Settings", icon: Settings });
    }
    if (configuration.length) built.push({ id: "configuration", label: "Configuration", items: configuration });

    const admin: NavItem[] = [];
    if (can("users.view")) admin.push({ href: "/users", label: "Users", icon: Shield });
    if (can("raw_shifts.view")) admin.push({ href: "/shifts", label: "Shifts", icon: Clock });
    if (can("settings.permissions")) admin.push({ href: "/permissions", label: "Permissions", icon: ShieldCheck });
    if (can("settings.permissions")) admin.push({ href: "/job-title-hierarchy", label: "Job Title Hierarchy", icon: Network });
    admin.push({ href: "/changelog", label: "Changelog", icon: ScrollText });
    if (admin.length) built.push({ id: "admin", label: "Admin", items: admin });

    return built;
  }, [can]);

  // Determine which section contains the active route (for default-open behavior)
  const activeSectionId = useMemo(() => {
    for (const s of sections) {
      if (s.items.some((i) => !i.external && i.href === location)) return s.id;
    }
    return null;
  }, [sections, location]);

  // Per-section collapsed state, persisted; default = closed unless this section holds the active route
  const [sectionState, setSectionState] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setSectionState(loadSectionState());
  }, []);

  const isSectionOpen = (id: string) => {
    if (id in sectionState) return sectionState[id];
    return id === activeSectionId;
  };

  const toggleSection = (id: string) => {
    setSectionState((prev) => {
      const next = { ...prev, [id]: !isSectionOpen(id) };
      saveSectionState(next);
      return next;
    });
  };

  // ⌘K / Ctrl+K to open the command palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const runCommand = (item: NavItem) => {
    setPaletteOpen(false);
    setMobileOpen(false);
    if (item.external) {
      window.open(item.href, "_blank", "noopener,noreferrer");
    } else {
      setLocation(item.href);
    }
  };

  // Auto-expand a previously-collapsed section when navigating into it via command palette / link
  useEffect(() => {
    if (!activeSectionId) return;
    setSectionState((prev) => {
      if (prev[activeSectionId] === false) {
        const next = { ...prev, [activeSectionId]: true };
        saveSectionState(next);
        return next;
      }
      return prev;
    });
  }, [activeSectionId]);

  const renderItem = (item: NavItem, ctx: "desktop" | "mobile") => {
    const active = !item.external && location === item.href;
    const testId = `link-${ctx === "mobile" ? "mobile-nav" : "nav"}-${item.label.toLowerCase().replace(/\s+/g, "-")}`;
    const className = clsx(
      "flex items-center gap-3 px-4 py-2.5 rounded transition-all duration-200 cursor-pointer group text-sm",
      active
        ? "bg-primary text-primary-foreground shadow-md shadow-primary/25 font-medium"
        : "text-muted-foreground hover-elevate"
    );
    if (item.external) {
      return (
        <a
          key={item.href}
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => ctx === "mobile" && setMobileOpen(false)}
          data-testid={testId}
          className={className}
        >
          <item.icon className={clsx("w-5 h-5", active ? "text-primary-foreground" : "text-muted-foreground")} />
          <span className="flex-1">{item.label}</span>
          <ExternalLink className="w-3.5 h-3.5 opacity-60" />
        </a>
      );
    }
    return (
      <Link key={item.href} href={item.href}>
        <div
          onClick={() => ctx === "mobile" && setMobileOpen(false)}
          data-testid={testId}
          className={className}
        >
          <item.icon className={clsx("w-5 h-5", active ? "text-primary-foreground" : "text-muted-foreground")} />
          {item.label}
        </div>
      </Link>
    );
  };

  const renderSection = (section: NavSection, ctx: "desktop" | "mobile") => {
    const open = isSectionOpen(section.id);
    const hasActive = section.id === activeSectionId;
    return (
      <div key={section.id} className="mt-1">
        <button
          type="button"
          onClick={() => toggleSection(section.id)}
          data-testid={`button-section-${ctx === "mobile" ? "mobile-" : ""}${section.id}`}
          className="w-full flex items-center justify-between px-4 py-2 rounded hover-elevate group"
        >
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            {section.label}
            {!open && hasActive && (
              <span className="w-1.5 h-1.5 rounded-full bg-primary" aria-label="contains active page" />
            )}
          </span>
          <ChevronRight
            className={clsx(
              "w-3.5 h-3.5 text-muted-foreground transition-transform",
              open && "rotate-90"
            )}
          />
        </button>
        {open && (
          <div className="mt-1 space-y-1">
            {section.items.map((item) => renderItem(item, ctx))}
          </div>
        )}
      </div>
    );
  };

  const searchButton = (ctx: "desktop" | "mobile") => (
    <button
      type="button"
      onClick={() => {
        setPaletteOpen(true);
        if (ctx === "mobile") setMobileOpen(false);
      }}
      data-testid={`button-search-${ctx}`}
      className="w-full flex items-center gap-2 px-3 py-2 mb-2 rounded border border-border bg-muted/40 text-muted-foreground hover-elevate text-sm"
    >
      <Search className="w-4 h-4" />
      <span className="flex-1 text-left">Search…</span>
      <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border border-border bg-background px-1.5 text-[10px] font-medium text-muted-foreground">
        ⌘K
      </kbd>
    </button>
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

        <nav className="flex-1 p-3 overflow-y-auto">
          {searchButton("desktop")}
          {sections.map((s) => renderSection(s, "desktop"))}
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
            <SheetContent side="left" className="w-72 p-0 flex flex-col">
              <div className="p-4 border-b flex flex-col items-center">
                <img src={goodshiftLogo} alt="GoodShift" className="w-48 h-auto" data-testid="img-logo-mobile" />
              </div>
              <nav className="flex-1 p-3 overflow-y-auto">
                {searchButton("mobile")}
                {sections.map((s) => renderSection(s, "mobile"))}
              </nav>
              <div className="p-4 border-t space-y-3">
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
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setPaletteOpen(true)}
            data-testid="button-search-mobile-header"
            title="Search"
          >
            <Search className="w-5 h-5" />
          </Button>
          <NotificationBell />
        </div>
      </header>

      {/* Command palette */}
      <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <CommandInput placeholder="Search pages, reports, forms…" data-testid="input-command-palette" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {sections.map((section) => (
            <CommandGroup key={section.id} heading={section.label}>
              {section.items.map((item) => (
                <CommandItem
                  key={`${section.id}:${item.href}`}
                  value={`${section.label} ${item.label}`}
                  onSelect={() => runCommand(item)}
                  data-testid={`command-item-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <item.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span>{item.label}</span>
                  {item.external && <ExternalLink className="ml-auto w-3.5 h-3.5 opacity-60" />}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
