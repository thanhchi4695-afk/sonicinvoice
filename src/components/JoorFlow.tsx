import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  groupJoorItemsIntoProducts,
  buildShopifyCSV,
  buildLightspeedCSV,
  type MappedProduct,
  type JoorLineItem,
} from "@/lib/joor-mapper";
import {
  parseJoorFile,
  enrichJoorProducts,
  type JoorParsedProduct,
  type JoorFileParseResult,
} from "@/lib/joor-file-parser";
import { toast } from "sonner";
import {
  ArrowLeft, Check, Loader2, RefreshCw, Download,
  Upload, Search, Filter, ChevronRight, Link2, Unplug,
  Package, AlertTriangle, FileUp, Sparkles, Eye,
} from "lucide-react";

interface JoorFlowProps {
  onBack: () => void;
}

interface JoorOrder {
  order_id: string;
  order_total: number;
  order_currency: string;
  order_season_code: string;
  order_delivery_name: string;
  retailer?: { customer_name?: string; customer_code?: string };
  line_items: JoorLineItem[];
  brand?: string;
  _processed?: boolean;
}

type Step = "connect" | "orders" | "detail" | "file_import" | "file_review";

const JoorFlow = ({ onBack }: JoorFlowProps) => {
  const [step, setStep] = useState<Step>("connect");
  const [connected, setConnected] = useState(false);
  const [tokenLabel, setTokenLabel] = useState("");
  const [loading, setLoading] = useState(true);

  // Connect step
  const [tokenInput, setTokenInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [testing, setTesting] = useState(false);

  // Orders step
  const [orders, setOrders] = useState<JoorOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [seasonFilter, setSeasonFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "unprocessed" | "processed">("all");
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());

  // Detail step
  const [activeOrder, setActiveOrder] = useState<JoorOrder | null>(null);
  const [groupedProducts, setGroupedProducts] = useState<MappedProduct[]>([]);
  const [pushing, setPushing] = useState(false);
  const [pushProgress, setPushProgress] = useState({ current: 0, total: 0 });

  // File import step
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileParseResult, setFileParseResult] = useState<JoorFileParseResult | null>(null);
  const [fileParsing, setFileParsing] = useState(false);
  const [fileEnriching, setFileEnriching] = useState(false);
  const [fileProducts, setFileProducts] = useState<JoorParsedProduct[]>([]);
  const [fileGroupedProducts, setFileGroupedProducts] = useState<MappedProduct[]>([]);

  // Check existing connection
  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }

      const { data } = await supabase
        .from("joor_connections")
        .select("token_label, last_synced")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (data) {
        setConnected(true);
        setTokenLabel(data.token_label || "JOOR Account");
        setStep("orders");
        loadOrders();
      }
    } catch (e) {
      console.error("JOOR connection check failed:", e);
    }
    setLoading(false);
  };

  const callJoorProxy = async (action: string, params?: Record<string, unknown>) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");

    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const res = await fetch(
      `https://${projectId}.supabase.co/functions/v1/joor-proxy`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action, params }),
      }
    );

    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401 && data.error?.includes("JOOR")) {
        throw new Error("Your JOOR token is invalid or expired. Please reconnect in Account Settings → JOOR.");
      }
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  };

  const handleConnect = async () => {
    if (!tokenInput.trim()) { toast.error("Please enter your JOOR API token"); return; }
    setTesting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      // Save token first
      const { error: saveErr } = await supabase.from("joor_connections").upsert({
        user_id: session.user.id,
        oauth_token: tokenInput.trim(),
        token_label: labelInput.trim() || null,
      }, { onConflict: "user_id" });
      if (saveErr) throw saveErr;

      // Test connection
      await callJoorProxy("test_connection");

      setConnected(true);
      setTokenLabel(labelInput.trim() || "JOOR Account");
      setStep("orders");
      toast.success("Connected to JOOR");
      loadOrders();
    } catch (e: any) {
      // Remove saved token if test failed
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await supabase.from("joor_connections").delete().eq("user_id", session.user.id);
      }
      toast.error(e.message || "Failed to connect to JOOR");
    }
    setTesting(false);
  };

  const handleDisconnect = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await supabase.from("joor_connections").delete().eq("user_id", session.user.id);
    setConnected(false);
    setStep("connect");
    setTokenInput("");
    setLabelInput("");
    setOrders([]);
    toast.success("JOOR disconnected");
  };

  const loadOrders = async () => {
    setOrdersLoading(true);
    try {
      const data = await callJoorProxy("get_orders", { count: 100 });
      const orderList = Array.isArray(data) ? data : data.orders || data.results || [];
      setOrders(orderList);

      // Update last_synced
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await supabase.from("joor_connections")
          .update({ last_synced: new Date().toISOString() })
          .eq("user_id", session.user.id);
      }
    } catch (e: any) {
      if (e.message?.includes("token")) {
        toast.error(e.message);
      } else {
        toast.error("Could not reach JOOR. Check your internet connection and try again.");
      }
    }
    setOrdersLoading(false);
  };

  const openOrderDetail = (order: JoorOrder) => {
    setActiveOrder(order);
    const items = order.line_items || [];
    const products = groupJoorItemsIntoProducts(items, {
      season_code: order.order_season_code,
      delivery_name: order.order_delivery_name,
    });
    setGroupedProducts(products);
    setStep("detail");
  };

  const downloadCSV = (type: "shopify" | "lightspeed") => {
    if (!activeOrder || groupedProducts.length === 0) return;
    const csv = type === "shopify"
      ? buildShopifyCSV(groupedProducts)
      : buildLightspeedCSV(groupedProducts);

    const brand = activeOrder.brand || "JOOR";
    const season = activeOrder.order_season_code || "order";
    const date = new Date().toISOString().slice(0, 10);
    const filename = `${brand}-${season}-${date}-${type}.csv`;

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${type === "shopify" ? "Shopify" : "Lightspeed"} CSV downloaded (${groupedProducts.length} products)`);
  };

  const pushToShopify = async (products: MappedProduct[]) => {
    setPushing(true);
    setPushProgress({ current: 0, total: products.length });
    let errors = 0;

    for (let i = 0; i < products.length; i++) {
      setPushProgress({ current: i + 1, total: products.length });
      try {
        const p = products[i];
        const variants = (p.sizes || [p.size]).map((sz, idx) => ({
          sku: `${p.sku.split("-").slice(0, 2).join("-")}-${sz}`.toUpperCase().replace(/\s+/g, "-"),
          price: p.price,
          cost: p.costPrice,
          barcode: (p.barcodes || [p.barcode])?.[idx] || "",
          option1: p.colour,
          option2: sz,
        }));

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Not authenticated");

        const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
        const res = await fetch(
          `https://${projectId}.supabase.co/functions/v1/shopify-proxy`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              action: "graphql_create_product",
              product: {
                title: p.title,
                vendor: p.vendor,
                product_type: p.productType,
                body_html: p.description,
                status: "draft",
                tags: [p.brand, p.colour, p.collection, "full_price", "new"].filter(Boolean).join(", "),
                variants,
                options: [
                  { name: "Colour", values: [p.colour] },
                  { name: "Size", values: p.sizes || [p.size] },
                ],
              },
            }),
          }
        );

        if (res.status === 429) {
          // Rate limited — retry
          toast.info("Rate limited — retrying...");
          await new Promise((r) => setTimeout(r, 2000));
          i--; // retry this product
          continue;
        }
        if (!res.ok) errors++;
      } catch {
        errors++;
      }
    }

    setPushing(false);
    if (errors > 0) {
      toast.warning(`${products.length - errors} pushed, ${errors} failed`);
    } else {
      toast.success(`${products.length} products pushed to Shopify`);
    }
  };

  const markExported = async (orderId: string) => {
    try {
      await callJoorProxy("mark_exported", { order_id: orderId });
      setOrders((prev) =>
        prev.map((o) => (o.order_id === orderId ? { ...o, _processed: true } : o))
      );
      toast.success("Order marked as processed in JOOR");
    } catch (e: any) {
      toast.error(e.message || "Failed to mark order");
    }
  };

  const handleBulkDownload = () => {
    const selected = orders.filter((o) => selectedOrders.has(o.order_id));
    const allProducts: MappedProduct[] = [];
    for (const order of selected) {
      const products = groupJoorItemsIntoProducts(order.line_items || [], {
        season_code: order.order_season_code,
        delivery_name: order.order_delivery_name,
      });
      allProducts.push(...products);
    }
    if (allProducts.length === 0) { toast.error("No products in selected orders"); return; }

    const csv = buildShopifyCSV(allProducts);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `joor-combined-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Combined CSV downloaded (${allProducts.length} products from ${selected.length} orders)`);
  };

  const handleBulkPush = async () => {
    const selected = orders.filter((o) => selectedOrders.has(o.order_id));
    for (const order of selected) {
      const products = groupJoorItemsIntoProducts(order.line_items || [], {
        season_code: order.order_season_code,
        delivery_name: order.order_delivery_name,
      });
      await pushToShopify(products);
      await markExported(order.order_id);
    }
  };

  // Filtering
  const filteredOrders = orders.filter((o) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchId = o.order_id?.toLowerCase().includes(q);
      const matchBrand = o.brand?.toLowerCase().includes(q);
      if (!matchId && !matchBrand) return false;
    }
    if (seasonFilter !== "all" && o.order_season_code !== seasonFilter) return false;
    if (statusFilter === "processed" && !o._processed) return false;
    if (statusFilter === "unprocessed" && o._processed) return false;
    return true;
  });

  const uniqueSeasons = [...new Set(orders.map((o) => o.order_season_code).filter(Boolean))];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  // ─── STEP: CONNECT ───
  if (step === "connect") {
    return (
      <div className="px-4 pt-4 pb-24 animate-fade-in max-w-2xl mx-auto">
        <button onClick={onBack} className="flex items-center gap-1 text-muted-foreground text-sm mb-4 hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <div className="bg-card rounded-lg border border-border p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-11 h-11 rounded-lg bg-primary/15 flex items-center justify-center">
              <Link2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold font-display">Connect your JOOR account</h1>
            </div>
          </div>

          <p className="text-sm text-muted-foreground leading-relaxed mb-6">
            JOOR is the wholesale platform used by brands like Funkita, Seafolly, and Speedo.
            Your retailers place orders on JOOR — this integration pulls those orders directly
            into Sonic Invoice so you can push products to Shopify with one click, no manual entry required.
          </p>

          {connected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-success">
                <Check className="w-4 h-4" />
                <span className="font-medium">Connected — {tokenLabel}</span>
              </div>
              <button
                onClick={handleDisconnect}
                className="text-xs text-destructive hover:underline flex items-center gap-1"
              >
                <Unplug className="w-3 h-3" /> Disconnect
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">JOOR API token</label>
                <Input
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="Paste your JOOR API token here"
                  type="password"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Find this in JOOR → Settings → Integrations → API token. Contact your JOOR account manager if you don't see it.
                </p>
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">Label (optional)</label>
                <Input
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  placeholder="e.g. Splash Swimwear - AUS"
                />
              </div>

              <Button onClick={handleConnect} disabled={testing} className="w-full">
                {testing ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Testing connection...</>
                ) : (
                  "Test & Connect"
                )}
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── STEP: ORDER DETAIL ───
  if (step === "detail" && activeOrder) {
    return (
      <div className="px-4 pt-4 pb-24 animate-fade-in max-w-4xl mx-auto">
        <button
          onClick={() => { setStep("orders"); setActiveOrder(null); }}
          className="flex items-center gap-1 text-muted-foreground text-sm mb-4 hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" /> Back to orders
        </button>

        <div className="bg-card rounded-lg border border-border p-5 mb-4">
          <h2 className="text-lg font-semibold font-display">
            Order #{activeOrder.order_id}
          </h2>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-muted-foreground">
            {activeOrder.brand && <span>{activeOrder.brand}</span>}
            {activeOrder.order_season_code && <span>{activeOrder.order_season_code}</span>}
            {activeOrder.order_delivery_name && <span>{activeOrder.order_delivery_name}</span>}
          </div>
          {activeOrder.retailer?.customer_name && (
            <p className="text-sm mt-1">Retailer: {activeOrder.retailer.customer_name}</p>
          )}
          <p className="text-sm font-medium mt-2">
            Total: {activeOrder.order_currency} ${activeOrder.order_total?.toFixed(2)}
          </p>
        </div>

        {/* Product table */}
        <div className="bg-card rounded-lg border border-border overflow-hidden mb-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left p-3 font-medium">Style</th>
                  <th className="text-left p-3 font-medium">Style #</th>
                  <th className="text-left p-3 font-medium">Colour</th>
                  <th className="text-left p-3 font-medium">Sizes</th>
                  <th className="text-right p-3 font-medium">RRP</th>
                  <th className="text-right p-3 font-medium">Wholesale</th>
                </tr>
              </thead>
              <tbody>
                {groupedProducts.map((p, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        {p.imageUrl && (
                          <img src={p.imageUrl} alt="" className="w-10 h-10 rounded object-cover" />
                        )}
                        <span className="font-medium">{p.title}</span>
                      </div>
                    </td>
                    <td className="p-3 font-mono text-xs">{p.sku.split("-")[0]}</td>
                    <td className="p-3">{p.colour}</td>
                    <td className="p-3 text-xs">{p.sizes?.join(", ") || p.size}</td>
                    <td className="p-3 text-right">${p.price}</td>
                    <td className="p-3 text-right text-muted-foreground">${p.costPrice}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pushing progress */}
        {pushing && (
          <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span className="text-sm font-medium">
                Pushing products to Shopify ({pushProgress.current} / {pushProgress.total})...
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className="bg-primary rounded-full h-2 transition-all"
                style={{ width: `${(pushProgress.current / pushProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Button variant="outline" onClick={() => downloadCSV("shopify")} disabled={pushing}>
            <Download className="w-4 h-4 mr-2" /> Shopify CSV
          </Button>
          <Button variant="outline" onClick={() => downloadCSV("lightspeed")} disabled={pushing}>
            <Download className="w-4 h-4 mr-2" /> Lightspeed CSV
          </Button>
          <Button
            onClick={() => {
              if (confirm(`Push ${groupedProducts.length} products from this order to Shopify?`)) {
                pushToShopify(groupedProducts);
              }
            }}
            disabled={pushing}
          >
            <Upload className="w-4 h-4 mr-2" /> Push all to Shopify
          </Button>
          <Button
            variant="secondary"
            onClick={() => markExported(activeOrder.order_id)}
            disabled={pushing}
          >
            <Check className="w-4 h-4 mr-2" /> Mark as processed
          </Button>
        </div>
      </div>
    );
  }

  // ─── STEP: ORDER LIST ───
  return (
    <div className="px-4 pt-4 pb-24 animate-fade-in max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <button onClick={onBack} className="flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-success flex items-center gap-1">
            <Check className="w-3 h-3" /> JOOR connected
          </span>
          <span className="text-muted-foreground">— {tokenLabel}</span>
        </div>
      </div>

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold font-display">JOOR Orders</h1>
        <Button variant="outline" size="sm" onClick={loadOrders} disabled={ordersLoading}>
          <RefreshCw className={`w-4 h-4 mr-1.5 ${ordersLoading ? "animate-spin" : ""}`} />
          Pull latest
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search brand or order ID..."
            className="pl-9 h-9"
          />
        </div>
        <select
          value={seasonFilter}
          onChange={(e) => setSeasonFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">All seasons</option>
          {uniqueSeasons.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">All orders</option>
          <option value="unprocessed">Unprocessed</option>
          <option value="processed">Processed</option>
        </select>
      </div>

      {ordersLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-primary mr-2" />
          <span className="text-sm text-muted-foreground">Fetching orders from JOOR...</span>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="text-center py-12 bg-card rounded-lg border border-border">
          <Package className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground mb-2">
            No unprocessed orders found in JOOR.
          </p>
          <p className="text-xs text-muted-foreground mb-4">
            Orders appear here once they are marked as Approved in JOOR.
          </p>
          <Button variant="outline" size="sm" onClick={loadOrders}>
            <RefreshCw className="w-4 h-4 mr-1.5" /> Refresh
          </Button>
        </div>
      ) : (
        <>
          {/* Orders table */}
          <div className="bg-card rounded-lg border border-border overflow-hidden mb-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="p-3 w-8">
                      <input
                        type="checkbox"
                        checked={selectedOrders.size === filteredOrders.length && filteredOrders.length > 0}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedOrders(new Set(filteredOrders.map((o) => o.order_id)));
                          } else {
                            setSelectedOrders(new Set());
                          }
                        }}
                        className="rounded"
                      />
                    </th>
                    <th className="text-left p-3 font-medium">Order</th>
                    <th className="text-left p-3 font-medium">Brand</th>
                    <th className="text-left p-3 font-medium">Season</th>
                    <th className="text-left p-3 font-medium">Collection</th>
                    <th className="text-right p-3 font-medium">Items</th>
                    <th className="text-right p-3 font-medium">Total</th>
                    <th className="text-center p-3 font-medium">Status</th>
                    <th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => (
                    <tr key={order.order_id} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={selectedOrders.has(order.order_id)}
                          onChange={(e) => {
                            const next = new Set(selectedOrders);
                            if (e.target.checked) next.add(order.order_id);
                            else next.delete(order.order_id);
                            setSelectedOrders(next);
                          }}
                          className="rounded"
                        />
                      </td>
                      <td className="p-3 font-mono text-xs">#{order.order_id}</td>
                      <td className="p-3">{order.brand || "—"}</td>
                      <td className="p-3">{order.order_season_code || "—"}</td>
                      <td className="p-3 text-xs">{order.order_delivery_name || "—"}</td>
                      <td className="p-3 text-right">{order.line_items?.length || 0}</td>
                      <td className="p-3 text-right">
                        {order.order_currency} ${order.order_total?.toFixed(2)}
                      </td>
                      <td className="p-3 text-center">
                        {order._processed ? (
                          <span className="text-xs bg-muted px-2 py-0.5 rounded-full">Processed</span>
                        ) : (
                          <span className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">Ready</span>
                        )}
                      </td>
                      <td className="p-3">
                        <Button size="sm" variant="ghost" onClick={() => openOrderDetail(order)}>
                          Review <ChevronRight className="w-3 h-3 ml-1" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bulk actions */}
          {selectedOrders.size > 0 && (
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg border border-border">
              <span className="text-sm font-medium">{selectedOrders.size} selected</span>
              <Button size="sm" variant="outline" onClick={handleBulkDownload}>
                <Download className="w-3 h-3 mr-1.5" /> Combined CSV
              </Button>
              <Button size="sm" onClick={handleBulkPush} disabled={pushing}>
                <Upload className="w-3 h-3 mr-1.5" /> Push selected to Shopify
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default JoorFlow;
