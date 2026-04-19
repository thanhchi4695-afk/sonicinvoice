import { useState } from "react";
import { ChevronLeft, Download, ExternalLink, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export type EnrichedImageProduct = {
  title: string;
  sku?: string;
  colour?: string;
  imageSrc: string;
  imageUrls?: string[];
};

function slugifyForFilename(s: string): string {
  return (s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function ImageTile({
  product,
  index,
  onReenrich,
}: {
  product: EnrichedImageProduct;
  index: number;
  onReenrich: () => void;
}) {
  const [errored, setErrored] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [downloading, setDownloading] = useState(false);

  const url = product.imageSrc || (product.imageUrls && product.imageUrls[0]) || "";
  let domain = "";
  try {
    domain = url ? new URL(url).hostname.replace(/^www\./, "") : "";
  } catch {}

  const filename = (() => {
    const sku = slugifyForFilename(product.sku || "");
    const colour = slugifyForFilename(product.colour || "");
    const base = sku || slugifyForFilename(product.title) || `image-${index + 1}`;
    return colour ? `${base}-${colour}.jpg` : `${base}.jpg`;
  })();

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
        {!errored && url ? (
          <img
            src={url}
            alt={product.title}
            crossOrigin="anonymous"
            className="w-full h-full object-cover cursor-pointer"
            onClick={() => window.open(url, "_blank")}
            onLoad={(e) => {
              const img = e.currentTarget;
              setDims({ w: img.naturalWidth, h: img.naturalHeight });
            }}
            onError={() => setErrored(true)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-center p-2 gap-2">
            <p className="text-[10px] text-muted-foreground leading-tight">
              Image not available — try re-enriching
            </p>
            <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={onReenrich}>
              Re-enrich
            </Button>
          </div>
        )}
      </div>
      <div className="p-2 space-y-0.5">
        <p className="text-[11px] font-medium truncate" title={product.title}>
          {product.title}
        </p>
        {product.sku && (
          <p className="text-[10px] text-muted-foreground truncate font-mono-data">{product.sku}</p>
        )}
        {!errored && dims && (
          <p className="text-[10px] text-muted-foreground">
            {dims.w} × {dims.h}px
          </p>
        )}
        {!errored && domain && (
          <p className="text-[10px] text-muted-foreground truncate">{domain}</p>
        )}
        <Button
          size="sm"
          variant="outline"
          className="w-full h-7 text-[11px] gap-1 mt-1"
          onClick={handleDownload}
          disabled={errored || !url || downloading}
        >
          <Download className="w-3 h-3" /> {downloading ? "Downloading…" : "Download"}
        </Button>
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
  const [copied, setCopied] = useState(false);

  const getEnrichedProducts = (): EnrichedImageProduct[] => {
    if (overrideProducts) {
      return overrideProducts.filter((p) => p.imageSrc || (p.imageUrls && p.imageUrls.length > 0));
    }
    try {
      const raw = localStorage.getItem("last_enriched_products");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((p: any) => p.imageSrc || (p.imageUrls && p.imageUrls.length > 0))
        : [];
    } catch {
      return [];
    }
  };

  const products = getEnrichedProducts();

  const copyUrlList = () => {
    const list = products.map((p) => `${p.title}\t${p.imageSrc}`).join("\n");
    navigator.clipboard.writeText(list);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openAllTabs = () => {
    const urls = products.map((p) => p.imageSrc).filter(Boolean);
    if (urls.length === 0) return;
    if (urls.length > 20 && !confirm(`Open ${urls.length} tabs? Your browser may block this.`)) return;
    urls.forEach((url) => window.open(url, "_blank"));
  };

  const handleReenrich = () => {
    alert("Open the invoice review screen and click Enrich All to refetch images.");
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
        <h3 className="text-sm font-semibold mb-1">
          {scopeLabel ? "Images in this invoice" : "Images from last import"}
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          {products.length > 0
            ? `${products.length} products with images`
            : "No enriched products yet. Run Enrich All on an invoice first."}
        </p>

        {products.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
            {products.map((p, i) => (
              <ImageTile key={i} product={p} index={i} onReenrich={handleReenrich} />
            ))}
          </div>
        )}

        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mb-4">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-primary">💡 Tip:</span> Use the Download button on each
            tile to save with SKU-based filenames, or "Open all in tabs" to save many at once.
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            variant="teal"
            size="sm"
            className="flex-1 gap-1"
            onClick={openAllTabs}
            disabled={products.length === 0}
          >
            <ExternalLink className="w-3.5 h-3.5" /> Open all in tabs
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1"
            onClick={copyUrlList}
            disabled={products.length === 0}
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
      </div>
    </div>
  );
}
