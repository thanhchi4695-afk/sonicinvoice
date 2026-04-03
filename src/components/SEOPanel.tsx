import { useState } from "react";
import { Search, RefreshCw, Sparkles, ChevronDown, ChevronUp, Check, Copy, Globe, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { getStoreConfig } from "@/lib/prompt-builder";
import { toast } from "sonner";

/* ─── types ─── */
export interface SEOResult {
  seo_description: string;
  short_description: string;
  meta_title: string;
  meta_description: string;
  keywords: string[];
  confidence_score: number;
  confidence_reason: string;
}

interface SEOProduct {
  title: string;
  type: string;
  vendor: string;
  colour: string;
  tags: string;
  pattern?: string;
}

/* ─── inline button for single product ─── */
interface SEOInlineProps {
  product: SEOProduct;
  onApply: (result: SEOResult) => void;
}

export function SEOButton({ product, onApply }: SEOInlineProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SEOResult | null>(null);
  const [open, setOpen] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const config = getStoreConfig();
      const { data, error } = await supabase.functions.invoke("seo-description", {
        body: {
          products: [product],
          storeName: config.name,
          storeCity: config.city,
          locale: config.locale,
          industry: config.industry,
          freeShippingThreshold: config.freeShippingThreshold,
        },
      });
      if (error) throw error;
      const r = data?.results?.[0];
      if (!r) throw new Error("No result");
      setResult(r);
      setOpen(true);
    } catch (e: any) {
      toast.error(e.message || "SEO generation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" onClick={run} disabled={loading}
          className="h-6 w-6 p-0 text-primary hover:text-primary/80" title="Generate SEO">
          {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Globe className="w-3 h-3" />}
        </Button>
      </PopoverTrigger>
      {result && (
        <PopoverContent className="w-80 p-3 max-h-96 overflow-y-auto" side="bottom" align="start">
          <p className="text-[10px] font-semibold text-muted-foreground mb-2 flex items-center gap-1">
            <Globe className="w-3 h-3" /> SEO Optimization
          </p>

          {/* Google preview */}
          <div className="bg-background border border-border rounded-lg p-2.5 mb-2.5">
            <p className="text-[10px] text-muted-foreground mb-1">Google Preview</p>
            <p className="text-sm text-[#1a0dab] font-medium leading-snug truncate">{result.meta_title}</p>
            <p className="text-[11px] text-[#006621] truncate">sonicinvoice.lovable.app › products</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{result.meta_description}</p>
          </div>

          {/* Meta title */}
          <div className="mb-2">
            <p className="text-[9px] font-semibold text-muted-foreground mb-0.5">Meta Title ({result.meta_title.length} chars)</p>
            <p className="text-xs text-foreground">{result.meta_title}</p>
          </div>

          {/* Meta description */}
          <div className="mb-2">
            <p className="text-[9px] font-semibold text-muted-foreground mb-0.5">Meta Description ({result.meta_description.length} chars)</p>
            <p className="text-xs text-foreground">{result.meta_description}</p>
          </div>

          {/* Short description */}
          <div className="mb-2">
            <p className="text-[9px] font-semibold text-muted-foreground mb-0.5">Short Description</p>
            <p className="text-xs text-foreground">{result.short_description}</p>
          </div>

          {/* Keywords */}
          {result.keywords.length > 0 && (
            <div className="mb-2">
              <p className="text-[9px] font-semibold text-muted-foreground mb-0.5">Keywords</p>
              <div className="flex flex-wrap gap-1">
                {result.keywords.map((k, i) => (
                  <span key={i} className="px-1.5 py-0.5 text-[9px] bg-muted rounded text-muted-foreground">{k}</span>
                ))}
              </div>
            </div>
          )}

          {/* Confidence */}
          <div className="mb-2 pt-1 border-t border-border">
            <p className="text-[9px] text-muted-foreground">
              Confidence: {result.confidence_score}% · {result.confidence_reason}
            </p>
          </div>

          {/* Apply button */}
          <Button size="sm" className="w-full h-7 text-xs" onClick={() => { onApply(result); setOpen(false); toast.success("SEO applied"); }}>
            <Check className="w-3 h-3 mr-1" /> Apply SEO
          </Button>
        </PopoverContent>
      )}
    </Popover>
  );
}

/* ─── bulk SEO generation ─── */
export interface BulkSEOProduct {
  id: string;
  title: string;
  type: string;
  vendor: string;
  colour: string;
  tags: string;
}

export async function runBulkSEO(
  products: BulkSEOProduct[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, SEOResult>> {
  const config = getStoreConfig();
  const results = new Map<string, SEOResult>();
  const batchSize = 15;

  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);
    try {
      const { data, error } = await supabase.functions.invoke("seo-description", {
        body: {
          products: batch.map(p => ({
            title: p.title, type: p.type, vendor: p.vendor,
            colour: p.colour, tags: p.tags,
          })),
          storeName: config.name,
          storeCity: config.city,
          locale: config.locale,
          industry: config.industry,
          freeShippingThreshold: config.freeShippingThreshold,
        },
      });
      if (error) throw error;
      const items = data?.results || [];
      batch.forEach((p, idx) => {
        if (items[idx]) results.set(p.id, items[idx]);
      });
    } catch (e) {
      console.error("Bulk SEO batch error:", e);
    }
    onProgress?.(Math.min(i + batchSize, products.length), products.length);
  }

  return results;
}
