import { useState } from "react";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export interface ProductDescription {
  brandName: string;
  productName: string;
  colour: string;
  productType: string;
  features: string[];
  text: string;
  lengthVariant: "default" | "shorter" | "longer";
}

interface Props {
  description: ProductDescription;
  hasActiveParse?: boolean;
  onUpdate: (next: ProductDescription) => void;
}

export default function ProductDescriptionCard({ description, hasActiveParse, onUpdate }: Props) {
  const [busy, setBusy] = useState<null | "shorter" | "longer">(null);

  const heading = [description.brandName, description.productName].filter(Boolean).join(" ").trim();
  const headingLine = description.colour ? `${heading} — ${description.colour}` : heading;

  async function regenerate(variant: "shorter" | "longer") {
    setBusy(variant);
    try {
      const { data, error } = await supabase.functions.invoke("sonic-product-description", {
        body: {
          brand_name: description.brandName,
          product_name: description.productName,
          colour: description.colour,
          product_type: description.productType,
          features: description.features,
          length_variant: variant,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const text = String(data?.description ?? "").trim();
      onUpdate({ ...description, text, lengthVariant: variant });
      toast.success(variant === "shorter" ? "Shorter version" : "Longer version");
    } catch (e) {
      console.error(e);
      toast.error("Couldn't regenerate");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="w-full max-w-[85%] space-y-3 rounded-2xl border border-border bg-muted p-3 text-sm">
      <div>
        <div className="font-semibold">{headingLine || "Product description"}</div>
        <div className="my-1 border-t border-border" />
        <div className="whitespace-pre-wrap rounded bg-background/60 p-2 text-foreground">
          {description.text}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Character count: {description.text.length} chars
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(description.text);
              toast.success("Copied!");
            } catch {
              toast.error("Copy failed");
            }
          }}
        >
          <Copy className="mr-1 h-3 w-3" /> Copy
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!!busy}
          onClick={() => regenerate("shorter")}
        >
          {busy === "shorter" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
          Make it shorter
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!!busy}
          onClick={() => regenerate("longer")}
        >
          {busy === "longer" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
          Make it longer
        </Button>
        {hasActiveParse && (
          <Button
            size="sm"
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent("sonic:apply-product-description", {
                  detail: {
                    brandName: description.brandName,
                    productName: description.productName,
                    colour: description.colour,
                    body: description.text,
                  },
                }),
              );
              toast.success("Added to product");
            }}
          >
            Add to this product
          </Button>
        )}
      </div>
    </div>
  );
}
