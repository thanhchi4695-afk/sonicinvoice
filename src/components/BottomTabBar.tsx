import { Home, FolderOpen, Wrench, User, Monitor, BarChart3, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStoreMode } from "@/hooks/use-store-mode";

interface BottomTabBarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const baseTabs = [
  { id: "home", label: "Home", icon: Home },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "history", label: "History", icon: FolderOpen },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "help", label: "Help", icon: HelpCircle },
  { id: "account", label: "Account", icon: User },
];

const guidTab = { id: "guide", label: "Guide", icon: Monitor };

const BottomTabBar = ({ activeTab, onTabChange }: BottomTabBarProps) => {
  const mode = useStoreMode();
  const tabs = mode.isLightspeed ? [...baseTabs.slice(0, 4), guidTab, baseTabs[4]] : baseTabs;
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card safe-bottom">
      <div className="flex items-center justify-around h-16">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 w-full h-full transition-colors",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[11px] font-medium">{tab.label}</span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-center gap-1 pb-1 -mt-1">
        <span className="text-[9px] text-muted-foreground/60">SkuPilot v1.0</span>
        <span className="text-[9px] text-muted-foreground/40">·</span>
        <span className="text-[9px] text-muted-foreground/60">🛍 Shopify</span>
      </div>
    </nav>
  );
};

export default BottomTabBar;
