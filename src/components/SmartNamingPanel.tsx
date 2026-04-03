import { useState } from "react";
import { Sparkles, ChevronDown, Check, RefreshCw, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { getStoreConfig } from "@/lib/prompt-builder";
import { toast } from "sonner";

/* ─── types ─── */
export interface SmartNamingResult {
  recommended_title: string;
  alternative_titles: string[];
  product_type: string;
  short_description: string;
  tags: string[];
  confidence_score: number;
  confidence_reason: string;
}

interface SmartNamingInlineProps {
  currentTitle: string;
  currentType: string;
  vendor: string;
  sku: string;
  barcode: string;
  colour: string;
  onApply: (result: { title: string; type: string; description: string; tags: string; confidence: number; confidenceReason: string }) => void;
}

/* ─── single-item inline button ─── */
export function SmartNamingButton({ currentTitle, currentType, vendor, sku, barcode, colour, onApply }: SmartNamingInlineProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SmartNamingResult | null>(null);
  const [open, setOpen] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const config = getStoreConfig();
      const { data, error } = await supabase.functions.invoke("smart-naming", {
        body: {
          products: [{ title: currentTitle, type: currentType, vendor, sku, barcode, colour }],
          storeName: config.name,
          storeCity: config.city,
          industry: config.industry,
        },
      });
      if (error) throw error;
      const r = data?.results?.[0];
      if (!r) throw new Error("No result");
      setResult(r);
      setOpen(true);
    } catch (e: any) {
      toast.error(e.message || "Smart naming failed");
    } finally {
      setLoading(false);
    }
  };

  const apply = (title: string) => {
    if (!result) return;
    onApply({
      title,
      type: result.product_type,
      description: result.short_description,
      tags: result.tags.join(", "),
      confidence: result.confidence_score,
      confidenceReason: result.confidence_reason,
    });
    setOpen(false);
    setResult(null);
    toast.success("Smart name applied");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" onClick={run} disabled={loading}
          className="h-6 w-6 p-0 text-primary hover:text-primary/80" title="Smart Naming AI">
          {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
        </Button>
      </PopoverTrigger>
      {result && (
        <PopoverContent className="w-72 p-3" side="bottom" align="start">
          <p className="text-[10px] font-semibold text-muted-foreground mb-2 flex items-center gap-1">
            <Wand2 className="w-3 h-3" /> Smart Naming AI
          </p>

          {/* Recommended */}
          <button onClick={() => apply(result.recommended_title)}
            className="w-full text-left px-2 py-1.5 rounded-md bg-primary/10 hover:bg-primary/20 transition-colors mb-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">{result.recommended_title}</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-medium">Recommended</span>
            </div>
          </button>

          {/* Alternatives */}
          {result.alternative_titles.map((alt, i) => (
            <button key={i} onClick={() => apply(alt)}
              className="w-full text-left px-2 py-1.5 rounded-md hover:bg-muted/60 transition-colors">
              <span className="text-xs text-muted-foreground">{alt}</span>
            </button>
          ))}

          {/* Meta */}
          <div className="mt-2 pt-2 border-t border-border space-y-1">
            <p className="text-[9px] text-muted-foreground">Type: {result.product_type}</p>
            {result.short_description && (
              <p className="text-[9px] text-muted-foreground line-clamp-2">{result.short_description}</p>
            )}
            <p className="text-[9px] text-muted-foreground">
              Confidence: {result.confidence_score}% · {result.confidence_reason}
            </p>
          </div>
        </PopoverContent>
      )}
    </Popover>
  );
}

/* ─── bulk naming hook ─── */
export interface BulkProduct {
  id: string;
  title: string;
  type: string;
  vendor: string;
  sku: string;
  barcode: string;
  colour: string;
}

export async function runBulkSmartNaming(
  products: BulkProduct[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, SmartNamingResult>> {
  const config = getStoreConfig();
  const results = new Map<string, SmartNamingResult>();
  const batchSize = 20;

  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);
    try {
      const { data, error } = await supabase.functions.invoke("smart-naming", {
        body: {
          products: batch.map(p => ({
            title: p.title, type: p.type, vendor: p.vendor,
            sku: p.sku, barcode: p.barcode, colour: p.colour,
          })),
          storeName: config.name,
          storeCity: config.city,
          industry: config.industry,
        },
      });
      if (error) throw error;
      const items = data?.results || [];
      batch.forEach((p, idx) => {
        if (items[idx]) results.set(p.id, items[idx]);
      });
    } catch (e) {
      console.error("Bulk naming batch error:", e);
    }
    onProgress?.(Math.min(i + batchSize, products.length), products.length);
  }

  return results;
}
