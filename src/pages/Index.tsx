import { useState, useEffect, useCallback } from "react";
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
import ScanMode from "@/components/ScanMode";
import OrderFormFlow from "@/components/OrderFormFlow";
import PurchaseOrderPanel from "@/components/PurchaseOrderPanel";
import SeasonManager from "@/components/SeasonManager";
import ReorderPanel from "@/components/ReorderPanel";
import SupplierPanel from "@/components/SupplierPanel";
import HelpCentre from "@/components/HelpCentre";
import AuditLogPanel from "@/components/AuditLogPanel";
import CatalogMemoryPanel from "@/components/CatalogMemoryPanel";
import EmailInboxPanel from "@/components/EmailInboxPanel";
import CollabSEOFlow from "@/components/CollabSEOFlow";
import NotificationBell from "@/components/NotificationBell";
import AdsGuideTabs from "@/components/AdsGuideTabs";
import LightspeedConverter from "@/components/LightspeedConverter";
import GoogleAdsSetupWizard from "@/components/GoogleAdsSetupWizard";
import MetaAdsSetupWizard from "@/components/MetaAdsSetupWizard";
import PerformanceDashboard from "@/components/PerformanceDashboard";
import AIFeedOptimisation from "@/components/AIFeedOptimisation";
import FeedHealthPanel from "@/components/FeedHealthPanel";
import GoogleColourFlow from "@/components/GoogleColourFlow";
import GoogleAdsFlow from "@/components/GoogleAdsFlow";
import StyleGroupingFlow from "@/components/StyleGroupingFlow";
import { useStoreMode } from "@/hooks/use-store-mode";
import { useNotifications } from "@/hooks/use-notifications";
import { useShopifyEmbedded } from "@/components/ShopifyEmbeddedProvider";
import { exchangeShopifyToken } from "@/lib/shopify-auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import LoadingScreen from "@/components/ui/loading-screen";

const Index = () => {
  const [authed, setAuthed] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem("onboarding_complete") === "true");
  const [activeTab, setActiveTab] = useState("home");
  const [activeFlow, setActiveFlow] = useState<"invoice" | "sale" | "restock" | "price_adjust" | "price_lookup" | "order_form" | "seasons" | "reorder" | "suppliers" | "audit_log" | "purchase_orders" | "catalog_memory" | "email_inbox" | "collab_seo" | "google_ads_setup" | "meta_ads_setup" | "lightspeed_convert" | "scan_mode" | "performance" | "feed_optimise" | "feed_health" | "google_colour" | "google_ads" | null>(null);
  const [showCapture, setShowCapture] = useState(false);
  const mode = useStoreMode();
  const { notifications, unreadCount, addNotification, markRead, markAllRead } = useNotifications();
  const { isEmbedded, shop } = useShopifyEmbedded();

  // ── Session management with onAuthStateChange ──
  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        setAuthed(true);
        setAuthLoading(false);
      } else {
        // Don't set authed=false if we're in embedded mode (will handle separately)
        if (!isEmbedded) {
          setAuthed(false);
        }
        setAuthLoading(false);
      }
    });

    // Then check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setAuthed(true);
      }
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [isEmbedded]);

  // ── Embedded mode: authenticate via Shopify session token ──
  useEffect(() => {
    if (!isEmbedded || !shop || authed) return;

    const authenticateEmbedded = async () => {
      try {
        // Get session token from App Bridge
        // @ts-ignore — shopify global is injected by App Bridge CDN
        const shopify = window.shopify;
        if (!shopify?.idToken) {
          console.warn("App Bridge not ready for session token");
          setAuthLoading(false);
          return;
        }

        const sessionToken = await shopify.idToken();
        if (!sessionToken) {
          console.warn("No session token available");
          setAuthLoading(false);
          return;
        }

        // Verify session token with our backend
        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/shopify-session-verify`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_token: sessionToken }),
          }
        );

        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({ error: "Verification failed" }));
          console.error("Session verify failed:", errData);
          if (errData.needs_install) {
            toast.error("Please install the app from the Shopify App Store first");
          }
          setAuthLoading(false);
          return;
        }

        const result = await resp.json();
        if (result.access_token && result.refresh_token) {
          await supabase.auth.setSession({
            access_token: result.access_token,
            refresh_token: result.refresh_token,
          });
          setAuthed(true);
          setOnboarded(true);
          localStorage.setItem("onboarding_complete", "true");
          addAuditEntry("Login", `Embedded session auth for ${result.shop}`);
        }
      } catch (err) {
        console.error("Embedded auth error:", err);
      } finally {
        setAuthLoading(false);
      }
    };

    // Wait for App Bridge to load
    const timer = setTimeout(authenticateEmbedded, 500);
    return () => clearTimeout(timer);
  }, [isEmbedded, shop, authed]);

  // Handle Shopify OAuth callback redirect (store connection)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("shopify_connected") === "1") {
      window.history.replaceState({}, "", window.location.pathname);
      setActiveTab("account");
    }
  }, []);

  // Handle Shopify OAuth login callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const loginToken = params.get("shopify_login");
    if (loginToken) {
      window.history.replaceState({}, "", window.location.pathname);
      exchangeShopifyToken(loginToken)
        .then(({ shop }) => {
          setAuthed(true);
          setOnboarded(true);
          localStorage.setItem("onboarding_complete", "true");
          addAuditEntry("Login", `Shopify OAuth login from ${shop}`);
          toast.success(`Signed in via Shopify (${shop})`);
        })
        .catch((err) => {
          console.error("Shopify login failed:", err);
          toast.error("Shopify sign-in failed. Please try again.");
          setAuthLoading(false);
        });
    }
  }, []);

  const handleAuth = () => {
    setAuthed(true);
    addAuditEntry("Login", `User logged in`);
  };

  // ── Loading state ──
  if (authLoading) {
    return (
      <LoadingScreen
        title="Sonic Invoice"
        messages={[
          "Initialising session...",
          "Connecting to backend...",
          "Almost ready...",
        ]}
        interval={1800}
      />
    );
  }

  // When embedded in Shopify, skip standalone auth/onboarding
  // (Shopify handles auth via session tokens or OAuth install flow)
  if (!isEmbedded && !authed) {
    return <AuthScreen onAuth={handleAuth} />;
  }

  if (!isEmbedded && !onboarded) {
    return <OnboardingFlow onComplete={() => setOnboarded(true)} />;
  }

  const renderFlow = () => {
    switch (activeFlow) {
      case "invoice": return <InvoiceFlow onBack={() => setActiveFlow(null)} />;
      case "sale": return <BulkSaleFlow onBack={() => setActiveFlow(null)} onNavigateToGoogleFeed={() => { setActiveFlow(null); setActiveTab("tools"); }} />;
      case "restock": return <RestockAnalytics onBack={() => setActiveFlow(null)} />;
      case "price_adjust": return <PriceAdjustmentPanel onBack={() => setActiveFlow(null)} />;
      case "price_lookup": return <PriceLookup onBack={() => setActiveFlow(null)} />;
      case "order_form": return <OrderFormFlow onBack={() => setActiveFlow(null)} />;
      case "seasons": return <SeasonManager onBack={() => setActiveFlow(null)} />;
      case "reorder": return <ReorderPanel onBack={() => setActiveFlow(null)} onViewOrders={() => setActiveFlow("order_form")} />;
      case "suppliers": return <SupplierPanel onBack={() => setActiveFlow(null)} onStartInvoice={() => setActiveFlow("invoice")} />;
      case "audit_log": return <AuditLogPanel onBack={() => setActiveFlow(null)} />;
      case "purchase_orders": return <PurchaseOrderPanel onBack={() => setActiveFlow(null)} />;
      case "catalog_memory": return <CatalogMemoryPanel onBack={() => setActiveFlow(null)} />;
      case "email_inbox": return <EmailInboxPanel onBack={() => setActiveFlow(null)} onProcessInvoice={() => setActiveFlow("invoice")} />;
      case "collab_seo": return <CollabSEOFlow onBack={() => setActiveFlow(null)} />;
      case "google_ads_setup": return <GoogleAdsSetupWizard onBack={() => setActiveFlow(null)} />;
      case "meta_ads_setup": return <MetaAdsSetupWizard onBack={() => setActiveFlow(null)} />;
      case "lightspeed_convert": return <LightspeedConverter onBack={() => setActiveFlow(null)} />;
      case "scan_mode": return <ScanMode onBack={() => setActiveFlow(null)} />;
      case "performance": return <PerformanceDashboard onBack={() => setActiveFlow(null)} />;
      case "feed_optimise": return <AIFeedOptimisation onBack={() => setActiveFlow(null)} />;
      case "feed_health": return <FeedHealthPanel onBack={() => setActiveFlow(null)} />;
      case "google_colour": return <GoogleColourFlow onBack={() => setActiveFlow(null)} />;
      case "google_ads": return <GoogleAdsFlow onBack={() => setActiveFlow(null)} />;
      default: return null;
    }
  };

  // In standalone mode, flows replace the entire screen
  if (!isEmbedded && activeFlow) {
    return renderFlow();
  }

  const mainContent = (
    <>
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
          onStartCollabSEO={() => setActiveFlow("collab_seo")}
          onStartGoogleAdsSetup={() => setActiveFlow("google_ads_setup")}
          onStartMetaAdsSetup={() => setActiveFlow("meta_ads_setup")}
          onStartLightspeedConvert={() => setActiveFlow("lightspeed_convert")}
          onStartScanMode={() => setActiveFlow("scan_mode")}
          onStartPerformance={() => setActiveFlow("performance")}
          onStartFeedOptimise={() => setActiveFlow("feed_optimise")}
          onStartFeedHealth={() => setActiveFlow("feed_health")}
          onStartGoogleColour={() => setActiveFlow("google_colour")}
          onStartGoogleAds={() => setActiveFlow("google_ads")}
        />
      )}
      {activeTab === "analytics" && <AnalyticsPanel />}
      {activeTab === "history" && <HistoryScreen />}
      {activeTab === "tools" && <ToolsScreen />}
      {activeTab === "guide" && <LightspeedGuide onBack={() => setActiveTab("home")} onNavigate={(f) => setActiveFlow(f as any)} />}
      {activeTab === "google_ads" && <AdsGuideTabs />}
      {activeTab === "help" && <HelpCentre />}
      {activeTab === "account" && <AccountScreen />}
    </>
  );

  // ─── Embedded layout (inside Shopify Admin) ───
  if (isEmbedded) {
    return (
      <div className="flex h-screen overflow-hidden bg-background">
        <EmbeddedNav
          activeTab={activeFlow ? "" : activeTab}
          onTabChange={(tab) => { setActiveFlow(null); setActiveTab(tab); }}
          onFlowChange={(flow) => setActiveFlow(flow as any)}
        />
        <main className="flex-1 overflow-y-auto">
          <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-0 border-b border-border mb-0">
            <div className="flex items-center gap-2">
              {activeFlow && (
                <button
                  onClick={() => setActiveFlow(null)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  ← Back
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 pb-2">
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
            </div>
          </div>
          {activeFlow ? renderFlow() : mainContent}
        </main>
      </div>
    );
  }

  // ─── Standalone layout (original mobile-first) ───
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

      {mainContent}
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
