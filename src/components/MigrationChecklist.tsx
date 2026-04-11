import { useState, useEffect, useCallback } from "react";
import { CheckCircle2, Circle, ExternalLink, PartyPopper } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  flow?: string;
}

const ITEMS: ChecklistItem[] = [
  { id: "export_stocky", label: "Exported data from Stocky", description: "Download your POs, stocktakes, and products from Stocky", flow: "stocky_migration" },
  { id: "import_pos", label: "Imported POs into Sonic", description: "Upload Stocky PO export CSV", flow: "stocky_migration" },
  { id: "import_stocktakes", label: "Imported stocktake history", description: "Upload Stocky stocktake export", flow: "stocky_migration" },
  { id: "import_suppliers", label: "Imported supplier list", description: "Create or import your suppliers", flow: "suppliers" },
  { id: "connect_shopify", label: "Connected Shopify store", description: "Link your Shopify store for sync", flow: "account" },
  { id: "test_po_receive", label: "Run test PO receive", description: "Create and receive a test purchase order", flow: "purchase_orders" },
  { id: "test_stocktake", label: "Run test stocktake", description: "Complete a test stocktake count", flow: "stocktake_module" },
  { id: "train_team", label: "Trained team (optional)", description: "Share the app with your team" },
];

const STORAGE_KEY = "migration_checklist";

function loadChecked(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch { return {}; }
}

interface Props {
  onNavigate: (flow: string) => void;
  onDismiss?: () => void;
}

const MigrationChecklist = ({ onNavigate, onDismiss }: Props) => {
  const [checked, setChecked] = useState<Record<string, boolean>>(loadChecked);
  const completedCount = ITEMS.filter((i) => checked[i.id]).length;
  const progress = Math.round((completedCount / ITEMS.length) * 100);
  const allDone = completedCount === ITEMS.length;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(checked));
  }, [checked]);

  const toggle = useCallback((id: string) => {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  if (allDone) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center space-y-3">
        <PartyPopper className="h-10 w-10 mx-auto text-primary animate-bounce" />
        <h3 className="text-lg font-semibold">Ready for the Stocky sunset – you're all set! 🎉</h3>
        <p className="text-sm text-muted-foreground">All migration steps complete. You're fully switched over to Sonic.</p>
        {onDismiss && (
          <Button variant="outline" size="sm" onClick={onDismiss}>Dismiss</Button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Migration Checklist</h3>
        <span className="text-xs text-muted-foreground">{completedCount}/{ITEMS.length}</span>
      </div>
      <Progress value={progress} className="h-2" />

      <div className="space-y-1">
        {ITEMS.map((item) => {
          const done = !!checked[item.id];
          return (
            <div
              key={item.id}
              className={cn(
                "flex items-start gap-3 rounded-lg px-3 py-2 transition-colors",
                done ? "bg-muted/30" : "hover:bg-muted/20"
              )}
            >
              <button onClick={() => toggle(item.id)} className="mt-0.5 shrink-0">
                {done ? (
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                ) : (
                  <Circle className="h-5 w-5 text-muted-foreground" />
                )}
              </button>
              <div className="flex-1 min-w-0">
                <p className={cn("text-sm font-medium", done && "line-through text-muted-foreground")}>{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.description}</p>
              </div>
              {item.flow && !done && (
                <Button variant="ghost" size="sm" className="h-7 text-xs shrink-0" onClick={() => onNavigate(item.flow!)}>
                  Open <ExternalLink className="h-3 w-3 ml-1" />
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MigrationChecklist;
