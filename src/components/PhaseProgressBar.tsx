import { useMemo } from "react";
import { Check, ChevronRight, Settings2, FileText, Search, Package, DollarSign, Upload, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

export type PhaseId = "setup" | "capture" | "review" | "catalog" | "price" | "publish" | "analyse";

export interface Phase {
  id: PhaseId;
  num: number;
  label: string;
  shortLabel: string;
  icon: React.ElementType;
  description: string;
  /** primary tab/flow to navigate to when clicked */
  target: { type: "tab" | "flow"; id: string };
}

export const PHASES: Phase[] = [
  { id: "capture",  num: 1, label: "Capture",       shortLabel: "Capture",  icon: FileText,  description: "Upload invoice / scan goods", target: { type: "flow", id: "invoice" } },
  { id: "review",   num: 2, label: "Review & Sync", shortLabel: "Review",   icon: Search,    description: "Verify lines & sync to catalog", target: { type: "flow", id: "invoice" } },
  { id: "catalog",  num: 3, label: "Enrich",        shortLabel: "Enrich",   icon: Package,   description: "Names, images, SEO, descriptions", target: { type: "flow", id: "invoice" } },
  { id: "price",    num: 4, label: "Price",         shortLabel: "Price",    icon: DollarSign,description: "RRP, margins, markdowns", target: { type: "flow", id: "price_adjust" } },
  { id: "publish",  num: 5, label: "Publish",       shortLabel: "Publish",  icon: Upload,    description: "Push to Shopify / Lightspeed / CSV", target: { type: "flow", id: "invoice" } },
  { id: "analyse",  num: 6, label: "Analyse",       shortLabel: "Analyse",  icon: BarChart3, description: "Reports, restock, performance", target: { type: "tab", id: "analytics" } },
];

/** Maps tab/flow IDs → which phase they belong to */
const PHASE_MAP: Record<string, PhaseId> = {
  // Capture
  invoice: "capture",
  scan_mode: "capture",
  packing_slip: "capture",
  email_inbox: "capture",
  joor: "capture",
  wholesale_import: "capture",
  lookbook_import: "capture",
  order_form: "capture",
  // Review
  catalog_memory: "review",
  supplier_intelligence: "review",
  stock_check: "review",
  reconciliation: "review",
  // Enrich (catalog)
  product_descriptions: "catalog",
  smart_naming: "catalog",
  image_optimise: "catalog",
  collection_seo: "catalog",
  collab_seo: "catalog",
  organic_seo: "catalog",
  geo_agentic: "catalog",
  style_grouping: "catalog",
  shopify_csv_seo: "catalog",
  // Price
  price_adjust: "price",
  price_lookup: "price",
  price_match: "price",
  margin_protection: "price",
  markdown_ladder: "price",
  competitor_intel: "price",
  sale: "price",
  // Publish
  google_ads_setup: "publish",
  meta_ads_setup: "publish",
  ai_feed_optimise: "publish",
  feed_health: "publish",
  google_ads: "publish",
  social_media: "publish",
  lightspeed_convert: "publish",
  // Analyse
  analytics: "analyse",
  reports_hub: "analyse",
  restock: "analyse",
  performance: "analyse",
  profit_loss: "analyse",
  product_health: "analyse",
  stock_monitor: "analyse",
  inventory_planning: "analyse",
  history: "analyse",
  processing_history: "analyse",
};

interface PhaseProgressBarProps {
  activeTab: string;
  activeFlow: string | null;
  onNavigate: (target: { type: "tab" | "flow"; id: string }) => void;
}

const PhaseProgressBar = ({ activeTab, activeFlow, onNavigate }: PhaseProgressBarProps) => {
  const currentId: string = activeFlow || activeTab;
  const currentPhase = useMemo<PhaseId | null>(() => PHASE_MAP[currentId] ?? null, [currentId]);
  const currentIndex = currentPhase ? PHASES.findIndex(p => p.id === currentPhase) : -1;

  return (
    <div className="border-b border-border bg-card/40 backdrop-blur-sm sticky top-0 z-30">
      <div className="px-3 lg:px-4 py-2">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin">
          {PHASES.map((phase, idx) => {
            const Icon = phase.icon;
            const isActive = idx === currentIndex;
            const isComplete = currentIndex >= 0 && idx < currentIndex;
            const isUpcoming = currentIndex >= 0 && idx > currentIndex;

            return (
              <div key={phase.id} className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => onNavigate(phase.target)}
                  title={phase.description}
                  className={cn(
                    "group flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all",
                    isActive && "bg-primary text-primary-foreground shadow-sm",
                    isComplete && "text-primary hover:bg-primary/10",
                    isUpcoming && "text-muted-foreground hover:text-foreground hover:bg-muted",
                    currentIndex < 0 && "text-muted-foreground hover:text-foreground hover:bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold shrink-0",
                      isActive && "bg-primary-foreground text-primary",
                      isComplete && "bg-primary text-primary-foreground",
                      (isUpcoming || currentIndex < 0) && "bg-muted text-muted-foreground border border-border",
                    )}
                  >
                    {isComplete ? <Check className="w-3 h-3" /> : phase.num}
                  </span>
                  <Icon className="w-3.5 h-3.5 hidden sm:inline-block shrink-0" />
                  <span className="whitespace-nowrap">{phase.shortLabel}</span>
                </button>
                {idx < PHASES.length - 1 && (
                  <ChevronRight className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                )}
              </div>
            );
          })}
        </div>
        {currentPhase && (
          <p className="text-[10px] text-muted-foreground mt-1 px-1 hidden lg:block">
            <span className="font-semibold text-foreground">Phase {PHASES[currentIndex].num}: {PHASES[currentIndex].label}</span>
            {" — "}{PHASES[currentIndex].description}
          </p>
        )}
      </div>
    </div>
  );
};

export default PhaseProgressBar;
