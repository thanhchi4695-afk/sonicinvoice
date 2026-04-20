import { useState, useMemo, useCallback } from "react";
import {
  ChevronLeft, Sparkles, Percent, TrendingUp, Target, X as XIcon,
  ChevronDown, ChevronUp, AlertTriangle, Check, Download, Copy, Trash2, Save,
  DollarSign, ShoppingCart,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  type AdjustmentType, type AdjustField, type PriceRounding,
  type AdjustmentFilter, type AdjustmentRule, type AdjustmentTemplate,
  type ProductForAdjustment, type AdjustedProduct, type AdjustmentSummary,
  DEFAULT_FILTER, DEFAULT_RULE,
  matchesFilter, adjustProducts,
  loadTemplates, saveTemplate, deleteTemplate,
  applyPriceRounding,
} from "@/lib/price-adjustment";
import { useInvoiceSession } from "@/stores/invoice-session-store";
import InvoiceSessionBanner from "@/components/InvoiceSessionBanner";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  onBack: () => void;
  /** Pre-loaded products from an invoice or CSV */
  products?: ProductForAdjustment[];
}

const ADJUSTMENT_TYPES: { value: AdjustmentType; icon: React.ReactNode; label: string; desc: string }[] = [
  { value: "percent_discount", icon: <Percent className="w-5 h-5" />, label: "% Discount", desc: "Reduce by %" },
  { value: "percent_markup", icon: <TrendingUp className="w-5 h-5" />, label: "% Markup", desc: "Increase by %" },
  { value: "set_exact", icon: <Target className="w-5 h-5" />, label: "Set exact", desc: "Fixed $ amount" },
  { value: "multiply_by", icon: <DollarSign className="w-5 h-5" />, label: "Multiply by", desc: "Factor (e.g. 2×)" },
];

const ROUNDING_OPTIONS: { value: PriceRounding; label: string }[] = [
  { value: "none", label: "No rounding" },
  { value: "nearest_05", label: "Nearest $0.05" },
  { value: "nearest_1", label: "Nearest $1.00" },
  { value: "charm_95", label: "Charm (.95)" },
  { value: "nearest_5", label: "Nearest $5.00" },
  { value: "nearest_10", label: "Nearest $10.00" },
];

const QUICK_PERCENTS = [5, 10, 15, 20, 25, 30, 50];
const QUICK_FACTORS = [1.5, 2.0, 2.5, 3.0];

// Demo products for standalone mode
const DEMO_PRODUCTS: ProductForAdjustment[] = [
  { handle: "mara-one-piece", title: "Mara One Piece", vendor: "Bond Eye", type: "One Piece", tags: ["new arrivals", "full_price"], currentPrice: 199.95, compareAtPrice: null, costPrice: 58 },
  { handle: "gracie-top", title: "Gracie Balconette Top", vendor: "Bond Eye", type: "Bikini Top", tags: ["full_price"], currentPrice: 179.95, compareAtPrice: null, costPrice: 52 },
  { handle: "inez-bottom", title: "Inez Bikini Bottom", vendor: "Bond Eye", type: "Bikini Bottom", tags: ["full_price"], currentPrice: 149.95, compareAtPrice: null, costPrice: 44 },
  { handle: "sahara-kaftan", title: "Sahara Kaftan", vendor: "Jantzen", type: "Kaftan", tags: ["new arrivals", "sale"], currentPrice: 89.95, compareAtPrice: 120.00, costPrice: 42 },
  { handle: "mira-one-piece", title: "Mira One Piece", vendor: "Seafolly", type: "One Piece", tags: ["full_price"], currentPrice: 159.95, compareAtPrice: null, costPrice: 50 },
  { handle: "costa-bikini", title: "Costa Rica Bikini Set", vendor: "Seafolly", type: "Bikini Set", tags: ["new arrivals", "full_price"], currentPrice: 219.95, compareAtPrice: null, costPrice: 68 },
  { handle: "linen-shirt", title: "Linen Beach Shirt", vendor: "Jantzen", type: "Cover Up", tags: ["sale"], currentPrice: 49.95, compareAtPrice: 79.95, costPrice: 22 },
];

const PriceAdjustmentPanel = ({ onBack, products: externalProducts }: Props) => {
  const { sessionProducts, hasSession } = useInvoiceSession();
  const [source, setSource] = useState<"invoice" | "catalog">(hasSession ? "invoice" : "catalog");

  // Map invoice session products → ProductForAdjustment shape
  const invoiceProducts: ProductForAdjustment[] = useMemo(
    () => sessionProducts.map(p => ({
      handle: (p.sku || p.product_title).toLowerCase().replace(/\s+/g, "-"),
      title: p.product_title,
      vendor: p.vendor || "Unknown",
      type: "",
      tags: [],
      currentPrice: Number(p.rrp) || 0,
      compareAtPrice: null,
      costPrice: Number(p.unit_cost) || 0,
    })),
    [sessionProducts],
  );

  const products = externalProducts && externalProducts.length > 0
    ? externalProducts
    : (source === "invoice" && invoiceProducts.length > 0 ? invoiceProducts : DEMO_PRODUCTS);

  // Filter state
  const [filter, setFilter] = useState<AdjustmentFilter>({ ...DEFAULT_FILTER });
  // Rule state
  const [rule, setRule] = useState<AdjustmentRule>({ ...DEFAULT_RULE });
  // AI
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiExplanation, setAiExplanation] = useState("");
  // Templates
  const [templates, setTemplates] = useState<AdjustmentTemplate[]>(loadTemplates());
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  // UI
  const [showGuardrails, setShowGuardrails] = useState(false);
  const [applied, setApplied] = useState(false);
  const [showUndo, setShowUndo] = useState(false);

  // Derived
  const allBrands = useMemo(() => [...new Set(products.map(p => p.vendor))].sort(), [products]);
  const allTypes = useMemo(() => [...new Set(products.map(p => p.type))].sort(), [products]);
  const allTags = useMemo(() => [...new Set(products.flatMap(p => p.tags))].sort(), [products]);

  const matched = useMemo(() => products.filter(p => matchesFilter(p, filter)), [products, filter]);
  const { adjusted, summary } = useMemo(() => adjustProducts(products, filter, rule), [products, filter, rule]);

  // AI handler
  const handleAI = useCallback(async () => {
    if (!aiInstruction.trim()) return;
    setAiLoading(true);
    setAiExplanation("");
    try {
      const prices = products.map(p => p.currentPrice);
      const { data, error } = await supabase.functions.invoke("price-adjust-ai", {
        body: {
          instruction: aiInstruction,
          brands: allBrands, types: allTypes, tags: allTags,
          priceMin: Math.min(...prices), priceMax: Math.max(...prices),
        },
      });
      if (error) throw error;
      if (data.error) { toast.error(data.error); return; }

      // Map AI response to state
      if (data.filter) {
        setFilter({
          scope: data.filter.scope || "all",
          brands: data.filter.brands || [],
          types: data.filter.types || [],
          tags: data.filter.tags || [],
          priceMin: data.filter.priceMin ?? null,
          priceMax: data.filter.priceMax ?? null,
        });
      }
      setRule({
        field: data.field || "price",
        type: data.type || "percent_discount",
        value: data.value ?? 20,
        rounding: data.rounding || "nearest_05",
        customRoundValue: 1,
        floor: data.floor ?? null,
        ceiling: data.ceiling ?? null,
        marginFloor: data.marginFloor ?? null,
      });
      setAiExplanation(data.explanation || "Settings applied from your instruction.");
      toast.success("AI interpreted your instruction");
    } catch (e) {
      console.error(e);
      toast.error("Failed to interpret instruction");
    } finally {
      setAiLoading(false);
    }
  }, [aiInstruction, products, allBrands, allTypes, allTags]);

  const handleApply = () => {
    setApplied(true);
    setShowUndo(true);
    toast.success(`Prices adjusted for ${summary.affected} products`);
    setTimeout(() => setShowUndo(false), 10000);
  };

  const handleUndo = () => {
    setApplied(false);
    setShowUndo(false);
    toast("Price adjustments undone");
  };

  const handleSaveTemplate = () => {
    if (!templateName.trim()) return;
    const tmpl: AdjustmentTemplate = {
      id: `tmpl_${Date.now()}`,
      name: templateName.trim(),
      filter: { ...filter },
      rule: { ...rule },
      createdAt: new Date().toISOString(),
    };
    saveTemplate(tmpl);
    setTemplates(loadTemplates());
    setShowSaveTemplate(false);
    setTemplateName("");
    toast.success("Template saved");
  };

  const handleLoadTemplate = (tmpl: AdjustmentTemplate) => {
    setFilter({ ...tmpl.filter });
    setRule({ ...tmpl.rule });
    toast(`Loaded: ${tmpl.name}`);
  };

  const handleDeleteTemplate = (id: string) => {
    deleteTemplate(id);
    setTemplates(loadTemplates());
    toast("Template deleted");
  };

  const handleExportPreview = () => {
    const csv = [
      "Product,Brand,Current Price,New Price,Change %",
      ...adjusted.map(p =>
        `"${p.title}","${p.vendor}",${p.currentPrice.toFixed(2)},${p.newPrice.toFixed(2)},${p.changePercent.toFixed(1)}%`
      ),
    ].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `price_adjustment_preview_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Preview CSV downloaded");
  };

  // Inline filter toggle helper
  const toggleArrayFilter = (arr: string[], item: string) =>
    arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item];

  return (
    <div className="min-h-screen pb-24 animate-fade-in">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={onBack}><ChevronLeft className="w-5 h-5" /></button>
        <h1 className="font-display font-bold text-lg">💲 Price Adjustment</h1>
      </div>

      <div className="px-4 pt-4 space-y-4">
        <InvoiceSessionBanner />

        {hasSession && !externalProducts && (
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <span className="text-muted-foreground">Show:</span>
            <button
              onClick={() => setSource("invoice")}
              className={`px-3 py-1.5 rounded-full border transition-colors ${source === "invoice" ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
            >
              Current invoice ({invoiceProducts.length} products)
            </button>
            <button
              onClick={() => setSource("catalog")}
              className={`px-3 py-1.5 rounded-full border transition-colors ${source === "catalog" ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
            >
              All catalog
            </button>
          </div>
        )}

        {/* Templates bar */}
        {templates.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">📋 Saved templates</p>
            <div className="flex gap-2 flex-wrap">
              {templates.map(t => (
                <div key={t.id} className="flex items-center gap-1">
                  <button onClick={() => handleLoadTemplate(t)}
                    className="text-xs bg-muted px-3 py-1.5 rounded-full hover:bg-muted/80 transition-colors">
                    {t.name}
                  </button>
                  <button onClick={() => handleDeleteTemplate(t.id)} className="text-muted-foreground hover:text-destructive">
                    <XIcon className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AI natural language */}
        <div className="bg-card rounded-lg border border-border p-4">
          <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5" /> Describe your adjustment in plain English
          </p>
          <textarea
            value={aiInstruction}
            onChange={e => setAiInstruction(e.target.value)}
            placeholder='e.g. "Give 20% off all Bond Eye products"'
            className="w-full h-16 bg-input border border-border rounded-lg px-3 py-2 text-sm resize-none"
          />
          <Button variant="teal" size="sm" className="mt-2 w-full" onClick={handleAI} disabled={aiLoading || !aiInstruction.trim()}>
            {aiLoading ? "Interpreting..." : "✨ Apply instructions"}
          </Button>
          {aiExplanation && (
            <div className="mt-3 bg-primary/10 border border-primary/20 rounded-lg p-3 text-xs">
              <p className="font-semibold text-primary mb-1">✓ Understood:</p>
              <p className="text-foreground/80">{aiExplanation}</p>
            </div>
          )}
        </div>

        {/* Section 1: Product selection */}
        <div className="bg-card rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold mb-3">Apply to:</h3>
          <div className="space-y-2">
            {(["all", "brand", "type", "tag", "price_range"] as const).map(scope => (
              <label key={scope} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" name="scope" checked={filter.scope === scope}
                  onChange={() => setFilter(f => ({ ...f, scope }))}
                  className="accent-primary" />
                {scope === "all" && "All products"}
                {scope === "brand" && "Filter by brand"}
                {scope === "type" && "Filter by product type"}
                {scope === "tag" && "Filter by tag"}
                {scope === "price_range" && "Filter by price range"}
              </label>
            ))}
          </div>

          {/* Sub-filters */}
          {filter.scope === "brand" && (
            <div className="mt-3 flex flex-wrap gap-2">
              {allBrands.map(b => (
                <button key={b} onClick={() => setFilter(f => ({ ...f, brands: toggleArrayFilter(f.brands, b) }))}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    filter.brands.includes(b) ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"
                  }`}>{b}</button>
              ))}
            </div>
          )}
          {filter.scope === "type" && (
            <div className="mt-3 flex flex-wrap gap-2">
              {allTypes.map(t => (
                <button key={t} onClick={() => setFilter(f => ({ ...f, types: toggleArrayFilter(f.types, t) }))}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    filter.types.includes(t) ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"
                  }`}>{t}</button>
              ))}
            </div>
          )}
          {filter.scope === "tag" && (
            <div className="mt-3 flex flex-wrap gap-2">
              {allTags.map(t => (
                <button key={t} onClick={() => setFilter(f => ({ ...f, tags: toggleArrayFilter(f.tags, t) }))}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    filter.tags.includes(t) ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"
                  }`}>{t}</button>
              ))}
            </div>
          )}
          {filter.scope === "price_range" && (
            <div className="mt-3 flex items-center gap-2">
              <Input type="number" placeholder="Min $" className="w-24 h-9 text-sm"
                value={filter.priceMin ?? ""} onChange={e => setFilter(f => ({ ...f, priceMin: e.target.value ? Number(e.target.value) : null }))} />
              <span className="text-muted-foreground text-sm">to</span>
              <Input type="number" placeholder="Max $" className="w-24 h-9 text-sm"
                value={filter.priceMax ?? ""} onChange={e => setFilter(f => ({ ...f, priceMax: e.target.value ? Number(e.target.value) : null }))} />
            </div>
          )}

          <p className="mt-3 text-xs text-muted-foreground">
            📦 {matched.length} of {products.length} products match
          </p>
        </div>

        {/* Section 2: Adjustment rule */}
        <div className="bg-card rounded-lg border border-border p-4 space-y-4">
          <h3 className="text-sm font-semibold">Price adjustment rule</h3>

          {/* Field to adjust */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Field to adjust</label>
            <select value={rule.field} onChange={e => setRule(r => ({ ...r, field: e.target.value as AdjustField }))}
              className="w-full h-10 bg-input border border-border rounded-lg px-3 text-sm">
              <option value="price">Selling Price</option>
              <option value="compare_at">Compare-at Price (RRP)</option>
              <option value="both">Both Price and Compare-at</option>
              <option value="cost">Cost per item</option>
            </select>
          </div>

          {/* Adjustment type cards */}
          <div className="grid grid-cols-2 gap-2">
            {ADJUSTMENT_TYPES.map(at => (
              <button key={at.value}
                onClick={() => setRule(r => ({ ...r, type: at.value, value: at.value === "multiply_by" ? 2.0 : at.value === "set_exact" ? 49.95 : 20 }))}
                className={`p-3 rounded-lg border text-left transition-all ${
                  rule.type === at.value
                    ? "border-primary bg-primary/10 ring-1 ring-primary"
                    : "border-border hover:bg-muted"
                }`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={rule.type === at.value ? "text-primary" : "text-muted-foreground"}>{at.icon}</span>
                  <span className="text-sm font-semibold">{at.label}</span>
                </div>
                <p className="text-xs text-muted-foreground">{at.desc}</p>
              </button>
            ))}
          </div>

          {/* Value input */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              {rule.type === "percent_discount" ? "Reduce by" :
               rule.type === "percent_markup" ? "Increase by" :
               rule.type === "set_exact" ? "Set to" : "Multiply by"}
            </label>
            <div className="flex items-center gap-2">
              {(rule.type === "set_exact") && <span className="text-lg font-semibold">$</span>}
              <Input type="number" className="h-12 text-lg font-semibold w-32"
                value={rule.value} step={rule.type === "multiply_by" ? 0.1 : 1}
                onChange={e => setRule(r => ({ ...r, value: parseFloat(e.target.value) || 0 }))} />
              {(rule.type === "percent_discount" || rule.type === "percent_markup") && (
                <span className="text-lg font-semibold">%</span>
              )}
              {rule.type === "multiply_by" && <span className="text-lg font-semibold">×</span>}
            </div>
          </div>

          {/* Quick selects */}
          {(rule.type === "percent_discount" || rule.type === "percent_markup") && (
            <div className="flex flex-wrap gap-2">
              {QUICK_PERCENTS.map(p => (
                <button key={p} onClick={() => setRule(r => ({ ...r, value: p }))}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    rule.value === p ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"
                  }`}>{p}%</button>
              ))}
            </div>
          )}
          {rule.type === "multiply_by" && (
            <div className="flex flex-wrap gap-2">
              {QUICK_FACTORS.map(f => (
                <button key={f} onClick={() => setRule(r => ({ ...r, value: f }))}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    rule.value === f ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"
                  }`}>×{f}</button>
              ))}
            </div>
          )}

          {/* Formula */}
          {matched.length > 0 && (
            <p className="text-xs font-mono-data text-muted-foreground bg-muted/50 rounded px-3 py-2">
              {rule.type === "percent_discount" && `New price = Current × (1 − ${(rule.value / 100).toFixed(2)})`}
              {rule.type === "percent_markup" && `New price = Current × (1 + ${(rule.value / 100).toFixed(2)})`}
              {rule.type === "set_exact" && `New price = $${rule.value.toFixed(2)}`}
              {rule.type === "multiply_by" && `New price = Current × ${rule.value}`}
              {" → e.g. "}
              ${matched[0].currentPrice.toFixed(2)} → $
              {applyPriceRounding(
                rule.type === "percent_discount" ? matched[0].currentPrice * (1 - rule.value / 100) :
                rule.type === "percent_markup" ? matched[0].currentPrice * (1 + rule.value / 100) :
                rule.type === "set_exact" ? rule.value :
                matched[0].currentPrice * rule.value,
                rule.rounding, rule.customRoundValue
              ).toFixed(2)}
            </p>
          )}

          {/* Rounding */}
          <div>
            <label className="text-xs text-muted-foreground mb-2 block">Round adjusted prices to:</label>
            <div className="space-y-1.5">
              {ROUNDING_OPTIONS.map(r => (
                <label key={r.value} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="rounding" checked={rule.rounding === r.value}
                    onChange={() => setRule(prev => ({ ...prev, rounding: r.value }))}
                    className="accent-primary" />
                  {r.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Guardrails */}
        <button onClick={() => setShowGuardrails(!showGuardrails)}
          className="w-full flex items-center justify-between bg-card border border-border rounded-lg px-4 py-3 text-sm">
          <span>🛡️ Price guardrails (optional)</span>
          {showGuardrails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {showGuardrails && (
          <div className="bg-card rounded-lg border border-border p-4 space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Never go below $</label>
              <Input type="number" className="h-9 w-32 text-sm" placeholder="—"
                value={rule.floor ?? ""} onChange={e => setRule(r => ({ ...r, floor: e.target.value ? Number(e.target.value) : null }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Never go above $</label>
              <Input type="number" className="h-9 w-32 text-sm" placeholder="—"
                value={rule.ceiling ?? ""} onChange={e => setRule(r => ({ ...r, ceiling: e.target.value ? Number(e.target.value) : null }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Min margin above cost (%)</label>
              <Input type="number" className="h-9 w-32 text-sm" placeholder="—"
                value={rule.marginFloor ?? ""} onChange={e => setRule(r => ({ ...r, marginFloor: e.target.value ? Number(e.target.value) : null }))} />
              <p className="text-xs text-muted-foreground mt-1">Formula: Min price = Cost ÷ (1 − margin%)</p>
            </div>
          </div>
        )}

        {/* Section 3: Live preview */}
        {adjusted.length > 0 && (
          <div className="bg-card rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold mb-3">Preview — {adjusted.length} products affected</h3>

            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-2 text-muted-foreground font-medium">Product</th>
                    <th className="text-right py-2 px-2 text-muted-foreground font-medium">Current</th>
                    <th className="text-center py-2 px-1 text-muted-foreground">→</th>
                    <th className="text-right py-2 px-2 text-muted-foreground font-medium">New</th>
                    <th className="text-right py-2 pl-2 text-muted-foreground font-medium">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {adjusted.slice(0, 20).map(p => (
                    <tr key={p.handle} className="border-b border-border/50">
                      <td className="py-2 pr-2">
                        <p className="font-medium truncate max-w-[140px]">{p.title}</p>
                        <p className="text-muted-foreground">{p.vendor}</p>
                      </td>
                      <td className="text-right py-2 px-2 font-mono-data">${p.currentPrice.toFixed(2)}</td>
                      <td className="text-center py-2 px-1 text-muted-foreground">→</td>
                      <td className={`text-right py-2 px-2 font-mono-data font-semibold ${
                        p.belowCost ? "text-destructive" :
                        p.floorApplied || p.ceilingApplied ? "text-secondary" :
                        p.changePercent < 0 ? "text-success" :
                        p.changePercent > 0 ? "text-primary" : ""
                      }`}>
                        ${p.newPrice.toFixed(2)}
                        {p.floorApplied && <AlertTriangle className="w-3 h-3 inline ml-1 text-secondary" />}
                        {p.belowCost && <AlertTriangle className="w-3 h-3 inline ml-1 text-destructive" />}
                      </td>
                      <td className={`text-right py-2 pl-2 font-mono-data ${
                        p.changePercent < 0 ? "text-success" : p.changePercent > 0 ? "text-destructive" : "text-muted-foreground"
                      }`}>
                        {p.changePercent > 0 ? "+" : ""}{p.changePercent.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {adjusted.length > 20 && (
                <p className="text-xs text-muted-foreground text-center mt-2">+ {adjusted.length - 20} more products</p>
              )}
            </div>

            {/* Summary */}
            <div className="mt-4 bg-muted/50 rounded-lg p-3 text-xs space-y-1">
              <p><strong>{summary.affected}</strong> products affected</p>
              <p>Average change: <span className="font-mono-data">{summary.avgChange > 0 ? "+" : ""}{summary.avgChange}%</span></p>
              <p>Total before: <span className="font-mono-data">${summary.totalBefore.toFixed(2)}</span></p>
              <p>Total after: <span className="font-mono-data">${summary.totalAfter.toFixed(2)}</span></p>
              <p>Difference: <span className={`font-mono-data font-semibold ${summary.difference < 0 ? "text-success" : "text-destructive"}`}>
                {summary.difference > 0 ? "+" : ""}${summary.difference.toFixed(2)}
              </span></p>
              {summary.floored > 0 && (
                <p className="text-secondary">⚠ {summary.floored} price{summary.floored > 1 ? "s" : ""} floored (guardrail applied)</p>
              )}
              {summary.belowCost > 0 && (
                <p className="text-destructive">❌ {summary.belowCost} price{summary.belowCost > 1 ? "s" : ""} below cost</p>
              )}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="space-y-2">
          {!applied ? (
            <>
              <Button variant="teal" className="w-full h-12 text-base" onClick={handleApply} disabled={adjusted.length === 0}>
                <Check className="w-4 h-4 mr-2" /> Apply to {summary.affected} products
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={handleExportPreview}>
                  <Download className="w-4 h-4 mr-1" /> Export preview
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => setShowSaveTemplate(true)}>
                  <Save className="w-4 h-4 mr-1" /> Save template
                </Button>
              </div>
            </>
          ) : (
            <div className="bg-success/10 border border-success/20 rounded-lg p-4 text-center">
              <p className="text-sm font-semibold text-success">✅ Prices adjusted for {summary.affected} products</p>
              {showUndo && (
                <Button variant="outline" size="sm" className="mt-2" onClick={handleUndo}>
                  Undo ↩
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Save template modal */}
        {showSaveTemplate && (
          <div className="bg-card rounded-lg border border-border p-4 space-y-3">
            <p className="text-sm font-semibold">Save as template</p>
            <Input value={templateName} onChange={e => setTemplateName(e.target.value)}
              placeholder="e.g. 20% Bond Eye Sale" className="h-10" />
            <div className="flex gap-2">
              <Button variant="teal" size="sm" onClick={handleSaveTemplate} disabled={!templateName.trim()}>
                Save template
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowSaveTemplate(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PriceAdjustmentPanel;
