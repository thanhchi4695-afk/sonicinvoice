import { useState } from "react";
import {
  Home,
  Boxes,
  Truck,
  BarChart3,
  Wrench,
  User,
  X,
  Package,
  Scissors,
  ClipboardCheck,
  ArrowRightLeft,
  ClipboardList,
  Users,
  Brain,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Shield,
  CreditCard,
  BookOpen,
  Bot,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface BottomTabBarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

interface GroupItem {
  id: string;
  label: string;
  icon: React.ElementType;
  type: "tab" | "flow" | "route";
  href?: string;
}

interface BottomGroup {
  id: string;
  label: string;
  icon: React.ElementType;
  items: GroupItem[];
}

const dispatchFlow = (id: string) =>
  window.dispatchEvent(new CustomEvent("sonic:navigate-flow", { detail: id }));
const dispatchTab = (id: string) =>
  window.dispatchEvent(new CustomEvent("sonic:navigate-tab", { detail: id }));

const groups: BottomGroup[] = [
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
      { id: "invoices", label: "Invoices", icon: FileText, type: "tab" },
      { id: "purchase_orders", label: "Purchase Orders", icon: ClipboardList, type: "flow" },
      { id: "suppliers", label: "Suppliers", icon: Users, type: "flow" },
      { id: "supplier_intelligence", label: "Supplier Brain", icon: Brain, type: "flow" },
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
      { id: "pricing_intelligence", label: "Price Intelligence", icon: TrendingUp, type: "route", href: "/pricing-intelligence" },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    icon: Wrench,
    items: [
      { id: "tools", label: "Tools & Feeds", icon: Wrench, type: "tab" },
      { id: "ai_agents", label: "AI Agents", icon: Bot, type: "tab" },
      { id: "margin_guardian", label: "Margin Guardian", icon: Shield, type: "route", href: "/rules" },
      { id: "howto", label: "How To", icon: BookOpen, type: "tab" },
      { id: "billing", label: "Billing", icon: CreditCard, type: "tab" },
    ],
  },
];

const BottomTabBar = ({ activeTab, onTabChange }: BottomTabBarProps) => {
  const { t } = useTranslation();
  const [openGroup, setOpenGroup] = useState<BottomGroup | null>(null);

  const rootTabs = [
    { id: "home", label: t("nav.home", "Home"), icon: Home },
  ];
  const accountTab = { id: "account", label: t("nav.account"), icon: User };

  const handleItem = (item: GroupItem) => {
    if (item.type === "route" && item.href) {
      window.location.href = item.href;
    } else if (item.type === "tab") {
      dispatchTab(item.id);
      onTabChange(item.id);
    } else {
      dispatchFlow(item.id);
    }
    setOpenGroup(null);
  };

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/95 backdrop-blur-md safe-bottom">
        <div className="flex items-center justify-around h-16">
          {rootTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 w-full h-full transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[11px] font-medium">{tab.label}</span>
              </button>
            );
          })}
          {groups.map((group) => {
            const Icon = group.icon;
            const isActive = group.items.some((it) => it.id === activeTab);
            return (
              <button
                key={group.id}
                onClick={() => setOpenGroup(group)}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 w-full h-full transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[11px] font-medium">{group.label}</span>
              </button>
            );
          })}
          {(() => {
            const Icon = accountTab.icon;
            const isActive = activeTab === accountTab.id;
            return (
              <button
                onClick={() => onTabChange(accountTab.id)}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 w-full h-full transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[11px] font-medium">{accountTab.label}</span>
              </button>
            );
          })()}
        </div>
        <div className="flex items-center justify-center gap-1 pb-1 -mt-1">
          <span className="text-[9px] text-muted-foreground/60">Sonic Invoice v1.0</span>
          <span className="text-[9px] text-muted-foreground/40">·</span>
          <span className="text-[9px] text-muted-foreground/60">🛍 Shopify</span>
        </div>
      </nav>

      {openGroup && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/60 lg:hidden animate-fade-in"
            onClick={() => setOpenGroup(null)}
          />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border rounded-t-2xl pb-safe lg:hidden animate-fade-in">
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h3 className="text-base font-semibold text-foreground">{openGroup.label}</h3>
              <button
                onClick={() => setOpenGroup(null)}
                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-3 pb-5 space-y-0.5">
              {openGroup.items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleItem(item)}
                    className="flex items-center gap-3 w-full px-3 py-3 rounded-lg text-sm text-foreground hover:bg-muted transition-colors min-h-[44px]"
                  >
                    <Icon className="w-5 h-5 text-muted-foreground" />
                    <span className="flex-1 text-left">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
};

export default BottomTabBar;
