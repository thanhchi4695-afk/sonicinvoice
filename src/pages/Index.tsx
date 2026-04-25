import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { addAuditEntry } from "@/lib/audit-log";
import { onImageSeoTrigger } from "@/lib/image-seo-trigger";
import NotificationBell from "@/components/NotificationBell";
import StoreModePill from "@/components/StoreModePill";
import LoadingScreen from "@/components/ui/loading-screen";
import { useKeyboardShortcuts, type ShortcutDef } from "@/hooks/use-keyboard-shortcuts";
import { useMediaQuery } from "@/hooks/use-media-query";

// ── Eagerly loaded (critical path) ──
import HomeWizard from "@/components/HomeWizard";
import PhaseFlowHome from "@/components/PhaseFlowHome";
import BottomTabBar from "@/components/BottomTabBar";
import EmbeddedNav from "@/components/EmbeddedNav";
import StockyLayout from "@/components/StockyLayout";
import QuickActionsBar from "@/components/QuickActionsBar";
import KeyboardShortcutsModal from "@/components/KeyboardShortcutsModal";
import QuickSearchModal from "@/components/QuickSearchModal";
import PhaseProgressBar from "@/components/PhaseProgressBar";
// HomeScreen kept available (now lazy) — accessible from Tools as "Classic dashboard".
const HomeScreen = lazy(() => import("@/components/HomeScreen"));


// ── Lazy-loaded (code-split) — improves LCP & reduces main-thread work (INP) ──
const BillingScreen = lazy(() => import("@/components/BillingScreen"));
const InvoicesTab = lazy(() => import("@/components/InvoicesTab"));
const AuthScreen = lazy(() => import("@/components/AuthScreen"));
const OnboardingFlow = lazy(() => import("@/components/OnboardingFlow"));
const HistoryScreen = lazy(() => import("@/components/HistoryScreen"));
const ToolsScreen = lazy(() => import("@/components/ToolsScreen"));
const AccountScreen = lazy(() => import("@/components/AccountScreen"));
const InvoiceFlow = lazy(() => import("@/components/InvoiceFlow"));
const BulkSaleFlow = lazy(() => import("@/components/BulkSaleFlow"));
const RestockAnalytics = lazy(() => import("@/components/RestockAnalytics"));
const PriceAdjustmentPanel = lazy(() => import("@/components/PriceAdjustmentPanel"));
const PriceLookup = lazy(() => import("@/components/PriceLookup"));
const LightspeedGuide = lazy(() => import("@/components/LightspeedGuide"));
const AnalyticsPanel = lazy(() => import("@/components/AnalyticsPanel"));
const QuickCapture = lazy(() => import("@/components/QuickCapture"));
const ScanMode = lazy(() => import("@/components/ScanMode"));
const OrderFormFlow = lazy(() => import("@/components/OrderFormFlow"));
const PurchaseOrderPanel = lazy(() => import("@/components/PurchaseOrderPanel"));
const SeasonManager = lazy(() => import("@/components/SeasonManager"));
const ReorderPanel = lazy(() => import("@/components/ReorderPanel"));
const SupplierPanel = lazy(() => import("@/components/SupplierPanel"));
const HelpCentre = lazy(() => import("@/components/HelpCentre"));
const HowToCatalog = lazy(() => import("@/components/HowToCatalog"));
const AgentGuide = lazy(() => import("@/components/AgentGuide"));
const AuditLogPanel = lazy(() => import("@/components/AuditLogPanel"));
const CatalogMemoryPanel = lazy(() => import("@/components/CatalogMemoryPanel"));
const EmailInboxPanel = lazy(() => import("@/components/EmailInboxPanel"));
const CollabSEOFlow = lazy(() => import("@/components/CollabSEOFlow"));
const AdsGuideTabs = lazy(() => import("@/components/AdsGuideTabs"));
const LightspeedConverter = lazy(() => import("@/components/LightspeedConverter"));
const GoogleAdsSetupWizard = lazy(() => import("@/components/GoogleAdsSetupWizard"));
const MetaAdsSetupWizard = lazy(() => import("@/components/MetaAdsSetupWizard"));
const PerformanceDashboard = lazy(() => import("@/components/PerformanceDashboard"));
const AIFeedOptimisation = lazy(() => import("@/components/AIFeedOptimisation"));
const FeedHealthPanel = lazy(() => import("@/components/FeedHealthPanel"));
const GoogleColourFlow = lazy(() => import("@/components/GoogleColourFlow"));
const GoogleAdsFlow = lazy(() => import("@/components/GoogleAdsFlow"));
const StyleGroupingFlow = lazy(() => import("@/components/StyleGroupingFlow"));
const CompetitorIntelFlow = lazy(() => import("@/components/CompetitorIntelFlow"));
const CollectionSEOFlow = lazy(() => import("@/components/CollectionSEOFlow"));
const CollectionSEOExport = lazy(() => import("@/components/CollectionSEOExport"));
const GeoAgenticFlow = lazy(() => import("@/components/GeoAgenticFlow"));
const OrganicSEOFlow = lazy(() => import("@/components/OrganicSEOFlow"));
const MarginProtectionPanel = lazy(() => import("@/components/MarginProtectionPanel"));
const MarkdownLadderPanel = lazy(() => import("@/components/MarkdownLadderPanel"));
const StockMonitorPanel = lazy(() => import("@/components/StockMonitorPanel"));
const SocialMediaPanel = lazy(() => import("@/components/SocialMediaPanel"));
const InventoryPlanningPanel = lazy(() => import("@/components/InventoryPlanningPanel"));
const PackingSlipFlow = lazy(() => import("@/components/PackingSlipFlow"));
const JoorFlow = lazy(() => import("@/components/JoorFlow"));
const WholesaleImportFlow = lazy(() => import("@/components/WholesaleImportFlow"));
const LookbookImportFlow = lazy(() => import("@/components/LookbookImportFlow"));
const AccountingIntegration = lazy(() => import("@/components/AccountingIntegration"));
const ProfitLossPanel = lazy(() => import("@/components/ProfitLossPanel"));
const StockyHub = lazy(() => import("@/components/StockyHub"));
const StockyMigration = lazy(() => import("@/components/StockyMigration"));
const InventoryDashboard = lazy(() => import("@/components/InventoryDashboard"));
const ProductHealthPanel = lazy(() => import("@/components/ProductHealthPanel"));
const ShopifyOrderSync = lazy(() => import("@/components/ShopifyOrderSync"));
const ImageOptimisePanel = lazy(() => import("@/components/ImageOptimisePanel"));
const StockCheckFlow = lazy(() => import("@/components/StockCheckFlow"));
const PipelineRunner = lazy(() => import("@/components/PipelineRunner"));
const PipelineChooser = lazy(() => import("@/components/PipelineChooser"));
const StockyOnboarding = lazy(() => import("@/components/StockyOnboarding"));
const SupplierProfileBuilder = lazy(() => import("@/components/SupplierProfileBuilder"));
const SupplierIntelligencePanel = lazy(() => import("@/components/SupplierIntelligencePanel"));
const TeachInvoiceTutorial = lazy(() => import("@/components/TeachInvoiceTutorial"));
const ProcessingHistoryPanel = lazy(() => import("@/components/ProcessingHistoryPanel"));
const StocktakeModule = lazy(() => import("@/components/StocktakeModule"));
const TransferOrderPanel = lazy(() => import("@/components/TransferOrderPanel"));
const ReportsHub = lazy(() => import("@/components/ReportsHub"));
const StockAdjustmentPanel = lazy(() => import("@/components/StockAdjustmentPanel"));
const InventoryView = lazy(() => import("@/components/InventoryView"));
const ShopifyCSVSEO = lazy(() => import("@/components/ShopifyCSVSEO"));
const StockyHomeDashboard = lazy(() => import("@/components/StockyHomeDashboard"));
const PriceMatchPanel = lazy(() => import("@/components/PriceMatchPanel"));
const ProductDescriptionPanel = lazy(() => import("@/components/ProductDescriptionPanel"));
const StockReconciliationPanel = lazy(() => import("@/components/StockReconciliationPanel").then(m => ({ default: m.StockReconciliationPanel })));
// ── Flow keys registry — single source of truth for all activeFlow values ──
// Add a new flow by adding its key here; TypeScript will enforce usage everywhere.
const FLOW_KEYS = {
  invoice: true,
  sale: true,
  restock: true,
  price_adjust: true,
  price_lookup: true,
  price_match: true,
  product_descriptions: true,
  order_form: true,
  seasons: true,
  reorder: true,
  suppliers: true,
  audit_log: true,
  purchase_orders: true,
  catalog_memory: true,
  email_inbox: true,
  collab_seo: true,
  google_ads_setup: true,
  meta_ads_setup: true,
  lightspeed_convert: true,
  scan_mode: true,
  performance: true,
  feed_optimise: true,
  feed_health: true,
  google_colour: true,
  google_ads: true,
  style_grouping: true,
  competitor_intel: true,
  collection_seo: true,
  collection_seo_export: true,
  geo_agentic: true,
  organic_seo: true,
  margin_protection: true,
  markdown_ladder: true,
  stock_monitor: true,
  social_media: true,
  inventory_planning: true,
  packing_slip: true,
  joor: true,
  wholesale_import: true,
  lookbook_import: true,
  accounting: true,
  profit_loss: true,
  stocky_hub: true,
  stocky_migration: true,
  stocky_onboarding: true,
  inventory_dashboard: true,
  inventory_view: true,
  product_health: true,
  order_sync: true,
  image_optimise: true,
  stock_check: true,
  stocktake_module: true,
  transfer_orders: true,
  reports_hub: true,
  pipeline: true,
  pipeline_chooser: true,
  supplier_profile_builder: true,
  supplier_intelligence: true,
  processing_history: true,
  stock_adjustment: true,
  quick_receive: true,
  csv_seo: true,
  stocky_dashboard: true,
  stock_reconciliation: true,
  teach_invoice_tutorial: true,
} as const;

export type ActiveFlow = keyof typeof FLOW_KEYS;

import { useStoreMode } from "@/hooks/use-store-mode";
import { useNotifications } from "@/hooks/use-notifications";
import { useShopifyEmbedded } from "@/components/ShopifyEmbeddedProvider";
import { exchangeShopifyToken } from "@/lib/shopify-auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface IndexProps {
  initialTab?: string;
}

const Index = ({ initialTab }: IndexProps = {}) => {
  const [authed, setAuthed] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  // Onboarding flag is *display-only*; we re-validate against the live session below.
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem("onboarding_complete") === "true");
  const [activeTab, setActiveTab] = useState(initialTab || "home");
  const [activeFlow, setActiveFlow] = useState<ActiveFlow | null>(null);
  const [activePipelineId, setActivePipelineId] = useState<string | null>(null);
  const [showCapture, setShowCapture] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [useStockyDashboard, setUseStockyDashboard] = useState(() => localStorage.getItem("stocky_dashboard_mode") === "true");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showQuickSearch, setShowQuickSearch] = useState(false);
  const [reconciliationResult, setReconciliationResult] = useState<any>(null);
  const [embeddedAuthTimedOut, setEmbeddedAuthTimedOut] = useState(false);

  const handleReconciliationExport = useCallback((_sets: unknown) => {
    // Hand-off back to invoice flow's export step
    setActiveFlow("invoice");
  }, []);

  // Allow InvoiceFlow (and others) to stash the reconciliation payload
  // before navigating to the dedicated review panel.
  useEffect(() => {
    const onReady = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) setReconciliationResult(detail);
    };
    const onNavFlow = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === "string") setActiveFlow(detail as ActiveFlow);
    };
    const onNavTab = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === "string") {
        setActiveFlow(null);
        setActiveTab(detail);
      }
    };
    window.addEventListener("sonic:reconciliation-ready", onReady as EventListener);
    window.addEventListener("sonic:navigate-flow", onNavFlow as EventListener);
    window.addEventListener("sonic:navigate-tab", onNavTab as EventListener);
    return () => {
      window.removeEventListener("sonic:reconciliation-ready", onReady as EventListener);
      window.removeEventListener("sonic:navigate-flow", onNavFlow as EventListener);
      window.removeEventListener("sonic:navigate-tab", onNavTab as EventListener);
    };
  }, []);
  
  const mode = useStoreMode();
  const { notifications, unreadCount, addNotification, markRead, markAllRead } = useNotifications();
  const { isEmbedded, shop, authState: embeddedAuthState, authError: embeddedAuthError } = useShopifyEmbedded();

  // ── Standalone session management (non-embedded only) ──
  // Embedded auth is handled entirely by ShopifyEmbeddedProvider.
  useEffect(() => {
    if (isEmbedded) {
      // Embedded mode: derive auth state from the provider
      // No Supabase listener needed here — the provider already set the session.
      return;
    }

    // Set up auth state listener FIRST (standalone only)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const hasSession = !!session;
      setAuthed(hasSession);
      // ── Defence in depth: clear stale onboarding flag if there is no session.
      // This stops the in-app dashboard from rendering for signed-out users
      // just because localStorage still has onboarding_complete=true.
      if (!hasSession) {
        localStorage.removeItem("onboarding_complete");
        setOnboarded(false);
      }
      setAuthLoading(false);
    });

    // Then check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setAuthed(true);
      } else {
        localStorage.removeItem("onboarding_complete");
        setOnboarded(false);
      }
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [isEmbedded]);

  // ── Sync embedded auth state from provider ──
  useEffect(() => {
    if (!isEmbedded) return;
    if (embeddedAuthState === "authenticated") {
      setAuthed(true);
      setOnboarded(true);
      setAuthLoading(false);
    } else if (
      embeddedAuthState === "unauthenticated" ||
      embeddedAuthState === "needs_install"
    ) {
      // Stop the loading screen so the reinstall / unauthenticated UI can render.
      // Without this, "needs_install" left authLoading=true forever and the app
      // got stuck on "Initialising session…".
      setAuthLoading(false);
    }
    // "loading" → keep authLoading true (default)
  }, [isEmbedded, embeddedAuthState]);

  // ── Hard timeout safety net ──
  // If embedded auth never resolves (App Bridge CDN blocked, network stall,
  // verify endpoint hanging), drop the loading screen after 15s so the user
  // sees the reinstall / retry UI rather than an infinite spinner.
  useEffect(() => {
    if (!isEmbedded) return;
    if (embeddedAuthState !== "loading") {
      setEmbeddedAuthTimedOut(false);
      return;
    }
    const t = window.setTimeout(() => {
      console.warn("[embedded-auth] Hard timeout — forcing authLoading=false after 15s");
      setAuthLoading(false);
      setEmbeddedAuthTimedOut(true);
    }, 15000);
    return () => window.clearTimeout(t);
  }, [isEmbedded, embeddedAuthState]);

  // Handle Shopify OAuth callback redirect (store connection)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("shopify_connected") === "1") {
      window.history.replaceState({}, "", window.location.pathname);
      setActiveTab("account");
    }
  }, []);

  // Handle Shopify OAuth login callback (standalone Shopify login, not embedded)
  useEffect(() => {
    if (isEmbedded) return;
    const params = new URLSearchParams(window.location.search);
    const loginToken = params.get("shopify_login");
    if (loginToken) {
      window.history.replaceState({}, "", window.location.pathname);
      exchangeShopifyToken(loginToken)
        .then(({ shop: shopName }) => {
          setAuthed(true);
          setAuthLoading(false);
          setOnboarded(true);
          localStorage.setItem("onboarding_complete", "true");
          addAuditEntry("Login", `Shopify OAuth login from ${shopName}`);
          toast.success(`Signed in via Shopify (${shopName})`);
        })
        .catch((err) => {
          console.error("Shopify login failed:", err);
          toast.error("Shopify sign-in failed. Please try again.");
          setAuthLoading(false);
        });
    }
  }, [isEmbedded]);

  // ── Auto-trigger image SEO after imports ──
  useEffect(() => {
    return onImageSeoTrigger(({ source, productCount }) => {
      toast(`${productCount} products imported from ${source}`, {
        description: "Run Image SEO to generate alt text & keywords",
        action: {
          label: "Optimise Images",
          onClick: () => setActiveFlow("image_optimise"),
        },
        duration: 8000,
      });
    });
  }, []);

  const handleAuth = () => {
    setAuthed(true);
    addAuditEntry("Login", `User logged in`);
  };

  const handleStartFlow = useCallback((flow: string) => {
    if (flow.startsWith("pipeline:")) {
      setActivePipelineId(flow.replace("pipeline:", ""));
      setActiveFlow("pipeline");
    } else {
      setActiveFlow(flow as any);
    }
  }, []);

  // ── Keyboard shortcuts ──
  const shortcuts: ShortcutDef[] = useMemo(() => [
    { key: "n", label: "N", description: "New Purchase Order", action: () => setActiveFlow("purchase_orders") },
    { key: "r", label: "R", description: "Receive Stock", action: () => setActiveFlow("quick_receive") },
    { key: "t", label: "T", description: "New Stocktake", action: () => setActiveFlow("stocktake_module") },
    { key: "s", label: "S", description: "Focus Barcode Scanner", action: () => setActiveFlow("scan_mode") },
    { key: "k", ctrl: true, label: "⌘K", description: "Quick Search", action: () => setShowQuickSearch(true) },
    { key: "?", label: "?", description: "Keyboard Shortcuts", action: () => setShowShortcuts(true) },
  ], []);
  useKeyboardShortcuts(shortcuts);

  // ── Responsive layout switch (reactive to window resize) ──
  const isDesktop = useMediaQuery("(min-width: 1024px)");

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

  // Suspense fallback — minimal spinner to prevent CLS
  const suspenseFallback = (
    <div className="flex items-center justify-center min-h-[200px]">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  // ── Embedded auth gate ──
  // While the embedded session-token handshake is running, show a loading
  // state instead of falling through to the public marketing AuthScreen.
  if (isEmbedded && embeddedAuthState === "loading" && !embeddedAuthTimedOut) {
    return (
      <div className="flex items-center justify-center min-h-screen flex-col gap-3 p-6 text-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground">Signing you in via Shopify…</p>
      </div>
    );
  }

  // Hard timeout reached — App Bridge / verify endpoint never returned.
  // Show a retry button so the user isn't stuck on an infinite spinner.
  if (isEmbedded && embeddedAuthState === "loading" && embeddedAuthTimedOut) {
    // Detect if we're actually inside a Shopify Admin iframe. If we're at the
    // top window, the user is browsing the preview/published URL directly with
    // stale ?shop=&host= params (or a stuck dev_embedded_mode flag) and App
    // Bridge will never load — give them a one-click escape hatch.
    const inIframe = (() => { try { return window.self !== window.top; } catch { return true; } })();
    const exitEmbedded = () => {
      try { localStorage.removeItem("dev_embedded_mode"); } catch { /* noop */ }
      const url = new URL(window.location.href);
      url.searchParams.delete("shop");
      url.searchParams.delete("host");
      url.searchParams.delete("embedded");
      url.searchParams.delete("id_token");
      window.location.replace(url.pathname + (url.search ? url.search : "") + url.hash);
    };
    return (
      <div className="flex items-center justify-center min-h-screen flex-col gap-3 p-6 text-center max-w-md mx-auto">
        <h1 className="text-lg font-semibold text-foreground">Sign-in is taking longer than expected</h1>
        <p className="text-sm text-muted-foreground">
          We couldn't complete the Shopify session handshake. This usually clears with a reload.
          {embeddedAuthError ? <span className="block mt-2 text-xs opacity-70">{embeddedAuthError}</span> : null}
        </p>
        <div className="flex flex-col sm:flex-row gap-2 mt-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
          >
            Reload app
          </button>
          {!inIframe && (
            <button
              type="button"
              onClick={exitEmbedded}
              className="px-4 py-2 rounded-md border border-border text-sm font-medium hover:bg-muted"
            >
              Continue without Shopify
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {inIframe
            ? "Still stuck? Open the app from your Shopify Admin home (Apps → Sonic Invoices)."
            : "You're not inside Shopify Admin — use \"Continue without Shopify\" to sign in normally, or open the app from Shopify Admin (Apps → Sonic Invoices)."}
        </p>
      </div>
    );
  }

  // If the shop has no install row in the backend, surface a clear reinstall
  // prompt rather than the public-marketing login (which would just confuse merchants).
  if (isEmbedded && embeddedAuthState === "needs_install") {
    return (
      <div className="flex items-center justify-center min-h-screen flex-col gap-3 p-6 text-center max-w-md mx-auto">
        <h1 className="text-lg font-semibold text-foreground">Finish installing Sonic Invoices</h1>
        <p className="text-sm text-muted-foreground">
          Your shop hasn't completed the install handshake yet. Reinstall the app from the Shopify App Store
          (or your dev partner dashboard) to grant access.
        </p>
      </div>
    );
  }

  if (isEmbedded && embeddedAuthState === "unauthenticated") {
    return (
      <div className="flex items-center justify-center min-h-screen flex-col gap-3 p-6 text-center max-w-md mx-auto">
        <h1 className="text-lg font-semibold text-foreground">Shopify sign-in could not be completed</h1>
        <p className="text-sm text-muted-foreground">
          We couldn't validate the embedded Shopify session for this load.
          {embeddedAuthError ? <span className="block mt-2 text-xs opacity-70">{embeddedAuthError}</span> : null}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          Reload app
        </button>
      </div>
    );
  }

  // When embedded in Shopify, skip standalone auth/onboarding
  // (Shopify handles auth via session tokens or OAuth install flow)
  if (!authed) {
    return <Suspense fallback={suspenseFallback}><AuthScreen onAuth={handleAuth} /></Suspense>;
  }

  if (!isEmbedded && !onboarded) {
    return <Suspense fallback={suspenseFallback}><OnboardingFlow onComplete={() => setOnboarded(true)} /></Suspense>;
  }


  const renderFlow = () => {
    let flowEl: React.ReactNode = null;
    switch (activeFlow) {
      case "invoice": flowEl = <InvoiceFlow onBack={() => setActiveFlow(null)} onNavigate={(f) => setActiveFlow(f as any)} />; break;
      case "sale": flowEl = <BulkSaleFlow onBack={() => setActiveFlow(null)} onNavigateToGoogleFeed={() => { setActiveFlow(null); setActiveTab("tools"); }} />; break;
      case "restock": flowEl = <RestockAnalytics onBack={() => setActiveFlow(null)} onStartFlow={handleStartFlow} />; break;
      case "price_adjust": flowEl = <PriceAdjustmentPanel onBack={() => setActiveFlow(null)} />; break;
      case "price_lookup": flowEl = <PriceLookup onBack={() => setActiveFlow(null)} />; break;
      case "order_form": flowEl = <OrderFormFlow onBack={() => setActiveFlow(null)} />; break;
      case "seasons": flowEl = <SeasonManager onBack={() => setActiveFlow(null)} />; break;
      case "reorder": flowEl = <ReorderPanel onBack={() => setActiveFlow(null)} onViewOrders={() => setActiveFlow("order_form")} />; break;
      case "suppliers": flowEl = <SupplierPanel onBack={() => setActiveFlow(null)} onStartInvoice={() => setActiveFlow("invoice")} />; break;
      case "audit_log": flowEl = <AuditLogPanel onBack={() => setActiveFlow(null)} />; break;
      case "purchase_orders": flowEl = <PurchaseOrderPanel onBack={() => setActiveFlow(null)} />; break;
      case "quick_receive": flowEl = <PurchaseOrderPanel onBack={() => setActiveFlow(null)} />; break;
      case "catalog_memory": flowEl = <CatalogMemoryPanel onBack={() => setActiveFlow(null)} />; break;
      case "email_inbox": flowEl = <EmailInboxPanel onBack={() => setActiveFlow(null)} onProcessInvoice={() => setActiveFlow("invoice")} />; break;
      case "collab_seo": flowEl = <CollabSEOFlow onBack={() => setActiveFlow(null)} />; break;
      case "google_ads_setup": flowEl = <GoogleAdsSetupWizard onBack={() => setActiveFlow(null)} />; break;
      case "meta_ads_setup": flowEl = <MetaAdsSetupWizard onBack={() => setActiveFlow(null)} />; break;
      case "lightspeed_convert": flowEl = <LightspeedConverter onBack={() => setActiveFlow(null)} />; break;
      case "scan_mode": flowEl = <ScanMode onBack={() => setActiveFlow(null)} />; break;
      case "performance": flowEl = <PerformanceDashboard onBack={() => setActiveFlow(null)} />; break;
      case "feed_optimise": flowEl = <AIFeedOptimisation onBack={() => setActiveFlow(null)} />; break;
      case "feed_health": flowEl = <FeedHealthPanel onBack={() => setActiveFlow(null)} onStartFlow={handleStartFlow} />; break;
      case "google_colour": flowEl = <GoogleColourFlow onBack={() => setActiveFlow(null)} />; break;
      case "google_ads": flowEl = <GoogleAdsFlow onBack={() => setActiveFlow(null)} />; break;
      case "style_grouping": flowEl = <StyleGroupingFlow onBack={() => setActiveFlow(null)} />; break;
      case "competitor_intel": flowEl = <CompetitorIntelFlow onBack={() => setActiveFlow(null)} />; break;
      case "collection_seo": flowEl = <CollectionSEOFlow onBack={() => setActiveFlow(null)} onStartFlow={handleStartFlow} />; break;
      case "collection_seo_export": flowEl = <CollectionSEOExport onBack={() => setActiveFlow(null)} />; break;
      case "geo_agentic": flowEl = <GeoAgenticFlow onBack={() => setActiveFlow(null)} />; break;
      case "organic_seo": flowEl = <OrganicSEOFlow onBack={() => setActiveFlow(null)} />; break;
      case "margin_protection": flowEl = <MarginProtectionPanel onBack={() => setActiveFlow(null)} />; break;
      case "markdown_ladder": flowEl = <MarkdownLadderPanel onBack={() => setActiveFlow(null)} />; break;
      case "stock_monitor": flowEl = <StockMonitorPanel onBack={() => setActiveFlow(null)} />; break;
      case "social_media": flowEl = <SocialMediaPanel onBack={() => setActiveFlow(null)} onStartFlow={handleStartFlow} />; break;
      case "inventory_planning": flowEl = <InventoryPlanningPanel onBack={() => setActiveFlow(null)} />; break;
      case "packing_slip": flowEl = <PackingSlipFlow onBack={() => setActiveFlow(null)} />; break;
      case "joor": flowEl = <JoorFlow onBack={() => setActiveFlow(null)} />; break;
      case "wholesale_import": flowEl = <WholesaleImportFlow onBack={() => setActiveFlow(null)} />; break;
      case "lookbook_import": flowEl = <LookbookImportFlow onBack={() => setActiveFlow(null)} />; break;
      case "accounting": flowEl = <AccountingIntegration onBack={() => setActiveFlow(null)} />; break;
      case "profit_loss": flowEl = <ProfitLossPanel onBack={() => setActiveFlow(null)} />; break;
      case "stocky_hub": flowEl = <StockyHub onBack={() => setActiveFlow(null)} onNavigate={(t) => {
        const map: Record<string, any> = { purchase_orders: "purchase_orders", suppliers: "suppliers", stock_monitor: "stock_monitor", reorder: "reorder", margin_protection: "margin_protection", markdown_ladder: "markdown_ladder", restock_analytics: "restock", stocky_migration: "stocky_migration", inventory_dashboard: "inventory_dashboard", product_health: "product_health", order_sync: "order_sync", stock_adjustment: "stock_adjustment" };
        setActiveFlow(map[t] || t);
      }} />; break;
      case "stocky_migration": flowEl = <StockyMigration onBack={() => setActiveFlow("stocky_hub")} onComplete={() => setActiveFlow("stocky_hub")} />; break;
      case "stocky_onboarding": flowEl = <StockyOnboarding onBack={() => setActiveFlow(null)} onComplete={() => { setActiveFlow(null); localStorage.setItem("stocky_onboarding_done", "true"); }} onStartPipeline={(id) => { setActivePipelineId(id); setActiveFlow("pipeline"); localStorage.setItem("stocky_onboarding_done", "true"); }} onStartFlow={(f) => { setActiveFlow(f as any); localStorage.setItem("stocky_onboarding_done", "true"); }} />; break;
      case "inventory_dashboard": flowEl = <InventoryDashboard onBack={() => setActiveFlow("stocky_hub")} />; break;
      case "product_health": flowEl = <ProductHealthPanel onBack={() => setActiveFlow("stocky_hub")} />; break;
      case "order_sync": flowEl = <ShopifyOrderSync onBack={() => setActiveFlow("stocky_hub")} />; break;
      case "image_optimise": flowEl = <ImageOptimisePanel onBack={() => setActiveFlow(null)} />; break;
      case "stock_check": flowEl = <StockCheckFlow lineItems={[]} onBack={() => setActiveFlow(null)} onStartFlow={handleStartFlow} />; break;
      case "stocktake_module": flowEl = <StocktakeModule onBack={() => setActiveFlow(null)} />; break;
      case "transfer_orders": flowEl = <TransferOrderPanel onBack={() => setActiveFlow(null)} />; break;
      case "reports_hub": flowEl = <ReportsHub onBack={() => setActiveFlow(null)} />; break;
      case "supplier_profile_builder": flowEl = <SupplierProfileBuilder onBack={() => setActiveFlow(null)} onViewLearnedRules={() => setActiveFlow("supplier_intelligence")} />; break;
      case "stock_adjustment": flowEl = <StockAdjustmentPanel onBack={() => setActiveFlow(null)} />; break;
      case "inventory_view": flowEl = <InventoryView onBack={() => setActiveFlow(null)} />; break;
      case "csv_seo": flowEl = <ShopifyCSVSEO onBack={() => setActiveFlow(null)} />; break;
      case "price_match": flowEl = <PriceMatchPanel lineItems={[]} onBack={() => setActiveFlow(null)} />; break;
      case "product_descriptions": flowEl = <ProductDescriptionPanel lineItems={[]} onBack={() => setActiveFlow(null)} />; break;
      case "stocky_dashboard": flowEl = <StockyHomeDashboard onNavigate={(f) => setActiveFlow(f as any)} onSwitchToClassic={() => { setUseStockyDashboard(false); localStorage.setItem("stocky_dashboard_mode", "false"); setActiveFlow(null); }} />; break;
      case "pipeline": flowEl = activePipelineId ? <PipelineRunner pipelineId={activePipelineId} onRenderFlow={(flowKey, onComplete) => {
        const flowMap: Record<string, React.ReactNode> = {
          invoice: <InvoiceFlow onBack={onComplete} />,
          stock_check: <StockCheckFlow lineItems={[]} onBack={onComplete} />,
          image_optimise: <ImageOptimisePanel onBack={onComplete} />,
          feed_health: <FeedHealthPanel onBack={onComplete} />,
          collection_seo: <CollectionSEOFlow onBack={onComplete} />,
          style_grouping: <StyleGroupingFlow onBack={onComplete} />,
          social_media: <SocialMediaPanel onBack={onComplete} />,
          accounting: <AccountingIntegration onBack={onComplete} />,
          feed_optimise: <AIFeedOptimisation onBack={onComplete} />,
          organic_seo: <OrganicSEOFlow onBack={onComplete} />,
          geo_agentic: <GeoAgenticFlow onBack={onComplete} />,
          collab_seo: <CollabSEOFlow onBack={onComplete} />,
          google_colour: <GoogleColourFlow onBack={onComplete} />,
          google_ads: <GoogleAdsFlow onBack={onComplete} />,
          google_ads_setup: <GoogleAdsSetupWizard onBack={onComplete} />,
          meta_ads_setup: <MetaAdsSetupWizard onBack={onComplete} />,
          performance: <PerformanceDashboard onBack={onComplete} />,
          restock: <RestockAnalytics onBack={onComplete} />,
          markdown_ladder: <MarkdownLadderPanel onBack={onComplete} />,
          margin_protection: <MarginProtectionPanel onBack={onComplete} />,
          reorder: <ReorderPanel onBack={onComplete} onViewOrders={() => {}} />,
          purchase_orders: <PurchaseOrderPanel onBack={onComplete} />,
          profit_loss: <ProfitLossPanel onBack={onComplete} />,
        };
        return flowMap[flowKey] || <div className="p-6 text-center text-sm text-muted-foreground">Flow "{flowKey}" — <button className="text-primary underline" onClick={onComplete}>Mark complete →</button></div>;
      }} onExit={() => { setActiveFlow(null); setActivePipelineId(null); }} /> : null; break;
      case "pipeline_chooser": flowEl = <PipelineChooser onSelect={(id) => { setActivePipelineId(id); setActiveFlow("pipeline"); }} onBack={() => setActiveFlow(null)} />; break;
      case "supplier_intelligence": flowEl = <SupplierIntelligencePanel onBack={() => setActiveFlow(null)} onOpenInvoiceFlow={() => setActiveFlow("invoice")} />; break;
      case "teach_invoice_tutorial": flowEl = <TeachInvoiceTutorial
        onBack={() => setActiveFlow(null)}
        onStartInvoice={() => setActiveFlow("invoice")}
        onOpenSupplierIntelligence={() => setActiveFlow("supplier_intelligence")}
        onOpenCatalogMemory={() => setActiveFlow("catalog_memory")}
      />; break;
      case "processing_history": flowEl = <ProcessingHistoryPanel onBack={() => setActiveFlow(null)} onOpenInvoiceFlow={() => setActiveFlow("invoice")} />; break;
      case "stock_reconciliation":
        flowEl = reconciliationResult ? (
          <StockReconciliationPanel
            reconciliationResult={reconciliationResult}
            onBack={() => setActiveFlow("invoice")}
            onExport={(sets) => handleReconciliationExport(sets)}
          />
        ) : (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No reconciliation in progress. <button className="text-primary underline" onClick={() => setActiveFlow("invoice")}>Start an invoice →</button>
          </div>
        );
        break;
      default: return null;
    }
    return <Suspense fallback={suspenseFallback}>{flowEl}</Suspense>;
  };

  // In standalone mobile mode, flows replace the entire screen (no sidebar)
  // On desktop, flows render inside StockyLayout (sidebar stays visible)
  if (!isEmbedded && activeFlow && !isDesktop) {
    return (
      <div className="min-h-screen pb-24">
        {renderFlow()}
        <BottomTabBar activeTab={activeTab} onTabChange={(tab) => { setActiveFlow(null); setActiveTab(tab); }} />
      </div>
    );
  }

  const mainContent = (
    <>
      {activeTab === "home" && useStockyDashboard && (
        <Suspense fallback={suspenseFallback}>
          <StockyHomeDashboard
            onNavigate={(f) => setActiveFlow(f as any)}
            onSwitchToClassic={() => { setUseStockyDashboard(false); localStorage.setItem("stocky_dashboard_mode", "false"); }}
          />
        </Suspense>
      )}
      {activeTab === "home" && !useStockyDashboard && (
        <HomeWizard
          onStartInvoice={() => setActiveFlow("invoice")}
          onStartPackingSlip={() => setActiveFlow("packing_slip")}
          onStartEmailInbox={() => setActiveFlow("email_inbox")}
          onStartJoor={() => setActiveFlow("joor")}
          onStartWholesaleImport={() => setActiveFlow("wholesale_import")}
          onStartLookbookImport={() => setActiveFlow("lookbook_import")}
          onStartScanMode={() => setActiveFlow("scan_mode")}
        />
      )}
      {activeTab === "start" && (
        <PhaseFlowHome
          onStartInvoice={() => setActiveFlow("invoice")}
          onStartPackingSlip={() => setActiveFlow("packing_slip")}
          onStartEmailInbox={() => setActiveFlow("email_inbox")}
          onStartJoor={() => setActiveFlow("joor")}
          onStartWholesaleImport={() => setActiveFlow("wholesale_import")}
          onStartLookbookImport={() => setActiveFlow("lookbook_import")}
          onStartScanMode={() => setActiveFlow("scan_mode")}
        />
      )}
      <Suspense fallback={suspenseFallback}>
        {activeTab === "invoices" && (
          <InvoicesTab
            onStartInvoice={() => setActiveFlow("invoice")}
            onStartStockCheck={() => setActiveFlow("stock_check")}
            onStartPackingSlip={() => setActiveFlow("packing_slip")}
            onStartScanMode={() => setActiveFlow("scan_mode")}
            onStartEmailInbox={() => setActiveFlow("email_inbox")}
            onStartJoor={() => setActiveFlow("joor")}
            onStartWholesaleImport={() => setActiveFlow("wholesale_import")}
            onStartLookbookImport={() => setActiveFlow("lookbook_import")}
            onStartPurchaseOrders={() => setActiveFlow("purchase_orders")}
            onStartOrderForm={() => setActiveFlow("order_form")}
            onStartAccounting={() => setActiveFlow("accounting")}
            onStartRestock={() => setActiveFlow("restock")}
            onStartReorder={() => setActiveFlow("reorder")}
            onStartSuppliers={() => setActiveFlow("suppliers")}
            onStartCatalogMemory={() => setActiveFlow("catalog_memory")}
          />
        )}
        {activeTab === "analytics" && <AnalyticsPanel />}
        {activeTab === "history" && <HistoryScreen />}
        {activeTab === "tools" && <ToolsScreen />}
        {activeTab === "guide" && <LightspeedGuide onBack={() => setActiveTab("home")} onNavigate={(f) => { if (f === "invoice" || f === "lightspeed_convert") setActiveFlow(f); }} />}
        {activeTab === "google_ads" && <AdsGuideTabs />}
        {activeTab === "billing" && <BillingScreen />}
        {activeTab === "help" && <HelpCentre />}
        {activeTab === "howto" && <HowToCatalog onNavigateToFeature={(f) => setActiveFlow(f as any)} onNavigateToTab={(t) => { setActiveFlow(null); setActiveTab(t); }} />}
        {activeTab === "agent_guide" && <AgentGuide onBack={() => setActiveTab("home")} onOpenAutomation={() => setActiveTab("account")} />}
        {activeTab === "account" && <AccountScreen />}
      </Suspense>
    </>
  );

  // ─── Embedded layout (inside Shopify Admin) — always uses StockyLayout ───
  if (isEmbedded) {
    return (
      <StockyLayout
        activeTab={activeFlow ? "" : activeTab}
        activeFlow={activeFlow}
        onTabChange={(tab) => { setActiveFlow(null); setActiveTab(tab); }}
        onFlowChange={(flow) => setActiveFlow(flow as any)}
      >
        <div className="pb-20 lg:pb-0">
          <div className="flex items-center justify-end gap-2 px-4 pt-3 pb-2 border-b border-border lg:border-0">
            {activeFlow && (
              <button
                onClick={() => setActiveFlow(null)}
                className="mr-auto text-xs text-muted-foreground hover:text-foreground"
              >
                ← Back
              </button>
            )}
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
          <PhaseProgressBar
            activeTab={activeTab}
            activeFlow={activeFlow}
            onNavigate={(t) => {
              if (t.type === "tab") { setActiveFlow(null); setActiveTab(t.id); }
              else { setActiveFlow(t.id as any); }
            }}
          />
          {activeFlow ? renderFlow() : mainContent}
        </div>
        {/* Mobile bottom tabs for embedded mode — conditional render to avoid duplicate DOM */}
        {!isDesktop && (
          <BottomTabBar activeTab={activeTab} onTabChange={(tab) => { setActiveFlow(null); setActiveTab(tab); }} />
        )}
      </StockyLayout>
    );
  }

  // ─── Standalone layout ───
  // Desktop (≥1024px): use StockyLayout sidebar; Mobile: use BottomTabBar
  return (
    <div className="min-h-screen">
      {/* Desktop layout — only mounted on desktop viewports (eliminates duplicate DOM) */}
      {isDesktop && (
        <div className="h-screen">
          <StockyLayout
            activeTab={activeFlow ? "" : activeTab}
            activeFlow={activeFlow}
            onTabChange={(tab) => { setActiveFlow(null); setActiveTab(tab); }}
            onFlowChange={(flow) => setActiveFlow(flow as any)}
          >
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
              <StoreModePill mode={mode} onOpenAccount={() => setActiveTab("account")} />
            </div>
            <PhaseProgressBar
              activeTab={activeTab}
              activeFlow={activeFlow}
              onNavigate={(t) => {
                if (t.type === "tab") { setActiveFlow(null); setActiveTab(t.id); }
                else { setActiveFlow(t.id as any); }
              }}
            />
            <QuickActionsBar onAction={handleStartFlow} />
            {activeFlow ? renderFlow() : mainContent}
          </StockyLayout>
        </div>
      )}

      {/* Mobile layout — only mounted on mobile viewports */}
      {!isDesktop && (
        <div className="pb-24">
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
            <StoreModePill mode={mode} onOpenAccount={() => setActiveTab("account")} />
          </div>
          <PhaseProgressBar
            activeTab={activeTab}
            activeFlow={activeFlow}
            onNavigate={(t) => {
              if (t.type === "tab") { setActiveFlow(null); setActiveTab(t.id); }
              else { setActiveFlow(t.id as any); }
            }}
          />
          <QuickActionsBar onAction={handleStartFlow} />
          {activeFlow ? renderFlow() : mainContent}
          <BottomTabBar activeTab={activeTab} onTabChange={setActiveTab} />

        {/* Floating Quick Capture button — mobile only */}
        <button
          onClick={() => setShowCapture(true)}
          className="fixed bottom-20 right-4 z-40 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center active:scale-95 transition-transform"
          aria-label="Quick Capture"
        >
          <span className="text-2xl">📷</span>
        </button>

          {showCapture && <QuickCapture onClose={() => setShowCapture(false)} />}
        </div>
      )}

      {/* Global modals */}
      <KeyboardShortcutsModal open={showShortcuts} onOpenChange={setShowShortcuts} />
      <QuickSearchModal open={showQuickSearch} onOpenChange={setShowQuickSearch} onNavigate={handleStartFlow} />
    </div>
  );
};

export default Index;
