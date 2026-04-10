import { useState, useMemo, useCallback } from "react";
import {
  Check, X, AlertTriangle, ChevronDown, ChevronRight, RotateCcw,
  ShieldCheck, Bug, Search, Filter, CheckCheck, ArrowRight,
  Edit3, Download, Zap, ArrowUpRight, Layers, Merge, Scissors,
  Eye, Brain, Truck, Receipt, Package, FileText, DollarSign, Hash, MapPin, ScanLine
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ValidatedProduct, ValidationDebugInfo, CorrectionDetail } from "@/lib/invoice-validator";
import { saveCorrection, type CorrectionPattern } from "@/lib/invoice-templates";
import { recordFieldCorrection, recordNoiseRejection, recordGroupingRule, recordReclassification } from "@/lib/invoice-learning";
import { toast } from "sonner";
import SourceTraceViewer, { InlineSourcePreview } from "@/components/SourceTraceViewer";
import SizeGridEditor from "@/components/SizeGridEditor";
import InvoiceDebugOverlay from "@/components/InvoiceDebugOverlay";

interface PostParseReviewScreenProps {
  debug: ValidationDebugInfo;
  products: ValidatedProduct[];
  supplierName?: string;
  invoicePages?: string[]; // base64 or URL images per page
  onUpdateProducts: (products: ValidatedProduct[]) => void;
  onExportAccepted: () => void;
  onPushToShopify: () => void;
  onBack: () => void;
}

type ReviewTab = "accepted" | "review" | "rejected";
type ConfFilter = "all" | "high" | "medium" | "low";
type ViewMode = "flat" | "grouped";

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

export default function PostParseReviewScreen({
  debug,
  products,
  supplierName,
  invoicePages = [],
  onUpdateProducts,
  onExportAccepted,
  onPushToShopify,
  onBack,
}: PostParseReviewScreenProps) {
  const [activeTab, setActiveTab] = useState<ReviewTab>("accepted");
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
  const [sourceTraceProduct, setSourceTraceProduct] = useState<ValidatedProduct | null>(null);
  const [showDebugZones, setShowDebugZones] = useState(false);
  const [showDebugOverlay, setShowDebugOverlay] = useState(false);

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

  const updateField = (rowIndex: number, field: string, value: string | number) => {
    onUpdateProducts(products.map(p => {
      if (p._rowIndex !== rowIndex) return p;
      const originalValue = String((p as any)[field] || "");
      const newValue = String(value);
      if (supplierName && originalValue !== newValue && originalValue) {
        const fieldLabels: Record<string, string> = { name: "title", colour: "colour", size: "size", cost: "cost", sku: "sku", qty: "quantity", brand: "vendor" };
        const fieldLabel = fieldLabels[field] || field;
        saveCorrection(supplierName, {
          field: fieldLabel, original: originalValue, corrected: newValue,
          rule: `In ${fieldLabel}: "${originalValue}" → "${newValue}"`,
          timestamp: new Date().toISOString(),
        });
        recordFieldCorrection(supplierName, fieldLabel, originalValue, newValue);
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

  const handleExportClick = () => {
    if (needsReview.length > 0) setShowExportWarning(true);
    else onExportAccepted();
  };

  const tabs: { key: ReviewTab; label: string; count: number; icon: React.ReactNode; colorClass: string }[] = [
    { key: "accepted", label: "Accepted", count: accepted.length, icon: <Check className="w-3.5 h-3.5" />, colorClass: "text-success" },
    { key: "review", label: "Needs Review", count: needsReview.length, icon: <AlertTriangle className="w-3.5 h-3.5" />, colorClass: "text-secondary" },
    { key: "rejected", label: "Rejected", count: rejected.length, icon: <X className="w-3.5 h-3.5" />, colorClass: "text-destructive" },
  ];

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

      {/* Groups count + avg confidence */}
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
          <div className="flex bg-muted/30 rounded-lg p-1">
            <button
              onClick={() => setViewMode("flat")}
              className={`px-2.5 py-2 rounded-md text-[10px] font-medium transition-colors ${viewMode === "flat" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"}`}
            >
              <FileText className="w-3 h-3" />
            </button>
            <button
              onClick={() => setViewMode("grouped")}
              className={`px-2.5 py-2 rounded-md text-[10px] font-medium transition-colors ${viewMode === "grouped" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"}`}
            >
              <Layers className="w-3 h-3" />
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
              {currentList.map(p => (
                <ReviewRow
                  key={p._rowIndex}
                  product={p as ReviewProduct}
                  tab={activeTab}
                  isEditing={editingRow === p._rowIndex}
                  isSelected={selectedRows.has(p._rowIndex)}
                  onToggleSelect={() => toggleSelectRow(p._rowIndex)}
                  onStartEdit={() => setEditingRow(p._rowIndex)}
                  onStopEdit={() => setEditingRow(null)}
                  onApprove={() => approveRow(p._rowIndex)}
                  onReject={() => rejectRow(p._rowIndex)}
                  onMoveToReview={() => moveToReview(p._rowIndex)}
                  onRestore={() => restoreToReview(p._rowIndex)}
                  onUpdateField={(field, value) => updateField(p._rowIndex, field, value)}
                  onMarkAs={(markAs) => markRowAs(p._rowIndex, markAs)}
                  onSplit={() => splitRow(p._rowIndex)}
                  showTeachAI={showTeachAI === p._rowIndex}
                  onToggleTeachAI={() => setShowTeachAI(showTeachAI === p._rowIndex ? null : p._rowIndex)}
                  supplierName={supplierName}
                  parsingPlan={debug.parsingPlan}
                  invoicePages={invoicePages}
                  onShowSourceTrace={(prod) => setSourceTraceProduct(prod)}
                />
              ))}
            </div>
          )
        )}
      </div>

      {/* Debug panel */}
      <div className="mt-3 border border-border rounded-lg bg-card overflow-hidden">
        <button onClick={() => setShowDebug(!showDebug)} className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-muted-foreground hover:bg-muted/30 transition-colors">
          <Bug className="w-3.5 h-3.5" />
          <span className="font-medium">AI Parsing Details</span>
          <span className="text-[10px] ml-auto mr-2">{debug.corrections.length} corrections · {debug.detectedVendor}</span>
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
              <Button variant="teal" size="sm" className="flex-1 h-9 text-xs" onClick={() => { setShowExportWarning(false); onExportAccepted(); }}>
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

      {/* Sticky bottom action bar */}
      <div className="sticky bottom-0 mt-4 -mx-4 px-4 py-3 bg-background border-t border-border flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onBack} className="gap-1">
          <ChevronDown className="w-3.5 h-3.5 rotate-90" /> Back
        </Button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={handleExportClick} className="gap-1">
          <Download className="w-3.5 h-3.5" /> Export Accepted ({accepted.length})
        </Button>
        <Button variant="teal" size="sm" onClick={() => { if (needsReview.length > 0) setShowExportWarning(true); else onPushToShopify(); }} className="gap-1">
          <ArrowUpRight className="w-3.5 h-3.5" /> Push to Shopify ({accepted.length})
        </Button>
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
}) {
  const [expanded, setExpanded] = useState(false);
  const [showWhyAI, setShowWhyAI] = useState(false);

  return (
    <div className={`transition-colors ${tab === "rejected" ? "opacity-60" : ""} ${isSelected ? "bg-primary/5" : ""}`}>
      {/* Main row */}
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
              <div>
                <label className="text-[10px] text-muted-foreground mb-0.5 block">Product Title</label>
                <Input defaultValue={p.name} onBlur={e => onUpdateField("name", e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground mb-0.5 block">Vendor</label>
                  <Input defaultValue={p.brand} onBlur={e => onUpdateField("brand", e.target.value)} className="h-8 text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground mb-0.5 block">Style Code / SKU</label>
                  <Input defaultValue={p.sku} onBlur={e => onUpdateField("sku", e.target.value)} className="h-8 text-xs" />
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground mb-0.5 block">Unit Cost</label>
                  <Input type="number" defaultValue={p.cost} onBlur={e => onUpdateField("cost", parseFloat(e.target.value) || 0)} className="h-8 text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground mb-0.5 block">Qty</label>
                  <Input type="number" defaultValue={p.qty} onBlur={e => onUpdateField("qty", parseInt(e.target.value) || 0)} className="h-8 text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground mb-0.5 block">Size</label>
                  <Input defaultValue={p.size} onBlur={e => onUpdateField("size", e.target.value)} className="h-8 text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground mb-0.5 block">Colour</label>
                  <Input defaultValue={p.colour} onBlur={e => onUpdateField("colour", e.target.value)} className="h-8 text-xs" />
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
              <div className="flex justify-between items-center">
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-7 text-[10px] gap-1 text-muted-foreground" onClick={onSplit}>
                    <Scissors className="w-3 h-3" /> Split
                  </Button>
                </div>
                <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={onStopEdit}>Done editing</Button>
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
