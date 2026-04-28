import { useState, useRef, useEffect } from "react";
import { Link as LinkIcon, Loader2, ImageIcon, Plus, X, ExternalLink, Check, Circle } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { addAuditEntry } from "@/lib/audit-log";

// ════════════════════════════════════════════════════════════════
// ProductUrlImporter — standalone card variant of the URL paste-link
// agent. Posts to the `product-extract` Edge Function and lets the
// caller drop the result into the current invoice's line items.
//
// Companion to FetchFromUrlDialog (modal variant). Reuses the same
// edge function + ExtractedProduct shape.
// ════════════════════════════════════════════════════════════════

// ── URL validation ──────────────────────────────────────────────
// Hosts we know cannot be extracted as a single product page.
const UNSUPPORTED_HOSTS = [
  "google.com", "google.co", "bing.com", "duckduckgo.com",
  "facebook.com", "instagram.com", "tiktok.com", "twitter.com", "x.com",
  "youtube.com", "youtu.be", "pinterest.com",
  "amazon.com", "amazon.co.uk", "amazon.com.au",
  "ebay.com", "ebay.com.au", "alibaba.com", "aliexpress.com",
];

const baseUrlSchema = z
  .string()
  .trim()
  .min(1, { message: "Please paste a product URL." })
  .max(2048, { message: "That URL is too long — please shorten it (max 2048 characters)." });

/** Returns { ok, value } or { ok:false, message }. Auto-prepends https:// if missing. */
function validateProductUrl(raw: string): { ok: true; value: string } | { ok: false; message: string } {
  const base = baseUrlSchema.safeParse(raw);
  if (!base.success) {
    return { ok: false, message: base.error.issues[0]?.message ?? "Invalid URL" };
  }

  let candidate = base.data;
  if (!/^[a-z]+:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, message: "That doesn't look like a valid web link. Example: https://brand.com/products/dress" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, message: "Only http:// and https:// links are supported." };
  }

  const host = parsed.hostname.toLowerCase();
  if (!host || !host.includes(".")) {
    return { ok: false, message: "URL is missing a domain (e.g. brand.com)." };
  }
  if (host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return { ok: false, message: "Local or IP addresses aren't supported — paste a public product page." };
  }

  if (UNSUPPORTED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return {
      ok: false,
      message: `${parsed.hostname} isn't supported — search engines, social media and major marketplaces block automated extraction. Paste the brand's own product page instead.`,
    };
  }

  return { ok: true, value: parsed.toString() };
}

/** Map backend / network errors to friendly copy. */
function friendlyError(raw: string): string {
  const msg = (raw || "").toLowerCase();
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return "The site took too long to respond. Try again, or paste a different product page.";
  }
  if (msg.includes("403") || msg.includes("forbidden") || msg.includes("blocked")) {
    return "This site blocked our request. Try the brand's own page rather than a marketplace listing.";
  }
  if (msg.includes("404") || msg.includes("not found")) {
    return "That page wasn't found (404). Double-check the link is still live.";
  }
  if (msg.includes("network") || msg.includes("fetch failed") || msg.includes("failed to fetch")) {
    return "Couldn't reach the site. Check your connection and try again.";
  }
  if (msg.includes("no product") || msg.includes("could not extract") || msg.includes("not a product")) {
    return "We couldn't find product details on that page. Make sure the link points directly to a single product — not a category or homepage.";
  }
  if (msg.includes("rate") || msg.includes("429")) {
    return "We're being rate-limited by that site. Please wait a minute and try again.";
  }
  return raw || "Something went wrong fetching that product.";
}

export interface ImportedLineItem {
  name: string;
  description?: string;
  price?: number;
  currency?: string;
  imageUrls: string[];
  sourceUrl: string;
}

export interface ExtractedProduct {
  name?: string;
  description?: string;
  price?: number | string;
  currency?: string;
  priceNormalized?: number;
  images?: Array<{ storedUrl: string; originalUrl?: string }>;
  sourceUrl?: string;
  extractedAt?: string;
}

interface Props {
  /** Called when the user clicks "Add to current invoice". */
  onAddToInvoice?: (item: ImportedLineItem) => void;
  /** Optional className for the outer Card. */
  className?: string;
}

const STEPS = [
  { key: "fetch", label: "Fetching page" },
  { key: "extract", label: "Extracting product details" },
  { key: "images", label: "Downloading & optimising images" },
  { key: "shopify", label: "Preparing Shopify-ready fields" },
] as const;
type StepKey = (typeof STEPS)[number]["key"];

export default function ProductUrlImporter({ onAddToInvoice, className }: Props) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExtractedProduct | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const stepTimers = useRef<number[]>([]);

  const clearStepTimers = () => {
    stepTimers.current.forEach((id) => window.clearTimeout(id));
    stepTimers.current = [];
  };

  useEffect(() => () => clearStepTimers(), []);

  const reset = () => {
    setUrl("");
    setResult(null);
    setError(null);
    setStepIndex(0);
    clearStepTimers();
  };

  const handleFetch = async () => {
    setError(null);
    const v = validateProductUrl(url);
    if (v.ok === false) {
      setError(v.message);
      toast.error(v.message);
      return;
    }
    if (v.value !== url) setUrl(v.value);

    setLoading(true);
    setStepIndex(0);
    clearStepTimers();
    // Advance steps on a rough schedule so the UI feels alive even though the
    // edge function is a single round-trip. Last step waits for completion.
    const schedule = [1500, 4000, 8000]; // ms — advances to step 1, 2, 3
    schedule.forEach((delay, i) => {
      const id = window.setTimeout(() => setStepIndex(i + 1), delay);
      stepTimers.current.push(id);
    });

    try {
      const { data, error: fnError } = await supabase.functions.invoke("product-extract", {
        body: { url: v.value },
      });

      if (fnError) throw new Error(fnError.message || "Extraction failed");
      if (!data?.success) {
        throw new Error(data?.error || "Could not extract product details");
      }

      clearStepTimers();
      setStepIndex(STEPS.length); // mark all done
      setResult(data.product ?? {});
      toast.success("Product details fetched");
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Something went wrong";
      const message = friendlyError(raw);
      setError(message);
      toast.error(message);
    } finally {
      clearStepTimers();
      setLoading(false);
    }
  };

  const handleAdd = () => {
    if (!result) return;
    const numericPrice =
      typeof result.price === "number"
        ? result.price
        : typeof result.price === "string" && result.price.trim() !== ""
          ? Number(result.price)
          : undefined;

    const item: ImportedLineItem = {
      name: result.name?.trim() || "Imported product",
      description: result.description?.trim() || undefined,
      price: Number.isFinite(numericPrice) ? (numericPrice as number) : result.priceNormalized,
      currency: result.currency,
      imageUrls: (result.images ?? []).map((i) => i.storedUrl).filter(Boolean),
      sourceUrl: result.sourceUrl ?? url,
    };

    onAddToInvoice?.(item);
    addAuditEntry(
      "url_import",
      `Imported "${item.name}" from ${item.sourceUrl}${item.price !== undefined ? ` — ${item.currency ?? ""} ${item.price}` : ""}`,
    );
    toast.success(`Added "${item.name}" to invoice`);
    reset();
  };

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <LinkIcon className="w-4 h-4 text-primary" />
          Import from URL
        </CardTitle>
        <CardDescription>
          Paste a product link to pull name, description, price and images straight onto this invoice.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            type="url"
            inputMode="url"
            placeholder="https://brand.com/products/example"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !loading) handleFetch();
            }}
            maxLength={2048}
            disabled={loading}
            className="flex-1"
            aria-label="Product URL"
          />
          <Button onClick={handleFetch} disabled={loading || !url.trim()}>
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Fetching…
              </>
            ) : (
              <>
                <LinkIcon className="w-4 h-4 mr-2" />
                Fetch product
              </>
            )}
          </Button>
        </div>

        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}

        {result && (
          <div className="rounded-lg border border-border bg-card/50 p-3 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">
                  {result.name || "Untitled product"}
                </p>
                {(result.price !== undefined || result.currency) && (
                  <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                    {result.currency ?? ""} {result.price ?? ""}
                    {result.priceNormalized !== undefined && result.currency !== "AUD" && (
                      <span className="ml-1 text-muted-foreground/70">
                        (≈ AUD {result.priceNormalized.toFixed(2)})
                      </span>
                    )}
                  </p>
                )}
                {result.sourceUrl && (
                  <a
                    href={result.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 mt-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="w-3 h-3" />
                    View source
                  </a>
                )}
              </div>
              <button
                onClick={reset}
                className="text-muted-foreground hover:text-foreground shrink-0"
                aria-label="Clear result"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {result.description && (
              <p className="text-xs text-muted-foreground line-clamp-3">{result.description}</p>
            )}

            {result.images && result.images.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {result.images.slice(0, 8).map((img, i) => (
                  <img
                    key={i}
                    src={img.storedUrl}
                    alt={`Product image ${i + 1}`}
                    className="w-16 h-16 rounded-md object-cover border border-border shrink-0"
                    loading="lazy"
                  />
                ))}
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <ImageIcon className="w-3 h-3" />
                {result.images?.length ?? 0} image{(result.images?.length ?? 0) === 1 ? "" : "s"}
              </div>
              <Button size="sm" onClick={handleAdd} disabled={!onAddToInvoice}>
                <Plus className="w-4 h-4 mr-1.5" />
                Add to current invoice
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
