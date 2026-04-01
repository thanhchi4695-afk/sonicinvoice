import { useState, useEffect } from "react";
import { Download, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ExportEntry {
  supplier: string;
  format: string;
  filename: string;
  productCount: number;
  date: string;
}

const historyItems = [
  { type: "invoice" as const, label: "Jantzen Mar26", count: 18, date: "30 Mar 2026", supplier: "jantzen", processingTime: 83 },
  { type: "sale" as const, label: "Baku 30% off", count: 48, date: "28 Mar 2026", supplier: "baku", processingTime: 127 },
  { type: "invoice" as const, label: "Seafolly Feb26", count: 24, date: "15 Feb 2026", supplier: "seafolly", processingTime: 96 },
  { type: "sale" as const, label: "Summer clearance 50%", count: 92, date: "10 Feb 2026", supplier: "mixed", processingTime: 215 },
  { type: "invoice" as const, label: "Bond Eye Jan26", count: 12, date: "5 Jan 2026", supplier: "bond-eye", processingTime: 54 },
];

function getExportHistory(): ExportEntry[] {
  try { return JSON.parse(localStorage.getItem("export_history") || "[]"); } catch { return []; }
}

function getExportCountForSupplier(exports: ExportEntry[], supplier: string): number {
  return exports.filter(e => e.supplier.toLowerCase().replace(/\s+/g, "-") === supplier).length;
}

function getLastExportForSupplier(exports: ExportEntry[], supplier: string): ExportEntry | undefined {
  return exports.find(e => e.supplier.toLowerCase().replace(/\s+/g, "-") === supplier);
}

const FORMAT_LABELS: Record<string, string> = {
  shopify_full: "Shopify CSV Full",
  shopify_inventory: "Inventory CSV",
  shopify_price: "Price CSV",
  tags_only: "Tags CSV",
  xlsx: "Excel",
  summary_pdf: "Summary PDF",
};

const HistoryScreen = () => {
  const [exports, setExports] = useState<ExportEntry[]>([]);

  useEffect(() => {
    setExports(getExportHistory());
  }, []);

  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <h1 className="text-2xl font-bold font-display mb-1">History</h1>
      <p className="text-muted-foreground text-sm mb-6">Past imports and sale runs</p>

      <div className="space-y-2">
        {historyItems.map((item, i) => {
          const exportCount = getExportCountForSupplier(exports, item.supplier);
          const lastExport = getLastExportForSupplier(exports, item.supplier);

          return (
            <div key={i} className="bg-card rounded-lg border border-border px-4 py-3">
              <div className="flex items-center gap-3">
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                    item.type === "invoice"
                      ? "bg-primary/15 text-primary"
                      : "bg-secondary/15 text-secondary"
                  }`}
                >
                  {item.type === "invoice" ? "Invoice" : "Sale"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.label}</p>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground font-mono-data">
                      {item.count} products · {item.date} · ⏱ {item.processingTime < 60 ? `${item.processingTime}s` : `${Math.floor(item.processingTime / 60)}m ${item.processingTime % 60}s`}
                    </p>
                    {exportCount > 0 && (
                      <span className="text-[10px] text-primary font-medium" title={lastExport ? `Last exported: ${new Date(lastExport.date).toLocaleDateString()} · ${FORMAT_LABELS[lastExport.format] || lastExport.format}` : ""}>
                        {exportCount} export{exportCount > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {exportCount > 0 && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Re-export">
                      <RotateCcw className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Download className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default HistoryScreen;
