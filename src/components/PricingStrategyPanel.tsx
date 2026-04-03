import { useState } from "react";
import { DollarSign, RefreshCw, Check, Settings2, TrendingUp, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import {
  calculatePrice, calculateBulkPrices, getPricingRules, savePricingRules,
  type PricingInput, type PricingResult, type PricingRules,
} from "@/lib/pricing-strategy";

/* ─── inline button for single product ─── */
interface PricingInlineProps {
  costPrice: number;
  productType: string;
  vendor: string;
  currentPrice: number;
  onApply: (price: number, result: PricingResult) => void;
}

export function PricingButton({ costPrice, productType, vendor, currentPrice, onApply }: PricingInlineProps) {
  const [result, setResult] = useState<PricingResult | null>(null);
  const [open, setOpen] = useState(false);

  const run = () => {
    if (costPrice <= 0) {
      toast.error("Cost price required for AI pricing");
      return;
    }
    const r = calculatePrice({ costPrice, productType, vendor });
    setResult(r);
    setOpen(true);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" onClick={run}
          className="h-6 w-6 p-0 text-primary hover:text-primary/80" title="AI Pricing">
          <DollarSign className="w-3 h-3" />
        </Button>
      </PopoverTrigger>
      {result && (
        <PopoverContent className="w-64 p-3" side="bottom" align="start">
          <p className="text-[10px] font-semibold text-muted-foreground mb-2 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> AI Pricing Strategy
          </p>

          {/* Price range */}
          <div className="space-y-1.5 mb-2">
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-muted-foreground">Min</span>
              <span className="text-xs text-muted-foreground">${result.min_price.toFixed(2)}</span>
            </div>
            <button onClick={() => { onApply(result.recommended_price, result); setOpen(false); toast.success("Price applied"); }}
              className="w-full flex items-center justify-between px-2 py-1.5 rounded-md bg-primary/10 hover:bg-primary/20 transition-colors">
              <span className="text-[9px] font-medium text-primary">Recommended</span>
              <span className="text-sm font-bold text-foreground">${result.recommended_price.toFixed(2)}</span>
            </button>
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-muted-foreground">Max</span>
              <span className="text-xs text-muted-foreground">${result.max_price.toFixed(2)}</span>
            </div>
          </div>

          {/* Quick apply min/max */}
          <div className="flex gap-1 mb-2">
            <Button size="sm" variant="outline" className="flex-1 h-6 text-[9px]"
              onClick={() => { onApply(result.min_price, result); setOpen(false); toast.success("Min price applied"); }}>
              Apply Min
            </Button>
            <Button size="sm" variant="outline" className="flex-1 h-6 text-[9px]"
              onClick={() => { onApply(result.max_price, result); setOpen(false); toast.success("Max price applied"); }}>
              Apply Max
            </Button>
          </div>

          {/* Details */}
          <div className="pt-2 border-t border-border space-y-0.5 text-[9px] text-muted-foreground">
            <p>Cost: ${costPrice.toFixed(2)} · Margin: {result.margin_percentage}%</p>
            <p>Markup: {result.markup_multiple}x · {result.pricing_strategy_used}</p>
            <p>Confidence: {result.confidence_score}%</p>
          </div>
        </PopoverContent>
      )}
    </Popover>
  );
}

/* ─── pricing rules settings panel ─── */
export function PricingSettingsPanel({ onClose }: { onClose: () => void }) {
  const [rules, setRules] = useState<PricingRules>(getPricingRules());

  const save = () => {
    savePricingRules(rules);
    toast.success("Pricing rules saved");
    onClose();
  };

  return (
    <div className="space-y-3 p-3">
      <p className="text-xs font-semibold text-foreground flex items-center gap-1">
        <Settings2 className="w-3.5 h-3.5" /> Pricing Strategy Settings
      </p>

      {/* Mode */}
      <div>
        <p className="text-[9px] font-medium text-muted-foreground mb-1">Pricing Mode</p>
        <div className="flex gap-1">
          {(["markup", "margin"] as const).map(m => (
            <button key={m} onClick={() => setRules(r => ({ ...r, mode: m }))}
              className={`flex-1 px-2 py-1.5 rounded text-[10px] font-medium transition-colors ${rules.mode === m ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              {m === "markup" ? "Markup (×)" : "Margin (%)"}
            </button>
          ))}
        </div>
      </div>

      {/* Value */}
      <div>
        <p className="text-[9px] font-medium text-muted-foreground mb-1">
          {rules.mode === "markup" ? "Markup Multiplier" : "Target Margin %"}
        </p>
        <input type="number" step={rules.mode === "markup" ? "0.1" : "1"} value={rules.value}
          onChange={e => setRules(r => ({ ...r, value: parseFloat(e.target.value) || 0 }))}
          className="w-full h-8 px-2 rounded bg-background border border-border text-sm text-foreground" />
        <p className="text-[8px] text-muted-foreground mt-0.5">
          {rules.mode === "markup"
            ? `Cost $30 → $${(30 * rules.value).toFixed(2)}`
            : `Cost $30 → $${(30 / (1 - rules.value / 100)).toFixed(2)}`}
        </p>
      </div>

      {/* Rounding */}
      <div>
        <p className="text-[9px] font-medium text-muted-foreground mb-1">Price Rounding</p>
        <div className="flex gap-1">
          {(["psychological", "clean", "none"] as const).map(r => (
            <button key={r} onClick={() => setRules(ru => ({ ...ru, rounding: r }))}
              className={`flex-1 px-2 py-1.5 rounded text-[10px] font-medium transition-colors ${rules.rounding === r ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              {r === "psychological" ? ".95" : r === "clean" ? "Round" : "Exact"}
            </button>
          ))}
        </div>
      </div>

      {/* Min margin */}
      <div>
        <p className="text-[9px] font-medium text-muted-foreground mb-1">Minimum Margin Floor (%)</p>
        <input type="number" step="1" value={rules.minMarginPercent}
          onChange={e => setRules(r => ({ ...r, minMarginPercent: parseInt(e.target.value) || 0 }))}
          className="w-full h-8 px-2 rounded bg-background border border-border text-sm text-foreground" />
      </div>

      <Button className="w-full h-8 text-xs" onClick={save}>
        <Check className="w-3 h-3 mr-1" /> Save Rules
      </Button>
    </div>
  );
}

/* ─── bulk pricing helper ─── */
export { calculateBulkPrices, getPricingRules };
