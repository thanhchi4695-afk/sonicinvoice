import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import type { WholesaleOrder, WholesaleLineItem } from "@/lib/unified-types";
import type { InvoiceLineItem } from "@/lib/stock-matcher";
import StockCheckFlow from "@/components/StockCheckFlow";
import {
  buildWholesaleShopifyCSV,
  buildWholesaleLightspeedCSV,
} from "@/lib/wholesale-mapper";
import {
  parseJoorOrders,
  parseNuOrderCSV,
  parseBrandscopeCSV,
  parseBrandboomCSV,
  parseFaireOrders,
  parseGenericCSV,
  detectPlatform,
} from "@/lib/wholesale-parsers";
import { toast } from "sonner";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  ArrowLeft, Check, Loader2, RefreshCw, Download,
  Upload, Search, ChevronRight, Link2, Unplug,
  Package, FileUp, Globe, FileSpreadsheet, PackageCheck,
} from "lucide-react";

interface Props {
  onBack: () => void;
}

type Platform = "joor" | "nuorder" | "brandscope" | "brandboom" | "faire" | "csv" | "lookbook";
type Screen = "select" | "connect_api" | "upload_csv" | "orders" | "detail";

const PLATFORMS: {
  id: Platform;
  name: string;
  method: "api" | "csv";
  geo: string;
  brands: string;
}[] = [
  { id: "joor", name: "JOOR", method: "api", geo: "Global (fashion)", brands: "Funkita, Seafolly, Speedo, Billabong, Rip Curl" },
  { id: "nuorder", name: "NuOrder", method: "csv", geo: "Global (surf/action)", brands: "Quiksilver, RVCA, Volcom, O'Neill" },
  { id: "brandscope", name: "Brandscope", method: "csv", geo: "AU/NZ (swim & resort)", brands: "Watercult, Seafolly, Roxy, Billabong" },
  { id: "brandboom", name: "Brandboom", method: "csv", geo: "US (indie fashion)", brands: "Independent fashion brands, US designers" },
  { id: "faire", name: "Faire", method: "api", geo: "Global (boutique)", brands: "Independent boutique, gift & homewares" },
  { id: "csv", name: "Generic CSV", method: "csv", geo: "Any platform", brands: "Any brand — email orders, Excel invoices" },
  { id: "lookbook", name: "Lookbook / Image Link", method: "csv", geo: "Dropbox, Drive, OneDrive", brands: "Paste a cloud link — AI extracts products from images" },
];

const WholesaleImportFlow = ({ onBack }: Props) => {
  const [screen, setScreen] = useState<Screen>("select");
  const [activePlatform, setActivePlatform] = useState<Platform | null>(null);
  const [connections, setConnections] = useState<Record<string, { label: string; lastSynced: string | null }>>({});
  const [loading, setLoading] = useState(true);

  // Connect
  const [tokenInput, setTokenInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [testing, setTesting] = useState(false);

  // Orders
  const [orders, setOrders] = useState<WholesaleOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [seasonFilter, setSeasonFilter] = useState("all");
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());

  // Detail
  const [activeOrder, setActiveOrder] = useState<WholesaleOrder | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushProgress, setPushProgress] = useState({ current: 0, total: 0 });
  const [stockCheckItems, setStockCheckItems] = useState<InvoiceLineItem[] | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadConnections();
  }, []);

  const loadConnections = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }
      const { data } = await supabase
        .from("wholesale_connections")
        .select("platform, label, last_synced")
        .eq("user_id", session.user.id);
      const map: Record<string, { label: string; lastSynced: string | null }> = {};
      (data || []).forEach((c: any) => {
        map[c.platform] = { label: c.label || c.platform, lastSynced: c.last_synced };
      });
      setConnections(map);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const callProxy = async (action: string, platform: string, params?: Record<string, unknown>) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const res = await fetch(
      `https://${projectId}.supabase.co/functions/v1/wholesale-proxy`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action, platform, params }),
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };

  // ── API connect (JOOR / Faire) ──
  const handleApiConnect = async () => {
    if (!tokenInput.trim() || !activePlatform) return;
    setTesting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const credentials = activePlatform === "joor"
        ? { oauth_token: tokenInput.trim() }
        : { api_key: tokenInput.trim() };

      await supabase.from("wholesale_connections").upsert({
        user_id: session.user.id,
        platform: activePlatform,
        label: labelInput.trim() || null,
        credentials,
      }, { onConflict: "user_id,platform" });

      await callProxy("test", activePlatform);

      setConnections((prev) => ({
        ...prev,
        [activePlatform]: { label: labelInput.trim() || activePlatform, lastSynced: null },
      }));
      toast.success(`Connected to ${activePlatform.toUpperCase()}`);

      // Load orders
      await loadApiOrders(activePlatform);
      setScreen("orders");
    } catch (e: any) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session && activePlatform) {
        await supabase.from("wholesale_connections")
          .delete()
          .eq("user_id", session.user.id)
          .eq("platform", activePlatform);
      }
      toast.error(e.message || "Connection failed");
    }
    setTesting(false);
  };

  const handleDisconnect = async (platform: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await supabase.from("wholesale_connections").delete()
      .eq("user_id", session.user.id).eq("platform", platform);
    setConnections((prev) => { const next = { ...prev }; delete next[platform]; return next; });
    toast.success(`${platform} disconnected`);
  };

  const loadApiOrders = async (platform: string) => {
    setOrdersLoading(true);
    try {
      const data = await callProxy("get_orders", platform);
      let parsed: WholesaleOrder[] = [];
      if (platform === "joor") parsed = parseJoorOrders(data);
      else if (platform === "faire") parsed = parseFaireOrders(data);
      setOrders(parsed);

      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await supabase.from("wholesale_connections")
          .update({ last_synced: new Date().toISOString() })
          .eq("user_id", session.user.id)
          .eq("platform", platform);
      }
    } catch (e: any) {
      toast.error(e.message || "Failed to load orders");
    }
    setOrdersLoading(false);
  };

  // ── CSV upload ──
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activePlatform) return;

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const wb = XLSX.read(ev.target?.result, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });
        processCSVRows(rows);
      };
      reader.readAsArrayBuffer(file);
    } else {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => processCSVRows(result.data as Record<string, string>[]),
        error: () => toast.error("Failed to parse CSV file"),
      });
    }
  };

  const processCSVRows = (rows: Record<string, string>[]) => {
    if (!rows.length) { toast.error("No data found in file"); return; }

    let platform = activePlatform || "csv";
    if (platform === "csv") {
      const headers = Object.keys(rows[0]);
      platform = detectPlatform(headers) as Platform;
    }

    let parsed: WholesaleOrder[] = [];
    switch (platform) {
      case "nuorder": parsed = parseNuOrderCSV(rows); break;
      case "brandscope": parsed = parseBrandscopeCSV(rows); break;
      case "brandboom": parsed = parseBrandboomCSV(rows); break;
      default: parsed = parseGenericCSV(rows); break;
    }

    if (!parsed.length) { toast.error("No orders found in file"); return; }

    setOrders(parsed);
    const totalItems = parsed.reduce((s, o) => s + o.lineItems.length, 0);
    toast.success(`${parsed.length} order(s) imported (${totalItems} line items)`);
    import("@/lib/image-seo-trigger").then(m => m.dispatchImageSeoTrigger({ source: "wholesale", productCount: totalItems }));
    setScreen("orders");
  };

  // ── Downloads ──
  const downloadCSV = (type: "shopify" | "lightspeed", targetOrders: WholesaleOrder[]) => {
    const csv = type === "shopify"
      ? buildWholesaleShopifyCSV(targetOrders)
      : buildWholesaleLightspeedCSV(targetOrders);
    const platform = targetOrders[0]?.platform || "wholesale";
    const date = new Date().toISOString().slice(0, 10);
    const filename = `${platform}-${type}-${date}.csv`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    const count = targetOrders.reduce((s, o) => s + o.lineItems.length, 0);
    toast.success(`${type === "shopify" ? "Shopify" : "Lightspeed"} CSV downloaded (${count} items)`);
  };

  // ── Stock check before push ──
  const startStockCheck = (targetOrders: WholesaleOrder[]) => {
    const allItems = targetOrders.flatMap((o) => o.lineItems);
    const converted: InvoiceLineItem[] = allItems.map((it) => ({
      styleNumber: it.styleNumber,
      styleName: it.styleName,
      colour: it.colour,
      colourCode: it.colourCode,
      size: it.size,
      barcode: it.barcode,
      sku: `${it.styleNumber}-${it.colourCode || it.colour}-${it.size}`.toUpperCase().replace(/\s+/g, "-"),
      brand: it.brand,
      quantityOrdered: it.quantityOrdered,
      rrp: it.rrp,
      wholesale: it.wholesale,
      imageUrl: it.imageUrl || undefined,
      description: it.description || undefined,
      productType: it.productType || undefined,
      season: it.season || undefined,
      collection: it.collection || undefined,
    }));
    setStockCheckItems(converted);
  };

  // ── Push to Shopify ──
  const pushToShopify = async (targetOrders: WholesaleOrder[]) => {
    const allItems = targetOrders.flatMap((o) => o.lineItems);
    // Group by style+colour
    const grouped = new Map<string, typeof allItems>();
    for (const item of allItems) {
      const key = `${item.styleNumber}||${item.colour}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(item);
    }

    const products = Array.from(grouped.values());
    setPushing(true);
    setPushProgress({ current: 0, total: products.length });
    let errors = 0;

    for (let i = 0; i < products.length; i++) {
      setPushProgress({ current: i + 1, total: products.length });
      const items = products[i];
      const first = items[0];
      try {
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
                title: first.styleName,
                vendor: first.brand,
                product_type: first.productType,
                body_html: first.description,
                status: "draft",
                tags: [first.brand, first.colour, first.collection, "full_price", "new"].filter(Boolean).join(", "),
                variants: items.map((it) => ({
                  sku: `${it.styleNumber}-${it.colourCode || it.colour}-${it.size}`.toUpperCase().replace(/\s+/g, "-"),
                  price: it.rrp.toFixed(2),
                  cost: it.wholesale.toFixed(2),
                  barcode: it.barcode,
                  option1: it.colour,
                  option2: it.size,
                })),
                options: [
                  { name: "Colour", values: [...new Set(items.map((it) => it.colour))] },
                  { name: "Size", values: [...new Set(items.map((it) => it.size))] },
                ],
              },
            }),
          }
        );

        if (res.status === 429) {
          toast.info("Rate limited — retrying...");
          await new Promise((r) => setTimeout(r, 2000));
          i--;
          continue;
        }
        if (!res.ok) errors++;
      } catch {
        errors++;
      }
    }

    setPushing(false);
    if (errors > 0) toast.warning(`${products.length - errors} pushed, ${errors} failed`);
    else toast.success(`${products.length} products pushed to Shopify`);
  };

  // ── Filtering ──
  const filteredOrders = orders.filter((o) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!o.orderId.toLowerCase().includes(q) && !o.brandName.toLowerCase().includes(q)) return false;
    }
    if (seasonFilter !== "all" && o.season !== seasonFilter) return false;
    return true;
  });

  const uniqueSeasons = [...new Set(orders.map((o) => o.season).filter(Boolean))];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  // ═══ SCREEN: PLATFORM SELECTOR ═══
  if (screen === "select") {
    return (
      <div className="px-4 pt-4 pb-24 animate-fade-in max-w-3xl mx-auto">
        <button onClick={onBack} className="flex items-center gap-1 text-muted-foreground text-sm mb-4 hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <h1 className="text-xl font-semibold font-display mb-1">Wholesale Import</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Import orders from any wholesale platform and push products to Shopify in one click.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {PLATFORMS.map((p) => {
            const isConnected = !!connections[p.id];
            return (
              <div
                key={p.id}
                className="bg-card rounded-lg border border-border p-4 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                      {p.name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm">{p.name}</h3>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                        p.method === "api"
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground"
                      }`}>
                        {p.method === "api" ? "Live API" : "CSV Upload"}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mb-1">{p.geo}</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{p.brands}</p>
                </div>

                <div className="mt-3 space-y-1.5">
                  {isConnected && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-success flex items-center gap-1">
                        <Check className="w-3 h-3" /> Connected
                      </span>
                      <button onClick={() => handleDisconnect(p.id)} className="text-[10px] text-destructive hover:underline">
                        Disconnect
                      </button>
                    </div>
                  )}
                  <Button
                    size="sm"
                    variant={isConnected ? "outline" : "default"}
                    className="w-full"
                    onClick={() => {
                      setActivePlatform(p.id);
                      setTokenInput("");
                      setLabelInput("");
                      if (p.method === "api" && !isConnected) {
                        setScreen("connect_api");
                      } else if (p.method === "api" && isConnected) {
                        loadApiOrders(p.id);
                        setScreen("orders");
                      } else {
                        setScreen("upload_csv");
                      }
                    }}
                  >
                    {isConnected && p.method === "api" ? "Pull orders" : p.method === "api" ? "Connect" : "Upload CSV"}
                    <ChevronRight className="w-3 h-3 ml-1" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ═══ SCREEN: API CONNECTION ═══
  if (screen === "connect_api" && activePlatform) {
    const isJoor = activePlatform === "joor";
    return (
      <div className="px-4 pt-4 pb-24 animate-fade-in max-w-xl mx-auto">
        <button onClick={() => setScreen("select")} className="flex items-center gap-1 text-muted-foreground text-sm mb-4 hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <div className="bg-card rounded-lg border border-border p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-11 h-11 rounded-lg bg-primary/15 flex items-center justify-center">
              <Link2 className="w-5 h-5 text-primary" />
            </div>
            <h1 className="text-xl font-semibold font-display">
              Connect {isJoor ? "JOOR" : "Faire"}
            </h1>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                {isJoor ? "JOOR API token" : "Faire API key"}
              </label>
              <Input
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder={isJoor ? "Paste your JOOR API token here" : "Paste your Faire API key"}
                type="password"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {isJoor
                  ? "Find this in JOOR → Settings → Integrations → API token. Contact your JOOR account manager if you don't see it."
                  : "Find this in Faire Brand Portal → Integrations → API → Generate key."}
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
            <Button onClick={handleApiConnect} disabled={testing} className="w-full">
              {testing ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Testing...</> : "Test & Connect"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ═══ SCREEN: CSV UPLOAD ═══
  if (screen === "upload_csv" && activePlatform) {
    const platformInfo = PLATFORMS.find((p) => p.id === activePlatform);
    const instructions: Record<string, string> = {
      nuorder: "In NuOrder: Orders → Select orders → Download → Choose 'Standard CSV' format. Upload the file below.",
      brandscope: "In Brandscope: Orders → Select orders → Export → Download as .xlsx or .csv. Upload the file below.",
      brandboom: "In Brandboom: Orders → Export Orders as Files → Select CSV format. Upload the file below.",
      csv: "Upload any CSV or Excel file with order data. The app will auto-detect the column format.",
    };

    return (
      <div className="px-4 pt-4 pb-24 animate-fade-in max-w-xl mx-auto">
        <button onClick={() => setScreen("select")} className="flex items-center gap-1 text-muted-foreground text-sm mb-4 hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <div className="bg-card rounded-lg border border-border p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-11 h-11 rounded-lg bg-primary/15 flex items-center justify-center">
              <FileUp className="w-5 h-5 text-primary" />
            </div>
            <h1 className="text-xl font-semibold font-display">
              Upload {platformInfo?.name || "CSV"} order export
            </h1>
          </div>

          <p className="text-sm text-muted-foreground mb-4">
            {instructions[activePlatform] || instructions.csv}
          </p>

          <div
            className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file) {
                const input = fileInputRef.current;
                if (input) {
                  const dt = new DataTransfer();
                  dt.items.add(file);
                  input.files = dt.files;
                  input.dispatchEvent(new Event("change", { bubbles: true }));
                }
              }
            }}
          >
            <FileSpreadsheet className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-medium mb-1">Drop file here or click to browse</p>
            <p className="text-xs text-muted-foreground">Accepts .csv, .xlsx, .xls</p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={handleFileUpload}
          />
        </div>
      </div>
    );
  }

  // ═══ SCREEN: ORDER DETAIL ═══
  if (screen === "detail" && activeOrder) {
    return (
      <div className="px-4 pt-4 pb-24 animate-fade-in max-w-4xl mx-auto">
        <button
          onClick={() => { setScreen("orders"); setActiveOrder(null); }}
          className="flex items-center gap-1 text-muted-foreground text-sm mb-4 hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" /> Back to orders
        </button>

        <div className="bg-card rounded-lg border border-border p-5 mb-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary uppercase font-medium">
              {activeOrder.platform}
            </span>
            <h2 className="text-lg font-semibold font-display">Order #{activeOrder.orderId}</h2>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {activeOrder.brandName && <span>{activeOrder.brandName}</span>}
            {activeOrder.season && <span>{activeOrder.season}</span>}
            {activeOrder.collection && <span>{activeOrder.collection}</span>}
          </div>
          {activeOrder.retailerName && <p className="text-sm mt-1">Retailer: {activeOrder.retailerName}</p>}
          <p className="text-sm font-medium mt-2">
            Total: {activeOrder.currency} ${activeOrder.orderTotal.toFixed(2)} · {activeOrder.lineItems.length} items
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
                  <th className="text-left p-3 font-medium">Size</th>
                  <th className="text-right p-3 font-medium">Qty</th>
                  <th className="text-right p-3 font-medium">RRP</th>
                  <th className="text-right p-3 font-medium">Wholesale</th>
                </tr>
              </thead>
              <tbody>
                {activeOrder.lineItems.map((item, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        {item.imageUrl && <img src={item.imageUrl} alt="" className="w-8 h-8 rounded object-cover" />}
                        <span className="font-medium text-xs">{item.styleName}</span>
                      </div>
                    </td>
                    <td className="p-3 font-mono text-xs">{item.styleNumber}</td>
                    <td className="p-3 text-xs">{item.colour}</td>
                    <td className="p-3 text-xs">{item.size}</td>
                    <td className="p-3 text-right text-xs">{item.quantityOrdered}</td>
                    <td className="p-3 text-right text-xs">${item.rrp.toFixed(2)}</td>
                    <td className="p-3 text-right text-xs text-muted-foreground">${item.wholesale.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {pushing && (
          <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span className="text-sm font-medium">Pushing to Shopify ({pushProgress.current} / {pushProgress.total})...</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div className="bg-primary rounded-full h-2 transition-all" style={{ width: `${(pushProgress.current / pushProgress.total) * 100}%` }} />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Button variant="outline" onClick={() => downloadCSV("shopify", [activeOrder])} disabled={pushing}>
            <Download className="w-4 h-4 mr-2" /> Shopify CSV
          </Button>
          <Button variant="outline" onClick={() => downloadCSV("lightspeed", [activeOrder])} disabled={pushing}>
            <Download className="w-4 h-4 mr-2" /> Lightspeed CSV
          </Button>
          <Button
            onClick={() => {
              if (confirm(`Push ${activeOrder.lineItems.length} items from this order to Shopify?`)) {
                pushToShopify([activeOrder]);
              }
            }}
            disabled={pushing}
          >
            <Upload className="w-4 h-4 mr-2" /> Push to Shopify
          </Button>
          <Button variant="secondary" onClick={() => { setScreen("orders"); setActiveOrder(null); }} disabled={pushing}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to list
          </Button>
        </div>
      </div>
    );
  }

  // ═══ SCREEN: ORDER LIST ═══
  return (
    <div className="px-4 pt-4 pb-24 animate-fade-in max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => { setScreen("select"); setOrders([]); }} className="flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Platforms
        </button>
        {activePlatform && PLATFORMS.find((p) => p.id === activePlatform)?.method === "api" && (
          <Button variant="outline" size="sm" onClick={() => loadApiOrders(activePlatform)} disabled={ordersLoading}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${ordersLoading ? "animate-spin" : ""}`} /> Pull latest
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2 mb-4">
        <h1 className="text-xl font-semibold font-display">Orders</h1>
        <span className="text-xs bg-muted px-2 py-0.5 rounded-full">{orders.length}</span>
        {activePlatform && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary uppercase font-medium">
            {activePlatform}
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search brand or order ID..." className="pl-9 h-9" />
        </div>
        {uniqueSeasons.length > 1 && (
          <select value={seasonFilter} onChange={(e) => setSeasonFilter(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="all">All seasons</option>
            {uniqueSeasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>

      {ordersLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-primary mr-2" />
          <span className="text-sm text-muted-foreground">Loading orders...</span>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="text-center py-12 bg-card rounded-lg border border-border">
          <Package className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground mb-2">No orders found.</p>
          <p className="text-xs text-muted-foreground mb-4">Try uploading a different file or pulling orders from the platform.</p>
        </div>
      ) : (
        <>
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
                          setSelectedOrders(e.target.checked ? new Set(filteredOrders.map((o) => o.orderId)) : new Set());
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
                    <th className="text-left p-3 font-medium">Source</th>
                    <th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => (
                    <tr key={order.orderId + order.platform} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={selectedOrders.has(order.orderId)}
                          onChange={(e) => {
                            const next = new Set(selectedOrders);
                            if (e.target.checked) next.add(order.orderId); else next.delete(order.orderId);
                            setSelectedOrders(next);
                          }}
                          className="rounded"
                        />
                      </td>
                      <td className="p-3 font-mono text-xs">#{order.orderId}</td>
                      <td className="p-3 text-xs">{order.brandName || "—"}</td>
                      <td className="p-3 text-xs">{order.season || "—"}</td>
                      <td className="p-3 text-xs">{order.collection || "—"}</td>
                      <td className="p-3 text-right text-xs">{order.lineItems.length}</td>
                      <td className="p-3 text-right text-xs">{order.currency} ${order.orderTotal.toFixed(2)}</td>
                      <td className="p-3">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted uppercase">{order.platform}</span>
                      </td>
                      <td className="p-3">
                        <Button size="sm" variant="ghost" onClick={() => { setActiveOrder(order); setScreen("detail"); }}>
                          Review <ChevronRight className="w-3 h-3 ml-1" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {selectedOrders.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 p-3 bg-muted/50 rounded-lg border border-border">
              <span className="text-sm font-medium">{selectedOrders.size} selected</span>
              <Button size="sm" variant="outline" onClick={() => {
                const sel = orders.filter((o) => selectedOrders.has(o.orderId));
                downloadCSV("shopify", sel);
              }}>
                <Download className="w-3 h-3 mr-1.5" /> Shopify CSV
              </Button>
              <Button size="sm" variant="outline" onClick={() => {
                const sel = orders.filter((o) => selectedOrders.has(o.orderId));
                downloadCSV("lightspeed", sel);
              }}>
                <Download className="w-3 h-3 mr-1.5" /> Lightspeed CSV
              </Button>
              <Button size="sm" onClick={() => {
                const sel = orders.filter((o) => selectedOrders.has(o.orderId));
                if (confirm(`Push ${sel.reduce((s, o) => s + o.lineItems.length, 0)} items to Shopify?`)) {
                  pushToShopify(sel);
                }
              }} disabled={pushing}>
                <Upload className="w-3 h-3 mr-1.5" /> Push to Shopify
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default WholesaleImportFlow;
