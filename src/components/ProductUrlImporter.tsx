import { useState } from "react";
import { Link as LinkIcon, Loader2, ImageIcon, Plus, X, ExternalLink } from "lucide-react";
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

const urlSchema = z
  .string()
  .trim()
  .url({ message: "Please paste a valid URL (https://…)" })
  .max(2048, { message: "URL is too long" });

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

export default function ProductUrlImporter({ onAddToInvoice, className }: Props) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExtractedProduct | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setUrl("");
    setResult(null);
    setError(null);
  };

  const handleFetch = async () => {
    setError(null);
    const parsed = urlSchema.safeParse(url);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Invalid URL";
      setError(msg);
      toast.error(msg);
      return;
    }

    setLoading(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("product-extract", {
        body: { url: parsed.data },
      });

      if (fnError) throw new Error(fnError.message || "Extraction failed");
      if (!data?.success) {
        throw new Error(data?.error || "Could not extract product details");
      }

      setResult(data.product ?? {});
      toast.success("Product details fetched");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message);
      toast.error(message);
    } finally {
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
