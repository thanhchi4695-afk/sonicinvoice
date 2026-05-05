import { useState, useMemo, useEffect } from "react";
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
  ChevronDown,
  Menu,
  X,
  ArrowRightLeft,
  FileText,
  Scissors,
  Brain,
  GraduationCap,
  History as HistoryIcon,
  CreditCard,
  Sparkles,
  TrendingDown,
  TrendingUp,
  MessageCircle,
  Shield,
  Search,
  Boxes,
  Truck,
  Wrench,
  Layers,
  Globe,
  HeartPulse,
  Image as ImageIcon,
  Megaphone,
  Bot,
  DollarSign,
  ShoppingCart,
  Download,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import CollectionAutopilotWidget from "@/components/CollectionAutopilotWidget";

export interface StockyNavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  type: "tab" | "flow";
}

interface NavGroup {
  id: string;
  label: string;
  icon: React.ElementType;
  items: StockyNavItem[];
}

/**
 * Apple-inspired grouped navigation. Same IDs as before — no behaviour change
 * downstream. Active group expands automatically; collapsed sidebar shows the
 * group icon as a quick affordance.
 */
const defaultGroups: NavGroup[] = [
  {
    id: "main",
    label: "Main",
    icon: LayoutDashboard,
    items: [
      { id: "home", label: "Home", icon: LayoutDashboard, type: "tab" },
      { id: "ai_agents", label: "AI Agents", icon: Brain, type: "tab" },
      { id: "invoices", label: "Invoices", icon: FileText, type: "tab" },
      { id: "processing_history", label: "Processing History", icon: HistoryIcon, type: "flow" },
    ],
  },
  {
    id: "stock",
    label: "Stock",
    icon: Boxes,
    items: [
      { id: "inventory_view", label: "Inventory", icon: Package, type: "flow" },
      { id: "stock_adjustment", label: "Stock Adjustments", icon: Scissors, type: "flow" },
      { id: "stocktake_module", label: "Stocktakes", icon: ClipboardCheck, type: "flow" },
      { id: "transfer_orders", label: "Transfers", icon: ArrowRightLeft, type: "flow" },
    ],
  },
  {
    id: "suppliers",
    label: "Suppliers",
    icon: Truck,
    items: [
      { id: "purchase_orders", label: "Purchase Orders", icon: ClipboardList, type: "flow" },
      { id: "suppliers", label: "Suppliers", icon: Users, type: "flow" },
      { id: "supplier_intelligence", label: "Supplier Brain", icon: Brain, type: "flow" },
      { id: "teach_invoice_tutorial", label: "Teach Invoices Tour", icon: GraduationCap, type: "flow" },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    icon: BarChart3,
    items: [
      { id: "reports_hub", label: "Reports", icon: BarChart3, type: "flow" },
      { id: "restock_suggestions", label: "Restock Suggestions", icon: Sparkles, type: "flow" },
      { id: "pricing_assistant", label: "Pricing", icon: TrendingDown, type: "flow" },
      { id: "pricing_intelligence", label: "Price Intelligence", icon: TrendingUp, type: "tab" },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    icon: Wrench,
    items: [
      { id: "tools", label: "All Tools", icon: Wrench, type: "tab" },
      { id: "margin_guardian", label: "Margin Guardian", icon: Shield, type: "tab" },
      { id: "collection_seo", label: "Collection SEO AI", icon: Globe, type: "flow" },
      { id: "feed_health", label: "Feed Health", icon: HeartPulse, type: "flow" },
      { id: "feed_optimise", label: "AI Feed Optimisation", icon: Sparkles, type: "flow" },
      { id: "image_seo", label: "Image SEO Powerhouse", icon: ImageIcon, type: "flow" },
      { id: "image_optimise", label: "Image Optimisation", icon: ImageIcon, type: "flow" },
      { id: "csv_seo", label: "CSV SEO Optimizer", icon: Search, type: "flow" },
      { id: "organic_seo", label: "Organic SEO Blog", icon: Search, type: "flow" },
      { id: "geo_agentic", label: "Local SEO", icon: Globe, type: "flow" },
      { id: "social_media", label: "Social Media", icon: Megaphone, type: "flow" },
      { id: "competitor_intel", label: "Competitor Intel", icon: Bot, type: "flow" },
      { id: "price_lookup", label: "Price Lookup", icon: DollarSign, type: "flow" },
      { id: "google_ads_setup", label: "Google Ads Setup", icon: ShoppingCart, type: "flow" },
      { id: "meta_ads_setup", label: "Meta Ads Setup", icon: Megaphone, type: "flow" },
      { id: "performance", label: "Ad Performance", icon: BarChart3, type: "flow" },
      { id: "lightspeed_convert", label: "Lightspeed Converter", icon: Download, type: "flow" },
      { id: "accounting", label: "Accounting", icon: FileText, type: "flow" },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    items: [
      { id: "account", label: "Account", icon: User, type: "tab" },
      { id: "billing", label: "Billing", icon: CreditCard, type: "tab" },
      { id: "support_chat", label: "Chat with Support", icon: MessageCircle, type: "tab" },
    ],
  },
];

interface StockyLayoutProps {
  activeTab: string;
  activeFlow: string | null;
  onTabChange: (tab: string) => void;
  onFlowChange: (flow: string) => void;
  children: React.ReactNode;
  /** Optional flat override (legacy) — if provided, it replaces all groups. */
  navItems?: StockyNavItem[];
}

const NAV_PERMISSIONS: Record<string, Permission> = {
  purchase_orders: "create_po",
  stock_adjustment: "adjust_inventory",
  stocktake_module: "create_stocktake",
  reports_hub: "view_reports",
  account: "manage_settings",
  suppliers: "view_suppliers",
  transfer_orders: "manage_transfers",
};

const StockyLayout = ({
  activeTab,
  activeFlow,
  onTabChange,
  onFlowChange,
  children,
  navItems,
}: StockyLayoutProps) => {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem("sidebar-collapsed") === "1";
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("sidebar-collapsed", collapsed ? "1" : "0");
    }
  }, [collapsed]);
  const { hasPermission } = useUserRole();

  const activeId = activeFlow || activeTab;

  // If a legacy flat list is passed, wrap it as a single group.
  const groups: NavGroup[] = useMemo(() => {
    if (navItems && navItems.length > 0) {
      return [{ id: "all", label: "Menu", icon: LayoutDashboard, items: navItems }];
    }
    return defaultGroups
      .map((g) => ({
        ...g,
        items: g.items.filter((it) => {
          const perm = NAV_PERMISSIONS[it.id];
          return perm ? hasPermission(perm) : true;
        }),
      }))
      .filter((g) => g.items.length > 0);
  }, [navItems, hasPermission]);

  // Track which group is open. Group containing the active route is open by default;
  // user can toggle others.
  const initialOpen = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const g of groups) {
      map[g.id] = g.items.some((it) => it.id === activeId);
    }
    // Always keep Main open by default if nothing matched
    if (!Object.values(map).some(Boolean) && groups[0]) map[groups[0].id] = true;
    return map;
  }, [groups, activeId]);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(initialOpen);

  // Re-open the active group when route changes
  useEffect(() => {
    setOpenGroups((prev) => {
      const next = { ...prev };
      for (const g of groups) {
        if (g.items.some((it) => it.id === activeId)) next[g.id] = true;
      }
      return next;
    });
  }, [activeId, groups]);

  const handleClick = (item: StockyNavItem) => {
    if (item.id === "support_chat") {
      window.location.href = "/support";
      setMobileOpen(false);
      return;
    }
    if (item.id === "margin_guardian") {
      window.location.href = "/rules";
      setMobileOpen(false);
      return;
    }
    if (item.id === "pricing_intelligence") {
      window.location.href = "/pricing-intelligence";
      setMobileOpen(false);
      return;
    }
    if (item.type === "tab") onTabChange(item.id);
    else onFlowChange(item.id);
    setMobileOpen(false);
  };

  const openQuickSearch = () => {
    window.dispatchEvent(new CustomEvent("sonic:open-quick-search"));
  };

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className={cn("flex items-center gap-2 px-3 py-3 border-b border-border/60", collapsed && "justify-center")}>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold font-display text-foreground truncate">Sonic Invoice</h2>
            <p className="text-[10px] text-muted-foreground">Inventory Hub</p>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden lg:flex p-1 rounded-md hover:bg-muted text-muted-foreground"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
        <button
          onClick={() => setMobileOpen(false)}
          className="lg:hidden p-1 rounded-md hover:bg-muted text-muted-foreground"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Quick Search trigger */}
      <div className={cn("px-2 pt-2", collapsed && "px-1")}>
        <button
          onClick={openQuickSearch}
          title="Quick Search"
          className={cn(
            "flex items-center gap-2 w-full rounded-md text-sm transition-colors border border-border/60",
            "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground",
            collapsed ? "justify-center px-2 py-2" : "px-2.5 py-1.5",
          )}
        >
          <Search className="w-4 h-4 shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Quick Search</span>
              <kbd className="text-[10px] px-1 py-0.5 rounded bg-card border border-border text-muted-foreground font-mono">
                ⌘K
              </kbd>
            </>
          )}
        </button>
      </div>

      {/* Grouped nav */}
      <nav className="flex-1 px-2 py-3 space-y-3 overflow-y-auto">
        {groups.map((group) => {
          const GroupIcon = group.icon;
          const isOpen = collapsed ? true : openGroups[group.id] ?? false;
          const groupHasActive = group.items.some((it) => it.id === activeId);
          return (
            <div key={group.id} className="space-y-0.5">
              {!collapsed ? (
                <button
                  onClick={() =>
                    setOpenGroups((prev) => ({ ...prev, [group.id]: !prev[group.id] }))
                  }
                  className={cn(
                    "flex items-center justify-between w-full px-2 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wider transition-colors",
                    groupHasActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <GroupIcon className="w-3.5 h-3.5" />
                    {group.label}
                  </span>
                  <ChevronDown
                    className={cn(
                      "w-3.5 h-3.5 transition-transform",
                      !isOpen && "-rotate-90",
                    )}
                  />
                </button>
              ) : (
                <div className="flex justify-center text-muted-foreground py-1" title={group.label}>
                  <GroupIcon className="w-4 h-4" />
                </div>
              )}
              {isOpen &&
                group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeId === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleClick(item)}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "relative flex items-center gap-2.5 w-full rounded-md text-sm transition-colors",
                        collapsed ? "justify-center px-2 py-2" : "px-3 py-1.5",
                        isActive
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {isActive && !collapsed && (
                        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary" />
                      )}
                      <Icon className="w-[18px] h-[18px] shrink-0" />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </button>
                  );
                })}
            </div>
          );
        })}
      </nav>

      {/* Persistent Account pinned at bottom — always visible */}
      <div className={cn("border-t border-border/60 mt-auto", collapsed ? "px-1 py-2" : "px-2 py-2")}>
        <button
          onClick={() => { onTabChange("account"); setMobileOpen(false); }}
          title={collapsed ? "Account" : undefined}
          className={cn(
            "flex items-center gap-2.5 w-full rounded-md text-sm transition-colors",
            collapsed ? "justify-center px-2 py-2" : "px-2.5 py-2",
            activeId === "account"
              ? "bg-primary/10 text-primary font-medium"
              : "text-foreground hover:bg-muted",
          )}
        >
          <User className="w-[18px] h-[18px] shrink-0" />
          {!collapsed && (
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-medium truncate">Account</p>
              <p className="text-[10px] text-muted-foreground truncate">Profile · Sign out</p>
            </div>
          )}
        </button>
      </div>

      {!collapsed && (
        <div className="px-3 py-2 border-t border-border/60">
          <p className="text-[9px] text-muted-foreground">Sonic Invoice v1.0</p>
          <p className="text-[9px] text-muted-foreground">Apple-clean layout</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside
        className={cn(
          "hidden lg:flex flex-col shrink-0 border-r border-border/60 bg-card/50 h-full transition-[width] duration-200",
          collapsed ? "w-14" : "w-60",
        )}
      >
        {sidebarContent}
      </aside>

      {mobileOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60 lg:hidden" onClick={() => setMobileOpen(false)} />
          <aside className="fixed inset-y-0 left-0 z-50 w-64 bg-card border-r border-border overflow-y-auto lg:hidden animate-fade-in">
            {sidebarContent}
          </aside>
        </>
      )}

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="flex items-center gap-2 px-4 h-12 border-b border-border lg:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-sm font-semibold text-foreground">Sonic Invoice</span>
          <button
            onClick={openQuickSearch}
            className="ml-auto p-1.5 rounded-md hover:bg-muted text-muted-foreground"
            aria-label="Quick search"
          >
            <Search className="w-5 h-5" />
          </button>
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
};

export default StockyLayout;
