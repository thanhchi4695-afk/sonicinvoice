import { useState, useEffect, useMemo } from "react";
import {
  AlertTriangle, Package, TrendingDown, RefreshCw, Loader2,
  ChevronDown, ChevronUp, ShoppingCart, ClipboardList, ExternalLink,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface AlertItem {
  variantId: string;
  productTitle: string;
  sku: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  cost: number;
  vendor: string | null;
  reorderPoint: number;
  type: "low" | "negative" | "overstock";
}

interface OverdueLocation {
  location: string;
  lastCounted: string | null;
  daysSince: number;
}

export default function InventoryAlerts({
  onCreatePO,
  onAdjustStock,
}: {
  onCreatePO?: () => void;
  onAdjustStock?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [overdueLocations, setOverdueLocations] = useState<OverdueLocation[]>([]);
  const [expanded, setExpanded] = useState(false);

  const fetchAlerts = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      // Fetch variants, products, and reorder settings in parallel
      const [variantsRes, productsRes, settingsRes, stocktakesRes] = await Promise.all([
        supabase.from("variants").select("id, product_id, sku, color, size, quantity, cost").eq("user_id", user.id),
        supabase.from("products").select("id, title, vendor").eq("user_id", user.id),
        supabase.from("product_reorder_settings").select("variant_id, lead_time_days, safety_stock_days").eq("user_id", user.id),
        supabase.from("stocktakes").select("location, counted_at").eq("user_id", user.id).eq("status", "completed"),
      ]);

      const productMap = new Map((productsRes.data || []).map(p => [p.id, p]));
      const settingsMap = new Map((settingsRes.data || []).map(s => [s.variant_id, s]));

      const DEFAULT_REORDER = 5;
      const DEFAULT_MAX = 999;
      const items: AlertItem[] = [];

      for (const v of variantsRes.data || []) {
        const prod = productMap.get(v.product_id);
        const settings = settingsMap.get(v.id);
        const reorderPoint = settings ? (settings.lead_time_days + settings.safety_stock_days) : DEFAULT_REORDER;

        if (v.quantity < 0) {
          items.push({ variantId: v.id, productTitle: prod?.title || "Unknown", sku: v.sku, color: v.color, size: v.size, quantity: v.quantity, cost: Number(v.cost) || 0, vendor: prod?.vendor || null, reorderPoint, type: "negative" });
        } else if (v.quantity < reorderPoint && v.quantity >= 0) {
          items.push({ variantId: v.id, productTitle: prod?.title || "Unknown", sku: v.sku, color: v.color, size: v.size, quantity: v.quantity, cost: Number(v.cost) || 0, vendor: prod?.vendor || null, reorderPoint, type: "low" });
        } else if (v.quantity > DEFAULT_MAX) {
          items.push({ variantId: v.id, productTitle: prod?.title || "Unknown", sku: v.sku, color: v.color, size: v.size, quantity: v.quantity, cost: Number(v.cost) || 0, vendor: prod?.vendor || null, reorderPoint, type: "overstock" });
        }
      }

      setAlerts(items);

      // Overdue stocktakes: group by location, find latest count
      const locationLastCount = new Map<string, string>();
      for (const st of stocktakesRes.data || []) {
        const existing = locationLastCount.get(st.location);
        if (!existing || st.counted_at > existing) {
          locationLastCount.set(st.location, st.counted_at);
        }
      }

      const now = Date.now();
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      const overdue: OverdueLocation[] = [];

      // Check known locations from stocktakes
      for (const [loc, lastDate] of locationLastCount.entries()) {
        const diff = now - new Date(lastDate).getTime();
        if (diff > thirtyDays) {
          overdue.push({ location: loc, lastCounted: lastDate, daysSince: Math.floor(diff / (24 * 60 * 60 * 1000)) });
        }
      }

      // If no stocktakes at all but variants exist, flag default location
      if (locationLastCount.size === 0 && (variantsRes.data || []).length > 0) {
        overdue.push({ location: "Default", lastCounted: null, daysSince: 999 });
      }

      setOverdueLocations(overdue);
    } catch (e) {
      console.error("Alerts fetch error:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAlerts(); }, []);

  const counts = useMemo(() => ({
    low: alerts.filter(a => a.type === "low").length,
    negative: alerts.filter(a => a.type === "negative").length,
    overstock: alerts.filter(a => a.type === "overstock").length,
    overdue: overdueLocations.length,
  }), [alerts, overdueLocations]);

  const totalAlerts = counts.low + counts.negative + counts.overstock + counts.overdue;

  if (loading) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Checking inventory alerts…</span>
        </div>
      </Card>
    );
  }

  if (totalAlerts === 0) return null;

  return (
    <Card className="overflow-hidden">
      {/* Summary header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center gap-3 hover:bg-muted/30 transition-colors"
      >
        <div className="w-9 h-9 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
          <AlertTriangle className="w-5 h-5 text-destructive" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-sm font-semibold">
            {totalAlerts} Inventory Alert{totalAlerts !== 1 ? "s" : ""}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {counts.negative > 0 && <Badge variant="destructive" className="text-[10px]">{counts.negative} negative</Badge>}
            {counts.low > 0 && <Badge variant="secondary" className="text-[10px]">{counts.low} low stock</Badge>}
            {counts.overstock > 0 && <Badge className="text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{counts.overstock} overstock</Badge>}
            {counts.overdue > 0 && <Badge variant="outline" className="text-[10px]">{counts.overdue} overdue count</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); fetchAlerts(); }}>
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border px-4 pb-4 space-y-3 pt-3">
          {/* Negative stock */}
          {counts.negative > 0 && (
            <AlertSection
              title="Negative Stock"
              icon={<TrendingDown className="w-3.5 h-3.5 text-destructive" />}
              items={alerts.filter(a => a.type === "negative")}
              actionLabel="Adjust Stock"
              onAction={onAdjustStock}
            />
          )}

          {/* Low stock */}
          {counts.low > 0 && (
            <AlertSection
              title="Below Reorder Point"
              icon={<Package className="w-3.5 h-3.5 text-yellow-600" />}
              items={alerts.filter(a => a.type === "low")}
              actionLabel="Create PO"
              onAction={onCreatePO}
            />
          )}

          {/* Overstock */}
          {counts.overstock > 0 && (
            <AlertSection
              title="Overstock (>999)"
              icon={<Package className="w-3.5 h-3.5 text-blue-600" />}
              items={alerts.filter(a => a.type === "overstock")}
            />
          )}

          {/* Overdue stocktakes */}
          {counts.overdue > 0 && (
            <div>
              <p className="text-xs font-semibold flex items-center gap-1.5 mb-1.5">
                <ClipboardList className="w-3.5 h-3.5 text-muted-foreground" />
                Overdue Stocktakes
              </p>
              <div className="space-y-1">
                {overdueLocations.map(loc => (
                  <div key={loc.location} className="flex items-center justify-between text-xs bg-muted/30 rounded px-2 py-1.5">
                    <span className="font-medium">{loc.location}</span>
                    <span className="text-muted-foreground">
                      {loc.lastCounted ? `${loc.daysSince}d since last count` : "Never counted"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function AlertSection({
  title, icon, items, actionLabel, onAction,
}: {
  title: string;
  icon: React.ReactNode;
  items: AlertItem[];
  actionLabel?: string;
  onAction?: () => void;
}) {
  const shown = items.slice(0, 5);
  const remaining = items.length - shown.length;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs font-semibold flex items-center gap-1.5">{icon} {title} ({items.length})</p>
        {actionLabel && onAction && (
          <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={onAction}>
            {actionLabel}
          </Button>
        )}
      </div>
      <div className="space-y-0.5">
        {shown.map(a => (
          <div key={a.variantId} className="flex items-center justify-between text-xs bg-muted/30 rounded px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <span className="font-medium truncate block">{a.productTitle}</span>
              <span className="text-[10px] text-muted-foreground">
                {[a.sku, a.color, a.size].filter(Boolean).join(" • ")}
              </span>
            </div>
            <div className="text-right shrink-0 ml-2">
              <span className={cn("font-mono font-semibold", a.quantity < 0 ? "text-destructive" : a.type === "low" ? "text-yellow-600" : "text-blue-600")}>
                {a.quantity}
              </span>
              {a.type === "low" && (
                <span className="text-[10px] text-muted-foreground block">min {a.reorderPoint}</span>
              )}
            </div>
          </div>
        ))}
        {remaining > 0 && (
          <p className="text-[10px] text-muted-foreground text-center pt-1">+{remaining} more</p>
        )}
      </div>
    </div>
  );
}
