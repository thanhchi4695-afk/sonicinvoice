import { useState } from "react";
import { ChevronLeft, Download, ExternalLink, Copy, Check, Search, Loader2, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";

export type EnrichedImageProduct = {
  title: string;
  sku?: string;
  colour?: string;
  brand?: string;
  type?: string;
  imageSrc: string;
  imageUrls?: string[];
};

function slugifyForFilename(s: string): string {
  return (s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function filenameFor(product: EnrichedImageProduct, index: number): string {
  const sku = slugifyForFilename(product.sku || "");
  const colour = slugifyForFilename(product.colour || "");
  const base = sku || slugifyForFilename(product.title) || `image-${index + 1}`;
  return colour ? `${base}-${colour}.jpg` : `${base}.jpg`;
}

// Lazy-load JSZip from CDN
let jszipPromise: Promise<any> | null = null;
function loadJSZip(): Promise<any> {
  if ((window as any).JSZip) return Promise.resolve((window as any).JSZip);
  if (jszipPromise) return jszipPromise;
  jszipPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    script.onload = () => resolve((window as any).JSZip);
    script.onerror = () => reject(new Error("Failed to load JSZip"));
    document.head.appendChild(script);
  });
  return jszipPromise;
}

// Call existing enrich-product edge function to get image URLs
async function fetchProductImage(product: EnrichedImageProduct, customQuery?: string): Promise<string | null> {
  try {
    const storeConfig = JSON.parse(localStorage.getItem("store_config_sonic_invoice") || "{}");
    const brandDir = JSON.parse(localStorage.getItem("brand_directory_sonic_invoice") || "[]");
    const brandEntry = brandDir.find((b: any) => b.name?.toLowerCase() === (product.brand || "").toLowerCase());
    const brandWebsite = brandEntry?.website || "";

    const { data, error } = await supabase.functions.invoke("enrich-product", {
      body: {
        title: customQuery || product.title,
        vendor: product.brand || "",
        type: product.type || "",
        brandWebsite,
        storeName: storeConfig.name || "My Store",
        storeCity: storeConfig.city || "",
        customInstructions: storeConfig.defaultInstructions || "",
      },
    });

    if (error) return null;
    const url = data?.imageUrls?.[0];
    return url && typeof url === "string" && url.startsWith("http") ? url : null;
  } catch {
    return null;
  }
}

function ImageTile({
  product,
  index,
  onUpdateUrl,
  fetching,
  onFetch,
}: {
  product: EnrichedImageProduct;
  index: number;
  onUpdateUrl: (url: string) => void;
  fetching: boolean;
  onFetch: (customQuery?: string) => void;
}) {
  const [errored, setErrored] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [searchTerms, setSearchTerms] = useState(product.title);

  const url = product.imageSrc || (product.imageUrls && product.imageUrls[0]) || "";
  let domain = "";
  try {
    domain = url ? new URL(url).hostname.replace(/^www\./, "") : "";
  } catch {}

  const filename = filenameFor(product, index);
  const noImage = !url || errored;

  const handleDownload = async () => {
    if (!url) return;
    setDownloading(true);
    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error("fetch failed");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch {
      window.open(url, "_blank");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="bg-card rounded-md border border-border overflow-hidden flex flex-col">
      <div className="relative w-full aspect-square bg-muted">
        {fetching ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <p className="text-[10px] text-muted-foreground">Searching…</p>
          </div>
        ) : !noImage ? (
          <img
            src={url}
            alt={product.title}
            crossOrigin="anonymous"
            className="w-full h-full object-cover cursor-pointer"
            onClick={() => window.open(url, "_blank")}
            onLoad={(e) => {
              const img = e.currentTarget;
              setDims({ w: img.naturalWidth, h: img.naturalHeight });
              setErrored(false);
            }}
            onError={() => setErrored(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-center p-2">
            <p className="text-[11px] text-muted-foreground font-medium">No image found</p>
          </div>
        )}
      </div>
      <div className="p-2 space-y-1">
        <p className="text-[11px] font-medium truncate" title={product.title}>
          {product.title}
        </p>
        {product.sku && (
          <p className="text-[10px] text-muted-foreground truncate font-mono-data">{product.sku}</p>
        )}
        {!noImage && !fetching && dims && (
          <p className="text-[10px] text-muted-foreground">
            {dims.w} × {dims.h}px
          </p>
        )}
        {!noImage && !fetching && domain && (
          <p className="text-[10px] text-muted-foreground truncate">{domain}</p>
        )}

        {noImage && !fetching ? (
          <div className="space-y-1 pt-1">
            <p className="text-[10px] text-muted-foreground">Search with different keywords:</p>
            <div className="flex gap-1">
              <Input
                value={searchTerms}
                onChange={(e) => setSearchTerms(e.target.value)}
                className="h-7 text-[11px] px-2"
                placeholder="Search terms"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                onClick={() => {
                  setErrored(false);
                  onFetch(searchTerms);
                }}
              >
                <Search className="w-3 h-3" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-1 pt-1">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 h-7 text-[11px] gap-1"
              onClick={handleDownload}
              disabled={noImage || downloading || fetching}
            >
              <Download className="w-3 h-3" /> {downloading ? "…" : "Save"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              onClick={() => {
                setErrored(false);
                onFetch();
              }}
              disabled={fetching}
              title="Re-search image"
            >
              <Search className="w-3 h-3" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

interface ImageHelperPanelProps {
  onBack: () => void;
  /** Optional: if provided, shows ONLY these products instead of reading from localStorage */
  products?: EnrichedImageProduct[];
  /** Optional: title override when scoped to a single invoice */
  scopeLabel?: string;
}

export default function ImageHelperPanel({ onBack, products: overrideProducts, scopeLabel }: ImageHelperPanelProps) {
  const confirmDialog = useConfirmDialog();
  const [copied, setCopied] = useState(false);

  const initial = (() => {
    if (overrideProducts) return overrideProducts;
    try {
      const raw = localStorage.getItem("last_enriched_products");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  const [products, setProducts] = useState<EnrichedImageProduct[]>(initial);
  const [fetchingIdx, setFetchingIdx] = useState<Set<number>>(new Set());
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [zipping, setZipping] = useState(false);

  const updateProduct = (idx: number, patch: Partial<EnrichedImageProduct>) => {
    setProducts((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };

  const setFetching = (idx: number, on: boolean) => {
    setFetchingIdx((prev) => {
      const next = new Set(prev);
      if (on) next.add(idx);
      else next.delete(idx);
      return next;
    });
  };

  const fetchOne = async (idx: number, customQuery?: string) => {
    setFetching(idx, true);
    try {
      const url = await fetchProductImage(products[idx], customQuery);
      if (url) {
        updateProduct(idx, { imageSrc: url, imageUrls: [url] });
      } else {
        updateProduct(idx, { imageSrc: "", imageUrls: [] });
        toast.error("No image found", { description: products[idx].title });
      }
    } finally {
      setFetching(idx, false);
    }
  };

  const fetchAll = async () => {
    if (products.length === 0) return;
    setBatchProgress({ current: 0, total: products.length });
    for (let i = 0; i < products.length; i++) {
      setBatchProgress({ current: i + 1, total: products.length });
      await fetchOne(i);
      await new Promise((r) => setTimeout(r, 800));
    }
    setBatchProgress(null);
    toast.success("Image fetch complete");
  };

  const withImage = products.filter((p) => p.imageSrc || (p.imageUrls && p.imageUrls.length > 0));
  const withoutImage = products.length - withImage.length;

  const copyUrlList = () => {
    const list = withImage.map((p) => `${p.title}\t${p.imageSrc || (p.imageUrls && p.imageUrls[0]) || ""}`).join("\n");
    navigator.clipboard.writeText(list);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openAllTabs = () => {
    const urls = withImage.map((p) => p.imageSrc || (p.imageUrls && p.imageUrls[0]) || "").filter(Boolean);
    if (urls.length === 0) return;
    if (urls.length > 20 && !confirm(`Open ${urls.length} tabs? Your browser may block this.`)) return;
    urls.forEach((url) => window.open(url, "_blank"));
  };

  const downloadZip = async () => {
    if (withImage.length === 0) return;
    setZipping(true);
    try {
      const JSZip = await loadJSZip();
      const zip = new JSZip();
      let added = 0;
      for (let i = 0; i < products.length; i++) {
        const p = products[i];
        const url = p.imageSrc || (p.imageUrls && p.imageUrls[0]) || "";
        if (!url) continue;
        try {
          const res = await fetch(url, { mode: "cors" });
          if (!res.ok) continue;
          const blob = await res.blob();
          zip.file(filenameFor(p, i), blob);
          added++;
        } catch {
          // skip
        }
      }
      if (added === 0) {
        toast.error("No images could be downloaded", { description: "CORS or network issue" });
        return;
      }
      const content = await zip.generateAsync({ type: "blob" });
      const blobUrl = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `product-images-${todayStamp()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      toast.success(`Downloaded ${added} images as ZIP`);
    } catch (e) {
      toast.error("ZIP download failed", { description: e instanceof Error ? e.message : "Unknown error" });
    } finally {
      setZipping(false);
    }
  };

  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-muted-foreground">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h2 className="text-lg font-semibold font-display">🖼 Image download helper</h2>
      </div>

      <p className="text-sm text-muted-foreground mb-5">
        {scopeLabel
          ? `Showing images from ${scopeLabel}.`
          : "Shopify imports images automatically from URLs. Use this if you also want the files on your computer."}
      </p>

      <div className="bg-card rounded-lg border border-border p-4 mb-4">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold">
              {scopeLabel ? "Images in this invoice" : "Images from last import"}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {products.length === 0
                ? "No products yet."
                : (
                  <>
                    <span className="text-success font-medium">{withImage.length} ready</span>
                    <span className="mx-1">·</span>
                    <span className={withoutImage > 0 ? "text-destructive font-medium" : ""}>
                      {withoutImage} not found
                    </span>
                  </>
                )}
            </p>
          </div>
          <Button
            variant="teal"
            size="sm"
            className="gap-1"
            onClick={fetchAll}
            disabled={products.length === 0 || batchProgress !== null}
          >
            {batchProgress ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Fetching {batchProgress.current} of {batchProgress.total}…
              </>
            ) : (
              <>
                <Search className="w-3.5 h-3.5" /> Fetch All Images
              </>
            )}
          </Button>
        </div>

        {products.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
            {products.map((p, i) => (
              <ImageTile
                key={i}
                product={p}
                index={i}
                fetching={fetchingIdx.has(i)}
                onFetch={(q) => fetchOne(i, q)}
                onUpdateUrl={(url) => updateProduct(i, { imageSrc: url, imageUrls: [url] })}
              />
            ))}
          </div>
        )}

        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mb-4">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-primary">💡 Tip:</span> Click "Fetch All Images" to search the web for each product, or use "Search" on individual tiles to refine.
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button
            variant="teal"
            size="sm"
            className="flex-1 gap-1 min-w-[140px]"
            onClick={openAllTabs}
            disabled={withImage.length === 0}
          >
            <ExternalLink className="w-3.5 h-3.5" /> Open all in tabs
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1 min-w-[140px]"
            onClick={copyUrlList}
            disabled={withImage.length === 0}
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5" /> Copied
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" /> Copy URL list
              </>
            )}
          </Button>
        </div>

        <Button
          variant="success"
          size="sm"
          className="w-full gap-1 mt-2"
          onClick={downloadZip}
          disabled={withImage.length === 0 || zipping}
        >
          {zipping ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Building ZIP…
            </>
          ) : (
            <>
              <Package className="w-3.5 h-3.5" /> Download all as ZIP ({withImage.length})
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
