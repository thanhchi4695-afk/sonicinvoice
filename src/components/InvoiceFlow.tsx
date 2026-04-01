import { useState, useEffect } from "react";
import { Upload, ChevronDown, ChevronRight, Camera, FileText, Loader2, Check, ChevronLeft, RotateCcw, X, Download, Bot, Clock, Save, Monitor, Package, AlertTriangle, Search, Settings, Eye, Zap, DollarSign, Link, Scissors } from "lucide-react";
import ShopifyPreview from "@/components/ShopifyPreview";
import ExportReviewScreen from "@/components/ExportReviewScreen";
import { Button } from "@/components/ui/button";
import { matchCollectionsWithBrand, checkCoverage } from "@/lib/collection-engine";
import { useStoreMode } from "@/hooks/use-store-mode";
import Papa from "papaparse";
import { generateXSeriesCSV, getXSeriesSettings, saveXSeriesSettings, type XSeriesSettings, type XSeriesProduct } from "@/lib/lightspeed-xseries";
import { findTemplate, saveFormatTemplate, incrementTemplateUse, COLUMN_LABELS, type InvoiceTemplate, type ColumnMapping } from "@/lib/invoice-templates";
import { getStoreLocations } from "@/components/AccountScreen";

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
const COST_HISTORY_KEY = 'cost_history';

interface CostEntry { date: string; cost: number; supplier: string; invoice: string; }
type CostHistoryMap = Record<string, CostEntry[]>;

export function getCostHistory(): CostHistoryMap {
  try { return JSON.parse(localStorage.getItem(COST_HISTORY_KEY) || "{}"); } catch { return {}; }
}

export function saveCostHistory(h: CostHistoryMap) {
  localStorage.setItem(COST_HISTORY_KEY, JSON.stringify(h));
}

export function addCostEntry(sku: string, entry: CostEntry) {
  const h = getCostHistory();
  if (!h[sku]) h[sku] = [];
  h[sku].push(entry);
  saveCostHistory(h);
}

// Seed demo cost history on first load
(function seedCostHistory() {
  const h = getCostHistory();
  if (Object.keys(h).length > 0) return;
  const seed: CostHistoryMap = {
    "BE10042": [{ date: "2026-01-15", cost: 85.00, supplier: "Bond Eye", invoice: "BE-1001" }],
    "SF10023": [{ date: "2026-02-10", cost: 45.00, supplier: "Seafolly", invoice: "SF-1122" }],
    "BK20015": [{ date: "2026-01-20", cost: 40.00, supplier: "Baku", invoice: "BK-501" }],
    "JA81520": [{ date: "2026-01-15", cost: 61.20, supplier: "Jantzen", invoice: "JAN-2647" }],
  };
  saveCostHistory(seed);
})();

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
  const [previewProduct, setPreviewProduct] = useState<any>(null);
  const [previewAll, setPreviewAll] = useState(false);
  const [previewIdx, setPreviewIdx] = useState(0);
  const mode = useStoreMode();

  // OCR / file type detection state
  type FileParseMode = "pdf_text" | "pdf_scan" | "photo" | "spreadsheet" | "email";
  const [fileParseMode, setFileParseMode] = useState<FileParseMode | null>(null);
  const [showLowQualityWarning, setShowLowQualityWarning] = useState(false);

  // Location state
  const storeLocations = getStoreLocations();
  const defaultLoc = storeLocations.find(l => l.isDefault) || storeLocations[0];
  const [receivingLocation, setReceivingLocation] = useState(defaultLoc?.id || "");

  // Template recognition state
  const [matchedTemplate, setMatchedTemplate] = useState<InvoiceTemplate | null>(null);
  const [useTemplate, setUseTemplate] = useState<boolean | null>(null);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [savedTemplate, setSavedTemplate] = useState(false);

  // Processing timer state
  const [processStartTime, setProcessStartTime] = useState<number | null>(null);
  const [processingElapsed, setProcessingElapsed] = useState(0);
  const [processingDone, setProcessingDone] = useState(false);
  const [finalProcessingTime, setFinalProcessingTime] = useState(0);
  const [showSpeedTips, setShowSpeedTips] = useState(false);

  // Timer tick
  useEffect(() => {
    if (processStartTime && !processingDone) {
      const interval = setInterval(() => {
        setProcessingElapsed(Math.floor((Date.now() - processStartTime) / 1000));
      }, 500);
      return () => clearInterval(interval);
    }
  }, [processStartTime, processingDone]);

  // Check for template match when supplier changes
  useEffect(() => {
    if (supplierName.trim()) {
      const tmpl = findTemplate(supplierName);
      setMatchedTemplate(tmpl);
      setUseTemplate(null);
    } else {
      setMatchedTemplate(null);
    }
  }, [supplierName]);

  const handleFileSelect = () => {
    if (customInstructions.trim()) {
      addHistory(customInstructions, supplierName);
      const saveCheckbox = document.getElementById('save-supplier') as HTMLInputElement;
      if (saveCheckbox?.checked && supplierName) {
        saveTemplate(supplierName, customInstructions);
      }
    }
    if (useTemplate && matchedTemplate) {
      incrementTemplateUse(supplierName);
    }
    // Simulate file type detection for demo
    const fName = "invoice_jantzen_mar26.pdf";
    setFileName(fName);
    const ext = fName.split(".").pop()?.toLowerCase() || "";
    if (["jpg", "jpeg", "png", "heic", "webp"].includes(ext)) {
      setFileParseMode("photo");
    } else if (ext === "pdf") {
      // Simulate: check if text layer is substantial (>50 chars)
      const hasTextLayer = true; // In real impl, try text extraction first
      setFileParseMode(hasTextLayer ? "pdf_text" : "pdf_scan");
    } else {
      setFileParseMode("spreadsheet");
    }
    setProcessStartTime(Date.now());
    setProcessingDone(false);
    setProcessingElapsed(0);
    setTimeout(() => setStep(2), 300);
    const duration = useTemplate ? 1500 : 3000;
    setTimeout(() => {
      const elapsed = Math.round(duration / 1000);
      setProcessingDone(true);
      setFinalProcessingTime(elapsed);
      setStep(3);
      if (elapsed > 3) setShowSpeedTips(true);
      // Show save-template prompt if no existing template
      if (!matchedTemplate && supplierName.trim()) {
        setShowSaveTemplate(true);
      }
      // Save to processing history
      const history = JSON.parse(localStorage.getItem("processing_history") || "[]");
      history.unshift({
        supplier: supplierName || "Unknown",
        lines: 4,
        processingTime: elapsed,
        matchRate: 94,
        date: new Date().toISOString(),
      });
      localStorage.setItem("processing_history", JSON.stringify(history.slice(0, 100)));
    }, duration);
  };

  // Simulated rules-applied feedback
  const appliedRules = customInstructions.trim() ? [
    { applied: true, text: 'Custom AI instructions applied to all products' },
  ] : [];

  // ── Variant matrix types & data ──────────────────────────
  interface VariantLine {
    sku: string;
    option1Name: string;
    option1Value: string;
    option2Name: string;
    option2Value: string;
    qty: number;
    price: number;
    rrp: number;
  }

  interface ProductGroup {
    styleGroup: string;
    name: string;
    brand: string;
    type: string;
    price: number;
    rrp: number;
    status: string;
    metafields: Record<string, string>;
    variants: VariantLine[];
    isGrouped: boolean;
  }

  const [productGroups, setProductGroups] = useState<ProductGroup[]>([
    {
      styleGroup: "Mara One Piece",
      name: "Bond Eye Mara One Piece",
      brand: "Bond Eye",
      type: "One Piece",
      price: 89.95,
      rrp: 219.95,
      status: "ready",
      metafields: { fabric_content: "78% Nylon, 22% Lycra", care_instructions: "Hand wash cold, do not tumble dry", country_of_origin: "Australia", cup_sizes: "A-D", uv_protection: "UPF 50+" },
      isGrouped: true,
      variants: [
        { sku: "BE2204-BLK-8", option1Name: "Size", option1Value: "8", option2Name: "Colour", option2Value: "Black", qty: 2, price: 89.95, rrp: 219.95 },
        { sku: "BE2204-BLK-10", option1Name: "Size", option1Value: "10", option2Name: "Colour", option2Value: "Black", qty: 3, price: 89.95, rrp: 219.95 },
        { sku: "BE2204-BLK-12", option1Name: "Size", option1Value: "12", option2Name: "Colour", option2Value: "Black", qty: 2, price: 89.95, rrp: 219.95 },
        { sku: "BE2204-NAV-8", option1Name: "Size", option1Value: "8", option2Name: "Colour", option2Value: "Navy", qty: 1, price: 89.95, rrp: 219.95 },
        { sku: "BE2204-NAV-10", option1Name: "Size", option1Value: "10", option2Name: "Colour", option2Value: "Navy", qty: 3, price: 89.95, rrp: 219.95 },
        { sku: "BE2204-NAV-12", option1Name: "Size", option1Value: "12", option2Name: "Colour", option2Value: "Navy", qty: 2, price: 89.95, rrp: 219.95 },
      ],
    },
    {
      styleGroup: null as any,
      name: "Seafolly Collective Bikini Top - Navy",
      brand: "Seafolly",
      type: "Bikini Tops",
      price: 45.00,
      rrp: 109.95,
      status: "ready",
      metafields: { fabric_content: "82% Nylon, 18% Elastane", care_instructions: "Hand wash cold, line dry in shade", country_of_origin: "China", cup_sizes: "", uv_protection: "UPF 50+" },
      isGrouped: false,
      variants: [{ sku: "SF10023", option1Name: "Size", option1Value: "One Size", option2Name: "", option2Value: "", qty: 6, price: 45.00, rrp: 109.95 }],
    },
    {
      styleGroup: null as any,
      name: "Baku Riviera High Waist Pant - Ivory",
      brand: "Baku",
      type: "Bikini Bottoms",
      price: 38.00,
      rrp: 89.95,
      status: "review",
      metafields: { fabric_content: "80% Nylon, 20% Elastane", care_instructions: "Hand wash cold", country_of_origin: "Indonesia", cup_sizes: "", uv_protection: "" },
      isGrouped: false,
      variants: [{ sku: "BK20015", option1Name: "Size", option1Value: "One Size", option2Name: "", option2Value: "", qty: 4, price: 38.00, rrp: 89.95 }],
    },
    {
      styleGroup: "Retro Racerback",
      name: "Jantzen Retro Racerback",
      brand: "Jantzen",
      type: "One Piece",
      price: 65.00,
      rrp: 159.95,
      status: "ready",
      metafields: { fabric_content: "77% Nylon, 23% Lycra", care_instructions: "Hand wash cold, do not bleach", country_of_origin: "Australia", cup_sizes: "A-DD", uv_protection: "UPF 50+" },
      isGrouped: true,
      variants: [
        { sku: "JA81520-COR-8", option1Name: "Size", option1Value: "8", option2Name: "Colour", option2Value: "Coral", qty: 2, price: 65.00, rrp: 159.95 },
        { sku: "JA81520-COR-10", option1Name: "Size", option1Value: "10", option2Name: "Colour", option2Value: "Coral", qty: 3, price: 65.00, rrp: 159.95 },
        { sku: "JA81520-COR-12", option1Name: "Size", option1Value: "12", option2Name: "Colour", option2Value: "Coral", qty: 2, price: 65.00, rrp: 159.95 },
      ],
    },
  ]);

  // Flatten for backward-compat with cost tracking etc.
  const mockProducts = productGroups.map(g => ({
    name: g.name,
    sku: g.variants[0]?.sku || "",
    brand: g.brand,
    type: g.type,
    price: g.price,
    rrp: g.rrp,
    status: g.status,
    metafields: g.metafields,
  }));

  const totalVariantLines = productGroups.reduce((s, g) => s + g.variants.length, 0);
  const groupedCount = productGroups.filter(g => g.isGrouped).length;
  const standaloneCount = productGroups.filter(g => !g.isGrouped).length;
  const totalQty = productGroups.reduce((s, g) => s + g.variants.reduce((v, l) => v + l.qty, 0), 0);

  // Split / ungroup a grouped product into individual rows
  const handleSplitGroup = (idx: number) => {
    const group = productGroups[idx];
    if (!group.isGrouped) return;
    const newProducts: ProductGroup[] = group.variants.map(v => ({
      styleGroup: null as any,
      name: `${group.name} - ${v.option2Value || v.option1Value}`,
      brand: group.brand,
      type: group.type,
      price: v.price,
      rrp: v.rrp,
      status: group.status,
      metafields: { ...group.metafields },
      isGrouped: false,
      variants: [v],
    }));
    setProductGroups(prev => [...prev.slice(0, idx), ...newProducts, ...prev.slice(idx + 1)]);
  };

  // Merge selected standalone rows into a group
  const [mergeSelection, setMergeSelection] = useState<number[]>([]);
  const [showMergeForm, setShowMergeForm] = useState(false);
  const [mergeOpt1, setMergeOpt1] = useState("Size");
  const [mergeOpt2, setMergeOpt2] = useState("Colour");

  const handleMergeSelected = () => {
    if (mergeSelection.length < 2) return;
    const selected = mergeSelection.map(i => productGroups[i]).filter(Boolean);
    const base = selected[0];
    const merged: ProductGroup = {
      styleGroup: base.name.replace(/\s*-\s*(Black|Navy|Ivory|Coral|White|Red|Blue|Green|Pink|S|M|L|XL|8|10|12|14|16).*$/i, "").trim(),
      name: base.name.replace(/\s*-\s*(Black|Navy|Ivory|Coral|White|Red|Blue|Green|Pink|S|M|L|XL|8|10|12|14|16).*$/i, "").trim(),
      brand: base.brand,
      type: base.type,
      price: base.price,
      rrp: base.rrp,
      status: base.status,
      metafields: { ...base.metafields },
      isGrouped: true,
      variants: selected.flatMap(s => s.variants),
    };
    const remaining = productGroups.filter((_, i) => !mergeSelection.includes(i));
    setProductGroups([...remaining, merged]);
    setMergeSelection([]);
    setShowMergeForm(false);
  };

  // ── Cost history tracking ────────────────────────────────
  const costHistory = getCostHistory();
  const costChanges = mockProducts.map(p => {
    const key = p.sku || p.name.toLowerCase().replace(/\s*-\s*(black|navy|ivory|coral|white|red|blue|green|pink).*$/i, "").trim();
    const history = costHistory[key];
    if (!history || history.length === 0) return { ...p, costChange: null, isNew: true };
    const prev = history[history.length - 1];
    const changeAmount = p.price - prev.cost;
    const changePct = (changeAmount / prev.cost) * 100;
    return { ...p, costChange: { prev: prev.cost, changeAmount, changePct, prevDate: prev.date }, isNew: false };
  });
  const priceIncreases = costChanges.filter(c => c.costChange && c.costChange.changePct > 0);
  const priceDecreases = costChanges.filter(c => c.costChange && c.costChange.changePct < 0);
  const largePriceAlert = costChanges.find(c => c.costChange && c.costChange.changePct > 10);
  const [showCostSummary, setShowCostSummary] = useState(true);
  const [showPriceAlertModal, setShowPriceAlertModal] = useState(!!largePriceAlert);

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
          {/* Location selector */}
          {storeLocations.length > 1 && (
            <div className="bg-card rounded-lg border border-border p-3 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm">📍</span>
                <span className="text-xs font-medium">Receiving location for this invoice:</span>
              </div>
              <select value={receivingLocation} onChange={e => setReceivingLocation(e.target.value)}
                className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm">
                {storeLocations.map(loc => (
                  <option key={loc.id} value={loc.id}>{loc.name}{loc.isDefault ? " (default)" : ""}</option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={handleFileSelect}
            className="w-full h-48 rounded-lg border-2 border-dashed border-border bg-card flex flex-col items-center justify-center gap-3 active:bg-muted transition-colors"
          >
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <Upload className="w-6 h-6 text-primary" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">Tap to upload invoice</p>
              <p className="text-xs text-muted-foreground mt-1">PDF · Excel · CSV · Word · JPG · PNG</p>
              <p className="text-[11px] text-muted-foreground/70 mt-0.5">📷 Drop a photo of your invoice — AI will read it automatically</p>
            </div>
          </button>

          <button
            onClick={handleFileSelect}
            className="w-full mt-3 h-12 rounded-lg border border-border bg-card flex items-center justify-center gap-2 text-sm active:bg-muted"
          >
            <Camera className="w-4 h-4 text-primary" />
            Take a photo
          </button>

          {/* File parse mode indicator */}
          {fileParseMode && (
            <div className="mt-3 bg-card rounded-lg border border-border px-3 py-2 flex items-center gap-2">
              {fileParseMode === "pdf_text" && <><FileText className="w-4 h-4 text-primary" /><span className="text-xs">📄 Digital PDF — reading text layer</span></>}
              {fileParseMode === "pdf_scan" && <><Search className="w-4 h-4 text-accent-foreground" /><span className="text-xs">🔍 Scanned PDF — using image recognition</span></>}
              {fileParseMode === "photo" && <><Camera className="w-4 h-4 text-accent-foreground" /><span className="text-xs">📷 Invoice photo — using image recognition</span></>}
              {fileParseMode === "spreadsheet" && <><FileText className="w-4 h-4 text-primary" /><span className="text-xs">📊 Spreadsheet — reading data rows</span></>}
              {fileParseMode === "email" && <><FileText className="w-4 h-4 text-primary" /><span className="text-xs">📧 Email — extracting invoice data</span></>}
            </div>
          )}

          {/* Low quality image warning */}
          {showLowQualityWarning && (
            <div className="mt-3 bg-destructive/10 border border-destructive/20 rounded-lg p-3">
              <p className="text-xs font-semibold text-destructive mb-1">⚠️ Image quality may be affecting accuracy</p>
              <p className="text-xs text-muted-foreground mb-2">AI extracted fewer than 3 lines from this image. For best results:</p>
              <ul className="text-xs text-muted-foreground space-y-0.5 mb-2 list-disc list-inside">
                <li>Use good lighting when photographing invoices</li>
                <li>Ensure text is in focus and not blurry</li>
                <li>Avoid shadows across the text</li>
              </ul>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setShowLowQualityWarning(false); setFileParseMode(null); }}>Try again with a better photo</Button>
                <Button size="sm" className="h-7 text-xs" onClick={() => setShowLowQualityWarning(false)}>Continue</Button>
              </div>
            </div>
          )}


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

          {/* Template recognition banner */}
          {matchedTemplate && showDetails && useTemplate === null && (
            <div className="mt-3 bg-primary/5 border border-primary/20 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 text-primary" />
                <span className="text-xs font-semibold text-primary">
                  {matchedTemplate.isShared ? "🇦🇺 AU shared template" : "Saved template"} recognised
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                {matchedTemplate.supplier} template found — parsing with saved format
                {matchedTemplate.successCount > 0 ? ` (${matchedTemplate.successCount} successful uses)` : ""}.
              </p>
              <div className="grid grid-cols-2 gap-1 text-[11px] bg-muted/50 rounded-md p-2 mb-2">
                <span className="text-muted-foreground">File type:</span><span>{matchedTemplate.fileType.toUpperCase()}</span>
                <span className="text-muted-foreground">Header row:</span><span>Row {matchedTemplate.headerRow}</span>
                {Object.entries(matchedTemplate.columns).filter(([, v]) => v).map(([k, v]) => (
                  <><span key={k} className="text-muted-foreground">{COLUMN_LABELS[k as keyof ColumnMapping] || k}:</span><span>Column {v}</span></>
                ))}
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="h-7 text-xs" onClick={() => setUseTemplate(true)}>
                  <Zap className="w-3 h-3 mr-1" /> Use template
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setUseTemplate(false)}>
                  Parse fresh instead
                </Button>
              </div>
            </div>
          )}
          {useTemplate === true && matchedTemplate && (
            <div className="mt-2 bg-primary/5 border border-primary/20 rounded-lg p-2 flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs text-primary font-medium">⚡ Using {matchedTemplate.supplier} template — expected ~40% faster</span>
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
          <h3 className="text-lg font-semibold font-display mb-2">
            {fileParseMode === "photo" ? "Reading your invoice photo..." : fileParseMode === "pdf_scan" ? "Scanning your PDF..." : "Reading your invoice..."}
          </h3>
          <p className="text-sm text-muted-foreground text-center">
            {(fileParseMode === "photo" || fileParseMode === "pdf_scan")
              ? "Using AI image recognition to extract product data"
              : "Extracting product names, prices, and quantities"}
          </p>
          {fileParseMode && (
            <p className="text-xs text-muted-foreground mt-2">
              {fileParseMode === "pdf_text" && "📄 Digital PDF — text layer detected"}
              {fileParseMode === "pdf_scan" && "🔍 Scanned PDF — OCR in progress"}
              {fileParseMode === "photo" && "📷 Photo — AI vision processing"}
              {fileParseMode === "spreadsheet" && "📊 Spreadsheet — parsing rows"}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-3 font-mono-data">
            ⏱ {Math.floor(processingElapsed / 60)}:{String(processingElapsed % 60).padStart(2, "0")} elapsed
            {useTemplate ? " · ~0:02 remaining" : " · ~0:03 remaining"}
          </p>
          {useTemplate && matchedTemplate && (
            <p className="text-xs text-primary mt-2 flex items-center gap-1">
              <Zap className="w-3 h-3" /> Using {matchedTemplate.supplier} template — faster parsing
            </p>
          )}
          {customInstructions.trim() && (
            <p className="text-xs text-primary mt-2">🤖 Applying your custom instructions...</p>
          )}
        </div>
      )}

      {/* Step 3: Review */}
      {step === 3 && (
        <div className="px-4 pt-4">
          {/* Template save prompt */}
          {showSaveTemplate && !savedTemplate && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mb-3">
              <div className="flex items-center gap-2 mb-1.5">
                <FileText className="w-4 h-4 text-primary" />
                <span className="text-xs font-semibold text-primary">📋 Save this invoice format?</span>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                SkuPilot detected a consistent layout for {supplierName || "this supplier"}'s invoices. Save it so future invoices parse instantly.
              </p>
              <div className="grid grid-cols-2 gap-1 text-[11px] bg-muted/50 rounded-md p-2 mb-2">
                <span className="text-muted-foreground">Supplier:</span><span>{supplierName}</span>
                <span className="text-muted-foreground">File type:</span><span>PDF</span>
                <span className="text-muted-foreground">Header row:</span><span>Row 1</span>
                <span className="text-muted-foreground">Product column:</span><span>Column A</span>
                <span className="text-muted-foreground">SKU column:</span><span>Column B</span>
                <span className="text-muted-foreground">Cost column:</span><span>Column F</span>
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="h-7 text-xs" onClick={() => {
                  saveFormatTemplate({
                    supplier: supplierName,
                    fileType: "pdf",
                    headerRow: 1,
                    columns: { title: "A", sku: "B", colour: "C", size: "D", qty: "E", cost: "F" },
                    successCount: 1, errorCount: 0,
                    lastUsed: new Date().toISOString(),
                    createdAt: new Date().toISOString(),
                    notes: "",
                  });
                  setSavedTemplate(true);
                  setShowSaveTemplate(false);
                }}>
                  <Check className="w-3 h-3 mr-1" /> Save template
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowSaveTemplate(false)}>Not now</Button>
              </div>
            </div>
          )}
          {savedTemplate && (
            <div className="bg-success/10 border border-success/20 rounded-lg p-2 mb-3 flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-success" />
              <span className="text-xs text-success font-medium">Template saved — future {supplierName} invoices will parse faster</span>
            </div>
          )}

          {/* Processing time banner */}
          {processingDone && finalProcessingTime > 0 && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-2.5 mb-3 flex items-center gap-2">
              <span className="text-xs text-primary font-medium font-mono-data">
                ✅ {totalVariantLines} lines → {productGroups.length} products ({groupedCount} grouped + {standaloneCount} standalone) · {totalQty} total units · enriched in {finalProcessingTime < 60 ? `${finalProcessingTime}s` : `${Math.floor(finalProcessingTime / 60)}m ${finalProcessingTime % 60}s`}
              </span>
            </div>
          )}

          {/* Cost change summary */}
          {(priceIncreases.length > 0 || priceDecreases.length > 0) && (
            <div className="bg-card border border-border rounded-lg p-3 mb-3">
              <button onClick={() => setShowCostSummary(!showCostSummary)} className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-secondary" />
                  <span className="text-xs font-semibold">💰 Cost changes detected</span>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${showCostSummary ? "rotate-180" : ""}`} />
              </button>
              {showCostSummary && (
                <div className="mt-2.5 space-y-1.5">
                  <p className="text-[10px] text-muted-foreground">
                    {priceIncreases.length > 0 && <span className="text-destructive">⚠ {priceIncreases.length} increase{priceIncreases.length > 1 ? "s" : ""}</span>}
                    {priceIncreases.length > 0 && priceDecreases.length > 0 && " · "}
                    {priceDecreases.length > 0 && <span className="text-success">↓ {priceDecreases.length} decrease{priceDecreases.length > 1 ? "s" : ""}</span>}
                  </p>
                  {costChanges.filter(c => c.costChange && c.costChange.changePct !== 0).map((c, i) => (
                    <div key={i} className="flex items-center justify-between text-xs bg-muted/30 rounded px-2.5 py-1.5">
                      <span className="truncate flex-1 mr-2">{c.name}</span>
                      <span className={`shrink-0 font-mono-data font-medium ${c.costChange!.changePct > 5 ? "text-destructive" : c.costChange!.changePct > 0 ? "text-warning" : "text-success"}`}>
                        ${c.costChange!.prev.toFixed(2)} → ${c.price.toFixed(2)} ({c.costChange!.changePct > 0 ? "+" : ""}{c.costChange!.changePct.toFixed(1)}%)
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Large price increase alert modal */}
          {showPriceAlertModal && largePriceAlert && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="bg-card rounded-xl border border-border shadow-lg max-w-sm w-full p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-destructive" />
                  <h3 className="font-semibold text-sm">Large price increase detected</h3>
                </div>
                <div className="text-xs text-muted-foreground space-y-1.5">
                  <p>{largePriceAlert.brand} has increased the cost of:</p>
                  <p className="font-medium text-foreground">{largePriceAlert.name} — SKU {largePriceAlert.sku}</p>
                  <div className="bg-muted/50 rounded-lg p-2.5 space-y-0.5 font-mono-data">
                    <p>Previous cost: ${largePriceAlert.costChange!.prev.toFixed(2)} ({largePriceAlert.costChange!.prevDate})</p>
                    <p>New cost: ${largePriceAlert.price.toFixed(2)}</p>
                    <p className="text-destructive font-semibold">Increase: ${largePriceAlert.costChange!.changeAmount.toFixed(2)} (+{largePriceAlert.costChange!.changePct.toFixed(1)}%)</p>
                  </div>
                  {largePriceAlert.rrp > 0 && (() => {
                    const oldMargin = ((largePriceAlert.rrp - largePriceAlert.costChange!.prev) / largePriceAlert.rrp * 100).toFixed(0);
                    const newMargin = ((largePriceAlert.rrp - largePriceAlert.price) / largePriceAlert.rrp * 100).toFixed(0);
                    return <p className="text-[10px]">RRP: ${largePriceAlert.rrp.toFixed(2)} · Margin: {oldMargin}% → {newMargin}%</p>;
                  })()}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1 h-8 text-xs" onClick={() => setShowPriceAlertModal(false)}>Acknowledge</Button>
                  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowPriceAlertModal(false)}>Review price</Button>
                </div>
              </div>
            </div>
          )}

          {showSpeedTips && (
            <div className="bg-muted/50 border border-border rounded-lg p-3 mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-semibold">💡 Speed tips for faster processing</p>
                <button onClick={() => setShowSpeedTips(false)} className="text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <p>• Upload your supplier catalog to catalog memory — next time, products will match in seconds without web search</p>
                <p>• Save barcodes after each invoice — barcode matching is 10× faster than name matching</p>
                <p>• Turn off image search for restock orders — you already have photos for existing products</p>
              </div>
            </div>
          )}

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
            <div>
              <p className="text-sm font-medium">{productGroups.length} products found</p>
              <p className="text-[10px] text-muted-foreground">{totalVariantLines} lines → {groupedCount} grouped + {standaloneCount} standalone</p>
            </div>
            <div className="flex gap-2">
              {mergeSelection.length >= 2 ? (
                <Button variant="outline" size="sm" onClick={handleMergeSelected} className="gap-1 text-primary border-primary">
                  <Link className="w-3.5 h-3.5" /> Group {mergeSelection.length} as variants
                </Button>
              ) : mergeSelection.length > 0 ? (
                <span className="text-[10px] text-muted-foreground self-center">Select {2 - mergeSelection.length} more to group</span>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => setPreviewAll(true)} className="gap-1"><Eye className="w-3.5 h-3.5" /> Preview all</Button>
              <Button variant="ghost" size="sm"><RotateCcw className="w-3.5 h-3.5 mr-1" /> Regenerate</Button>
              <Button variant="teal" size="sm" onClick={() => setStep(4)}>Download <ChevronRight className="w-3.5 h-3.5 ml-1" /></Button>
            </div>
          </div>
          <div className="space-y-2">
            {productGroups.map((group, i) => (
              group.isGrouped ? (
                <VariantGroupCard
                  key={`g-${i}`}
                  group={group}
                  onSplit={() => handleSplitGroup(i)}
                  onPreview={() => setPreviewProduct(mockProducts.find(p => p.name === group.name) || mockProducts[0])}
                />
              ) : (
                <div key={`s-${i}`} className="relative">
                  {/* Merge selection checkbox */}
                  <div className="absolute top-3 right-12 z-10">
                    <input
                      type="checkbox"
                      checked={mergeSelection.includes(i)}
                      onChange={e => {
                        if (e.target.checked) setMergeSelection([...mergeSelection, i]);
                        else setMergeSelection(mergeSelection.filter(x => x !== i));
                      }}
                      title="Select to group as variants"
                      className="w-4 h-4 rounded border-border accent-primary"
                    />
                  </div>
                  <ProductCard
                    product={{
                      ...mockProducts.find(p => p.name === group.name) || { name: group.name, brand: group.brand, type: group.type, price: group.price, rrp: group.rrp, status: group.status },
                      sku: group.variants[0]?.sku,
                      metafields: group.metafields,
                      costChange: costChanges.find(c => c.name === group.name)?.costChange || null,
                      isNew: costChanges.find(c => c.name === group.name)?.isNew,
                    }}
                    onPreview={() => setPreviewProduct(mockProducts.find(p => p.name === group.name) || mockProducts[0])}
                  />
                </div>
              )
            ))}
          </div>

          {/* Collection coverage check */}
          {(() => {
            const coverageData = mockProducts.map(p => ({
              name: p.name, brand: p.brand, type: p.type,
              tags: [p.type, p.brand, "new arrivals", "Womens", "Swimwear", "full_price"].filter(Boolean),
            }));
            const coverage = checkCoverage(coverageData);
            const unassigned = coverage.results.filter(r => !r.hasSpecificCollection);
            return (
              <div className={`rounded-lg p-3 mt-3 text-xs ${unassigned.length > 0 ? "bg-warning/10 border border-warning/20" : "bg-success/10 border border-success/20"}`}>
                <p className={`font-semibold ${unassigned.length > 0 ? "text-warning" : "text-success"}`}>
                  🏷️ {coverage.assignedCount}/{coverage.total} products assigned to specific collections
                </p>
                {unassigned.map((u, i) => (
                  <p key={i} className="text-warning/80 mt-0.5">⚠ {u.productName} — {u.suggestion}</p>
                ))}
              </div>
            );
          })()}

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

      {/* Step 4: Export Review */}
      {step === 4 && (
        <ExportReviewScreen
          products={mockProducts.map(p => ({
            ...p,
            hasImage: p.status === "ready",
            hasSeo: true,
            hasTags: true,
            confidence: p.status === "ready" ? "high" as const : "medium" as const,
            isNew: true,
          }))}
          supplierName={supplierName}
          onBack={() => setStep(3)}
        />
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
// ── Variant Group Card ────────────────────────────────────
const VariantGroupCard = ({ group, onSplit, onPreview }: {
  group: { styleGroup: string; name: string; brand: string; type: string; price: number; rrp: number; status: string; variants: { sku: string; option1Name: string; option1Value: string; option2Name: string; option2Value: string; qty: number }[]; metafields: Record<string, string> };
  onSplit: () => void;
  onPreview?: () => void;
}) => {
  const [expanded, setExpanded] = useState(false);
  const variants = group.variants;
  const totalQty = variants.reduce((s, v) => s + v.qty, 0);

  // Build the grid: option2 values as rows, option1 values as columns
  const option1Values = [...new Set(variants.map(v => v.option1Value))];
  const option2Values = [...new Set(variants.filter(v => v.option2Value).map(v => v.option2Value))];
  const hasOption2 = option2Values.length > 0;

  const getQty = (opt1: string, opt2: string) => {
    const v = variants.find(v => v.option1Value === opt1 && v.option2Value === opt2);
    return v?.qty ?? 0;
  };

  return (
    <div className="bg-card rounded-lg border-2 border-primary/30 overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full px-4 py-3 text-left">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm">🧩</span>
              <p className="font-semibold text-sm truncate">{group.name} — {group.brand}</p>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {hasOption2
                ? `${option2Values.length} colour${option2Values.length > 1 ? "s" : ""} × ${option1Values.length} size${option1Values.length > 1 ? "s" : ""}`
                : `${option1Values.length} variant${option1Values.length > 1 ? "s" : ""}`}
              {" · "}{variants.length} variants · Total qty: {totalQty}
            </p>
            <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] bg-primary/10 text-primary border border-primary/20">
              ✓ Enriched ({variants.length} variants)
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-3">
            <span className={`w-2 h-2 rounded-full ${group.status === "ready" ? "bg-success" : "bg-secondary"}`} />
            <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
          </div>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
          {/* Variant grid */}
          {hasOption2 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr>
                    <th className="text-left py-1.5 pr-3 text-muted-foreground font-medium border-b border-border">
                      {variants[0]?.option2Name || "Colour"} / {variants[0]?.option1Name || "Size"}
                    </th>
                    {option1Values.map(s => (
                      <th key={s} className="text-center py-1.5 px-2 text-muted-foreground font-medium border-b border-border">{s}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {option2Values.map(colour => (
                    <tr key={colour} className="border-b border-border/50">
                      <td className="py-1.5 pr-3 font-medium">{colour}</td>
                      {option1Values.map(size => {
                        const qty = getQty(size, colour);
                        return (
                          <td key={size} className="text-center py-1.5 px-2">
                            <span className={`inline-block min-w-[24px] rounded px-1 py-0.5 font-mono-data ${qty > 0 ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground/40"}`}>
                              {qty > 0 ? qty : "—"}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {variants.map((v, i) => (
                <div key={i} className="px-2.5 py-1 rounded-md bg-muted text-xs font-mono-data">
                  {v.option1Value}: <span className="font-medium">{v.qty}</span>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 flex-wrap">
            {onPreview && <Button variant="outline" size="sm" onClick={onPreview}><Eye className="w-3.5 h-3.5 mr-1" /> Preview</Button>}
            <Button variant="ghost" size="sm" onClick={onSplit}>
              <Scissors className="w-3.5 h-3.5 mr-1" /> Split into separate products
            </Button>
            <Button variant="ghost" size="sm"><RotateCcw className="w-3.5 h-3.5 mr-1" /> Regenerate</Button>
          </div>
        </div>
      )}
    </div>
  );
};

const ProductCard = ({ product, onPreview }: { product: { name: string; sku?: string; brand: string; type: string; price: number; rrp: number; status: string; metafields?: Record<string, string>; costChange?: { prev: number; changeAmount: number; changePct: number; prevDate: string } | null; isNew?: boolean }; onPreview?: () => void }) => {
  const [showMeta, setShowMeta] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
  const locs = getStoreLocations();
  const defaultLoc = locs.find(l => l.isDefault) || locs[0];
  const [selectedLocation, setSelectedLocation] = useState(defaultLoc?.id || "");
  const [splitQtys, setSplitQtys] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    locs.forEach(l => { init[l.id] = l.isDefault ? 12 : 0; });
    return init;
  });
  const enabledMeta = (() => { try { return (JSON.parse(localStorage.getItem("metafield_config") || "[]") as { key: string; label: string; enabled: boolean }[]).filter(m => m.enabled); } catch { return []; } })();
  const meta = product.metafields || {};
  const invoiceQty = 12;
  const splitTotal = Object.values(splitQtys).reduce((a, b) => a + b, 0);
  const margin = product.rrp > 0 ? ((product.rrp - product.price) / product.rrp) * 100 : null;

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full px-4 py-3 text-left">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">{product.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {product.brand} · {product.type} · ${product.rrp.toFixed(2)}
            </p>
            {/* Collection pills */}
            {(() => {
              const tags = [product.type, product.brand, "new arrivals", "Womens", "Swimwear", "full_price"].filter(Boolean);
              const cols = matchCollectionsWithBrand(tags, product.brand);
              return cols.length > 0 ? (
                <div className="flex flex-wrap gap-1 mt-1">
                  {cols.slice(0, 4).map(c => (
                    <span key={c} className="px-1.5 py-0.5 rounded text-[9px] bg-primary/10 text-primary border border-primary/20">{c}</span>
                  ))}
                  {cols.length > 4 && <span className="text-[9px] text-muted-foreground">+{cols.length - 4}</span>}
                </div>
              ) : null;
            })()}
            {/* Cost change badge */}
            {product.costChange && product.costChange.changePct !== 0 && (
              <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] font-medium ${
                product.costChange.changePct > 5 ? "bg-destructive/15 text-destructive" :
                product.costChange.changePct > 0 ? "bg-warning/15 text-warning" :
                "bg-success/15 text-success"
              }`}>
                {product.costChange.changePct > 0 ? "↑" : "↓"} {product.costChange.changePct > 0 ? "+" : ""}{product.costChange.changePct.toFixed(1)}% vs last order
              </span>
            )}
            {product.isNew && !product.costChange && (
              <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] bg-muted text-muted-foreground">New — no price history</span>
            )}
            {/* Margin indicator */}
            {margin !== null && (
              <span className={`inline-block mt-0.5 text-[9px] ${margin < 25 ? "text-destructive" : margin < 40 ? "text-warning" : "text-muted-foreground"}`}>
                {margin < 25 && "⚠ "}Margin: {margin.toFixed(0)}%
              </span>
            )}
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
            <input type="number" defaultValue={product.price} className="h-10 rounded-md bg-input border border-border px-3 text-sm" placeholder="Cost" />
            <input type="number" defaultValue={product.rrp} className="h-10 rounded-md bg-input border border-border px-3 text-sm" placeholder="RRP" />
          </div>
          <textarea defaultValue="Stylish swimwear piece perfect for summer." className="w-full h-20 rounded-md bg-input border border-border px-3 py-2 text-sm resize-none" placeholder="Description" />

          {/* Per-line location */}
          {locs.length > 1 && (
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">📍 Location</label>
              <div className="flex gap-2 items-center">
                <select value={selectedLocation} onChange={e => setSelectedLocation(e.target.value)}
                  className="flex-1 h-8 rounded-md bg-input border border-border px-2 text-xs">
                  {locs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <button onClick={() => setShowSplit(!showSplit)}
                  className="text-[10px] text-primary font-medium whitespace-nowrap">
                  {showSplit ? "Cancel split" : "Split shipment"}
                </button>
              </div>
              {showSplit && (
                <div className="mt-2 bg-muted/30 rounded-lg p-2.5 space-y-1.5">
                  <p className="text-[10px] text-muted-foreground font-medium mb-1">Split across locations (invoice qty: {invoiceQty})</p>
                  {locs.map(l => (
                    <div key={l.id} className="flex items-center gap-2">
                      <span className="text-[10px] flex-1 truncate">{l.name}</span>
                      <input type="number" min={0} value={splitQtys[l.id] || 0}
                        onChange={e => setSplitQtys({ ...splitQtys, [l.id]: parseInt(e.target.value) || 0 })}
                        className="w-16 h-7 rounded-md bg-input border border-border px-2 text-xs text-center" />
                      <span className="text-[10px] text-muted-foreground">units</span>
                    </div>
                  ))}
                  <div className={`text-[10px] font-medium mt-1 ${splitTotal === invoiceQty ? "text-success" : "text-destructive"}`}>
                    Total: {splitTotal} / {invoiceQty} {splitTotal === invoiceQty ? "✓" : `⚠ ${splitTotal > invoiceQty ? "over" : "under"} by ${Math.abs(splitTotal - invoiceQty)}`}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Metafields section */}
          {enabledMeta.length > 0 && (
            <div>
              <button onClick={() => setShowMeta(!showMeta)} className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <ChevronDown className={`w-3 h-3 transition-transform ${showMeta ? "rotate-180" : ""}`} />
                📋 Product details ({Object.values(meta).filter(Boolean).length}/{enabledMeta.length} fields)
              </button>
              {showMeta && (
                <div className="space-y-2 bg-muted/30 rounded-lg p-3">
                  {enabledMeta.map(mf => (
                    <div key={mf.key}>
                      <label className="text-[10px] text-muted-foreground mb-0.5 block">{mf.label}</label>
                      <input
                        defaultValue={meta[mf.key] || ""}
                        placeholder={`Enter ${mf.label.toLowerCase()}`}
                        className="w-full h-8 rounded-md bg-input border border-border px-2 text-xs"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2">
            {onPreview && <Button variant="outline" size="sm" onClick={onPreview}><Eye className="w-3.5 h-3.5 mr-1" /> Preview</Button>}
            <Button variant="ghost" size="sm"><RotateCcw className="w-3.5 h-3.5 mr-1" /> Regenerate</Button>
            <Button variant="ghost" size="sm" className="text-destructive"><X className="w-3.5 h-3.5 mr-1" /> Remove</Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default InvoiceFlow;
