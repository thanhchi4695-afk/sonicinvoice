import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";

export interface EnrichInvoiceProduct {
  brand?: string | null;
  product_name?: string | null;
  sku?: string | null;
  colour?: string | null;
  size?: string | null;
  price?: number | string | null;
  cost?: number | string | null;
}

export interface EnrichedFields {
  description: string;
  imageUrl: string;
  price: string;
  title?: string;
  sourceUrl?: string;
  confidence: number;
  source: "supplier" | "web";
}

interface EnrichResponse {
  success: boolean;
  enrichedProduct?: {
    title?: string;
    description?: string;
    imageUrl?: string;
    price?: string;
    sourceUrl?: string;
    confidence?: number;
  };
  confidence?: number;
  source?: "supplier" | "web";
  action?: "auto_accept" | "needs_review" | "skip";
  reasoning?: string;
  error?: string;
}

interface Props {
  productId?: string;
  invoiceProduct: EnrichInvoiceProduct;
  /** True when the row already has both description AND image — hides button. */
  hasDescriptionAndImage?: boolean;
  /** Called when enrichment is accepted (auto or by the user). */
  onEnriched: (fields: EnrichedFields) => void;
  className?: string;
  size?: "default" | "sm" | "lg" | "icon";
}

export const EnrichProductButton = ({
  productId,
  invoiceProduct,
  hasDescriptionAndImage,
  onEnriched,
  className,
  size = "sm",
}: Props) => {
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<EnrichedFields | null>(null);
  const [reasoning, setReasoning] = useState<string>("");

  const brand = (invoiceProduct.brand || "").trim();
  const productName = (invoiceProduct.product_name || "").trim();

  // Visibility rules: must have at least brand or product name,
  // AND must be missing at least one of description/image.
  if (!brand && !productName) return null;
  if (hasDescriptionAndImage) return null;

  const handleClick = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke<EnrichResponse>("enrich", {
        body: { productId, invoiceProduct },
      });

      if (error) {
        console.error("[EnrichProductButton] invoke error:", error);
        toast.error("No enrichment found – please add manually.");
        return;
      }

      if (!data) {
        toast.error("No enrichment found – please add manually.");
        return;
      }

      const action = data.action;
      const enriched = data.enrichedProduct;

      if (action === "skip" || !data.success || !enriched) {
        toast("No enrichment found – please add manually.");
        return;
      }

      const fields: EnrichedFields = {
        title: enriched.title,
        description: enriched.description ?? "",
        imageUrl: enriched.imageUrl ?? "",
        price: enriched.price ?? "",
        sourceUrl: enriched.sourceUrl,
        confidence: data.confidence ?? enriched.confidence ?? 0,
        source: (data.source as "supplier" | "web") ?? "web",
      };

      if (action === "auto_accept") {
        onEnriched(fields);
        toast.success("Enriched from web", {
          description: `Confidence ${fields.confidence}% · ${fields.source}`,
        });
        return;
      }

      // needs_review → open confirm dialog
      setReasoning(data.reasoning || "");
      setPending(fields);
    } catch (e) {
      console.error("[EnrichProductButton] unexpected error:", e);
      toast.error("No enrichment found – please add manually.");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = () => {
    if (pending) {
      onEnriched(pending);
      toast.success("Applied enrichment");
    }
    setPending(null);
  };

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size={size}
        onClick={handleClick}
        disabled={loading}
        className={className}
        title="Search supplier and web for product details"
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Sparkles className="w-3.5 h-3.5" />
        )}
        {loading ? "Enriching…" : "Enrich from Web"}
      </Button>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Review proposed enrichment</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-foreground">
                <div className="text-xs text-muted-foreground">
                  Confidence {pending?.confidence ?? 0}% · source: {pending?.source}
                </div>

                {pending?.title && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Title
                    </div>
                    <div className="font-medium">{pending.title}</div>
                  </div>
                )}

                {pending?.imageUrl && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                      Image
                    </div>
                    <img
                      src={pending.imageUrl}
                      alt={pending.title || "Proposed product image"}
                      className="max-h-32 rounded border border-border object-contain bg-muted"
                      loading="lazy"
                    />
                  </div>
                )}

                {pending?.description && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Description
                    </div>
                    <p className="line-clamp-4 text-xs">{pending.description}</p>
                  </div>
                )}

                {pending?.price && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">Price: </span>
                    <span className="font-mono">{pending.price}</span>
                  </div>
                )}

                {reasoning && (
                  <div className="text-[11px] text-muted-foreground italic border-l-2 border-border pl-2">
                    {reasoning}
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>Confirm & apply</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default EnrichProductButton;
