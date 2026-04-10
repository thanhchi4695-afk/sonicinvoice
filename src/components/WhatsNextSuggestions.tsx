import { ChevronRight } from "lucide-react";

interface Suggestion {
  emoji: string;
  label: string;
  description: string;
  flow: string;
}

interface WhatsNextProps {
  completedFlow: string;
  context?: {
    hasNewProducts?: boolean;
    hasNewVariants?: boolean;
    hasRefills?: boolean;
    brandCount?: number;
    supplier?: string;
  };
  onStartFlow: (flow: string) => void;
  onStartPipeline?: (id: string) => void;
  onGoHome: () => void;
}

const SUGGESTION_MAP: Record<string, Suggestion[]> = {
  invoice: [
    { emoji: "🔍", label: "Check stock before pushing", description: "Detect refills vs new products", flow: "stock_check" },
    { emoji: "🖼", label: "Optimise images", description: "Auto-generate alt text", flow: "image_optimise" },
    { emoji: "🗂️", label: "Generate collection SEO pages", description: "SEO for brands in this invoice", flow: "collection_seo" },
    { emoji: "💼", label: "Push invoice to accounting", description: "Send to Xero or MYOB", flow: "accounting" },
  ],
  stock_check: [
    { emoji: "🖼", label: "Optimise images for new products", description: "Alt text & filenames", flow: "image_optimise" },
    { emoji: "💚", label: "Fix Google Shopping attributes", description: "Gender, age_group, colour", flow: "feed_health" },
    { emoji: "📣", label: "Generate social posts", description: "AI captions for new arrivals", flow: "social_media" },
  ],
  shopify_push: [
    { emoji: "🖼", label: "Generate alt text + SEO", description: "Image optimisation", flow: "image_optimise" },
    { emoji: "💚", label: "Fix Google Feed Health", description: "Shopping attributes", flow: "feed_health" },
    { emoji: "🗂️", label: "Create collection SEO pages", description: "For new brands & types", flow: "collection_seo" },
    { emoji: "📣", label: "Schedule social posts", description: "New arrivals captions", flow: "social_media" },
  ],
  feed_health: [
    { emoji: "✨", label: "Optimise AI feed attributes", description: "Product detail from images", flow: "feed_optimise" },
    { emoji: "🚀", label: "Launch Google Ads", description: "Shopping campaign setup", flow: "google_ads_setup" },
    { emoji: "🎨", label: "Fix colour attributes", description: "Google colour mapping", flow: "google_colour" },
  ],
  collection_seo: [
    { emoji: "📈", label: "Build topic map + blog posts", description: "Organic SEO content", flow: "organic_seo" },
    { emoji: "🤖", label: "Optimise for AI citations", description: "ChatGPT, Perplexity, AI Mode", flow: "geo_agentic" },
    { emoji: "🤝", label: "Set up collab backlinks", description: "Local partner blog post", flow: "collab_seo" },
  ],
  organic_seo: [
    { emoji: "🤖", label: "Optimise for AI citations", description: "GEO & Agentic SEO", flow: "geo_agentic" },
    { emoji: "🚀", label: "Launch Google Ads", description: "Shopping campaign", flow: "google_ads_setup" },
  ],
  social_media: [
    { emoji: "📱", label: "Launch Meta Ads", description: "Facebook + Instagram ads", flow: "meta_ads_setup" },
    { emoji: "📊", label: "Track performance", description: "ROAS and conversions", flow: "performance" },
  ],
  markdown_ladder: [
    { emoji: "🛡️", label: "Check margin protection", description: "No markdown below cost", flow: "margin_protection" },
    { emoji: "📈", label: "Review profit & loss", description: "Season P&L summary", flow: "profit_loss" },
  ],
  restock: [
    { emoji: "🔄", label: "Create reorder suggestions", description: "AI recommendations", flow: "reorder" },
    { emoji: "📋", label: "Create purchase orders", description: "POs for confirmed reorders", flow: "purchase_orders" },
  ],
};

const WhatsNextSuggestions = ({ completedFlow, context, onStartFlow, onStartPipeline, onGoHome }: WhatsNextProps) => {
  const suggestions = SUGGESTION_MAP[completedFlow] || [];
  const shown = suggestions.slice(0, 3);

  if (shown.length === 0) return null;

  return (
    <div className="mt-6 border-t border-border pt-6">
      <h3 className="text-sm font-semibold mb-3">What would you like to do next?</h3>
      <div className="grid grid-cols-2 gap-2 mb-3">
        {shown.map((s) => (
          <button
            key={s.flow}
            onClick={() => onStartFlow(s.flow)}
            className="bg-card border border-border rounded-lg p-3 text-left hover:border-primary/40 transition-colors"
          >
            <span className="text-lg block mb-1">{s.emoji}</span>
            <p className="text-xs font-semibold">{s.label}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{s.description}</p>
          </button>
        ))}
      </div>

      {onStartPipeline && completedFlow === "invoice" && (
        <button
          onClick={() => onStartPipeline("new_arrivals_full")}
          className="w-full bg-primary/5 border border-primary/20 rounded-lg p-3 text-left hover:bg-primary/10 transition-colors mb-3"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">📦</span>
            <div className="flex-1">
              <p className="text-xs font-semibold">Run the full new arrivals pipeline</p>
              <p className="text-[10px] text-muted-foreground">All steps from here to social posts</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </div>
        </button>
      )}

      <button onClick={onGoHome} className="text-xs text-muted-foreground hover:text-foreground">
        ← Back to home
      </button>
    </div>
  );
};

export default WhatsNextSuggestions;
