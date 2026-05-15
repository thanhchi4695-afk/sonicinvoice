// ── FlowRegistry ──────────────────────────────────────────────────────────
// Single source of truth for every "activeFlow" panel. Replaces the dual
// FLOW_KEYS table + giant switch in Index.tsx.
//
// Add a flow by adding one entry below — the type guard, render dispatch and
// suspense skeleton are all derived from this map.
import { lazy, Suspense, type ReactNode } from "react";
import { FlowSkeleton } from "@/components/ui/flow-skeleton";

// ── Lazy-loaded panels ──
const InvoiceFlow = lazy(() => import("@/components/InvoiceFlow"));
const BulkSaleFlow = lazy(() => import("@/components/BulkSaleFlow"));
const RestockAnalytics = lazy(() => import("@/components/RestockAnalytics"));
const PriceAdjustmentPanel = lazy(() => import("@/components/PriceAdjustmentPanel"));
const PriceLookup = lazy(() => import("@/components/PriceLookup"));
const OrderFormFlow = lazy(() => import("@/components/OrderFormFlow"));
const SeasonManager = lazy(() => import("@/components/SeasonManager"));
const ReorderPanel = lazy(() => import("@/components/ReorderPanel"));
const SupplierPanel = lazy(() => import("@/components/SupplierPanel"));
const AuditLogPanel = lazy(() => import("@/components/AuditLogPanel"));
const OutboundPurchaseOrders = lazy(() => import("@/components/OutboundPurchaseOrders"));
const RestockSuggestionsPanel = lazy(() => import("@/components/RestockSuggestionsPanel"));
const PricingAssistantPanel = lazy(() => import("@/components/PricingAssistantPanel"));
const PurchaseOrderPanel = lazy(() => import("@/components/PurchaseOrderPanel"));
const CatalogMemoryPanel = lazy(() => import("@/components/CatalogMemoryPanel"));
const EmailInboxPanel = lazy(() => import("@/components/EmailInboxPanel"));
const CollabSEOFlow = lazy(() => import("@/components/CollabSEOFlow"));
const GoogleAdsSetupWizard = lazy(() => import("@/components/GoogleAdsSetupWizard"));
const MetaAdsSetupWizard = lazy(() => import("@/components/MetaAdsSetupWizard"));
const LightspeedConverter = lazy(() => import("@/components/LightspeedConverter"));
const ScanMode = lazy(() => import("@/components/ScanMode"));
const PerformanceDashboard = lazy(() => import("@/components/PerformanceDashboard"));
const AIFeedOptimisation = lazy(() => import("@/components/AIFeedOptimisation"));
const FeedHealthPanel = lazy(() => import("@/components/FeedHealthPanel"));
const GoogleColourFlow = lazy(() => import("@/components/GoogleColourFlow"));
const GoogleAdsFlow = lazy(() => import("@/components/GoogleAdsFlow"));
const StyleGroupingFlow = lazy(() => import("@/components/StyleGroupingFlow"));
const CompetitorIntelFlow = lazy(() => import("@/components/CompetitorIntelFlow"));
const CollectionSEOFlow = lazy(() => import("@/components/CollectionSEOFlow"));
const ProductCollectionDecomposer = lazy(() => import("@/components/ProductCollectionDecomposer"));
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
const ImageSEOFlow = lazy(() => import("@/components/ImageSEOFlow"));
const AccountingIntegration = lazy(() => import("@/components/AccountingIntegration"));
const ProfitLossPanel = lazy(() => import("@/components/ProfitLossPanel"));
const StockyHub = lazy(() => import("@/components/StockyHub"));
const StockyMigration = lazy(() => import("@/components/StockyMigration"));
const StockyOnboarding = lazy(() => import("@/components/StockyOnboarding"));
const InventoryDashboard = lazy(() => import("@/components/InventoryDashboard"));
const ProductHealthPanel = lazy(() => import("@/components/ProductHealthPanel"));
const ShopifyOrderSync = lazy(() => import("@/components/ShopifyOrderSync"));
const ImageOptimisePanel = lazy(() => import("@/components/ImageOptimisePanel"));
const StockCheckFlow = lazy(() => import("@/components/StockCheckFlow"));
const StocktakeModule = lazy(() => import("@/components/StocktakeModule"));
const TransferOrderPanel = lazy(() => import("@/components/TransferOrderPanel"));
const ReportsHub = lazy(() => import("@/components/ReportsHub"));
const SupplierProfileBuilder = lazy(() => import("@/components/SupplierProfileBuilder"));
const StockAdjustmentPanel = lazy(() => import("@/components/StockAdjustmentPanel"));
const InventoryView = lazy(() => import("@/components/InventoryView"));
const ShopifyCSVSEO = lazy(() => import("@/components/ShopifyCSVSEO"));
const PriceMatchPanel = lazy(() => import("@/components/PriceMatchPanel"));
const ProductDescriptionPanel = lazy(() => import("@/components/ProductDescriptionPanel"));
const StockyHomeDashboard = lazy(() => import("@/components/StockyHomeDashboard"));
const PipelineRunner = lazy(() => import("@/components/PipelineRunner"));
const PipelineChooser = lazy(() => import("@/components/PipelineChooser"));
const SupplierIntelligencePanel = lazy(() => import("@/components/SupplierIntelligencePanel"));
const TeachInvoiceTutorial = lazy(() => import("@/components/TeachInvoiceTutorial"));
const ProcessingHistoryPanel = lazy(() => import("@/components/ProcessingHistoryPanel"));
const InvoiceDetailScreen = lazy(() => import("@/components/InvoiceDetailScreen"));
const StockReconciliationPanel = lazy(() =>
  import("@/components/StockReconciliationPanel").then((m) => ({ default: m.StockReconciliationPanel })),
);

// ── Render context passed from Index ──
export interface FlowContext {
  setActiveFlow: (flow: FlowKey | null) => void;
  setActiveTab: (tab: string) => void;
  setActivePipelineId: (id: string | null) => void;
  setUseStockyDashboard: (b: boolean) => void;
  setReconciliationResult: (r: unknown) => void;
  setHistoryPatternId: (id: string | null) => void;
  handleStartFlow: (flow: string) => void;
  handleReconciliationExport: (sets: unknown) => void;
  safeSetFlow: (flow: string | null) => void;
  // Live state
  activePipelineId: string | null;
  historyPatternId: string | null;
  reconciliationResult: unknown;
}

type Renderer = (ctx: FlowContext) => ReactNode;

// Custom skeleton variant per heavy panel — defaults to "default".
type SkeletonVariant = Parameters<typeof FlowSkeleton>[0]["variant"];

interface FlowEntry {
  render: Renderer;
  skeleton?: SkeletonVariant;
}

const back = (ctx: FlowContext) => () => ctx.setActiveFlow(null);

// ── The registry — add new flows here ──
export const FLOW_REGISTRY = {
  invoice: {
    skeleton: "wizard",
    render: (c) => <InvoiceFlow onBack={back(c)} onNavigate={(f) => c.safeSetFlow(f)} />,
  },
  sale: {
    render: (c) => <BulkSaleFlow onBack={back(c)} onNavigateToGoogleFeed={() => { c.setActiveFlow(null); c.setActiveTab("tools"); }} />,
  },
  restock: { render: (c) => <RestockAnalytics onBack={back(c)} onStartFlow={c.handleStartFlow} /> },
  price_adjust: { render: (c) => <PriceAdjustmentPanel onBack={back(c)} /> },
  price_lookup: { render: (c) => <PriceLookup onBack={back(c)} /> },
  price_match: { render: (c) => <PriceMatchPanel lineItems={[]} onBack={back(c)} /> },
  product_descriptions: { render: (c) => <ProductDescriptionPanel lineItems={[]} onBack={back(c)} /> },
  order_form: { render: (c) => <OrderFormFlow onBack={back(c)} /> },
  seasons: { render: (c) => <SeasonManager onBack={back(c)} /> },
  reorder: { render: (c) => <ReorderPanel onBack={back(c)} onViewOrders={() => c.setActiveFlow("order_form")} /> },
  suppliers: { render: (c) => <SupplierPanel onBack={back(c)} onStartInvoice={() => c.setActiveFlow("invoice")} /> },
  audit_log: { skeleton: "table", render: (c) => <AuditLogPanel onBack={back(c)} /> },
  purchase_orders: { render: (c) => <OutboundPurchaseOrders onBack={back(c)} /> },
  restock_suggestions: { render: (c) => <RestockSuggestionsPanel onBack={back(c)} onOpenPO={() => c.setActiveFlow("purchase_orders")} /> },
  pricing_assistant: { render: (c) => <PricingAssistantPanel onBack={back(c)} /> },
  quick_receive: { render: (c) => <PurchaseOrderPanel onBack={back(c)} /> },
  catalog_memory: { skeleton: "table", render: (c) => <CatalogMemoryPanel onBack={back(c)} /> },
  email_inbox: { render: (c) => <EmailInboxPanel onBack={back(c)} onProcessInvoice={() => c.setActiveFlow("invoice")} /> },
  collab_seo: { render: (c) => <CollabSEOFlow onBack={back(c)} /> },
  google_ads_setup: { skeleton: "wizard", render: (c) => <GoogleAdsSetupWizard onBack={back(c)} /> },
  meta_ads_setup: { skeleton: "wizard", render: (c) => <MetaAdsSetupWizard onBack={back(c)} /> },
  lightspeed_convert: { render: (c) => <LightspeedConverter onBack={back(c)} /> },
  scan_mode: { render: (c) => <ScanMode onBack={back(c)} /> },
  performance: { skeleton: "split", render: (c) => <PerformanceDashboard onBack={back(c)} /> },
  feed_optimise: { render: (c) => <AIFeedOptimisation onBack={back(c)} /> },
  feed_health: { render: (c) => <FeedHealthPanel onBack={back(c)} onStartFlow={c.handleStartFlow} /> },
  google_colour: { render: (c) => <GoogleColourFlow onBack={back(c)} /> },
  google_ads: { render: (c) => <GoogleAdsFlow onBack={back(c)} /> },
  style_grouping: { render: (c) => <StyleGroupingFlow onBack={back(c)} /> },
  competitor_intel: { render: (c) => <CompetitorIntelFlow onBack={back(c)} /> },
  collection_seo: { render: (c) => <CollectionSEOFlow onBack={back(c)} onStartFlow={c.handleStartFlow} /> },
  collection_decomposer: { render: (c) => <ProductCollectionDecomposer onBack={back(c)} onOpenCollectionSEO={() => c.handleStartFlow("collection_seo")} /> },
  collection_seo_export: { render: (c) => <CollectionSEOExport onBack={back(c)} /> },
  geo_agentic: { render: (c) => <GeoAgenticFlow onBack={back(c)} /> },
  organic_seo: { render: (c) => <OrganicSEOFlow onBack={back(c)} /> },
  margin_protection: { render: (c) => <MarginProtectionPanel onBack={back(c)} /> },
  markdown_ladder: { render: (c) => <MarkdownLadderPanel onBack={back(c)} /> },
  stock_monitor: { render: (c) => <StockMonitorPanel onBack={back(c)} /> },
  social_media: { render: (c) => <SocialMediaPanel onBack={back(c)} onStartFlow={c.handleStartFlow} /> },
  inventory_planning: { render: (c) => <InventoryPlanningPanel onBack={back(c)} /> },
  packing_slip: { render: (c) => <PackingSlipFlow onBack={back(c)} /> },
  joor: { render: (c) => <JoorFlow onBack={back(c)} /> },
  wholesale_import: { render: (c) => <WholesaleImportFlow onBack={back(c)} /> },
  lookbook_import: { render: (c) => <LookbookImportFlow onBack={back(c)} /> },
  image_seo: { render: (c) => <ImageSEOFlow onBack={back(c)} /> },
  accounting: { render: (c) => <AccountingIntegration onBack={back(c)} /> },
  profit_loss: { skeleton: "split", render: (c) => <ProfitLossPanel onBack={back(c)} /> },
  stocky_hub: {
    render: (c) => (
      <StockyHub
        onBack={back(c)}
        onNavigate={(t) => {
          const map: Record<string, FlowKey> = {
            purchase_orders: "purchase_orders", suppliers: "suppliers", stock_monitor: "stock_monitor",
            reorder: "reorder", margin_protection: "margin_protection", markdown_ladder: "markdown_ladder",
            restock_analytics: "restock", stocky_migration: "stocky_migration",
            inventory_dashboard: "inventory_dashboard", product_health: "product_health",
            order_sync: "order_sync", stock_adjustment: "stock_adjustment",
          };
          const target = map[t] ?? t;
          if (isFlowKey(target)) c.setActiveFlow(target);
        }}
      />
    ),
  },
  stocky_migration: { render: (c) => <StockyMigration onBack={() => c.setActiveFlow("stocky_hub")} onComplete={() => c.setActiveFlow("stocky_hub")} /> },
  stocky_onboarding: {
    skeleton: "wizard",
    render: (c) => (
      <StockyOnboarding
        onBack={back(c)}
        onComplete={() => { c.setActiveFlow(null); localStorage.setItem("stocky_onboarding_done", "true"); }}
        onStartPipeline={(id) => { c.setActivePipelineId(id); c.setActiveFlow("pipeline"); localStorage.setItem("stocky_onboarding_done", "true"); }}
        onStartFlow={(f) => { c.safeSetFlow(f); localStorage.setItem("stocky_onboarding_done", "true"); }}
      />
    ),
  },
  inventory_dashboard: { skeleton: "split", render: (c) => <InventoryDashboard onBack={() => c.setActiveFlow("stocky_hub")} /> },
  product_health: { skeleton: "table", render: (c) => <ProductHealthPanel onBack={() => c.setActiveFlow("stocky_hub")} /> },
  order_sync: { render: (c) => <ShopifyOrderSync onBack={() => c.setActiveFlow("stocky_hub")} /> },
  image_optimise: { render: (c) => <ImageOptimisePanel onBack={back(c)} /> },
  stock_check: { render: (c) => <StockCheckFlow lineItems={[]} onBack={back(c)} onStartFlow={c.handleStartFlow} /> },
  stocktake_module: { render: (c) => <StocktakeModule onBack={back(c)} /> },
  transfer_orders: { render: (c) => <TransferOrderPanel onBack={back(c)} /> },
  reports_hub: { skeleton: "split", render: (c) => <ReportsHub onBack={back(c)} /> },
  supplier_profile_builder: { render: (c) => <SupplierProfileBuilder onBack={back(c)} onViewLearnedRules={() => c.setActiveFlow("supplier_intelligence")} /> },
  stock_adjustment: { render: (c) => <StockAdjustmentPanel onBack={back(c)} /> },
  inventory_view: { skeleton: "table", render: (c) => <InventoryView onBack={back(c)} /> },
  csv_seo: { render: (c) => <ShopifyCSVSEO onBack={back(c)} /> },
  stocky_dashboard: {
    skeleton: "split",
    render: (c) => (
      <StockyHomeDashboard
        onNavigate={(f) => c.safeSetFlow(f)}
        onSwitchToClassic={() => { c.setUseStockyDashboard(false); localStorage.setItem("stocky_dashboard_mode", "false"); c.setActiveFlow(null); }}
      />
    ),
  },
  pipeline: {
    skeleton: "wizard",
    render: (c) =>
      c.activePipelineId ? (
        <PipelineRunner
          pipelineId={c.activePipelineId}
          onRenderFlow={(flowKey, onComplete) => {
            const flowMap: Record<string, ReactNode> = {
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
            return (
              flowMap[flowKey] || (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  Flow "{flowKey}" — <button className="text-primary underline" onClick={onComplete}>Mark complete →</button>
                </div>
              )
            );
          }}
          onExit={() => { c.setActiveFlow(null); c.setActivePipelineId(null); }}
        />
      ) : (
        <div className="p-6 text-center text-sm text-muted-foreground">
          No pipeline selected.{" "}
          <button className="text-primary underline" onClick={() => c.setActiveFlow("pipeline_chooser")}>Choose a pipeline →</button>
        </div>
      ),
  },
  pipeline_chooser: {
    render: (c) => <PipelineChooser onSelect={(id) => { c.setActivePipelineId(id); c.setActiveFlow("pipeline"); }} onBack={back(c)} />,
  },
  supplier_intelligence: { render: (c) => <SupplierIntelligencePanel onBack={back(c)} onOpenInvoiceFlow={() => c.setActiveFlow("invoice")} /> },
  teach_invoice_tutorial: {
    skeleton: "wizard",
    render: (c) => (
      <TeachInvoiceTutorial
        onBack={back(c)}
        onStartInvoice={() => c.setActiveFlow("invoice")}
        onOpenSupplierIntelligence={() => c.setActiveFlow("supplier_intelligence")}
        onOpenCatalogMemory={() => c.setActiveFlow("catalog_memory")}
      />
    ),
  },
  processing_history: {
    skeleton: "table",
    render: (c) => (
      <ProcessingHistoryPanel
        onBack={() => { c.setActiveFlow(null); c.setHistoryPatternId(null); }}
        onOpenInvoiceFlow={() => c.setActiveFlow("invoice")}
        initialPatternId={c.historyPatternId ?? undefined}
      />
    ),
  },
  invoice_detail: {
    render: (c) =>
      c.historyPatternId ? (
        <InvoiceDetailScreen
          patternId={c.historyPatternId}
          onBack={() => { c.setActiveFlow(null); c.setHistoryPatternId(null); }}
          onResume={() => c.setActiveFlow("invoice")}
          onOpenHistory={(id) => { c.setHistoryPatternId(id); c.setActiveFlow("processing_history"); }}
        />
      ) : (
        <div className="p-6 text-center text-sm text-muted-foreground">No invoice selected.</div>
      ),
  },
  stock_reconciliation: {
    render: (c) =>
      c.reconciliationResult ? (
        <StockReconciliationPanel
          reconciliationResult={c.reconciliationResult as never}
          onBack={() => { c.setReconciliationResult(null); c.setActiveFlow("invoice"); }}
          onExport={(sets) => { c.setReconciliationResult(null); c.handleReconciliationExport(sets); }}
        />
      ) : (
        <div className="p-6 text-center text-sm text-muted-foreground">
          No reconciliation in progress.{" "}
          <button className="text-primary underline" onClick={() => c.setActiveFlow("invoice")}>Start an invoice →</button>
        </div>
      ),
  },
} satisfies Record<string, FlowEntry>;

export type FlowKey = keyof typeof FLOW_REGISTRY;

export const isFlowKey = (k: unknown): k is FlowKey =>
  typeof k === "string" && Object.prototype.hasOwnProperty.call(FLOW_REGISTRY, k);

// Single render dispatch — wraps in Suspense with the entry-specific skeleton.
export function renderFlow(flow: FlowKey | null, ctx: FlowContext): ReactNode {
  if (!flow) return null;
  const entry = FLOW_REGISTRY[flow];
  if (!entry) return null;
  const e = entry as FlowEntry;
  return <Suspense fallback={<FlowSkeleton variant={e.skeleton} />}>{e.render(ctx)}</Suspense>;
}
