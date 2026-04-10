import { useState, useCallback } from "react";
import {
  ChevronLeft, ChevronRight, Check, Upload, Package, FileText,
  ShoppingCart, Zap, TrendingUp, BarChart3, Sparkles, ArrowRight,
  Shield, Clock, DollarSign, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import Papa from "papaparse";
import { toast } from "sonner";

interface StockyOnboardingProps {
  onComplete: () => void;
  onBack: () => void;
  onStartPipeline: (id: string) => void;
  onStartFlow: (flow: string) => void;
}

type Step = "welcome" | "import_products" | "import_inventory" | "import_pos" | "comparison" | "highlights" | "launch";

interface ImportStats {
  products: number;
  variants: number;
  inventory: number;
  purchaseOrders: number;
}

const COMPARISON_ROWS = [
  { feature: "Purchase orders", stocky: true, sonic: true, sonicExtra: "with AI matching" },
  { feature: "Demand forecasting", stocky: true, sonic: true, sonicExtra: "AI-powered" },
  { feature: "Dead stock detection", stocky: true, sonic: true, sonicExtra: "with capital at cost" },
  { feature: "Stocktake management", stocky: true, sonic: true, sonicExtra: "" },
  { feature: "Reorder suggestions", stocky: true, sonic: true, sonicExtra: "seasonal intelligence" },
  { feature: "Supplier performance", stocky: false, sonic: true, sonicExtra: "" },
  { feature: "Invoice → Shopify", stocky: false, sonic: true, sonicExtra: "AI parsing" },
  { feature: "Margin protection", stocky: false, sonic: true, sonicExtra: "real-time" },
  { feature: "Markdown ladders", stocky: false, sonic: true, sonicExtra: "automated" },
  { feature: "Google Shopping feed", stocky: false, sonic: true, sonicExtra: "AI optimised" },
  { feature: "SEO & blog generation", stocky: false, sonic: true, sonicExtra: "" },
  { feature: "Social media automation", stocky: false, sonic: true, sonicExtra: "" },
  { feature: "Automation pipelines", stocky: false, sonic: true, sonicExtra: "5 built-in" },
  { feature: "Xero / MYOB integration", stocky: false, sonic: true, sonicExtra: "" },
  { feature: "Profit & Loss reporting", stocky: false, sonic: true, sonicExtra: "" },
];

const STEPS_ORDER: Step[] = ["welcome", "import_products", "import_inventory", "import_pos", "comparison", "highlights", "launch"];

const StockyOnboarding = ({ onComplete, onBack, onStartPipeline, onStartFlow }: StockyOnboardingProps) => {
  const [step, setStep] = useState<Step>("welcome");
  const [stats, setStats] = useState<ImportStats>({ products: 0, variants: 0, inventory: 0, purchaseOrders: 0 });
  const [importing, setImporting] = useState(false);
  const [importedSections, setImportedSections] = useState<Set<string>>(new Set());

  const stepIdx = STEPS_ORDER.indexOf(step);
  const progressPct = Math.round(((stepIdx) / (STEPS_ORDER.length - 1)) * 100);

  const next = useCallback(() => {
    const idx = STEPS_ORDER.indexOf(step);
    if (idx < STEPS_ORDER.length - 1) setStep(STEPS_ORDER[idx + 1]);
  }, [step]);

  const prev = useCallback(() => {
    const idx = STEPS_ORDER.indexOf(step);
    if (idx > 0) setStep(STEPS_ORDER[idx - 1]);
    else onBack();
  }, [step, onBack]);

  const handleFileImport = useCallback((type: "products" | "inventory" | "purchase_orders", file: File) => {
    setImporting(true);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const count = result.data.length;
        if (type === "products") {
          // Count unique products vs variants
          const titles = new Set(result.data.map((r: any) => r["Title"] || r["title"] || r["Handle"] || ""));
          setStats(s => ({ ...s, products: titles.size || count, variants: count }));
        } else if (type === "inventory") {
          setStats(s => ({ ...s, inventory: count }));
        } else {
          setStats(s => ({ ...s, purchaseOrders: count }));
        }
        setImportedSections(s => new Set([...s, type]));
        setImporting(false);
        toast.success(`Imported ${count} rows from ${file.name}`);
      },
      error: () => {
        setImporting(false);
        toast.error("Failed to parse CSV file");
      },
    });
  }, []);

  const renderFileUpload = (type: "products" | "inventory" | "purchase_orders", label: string, desc: string, icon: React.ReactNode) => {
    const done = importedSections.has(type);
    return (
      <label className={`flex items-center gap-3 rounded-xl border-2 p-4 cursor-pointer transition-all ${done ? "border-green-500/50 bg-green-500/5" : "border-dashed border-border hover:border-primary/50 hover:bg-primary/5"}`}>
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileImport(type, f);
          }}
        />
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${done ? "bg-green-500/10" : "bg-muted"}`}>
          {done ? <Check className="w-5 h-5 text-green-500" /> : icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{label}</p>
          <p className="text-xs text-muted-foreground">{desc}</p>
          {done && (
            <p className="text-[10px] text-green-600 mt-0.5">
              {type === "products" ? `${stats.products} products, ${stats.variants} variants` : 
               type === "inventory" ? `${stats.inventory} inventory rows` : 
               `${stats.purchaseOrders} purchase orders`}
            </p>
          )}
        </div>
        {importing && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
      </label>
    );
  };

  return (
    <div className="min-h-screen flex flex-col animate-fade-in">
      {/* Progress */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center gap-2 mb-2">
          <button onClick={prev} className="text-muted-foreground hover:text-foreground">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-xs text-muted-foreground flex-1">Switching from Stocky</span>
          <span className="text-xs text-muted-foreground">{stepIdx + 1}/{STEPS_ORDER.length}</span>
        </div>
        <Progress value={progressPct} className="h-1.5" />
      </div>

      <div className="flex-1 px-5 pb-8 overflow-y-auto">
        {/* ── Welcome ── */}
        {step === "welcome" && (
          <div className="pt-8 text-center">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-5">
              <span className="text-4xl">📦</span>
            </div>
            <h1 className="text-2xl font-bold font-display mb-2">Moving from Stocky?</h1>
            <p className="text-sm text-muted-foreground mb-2 max-w-sm mx-auto">
              Shopify is sunsetting Stocky in 2026. Sonic Invoices replaces everything Stocky does — 
              plus invoice processing, SEO, marketing, and automation pipelines.
            </p>
            <p className="text-xs text-muted-foreground mb-8">
              Let's import your data and show you what's new.
            </p>

            <div className="grid grid-cols-3 gap-3 mb-8 max-w-sm mx-auto">
              <div className="bg-card border border-border rounded-lg p-3 text-center">
                <Package className="w-5 h-5 text-primary mx-auto mb-1" />
                <p className="text-[10px] text-muted-foreground">Import data</p>
              </div>
              <div className="bg-card border border-border rounded-lg p-3 text-center">
                <BarChart3 className="w-5 h-5 text-primary mx-auto mb-1" />
                <p className="text-[10px] text-muted-foreground">See what's new</p>
              </div>
              <div className="bg-card border border-border rounded-lg p-3 text-center">
                <Zap className="w-5 h-5 text-primary mx-auto mb-1" />
                <p className="text-[10px] text-muted-foreground">Run first workflow</p>
              </div>
            </div>

            <Button variant="teal" className="w-full max-w-sm h-12 text-base" onClick={next}>
              Let's get started <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
            <button onClick={onBack} className="w-full mt-4 text-xs text-muted-foreground text-center">
              Skip — I'll set up later
            </button>
          </div>
        )}

        {/* ── Import Products ── */}
        {step === "import_products" && (
          <div className="pt-4">
            <h2 className="text-xl font-bold font-display mb-1">Step 1: Import your products</h2>
            <p className="text-sm text-muted-foreground mb-5">
              Export your Shopify products CSV and upload it here. We'll import your product catalog, 
              cost prices, and variant data.
            </p>

            <div className="space-y-3 mb-6">
              {renderFileUpload("products", "Shopify products CSV", "Export from Shopify Admin → Products → Export", <ShoppingCart className="w-5 h-5 text-muted-foreground" />)}
            </div>

            <div className="bg-muted/50 rounded-lg p-3 mb-6">
              <p className="text-xs font-semibold mb-1">How to export from Shopify:</p>
              <ol className="text-[11px] text-muted-foreground space-y-1 list-decimal pl-4">
                <li>Go to Shopify Admin → Products</li>
                <li>Click "Export" in the top right</li>
                <li>Select "All products" and "Plain CSV file"</li>
                <li>Upload the downloaded CSV here</li>
              </ol>
            </div>

            <div className="flex gap-2">
              <Button variant="teal" className="flex-1 h-11" onClick={next}>
                {importedSections.has("products") ? "Continue" : "Skip for now"} <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Import Inventory ── */}
        {step === "import_inventory" && (
          <div className="pt-4">
            <h2 className="text-xl font-bold font-display mb-1">Step 2: Import inventory levels</h2>
            <p className="text-sm text-muted-foreground mb-5">
              If you have a Stocky inventory export or Shopify inventory CSV, upload it to bring your stock levels across.
            </p>

            <div className="space-y-3 mb-6">
              {renderFileUpload("inventory", "Inventory CSV", "Stocky export or Shopify inventory levels", <Package className="w-5 h-5 text-muted-foreground" />)}
            </div>

            {stats.products > 0 && (
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mb-6">
                <p className="text-xs font-semibold text-primary mb-1">Already imported</p>
                <p className="text-xs text-muted-foreground">
                  {stats.products} products · {stats.variants} variants from Step 1
                </p>
              </div>
            )}

            <Button variant="teal" className="w-full h-11" onClick={next}>
              {importedSections.has("inventory") ? "Continue" : "Skip for now"} <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* ── Import Purchase Orders ── */}
        {step === "import_pos" && (
          <div className="pt-4">
            <h2 className="text-xl font-bold font-display mb-1">Step 3: Import purchase orders</h2>
            <p className="text-sm text-muted-foreground mb-5">
              Bring your Stocky purchase order history across so you keep supplier records and cost price history.
            </p>

            <div className="space-y-3 mb-6">
              {renderFileUpload("purchase_orders", "Stocky PO export", "Purchase order history from Stocky", <FileText className="w-5 h-5 text-muted-foreground" />)}
            </div>

            {(stats.products > 0 || stats.inventory > 0) && (
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mb-6">
                <p className="text-xs font-semibold text-primary mb-1">Import summary so far</p>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  {stats.products > 0 && <p>✓ {stats.products} products, {stats.variants} variants</p>}
                  {stats.inventory > 0 && <p>✓ {stats.inventory} inventory rows</p>}
                </div>
              </div>
            )}

            <Button variant="teal" className="w-full h-11" onClick={next}>
              {importedSections.has("purchase_orders") ? "Continue" : "Skip for now"} <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* ── Comparison ── */}
        {step === "comparison" && (
          <div className="pt-4">
            <h2 className="text-xl font-bold font-display mb-1">Stocky vs Sonic Invoices</h2>
            <p className="text-sm text-muted-foreground mb-5">
              Everything Stocky does, plus 40+ features you didn't have before.
            </p>

            <div className="border border-border rounded-xl overflow-hidden mb-6">
              {/* Header */}
              <div className="grid grid-cols-[1fr,60px,60px] bg-muted/50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span>Feature</span>
                <span className="text-center">Stocky</span>
                <span className="text-center text-primary">Sonic</span>
              </div>
              {/* Rows */}
              {COMPARISON_ROWS.map((row, i) => (
                <div key={i} className={`grid grid-cols-[1fr,60px,60px] px-3 py-2 text-xs items-center ${i % 2 === 0 ? "bg-card" : "bg-card/50"} ${!row.stocky ? "bg-primary/[0.03]" : ""}`}>
                  <div>
                    <span>{row.feature}</span>
                    {row.sonicExtra && <span className="text-[10px] text-primary ml-1">· {row.sonicExtra}</span>}
                  </div>
                  <div className="text-center">
                    {row.stocky ? <Check className="w-3.5 h-3.5 text-muted-foreground mx-auto" /> : <span className="text-muted-foreground/30">—</span>}
                  </div>
                  <div className="text-center">
                    <Check className="w-3.5 h-3.5 text-primary mx-auto" />
                  </div>
                </div>
              ))}
            </div>

            <Button variant="teal" className="w-full h-11" onClick={next}>
              See what's new <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* ── Highlights ── */}
        {step === "highlights" && (
          <div className="pt-4">
            <h2 className="text-xl font-bold font-display mb-1">What you unlock with Sonic</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Three capabilities that Stocky never had.
            </p>

            <div className="space-y-4 mb-8">
              {/* Automation Pipelines */}
              <Card className="p-4 border-primary/20 bg-primary/[0.03]">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Zap className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold mb-1">Automation Pipelines</h3>
                    <p className="text-xs text-muted-foreground mb-2">
                      Chain invoice → stock check → Shopify push → SEO → social posts into a single guided workflow. 
                      Five built-in pipelines cover new arrivals, restocking, SEO boost, marketing launch, and season close.
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {["📦 New arrivals", "🔄 Restock", "📈 SEO boost", "📣 Marketing", "📉 Season close"].map(p => (
                        <span key={p} className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">{p}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>

              {/* SEO + Marketing */}
              <Card className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <TrendingUp className="w-5 h-5 text-foreground" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold mb-1">SEO + Marketing Integration</h3>
                    <p className="text-xs text-muted-foreground mb-2">
                      Every product you add automatically gets SEO titles, meta descriptions, Google Shopping attributes, 
                      collection pages, and social media posts. Your inventory system now drives your marketing.
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {["Google Shopping", "Collection SEO", "Blog posts", "Social posts", "AI citations"].map(t => (
                        <span key={t} className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{t}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>

              {/* AI Recommendations */}
              <Card className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <Sparkles className="w-5 h-5 text-foreground" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold mb-1">AI Recommendations</h3>
                    <p className="text-xs text-muted-foreground mb-2">
                      AI reads your invoices, learns your suppliers, detects refills vs new products, suggests reorder 
                      quantities based on sales velocity, and protects your margins in real-time. Every week it gets smarter.
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {["Invoice AI", "Reorder AI", "Margin shield", "Dead stock alerts", "Size run gaps"].map(t => (
                        <span key={t} className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{t}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            </div>

            <Button variant="teal" className="w-full h-11" onClick={next}>
              Ready to run your first workflow <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* ── Launch ── */}
        {step === "launch" && (
          <div className="pt-8 text-center">
            <div className="w-20 h-20 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-5">
              <span className="text-4xl">🚀</span>
            </div>
            <h2 className="text-xl font-bold font-display mb-2">You're ready!</h2>
            <p className="text-sm text-muted-foreground mb-2 max-w-sm mx-auto">
              {importedSections.size > 0
                ? `We've imported your data (${stats.products > 0 ? `${stats.products} products` : ""}${stats.inventory > 0 ? `, ${stats.inventory} inventory rows` : ""}${stats.purchaseOrders > 0 ? `, ${stats.purchaseOrders} POs` : ""}). Now choose how you want to start.`
                : "Your Stocky replacement is set up. Choose how you want to start."
              }
            </p>

            <div className="space-y-3 mt-8 max-w-sm mx-auto text-left">
              {/* Primary CTA — run pipeline */}
              <button
                onClick={() => { onComplete(); onStartPipeline("new_arrivals_full"); }}
                className="w-full rounded-xl border-2 border-primary bg-primary/5 p-4 text-left transition-all hover:bg-primary/10 active:scale-[0.98]"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Zap className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold">Run your first automated workflow</p>
                    <p className="text-xs text-muted-foreground">Invoice → Shopify → SEO → social posts in one go</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-primary shrink-0" />
                </div>
              </button>

              {/* Secondary — process an invoice */}
              <button
                onClick={() => { onComplete(); onStartFlow("invoice"); }}
                className="w-full rounded-xl border border-border bg-card p-4 text-left transition-all hover:bg-muted/50 active:scale-[0.98]"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold">Process a single invoice</p>
                    <p className="text-xs text-muted-foreground">Upload a PDF or CSV to try the AI parser</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </div>
              </button>

              {/* Tertiary — go to inventory hub */}
              <button
                onClick={() => { onComplete(); onStartFlow("stocky_hub"); }}
                className="w-full rounded-xl border border-border bg-card p-4 text-left transition-all hover:bg-muted/50 active:scale-[0.98]"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <Package className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold">Explore the Inventory Hub</p>
                    <p className="text-xs text-muted-foreground">Your Stocky replacement — POs, reorders, analytics</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </div>
              </button>

              <button onClick={onComplete} className="w-full mt-2 text-xs text-muted-foreground text-center py-2">
                Skip — go to dashboard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StockyOnboarding;