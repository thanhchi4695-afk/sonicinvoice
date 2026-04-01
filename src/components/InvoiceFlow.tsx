import { useState, useEffect } from "react";
import { Upload, ChevronDown, ChevronRight, Camera, FileText, Loader2, Check, ChevronLeft, RotateCcw, X, Download, Bot, Clock, Save, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStoreMode } from "@/hooks/use-store-mode";

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
              <Button variant="ghost" size="sm"><RotateCcw className="w-3.5 h-3.5 mr-1" /> Regenerate</Button>
              <Button variant="teal" size="sm" onClick={() => setStep(4)}>Download <ChevronRight className="w-3.5 h-3.5 ml-1" /></Button>
            </div>
          </div>
          <div className="space-y-2">
            {mockProducts.map((p, i) => (
              <ProductCard key={i} product={p} />
            ))}
          </div>
        </div>
      )}

      {/* Step 4: Download */}
      {step === 4 && (
        <div className="flex flex-col items-center justify-center px-4 pt-20">
          <div className="w-20 h-20 rounded-full bg-success/15 flex items-center justify-center mb-6">
            <Check className="w-10 h-10 text-success" />
          </div>
          <h3 className="text-xl font-bold font-display mb-2">Your file is ready</h3>
          <p className="text-sm text-muted-foreground mb-8">{mockProducts.length} products, Shopify-ready format</p>
          <Button variant="success" className="w-full max-w-xs h-14 text-base">
            <Download className="w-5 h-5 mr-2" /> Download product file
          </Button>
          <button onClick={onBack} className="mt-6 text-sm text-primary font-medium">
            Import another invoice
          </button>
        </div>
      )}
    </div>
  );
};

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
