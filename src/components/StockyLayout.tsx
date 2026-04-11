import { useState, useMemo } from "react";
import { useUserRole, type Permission } from "@/hooks/use-user-role";
import {
  LayoutDashboard,
  ClipboardList,
  Package,
  Users,
  ClipboardCheck,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  ArrowRightLeft,
  FileText,
  Scissors,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface StockyNavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  type: "tab" | "flow";
}

const defaultNavItems: StockyNavItem[] = [
  { id: "home", label: "Dashboard", icon: LayoutDashboard, type: "tab" },
  { id: "invoices", label: "Invoices", icon: FileText, type: "tab" },
  { id: "purchase_orders", label: "Purchase Orders", icon: ClipboardList, type: "flow" },
  { id: "inventory_view", label: "Inventory", icon: Package, type: "flow" },
  { id: "transfer_orders", label: "Transfers", icon: ArrowRightLeft, type: "flow" },
  { id: "suppliers", label: "Suppliers", icon: Users, type: "flow" },
  { id: "stocktake_module", label: "Stocktakes", icon: ClipboardCheck, type: "flow" },
  { id: "stock_adjustment", label: "Adjustments", icon: Scissors, type: "flow" },
  { id: "reports_hub", label: "Reports", icon: BarChart3, type: "flow" },
  { id: "account", label: "Settings", icon: Settings, type: "tab" },
];

interface StockyLayoutProps {
  activeTab: string;
  activeFlow: string | null;
  onTabChange: (tab: string) => void;
  onFlowChange: (flow: string) => void;
  children: React.ReactNode;
  navItems?: StockyNavItem[];
}

const StockyLayout = ({
  activeTab,
  activeFlow,
  onTabChange,
  onFlowChange,
  children,
  navItems = defaultNavItems,
}: StockyLayoutProps) => {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { hasPermission } = useUserRole();

  // Filter nav items by permission
  const NAV_PERMISSIONS: Record<string, Permission> = {
    purchase_orders: "create_po",
    stock_adjustment: "adjust_inventory",
    stocktake_module: "create_stocktake",
    reports_hub: "view_reports",
    account: "manage_settings",
    suppliers: "view_suppliers",
    transfer_orders: "manage_transfers",
  };

  const filteredNavItems = useMemo(() => {
    return navItems.filter(item => {
      const perm = NAV_PERMISSIONS[item.id];
      if (!perm) return true; // no restriction
      return hasPermission(perm);
    });
  }, [navItems, hasPermission]);

  const getActiveId = () => activeFlow || activeTab;

  const handleClick = (item: StockyNavItem) => {
    if (item.type === "tab") {
      onTabChange(item.id);
    } else {
      onFlowChange(item.id);
    }
    setMobileOpen(false);
  };

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className={cn("flex items-center gap-2 px-3 py-4 border-b border-border", collapsed && "justify-center")}>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold font-display text-foreground truncate">Sonic Invoice</h2>
            <p className="text-[10px] text-muted-foreground">Inventory Hub</p>
          </div>
        )}
        {/* Desktop collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden lg:flex p-1 rounded-md hover:bg-muted text-muted-foreground"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
        {/* Mobile close */}
        <button
          onClick={() => setMobileOpen(false)}
          className="lg:hidden p-1 rounded-md hover:bg-muted text-muted-foreground"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = getActiveId() === item.id;
          return (
            <button
              key={item.id}
              onClick={() => handleClick(item)}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-2.5 w-full rounded-md text-sm transition-colors",
                collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2",
                isActive
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="w-[18px] h-[18px] shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      {!collapsed && (
        <div className="px-3 py-3 border-t border-border mt-auto">
          <p className="text-[9px] text-muted-foreground">Sonic Invoice v1.0</p>
          <p className="text-[9px] text-muted-foreground">Stocky-style layout</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden lg:flex flex-col shrink-0 border-r border-border bg-card/50 h-full transition-[width] duration-200",
          collapsed ? "w-14" : "w-56"
        )}
      >
        {sidebarContent}
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60 lg:hidden" onClick={() => setMobileOpen(false)} />
          <aside className="fixed inset-y-0 left-0 z-50 w-64 bg-card border-r border-border overflow-y-auto lg:hidden animate-fade-in">
            {sidebarContent}
          </aside>
        </>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header with hamburger */}
        <header className="flex items-center gap-2 px-4 h-12 border-b border-border lg:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-sm font-semibold text-foreground">Sonic Invoice</span>
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
};

export default StockyLayout;
