import { useState } from "react";
import { Link as LinkIcon, Loader2, ImageIcon, X } from "lucide-react";
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
  open: boolean;
  onClose: () => void;
  onExtracted?: (product: ExtractedProduct) => void;
}

export default function FetchFromUrlDialog({ open, onClose, onExtracted }: Props) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExtractedProduct | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setUrl("");
    setResult(null);
    setError(null);
    setLoading(false);
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
      toast.success("Product details fetched");
      onExtracted?.(product);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && handleClose()}
      size="md"
      title={
        <span className="flex items-center gap-2">
          <LinkIcon className="w-4 h-4 text-primary" />
          Fetch product from URL
        </span>
      }
      description="Paste a product link from a brand or competitor's website. We'll pull the name, description, price and images."
      footer={
        <ModalFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            {result ? "Done" : "Cancel"}
          </Button>
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
              if (e.key === "Enter" && !loading) handleFetch();
            }}
            maxLength={2048}
            disabled={loading}
          />
        </FormField>

        {result && (
          <div className="rounded-lg border border-border bg-card p-3 space-y-2">
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
                onClick={() => setResult(null)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Clear result"
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
