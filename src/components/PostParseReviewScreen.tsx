import { useState, useMemo, useCallback, useEffect, useRef } from "react";

import {
  Check, X, AlertTriangle, ChevronDown, ChevronRight, RotateCcw,
  ShieldCheck, Bug, Search, Filter, CheckCheck, ArrowRight,
  Edit3, Download, Zap, ArrowUpRight, Layers, Merge, Scissors,
  Eye, Brain, Truck, Receipt, Package, FileText, DollarSign, Hash, MapPin, ScanLine, Tag, Percent,
  FolderTree
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ValidatedProduct, ValidationDebugInfo, CorrectionDetail } from "@/lib/invoice-validator";
import { saveCorrection, type CorrectionPattern } from "@/lib/invoice-templates";
import { recordFieldCorrection, recordNoiseRejection, recordGroupingRule, recordReclassification } from "@/lib/invoice-learning";
import { updateSupplierProfileWithCorrections } from "@/lib/supplier-profile-updater";
import { logCorrection, deriveFieldCategory, registerApplyToRemainingRowsHandler, type CorrectionReason } from "@/lib/correction-tracker";
import { recordLineEdits } from "@/lib/processing-timing";
import CorrectionReasonPicker, { CorrectionSavedCheck } from "@/components/CorrectionReasonPicker";
import { saveInvoiceLinesToCatalog } from "@/components/SupplierCatalog";
import { persistParsedInvoice } from "@/lib/invoice-persistence";
import { supabase } from "@/integrations/supabase/client";
import { normaliseVendor } from "@/lib/normalise-vendor";
import { toast } from "sonner";
import SourceTraceViewer, { InlineSourcePreview } from "@/components/SourceTraceViewer";
import SizeGridEditor from "@/components/SizeGridEditor";
import InvoiceDebugOverlay from "@/components/InvoiceDebugOverlay";
import FieldConfidenceHeader, { lowConfidenceFieldNames } from "@/components/FieldConfidenceHeader";

interface PostParseReviewScreenProps {
  debug: ValidationDebugInfo;
  products: ValidatedProduct[];
  supplierName?: string;
  invoicePages?: string[]; // base64 or URL images per page
  /** Original column headers detected in the source invoice — needed when the
   *  user agrees to retrain a saved rule from the correction prompt. */
  detectedHeaders?: string[];
  /** Detected invoice layout (A/B/C/D/E/F) — passed through to retraining. */
  detectedLayout?: string | null;
  onUpdateProducts: (products: ValidatedProduct[]) => void;
  /** Called every time the user edits a cell — used for processing-quality tracking. */
  onCellEdited?: (field: string) => void;
  onExportAccepted: () => void;
  onPushToShopify: () => void;
  /** Optional — when provided, renders a "Price Match" button in the action bar that
   *  opens PriceMatchPanel with the current invoice's line items pre-loaded. */
  onPriceMatch?: () => void;
  /** Optional — when provided, renders a "Get Descriptions" button in the action bar
   *  that opens ProductDescriptionPanel with the current invoice's line items pre-loaded. */
  onGetDescriptions?: () => void;
  onBack: () => void;
  onReprocessDetailed?: (expectedRowCount?: number) => void;
  isReprocessing?: boolean;
  underExtractionWarning?: { extractedCount: number; estimatedRows: number } | null;
  /** Per-field AI confidence scores from the extraction response (0–100). */
  fieldConfidence?: Record<string, number> | null;
  /** Brief AI-authored note describing any uncertainty in the extraction. */
  extractionNotes?: string | null;
  /** Which extraction path was taken: full_extraction | supplier_match | fingerprint_match. */
  matchMethod?: "full_extraction" | "supplier_match" | "fingerprint_match";
  /** Set when the review screen was opened from a Watchdog Agent run. Renders the
   *  (currently disabled) "Auto-publish to Shopify" button in the action bar. */
  watchdogRun?: { runId: string; autoPublishEligible: boolean } | null;
  /** Per-product Qty header validator warnings raised by parse-invoice when
   *  the extracted size-row count for a product doesn't match the invoice
   *  header `Qty:` field. Drives the yellow review banner + per-row flag.
   *  (Round 4 Walnut fix — Vermont Pant phantom-size-16 canary.) */
  qtyHeaderWarnings?: Array<{
    invoice_number: string;
    product_title: string;
    colour: string;
    extracted_rows: number;
    header_qty: number;
    message: string;
  }>;
}

type ReviewTab = "accepted" | "review" | "rejected";
type ConfFilter = "all" | "high" | "medium" | "low";
type ViewMode = "flat" | "grouped" | "by-collection";

const UNASSIGNED_COLLECTION = "Unassigned";

// Extended product type with extra flags
interface ReviewProduct extends ValidatedProduct {
  _manuallyEdited?: boolean;
  _markedAs?: "freight" | "tax" | "summary" | "non-product";
  _extractionReason?: string;
  _parseNotes?: string;
  _sourcePage?: number;
  _groupId?: string;
}

// Grouped product structure
interface ProductGroup {
  groupId: string;
  parentTitle: string;
  styleCode: string;
  colour: string;
  vendor: string;
  unitCost: number;
  totalUnits: number;
  variants: ReviewProduct[];
}

// Under-extraction warning banner with manual row count input
function UnderExtractionBanner({ warning, onReprocessDetailed, isReprocessing }: {
  warning: { extractedCount: number; estimatedRows: number };
  onReprocessDetailed?: (expectedRowCount?: number) => void;
  isReprocessing?: boolean;
}) {
  const [manualCount, setManualCount] = useState<string>("");
  const expectedCount = manualCount ? parseInt(manualCount, 10) : undefined;

  return (
    <div className="bg-secondary/10 border border-secondary/30 rounded-lg p-3 mb-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-secondary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-secondary">
            Possible under-extraction detected
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            We found only {warning.extractedCount} product{warning.extractedCount !== 1 ? 's' : ''}, but this invoice appears to contain ~{warning.estimatedRows} rows.
          </p>

          <div className="flex items-center gap-2 mt-2">
            <label className="text-xs text-muted-foreground whitespace-nowrap">Expected products:</label>
            <Input
              type="number"
              min={1}
              max={200}
              placeholder={String(warning.estimatedRows)}
              value={manualCount}
              onChange={(e) => setManualCount(e.target.value)}
              className="w-20 h-7 text-xs"
            />
          </div>

          {onReprocessDetailed && (
            <Button
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={() => onReprocessDetailed(expectedCount)}
              disabled={isReprocessing}
            >
              {isReprocessing ? (
                <>
                  <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                  Reprocessing…
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5" />
                  Reprocess in detailed mode{expectedCount ? ` (expect ${expectedCount})` : ''}
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// Contextual tip that explains how the user's review-screen corrections feed
// the Supplier Brain profile for this supplier. Dismissible per supplier
// (persisted in localStorage). Updates live as edits accumulate.
function SupplierBrainLearningTip({
  supplierName,
  sessionEditCount,
  matchMethod,
}: {
  supplierName?: string;
  sessionEditCount: number;
  matchMethod?: "full_extraction" | "supplier_match" | "fingerprint_match";
}) {
  const supplierLabel = (supplierName || "").trim() || "this supplier";
  const storageKey = `sonic_brain_tip_dismissed::${supplierLabel.toLowerCase()}`;
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(storageKey) === "1"; } catch { return false; }
  });

  if (dismissed) return null;

  const isReturningSupplier = matchMethod === "supplier_match" || matchMethod === "fingerprint_match";
  const headline = isReturningSupplier
    ? `Refining the Supplier Brain for ${supplierLabel}`
    : `Teaching the Supplier Brain about ${supplierLabel}`;
  const subtext = isReturningSupplier
    ? "We matched this invoice to a saved profile. Every correction you make here sharpens the column map, GST rules and size system for next time."
    : "This looks like a new supplier format. Every cell you edit, reject or reclassify is logged and folded into a Supplier Brain profile so future invoices auto-extract.";

  return (
    <div className="mb-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-start gap-2">
        <Brain className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm font-medium text-foreground">{headline}</p>
            <button
              type="button"
              onClick={() => {
                setDismissed(true);
                try { localStorage.setItem(storageKey, "1"); } catch { /* ignore */ }
              }}
              className="text-xs text-muted-foreground hover:text-foreground"
              aria-label="Dismiss tip"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{subtext}</p>
          <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground list-disc list-inside">
            <li><span className="text-foreground">Edit a cell</span> → saves a column-mapping correction.</li>
            <li><span className="text-foreground">Reject a row</span> → teaches the noise/freight pattern.</li>
            <li><span className="text-foreground">Confirm sizes / colours</span> → locks in this supplier's variant system.</li>
          </ul>
          <p className="text-xs text-muted-foreground mt-2">
            {sessionEditCount > 0 ? (
              <>
                <span className="text-primary font-medium">{sessionEditCount}</span> correction{sessionEditCount === 1 ? "" : "s"} captured this session — visible later in <span className="text-foreground">Suppliers → {supplierLabel} → Brain</span>.
              </>
            ) : (
              <>Open <span className="text-foreground">Suppliers → {supplierLabel} → Brain</span> after exporting to see the updated profile.</>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function PostParseReviewScreen({
  debug,
  products,
  supplierName,
  invoicePages = [],
  detectedHeaders = [],
  detectedLayout = null,
  matchMethod = "full_extraction",
  onUpdateProducts,
  onCellEdited,
  onExportAccepted,
  onPushToShopify,
  onPriceMatch,
  onGetDescriptions,
  onBack,
  onReprocessDetailed,
  isReprocessing = false,
  underExtractionWarning = null,
  fieldConfidence = null,
  extractionNotes = null,
  watchdogRun = null,
  qtyHeaderWarnings = [],
}: PostParseReviewScreenProps) {
  const [activeTab, setActiveTab] = useState<ReviewTab>("accepted");
  // Lookup: "title|colour" (lowercased) -> warning message. Used to flag matching rows.
  const qtyWarningByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of qtyHeaderWarnings) {
      const titleKey = (w.product_title || "").trim().toLowerCase();
      const colourKey = (w.colour || "").trim().toLowerCase();
      map.set(`${titleKey}|${colourKey}`, w.message);
      map.set(`${titleKey}|`, w.message); // colour-agnostic fallback
    }
    return map;
  }, [qtyHeaderWarnings]);
  const lookupQtyWarning = useCallback((p: ReviewProduct): string | null => {
    if (qtyWarningByKey.size === 0) return null;
    const title = ((p as any).name || (p as any).product_title || "").trim().toLowerCase();
    const colour = ((p as any).colour || (p as any).color || "").trim().toLowerCase();
    return qtyWarningByKey.get(`${title}|${colour}`) || qtyWarningByKey.get(`${title}|`) || null;
  }, [qtyWarningByKey]);
  const [searchQuery, setSearchQuery] = useState("");
  const [vendorFilter, setVendorFilter] = useState<string>("all");
  const [confFilter, setConfFilter] = useState<ConfFilter>("all");
  const [showEditedOnly, setShowEditedOnly] = useState(false);
  const [showCorrectedOnly, setShowCorrectedOnly] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [showExportWarning, setShowExportWarning] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("flat");
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [showTeachAI, setShowTeachAI] = useState<number | null>(null);
  const [bulkVendor, setBulkVendor] = useState("");
  const [bulkCollection, setBulkCollection] = useState("");
  /** When set, only that collection is shown in by-collection mode (focus mode). */
  const [focusedCollection, setFocusedCollection] = useState<string | null>(null);
  /** Collection sections the user has marked as "done" — collapses them. */
  const [doneCollections, setDoneCollections] = useState<Set<string>>(new Set());
  const [sourceTraceProduct, setSourceTraceProduct] = useState<ValidatedProduct | null>(null);
  const [showDebugZones, setShowDebugZones] = useState(false);
  const [showDebugOverlay, setShowDebugOverlay] = useState(false);
  const [autoRefineProfile, setAutoRefineProfile] = useState(() => {
    try { return localStorage.getItem("sonic_auto_refine_profile") !== "false"; } catch { return true; }
  });
  const [autoPublishing, setAutoPublishing] = useState(false);

  async function handleAutoPublish() {
    if (!watchdogRun?.runId) return;
    setAutoPublishing(true);
    try {
      const { data, error } = await supabase.functions.invoke("publishing-agent", {
        body: { run_id: watchdogRun.runId },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      const published = (data as any)?.published ?? 0;
      const failed = ((data as any)?.failed ?? []).length;
      if (failed > 0) {
        toast.warning(`${published} published · ${failed} failed`);
      } else {
        toast.success(`${published} products published to Shopify`);
      }
      window.dispatchEvent(new CustomEvent("sonic:navigate-flow", { detail: "account" }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setAutoPublishing(false);
    }
  }

  /** GST mode for the cost-per-item column. "exclusive" (default) = cost is ex-GST.
   *  "inclusive" = cost was entered GST-inclusive and we divide by (1 + rate) to
   *  derive the true ex-GST cost. Toggling is fully reversible. */
  const [costGstMode, setCostGstMode] = useState<"exclusive" | "inclusive">("exclusive");
  /** Add-GST-on-top toggle. Independent of the strip toggle above — this one
   *  is for users whose supplier cost is genuinely ex-GST and they want to
   *  store / export it inc-GST. Multiplies every cost by (1 + gstRate).
   *  Fully reversible: turning it off divides cost back by the same factor. */
  const [addGstOnTop, setAddGstOnTop] = useState<boolean>(false);
  /** How multi-colour products should be exported:
   *  - "variants" (default) → one Shopify product, colours become variants
   *  - "separate" → one Shopify product per colour, name becomes "Product - Colour"
   *  Toggle is fully reversible — switching back strips any " - Colour" suffix we added. */
  const [colourMode, setColourMode] = useState<"variants" | "separate">("variants");
  const [gstRate] = useState(0.10); // AU/NZ default; future: pull from tax-service

  /** Pending corrections awaiting a reason. Key = `${rowIndex}::${field}`. */
  const [pendingCorrections, setPendingCorrections] = useState<Record<string, {
    rowIndex: number;
    field: string;
    fieldLabel: string;
    originalValue: string;
    correctedValue: string;
  }>>({});
  /** Cells where a reason was just recorded — show check for ~1.5s. */
  const [savedReasonFlash, setSavedReasonFlash] = useState<Record<string, boolean>>({});
  /** Counts every persisted correction in this session — drives the
   *  "N corrections · SUPPLIER" badge in the AI Parsing Details header. */
  const [sessionEditCount, setSessionEditCount] = useState(0);
  /** Per-row state: when true, the row is in "awaiting reason" mode after the
   *  user clicked Done editing with at least one changed field. */
  const [awaitingReasonRows, setAwaitingReasonRows] = useState<Set<number>>(new Set());
  /** Stable session id used as invoice_id when persisting corrections. */
  const sessionInvoiceId = useMemo(() => `session_${Date.now().toString(36)}`, []);

  // ── Agent 3 (Enrichment) — live updates ──────────────────────────
  // Subscribe to products UPDATE events so the Review screen renders
  // descriptions and image URLs as the auto-enrich edge function fills
  // them in. Matches DB rows back to in-memory products by title.
  const [enrichmentMap, setEnrichmentMap] = useState<Record<string, { description?: string; image_url?: string }>>({});
  const [enrichmentTotal, setEnrichmentTotal] = useState(0);
  useEffect(() => {
    let mounted = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !mounted) return;
      const userId = session.user.id;
      // Count distinct titles we expect to be enriched
      const titles = Array.from(new Set(products.filter(p => !p._rejected).map(p => (p.name || "").trim()).filter(Boolean)));
      setEnrichmentTotal(titles.length);
      channel = supabase
        .channel(`enrich-${sessionInvoiceId}`)
        .on("postgres_changes", {
          event: "UPDATE",
          schema: "public",
          table: "products",
          filter: `user_id=eq.${userId}`,
        }, (payload: any) => {
          const row = payload?.new;
          if (!row?.title) return;
          const key = String(row.title).trim().toLowerCase();
          setEnrichmentMap(prev => ({
            ...prev,
            [key]: {
              description: row.description ?? prev[key]?.description,
              image_url: row.image_url ?? prev[key]?.image_url,
            },
          }));
        })
        .subscribe();
    })();
    return () => {
      mounted = false;
      if (channel) supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionInvoiceId]);

  const enrichmentDoneCount = useMemo(() => {
    return Object.values(enrichmentMap).filter(e => e.description || e.image_url).length;
  }, [enrichmentMap]);

  // Listen for "edit product" requests fired by the pre-publish validation
  // screen. Payload `{ brand, name }` is matched against current products;
  // we flip to the right tab, open inline edit, and scroll the row in.
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { brand?: string; name?: string } | undefined;
      if (!detail) return;
      const brand = (detail.brand || "").trim().toLowerCase();
      const name = (detail.name || "").trim().toLowerCase();
      const match = products.find(
        p => (p.brand || "").trim().toLowerCase() === brand
          && (p.name || "").trim().toLowerCase() === name,
      );
      if (!match) {
        toast.error("Couldn't find that line item to edit");
        return;
      }
      const nextTab: ReviewTab = match._rejected ? "rejected" : match._confidenceLevel === "high" ? "accepted" : "review";
      setActiveTab(nextTab);
      setEditingRow(match._rowIndex);
      // Scroll after the tab change paints
      setTimeout(() => {
        document.getElementById(`review-row-${match._rowIndex}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 80);
    };
    window.addEventListener("sonic:edit-product", handler as EventListener);
    return () => window.removeEventListener("sonic:edit-product", handler as EventListener);
  }, [products]);

  // Categorize products
  const accepted = useMemo(() => products.filter(p => !p._rejected && p._confidenceLevel === "high"), [products]);
  const needsReview = useMemo(() => products.filter(p => !p._rejected && p._confidenceLevel !== "high"), [products]);
  const rejected = useMemo(() => products.filter(p => p._rejected), [products]);

  // Unique vendors
  const vendors = useMemo(() => {
    const set = new Set(products.filter(p => p.brand?.trim()).map(p => p.brand.trim()));
    return Array.from(set).sort();
  }, [products]);

  // Summary stats
  const avgConfidence = useMemo(() => {
    const nonRejected = products.filter(p => !p._rejected);
    if (nonRejected.length === 0) return 0;
    return Math.round(nonRejected.reduce((s, p) => s + p._confidence, 0) / nonRejected.length);
  }, [products]);

  const totalEstimatedCost = useMemo(() => {
    return products.filter(p => !p._rejected).reduce((s, p) => s + (p.cost || 0) * (p.qty || 1), 0);
  }, [products]);

  const missingCostCount = useMemo(() => {
    return products.filter(p => !p._rejected && (!p.cost || p.cost <= 0)).length;
  }, [products]);

  /** Internal product field names whose AI confidence was < 70 — used both for
   *  cell tinting and for marking corrections as system-suggested (the most
   *  valuable training signal). */
  const lowConfFields = useMemo(() => lowConfidenceFieldNames(fieldConfidence), [fieldConfidence]);

  // Grouped products for fashion view
  const groupedProducts = useMemo((): ProductGroup[] => {
    const nonRejected = products.filter(p => !p._rejected) as ReviewProduct[];
    const groups = new Map<string, ReviewProduct[]>();

    for (const p of nonRejected) {
      // Group by normalized base title + vendor + cost
      const baseTitle = (p.name || "").replace(/\s*-\s*(XS|S|M|L|XL|XXL|\d+|O\/S)\s*$/i, "").trim();
      const key = `${baseTitle}::${p.brand || ""}::${p.cost || 0}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }

    return Array.from(groups.entries())
      .filter(([_, items]) => items.length > 1)
      .map(([key, items]) => ({
        groupId: key,
        parentTitle: items[0].name?.replace(/\s*-\s*(XS|S|M|L|XL|XXL|\d+|O\/S)\s*$/i, "").trim() || "",
        styleCode: items[0].sku || "",
        colour: items[0].colour || "",
        vendor: items[0].brand || "",
        unitCost: items[0].cost || 0,
        totalUnits: items.reduce((s, i) => s + (i.qty || 0), 0),
        variants: items,
      }));
  }, [products]);

  // Get filtered list for current tab
  const currentList = useMemo(() => {
    let list = activeTab === "accepted" ? accepted : activeTab === "review" ? needsReview : rejected;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(p =>
        p.name?.toLowerCase().includes(q) ||
        p._rawName?.toLowerCase().includes(q) ||
        p.brand?.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q)
      );
    }

    if (vendorFilter !== "all") list = list.filter(p => p.brand?.trim() === vendorFilter);
    if (confFilter !== "all") list = list.filter(p => p._confidenceLevel === confFilter);
    if (showEditedOnly) list = list.filter(p => (p as ReviewProduct)._manuallyEdited);
    if (showCorrectedOnly) list = list.filter(p => p._corrections.length > 0);

    if (activeTab === "accepted") list = [...list].sort((a, b) => b._confidence - a._confidence);

    return list;
  }, [activeTab, accepted, needsReview, rejected, searchQuery, vendorFilter, confFilter, showEditedOnly, showCorrectedOnly]);

  /** Group the current (already filtered) list by collection / story.
   *  Preserves invoice order — the first collection seen is rendered first.
   *  Items without a collection fall into an "Unassigned" bucket so the
   *  merchant can drag a value in from the bulk-tag input.
   *  Powers the "Group by Collection" view mode. */
  const collectionGroups = useMemo(() => {
    const order: string[] = [];
    const buckets = new Map<string, ReviewProduct[]>();
    for (const p of currentList as ReviewProduct[]) {
      const key = (p.collection || "").trim() || UNASSIGNED_COLLECTION;
      if (!buckets.has(key)) {
        buckets.set(key, []);
        order.push(key);
      }
      buckets.get(key)!.push(p);
    }
    return order.map(name => ({
      name,
      items: buckets.get(name)!,
      totalUnits: buckets.get(name)!.reduce((s, i) => s + (i.qty || 0), 0),
    }));
  }, [currentList]);

  /** All distinct collection names across the entire invoice (not just the
   *  active tab) — feeds the bulk-tag dropdown so users can re-use existing
   *  story labels with one click. */
  const allCollectionNames = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      const v = (p.collection || "").trim();
      if (v) set.add(v);
    }
    return Array.from(set).sort();
  }, [products]);

  // ── Actions ──
  const approveRow = (rowIndex: number) => {
    const product = products.find(p => p._rowIndex === rowIndex);
    if (supplierName && product) {
      const from = product._rejected ? "rejected" : product._confidenceLevel === "high" ? "accepted" : "review";
      if (from !== "accepted") {
        recordReclassification(supplierName, product._rawName || product.name || "", from as any, "accepted", "Manually accepted by merchant");
        toast.success("AI learned: row accepted", { description: `"${(product.name || product._rawName || "").slice(0, 40)}" saved as product pattern`, duration: 2000 });
      }
    }
    onUpdateProducts(products.map(p =>
      p._rowIndex === rowIndex
        ? { ...p, _rejected: false, _confidenceLevel: "high" as const, _confidence: Math.max(p._confidence, 80) }
        : p
    ));
  };

  const rejectRow = (rowIndex: number, reason?: string) => {
    const product = products.find(p => p._rowIndex === rowIndex);
    if (supplierName && product) {
      const rejectReason = reason || "Manually rejected by merchant";
      recordNoiseRejection(supplierName, product._rawName || product.name || "", rejectReason);
      const from = product._confidenceLevel === "high" ? "accepted" : "review";
      recordReclassification(supplierName, product._rawName || product.name || "", from as any, "rejected", rejectReason);
      toast.info("AI learned: row rejected", { description: `Future invoices will auto-reject similar rows`, duration: 2000 });
    }
    onUpdateProducts(products.map(p =>
      p._rowIndex === rowIndex
        ? { ...p, _rejected: true, _rejectReason: reason || "Manually rejected", _confidenceLevel: "low" as const, _confidence: 0 }
        : p
    ));
  };

  const moveToReview = (rowIndex: number) => {
    const product = products.find(p => p._rowIndex === rowIndex);
    if (supplierName && product) {
      recordReclassification(supplierName, product._rawName || product.name || "", "accepted", "review", "Moved to review — needs verification");
    }
    onUpdateProducts(products.map(p =>
      p._rowIndex === rowIndex
        ? { ...p, _rejected: false, _confidenceLevel: "medium" as const, _confidence: Math.min(p._confidence, 70) }
        : p
    ));
  };

  const restoreToReview = (rowIndex: number) => {
    const product = products.find(p => p._rowIndex === rowIndex);
    if (supplierName && product) {
      recordReclassification(supplierName, product._rawName || product.name || "", "rejected", "review", "Restored from rejected — may be a product");
      toast.success("AI learned: row restored", { description: `Similar rows will get higher confidence next time`, duration: 2000 });
    }
    onUpdateProducts(products.map(p =>
      p._rowIndex === rowIndex
        ? { ...p, _rejected: false, _confidenceLevel: "medium" as const, _confidence: 50, _rejectReason: undefined }
        : p
    ));
  };

  const markRowAs = (rowIndex: number, markAs: "freight" | "tax" | "summary" | "non-product") => {
    const labels: Record<string, string> = {
      freight: "Marked as freight/shipping",
      tax: "Marked as tax/GST",
      summary: "Marked as subtotal/summary",
      "non-product": "Marked as non-product",
    };
    const product = products.find(p => p._rowIndex === rowIndex);
    if (supplierName && product) {
      recordNoiseRejection(supplierName, product._rawName || product.name || "", labels[markAs]);
      recordReclassification(supplierName, product._rawName || product.name || "", "review", "rejected", labels[markAs]);
      toast.info(`AI learned: ${labels[markAs].toLowerCase()}`, { description: "Similar rows will be auto-rejected next time", duration: 2000 });
    }
    onUpdateProducts(products.map(p =>
      p._rowIndex === rowIndex
        ? { ...p, _rejected: true, _rejectReason: labels[markAs], _confidenceLevel: "low" as const, _confidence: 0, _markedAs: markAs } as any
        : p
    ));
  };

  const FIELD_LABELS: Record<string, string> = { name: "title", colour: "colour", size: "size", cost: "cost", sku: "sku", qty: "quantity", brand: "vendor" };

  /** Persist a correction (and trigger the rule-update prompt) with an optional reason. */
  const persistCorrection = useCallback((args: {
    rowIndex: number;
    field: string;
    fieldLabel: string;
    originalValue: string;
    correctedValue: string;
    reason?: CorrectionReason | null;
    reasonDetail?: string | null;
  }) => {
    if (!supplierName) return;
    const { field, fieldLabel, originalValue, correctedValue, reason, reasonDetail } = args;
    saveCorrection(supplierName, {
      field: fieldLabel, original: originalValue, corrected: correctedValue,
      rule: `In ${fieldLabel}: "${originalValue}" → "${correctedValue}"`,
      timestamp: new Date().toISOString(),
    });
    recordFieldCorrection(supplierName, fieldLabel, originalValue, correctedValue);
    const sampleRows = products.slice(0, 3).map(sp => ({
      name: sp.name, sku: sp.sku, cost: sp.cost, colour: sp.colour, size: sp.size, qty: sp.qty,
    }));
    void logCorrection({
      supplierName,
      field: fieldLabel,
      originalValue,
      correctedValue,
      rawHeaders: detectedHeaders,
      sampleRows,
      formatType: detectedLayout,
      extractedProducts: products.filter(pp => !pp._rejected) as unknown as Record<string, unknown>[],
      correctionReason: reason ?? "unspecified",
      correctionReasonDetail: reasonDetail ?? null,
      fieldCategory: deriveFieldCategory(field),
      autoDetected: lowConfFields.has(field),
      invoiceId: sessionInvoiceId,
    });
    // Per-field audit row → powers Processing History "Edits" column.
    recordLineEdits(
      [{ field: fieldLabel, oldValue: originalValue, newValue: correctedValue, rowIndex: args.rowIndex }],
      null,
    );
    setSessionEditCount((c) => c + 1);
  }, [supplierName, products, detectedHeaders, detectedLayout, lowConfFields, sessionInvoiceId]);

  // Keep a ref to the latest products so the bulk-apply handler always sees them.
  const productsRef = useRef(products);
  useEffect(() => { productsRef.current = products; }, [products]);

  // Register a session-scoped bulk-apply handler that the correction-tracker
  // toast ("Apply to all") can call after a rule update. Returns the count.
  useEffect(() => {
    registerApplyToRemainingRowsHandler(({ field, originalValue, correctedValue }) => {
      // Map UI label -> raw product key.
      const keyByLabel: Record<string, string> = {
        title: "name", colour: "colour", size: "size", cost: "cost",
        sku: "sku", quantity: "qty", vendor: "brand",
      };
      const productKey = keyByLabel[field] ?? field;
      const current = productsRef.current;
      let count = 0;
      const updated = current.map((p) => {
        if (p._rejected) return p;
        const v = String((p as any)[productKey] ?? "");
        if (v.trim().toLowerCase() !== originalValue.trim().toLowerCase()) return p;
        count += 1;
        return { ...p, [productKey]: correctedValue, _manuallyEdited: true } as typeof p;
      });
      if (count > 0) onUpdateProducts(updated);
      return count;
    });
    return () => registerApplyToRemainingRowsHandler(null);
  }, [onUpdateProducts]);

  /** Briefly flash the green check on a cell. */
  const flashSavedFor = useCallback((key: string) => {
    setSavedReasonFlash((prev) => ({ ...prev, [key]: true }));
    setTimeout(() => {
      setSavedReasonFlash((prev) => {
        const { [key]: _drop, ...rest } = prev;
        return rest;
      });
    }, 1500);
  }, []);

  /** Persist every pending correction for the given row with the chosen reason,
   *  flash the green check on each, then move the row to Accepted. */
  const confirmRowReason = useCallback((
    rowIndex: number,
    reason: CorrectionReason,
    detail?: string,
  ) => {
    let savedCount = 0;
    const fieldsSaved: string[] = [];
    setPendingCorrections((prev) => {
      const next = { ...prev };
      for (const [key, entry] of Object.entries(prev)) {
        if (entry.rowIndex !== rowIndex) continue;
        persistCorrection({ ...entry, reason, reasonDetail: detail ?? null });
        flashSavedFor(key);
        savedCount += 1;
        fieldsSaved.push(entry.field);
        delete next[key];
      }
      return next;
    });
    setAwaitingReasonRows((prev) => {
      const next = new Set(prev);
      next.delete(rowIndex);
      return next;
    });
    setEditingRow((current) => (current === rowIndex ? null : current));
    // Move to Accepted (also runs the existing learning hook).
    approveRow(rowIndex);

    // Session-summary toast — concise confirmation per row.
    if (savedCount > 0) {
      const reasonLabel =
        reason === "unspecified" ? "unspecified" :
        reason === "wrong_column_detected" ? "wrong column" :
        reason === "wrong_format" ? "wrong format" :
        reason === "currency_error" ? "currency" :
        reason === "size_system_wrong" ? "wrong size system" :
        reason === "missed_field" ? "field missing" :
        reason === "wrong_value" ? "wrong value" :
        "other";
      const fieldList = fieldsSaved.slice(0, 3).join(", ") + (fieldsSaved.length > 3 ? "…" : "");
      toast.success(
        `${savedCount} correction${savedCount === 1 ? "" : "s"} saved`,
        {
          description: `${fieldList} · reason: ${reasonLabel}${supplierName ? ` · ${supplierName}` : ""}`,
          duration: 2500,
        },
      );
    }
  }, [persistCorrection, flashSavedFor, supplierName]);

  /** User dismissed without picking — record everything for this row as
   *  "unspecified" and still move to Accepted. */
  const skipRowReason = useCallback((rowIndex: number) => {
    confirmRowReason(rowIndex, "unspecified");
  }, [confirmRowReason]);

  /** Convenience: derive pending field labels for a row, used for the bar's summary. */
  const pendingFieldsForRow = useCallback((rowIndex: number) => {
    return Object.values(pendingCorrections).filter((c) => c.rowIndex === rowIndex);
  }, [pendingCorrections]);

  const updateField = (rowIndex: number, field: string, value: string | number) => {
    onUpdateProducts(products.map(p => {
      if (p._rowIndex !== rowIndex) return p;
      const originalValue = String((p as any)[field] || "");
      const newValue = String(value);
      if (originalValue !== newValue) {
        const fieldLabel = FIELD_LABELS[field] || field;
        onCellEdited?.(fieldLabel);
        if (supplierName && originalValue) {
          const key = `${rowIndex}::${field}`;
          // Queue the change. Reason is captured later via the row-level
          // picker shown after the user clicks "Done editing".
          setPendingCorrections(prev => ({
            ...prev,
            [key]: { rowIndex, field, fieldLabel, originalValue, correctedValue: newValue },
          }));
        }
      }
      const updated = { ...p, [field]: value, _manuallyEdited: true } as any;
      // Recalculate confidence
      let conf = 0;
      if (updated.name?.trim()?.length >= 3) conf += 30;
      if (updated.brand?.trim()) conf += 10;
      if (updated.type?.trim()) conf += 10;
      if (updated.sku?.trim()) conf += 10;
      if (updated.barcode?.trim()) conf += 10;
      if (updated.cost > 0) conf += 15;
      if (updated.rrp > 0) conf += 5;
      if (updated.qty > 0) conf += 5;
      if (updated.colour?.trim()) conf += 3;
      if (updated.size?.trim()) conf += 2;
      updated._confidence = Math.min(100, conf);
      updated._confidenceLevel = conf >= 80 ? "high" : conf >= 50 ? "medium" : "low";
      return updated;
    }));
  };

  // Merge selected rows into one product with variants
  const mergeSelected = () => {
    if (selectedRows.size < 2) return;
    const indices = Array.from(selectedRows);
    const baseProduct = products.find(p => p._rowIndex === indices[0]);
    if (!baseProduct) return;

    if (supplierName) {
      recordGroupingRule(supplierName, `Merge rows by similar title under "${baseProduct.name}"`);
    }

    // Keep first row, mark others with group reference
    onUpdateProducts(products.map(p => {
      if (indices.includes(p._rowIndex) && p._rowIndex !== indices[0]) {
        return { ...p, _rejected: true, _rejectReason: `Merged into "${baseProduct.name}"` };
      }
      if (p._rowIndex === indices[0]) {
        const totalQty = indices.reduce((s, idx) => {
          const found = products.find(pp => pp._rowIndex === idx);
          return s + (found?.qty || 0);
        }, 0);
        return { ...p, qty: totalQty, _manuallyEdited: true } as any;
      }
      return p;
    }));
    setSelectedRows(new Set());
  };

  // Split a product row into standalone
  const splitRow = (rowIndex: number) => {
    // Simply reset any grouping and mark as standalone
    onUpdateProducts(products.map(p =>
      p._rowIndex === rowIndex ? { ...p, _groupId: undefined, _manuallyEdited: true } as any : p
    ));
  };

  // ── Bulk Actions ──
  const acceptAllHighConfidence = () => {
    onUpdateProducts(products.map(p =>
      !p._rejected && p._confidence >= 80 ? { ...p, _confidenceLevel: "high" as const } : p
    ));
  };

  const rejectAllSummaryRows = () => {
    onUpdateProducts(products.map(p => {
      if (p._rejected) return p;
      const name = (p.name || "").toLowerCase().trim();
      if (/^(subtotal|total|gst|tax|freight|shipping|carton|bank|bsb|account|abn|thank|terms|payment)/i.test(name)) {
        return { ...p, _rejected: true, _rejectReason: "Bulk rejected: summary/non-product row", _confidenceLevel: "low" as const, _confidence: 0 };
      }
      return p;
    }));
  };

  const rejectAllNumericOnly = () => {
    onUpdateProducts(products.map(p => {
      if (p._rejected) return p;
      if (/^[\d.,\s$€£¥%]+$/.test((p.name || "").trim())) {
        return { ...p, _rejected: true, _rejectReason: "Bulk rejected: numeric-only value", _confidenceLevel: "low" as const, _confidence: 0 };
      }
      return p;
    }));
  };

  const applyBulkVendor = () => {
    if (!bulkVendor.trim() || selectedRows.size === 0) return;
    onUpdateProducts(products.map(p =>
      selectedRows.has(p._rowIndex) ? { ...p, brand: bulkVendor.trim(), _manuallyEdited: true } as any : p
    ));
    setSelectedRows(new Set());
    setBulkVendor("");
  };

  const applyBulkCollection = () => {
    const v = bulkCollection.trim();
    if (!v || selectedRows.size === 0) return;
    onUpdateProducts(products.map(p =>
      selectedRows.has(p._rowIndex)
        ? ({ ...p, collection: v, _manuallyEdited: true } as any)
        : p
    ));
    toast.success(`Tagged ${selectedRows.size} item${selectedRows.size === 1 ? "" : "s"} as "${v}"`);
    setSelectedRows(new Set());
    setBulkCollection("");
  };

  const markSelectedAsFreight = () => {
    selectedRows.forEach(idx => markRowAs(idx, "freight"));
    setSelectedRows(new Set());
  };

  const toggleSelectRow = (rowIndex: number) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex); else next.add(rowIndex);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedRows(new Set(currentList.map(p => p._rowIndex)));
  };

  const clearSelection = () => setSelectedRows(new Set());

  const triggerProfileUpdate = useCallback(() => {
    if (!autoRefineProfile || !supplierName) return;
    const toastId = toast.loading("Learning from your corrections…");
    updateSupplierProfileWithCorrections(supplierName, products).then(() => {
      toast.success("Profile refined — future extractions will be more accurate", { id: toastId, duration: 3000 });
    }).catch(() => {
      toast.dismiss(toastId);
    });
  }, [supplierName, products, autoRefineProfile]);

  const handleExportClick = () => {
    if (needsReview.length > 0) setShowExportWarning(true);
    else { triggerProfileUpdate(); onExportAccepted(); }
  };

  const [savingToCatalog, setSavingToCatalog] = useState(false);

  const [savedToCatalog, setSavedToCatalog] = useState(false);

  const handleSaveToCatalog = async () => {
    if (!supplierName || accepted.length === 0) {
      toast.error("No accepted products to save");
      return;
    }
    setSavingToCatalog(true);
    setSavedToCatalog(false);
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session) { toast.error("Please sign in first"); return; }
      const userId = session.session.user.id;

      // Find or create supplier (case-insensitive on canonical form)
      const canonicalSupplier = normaliseVendor(supplierName);
      let { data: supplier } = await supabase
        .from("suppliers")
        .select("id")
        .ilike("name", canonicalSupplier)
        .maybeSingle();

      if (!supplier) {
        const { data: newSup } = await supabase
          .from("suppliers")
          .insert({ user_id: userId, name: canonicalSupplier })
          .select("id")
          .single();
        supplier = newSup;
      }

      if (!supplier) { toast.error("Could not resolve supplier"); return; }

      const lines = accepted.map(p => ({
        product_title: p.name,
        sku: p.sku,
        unit_cost: p.cost,
        color: p.colour,
        size: p.size,
      }));

      // 1. Save to supplier_catalog_items (existing behaviour)
      const saved = await saveInvoiceLinesToCatalog(supplier.id, userId, lines);

      // 2. ALSO write to products + variants so pricing tools can see them.
      const subtotal = accepted.reduce((s, p) => s + (p.cost || 0) * (p.qty || 0), 0);
      await persistParsedInvoice(
        {
          supplier: supplierName,
          invoiceNumber: "",
          invoiceDate: new Date().toISOString().slice(0, 10),
          currency: "AUD",
          subtotal,
          gst: null,
          total: subtotal,
          documentType: "invoice",
        },
        accepted,
      );

      setSavedToCatalog(true);
      const n = accepted.length;
      toast.success(
        `${n} product${n === 1 ? "" : "s"} saved to your catalog. Price Adjustment, Margin Protection, and Markdown Ladder can now use these products.`,
        { duration: 6000 },
      );
      if (saved === 0) {
        toast.info("All items already existed in supplier catalog");
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to save to catalog");
    } finally {
      setSavingToCatalog(false);
    }
  };

  const tabs: { key: ReviewTab; label: string; count: number; icon: React.ReactNode; colorClass: string }[] = [
    { key: "accepted", label: "Accepted", count: accepted.length, icon: <Check className="w-3.5 h-3.5" />, colorClass: "text-success" },
    { key: "review", label: "Needs Review", count: needsReview.length, icon: <AlertTriangle className="w-3.5 h-3.5" />, colorClass: "text-secondary" },
    { key: "rejected", label: "Rejected", count: rejected.length, icon: <X className="w-3.5 h-3.5" />, colorClass: "text-destructive" },
  ];


  /** Render a single review row. Extracted so flat view and the new
   *  by-collection view share identical row UI + handlers. */
  const renderReviewRow = (p: ReviewProduct) => (
    <ReviewRow
      key={p._rowIndex}
      product={p}
      tab={activeTab}
      isEditing={editingRow === p._rowIndex}
      isSelected={selectedRows.has(p._rowIndex)}
      onToggleSelect={() => toggleSelectRow(p._rowIndex)}
      onStartEdit={() => setEditingRow(p._rowIndex)}
      onStopEdit={() => {
        const pendingForRow = pendingFieldsForRow(p._rowIndex);
        if (pendingForRow.length > 0) {
          setAwaitingReasonRows(prev => new Set(prev).add(p._rowIndex));
        } else {
          setEditingRow(null);
        }
      }}
      onApprove={() => approveRow(p._rowIndex)}
      onReject={() => rejectRow(p._rowIndex)}
      onMoveToReview={() => moveToReview(p._rowIndex)}
      onRestore={() => restoreToReview(p._rowIndex)}
      onUpdateField={(field, value) => updateField(p._rowIndex, field, value)}
      pendingRowCorrections={pendingFieldsForRow(p._rowIndex)}
      savedReasonFields={new Set(Object.keys(savedReasonFlash).filter(k => k.startsWith(`${p._rowIndex}::`)).map(k => k.split("::")[1]))}
      awaitingRowReason={awaitingReasonRows.has(p._rowIndex)}
      onConfirmRowReason={(reason, detail) => confirmRowReason(p._rowIndex, reason, detail)}
      onSkipRowReason={() => skipRowReason(p._rowIndex)}
      onMarkAs={(markAs) => markRowAs(p._rowIndex, markAs)}
      onSplit={() => splitRow(p._rowIndex)}
      showTeachAI={showTeachAI === p._rowIndex}
      onToggleTeachAI={() => setShowTeachAI(showTeachAI === p._rowIndex ? null : p._rowIndex)}
      supplierName={supplierName}
      parsingPlan={debug.parsingPlan}
      invoicePages={invoicePages}
      onShowSourceTrace={(prod) => setSourceTraceProduct(prod)}
      lowConfFields={lowConfFields}
      qtyHeaderWarning={lookupQtyWarning(p)}
    />
  );

  return (
    <div className="flex flex-col min-h-0">
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold font-display">Review Products</h2>
        </div>
        <p className="text-xs text-muted-foreground">Review, fix, and teach the AI before exporting</p>
      </div>

      {/* Summary Panel */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
        <StatCard label="Total Rows" value={products.length} icon={<FileText className="w-3.5 h-3.5" />} colorClass="text-foreground bg-muted/30 border-border" />
        <StatCard label="Accepted" value={accepted.length} icon={<Check className="w-3.5 h-3.5" />} colorClass="text-success bg-success/10 border-success/20" />
        <StatCard label="Review" value={needsReview.length} icon={<AlertTriangle className="w-3.5 h-3.5" />} colorClass="text-secondary bg-secondary/10 border-secondary/20" />
        <StatCard label="Rejected" value={rejected.length} icon={<X className="w-3.5 h-3.5" />} colorClass="text-destructive bg-destructive/10 border-destructive/20" />
        <StatCard label="Est. Cost" value={`$${totalEstimatedCost.toFixed(0)}`} icon={<DollarSign className="w-3.5 h-3.5" />} colorClass="text-primary bg-primary/10 border-primary/20" />
        <StatCard label="Missing Cost" value={missingCostCount} icon={<AlertTriangle className="w-3.5 h-3.5" />} colorClass={missingCostCount > 0 ? "text-secondary bg-secondary/10 border-secondary/20" : "text-success bg-success/10 border-success/20"} />
      </div>

      {enrichmentTotal > 0 && (
        <div className="mb-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-foreground flex items-center gap-2">
          {enrichmentDoneCount >= enrichmentTotal ? (
            <span className="text-success">✓ Enrichment complete — descriptions and images fetched.</span>
          ) : (
            <span className="text-muted-foreground">
              Enriching products in the background… {enrichmentDoneCount} of {enrichmentTotal} complete
            </span>
          )}
        </div>
      )}

      {qtyHeaderWarnings.length > 0 && (
        <div className="bg-secondary/10 border border-secondary/40 rounded-lg p-3 mb-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-secondary mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-secondary">
                Some products extracted with a different size count than the invoice header — please review highlighted rows.
              </p>
              <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                {qtyHeaderWarnings.map((w, i) => (
                  <li key={i}>
                    ⚠️ <span className="text-foreground font-medium">{w.product_title}</span>
                    {w.colour ? <span className="text-muted-foreground"> · {w.colour}</span> : null}
                    <span className="text-muted-foreground"> — extracted {w.extracted_rows} sizes, invoice says Qty: {w.header_qty}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {underExtractionWarning && (
        <UnderExtractionBanner
          warning={underExtractionWarning}
          onReprocessDetailed={onReprocessDetailed}
          isReprocessing={isReprocessing}
        />
      )}

      <SupplierBrainLearningTip
        supplierName={supplierName}
        sessionEditCount={sessionEditCount}
        matchMethod={matchMethod}
      />

      {/* Vendor / Supplier name banner — apply to all rows missing a vendor.
          Critical when the AI couldn't infer the supplier (e.g. handwritten slips
          where rows otherwise show "Unknown" in the product title). */}
      {(() => {
        if (products.length === 0) return null;
        const missingVendor = products.filter(p => !(p.brand || "").trim()).length;
        return (
          <div className="mb-3 flex flex-wrap items-center gap-2 px-3 py-2 rounded-md border border-border bg-muted/20">
            <Truck className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">Vendor / Supplier:</span>
            <Input
              value={bulkVendor}
              onChange={e => setBulkVendor(e.target.value)}
              placeholder={supplierName || "e.g. OM Designs"}
              className="h-7 text-xs w-48"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              disabled={!bulkVendor.trim()}
              onClick={() => {
                const v = bulkVendor.trim();
                onUpdateProducts(products.map(p => ({ ...p, brand: v, _manuallyEdited: true } as any)));
                toast.success(`Vendor set to "${v}" on all ${products.length} rows`);
                setBulkVendor("");
              }}
            >
              Apply to all rows
            </Button>
            {missingVendor > 0 && (
              <span className="text-[10px] text-muted-foreground ml-auto">
                {missingVendor} of {products.length} rows missing a vendor
              </span>
            )}
          </div>
        );
      })()}

      {/* GST mode toggle for cost column — additive, fully reversible */}
      {(() => {
        const sampleCost = products.find(p => (p.cost || 0) > 0)?.cost || 0;
        const factor = 1 + gstRate;
        const stripped = sampleCost > 0 ? (costGstMode === "inclusive" ? sampleCost : sampleCost / factor) : 0;
        return (
          <div className="mb-3 flex flex-wrap items-center gap-2 px-3 py-2 rounded-md border border-border bg-muted/20">
            <Percent className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">Cost prices include GST?</span>
            <div className="flex bg-card rounded-md border border-border overflow-hidden ml-1">
              <button
                type="button"
                onClick={() => {
                  if (costGstMode === "exclusive") return;
                  const updated = products.map(p => ({ ...p, cost: +(((p.cost || 0) * factor)).toFixed(4) }));
                  onUpdateProducts(updated);
                  setCostGstMode("exclusive");
                  toast.success(`Costs restored — GST added back (×${factor.toFixed(2)})`);
                }}
                className={`px-3 py-1 text-[11px] font-medium transition-colors ${
                  costGstMode === "exclusive" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50"
                }`}
              >
                No — already ex-GST
              </button>
              <button
                type="button"
                onClick={() => {
                  if (costGstMode === "inclusive") return;
                  const updated = products.map(p => ({ ...p, cost: +(((p.cost || 0) / factor)).toFixed(4) }));
                  onUpdateProducts(updated);
                  setCostGstMode("inclusive");
                  toast.success(`Stripped ${(gstRate * 100).toFixed(0)}% GST from all costs (÷${factor.toFixed(2)})`);
                }}
                className={`px-3 py-1 text-[11px] font-medium transition-colors ${
                  costGstMode === "inclusive" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50"
                }`}
              >
                Yes — strip {(gstRate * 100).toFixed(0)}% GST
              </button>
            </div>
            {sampleCost > 0 && (
              <span className="text-[10px] text-muted-foreground ml-auto font-mono">
                e.g. ${sampleCost.toFixed(2)} → ${stripped.toFixed(2)} ex-GST
              </span>
            )}
          </div>
        );
      })()}

      {/* Add 10% GST on top of cost — sibling to the strip toggle above.
          Lets users whose supplier cost is genuinely ex-GST store it inc-GST. */}
      {(() => {
        const sampleCost = products.find(p => (p.cost || 0) > 0)?.cost || 0;
        const factor = 1 + gstRate;
        const withGst = sampleCost > 0
          ? (addGstOnTop ? sampleCost : sampleCost * factor)
          : 0;
        return (
          <div className="mb-3 flex flex-wrap items-center gap-2 px-3 py-2 rounded-md border border-border bg-muted/20">
            <Percent className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">
              Add {(gstRate * 100).toFixed(0)}% GST on top of cost?
            </span>
            <div className="flex bg-card rounded-md border border-border overflow-hidden ml-1">
              <button
                type="button"
                onClick={() => {
                  if (!addGstOnTop) return;
                  // Reverse: divide cost back by the factor
                  const updated = products.map(p => ({
                    ...p,
                    cost: +(((p.cost || 0) / factor)).toFixed(4),
                  }));
                  onUpdateProducts(updated);
                  setAddGstOnTop(false);
                  toast.success(`GST removed — costs divided by ${factor.toFixed(2)}`);
                }}
                className={`px-3 py-1 text-[11px] font-medium transition-colors ${
                  !addGstOnTop ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50"
                }`}
              >
                No — keep as-is
              </button>
              <button
                type="button"
                onClick={() => {
                  if (addGstOnTop) return;
                  const updated = products.map(p => ({
                    ...p,
                    cost: +(((p.cost || 0) * factor)).toFixed(4),
                  }));
                  onUpdateProducts(updated);
                  setAddGstOnTop(true);
                  toast.success(`Added ${(gstRate * 100).toFixed(0)}% GST on top (×${factor.toFixed(2)})`);
                }}
                className={`px-3 py-1 text-[11px] font-medium transition-colors ${
                  addGstOnTop ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50"
                }`}
              >
                Yes — add {(gstRate * 100).toFixed(0)}% GST
              </button>
            </div>
            {sampleCost > 0 && (
              <span className="text-[10px] text-muted-foreground ml-auto font-mono">
                e.g. ${sampleCost.toFixed(2)} → ${withGst.toFixed(2)} inc-GST
              </span>
            )}
          </div>
        );
      })()}

      {/* Colour grouping mode — controls how multi-colour styles are exported */}
      {(() => {
        const colourCount = new Set(
          products.map(p => (p.colour || "").trim().toLowerCase()).filter(Boolean)
        ).size;
        if (colourCount < 2) return null;

        const COLOUR_SUFFIX = / - [^-]+$/;
        const stripColourSuffix = (name: string, colour: string) => {
          const c = (colour || "").trim();
          if (!c) return name;
          const re = new RegExp(`\\s*[-–]\\s*${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
          return name.replace(re, "").trim();
        };

        return (
          <div className="mb-3 flex flex-wrap items-center gap-2 px-3 py-2 rounded-md border border-border bg-muted/20">
            <Layers className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">Multi-colour products:</span>
            <div className="flex bg-card rounded-md border border-border overflow-hidden ml-1">
              <button
                type="button"
                onClick={() => {
                  if (colourMode === "variants") return;
                  // Strip the " - Colour" suffix we previously appended
                  const updated = products.map(p => ({
                    ...p,
                    name: stripColourSuffix(p.name || "", p.colour || ""),
                  }));
                  onUpdateProducts(updated);
                  setColourMode("variants");
                  toast.success("Colours grouped as variants of one product");
                }}
                className={`px-3 py-1 text-[11px] font-medium transition-colors ${
                  colourMode === "variants" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50"
                }`}
              >
                One product · colours as variants
              </button>
              <button
                type="button"
                onClick={() => {
                  if (colourMode === "separate") return;
                  // Split combined colour values (e.g. "Thar Desert / Spiral Green")
                  // into one row per colour, then append " - Colour" to each name.
                  const SPLIT_RE = /\s*[\/,&]\s*|\s+(?:and|AND|y|Y)\s+/;
                  const updated: typeof products = [];
                  let extraRows = 0;
                  products.forEach(p => {
                    const baseName = stripColourSuffix(p.name || "", p.colour || "");
                    const raw = (p.colour || "").trim();
                    const parts = raw ? raw.split(SPLIT_RE).map(s => s.trim()).filter(Boolean) : [""];
                    if (parts.length <= 1) {
                      const colour = parts[0] || "";
                      updated.push({
                        ...p,
                        name: colour ? `${baseName} - ${colour}` : baseName,
                      });
                    } else {
                      // Divide qty as evenly as possible across the split colours
                      const totalQty = Number((p as any).qty) || 0;
                      const per = totalQty > 0 ? Math.floor(totalQty / parts.length) : 0;
                      const remainder = totalQty > 0 ? totalQty - per * parts.length : 0;
                      parts.forEach((colour, i) => {
                        const qty = per + (i < remainder ? 1 : 0);
                        updated.push({
                          ...p,
                          _rowIndex: p._rowIndex + i * 0.001, // keep stable-ish order
                          name: `${baseName} - ${colour}`,
                          colour,
                          ...(totalQty > 0 ? { qty } : {}),
                        } as any);
                      });
                      extraRows += parts.length - 1;
                    }
                  });
                  // Re-sequence _rowIndex so downstream logic stays clean
                  const reindexed = updated.map((p, i) => ({ ...p, _rowIndex: i }));
                  onUpdateProducts(reindexed);
                  setColourMode("separate");
                  toast.success(
                    extraRows > 0
                      ? `Split into ${reindexed.length} separate products (${extraRows} new rows)`
                      : "Each colour will be exported as a separate product"
                  );
                }}
                className={`px-3 py-1 text-[11px] font-medium transition-colors ${
                  colourMode === "separate" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50"
                }`}
              >
                Separate product per colour
              </button>
            </div>
            <span className="text-[10px] text-muted-foreground ml-auto">
              {colourCount} colours detected
            </span>
          </div>
        );
      })()}

      <FieldConfidenceHeader
        fieldConfidence={fieldConfidence}
        extractionNotes={extractionNotes}
      />

      <div className="flex items-center gap-3 mb-3 text-xs text-muted-foreground">
        <span><Layers className="w-3 h-3 inline mr-1" />{groupedProducts.length} grouped products</span>
        <span>·</span>
        <span>Avg confidence: <span className={avgConfidence >= 80 ? "text-success font-semibold" : avgConfidence >= 50 ? "text-secondary font-semibold" : "text-destructive font-semibold"}>{avgConfidence}%</span></span>
      </div>

      {/* Tab bar + view toggle */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex flex-1 bg-muted/30 rounded-lg p-1">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => { setActiveTab(t.key); setSelectedRows(new Set()); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-md text-xs font-medium transition-colors ${
                activeTab === t.key ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:bg-muted/50"
              }`}
            >
              <span className={t.colorClass}>{t.icon}</span>
              {t.label}
              <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
                activeTab === t.key ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
              }`}>{t.count}</span>
            </button>
          ))}
        </div>
        {activeTab !== "rejected" && (
          <div className="flex bg-muted/30 rounded-lg p-1" role="tablist" aria-label="Review view mode">
            <button
              onClick={() => setViewMode("flat")}
              title="Flat list — every row in invoice order"
              aria-pressed={viewMode === "flat"}
              className={`px-2.5 py-2 rounded-md text-[10px] font-medium transition-colors ${viewMode === "flat" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"}`}
            >
              <FileText className="w-3 h-3" />
            </button>
            <button
              onClick={() => setViewMode("grouped")}
              title="Group by style — variants of the same product collapsed"
              aria-pressed={viewMode === "grouped"}
              className={`px-2.5 py-2 rounded-md text-[10px] font-medium transition-colors ${viewMode === "grouped" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"}`}
            >
              <Layers className="w-3 h-3" />
            </button>
            <button
              onClick={() => { setViewMode("by-collection"); setFocusedCollection(null); }}
              title="Group by collection / story — review one collection at a time"
              aria-pressed={viewMode === "by-collection"}
              className={`px-2.5 py-2 rounded-md text-[10px] font-medium transition-colors ${viewMode === "by-collection" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"}`}
            >
              <FolderTree className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <div className="relative flex-1 min-w-[140px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search products..." className="h-8 pl-8 text-xs" />
        </div>
        <select value={vendorFilter} onChange={e => setVendorFilter(e.target.value)} className="h-8 rounded-md bg-input border border-border px-2 text-xs min-w-[100px]">
          <option value="all">All vendors</option>
          {vendors.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={confFilter} onChange={e => setConfFilter(e.target.value as ConfFilter)} className="h-8 rounded-md bg-input border border-border px-2 text-xs">
          <option value="all">All confidence</option>
          <option value="high">High (90-100%)</option>
          <option value="medium">Medium (50-89%)</option>
          <option value="low">Low (&lt;50%)</option>
        </select>
        <button onClick={() => setShowEditedOnly(!showEditedOnly)} className={`px-2.5 py-1.5 rounded-md text-[10px] font-medium border transition-colors ${showEditedOnly ? "bg-primary/10 border-primary text-primary" : "bg-muted border-border text-muted-foreground"}`}>
          <Edit3 className="w-3 h-3 inline mr-1" />Edited
        </button>
        <button onClick={() => setShowCorrectedOnly(!showCorrectedOnly)} className={`px-2.5 py-1.5 rounded-md text-[10px] font-medium border transition-colors ${showCorrectedOnly ? "bg-primary/10 border-primary text-primary" : "bg-muted border-border text-muted-foreground"}`}>
          <Zap className="w-3 h-3 inline mr-1" />Auto-corrected
        </button>
      </div>

      {/* Bulk actions bar */}
      <div className="flex flex-wrap gap-1.5 mb-3 items-center">
        {selectedRows.size > 0 && (
          <>
            <Badge variant="outline" className="text-[10px] h-6">{selectedRows.size} selected</Badge>
            <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={clearSelection}>Clear</Button>
            <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 text-success" onClick={() => selectedRows.forEach(idx => approveRow(idx))}>
              <Check className="w-3 h-3" /> Accept selected
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 text-destructive" onClick={() => { selectedRows.forEach(idx => rejectRow(idx)); setSelectedRows(new Set()); }}>
              <X className="w-3 h-3" /> Reject selected
            </Button>
            {selectedRows.size >= 2 && (
              <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={mergeSelected}>
                <Merge className="w-3 h-3" /> Merge selected
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={markSelectedAsFreight}>
              <Truck className="w-3 h-3" /> Mark freight/tax
            </Button>
            <div className="flex items-center gap-1">
              <Input value={bulkVendor} onChange={e => setBulkVendor(e.target.value)} placeholder="Vendor..." className="h-7 text-[10px] w-24" />
              <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={applyBulkVendor} disabled={!bulkVendor.trim()}>Apply</Button>
            </div>
            <div className="flex items-center gap-1" title="Tag selected rows with a collection / story (e.g. Summer Chintz)">
              <FolderTree className="w-3 h-3 text-muted-foreground" />
              <Input
                value={bulkCollection}
                onChange={e => setBulkCollection(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") applyBulkCollection(); }}
                placeholder="Collection..."
                list="sonic-known-collections"
                className="h-7 text-[10px] w-32"
              />
              <datalist id="sonic-known-collections">
                {allCollectionNames.map(n => <option key={n} value={n} />)}
              </datalist>
              <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={applyBulkCollection} disabled={!bulkCollection.trim()}>Tag</Button>
            </div>
          </>
        )}
        {selectedRows.size === 0 && (
          <>
            <Button variant="ghost" size="sm" className="h-7 text-[10px] gap-1 text-muted-foreground" onClick={selectAll}>Select all</Button>
            {activeTab === "review" && needsReview.length > 0 && (
              <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={acceptAllHighConfidence}>
                <CheckCheck className="w-3 h-3" /> Accept high-confidence
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 text-destructive border-destructive/30" onClick={rejectAllSummaryRows}>
              <Receipt className="w-3 h-3" /> Reject summary rows
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 text-destructive border-destructive/30" onClick={rejectAllNumericOnly}>
              <Hash className="w-3 h-3" /> Reject numeric-only
            </Button>
          </>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto max-h-[500px] border border-border rounded-lg bg-card">
        {viewMode === "grouped" && activeTab !== "rejected" ? (
          /* ── Grouped Product View ── */
          groupedProducts.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No grouped products detected — switch to flat view</div>
          ) : (
            <div className="divide-y divide-border/50">
              {groupedProducts.map(group => (
                <GroupedProductCard
                  key={group.groupId}
                  group={group}
                  onUpdateField={updateField}
                  onRejectVariant={(idx) => rejectRow(idx)}
                  onSplitVariant={splitRow}
                  supplierName={supplierName}
                  parsingPlan={debug.parsingPlan}
                />
              ))}
            </div>
          )
        ) : viewMode === "by-collection" && activeTab !== "rejected" ? (
          /* ── Group by Collection / Story view ──
             Renders one collapsible section per collection (in invoice
             order). Lets the merchant work through "Summer Chintz" then
             "Beach Bound" without losing place between them. */
          collectionGroups.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {activeTab === "review"
                ? "✓ No rows need review — all clean!"
                : "No products in this tab"}
            </div>
          ) : (
            <div className="divide-y divide-border/70">
              {collectionGroups.map((group, gi) => {
                const isUnassigned = group.name === UNASSIGNED_COLLECTION;
                const isFocused = focusedCollection === group.name;
                const isHidden = focusedCollection !== null && !isFocused;
                const isDone = doneCollections.has(group.name);
                if (isHidden) return null;
                const headerColor = isUnassigned
                  ? "bg-muted/30 border-l-4 border-muted-foreground/30"
                  : "bg-primary/5 border-l-4 border-primary";
                return (
                  <section key={group.name} aria-label={`Collection ${group.name}`}>
                    <header className={`sticky top-0 z-10 flex flex-wrap items-center gap-2 px-3 py-2 ${headerColor} backdrop-blur-sm`}>
                      <FolderTree className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="text-xs font-semibold text-foreground truncate">
                        {isUnassigned ? "Unassigned (no collection)" : group.name}
                      </span>
                      <Badge variant="outline" className="text-[9px] h-5">
                        {group.items.length} row{group.items.length === 1 ? "" : "s"}
                      </Badge>
                      <Badge variant="outline" className="text-[9px] h-5">
                        {group.totalUnits} units
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        Step {gi + 1} of {collectionGroups.length}
                      </span>
                      <div className="ml-auto flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-[10px] gap-1"
                          onClick={() => {
                            const next = new Set(selectedRows);
                            group.items.forEach(i => next.add(i._rowIndex));
                            setSelectedRows(next);
                          }}
                        >
                          Select all
                        </Button>
                        {isFocused ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-[10px] gap-1"
                            onClick={() => setFocusedCollection(null)}
                          >
                            Show all collections
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-[10px] gap-1"
                            onClick={() => setFocusedCollection(group.name)}
                          >
                            Focus this collection
                          </Button>
                        )}
                        <Button
                          variant={isDone ? "secondary" : "outline"}
                          size="sm"
                          className="h-6 text-[10px] gap-1"
                          onClick={() => {
                            const next = new Set(doneCollections);
                            if (isDone) next.delete(group.name); else next.add(group.name);
                            setDoneCollections(next);
                          }}
                        >
                          <Check className="w-3 h-3" />
                          {isDone ? "Done" : "Mark done"}
                        </Button>
                      </div>
                    </header>
                    {!isDone && (
                      <div className="divide-y divide-border/50">
                        {group.items.map(p => renderReviewRow(p))}
                      </div>
                    )}
                    {isDone && (
                      <div className="px-3 py-2 text-[10px] text-muted-foreground italic bg-success/5">
                        Collection collapsed — click "Done" again to re-open.
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )
        ) : (
          /* ── Flat Row View ── */
          currentList.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-muted-foreground">
                {activeTab === "accepted" && "No accepted products yet"}
                {activeTab === "review" && "✓ No rows need review — all clean!"}
                {activeTab === "rejected" && "No rows were rejected"}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {currentList.map(p => renderReviewRow(p as ReviewProduct))}
            </div>
          )
        )}
      </div>

      {/* Debug panel */}
      {invoicePages.length > 0 && (
        <div className="mt-3 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-[10px] h-8"
            onClick={() => setShowDebugOverlay(true)}
          >
            <ScanLine className="w-3.5 h-3.5" />
            Extraction Debug View
            <Badge variant="outline" className="text-[8px] h-4 px-1 ml-1">{products.filter(p => !p._rejected).length} rows</Badge>
          </Button>
        </div>
      )}
      <div className={`${invoicePages.length > 0 ? "mt-2" : "mt-3"} border border-border rounded-lg bg-card overflow-hidden`}>
        <button onClick={() => setShowDebug(!showDebug)} className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-muted-foreground hover:bg-muted/30 transition-colors">
          <Bug className="w-3.5 h-3.5" />
          <span className="font-medium">AI Parsing Details</span>
          <span className="text-[10px] ml-auto mr-2">Method: {matchMethod} · {debug.corrections.length + sessionEditCount} corrections{supplierName ? ` · ${supplierName}` : ""}</span>
          {showDebug ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        {showDebug && (
          <div className="border-t border-border">
            {debug.parsingPlan && (
              <div className="px-4 py-3 bg-muted/10 border-b border-border">
                <p className="text-[10px] font-semibold text-foreground mb-2 flex items-center gap-1"><Zap className="w-3 h-3" /> Parsing Strategy Plan</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                  <DetailRow label="Document type" value={debug.parsingPlan.document_type || "—"} />
                  <DetailRow label="Layout type" value={debug.parsingPlan.layout_type || "—"} />
                  <DetailRow label="Variant method" value={debug.parsingPlan.variant_method || "—"} />
                  <DetailRow label="Line-item zone" value={debug.parsingPlan.line_item_zone || "—"} />
                  <DetailRow label="Quantity field" value={debug.parsingPlan.quantity_field || "—"} />
                  <DetailRow label="Cost field" value={debug.parsingPlan.cost_field || "—"} />
                  <DetailRow label="Grouping required" value={debug.parsingPlan.grouping_required ? `Yes — ${debug.parsingPlan.grouping_reason || ""}` : "No"} />
                  <DetailRow label="Row count" value={debug.parsingPlan.row_count != null ? String(debug.parsingPlan.row_count) : "—"} highlight />
                  <DetailRow label="Expected review" value={debug.parsingPlan.expected_review_level || "—"} highlight />
                </div>
                {debug.parsingPlan.row_anchors_detected && debug.parsingPlan.row_anchors_detected.length > 0 && (
                  <div className="mt-2 border-t border-border/30 pt-2">
                    <p className="text-[10px] font-semibold text-foreground mb-1.5 flex items-center gap-1">
                      <Layers className="w-3 h-3" /> Row Anchors Detected ({debug.parsingPlan.row_anchors_detected.length})
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {debug.parsingPlan.row_anchors_detected.map((code, i) => (
                        <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[9px] font-mono font-medium">
                          {code}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {debug.parsingPlan.strategy_explanation && (
                  <p className="mt-2 text-[10px] text-muted-foreground italic border-t border-border/30 pt-1.5">💡 {debug.parsingPlan.strategy_explanation}</p>
                )}
              </div>
            )}
            {debug.rejectedByAI && debug.rejectedByAI.length > 0 && (
              <div className="px-4 py-2 bg-destructive/5 border-b border-border">
                <p className="text-[10px] font-semibold text-destructive mb-1">🚫 Rows Rejected by AI ({debug.rejectedByAI.length})</p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {debug.rejectedByAI.map((r, i) => (
                    <div key={i} className="flex gap-2 text-[9px]">
                      <span className="text-muted-foreground max-w-[200px] truncate">{r.raw_text}</span>
                      <span className="text-destructive">→ {r.rejection_reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="px-4 py-2 bg-muted/20 text-[10px] text-muted-foreground">
              {debug.totalRaw} rows parsed → {debug.accepted} accepted, {debug.needsReview} flagged, {debug.rejected} rejected
            </div>
          </div>
        )}
      </div>

      {/* Export warning modal */}
      {showExportWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-card rounded-xl border border-border shadow-lg max-w-sm w-full p-5 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-secondary" />
              <h3 className="font-semibold text-sm">Some rows still need review</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              {needsReview.length} row{needsReview.length > 1 ? "s" : ""} still need review. Export accepted rows only or review them first.
            </p>
            <div className="flex gap-2">
              <Button variant="teal" size="sm" className="flex-1 h-9 text-xs" onClick={() => { setShowExportWarning(false); triggerProfileUpdate(); onExportAccepted(); }}>
                <Download className="w-3.5 h-3.5 mr-1" /> Export Accepted Only
              </Button>
              <Button variant="outline" size="sm" className="flex-1 h-9 text-xs" onClick={() => { setShowExportWarning(false); setActiveTab("review"); }}>
                Review Remaining
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Source Trace Viewer Modal */}
      {sourceTraceProduct && invoicePages.length > 0 && (
        <div className="fixed inset-0 z-50 bg-black/60 p-4 flex items-center justify-center">
          <div className="w-full max-w-5xl h-[80vh]">
            <SourceTraceViewer
              product={sourceTraceProduct}
              invoicePages={invoicePages}
              onClose={() => setSourceTraceProduct(null)}
              allProducts={products}
              showDebugZones={showDebugZones}
            />
          </div>
        </div>
      )}

      {/* Extraction Debug Overlay Modal */}
      {showDebugOverlay && invoicePages.length > 0 && (
        <div className="fixed inset-0 z-50 bg-black/60 p-4 flex items-center justify-center">
          <div className="w-full max-w-6xl h-[85vh]">
            <InvoiceDebugOverlay
              invoicePages={invoicePages}
              products={products}
              rejectedRows={debug.rejectedByAI}
              parsingPlan={debug.parsingPlan}
              onClose={() => setShowDebugOverlay(false)}
            />
          </div>
        </div>
      )}

      {/* Sticky bottom action bar */}
      <div className="sticky bottom-0 mt-4 -mx-4 px-4 py-3 bg-background border-t border-border space-y-2">
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoRefineProfile}
            onChange={(e) => {
              setAutoRefineProfile(e.target.checked);
              localStorage.setItem("sonic_auto_refine_profile", String(e.target.checked));
            }}
            className="rounded border-border"
          />
          <Brain className="w-3 h-3" />
          Use my corrections to improve future extractions (recommended)
        </label>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onBack} className="gap-1">
            <ChevronDown className="w-3.5 h-3.5 rotate-90" /> Back
          </Button>
          <Button variant="outline" size="sm" onClick={handleSaveToCatalog} className="gap-1" disabled={savingToCatalog}>
            <Package className="w-3.5 h-3.5" />
            {savingToCatalog ? "Saving…" : savedToCatalog ? "✅ Saved to catalog" : "Save to Catalog"}
          </Button>
          {onPriceMatch && (
            <Button variant="outline" size="sm" onClick={onPriceMatch} className="gap-1">
              <Tag className="w-3.5 h-3.5" /> Price Match
            </Button>
          )}
          <div className="flex-1" />
          {onGetDescriptions && (
            <Button variant="secondary" size="sm" onClick={onGetDescriptions} className="gap-1">
              <FileText className="w-3.5 h-3.5" /> Get Descriptions
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleExportClick} className="gap-1">
            <Download className="w-3.5 h-3.5" /> Export Accepted ({accepted.length})
          </Button>
          <Button variant="teal" size="sm" onClick={() => { triggerProfileUpdate(); if (needsReview.length > 0) setShowExportWarning(true); else onPushToShopify(); }} className="gap-1">
            <ArrowUpRight className="w-3.5 h-3.5" /> Push to Shopify ({accepted.length})
          </Button>
          {watchdogRun && watchdogRun.autoPublishEligible && (
            <Button
              variant="teal"
              size="sm"
              onClick={handleAutoPublish}
              disabled={autoPublishing}
              className="gap-1"
            >
              <Zap className="w-3.5 h-3.5" />
              {autoPublishing ? "Publishing…" : "Auto-publish to Shopify"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Stat Card ──
function StatCard({ label, value, icon, colorClass }: { label: string; value: string | number; icon: React.ReactNode; colorClass: string }) {
  return (
    <div className={`rounded-lg border p-2.5 text-center ${colorClass}`}>
      <div className="flex items-center justify-center gap-1 mb-0.5">{icon}</div>
      <p className="text-base font-bold font-display">{value}</p>
      <p className="text-[9px] opacity-80">{label}</p>
    </div>
  );
}

// ── Grouped Product Card (Fashion view) ──
function GroupedProductCard({
  group, onUpdateField, onRejectVariant, onSplitVariant, supplierName, parsingPlan,
}: {
  group: ProductGroup;
  onUpdateField: (rowIndex: number, field: string, value: string | number) => void;
  onRejectVariant: (rowIndex: number) => void;
  onSplitVariant: (rowIndex: number) => void;
  supplierName?: string;
  parsingPlan?: import("@/lib/invoice-validator").ParsingPlan;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editingParent, setEditingParent] = useState(false);
  const [showWhyAI, setShowWhyAI] = useState(false);

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <button onClick={() => setExpanded(!expanded)} className="mt-1 text-muted-foreground">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Package className="w-4 h-4 text-primary" />
            {editingParent ? (
              <Input
                defaultValue={group.parentTitle}
                onBlur={e => {
                  group.variants.forEach(v => onUpdateField(v._rowIndex, "name", e.target.value + (v.size ? ` - ${v.size}` : "")));
                  setEditingParent(false);
                }}
                className="h-7 text-sm font-semibold flex-1"
                autoFocus
              />
            ) : (
              <span className="text-sm font-semibold truncate cursor-pointer hover:text-primary" onClick={() => setEditingParent(true)}>
                {group.parentTitle}
              </span>
            )}
            <Badge variant="outline" className="text-[9px] h-5 shrink-0">{group.variants.length} variants</Badge>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
            {group.styleCode && <span><Hash className="w-3 h-3 inline mr-0.5" />{group.styleCode}</span>}
            {group.colour && <span>Colour: {group.colour}</span>}
            <span>{group.vendor}</span>
            <span>${group.unitCost.toFixed(2)} ea</span>
            <span className="font-semibold text-foreground">{group.totalUnits} total units</span>
          </div>
        </div>
      </div>

      {expanded && (
        <>
          <div className="ml-10 mt-2">
            <SizeGridEditor
              label={group.styleCode || undefined}
              unitCost={group.unitCost}
              sizes={group.variants.map(v => ({
                size: v.size || "—",
                qty: v.qty || 0,
                confidence: v._confidenceLevel,
                handwritten: (v._parseNotes || "").toLowerCase().includes("handwritten"),
              }))}
              onChange={(updated) => {
                updated.forEach((s, i) => {
                  if (i < group.variants.length) {
                    const v = group.variants[i];
                    if (s.qty !== v.qty) onUpdateField(v._rowIndex, "qty", s.qty);
                    if (s.size !== (v.size || "—")) onUpdateField(v._rowIndex, "size", s.size);
                  }
                });
                // Handle removals
                if (updated.length < group.variants.length) {
                  for (let i = updated.length; i < group.variants.length; i++) {
                    onRejectVariant(group.variants[i]._rowIndex);
                  }
                }
              }}
            />
          </div>
          <div className="ml-10 mt-2 border border-primary/15 rounded-md overflow-hidden">
            <button
              onClick={() => setShowWhyAI(!showWhyAI)}
              className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium text-primary bg-primary/5 hover:bg-primary/10 transition-colors"
            >
              <Bug className="w-3 h-3" />
              Why AI grouped this
              {showWhyAI ? <ChevronDown className="w-3 h-3 ml-auto" /> : <ChevronRight className="w-3 h-3 ml-auto" />}
            </button>
            {showWhyAI && (
              <WhyAIPanel product={group.variants[0]} parsingPlan={parsingPlan} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Review Row (Flat view) ──
function ReviewRow({
  product: p, tab, isEditing, isSelected,
  onToggleSelect, onStartEdit, onStopEdit,
  onApprove, onReject, onMoveToReview, onRestore,
  onUpdateField, onMarkAs, onSplit,
  showTeachAI, onToggleTeachAI, supplierName, parsingPlan,
  invoicePages, onShowSourceTrace,
  pendingRowCorrections, savedReasonFields,
  awaitingRowReason, onConfirmRowReason, onSkipRowReason,
  lowConfFields,
  qtyHeaderWarning = null,
}: {
  product: ReviewProduct;
  tab: ReviewTab;
  isEditing: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onApprove: () => void;
  onReject: () => void;
  onMoveToReview: () => void;
  onRestore: () => void;
  onUpdateField: (field: string, value: string | number) => void;
  onMarkAs: (markAs: "freight" | "tax" | "summary" | "non-product") => void;
  onSplit: () => void;
  showTeachAI: boolean;
  onToggleTeachAI: () => void;
  supplierName?: string;
  parsingPlan?: import("@/lib/invoice-validator").ParsingPlan;
  invoicePages?: string[];
  onShowSourceTrace?: (product: ReviewProduct) => void;
  /** All currently-queued field changes for this row, awaiting a reason. */
  pendingRowCorrections?: Array<{ field: string; fieldLabel: string; originalValue: string; correctedValue: string }>;
  savedReasonFields?: Set<string>;
  /** True when the user has clicked "Done editing" with pending changes — show the bar. */
  awaitingRowReason?: boolean;
  /** Picked a reason for the entire row — applies it to every pending change. */
  onConfirmRowReason?: (reason: CorrectionReason, detail?: string) => void;
  /** Dismissed the bar without picking — record everything as "unspecified". */
  onSkipRowReason?: () => void;
  lowConfFields?: Set<string>;
  /** Set when this row's product was flagged by the Qty header validator —
   *  drives a yellow border + ⚠️ pill so users know exactly which row to check. */
  qtyHeaderWarning?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showWhyAI, setShowWhyAI] = useState(false);
  // Tint label for low-confidence fields. < 50 was tinted destructive at the
  // banner level; here we keep both <50 and 50–69 visually muted-amber to keep
  // the row UI calm — the dot/banner above already escalates to red.
  const labelCls = (field: string) =>
    `text-[10px] mb-0.5 block ${lowConfFields?.has(field) ? "text-secondary font-medium" : "text-muted-foreground"}`;

  return (
    <div id={`review-row-${p._rowIndex}`} className={`transition-colors ${tab === "rejected" ? "opacity-60" : ""} ${isSelected ? "bg-primary/5" : ""} ${qtyHeaderWarning ? "border-l-4 border-l-secondary bg-secondary/5" : ""}`}>
      {qtyHeaderWarning && (
        <div className="px-4 pt-2 flex items-center gap-1.5 text-[10px] text-secondary">
          <Badge variant="outline" className="border-secondary/50 text-secondary text-[9px] px-1.5 py-0 h-4">⚠️ Qty mismatch</Badge>
          <span className="text-muted-foreground">{qtyHeaderWarning}</span>
        </div>
      )}
      <div className="px-4 py-3 flex items-center gap-2">
        {/* Select checkbox */}
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          className="w-3.5 h-3.5 rounded border-border accent-primary shrink-0"
        />

        <button onClick={() => setExpanded(!expanded)} className="shrink-0 text-muted-foreground">
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>

        {/* Confidence */}
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="shrink-0 w-10 text-center cursor-help">
                <span className={`text-sm font-bold font-mono ${
                  p._confidenceLevel === "high" ? "text-success" :
                  p._confidenceLevel === "medium" ? "text-secondary" : "text-destructive"
                }`}>{p._confidence}%</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[240px] p-2">
              <p className="text-[10px] font-semibold mb-1">Score breakdown</p>
              <div className="space-y-0.5">
                {(p._confidenceReasons || []).slice(0, 6).map((r, i) => (
                  <div key={i} className={`text-[9px] flex items-center gap-1 ${r.delta > 0 ? "text-success" : "text-destructive"}`}>
                    <span className="font-mono">{r.delta > 0 ? "+" : ""}{r.delta}</span>
                    <span className="text-muted-foreground">{r.label}</span>
                  </div>
                ))}
              </div>
              {p._extractionReason && (
                <p className="text-[9px] text-muted-foreground mt-1 pt-1 border-t border-border/50">
                  {p._extractionReason}
                </p>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Product info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className={`text-sm font-medium truncate ${p._rejected ? "line-through text-muted-foreground" : ""}`}>
              {p._rejected ? (p._rawName || "(empty)") : (p.name || p._rawName || "(empty)")}
            </p>
            {p._corrections.length > 0 && !p._rejected && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-primary/30 text-primary shrink-0">Auto-corrected</Badge>
            )}
            {p._manuallyEdited && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-secondary/30 text-secondary shrink-0">Edited</Badge>
            )}
            {p._sourcePage && (
              <Badge variant="outline" className="text-[8px] px-1 py-0 h-4 border-muted-foreground/30 text-muted-foreground shrink-0">p.{p._sourcePage}</Badge>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground truncate mt-0.5">
            {tab === "rejected" ? (
              <span className="text-destructive">{p._rejectReason}</span>
            ) : (
              <>
                {p.brand && <span>{p.brand}</span>}
                {p.sku && <span> · {p.sku}</span>}
                {p.colour && <span> · {p.colour}</span>}
                {p.size && <span> · {p.size}</span>}
                {p.cost > 0 && <span> · ${p.cost.toFixed(2)}</span>}
                {p.qty > 0 && <span> · Qty: {p.qty}</span>}
                {p.cost > 0 && p.qty > 0 && <span className="text-foreground font-medium"> · Line: ${(p.cost * p.qty).toFixed(2)}</span>}
              </>
            )}
          </p>
        </div>

        {/* Inline source preview thumbnail */}
        {invoicePages && invoicePages.length > 0 && p._sourceTrace && (
          <InlineSourcePreview
            product={p}
            invoicePages={invoicePages}
            onClick={() => onShowSourceTrace?.(p)}
          />
        )}
        {/* Source trace button (when no trace data but pages exist) */}
        {invoicePages && invoicePages.length > 0 && !p._sourceTrace && (
          <button
            onClick={() => onShowSourceTrace?.(p)}
            className="w-8 h-8 rounded border border-border flex items-center justify-center shrink-0 hover:bg-muted/30 transition-colors"
            title="View source page"
          >
            <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        )}

        {/* Actions */}
        <div className="flex gap-0.5 shrink-0">
          {tab === "accepted" && (
            <>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onStartEdit} title="Edit"><Edit3 className="w-3.5 h-3.5 text-muted-foreground" /></Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onToggleTeachAI} title="Teach AI"><Brain className="w-3.5 h-3.5 text-primary" /></Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onMoveToReview} title="Move to Review"><AlertTriangle className="w-3.5 h-3.5 text-secondary" /></Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onReject} title="Reject"><X className="w-3.5 h-3.5 text-destructive" /></Button>
            </>
          )}
          {tab === "review" && (
            <>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px] text-success gap-1" onClick={onApprove}><Check className="w-3.5 h-3.5" /> Accept</Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onStartEdit} title="Edit"><Edit3 className="w-3.5 h-3.5 text-muted-foreground" /></Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onToggleTeachAI} title="Teach AI"><Brain className="w-3.5 h-3.5 text-primary" /></Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onReject} title="Reject"><X className="w-3.5 h-3.5 text-destructive" /></Button>
            </>
          )}
          {tab === "rejected" && (
            <>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px] gap-1" onClick={onRestore}><RotateCcw className="w-3 h-3" /> Restore</Button>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px] gap-1" onClick={onApprove}><Check className="w-3 h-3" /> Accept</Button>
            </>
          )}
        </div>
      </div>

      {/* Expanded detail / edit / teach AI area */}
      {(expanded || isEditing || showTeachAI) && (
        <div className="px-4 pb-4 ml-[52px]">
          {isEditing ? (
            <div className="bg-muted/30 rounded-lg p-3 space-y-2">
              {/* Show a small green check beside any field that has just been
                  recorded; the row-level picker below captures the reason. */}
              <div>
                <label className={labelCls("name")}>Product Title</label>
                <Input defaultValue={p.name} onBlur={e => onUpdateField("name", e.target.value)} className="h-8 text-xs" />
                {savedReasonFields?.has("name") && <CorrectionSavedCheck />}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls("brand")}>Vendor</label>
                  <Input defaultValue={p.brand} onBlur={e => onUpdateField("brand", e.target.value)} className="h-8 text-xs" />
                  {savedReasonFields?.has("brand") && <CorrectionSavedCheck />}
                </div>
                <div>
                  <label className={labelCls("sku")}>Style Code / SKU</label>
                  <Input defaultValue={p.sku} onBlur={e => onUpdateField("sku", e.target.value)} className="h-8 text-xs" />
                  {savedReasonFields?.has("sku") && <CorrectionSavedCheck />}
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className={labelCls("cost")}>Unit Cost</label>
                  <Input type="number" defaultValue={p.cost} onBlur={e => onUpdateField("cost", parseFloat(e.target.value) || 0)} className="h-8 text-xs" />
                  {savedReasonFields?.has("cost") && <CorrectionSavedCheck />}
                </div>
                <div>
                  <label className={labelCls("qty")}>Qty</label>
                  <Input type="number" defaultValue={p.qty} onBlur={e => onUpdateField("qty", parseInt(e.target.value) || 0)} className="h-8 text-xs" />
                  {savedReasonFields?.has("qty") && <CorrectionSavedCheck />}
                </div>
                <div>
                  <label className={labelCls("size")}>Size</label>
                  <Input defaultValue={p.size} onBlur={e => onUpdateField("size", e.target.value)} className="h-8 text-xs" />
                  {savedReasonFields?.has("size") && <CorrectionSavedCheck />}
                </div>
                <div>
                  <label className={labelCls("colour")}>Colour</label>
                  <Input defaultValue={p.colour} onBlur={e => onUpdateField("colour", e.target.value)} className="h-8 text-xs" />
                  {savedReasonFields?.has("colour") && <CorrectionSavedCheck />}
                </div>
              </div>
              {/* Size grid editor for multi-size rows */}
              {p.size && p.size.includes(",") && (
                <SizeGridEditor
                  label={p.sku || undefined}
                  unitCost={p.cost}
                  sizes={p.size.split(",").map(s => s.trim()).filter(Boolean).map(s => ({
                    size: s,
                    qty: Math.round(p.qty / p.size.split(",").filter(Boolean).length),
                    confidence: p._confidenceLevel,
                    handwritten: (p._parseNotes || "").toLowerCase().includes("handwritten"),
                  }))}
                  onChange={(updated) => {
                    const newSizes = updated.map(u => u.size).join(", ");
                    const newQty = updated.reduce((sum, u) => sum + u.qty, 0);
                    onUpdateField("size", newSizes);
                    onUpdateField("qty", newQty);
                  }}
                />
              )}

              {/* Row-level reason picker — shown after the user clicks "Done editing"
                  and at least one field was changed. Choosing a reason persists every
                  pending change with that reason and moves the row to Accepted. */}
              {awaitingRowReason && (pendingRowCorrections?.length ?? 0) > 0 && onConfirmRowReason && onSkipRowReason && (
                <CorrectionReasonPicker
                  summary={`${pendingRowCorrections!.length} field${pendingRowCorrections!.length === 1 ? "" : "s"} changed: ${pendingRowCorrections!.map(c => c.fieldLabel).join(", ")}`}
                  onPick={(r, d) => onConfirmRowReason(r, d)}
                  onDismiss={onSkipRowReason}
                />
              )}

              <div className="flex justify-between items-center">
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-7 text-[10px] gap-1 text-muted-foreground" onClick={onSplit}>
                    <Scissors className="w-3 h-3" /> Split
                  </Button>
                </div>
                <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={onStopEdit}>
                  {awaitingRowReason ? "Pick a reason above" : "Done editing"}
                </Button>
              </div>
            </div>
          ) : showTeachAI ? (
            <TeachAIPanel product={p} supplierName={supplierName} onClose={onToggleTeachAI} />
          ) : (
            <div className="bg-muted/20 rounded-lg p-3 space-y-2 text-[11px]">
              {/* Why extracted/rejected */}
              <div className="bg-primary/5 border border-primary/10 rounded-md p-2">
                <span className="text-[10px] font-semibold text-primary block mb-0.5">
                  {p._rejected ? "❌ Why rejected:" : "✅ Why extracted:"}
                </span>
                <p className="text-[10px] text-muted-foreground">
                  {p._rejected ? (p._rejectReason || "Invalid row data") : (p._extractionReason || "Extracted by AI parser")}
                </p>
              </div>

              {p._parseNotes && (
                <div className="bg-secondary/5 border border-secondary/10 rounded-md p-2">
                  <span className="text-[10px] font-semibold text-secondary block mb-0.5">🤖 AI Parse Note:</span>
                  <p className="text-[10px] text-muted-foreground">{p._parseNotes}</p>
                </div>
              )}

              {/* Why AI did this — per-row debug */}
              <div className="border border-primary/15 rounded-md overflow-hidden">
                <button
                  onClick={() => setShowWhyAI(!showWhyAI)}
                  className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium text-primary bg-primary/5 hover:bg-primary/10 transition-colors"
                >
                  <Bug className="w-3 h-3" />
                  Why AI did this
                  {showWhyAI ? <ChevronDown className="w-3 h-3 ml-auto" /> : <ChevronRight className="w-3 h-3 ml-auto" />}
                </button>
                {showWhyAI && (
                  <WhyAIPanel product={p} parsingPlan={parsingPlan} />
                )}
              </div>

              {/* Full field detail */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <DetailRow label="Raw text" value={p._rawName || "(empty)"} mono />
                <DetailRow label="Title" value={p.name || "—"} highlight />
                <DetailRow label="Vendor" value={p.brand || "—"} />
                <DetailRow label="SKU" value={p.sku || "—"} mono />
                <DetailRow label="Colour" value={p.colour || "—"} />
                <DetailRow label="Size" value={p.size || "—"} />
                <DetailRow label="Unit cost" value={p.cost > 0 ? `$${p.cost.toFixed(2)}` : "—"} />
                <DetailRow label="Quantity" value={String(p.qty || 0)} />
                <DetailRow label="Line total" value={p.cost > 0 && p.qty > 0 ? `$${(p.cost * p.qty).toFixed(2)}` : "—"} />
                {p._sourcePage && <DetailRow label="Source page" value={`Page ${p._sourcePage}`} />}
                <DetailRow label="Classification" value={p._classification} />
              </div>

              {/* Corrections */}
              {p._corrections.length > 0 && (
                <div className="pt-1.5 border-t border-border/50">
                  <span className="text-muted-foreground font-medium">Auto-corrections:</span>
                  {p._corrections.map((c, i) => (
                    <div key={i} className="flex items-center gap-1 mt-0.5">
                      <span className="text-muted-foreground">{c.field}:</span>
                      <span className="text-destructive line-through">{c.from || "(empty)"}</span>
                      <ArrowRight className="w-2.5 h-2.5 text-muted-foreground" />
                      <span className="text-success">{c.to}</span>
                      <span className="text-muted-foreground ml-1 text-[9px]">({c.reason})</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Confidence breakdown */}
              <div className="pt-1.5 border-t border-border/50">
                <DetailRow
                  label="Confidence"
                  value={`${p._confidence}% (${p._confidenceLevel})`}
                  color={p._confidenceLevel === "high" ? "text-success" : p._confidenceLevel === "medium" ? "text-secondary" : "text-destructive"}
                />
                {(p._confidenceReasons || []).length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    <span className="text-muted-foreground text-[9px]">Score factors:</span>
                    {p._confidenceReasons.map((r, ri) => (
                      <div key={ri} className={`flex items-center gap-1 text-[9px] ${r.delta > 0 ? "text-success" : "text-destructive"}`}>
                        <span className="font-mono">{r.delta > 0 ? "+" : ""}{r.delta}</span>
                        <span className="text-muted-foreground">{r.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Mark-as buttons for review/rejected tabs */}
              {(tab === "review" || tab === "rejected") && !p._rejected && (
                <div className="pt-1.5 border-t border-border/50 flex flex-wrap gap-1">
                  <span className="text-[9px] text-muted-foreground mr-1 self-center">Mark as:</span>
                  <Button variant="ghost" size="sm" className="h-6 text-[9px] gap-1 px-2" onClick={() => onMarkAs("freight")}><Truck className="w-2.5 h-2.5" /> Freight</Button>
                  <Button variant="ghost" size="sm" className="h-6 text-[9px] gap-1 px-2" onClick={() => onMarkAs("tax")}><Receipt className="w-2.5 h-2.5" /> Tax/GST</Button>
                  <Button variant="ghost" size="sm" className="h-6 text-[9px] gap-1 px-2" onClick={() => onMarkAs("summary")}><DollarSign className="w-2.5 h-2.5" /> Subtotal</Button>
                  <Button variant="ghost" size="sm" className="h-6 text-[9px] gap-1 px-2" onClick={() => onMarkAs("non-product")}><X className="w-2.5 h-2.5" /> Non-product</Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Why AI Did This Panel ──
function WhyAIPanel({ product, parsingPlan }: { product: ReviewProduct; parsingPlan?: import("@/lib/invoice-validator").ParsingPlan }) {
  // Build intelligent explanations based on product data + parsing plan
  const explanations = useMemo(() => {
    const items: { icon: string; label: string; value: string }[] = [];

    // Document & layout
    if (parsingPlan?.document_type) items.push({ icon: "📄", label: "Document type", value: parsingPlan.document_type });
    if (parsingPlan?.layout_type) items.push({ icon: "📐", label: "Layout type", value: parsingPlan.layout_type });
    if (parsingPlan?.variant_method) items.push({ icon: "🔀", label: "Variant method", value: parsingPlan.variant_method });
    if (parsingPlan?.cost_field) items.push({ icon: "💰", label: "Cost field", value: parsingPlan.cost_field });
    if (parsingPlan?.quantity_field) items.push({ icon: "📦", label: "Quantity field", value: parsingPlan.quantity_field });
    if (parsingPlan?.line_item_zone) items.push({ icon: "🎯", label: "Line-item zone", value: parsingPlan.line_item_zone });

    // Grouping
    if (parsingPlan?.grouping_required) {
      items.push({ icon: "🔗", label: "Grouping", value: parsingPlan.grouping_reason || "Grouped by style code and colour" });
    }

    // Source field mapping
    const fieldMap: string[] = [];
    if (product.name) fieldMap.push(`Title: "${product.name}"`);
    if (product.colour) fieldMap.push(`Colour: "${product.colour}"`);
    if (product.size) fieldMap.push(`Size: "${product.size}"`);
    if (product.sku) fieldMap.push(`SKU: "${product.sku}"`);
    if (fieldMap.length > 0) items.push({ icon: "🗺️", label: "Extracted fields", value: fieldMap.join(" · ") });

    // Cost derivation
    if (product.cost > 0 && product.qty > 0) {
      const lineTotal = product.cost * product.qty;
      items.push({ icon: "🧮", label: "Cost calculation", value: `$${product.cost.toFixed(2)} × ${product.qty} = $${lineTotal.toFixed(2)}` });
    } else if (product.cost > 0) {
      items.push({ icon: "💲", label: "Unit cost", value: `$${product.cost.toFixed(2)} (direct from invoice)` });
    } else {
      items.push({ icon: "⚠️", label: "Cost", value: "No cost detected — may need manual entry" });
    }

    // Why confidence level
    const confReasons: string[] = [];
    if (product._confidenceLevel === "high") {
      confReasons.push("All key fields present (title, cost, quantity)");
      if (product.sku) confReasons.push("SKU detected");
      if (product.colour || product.size) confReasons.push("Variant info found");
    } else if (product._confidenceLevel === "medium") {
      if (!product.cost || product.cost <= 0) confReasons.push("Missing unit cost");
      if (!product.size && !product.colour) confReasons.push("No variant info detected");
      if ((product.name || "").length < 5) confReasons.push("Short or ambiguous title");
      if (!product.sku) confReasons.push("No SKU/style code found");
    } else {
      if (product._rejected) confReasons.push(product._rejectReason || "Row data doesn't match product pattern");
      else confReasons.push("Insufficient product fields");
    }
    items.push({ icon: product._confidenceLevel === "high" ? "🟢" : product._confidenceLevel === "medium" ? "🟡" : "🔴", label: `Why ${product._confidenceLevel} confidence`, value: confReasons.join("; ") });

    // Why accepted/rejected/grouped
    if (product._rejected) {
      items.push({ icon: "❌", label: "Why rejected", value: product._rejectReason || "Matched noise/non-product pattern" });
    } else {
      items.push({ icon: "✅", label: "Why accepted", value: product._extractionReason || "Matched product line pattern with sufficient fields" });
    }

    // Strategy explanation
    if (parsingPlan?.strategy_explanation) {
      items.push({ icon: "💡", label: "AI strategy", value: parsingPlan.strategy_explanation });
    }

    return items;
  }, [product, parsingPlan]);

  return (
    <div className="px-2.5 py-2 bg-card space-y-1">
      {explanations.map((e, i) => (
        <div key={i} className="flex items-start gap-2 text-[10px]">
          <span className="shrink-0 w-4 text-center">{e.icon}</span>
          <span className="text-muted-foreground shrink-0 w-28 font-medium">{e.label}:</span>
          <span className="text-foreground">{e.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Teach AI Panel ──
function TeachAIPanel({ product, supplierName, onClose }: { product: ReviewProduct; supplierName?: string; onClose: () => void }) {
  const [savedRules, setSavedRules] = useState<string[]>([]);

  const teachRules = [
    { label: "This column is unit cost", rule: `column_is_cost: The field containing "${product.cost}" is the unit cost field` },
    { label: "This text pattern means colour", rule: `colour_pattern: "${product.colour}" should be recognized as colour` },
    { label: "This row type is freight", rule: `noise_type: Rows like "${product._rawName}" are freight/shipping` },
    { label: "This size grid maps to variants", rule: `variant_method: Size values like "${product.size}" should create separate variants` },
    { label: "Group rows by style code", rule: `grouping: Group rows by style code prefix, similar to "${product.sku}"` },
    { label: "This supplier uses this format", rule: `layout: This supplier's invoices use the detected layout format` },
  ];

  const saveRule = (rule: string, description: string) => {
    if (!supplierName) return;
    saveCorrection(supplierName, {
      field: "ai_teaching",
      original: product._rawName || "",
      corrected: rule,
      rule: description,
      timestamp: new Date().toISOString(),
    });
    if (rule.startsWith("grouping:")) {
      recordGroupingRule(supplierName, description);
    } else if (rule.startsWith("noise_type:")) {
      recordNoiseRejection(supplierName, product._rawName || "", description);
    } else {
      recordFieldCorrection(supplierName, "ai_teaching", product._rawName || "", rule);
    }
    setSavedRules(prev => [...prev, description]);
  };

  return (
    <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-primary" />
          <span className="text-xs font-semibold text-primary">Teach AI — Save Correction Rule</span>
        </div>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}><X className="w-3 h-3" /></Button>
      </div>
      <p className="text-[10px] text-muted-foreground">Click a rule to save it. The AI will remember this for future invoices from this supplier.</p>
      <div className="space-y-1">
        {teachRules.map((tr, i) => {
          const isSaved = savedRules.includes(tr.label);
          return (
            <button
              key={i}
              onClick={() => !isSaved && saveRule(tr.rule, tr.label)}
              disabled={isSaved || !supplierName}
              className={`w-full text-left px-3 py-2 rounded-md text-[10px] transition-colors border ${
                isSaved
                  ? "bg-success/10 border-success/30 text-success"
                  : "bg-card border-border hover:bg-muted/50 text-foreground"
              }`}
            >
              <span className="font-medium">{isSaved ? "✓ " : ""}{tr.label}</span>
              <p className="text-[9px] text-muted-foreground mt-0.5 truncate">{tr.rule}</p>
            </button>
          );
        })}
      </div>
      {!supplierName && (
        <p className="text-[9px] text-destructive">⚠ No supplier detected — cannot save rules</p>
      )}
    </div>
  );
}

// ── Detail Row ──
function DetailRow({ label, value, mono, highlight, color }: {
  label: string; value: string; mono?: boolean; highlight?: boolean; color?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground shrink-0 w-24">{label}:</span>
      <span className={`${mono ? "font-mono text-[10px]" : ""} ${highlight ? "font-medium text-foreground" : ""} ${color || ""} truncate`}>
        {value}
      </span>
    </div>
  );
}
