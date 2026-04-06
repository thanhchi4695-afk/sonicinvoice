import { FilePlus, Percent, ChevronRight, BarChart3, DollarSign, Monitor, FileText, Zap, Clock, TrendingUp, MapPin, RotateCcw, Users, X, ClipboardList, BookOpen, Mail, Link, Target, ScanLine, Sparkles, Bell } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { getRecentAuditEntries, formatRelativeTime } from "@/lib/audit-log";
import { getStockUpdatesCount } from "@/lib/inventory-sim";
import { getTotalCatalogProducts } from "@/lib/catalog-memory";
import { getUnprocessedInboxCount } from "@/components/EmailInboxPanel";
import { useStoreMode } from "@/hooks/use-store-mode";
import { getStoreLocations } from "@/components/AccountScreen";

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
}

const HomeScreen = ({ onStartInvoice, onStartSale, onStartRestock, onStartPriceAdjust, onStartOrderForm, onStartReorder, onStartSuppliers, onOpenAuditLog, onStartPurchaseOrders, onStartCatalogMemory, onStartEmailInbox, onStartCollabSEO, onStartGoogleAdsSetup, onStartMetaAdsSetup, onStartLightspeedConvert, onStartScanMode, onStartPerformance, onStartFeedOptimise, onStartFeedHealth, onStartGoogleColour, onStartGoogleAds, onStartStyleGrouping, onStartCompetitorIntel, onStartCollectionSEO, onStartGeoAgentic, onStartOrganicSEO, onStartMarginProtection, onStartMarkdownLadder, onStartStockMonitor, onStartSocialMedia }: HomeScreenProps) => {
  const mode = useStoreMode();

  const recentActivity = [
    {
      type: "invoice" as const,
      label: mode.isLightspeed ? "Lightspeed CSV downloaded — 18 products (Jantzen Mar26)" : "CSV exported — Jantzen Mar26 — 18 products",
      time: "2 days ago",
    },
    {
      type: "sale" as const,
      label: mode.isLightspeed ? "Ready to import to Lightspeed POS" : "Baku 30% off — 48 products",
      time: "5 days ago",
    },
  ];

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

      {/* Import Invoice Card */}
      <div className="bg-card rounded-lg border border-border p-5 mb-3">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <FilePlus className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">Import invoice</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Upload a supplier invoice and get a {mode.isLightspeed ? 'Lightspeed' : 'Shopify'}-ready product file in minutes.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">PDF · Excel · CSV · Word</p>
          </div>
        </div>
        <Button variant="teal" className="w-full mt-4 h-12 text-base" onClick={onStartInvoice}>
          Start <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Scan Mode AI Card */}
      <div className="bg-card rounded-lg border border-border p-5 mb-3">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <ScanLine className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">Scan Mode (AI)</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Scan or enter items quickly and build your product list in seconds.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">text · photo · barcode</p>
          </div>
        </div>
        <Button variant="teal" className="w-full mt-4 h-12 text-base" onClick={onStartScanMode}>
          Start <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Email Inbox Card */}
      <div className="bg-card rounded-lg border border-border p-5 mb-3">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <Mail className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold font-display">Email inbox</h2>
              {getUnprocessedInboxCount() > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-primary text-primary-foreground">{getUnprocessedInboxCount()}</span>
              )}
            </div>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Suppliers email invoices directly. Process them without uploading.
            </p>
          </div>
        </div>
        <Button variant="outline" className="w-full mt-4 h-12 text-base" onClick={onStartEmailInbox}>
          Open inbox <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      <div className="bg-card rounded-lg border border-border p-5 mb-3">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-secondary/15 flex items-center justify-center shrink-0">
            <Percent className="w-5 h-5 text-secondary" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">Bulk sale pricing</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Put a collection on sale or restore original prices. Upload your {mode.isLightspeed ? 'Lightspeed' : 'Shopify'} export.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">Upload {mode.isLightspeed ? 'Lightspeed' : 'Shopify'} product export</p>
          </div>
        </div>
        <Button variant="amber" className="w-full mt-4 h-12 text-base" onClick={onStartSale}>
          Start <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Price Adjustment Card */}
      <div className="bg-card rounded-lg border border-border p-5 mb-3">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-success/15 flex items-center justify-center shrink-0">
            <DollarSign className="w-5 h-5 text-success" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">Price adjustment</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Apply bulk discounts, markups, or exact pricing to products. AI-powered or manual.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">% discount · markup · exact price · rounding</p>
          </div>
        </div>
        <Button variant="success" className="w-full mt-4 h-12 text-base" onClick={onStartPriceAdjust}>
          Start <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Restock Analytics Card */}
      <div className="bg-card rounded-lg border border-border p-5 mb-6">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-destructive/15 flex items-center justify-center shrink-0">
            <BarChart3 className="w-5 h-5 text-destructive" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">Restock analytics</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Find size holes and sold-out items. Generate JOOR reorder files instantly.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">Upload {mode.isLightspeed ? 'Lightspeed' : 'Shopify'} or JOOR inventory</p>
          </div>
        </div>
        <Button variant="outline" className="w-full mt-4 h-12 text-base border-destructive/30 text-destructive hover:bg-destructive/10" onClick={onStartRestock}>
          Start <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Purchase Orders Card */}
      <div className="bg-card rounded-lg border border-border p-5 mb-6">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <ClipboardList className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">Purchase orders</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Create POs before goods arrive, then match invoices to verify quantities and prices.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">Create · match · verify</p>
          </div>
        </div>
        <Button variant="outline" className="w-full mt-4 h-12 text-base" onClick={onStartPurchaseOrders}>
          View POs <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Order Form Card */}
      <div className="bg-card rounded-lg border border-border p-5 mb-6">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">Order forms</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Create professional wholesale order forms to send to your suppliers.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">PDF · CSV · email text</p>
          </div>
        </div>
        <Button variant="outline" className="w-full mt-4 h-12 text-base" onClick={onStartOrderForm}>
          Start <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Reorder Suggestions Card */}
      <div className="bg-card rounded-lg border border-border p-5 mb-6">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-secondary/15 flex items-center justify-center shrink-0">
            <RotateCcw className="w-5 h-5 text-secondary" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">Reorder suggestions</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              AI-powered reorder recommendations based on stock levels and order history.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">Low stock · due for reorder · seasonal</p>
          </div>
        </div>
        <Button variant="outline" className="w-full mt-4 h-12 text-base" onClick={onStartReorder}>
          View suggestions <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Supplier Performance Card */}
      <div className="bg-card rounded-lg border border-border p-5 mb-6">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">Supplier performance</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Track invoices, match rates, and cost history per supplier.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">Invoices · products · pricing trends</p>
          </div>
        </div>
        <Button variant="outline" className="w-full mt-4 h-12 text-base" onClick={onStartSuppliers}>
          View suppliers <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Catalog Memory Card */}
      <div className="bg-card rounded-lg border border-border p-5 mb-6">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <BookOpen className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">Catalog memory</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Upload supplier catalogs so future invoices match instantly — no web search needed.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">{getTotalCatalogProducts()} products learned</p>
          </div>
        </div>
        <Button variant="outline" className="w-full mt-4 h-12 text-base" onClick={onStartCatalogMemory}>
          Manage catalogs <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Google Feed Health Card */}
      <div className="bg-card rounded-lg border border-border p-5 mb-3">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-success/15 flex items-center justify-center shrink-0">
            <BarChart3 className="w-5 h-5 text-success" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">Google Feed Health</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Fix gender, age_group, and color for all products. Push metafields directly to Shopify.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">gender · age_group · color · metafields</p>
          </div>
        </div>
        <Button variant="success" className="w-full mt-4 h-12 text-base" onClick={onStartFeedHealth}>
          Scan store <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Google Colours Card */}
      <div className="bg-card rounded-lg border border-border p-5 mb-3">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <span className="text-lg">🎨</span>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">Google colours</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Auto-detect product colours for Google Shopping. Fix "Add missing colors" in Merchant Center.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">title parsing · variant · vision AI</p>
          </div>
        </div>
        <Button variant="teal" className="w-full mt-4 h-12 text-base" onClick={onStartGoogleColour}>
          Detect colours <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Google Ads Attributes Card */}
      <div className="bg-card rounded-lg border border-border p-5 mb-3">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-destructive/15 flex items-center justify-center shrink-0">
            <span className="text-lg">📢</span>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">Google Ads attributes</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Auto-detect age group and gender for every product. Fix disapproved ads in one export.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">age_group · gender · Matrixify CSV</p>
          </div>
        </div>
        <Button variant="outline" className="w-full mt-4 h-12 text-base border-destructive/30 text-destructive hover:bg-destructive/10" onClick={onStartGoogleAds}>
          Fix ads <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Style Grouping Card */}
      <div className="bg-card rounded-lg border border-border p-5 mb-3">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-secondary/15 flex items-center justify-center shrink-0">
            <span className="text-lg">🎨</span>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">Style grouping</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Link same-style products so customers can switch between colours on the product page.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">related_products · colour_label · Matrixify CSV</p>
          </div>
        </div>
        <Button variant="secondary" className="w-full mt-4 h-12 text-base" onClick={onStartStyleGrouping}>
          Group styles <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Collection SEO Card */}
      <div className="bg-card rounded-lg border border-border p-5 mb-3">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-warning/15 flex items-center justify-center shrink-0">
            <span className="text-lg">🗂</span>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">Collection SEO</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Turn every product name into rankable collection pages with internal links. Programmatic SEO from a single invoice.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">brand · print · type · internal links</p>
          </div>
        </div>
        <Button variant="outline" className="w-full mt-4 h-12 text-base border-warning/30 text-warning hover:bg-warning/10" onClick={onStartCollectionSEO}>
          Generate <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* GEO & Agentic Card */}
      <div className="bg-card rounded-lg border border-border p-5 mb-3">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <span className="text-lg">🤖</span>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">GEO & Agentic</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Get cited by AI. Get bought by AI agents. Optimise for ChatGPT, Perplexity, Google AI Mode, and UCP agentic commerce.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">answer capsules · schema · UCP · visibility</p>
          </div>
        </div>
        <Button className="w-full mt-4 h-12 text-base bg-gradient-to-r from-primary to-accent text-primary-foreground" onClick={onStartGeoAgentic}>
          Optimise <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Organic SEO Card */}
      <div className="bg-card rounded-lg border border-border p-5 mb-3">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <span className="text-lg">📈</span>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">Organic SEO</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Build topical authority. Generate blog posts that rank on Google and drive free traffic to your products.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">topic maps · blog posts · internal links · gap analysis</p>
          </div>
        </div>
        <Button className="w-full mt-4 h-12 text-base bg-primary text-primary-foreground" onClick={onStartOrganicSEO}>
          Build topic map <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Margin Protection Card */}
      <div className="bg-card rounded-lg border border-border p-5 mb-3">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-destructive/15 flex items-center justify-center shrink-0">
            <span className="text-lg">🛡️</span>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">Margin Protection</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Prevent selling below cost. Protect minimum margins across all pricing actions.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">real-time validation · bulk checks · audit trail</p>
          </div>
        </div>
        <Button variant="outline" className="w-full mt-4 h-12 text-base border-destructive/30 text-destructive hover:bg-destructive/10" onClick={onStartMarginProtection}>
          Review margins <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Markdown Ladder Card */}
      <div className="bg-card rounded-lg border border-border p-5 mb-3">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-warning/15 flex items-center justify-center shrink-0">
            <span className="text-lg">📉</span>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">Markdown Ladders</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Automatically reduce prices over time for slow-moving stock. Staged discounts with margin protection.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">staged discounts · dead stock · auto-pricing</p>
          </div>
        </div>
        <Button variant="outline" className="w-full mt-4 h-12 text-base border-warning/30 text-warning hover:bg-warning/10" onClick={onStartMarkdownLadder}>
          Manage ladders <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Stock Monitor Card */}
      <div className="bg-card rounded-lg border border-border p-5 mb-3">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <Bell className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">Stock Monitor</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Track ongoing styles in real time. Get alerts when any size drops below your reorder threshold.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">ongoing styles · reorder alerts · size tracking</p>
          </div>
        </div>
        <Button variant="outline" className="w-full mt-4 h-12 text-base border-primary/30 text-primary hover:bg-primary/10" onClick={onStartStockMonitor}>
          View alerts <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Social Media Card */}
      <div className="bg-card rounded-lg border border-border p-5 mb-3">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <span className="text-lg">📣</span>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">Social Media</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Auto-detect new arrivals, generate AI captions, and schedule posts to Facebook and Instagram.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">AI captions · drag-drop schedule · auto-detect</p>
          </div>
        </div>
        <Button variant="outline" className="w-full mt-4 h-12 text-base border-primary/30 text-primary hover:bg-primary/10" onClick={onStartSocialMedia}>
          Manage queue <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">Competitor Intel</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Spy on competitors and suppliers. Find collection gaps. Generate descriptions that outrank them.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">gap analysis · print stories · SEO descriptions</p>
          </div>
        </div>
        <Button variant="outline" className="w-full mt-4 h-12 text-base" onClick={onStartCompetitorIntel}>
          Research <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      <div className="bg-card rounded-lg border border-border p-5 mb-3">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">AI Feed Optimisation</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Generate Google Shopping attributes from product images — silhouette, neckline, pattern and more.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">product_detail · refinement filters · "About this product"</p>
          </div>
        </div>
        <Button variant="teal" className="w-full mt-4 h-12 text-base" onClick={onStartFeedOptimise}>
          Optimise feed <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Performance Dashboard Card */}
      <div className="bg-card rounded-lg border border-border p-5 mb-3">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <BarChart3 className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">Performance</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Track ROAS, spend, conversions, and pipeline activity for published products.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">ROAS · spend · conversions · funnel</p>
          </div>
        </div>
        <Button variant="outline" className="w-full mt-4 h-12 text-base" onClick={onStartPerformance}>
          View dashboard <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Google Ads Setup AI Card */}
      <div className="bg-card rounded-lg border border-border p-5 mb-3">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-success/15 flex items-center justify-center shrink-0">
            <TrendingUp className="w-5 h-5 text-success" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">Google Ads Setup AI</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Launch and scale profitable ads step-by-step. From zero to converting campaigns.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">search · shopping · performance max</p>
          </div>
        </div>
        <Button variant="success" className="w-full mt-4 h-12 text-base" onClick={onStartGoogleAdsSetup}>
          Start <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Meta Ads Setup AI Card */}
      <div className="bg-card rounded-lg border border-border p-5 mb-3">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <Target className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">Meta Ads Setup AI</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Facebook + Instagram ads — from zero to profitable campaigns with Advantage+.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">UGC · reels · advantage+ shopping</p>
          </div>
        </div>
        <Button variant="teal" className="w-full mt-4 h-12 text-base" onClick={onStartMetaAdsSetup}>
          Start <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Lightspeed → Shopify Converter Card */}
      <div className="bg-card rounded-lg border border-border p-5 mb-3">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">Lightspeed → Shopify</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Convert your Lightspeed product export to a Shopify-ready CSV. Barcodes mapped automatically where available.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">products · variants · barcodes · pricing</p>
          </div>
        </div>
        <Button variant="outline" className="w-full mt-4 h-12 text-base" onClick={onStartLightspeedConvert}>
          Convert file → <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Local Collab SEO Card */}
      <div className="bg-card rounded-lg border border-border p-5 mb-6">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <Link className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">Local collab SEO</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Write one blog post with local partners. Every store gets a backlink. Runs in 10 minutes.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">blog post · outreach emails · backlink tracker</p>
          </div>
        </div>
        <Button variant="teal" className="w-full mt-4 h-12 text-base" onClick={onStartCollabSEO}>
          Start campaign <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
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

      {/* Stat tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-card rounded-lg border border-border p-4 text-center">
          <p className="text-2xl font-bold font-display">3</p>
          <p className="text-xs text-muted-foreground mt-1">{mode.isLightspeed ? 'Lightspeed imports' : 'CSV exports'}</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-4 text-center">
          <p className="text-2xl font-bold font-display">84</p>
          <p className="text-xs text-muted-foreground mt-1">{mode.isLightspeed ? 'Products ready' : 'Products imported'}</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-4 text-center">
          <p className="text-2xl font-bold font-display">{getStockUpdatesCount()}</p>
          <p className="text-xs text-muted-foreground mt-1">📦 Stock updates</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-4 text-center cursor-pointer hover:border-primary/30 transition-colors" onClick={onStartCatalogMemory}>
          <p className="text-2xl font-bold font-display">{getTotalCatalogProducts()}</p>
          <p className="text-xs text-muted-foreground mt-1">📚 Catalog products</p>
          <p className="text-[9px] text-muted-foreground/60 mt-0.5">More catalogs = faster matching</p>
        </div>
      </div>

      {/* Performance metrics card */}
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
          <div className="bg-card rounded-lg border border-border p-4 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">Performance</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-lg font-bold font-display">{avgTime < 60 ? `${avgTime}s` : `${Math.floor(avgTime / 60)}m ${avgTime % 60}s`}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Avg processing<br/>per invoice</p>
              </div>
              <div>
                <p className="text-lg font-bold font-display text-success">{avgMatch}%</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Avg match rate<br/>this month</p>
              </div>
              <div>
                <p className="text-lg font-bold font-display text-primary">{savedHours}h</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Total saved<br/>vs manual</p>
              </div>
            </div>

            {/* Time saved detail */}
            <div className="bg-muted/50 rounded-lg p-3 mt-3 text-xs">
              <p className="font-semibold mb-1.5 flex items-center gap-1"><Clock className="w-3 h-3" /> How much time has Sonic Invoice saved you?</p>
              <div className="grid grid-cols-2 gap-y-1 text-muted-foreground">
                <span>Invoices processed:</span><span className="font-mono-data text-foreground">{totalInvoices}</span>
                <span>Total product lines:</span><span className="font-mono-data text-foreground">{totalLines}</span>
                <span>Manual time estimate:</span><span className="font-mono-data text-foreground">~{Math.round(manualMinutes / 60)}h</span>
                <span>Sonic Invoice time:</span><span className="font-mono-data text-foreground">~{(totalProcTime / 60).toFixed(0)}m</span>
                <span>Time saved:</span><span className="font-mono-data text-success font-semibold">~{savedHours} hours ✅</span>
              </div>
              <p className="text-[10px] text-muted-foreground/70 mt-2">Based on 8 min/product for manual entry (industry average for fashion boutiques)</p>
            </div>
          </div>
        );
      })()}

      {/* Recent Activity — from audit log */}
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Recent activity</h3>
      {(() => {
        const auditEntries = getRecentAuditEntries(5);
        if (auditEntries.length === 0) {
          return (
            <div className="space-y-2">
              {recentActivity.map((item, i) => (
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
                <ClipboardList className="w-3 h-3" /> View full log →
              </button>
            )}
          </div>
        );
      })()}
    </div>
  );
};

export default HomeScreen;
