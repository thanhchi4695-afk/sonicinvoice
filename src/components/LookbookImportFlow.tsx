import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { buildWholesaleShopifyCSV, buildWholesaleLightspeedCSV, type WholesaleOrder, type WholesaleLineItem } from "@/lib/wholesale-mapper";
import { toast } from "sonner";
import {
  ArrowLeft, Loader2, Download, Upload, Search, Link2,
  ChevronRight, ImageIcon, Check, X, AlertTriangle, Eye,
} from "lucide-react";

interface Props { onBack: () => void; }

interface ExtractedProduct {
  style_name: string;
  style_number: string | null;
  description: string;
  product_type: string;
  colour: string;
  colour_secondary: string | null;
  print_type: string | null;
  fabric_description: string | null;
  target_gender: string;
  age_group: string;
  confidence: "high" | "medium" | "low";
  imageUrl: string;
  imageName: string;
  selected: boolean;
}

type Screen = "paste" | "fetching" | "analysing" | "review";

const PLATFORM_BADGES = [
  { id: "dropbox", label: "Dropbox", pattern: "dropbox.com" },
  { id: "google_drive", label: "Google Drive", pattern: "drive.google.com" },
  { id: "wetransfer", label: "WeTransfer", pattern: "wetransfer.com" },
  { id: "onedrive", label: "OneDrive", pattern: "1drv.ms" },
] as const;

const LookbookImportFlow = ({ onBack }: Props) => {
  const [screen, setScreen] = useState<Screen>("paste");
  const [linkInput, setLinkInput] = useState("");
  const [detectedPlatform, setDetectedPlatform] = useState<string | null>(null);
  const [images, setImages] = useState<{ name: string; downloadUrl: string }[]>([]);
  const [fetchProgress, setFetchProgress] = useState({ current: 0, total: 0, status: "" });
  const [products, setProducts] = useState<ExtractedProduct[]>([]);
  const [analyseProgress, setAnalyseProgress] = useState({ current: 0, total: 0 });
  const [brand, setBrand] = useState("");
  const [season, setSeason] = useState("");
  const [collection, setCollection] = useState("");
  const [deliveryMonth, setDeliveryMonth] = useState("");
  const [filter, setFilter] = useState<"all" | "high" | "medium" | "low">("all");
  const [pushing, setPushing] = useState(false);
  const [pushProgress, setPushProgress] = useState({ current: 0, total: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Detect platform as user types
  const handleLinkChange = (value: string) => {
    setLinkInput(value);
    const found = PLATFORM_BADGES.find(p => value.includes(p.pattern));
    setDetectedPlatform(found?.id || null);
  };

  // Fetch images from cloud link
  const handleFetchImages = async () => {
    if (!linkInput.trim()) return;
    setScreen("fetching");
    setFetchProgress({ current: 0, total: 0, status: "Connecting..." });

    try {
      setFetchProgress(p => ({ ...p, status: "Downloading image list..." }));
      const { data, error } = await supabase.functions.invoke("lookbook-fetch", {
        body: { action: "list_images", url: linkInput.trim() },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      const imgs = data.images || [];
      if (imgs.length === 0) {
        toast.error("No images found in this folder.");
        setScreen("paste");
        return;
      }

      setImages(imgs);
      setFetchProgress({ current: imgs.length, total: imgs.length, status: `Found ${imgs.length} images` });
      toast.success(`Found ${imgs.length} images`);

      // Auto-proceed to analysis
      await analyseImages(imgs);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to fetch images");
      setScreen("paste");
    }
  };

  // Handle direct file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const imageFiles = Array.from(files).filter(f =>
      /\.(jpe?g|png|webp|gif)$/i.test(f.name)
    );

    if (imageFiles.length === 0) {
      toast.error("No image files selected");
      return;
    }

    setScreen("analysing");
    setAnalyseProgress({ current: 0, total: imageFiles.length });

    const extracted: ExtractedProduct[] = [];

    for (let i = 0; i < imageFiles.length; i++) {
      setAnalyseProgress({ current: i + 1, total: imageFiles.length });

      try {
        const file = imageFiles[i];
        const base64 = await fileToBase64(file);
        const contentType = file.type || "image/jpeg";

        const { data, error } = await supabase.functions.invoke("lookbook-extract", {
          body: { base64, contentType },
        });

        if (!error && data?.products) {
          for (const p of data.products) {
            extracted.push({
              ...p,
              imageUrl: URL.createObjectURL(file),
              imageName: file.name,
              selected: p.confidence !== "low",
            });
          }
        }
      } catch (err) {
        console.warn(`Failed to analyse ${imageFiles[i].name}:`, err);
      }
    }

    setProducts(extracted);
    setScreen("review");
    toast.success(`Extracted ${extracted.length} products from ${imageFiles.length} images`);
    import("@/lib/image-seo-trigger").then(m => m.dispatchImageSeoTrigger({ source: "lookbook", productCount: extracted.length }));
  };

  // Analyse images with AI
  const analyseImages = async (imgs: { name: string; downloadUrl: string }[]) => {
    setScreen("analysing");
    setAnalyseProgress({ current: 0, total: imgs.length });

    const extracted: ExtractedProduct[] = [];

    for (let i = 0; i < imgs.length; i++) {
      setAnalyseProgress({ current: i + 1, total: imgs.length });

      try {
        // Fetch image as base64 via edge function
        const { data: imgData, error: imgErr } = await supabase.functions.invoke("lookbook-fetch", {
          body: { action: "fetch_image_as_base64", url: imgs[i].downloadUrl },
        });

        if (imgErr || imgData?.error) {
          console.warn(`Skipping ${imgs[i].name}: ${imgData?.error || imgErr?.message}`);
          continue;
        }

        // Send to AI for extraction
        const { data: extractData, error: extractErr } = await supabase.functions.invoke("lookbook-extract", {
          body: { base64: imgData.base64, contentType: imgData.contentType },
        });

        if (!extractErr && extractData?.products) {
          for (const p of extractData.products) {
            extracted.push({
              ...p,
              imageUrl: imgs[i].downloadUrl,
              imageName: imgs[i].name,
              selected: p.confidence !== "low",
            });
          }
        }
      } catch (err) {
        console.warn(`Failed to process ${imgs[i].name}:`, err);
      }
    }

    setProducts(extracted);
    setScreen("review");
    toast.success(`Extracted ${extracted.length} products from ${imgs.length} images`);
    import("@/lib/image-seo-trigger").then(m => m.dispatchImageSeoTrigger({ source: "lookbook", productCount: extracted.length }));
  };

  // Toggle product selection
  const toggleProduct = (idx: number) => {
    setProducts(prev => prev.map((p, i) => i === idx ? { ...p, selected: !p.selected } : p));
  };

  const toggleAll = (val: boolean) => {
    setProducts(prev => prev.map(p => ({ ...p, selected: val })));
  };

  // Update product field
  const updateField = (idx: number, field: keyof ExtractedProduct, value: string) => {
    setProducts(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  };

  // Build WholesaleOrder from extracted products
  const buildOrders = (): WholesaleOrder[] => {
    const selected = products.filter(p => p.selected);
    if (selected.length === 0) return [];

    const lineItems: WholesaleLineItem[] = selected.map((p, i) => ({
      styleNumber: p.style_number || `${(brand || "LB").substring(0, 3).toUpperCase()}-${String(i + 1).padStart(3, "0")}`,
      styleName: p.style_name,
      description: p.description || "",
      brand: brand,
      productType: p.product_type || "",
      fabrication: p.fabric_description || "",
      colour: p.colour || "",
      colourCode: "",
      size: "",
      barcode: "",
      rrp: 0,
      wholesale: 0,
      quantityOrdered: 1,
      season: season,
      collection: collection,
      arrivalMonth: deliveryMonth,
      imageUrl: convertToDirectUrl(p.imageUrl),
      sourceOrderId: `lookbook-${Date.now()}`,
      sourcePlatform: "lookbook",
    }));

    return [{
      orderId: `lookbook-${Date.now()}`,
      platform: "lookbook",
      brandName: brand,
      season: season,
      collection: collection,
      currency: "AUD",
      orderTotal: 0,
      retailerName: "",
      status: "Imported",
      lineItems,
      importedAt: new Date().toISOString(),
    }];
  };

  const handleDownloadShopifyCSV = () => {
    const orders = buildOrders();
    if (orders.length === 0 || orders[0].lineItems.length === 0) {
      toast.error("No products selected");
      return;
    }
    const csv = buildWholesaleShopifyCSV(orders);
    downloadCSV(csv, `${brand || "lookbook"}-${season || "import"}-shopify-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Shopify CSV downloaded (${orders[0].lineItems.length} products)`);
  };

  const handleDownloadLightspeedCSV = () => {
    const orders = buildOrders();
    if (orders.length === 0 || orders[0].lineItems.length === 0) {
      toast.error("No products selected");
      return;
    }
    const csv = buildWholesaleLightspeedCSV(orders);
    downloadCSV(csv, `${brand || "lookbook"}-${season || "import"}-lightspeed-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Lightspeed CSV downloaded (${orders[0].lineItems.length} products)`);
  };

  const handlePushToShopify = async () => {
    const orders = buildOrders();
    const items = orders[0]?.lineItems || [];
    if (items.length === 0) { toast.error("No products selected"); return; }

    setPushing(true);
    setPushProgress({ current: 0, total: items.length });

    let created = 0;
    let errors = 0;

    for (let i = 0; i < items.length; i++) {
      setPushProgress({ current: i + 1, total: items.length });
      try {
        const item = items[i];
        const { error } = await supabase.functions.invoke("shopify-proxy", {
          body: {
            action: "graphql_create_product",
            product: {
              title: item.styleName,
              vendor: item.brand,
              product_type: item.productType,
              body_html: item.description,
              status: "draft",
              tags: [item.brand, item.colour, item.collection, "full_price", "new"].filter(Boolean).join(", "),
              images: item.imageUrl ? [{ src: item.imageUrl }] : [],
              variants: [{
                sku: item.styleNumber,
                price: item.rrp > 0 ? item.rrp.toFixed(2) : "0.00",
                cost: item.wholesale > 0 ? item.wholesale.toFixed(2) : undefined,
                option1: item.colour || "Default",
              }],
            },
          },
        });
        if (error) { errors++; } else { created++; }
      } catch {
        errors++;
      }
    }

    setPushing(false);
    toast.success(`${created} products pushed to Shopify${errors > 0 ? ` (${errors} errors)` : ""}`);
  };

  const filteredProducts = products.filter(p => {
    if (filter === "all") return true;
    return p.confidence === filter;
  });

  const counts = {
    all: products.length,
    high: products.filter(p => p.confidence === "high").length,
    medium: products.filter(p => p.confidence === "medium").length,
    low: products.filter(p => p.confidence === "low").length,
  };

  // ── SCREEN: PASTE LINK ──
  if (screen === "paste") {
    return (
      <div className="px-4 pt-6 pb-24 animate-fade-in">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground mb-4">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <h1 className="text-2xl font-bold font-display mb-1">Import from supplier lookbook</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Paste any link your supplier sent you. Works with Dropbox, Google Drive, WeTransfer, or OneDrive shared folders.
        </p>

        <div className="space-y-4">
          <div>
            <Input
              value={linkInput}
              onChange={(e) => handleLinkChange(e.target.value)}
              placeholder="Paste supplier link here — e.g. https://www.dropbox.com/scl/fo/..."
              className="h-12 text-sm"
            />
            <div className="flex gap-2 mt-2">
              {PLATFORM_BADGES.map(p => (
                <span
                  key={p.id}
                  className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
                    detectedPlatform === p.id
                      ? "bg-primary/15 border-primary/30 text-primary font-medium"
                      : "bg-muted/50 border-border text-muted-foreground"
                  }`}
                >
                  {p.label}
                </span>
              ))}
            </div>
          </div>

          {detectedPlatform && (
            <div className="bg-success/10 border border-success/20 rounded-lg p-3 flex items-center gap-2">
              <Check className="w-4 h-4 text-success" />
              <span className="text-sm text-success font-medium">
                {PLATFORM_BADGES.find(p => p.id === detectedPlatform)?.label} folder detected
              </span>
            </div>
          )}

          <Button
            variant="teal"
            className="w-full h-12 text-base"
            onClick={handleFetchImages}
            disabled={!linkInput.trim()}
          >
            <Link2 className="w-4 h-4 mr-2" /> Fetch Images
          </Button>

          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <Button
            variant="outline"
            className="w-full h-12 text-base"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-4 h-4 mr-2" /> Upload images directly
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.gif"
            multiple
            className="hidden"
            onChange={handleFileUpload}
          />

          {detectedPlatform === "wetransfer" && (
            <div className="bg-secondary/30 border border-secondary/40 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-secondary-foreground mt-0.5" />
              <p className="text-xs text-secondary-foreground">
                WeTransfer links expire after 7 days. For permanent image URLs, ask your supplier to use Dropbox or Google Drive.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── SCREEN: FETCHING ──
  if (screen === "fetching") {
    return (
      <div className="px-4 pt-6 pb-24 animate-fade-in">
        <h1 className="text-2xl font-bold font-display mb-1">Fetching images</h1>
        <div className="mt-8 flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">{fetchProgress.status}</p>
          {fetchProgress.total > 0 && (
            <div className="w-full max-w-xs">
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${(fetchProgress.current / fetchProgress.total) * 100}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-center mt-1">
                {fetchProgress.current} / {fetchProgress.total}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── SCREEN: ANALYSING ──
  if (screen === "analysing") {
    return (
      <div className="px-4 pt-6 pb-24 animate-fade-in">
        <h1 className="text-2xl font-bold font-display mb-1">Analysing images with AI</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Extracting product data from each image...
        </p>
        <div className="mt-8 flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 text-primary animate-spin" />
          <div className="w-full max-w-xs">
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${analyseProgress.total > 0 ? (analyseProgress.current / analyseProgress.total) * 100 : 0}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground text-center mt-1">
              {analyseProgress.current} / {analyseProgress.total} images
            </p>
          </div>
          {products.length > 0 && (
            <p className="text-sm text-primary font-medium">
              {products.length} products extracted so far
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── SCREEN: REVIEW ──
  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <button onClick={() => { setScreen("paste"); setProducts([]); }} className="flex items-center gap-1 text-sm text-muted-foreground mb-4">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <h1 className="text-2xl font-bold font-display mb-1">Review extracted products</h1>
      <p className="text-muted-foreground text-sm mb-4">
        {products.length} products extracted. Edit details, then push to Shopify or download CSV.
      </p>

      {/* Brand + Season Header */}
      <div className="bg-card border border-border rounded-lg p-4 mb-4 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Apply to all products</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Brand / Supplier</label>
            <Input value={brand} onChange={e => setBrand(e.target.value)} placeholder="e.g. Funkita" className="h-9 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Season</label>
            <Input value={season} onChange={e => setSeason(e.target.value)} placeholder="e.g. SS26" className="h-9 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Collection</label>
            <Input value={collection} onChange={e => setCollection(e.target.value)} placeholder="e.g. Originals 2026" className="h-9 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Delivery month</label>
            <Input value={deliveryMonth} onChange={e => setDeliveryMonth(e.target.value)} placeholder="e.g. Feb 2026" className="h-9 text-sm" />
          </div>
        </div>
      </div>

      {/* Confidence filter tabs */}
      <div className="flex gap-2 mb-4 overflow-x-auto">
        {(["all", "high", "medium", "low"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-full border whitespace-nowrap transition-colors ${
              filter === f
                ? "bg-primary/15 border-primary/30 text-primary font-medium"
                : "bg-muted/50 border-border text-muted-foreground"
            }`}
          >
            {f === "all" ? "All" : f === "high" ? "High" : f === "medium" ? "Medium" : "Needs review"} ({counts[f]})
          </button>
        ))}
      </div>

      {/* Select all */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => toggleAll(true)} className="text-xs text-primary hover:underline">Select all</button>
        <button onClick={() => toggleAll(false)} className="text-xs text-muted-foreground hover:underline">Deselect all</button>
      </div>

      {/* Product cards */}
      <div className="space-y-2 mb-6">
        {filteredProducts.map((p, idx) => {
          const realIdx = products.indexOf(p);
          return (
            <div key={idx} className={`border rounded-lg p-3 transition-colors ${p.selected ? "border-primary/30 bg-card" : "border-border bg-muted/20 opacity-60"}`}>
              <div className="flex gap-3">
                <button onClick={() => toggleProduct(realIdx)} className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 mt-0.5 ${p.selected ? "bg-primary border-primary" : "border-border"}`}>
                  {p.selected && <Check className="w-3 h-3 text-primary-foreground" />}
                </button>
                <div className="w-12 h-12 rounded bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <ImageIcon className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <input
                    value={p.style_name}
                    onChange={e => updateField(realIdx, "style_name", e.target.value)}
                    className="text-sm font-medium bg-transparent border-none w-full p-0 focus:outline-none focus:ring-0"
                  />
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{p.colour}</span>
                    <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{p.product_type}</span>
                    <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{p.target_gender}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      p.confidence === "high" ? "bg-success/15 text-success" :
                      p.confidence === "medium" ? "bg-secondary/30 text-secondary-foreground" :
                      "bg-destructive/15 text-destructive"
                    }`}>
                      {p.confidence}
                    </span>
                  </div>
                  {p.confidence === "low" && (
                    <p className="text-[10px] text-destructive mt-1 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Low confidence — please review
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Actions */}
      {pushing ? (
        <div className="bg-card border border-border rounded-lg p-4 mb-4">
          <p className="text-sm font-medium mb-2">Pushing to Shopify...</p>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pushProgress.total > 0 ? (pushProgress.current / pushProgress.total) * 100 : 0}%` }} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">{pushProgress.current} / {pushProgress.total}</p>
        </div>
      ) : (
        <div className="space-y-2">
          <Button variant="teal" className="w-full h-12 text-base" onClick={handlePushToShopify}>
            Push {products.filter(p => p.selected).length} products to Shopify
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="h-10" onClick={handleDownloadShopifyCSV}>
              <Download className="w-4 h-4 mr-1" /> Shopify CSV
            </Button>
            <Button variant="outline" className="h-10" onClick={handleDownloadLightspeedCSV}>
              <Download className="w-4 h-4 mr-1" /> Lightspeed CSV
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

function convertToDirectUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("blob:")) return ""; // Local blob URLs can't be used
  if (url.includes("dropbox.com")) return url.replace(/[?&]dl=0/, "").replace(/\?.*$/, "") + "?raw=1";
  if (url.includes("drive.google.com")) {
    const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match) return `https://drive.google.com/uc?id=${match[1]}&export=download`;
  }
  return url;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function downloadCSV(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default LookbookImportFlow;
