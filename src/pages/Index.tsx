import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { addAuditEntry } from "@/lib/audit-log";
import { onImageSeoTrigger } from "@/lib/image-seo-trigger";
import NotificationBell from "@/components/NotificationBell";
import LoadingScreen from "@/components/ui/loading-screen";

// ── Eagerly loaded (critical path) ──
import HomeScreen from "@/components/HomeScreen";
import BottomTabBar from "@/components/BottomTabBar";
import EmbeddedNav from "@/components/EmbeddedNav";
import StockyLayout from "@/components/StockyLayout";
import QuickActionsBar from "@/components/QuickActionsBar";

// ── Lazy-loaded (code-split) — improves LCP & reduces main-thread work (INP) ──
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
const StocktakeModule = lazy(() => import("@/components/StocktakeModule"));
const TransferOrderPanel = lazy(() => import("@/components/TransferOrderPanel"));
const ReportsHub = lazy(() => import("@/components/ReportsHub"));
const StockAdjustmentPanel = lazy(() => import("@/components/StockAdjustmentPanel"));
const InventoryView = lazy(() => import("@/components/InventoryView"));
import { useStoreMode } from "@/hooks/use-store-mode";
import { useNotifications } from "@/hooks/use-notifications";
import { useShopifyEmbedded } from "@/components/ShopifyEmbeddedProvider";
import { exchangeShopifyToken } from "@/lib/shopify-auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const Index = () => {
  const [authed, setAuthed] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem("onboarding_complete") === "true");
  const [activeTab, setActiveTab] = useState("home");
  const [activeFlow, setActiveFlow] = useState<"invoice" | "sale" | "restock" | "price_adjust" | "price_lookup" | "order_form" | "seasons" | "reorder" | "suppliers" | "audit_log" | "purchase_orders" | "catalog_memory" | "email_inbox" | "collab_seo" | "google_ads_setup" | "meta_ads_setup" | "lightspeed_convert" | "scan_mode" | "performance" | "feed_optimise" | "feed_health" | "google_colour" | "google_ads" | "style_grouping" | "competitor_intel" | "collection_seo" | "geo_agentic" | "organic_seo" | "margin_protection" | "markdown_ladder" | "stock_monitor" | "social_media" | "inventory_planning" | "packing_slip" | "joor" | "wholesale_import" | "lookbook_import" | "accounting" | "profit_loss" | "stocky_hub" | "stocky_migration" | "stocky_onboarding" | "inventory_dashboard" | "inventory_view" | "product_health" | "order_sync" | "image_optimise" | "stock_check" | "stocktake_module" | "transfer_orders" | "reports_hub" | "pipeline" | "pipeline_chooser" | "supplier_profile_builder" | "stock_adjustment" | null>(null);
  const [activePipelineId, setActivePipelineId] = useState<string | null>(null);
  const [showCapture, setShowCapture] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mode = useStoreMode();
  const { notifications, unreadCount, addNotification, markRead, markAllRead } = useNotifications();
  const { isEmbedded, shop, authState: embeddedAuthState } = useShopifyEmbedded();

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
      setAuthed(!!session);
      setAuthLoading(false);
    });

    // Then check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setAuthed(true);
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
    } else if (embeddedAuthState === "unauthenticated") {
      setAuthLoading(false);
    }
    // "loading" → keep authLoading true (default)
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
      case "invoice": flowEl = <InvoiceFlow onBack={() => setActiveFlow(null)} />; break;
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
      case "supplier_profile_builder": flowEl = <SupplierProfileBuilder onBack={() => setActiveFlow(null)} />; break;
      case "stock_adjustment": flowEl = <StockAdjustmentPanel onBack={() => setActiveFlow(null)} />; break;
      case "inventory_view": flowEl = <InventoryView onBack={() => setActiveFlow(null)} />; break;
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
      default: return null;
    }
    return <Suspense fallback={suspenseFallback}>{flowEl}</Suspense>;
  };

  // In standalone mobile mode, flows replace the entire screen (no sidebar)
  // On desktop, flows render inside StockyLayout (sidebar stays visible)
  const isDesktop = typeof window !== "undefined" && window.innerWidth >= 1024;
  if (!isEmbedded && activeFlow && !isDesktop) {
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
          onStartStyleGrouping={() => setActiveFlow("style_grouping")}
          onStartCompetitorIntel={() => setActiveFlow("competitor_intel")}
          onStartCollectionSEO={() => setActiveFlow("collection_seo")}
          onStartGeoAgentic={() => setActiveFlow("geo_agentic")}
          onStartOrganicSEO={() => setActiveFlow("organic_seo")}
          onStartMarginProtection={() => setActiveFlow("margin_protection")}
          onStartMarkdownLadder={() => setActiveFlow("markdown_ladder")}
          onStartStockMonitor={() => setActiveFlow("stock_monitor")}
          onStartSocialMedia={() => setActiveFlow("social_media")}
           onStartInventoryPlanning={() => setActiveFlow("inventory_planning")}
           onStartStockyHub={() => setActiveFlow("stocky_hub")}
          onStartPackingSlip={() => setActiveFlow("packing_slip")}
          onStartJoor={() => setActiveFlow("joor")}
          onStartWholesaleImport={() => setActiveFlow("wholesale_import")}
          onStartLookbookImport={() => setActiveFlow("lookbook_import")}
           onStartAccounting={() => setActiveFlow("accounting")}
           onStartProfitLoss={() => setActiveFlow("profit_loss")}
           onStartImageOptimise={() => setActiveFlow("image_optimise")}
           onStartStockCheck={() => setActiveFlow("stock_check")}
           onStartPriceLookup={() => setActiveFlow("price_lookup")}
           onStartSeasons={() => setActiveFlow("seasons")}
            onNavigateToTab={(tab) => { setActiveFlow(null); setActiveTab(tab); }}
            onStartPipeline={(id) => { setActivePipelineId(id); setActiveFlow("pipeline"); }}
            onStartPipelineChooser={() => setActiveFlow("pipeline_chooser")}
             onStartStockyOnboarding={() => setActiveFlow("stocky_onboarding")}
             onStartSupplierProfileBuilder={() => setActiveFlow("supplier_profile_builder")}
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
        {activeTab === "help" && <HelpCentre />}
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
          {activeFlow ? renderFlow() : mainContent}
        </div>
        {/* Mobile bottom tabs for embedded mode */}
        <div className="lg:hidden">
          <BottomTabBar activeTab={activeTab} onTabChange={(tab) => { setActiveFlow(null); setActiveTab(tab); }} />
        </div>
      </StockyLayout>
    );
  }

  // ─── Standalone layout ───
  // Desktop (≥1024px): use StockyLayout sidebar; Mobile: use BottomTabBar
  return (
    <div className="min-h-screen">
      {/* Desktop sidebar wrapper — hidden on mobile */}
      <div className="hidden lg:block h-screen">
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
            <button
              onClick={() => setActiveTab("account")}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${mode.modeBadge.color}`}
            >
              <span>{mode.modeBadge.emoji}</span>
              {mode.modeBadge.label}
            </button>
          </div>
          <QuickActionsBar onAction={handleStartFlow} />
          {activeFlow ? renderFlow() : mainContent}
        </StockyLayout>
      </div>

      {/* Mobile layout — hidden on desktop */}
      <div className="lg:hidden">
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
    </div>
  );
};

export default Index;
