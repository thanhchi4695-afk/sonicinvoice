import { useState, useEffect } from "react";
import { Upload, ChevronDown, ChevronRight, Camera, FileText, Loader2, Check, ChevronLeft, RotateCcw, X, Download, Bot, Clock, Save, Monitor, Package, AlertTriangle, Search, Settings, Eye } from "lucide-react";
import ShopifyPreview from "@/components/ShopifyPreview";
import { Button } from "@/components/ui/button";
import { useStoreMode } from "@/hooks/use-store-mode";
import Papa from "papaparse";
import { generateXSeriesCSV, getXSeriesSettings, saveXSeriesSettings, type XSeriesSettings, type XSeriesProduct } from "@/lib/lightspeed-xseries";

interface InvoiceFlowProps {
  onBack: () => void;
}

type Step = 1 | 2 | 3 | 4;

const stepLabels = ["Upload", "Reading", "Review", "Download"];

// ── Instruction snippets ───────────────────────────────────
const quickInserts = [
  { label: "+ Brand prefix", text: "Add '[BRAND NAME]' at the start of every product name." },
  { label: "+ Title case", text: "Capitalise only the first letter of each word in product names (title case)." },
  { label: "+ ALL CAPS", text: "Convert all product names to ALL CAPITALS." },
  { label: "+ Remove brand", text: "Remove the brand name from the start of each product name." },
  { label: "+ Map price cols", text: "The first price column is the cost price (what I paid). The second price column is the retail price (RRP)." },
  { label: "+ Map QTY", text: "The column labelled '[COLUMN NAME]' contains the quantity." },
  { label: "+ Map SKU", text: "The column labelled '[COLUMN NAME]' is the product SKU." },
  { label: "+ Abbreviation", text: "Replace '[ABBREVIATION]' with '[FULL WORD]' in all product names." },
];

// ── localStorage helpers ───────────────────────────────────
const HISTORY_KEY = 'custom_instructions_history';
const TEMPLATES_KEY = 'invoice_templates';

function getHistory(): { text: string; label: string }[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}
function addHistory(text: string, supplier: string) {
  if (!text.trim()) return;
  const history = getHistory().filter(h => h.text !== text);
  history.unshift({ text, label: supplier || text.slice(0, 50) + '...' });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 10)));
}
function getTemplates(): Record<string, { instructions: string; savedAt: string; useCount: number }> {
  try { return JSON.parse(localStorage.getItem(TEMPLATES_KEY) || '{}'); } catch { return {}; }
}
function saveTemplate(supplier: string, instructions: string) {
  const t = getTemplates();
  t[supplier] = { instructions, savedAt: new Date().toISOString(), useCount: (t[supplier]?.useCount || 0) + 1 };
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(t));
}

// ── Custom Instructions Component ──────────────────────────
const CustomInstructionsField = ({
  value, onChange, supplierName,
}: {
  value: string; onChange: (v: string) => void; supplierName: string;
}) => {
  const [showHistory, setShowHistory] = useState(false);
  const [saveForSupplier, setSaveForSupplier] = useState(false);
  const [templateSupplier, setTemplateSupplier] = useState(supplierName);
  const [loadedTemplate, setLoadedTemplate] = useState<string | null>(null);
  const history = getHistory();

  // Auto-load saved template when supplier changes
  useEffect(() => {
    setTemplateSupplier(supplierName);
    if (supplierName) {
      const templates = getTemplates();
      const match = templates[supplierName];
      if (match && !value) {
        onChange(match.instructions);
        setLoadedTemplate(supplierName);
      }
    }
  }, [supplierName]);

  const handleInsert = (text: string) => {
    onChange(value ? value + '\n' + text : text);
  };

  return (
    <div className="bg-card rounded-lg border border-border p-4 mt-4">
      <div className="flex items-center gap-2 mb-1">
        <Bot className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold">Custom AI Instructions</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Tell the AI exactly how to process this invoice. Plain English — no code needed.
      </p>

      {loadedTemplate && (
        <div className="bg-primary/10 border border-primary/20 rounded-md p-2 mb-2 flex items-center justify-between">
          <p className="text-xs text-primary">💡 Loaded saved instructions for {loadedTemplate}</p>
          <button onClick={() => { onChange(''); setLoadedTemplate(null); }} className="text-xs text-primary font-medium ml-2">Clear</button>
        </div>
      )}

      <textarea
        value={value}
        onChange={e => { onChange(e.target.value); setLoadedTemplate(null); }}
        rows={5}
        maxLength={2000}
        placeholder={`Examples:\n• QTY means quantity, first price is cost, second is retail\n• Add supplier name at the start of every product name\n• Replace 'nk' with Necklace, 'br' with Bracelet\n• All names should have first letter capitalised only\n• The SKU column is called 'Style No' in this invoice`}
        className="w-full rounded-md bg-input border border-border px-3 py-2 text-sm resize-none leading-relaxed placeholder:text-muted-foreground/50"
      />
      <p className="text-xs text-muted-foreground text-right mt-1">{value.length} / 2000</p>

      {/* Quick add buttons */}
      <p className="text-xs text-muted-foreground mt-2 mb-1.5">Quick add:</p>
      <div className="flex flex-wrap gap-1.5">
        {quickInserts.map(qi => (
          <button
            key={qi.label}
            onClick={() => handleInsert(qi.text)}
            className="px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground active:bg-accent transition-colors"
          >
            {qi.label}
          </button>
        ))}
      </div>

      {/* Recent instructions */}
      {history.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setShowHistory(!showHistory)} className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            📋 Recent instructions {showHistory ? '▲' : '▼'}
          </button>
          {showHistory && (
            <div className="mt-1.5 space-y-1">
              {history.map((h, i) => (
                <button key={i} onClick={() => { onChange(h.text); setShowHistory(false); }}
                  className="w-full text-left text-xs bg-muted/50 rounded-md px-3 py-2 truncate text-muted-foreground hover:bg-muted">
                  {h.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Save for supplier */}
      <div className="mt-3 flex items-center gap-2">
        <input type="checkbox" id="save-supplier" checked={saveForSupplier} onChange={e => setSaveForSupplier(e.target.checked)}
          className="w-4 h-4 rounded border-border accent-primary" />
        <label htmlFor="save-supplier" className="text-xs text-muted-foreground">Save for future invoices from this supplier</label>
      </div>
      {saveForSupplier && (
        <input value={templateSupplier} onChange={e => setTemplateSupplier(e.target.value)}
          placeholder="Supplier name"
          className="w-full h-9 rounded-md bg-input border border-border px-3 text-xs mt-2" />
      )}
    </div>
  );
};

const InvoiceFlow = ({ onBack }: InvoiceFlowProps) => {
  const [step, setStep] = useState<Step>(1);
  const [showDetails, setShowDetails] = useState(false);
  const [fileName, setFileName] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [exportFormat, setExportFormat] = useState<'shopify' | 'lightspeed_x' | 'xlsx'>('shopify');
  const [showLsSettings, setShowLsSettings] = useState(false);
  const [lsSettings, setLsSettings] = useState<XSeriesSettings>(getXSeriesSettings);
  const mode = useStoreMode();

  const handleFileSelect = () => {
    // Save instructions to history
    if (customInstructions.trim()) {
      addHistory(customInstructions, supplierName);
      // Save template if toggled
      const saveCheckbox = document.getElementById('save-supplier') as HTMLInputElement;
      if (saveCheckbox?.checked && supplierName) {
        saveTemplate(supplierName, customInstructions);
      }
    }
    setFileName("invoice_jantzen_mar26.pdf");
    setTimeout(() => setStep(2), 300);
    setTimeout(() => setStep(3), 3000);
  };

  // Simulated rules-applied feedback
  const appliedRules = customInstructions.trim() ? [
    { applied: true, text: 'Custom AI instructions applied to all products' },
  ] : [];

  const mockProducts = [
    { name: "Bond Eye Mara One Piece - Black", brand: "Bond Eye", type: "One Piece", price: 89.95, rrp: 219.95, status: "ready" },
    { name: "Seafolly Collective Bikini Top - Navy", brand: "Seafolly", type: "Bikini Tops", price: 45.00, rrp: 109.95, status: "ready" },
    { name: "Baku Riviera High Waist Pant - Ivory", brand: "Baku", type: "Bikini Bottoms", price: 38.00, rrp: 89.95, status: "review" },
    { name: "Jantzen Retro Racerback - Coral", brand: "Jantzen", type: "One Piece", price: 65.00, rrp: 159.95, status: "ready" },
  ];

  return (
    <div className="min-h-screen pb-24 animate-fade-in">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background border-b border-border px-4 py-3">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={onBack} className="text-muted-foreground">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h2 className="text-lg font-semibold font-display">Import invoice</h2>
        </div>
        {/* Progress */}
        <div className="flex items-center gap-1">
          {stepLabels.map((label, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div className={`h-1 w-full rounded-full transition-colors ${i + 1 <= step ? "bg-primary" : "bg-muted"}`} />
              <span className={`text-[10px] ${i + 1 <= step ? "text-primary" : "text-muted-foreground"}`}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Step 1: Upload */}
      {step === 1 && (
        <div className="px-4 pt-6">
          <button
            onClick={handleFileSelect}
            className="w-full h-48 rounded-lg border-2 border-dashed border-border bg-card flex flex-col items-center justify-center gap-3 active:bg-muted transition-colors"
          >
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <Upload className="w-6 h-6 text-primary" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">Tap to upload invoice</p>
              <p className="text-xs text-muted-foreground mt-1">PDF · Excel · CSV · Word · Photo</p>
            </div>
          </button>

          <button
            onClick={handleFileSelect}
            className="w-full mt-3 h-12 rounded-lg border border-border bg-card flex items-center justify-center gap-2 text-sm active:bg-muted"
          >
            <Camera className="w-4 h-4 text-primary" />
            Take a photo
          </button>

          {/* Collapsible details */}
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-2 mt-6 text-sm text-muted-foreground"
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${showDetails ? "rotate-180" : ""}`} />
            Invoice details
          </button>
          {showDetails && (
            <div className="mt-3 space-y-3">
              <input type="text" placeholder="Supplier name" value={supplierName} onChange={e => setSupplierName(e.target.value)}
                className="w-full h-11 rounded-lg bg-input border border-border px-3 text-sm" />
              <select className="w-full h-11 rounded-lg bg-input border border-border px-3 text-sm text-foreground">
                <option value="">Arrival month</option>
                <option>Mar 2026</option>
                <option>Apr 2026</option>
                <option>May 2026</option>
              </select>
              <select className="w-full h-11 rounded-lg bg-input border border-border px-3 text-sm text-foreground">
                <option value="">Mark as</option>
                <option>New arrivals</option>
                <option>Restock order</option>
              </select>
            </div>
          )}

          {/* Custom AI Instructions */}
          <CustomInstructionsField
            value={customInstructions}
            onChange={setCustomInstructions}
            supplierName={supplierName}
          />

          <button className="mt-6 text-sm text-primary font-medium">
            Or enter products manually →
          </button>
        </div>
      )}

      {/* Step 2: Reading */}
      {step === 2 && (
        <div className="flex flex-col items-center justify-center px-4 pt-24">
          <div className="w-16 h-16 rounded-full border-4 border-primary border-t-transparent animate-spin-slow mb-6" />
          <h3 className="text-lg font-semibold font-display mb-2">Reading your invoice...</h3>
          <p className="text-sm text-muted-foreground text-center">Extracting product names, prices, and quantities</p>
          {customInstructions.trim() && (
            <p className="text-xs text-primary mt-3">🤖 Applying your custom instructions...</p>
          )}
        </div>
      )}

      {/* Step 3: Review */}
      {step === 3 && (
        <div className="px-4 pt-4">
          {/* Custom rules applied feedback */}
          {appliedRules.length > 0 && (
            <div className="bg-success/10 border border-success/20 rounded-lg p-3 mb-3">
              <p className="text-xs font-semibold text-success mb-1">🤖 Custom instructions applied to all {mockProducts.length} products:</p>
              {appliedRules.map((r, i) => (
                <p key={i} className="text-xs text-success">✓ {r.text}</p>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-medium">{mockProducts.length} products found</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPreviewAll(true)} className="gap-1"><Eye className="w-3.5 h-3.5" /> Preview all</Button>
              <Button variant="ghost" size="sm"><RotateCcw className="w-3.5 h-3.5 mr-1" /> Regenerate</Button>
              <Button variant="teal" size="sm" onClick={() => setStep(4)}>Download <ChevronRight className="w-3.5 h-3.5 ml-1" /></Button>
            </div>
          </div>
          <div className="space-y-2">
            {mockProducts.map((p, i) => (
              <ProductCard key={i} product={p} onPreview={() => setPreviewProduct(p)} />
            ))}
          </div>

          {/* Preview modal */}
          {(previewProduct || previewAll) && (
            <ShopifyPreview
              product={previewAll && !previewProduct ? mockProducts[previewIdx] : (previewProduct || mockProducts[0])}
              open={true}
              onClose={() => { setPreviewProduct(null); setPreviewAll(false); setPreviewIdx(0); }}
              onSave={() => { if (previewAll && previewIdx < mockProducts.length - 1) { setPreviewIdx(previewIdx + 1); } else { setPreviewProduct(null); setPreviewAll(false); setPreviewIdx(0); } }}
            />
          )}
        </div>
      )}

      {/* Step 4: Download */}
      {step === 4 && (
        <div className="px-4 pt-6 pb-24">
          {/* Export format selector */}
          <div className="mb-6">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Select export format</p>
            <div className="space-y-2">
              {[
                { id: 'shopify' as const, label: '🛍️ Shopify CSV', desc: 'Standard Shopify product import' },
                { id: 'lightspeed_x' as const, label: '🖥️ Lightspeed X-Series', desc: 'For Lightspeed POS → Shopify workflow' },
                { id: 'xlsx' as const, label: '📊 Excel (.xlsx)', desc: 'For manual review' },
              ].map(fmt => (
                <button
                  key={fmt.id}
                  onClick={() => setExportFormat(fmt.id)}
                  className={`w-full rounded-lg border-2 p-3 text-left transition-all flex items-center gap-3 ${
                    exportFormat === fmt.id ? 'border-primary bg-primary/5' : 'border-border bg-card'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">{fmt.label}</p>
                    <p className="text-xs text-muted-foreground">{fmt.desc}</p>
                  </div>
                  {exportFormat === fmt.id && <Check className="w-4 h-4 text-primary shrink-0" />}
                </button>
              ))}
            </div>
          </div>

          {/* Lightspeed X-Series settings */}
          {exportFormat === 'lightspeed_x' && (
            <div className="mb-6">
              <button onClick={() => setShowLsSettings(!showLsSettings)}
                className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                <Settings className="w-3.5 h-3.5" />
                <span className="font-medium">Lightspeed export settings</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${showLsSettings ? 'rotate-180' : ''}`} />
              </button>
              {showLsSettings && (
                <div className="bg-card border border-border rounded-lg p-4 space-y-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Outlet name (exactly as in Lightspeed)</label>
                    <input value={lsSettings.outletName} onChange={e => { const v = e.target.value; setLsSettings(s => ({ ...s, outletName: v })); }}
                      placeholder="Main_Store" className="w-full h-9 rounded-md bg-input border border-border px-3 text-xs font-mono-data" />
                    <p className="text-[10px] text-muted-foreground mt-1">Use underscores instead of spaces. Find in Lightspeed → Setup → Outlets.</p>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Tax name</label>
                    <input value={lsSettings.taxName} onChange={e => { const v = e.target.value; setLsSettings(s => ({ ...s, taxName: v })); }}
                      placeholder="GST" className="w-full h-9 rounded-md bg-input border border-border px-3 text-xs" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Name format</label>
                    <div className="flex gap-2">
                      {(['brand_first', 'product_only'] as const).map(nf => (
                        <button key={nf} onClick={() => setLsSettings(s => ({ ...s, nameFormat: nf }))}
                          className={`flex-1 rounded-md border p-2 text-xs text-center ${lsSettings.nameFormat === nf ? 'border-primary bg-primary/5' : 'border-border'}`}>
                          {nf === 'brand_first' ? 'Brand + Product' : 'Product only'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Attribute order</label>
                    <div className="flex gap-2">
                      {(['size_first', 'colour_first'] as const).map(ao => (
                        <button key={ao} onClick={() => setLsSettings(s => ({ ...s, attributeOrder: ao }))}
                          className={`flex-1 rounded-md border p-2 text-xs text-center ${lsSettings.attributeOrder === ao ? 'border-primary bg-primary/5' : 'border-border'}`}>
                          {ao === 'size_first' ? 'Size → Colour' : 'Colour → Size'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={lsSettings.useReorderPoints}
                      onChange={e => setLsSettings(s => ({ ...s, useReorderPoints: e.target.checked }))}
                      className="w-4 h-4 rounded border-border accent-primary" />
                    <span className="text-xs text-muted-foreground">Set reorder points</span>
                  </div>
                  {lsSettings.useReorderPoints && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-muted-foreground mb-0.5 block">Reorder point</label>
                        <input type="number" value={lsSettings.reorderPoint}
                          onChange={e => setLsSettings(s => ({ ...s, reorderPoint: Number(e.target.value) }))}
                          className="w-full h-8 rounded-md bg-input border border-border px-2 text-xs" />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground mb-0.5 block">Reorder amount</label>
                        <input type="number" value={lsSettings.reorderAmount}
                          onChange={e => setLsSettings(s => ({ ...s, reorderAmount: Number(e.target.value) }))}
                          className="w-full h-8 rounded-md bg-input border border-border px-2 text-xs" />
                      </div>
                    </div>
                  )}
                  <Button variant="outline" size="sm" className="w-full" onClick={() => { saveXSeriesSettings(lsSettings); }}>
                    <Save className="w-3.5 h-3.5 mr-1" /> Save Lightspeed settings
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Download area */}
          <LightspeedExportDownload
            exportFormat={exportFormat}
            products={mockProducts}
            supplierName={supplierName}
            lsSettings={lsSettings}
            mode={mode}
          />

          {/* R-Series import note */}
          {mode.isRSeries && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 mt-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                <div className="text-xs space-y-2">
                  <p className="font-semibold text-amber-300">R-Series Import Note</p>
                  <p className="text-muted-foreground">For large imports (100+ products), Lightspeed recommends submitting to their Retail Imports Team. Allow 3–5 business days for processing.</p>
                  <p className="text-muted-foreground">For small imports (&lt;100 products): go to Inventory → Import Items → New Import in R-Series. Select "Create new items only".</p>
                  <p className="text-amber-400 font-medium">⚠ The System ID column must be BLANK for new products. Never enter a number in the System ID column.</p>
                  <p className="text-muted-foreground">⚠ QOH (Quantity on Hand) ADDS to existing inventory — it does not replace it.</p>
                </div>
              </div>
            </div>
          )}

          {/* Lightspeed Stock Order restock option */}
          {mode.isLightspeed && (
            <LightspeedRestockSection products={mockProducts} supplierName={supplierName} />
          )}

          {/* Lightspeed sync rules reminder */}
          {(exportFormat === 'lightspeed_x' || mode.isLightspeed) && (
            <div className="bg-card border border-purple-500/20 rounded-lg p-4 mt-4">
              <div className="flex items-center gap-2 mb-2">
                <Monitor className="w-4 h-4 text-purple-400" />
                <span className="text-xs font-semibold">After importing into Lightspeed</span>
              </div>
              <div className="text-xs space-y-1.5 text-muted-foreground">
                <p>✅ <span className="text-foreground">DO in Shopify:</span> Add photos, SEO titles, collections</p>
                <p>❌ <span className="text-foreground">DON'T in Shopify:</span> Edit name, price, SKU, description</p>
                <p className="text-[10px] mt-2 text-muted-foreground/70">Editing product details in Shopify will break the sync with Lightspeed. Always edit products in Lightspeed POS.</p>
              </div>
            </div>
          )}

          <button onClick={onBack} className="w-full mt-6 text-sm text-primary font-medium text-center">
            Import another invoice
          </button>
        </div>
      )}
    </div>
  );
};

// ── Lightspeed Export Download Section ─────────────────────
import type { StoreMode } from '@/hooks/use-store-mode';

function LightspeedExportDownload({ exportFormat, products, supplierName, lsSettings, mode }: {
  exportFormat: 'shopify' | 'lightspeed_x' | 'xlsx';
  products: { name: string; brand: string; type: string; price: number; rrp: number; status: string }[];
  supplierName: string;
  lsSettings: XSeriesSettings;
  mode: StoreMode;
}) {
  const downloadFile = (content: string, filename: string, mime = 'text/csv') => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const month = new Date().toLocaleString('en', { month: 'short', year: '2-digit' }).replace(' ', '');
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const tag = (supplierName || 'products').toLowerCase().replace(/\s+/g, '-');

  if (exportFormat === 'lightspeed_x') {
    const xProducts: XSeriesProduct[] = products.map(p => ({
      title: p.name, brand: p.brand, type: p.type, price: p.price, rrp: p.rrp,
      tags: `${p.brand}, ${p.type}, New Arrival`,
    }));
    const { csv, errors, rowCount } = generateXSeriesCSV(xProducts, lsSettings);
    const hasErrors = errors.filter(e => e.severity === 'error').length > 0;
    const warnings = errors.filter(e => e.severity === 'warning');

    return (
      <div className="space-y-3">
        {/* Validation */}
        {!hasErrors && (
          <div className="bg-success/10 border border-success/20 rounded-lg p-3 flex items-center gap-2">
            <Check className="w-4 h-4 text-success" />
            <span className="text-xs text-success font-medium">✅ {products.length} products ready for Lightspeed import ({rowCount} rows)</span>
          </div>
        )}
        {hasErrors && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
            <p className="text-xs text-destructive font-medium mb-1">⚠ {errors.filter(e => e.severity === 'error').length} issues found:</p>
            {errors.filter(e => e.severity === 'error').slice(0, 5).map((e, i) => (
              <p key={i} className="text-xs text-destructive">{e.field}: {e.message}</p>
            ))}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
            {warnings.map((w, i) => (
              <p key={i} className="text-xs text-amber-400 flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {w.message}
              </p>
            ))}
          </div>
        )}

        {/* Step 1: Download Lightspeed CSV */}
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs font-semibold mb-1 flex items-center gap-1.5">📥 Step 1: Download Lightspeed X-Series CSV</p>
          <p className="text-[11px] text-muted-foreground mb-3">Import this into Lightspeed POS first</p>
          <Button variant="success" className="w-full h-12 text-sm"
            onClick={() => downloadFile(csv, `${tag}_${month}_lightspeed_${date}.csv`)}>
            <Download className="w-4 h-4 mr-2" /> Download Lightspeed CSV — {products.length} products
          </Button>
        </div>

        <p className="text-[10px] text-muted-foreground text-center px-4">
          Wait until Lightspeed has synced your products to Shopify before importing the SEO Update file.
        </p>

        {/* Step 2: SEO Update */}
        <ShopifySeoUpdateSection products={products} supplierName={supplierName} />
      </div>
    );
  }

  // Shopify / XLSX mode
  return (
    <div className="flex flex-col items-center">
      <div className="w-20 h-20 rounded-full bg-success/15 flex items-center justify-center mb-6">
        <Check className="w-10 h-10 text-success" />
      </div>
      <h3 className="text-xl font-bold font-display mb-2">Your file is ready</h3>
      <p className="text-sm text-muted-foreground mb-6">{products.length} products, {exportFormat === 'xlsx' ? 'Excel' : 'Shopify'}-ready format</p>
      <Button variant="success" className="w-full max-w-xs h-14 text-base">
        <Download className="w-5 h-5 mr-2" /> Download {exportFormat === 'xlsx' ? 'Excel file' : mode.exportLabel}
      </Button>
    </div>
  );
}

// ── Shopify SEO Update Companion Export ────────────────────
function ShopifySeoUpdateSection({ products, supplierName }: {
  products: { name: string; brand: string; type: string; price: number; rrp: number; status: string }[];
  supplierName: string;
}) {
  const [showGuide, setShowGuide] = useState(false);

  const generateSeoCSV = () => {
    const rows = products.map(p => {
      const handle = `${p.name}-${p.brand}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      return {
        'Handle': handle,
        'Title': `${p.brand} ${p.name}`,
        'SEO Title': `${p.name} | ${p.brand}`.slice(0, 70),
        'SEO Description': `Shop ${p.name} by ${p.brand}. Premium ${p.type.toLowerCase()}.`.slice(0, 160),
        'Tags': `${p.brand}, ${p.type}, New Arrival`,
        'Image Src': '',
        'Image Alt Text': `${p.brand} ${p.name} - ${p.type}`,
      };
    });
    return Papa.unparse(rows, {
      columns: ['Handle', 'Title', 'SEO Title', 'SEO Description', 'Tags', 'Image Src', 'Image Alt Text'],
    });
  };

  const handleDownload = () => {
    const csv = generateSeoCSV();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const month = new Date().toLocaleString('en', { month: 'short', year: '2-digit' }).replace(' ', '');
    const tag = (supplierName || 'products').toLowerCase().replace(/\s+/g, '-');
    a.href = url; a.download = `${tag}_seo_update_${month}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <p className="text-xs font-semibold mb-1 flex items-center gap-1.5">
        <Search className="w-3.5 h-3.5 text-primary" />
        Step 2: Download Shopify SEO Update <span className="text-muted-foreground font-normal">(optional)</span>
      </p>
      <p className="text-[11px] text-muted-foreground mb-3">
        After Lightspeed syncs to Shopify, import this file into Shopify to add SEO titles, tags, and images
      </p>
      <Button variant="outline" className="w-full h-11 text-sm" onClick={handleDownload}>
        <Download className="w-4 h-4 mr-2" /> Download Shopify SEO Update — {products.length} products
      </Button>

      <button
        onClick={() => setShowGuide(!showGuide)}
        className="flex items-center gap-1 text-xs text-muted-foreground mt-3"
      >
        <ChevronDown className={`w-3 h-3 transition-transform ${showGuide ? 'rotate-180' : ''}`} />
        How to import the SEO Update into Shopify
      </button>
      {showGuide && (
        <ol className="text-xs text-muted-foreground mt-2 space-y-1.5 pl-4 list-decimal">
          <li>Wait for Lightspeed to sync products to your Shopify store (check Shopify admin → Products to confirm they appear)</li>
          <li>In Shopify admin: go to Products → Import</li>
          <li>Upload the Shopify SEO Update CSV file</li>
          <li>On the import screen, tick: <span className="font-medium text-foreground">☑ "Overwrite existing products with matching handle"</span></li>
          <li>Click Import → SEO titles, tags, and images will update</li>
          <li>Verify by checking one product in Shopify admin — confirm SEO title and tags are correct</li>
          <li className="text-amber-400 font-medium mt-2">⚠ Do NOT tick "Create new products" — this will create duplicates. Only use the overwrite/update option.</li>
        </ol>
      )}
    </div>
  );
}

// ── Lightspeed Stock Order Restock Section ─────────────────
const CATALOG_KEY = 'catalog_memory_skupilot';

interface CatalogEntry {
  sku: string;
  handle: string;
  brand: string;
}

function getCatalog(): Record<string, CatalogEntry> {
  try { return JSON.parse(localStorage.getItem(CATALOG_KEY) || '{}'); } catch { return {}; }
}

function generateHandle(name: string, brand: string): string {
  return `${name}-${brand}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function LightspeedRestockSection({ products, supplierName }: {
  products: { name: string; brand: string; type: string; price: number; rrp: number; status: string }[];
  supplierName: string;
}) {
  const [showGuide, setShowGuide] = useState(false);
  const catalog = getCatalog();

  // Build stock order lines, flag missing SKUs
  const lines = products.map(p => {
    const key = `${p.brand}::${p.name}`.toLowerCase();
    const entry = catalog[key];
    return {
      name: p.name,
      brand: p.brand,
      handle: entry?.handle || generateHandle(p.name, p.brand),
      sku: entry?.sku || '',
      supply_price: p.price,
      quantity: 1, // placeholder
      hasSku: !!entry?.sku,
    };
  });

  const validLines = lines.filter(l => l.hasSku);
  const missingLines = lines.filter(l => !l.hasSku);

  // Group by brand/supplier for split
  const bySupplier: Record<string, typeof lines> = {};
  for (const l of lines) {
    const key = l.brand || 'Unknown';
    if (!bySupplier[key]) bySupplier[key] = [];
    bySupplier[key].push(l);
  }
  const supplierKeys = Object.keys(bySupplier);
  const needsSplit = supplierKeys.length > 1;

  const generateStockOrderCSV = (items: typeof lines) => {
    const rows = items.filter(l => l.hasSku).map(l => ({
      handle: l.handle,
      sku: l.sku,
      supply_price: l.supply_price,
      quantity: l.quantity,
    }));
    return Papa.unparse(rows, { columns: ['handle', 'sku', 'supply_price', 'quantity'] });
  };

  const downloadCSV = (csv: string, filename: string) => {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownload = () => {
    if (needsSplit) {
      // Download each supplier separately
      for (const [brand, items] of Object.entries(bySupplier)) {
        const csv = generateStockOrderCSV(items);
        if (csv.split('\n').length > 1) {
          const tag = brand.toLowerCase().replace(/\s+/g, '-');
          const month = new Date().toLocaleString('en', { month: 'short', year: '2-digit' }).replace(' ', '');
          downloadCSV(csv, `${tag}_restock_${month}.csv`);
        }
      }
    } else {
      const csv = generateStockOrderCSV(lines);
      const month = new Date().toLocaleString('en', { month: 'short', year: '2-digit' }).replace(' ', '');
      const tag = (supplierName || supplierKeys[0] || 'restock').toLowerCase().replace(/\s+/g, '-');
      downloadCSV(csv, `${tag}_restock_${month}.csv`);
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 mt-4">
      <div className="flex items-center gap-2 mb-2">
        <Package className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold">Restock existing products (Stock Order import)</span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        For deliveries of products already in Lightspeed. Only updates quantities — does not create new products.
      </p>

      {/* Missing SKU warnings */}
      {missingLines.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mb-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="text-xs">
              <p className="font-medium text-amber-300 mb-1">SKU not found for {missingLines.length} product{missingLines.length > 1 ? 's' : ''}</p>
              {missingLines.slice(0, 3).map((l, i) => (
                <p key={i} className="text-muted-foreground">• {l.name}</p>
              ))}
              {missingLines.length > 3 && (
                <p className="text-muted-foreground">…and {missingLines.length - 3} more</p>
              )}
              <p className="text-muted-foreground mt-1.5">Use full product import for new products, or add SKUs to catalog memory.</p>
            </div>
          </div>
        </div>
      )}

      {/* Split summary */}
      {needsSplit && validLines.length > 0 && (
        <div className="bg-muted/50 rounded-lg p-3 mb-3 text-xs">
          <p className="font-medium mb-1">Your restock will be split into {supplierKeys.length} files:</p>
          {supplierKeys.map(s => {
            const count = bySupplier[s].filter(l => l.hasSku).length;
            return count > 0 ? (
              <p key={s} className="text-muted-foreground">
                • <span className="font-mono-data">{s.toLowerCase().replace(/\s+/g, '-')}_restock.csv</span> — {count} line{count > 1 ? 's' : ''}
              </p>
            ) : null;
          })}
        </div>
      )}

      <Button
        variant="outline"
        className="w-full h-11"
        onClick={handleDownload}
        disabled={validLines.length === 0}
      >
        <Download className="w-4 h-4 mr-2" />
        {validLines.length === 0 ? 'No SKUs found for stock order' : `Download Lightspeed Stock Order CSV`}
      </Button>

      {/* Import guide */}
      <button
        onClick={() => setShowGuide(!showGuide)}
        className="flex items-center gap-1 text-xs text-muted-foreground mt-3"
      >
        <ChevronDown className={`w-3 h-3 transition-transform ${showGuide ? 'rotate-180' : ''}`} />
        How to import a stock order into Lightspeed
      </button>
      {showGuide && (
        <ol className="text-xs text-muted-foreground mt-2 space-y-1.5 pl-4 list-decimal">
          <li>In Lightspeed: go to Inventory → Stock Control → Order Stock</li>
          <li>Click: New Order</li>
          <li>Select your supplier from the dropdown</li>
          <li>Under Products, click: Import via CSV</li>
          <li>Upload the Stock Order CSV from SkuPilot</li>
          <li>Review the imported lines — quantities appear in the order</li>
          <li>Mark the order as received to update stock</li>
          <li className="text-amber-400 font-medium mt-2">
            ⚠ All products in a single stock order must be from the SAME supplier in Lightspeed. If your invoice has multiple suppliers, SkuPilot splits the CSV into one file per supplier automatically.
          </li>
        </ol>
      )}
    </div>
  );
}

const ProductCard = ({ product }: { product: { name: string; brand: string; type: string; price: number; rrp: number; status: string } }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full px-4 py-3 text-left">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">{product.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {product.brand} · {product.type} · ${product.rrp.toFixed(2)}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-3">
            <span className={`w-2 h-2 rounded-full ${product.status === "ready" ? "bg-success" : "bg-secondary"}`} />
            <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
          </div>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
          <input defaultValue={product.name} className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm" />
          <div className="grid grid-cols-2 gap-3">
            <input defaultValue={product.brand} className="h-10 rounded-md bg-input border border-border px-3 text-sm" placeholder="Brand" />
            <input defaultValue={product.type} className="h-10 rounded-md bg-input border border-border px-3 text-sm" placeholder="Type" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input type="number" defaultValue={product.price} className="h-10 rounded-md bg-input border border-border px-3 text-sm" placeholder="Price" />
            <input type="number" defaultValue={product.rrp} className="h-10 rounded-md bg-input border border-border px-3 text-sm" placeholder="RRP" />
          </div>
          <textarea defaultValue="Stylish swimwear piece perfect for summer." className="w-full h-20 rounded-md bg-input border border-border px-3 py-2 text-sm resize-none" placeholder="Description" />
          <div className="flex gap-2">
            <Button variant="ghost" size="sm"><RotateCcw className="w-3.5 h-3.5 mr-1" /> Regenerate</Button>
            <Button variant="ghost" size="sm" className="text-destructive"><X className="w-3.5 h-3.5 mr-1" /> Remove</Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default InvoiceFlow;
