import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

const historyItems = [
  { type: "invoice" as const, label: "Jantzen Mar26", count: 18, date: "30 Mar 2026" },
  { type: "sale" as const, label: "Baku 30% off", count: 48, date: "28 Mar 2026" },
  { type: "invoice" as const, label: "Seafolly Feb26", count: 24, date: "15 Feb 2026" },
  { type: "sale" as const, label: "Summer clearance 50%", count: 92, date: "10 Feb 2026" },
  { type: "invoice" as const, label: "Bond Eye Jan26", count: 12, date: "5 Jan 2026" },
];

const HistoryScreen = () => {
  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <h1 className="text-2xl font-bold font-display mb-1">History</h1>
      <p className="text-muted-foreground text-sm mb-6">Past imports and sale runs</p>

      <div className="space-y-2">
        {historyItems.map((item, i) => (
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
                <p className="text-xs text-muted-foreground font-mono-data">{item.count} products · {item.date}</p>
              </div>
              <Button variant="ghost" size="icon" className="shrink-0">
                <Download className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default HistoryScreen;
