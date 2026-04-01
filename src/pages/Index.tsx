import { useState } from "react";
import AuthScreen from "@/components/AuthScreen";
import OnboardingFlow from "@/components/OnboardingFlow";
import BottomTabBar from "@/components/BottomTabBar";
import HomeScreen from "@/components/HomeScreen";
import HistoryScreen from "@/components/HistoryScreen";
import ToolsScreen from "@/components/ToolsScreen";
import AccountScreen from "@/components/AccountScreen";
import InvoiceFlow from "@/components/InvoiceFlow";
import BulkSaleFlow from "@/components/BulkSaleFlow";
import RestockAnalytics from "@/components/RestockAnalytics";
import PriceAdjustmentPanel from "@/components/PriceAdjustmentPanel";
import PriceLookup from "@/components/PriceLookup";
import LightspeedGuide from "@/components/LightspeedGuide";
import AnalyticsPanel from "@/components/AnalyticsPanel";
import QuickCapture from "@/components/QuickCapture";
import NotificationBell from "@/components/NotificationBell";
import { useStoreMode } from "@/hooks/use-store-mode";
import { useNotifications } from "@/hooks/use-notifications";

const Index = () => {
  const [authed, setAuthed] = useState(false);
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem("onboarding_complete") === "true");
  const [activeTab, setActiveTab] = useState("home");
  const [activeFlow, setActiveFlow] = useState<"invoice" | "sale" | "restock" | "price_adjust" | "price_lookup" | null>(null);
  const [showCapture, setShowCapture] = useState(false);
  const mode = useStoreMode();
  const { notifications, unreadCount, addNotification, markRead, markAllRead } = useNotifications();

  if (!authed) {
    return <AuthScreen onAuth={() => setAuthed(true)} />;
  }

  if (!onboarded) {
    return <OnboardingFlow onComplete={() => setOnboarded(true)} />;
  }

  if (activeFlow === "invoice") {
    return <InvoiceFlow onBack={() => setActiveFlow(null)} />;
  }

  if (activeFlow === "sale") {
    return <BulkSaleFlow onBack={() => setActiveFlow(null)} />;
  }

  if (activeFlow === "restock") {
    return <RestockAnalytics onBack={() => setActiveFlow(null)} />;
  }

  if (activeFlow === "price_adjust") {
    return <PriceAdjustmentPanel onBack={() => setActiveFlow(null)} />;
  }

  if (activeFlow === "price_lookup") {
    return <PriceLookup onBack={() => setActiveFlow(null)} />;
  }

  return (
    <div className="min-h-screen">
      {/* Top bar */}
      <div className="flex items-center justify-end gap-2 px-4 pt-3 pb-0">
        <NotificationBell
          notifications={notifications}
          unreadCount={unreadCount}
          onMarkRead={markRead}
          onMarkAllRead={markAllRead}
          onNavigate={(link) => {
            if (["invoice", "sale", "restock", "price_adjust", "price_lookup"].includes(link)) {
              setActiveFlow(link as any);
            } else {
              setActiveTab(link);
            }
          }}
        />
        <button
          onClick={() => setActiveTab("account")}
          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${mode.modeBadge.color}`}
        >
          <span>{mode.modeBadge.emoji}</span>
          {mode.modeBadge.label}
        </button>
      </div>

      {activeTab === "home" && (
        <HomeScreen
          onStartInvoice={() => setActiveFlow("invoice")}
          onStartSale={() => setActiveFlow("sale")}
          onStartRestock={() => setActiveFlow("restock")}
          onStartPriceAdjust={() => setActiveFlow("price_adjust")}
        />
      )}
      {activeTab === "analytics" && <AnalyticsPanel />}
      {activeTab === "history" && <HistoryScreen />}
      {activeTab === "tools" && <ToolsScreen />}
      {activeTab === "guide" && <LightspeedGuide onBack={() => setActiveTab("home")} onNavigate={(f) => setActiveFlow(f as any)} />}
      {activeTab === "account" && <AccountScreen />}
      <BottomTabBar activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Floating Quick Capture button — mobile only */}
      <button
        onClick={() => setShowCapture(true)}
        className="md:hidden fixed bottom-20 right-4 z-40 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center active:scale-95 transition-transform"
        aria-label="Quick Capture"
      >
        <span className="text-2xl">📷</span>
      </button>

      {showCapture && <QuickCapture onClose={() => setShowCapture(false)} />}
    </div>
  );
};

export default Index;
