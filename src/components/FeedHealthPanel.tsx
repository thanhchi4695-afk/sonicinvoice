import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import WhatsNextSuggestions from "@/components/WhatsNextSuggestions";
import { ChevronLeft, Activity, Check, AlertTriangle, Loader2, Eye, ShoppingCart, Pencil, Store, Download, Upload, ExternalLink, Copy, ChevronDown, ChevronUp, Globe, Image as ImageIcon, CheckCircle2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getActiveDirectStore } from "@/lib/shopify-direct";
import Papa from "papaparse";
import {
  type FeedHealthProduct,
  type FeedHealthRow,
  type DetectedAttributes,
  detectAttributes,
  parseShopifyProduct,
} from "@/lib/feed-health";

type Step = "idle" | "scanning" | "reviewing" | "pushing" | "done" | "currency";

interface ScanStats {
  female: number; male: number; unisex: number;
  adult: number; kids: number; other_age: number;
  colorFound: number; colorMissing: number;
}

export default function FeedHealthPanel({ onBack, onStartFlow }: { onBack: () => void; onStartFlow?: (flow: string) => void }) {
  const [step, setStep] = useState<Step>("idle");
  const [rows, setRows] = useState<FeedHealthRow[]>([]);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 });
  const [scanStats, setScanStats] = useState<ScanStats>({ female: 0, male: 0, unisex: 0, adult: 0, kids: 0, other_age: 0, colorFound: 0, colorMissing: 0 });
  const [pushProgress, setPushProgress] = useState({ done: 0, total: 0, failed: 0 });
  const [tab, setTab] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [namespace, setNamespace] = useState("custom");
  const [detailRow, setDetailRow] = useState<FeedHealthRow | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [altEditRow, setAltEditRow] = useState<FeedHealthRow | null>(null);
  const [altDraft, setAltDraft] = useState("");
  const [altSaving, setAltSaving] = useState(false);

  // Currency diagnostic state
  const [primaryCountry, setPrimaryCountry] = useState("Australia");
  const [primaryCurrency, setPrimaryCurrency] = useState("AUD");
  const [secondaryCountries, setSecondaryCountries] = useState<{ country: string; currency: string }[]>([]);
  const [testUrl, setTestUrl] = useState("");
  const [showCurrencyGuide, setShowCurrencyGuide] = useState(false);

  const directStore = getActiveDirectStore();

  // Helper to call the appropriate proxy
  const callProxy = async (body: Record<string, unknown>) => {
    if (directStore) {
      const { data, error } = await supabase.functions.invoke("shopify-direct-proxy", {
        body: { store_url: directStore.storeUrl, token: directStore.token, ...body },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data;
    }
    const { data, error } = await supabase.functions.invoke("shopify-proxy", { body });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data;
  };

  // ── LIVE STATS UPDATER ──────────────────────────
  const computeLiveStats = (allRows: FeedHealthRow[]): ScanStats => {
    const stats: ScanStats = { female: 0, male: 0, unisex: 0, adult: 0, kids: 0, other_age: 0, colorFound: 0, colorMissing: 0 };
    for (const r of allRows) {
      if (r.detected.gender === "female") stats.female++;
      else if (r.detected.gender === "male") stats.male++;
      else stats.unisex++;
      if (r.detected.ageGroup === "adult") stats.adult++;
      else if (r.detected.ageGroup === "kids") stats.kids++;
      else stats.other_age++;
      if (r.detected.color) stats.colorFound++;
      else stats.colorMissing++;
    }
    return stats;
  };

  // ── SCAN VIA API ──────────────────────────────
  const startScan = async () => {
    setStep("scanning");
    setScanProgress({ done: 0, total: 0 });
    setRows([]);
    setScanStats({ female: 0, male: 0, unisex: 0, adult: 0, kids: 0, other_age: 0, colorFound: 0, colorMissing: 0 });

    const allProducts: FeedHealthRow[] = [];
    let pageInfo: string | null = null;
    let totalFetched = 0;

    try {
      do {
        const data = await callProxy({
          action: "get_products_page",
          limit: 250,
          page_info: pageInfo || undefined,
        });

        const products = (data.products || []).map((raw: any) => {
          const product = parseShopifyProduct(raw);
          const detected = detectAttributes(product);
          return { product, detected, pushed: false, edited: false } as FeedHealthRow;
        });

        allProducts.push(...products);
        totalFetched += products.length;
        pageInfo = data.nextPageInfo || null;

        setScanProgress({ done: totalFetched, total: totalFetched + (pageInfo ? 250 : 0) });
        setRows([...allProducts]);
        setScanStats(computeLiveStats(allProducts));

        if (pageInfo) await new Promise(r => setTimeout(r, 300));
      } while (pageInfo);

      setScanProgress({ done: totalFetched, total: totalFetched });
      setStep("reviewing");
      toast.success(`Scanned ${totalFetched} products`);
    } catch (err) {
      console.error("Scan error:", err);
      toast.error(err instanceof Error ? err.message : "Scan failed");
      if (allProducts.length > 0) setStep("reviewing");
      else setStep("idle");
    }
  };

  // ── SCAN VIA CSV UPLOAD ──────────────────────────
  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStep("scanning");
    setScanProgress({ done: 0, total: 0 });

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const csvRows = result.data as Record<string, string>[];
        const allProducts: FeedHealthRow[] = [];

        for (const row of csvRows) {
          const handle = row["Handle"] || row["handle"] || "";
          const title = row["Title"] || row["title"] || "";
          if (!handle && !title) continue;

          const tags = (row["Tags"] || row["tags"] || "").split(",").map(t => t.trim()).filter(Boolean);
          const product: FeedHealthProduct = {
            id: `csv-${handle || allProducts.length}`,
            title,
            handle,
            vendor: row["Vendor"] || row["vendor"] || "",
            productType: row["Type"] || row["Product Type"] || row["product_type"] || "",
            tags,
            imageUrl: row["Image Src"] || row["image_src"] || null,
            variants: [],
          };
          const detected = detectAttributes(product);
          allProducts.push({ product, detected, pushed: false, edited: false });
        }

        setRows(allProducts);
        setScanStats(computeLiveStats(allProducts));
        setScanProgress({ done: allProducts.length, total: allProducts.length });
        setStep("reviewing");
        toast.success(`Loaded ${allProducts.length} products from CSV`);
      },
      error: () => {
        toast.error("Failed to parse CSV");
        setStep("idle");
      },
    });
    if (fileRef.current) fileRef.current.value = "";
  };

  // ── MATRIXIFY CSV EXPORT ──────────────────────────
  const exportMatrixifyCsv = () => {
    const csvRows: Record<string, string>[] = [];
    for (const r of rows) {
      csvRows.push({
        "Handle": r.product.handle,
        "Command": "MERGE",
        "Title": r.product.title,
        [`Metafield: ${namespace}.gender [single_line_text]`]: r.detected.gender || "",
        [`Metafield: ${namespace}.age_group [single_line_text]`]: r.detected.ageGroup || "",
        [`Metafield: ${namespace}.color [single_line_text]`]: r.detected.color || "",
      });
    }
    const csv = Papa.unparse(csvRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Products.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${csvRows.length} products for Matrixify`);
  };

  // ── PUSH METAFIELDS ──────────────────────────────
  const pushMetafields = async (ids?: string[]) => {
    const toPush = ids ? rows.filter(r => ids.includes(r.product.id)) : rows;
    if (toPush.length === 0) return;

    setStep("pushing");
    setPushProgress({ done: 0, total: toPush.length, failed: 0 });

    const BATCH = 8;
    let success = 0;
    let failed = 0;

    for (let i = 0; i < toPush.length; i += BATCH) {
      const batch = toPush.slice(i, i + BATCH);
      const metafields = batch.flatMap(r => {
        const mf: Array<{ ownerId: string; namespace: string; key: string; value: string; type: string }> = [];
        if (r.detected.gender) mf.push({ ownerId: r.product.id, namespace, key: "gender", value: r.detected.gender, type: "single_line_text_field" });
        if (r.detected.ageGroup) mf.push({ ownerId: r.product.id, namespace, key: "age_group", value: r.detected.ageGroup, type: "single_line_text_field" });
        if (r.detected.color) mf.push({ ownerId: r.product.id, namespace, key: "color", value: r.detected.color, type: "single_line_text_field" });
        return mf;
      });
      if (metafields.length === 0) { success += batch.length; continue; }
      try {
        await callProxy({ action: "set_metafields", metafields });
        success += batch.length;
        setRows(prev => prev.map(r => batch.find(b => b.product.id === r.product.id) ? { ...r, pushed: true } : r));
      } catch { failed += batch.length; }
      setPushProgress({ done: success + failed, total: toPush.length, failed });
      if (i + BATCH < toPush.length) await new Promise(r => setTimeout(r, 500));
    }

    setPushProgress({ done: success + failed, total: toPush.length, failed });
    setStep("done");
    toast.success(`Pushed ${success} products${failed > 0 ? `, ${failed} failed` : ""}`);
  };

  // ── EDIT HANDLERS ──────────────────────────────
  const updateDetected = (productId: string, field: keyof DetectedAttributes, value: string) => {
    setRows(prev => prev.map(r => r.product.id !== productId ? r : { ...r, detected: { ...r.detected, [field]: value }, edited: true }));
    if (detailRow?.product.id === productId) {
      setDetailRow(prev => prev ? { ...prev, detected: { ...prev.detected, [field]: value }, edited: true } : null);
    }
  };

  // ── FILTERS ──────────────────────────────────
  const filtered = useCallback(() => {
    if (tab === "all") return rows;
    if (tab === "review") return rows.filter(r => r.detected.genderConf === "low" || r.detected.ageConf === "low" || r.detected.colorConf === "low" || !r.detected.color);
    if (tab === "no_color") return rows.filter(r => !r.detected.color);
    if (tab === "pushed") return rows.filter(r => r.pushed);
    return rows;
  }, [rows, tab]);

  const counts = {
    all: rows.length,
    review: rows.filter(r => r.detected.genderConf === "low" || r.detected.ageConf === "low" || !r.detected.color).length,
    no_color: rows.filter(r => !r.detected.color).length,
    pushed: rows.filter(r => r.pushed).length,
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const current = filtered();
  const autoReady = rows.filter(r => r.detected.genderConf !== "low" && r.detected.ageConf !== "low" && r.detected.color).length;

  // Reset page when tab changes
  useEffect(() => { setPage(1); }, [tab]);
  const totalPages = Math.max(1, Math.ceil(current.length / PAGE_SIZE));
  const paginatedRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return current.slice(start, start + PAGE_SIZE);
  }, [current, page]);

  // Merchant Center warnings derived from detected attributes
  const getMerchantCenterWarnings = (row: FeedHealthRow): string[] => {
    const w: string[] = [];
    if (!row.detected.gender) w.push("gender field required for apparel category");
    if (!row.detected.ageGroup) w.push("age_group required for apparel targeting");
    if (!row.detected.color) w.push("color field is invalid or missing");
    const hasGtin = row.product.variants?.some(v => v.barcode && v.barcode.length >= 8);
    if (!hasGtin) w.push("Missing identifier: Brand + GTIN or Brand + MPN required");
    if (row.product.imageUrl && row.product.imageWidth && row.product.imageWidth < 250) {
      w.push("Image too small — minimum 250×250px for Shopping");
    }
    if (!row.product.altText) w.push("Image alt text missing — required for accessibility");
    return w;
  };

  const getChannelStatus = (row: FeedHealthRow, channel: "google" | "meta" | "pinterest"): "ok" | "warning" | "error" => {
    const w = getMerchantCenterWarnings(row);
    const critical = w.filter(x => x.includes("required"));
    if (channel === "google") {
      if (critical.length > 0) return "error";
      if (w.length > 0) return "warning";
      return "ok";
    }
    if (channel === "meta") {
      if (!row.product.description) return "warning";
      return w.length > 0 ? "warning" : "ok";
    }
    return w.length > 0 ? "warning" : "ok";
  };

  const generateAltSuggestion = (row: FeedHealthRow): string => {
    const parts = [row.product.vendor, row.product.title, row.detected.color].filter(Boolean);
    return parts.join(" ").trim();
  };

  const openAltTextEdit = (row: FeedHealthRow) => {
    setAltEditRow(row);
    setAltDraft(row.product.altText || "");
  };

  const saveAltText = async (advance = false) => {
    if (!altEditRow) return;
    const text = altDraft.trim();
    const imageId = altEditRow.product.imageId;
    if (!imageId) {
      toast.error("No image found on product");
      return;
    }
    setAltSaving(true);
    try {
      // Update via Shopify image alt — uses REST update_image action; falls back gracefully
      await callProxy({
        action: "update_image_alt",
        product_id: altEditRow.product.id.replace("gid://shopify/Product/", ""),
        image_id: imageId,
        alt: text,
      });
      setRows(prev => prev.map(r => r.product.id === altEditRow.product.id
        ? { ...r, product: { ...r.product, altText: text }, edited: true }
        : r));
      toast.success("Alt text updated");
      if (advance) {
        const nextMissing = current.find(r =>
          r.product.id !== altEditRow.product.id && !r.product.altText
        );
        if (nextMissing) {
          setAltEditRow(nextMissing);
          setAltDraft("");
          return;
        }
      }
      setAltEditRow(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update alt text");
    } finally {
      setAltSaving(false);
    }
  };


  // ── CURRENCY HELPERS ──────────────────────────
  const addSecondaryCountry = () => setSecondaryCountries(prev => [...prev, { country: "United States", currency: "USD" }]);
  const removeSecondaryCountry = (i: number) => setSecondaryCountries(prev => prev.filter((_, idx) => idx !== i));
  const copyToClipboard = (text: string) => { navigator.clipboard.writeText(text); toast.success("Copied to clipboard"); };

  // ══════════════════════════════════════════════
  // IDLE VIEW
  // ══════════════════════════════════════════════
  if (step === "idle") {
    return (
      <div className="px-4 pt-6 pb-24 animate-fade-in">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
          <div>
            <h2 className="text-lg font-semibold font-display flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" /> Google Feed Health
            </h2>
            <p className="text-xs text-muted-foreground">Bulk-fix gender, age_group, and color for ALL store products</p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-5 mb-4">
          <h3 className="text-sm font-semibold mb-2">How it works</h3>
          <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
            <li>Scan all products from your Shopify store (or upload a CSV)</li>
            <li>Auto-detect gender, age group, and color from titles, tags, and variants</li>
            <li>Review and edit detected values</li>
            <li>Push metafields directly to Shopify or export Matrixify CSV</li>
            <li>Map metafields in Simprosys (or Google & YouTube app)</li>
          </ol>
        </div>

        {/* Connected store indicator */}
        {directStore ? (
          <div className="bg-success/10 border border-success/20 rounded-lg p-3 mb-4 flex items-center gap-2">
            <Store className="w-4 h-4 text-success" />
            <div>
              <p className="text-xs font-medium text-success">{directStore.storeName}</p>
              <p className="text-[10px] text-muted-foreground">{directStore.storeUrl} · {directStore.productCount} products</p>
            </div>
          </div>
        ) : (
          <div className="bg-secondary/10 border border-secondary/20 rounded-lg p-3 mb-4">
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-secondary">No store connected.</span> Go to Account → Connected Shopify stores to connect one, or use the CSV upload below.
            </p>
          </div>
        )}

        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mb-4">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-primary">Why this matters:</span> Google requires gender, age_group, and color for apparel products. Missing values = disapproved listings = lost impressions.
          </p>
        </div>

        {/* Two scan options */}
        <div className="space-y-3">
          <Button variant="teal" className="w-full h-12 text-base" onClick={startScan} disabled={!directStore}>
            <Activity className="w-4 h-4 mr-2" /> Scan store products via API
          </Button>

          <div className="text-center text-xs text-muted-foreground">or</div>

          <Button variant="outline" className="w-full h-12 text-base" onClick={() => fileRef.current?.click()}>
            <Upload className="w-4 h-4 mr-2" /> Upload Shopify / Matrixify CSV
          </Button>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} />
          <p className="text-[10px] text-muted-foreground text-center">No API token needed — export your products from Shopify Admin and upload here</p>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════
  // SCANNING VIEW (with live breakdown)
  // ══════════════════════════════════════════════
  if (step === "scanning") {
    return (
      <div className="px-4 pt-6 pb-24 animate-fade-in">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
          <h2 className="text-lg font-semibold font-display">Google Feed Health</h2>
        </div>
        <div className="bg-card border border-border rounded-lg p-6">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
          <p className="text-sm font-medium mb-2 text-center">Scanning your store…</p>
          <p className="text-xs text-muted-foreground mb-3 text-center">
            {scanProgress.done > 0 ? `${scanProgress.done.toLocaleString()} products scanned` : "Connecting to Shopify…"}
          </p>
          {scanProgress.total > 0 && <Progress value={(scanProgress.done / scanProgress.total) * 100} className="h-2 mb-4" />}

          {/* Live detection breakdown */}
          {scanProgress.done > 0 && (
            <div className="grid grid-cols-3 gap-2 text-center mt-3">
              <div className="bg-muted/50 rounded-lg p-2">
                <p className="text-[10px] text-muted-foreground mb-1">Gender</p>
                <p className="text-[10px]"><span className="font-medium">♀ {scanStats.female}</span> · <span className="font-medium">♂ {scanStats.male}</span> · <span className="font-medium">⚥ {scanStats.unisex}</span></p>
              </div>
              <div className="bg-muted/50 rounded-lg p-2">
                <p className="text-[10px] text-muted-foreground mb-1">Age</p>
                <p className="text-[10px]"><span className="font-medium">Adult {scanStats.adult}</span> · <span className="font-medium">Kids {scanStats.kids}</span></p>
              </div>
              <div className="bg-muted/50 rounded-lg p-2">
                <p className="text-[10px] text-muted-foreground mb-1">Color</p>
                <p className="text-[10px]"><span className="font-medium text-success">✓ {scanStats.colorFound}</span> · <span className="font-medium text-destructive">✗ {scanStats.colorMissing}</span></p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════
  // PUSHING VIEW
  // ══════════════════════════════════════════════
  if (step === "pushing") {
    return (
      <div className="px-4 pt-6 pb-24 animate-fade-in">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
          <h2 className="text-lg font-semibold font-display">Google Feed Health</h2>
        </div>
        <div className="bg-card border border-border rounded-lg p-6 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
          <p className="text-sm font-medium mb-2">Pushing metafields to Shopify…</p>
          <p className="text-xs text-muted-foreground mb-3">
            {pushProgress.done.toLocaleString()} of {pushProgress.total.toLocaleString()} products
            {pushProgress.failed > 0 && <span className="text-destructive"> · {pushProgress.failed} failed</span>}
          </p>
          <Progress value={(pushProgress.done / pushProgress.total) * 100} className="h-2" />
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════
  // DONE VIEW
  // ══════════════════════════════════════════════
  if (step === "done") {
    return (
      <div className="px-4 pt-6 pb-24 animate-fade-in">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
          <h2 className="text-lg font-semibold font-display">Google Feed Health</h2>
        </div>

        <div className="bg-success/10 border border-success/20 rounded-lg p-5 mb-4 text-center">
          <Check className="w-8 h-8 text-success mx-auto mb-2" />
          <p className="text-sm font-semibold mb-1">Feed health fix complete</p>
          <p className="text-xs text-muted-foreground">
            {(pushProgress.done - pushProgress.failed).toLocaleString()} products updated
            {pushProgress.failed > 0 && ` · ${pushProgress.failed} failed`}
          </p>
        </div>

        {/* Next steps card */}
        <div className="bg-card border border-border rounded-lg p-4 mb-4">
          <p className="text-xs font-semibold mb-2">Next steps</p>
          {namespace === "custom" ? (
            <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
              <li>In Simprosys → Settings → Shopify Metafields Mapping</li>
              <li>Map <code className="bg-muted px-1 rounded">custom.gender</code> → Gender</li>
              <li>Map <code className="bg-muted px-1 rounded">custom.age_group</code> → Age Group</li>
              <li>Map <code className="bg-muted px-1 rounded">custom.color</code> → Color</li>
              <li>Manage Products → Sync from Shopify</li>
              <li>Errors like "gender field is required" will clear</li>
              <li>Google Merchant Center re-crawls within 24–48 hours</li>
            </ol>
          ) : (
            <p className="text-xs text-muted-foreground">Values are live in Shopify. Google re-crawls within 24–48 hours.</p>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-card border border-border rounded-lg p-3 text-center">
            <p className="text-lg font-bold text-success">{(pushProgress.done - pushProgress.failed).toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">Updated</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-3 text-center">
            <p className="text-lg font-bold text-destructive">{pushProgress.failed}</p>
            <p className="text-[10px] text-muted-foreground">Errors</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-3 text-center">
            <p className="text-lg font-bold">{counts.no_color}</p>
            <p className="text-[10px] text-muted-foreground">No color</p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setStep("reviewing")}>Review products</Button>
          <Button variant="outline" className="flex-1" onClick={() => setStep("currency")}>
            <Globe className="w-3.5 h-3.5 mr-1" /> Currency fix
          </Button>
          <Button variant="teal" className="flex-1" onClick={onBack}>Done</Button>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════
  // CURRENCY DIAGNOSTIC VIEW (Step 5)
  // ══════════════════════════════════════════════
  if (step === "currency") {
    return (
      <div className="px-4 pt-6 pb-24 animate-fade-in">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => setStep("done")} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
          <div>
            <h2 className="text-lg font-semibold font-display flex items-center gap-2">
              <Globe className="w-5 h-5 text-primary" /> Currency Mismatch Fix
            </h2>
            <p className="text-xs text-muted-foreground">Fix multi-country feed currency errors</p>
          </div>
        </div>

        {/* Error example */}
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 mb-4">
          <p className="text-xs font-semibold text-destructive mb-1">⚠ "Inconsistent currency"</p>
          <p className="text-[11px] text-muted-foreground">
            Your product data uses AUD but Google's crawler saw USD on your landing page.
            This happens because Shopify shows currency based on the visitor's IP — Google crawls from US IPs and sees USD.
          </p>
        </div>

        {/* The fix explanation */}
        <div className="bg-card border border-border rounded-lg p-4 mb-4">
          <h3 className="text-sm font-semibold mb-2">The fix</h3>
          <p className="text-xs text-muted-foreground mb-2">
            Append <code className="bg-muted px-1 rounded">?currency=AUD</code> to all product URLs in your AU feed.
            This forces Shopify to show the correct currency regardless of the crawler's IP.
          </p>
        </div>

        {/* Country configuration */}
        <div className="bg-card border border-border rounded-lg p-4 mb-4 space-y-3">
          <h3 className="text-sm font-semibold">Your store countries</h3>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground">Primary country</label>
              <select value={primaryCountry} onChange={e => setPrimaryCountry(e.target.value)}
                className="w-full h-8 rounded-md bg-input border border-border px-2 text-xs">
                <option>Australia</option><option>United States</option><option>United Kingdom</option><option>New Zealand</option><option>Canada</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Currency</label>
              <select value={primaryCurrency} onChange={e => setPrimaryCurrency(e.target.value)}
                className="w-full h-8 rounded-md bg-input border border-border px-2 text-xs">
                <option>AUD</option><option>USD</option><option>GBP</option><option>NZD</option><option>CAD</option><option>EUR</option>
              </select>
            </div>
          </div>

          {secondaryCountries.map((sc, i) => (
            <div key={i} className="grid grid-cols-3 gap-2 items-end">
              <div>
                <label className="text-[10px] text-muted-foreground">Country</label>
                <select value={sc.country} onChange={e => { const n = [...secondaryCountries]; n[i].country = e.target.value; setSecondaryCountries(n); }}
                  className="w-full h-8 rounded-md bg-input border border-border px-2 text-xs">
                  <option>United States</option><option>New Zealand</option><option>United Kingdom</option><option>Canada</option><option>Australia</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Currency</label>
                <select value={sc.currency} onChange={e => { const n = [...secondaryCountries]; n[i].currency = e.target.value; setSecondaryCountries(n); }}
                  className="w-full h-8 rounded-md bg-input border border-border px-2 text-xs">
                  <option>USD</option><option>AUD</option><option>GBP</option><option>NZD</option><option>CAD</option><option>EUR</option>
                </select>
              </div>
              <Button variant="ghost" size="sm" className="text-destructive text-xs h-8" onClick={() => removeSecondaryCountry(i)}>Remove</Button>
            </div>
          ))}

          <Button variant="outline" size="sm" className="text-xs" onClick={addSecondaryCountry}>+ Add secondary country</Button>
        </div>

        {/* Generated feed rules */}
        <div className="bg-card border border-border rounded-lg p-4 mb-4 space-y-3">
          <h3 className="text-sm font-semibold">Simprosys feed rules</h3>

          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-[10px] text-muted-foreground mb-1 uppercase font-semibold">{primaryCountry} ({primaryCurrency})</p>
            <div className="text-xs space-y-0.5">
              <p>Attribute: <span className="font-mono-data">link</span></p>
              <p>Action: <span className="font-mono-data">Append value</span></p>
              <p>Value: <span className="font-mono-data font-semibold">?currency={primaryCurrency}</span></p>
            </div>
            <Button variant="ghost" size="sm" className="text-xs mt-2 gap-1" onClick={() => copyToClipboard(`?currency=${primaryCurrency}`)}>
              <Copy className="w-3 h-3" /> Copy
            </Button>
          </div>

          {secondaryCountries.map((sc, i) => (
            <div key={i} className="bg-muted/50 rounded-lg p-3">
              <p className="text-[10px] text-muted-foreground mb-1 uppercase font-semibold">{sc.country} ({sc.currency})</p>
              <div className="text-xs space-y-0.5">
                <p>Attribute: <span className="font-mono-data">link</span></p>
                <p>Action: <span className="font-mono-data">Append value</span></p>
                <p>Value: <span className="font-mono-data font-semibold">?currency={sc.currency}</span></p>
              </div>
              <Button variant="ghost" size="sm" className="text-xs mt-2 gap-1" onClick={() => copyToClipboard(`?currency=${sc.currency}`)}>
                <Copy className="w-3 h-3" /> Copy
              </Button>
            </div>
          ))}

          {/* Setup instructions */}
          <button onClick={() => setShowCurrencyGuide(!showCurrencyGuide)} className="flex items-center gap-1 text-xs text-primary font-medium">
            {showCurrencyGuide ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Simprosys setup guide
          </button>
          {showCurrencyGuide && (
            <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside bg-muted/30 rounded-lg p-3">
              <li>Simprosys → Settings → Automated Rules for Feed</li>
              <li>Add rule: 'link' attribute → 'Append' → <code className="bg-muted px-1 rounded">?currency={primaryCurrency}</code></li>
              <li>Apply to: {primaryCountry} feed only</li>
              {secondaryCountries.map((sc, i) => (
                <li key={i}>Add rule for {sc.country}: append <code className="bg-muted px-1 rounded">?currency={sc.currency}</code></li>
              ))}
              <li>Save and resync your feed</li>
            </ol>
          )}
        </div>

        {/* Quick self-test */}
        <div className="bg-card border border-border rounded-lg p-4 mb-4">
          <h3 className="text-sm font-semibold mb-2">Quick self-test</h3>
          <p className="text-xs text-muted-foreground mb-2">Paste a product URL to test the currency fix:</p>
          <div className="flex gap-2">
            <Input value={testUrl} onChange={e => setTestUrl(e.target.value)} placeholder="https://yourstore.com/products/..." className="text-xs" />
            <Button variant="outline" size="sm" className="shrink-0 gap-1" onClick={() => {
              if (!testUrl) return;
              const sep = testUrl.includes("?") ? "&" : "?";
              window.open(`${testUrl}${sep}currency=${primaryCurrency}`, "_blank");
            }}>
              <ExternalLink className="w-3 h-3" /> Test
            </Button>
          </div>
        </div>

        {/* Shopify Markets note */}
        <div className="bg-muted/50 border border-border rounded-lg p-3 mb-4">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold">Using Shopify Markets?</span> If you have Shopify Markets set up, your store may use subdirectories (e.g. /en-au/) for different regions. Contact Simprosys support to confirm your Markets feed is configured correctly — this is more reliable than the currency parameter approach.
          </p>
        </div>

        <Button variant="teal" className="w-full h-12" onClick={() => setStep("done")}>← Back to summary</Button>
      </div>
    );
  }

  // ══════════════════════════════════════════════
  // REVIEWING VIEW
  // ══════════════════════════════════════════════
  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold font-display">Google Feed Health</h2>
          <p className="text-xs text-muted-foreground">{rows.length.toLocaleString()} products scanned</p>
        </div>
      </div>

      {/* Summary dashboard */}
      <div className="bg-card border border-border rounded-lg p-4 mb-4">
        <h3 className="text-sm font-semibold mb-3">📊 Feed Health Report</h3>
        <div className="grid grid-cols-3 gap-3 text-center mb-3">
          <div>
            <p className="text-lg font-bold text-success">{autoReady.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">Auto-ready</p>
          </div>
          <div>
            <p className="text-lg font-bold text-secondary">{counts.review}</p>
            <p className="text-[10px] text-muted-foreground">Needs review</p>
          </div>
          <div>
            <p className="text-lg font-bold text-destructive">{counts.no_color}</p>
            <p className="text-[10px] text-muted-foreground">No color</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
          <div className="bg-muted/50 rounded p-1.5 text-center">♀ {scanStats.female} · ♂ {scanStats.male} · ⚥ {scanStats.unisex}</div>
          <div className="bg-muted/50 rounded p-1.5 text-center">Adult {scanStats.adult} · Kids {scanStats.kids}</div>
          <div className="bg-muted/50 rounded p-1.5 text-center">Color ✓{scanStats.colorFound} ✗{scanStats.colorMissing}</div>
        </div>
      </div>

      {/* Namespace selector */}
      <div className="flex gap-2 mb-3">
        <button onClick={() => setNamespace("custom")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${namespace === "custom" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}>
          custom.* (Simprosys)
        </button>
        <button onClick={() => setNamespace("mm-google-shopping")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${namespace === "mm-google-shopping" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}>
          mm-google-shopping.*
        </button>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="mb-3">
        <TabsList className="w-full">
          <TabsTrigger value="all" className="flex-1 text-xs">All ({counts.all})</TabsTrigger>
          <TabsTrigger value="review" className="flex-1 text-xs">Review ({counts.review})</TabsTrigger>
          <TabsTrigger value="no_color" className="flex-1 text-xs">No color ({counts.no_color})</TabsTrigger>
          <TabsTrigger value="pushed" className="flex-1 text-xs">Pushed ({counts.pushed})</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Actions — push + export side by side */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        {directStore && (
          <div className="bg-card border border-border rounded-lg p-3">
            <p className="text-xs font-semibold mb-1">Direct API push</p>
            <p className="text-[10px] text-muted-foreground mb-2">No CSV. Changes appear immediately.</p>
            <Button variant="teal" size="sm" className="w-full gap-1"
              onClick={() => pushMetafields(selected.size > 0 ? Array.from(selected) : undefined)}>
              <ShoppingCart className="w-3.5 h-3.5" />
              {selected.size > 0 ? `Push ${selected.size}` : `Push all (${rows.length})`}
            </Button>
          </div>
        )}
        <div className={`bg-card border border-border rounded-lg p-3 ${!directStore ? "col-span-2" : ""}`}>
          <p className="text-xs font-semibold mb-1">Matrixify CSV</p>
          <p className="text-[10px] text-muted-foreground mb-2">Import via Matrixify app in Shopify.</p>
          <Button variant="outline" size="sm" className="w-full gap-1" onClick={exportMatrixifyCsv}>
            <Download className="w-3.5 h-3.5" /> Download CSV
          </Button>
        </div>
      </div>

      {/* Product table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  checked={selected.size === current.length && current.length > 0}
                  onCheckedChange={() => {
                    if (selected.size === current.length) setSelected(new Set());
                    else setSelected(new Set(current.map(r => r.product.id)));
                  }}
                />
              </TableHead>
              <TableHead className="text-xs">Product</TableHead>
              <TableHead className="text-xs hidden sm:table-cell">Gender</TableHead>
              <TableHead className="text-xs hidden sm:table-cell">Age</TableHead>
              <TableHead className="text-xs">Color</TableHead>
              <TableHead className="text-xs w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {current.slice(0, 100).map(r => (
              <TableRow key={r.product.id}>
                <TableCell>
                  <Checkbox checked={selected.has(r.product.id)} onCheckedChange={() => toggleSelect(r.product.id)} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {r.product.imageUrl && (
                      <img src={r.product.imageUrl} alt="" className="w-7 h-7 rounded object-cover shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate max-w-[180px]">{r.product.title}</p>
                      <p className="text-[10px] text-muted-foreground">{r.product.vendor}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <InlineEdit value={r.detected.gender} confidence={r.detected.genderConf} options={["female", "male", "unisex"]}
                    onSave={v => updateDetected(r.product.id, "gender", v)} />
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <InlineEdit value={r.detected.ageGroup} confidence={r.detected.ageConf} options={["adult", "kids", "toddler", "infant", "newborn"]}
                    onSave={v => updateDetected(r.product.id, "ageGroup", v)} />
                </TableCell>
                <TableCell>
                  {r.detected.color ? (
                    <InlineEdit value={r.detected.color} confidence={r.detected.colorConf}
                      onSave={v => updateDetected(r.product.id, "color", v)} />
                  ) : (
                    <Badge variant="destructive" className="text-[10px]">Missing</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <button onClick={() => setDetailRow(r)} className="text-muted-foreground hover:text-foreground">
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {current.length > 100 && (
          <div className="p-2 text-center text-xs text-muted-foreground border-t border-border">
            Showing first 100 of {current.length.toLocaleString()} products
          </div>
        )}
      </div>

      {/* Detail modal */}
      <Dialog open={!!detailRow} onOpenChange={open => { if (!open) setDetailRow(null); }}>
        <DialogContent className="max-w-md">
          {detailRow && (
            <>
              <DialogHeader>
                <DialogTitle className="text-sm">{detailRow.product.title}</DialogTitle>
                <DialogDescription className="text-xs">{detailRow.product.vendor} · {detailRow.product.productType}</DialogDescription>
              </DialogHeader>
              {detailRow.product.imageUrl && (
                <img src={detailRow.product.imageUrl} alt="" className="w-full h-32 object-contain rounded-lg bg-muted" />
              )}
              <div className="space-y-3">
                <DetailField label="Gender" value={detailRow.detected.gender} confidence={detailRow.detected.genderConf} reason={detailRow.detected.genderReason}
                  options={["female", "male", "unisex"]} onSave={v => updateDetected(detailRow.product.id, "gender", v)} />
                <DetailField label="Age Group" value={detailRow.detected.ageGroup} confidence={detailRow.detected.ageConf} reason={detailRow.detected.ageReason}
                  options={["adult", "kids", "toddler", "infant", "newborn"]} onSave={v => updateDetected(detailRow.product.id, "ageGroup", v)} />
                <DetailField label="Color" value={detailRow.detected.color || "—"} confidence={detailRow.detected.colorConf} reason={`Detected via ${detailRow.detected.colorMethod}`}
                  onSave={v => updateDetected(detailRow.product.id, "color", v)} />
              </div>
              <div className="bg-muted/50 rounded-lg p-2 text-[10px] text-muted-foreground">
                <p>Tags: {detailRow.product.tags.join(", ") || "none"}</p>
                <p>ID: {detailRow.product.id}</p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {onStartFlow && rows.length > 0 && (
        <WhatsNextSuggestions
          completedFlow="feed_health"
          onStartFlow={onStartFlow}
          onGoHome={onBack}
        />
      )}
    </div>
  );
}

// ── Inline Edit Component ──────────────────────
function InlineEdit({ value, confidence, options, onSave }: {
  value: string;
  confidence: "high" | "medium" | "low";
  options?: string[];
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const confColor = confidence === "high" ? "text-success" : confidence === "medium" ? "text-secondary" : "text-destructive";

  if (editing) {
    if (options) {
      return (
        <select autoFocus defaultValue={value}
          onChange={e => { onSave(e.target.value); setEditing(false); }}
          onBlur={() => setEditing(false)}
          className="h-6 text-xs bg-input border border-border rounded px-1">
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    return (
      <input autoFocus defaultValue={value}
        onBlur={e => { if (e.target.value.trim()) onSave(e.target.value.trim()); setEditing(false); }}
        onKeyDown={e => { if (e.key === "Enter" && (e.target as HTMLInputElement).value.trim()) { onSave((e.target as HTMLInputElement).value.trim()); setEditing(false); } }}
        className="h-6 w-full text-xs bg-input border border-border rounded px-1" />
    );
  }

  return (
    <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-xs hover:underline group">
      <span className={confColor}>●</span>
      <span>{value}</span>
      <Pencil className="w-2.5 h-2.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
    </button>
  );
}

// ── Detail Field Component ──────────────────────
function DetailField({ label, value, confidence, reason, options, onSave }: {
  label: string; value: string; confidence: "high" | "medium" | "low"; reason: string; options?: string[];
  onSave: (v: string) => void;
}) {
  const confBadge = confidence === "high"
    ? <Badge variant="secondary" className="text-[10px] bg-success/20 text-success">High</Badge>
    : confidence === "medium"
    ? <Badge variant="secondary" className="text-[10px] bg-secondary/20 text-secondary">Medium</Badge>
    : <Badge variant="destructive" className="text-[10px]">Low</Badge>;

  return (
    <div className="bg-muted/30 rounded-lg p-2.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium">{label}</span>
        {confBadge}
      </div>
      <InlineEdit value={value} confidence={confidence} options={options} onSave={onSave} />
      <p className="text-[10px] text-muted-foreground mt-1">{reason}</p>
    </div>
  );
}
