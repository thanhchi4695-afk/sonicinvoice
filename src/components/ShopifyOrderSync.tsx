import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ChevronLeft, RefreshCw, ShoppingCart, Loader2, CheckCircle2,
  AlertTriangle, Calendar, TrendingUp, Package,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, subDays } from "date-fns";

interface ShopifyOrderSyncProps {
  onBack: () => void;
}

type SyncRange = "30" | "90" | "180" | "365" | "all";

const ShopifyOrderSync = ({ onBack }: ShopifyOrderSyncProps) => {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [shopName, setShopName] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncRange, setSyncRange] = useState<SyncRange>("90");
  const [result, setResult] = useState<{
    synced: number;
    skipped: number;
    total_orders: number;
    message: string;
  } | null>(null);
  const [stats, setStats] = useState<{
    totalRecords: number;
    totalRevenue: number;
    totalCogs: number;
    lastSync: string | null;
  }>({ totalRecords: 0, totalRevenue: 0, totalCogs: 0, lastSync: null });

  useEffect(() => {
    checkConnection();
    loadStats();
  }, []);

  const checkConnection = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("shopify_connections")
      .select("shop_name")
      .eq("user_id", user.id)
      .maybeSingle();
    setConnected(!!data);
    if (data?.shop_name) setShopName(data.shop_name);
  };

  const loadStats = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, count } = await supabase
      .from("sales_data")
      .select("revenue, cost_of_goods, sold_at", { count: "exact" })
      .eq("user_id", user.id)
      .eq("source", "shopify")
      .order("sold_at", { ascending: false })
      .limit(1);

    const { data: agg } = await supabase
      .from("sales_data")
      .select("revenue, cost_of_goods")
      .eq("user_id", user.id)
      .eq("source", "shopify");

    const totalRevenue = agg?.reduce((s, r) => s + Number(r.revenue || 0), 0) || 0;
    const totalCogs = agg?.reduce((s, r) => s + Number(r.cost_of_goods || 0), 0) || 0;

    setStats({
      totalRecords: count || 0,
      totalRevenue,
      totalCogs,
      lastSync: data?.[0]?.sold_at || null,
    });
  };

  const runSync = async () => {
    setSyncing(true);
    setResult(null);
    try {
      const since = syncRange === "all"
        ? undefined
        : subDays(new Date(), parseInt(syncRange)).toISOString();

      const { data, error } = await supabase.functions.invoke("shopify-order-sync", {
        body: { since },
      });

      if (error) throw error;
      setResult(data);
      toast.success(data.message || "Order sync complete");
      loadStats();
    } catch (err: any) {
      toast.error(err.message || "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(n);

  if (connected === null) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 pb-24 animate-fade-in max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold font-display flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-primary" /> Shopify Order Sync
          </h2>
          <p className="text-xs text-muted-foreground">
            Import sales data to power velocity calculations
          </p>
        </div>
      </div>

      {!connected ? (
        <Card className="p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-warning mx-auto mb-3" />
          <p className="text-sm font-semibold mb-1">No Shopify connection</p>
          <p className="text-xs text-muted-foreground">
            Connect your Shopify store first to sync orders.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Current stats */}
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Synced Records</p>
              <p className="text-xl font-bold font-mono-data">{stats.totalRecords.toLocaleString()}</p>
            </Card>
            <Card className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total Revenue</p>
              <p className="text-xl font-bold font-mono-data">{fmt(stats.totalRevenue)}</p>
            </Card>
            <Card className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">COGS</p>
              <p className="text-xl font-bold font-mono-data">{fmt(stats.totalCogs)}</p>
            </Card>
            <Card className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Gross Profit</p>
              <p className="text-xl font-bold font-mono-data text-success">
                {fmt(stats.totalRevenue - stats.totalCogs)}
              </p>
            </Card>
          </div>

          {stats.lastSync && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              Latest order: {format(new Date(stats.lastSync), "dd MMM yyyy")}
            </p>
          )}

          {/* Sync controls */}
          <Card className="p-4 space-y-4">
            <div>
              <label className="text-xs font-medium mb-2 block">Date Range</label>
              <div className="flex flex-wrap gap-2">
                {([
                  ["30", "30 days"],
                  ["90", "90 days"],
                  ["180", "6 months"],
                  ["365", "1 year"],
                  ["all", "All time"],
                ] as [SyncRange, string][]).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setSyncRange(val)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      syncRange === val
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-input hover:bg-muted"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <Button
              onClick={runSync}
              disabled={syncing}
              className="w-full"
              size="lg"
            >
              {syncing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Syncing orders from {shopName || "Shopify"}...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Sync Orders
                </>
              )}
            </Button>

            <p className="text-[10px] text-muted-foreground text-center">
              Duplicate orders are automatically skipped. Safe to run multiple times.
            </p>
          </Card>

          {/* Result */}
          {result && (
            <Card className="p-4 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-green-700 dark:text-green-300">
                    Sync Complete
                  </p>
                  <div className="text-xs text-green-600 dark:text-green-400 space-y-0.5 mt-1">
                    <p>✓ {result.synced} new line items imported</p>
                    {result.skipped > 0 && <p>↳ {result.skipped} duplicates skipped</p>}
                    <p>↳ {result.total_orders} total line items processed</p>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* How it works */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" /> How it powers your store
            </h3>
            <ul className="text-xs text-muted-foreground space-y-1.5">
              <li className="flex items-start gap-2">
                <Package className="w-3 h-3 mt-0.5 text-primary" />
                <span><strong>Sales velocity</strong> — measures units sold per day for reorder timing</span>
              </li>
              <li className="flex items-start gap-2">
                <Package className="w-3 h-3 mt-0.5 text-primary" />
                <span><strong>Product health</strong> — identifies dead stock vs. best sellers</span>
              </li>
              <li className="flex items-start gap-2">
                <Package className="w-3 h-3 mt-0.5 text-primary" />
                <span><strong>Markdown triggers</strong> — detects when products stop selling</span>
              </li>
              <li className="flex items-start gap-2">
                <Package className="w-3 h-3 mt-0.5 text-primary" />
                <span><strong>P&L reporting</strong> — revenue data for profit calculations</span>
              </li>
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
};

export default ShopifyOrderSync;
