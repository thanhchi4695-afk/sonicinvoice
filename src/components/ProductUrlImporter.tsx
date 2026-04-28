import { useState, useRef, useEffect } from "react";
import {
  Link as LinkIcon, Loader2, ImageIcon, Plus, X, ExternalLink, Check, Circle,
  Star, Trash2, ImagePlus, Layers, AlertTriangle, GripVertical,
} from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { addAuditEntry } from "@/lib/audit-log";
import { cn } from "@/lib/utils";

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

interface EditState {
  name: string;
  description: string;
  priceText: string;
  currency: string;
  images: Array<{ storedUrl: string; originalUrl?: string }>;
  primaryIndex: number;
}

type BulkStatus = "pending" | "fetching" | "success" | "error";
interface BulkRow {
  url: string;
  status: BulkStatus;
  product?: ExtractedProduct;
  error?: string;
}

const MAX_BULK_URLS = 25;

/** Parse a multi-URL textarea (newline / comma / space / tab separated). */
function parseBulkUrls(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  raw.split(/[\s,]+/).forEach((tok) => {
    const t = tok.trim();
    if (!t) return;
    const v = validateProductUrl(t);
    const key = v.ok ? v.value : t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(v.ok ? v.value : t);
  });
  return out;
}

export default function ProductUrlImporter({ onAddToInvoice, className }: Props) {
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [url, setUrl] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const [bulkRunning, setBulkRunning] = useState(false);
  const bulkAbortRef = useRef(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const bulkListRef = useRef<HTMLUListElement | null>(null);
  const touchDragRef = useRef<{ from: number; pointerId: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExtractedProduct | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [newImageUrl, setNewImageUrl] = useState("");
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
    setEdit(null);
    setNewImageUrl("");
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
      const product: ExtractedProduct = data.product ?? {};
      setResult(product);
      const priceText =
        typeof product.price === "number"
          ? String(product.price)
          : typeof product.price === "string"
            ? product.price
            : product.priceNormalized !== undefined
              ? String(product.priceNormalized)
              : "";
      setEdit({
        name: product.name?.trim() ?? "",
        description: product.description?.trim() ?? "",
        priceText,
        currency: product.currency ?? "",
        images: (product.images ?? []).filter((i) => !!i?.storedUrl),
        primaryIndex: 0,
      });
      toast.success("Product details fetched — review and edit before adding");
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
    if (!result || !edit) return;
    const trimmedPrice = edit.priceText.trim();
    const parsedPrice = trimmedPrice === "" ? undefined : Number(trimmedPrice);
    if (trimmedPrice !== "" && !Number.isFinite(parsedPrice)) {
      toast.error("Price must be a number (e.g. 49.95).");
      return;
    }

    // Re-order images so the chosen primary is first.
    const ordered = edit.images.length
      ? [edit.images[edit.primaryIndex], ...edit.images.filter((_, i) => i !== edit.primaryIndex)]
      : [];

    const item: ImportedLineItem = {
      name: edit.name.trim() || "Imported product",
      description: edit.description.trim() || undefined,
      price: parsedPrice,
      currency: edit.currency.trim() || undefined,
      imageUrls: ordered.map((i) => i.storedUrl).filter(Boolean),
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

  // ── Bulk mode ──────────────────────────────────────────────────
  const productToItem = (p: ExtractedProduct, fallbackUrl: string): ImportedLineItem => {
    const numericPrice =
      typeof p.price === "number"
        ? p.price
        : typeof p.price === "string" && p.price.trim() !== ""
          ? Number(p.price)
          : undefined;
    return {
      name: p.name?.trim() || "Imported product",
      description: p.description?.trim() || undefined,
      price: Number.isFinite(numericPrice) ? (numericPrice as number) : p.priceNormalized,
      currency: p.currency,
      imageUrls: (p.images ?? []).map((i) => i.storedUrl).filter(Boolean),
      sourceUrl: p.sourceUrl ?? fallbackUrl,
    };
  };

  const runBulk = async () => {
    const urls = parseBulkUrls(bulkText);
    if (urls.length === 0) {
      toast.error("Paste at least one product URL.");
      return;
    }
    if (urls.length > MAX_BULK_URLS) {
      toast.error(`Too many URLs — max ${MAX_BULK_URLS} at a time.`);
      return;
    }

    // Validate all upfront so user sees per-row issues immediately.
    const initial: BulkRow[] = urls.map((u) => {
      const v = validateProductUrl(u);
      if (v.ok === false) {
        return { url: u, status: "error" as const, error: v.message };
      }
      return { url: v.value, status: "pending" as const };
    });
    setBulkRows(initial);

    bulkAbortRef.current = false;
    setBulkRunning(true);

    // Sequential — respects upstream sites & avoids edge fn rate limits.
    for (let i = 0; i < initial.length; i++) {
      if (bulkAbortRef.current) break;
      if (initial[i].status === "error") continue;

      setBulkRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, status: "fetching" } : r)));

      try {
        const { data, error: fnError } = await supabase.functions.invoke("product-extract", {
          body: { url: initial[i].url },
        });
        if (fnError) throw new Error(fnError.message || "Extraction failed");
        if (!data?.success) throw new Error(data?.error || "Could not extract product details");
        const product: ExtractedProduct = data.product ?? {};
        setBulkRows((rows) =>
          rows.map((r, idx) => (idx === i ? { ...r, status: "success", product } : r)),
        );
      } catch (err) {
        const raw = err instanceof Error ? err.message : "Something went wrong";
        setBulkRows((rows) =>
          rows.map((r, idx) =>
            idx === i ? { ...r, status: "error", error: friendlyError(raw) } : r,
          ),
        );
      }

      // Light delay between requests to be a good citizen.
      if (i < initial.length - 1) {
        await new Promise((res) => setTimeout(res, 600));
      }
    }

    setBulkRunning(false);
    setBulkRows((rows) => {
      const successCount = rows.filter((r) => r.status === "success").length;
      if (successCount > 0) {
        toast.success(`Fetched ${successCount} product${successCount === 1 ? "" : "s"} — review then merge.`);
      }
      return rows;
    });
  };

  const stopBulk = () => {
    bulkAbortRef.current = true;
    toast.message("Stopping after current URL…");
  };

  const removeBulkRow = (idx: number) => {
    setBulkRows((rows) => rows.filter((_, i) => i !== idx));
  };

  const reorderBulkRow = (from: number, to: number) => {
    if (from === to) return;
    setBulkRows((rows) => {
      if (from < 0 || from >= rows.length || to < 0 || to >= rows.length) return rows;
      const next = rows.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const retryBulkRow = async (idx: number) => {
    const row = bulkRows[idx];
    if (!row || bulkRunning) return;
    setBulkRows((rows) => rows.map((r, i) => (i === idx ? { ...r, status: "fetching", error: undefined } : r)));
    try {
      const { data, error: fnError } = await supabase.functions.invoke("product-extract", {
        body: { url: row.url },
      });
      if (fnError) throw new Error(fnError.message || "Extraction failed");
      if (!data?.success) throw new Error(data?.error || "Could not extract product details");
      const product: ExtractedProduct = data.product ?? {};
      setBulkRows((rows) => rows.map((r, i) => (i === idx ? { ...r, status: "success", product } : r)));
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Something went wrong";
      setBulkRows((rows) =>
        rows.map((r, i) => (i === idx ? { ...r, status: "error", error: friendlyError(raw) } : r)),
      );
    }
  };

  const mergeBulkIntoInvoice = () => {
    const successes = bulkRows.filter((r) => r.status === "success" && r.product);
    if (successes.length === 0) {
      toast.error("No successful products to merge yet.");
      return;
    }
    if (!onAddToInvoice) {
      toast.error("No invoice target connected.");
      return;
    }
    successes.forEach((row) => {
      const item = productToItem(row.product!, row.url);
      onAddToInvoice(item);
      addAuditEntry(
        "url_import",
        `Bulk imported "${item.name}" from ${item.sourceUrl}${item.price !== undefined ? ` — ${item.currency ?? ""} ${item.price}` : ""}`,
      );
    });
    toast.success(`Merged ${successes.length} product${successes.length === 1 ? "" : "s"} into invoice`);
    setBulkRows([]);
    setBulkText("");
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
        <Tabs value={mode} onValueChange={(v) => setMode(v as "single" | "bulk")}>
          <TabsList className="grid grid-cols-2 w-full mb-3">
            <TabsTrigger value="single" className="text-xs">
              <LinkIcon className="w-3.5 h-3.5 mr-1.5" />
              Single URL
            </TabsTrigger>
            <TabsTrigger value="bulk" className="text-xs">
              <Layers className="w-3.5 h-3.5 mr-1.5" />
              Multiple URLs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="single" className="space-y-3 mt-0">
        <div className="space-y-2">
          <label
            htmlFor="product-url-input"
            className="flex items-center gap-1.5 text-sm font-medium text-foreground"
          >
            <LinkIcon className="w-3.5 h-3.5 text-primary" />
            Paste link
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                id="product-url-input"
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
                className="pl-9 h-11"
                aria-label="Product URL"
              />
            </div>
            <Button
              onClick={handleFetch}
              disabled={loading || !url.trim()}
              size="lg"
              className="h-11 sm:min-w-[170px] font-semibold"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Extracting…
                </>
              ) : (
                <>
                  <LinkIcon className="w-4 h-4 mr-2" />
                  Extract product
                </>
              )}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Press Enter or click <span className="font-medium text-foreground">Extract product</span> to start parsing.
          </p>
        </div>

        {loading && (
          <div
            className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2"
            role="status"
            aria-live="polite"
          >
            <p className="text-xs font-semibold text-primary mb-1">
              Working on it… this usually takes 5–15 seconds
            </p>
            <ul className="space-y-1.5">
              {STEPS.map((step, i) => {
                const done = i < stepIndex;
                const active = i === stepIndex;
                return (
                  <li
                    key={step.key}
                    className={cn(
                      "flex items-center gap-2 text-xs transition-colors",
                      done && "text-muted-foreground",
                      active && "text-foreground font-medium",
                      !done && !active && "text-muted-foreground/60",
                    )}
                  >
                    <span className="w-4 h-4 flex items-center justify-center shrink-0">
                      {done ? (
                        <Check className="w-3.5 h-3.5 text-primary" />
                      ) : active ? (
                        <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                      ) : (
                        <Circle className="w-2.5 h-2.5" />
                      )}
                    </span>
                    <span>{step.label}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}

        {result && edit && (
          <div className="rounded-lg border border-border bg-card/50 p-3 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                  Review & edit before adding
                </p>
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

            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor="edit-name" className="text-xs">Product name</Label>
              <Input
                id="edit-name"
                value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                placeholder="Untitled product"
                maxLength={255}
              />
            </div>

            {/* Price + Currency */}
            <div className="grid grid-cols-[1fr_110px] gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="edit-price" className="text-xs">Price</Label>
                <Input
                  id="edit-price"
                  inputMode="decimal"
                  value={edit.priceText}
                  onChange={(e) => setEdit({ ...edit, priceText: e.target.value })}
                  placeholder="0.00"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-currency" className="text-xs">Currency</Label>
                <Input
                  id="edit-currency"
                  value={edit.currency}
                  onChange={(e) => setEdit({ ...edit, currency: e.target.value.toUpperCase().slice(0, 3) })}
                  placeholder="AUD"
                  maxLength={3}
                  className="uppercase font-mono"
                />
              </div>
            </div>
            {result.priceNormalized !== undefined && edit.currency && edit.currency !== "AUD" && (
              <p className="text-[11px] text-muted-foreground -mt-2 font-mono">
                ≈ AUD {result.priceNormalized.toFixed(2)} (auto-converted)
              </p>
            )}

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="edit-desc" className="text-xs">Description</Label>
              <Textarea
                id="edit-desc"
                value={edit.description}
                onChange={(e) => setEdit({ ...edit, description: e.target.value })}
                placeholder="Add or refine the product description…"
                rows={4}
                className="resize-y"
              />
            </div>

            {/* Images */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">
                  Images ({edit.images.length})
                </Label>
                <span className="text-[10px] text-muted-foreground">
                  Click <Star className="inline w-2.5 h-2.5 -mt-0.5" /> to set the main image
                </span>
              </div>

              {edit.images.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {edit.images.map((img, i) => {
                    const isPrimary = i === edit.primaryIndex;
                    return (
                      <div
                        key={`${img.storedUrl}-${i}`}
                        className={cn(
                          "relative w-20 h-20 rounded-md border shrink-0 group overflow-hidden",
                          isPrimary ? "border-primary ring-2 ring-primary/40" : "border-border",
                        )}
                      >
                        <img
                          src={img.storedUrl}
                          alt={`Product image ${i + 1}`}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                        {isPrimary && (
                          <span className="absolute top-0.5 left-0.5 bg-primary text-primary-foreground text-[9px] font-semibold px-1 py-0.5 rounded">
                            MAIN
                          </span>
                        )}
                        <div className="absolute inset-x-0 bottom-0 flex justify-between bg-background/85 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => setEdit({ ...edit, primaryIndex: i })}
                            className="flex-1 p-1 text-muted-foreground hover:text-primary"
                            aria-label="Set as main image"
                            title="Set as main image"
                          >
                            <Star className={cn("w-3.5 h-3.5 mx-auto", isPrimary && "fill-primary text-primary")} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const next = edit.images.filter((_, idx) => idx !== i);
                              const newPrimary =
                                edit.primaryIndex === i
                                  ? 0
                                  : edit.primaryIndex > i
                                    ? edit.primaryIndex - 1
                                    : edit.primaryIndex;
                              setEdit({ ...edit, images: next, primaryIndex: Math.max(0, newPrimary) });
                            }}
                            className="flex-1 p-1 text-muted-foreground hover:text-destructive border-l border-border"
                            aria-label="Remove image"
                            title="Remove image"
                          >
                            <Trash2 className="w-3.5 h-3.5 mx-auto" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground italic">No images — add one below.</p>
              )}

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <ImagePlus className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    type="url"
                    value={newImageUrl}
                    onChange={(e) => setNewImageUrl(e.target.value)}
                    placeholder="Paste image URL (https://…)"
                    className="pl-8 h-9 text-xs"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        document.getElementById("add-image-btn")?.click();
                      }
                    }}
                  />
                </div>
                <Button
                  id="add-image-btn"
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!newImageUrl.trim()}
                  onClick={() => {
                    const trimmed = newImageUrl.trim();
                    try {
                      const u = new URL(trimmed);
                      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad protocol");
                    } catch {
                      toast.error("Image URL must start with http:// or https://");
                      return;
                    }
                    setEdit({
                      ...edit,
                      images: [...edit.images, { storedUrl: trimmed, originalUrl: trimmed }],
                    });
                    setNewImageUrl("");
                  }}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Add
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/60">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <ImageIcon className="w-3 h-3" />
                {edit.images.length} image{edit.images.length === 1 ? "" : "s"} ready
              </div>
              <Button size="sm" onClick={handleAdd} disabled={!onAddToInvoice}>
                <Plus className="w-4 h-4 mr-1.5" />
                Add to current invoice
              </Button>
            </div>
          </div>
        )}
          </TabsContent>

          <TabsContent value="bulk" className="space-y-3 mt-0">
            <div className="space-y-2">
              <Label htmlFor="bulk-urls" className="text-sm font-medium flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-primary" />
                Paste product links
              </Label>
              <Textarea
                id="bulk-urls"
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={"https://brand.com/products/dress-a\nhttps://brand.com/products/dress-b\nhttps://brand.com/products/dress-c"}
                rows={5}
                disabled={bulkRunning}
                className="font-mono text-xs resize-y"
              />
              <p className="text-[11px] text-muted-foreground">
                One URL per line, or separated by commas/spaces. Max {MAX_BULK_URLS} at a time.
                {bulkText.trim() && (() => {
                  const count = parseBulkUrls(bulkText).length;
                  return (
                    <span className="ml-1 font-medium text-foreground">
                      ({count} link{count === 1 ? "" : "s"} detected)
                    </span>
                  );
                })()}
              </p>
              <div className="flex gap-2">
                {!bulkRunning ? (
                  <Button
                    onClick={runBulk}
                    disabled={!bulkText.trim()}
                    size="lg"
                    className="h-11 flex-1 font-semibold"
                  >
                    <Layers className="w-4 h-4 mr-2" />
                    Extract all products
                  </Button>
                ) : (
                  <Button onClick={stopBulk} variant="outline" size="lg" className="h-11 flex-1">
                    <X className="w-4 h-4 mr-2" />
                    Stop after current
                  </Button>
                )}
              </div>
            </div>

            {bulkRows.length > 0 && (
              <div className="rounded-lg border border-border bg-card/50 p-2 space-y-2">
                <div className="flex items-center justify-between px-1 pb-1 border-b border-border/60">
                  <p className="text-xs font-semibold">
                    {bulkRows.filter((r) => r.status === "success").length} of {bulkRows.length} ready
                    {bulkRunning && " · processing…"}
                  </p>
                  <button
                    type="button"
                    onClick={() => setBulkRows([])}
                    disabled={bulkRunning}
                    className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    Clear list
                  </button>
                </div>

                <p className="text-[11px] text-muted-foreground px-1">
                  Drag <GripVertical className="inline w-3 h-3 -mt-0.5" /> to reorder — works with mouse <span className="hidden sm:inline">or touch</span><span className="sm:hidden">, or just touch & swipe up/down</span>.
                </p>
                <ul
                  ref={bulkListRef}
                  className="max-h-72 overflow-y-auto space-y-1.5 touch-pan-y"
                >
                  {bulkRows.map((row, i) => {
                    const draggable = !bulkRunning && row.status === "success";
                    const isDragging = dragIndex === i;
                    const isDragOver = dragOverIndex === i && dragIndex !== null && dragIndex !== i;
                    return (
                    <li
                      key={`${row.url}-${i}`}
                      data-row-index={i}
                      onDragOver={(e) => {
                        if (dragIndex === null || !draggable) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (dragOverIndex !== i) setDragOverIndex(i);
                      }}
                      onDrop={(e) => {
                        if (dragIndex === null) return;
                        e.preventDefault();
                        reorderBulkRow(dragIndex, i);
                        setDragIndex(null);
                        setDragOverIndex(null);
                      }}
                      onDragLeave={() => {
                        if (dragOverIndex === i) setDragOverIndex(null);
                      }}
                      className={cn(
                        "flex items-center gap-2 rounded-md p-2 text-xs border transition-all",
                        row.status === "success" && "border-primary/30 bg-primary/5",
                        row.status === "error" && "border-destructive/30 bg-destructive/5",
                        row.status === "fetching" && "border-primary/40 bg-primary/10",
                        row.status === "pending" && "border-border bg-background/40",
                        isDragging && "opacity-40",
                        isDragOver && "border-t-2 border-t-primary",
                      )}
                    >
                      <button
                        type="button"
                        draggable={draggable}
                        onDragStart={(e) => {
                          if (!draggable) {
                            e.preventDefault();
                            return;
                          }
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", String(i));
                          setDragIndex(i);
                        }}
                        onDragEnd={() => {
                          setDragIndex(null);
                          setDragOverIndex(null);
                        }}
                        disabled={!draggable}
                        aria-label="Drag to reorder"
                        title={draggable ? "Drag to reorder" : "Only successful rows can be reordered"}
                        className={cn(
                          "shrink-0 p-0.5 -ml-0.5 rounded text-muted-foreground",
                          draggable ? "cursor-grab active:cursor-grabbing hover:text-foreground hover:bg-background/60" : "opacity-30 cursor-not-allowed",
                        )}
                      >
                        <GripVertical className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-4 h-4 flex items-center justify-center shrink-0">
                        {row.status === "success" && <Check className="w-3.5 h-3.5 text-primary" />}
                        {row.status === "error" && <AlertTriangle className="w-3.5 h-3.5 text-destructive" />}
                        {row.status === "fetching" && <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />}
                        {row.status === "pending" && <Circle className="w-2.5 h-2.5 text-muted-foreground" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          {row.product?.name?.trim() || row.url}
                        </p>
                        {row.status === "success" && row.product && (
                          <p className="text-[11px] text-muted-foreground font-mono truncate">
                            {row.product.currency ?? ""} {row.product.price ?? ""} · {row.product.images?.length ?? 0} img
                          </p>
                        )}
                        {row.status === "error" && (
                          <p className="text-[11px] text-destructive truncate" title={row.error}>
                            {row.error || "Failed"}
                          </p>
                        )}
                        {row.status === "pending" && (
                          <p className="text-[11px] text-muted-foreground truncate">{row.url}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {row.status === "error" && !bulkRunning && (
                          <button
                            type="button"
                            onClick={() => retryBulkRow(i)}
                            className="text-[11px] text-primary hover:underline px-1"
                          >
                            Retry
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => removeBulkRow(i)}
                          disabled={bulkRunning && row.status === "fetching"}
                          className="text-muted-foreground hover:text-destructive disabled:opacity-30"
                          aria-label="Remove"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </li>
                    );
                  })}
                </ul>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/60">
                  <span className="text-[11px] text-muted-foreground">
                    Successful items will be merged into the invoice.
                  </span>
                  <Button
                    size="sm"
                    onClick={mergeBulkIntoInvoice}
                    disabled={
                      bulkRunning ||
                      !onAddToInvoice ||
                      bulkRows.filter((r) => r.status === "success").length === 0
                    }
                  >
                    <Plus className="w-4 h-4 mr-1.5" />
                    Merge {bulkRows.filter((r) => r.status === "success").length} into invoice
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
