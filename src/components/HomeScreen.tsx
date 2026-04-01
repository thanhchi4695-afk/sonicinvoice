import { FilePlus, Percent, ChevronRight, BarChart3, DollarSign, Monitor, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStoreMode } from "@/hooks/use-store-mode";

interface HomeScreenProps {
  onStartInvoice: () => void;
  onStartSale: () => void;
  onStartRestock: () => void;
  onStartPriceAdjust: () => void;
}

const HomeScreen = ({ onStartInvoice, onStartSale, onStartRestock, onStartPriceAdjust }: HomeScreenProps) => {
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

  return (
    <div className="px-4 pt-2 pb-24 animate-fade-in">
      <h1 className="text-2xl font-bold font-display mb-1">SkuPilot</h1>
      <p className="text-muted-foreground text-sm mb-6">
        {mode.isLightspeed
          ? `Invoice → ${mode.targetPlatform} in minutes`
          : "Invoice → Shopify in minutes"}
      </p>

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

      {/* Bulk Sale Card */}
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

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-card rounded-lg border border-border p-4 text-center">
          <p className="text-2xl font-bold font-display">3</p>
          <p className="text-xs text-muted-foreground mt-1">{mode.isLightspeed ? 'Lightspeed imports' : 'CSV exports'}</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-4 text-center">
          <p className="text-2xl font-bold font-display">84</p>
          <p className="text-xs text-muted-foreground mt-1">{mode.isLightspeed ? 'Products ready for Lightspeed' : 'Products imported to Shopify'}</p>
        </div>
      </div>

      {/* Recent Activity */}
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Recent activity</h3>
      <div className="space-y-2">
        {recentActivity.map((item, i) => (
          <div key={i} className="flex items-center gap-3 bg-card rounded-lg border border-border px-4 py-3">
            <span
              className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                item.type === "invoice"
                  ? "bg-primary/15 text-primary"
                  : "bg-secondary/15 text-secondary"
              }`}
            >
              {item.type === "invoice" ? "Invoice" : "Sale"}
            </span>
            <span className="text-sm flex-1 truncate">{item.label}</span>
            <span className="text-xs text-muted-foreground font-mono-data">{item.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default HomeScreen;
