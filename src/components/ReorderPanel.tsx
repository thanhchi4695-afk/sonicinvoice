import { useState, useMemo } from "react";
import { ChevronLeft, ShoppingCart, AlertTriangle, Clock, Snowflake, X, Check, ChevronDown, Download, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ReorderPanelProps {
  onBack: () => void;
  onViewOrders?: () => void;
}

interface ReorderSuggestion {
  id: string;
  product: string;
  supplier: string;
  currentStock: number;
  lastOrderDate: string;
  lastOrderQty: number;
  suggestedQty: number;
  reason: "low_stock" | "due_reorder" | "new_season";
  dismissed: boolean;
}

const DISMISSED_KEY = "reorder_dismissed";
const SETTINGS_KEY = "reorder_settings";

interface ReorderSettings {
  lowStockThreshold: number;
  reorderFrequency: "auto" | number;
  seasonalCycle: number;
}

const DEFAULT_SETTINGS: ReorderSettings = { lowStockThreshold: 3, reorderFrequency: "auto", seasonalCycle: 12 };

function getSettings(): ReorderSettings {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; } catch { return DEFAULT_SETTINGS; }
}
function saveSettings(s: ReorderSettings) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }
function getDismissed(): string[] {
  try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]"); } catch { return []; }
}
function addDismissed(id: string) {
  const d = getDismissed();
  if (!d.includes(id)) { d.push(id); localStorage.setItem(DISMISSED_KEY, JSON.stringify(d)); }
}

const REASON_CONFIG = {
  low_stock: { icon: "🔴", label: "Low stock", badgeClass: "bg-destructive/15 text-destructive" },
  due_reorder: { icon: "🟡", label: "Due for reorder", badgeClass: "bg-warning/15 text-warning" },
  new_season: { icon: "🔵", label: "New season", badgeClass: "bg-primary/15 text-primary" },
};

// Generate mock suggestions from simulated data
function generateSuggestions(settings: ReorderSettings): ReorderSuggestion[] {
  const dismissed = getDismissed();
  const now = new Date();
  const suggestions: ReorderSuggestion[] = [
    { id: "r1", product: "Mara One Piece - Black", supplier: "Bond Eye", currentStock: 1, lastOrderDate: "2026-01-15", lastOrderQty: 12, suggestedQty: 12, reason: "low_stock", dismissed: false },
    { id: "r2", product: "Sahara Kaftan", supplier: "Jantzen", currentStock: 2, lastOrderDate: "2026-02-10", lastOrderQty: 8, suggestedQty: 8, reason: "low_stock", dismissed: false },
    { id: "r3", product: "Collective Bikini Top", supplier: "Seafolly", currentStock: 8, lastOrderDate: "2025-12-01", lastOrderQty: 24, suggestedQty: 24, reason: "due_reorder", dismissed: false },
    { id: "r4", product: "Riviera High Waist Pant", supplier: "Baku", currentStock: 6, lastOrderDate: "2025-11-15", lastOrderQty: 18, suggestedQty: 18, reason: "due_reorder", dismissed: false },
    { id: "r5", product: "Classic One Piece", supplier: "Seafolly", currentStock: 14, lastOrderDate: "2025-04-20", lastOrderQty: 20, suggestedQty: 20, reason: "new_season", dismissed: false },
    { id: "r6", product: "Retro Racerback", supplier: "Jantzen", currentStock: 0, lastOrderDate: "2026-01-05", lastOrderQty: 10, suggestedQty: 10, reason: "low_stock", dismissed: false },
  ];
  return suggestions.map(s => ({ ...s, dismissed: dismissed.includes(s.id) }));
}

const ReorderPanel = ({ onBack, onViewOrders }: ReorderPanelProps) => {
  const [settings, setSettings] = useState<ReorderSettings>(getSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [localSettings, setLocalSettings] = useState<ReorderSettings>(settings);
  const [suggestions, setSuggestions] = useState<ReorderSuggestion[]>(() => generateSuggestions(settings));
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [createdPOs, setCreatedPOs] = useState<{ supplier: string; count: number; poNum: string }[]>([]);
  const [addedToPO, setAddedToPO] = useState<Set<string>>(new Set());

  const visible = useMemo(() => suggestions.filter(s => !s.dismissed), [suggestions]);
  const lowStockCount = visible.filter(s => s.reason === "low_stock").length;
  const dueCount = visible.filter(s => s.reason === "due_reorder").length;
  const seasonCount = visible.filter(s => s.reason === "new_season").length;

  const handleDismiss = (id: string) => {
    addDismissed(id);
    setSuggestions(prev => prev.map(s => s.id === id ? { ...s, dismissed: true } : s));
  };

  const handleAddToPO = (id: string) => {
    setAddedToPO(prev => new Set(prev).add(id));
  };

  const handleGeneratePOs = () => {
    const toOrder = visible.filter(s => !addedToPO.has(s.id) || addedToPO.has(s.id));
    const bySupplier: Record<string, ReorderSuggestion[]> = {};
    for (const s of toOrder) {
      if (!bySupplier[s.supplier]) bySupplier[s.supplier] = [];
      bySupplier[s.supplier].push(s);
    }
    const pos = Object.entries(bySupplier).map(([supplier, items], i) => ({
      supplier,
      count: items.length,
      poNum: `PO-2026-${String(14 + i).padStart(3, "0")}`,
    }));
    // Save draft POs to localStorage for OrderFormFlow
    const existing = JSON.parse(localStorage.getItem("purchase_orders") || "[]");
    const newPOs = pos.map(po => ({
      poNumber: po.poNum,
      supplier: po.supplier,
      date: new Date().toISOString(),
      status: "draft",
      lines: bySupplier[po.supplier].map(s => ({
        product: s.product,
        qty: s.suggestedQty,
        cost: 0,
      })),
    }));
    localStorage.setItem("purchase_orders", JSON.stringify([...newPOs, ...existing]));
    setCreatedPOs(pos);
    setShowConfirmation(true);
  };

  const handleSaveSettings = () => {
    saveSettings(localSettings);
    setSettings(localSettings);
    setSuggestions(generateSuggestions(localSettings));
    setShowSettings(false);
  };

  return (
    <div className="min-h-screen pb-24 animate-fade-in">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="text-muted-foreground">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-semibold font-display">🔁 Reorder Suggestions</h2>
          </div>
          <button onClick={() => setShowSettings(!showSettings)} className="text-muted-foreground">
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="px-4 pt-4">
        {/* Settings panel */}
        {showSettings && (
          <div className="bg-card border border-border rounded-lg p-4 mb-4">
            <h3 className="text-sm font-semibold mb-3">Reorder thresholds</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Low stock threshold</label>
                <select value={localSettings.lowStockThreshold} onChange={e => setLocalSettings({ ...localSettings, lowStockThreshold: Number(e.target.value) })}
                  className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm">
                  {[1, 2, 3, 5, 10].map(n => <option key={n} value={n}>{n} units</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Reorder frequency</label>
                <select value={String(localSettings.reorderFrequency)} onChange={e => setLocalSettings({ ...localSettings, reorderFrequency: e.target.value === "auto" ? "auto" : Number(e.target.value) })}
                  className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm">
                  <option value="auto">Auto-detect from order history</option>
                  {[2, 4, 6, 8, 12].map(n => <option key={n} value={n}>{n} weeks</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Seasonal cycle</label>
                <select value={localSettings.seasonalCycle} onChange={e => setLocalSettings({ ...localSettings, seasonalCycle: Number(e.target.value) })}
                  className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm">
                  {[6, 12, 18].map(n => <option key={n} value={n}>{n} months</option>)}
                </select>
              </div>
              <Button size="sm" onClick={handleSaveSettings}>Save settings</Button>
            </div>
          </div>
        )}

        {/* Confirmation modal */}
        {showConfirmation && createdPOs.length > 0 && (
          <div className="bg-success/10 border border-success/20 rounded-lg p-4 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Check className="w-4 h-4 text-success" />
              <span className="text-sm font-semibold text-success">Created {createdPOs.length} draft POs</span>
            </div>
            <div className="space-y-1 mb-3">
              {createdPOs.map(po => (
                <p key={po.poNum} className="text-xs text-muted-foreground">
                  • <span className="font-mono-data">{po.poNum}</span> — {po.supplier} — {po.count} line{po.count > 1 ? "s" : ""}
                </p>
              ))}
            </div>
            {onViewOrders ? (
              <Button size="sm" variant="outline" onClick={onViewOrders}>View Purchase Orders →</Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setShowConfirmation(false)}>Dismiss</Button>
            )}
          </div>
        )}

        {/* Summary */}
        {visible.length > 0 ? (
          <div className="bg-card border border-border rounded-lg p-3 mb-4">
            <p className="text-sm font-medium">
              💡 {lowStockCount > 0 && <span className="text-destructive">{lowStockCount} running low</span>}
              {lowStockCount > 0 && dueCount > 0 && " · "}
              {dueCount > 0 && <span className="text-warning">{dueCount} due for reorder</span>}
              {(lowStockCount > 0 || dueCount > 0) && seasonCount > 0 && " · "}
              {seasonCount > 0 && <span className="text-primary">{seasonCount} new season</span>}
            </p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg p-6 mb-4 text-center">
            <p className="text-sm text-muted-foreground">✅ No reorder suggestions right now</p>
            <p className="text-xs text-muted-foreground mt-1">Process more invoices to build reorder intelligence</p>
          </div>
        )}

        {/* Generate PO button */}
        {visible.length > 0 && !showConfirmation && (
          <Button className="w-full h-12 mb-4" onClick={handleGeneratePOs}>
            <ShoppingCart className="w-4 h-4 mr-2" /> Generate PO from suggestions ({visible.length} items)
          </Button>
        )}

        {/* Suggestions list */}
        <div className="space-y-2">
          {visible.map(s => {
            const rc = REASON_CONFIG[s.reason];
            const isAdded = addedToPO.has(s.id);
            return (
              <div key={s.id} className="bg-card rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{s.product}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{s.supplier}</p>
                    <div className="flex flex-wrap gap-2 mt-1.5 text-[11px]">
                      <span className="text-muted-foreground">Stock: <span className={`font-medium ${s.currentStock <= 3 ? "text-destructive" : "text-foreground"}`}>{s.currentStock}</span></span>
                      <span className="text-muted-foreground">Last order: {new Date(s.lastOrderDate).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "2-digit" })} ({s.lastOrderQty} units)</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${rc.badgeClass}`}>
                        {rc.icon} {rc.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground">Suggested: <span className="font-medium text-foreground">{s.suggestedQty} units</span></span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    {isAdded ? (
                      <span className="text-[10px] text-success font-medium px-2 py-1">✓ Added</span>
                    ) : (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleAddToPO(s.id)}>
                        Add to PO
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => handleDismiss(s.id)}>
                      Dismiss
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Dismissed count */}
        {suggestions.filter(s => s.dismissed).length > 0 && (
          <p className="text-[10px] text-muted-foreground text-center mt-4">
            {suggestions.filter(s => s.dismissed).length} suggestion{suggestions.filter(s => s.dismissed).length > 1 ? "s" : ""} dismissed
          </p>
        )}
      </div>
    </div>
  );
};

export default ReorderPanel;
