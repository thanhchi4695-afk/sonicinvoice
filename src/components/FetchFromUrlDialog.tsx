import { useEffect, useMemo, useState } from "react";
import { Link as LinkIcon, Loader2, ImageIcon, X, Plus, Minus } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { FormField } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const urlSchema = z
  .string()
  .trim()
  .url({ message: "Please paste a valid URL (https://…)" })
  .max(2048, { message: "URL is too long" });

export interface ExtractedVariant {
  colour: string;
  size: string;
  qty: number;
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
  colors?: string[];
  sizes?: string[];
  /** Per-variant quantities chosen by the user before adding to invoice. */
  variants?: ExtractedVariant[];
  /** Total qty across all variants (sum of variants[].qty). */
  totalQty?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onExtracted?: (product: ExtractedProduct) => void;
}

const cellKey = (c: string, s: string) => `${c}\u0001${s}`;

export default function FetchFromUrlDialog({ open, onClose, onExtracted }: Props) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExtractedProduct | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Per-variant quantities, keyed by `${colour}\u0001${size}`.
  const [qtyMap, setQtyMap] = useState<Record<string, number>>({});

  const reset = () => {
    setUrl("");
    setResult(null);
    setError(null);
    setLoading(false);
    setQtyMap({});
  };

  const handleClose = () => {
    if (loading) return;
    reset();
    onClose();
  };

  const handleFetch = async () => {
    setError(null);
    const parsed = urlSchema.safeParse(url);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid URL");
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

      const product: ExtractedProduct = data.product ?? {};
      setResult(product);
      setQtyMap({});
      toast.success("Product details fetched");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  // Build axes for the qty matrix. Always render at least one row/col so the
  // user can enter a single quantity even when no variants were detected.
  const colours = useMemo(
    () => (result?.colors?.length ? result.colors : [""]),
    [result],
  );
  const sizes = useMemo(
    () => (result?.sizes?.length ? result.sizes : [""]),
    [result],
  );

  const totalQty = useMemo(
    () => Object.values(qtyMap).reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0),
    [qtyMap],
  );

  // When the result first arrives with no detected variants, default qty=1.
  useEffect(() => {
    if (!result) return;
    if ((result.colors?.length ?? 0) === 0 && (result.sizes?.length ?? 0) === 0) {
      setQtyMap({ [cellKey("", "")]: 1 });
    }
  }, [result]);

  const setCellQty = (colour: string, size: string, value: number) => {
    const v = Math.max(0, Math.min(9999, Math.floor(value || 0)));
    setQtyMap((prev) => {
      const next = { ...prev };
      if (v === 0) delete next[cellKey(colour, size)];
      else next[cellKey(colour, size)] = v;
      return next;
    });
  };

  const bumpCell = (colour: string, size: string, delta: number) => {
    const cur = qtyMap[cellKey(colour, size)] ?? 0;
    setCellQty(colour, size, cur + delta);
  };

  const handleAddToInvoice = () => {
    if (!result) return;
    if (totalQty <= 0) {
      toast.error("Enter a quantity for at least one variant");
      return;
    }
    const variants: ExtractedVariant[] = [];
    for (const c of colours) {
      for (const s of sizes) {
        const q = qtyMap[cellKey(c, s)] ?? 0;
        if (q > 0) variants.push({ colour: c, size: s, qty: q });
      }
    }
    onExtracted?.({ ...result, variants, totalQty });
    reset();
    onClose();
  };

  const hasVariantAxes =
    (result?.colors?.length ?? 0) > 0 || (result?.sizes?.length ?? 0) > 0;

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && handleClose()}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <LinkIcon className="w-4 h-4 text-primary" />
          Fetch product from URL
        </span>
      }
      description="Paste a product link from a brand or competitor's website. We'll pull the name, description, price and images — then enter how many of each colour/size you want to add."
      footer={
        <ModalFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          {!result ? (
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
          ) : (
            <Button onClick={handleAddToInvoice} disabled={totalQty <= 0}>
              Add {totalQty > 0 ? `${totalQty} ` : ""}to invoice
            </Button>
          )}
        </ModalFooter>
      }
    >
      <div className="space-y-4">
        <FormField label="Product URL" htmlFor="fetch-url" error={error ?? undefined}>
          <Input
            id="fetch-url"
            type="url"
            inputMode="url"
            autoFocus
            placeholder="https://brand.com/products/example"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !loading && !result) handleFetch();
            }}
            maxLength={2048}
            disabled={loading || !!result}
          />
        </FormField>

        {result && (
          <div className="rounded-lg border border-border bg-card p-3 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">
                  {result.name || "Untitled product"}
                </p>
                {(result.price !== undefined || result.currency) && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {result.currency ?? ""} {result.price ?? ""}
                    {result.priceNormalized !== undefined && result.currency !== "AUD" && (
                      <span className="ml-1 text-muted-foreground/70">
                        (≈ AUD {result.priceNormalized.toFixed(2)})
                      </span>
                    )}
                  </p>
                )}
              </div>
              <button
                onClick={reset}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Clear and start again"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {result.description && (
              <p className="text-xs text-muted-foreground line-clamp-3">
                {result.description}
              </p>
            )}

            {result.images && result.images.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {result.images.slice(0, 6).map((img, i) => (
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

            {/* Quantity matrix */}
            <div className="pt-2 border-t border-border">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold">
                  Quantity per variant
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Total: <span className="font-medium text-foreground">{totalQty}</span>
                </p>
              </div>

              {!hasVariantAxes ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    No variants detected — set total quantity:
                  </span>
                  <QtyInput
                    value={qtyMap[cellKey("", "")] ?? 1}
                    onChange={(v) => setCellQty("", "", v)}
                  />
                </div>
              ) : (
                <div className="overflow-x-auto -mx-1 px-1">
                  <table className="text-xs border-collapse">
                    <thead>
                      <tr>
                        <th className="text-left text-muted-foreground font-medium px-2 py-1 sticky left-0 bg-card">
                          {colours[0] === "" ? "Variant" : "Colour ↓ / Size →"}
                        </th>
                        {sizes.map((s) => (
                          <th
                            key={`h-${s || "_"}`}
                            className="text-left text-muted-foreground font-medium px-2 py-1 whitespace-nowrap"
                          >
                            {s || "—"}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {colours.map((c) => (
                        <tr key={`r-${c || "_"}`} className="border-t border-border">
                          <td className="px-2 py-1 text-foreground whitespace-nowrap sticky left-0 bg-card">
                            {c || "—"}
                          </td>
                          {sizes.map((s) => (
                            <td key={`c-${c}-${s}`} className="px-1 py-1">
                              <QtyInput
                                value={qtyMap[cellKey(c, s)] ?? 0}
                                onChange={(v) => setCellQty(c, s, v)}
                                onBump={(d) => bumpCell(c, s, d)}
                                compact
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <ImageIcon className="w-3 h-3" />
              {result.images?.length ?? 0} image{(result.images?.length ?? 0) === 1 ? "" : "s"} downloaded
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

interface QtyInputProps {
  value: number;
  onChange: (v: number) => void;
  onBump?: (delta: number) => void;
  compact?: boolean;
}

function QtyInput({ value, onChange, onBump, compact }: QtyInputProps) {
  return (
    <div className={`inline-flex items-center rounded-md border border-border bg-background ${compact ? "h-7" : "h-8"}`}>
      <button
        type="button"
        className="px-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
        onClick={() => (onBump ? onBump(-1) : onChange(Math.max(0, value - 1)))}
        disabled={value <= 0}
        aria-label="Decrease"
      >
        <Minus className="w-3 h-3" />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={9999}
        value={value === 0 ? "" : value}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
        placeholder="0"
        className={`w-10 text-center bg-transparent outline-none text-xs ${compact ? "py-0.5" : "py-1"}`}
      />
      <button
        type="button"
        className="px-1.5 text-muted-foreground hover:text-foreground"
        onClick={() => (onBump ? onBump(1) : onChange(value + 1))}
        aria-label="Increase"
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  );
}
