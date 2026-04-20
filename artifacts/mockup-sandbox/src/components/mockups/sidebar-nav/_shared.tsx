import {
  LayoutDashboard, Users, Settings, Shield, MapPin, Clock, AlertTriangle,
  ScrollText, ArrowLeftRight, FileBarChart, ClipboardList, MessageSquare,
  UsersRound, ListTodo, Target, PackageOpen, FileText, ShieldCheck, Truck,
  Warehouse, CreditCard, Package, Boxes, ExternalLink, Calendar, BarChart3,
  Wrench, Cog, Home,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: any;
  external?: boolean;
  active?: boolean;
};

export type NavSection = {
  id: string;
  label: string;
  icon: any;
  items: NavItem[];
};

export const SECTIONS: NavSection[] = [
  {
    id: "scheduling",
    label: "Scheduling",
    icon: Calendar,
    items: [
      { href: "/", label: "Schedule", icon: LayoutDashboard, active: true },
      { href: "/trades", label: "Shift Trades", icon: ArrowLeftRight },
      { href: "/attendance", label: "Attendance", icon: AlertTriangle },
      { href: "/tasks", label: "Task Assignment", icon: ListTodo },
    ],
  },
  {
    id: "development",
    label: "Development",
    icon: MessageSquare,
    items: [
      { href: "/coaching", label: "Coaching", icon: MessageSquare },
      { href: "/optimization", label: "Store Optimization", icon: Target },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    icon: Wrench,
    items: [
      { href: "/orders/new", label: "Order Form", icon: PackageOpen },
      { href: "/orders", label: "Order Submissions", icon: FileText },
      { href: "/trailer-manifests", label: "Trailer Manifest", icon: Truck },
      { href: "/warehouse-inventory", label: "Warehouse Inventory", icon: Warehouse },
      { href: "/credit-card-inspection/new", label: "CC Inspection Form", icon: CreditCard },
      { href: "/credit-card-inspections", label: "CC Inspections", icon: CreditCard },
      { href: "/driver-inspection/new", label: "Driver Inspection", icon: ClipboardList },
      { href: "/driver-inspections", label: "Driver Inspections", icon: Truck },
      { href: "https://showroom.inflowinventory.com/x", label: "New Goods Showroom", icon: Package, external: true },
      { href: "https://app.inflowinventory.com/", label: "Stock Count", icon: Boxes, external: true },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    icon: BarChart3,
    items: [
      { href: "/reports/occurrences", label: "Occurrence Report", icon: ClipboardList },
      { href: "/reports/variance", label: "Variance Report", icon: FileBarChart },
      { href: "/roster", label: "Roster Targets", icon: UsersRound },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    icon: Cog,
    items: [
      { href: "/employees", label: "Employees", icon: Users },
      { href: "/locations", label: "Locations", icon: MapPin },
      { href: "/users", label: "Users", icon: Shield },
      { href: "/shifts", label: "Shifts", icon: Clock },
      { href: "/permissions", label: "Permissions", icon: ShieldCheck },
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/changelog", label: "Changelog", icon: ScrollText },
    ],
  },
];

export function MockContent({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <main className="flex-1 bg-background p-8 overflow-auto">
      <div className="mb-6">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{subtitle}</p>
        <h1 className="text-2xl font-bold text-foreground mt-1">{title}</h1>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {[
          { label: "Scheduled today", value: "42" },
          { label: "Open shifts", value: "5" },
          { label: "Coaching due", value: "3" },
          { label: "Pending tasks", value: "11" },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="text-2xl font-semibold text-foreground mt-1">{s.value}</p>
          </div>
        ))}
      </div>
      <div className="mt-6 rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">Page content area (mock)</p>
      </div>
    </main>
  );
}

export function SidebarHeader({ subtitle }: { subtitle?: string }) {
  return (
    <div className="px-4 pt-4 pb-3 border-b border-border">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
          <Home className="w-4 h-4 text-primary-foreground" />
        </div>
        <div>
          <p className="text-sm font-bold text-foreground leading-tight">GoodShift</p>
          {subtitle && <p className="text-[10px] text-muted-foreground leading-tight">{subtitle}</p>}
        </div>
      </div>
    </div>
  );
}

export function SidebarFooter() {
  return (
    <div className="p-3 border-t border-border">
      <div className="flex items-center gap-2 rounded p-2 bg-muted/50">
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary to-primary/40 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground truncate">Alex Manager</p>
          <p className="text-[10px] text-muted-foreground">Store Optimizer</p>
        </div>
        <span className="text-[10px] text-muted-foreground">v3.0</span>
      </div>
    </div>
  );
}
