import { ChevronRight, X, Monitor, ClipboardList, Mail, MapPin, Zap, Clock } from "lucide-react";
import { useState, useCallback } from "react";
import ContextDetector from "@/components/ContextDetector";
import { Button } from "@/components/ui/button";
import { getRecentAuditEntries, formatRelativeTime } from "@/lib/audit-log";
import { getStockUpdatesCount } from "@/lib/inventory-sim";
import { getTotalCatalogProducts } from "@/lib/catalog-memory";
import { getUnprocessedInboxCount } from "@/components/EmailInboxPanel";
import { useStoreMode } from "@/hooks/use-store-mode";
import { getStoreLocations } from "@/components/AccountScreen";
import FeatureTile from "@/components/FeatureTile";
import CollapsibleSection from "@/components/CollapsibleSection";
import { getPipelineContext, clearPipelineContext } from "@/lib/pipeline-context";
import { getPipelineById } from "@/lib/pipeline-definitions";

interface HomeScreenProps {
  onStartInvoice: () => void;
  onStartSale: () => void;
  onStartRestock: () => void;
  onStartPriceAdjust: () => void;
  onStartOrderForm: () => void;
  onStartReorder: () => void;
  onStartSuppliers?: () => void;
  onOpenAuditLog?: () => void;
  onStartPurchaseOrders?: () => void;
  onStartCatalogMemory?: () => void;
  onStartEmailInbox?: () => void;
  onStartCollabSEO?: () => void;
  onStartGoogleAdsSetup?: () => void;
  onStartMetaAdsSetup?: () => void;
  onStartLightspeedConvert?: () => void;
  onStartScanMode?: () => void;
  onStartPerformance?: () => void;
  onStartFeedOptimise?: () => void;
  onStartFeedHealth?: () => void;
  onStartGoogleColour?: () => void;
  onStartGoogleAds?: () => void;
  onStartStyleGrouping?: () => void;
  onStartCompetitorIntel?: () => void;
  onStartCollectionSEO?: () => void;
  onStartGeoAgentic?: () => void;
  onStartOrganicSEO?: () => void;
  onStartMarginProtection?: () => void;
  onStartMarkdownLadder?: () => void;
  onStartStockMonitor?: () => void;
  onStartSocialMedia?: () => void;
  onStartInventoryPlanning?: () => void;
  onStartStockyHub?: () => void;
  onStartPackingSlip?: () => void;
  onStartJoor?: () => void;
  onStartWholesaleImport?: () => void;
  onStartLookbookImport?: () => void;
  onStartAccounting?: () => void;
  onStartProfitLoss?: () => void;
  onStartImageOptimise?: () => void;
  onStartStockCheck?: () => void;
  onStartPriceLookup?: () => void;
  onStartSeasons?: () => void;
  onNavigateToTab?: (tab: string) => void;
  onStartPipeline?: (id: string) => void;
  onStartPipelineChooser?: () => void;
  onStartStockyOnboarding?: () => void;
  onStartSupplierProfileBuilder?: () => void;
}

const HomeScreen = ({
  onStartInvoice, onStartSale, onStartRestock, onStartPriceAdjust, onStartOrderForm,
  onStartReorder, onStartSuppliers, onOpenAuditLog, onStartPurchaseOrders, onStartCatalogMemory,
  onStartEmailInbox, onStartCollabSEO, onStartGoogleAdsSetup, onStartMetaAdsSetup,
  onStartLightspeedConvert, onStartScanMode, onStartPerformance, onStartFeedOptimise,
  onStartFeedHealth, onStartGoogleColour, onStartGoogleAds, onStartStyleGrouping,
  onStartCompetitorIntel, onStartCollectionSEO, onStartGeoAgentic, onStartOrganicSEO,
  onStartMarginProtection, onStartMarkdownLadder, onStartStockMonitor, onStartSocialMedia,
  onStartInventoryPlanning, onStartStockyHub, onStartPackingSlip, onStartJoor,
  onStartWholesaleImport, onStartLookbookImport, onStartAccounting, onStartProfitLoss,
  onStartImageOptimise, onStartStockCheck, onStartPriceLookup, onStartSeasons, onNavigateToTab,
  onStartPipeline, onStartPipelineChooser, onStartStockyOnboarding,
  onStartSupplierProfileBuilder,
}: HomeScreenProps) => {
  const mode = useStoreMode();
  const unreadCount = getUnprocessedInboxCount();

  // Check for incomplete onboarding
  const onboardingStep = localStorage.getItem("onboarding_step");
  const onboardingComplete = localStorage.getItem("onboarding_complete") === "true";
  const showResumeBanner = !onboardingComplete && onboardingStep && parseInt(onboardingStep) < 5;

  const [bannerDismissed, setBannerDismissed] = useState(() => localStorage.getItem("shopify_app_store_banner_dismissed") === "true");

  const dismissBanner = () => {
    setBannerDismissed(true);
    localStorage.setItem("shopify_app_store_banner_dismissed", "true");
  };

  return (
    <div className="px-4 pt-2 pb-24 animate-fade-in">
      {/* Shopify App Store waitlist banner */}
      {!bannerDismissed && (
        <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 mb-4 flex items-start gap-3">
          <span className="text-lg shrink-0">🛍</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Sonic Invoice is coming to the Shopify App Store.</p>
            <p className="text-xs text-muted-foreground mt-0.5">Install directly from Shopify for automatic connection and one-click setup.</p>
            <button className="text-xs text-primary font-medium mt-1.5 hover:underline">Join the waitlist →</button>
          </div>
          <button onClick={dismissBanner} className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <h1 className="text-2xl font-bold font-display mb-1">Sonic Invoice</h1>
      <p className="text-muted-foreground text-sm mb-4">
        {mode.isLightspeed
          ? `Invoice → ${mode.targetPlatform} in minutes`
          : "Invoice → Shopify in minutes"}
      </p>

      {/* Onboarding resume banner */}
      {showResumeBanner && (
        <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm">📋</span>
            <span className="text-xs font-medium">Complete your setup (Step {onboardingStep} of 5)</span>
          </div>
          <Button variant="link" size="sm" className="text-xs h-auto p-0" onClick={() => {
            localStorage.removeItem("onboarding_complete");
            window.location.reload();
          }}>
            Continue →
          </Button>
        </div>
      )}

      {/* Switching from Stocky banner */}
      {localStorage.getItem("stocky_onboarding_done") !== "true" && (
        <div className="bg-card border border-border rounded-lg p-3 mb-4 flex items-center gap-3">
          <span className="text-lg shrink-0">📦</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Switching from Stocky?</p>
            <p className="text-xs text-muted-foreground">Import your data and see what Sonic adds on top.</p>
          </div>
          <Button variant="outline" size="sm" className="text-xs shrink-0" onClick={onStartStockyOnboarding}>
            Start →
          </Button>
        </div>
      )}

      {/* Context-aware smart suggestions */}
      <div className="mb-4">
        <ContextDetector onStartFlow={(flow) => {
          const flowMap: Record<string, (() => void) | undefined> = {
            invoice: onStartInvoice,
            stock_check: onStartStockCheck,
            joor: onStartJoor,
            wholesale_import: onStartWholesaleImport,
            lookbook_import: onStartLookbookImport,
            supplier_profile: onStartSupplierProfileBuilder,
            accounting: onStartAccounting,
            gdrive_import: onStartSupplierProfileBuilder,
            collection_builder: onStartCollectionSEO,
            quick_capture: onStartScanMode,
            email_forward: onStartEmailInbox,
          };
          flowMap[flow]?.();
        }} />
      </div>

      {/* Lightspeed workflow card */}
      {mode.isLightspeed && (
        <div className="bg-card rounded-lg border border-purple-500/20 p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Monitor className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-semibold">Your workflow</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-muted/50 rounded-lg p-2.5 text-center">
              <span className="text-base block mb-0.5">📄</span>
              <span className="font-medium">1. Upload invoice</span>
            </div>
            <div className="bg-muted/50 rounded-lg p-2.5 text-center">
              <span className="text-base block mb-0.5">✨</span>
              <span className="font-medium">2. AI enrich</span>
            </div>
            <div className="bg-muted/50 rounded-lg p-2.5 text-center">
              <span className="text-base block mb-0.5">📥</span>
              <span className="font-medium">3. Export to {mode.exportLabel}</span>
            </div>
            <div className="bg-muted/50 rounded-lg p-2.5 text-center">
              <span className="text-base block mb-0.5">🖥️</span>
              <span className="font-medium">4. Import to Lightspeed</span>
              {mode.isLightspeedShopify && (
                <span className="text-muted-foreground block text-[10px]">(syncs to Shopify auto)</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pipeline resume banner */}
      {(() => {
        const pCtx = getPipelineContext();
        if (!pCtx || pCtx.currentStep >= (getPipelineById(pCtx.pipelineId)?.steps.length ?? 0)) return null;
        const pl = getPipelineById(pCtx.pipelineId);
        if (!pl) return null;
        const stepLabel = pl.steps[pCtx.currentStep]?.label ?? "";
        return (
          <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm">{pl.emoji}</span>
              <div className="min-w-0">
                <span className="text-xs font-medium block truncate">{pl.name} — step {pCtx.currentStep + 1} of {pl.steps.length}</span>
                <span className="text-[10px] text-muted-foreground">You were on: {stepLabel}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="link" size="sm" className="text-xs h-auto p-0" onClick={() => onStartPipeline?.(pCtx.pipelineId)}>Resume →</Button>
              <button onClick={() => { clearPipelineContext(); window.location.reload(); }} className="text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        );
      })()}

      {/* Automation pipelines card */}
      <div className="bg-card border border-border rounded-xl p-4 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Automation pipelines</span>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">
          Go from invoice to live products, SEO, and social posts in one guided sequence
        </p>
        <div className="flex flex-wrap gap-1.5 mb-2">
          <Button variant="outline" size="sm" className="text-[11px] h-7" onClick={() => onStartPipeline?.("new_arrivals_full")}>📦 New arrivals</Button>
          <Button variant="outline" size="sm" className="text-[11px] h-7" onClick={() => onStartPipeline?.("restock_only")}>🔄 Restock</Button>
          <Button variant="outline" size="sm" className="text-[11px] h-7" onClick={() => onStartPipeline?.("seo_visibility")}>📈 SEO boost</Button>
        </div>
        <button onClick={onStartPipelineChooser} className="text-[11px] text-primary hover:underline">View all pipelines →</button>
      </div>

      {/* ── HERO ACTIONS ── */}
      <div className="space-y-2 mb-4">
        <button
          onClick={onStartInvoice}
          className="w-full h-14 bg-primary text-primary-foreground rounded-xl flex items-center gap-3 px-4 hover:bg-primary/90 transition-colors"
        >
          <span className="text-xl">📄</span>
          <div className="flex-1 text-left">
            <p className="text-sm font-semibold">Process invoice</p>
            <p className="text-[11px] opacity-80">Upload & convert to Shopify products</p>
          </div>
          <ChevronRight className="w-4 h-4 opacity-60" />
        </button>
        <button
          onClick={onStartStockCheck}
          className="w-full h-14 bg-card border border-primary/40 rounded-xl flex items-center gap-3 px-4 hover:bg-primary/10 transition-colors"
        >
          <span className="text-xl">🔍</span>
          <div className="flex-1 text-left">
            <p className="text-sm font-semibold text-foreground">Stock check</p>
            <p className="text-[11px] text-muted-foreground">Detect refills, new colours & products</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </button>
        <button
          onClick={onStartEmailInbox}
          className="w-full h-14 bg-card border border-border rounded-xl flex items-center gap-3 px-4 hover:bg-primary/10 transition-colors relative"
        >
          <span className="text-xl">📧</span>
          <div className="flex-1 text-left">
            <p className="text-sm font-semibold text-foreground">Email inbox</p>
            <p className="text-[11px] text-muted-foreground">Process supplier invoices from email</p>
          </div>
          {unreadCount > 0 && (
            <span className="bg-primary text-primary-foreground text-[10px] rounded-full px-1.5 min-w-[18px] text-center font-semibold">
              {unreadCount}
            </span>
          )}
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      {/* ── STATS ROW ── */}
      <div className="flex gap-2 mb-4">
        <div className="flex-1 bg-card rounded-lg border border-border px-3 py-2 text-center">
          <p className="text-lg font-bold font-display">84</p>
          <p className="text-[10px] text-muted-foreground">{mode.isLightspeed ? 'Products ready' : 'Products imported'}</p>
        </div>
        <div className="flex-1 bg-card rounded-lg border border-border px-3 py-2 text-center">
          <p className="text-lg font-bold font-display">{getStockUpdatesCount()}</p>
          <p className="text-[10px] text-muted-foreground">Stock updates</p>
        </div>
        <div className="flex-1 bg-card rounded-lg border border-border px-3 py-2 text-center cursor-pointer hover:border-primary/30 transition-colors" onClick={onStartCatalogMemory}>
          <p className="text-lg font-bold font-display">{getTotalCatalogProducts()}</p>
          <p className="text-[10px] text-muted-foreground">Catalog</p>
        </div>
      </div>

      {/* Stock by Location */}
      {(() => {
        const locs = getStoreLocations();
        if (locs.length <= 1) return null;
        const mockStock = [
          { products: 47, units: 312, lastUpdated: "Today" },
          { products: 23, units: 189, lastUpdated: "28 Mar 2026" },
          { products: 12, units: 67, lastUpdated: "25 Mar 2026" },
          { products: 8, units: 42, lastUpdated: "20 Mar 2026" },
        ];
        return (
          <div className="bg-card rounded-lg border border-border p-4 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">Stock by location</span>
            </div>
            <div className="space-y-2">
              {locs.map((loc, i) => {
                const data = mockStock[i % mockStock.length];
                return (
                  <div key={loc.id} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <MapPin className="w-3 h-3 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{loc.name}</p>
                        <p className="text-[10px] text-muted-foreground">{data.products} products · {data.units} units</p>
                      </div>
                    </div>
                    <span className="text-[10px] text-muted-foreground font-mono-data shrink-0">{data.lastUpdated}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── QUICK ACCESS GRID ── */}
      <CollapsibleSection title="Invoices & Stock" icon="📦" defaultOpen>
        <FeatureTile icon="📄" label="Import invoice" onClick={onStartInvoice} highlight />
        <FeatureTile icon="📦" label="Packing slip" onClick={onStartPackingSlip} />
        <FeatureTile icon="📷" label="Scan mode" onClick={onStartScanMode} />
        <FeatureTile icon="🔍" label="Stock check" onClick={onStartStockCheck} highlight />
        <FeatureTile icon="🔗" label="JOOR" onClick={onStartJoor} />
        <FeatureTile icon="📥" label="Wholesale import" onClick={onStartWholesaleImport} />
        <FeatureTile icon="📸" label="Lookbook import" onClick={onStartLookbookImport} />
        <FeatureTile icon="📋" label="Purchase orders" onClick={onStartPurchaseOrders} />
        <FeatureTile icon="📝" label="Order forms" onClick={onStartOrderForm} />
        <FeatureTile icon="💼" label="Accounting push" onClick={onStartAccounting} />
      </CollapsibleSection>

      <CollapsibleSection title="Inventory & Pricing" icon="💰">
        <FeatureTile icon="🏭" label="Inventory hub" onClick={onStartStockyHub} />
        <FeatureTile icon="🔔" label="Stock monitor" onClick={onStartStockMonitor} />
        <FeatureTile icon="📊" label="Restock analytics" onClick={onStartRestock} />
        <FeatureTile icon="🔄" label="Reorder suggestions" onClick={onStartReorder} />
        <FeatureTile icon="💲" label="Price adjustment" onClick={onStartPriceAdjust} />
        <FeatureTile icon="🏷️" label="Bulk sale" onClick={onStartSale} />
        <FeatureTile icon="🛡️" label="Margin protection" onClick={onStartMarginProtection} />
        <FeatureTile icon="📉" label="Markdown ladders" onClick={onStartMarkdownLadder} />
        <FeatureTile icon="📈" label="P&L" onClick={onStartProfitLoss} />
        <FeatureTile icon="👥" label="Supplier performance" onClick={onStartSuppliers || (() => {})} />
        <FeatureTile icon="🗓️" label="Seasons" onClick={onStartSeasons || (() => {})} />
      </CollapsibleSection>

      <CollapsibleSection title="Marketing & SEO" icon="📢">
        <FeatureTile icon="💚" label="Feed health" onClick={onStartFeedHealth} />
        <FeatureTile icon="✨" label="AI feed optimisation" onClick={onStartFeedOptimise} />
        <FeatureTile icon="🎨" label="Google colours" onClick={onStartGoogleColour} />
        <FeatureTile icon="📢" label="Google Ads attributes" onClick={onStartGoogleAds} />
        <FeatureTile icon="🚀" label="Google Ads setup" onClick={onStartGoogleAdsSetup} />
        <FeatureTile icon="📱" label="Meta Ads setup" onClick={onStartMetaAdsSetup} />
        <FeatureTile icon="📊" label="Performance" onClick={onStartPerformance} />
        <FeatureTile icon="📈" label="Organic SEO" onClick={onStartOrganicSEO} />
        <FeatureTile icon="🗂️" label="Collection SEO" onClick={onStartCollectionSEO} />
        <FeatureTile icon="🤖" label="GEO & Agentic" onClick={onStartGeoAgentic} />
        <FeatureTile icon="🤝" label="Collab SEO" onClick={onStartCollabSEO} />
        <FeatureTile icon="🔎" label="Competitor intel" onClick={onStartCompetitorIntel} />
        <FeatureTile icon="📣" label="Social media" onClick={onStartSocialMedia} />
      </CollapsibleSection>

      <CollapsibleSection title="Tools" icon="🔧">
        <FeatureTile icon="🏷️" label="Tag builder" onClick={() => onNavigateToTab?.("tools")} />
        <FeatureTile icon="✍️" label="SEO writer" onClick={() => onNavigateToTab?.("tools")} />
        <FeatureTile icon="🔍" label="Price lookup" onClick={onStartPriceLookup || (() => onNavigateToTab?.("tools"))} />
        <FeatureTile icon="📖" label="Brand reference" onClick={() => onNavigateToTab?.("tools")} />
        <FeatureTile icon="📤" label="Export collections" onClick={() => onNavigateToTab?.("tools")} />
        <FeatureTile icon="📥" label="Import collections" onClick={() => onNavigateToTab?.("tools")} />
        <FeatureTile icon="🤖" label="Auto collections AI" onClick={() => onNavigateToTab?.("tools")} />
        <FeatureTile icon="🖼️" label="Image optimisation" onClick={onStartImageOptimise || (() => {})} />
        <FeatureTile icon="📚" label="Catalog memory" onClick={onStartCatalogMemory || (() => {})} />
        <FeatureTile icon="🧬" label="Supplier profile builder" onClick={onStartSupplierProfileBuilder || (() => {})} />
        <FeatureTile icon="⚙️" label="AI instructions" onClick={() => onNavigateToTab?.("tools")} />
        <FeatureTile icon="📋" label="Audit log" onClick={onOpenAuditLog || (() => {})} />
      </CollapsibleSection>

      {/* ── PERFORMANCE METRICS ── */}
      {(() => {
        const history: { lines: number; processingTime: number; matchRate: number }[] = (() => {
          try { return JSON.parse(localStorage.getItem("processing_history") || "[]"); } catch { return []; }
        })();
        const totalInvoices = history.length || 3;
        const totalLines = history.reduce((s, h) => s + (h.lines || 0), 0) || 84;
        const totalProcTime = history.reduce((s, h) => s + (h.processingTime || 0), 0) || 312;
        const avgTime = Math.round(totalProcTime / Math.max(totalInvoices, 1));
        const avgMatch = Math.round(history.reduce((s, h) => s + (h.matchRate || 94), 0) / Math.max(totalInvoices, 1)) || 94;
        const manualMinutes = totalLines * 8;
        const savedMinutes = manualMinutes - Math.round(totalProcTime / 60);
        const savedHours = (savedMinutes / 60).toFixed(1);

        return (
          <div className="bg-card rounded-lg border border-border p-4 mb-4 mt-4">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">Performance</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-lg font-bold font-display">{avgTime < 60 ? `${avgTime}s` : `${Math.floor(avgTime / 60)}m ${avgTime % 60}s`}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Avg processing</p>
              </div>
              <div>
                <p className="text-lg font-bold font-display text-success">{avgMatch}%</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Match rate</p>
              </div>
              <div>
                <p className="text-lg font-bold font-display text-primary">{savedHours}h</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Time saved</p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── RECENT ACTIVITY ── */}
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Recent activity</h3>
      {(() => {
        const auditEntries = getRecentAuditEntries(3);
        const fallbackActivity = [
          { type: "invoice" as const, label: mode.isLightspeed ? "Lightspeed CSV downloaded — 18 products" : "CSV exported — Jantzen Mar26 — 18 products", time: "2 days ago" },
          { type: "sale" as const, label: mode.isLightspeed ? "Ready to import to Lightspeed POS" : "Baku 30% off — 48 products", time: "5 days ago" },
        ];

        if (auditEntries.length === 0) {
          return (
            <div className="space-y-2">
              {fallbackActivity.map((item, i) => (
                <div key={i} className="flex items-center gap-3 bg-card rounded-lg border border-border px-4 py-3">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${item.type === "invoice" ? "bg-primary/15 text-primary" : "bg-secondary/15 text-secondary"}`}>
                    {item.type === "invoice" ? "Invoice" : "Sale"}
                  </span>
                  <span className="text-sm flex-1 truncate">{item.label}</span>
                  <span className="text-xs text-muted-foreground font-mono-data">{item.time}</span>
                </div>
              ))}
            </div>
          );
        }
        return (
          <div className="space-y-1.5">
            {auditEntries.map((entry, i) => (
              <div key={`${entry.timestamp}-${i}`} className="flex items-center gap-2 bg-card rounded-lg border border-border px-3 py-2.5">
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                  {entry.action}
                </span>
                <span className="text-xs flex-1 truncate text-foreground/80">{entry.detail}</span>
                <span className="text-[10px] text-muted-foreground font-mono-data shrink-0">{formatRelativeTime(entry.timestamp)}</span>
              </div>
            ))}
            {onOpenAuditLog && (
              <button onClick={onOpenAuditLog} className="flex items-center gap-1 text-xs text-primary mt-2 hover:underline">
                <ClipboardList className="w-3 h-3" /> View all →
              </button>
            )}
          </div>
        );
      })()}
    </div>
  );
};

export default HomeScreen;
