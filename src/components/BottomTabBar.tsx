import { Home, FileText, Wrench, CreditCard, User, BookOpen, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface BottomTabBarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const BottomTabBar = ({ activeTab, onTabChange }: BottomTabBarProps) => {
  const { t } = useTranslation();

  const baseTabs = [
    { id: "start", label: t("nav.start", "Start"), icon: Rocket },
    { id: "home", label: t("nav.home"), icon: Home },
    { id: "invoices", label: t("nav.invoices"), icon: FileText },
    { id: "tools", label: t("nav.tools"), icon: Wrench },
    { id: "billing", label: t("nav.billing", "Billing"), icon: CreditCard },
    { id: "howto", label: t("nav.howto", "How To"), icon: BookOpen },
    { id: "account", label: t("nav.account"), icon: User },
  ];

  // "Guide" merged into "How To" — single entry in footer menu.
  const tabs = baseTabs;

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
        <span className="text-[9px] text-muted-foreground/60">Sonic Invoice v1.0</span>
        <span className="text-[9px] text-muted-foreground/40">·</span>
        <span className="text-[9px] text-muted-foreground/60">🛍 Shopify</span>
      </div>
    </nav>
  );
};

export default BottomTabBar;
