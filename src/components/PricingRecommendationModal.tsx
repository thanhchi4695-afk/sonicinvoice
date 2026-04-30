import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import {
  ExternalLink,
  Loader2,
  TrendingDown,
  AlertTriangle,
  ShieldCheck,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import {
  recommendPrice,
  simulateWhatIf,
  type LifecyclePhase,
} from "@/lib/pricing/lifecycleEngine";
import { fetchCompetitorPrice, type CompetitorPriceResult } from "@/lib/pricing/competitorScraper";
import {
  getVelocityForVariant,
  refreshSalesData,
  type VelocityResult,
} from "@/lib/pricing/salesVelocity";

export interface PricingProduct {
  id: string;
  title: string;
  sku: string | null;
  vendor: string | null;
  currentPrice: number;
  unitCost: number;
  stockOnHand: number;
  daysInInventory: number;
  /** Optional placeholder velocity. If omitted, what-if uses default 1.0 unit/wk. */
  avgWeeklySales?: number;
}

interface Props {
  product: PricingProduct;
  open: boolean;
  onClose: () => void;
}

const PHASE_TONE: Record<LifecyclePhase, string> = {
  1: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  2: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  3: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  4: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  5: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

export default function PricingRecommendationModal({ product, open, onClose }: Props) {
  // Competitor URL state
  const [competitorUrl, setCompetitorUrl] = useState("");
  const [scraping, setScraping] = useState(false);
  const [scraped, setScraped] = useState<CompetitorPriceResult | null>(null);

  // Build initial recommendation (no competitor data yet)
  const baseRec = useMemo(
    () =>
      recommendPrice({
        currentPrice: product.currentPrice,
        unitCost: product.unitCost,
        daysInInventory: product.daysInInventory,
        stockOnHand: product.stockOnHand,
        avgWeeklySales: product.avgWeeklySales,
        competitorPrice: scraped?.price ?? undefined,
      }),
    [product, scraped],
  );

  // Editable discount — defaults to engine recommendation
  const [discountPct, setDiscountPct] = useState<number>(baseRec.recommendedDiscountPct);
  useEffect(() => {
    setDiscountPct(baseRec.recommendedDiscountPct);
  }, [baseRec.recommendedDiscountPct]);

  // What-if simulator (Option B: simple elasticity model, default 2.0)
  const placeholderVelocity = product.avgWeeklySales ?? 1.0;
  const [elasticity, setElasticity] = useState(2.0);
  const whatIf = useMemo(
    () =>
      simulateWhatIf({
        currentPrice: product.currentPrice,
        unitCost: product.unitCost,
        avgWeeklySales: placeholderVelocity,
        stockOnHand: product.stockOnHand,
        discountPct,
        elasticity,
        horizonDays: 7,
      }),
    [product, placeholderVelocity, discountPct, elasticity],
  );

  const newPrice = +(product.currentPrice * (1 - discountPct)).toFixed(2);
  const belowFloor = newPrice < baseRec.marginFloorPrice;
  const finalPrice = belowFloor ? baseRec.marginFloorPrice : newPrice;

  const handleScrape = async () => {
    if (!competitorUrl.trim()) {
      toast.error("Paste a competitor product URL first");
      return;
    }
    setScraping(true);
    try {
      const result = await fetchCompetitorPrice(competitorUrl);
      setScraped(result);
      if (result.ok && result.price) {
        toast.success(`Found competitor price: $${result.price} (${result.source})`);
      } else {
        toast.error(result.message || "Could not detect price on that page");
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Scrape failed");
    } finally {
      setScraping(false);
    }
  };

  const handleApply = () => {
    // MVP: preview only. Wire to Shopify in Phase 2.
    toast.success(
      `Discount queued: ${(discountPct * 100).toFixed(0)}% off → $${finalPrice.toFixed(2)}`,
      { description: "Apply-to-Shopify will ship in the next release." },
    );
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-400" />
            Pricing Recommendation
          </DialogTitle>
          <p className="text-sm text-muted-foreground truncate">
            {product.title} {product.sku && <span className="font-mono ml-2">· {product.sku}</span>}
          </p>
        </DialogHeader>

        <div className="space-y-5">
          {/* Phase header */}
          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant="outline" className={PHASE_TONE[baseRec.phase]}>
              Phase {baseRec.phase} · {baseRec.phaseName}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {product.daysInInventory} days in inventory
            </span>
            <span className="text-sm text-muted-foreground">
              · Score <span className="font-semibold text-foreground">{baseRec.score}</span>/100
            </span>
            {baseRec.alertOnly && (
              <Badge variant="secondary" className="ml-auto">Alert-only mode</Badge>
            )}
          </div>

          {/* Reasons */}
          <div className="rounded-md border bg-muted/20 p-3 space-y-1">
            {baseRec.reasons.map((r, i) => (
              <div key={i} className="text-sm flex gap-2">
                <span className="text-muted-foreground">→</span>
                <span>{r}</span>
              </div>
            ))}
          </div>

          {/* Price grid */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-md border p-3">
              <div className="text-xs uppercase text-muted-foreground">Current</div>
              <div className="text-xl font-semibold tabular-nums">
                ${product.currentPrice.toFixed(2)}
              </div>
            </div>
            <div className="rounded-md border p-3 bg-amber-500/5 border-amber-500/30">
              <div className="text-xs uppercase text-amber-300">Suggested</div>
              <div className="text-xl font-semibold tabular-nums text-amber-200">
                ${finalPrice.toFixed(2)}
              </div>
              <div className="text-xs text-muted-foreground">
                {(discountPct * 100).toFixed(0)}% off
              </div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs uppercase text-muted-foreground flex items-center gap-1">
                <ShieldCheck className="h-3 w-3" /> Margin floor
              </div>
              <div className="text-xl font-semibold tabular-nums">
                ${baseRec.marginFloorPrice.toFixed(2)}
              </div>
            </div>
          </div>

          {belowFloor && (
            <div className="flex items-start gap-2 text-sm rounded-md border border-amber-500/40 bg-amber-500/10 p-2">
              <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
              <span>Capped at margin floor — slider value would breach minimum 15% gross.</span>
            </div>
          )}

          {/* Competitor URL */}
          <div className="space-y-2">
            <Label className="text-sm">Competitor URL (optional)</Label>
            <div className="flex gap-2">
              <Input
                placeholder="https://competitor.com/products/similar-style"
                value={competitorUrl}
                onChange={(e) => setCompetitorUrl(e.target.value)}
              />
              <Button onClick={handleScrape} disabled={scraping} variant="secondary">
                {scraping ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <ExternalLink className="h-4 w-4 mr-1" />
                    Fetch
                  </>
                )}
              </Button>
            </div>
            {scraped?.ok && scraped.price && (
              <div className="text-xs text-muted-foreground">
                Competitor: <span className="font-mono">${scraped.price.toFixed(2)}</span>
                {scraped.currency && <> {scraped.currency}</>} · source: {scraped.source}
                {baseRec.competitorGapPct !== null && (
                  <> · gap: <span className="font-semibold">{baseRec.competitorGapPct}%</span></>
                )}
              </div>
            )}
          </div>

          {/* Discount slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Discount</Label>
              <span className="text-sm font-mono tabular-nums">
                {(discountPct * 100).toFixed(0)}%
              </span>
            </div>
            <Slider
              value={[discountPct * 100]}
              onValueChange={([v]) => setDiscountPct(v / 100)}
              min={0}
              max={85}
              step={1}
            />
          </div>

          {/* What-if simulator */}
          <div className="rounded-md border bg-muted/10 p-3 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <TrendingDown className="h-4 w-4 text-amber-400" />
              What-if simulator (7-day projection)
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Projected units</div>
                <div className="font-semibold tabular-nums">
                  {whatIf.projectedUnitsInHorizon.toFixed(1)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Sell-through</div>
                <div className="font-semibold tabular-nums">
                  {whatIf.projectedSellThroughPct}%
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Revenue</div>
                <div className="font-semibold tabular-nums">
                  ${whatIf.projectedRevenue.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Gross margin</div>
                <div className="font-semibold tabular-nums">
                  ${whatIf.projectedGrossMargin.toFixed(2)}
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Price elasticity</span>
                <span className="font-mono">{elasticity.toFixed(1)}</span>
              </div>
              <Slider
                value={[elasticity * 10]}
                onValueChange={([v]) => setElasticity(v / 10)}
                min={5}
                max={40}
                step={1}
              />
              <p className="text-[11px] text-muted-foreground">
                Default 2.0 means every 10% discount drives 20% more units.
                {!product.avgWeeklySales && " Using placeholder velocity of 1 unit/week — connect sales data for real projections."}
              </p>
            </div>
            {whatIf.weeksToClear !== null && (
              <div className="text-xs text-muted-foreground">
                At this pace, stock clears in ~{whatIf.weeksToClear} week(s).
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>
            Dismiss
          </Button>
          <Button variant="outline" onClick={() => setDiscountPct(baseRec.recommendedDiscountPct)}>
            Reset to suggested
          </Button>
          <Button onClick={handleApply} disabled={discountPct === 0}>
            Apply discount
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
