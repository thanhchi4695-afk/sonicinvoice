import { FilePlus, Percent, ChevronRight, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HomeScreenProps {
  onStartInvoice: () => void;
  onStartSale: () => void;
  onStartRestock: () => void;
}

const recentActivity = [
  { type: "invoice" as const, label: "Jantzen Mar26", count: 18, time: "2 days ago" },
  { type: "sale" as const, label: "Baku 30% off", count: 48, time: "5 days ago" },
];

const HomeScreen = ({ onStartInvoice, onStartSale, onStartRestock }: HomeScreenProps) => {
  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <h1 className="text-2xl font-bold font-display mb-1">SkuPilot</h1>
      <p className="text-muted-foreground text-sm mb-6">Invoice → Shopify in minutes</p>

      {/* Import Invoice Card */}
      <div className="bg-card rounded-lg border border-border p-5 mb-3">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <FilePlus className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold font-display">Import invoice</h2>
            <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
              Upload a supplier invoice and get a Shopify-ready product file in minutes.
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
              Put a collection on sale or restore original prices. Upload your Shopify export.
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">Upload Shopify product export</p>
          </div>
        </div>
        <Button variant="amber" className="w-full mt-4 h-12 text-base" onClick={onStartSale}>
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
            <p className="text-xs text-muted-foreground mt-2 font-mono-data">Upload Shopify or JOOR inventory</p>
          </div>
        </div>
        <Button variant="outline" className="w-full mt-4 h-12 text-base border-destructive/30 text-destructive hover:bg-destructive/10" onClick={onStartRestock}>
          Start <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
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
            <span className="text-xs text-muted-foreground font-mono-data">
              {item.count} products · {item.time}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default HomeScreen;
