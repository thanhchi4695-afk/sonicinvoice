import { useState, useEffect } from "react";
import AuthScreen from "@/components/AuthScreen";
import { addAuditEntry } from "@/lib/audit-log";
import OnboardingFlow from "@/components/OnboardingFlow";
import BottomTabBar from "@/components/BottomTabBar";
import EmbeddedNav from "@/components/EmbeddedNav";
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
import OrderFormFlow from "@/components/OrderFormFlow";
import PurchaseOrderPanel from "@/components/PurchaseOrderPanel";
import SeasonManager from "@/components/SeasonManager";
import ReorderPanel from "@/components/ReorderPanel";
import SupplierPanel from "@/components/SupplierPanel";
import HelpCentre from "@/components/HelpCentre";
import AuditLogPanel from "@/components/AuditLogPanel";
import CatalogMemoryPanel from "@/components/CatalogMemoryPanel";
import EmailInboxPanel from "@/components/EmailInboxPanel";
import NotificationBell from "@/components/NotificationBell";
import { useStoreMode } from "@/hooks/use-store-mode";
import { useNotifications } from "@/hooks/use-notifications";
import { useShopifyEmbedded } from "@/components/ShopifyEmbeddedProvider";

const Index = () => {
  const [authed, setAuthed] = useState(true);
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem("onboarding_complete") === "true");
  const [activeTab, setActiveTab] = useState("home");
  const [activeFlow, setActiveFlow] = useState<"invoice" | "sale" | "restock" | "price_adjust" | "price_lookup" | "order_form" | "seasons" | "reorder" | "suppliers" | "audit_log" | "purchase_orders" | "catalog_memory" | "email_inbox" | null>(null);
  const [showCapture, setShowCapture] = useState(false);
  const mode = useStoreMode();
  const { notifications, unreadCount, addNotification, markRead, markAllRead } = useNotifications();
  const { isEmbedded } = useShopifyEmbedded();

  // Handle Shopify OAuth callback redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("shopify_connected") === "1") {
      window.history.replaceState({}, "", window.location.pathname);
      setActiveTab("account");
    }
  }, []);

  const handleAuth = () => {
    setAuthed(true);
    addAuditEntry("Login", `User logged in`);
  };

  if (!authed) {
    return <AuthScreen onAuth={handleAuth} />;
  }

  if (!onboarded) {
    return <OnboardingFlow onComplete={() => setOnboarded(true)} />;
  }

  if (activeFlow === "invoice") {
    return <InvoiceFlow onBack={() => setActiveFlow(null)} />;
  }

  if (activeFlow === "sale") {
    return <BulkSaleFlow onBack={() => setActiveFlow(null)} onNavigateToGoogleFeed={() => { setActiveFlow(null); setActiveTab("tools"); }} />;
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

  if (activeFlow === "order_form") {
    return <OrderFormFlow onBack={() => setActiveFlow(null)} />;
  }

  if (activeFlow === "seasons") {
    return <SeasonManager onBack={() => setActiveFlow(null)} />;
  }

  if (activeFlow === "reorder") {
    return <ReorderPanel onBack={() => setActiveFlow(null)} onViewOrders={() => setActiveFlow("order_form")} />;
  }

  if (activeFlow === "suppliers") {
    return <SupplierPanel onBack={() => setActiveFlow(null)} onStartInvoice={() => setActiveFlow("invoice")} />;
  }

  if (activeFlow === "audit_log") {
    return <AuditLogPanel onBack={() => setActiveFlow(null)} />;
  }

  if (activeFlow === "purchase_orders") {
    return <PurchaseOrderPanel onBack={() => setActiveFlow(null)} />;
  }

  if (activeFlow === "catalog_memory") {
    return <CatalogMemoryPanel onBack={() => setActiveFlow(null)} />;
  }

  if (activeFlow === "email_inbox") {
    return <EmailInboxPanel onBack={() => setActiveFlow(null)} onProcessInvoice={() => setActiveFlow("invoice")} />;
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
          onStartOrderForm={() => setActiveFlow("order_form")}
          onStartReorder={() => setActiveFlow("reorder")}
          onStartSuppliers={() => setActiveFlow("suppliers")}
          onOpenAuditLog={() => setActiveFlow("audit_log")}
          onStartPurchaseOrders={() => setActiveFlow("purchase_orders")}
          onStartCatalogMemory={() => setActiveFlow("catalog_memory")}
          onStartEmailInbox={() => setActiveFlow("email_inbox")}
        />
      )}
      {activeTab === "analytics" && <AnalyticsPanel />}
      {activeTab === "history" && <HistoryScreen />}
      {activeTab === "tools" && <ToolsScreen />}
      {activeTab === "guide" && <LightspeedGuide onBack={() => setActiveTab("home")} onNavigate={(f) => setActiveFlow(f as any)} />}
      {activeTab === "help" && <HelpCentre />}
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
