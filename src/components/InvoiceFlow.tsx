import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { setSessionProducts as setInvoiceSessionProducts } from "@/stores/invoice-session-store";
import { startShadowSession, logShadowStep, logShadowFeedback, completeShadowSession } from "@/lib/agent-shadow";
import { syncInvoiceItemsToCatalog } from "@/lib/invoice-catalog-sync";
import { runPhase3PriceResearch, type Phase3Item } from "@/lib/phase3-price-orchestrator";
import { detectBrandFromSku } from "@/lib/sku-brand-prefix";
import POSPickerDialog, { hasPickedPOS } from "@/components/POSPickerDialog";
import { toast } from "sonner";
import { usePromptDialog } from "@/hooks/use-prompt-dialog";
import { Upload, ChevronDown, ChevronRight, Camera, FileText, Loader2, Check, ChevronLeft, RotateCcw, X, Download, Bot, Clock, Save, Monitor, Package, AlertTriangle, Search, Settings, Eye, Zap, DollarSign, Link, Scissors, PackagePlus, ArrowDown, Barcode, PackageCheck, Image as ImageIcon, Tag, CloudDownload } from "lucide-react";
import ShopifyPreview from "@/components/ShopifyPreview";
import ExportReviewScreen from "@/components/ExportReviewScreen";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { matchCollectionsWithBrand, checkCoverage } from "@/lib/collection-engine";
import { useStoreMode } from "@/hooks/use-store-mode";
import Papa from "papaparse";
import { generateXSeriesCSV, getXSeriesSettings, saveXSeriesSettings, type XSeriesSettings, type XSeriesProduct } from "@/lib/lightspeed-xseries";
import { findTemplate, saveFormatTemplate, incrementTemplateUse, saveLayoutTemplate, buildTemplateHint, saveCorrection, getTemplateList, getLayoutLabel, COLUMN_LABELS, type InvoiceTemplate, type ColumnMapping, type ProcessAsMode, type LayoutType, type CorrectionPattern } from "@/lib/invoice-templates";
import { buildMemoryHint, recordParseSuccess, recordFieldCorrection, recordNoiseRejection, getMemoryStats, type LayoutFingerprint } from "@/lib/invoice-learning";
import { getStoreLocations } from "@/components/AccountScreen";
import { lookupInventory, updateStock, incrementStockUpdates, getStockUpdatesCount, type InventoryItem } from "@/lib/inventory-sim";
import { addAuditEntry } from "@/lib/audit-log";
import { normaliseVendor } from "@/lib/normalise-vendor";
import { calculateConfidence, type ConfidenceBreakdown, type ConfidenceLevel, getConfidenceLabel } from "@/lib/confidence";
import ConfidenceBadge from "@/components/ConfidenceBadge";
import { matchProduct, saveBarcodeToCatalog, getBarcodeCatalog, type MatchSource } from "@/lib/barcode-catalog";
import { validateAndCleanProducts, type ValidatedProduct, type ValidationDebugInfo } from "@/lib/invoice-validator";
import { isBrainModeEnabled, runBrainPipeline, saveBrainLearnings } from "@/lib/brain-pipeline";
import type { BrainProduct, BrainValidationSummary } from "@/lib/brain-validator";
import { BrainModeToggle } from "@/components/BrainModeToggle";
import { BrainSummaryBanner, BrainRecognitionBanner } from "@/components/BrainModeFlags";
import TeachSonicWizard from "@/components/TeachSonicWizard";
import { contributeSharedProfile } from "@/lib/universal-classifier";
import InvoiceAutoCorrectPanel from "@/components/InvoiceAutoCorrectPanel";
import PostParseReviewScreen from "@/components/PostParseReviewScreen";
import PhaseThreeFourPanel from "@/components/PhaseThreeFourPanel";
import PhaseFiveSixPanel from "@/components/PhaseFiveSixPanel";
import AccountingBillReview from "@/components/AccountingBillReview";
import StockCheckFlow from "@/components/StockCheckFlow";
import PriceLookup from "@/components/PriceLookup";
import PriceMatchPanel from "@/components/PriceMatchPanel";
import ProductDescriptionPanel from "@/components/ProductDescriptionPanel";
import ImageHelperPanel from "@/components/ImageHelperPanel";
import { mapInvoiceItemsToPriceMatch } from "@/lib/price-match-utils";
import CollectionSEOFlow from "@/components/CollectionSEOFlow";
import SupplierTemplateTeach from "@/components/SupplierTemplateTeach";
import { extractWithTemplate, parseFileToRows, autoDetectMappings, type SupplierTemplate as DBSupplierTemplate } from "@/lib/rule-based-extractor";
import type { InvoiceLineItem } from "@/lib/stock-matcher";
import { preprocessInvoiceImage, isLikelyPhotoInvoice, preprocessForUpload, isPdfFile, type PreprocessResult, type DetectedRegions } from "@/lib/invoice-preprocess";
import { supabase } from "@/integrations/supabase/client";
import { inferSupplierRules, computeHeaderFingerprint, type InferredRules, type SupplierProfile as InferProfile, type SharedPatternLite } from "@/lib/supplier-inference";
import { generateLayoutFingerprint, matchFingerprint } from "@/lib/layout-fingerprint";
import { recordProcessingQuality } from "@/lib/processing-quality";
import { formatDuration, estimateEta, recordProcessingDuration } from "@/lib/processing-timing";
import { persistParsedInvoice } from "@/lib/invoice-persistence";
import DriveQueuePanel from "@/components/DriveQueuePanel";

export type InvoiceMatchMethod = "fingerprint_match" | "supplier_match" | "full_extraction";

export interface FingerprintHit {
  source: "user" | "shared";
  layout_fingerprint: string;
  column_map: Record<string, string>;
  size_system?: string | null;
  price_logic?: Record<string, unknown> | null;
  format_type?: string | null;
  confidence_score?: number | null;
  invoice_count?: number | null;
  match_count?: number | null;
}

/**
 * STEP 1 — Look for an exact layout-fingerprint match.
 * Checks the user's own learned invoice_patterns first (with confidence
 * gate of >=80), then falls back to the cross-client shared_fingerprint_index.
 */
async function lookupFingerprintMatch(
  fingerprint: string,
): Promise<FingerprintHit | null> {
  if (!fingerprint) return null;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user?.id;
    if (!userId) return null;

    // a) User's own patterns — must clear confidence gate
    const { data: ownRows } = await supabase
      .from("invoice_patterns" as any)
      .select("id, layout_fingerprint, column_map, size_system, format_type, price_column_cost, price_column_rrp, gst_included_in_cost, gst_included_in_rrp, default_markup_multiplier, invoice_count, supplier_profiles!inner(confidence_score)")
      .eq("user_id", userId)
      .eq("layout_fingerprint", fingerprint)
      .limit(5);

    const eligible = (ownRows || []).find((r: any) => {
      const conf = r.supplier_profiles?.confidence_score ?? 0;
      return conf >= 80;
    }) as any;

    if (eligible) {
      const hit = matchFingerprint(fingerprint, [eligible]);
      if (hit) {
        return {
          source: "user",
          layout_fingerprint: fingerprint,
          column_map: (eligible.column_map || {}) as Record<string, string>,
          size_system: eligible.size_system,
          format_type: eligible.format_type,
          confidence_score: eligible.supplier_profiles?.confidence_score ?? null,
          invoice_count: eligible.invoice_count ?? null,
          price_logic: {
            price_column_cost: eligible.price_column_cost,
            price_column_rrp: eligible.price_column_rrp,
            gst_included_in_cost: eligible.gst_included_in_cost,
            gst_included_in_rrp: eligible.gst_included_in_rrp,
            default_markup_multiplier: eligible.default_markup_multiplier,
          },
        };
      }
    }

    // b) Cross-client shared index
    const { data: sharedRows } = await supabase
      .from("shared_fingerprint_index" as any)
      .select("layout_fingerprint, format_type, column_map, size_system, price_logic, match_count")
      .eq("layout_fingerprint", fingerprint)
      .limit(1);

    const shared = (sharedRows || [])[0] as any;
    if (shared) {
      return {
        source: "shared",
        layout_fingerprint: shared.layout_fingerprint,
        column_map: (shared.column_map || {}) as Record<string, string>,
        size_system: shared.size_system,
        format_type: shared.format_type,
        price_logic: shared.price_logic || null,
        match_count: shared.match_count ?? null,
      };
    }
  } catch (err) {
    console.warn("[Sonic Invoice] fingerprint lookup failed:", err);
  }
  return null;
}

// Load all of this user's supplier profiles + their invoice patterns,
// then run the waterfall inference. Used to pre-seed the AI extractor
// with learned rules before sending the prompt.
async function buildInferredRules(
  supplierName: string,
  detectedHeaders: string[],
  sampleRows: Record<string, unknown>[],
): Promise<InferredRules | null> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user?.id;
    if (!userId) return null;

    const { data: profiles } = await supabase
      .from("supplier_profiles" as any)
      .select("id, supplier_name, supplier_name_variants, confidence_score, invoice_count, currency, country, profile_data, invoice_patterns(id, format_type, column_map, size_system, price_column_cost, price_column_rrp, gst_included_in_cost, gst_included_in_rrp, default_markup_multiplier, pack_notation_detected, size_matrix_detected, sample_headers)")
      .eq("user_id", userId)
      .eq("is_active", true);

    // Pull anonymised shared patterns matching this header fingerprint
    // — fallback when this user has no learned rules yet.
    let sharedPatterns: SharedPatternLite[] = [];
    try {
      const fp = computeHeaderFingerprint(detectedHeaders || []);
      if (fp) {
        const { data: shared } = await supabase
          .from("shared_patterns" as any)
          .select("format_type, header_fingerprint, column_roles, size_system, gst_included_in_cost, gst_included_in_rrp, markup_avg, pack_notation_detected, size_matrix_detected, contributor_count, avg_confidence")
          .eq("header_fingerprint", fp)
          .limit(1);
        sharedPatterns = (shared || []) as unknown as SharedPatternLite[];
      }
    } catch {
      // table may not exist yet in older deployments — fail silent
    }

    const list = (profiles || []) as unknown as InferProfile[];
    return inferSupplierRules(detectedHeaders || [], sampleRows || [], list, supplierName, "fashion", sharedPatterns);
  } catch (err) {
    console.warn("[Sonic Invoice] inferSupplierRules failed:", err);
    return null;
  }
}

interface InvoiceFlowProps {
  onBack: () => void;
  /** Optional — used to auto-route to a different flow when the AI classifier
   *  detects a packing slip while the user left "Process as" on Auto. */
  onNavigate?: (flowKey: string) => void;
}

type Step = 1 | 2 | 3 | 4;

// B4 #2 — Sub-step labels nest under the top phase bar. The first three
// steps (Upload → Read → Review) are sub-stages of Phase 1: Capture; the
// final step (Export) is the hand-off to Phase 5: Publish. Keeping the
// vocabulary aligned avoids the "6 vs 4 step labels" mismatch.
const stepLabels = ["1a · Upload", "1b · Read", "1c · Review", "5 · Export"];

// ── Instruction snippets ───────────────────────────────────
const quickInserts = [
  { label: "+ Brand prefix", text: "Add the actual supplier/brand name (the real vendor, e.g. 'Walnut Melbourne') at the start of every product name. Do not insert the literal text '[BRAND NAME]' — substitute the detected brand." },
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

// Cost history seeding removed — only real invoice data is used now

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
function deleteTemplate(supplier: string) {
  const t = getTemplates();
  delete t[supplier];
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(t));
}

// Per-supplier opt-in flag for learning custom requirements as a reusable template.
const LEARN_FLAG_KEY = "invoice_learn_supplier_template";
export function getLearnSupplierFlag(supplier: string): boolean {
  if (!supplier) return false;
  try {
    const all = JSON.parse(localStorage.getItem(LEARN_FLAG_KEY) || '{}');
    return !!all[supplier.toLowerCase().trim()];
  } catch { return false; }
}
export function setLearnSupplierFlag(supplier: string, on: boolean) {
  if (!supplier) return;
  try {
    const all = JSON.parse(localStorage.getItem(LEARN_FLAG_KEY) || '{}');
    const key = supplier.toLowerCase().trim();
    if (on) all[key] = true; else delete all[key];
    localStorage.setItem(LEARN_FLAG_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

// ── Custom Instructions Component ──────────────────────────
import { getAllPresets, suggestPresetForSupplier, saveUserPreset, type InvoiceLogicPreset } from "@/lib/invoice-logic-presets";

const CustomInstructionsField = ({
  value, onChange, supplierName,
}: {
  value: string; onChange: (v: string) => void; supplierName: string;
}) => {
  const promptDialog = usePromptDialog();
  const [showHistory, setShowHistory] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [saveForSupplier, setSaveForSupplier] = useState(false);
  const [templateSupplier, setTemplateSupplier] = useState(supplierName);
  const [loadedTemplate, setLoadedTemplate] = useState<string | null>(null);
  const [suggestedPreset, setSuggestedPreset] = useState<InvoiceLogicPreset | null>(null);
  const history = getHistory();
  const allPresets = getAllPresets();

  // Auto-load saved template OR suggest a built-in preset when supplier changes
  useEffect(() => {
    setTemplateSupplier(supplierName);
    if (supplierName) {
      const templates = getTemplates();
      const match = templates[supplierName];
      // If we already have a saved template for this supplier, the learning
      // toggle should be ON by default so it stays in sync going forward.
      setSaveForSupplier(getLearnSupplierFlag(supplierName) || !!match);
      if (match && !value) {
        onChange(match.instructions);
        setLoadedTemplate(supplierName);
        setSuggestedPreset(null);
      } else if (!value) {
        // No saved template — try matching a built-in preset (e.g. Lula Soul)
        const preset = suggestPresetForSupplier(supplierName);
        setSuggestedPreset(preset);
      }
    } else {
      setSaveForSupplier(false);
    }
  }, [supplierName]);

  // When the user toggles the checkbox, persist immediately so the rest of
  // the pipeline (saveLayoutTemplate, future invoices) can honour it.
  const handleToggleSave = (on: boolean) => {
    setSaveForSupplier(on);
    const sup = (templateSupplier || supplierName).trim();
    if (!sup) {
      if (on) toast.info("Enter a supplier name to save these requirements.");
      return;
    }
    setLearnSupplierFlag(sup, on);
    if (on) {
      if (value.trim()) {
        saveTemplate(sup, value);
        toast.success(`Saved for future ${sup} invoices`, {
          description: "We'll auto-load these requirements next time.",
        });
      } else {
        toast.info(`Learning enabled for ${sup}`, {
          description: "Your requirements will be saved when you start processing.",
        });
      }
    } else {
      deleteTemplate(sup);
      toast(`Stopped learning for ${sup}`, { description: "Saved requirements removed." });
    }
  };

  const applyPreset = (p: InvoiceLogicPreset) => {
    onChange(p.instructions);
    setLoadedTemplate(p.name);
    setShowLibrary(false);
    setSuggestedPreset(null);
    toast.success(`Loaded "${p.name}"`, { description: "AI will follow these rules for this invoice." });
  };

  const saveCurrentAsPreset = async () => {
    if (!value.trim()) { toast.error("Write some instructions first"); return; }
    const name = await promptDialog({
      title: "Name this logic preset",
      label: "Preset name",
      defaultValue: supplierName || "My custom logic",
    });
    if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
    saveUserPreset({
      id, name,
      description: `Saved ${new Date().toLocaleDateString()}`,
      matches: supplierName ? [supplierName.toLowerCase()] : [],
      instructions: value,
      posTarget: "any",
    });
    toast.success(`Saved "${name}" to your Logic Library`);
  };

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

      {/* Suggested preset banner */}
      {suggestedPreset && !value && (
        <div className="bg-accent/10 border border-accent/30 rounded-md p-2.5 mb-2 flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium">✨ Matched preset: {suggestedPreset.name}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{suggestedPreset.description}</p>
          </div>
          <button onClick={() => applyPreset(suggestedPreset)} className="text-xs font-semibold text-primary hover:underline whitespace-nowrap">Use this →</button>
        </div>
      )}

      {/* Logic Library picker */}
      <div className="mb-2">
        <button onClick={() => setShowLibrary(!showLibrary)} className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
          <Settings className="w-3.5 h-3.5" />
          📚 Logic Library ({allPresets.length}) {showLibrary ? '▲' : '▼'}
        </button>
        {showLibrary && (
          <div className="mt-2 space-y-1.5 max-h-60 overflow-y-auto bg-muted/30 rounded-md p-2 border border-border">
            {allPresets.map(p => (
              <button key={p.id} onClick={() => applyPreset(p)}
                className="w-full text-left bg-card hover:bg-accent rounded-md px-3 py-2 border border-border transition-colors">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold">{p.name}</span>
                  {p.builtin && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">built-in</span>}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{p.description}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {loadedTemplate && (
        <div className="bg-primary/10 border border-primary/20 rounded-md p-2 mb-2 flex items-center justify-between">
          <p className="text-xs text-primary">💡 Loaded: {loadedTemplate}</p>
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

      {/* Save for supplier — controls supplier-brain template learning */}
      <div className="mt-3 rounded-md border border-border bg-muted/30 p-3">
        <label htmlFor="save-supplier" className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            id="save-supplier"
            checked={saveForSupplier}
            onChange={e => handleToggleSave(e.target.checked)}
            className="w-4 h-4 mt-0.5 rounded border-border accent-primary cursor-pointer"
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-foreground">
              Remember these requirements for future invoices from this supplier
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              When on, the supplier brain learns these instructions and auto-applies them next time.
              When off, no template is saved or updated.
            </p>
          </div>
        </label>
        {saveForSupplier && (
          <input
            value={templateSupplier}
            onChange={e => setTemplateSupplier(e.target.value)}
            onBlur={() => {
              // Persist flag against the latest typed supplier name too.
              if (templateSupplier.trim()) setLearnSupplierFlag(templateSupplier, true);
            }}
            placeholder="Supplier name"
            className="w-full h-9 rounded-md bg-input border border-border px-3 text-xs mt-2"
          />
        )}
        <div className="flex justify-end mt-2">
          <button onClick={saveCurrentAsPreset} className="text-xs font-medium text-primary hover:underline flex items-center gap-1">
            <Save className="w-3 h-3" /> Save as reusable preset instead
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Match Source Badge ──────────────────────────────────────
const MatchSourceBadge = ({ source, barcode }: { source: MatchSource; barcode?: string }) => {
  const config: Record<MatchSource, { icon: string; label: string; cls: string }> = {
    barcode: { icon: "🔵", label: "Barcode match", cls: "bg-primary/15 text-primary border-primary/20" },
    sku: { icon: "🟢", label: "SKU match", cls: "bg-success/15 text-success border-success/20" },
    name: { icon: "🟡", label: "Name match", cls: "bg-warning/15 text-warning border-warning/20" },
    none: { icon: "🔴", label: "No match", cls: "bg-destructive/15 text-destructive border-destructive/20" },
  };
  const c = config[source];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium border ${c.cls}`} title={barcode ? `Barcode: ${barcode}` : undefined}>
      {c.icon} {c.label}
    </span>
  );
};

const InvoiceFlow = ({ onBack, onNavigate }: InvoiceFlowProps) => {
  const [step, setStep] = useState<Step>(1);
  const [showDetails, setShowDetails] = useState(false);
  const [fileName, setFileName] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [supplierName, setSupplierName] = useState("");
  // Initial export format honours the Phase 1 POS choice
  // (set in PhaseFlowHome → localStorage "preferred_pos").
  const [exportFormat, setExportFormat] = useState<'shopify' | 'lightspeed_x' | 'xlsx'>(() => {
    const pos = typeof window !== 'undefined' ? localStorage.getItem('preferred_pos') : null;
    return pos === 'lightspeed' ? 'lightspeed_x' : 'shopify';
  });
  const [showLsSettings, setShowLsSettings] = useState(false);
  const [lsSettings, setLsSettings] = useState<XSeriesSettings>(getXSeriesSettings);
  const [previewProduct, setPreviewProduct] = useState<any>(null);
  const [previewAll, setPreviewAll] = useState(false);
  const [previewIdx, setPreviewIdx] = useState(0);
  const mode = useStoreMode();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  // Watchdog Agent hand-off — picks up a stashed run so the review screen can
  // render the (currently disabled) "Auto-publish to Shopify" button.
  // Also captures any products that were extracted by the agent so we can
  // pre-load them into the Review screen and skip the Upload step.
  const watchdogPayloadRef = useRef<{ products: any[]; supplierName: string | null } | null>(null);
  const [watchdogRun] = useState<{ runId: string; autoPublishEligible: boolean } | null>(() => {
    try {
      const raw = sessionStorage.getItem("sonic_watchdog_run");
      if (!raw) return null;
      sessionStorage.removeItem("sonic_watchdog_run");
      const parsed = JSON.parse(raw);
      if (!parsed?.run_id) return null;
      watchdogPayloadRef.current = {
        products: Array.isArray(parsed.products) ? parsed.products : [],
        supplierName: parsed.supplier_name ?? null,
      };
      console.log("[Watchdog] InvoiceFlow loaded run:", parsed.run_id, `products=${watchdogPayloadRef.current.products.length}`);
      return { runId: parsed.run_id, autoPublishEligible: !!parsed.auto_publish_eligible };
    } catch { return null; }
  });

  // OCR / file type detection state
  type FileParseMode = "pdf_text" | "pdf_scan" | "photo" | "spreadsheet" | "email";
  const [fileParseMode, setFileParseMode] = useState<FileParseMode | null>(null);
  const [showLowQualityWarning, setShowLowQualityWarning] = useState(false);
  const [preprocessResult, setPreprocessResult] = useState<PreprocessResult | null>(null);
  const [showPreprocessDebug, setShowPreprocessDebug] = useState(false);

  // Location state
  const storeLocations = getStoreLocations();
  const defaultLoc = storeLocations.find(l => l.isDefault) || storeLocations[0];
  const [receivingLocation, setReceivingLocation] = useState(defaultLoc?.id || "");

  // Template recognition state
  const [matchedTemplate, setMatchedTemplate] = useState<InvoiceTemplate | null>(null);
  const [useTemplate, setUseTemplate] = useState<boolean | null>(null);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [savedTemplate, setSavedTemplate] = useState(false);
  const [processAs, setProcessAs] = useState<ProcessAsMode>("auto");
  const [detectedLayout, setDetectedLayout] = useState<LayoutType | null>(null);

  // Supplier dropdown & DB template state
  const [supplierList, setSupplierList] = useState<string[]>([]);
  const [dbTemplate, setDbTemplate] = useState<DBSupplierTemplate | null>(null);
  const [showTeachModal, setShowTeachModal] = useState(false);
  const [detectedHeaders, setDetectedHeaders] = useState<string[]>([]);
  const [aiFieldConfidence, setAiFieldConfidence] = useState<Record<string, number> | null>(null);
  const [aiExtractionNotes, setAiExtractionNotes] = useState<string | null>(null);
  // Per-product Qty header validator warnings from parse-invoice. Drives the
  // yellow banner + per-row flag on the review screen (Round 4 Walnut fix).
  const [qtyHeaderWarnings, setQtyHeaderWarnings] = useState<Array<{
    invoice_number: string;
    product_title: string;
    colour: string;
    extracted_rows: number;
    header_qty: number;
    message: string;
  }>>([]);
  const [layoutFingerprint, setLayoutFingerprint] = useState<string | null>(null);
  const [fingerprintHit, setFingerprintHit] = useState<FingerprintHit | null>(null);
  const [matchMethod, setMatchMethod] = useState<InvoiceMatchMethod>("full_extraction");

  // ── Processing quality tracking ───────────────────────────
  const [invoiceReviewStartedAt, setInvoiceReviewStartedAt] = useState<number | null>(null);
  const editCountRef = useRef(0);
  const fieldsCorrectedRef = useRef<Set<string>>(new Set());
  const rowsDeletedRef = useRef(0);
  const rowsAddedRef = useRef(0);
  const lastRowCountRef = useRef<number | null>(null);
  const qualityRecordedRef = useRef(false);

  const beginReviewTimer = () => {
    setInvoiceReviewStartedAt(Date.now());
    editCountRef.current = 0;
    fieldsCorrectedRef.current = new Set();
    rowsDeletedRef.current = 0;
    rowsAddedRef.current = 0;
    lastRowCountRef.current = null;
    qualityRecordedRef.current = false;
  };

  const finalizeQualityMetrics = () => {
    if (qualityRecordedRef.current) return;
    qualityRecordedRef.current = true;
    recordProcessingQuality({
      reviewStartedAt: invoiceReviewStartedAt,
      exportedAt: Date.now(),
      editCount: editCountRef.current,
      fieldsCorrected: Array.from(fieldsCorrectedRef.current),
      rowsDeleted: rowsDeletedRef.current,
      rowsAdded: rowsAddedRef.current,
      layoutFingerprint:
        layoutFingerprint || (detectedHeaders.length ? generateLayoutFingerprint(detectedHeaders) : null),
    });
  };

  /**
   * Persist the confirmed invoice to the documents/document_lines tables
   * and update the matched supplier's spend metrics. Runs once per invoice
   * after the user accepts extraction. Best-effort — failures are logged
   * but do not block the export flow.
   */
  const persistedRef = useRef(false);
  const persistInvoiceToDb = async () => {
    if (persistedRef.current) return;
    persistedRef.current = true;
    console.log("[Phase2] persistInvoiceToDb called");
    const savingToastId = toast.loading("Saving to catalog…", {
      description: "Adding extracted products to your inventory.",
    });
    try {
      const accepted = validatedProducts.filter(p => !p._rejected);
      if (accepted.length === 0) {
        console.warn("[Phase2] no rows");
        toast.dismiss(savingToastId);
        return;
      }
      console.log("[Phase2] writing", accepted.length, "rows");
      const subtotal = accepted.reduce((s, p) => s + (p.cost || 0) * (p.qty || 0), 0);
      const total = subtotal;
      const today = new Date().toISOString().slice(0, 10);
      const { error } = await persistParsedInvoice(
        {
          supplier: supplierName || "Unknown",
          invoiceNumber: "",
          invoiceDate: today,
          currency: "AUD",
          subtotal,
          gst: null,
          total,
          documentType: "invoice",
          filename: fileName || undefined,
        },
        validatedProducts,
      );
      if (error) {
        console.warn("[Phase2] caught:", error);
        toast.error("Catalog save failed", { id: savingToastId, description: error });
      } else {
        console.log("[Phase2] done:", accepted.length);
        const variantCount = accepted.length;
        toast.success(`✅ ${variantCount} ${variantCount === 1 ? "variant" : "variants"} saved to catalog`, {
          id: savingToastId,
          description: "Price Adjustment, Margin Protection, and Markdown Ladder can now use these products.",
        });
      }
    } catch (e: any) {
      console.log('[SONIC-DEBUG] Invoice processing error', e);
      console.warn("[Phase2] caught:", e?.message || "Unknown error");
      toast.error("Catalog save failed", { id: savingToastId, description: e?.message || "Unknown error" });
    }
  };

  const syncPhase2Catalog = async (products: ValidatedProduct[], source: "parse" | "reprocess") => {
    console.log('[SONIC-DEBUG] Invoice processing insertion point reached', { timestamp: new Date().toISOString() });
    const accepted = products.filter((p) => !p._rejected);
    if (accepted.length === 0) {
      console.warn(`[Phase2] no rows from ${source}`);
      return;
    }

    const savingToastId = toast.loading("Saving to catalog…", {
      description: "Adding extracted products to your inventory.",
    });

    try {
      console.log("[Phase2] writing", accepted.length, "rows from", source);
      console.log("[InvoiceFlow] 🔄 Reached catalog sync insertion point — calling syncInvoiceItemsToCatalog with", accepted.length, "items");
      const result = await syncInvoiceItemsToCatalog(
        accepted.map((item) => {
          // Per-line brand detection by SKU prefix (e.g. JA→Jantzen, SS→Sunseeker,
          // OB→Olga Berg). Critical for multi-brand invoices billed under an
          // umbrella vendor like Skye Group, where the cover-page vendor is
          // meaningless for individual line lookups.
          const skuBrand = detectBrandFromSku(item.sku);
          return {
            product_title: item.name || "Untitled",
            vendor: skuBrand || item.brand || supplierName || undefined,
            sku: item.sku || undefined,
            barcode: (item as any).barcode || undefined,
            colour: item.colour || undefined,
            size: item.size || undefined,
            unit_cost: Number(item.cost) || 0,
            rrp: Number(item.rrp) || 0,
            qty: Number(item.qty) || 0,
          };
        }),
      );

      if (result.written > 0) {
        toast.success(`✅ ${result.written} ${result.written === 1 ? "variant" : "variants"} saved to catalog`, {
          id: savingToastId,
          description: "Price Adjustment, Margin Protection, and Markdown Ladder can now use these products.",
        });
      } else {
        toast.dismiss(savingToastId);
      }

      if (result.failed > 0) {
        console.warn("[Phase2] catalog sync failures:", result.errors);
        toast.warning(`${result.failed} product${result.failed === 1 ? "" : "s"} could not be saved`, {
          description: result.errors.slice(0, 2).join(" · ") || "Please retry after review.",
        });
      }

      console.log("[Phase2] done:", result.written, "written,", result.failed, "failed");

      // ── Phase 3 — auto price research ──────────────────────
      if (accepted.length > 0) {
        const phase3Items: Phase3Item[] = accepted.map((item) => {
          const skuBrand = detectBrandFromSku(item.sku);
          return {
            product_title: item.name || "Untitled",
            vendor: skuBrand || item.brand || supplierName || undefined,
            sku: item.sku || undefined,
            barcode: (item as any).barcode || undefined,
            unit_cost: Number(item.cost) || 0,
            rrp: Number(item.rrp) || 0,
            product_type: (item as any).product_type || (item as any).type || undefined,
          };
        });
        const phase3Toast = toast.loading(`🔍 Researching prices for ${phase3Items.length} products…`, {
          description: "Checking supplier sites, retailers, and applying markup rules.",
        });
        try {
          const summary = await runPhase3PriceResearch(phase3Items, {
            onProgress: (done, total) => {
              toast.loading(`🔍 Researching prices… ${done}/${total}`, { id: phase3Toast });
            },
          });
          // Write researched RRPs back into in-memory products so the Shopify
          // Preview / export step pick them up. Phase3 runs with worker
          // concurrency — summary.results is in COMPLETION order, NOT input
          // order. Match each result back to its input item by carried
          // product_title + vendor; index-based mapping causes price swaps.
          const rrpByTitle = new Map<string, number>();
          const rrpBySku = new Map<string, number>();
          const norm = (s: string) => (s || "").toLowerCase().trim();
          summary.results.forEach((r) => {
            if (!r?.recommended_rrp || r.recommended_rrp <= 0) return;
            const title = norm(r.product_title || "");
            if (title) rrpByTitle.set(title, r.recommended_rrp);
            const matchedItem =
              phase3Items.find(
                (it) => norm(it.product_title) === title && norm(it.vendor || "") === norm(r.vendor || ""),
              ) || phase3Items.find((it) => norm(it.product_title) === title);
            const sku = norm(matchedItem?.sku || "");
            if (sku) rrpBySku.set(sku, r.recommended_rrp);
          });
          const lookupRrp = (name?: string, sku?: string): number | undefined => {
            const bySku = sku ? rrpBySku.get(norm(sku)) : undefined;
            if (bySku) return bySku;
            const t = norm(name || "");
            if (rrpByTitle.has(t)) return rrpByTitle.get(t);
            // fuzzy: productGroups name may be "Brand Title" — try suffix match
            for (const [key, val] of rrpByTitle) {
              if (key && (t.endsWith(key) || t.includes(key))) return val;
            }
            return undefined;
          };
          if (rrpByTitle.size > 0 || rrpBySku.size > 0) {
            // PRICE PRIORITY: the CSV/invoice RRP is the source of truth — it is
            // what the retailer agreed to pay. The researched "market price" is
            // supplementary info only. Only overwrite when the CSV had no RRP.
            // The market price is always carried as _marketPrice so the UI can
            // show it as a "Market: $X" badge below the main price.
            setValidatedProducts((prev) =>
              prev.map((p) => {
                const marketRrp = lookupRrp(p.name, p.sku);
                if (!marketRrp) return p;
                const hasCsvRrp = (p.rrp || 0) > 0;
                return {
                  ...p,
                  rrp: hasCsvRrp ? p.rrp : marketRrp,
                  _marketPrice: marketRrp,
                } as ValidatedProduct;
              }),
            );
            setProductGroups((prev) =>
              prev.map((g) => {
                const marketRrp = lookupRrp(g.name, g.variants?.[0]?.sku || g.vendorCode);
                if (!marketRrp) return g;
                const hasCsvRrp = (g.rrp || 0) > 0;
                const finalRrp = hasCsvRrp ? g.rrp : marketRrp;
                return {
                  ...g,
                  rrp: finalRrp,
                  _marketPrice: marketRrp,
                  variants: g.variants?.map((v) => ({
                    ...v,
                    rrp: (v.rrp || 0) > 0 ? v.rrp : marketRrp,
                  })),
                } as typeof g;
              }),
            );
          }
          const breakdown = Object.entries(summary.bySource)
            .map(([k, v]) => `${v} ${k.replace("_", " ")}`)
            .join(" · ");
          toast.success(`💰 Price research complete: ${summary.succeeded}/${summary.total} · RRPs applied`, {
            id: phase3Toast,
            description: breakdown || "Recommended RRPs applied to products.",
          });
          console.log("[Phase3] summary:", summary);
        } catch (e: any) {
          console.warn("[Phase3] orchestrator failed:", e);
          toast.error("Price research failed", { id: phase3Toast, description: e?.message || "Unknown error" });
        }
      }
    } catch (e: any) {
      console.log('[SONIC-DEBUG] Invoice processing error', e);
      console.warn("[Phase2] caught:", e?.message || "Unknown error");
      toast.error("Catalog save failed", { id: savingToastId, description: e?.message || "Unknown error" });
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from("suppliers").select("name").order("name");
        if (data) setSupplierList(data.map((s: any) => s.name));
      } catch {}
    })();
  }, []);

  // Check for DB template when supplier changes
  useEffect(() => {
    if (!supplierName.trim()) { setDbTemplate(null); return; }
    (async () => {
      try {
        const { data } = await supabase
          .from("supplier_templates" as any)
          .select("*")
          .eq("supplier_name", supplierName.trim())
          .limit(1);
        if (data && data.length > 0) {
          setDbTemplate(data[0] as any);
        } else {
          setDbTemplate(null);
        }
      } catch { setDbTemplate(null); }
    })();
  }, [supplierName]);

  // Processing timer state
  const [processStartTime, setProcessStartTime] = useState<number | null>(null);
  const [processingElapsed, setProcessingElapsed] = useState(0);
  const [processingDone, setProcessingDone] = useState(false);
  const [finalProcessingTime, setFinalProcessingTime] = useState(0);
  const [showSpeedTips, setShowSpeedTips] = useState(false);
  const [processingCancelled, setProcessingCancelled] = useState(false);
  const [showCompletionSummary, setShowCompletionSummary] = useState(false);
  const [filterReviewOnly, setFilterReviewOnly] = useState(false);
  const [confidenceFilter, setConfidenceFilter] = useState<"all" | "high" | "medium" | "low">("all");

  // Line-by-line enrichment status
  type LineStatus = "waiting" | "searching" | "extracting" | "done" | "review" | "not_found";
  interface EnrichLine {
    name: string;
    status: LineStatus;
    action: string;
    confidence: number;
  }
  const [enrichLines, setEnrichLines] = useState<EnrichLine[]>([]);

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

  // Enrichment simulation that uses real parsed product names
  const actionSequence = [
    "Extracting description...",
    "Finding image URL...",
    "Generating SEO title...",
    "Building tags...",
    "Done ✓",
  ];

  const runEnrichmentSim = (cancelled: { current: boolean }, names: string[]) => {
    if (names.length === 0) {
      const startTs = processStartTime || Date.now();
      const durationSec = Math.max(1, Math.floor((Date.now() - startTs) / 1000));
      setProcessingDone(true);
      setFinalProcessingTime(durationSec);
      setShowCompletionSummary(true);
      return;
    }
    const lines: EnrichLine[] = names.map(name => ({
      name, status: "waiting" as LineStatus, action: "○ Waiting", confidence: 0,
    }));
    setEnrichLines([...lines]);

    let lineIdx = 0;
    const processNextLine = () => {
      if (cancelled.current || lineIdx >= lines.length) {
        if (!cancelled.current) {
          const startTs = processStartTime || Date.now();
          const endTs = Date.now();
          const durationSec = Math.max(1, Math.floor((endTs - startTs) / 1000));
          setProcessingDone(true);
          setFinalProcessingTime(durationSec);
          setShowCompletionSummary(true);
          // Persist real processing duration for Processing History (#5, #12)
          recordProcessingDuration({
            startedAt: startTs,
            completedAt: endTs,
            rowsSeen: lines.length,
            variantsExtracted: lines.length,
          });
          const history = JSON.parse(localStorage.getItem("processing_history") || "[]");
          history.unshift({
            supplier: supplierName || "Unknown",
            lines: lines.length,
            processingTime: durationSec,
            matchRate: Math.round((lines.filter(l => l.status === "done").length / lines.length) * 100),
            date: new Date().toISOString(),
          });
          localStorage.setItem("processing_history", JSON.stringify(history.slice(0, 100)));
        }
        return;
      }
      const i = lineIdx;
      let actionIdx = 0;
      const brandGuess = names[i].split(" ")[0]?.toLowerCase() || "supplier";
      lines[i] = { ...lines[i], status: "searching", action: `Searching ${brandGuess}.com.au...` };
      setEnrichLines([...lines]);

      const stepAction = () => {
        if (cancelled.current) return;
        actionIdx++;
        if (actionIdx < actionSequence.length - 1) {
          lines[i] = { ...lines[i], status: "extracting", action: actionSequence[actionIdx] };
          setEnrichLines([...lines]);
          setTimeout(stepAction, 200 + Math.random() * 300);
        } else {
          const finalStatus: LineStatus = Math.random() > 0.85 ? "review" : "done";
          lines[i] = { ...lines[i], status: finalStatus, action: "Done ✓", confidence: finalStatus === "review" ? 72 : 95 };
          setEnrichLines([...lines]);
          lineIdx++;
          setTimeout(processNextLine, 150);
        }
      };
      setTimeout(stepAction, 300 + Math.random() * 400);
    };
    processNextLine();
  };

  const cancelledRef = { current: false };
  const [parsedNames, setParsedNames] = useState<string[]>([]);

  const [posPickerOpen, setPOSPickerOpen] = useState(false);
  const pendingUploadKindRef = useRef<"file" | "camera" | null>(null);

  const handleFileSelect = () => {
    if (!hasPickedPOS()) {
      pendingUploadKindRef.current = "file";
      setPOSPickerOpen(true);
      return;
    }
    fileInputRef.current?.click();
  };

  const handleCameraSelect = () => {
    if (!hasPickedPOS()) {
      pendingUploadKindRef.current = "camera";
      setPOSPickerOpen(true);
      return;
    }
    cameraInputRef.current?.click();
  };

  const handlePOSPicked = () => {
    const kind = pendingUploadKindRef.current;
    pendingUploadKindRef.current = null;
    setTimeout(() => {
      if (kind === "camera") cameraInputRef.current?.click();
      else fileInputRef.current?.click();
    }, 100);
  };

  const [originalFileMeta, setOriginalFileMeta] = useState<{
    path: string; mime: string; name: string;
  } | null>(null);

  // ── Shared file-accept routine — used by picker, drag-drop, and paste ──
  const ACCEPTED_EXT = /\.(pdf|xlsx|xls|csv|doc|docx|jpe?g|png|heic|webp)$/i;
  const isAcceptedFile = (file: File) =>
    ACCEPTED_EXT.test(file.name) ||
    /^(application\/pdf|image\/|application\/vnd\.|text\/csv|application\/msword)/.test(file.type);

  const acceptInvoiceFile = (file: File) => {
    if (!isAcceptedFile(file)) {
      toast.error("Unsupported file type", {
        description: "Please upload a PDF, Excel, CSV, Word, or image file.",
      });
      return;
    }
    setUploadedFile(file);
    setFileName(file.name);
    toast("Invoice uploaded", { description: "Add any custom requirements below, then start processing." });
    void uploadOriginalToStorage(file);
    setTimeout(() => {
      document.getElementById("custom-requirements-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  };

  // Local multi-file queue — mirrors the Drive queue pattern. When the user drops or
  // picks N files at once, we load file 1 immediately and queue the rest. Each file
  // becomes its own history entry because acceptInvoiceFile triggers the normal
  // single-file flow (uploadOriginalToStorage + processing), and once the user
  // finishes review (uploadedFile is cleared) the next queued file auto-loads.
  // Failed items keep their "failed" status with a reason — the queue still
  // advances so the rest of the batch processes, and the user can see what broke.
  type LocalQueueItem = {
    file: File;
    status: "queued" | "processing" | "done" | "failed";
    errorMessage?: string;
  };
  const [localQueue, setLocalQueue] = useState<LocalQueueItem[]>([]);

  /** Try to load a file; if anything throws synchronously, mark the current
   *  batch entry as failed with the reason and let the queue continue. */
  const safeAcceptInvoiceFile = (file: File): { ok: boolean; reason: string } => {
    try {
      acceptInvoiceFile(file);
      return { ok: true, reason: "" };
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown error while loading file";
      console.warn("[Batch] failed to load file:", file.name, err);
      toast.error(`Couldn't load ${file.name}`, { description: reason });
      return { ok: false, reason };
    }
  };

  /** Accept a list of dropped/picked files. Loads the first, queues the rest. */
  const acceptInvoiceFiles = (files: File[]) => {
    const valid = files.filter(isAcceptedFile);
    const rejected = files.length - valid.length;
    if (rejected > 0) {
      toast.error(`${rejected} file${rejected === 1 ? "" : "s"} skipped`, {
        description: "Only PDF, Excel, CSV, Word, and image files are supported.",
      });
    }
    if (valid.length === 0) return;
    if (valid.length === 1) {
      safeAcceptInvoiceFile(valid[0]);
      return;
    }
    const [first, ...rest] = valid;
    const firstResult = safeAcceptInvoiceFile(first);
    let firstEntry: LocalQueueItem;
    if (firstResult.ok) {
      firstEntry = { file: first, status: "processing" };
    } else {
      firstEntry = { file: first, status: "failed", errorMessage: firstResult.reason };
    }
    setLocalQueue([
      firstEntry,
      ...rest.map<LocalQueueItem>((f) => ({ file: f, status: "queued" })),
    ]);
    toast(`Queued ${valid.length} invoices`, {
      description: "Each file becomes its own history entry. Failed files are flagged and skipped so the rest still process.",
    });
  };

  /** Mark the file currently being reviewed as failed and advance to the next.
   *  Triggered from the batch panel when the user hits "Skip & continue". */
  const skipCurrentBatchFile = (reason: string) => {
    setLocalQueue((prev) =>
      prev.map((q) =>
        q.status === "processing"
          ? { ...q, status: "failed" as const, errorMessage: reason }
          : q,
      ),
    );
    // Clearing the upload triggers the auto-advance effect below.
    setUploadedFile(null);
    setFileName("");
  };

  // Auto-advance the local queue when the current upload is cleared (review accepted/restarted).
  // Failed entries keep their status + reason so the user can see what broke.
  useEffect(() => {
    if (uploadedFile) return;
    setLocalQueue((prev) => {
      if (prev.length === 0) return prev;
      const advanced = prev.map((q) =>
        q.status === "processing" ? { ...q, status: "done" as const } : q,
      );
      const nextIdx = advanced.findIndex((q) => q.status === "queued");
      if (nextIdx === -1) {
        // Whole batch finished. If anything failed, keep the panel visible so the
        // user can see which files need attention; otherwise clear it.
        const anyFailed = advanced.some((q) => q.status === "failed");
        return anyFailed ? advanced : [];
      }
      const next = advanced[nextIdx];
      queueMicrotask(() => {
        const result = safeAcceptInvoiceFile(next.file);
        if (result.ok === true) return;
        const reason = result.reason;
        // Mark this item failed and re-trigger the effect by leaving uploadedFile null.
        setLocalQueue((curr) =>
          curr.map((q, i) =>
            i === nextIdx
              ? { ...q, status: "failed" as const, errorMessage: reason }
              : q,
          ),
        );
      });
      return advanced.map((q, i) => (i === nextIdx ? { ...q, status: "processing" } : q));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadedFile]);

  const handleFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    acceptInvoiceFiles(files);
    e.target.value = "";
  };

  // Drag-and-drop state — split into:
  //   isWindowDragging → any file is being dragged anywhere over the window (shows overlay)
  //   isDragOverTarget → the cursor is currently over the highlighted drop target
  const [isDragOver, setIsDragOver] = useState(false); // legacy, kept for the inline button highlight
  const [isWindowDragging, setIsWindowDragging] = useState(false);
  const [isDragOverTarget, setIsDragOverTarget] = useState(false);
  const dragDepthRef = useRef(0);
  const windowDragDepthRef = useRef(0);

  // Window-level listeners: detect when a file is dragged anywhere onto the page
  // so we can show a full-screen overlay with a clearly highlighted drop target.
  useEffect(() => {
    if (step !== 1) return;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types?.includes("Files");

    const onWindowDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      windowDragDepthRef.current += 1;
      setIsWindowDragging(true);
    };
    const onWindowDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // required for drop to fire
    };
    const onWindowDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      windowDragDepthRef.current = Math.max(0, windowDragDepthRef.current - 1);
      if (windowDragDepthRef.current === 0) {
        setIsWindowDragging(false);
        setIsDragOverTarget(false);
      }
    };
    const onWindowDrop = (e: DragEvent) => {
      // If the user drops outside our target, swallow it so the browser doesn't navigate to the file.
      if (!hasFiles(e)) return;
      e.preventDefault();
      windowDragDepthRef.current = 0;
      setIsWindowDragging(false);
      setIsDragOverTarget(false);
    };

    window.addEventListener("dragenter", onWindowDragEnter);
    window.addEventListener("dragover", onWindowDragOver);
    window.addEventListener("dragleave", onWindowDragLeave);
    window.addEventListener("drop", onWindowDrop);
    return () => {
      window.removeEventListener("dragenter", onWindowDragEnter);
      window.removeEventListener("dragover", onWindowDragOver);
      window.removeEventListener("dragleave", onWindowDragLeave);
      window.removeEventListener("drop", onWindowDrop);
      windowDragDepthRef.current = 0;
      setIsWindowDragging(false);
      setIsDragOverTarget(false);
    };
  }, [step]);

  // Esc cancels an in-progress drag overlay
  useEffect(() => {
    if (!isWindowDragging) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        windowDragDepthRef.current = 0;
        dragDepthRef.current = 0;
        setIsWindowDragging(false);
        setIsDragOverTarget(false);
        setIsDragOver(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isWindowDragging]);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.dataTransfer?.types?.includes("Files")) return;
    dragDepthRef.current += 1;
    setIsDragOver(true);
    setIsDragOverTarget(true);
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragOver(false);
      setIsDragOverTarget(false);
    }
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    windowDragDepthRef.current = 0;
    setIsDragOver(false);
    setIsWindowDragging(false);
    setIsDragOverTarget(false);
    if (!hasPickedPOS()) {
      pendingUploadKindRef.current = "file";
      setPOSPickerOpen(true);
      toast("Pick your POS first", { description: "Choose Shopify or Lightspeed, then drop the file again." });
      return;
    }
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) {
      toast.error("No file detected", { description: "Try dragging a PDF, Excel, CSV, or image file." });
      return;
    }
    acceptInvoiceFiles(files);
  };

  // Paste handler — accept clipboard images / files (Cmd/Ctrl+V on the dropzone)
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          if (!hasPickedPOS()) {
            pendingUploadKindRef.current = "file";
            setPOSPickerOpen(true);
            toast("Pick your POS first", { description: "Choose Shopify or Lightspeed, then paste again." });
            return;
          }
          acceptInvoiceFile(file);
          return;
        }
      }
    }
  };

  const [driveImportOpen, setDriveImportOpen] = useState(false);
  const [driveImportUrl, setDriveImportUrl] = useState("");
  const [driveImporting, setDriveImporting] = useState(false);
  // 2-step Drive flow: "link" → paste URL; "confirm" → see file list + enqueue
  const [driveStage, setDriveStage] = useState<"link" | "confirm">("link");
  const [drivePreview, setDrivePreview] = useState<{ id: string; name: string; mimeType: string }[]>([]);

  // Step 1 — paste folder/file link, list files via drive-list (no download).
  const handleDriveListFiles = async () => {
    if (!driveImportUrl.trim()) {
      toast.error("Paste a Google Drive folder or file link first");
      return;
    }
    setDriveImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("drive-list", {
        body: { url: driveImportUrl.trim() },
      });
      if (error) throw error;
      const files = (data?.files || []) as { id: string; name: string; mimeType: string }[];
      if (files.length === 0) {
        toast.error("No files found", { description: "Make sure the folder is shared as 'Anyone with the link'." });
        return;
      }
      setDrivePreview(files);
      setDriveStage("confirm");
    } catch (e) {
      toast.error("Drive import failed", {
        description: e instanceof Error ? e.message : "Could not access the Drive link",
      });
    } finally {
      setDriveImporting(false);
    }
  };

  // Step 2 — confirm: enqueue the whole batch server-side. The drive-worker
  // (run every 30s by pg_cron) downloads each file, uploads to storage, and
  // saves a stub invoice_patterns row marked 'pending_review'. The user sees
  // live progress in <DriveQueuePanel /> below the upload area.
  const handleDriveConfirmAutoProcess = async () => {
    if (drivePreview.length === 0) return;
    setDriveImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("enqueue-drive-batch", {
        body: { url: driveImportUrl.trim() },
      });
      if (error) throw error;
      const queued = data?.queued ?? drivePreview.length;
      toast.success(`Queued ${queued} invoice${queued === 1 ? "" : "s"}`, {
        description: "Files are downloading in the background. You can navigate away — we'll keep working.",
      });
      setDriveImportOpen(false);
      setDriveStage("link");
      setDrivePreview([]);
      setDriveImportUrl("");
    } catch (e) {
      toast.error("Could not queue Drive batch", {
        description: e instanceof Error ? e.message : "Try again in a moment",
      });
    } finally {
      setDriveImporting(false);
    }
  };


  const handleStartProcessingClick = () => {
    if (!uploadedFile) {
      toast.error("Please upload an invoice first");
      return;
    }
    startProcessing(uploadedFile);
  };

  /**
   * Fire-and-forget upload of the original invoice file to the
   * `invoice-originals` bucket so it can be re-processed later from
   * the History screen using improved supplier rules.
   */
  const uploadOriginalToStorage = async (file: File) => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id;
      if (!userId) return;
      const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
      const path = `${userId}/${Date.now()}-${safeName}`;
      const { error } = await supabase.storage
        .from("invoice-originals")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) {
        console.warn("[InvoiceFlow] Original upload failed (non-fatal):", error);
        return;
      }
      setOriginalFileMeta({ path, mime: file.type || "application/octet-stream", name: file.name });
    } catch (err) {
      console.warn("[InvoiceFlow] Original upload threw (non-fatal):", err);
    }
  };


  const convertToProductGroups = (products: Array<{ name: string; brand: string; sku: string; barcode: string; type: string; colour: string; size: string; qty: number; cost: number; rrp: number }>) => {
    // Group variant rows into Shopify-ready products by matching style code + product name
    // Group across BOTH colours and sizes so one Shopify product has all its variants
    const groupMap = new Map<string, typeof products>();
    for (const p of products) {
      // Strip trailing size/colour suffixes from SKU to find the base style code
      const baseSku = (p.sku || "").replace(/[-_]?(XXS|XS|S|M|L|XL|XXL|2XL|3XL|OS|\d{1,2})$/i, "").replace(/[-_]?(BLK|BK|NVY|NY|WHT|WH|OLI|CRE|GRY|GY|RED|PNK|BRN|BLU)$/i, "").toLowerCase().trim();
      const baseName = (p.name || "").toLowerCase().trim();
      // Key by style code OR name — do NOT include colour so variants group together
      const key = baseSku || baseName;
      if (!key) continue;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(p);
    }

    const groups: ProductGroup[] = [];
    for (const [, items] of groupMap) {
      const first = items[0];
      const result = matchProduct(first.barcode || "", first.sku || "", first.name || "");
      
      const uniqueColours = new Set(items.map(i => (i.colour || "").toLowerCase()).filter(Boolean));
      const uniqueSizes = new Set(items.map(i => (i.size || "").toLowerCase()).filter(Boolean));
      const hasMultipleColours = uniqueColours.size > 1;
      const hasSize = uniqueSizes.size > 0 && !uniqueSizes.has("one size");

      // W-05 — Keep `name` brand-free. Brand lives in its own column (Shopify
      // Vendor / Lightspeed brand_name) and gets recombined at export time
      // when the user's name format demands it. Prepending the brand here
      // caused "Walnut Melbourne MARRAKESH DRESS" to leak into the CSV's
      // name column even after stripBrandPrefix ran downstream (the brand
      // had already been concatenated into the AI-extracted name itself).
      const displayName = (first.name || "Unnamed Product").trim();

      // Deduplicate identical variant rows (same colour + size), summing quantities
      const variantMap = new Map<string, { sku: string; colour: string; size: string; qty: number; price: number; rrp: number }>();
      for (const p of items) {
        const vKey = `${(p.colour || "").toLowerCase()}::${(p.size || "").toLowerCase()}`;
        const existing = variantMap.get(vKey);
        if (existing) {
          existing.qty += p.qty || 0;
        } else {
          variantMap.set(vKey, {
            sku: p.sku || "",
            colour: p.colour || "",
            size: p.size || "One Size",
            qty: p.qty || 1,
            price: p.cost || 0,
            rrp: p.rrp || 0,
          });
        }
      }
      const dedupedVariants = Array.from(variantMap.values());

      groups.push({
        styleGroup: first.sku || null as any,
        name: displayName,
        // Prefer the user-entered supplierName over AI-extracted brand if supplier was set explicitly,
        // and never fall back to literal "Unknown" — leave blank so it doesn't pollute product titles.
        brand: (supplierName?.trim() || first.brand || "").trim(),
        type: first.type || "General",
        colour: hasMultipleColours ? "" : (first.colour || ""),
        size: dedupedVariants.length === 1 ? (dedupedVariants[0].size || "") : "",
        price: first.cost || 0,
        rrp: first.rrp || 0,
        cogs: first.cost || 0,
        status: (first.cost > 0 && first.name) ? "ready" : "review",
        metafields: {},
        isGrouped: dedupedVariants.length > 1,
        barcode: first.barcode || "",
        vendorCode: first.sku || "",
        matchSource: result.source,
        variants: dedupedVariants.map(v => ({
          sku: v.sku,
          option1Name: hasSize ? "Size" : (hasMultipleColours ? "Colour" : "Size"),
          option1Value: hasSize ? v.size : (hasMultipleColours ? v.colour : (v.size || "One Size")),
          option2Name: hasSize && hasMultipleColours ? "Colour" : "",
          option2Value: hasSize && hasMultipleColours ? v.colour : "",
          qty: v.qty,
          price: v.price,
          rrp: v.rrp,
        })),
      });
    }
    return groups;
  };

  const parseSpreadsheet = (file: File): Promise<Array<{ name: string; brand: string; sku: string; barcode: string; type: string; colour: string; size: string; qty: number; cost: number; rrp: number }>> => {
    return new Promise((resolve) => {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      if (ext === "csv") {
        Papa.parse(file, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            const products = (results.data as Record<string, string>[]).map(row => {
              const findCol = (keys: string[]) => {
                for (const k of keys) {
                  const found = Object.keys(row).find(h => h.toLowerCase().trim().includes(k.toLowerCase()));
                  if (found && row[found]?.trim()) return row[found].trim();
                }
                return "";
              };
              const findNum = (keys: string[]) => parseFloat(findCol(keys).replace(/[^0-9.]/g, "")) || 0;
              return {
                name: findCol(["product", "name", "title", "description", "item"]),
                brand: findCol(["brand", "vendor", "supplier", "manufacturer"]),
                sku: findCol(["sku", "style", "code", "item code", "article"]),
                barcode: findCol(["barcode", "ean", "upc", "gtin"]),
                type: findCol(["type", "category", "product type", "dept"]),
                colour: findCol(["colour", "color", "col"]),
                size: findCol(["size", "sz"]),
                qty: findNum(["qty", "quantity", "units", "ordered", "order qty"]),
                cost: findNum(["cost per item", "cost", "wholesale", "unit price", "net"]),
                rrp: findNum(["compare-at price", "rrp", "retail", "rrp price", "sell", "msrp", "price"]),
              };
            }).filter(p => p.name);
            resolve(products);
          },
          error: () => resolve([]),
        });
      } else if (["xlsx", "xls"].includes(ext)) {
        const reader = new FileReader();
        reader.onload = async (ev) => {
          try {
            const XLSX = await import("xlsx");
            const wb = XLSX.read(ev.target?.result, { type: "array" });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const data = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });
            const products = data.map((row: Record<string, any>) => {
              const findCol = (keys: string[]) => {
                for (const k of keys) {
                  const found = Object.keys(row).find(h => h.toLowerCase().trim().includes(k.toLowerCase()));
                  if (found && String(row[found]).trim()) return String(row[found]).trim();
                }
                return "";
              };
              const findNum = (keys: string[]) => parseFloat(String(findCol(keys)).replace(/[^0-9.]/g, "")) || 0;
              return {
                name: findCol(["product", "name", "title", "description", "item"]),
                brand: findCol(["brand", "vendor", "supplier", "manufacturer"]),
                sku: findCol(["sku", "style", "code", "item code", "article"]),
                barcode: findCol(["barcode", "ean", "upc", "gtin"]),
                type: findCol(["type", "category", "product type", "dept"]),
                colour: findCol(["colour", "color", "col"]),
                size: findCol(["size", "sz"]),
                qty: findNum(["qty", "quantity", "units", "ordered", "order qty"]),
                cost: findNum(["cost per item", "cost", "wholesale", "unit price", "net"]),
                rrp: findNum(["compare-at price", "rrp", "retail", "rrp price", "sell", "msrp", "price"]),
              };
            }).filter((p: any) => p.name);
            resolve(products);
          } catch {
            resolve([]);
          }
        };
        reader.readAsArrayBuffer(file);
      } else {
        resolve([]);
      }
    });
  };

  const parseWithAI = async (file: File): Promise<Array<{ name: string; brand: string; sku: string; barcode: string; type: string; colour: string; size: string; qty: number; cost: number; rrp: number }>> => {
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      let base64: string;

      // Non-image file types (PDF, CSV, Excel, Word) skip image preprocessing.
      const isNonImage = isPdfFile(file) || ["csv", "xlsx", "xls", "doc", "docx"].includes(ext);

      // ── Client-side image preprocessing (resize, grayscale, contrast, sharpen) ──
      if (!isNonImage) {
        setEnrichLines([{ name: "Preprocessing image…", status: "searching", action: "Resize, grayscale, contrast & sharpen…", confidence: 0 }]);

        try {
          const preprocessedBlob = await preprocessForUpload(file);
          if (preprocessedBlob) {
            // Use the preprocessed blob for all downstream processing
            const preprocessedFile = new File([preprocessedBlob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
            console.log(`[Preprocess] Lightweight: ${(file.size / 1024).toFixed(0)}KB → ${(preprocessedBlob.size / 1024).toFixed(0)}KB`);

            // ── Photo preprocessing pipeline (orientation, region detection) ──
            if (isLikelyPhotoInvoice(file)) {
              setEnrichLines([{ name: "Preprocessing photo…", status: "searching", action: "Correcting orientation & enhancing…", confidence: 0 }]);

              const aiRegionDetect = async (imgBase64: string): Promise<DetectedRegions | null> => {
                try {
                  const { data, error } = await supabase.functions.invoke("preprocess-invoice-image", {
                    body: { imageBase64: imgBase64, fileType: "jpg" },
                  });
                  if (error || !data?.regions) return null;
                  return data.regions as DetectedRegions;
                } catch { return null; }
              };

              const ppResult = await preprocessInvoiceImage(preprocessedFile, aiRegionDetect);
              setPreprocessResult(ppResult);
              base64 = ppResult.bestForOCR;

              const rotMsg = ppResult.rotationApplied ? ` (rotated ${ppResult.rotationApplied}°)` : "";
              const cropMsg = ppResult.lineItemCrop ? " • line-item crop" : "";
              console.log(`[Preprocess] Full: ${ppResult.processingTimeMs}ms${rotMsg}${cropMsg}`);
            } else {
              // Non-photo image (screenshot etc) — use preprocessed blob directly
              const arrayBuffer = await preprocessedBlob.arrayBuffer();
              const bytes = new Uint8Array(arrayBuffer);
              let binary = "";
              for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
              }
              base64 = btoa(binary);
            }
          } else {
            // preprocessForUpload returned null (shouldn't happen since we checked isPdf)
            const arrayBuffer = await file.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            let binary = "";
            for (let i = 0; i < bytes.length; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            base64 = btoa(binary);
          }
        } catch (ppErr) {
          console.warn("[Preprocess] Lightweight preprocessing failed, using original:", ppErr);
          const arrayBuffer = await file.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          base64 = btoa(binary);
        }
      } else {
        // Non-image (PDF / CSV / Excel / Word) — skip all image preprocessing
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        base64 = btoa(binary);
      }

      setEnrichLines([{ name: "Reading invoice…", status: "searching", action: "AI extracting products…", confidence: 0 }]);

      // Build learning memory hint (structure-based, not brand-specific)
      const memoryHint = buildMemoryHint(supplierName || undefined);
      // Also check the old template system as fallback
      const templateHint = !memoryHint && supplierName ? buildTemplateHint(supplierName) : null;
      const combinedHint = memoryHint || templateHint;

      // Show memory stats if available
      if (supplierName) {
        const stats = getMemoryStats(supplierName);
        if (stats && stats.parses > 1) {
          console.log(`[Sonic Invoice] Memory found: ${stats.parses} parses, ${stats.corrections} corrections, +${stats.boost} confidence boost`);
        }
      }

      // Load supplier profile from database if available
      let supplierProfileData: Record<string, unknown> | undefined;
      if (supplierName) {
        try {
          const { data: profileRows } = await supabase
            .from("supplier_profiles" as any)
            .select("profile_data, invoices_analysed, updated_at")
            .eq("supplier_name", supplierName)
            .eq("is_active", true)
            .limit(1);
          if (profileRows && profileRows.length > 0) {
            const row = profileRows[0] as any;
            supplierProfileData = {
              ...(row.profile_data as Record<string, unknown>),
              invoices_analysed: row.invoices_analysed,
              last_updated: row.updated_at?.split("T")[0],
            };
            console.log(`[Sonic Invoice] Supplier profile loaded for "${supplierName}" (${row.invoices_analysed} invoices analysed)`);
          }
        } catch (e) {
          console.warn("[Sonic Invoice] Could not load supplier profile:", e);
        }
      }

      // STEP 0 — Generate fingerprint from detected headers
      const headersForFingerprint = detectedHeaders.length
        ? detectedHeaders
        : ((["csv", "xlsx", "xls"].includes(ext)
            ? await parseFileToRows(file, 1).then(r => r[0] ? Object.keys(r[0]) : []).catch(() => [])
            : []) as string[]);
      const fp = headersForFingerprint.length ? generateLayoutFingerprint(headersForFingerprint) : "";
      setLayoutFingerprint(fp || null);

      // STEP 1 — Exact fingerprint match (free, instant). Skips column mapping work.
      let fpHit: FingerprintHit | null = null;
      if (fp) {
        fpHit = await lookupFingerprintMatch(fp);
        if (fpHit) {
          setFingerprintHit(fpHit);
          setMatchMethod("fingerprint_match");
          const label = fpHit.source === "user"
            ? `${fpHit.invoice_count ?? 0} invoices processed with this format`
            : `learned from ${fpHit.match_count ?? 0} similar layouts`;
          toast.success("Recognised invoice layout — using saved rules", { description: label });
          console.log(`[Sonic Invoice] Fingerprint hit (${fpHit.source}): ${fp}`);
        }
      }

      // STEP 2 — Supplier-profile waterfall (only if no fingerprint hit)
      let inferredRules: InferredRules | null = null;
      try {
        const sampleSheetRows = ["csv", "xlsx", "xls"].includes(ext)
          ? await parseFileToRows(file, 1).then(r => r.slice(0, 3)).catch(() => [])
          : [];
        const headersForInfer = headersForFingerprint;
        inferredRules = await buildInferredRules(supplierName || "", headersForInfer, sampleSheetRows);
        if (inferredRules) {
          if (!fpHit && inferredRules.rules_source !== "defaults" && inferredRules.rules_source !== "header_inference") {
            setMatchMethod("supplier_match");
          }
          console.log(`[Sonic Invoice] Inferred rules: ${inferredRules.rules_source} @ ${inferredRules.confidence}% confidence`);
        }
      } catch (e) {
        console.warn("[Sonic Invoice] Pre-extraction inference failed:", e);
      }

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/classify-extract-validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        body: JSON.stringify({
          fileContent: base64,
          fileName: file.name,
          fileType: ext,
          customInstructions,
          supplierName,
          forceMode: processAs === "invoice" ? "invoice"
            : processAs === "packing_slip" ? "packing_slip"
            : processAs === "handwritten" ? "handwritten"
            : undefined,
          templateHint: combinedHint || undefined,
          supplierProfile: supplierProfileData || undefined,
          inferredRules: inferredRules || undefined,
          // Fingerprint pre-check — when present, parse-invoice can skip column detection
          // and go straight to value extraction using the saved column_map.
          fingerprintMatch: fpHit ? {
            layout_fingerprint: fpHit.layout_fingerprint,
            source: fpHit.source,
            column_map: fpHit.column_map,
            size_system: fpHit.size_system,
            format_type: fpHit.format_type,
            price_logic: fpHit.price_logic,
          } : undefined,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.log('[SONIC-DEBUG] Edge function response received', { data: null, error: errText });
        console.error("AI parse failed:", errText);
        return [];
      }

      const data = await response.json();
      console.log('[SONIC-DEBUG] Edge function response received', { data, error: null });
      if (data.supplier && !supplierName) {
        setSupplierName(data.supplier);
      }
      if (data.field_confidence && typeof data.field_confidence === "object") {
        setAiFieldConfidence(data.field_confidence as Record<string, number>);
      }
      if (typeof data.extraction_notes === "string") {
        setAiExtractionNotes(data.extraction_notes);
      }
      if (Array.isArray(data.qty_header_warnings)) {
        setQtyHeaderWarnings(data.qty_header_warnings);
      } else {
        setQtyHeaderWarnings([]);
      }
      if (data.layout_type) {
        setDetectedLayout(data.layout_type as LayoutType);
        const plan = data.parsing_plan || {};
        const sup = data.supplier || supplierName;
        const memStats = sup ? getMemoryStats(sup) : null;
        const boostInfo = memStats && memStats.boost > 0 ? ` • +${memStats.boost} learned` : "";
        console.log(`[Sonic Invoice] Layout: ${data.layout_type}, Variant: ${data.variant_method}, Size: ${data.detected_size_system}${boostInfo}`);
        toast(`Layout: ${getLayoutLabel(data.layout_type)}`, {
          description: `${sup || 'Unknown'}${boostInfo}${memStats ? ` • ${memStats.parses} prior parses` : ""}`,
        });

        // Save to both template system and learning memory
        if (sup) {
          // Only persist customInstructions to the supplier brain when the
          // user has explicitly opted in via the "Remember these requirements"
          // checkbox. Layout/variant/size memory is always recorded so the AI
          // can still recognise the invoice shape next time.
          const learnInstructions = getLearnSupplierFlag(sup);
          saveLayoutTemplate(
            sup,
            data.layout_type as LayoutType,
            85,
            ext as any,
            learnInstructions ? (customInstructions || undefined) : undefined,
            data.variant_method,
            data.detected_size_system,
            data.detected_fields,
          );

          // Record to learning memory with full fingerprint
          const fingerprint: LayoutFingerprint = {
            layoutType: data.layout_type,
            variantMethod: plan.variant_method || data.variant_method || "unknown",
            sizeSystem: data.detected_size_system || "none",
            tableHeaders: data.detected_fields || [],
            lineItemZone: plan.line_item_zone || "",
            costFieldRule: plan.cost_field || "",
            quantityFieldRule: plan.quantity_field || "",
            groupingRequired: plan.grouping_required || false,
          };
          recordParseSuccess(sup, fingerprint, data.rejected_rows);
        }
      }
      if (data.parsing_plan) {
        setAiParsingPlan(data.parsing_plan);
      }
      if (data.rejected_rows) {
        setAiRejectedRows(data.rejected_rows);
      }

      // ── #1 Document type detector: surface AI classification & auto-route ──
      const aiDocType = data.parsing_plan?.document_type || data.document_type;
      if (aiDocType) {
        setDetectedDocType(aiDocType);
        // If user left it on "auto" and AI said packing slip, prompt to switch flows.
        if (
          processAs === "auto" &&
          aiDocType === "packing_slip" &&
          !packingSlipPromptShown
        ) {
          setPackingSlipPromptShown(true);
          toast.warning("This looks like a Packing Slip, not an invoice", {
            description: "Items & quantities only — no prices were extracted. Use the Packing Slip flow for stock check.",
            duration: 12000,
            action: {
              label: "Open Packing Slip flow",
              onClick: () => {
                if (onNavigate) onNavigate("packing_slip");
              },
            },
          });
        }
      }

      // OCR fallback notifications
      if (data.ocr_fallback_used) {
        toast.info("OCR fallback was used for better extraction accuracy", {
          description: "The initial vision pass had low confidence — a text-extraction fallback improved results.",
        });
      }
      if (data.needs_manual_review) {
        toast.warning("This invoice needs manual review", {
          description: data.review_reason || "Both extraction passes returned low confidence. Please verify the extracted data carefully.",
          duration: 8000,
        });
      }

      return data.products || [];
    } catch (err) {
      console.log('[SONIC-DEBUG] Invoice processing error', err);
      console.error("AI parse error:", err);
      return [];
    }
  };

  const startProcessing = async (file: File) => {
    if (customInstructions.trim()) {
      addHistory(customInstructions, supplierName);
      // Honour the persisted "remember for this supplier" opt-in instead of
      // poking at DOM state — the checkbox writes the flag on toggle.
      if (supplierName && getLearnSupplierFlag(supplierName)) {
        saveTemplate(supplierName, customInstructions);
      }
    }
    if (useTemplate && matchedTemplate) {
      incrementTemplateUse(supplierName);
    }
    const fName = file.name;
    setFileName(fName);
    const ext = fName.split(".").pop()?.toLowerCase() || "";
    if (["jpg", "jpeg", "png", "heic", "webp"].includes(ext)) {
      setFileParseMode("photo");
    } else if (ext === "pdf") {
      setFileParseMode("pdf_text");
    } else {
      setFileParseMode("spreadsheet");
    }
    setProcessStartTime(Date.now());
    setProcessingDone(false);
    setProcessingCancelled(false);
    setProcessingElapsed(0);
    setShowCompletionSummary(false);
    persistedRef.current = false;
    cancelledRef.current = false;
    setStep(2);
    setInvoicePageImages([]);
    setEnrichLines([{ name: "Identifying supplier and layout…", status: "searching", action: "Stage 1 — orientation agent", confidence: 0 }]);
    // Shadow-log: start an agent_sessions row mirroring this run.
    void (async () => {
      const sid = await startShadowSession({ supplier: supplierName, trigger: "invoice_upload" });
      if (sid) {
        await logShadowStep({
          step: "extract",
          status: "running",
          narrative: `Reading invoice from ${supplierName || "supplier"}…`,
          input: { fileName: fName, mode: fileParseMode },
        });
      }
    })();

    // Capture invoice page image(s) for source trace viewer
    const fileExt = fName.split(".").pop()?.toLowerCase() || "";
    if (["jpg", "jpeg", "png", "webp"].includes(fileExt)) {
      try {
        const imgReader = new FileReader();
        imgReader.onload = () => {
          if (imgReader.result) setInvoicePageImages([imgReader.result as string]);
        };
        imgReader.readAsDataURL(file);
      } catch {}
    }

    let products: Array<{ name: string; brand: string; sku: string; barcode: string; type: string; colour: string; size: string; qty: number; cost: number; rrp: number }> = [];

    // ── Rule-based extraction (DB template) — DISABLED ──
    // Previously short-circuited CSV/xlsx with a saved supplier_templates row,
    // bypassing the 3-stage classify-extract-validate edge pipeline. All files
    // now route through parseWithAI → classify-extract-validate so Stage 1
    // classification + supplier_profiles caching can apply uniformly.

    // Detect headers for CSV/Excel for potential teach later
    if (products.length === 0 && ["csv", "xlsx", "xls"].includes(ext)) {
      try {
        const rows = await parseFileToRows(file, 1);
        if (rows.length > 0) setDetectedHeaders(Object.keys(rows[0]));
      } catch {}
    }

    if (products.length === 0) {
      // ── Brain Mode branch — DISABLED ──
      // Previously used a client-side 5-stage pipeline (runBrainPipeline) for
      // images/PDF that never called classify-extract-validate. All files now
      // route through parseWithAI so the 3-stage edge pipeline runs uniformly.
      products = await parseWithAI(file);
    }

    console.log('[Phase2 trace] startProcessing got products:', products?.length, 'first:', products?.[0]);
    if (cancelledRef.current) { console.log('[Phase2 trace] cancelled exit'); return; }

    if (products.length === 0) {
      console.log('[Phase2 trace] zero-products exit');
      setEnrichLines([{ name: "No products found", status: "not_found", action: "Could not extract products from this file. Try CSV/Excel format or check column headers.", confidence: 0 }]);
      setProcessingDone(true);
      setFinalProcessingTime(Math.floor((Date.now() - (processStartTime || Date.now())) / 1000));
      setShowCompletionSummary(true);
      return;
    }

    // ── Post-processing validation ──
    const { products: validated, debug } = validateAndCleanProducts(products, supplierName);
    setValidationDebug({
      ...debug,
      parsingPlan: aiParsingPlan as any,
      rejectedByAI: aiRejectedRows,
    });
    setValidatedProducts(validated);

    // ── Under-extraction detection ──
    const nonRejectedCount = validated.filter(p => !p._rejected).length;
    const planAnchors = (aiParsingPlan as any)?.row_anchors_detected;
    const totalVisibleRows = (aiParsingPlan as any)?.total_visible_rows;
    const estimatedRows = totalVisibleRows || (planAnchors?.length ? planAnchors.length : 0);
    // Flag if extracted count is less than 50% of estimated, or if only 1 product from multi-row invoice
    if (estimatedRows > 0 && nonRejectedCount < estimatedRows * 0.5) {
      setUnderExtractionWarning({ extractedCount: nonRejectedCount, estimatedRows });
    } else if (nonRejectedCount <= 1 && (debug.totalRaw + debug.rejected) > 3) {
      setUnderExtractionWarning({ extractedCount: nonRejectedCount, estimatedRows: debug.totalRaw + debug.rejected });
    } else {
      setUnderExtractionWarning(null);
    }

    // Filter to accepted products only
    const cleanProducts = validated
      .filter(p => !p._rejected)
      .map(({ _confidence, _confidenceLevel, _issues, _rejected, _rejectReason, ...rest }) => rest);

    console.log('[Phase2 trace] after validate, cleanProducts:', cleanProducts.length, 'rejected:', validated.filter(p=>p._rejected).length);
    if (cleanProducts.length === 0) {
      console.log('[Phase2 trace] zero-cleanProducts exit, debug:', debug);
      setEnrichLines([{ name: "No valid products found", status: "not_found", action: `${debug.rejected} rows rejected. Check Debug View for details.`, confidence: 0 }]);
      setProcessingDone(true);
      setFinalProcessingTime(Math.floor((Date.now() - (processStartTime || Date.now())) / 1000));
      setShowCompletionSummary(true);
      return;
    }

    if (debug.rejected > 0) {
      toast(`${debug.rejected} invalid rows filtered`, { description: `${debug.corrections.length} auto-corrections applied` });
    }

    const groups = convertToProductGroups(cleanProducts);
    setProductGroups(groups);
    void syncPhase2Catalog(validated, "parse");

    const names = groups.map(g => g.name);
    setParsedNames(names);
    runEnrichmentSim(cancelledRef, names);
  };

  // ── Reprocess in detailed mode ──
  const handleReprocessDetailed = async (expectedRowCount?: number) => {
    if (!uploadedFile || isReprocessing) return;
    setIsReprocessing(true);
    toast("Reprocessing in detailed mode…", { description: expectedRowCount ? `Looking for ${expectedRowCount} products` : "Using stronger row segmentation and style code anchoring" });

    try {
      const file = uploadedFile;
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);

      const memoryHint = buildMemoryHint(supplierName || undefined);
      const templateHintData = !memoryHint && supplierName ? buildTemplateHint(supplierName) : null;
      const combinedHint = memoryHint || templateHintData;

      // Load supplier profile for reprocess too
      let supplierProfileData: Record<string, unknown> | undefined;
      if (supplierName) {
        try {
          const { data: profileRows } = await supabase
            .from("supplier_profiles" as any)
            .select("profile_data, invoices_analysed, updated_at")
            .eq("supplier_name", supplierName)
            .eq("is_active", true)
            .limit(1);
          if (profileRows && profileRows.length > 0) {
            const row = profileRows[0] as any;
            supplierProfileData = {
              ...(row.profile_data as Record<string, unknown>),
              invoices_analysed: row.invoices_analysed,
              last_updated: row.updated_at?.split("T")[0],
            };
          }
        } catch (e) { /* ignore */ }
      }

      // Re-run fingerprint pre-check + inference for the detailed pass (uses any newly-saved learning).
      const headersForFingerprintRe = detectedHeaders.length
        ? detectedHeaders
        : ((["csv", "xlsx", "xls"].includes(ext)
            ? await parseFileToRows(file, 1).then(r => r[0] ? Object.keys(r[0]) : []).catch(() => [])
            : []) as string[]);
      const fpRe = headersForFingerprintRe.length ? generateLayoutFingerprint(headersForFingerprintRe) : "";
      let fpHitRe: FingerprintHit | null = null;
      if (fpRe) {
        fpHitRe = await lookupFingerprintMatch(fpRe);
        if (fpHitRe) setFingerprintHit(fpHitRe);
      }
      let inferredRules: InferredRules | null = null;
      try {
        const sampleSheetRows = ["csv", "xlsx", "xls"].includes(ext)
          ? await parseFileToRows(file, 1).then(r => r.slice(0, 3)).catch(() => [])
          : [];
        inferredRules = await buildInferredRules(supplierName || "", headersForFingerprintRe, sampleSheetRows);
      } catch { /* ignore */ }

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/classify-extract-validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        body: JSON.stringify({
          fileContent: base64,
          fileName: file.name,
          fileType: ext,
          customInstructions,
          supplierName,
          forceMode: processAs === "invoice" ? "invoice"
            : processAs === "packing_slip" ? "packing_slip"
            : processAs === "handwritten" ? "handwritten"
            : undefined,
          templateHint: combinedHint || undefined,
          supplierProfile: supplierProfileData || undefined,
          inferredRules: inferredRules || undefined,
          fingerprintMatch: fpHitRe ? {
            layout_fingerprint: fpHitRe.layout_fingerprint,
            source: fpHitRe.source,
            column_map: fpHitRe.column_map,
            size_system: fpHitRe.size_system,
            format_type: fpHitRe.format_type,
            price_logic: fpHitRe.price_logic,
          } : undefined,
          detailedMode: true,
          expectedProductCount: expectedRowCount || undefined,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.log('[SONIC-DEBUG] Edge function response received', { data: null, error: errText });
        toast.error("Reprocessing failed", { description: "Could not re-extract products" });
        setIsReprocessing(false);
        return;
      }

      const data = await response.json();
      console.log('[SONIC-DEBUG] Edge function response received', { data, error: null });
      const products = data.products || [];

      if (data.parsing_plan) setAiParsingPlan(data.parsing_plan);
      if (data.rejected_rows) setAiRejectedRows(data.rejected_rows);
      if (data.field_confidence && typeof data.field_confidence === "object") {
        setAiFieldConfidence(data.field_confidence as Record<string, number>);
      }
      if (typeof data.extraction_notes === "string") {
        setAiExtractionNotes(data.extraction_notes);
      }
      if (Array.isArray(data.qty_header_warnings)) {
        setQtyHeaderWarnings(data.qty_header_warnings);
      } else {
        setQtyHeaderWarnings([]);
      }

      if (products.length === 0) {
        toast.error("No products found in detailed mode");
        setIsReprocessing(false);
        return;
      }

      const { products: validated, debug } = validateAndCleanProducts(products, supplierName);
      setValidationDebug({ ...debug, parsingPlan: data.parsing_plan as any, rejectedByAI: data.rejected_rows });
      setValidatedProducts(validated);

      const nonRejectedCount = validated.filter(p => !p._rejected).length;
      const prevCount = underExtractionWarning?.extractedCount || 0;
      if (nonRejectedCount > prevCount) {
        toast.success(`Found ${nonRejectedCount} products (was ${prevCount})`, { description: "Detailed mode recovered more rows" });
        setUnderExtractionWarning(null);
      } else {
        toast("Same result — try manual review", { description: `${nonRejectedCount} products extracted` });
      }

      // Rebuild product groups
      const cleanProducts = validated
        .filter(p => !p._rejected)
        .map(({ _confidence, _confidenceLevel, _issues, _rejected, _rejectReason, ...rest }) => rest);
      if (cleanProducts.length > 0) {
        const groups = convertToProductGroups(cleanProducts);
        setProductGroups(groups);
        setParsedNames(groups.map(g => g.name));
        void syncPhase2Catalog(validated, "reprocess");
      }
    } catch (err) {
      console.log('[SONIC-DEBUG] Invoice processing error', err);
      console.error("Detailed reprocess error:", err);
      toast.error("Reprocessing failed");
    } finally {
      setIsReprocessing(false);
    }
  };

  const handleCancelProcessing = () => {
    cancelledRef.current = true;
    setProcessingCancelled(true);
    setProcessingDone(true);
    const elapsed = Math.floor((Date.now() - (processStartTime || Date.now())) / 1000);
    setFinalProcessingTime(elapsed);
  };

  const handleResumeProcessing = () => {
    setProcessingCancelled(false);
    setProcessingDone(false);
    cancelledRef.current = false;
    runEnrichmentSim(cancelledRef, parsedNames);
  };

  const handleProceedToReview = () => {
    setShowCompletionSummary(false);
    setStep(3);
    beginReviewTimer();
    // Shadow-log: extract complete, stock-check gate awaiting review.
    void (async () => {
      await logShadowStep({
        step: "extract",
        status: "done",
        narrative: `Extracted ${validatedProducts.length} products from ${supplierName || "supplier"}.`,
        confidence: validatedProducts.length > 0
          ? validatedProducts.reduce((s, p) => s + (p._confidence ?? 0), 0) / validatedProducts.length
          : null as unknown as number,
        output: { productCount: validatedProducts.length },
      });
      await logShadowStep({
        step: "stock_check",
        status: "needs_review",
        narrative: `Stock check ready — ${validatedProducts.length} lines awaiting review.`,
      });
    })();
    // Write extracted products to Supabase products + variants tables so
    // pricing tools (Price Adjustment, Margin Protection, Markdown Ladder)
    // can see them immediately — no need to wait for Export.
    persistInvoiceToDb();
    if (!matchedTemplate && supplierName.trim()) {
      setShowSaveTemplate(true);
    }
    // Fire-and-forget: train the supplier intelligence engine in the background
    void trainSupplierPattern();
  };

  const trainSupplierPattern = async () => {
    try {
      const name = normaliseVendor(supplierName);
      if (!name || productGroups.length === 0) return;

      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id;
      if (!userId) return;

      // ── GUARANTEED SEED ROW (Bugs #8 & #9) ──────────────────────────
      // Write a baseline supplier_intelligence row immediately, BEFORE the
      // AI pattern call. This ensures every successfully-extracted invoice
      // produces a Supplier Brain entry even if the AI pattern call later
      // fails (rate limit / parse error). The post-AI recordSupplierUpdated
      // call below then enriches column_map and confidence on success.
      try {
        const { recordSupplierLearned, recordSupplierUpdated } = await import(
          "@/lib/supplier-intelligence"
        );
        const { data: existing } = await supabase
          .from("supplier_intelligence")
          .select("id")
          .eq("user_id", userId)
          .ilike("supplier_name", name)
          .maybeSingle();
        const seedPayload = {
          supplierName: name,
          confidence: null,
          columnMap: null,
          matchMethod: matchMethod || "full_extraction",
        };
        if (existing?.id) {
          void recordSupplierUpdated(seedPayload);
        } else {
          void recordSupplierLearned(seedPayload);
        }
      } catch (seedErr) {
        console.warn("Seed supplier row failed (non-fatal):", seedErr);
      }

      // Build sample rows from the first 3 product groups (flatten one variant each)
      const sampleRows = productGroups.slice(0, 3).map((g) => {
        const v = g.variants?.[0];
        return {
          name: g.name,
          brand: g.brand,
          sku: v?.sku || "",
          colour: g.colour,
          size: v?.option2Value || g.size,
          qty: v?.qty || 0,
          cost: g.cogs ?? g.price,
          rrp: g.rrp,
        };
      });

      const extractedProducts = productGroups.map((g) => ({
        name: g.name,
        brand: g.brand,
        type: g.type,
        colour: g.colour,
        cost: g.cogs ?? g.price,
        rrp: g.rrp,
        variant_count: g.variants?.length || 0,
      }));

      const payload = {
        user_id: userId,
        supplier_name: name,
        raw_headers: detectedHeaders,
        sample_rows: sampleRows,
        format_type: detectedLayout || null,
        extracted_products: extractedProducts,
        field_confidence: aiFieldConfidence || undefined,
        layout_fingerprint: layoutFingerprint || (detectedHeaders.length ? generateLayoutFingerprint(detectedHeaders) : null),
        match_method: matchMethod,
        original_file_path: originalFileMeta?.path || null,
        original_file_mime: originalFileMeta?.mime || null,
        original_filename: originalFileMeta?.name || null,
      };

      supabase.functions
        .invoke("extract-supplier-pattern", { body: payload })
        .then(async ({ data, error }) => {
          if (error) {
            console.warn("Pattern learning failed silently:", error);
            return;
          }
          if (!data) return;
          const supplierLabel = name;
          // Build a learning payload we can persist into supplier_intelligence.
          const learningPayload = {
            supplierName: supplierLabel,
            confidence: data.confidence_score ?? null,
            columnMap: (data.column_map ?? null) as Record<string, string> | null,
            sizeSystem: data.size_system ?? null,
            skuPrefixPattern: data.sku_prefix_pattern ?? null,
            gstOnCost: data.gst_included_in_cost ?? null,
            gstOnRrp: data.gst_included_in_rrp ?? null,
            markupMultiplier: data.default_markup_multiplier ?? null,
            matchMethod: matchMethod || "full_extraction",
          };
          // Lazy-load the helper so we don't pay the import cost on every render.
          const { recordSupplierLearned, recordSupplierUpdated } = await import(
            "@/lib/supplier-intelligence"
          );
          if (data.is_new_supplier) {
            void recordSupplierLearned(learningPayload);
            toast(`New supplier learned: ${supplierLabel}`, {
              description: "The app will get smarter with each invoice.",
            });
          } else {
            void recordSupplierUpdated(learningPayload);
            toast(`Supplier profile updated: ${supplierLabel}`, {
              description: `Confidence now ${data.confidence_score ?? 0}%.`,
            });
          }
        })
        .catch((err) => console.warn("Pattern learning failed silently:", err));
    } catch (err) {
      console.warn("Pattern learning failed silently:", err);
    }
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
    colour: string;
    size: string;
    price: number;
    rrp: number;
    cogs?: number;
    status: string;
    metafields: Record<string, string>;
    variants: VariantLine[];
    isGrouped: boolean;
    barcode?: string;
    vendorCode?: string;
    matchSource?: MatchSource;
    // Enrichment fields
    enriched?: boolean;
    enriching?: boolean;
    imageSrc?: string;
    imageUrls?: string[];
    desc?: string;
    fabric?: string;
    care?: string;
    origin?: string;
    productPageUrl?: string;
    enrichConfidence?: string;
    enrichNote?: string;
  }

  const [productGroups, setProductGroups] = useState<ProductGroup[]>([]);
  const [enrichAllRunning, setEnrichAllRunning] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState({ current: 0, total: 0 });
  const [validationDebug, setValidationDebug] = useState<ValidationDebugInfo | null>(null);
  const [validatedProducts, setValidatedProducts] = useState<ValidatedProduct[]>([]);
  // ── Brain Mode (5-stage pipeline) state — only populated when toggle is ON ──
  const [brainProducts, setBrainProducts] = useState<BrainProduct[] | null>(null);
  const [brainSummary, setBrainSummary] = useState<BrainValidationSummary | null>(null);
  const [brainRecognised, setBrainRecognised] = useState<string>("");
  const brainContextRef = useRef<{ orientation: Record<string, unknown>; layout: Record<string, unknown> } | null>(null);
  const brainClassificationRef = useRef<import("@/lib/universal-classifier").UniversalClassification | null>(null);
  const [needsTeach, setNeedsTeach] = useState(false);
  const [invoicePageImages, setInvoicePageImages] = useState<string[]>([]);
  const [aiParsingPlan, setAiParsingPlan] = useState<Record<string, unknown> | null>(null);
  const [aiRejectedRows, setAiRejectedRows] = useState<Array<{ raw_text: string; rejection_reason: string }>>([]);
  const [stockCheckItems, setStockCheckItems] = useState<InvoiceLineItem[] | null>(null);
  const [stockCheckPromptDismissed, setStockCheckPromptDismissed] = useState(false);
  const [priceLookupActive, setPriceLookupActive] = useState(false);
  const [bulkPriceLookupActive, setBulkPriceLookupActive] = useState(false);
  const [priceMatchActive, setPriceMatchActive] = useState(false);
  const [descriptionsActive, setDescriptionsActive] = useState(false);
  // Auto-detected document type from parse-invoice (#1 Document type detector)
  const [detectedDocType, setDetectedDocType] = useState<
    "tax_invoice" | "packing_slip" | "handwritten_invoice" | "statement" | "unknown" | null
  >(null);
  const [packingSlipPromptShown, setPackingSlipPromptShown] = useState(false);
  const [imageHelperActive, setImageHelperActive] = useState(false);
  const [collectionSeoActive, setCollectionSeoActive] = useState(false);
  const [underExtractionWarning, setUnderExtractionWarning] = useState<{ extractedCount: number; estimatedRows: number } | null>(null);
  const [isReprocessing, setIsReprocessing] = useState(false);

  // Watchdog Agent — hydrate Review screen on mount when a stashed run had products.
  // Maps the agent_runs / parse-invoice product shape into the ProductGroup shape
  // the Review UI expects, then jumps straight to Step 3 (Review).
  useEffect(() => {
    const payload = watchdogPayloadRef.current;
    if (!watchdogRun || !payload) return;
    if (payload.supplierName) setSupplierName(payload.supplierName);
    const products = payload.products ?? [];
    if (products.length === 0) {
      console.warn("[Watchdog] No products in payload — opening empty Review for run", watchdogRun.runId);
      setStep(3);
      return;
    }
    const normalized = products.map((p: any, i: number) => {
      const sku = p.sku ?? p.style_code ?? p.style_number ?? "";
      const colour = p.colour ?? p.color ?? "";
      const size = p.size ?? "";
      const qty = Number(p.quantity ?? p.qty ?? 1);
      const cost = Number(p.unit_cost ?? p.cost ?? p.price ?? 0);
      const rrp = Number(p.rrp ?? p.retail_price ?? 0);
      const title = p.title ?? p.product_title ?? p.name ?? `Product ${i + 1}`;
      const brand = p.brand ?? p.vendor ?? p.supplier ?? payload.supplierName ?? "";
      return { p, i, sku, colour, size, qty, cost, rrp, title, brand };
    });
    const groups: ProductGroup[] = normalized.map(({ p, i, sku, colour, size, qty, cost, rrp, title, brand }) => {
      return {
        styleGroup: sku || `${title}-${i}`,
        name: title,
        brand,
        type: p.product_type ?? p.type ?? "",
        colour,
        size,
        price: cost,
        rrp,
        cogs: cost,
        status: "pending",
        metafields: {},
        variants: [{
          sku,
          colour,
          size,
          qty,
          cost,
          rrp,
          price: rrp || cost,
          option1Name: "Colour",
          option1Value: colour,
          option2Name: "Size",
          option2Value: size,
        } as unknown as VariantLine],
        isGrouped: false,
        barcode: p.barcode ?? p.gtin ?? undefined,
        vendorCode: p.vendor_code ?? sku,
      } as ProductGroup;
    });
    const validated = normalized.map(({ p, i, sku, colour, size, qty, cost, rrp, title, brand }) => ({
      name: title,
      brand,
      sku,
      barcode: p.barcode ?? p.gtin ?? "",
      type: p.product_type ?? p.type ?? "",
      colour,
      size,
      qty,
      cost,
      rrp,
      group_key: p.group_key ?? sku,
      _rowIndex: i,
      _rawName: title,
      _rawCost: cost,
      _confidence: Number(p.confidence ?? p.overall_confidence ?? 50),
      _confidenceLevel: "medium",
      _confidenceReasons: [],
      _issues: [],
      _corrections: [],
      _rejected: false,
      _classification: "product_title",
      _suggestedTitle: title,
      _suggestedPrice: cost,
      _suggestedVendor: brand,
    } as ValidatedProduct));
    console.log(`[Watchdog] Hydrated ${groups.length} ProductGroups for run ${watchdogRun.runId}`);
    setValidatedProducts(validated);
    setValidationDebug({
      totalRaw: validated.length,
      accepted: validated.length,
      needsReview: validated.length,
      rejected: 0,
      rejectedRows: [],
      detectedVendor: payload.supplierName ?? "",
      corrections: [],
    });
    setProductGroups(groups);
    setStep(3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Stock reconciliation (auto-runs when reaching export step) ───────────
  const [platformConnections, setPlatformConnections] = useState<Array<{ platform: string; shop_domain?: string | null }>>([]);
  const [platformsChecked, setPlatformsChecked] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileProgress, setReconcileProgress] = useState(0);
  const [reconcileResult, setReconcileResult] = useState<any>(null);
  const [reconcileError, setReconcileError] = useState<string | null>(null);
  const reconcileStartedRef = useRef(false);

  // ── Onboarding sample invoice seeding ──
  // If the user clicked "Use this sample invoice" during onboarding, hydrate
  // validatedProducts directly and jump to the review step (no upload needed).
  const sampleSeededRef = useRef(false);
  useEffect(() => {
    if (sampleSeededRef.current) return;
    let raw: string | null = null;
    try { raw = localStorage.getItem("pending_sample_invoice"); } catch { /* ignore */ }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as {
        vendor: string;
        lines: { name: string; variant?: string; qty: number; cost: number }[];
      };
      if (!parsed?.lines?.length) {
        localStorage.removeItem("pending_sample_invoice");
        return;
      }

      // Expand variant strings like "Coral · 8,10,12,14" into one row per size.
      const expanded: ValidatedProduct[] = [];
      let rowIdx = 0;
      parsed.lines.forEach((line) => {
        const variant = (line.variant || "").trim();
        let colour = "";
        let sizes: string[] = [""];
        if (variant) {
          const [colPart, sizePart] = variant.split("·").map((s) => s.trim());
          colour = colPart || "";
          if (sizePart) {
            sizes = sizePart.split(/[,/]/).map((s) => s.trim()).filter(Boolean);
            if (sizes.length === 0) sizes = [""];
          }
        }
        const qtyEach = Math.max(1, Math.floor(line.qty / sizes.length));
        sizes.forEach((size) => {
          expanded.push({
            name: line.name,
            brand: parsed.vendor,
            sku: "",
            barcode: "",
            type: "",
            colour,
            size,
            qty: qtyEach,
            cost: line.cost,
            rrp: 0,
            _rowIndex: rowIdx++,
            _rawName: line.name,
            _rawCost: line.cost,
            _confidence: 95,
            _confidenceLevel: "high",
            _confidenceReasons: [{ label: "Sample data", delta: 0 }],
            _issues: [],
            _corrections: [],
            _rejected: false,
            _classification: "product_title",
            _suggestedTitle: line.name,
            _suggestedPrice: line.cost,
            _suggestedVendor: parsed.vendor,
          } as ValidatedProduct);
        });
      });

      setSupplierName(parsed.vendor);
      setValidatedProducts(expanded);
      setValidationDebug({
        totalRaw: expanded.length,
        accepted: expanded.length,
        rejected: 0,
        corrections: 0,
        issues: [],
        rejectedRows: [],
      } as unknown as ValidationDebugInfo);
      setStep(3);
      sampleSeededRef.current = true;
      try { localStorage.removeItem("pending_sample_invoice"); } catch { /* ignore */ }
      toast.success(`Loaded sample invoice from ${parsed.vendor}`);
    } catch (err) {
      console.warn("Failed to load pending sample invoice:", err);
      try { localStorage.removeItem("pending_sample_invoice"); } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const refreshPlatformConnections = async () => {
      try {
        const { data: userRes } = await supabase.auth.getUser();
        const uid = userRes?.user?.id;
        if (!uid) {
          setPlatformConnections([]);
          return;
        }

        const [{ data: platformData }, { data: shopifyConnection }] = await Promise.all([
          supabase
            .from("platform_connections")
            .select("platform, shop_domain")
            .eq("user_id", uid)
            .eq("is_active", true),
          supabase
            .from("shopify_connections")
            .select("store_url")
            .eq("user_id", uid)
            .maybeSingle(),
        ]);

        const nextConnections = [...(platformData ?? [])] as Array<{ platform: string; shop_domain?: string | null }>;
        if (shopifyConnection?.store_url && !nextConnections.some((conn) => conn.platform === "shopify")) {
          nextConnections.push({ platform: "shopify", shop_domain: shopifyConnection.store_url });
        }

        setPlatformConnections(nextConnections);
      } catch {
        // non-fatal
      } finally {
        setPlatformsChecked(true);
      }
    };

    void refreshPlatformConnections();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        setPlatformConnections([]);
        setPlatformsChecked(true);
        return;
      }
      void refreshPlatformConnections();
    });

    return () => subscription.unsubscribe();
  }, []);

  const connectedPlatformLabel = (() => {
    const set = new Set(platformConnections.map((c) => c.platform));
    if (set.has("shopify") && set.has("lightspeed")) return "Shopify & Lightspeed";
    if (set.has("shopify")) return "Shopify";
    if (set.has("lightspeed")) return "Lightspeed";
    return null;
  })();

  useEffect(() => {
    if (step !== 4) return;
    if (!platformsChecked) return;
    if (reconcileStartedRef.current) return;
    if (platformConnections.length === 0) return;
    if (productGroups.length === 0) return;
    reconcileStartedRef.current = true;

    const platform =
      platformConnections.some((c) => c.platform === "shopify") &&
      platformConnections.some((c) => c.platform === "lightspeed")
        ? "both"
        : platformConnections[0].platform;

    // Flatten productGroups into invoice_lines
    const invoice_lines = productGroups.flatMap((g) =>
      (g.variants && g.variants.length > 0)
        ? g.variants.map((v) => ({
            sku: v.sku,
            product_name: g.name,
            brand: g.brand,
            colour: v.option1Value || g.colour,
            size: v.option2Value || g.size,
            qty: v.qty,
            cost: v.price ?? g.cogs ?? g.price,
            rrp: v.rrp ?? g.rrp,
            barcode: g.barcode,
          }))
        : [{
            sku: (g as any).sku ?? "",
            product_name: g.name,
            brand: g.brand,
            colour: g.colour,
            size: g.size,
            qty: 1,
            cost: g.cogs ?? g.price,
            rrp: g.rrp,
            barcode: g.barcode,
          }]
    );

    // ── Push products into shared invoice session store for downstream tools ──
    try {
      const sessionProds = productGroups.map((g) => {
        const cost = Number(g.cogs ?? g.price ?? 0);
        const rrp = Number(g.rrp ?? 0);
        const margin = rrp > 0 ? ((rrp - cost) / rrp) * 100 : 0;
        const qty = (g.variants && g.variants.length > 0)
          ? g.variants.reduce((s: number, v: any) => s + (Number(v.qty) || 0), 0)
          : 1;
        return {
          product_title: g.name || "Untitled",
          sku: (g as any).sku ?? (g.variants?.[0] as any)?.sku ?? "",
          vendor: g.brand || "",
          unit_cost: cost,
          rrp,
          margin_pct: Math.round(margin * 10) / 10,
          qty,
        };
      });
      setInvoiceSessionProducts(
        sessionProds,
        supplierName || "",
        new Date().toISOString().slice(0, 10),
      );

      // Phase 2 catalog sync now runs immediately after parse/reprocess completion.
    } catch (e) {
      console.warn("[invoice-session-store] write failed", e);
    }

    setReconciling(true);
    setReconcileProgress(0);
    setReconcileError(null);

    // Indeterminate progress ticker (capped at 92%)
    const ticker = setInterval(() => {
      setReconcileProgress((p) => (p < 92 ? p + Math.max(1, Math.round((92 - p) / 12)) : p));
    }, 350);

    (async () => {
      try {
        const { data: userRes } = await supabase.auth.getUser();
        const uid = userRes?.user?.id;
        const { data, error } = await supabase.functions.invoke("reconcile-invoice", {
          body: {
            user_id: uid,
            invoice_id: null,
            supplier_name: supplierName ? normaliseVendor(supplierName) : null,
            platform,
            invoice_lines,
          },
        });
        if (error) throw error;
        setReconcileProgress(100);
        const enriched = { ...(data as any), platform };
        setReconcileResult(enriched);
        // Broadcast so Index can stash before navigating to the review panel
        window.dispatchEvent(new CustomEvent("sonic:reconciliation-ready", { detail: enriched }));
      } catch (err: any) {
        console.error("[reconcile-invoice]", err);
        setReconcileError(err?.message || "Stock reconciliation failed");
        toast.error("Stock check failed", { description: "You can still export your invoice as usual." });
      } finally {
        clearInterval(ticker);
        setReconciling(false);
      }
    })();

    return () => clearInterval(ticker);
  }, [step, platformsChecked, platformConnections, productGroups, supplierName]);


  // ── Product Enrichment via AI ────────────────────────────
  const enrichProduct = async (group: ProductGroup): Promise<Partial<ProductGroup>> => {
    try {
      const storeConfig = JSON.parse(localStorage.getItem('store_config_sonic_invoice') || '{}');
      const storeName = storeConfig.name || 'My Store';
      const storeCity = storeConfig.city || '';
      const customInstr = storeConfig.defaultInstructions || '';
      
      // Look up brand website from brand directory
      const brandDir = JSON.parse(localStorage.getItem('brand_directory_sonic_invoice') || '[]');
      const brandEntry = brandDir.find((b: any) => b.name.toLowerCase() === group.brand.toLowerCase());
      const brandWebsite = brandEntry?.website || '';

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/enrich-product`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          title: group.name,
          vendor: group.brand,
          type: group.type,
          brandWebsite,
          storeName,
          storeCity,
          customInstructions: customInstr,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Failed' }));
        return { enrichConfidence: 'low', enrichNote: err.error || 'Enrichment failed' };
      }

      const result = await response.json();
      return {
        desc: result.description && result.description.length > 20 ? result.description : undefined,
        imageUrls: result.imageUrls?.length > 0 ? result.imageUrls : undefined,
        imageSrc: result.imageUrls?.[0] || undefined,
        fabric: result.fabric || undefined,
        care: result.care || undefined,
        origin: result.origin || undefined,
        productPageUrl: result.productPageUrl || '',
        enrichConfidence: result.confidence || 'low',
        enrichNote: result.note || '',
      };
    } catch (e) {
      return { enrichConfidence: 'low', enrichNote: e instanceof Error ? e.message : 'Network error' };
    }
  };

  const runEnrichment = async (idx: number) => {
    setProductGroups(prev => prev.map((g, i) => i === idx ? { ...g, enriching: true } : g));
    const result = await enrichProduct(productGroups[idx]);
    setProductGroups(prev => {
      const updated = prev.map((g, i) => i === idx ? { ...g, ...result, enriched: true, enriching: false } : g);
      // Persist enriched products for Image Download Helper
      const enrichedForStorage = updated.filter(g => g.enriched && (g.imageSrc || (g.imageUrls && g.imageUrls.length > 0)))
        .map(g => ({
          title: g.name,
          sku: (g as any).vendorCode || (g as any).sku || '',
          colour: g.colour || '',
          imageSrc: g.imageSrc || (g.imageUrls && g.imageUrls[0]) || '',
          imageUrls: g.imageUrls || [],
        }));
      try { localStorage.setItem('last_enriched_products', JSON.stringify(enrichedForStorage)); } catch {}
      return updated;
    });
    addAuditEntry('Enriched', `${productGroups[idx].name} — ${result.enrichConfidence || 'low'} confidence`);
  };

  const runEnrichAll = async () => {
    const unenriched = productGroups.map((g, i) => ({ g, i })).filter(({ g }) => g.name && !g.enriched);
    if (unenriched.length === 0) return;
    setEnrichAllRunning(true);
    setEnrichProgress({ current: 0, total: unenriched.length });
    for (let j = 0; j < unenriched.length; j++) {
      setEnrichProgress({ current: j + 1, total: unenriched.length });
      await runEnrichment(unenriched[j].i);
      if (j < unenriched.length - 1) await new Promise(r => setTimeout(r, 700));
    }
    setEnrichAllRunning(false);
  };

  const setProductImage = (idx: number, url: string) => {
    setProductGroups(prev => prev.map((g, i) => i === idx ? { ...g, imageSrc: url } : g));
  };
  // Explode each ProductGroup into one ExportProduct per VariantLine, so the
  // CSV engine sees true per-(colour × size) rows. Colour/Size are derived
  // from the variant's option labels (case-insensitive) — falling back to
  // group-level colour/size when the variant only carries one axis.
  const mockProducts = productGroups.flatMap(g => {
    // Build a rich Body (HTML) from enrichment outputs (description, fabric, care).
    // Forwarded to BOTH Shopify "Body (HTML)" and Lightspeed "description"
    // (the Lightspeed exporter strips tags for plain-text).
    const bodyParts: string[] = [];
    if (g.desc) bodyParts.push(`<p>${g.desc}</p>`);
    if (g.fabric) bodyParts.push(`<p><strong>Fabric:</strong> ${g.fabric}</p>`);
    if (g.care) bodyParts.push(`<p><strong>Care:</strong> ${g.care}</p>`);
    if (g.origin) bodyParts.push(`<p><strong>Origin:</strong> ${g.origin}</p>`);
    const bodyHtml = bodyParts.length > 0 ? bodyParts.join("") : undefined;

    // W-07 — leave `tags` blank here so csv-export-engine.buildRichTags() runs
    // downstream with full context (brand, type, colour, invoiceDate, season).
    // Pre-building tags as "[brand, type, colour, New Arrival]" used to win the
    // `ln.tags ||` fallback and suppress the rich builder.
    const tags = "";

    // Parse season token (e.g. "W26") from the SKU's middle segment so the
    // engine can emit a season tag without re-parsing.
    const seasonFromGroup = (() => {
      const sku = g.vendorCode || g.variants?.[0]?.sku || "";
      const parts = sku.split(/[-_/]/).filter(Boolean);
      for (const p of parts) {
        if (/^(SS|AW|S|W|FW|HO|RE)\d{2}$/i.test(p)) return p.toUpperCase();
      }
      return "";
    })();

    const imageUrl = g.imageSrc || (g.imageUrls && g.imageUrls[0]) || undefined;

    const variants = g.variants && g.variants.length > 0
      ? g.variants
      : [{ sku: g.vendorCode || "", option1Name: "", option1Value: "", option2Name: "", option2Value: "", qty: 0, price: g.price, rrp: g.rrp } as VariantLine];

    return variants.map(v => {
      const o1n = (v.option1Name || "").toLowerCase();
      const o2n = (v.option2Name || "").toLowerCase();
      let colour = g.colour || "";
      let size = g.size || "";
      if (o1n.startsWith("colour") || o1n.startsWith("color")) colour = v.option1Value || colour;
      else if (o1n === "size") size = v.option1Value || size;
      if (o2n.startsWith("colour") || o2n.startsWith("color")) colour = v.option2Value || colour;
      else if (o2n === "size") size = v.option2Value || size;
      // Single-axis variants without explicit option name: assume value is the size.
      if (!o1n && !o2n && v.option1Value && !size) size = v.option1Value;

      return {
        name: g.name,
        sku: v.sku || g.vendorCode || "",
        barcode: g.barcode || "",
        brand: g.brand,
        type: g.type,
        colour,
        size,
        price: v.price ?? g.price,
        rrp: v.rrp ?? g.rrp,
        qty: v.qty ?? 0,
        // VariantLine.price IS the wholesale unit cost (set as `price: p.cost`
        // upstream). Surface it as cogs so Lightspeed `supply_price` and
        // Shopify `Cost per item` get the correct wholesale price — never RRP.
        cogs: (v.price ?? g.cogs ?? g.price),
        status: g.status,
        metafields: g.metafields,
        imageUrl,
        bodyHtml,
        tags,
        // W-07 — forward date + season so the engine emits Apr26 / W26 tags.
        invoiceDate: new Date().toISOString().split("T")[0],
        season: seasonFromGroup || undefined,
      };
    });
  });

  // Confidence scoring per product group
  const groupConfidences: ConfidenceBreakdown[] = productGroups.map(g => {
    return calculateConfidence({
      name: g.name,
      type: g.type,
      description: g.status !== "pending" ? "Stylish swimwear piece" : undefined,
      hasImage: g.status === "ready",
      rrp: g.rrp,
      seoTitle: g.status !== "pending" ? `${g.name} | ${g.brand}` : undefined,
      hasTags: g.status !== "pending",
      matchSource: g.matchSource || (g.barcode ? "barcode" : g.variants[0]?.sku ? "sku" : "name"),
      isPending: g.status === "pending",
    });
  });
  const confCounts = {
    high: groupConfidences.filter(c => c.level === "high").length,
    medium: groupConfidences.filter(c => c.level === "medium").length,
    low: groupConfidences.filter(c => c.level === "low").length,
    pending: groupConfidences.filter(c => c.level === "pending").length,
  };


  const totalVariantLines = productGroups.reduce((s, g) => s + g.variants.length, 0);
  const groupedCount = productGroups.filter(g => g.isGrouped).length;
  const standaloneCount = productGroups.filter(g => !g.isGrouped).length;
  const totalQty = productGroups.reduce((s, g) => s + g.variants.reduce((v, l) => v + l.qty, 0), 0);

  // ── Inventory update mode per product group ──────────────
  type LineMode = "new" | "update";
  const [lineModes, setLineModes] = useState<Record<number, LineMode>>(() => {
    const modes: Record<number, LineMode> = {};
    productGroups.forEach((g, i) => {
      const mainSku = g.variants[0]?.sku || "";
      const existing = lookupInventory(mainSku);
      modes[i] = existing ? "update" : "new";
    });
    return modes;
  });
  const [reviewTab, setReviewTab] = useState<"new" | "update">("new");
  const [inventoryApplied, setInventoryApplied] = useState(false);
  const [inventoryApplyCount, setInventoryApplyCount] = useState(0);

  const toggleLineMode = (idx: number) => {
    setLineModes(prev => ({ ...prev, [idx]: prev[idx] === "new" ? "update" : "new" }));
  };

  const newProductGroups = productGroups.filter((_, i) => lineModes[i] === "new");
  const updateProductGroups = productGroups.map((g, i) => ({ ...g, _idx: i })).filter((_, i) => lineModes[i] === "update");

  const handleApplyInventoryUpdates = () => {
    let count = 0;
    updateProductGroups.forEach(g => {
      g.variants.forEach(v => {
        const loc = receivingLocation || storeLocations[0]?.name || "Main store";
        updateStock(v.sku, v.qty, loc);
        count++;
      });
      addAuditEntry("Inventory", `Inventory update: ${g.name} +${g.variants.reduce((s, v) => s + v.qty, 0)} units at ${receivingLocation || "Main store"}`);
    });
    incrementStockUpdates(count);
    setInventoryApplied(true);
    setInventoryApplyCount(count);
    addAuditEntry("Inventory", `${count} inventory updates applied`);
  };

  // Split / ungroup a grouped product into individual rows
  const handleSplitGroup = (idx: number) => {
    const group = productGroups[idx];
    if (!group.isGrouped) return;
    const newProducts: ProductGroup[] = group.variants.map(v => ({
      styleGroup: null as any,
      name: `${group.name} - ${v.option2Value || v.option1Value}`,
      brand: group.brand,
      type: group.type,
      colour: v.option2Value || group.colour || "",
      size: v.option1Value || group.size || "",
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
      colour: selected.map(s => s.colour).filter(Boolean).join(" / ") || "",
      size: selected.map(s => s.size).filter(Boolean).join(", ") || "",
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

  // ── Convert product groups to InvoiceLineItems for stock check ──
  const convertToStockCheckItems = (): InvoiceLineItem[] => {
    const items: InvoiceLineItem[] = [];
    for (const g of productGroups) {
      for (const v of g.variants) {
        items.push({
          styleNumber: g.vendorCode || g.styleGroup || "",
          styleName: g.name,
          colour: v.option1Value || g.colour || "",
          colourCode: "",
          size: v.option2Value || g.size || "",
          barcode: g.barcode || "",
          sku: v.sku || "",
          brand: g.brand,
          quantityOrdered: v.qty,
          rrp: v.rrp || g.rrp,
          wholesale: v.price || g.price,
          imageUrl: g.imageSrc || undefined,
          description: g.desc || undefined,
          productType: g.type || undefined,
        });
      }
    }
    return items;
  };

  // ── Convert products for Collection SEO ──
  const convertToCollectionProducts = () => {
    return productGroups.map(g => ({
      title: `${g.brand} ${g.name}`.trim(),
      vendor: g.brand,
      product_type: g.type || "",
      colour: g.colour || "",
      tags: g.type ? `${g.brand}, ${g.type}` : g.brand,
      price: g.rrp || g.price,
      style_number: g.vendorCode || g.styleGroup || "",
      description: g.desc || "",
    }));
  };

  // ── If stock check is active, render it instead ──
  if (stockCheckItems) {
    return (
      <StockCheckFlow
        lineItems={stockCheckItems}
        onBack={() => setStockCheckItems(null)}
        onComplete={() => { setStockCheckItems(null); }}
      />
    );
  }

  // ── If price lookup is active, render it instead ──
  if (priceLookupActive) {
    const firstProduct = productGroups[0];
    return (
      <PriceLookup
        onBack={() => setPriceLookupActive(false)}
        initialProduct={firstProduct ? {
          product_name: firstProduct.name || "",
          supplier: firstProduct.brand || "",
          style_number: firstProduct.vendorCode || "",
          colour: firstProduct.colour || "",
          supplier_cost: firstProduct.price || undefined,
        } : undefined}
      />
    );
  }

  // ── Bulk price lookup across every product in this invoice ──
  if (bulkPriceLookupActive) {
    return (
      <PriceLookup
        onBack={() => setBulkPriceLookupActive(false)}
        bulkItems={productGroups.map(p => ({
          product_name: p.name || "",
          supplier: p.brand || "",
          style_number: p.vendorCode || "",
          colour: p.colour || "",
          supplier_cost: p.price || undefined,
        }))}
      />
    );
  }

  // ── If collection SEO is active, render it instead ──
  if (collectionSeoActive) {
    return (
      <CollectionSEOFlow
        onBack={() => setCollectionSeoActive(false)}
        products={convertToCollectionProducts()}
      />
    );
  }

  // ── If price match is active, render it instead ──
  if (priceMatchActive) {
    const items = mapInvoiceItemsToPriceMatch(productGroups as any);
    return <PriceMatchPanel lineItems={items} onBack={() => setPriceMatchActive(false)} />;
  }

  // ── If product descriptions is active, render it instead ──
  if (descriptionsActive) {
    const items = mapInvoiceItemsToPriceMatch(productGroups as any);
    return <ProductDescriptionPanel lineItems={items} onBack={() => setDescriptionsActive(false)} />;
  }

  // ── If image helper is active, render it pre-scoped to current invoice ──
  if (imageHelperActive) {
    const scopedProducts = productGroups
      .filter((g: any) => g.name)
      .map((g: any) => ({
        title: g.name,
        sku: g.vendorCode || g.sku || "",
        colour: g.colour || "",
        brand: g.brand || "",
        type: g.type || "",
        imageSrc: g.imageSrc || (g.imageUrls && g.imageUrls[0]) || "",
        imageUrls: g.imageUrls || [],
      }));
    return (
      <ImageHelperPanel
        onBack={() => setImageHelperActive(false)}
        products={scopedProducts}
        scopeLabel="this invoice"
      />
    );
  }

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

      {/* Full-screen drag overlay — appears whenever a file is dragged anywhere over the page on Step 1 */}
      {step === 1 && isWindowDragging && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Drop file to upload invoice"
          aria-live="assertive"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className="fixed inset-0 z-[100] hidden sm:flex items-center justify-center bg-background/80 backdrop-blur-sm animate-fade-in p-8"
        >
          <div
            className={cn(
              "w-full max-w-2xl rounded-2xl border-4 border-dashed flex flex-col items-center justify-center gap-5 p-12 transition-all",
              isDragOverTarget
                ? "border-primary bg-primary/15 scale-[1.02] shadow-2xl shadow-primary/20"
                : "border-primary/50 bg-card/80"
            )}
          >
            <div
              className={cn(
                "w-20 h-20 rounded-full flex items-center justify-center transition-all",
                isDragOverTarget ? "bg-primary text-primary-foreground scale-110" : "bg-primary/15 text-primary"
              )}
            >
              <Upload className="w-9 h-9" />
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-display font-semibold text-foreground">
                {isDragOverTarget ? "Release to upload" : "Drop your invoice anywhere"}
              </h2>
              <p className="text-sm text-muted-foreground max-w-md">
                We accept PDF, Excel, CSV, Word documents, and photos (JPG, PNG, HEIC, WebP). Sonic Invoices will read it automatically.
              </p>
              <p className="text-xs text-muted-foreground/70 pt-1">
                Press <kbd className="px-1.5 py-0.5 rounded bg-muted text-foreground font-mono text-[10px]">Esc</kbd> to cancel
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Step 1: Upload */}
      {step === 1 && (
        <div className="px-4 pt-6">
          {/* Vendor / Supplier name — set BEFORE upload so CSV vendor is never "Unknown" */}
          <div className="bg-card rounded-lg border border-border p-3 mb-4">
            <label className="text-xs font-medium mb-1.5 block">
              Vendor / Supplier name
              <span className="text-muted-foreground font-normal"> (recommended)</span>
            </label>
            <input
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              placeholder="e.g. OM Designs, Sunseeker, Jantzen"
              className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm"
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">
              This becomes the Vendor in your CSV and helps the AI match prior templates. Set it now to avoid "Unknown" appearing in product names.
            </p>
          </div>

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
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onPaste={handlePaste}
            tabIndex={0}
            aria-label="Upload invoice — click, drag and drop, or paste a file"
            className={cn(
              "w-full h-48 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-3 transition-all focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background",
              isDragOver
                ? "border-primary bg-primary/10 scale-[1.01]"
                : "border-border bg-card active:bg-muted hover:border-primary/40"
            )}
          >
            <div className={cn(
              "w-14 h-14 rounded-full flex items-center justify-center transition-colors",
              isDragOver ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"
            )}>
              <Upload className="w-6 h-6" />
            </div>
            <div className="text-center px-4">
              <p className="text-sm font-medium">
                {isDragOver ? "Drop to upload" : "Tap, drop, or paste invoice"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">PDF · Excel · CSV · Word · JPG · PNG</p>
              <p className="text-[11px] text-muted-foreground/70 mt-0.5 hidden sm:block">
                Drag a file from your desktop, or press ⌘/Ctrl+V to paste a screenshot
              </p>
              <p className="text-[11px] text-muted-foreground/70 mt-0.5 sm:hidden">
                📷 Tap to choose a photo or PDF — AI reads it automatically
              </p>
            </div>
          </button>

          {/* Hidden file inputs */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.xlsx,.xls,.csv,.doc,.docx,.jpg,.jpeg,.png,.heic,.webp"
            onChange={handleFileChosen}
            className="hidden"
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChosen}
            className="hidden"
          />

          <POSPickerDialog
            open={posPickerOpen}
            onClose={() => setPOSPickerOpen(false)}
            onPicked={handlePOSPicked}
          />

          <button
            onClick={handleCameraSelect}
            className="w-full mt-3 h-12 rounded-lg border border-border bg-card flex items-center justify-center gap-2 text-sm active:bg-muted"
          >
            <Camera className="w-4 h-4 text-primary" />
            Take a photo
          </button>

          <button
            onClick={() => setDriveImportOpen(true)}
            className="w-full mt-2 h-12 rounded-lg border border-border bg-card flex items-center justify-center gap-2 text-sm active:bg-muted"
          >
            <CloudDownload className="w-4 h-4 text-primary" />
            Import from Google Drive
          </button>

          <div className="mt-3">
            <DriveQueuePanel />
          </div>

          {localQueue.length > 0 && (
            <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3" aria-live="polite">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold">
                  Drop batch · {localQueue.filter(q => q.status === "done").length}/{localQueue.length} processed
                  {localQueue.some(q => q.status === "failed") && (
                    <span className="ml-2 text-destructive">
                      · {localQueue.filter(q => q.status === "failed").length} failed
                    </span>
                  )}
                </p>
                <button
                  onClick={() => setLocalQueue([])}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Clear batch
                </button>
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {localQueue.map((q, i) => (
                  <div key={`${q.file.name}-${i}`} className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="w-4 shrink-0 text-center">
                        {q.status === "done" && "✅"}
                        {q.status === "processing" && "⏳"}
                        {q.status === "queued" && "•"}
                        {q.status === "failed" && "❌"}
                      </span>
                      <span
                        className={cn(
                          "truncate flex-1",
                          q.status === "done" && "text-muted-foreground line-through",
                          q.status === "failed" && "text-destructive",
                        )}
                      >
                        {q.file.name}
                      </span>
                      <span
                        className={cn(
                          "text-[10px] capitalize",
                          q.status === "failed" ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {q.status}
                      </span>
                      {q.status === "processing" && (
                        <button
                          onClick={() => skipCurrentBatchFile("Skipped by user")}
                          className="text-[10px] text-muted-foreground hover:text-foreground underline"
                          title="Mark this file as failed and continue with the next one"
                        >
                          Skip & continue
                        </button>
                      )}
                    </div>
                    {q.status === "failed" && q.errorMessage && (
                      <p className="text-[10px] text-destructive/80 pl-6 truncate" title={q.errorMessage}>
                        Reason: {q.errorMessage}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">
                Each file becomes its own history entry. Failed files are flagged here and skipped so the rest of the batch still processes.
              </p>
            </div>
          )}

          {driveImportOpen && (
            <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !driveImporting && setDriveImportOpen(false)}>
              <div className="bg-card border border-border rounded-lg p-4 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
                {driveStage === "link" ? (
                  <>
                    <h3 className="text-sm font-semibold mb-1">Import invoices from Google Drive</h3>
                    <p className="text-xs text-muted-foreground mb-3">
                      Paste a folder link to auto-process every invoice inside, or a single file link.
                      The folder must be shared as <strong>"Anyone with the link"</strong>.
                    </p>
                    <input
                      value={driveImportUrl}
                      onChange={(e) => setDriveImportUrl(e.target.value)}
                      placeholder="https://drive.google.com/drive/folders/..."
                      className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm mb-3"
                      disabled={driveImporting}
                      onKeyDown={(e) => { if (e.key === "Enter") void handleDriveListFiles(); }}
                    />
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => setDriveImportOpen(false)}
                        disabled={driveImporting}
                        className="h-9 px-3 rounded-md border border-border text-sm hover:bg-muted disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleDriveListFiles}
                        disabled={driveImporting}
                        className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                      >
                        {driveImporting ? "Fetching…" : "Next"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <h3 className="text-sm font-semibold mb-1">
                      Process {drivePreview.length} invoice{drivePreview.length === 1 ? "" : "s"}?
                    </h3>
                    <p className="text-xs text-muted-foreground mb-3">
                      Each invoice will be auto-loaded for extraction one after another. Review and accept
                      each one when it's ready — the next file loads automatically.
                    </p>
                    <div className="max-h-56 overflow-y-auto rounded-md border border-border divide-y divide-border mb-3">
                      {drivePreview.map((f, i) => (
                        <div key={`${f.id}-${i}`} className="flex items-center gap-2 px-2.5 py-2 text-xs">
                          <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate flex-1">{f.name}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => { setDriveStage("link"); setDrivePreview([]); }}
                        className="h-9 px-3 rounded-md border border-border text-sm hover:bg-muted"
                      >
                        Back
                      </button>
                      <button
                        onClick={handleDriveConfirmAutoProcess}
                        className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90"
                      >
                        Auto-process all
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

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


          {/* Process As selector */}
          <div className="mt-4 bg-card rounded-lg border border-border p-3">
            <div className="flex items-center gap-2 mb-2">
              <Settings className="w-4 h-4 text-primary" />
              <span className="text-xs font-semibold">Process as:</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {([
                { value: "auto", label: "🤖 Auto-detect", desc: "AI classifies the document type" },
                { value: "invoice", label: "📄 Invoice", desc: "Has prices & quantities" },
                { value: "packing_slip", label: "📦 Packing Slip", desc: "Items & qty, no prices" },
                { value: "handwritten", label: "✍️ Handwritten", desc: "Low-structure document" },
              ] as { value: ProcessAsMode; label: string; desc: string }[]).map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setProcessAs(opt.value)}
                  className={`text-left px-3 py-2 rounded-md border text-xs transition-colors ${
                    processAs === opt.value
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-muted/30 text-muted-foreground"
                  }`}
                >
                  <span className="font-medium block">{opt.label}</span>
                  <span className="text-[10px] opacity-70">{opt.desc}</span>
                </button>
              ))}
            </div>
            {/* Supplier template option */}
            {matchedTemplate && (
              <button
                onClick={() => setProcessAs("supplier_template")}
                className={`w-full mt-1.5 text-left px-3 py-2 rounded-md border text-xs transition-colors ${
                  processAs === "supplier_template"
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-muted/30 text-muted-foreground"
                }`}
              >
                <span className="font-medium block">⚡ Use {matchedTemplate.supplier} Template</span>
                <span className="text-[10px] opacity-70">
                  {getLayoutLabel(matchedTemplate.layoutType)} · {matchedTemplate.successCount} uses
                </span>
              </button>
            )}
          </div>

          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-2 mt-4 text-sm text-muted-foreground"
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${showDetails ? "rotate-180" : ""}`} />
            Invoice details
          </button>
          {showDetails && (
            <div className="mt-3 space-y-3">
              {/* Supplier dropdown with free-text fallback */}
              <div className="relative">
                <input
                  list="supplier-options"
                  type="text"
                  placeholder="Select or type supplier name"
                  value={supplierName}
                  onChange={e => setSupplierName(e.target.value)}
                  className="w-full h-11 rounded-lg bg-input border border-border px-3 text-sm"
                />
                <datalist id="supplier-options">
                  {supplierList.map(s => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>

              {/* DB Template indicator */}
              {dbTemplate && (
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-2 flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5 text-primary" />
                  <span className="text-xs text-primary font-medium">⚡ Rule-based template found — instant extraction, no AI needed</span>
                </div>
              )}

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

          {/* ── Custom requirements for THIS invoice ─────────────────
              Appears prominently after upload. Supplier brain auto-loads
              any instructions saved from prior invoices of the same supplier
              (see CustomInstructionsField → getTemplates effect). */}
          <div id="custom-requirements-panel" className={uploadedFile ? "mt-6 ring-2 ring-primary/30 rounded-lg" : "mt-6"}>
            {uploadedFile && (
              <div className="bg-primary/10 border border-primary/30 rounded-t-lg px-4 py-2.5 flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-primary truncate">📎 {uploadedFile.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Add any custom requirements specific to this invoice below — sizing rules, vendor naming, abbreviations, anything the AI should know.
                  </p>
                </div>
              </div>
            )}
            <CustomInstructionsField
              value={customInstructions}
              onChange={setCustomInstructions}
              supplierName={supplierName}
            />
            <BrainModeToggle />
          </div>

          {/* Start processing — only once a file has been chosen */}
          {uploadedFile && (
            <Button
              variant="success"
              className="w-full h-14 mt-4 text-base"
              onClick={handleStartProcessingClick}
            >
              <Zap className="w-5 h-5 mr-2" />
              Start processing {customInstructions.trim() ? "with custom rules" : "invoice"}
            </Button>
          )}

          <button
            className="mt-6 text-sm text-primary font-medium hover:underline"
            onClick={() => setPriceLookupActive(true)}
          >
            Or enter products manually →
          </button>
        </div>
      )}

      {/* Step 2: Enrichment with live progress */}
      {step === 2 && (
        <div className="px-4 pt-4">
          {(() => {
            const total = enrichLines.length;
            const done = enrichLines.filter(l => l.status === "done" || l.status === "review" || l.status === "not_found").length;
            const inProgress = enrichLines.filter(l => l.status === "searching" || l.status === "extracting").length;
            const waiting = enrichLines.filter(l => l.status === "waiting").length;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;

            // Honest ETA — never claims "~3s" while elapsed > 3s.
            // If we have completed lines, project remaining from observed pace.
            // Otherwise show "Estimating…" rather than a fake number.
            const etaResult = total > 0 && done > 0
              ? estimateEta({ elapsedSeconds: processingElapsed, completedStages: done, totalStages: total })
              : null;
            const etaLabel: string = etaResult == null
              ? (processingElapsed < 5 ? "Estimating…" : "Still working — large or unfamiliar invoice")
              : etaResult.capped
                ? "Still working — large or unfamiliar invoice"
                : `~${formatDuration(etaResult.etaSeconds)} remaining`;

            // Variants extracted from product groups so the Reading screen reports
            // the same number the Review screen will show — no more "3 vs 22"
            // contradictions (Bug #6).
            const variantCount = productGroups.reduce(
              (s, g) => s + (g.variants?.length || 0),
              0,
            );

            return (
              <>
                {/* Completion summary overlay */}
                {showCompletionSummary && (
                  <div className="bg-card rounded-lg border border-border p-5 mb-4">
                    <div className="flex items-center gap-2 mb-4">
                      <Check className="w-5 h-5 text-success" />
                      <h3 className="text-lg font-semibold font-display">Processing complete</h3>
                    </div>
                    <p className="text-sm text-muted-foreground mb-4">
                      {total} {total === 1 ? "row" : "rows"} → {variantCount || total} {variantCount === 1 ? "variant" : "variants"} processed in {formatDuration(finalProcessingTime)}
                    </p>
                    <div className="bg-muted/50 rounded-lg border border-border divide-y divide-border overflow-hidden mb-4">
                      <div className="flex items-center justify-between px-4 py-2.5">
                        <span className="text-sm flex items-center gap-2"><Check className="w-3.5 h-3.5 text-success" /> Ready to export</span>
                        <span className="text-sm font-mono-data">{enrichLines.filter(l => l.status === "done").length} lines ({total > 0 ? Math.round(enrichLines.filter(l => l.status === "done").length / total * 100) : 0}%)</span>
                      </div>
                      <div className="flex items-center justify-between px-4 py-2.5">
                        <span className="text-sm flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5 text-secondary" /> Review recommended</span>
                        <span className="text-sm font-mono-data">{enrichLines.filter(l => l.status === "review").length} lines ({total > 0 ? Math.round(enrichLines.filter(l => l.status === "review").length / total * 100) : 0}%)</span>
                      </div>
                      <div className="flex items-center justify-between px-4 py-2.5">
                        <span className="text-sm flex items-center gap-2"><X className="w-3.5 h-3.5 text-destructive" /> Not found</span>
                        <span className="text-sm font-mono-data">{enrichLines.filter(l => l.status === "not_found").length} lines ({total > 0 ? Math.round(enrichLines.filter(l => l.status === "not_found").length / total * 100) : 0}%)</span>
                      </div>
                    </div>
                    {enrichLines.some(l => l.status === "review" || l.status === "not_found") && (
                      <p className="text-xs text-muted-foreground mb-4">
                        {enrichLines.filter(l => l.status === "review" || l.status === "not_found").length} product{enrichLines.filter(l => l.status === "review" || l.status === "not_found").length > 1 ? "s" : ""} tagged NEEDS-ENRICHMENT — search manually before importing.
                      </p>
                    )}
                    <div className="flex gap-2 flex-wrap">
                      <Button variant="teal" className="flex-1 h-11" onClick={handleProceedToReview}>
                        → Review & export
                      </Button>
                      {enrichLines.some(l => l.status === "review" || l.status === "not_found") && (
                        <Button variant="outline" className="flex-1 h-11 text-xs" onClick={() => { setFilterReviewOnly(true); handleProceedToReview(); }}>
                          Review issues first
                        </Button>
                      )}
                      {/* Teach this supplier button — shown when no DB template exists */}
                      {!dbTemplate && supplierName.trim() && detectedHeaders.length > 0 && (
                        <Button
                          variant="outline"
                          className="w-full h-9 text-xs border-dashed border-primary/50 text-primary"
                          onClick={() => setShowTeachModal(true)}
                        >
                          <Settings className="w-3.5 h-3.5 mr-1" />
                          Teach this supplier for instant future extraction
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* Cancelled state */}
                {processingCancelled && !showCompletionSummary && (
                  <div className="bg-secondary/10 border border-secondary/20 rounded-lg p-4 mb-4">
                    <p className="text-sm font-medium mb-1">⏹ Processing stopped</p>
                    <p className="text-xs text-muted-foreground mb-3">
                      {done}/{total} lines enriched.
                    </p>
                    <div className="flex gap-2">
                      <Button size="sm" className="h-8 text-xs" onClick={handleResumeProcessing}>
                        <RotateCcw className="w-3 h-3 mr-1" /> Resume
                      </Button>
                      <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleProceedToReview}>
                        Review partial results →
                      </Button>
                    </div>
                  </div>
                )}

                {/* Fingerprint pre-message — shown above the progress bar when layout was recognised */}
                {!showCompletionSummary && matchMethod === "fingerprint_match" && fingerprintHit && (
                  <div className="bg-success/10 border border-success/30 rounded-lg px-3 py-2 mb-3 flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-success shrink-0" />
                    <p className="text-xs text-success">
                      Recognised invoice layout{supplierName ? ` from ${supplierName}` : ""} — skipping full extraction
                    </p>
                  </div>
                )}

                {/* Status overview bar */}
                {!showCompletionSummary && (
                  <div className="bg-card rounded-lg border border-border p-4 mb-4">
                    {/* Extraction method badge */}
                    <div className="flex items-center gap-2 mb-3">
                      {matchMethod === "fingerprint_match" && (
                        <Badge className="bg-success/15 text-success border-success/30 hover:bg-success/15 text-[10px] font-medium">
                          ✓ Layout recognised — using saved fingerprint
                        </Badge>
                      )}
                      {matchMethod === "supplier_match" && (
                        <Badge className="bg-primary/15 text-primary border-primary/30 hover:bg-primary/15 text-[10px] font-medium">
                          ◆ Supplier recognised — using saved rules
                        </Badge>
                      )}
                      {matchMethod === "full_extraction" && (
                        <Badge className="bg-secondary/15 text-secondary border-secondary/30 hover:bg-secondary/15 text-[10px] font-medium">
                          ⚙ Full extraction — learning new layout
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-xs mb-3">
                      <div className="flex gap-3">
                        <span className="text-muted-foreground">{total} lines</span>
                        <span className="text-success">✓ {done} enriched</span>
                        {inProgress > 0 && <span className="text-primary">⚙ {inProgress} in progress</span>}
                        {waiting > 0 && <span className="text-muted-foreground">○ {waiting} pending</span>}
                      </div>
                      <span className="text-muted-foreground font-mono-data">
                        {processingDone
                          ? `✅ Complete in ${formatDuration(finalProcessingTime)}`
                          : etaLabel}
                      </span>
                    </div>
                    <div className="relative h-2.5 rounded-full bg-muted overflow-hidden">
                      {!processingDone && (
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/10 to-transparent animate-loading-bar" />
                      )}
                      <div
                        className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary to-primary/70 rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-xs font-semibold text-primary">{pct}%</span>
                      <span className="text-[10px] text-muted-foreground font-mono-data">
                        ⏱ {formatDuration(processingElapsed)} elapsed{variantCount > 0 ? ` · ${total} ${total === 1 ? "row" : "rows"} → ${variantCount} variants` : ""}
                      </span>
                    </div>
                  </div>
                )}

                {/* Line-by-line status table */}
                {!showCompletionSummary && (
                  <div className="bg-card rounded-lg border border-border overflow-hidden mb-4">
                    <div className="px-3 py-2 border-b border-border bg-muted/30">
                      <div className="grid grid-cols-[24px_1fr_90px_1fr_50px] gap-2 text-[10px] font-semibold text-muted-foreground uppercase">
                        <span>#</span>
                        <span>Product</span>
                        <span>Status</span>
                        <span>Current action</span>
                        <span>Conf.</span>
                      </div>
                    </div>
                    <div className="divide-y divide-border">
                      {enrichLines.map((line, i) => (
                        <div key={i} className="grid grid-cols-[24px_1fr_90px_1fr_50px] gap-2 items-center px-3 py-2 text-xs">
                          <span className="text-muted-foreground">{i + 1}</span>
                          <span className="truncate font-medium">{line.name}</span>
                          <span className={`flex items-center gap-1 text-[11px] font-medium ${
                            line.status === "waiting" ? "text-muted-foreground" :
                            line.status === "searching" || line.status === "extracting" ? "text-primary" :
                            line.status === "done" ? "text-success" :
                            line.status === "review" ? "text-secondary" :
                            "text-destructive"
                          }`}>
                            {line.status === "waiting" && "○ Waiting"}
                            {line.status === "searching" && <><Loader2 className="w-3 h-3 animate-spin" /> Searching</>}
                            {line.status === "extracting" && <><Loader2 className="w-3 h-3 animate-spin" /> Extracting</>}
                            {line.status === "done" && "✓ Done"}
                            {line.status === "review" && "⚠ Review"}
                            {line.status === "not_found" && "✗ Not found"}
                          </span>
                          <span className="text-muted-foreground truncate text-[11px]">{line.action}</span>
                          <span className={`font-mono-data text-[11px] ${
                            line.confidence >= 90 ? "text-success" :
                            line.confidence >= 70 ? "text-secondary" :
                            line.confidence > 0 ? "text-destructive" :
                            "text-muted-foreground"
                          }`}>
                            {line.confidence > 0 ? `${line.confidence}%` : "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Cancel button */}
                {!processingDone && !processingCancelled && (
                  <Button
                    variant="ghost"
                    className="w-full text-destructive hover:text-destructive hover:bg-destructive/10 h-10"
                    onClick={handleCancelProcessing}
                  >
                    ⏹ Cancel processing
                  </Button>
                )}
              </>
            );
          })()}
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
                Sonic Invoice detected a consistent layout for {supplierName || "this supplier"}'s invoices. Save it so future invoices parse instantly.
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

          {/* ── Phase 3 + 4 — Stock check & enrichment (additive, mounts above review) ── */}
          {validatedProducts.length > 0 && (
            <PhaseThreeFourPanel
              products={validatedProducts}
              supplierName={supplierName}
              onProceed={() => {
                document.getElementById("post-parse-review-anchor")?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
              }}
            />
          )}

          {/* ── Brain Mode banners (5-stage pipeline) ── */}
          {brainRecognised && <BrainRecognitionBanner supplierName={brainRecognised} />}
          {brainSummary && <BrainSummaryBanner summary={brainSummary} />}
          {needsTeach && (
            <TeachSonicWizard
              initialSupplier={supplierName}
              onCancel={() => setNeedsTeach(false)}
              onComplete={(tpl) => {
                setSupplierName(tpl.supplier_name);
                void contributeSharedProfile({
                  supplier_name: tpl.supplier_name,
                  detected_pattern: tpl.detected_pattern,
                  column_map: tpl.column_map,
                  gst_treatment: tpl.gst_treatment,
                  has_rrp: tpl.has_rrp,
                  sku_format: "unknown",
                  size_in_sku: false,
                  colour_in_name: false,
                  correction_rate: 0,
                });
                toast.success("Saved — Sonic will recognise this supplier next time");
                setNeedsTeach(false);
              }}
            />
          )}

          {/* Post-Parse Review Screen */}
          {validationDebug && validatedProducts.length > 0 && (
            <div className="mb-3" id="post-parse-review-anchor">
              <PostParseReviewScreen
                debug={validationDebug}
                products={validatedProducts}
                supplierName={supplierName}
                invoicePages={invoicePageImages}
                detectedHeaders={detectedHeaders}
                detectedLayout={detectedLayout}
                onUpdateProducts={(updated) => {
                  // Track row additions / deletions for quality metrics
                  const prev = lastRowCountRef.current ?? validatedProducts.length;
                  const next = updated.length;
                  if (next > prev) rowsAddedRef.current += next - prev;
                  else if (next < prev) rowsDeletedRef.current += prev - next;
                  lastRowCountRef.current = next;

                  // Shadow-log: diff each row's title/sku/cost/qty against the prior
                  // snapshot. Value-based classification — anything that actually
                  // changed is logged as feedback_type='edit' regardless of which
                  // button the user clicked (catches the Marrakesh case).
                  try {
                    const prevById = new Map(validatedProducts.map(p => [p._rowIndex, p]));
                    for (const p of updated) {
                      const before = prevById.get(p._rowIndex);
                      if (!before) continue;
                      const fields: { field: string; o: unknown; c: unknown }[] = [
                        { field: "title", o: before.name, c: p.name },
                        { field: "sku", o: before.sku, c: p.sku },
                        { field: "cost", o: before.cost, c: p.cost },
                        { field: "qty", o: before.qty, c: p.qty },
                        { field: "brand", o: before.brand, c: p.brand },
                      ];
                      for (const { field, o, c } of fields) {
                        if (JSON.stringify(o ?? null) !== JSON.stringify(c ?? null)) {
                          void logShadowFeedback({
                            feedbackType: "edit",
                            field,
                            original: o,
                            corrected: c,
                            supplier: supplierName,
                          });
                        }
                      }
                    }
                  } catch { /* ignore */ }

                  setValidatedProducts(updated);
                  // Rebuild product groups from accepted products
                  const acceptedOnly = updated.filter(p => !p._rejected);
                  const clean = acceptedOnly.map(({ _confidence, _confidenceLevel, _issues, _corrections, _rejected, _rejectReason, _classification, _suggestedTitle, _suggestedPrice, _suggestedVendor, _rowIndex, _rawName, _rawCost, ...rest }) => rest);
                  const groups = convertToProductGroups(clean);
                  setProductGroups(groups);
                }}
                onCellEdited={(field) => {
                  editCountRef.current += 1;
                  fieldsCorrectedRef.current.add(field);
                }}
                onExportAccepted={() => {
                  if (brainContextRef.current && brainProducts && brainRecognised !== undefined) {
                    void saveBrainLearnings({
                      supplierName: supplierName || brainRecognised,
                      orientation: brainContextRef.current.orientation,
                      layout: brainContextRef.current.layout,
                      acceptedProducts: brainProducts,
                      correctionCount: editCountRef.current,
                      classification: brainClassificationRef.current ?? undefined,
                    });
                  }
                  void (async () => {
                    await logShadowStep({ step: "stock_check", status: "done", narrative: `Accepted ${validatedProducts.filter(p => !p._rejected).length} products.` });
                    await logShadowStep({ step: "price", status: "needs_review", narrative: "Price review awaiting approval." });
                    await logShadowStep({ step: "publish", status: "needs_review", narrative: "Export / push gate ready." });
                  })();
                  finalizeQualityMetrics(); persistInvoiceToDb(); setStep(4);
                }}
                onPushToShopify={() => {
                  void (async () => {
                    await logShadowStep({ step: "stock_check", status: "done", narrative: "Stock check approved." });
                    await logShadowStep({ step: "publish", status: "done", narrative: "Pushed to Shopify." });
                    await completeShadowSession("Run complete — pushed to Shopify.");
                  })();
                  finalizeQualityMetrics(); persistInvoiceToDb(); setStep(4);
                }}
                onPriceMatch={() => setPriceMatchActive(true)}
                onGetDescriptions={() => setDescriptionsActive(true)}
                onBack={() => setStep(2)}
                matchMethod={matchMethod}
                onReprocessDetailed={handleReprocessDetailed}
                isReprocessing={isReprocessing}
                underExtractionWarning={underExtractionWarning}
                fieldConfidence={aiFieldConfidence}
                extractionNotes={aiExtractionNotes}
                qtyHeaderWarnings={qtyHeaderWarnings}
                watchdogRun={watchdogRun}
              />
            </div>
          )}

          {/* ── Phase 5 + 6 — Prepare tabs & Export hub (additive, mounts below review) ── */}
          {validatedProducts.length > 0 && (
            <PhaseFiveSixPanel
              products={validatedProducts}
              supplierName={supplierName}
              onExportCSV={() => {
                void (async () => {
                  await logShadowStep({ step: "publish", status: "done", narrative: "Exported CSV." });
                  await completeShadowSession("Run complete — CSV exported.");
                })();
                finalizeQualityMetrics(); persistInvoiceToDb(); setStep(4);
              }}
              onPushToShopify={() => {
                void (async () => {
                  await logShadowStep({ step: "publish", status: "done", narrative: "Pushed to Shopify." });
                  await completeShadowSession("Run complete — pushed to Shopify.");
                })();
                finalizeQualityMetrics(); persistInvoiceToDb(); setStep(4);
              }}
              onProcessAnother={() => { setStep(1); }}
            />
          )}

          {processingDone && finalProcessingTime > 0 && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-2.5 mb-3 space-y-1.5">
              <span className="text-xs text-primary font-medium font-mono-data block">
                ✅ {totalVariantLines} lines → {productGroups.length} products ({groupedCount} grouped + {standaloneCount} standalone) · {totalQty} total units · enriched in {finalProcessingTime < 60 ? `${finalProcessingTime}s` : `${Math.floor(finalProcessingTime / 60)}m ${finalProcessingTime % 60}s`}
              </span>
              <div className="flex flex-wrap gap-2 text-[11px]">
                <span className="text-muted-foreground">{productGroups.length} lines ·</span>
                <span className="text-success font-medium">{confCounts.high} ready ✓</span>
                <span className="text-warning font-medium">{confCounts.medium} review ⚠</span>
                {confCounts.low > 0 && <span className="text-destructive font-medium">{confCounts.low} fix needed ✗</span>}
              </div>
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

          {/* Mode tabs */}
          <div className="flex gap-1 mb-4 bg-muted/50 rounded-lg p-1">
            <button
              onClick={() => setReviewTab("new")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-colors ${reviewTab === "new" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"}`}
            >
              <PackagePlus className="w-3.5 h-3.5" /> 🆕 New products ({newProductGroups.length})
            </button>
            <button
              onClick={() => setReviewTab("update")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-colors ${reviewTab === "update" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"}`}
            >
              <Package className="w-3.5 h-3.5" /> 📦 Update stock ({updateProductGroups.length})
            </button>
          </div>

          {/* Confidence filter buttons */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {([
              { key: "all" as const, label: `All ${productGroups.length}`, cls: "" },
              { key: "high" as const, label: `✓ Ready ${confCounts.high}`, cls: "text-success" },
              { key: "medium" as const, label: `⚠ Review ${confCounts.medium}`, cls: "text-warning" },
              { key: "low" as const, label: `✗ Fix needed ${confCounts.low}`, cls: "text-destructive" },
            ]).map(f => (
              <button
                key={f.key}
                onClick={() => setConfidenceFilter(f.key)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                  confidenceFilter === f.key
                    ? "bg-primary/10 border-primary text-primary"
                    : `bg-muted border-border ${f.cls || "text-muted-foreground"}`
                }`}
              >
                {f.label}
              </button>
            ))}
            {(confCounts.medium > 0 || confCounts.low > 0) && (
              <button
                onClick={() => {
                  setConfidenceFilter(confCounts.low > 0 ? "low" : "medium");
                }}
                className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-muted border border-border text-muted-foreground ml-auto flex items-center gap-1"
              >
                <ArrowDown className="w-3 h-3" /> Jump to next issue
              </button>
            )}
          </div>

          {/* Enrichment status bar */}
          {(() => {
            const enrichedCount = productGroups.filter(g => g.enriched).length;
            const withImg = productGroups.filter(g => g.imageSrc).length;
            return enrichedCount > 0 ? (
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-2 mb-3 flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="text-xs text-primary font-medium">
                  {enrichedCount}/{productGroups.length} enriched · {withImg} with images
                </span>
              </div>
            ) : null;
          })()}

          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm font-medium">{productGroups.length} products found</p>
              <p className="text-[10px] text-muted-foreground">{totalVariantLines} lines → {groupedCount} grouped + {standaloneCount} standalone</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={runEnrichAll}
                disabled={enrichAllRunning}
                className="gap-1"
              >
                {enrichAllRunning ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Enriching {enrichProgress.current}/{enrichProgress.total}...</>
                ) : (
                  <><Zap className="w-3.5 h-3.5" /> ✦ Enrich all</>
                )}
              </Button>
              {mergeSelection.length >= 2 ? (
                <Button variant="outline" size="sm" onClick={handleMergeSelected} className="gap-1 text-primary border-primary">
                  <Link className="w-3.5 h-3.5" /> Group {mergeSelection.length} as variants
                </Button>
              ) : mergeSelection.length > 0 ? (
                <span className="text-[10px] text-muted-foreground self-center">Select {2 - mergeSelection.length} more to group</span>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => setPreviewAll(true)} className="gap-1"><Eye className="w-3.5 h-3.5" /> Preview all</Button>
              <Button variant="outline" size="sm" onClick={() => setImageHelperActive(true)} className="gap-1"><ImageIcon className="w-3.5 h-3.5" /> Images</Button>
              <Button variant="outline" size="sm" onClick={() => setPriceMatchActive(true)} className="gap-1"><Tag className="w-3.5 h-3.5" /> Price Match</Button>
              <Button variant="teal" size="sm" onClick={() => { finalizeQualityMetrics(); setStep(4); }}>Download <ChevronRight className="w-3.5 h-3.5 ml-1" /></Button>
            </div>
          </div>
          {/* New products tab */}
          {reviewTab === "new" && (
            <div className="space-y-2">
              {productGroups.map((group, i) => {
                const conf = groupConfidences[i];
                if (confidenceFilter !== "all" && conf.level !== confidenceFilter) return null;
                const isUpdate = lineModes[i] === "update";
                return (
                  <div key={`p-${i}`}>
                    {/* Mode toggle + match source + confidence badge */}
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <button
                        onClick={() => toggleLineMode(i)}
                        className={`text-[10px] font-medium px-2 py-0.5 rounded-full transition-colors ${!isUpdate ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}
                      >
                        🆕 New
                      </button>
                      <button
                        onClick={() => toggleLineMode(i)}
                        className={`text-[10px] font-medium px-2 py-0.5 rounded-full transition-colors ${isUpdate ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}
                      >
                        📦 Update
                      </button>
                      {isUpdate && (
                        <span className="text-[10px] text-success">→ Will update existing stock</span>
                      )}
                      {/* Match source badge */}
                      <MatchSourceBadge source={group.matchSource || "none"} barcode={group.barcode} />
                      {/* Parse confidence from validator */}
                      {validatedProducts.length > 0 && (() => {
                        const vp = validatedProducts.find(v => !v._rejected && v.name === group.name);
                        if (!vp) return null;
                        const cls = vp._confidenceLevel === "high" ? "text-success" : vp._confidenceLevel === "medium" ? "text-warning" : "text-destructive";
                        return (
                          <span className={`text-[9px] font-medium ${cls}`} title={vp._issues.join(", ") || "No issues"}>
                            {vp._confidence}%
                          </span>
                        );
                      })()}
                      <span className="ml-auto"><ConfidenceBadge breakdown={conf} /></span>
                    </div>
                    {group.isGrouped ? (
                      <VariantGroupCard
                        group={group}
                        onSplit={() => handleSplitGroup(i)}
                        onPreview={() => setPreviewProduct(mockProducts.find(p => p.name === group.name) || mockProducts[0])}
                      />
                    ) : (
                      <div className="relative">
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
                            barcode: group.barcode,
                            matchSource: group.matchSource,
                            metafields: group.metafields,
                            costChange: costChanges.find(c => c.name === group.name)?.costChange || null,
                            isNew: costChanges.find(c => c.name === group.name)?.isNew,
                            enriched: group.enriched,
                            enriching: group.enriching,
                            imageSrc: group.imageSrc,
                            imageUrls: group.imageUrls,
                            desc: group.desc,
                            fabric: group.fabric,
                            care: group.care,
                            origin: group.origin,
                            productPageUrl: group.productPageUrl,
                            enrichConfidence: group.enrichConfidence,
                            enrichNote: group.enrichNote,
                          }}
                          onPreview={() => setPreviewProduct(mockProducts.find(p => p.name === group.name) || mockProducts[0])}
                          onEnrich={() => runEnrichment(i)}
                          onSetImage={(url) => setProductImage(i, url)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Inventory updates tab */}
          {reviewTab === "update" && (
            <div className="space-y-3">
              {inventoryApplied ? (
                <div className="bg-success/10 border border-success/20 rounded-lg p-4 text-center">
                  <Check className="w-8 h-8 text-success mx-auto mb-2" />
                  <p className="text-sm font-semibold text-success">✅ {inventoryApplyCount} inventory updates applied</p>
                  <p className="text-xs text-muted-foreground mt-1">Stock levels have been updated in your simulated inventory.</p>
                </div>
              ) : updateProductGroups.length === 0 ? (
                <div className="text-center py-10">
                  <Package className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-medium">No stock updates</p>
                  <p className="text-xs text-muted-foreground mt-1">Toggle products to "📦 Update" mode in the New Products tab to add stock updates here.</p>
                </div>
              ) : (
                <>
                  <div className="bg-card rounded-lg border border-border overflow-hidden">
                    <div className="px-3 py-2 border-b border-border bg-muted/30">
                      <div className="grid grid-cols-[1fr_60px_50px_60px_80px] gap-2 text-[10px] font-semibold text-muted-foreground uppercase">
                        <span>Product</span>
                        <span>Current</span>
                        <span>Adding</span>
                        <span>New total</span>
                        <span>Location</span>
                      </div>
                    </div>
                    <div className="divide-y divide-border">
                      {updateProductGroups.flatMap(g =>
                        g.variants.map((v, vi) => {
                          const existing = lookupInventory(v.sku);
                          const currentQty = existing?.qty || 0;
                          const newTotal = currentQty + v.qty;
                          const isLargeQty = v.qty >= 50;
                          return (
                            <div key={`${g._idx}-${vi}`} className={`grid grid-cols-[1fr_60px_50px_60px_80px] gap-2 items-center px-3 py-2.5 text-xs ${isLargeQty ? "bg-secondary/5" : ""}`}>
                              <div className="min-w-0">
                                <p className="truncate font-medium">{g.name}</p>
                                <p className="text-[10px] text-muted-foreground font-mono-data">{v.sku}</p>
                              </div>
                              <span className="text-muted-foreground font-mono-data">{currentQty}</span>
                              <span className="text-success font-mono-data font-semibold">+{v.qty}</span>
                              <span className="font-mono-data font-semibold">{newTotal}</span>
                              <span className="text-[10px] text-muted-foreground truncate">{existing?.location || receivingLocation || "Main store"}</span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {updateProductGroups.some(g => g.variants.some(v => v.qty >= 50)) && (
                    <div className="bg-secondary/10 border border-secondary/20 rounded-lg p-2 flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-secondary shrink-0" />
                      <span className="text-xs text-secondary">Large quantity detected — confirm this is correct</span>
                    </div>
                  )}

                  <p className="text-[10px] text-muted-foreground">
                    Inventory shown is simulated. Connect to Shopify to sync real stock levels.
                  </p>

                  <Button variant="teal" className="w-full h-11" onClick={handleApplyInventoryUpdates}>
                    <Check className="w-4 h-4 mr-1" /> Approve all updates ({updateProductGroups.reduce((s, g) => s + g.variants.length, 0)} items)
                  </Button>
                </>
              )}
            </div>
          )}

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
        <div className="px-4 pt-4 pb-24 animate-fade-in">
          {/* Confidence gate warning */}
          {confCounts.low > 0 && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 mb-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-destructive">⚠ {confCounts.low} line{confCounts.low > 1 ? "s need" : " needs"} attention before export</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {confCounts.high} lines ready to export · {confCounts.medium} lines need review · {confCounts.low} line{confCounts.low > 1 ? "s have" : " has"} issues
                  </p>
                  <div className="flex gap-2 mt-2">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setStep(3)}>
                      Review issues first
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => { finalizeQualityMetrics(); /* user explicitly bypassed gate; keep step 4 active */ }}>
                      Export all anyway
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
          {confCounts.low === 0 && (
            <div className="bg-success/10 border border-success/20 rounded-lg p-2 mb-4 flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-success shrink-0" />
              <span className="text-xs text-success font-medium">
                {confCounts.high} lines ready · {confCounts.medium} need review · All products exportable
              </span>
            </div>
          )}

          {/* Stock reconciliation status (auto-runs when entering export step) */}
          {connectedPlatformLabel && (reconciling || reconcileResult || reconcileError) && (
            <div className="bg-card border border-primary/20 rounded-lg p-4 mb-4">
              {reconciling && (
                <div className="flex items-center gap-3">
                  <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">Checking stock…</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Matching {productGroups.length} products against your {connectedPlatformLabel} catalog
                    </p>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-2">
                      <div className="h-full bg-primary transition-all" style={{ width: `${reconcileProgress}%` }} />
                    </div>
                  </div>
                </div>
              )}
              {!reconciling && reconcileResult && (
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                    <PackageCheck className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold">Stock check complete</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {reconcileResult.summary?.new_products ?? 0} new ·{" "}
                      {reconcileResult.summary?.exact_refills ?? 0} refills ·{" "}
                      {(reconcileResult.summary?.new_variants ?? 0) + (reconcileResult.summary?.new_colours ?? 0)} new variants ·{" "}
                      {reconcileResult.summary?.conflicts ?? 0} need review
                    </p>
                    <Button
                      size="sm"
                      variant="teal"
                      className="mt-3"
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent("sonic:reconciliation-ready", { detail: reconcileResult }));
                        window.dispatchEvent(new CustomEvent("sonic:navigate-flow", { detail: "stock_reconciliation" }));
                      }}
                    >
                      Review stock classification <ChevronRight className="w-3.5 h-3.5 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
              {!reconciling && reconcileError && (
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold">Stock check unavailable</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {reconcileError}. You can still export your invoice using the buttons below.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* No-platform banner */}
          {platformsChecked && !connectedPlatformLabel && (
            <div className="bg-muted/40 border border-border rounded-lg p-3 mb-4 flex items-center gap-3">
              <Package className="w-4 h-4 text-muted-foreground shrink-0" />
              <p className="text-xs text-muted-foreground flex-1">
                Connect Shopify or Lightspeed to automatically identify new vs existing stock.
              </p>
              <button
                className="text-xs text-primary font-medium hover:underline shrink-0"
                onClick={() => window.dispatchEvent(new CustomEvent("sonic:navigate-tab", { detail: "account" }))}
              >
                Connect →
              </button>
            </div>
          )}

          {/* Stock check prompt */}
          {!stockCheckPromptDismissed && (
            <div className="bg-card border border-primary/20 rounded-lg p-4 mb-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                  <PackageCheck className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold">Before pushing to Shopify, check stock levels?</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    The stock check compares every item against your live Shopify catalog and classifies each as a refill, new colour, or new product — so you don't accidentally create duplicates.
                  </p>
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" variant="teal" onClick={() => setStockCheckItems(convertToStockCheckItems())}>
                      <PackageCheck className="w-3.5 h-3.5 mr-1.5" /> Yes, check Shopify first
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground"
                      onClick={() => setStockCheckPromptDismissed(true)}
                    >
                      Skip — push as new products
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Price Lookup, Price Match & Collection SEO tools */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
            <div className="bg-card border border-border rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                  <DollarSign className="w-4 h-4 text-secondary-foreground" />
                </div>
                <div>
                  <p className="text-xs font-semibold">Price Lookup</p>
                  <p className="text-[10px] text-muted-foreground">Find retail prices online</p>
                </div>
              </div>
              <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => setPriceLookupActive(true)}>
                <Search className="w-3 h-3 mr-1" /> Look Up Prices
              </Button>
              {productGroups.length > 1 && (
                <Button size="sm" variant="outline" className="w-full text-xs mt-2" onClick={() => setBulkPriceLookupActive(true)}>
                  <Search className="w-3 h-3 mr-1" /> Bulk Look Up All {productGroups.length} Products
                </Button>
              )}
            </div>
            <div className="bg-card border border-border rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-success/15 flex items-center justify-center shrink-0">
                  <DollarSign className="w-4 h-4 text-success" />
                </div>
                <div>
                  <p className="text-xs font-semibold">Price Match</p>
                  <p className="text-[10px] text-muted-foreground">Compare RRP vs market (AUD)</p>
                </div>
              </div>
              <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => setPriceMatchActive(true)}>
                <Search className="w-3 h-3 mr-1" /> Match Prices
              </Button>
            </div>
            <div className="bg-card border border-border rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs font-semibold">Get Descriptions</p>
                  <p className="text-[10px] text-muted-foreground">Fetch supplier copy → Shopify/Lightspeed</p>
                </div>
              </div>
              <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => setDescriptionsActive(true)}>
                <FileText className="w-3 h-3 mr-1" /> Get Descriptions
              </Button>
            </div>
            <div className="bg-card border border-border rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                  <Link className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs font-semibold">Build Collections</p>
                  <p className="text-[10px] text-muted-foreground">SEO collection hierarchy</p>
                </div>
              </div>
              <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => setCollectionSeoActive(true)}>
                <Link className="w-3 h-3 mr-1" /> Build SEO Collections
              </Button>
            </div>
          </div>

          <ExportReviewScreen
            products={mockProducts.map((p, i) => ({
              ...p,
              hasImage: p.status === "ready",
              hasSeo: true,
              hasTags: true,
              confidence: groupConfidences[i]?.level === "high" ? "high" as const : groupConfidences[i]?.level === "low" ? "low" as const : "medium" as const,
              isNew: true,
            }))}
            supplierName={supplierName}
            onBack={() => setStep(3)}
          />

          {/* Accounting Bill Review */}
          <div className="px-0 mt-4">
            <AccountingBillReview bill={{
              id: `inv-${Date.now()}`,
              supplierName: supplierName,
              invoiceNumber: "",
              invoiceDate: new Date().toISOString().split("T")[0],
              dueDate: "",
              subtotalExGst: mockProducts.reduce((s, p) => s + p.price, 0),
              gstAmount: mockProducts.reduce((s, p) => s + p.price, 0) * 0.1,
              totalIncGst: mockProducts.reduce((s, p) => s + p.price, 0) * 1.1,
              accountCategory: mockProducts[0]?.type || "Swimwear",
              accountCode: "",
              gstCode: "GST on Expenses",
              status: "draft",
              accountingPlatform: "manual",
              externalId: "",
              externalUrl: "",
              lineItems: mockProducts.map(p => ({
                description: `${p.brand} ${p.name}`,
                quantity: 1,
                unitPrice: p.price * 1.1,
                totalExGst: p.price,
                gstAmount: p.price * 0.1,
                accountCategory: mockProducts[0]?.type || "Swimwear",
                accountCode: "",
                gstCode: "GST on Expenses",
              })),
              source: {
                sourceType: "invoice",
                sourcePlatform: "manual",
                sourceDocumentId: "",
                sourceSupplier: supplierName,
                sourceDate: new Date().toISOString(),
                sourceCurrency: "AUD",
                importedAt: new Date().toISOString(),
              },
            }} />
          </div>
        </div>
      )}

      {/* Supplier Template Teach Modal */}
      <SupplierTemplateTeach
        open={showTeachModal}
        onClose={() => setShowTeachModal(false)}
        supplierName={supplierName}
        detectedHeaders={detectedHeaders}
        sampleProducts={productGroups.slice(0, 5).map(g => ({
          name: g.name,
          sku: g.vendorCode || "",
          colour: g.colour || "",
          size: g.size || "",
          qty: g.variants.reduce((s, v) => s + v.qty, 0),
          cost: g.price,
          rrp: g.rrp,
        }))}
      />
    </div>
  );
};

// ── Lightspeed Export Download Section ─────────────────────
import type { StoreMode } from '@/hooks/use-store-mode';
import { arrivalMonthTag, titleCase, stripBrandPrefix } from '@/lib/lightspeed-xseries';
// normaliseVendor already imported at top of file

interface ExportProduct {
  name: string;
  brand: string;
  type: string;
  price: number;       // wholesale cost ex GST
  rrp: number;         // retail price
  status: string;
  // Optional rich data — when present, drives variant fan-out + correct stock totals.
  variants?: { sku?: string; colour?: string; size?: string; qty?: number; price?: number; rrp?: number }[];
  vendorCode?: string;
  description?: string;
  /** Rich HTML description from enrichment (preferred over `description`). */
  bodyHtml?: string;
  season?: string;
  invoiceDate?: string; // ISO — used to derive arrivalMonth tag (Apr26 / Sept26)
}

function LightspeedExportDownload({ exportFormat, products, supplierName, lsSettings, mode, invoiceDate }: {
  exportFormat: 'shopify' | 'lightspeed_x' | 'xlsx';
  products: ExportProduct[];
  supplierName: string;
  lsSettings: XSeriesSettings;
  mode: StoreMode;
  invoiceDate?: string;
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

  // B1 #7 — Tag builder: Brand, Department, Type, ArrivalMonth, Season, Colour.
  // Drops the meaningless "General" / "New Arrival" placeholders.
  const buildTagsFor = (p: ExportProduct, dateIso?: string): string => {
    const departmentForType = (t: string): string => {
      const tt = (t || '').toLowerCase();
      if (/dress|top|pant|skirt|short|shirt|jumpsuit|playsuit|kimono|kaftan|sarong/.test(tt)) return 'womens clothing';
      if (/swim|bikini|tankini|rashie|board/.test(tt)) return 'swimwear';
      if (/jewel|earring|necklace|bracelet/.test(tt)) return 'jewellery';
      if (/hat|sunnies|bag|towel|accessor|wallet/.test(tt)) return 'accessories';
      return '';
    };
    const tags: string[] = [];
    const brand = normaliseVendor(p.brand);
    if (brand) tags.push(brand);
    const dept = departmentForType(p.type);
    if (dept) tags.push(dept);
    if (p.type) tags.push(p.type.toLowerCase());
    tags.push(arrivalMonthTag(dateIso || p.invoiceDate || invoiceDate));
    if (p.season) tags.push(p.season);
    // Add colour only when single-colour product (multi-colour groups put colour at variant level).
    const colours = new Set((p.variants || []).map(v => (v.colour || '').toLowerCase()).filter(Boolean));
    if (colours.size === 1) {
      const c = titleCase([...colours][0]);
      if (c) tags.push(c);
    } else if (!p.variants || p.variants.length === 0) {
      // single-row product — no colour info available
    }
    // Dedupe, preserve order
    const seen = new Set<string>();
    return tags.filter(t => {
      const k = t.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k); return true;
    }).join(', ');
  };

  if (exportFormat === 'lightspeed_x') {
    // B1 #1, #2, #3, #6 — thread per-variant qty/cost/retail/SKU through to the builder
    // so the Size matrix fans out, supply_price stays at wholesale, retail_price stays
    // at RRP, Main_Outlet_stock = extracted_qty, and each variant gets a unique SKU.
    const xProducts: XSeriesProduct[] = products.map(p => ({
      title: titleCase(stripBrandPrefix(p.name, p.brand)),
      brand: normaliseVendor(p.brand),
      type: p.type,
      price: p.price, // wholesale cost ex GST (NEVER overwritten with RRP)
      rrp: p.rrp,     // retail price
      // W-04 — the upstream pipeline carries the description as `bodyHtml`
      // (rich HTML enrichment output). Reading `p.description` here was always
      // undefined, leaving Lightspeed's description column blank on every row.
      // Strip HTML tags + collapse whitespace so Lightspeed gets clean prose.
      description: (p.bodyHtml || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim() || undefined,
      season: p.season,
      arrivalDate: p.invoiceDate || invoiceDate,
      supplierCode: p.vendorCode,
      supplierName: supplierName,
      tags: buildTagsFor(p),
      variants: (p.variants || []).map(v => ({
        sku: v.sku,
        colour: v.colour,
        size: v.size,
        quantity: v.qty,        // → Main_Outlet_stock (extracted_qty)
        supplyPrice: v.price,   // per-variant cost ex GST
        retailPrice: v.rrp,     // per-variant RRP
      })),
    }));
    const { csv, errors, rowCount } = generateXSeriesCSV(xProducts, lsSettings);

    // B1 #3 — stock-total reconciliation banner
    const totalStock = xProducts.reduce((s, x) =>
      s + (x.variants?.reduce((a, v) => a + (v.quantity || 0), 0) || 0), 0);
    const expectedTotal = products.reduce((s, p) =>
      s + ((p.variants || []).reduce((a, v) => a + (v.qty || 0), 0)), 0);
    const stockMismatch = totalStock !== expectedTotal && expectedTotal > 0;
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
          <div className="bg-warning/10 border border-warning/20 rounded-lg p-3">
            {warnings.slice(0, 5).map((w, i) => (
              <p key={i} className="text-xs text-warning flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {w.message}
              </p>
            ))}
          </div>
        )}
        {stockMismatch && (
          <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
            <span className="text-xs text-warning">
              Stock count doesn't match invoice total — CSV has {totalStock} units, invoice expected {expectedTotal}. Review before importing.
            </span>
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
  const handleShopifyDownload = () => {
    const shopifyProducts = products.map(p => ({
      title: titleCase(stripBrandPrefix(p.name, p.brand)),
      vendor: normaliseVendor(p.brand),
      type: p.type,
      price: p.rrp,
      cost: p.price,
      tags: buildTagsFor(p),
      bodyHtml: p.bodyHtml || p.description || '',
      variants: p.variants || [],
    }));
    const headers = ['Handle','Title','Body (HTML)','Vendor','Type','Tags','Variant SKU','Variant Price','Cost per item','Variant Inventory Qty','Option1 Name','Option1 Value','Option2 Name','Option2 Value'];
    const rows: string[][] = [headers];
    for (const p of shopifyProducts) {
      const handle = `${p.vendor}-${p.title}`.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
      const variants = p.variants.length > 0 ? p.variants : [{ sku: '', colour: '', size: '', qty: 0, price: p.price, rrp: p.price }];
      variants.forEach((v, i) => {
        rows.push([
          handle,
          i === 0 ? p.title : '',
          i === 0 ? p.bodyHtml : '',
          i === 0 ? p.vendor : '',
          i === 0 ? p.type : '',
          i === 0 ? p.tags : '',
          v.sku || '',
          String(v.rrp ?? p.price),
          String(v.price ?? p.cost),
          String(v.qty ?? 0),
          v.colour ? 'Colour' : '',
          v.colour || '',
          v.size ? 'Size' : '',
          v.size || '',
        ]);
      });
    }
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    downloadFile(csv, `${tag}_${month}_shopify_${date}.csv`);
  };

  return (
    <div className="flex flex-col items-center">
      <div className="w-20 h-20 rounded-full bg-success/15 flex items-center justify-center mb-6">
        <Check className="w-10 h-10 text-success" />
      </div>
      <h3 className="text-xl font-bold font-display mb-2">Your file is ready</h3>
      <p className="text-sm text-muted-foreground mb-6">{products.length} products, {exportFormat === 'xlsx' ? 'Excel' : 'Shopify'}-ready format</p>
      <Button variant="success" className="w-full max-w-xs h-14 text-base" onClick={handleShopifyDownload}>
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
const CATALOG_KEY = 'catalog_memory_sonic_invoice';

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
    toast.success("CSV downloaded", { description: filename });
    // Auto-trigger image SEO optimization
    import("@/lib/image-seo-trigger").then(m => m.dispatchImageSeoTrigger({ source: "invoice", productCount: products.length }));
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
          <li>Upload the Stock Order CSV from Sonic Invoice</li>
          <li>Review the imported lines — quantities appear in the order</li>
          <li>Mark the order as received to update stock</li>
          <li className="text-amber-400 font-medium mt-2">
            ⚠ All products in a single stock order must be from the SAME supplier in Lightspeed. If your invoice has multiple suppliers, Sonic Invoice splits the CSV into one file per supplier automatically.
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
          </div>
        </div>
      )}
    </div>
  );
};

const ProductCard = ({ product, onPreview, onEnrich, onSetImage }: { product: { name: string; sku?: string; barcode?: string; gtin?: string; matchSource?: MatchSource; brand: string; type: string; colour?: string; size?: string; price: number; rrp: number; status: string; metafields?: Record<string, string>; costChange?: { prev: number; changeAmount: number; changePct: number; prevDate: string } | null; isNew?: boolean; enriched?: boolean; enriching?: boolean; imageSrc?: string; imageUrls?: string[]; desc?: string; fabric?: string; care?: string; origin?: string; productPageUrl?: string; enrichConfidence?: string; enrichNote?: string }; onPreview?: () => void; onEnrich?: () => void; onSetImage?: (url: string) => void }) => {
  const [expanded, setExpanded] = useState(false);
  const [savedToBarcodeCatalog, setSavedToBarcodeCatalog] = useState(false);
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
        <div className="flex items-start gap-3">
          {/* Image thumbnail */}
          <div className="shrink-0 w-11 h-11 rounded bg-muted border border-border flex items-center justify-center overflow-hidden">
            {product.imageSrc ? (
              <img src={product.imageSrc} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            ) : (
              <span className="text-base text-muted-foreground">📷</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">{product.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {product.brand} · {product.type}
              {product.colour && <> · <span className="text-foreground">{product.colour}</span></>}
              {product.size && <> · <span className="font-mono-data">{product.size}</span></>}
              {" · "}${product.rrp.toFixed(2)}
              {product.sku && <> · <span className="font-mono-data">{product.sku}</span></>}
            </p>
            {product.barcode && (
              <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                <Barcode className="w-3 h-3" />
                <span className="font-mono-data">{product.barcode}</span>
                {product.matchSource === "barcode" && <span className="text-primary font-medium">· In catalog</span>}
                {product.barcode && product.matchSource !== "barcode" && <span className="text-warning">· Not in catalog</span>}
              </p>
            )}
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
            {margin !== null && (
              <span className={`inline-block mt-0.5 text-[9px] ${margin < 25 ? "text-destructive" : margin < 40 ? "text-warning" : "text-muted-foreground"}`}>
                {margin < 25 && "⚠ "}Margin: {margin.toFixed(0)}%
              </span>
            )}
            {/* Enrichment badge */}
            {product.enriched && (
              <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] font-medium ${
                product.enrichConfidence === 'high' ? 'bg-success/15 text-success' :
                product.enrichConfidence === 'medium' ? 'bg-warning/15 text-warning' :
                'bg-destructive/15 text-destructive'
              }`}>
                ✦ {product.enrichConfidence} confidence
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
            <input defaultValue={product.colour || ""} className="h-10 rounded-md bg-input border border-border px-3 text-sm" placeholder="Colour" />
            <input defaultValue={product.size || ""} className="h-10 rounded-md bg-input border border-border px-3 text-sm" placeholder="Size" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">SKU / Style Code</label>
              <input defaultValue={product.sku || ""} className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm font-mono-data" placeholder="e.g. JA81520" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">Barcode (GTIN)</label>
              <input defaultValue={product.barcode || ""} className={`w-full h-10 rounded-md bg-input border border-border px-3 text-sm font-mono-data ${product.barcode ? "text-success" : ""}`} placeholder="EAN-13 / UPC" />
            </div>
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

          {/* Save to barcode catalog */}
          {product.barcode && product.matchSource !== "barcode" && !savedToBarcodeCatalog && (
            <div className="bg-primary/5 border border-primary/20 rounded-md p-2 flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">Barcode found but not in catalog. Save it to speed up future invoices.</span>
              <Button size="sm" variant="outline" className="h-6 text-[10px] ml-2 shrink-0" onClick={() => {
                saveBarcodeToCatalog(product.barcode!, {
                  title: product.name, vendor: product.brand, sku: product.sku || "", type: product.type,
                  addedDate: new Date().toISOString().slice(0, 10),
                });
                setSavedToBarcodeCatalog(true);
                addAuditEntry("Catalog", `Barcode ${product.barcode} saved for ${product.name}`);
              }}>
                <Save className="w-3 h-3 mr-1" /> Save to catalog
              </Button>
            </div>
          )}
          {savedToBarcodeCatalog && (
            <div className="bg-success/10 border border-success/20 rounded-md p-2 flex items-center gap-2">
              <Check className="w-3 h-3 text-success" />
              <span className="text-[10px] text-success font-medium">Barcode saved to catalog ✓</span>
            </div>
          )}

          {/* Enrichment results */}
          {product.enriched && (
            <div className="mt-2 pt-2 border-t border-border space-y-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Enrichment results</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  product.enrichConfidence === 'high' ? 'bg-success/15 text-success' :
                  product.enrichConfidence === 'medium' ? 'bg-warning/15 text-warning' :
                  'bg-destructive/15 text-destructive'
                }`}>{product.enrichConfidence} confidence</span>
                {product.productPageUrl && (
                  <a href={product.productPageUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary hover:underline">View on brand site ↗</a>
                )}
              </div>
              {product.imageUrls && product.imageUrls.length > 0 && (
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">Images found ({product.imageUrls.length}) — click to set as primary</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {product.imageUrls.slice(0, 6).map((url, j) => (
                      <div key={j} className="relative cursor-pointer" onClick={(e) => { e.stopPropagation(); onSetImage?.(url); }}>
                        <img src={url} alt="" className={`w-14 h-14 object-cover rounded border ${product.imageSrc === url ? 'border-primary' : 'border-border'}`} onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }} />
                        {product.imageSrc === url && <div className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-primary flex items-center justify-center text-[7px] text-primary-foreground">✓</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(product.fabric || product.care || product.origin) && (
                <div className="grid grid-cols-2 gap-1 text-[11px]">
                  {product.fabric && <div><span className="text-muted-foreground">Fabric: </span>{product.fabric}</div>}
                  {product.care && <div><span className="text-muted-foreground">Care: </span>{product.care}</div>}
                  {product.origin && <div><span className="text-muted-foreground">Origin: </span>{product.origin}</div>}
                </div>
              )}
              {product.enrichNote && (
                <div className="text-[10px] text-warning bg-warning/10 rounded p-1.5">⚠ {product.enrichNote}</div>
              )}
            </div>
          )}

          <div className="flex gap-2 flex-wrap">
            {onEnrich && (
              <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); onEnrich(); }} disabled={product.enriching}>
                {product.enriching ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Finding...</> : product.enriched ? <><RotateCcw className="w-3.5 h-3.5 mr-1" /> Re-enrich</> : <><Zap className="w-3.5 h-3.5 mr-1" /> ✦ Enrich</>}
              </Button>
            )}
            {onPreview && <Button variant="outline" size="sm" onClick={onPreview}><Eye className="w-3.5 h-3.5 mr-1" /> Preview</Button>}
          </div>
        </div>
      )}
    </div>
  );
};

export default InvoiceFlow;
