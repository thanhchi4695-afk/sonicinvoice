import { useState, useMemo } from "react";
import {
  Check, X, AlertTriangle, ChevronDown, ChevronRight, RotateCcw,
  ShieldCheck, Bug, Search, Filter, CheckCheck, ArrowRight,
  Edit3, Download, Zap, ArrowUpRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ValidatedProduct, ValidationDebugInfo, CorrectionDetail } from "@/lib/invoice-validator";
import { saveCorrection, type CorrectionPattern } from "@/lib/invoice-templates";

interface PostParseReviewScreenProps {
  debug: ValidationDebugInfo;
  products: ValidatedProduct[];
  supplierName?: string;
  onUpdateProducts: (products: ValidatedProduct[]) => void;
  onExportAccepted: () => void;
  onPushToShopify: () => void;
  onBack: () => void;
}

type ReviewTab = "accepted" | "review" | "rejected";
type ConfFilter = "all" | "high" | "medium" | "low";

export default function PostParseReviewScreen({
  debug,
  products,
  supplierName,
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

  // Categorize products
  const accepted = useMemo(() => products.filter(p => !p._rejected && p._confidenceLevel === "high"), [products]);
  const needsReview = useMemo(() => products.filter(p => !p._rejected && p._confidenceLevel !== "high"), [products]);
  const rejected = useMemo(() => products.filter(p => p._rejected), [products]);

  // Unique vendors
  const vendors = useMemo(() => {
    const set = new Set(products.filter(p => p.brand?.trim()).map(p => p.brand.trim()));
    return Array.from(set).sort();
  }, [products]);

  // Average confidence
  const avgConfidence = useMemo(() => {
    const nonRejected = products.filter(p => !p._rejected);
    if (nonRejected.length === 0) return 0;
    return Math.round(nonRejected.reduce((s, p) => s + p._confidence, 0) / nonRejected.length);
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

    if (vendorFilter !== "all") {
      list = list.filter(p => p.brand?.trim() === vendorFilter);
    }

    if (confFilter !== "all") {
      list = list.filter(p => p._confidenceLevel === confFilter);
    }

    if (showEditedOnly) {
      list = list.filter(p => (p as any)._manuallyEdited);
    }

    if (showCorrectedOnly) {
      list = list.filter(p => p._corrections.length > 0);
    }

    // Sort accepted by confidence descending
    if (activeTab === "accepted") {
      list = [...list].sort((a, b) => b._confidence - a._confidence);
    }

    return list;
  }, [activeTab, accepted, needsReview, rejected, searchQuery, vendorFilter, confFilter, showEditedOnly, showCorrectedOnly]);

  // Actions
  const approveRow = (rowIndex: number) => {
    onUpdateProducts(products.map(p =>
      p._rowIndex === rowIndex
        ? { ...p, _rejected: false, _confidenceLevel: "high" as const, _confidence: Math.max(p._confidence, 80) }
        : p
    ));
  };

  const rejectRow = (rowIndex: number) => {
    onUpdateProducts(products.map(p =>
      p._rowIndex === rowIndex
        ? { ...p, _rejected: true, _rejectReason: "Manually rejected", _confidenceLevel: "low" as const, _confidence: 0 }
        : p
    ));
  };

  const moveToReview = (rowIndex: number) => {
    onUpdateProducts(products.map(p =>
      p._rowIndex === rowIndex
        ? { ...p, _rejected: false, _confidenceLevel: "medium" as const, _confidence: Math.min(p._confidence, 70) }
        : p
    ));
  };

  const restoreToReview = (rowIndex: number) => {
    onUpdateProducts(products.map(p =>
      p._rowIndex === rowIndex
        ? { ...p, _rejected: false, _confidenceLevel: "medium" as const, _confidence: 50, _rejectReason: undefined }
        : p
    ));
  };

  const updateField = (rowIndex: number, field: string, value: string | number) => {
    onUpdateProducts(products.map(p => {
      if (p._rowIndex !== rowIndex) return p;
      // Save correction for learning
      const originalValue = String((p as any)[field] || "");
      const newValue = String(value);
      if (supplierName && originalValue !== newValue && originalValue) {
        const fieldLabels: Record<string, string> = { name: "title", colour: "colour", size: "size", cost: "cost", sku: "sku", qty: "quantity" };
        const fieldLabel = fieldLabels[field] || field;
        saveCorrection(supplierName, {
          field: fieldLabel,
          original: originalValue,
          corrected: newValue,
          rule: `When parsing ${supplierName}: "${originalValue}" in ${fieldLabel} should be "${newValue}"`,
          timestamp: new Date().toISOString(),
        });
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

  // Bulk actions
  const acceptAllHighConfidence = () => {
    onUpdateProducts(products.map(p =>
      !p._rejected && p._confidence >= 80 ? { ...p, _confidenceLevel: "high" as const } : p
    ));
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

  const handleExportClick = () => {
    if (needsReview.length > 0) {
      setShowExportWarning(true);
    } else {
      onExportAccepted();
    }
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
        <p className="text-xs text-muted-foreground">Check AI-corrected products before sending to Shopify</p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        <StatCard label="Accepted" value={accepted.length} icon={<Check className="w-3.5 h-3.5" />} colorClass="text-success bg-success/10 border-success/20" />
        <StatCard label="Review" value={needsReview.length} icon={<AlertTriangle className="w-3.5 h-3.5" />} colorClass="text-secondary bg-secondary/10 border-secondary/20" />
        <StatCard label="Rejected" value={rejected.length} icon={<X className="w-3.5 h-3.5" />} colorClass="text-destructive bg-destructive/10 border-destructive/20" />
        <StatCard label="Avg Confidence" value={`${avgConfidence}%`} icon={<Zap className="w-3.5 h-3.5" />} colorClass="text-primary bg-primary/10 border-primary/20" />
      </div>

      {/* Tab bar */}
      <div className="flex bg-muted/30 rounded-lg p-1 mb-3">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === t.key
                ? "bg-card shadow-sm text-foreground"
                : "text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <span className={t.colorClass}>{t.icon}</span>
            {t.label}
            <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
              activeTab === t.key ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
            }`}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search products..."
            className="h-8 pl-8 text-xs"
          />
        </div>
        <select
          value={vendorFilter}
          onChange={e => setVendorFilter(e.target.value)}
          className="h-8 rounded-md bg-input border border-border px-2 text-xs min-w-[120px]"
        >
          <option value="all">All vendors</option>
          {vendors.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select
          value={confFilter}
          onChange={e => setConfFilter(e.target.value as ConfFilter)}
          className="h-8 rounded-md bg-input border border-border px-2 text-xs"
        >
          <option value="all">All confidence</option>
          <option value="high">High (90-100%)</option>
          <option value="medium">Medium (50-89%)</option>
          <option value="low">Low (&lt;50%)</option>
        </select>
        <button
          onClick={() => setShowEditedOnly(!showEditedOnly)}
          className={`px-2.5 py-1.5 rounded-md text-[10px] font-medium border transition-colors ${
            showEditedOnly ? "bg-primary/10 border-primary text-primary" : "bg-muted border-border text-muted-foreground"
          }`}
        >
          <Edit3 className="w-3 h-3 inline mr-1" />Edited
        </button>
        <button
          onClick={() => setShowCorrectedOnly(!showCorrectedOnly)}
          className={`px-2.5 py-1.5 rounded-md text-[10px] font-medium border transition-colors ${
            showCorrectedOnly ? "bg-primary/10 border-primary text-primary" : "bg-muted border-border text-muted-foreground"
          }`}
        >
          <Zap className="w-3 h-3 inline mr-1" />Auto-corrected
        </button>
      </div>

      {/* Bulk actions */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {activeTab === "review" && needsReview.length > 0 && (
          <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={acceptAllHighConfidence}>
            <CheckCheck className="w-3 h-3" /> Accept all high-confidence
          </Button>
        )}
        {activeTab === "review" && (
          <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 text-destructive border-destructive/30" onClick={rejectAllNumericOnly}>
            <X className="w-3 h-3" /> Reject all numeric-only
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto max-h-[500px] border border-border rounded-lg bg-card">
        {currentList.length === 0 ? (
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
                product={p}
                tab={activeTab}
                isEditing={editingRow === p._rowIndex}
                onStartEdit={() => setEditingRow(p._rowIndex)}
                onStopEdit={() => setEditingRow(null)}
                onApprove={() => approveRow(p._rowIndex)}
                onReject={() => rejectRow(p._rowIndex)}
                onMoveToReview={() => moveToReview(p._rowIndex)}
                onRestore={() => restoreToReview(p._rowIndex)}
                onUpdateField={(field, value) => updateField(p._rowIndex, field, value)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Debug panel */}
      <div className="mt-3 border border-border rounded-lg bg-card overflow-hidden">
        <button
          onClick={() => setShowDebug(!showDebug)}
          className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-muted-foreground hover:bg-muted/30 transition-colors"
        >
          <Bug className="w-3.5 h-3.5" />
          <span className="font-medium">AI Parsing Details</span>
          <span className="text-[10px] ml-auto mr-2">
            {debug.corrections.length} corrections · {debug.detectedVendor}
          </span>
          {showDebug ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        {showDebug && (
          <div className="border-t border-border">
            {/* Parsing Plan */}
            {debug.parsingPlan && (
              <div className="px-4 py-3 bg-muted/10 border-b border-border">
                <p className="text-[10px] font-semibold text-foreground mb-2 flex items-center gap-1">
                  <Zap className="w-3 h-3" /> Parsing Strategy Plan
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                  <DetailRow label="Document type" value={debug.parsingPlan.document_type || "—"} />
                  <DetailRow label="Layout type" value={debug.parsingPlan.layout_type || "—"} />
                  <DetailRow label="Variant method" value={debug.parsingPlan.variant_method || "—"} />
                  <DetailRow label="Line-item zone" value={debug.parsingPlan.line_item_zone || "—"} />
                  <DetailRow label="Quantity field" value={debug.parsingPlan.quantity_field || "—"} />
                  <DetailRow label="Cost field" value={debug.parsingPlan.cost_field || "—"} />
                  <DetailRow label="Grouping required" value={debug.parsingPlan.grouping_required ? `Yes — ${debug.parsingPlan.grouping_reason || ""}` : "No"} />
                  <DetailRow label="Expected review" value={debug.parsingPlan.expected_review_level || "—"} highlight />
                </div>
                {debug.parsingPlan.strategy_explanation && (
                  <p className="mt-2 text-[10px] text-muted-foreground italic border-t border-border/30 pt-1.5">
                    💡 {debug.parsingPlan.strategy_explanation}
                  </p>
                )}
                {debug.parsingPlan.review_reason && (
                  <p className="text-[10px] text-muted-foreground">
                    Review reason: {debug.parsingPlan.review_reason}
                  </p>
                )}
              </div>
            )}

            {/* AI Rejected Rows */}
            {debug.rejectedByAI && debug.rejectedByAI.length > 0 && (
              <div className="px-4 py-2 bg-destructive/5 border-b border-border">
                <p className="text-[10px] font-semibold text-destructive mb-1">
                  🚫 Rows Rejected by AI ({debug.rejectedByAI.length})
                </p>
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
            <div className="max-h-60 overflow-y-auto">
              <table className="w-full text-[9px]">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-1.5 px-2">#</th>
                    <th className="py-1.5 px-2">Raw Text</th>
                    <th className="py-1.5 px-2">Classification</th>
                    <th className="py-1.5 px-2">→ Title</th>
                    <th className="py-1.5 px-2">→ Price</th>
                    <th className="py-1.5 px-2">→ Vendor</th>
                    <th className="py-1.5 px-2">Score</th>
                    <th className="py-1.5 px-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map(p => (
                    <tr key={p._rowIndex} className={`border-b border-border/20 ${p._rejected ? "opacity-40" : ""}`}>
                      <td className="py-1 px-2 font-mono">{p._rowIndex + 1}</td>
                      <td className="py-1 px-2 max-w-[120px] truncate">{p._rawName || "—"}</td>
                      <td className="py-1 px-2">
                        <span className={`px-1 py-0.5 rounded text-[8px] ${
                          p._classification === "product_title" ? "bg-success/15 text-success" :
                          p._classification === "vendor" ? "bg-primary/15 text-primary" :
                          p._classification === "unit_price" ? "bg-secondary/15 text-secondary" :
                          "bg-muted text-muted-foreground"
                        }`}>
                          {p._classification}
                        </span>
                      </td>
                      <td className="py-1 px-2 max-w-[120px] truncate">{p._suggestedTitle || "—"}</td>
                      <td className="py-1 px-2 font-mono">{p._suggestedPrice > 0 ? `$${p._suggestedPrice.toFixed(2)}` : "—"}</td>
                      <td className="py-1 px-2 max-w-[80px] truncate">{p._suggestedVendor}</td>
                      <td className="py-1 px-2">
                        <ConfidenceBadgeInline confidence={p._confidence} level={p._confidenceLevel} />
                      </td>
                      <td className="py-1 px-2 max-w-[140px] truncate text-muted-foreground">
                        {p._rejectReason || (p._corrections.length > 0 ? `${p._corrections.length} fix(es)` : "—")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
              {needsReview.length} row{needsReview.length > 1 ? "s" : ""} still need review.
              Export accepted rows only or review them first.
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
    <div className={`rounded-lg border p-3 text-center ${colorClass}`}>
      <div className="flex items-center justify-center gap-1 mb-1">{icon}</div>
      <p className="text-lg font-bold font-display">{value}</p>
      <p className="text-[10px] opacity-80">{label}</p>
    </div>
  );
}

// ── Confidence Badge Inline ──
function ConfidenceBadgeInline({ confidence, level }: { confidence: number; level: string }) {
  const cls = level === "high" ? "text-success" : level === "medium" ? "text-secondary" : "text-destructive";
  return <span className={`font-bold text-[10px] ${cls}`}>{confidence}%</span>;
}

// ── Review Row ──
function ReviewRow({
  product: p,
  tab,
  isEditing,
  onStartEdit,
  onStopEdit,
  onApprove,
  onReject,
  onMoveToReview,
  onRestore,
  onUpdateField,
}: {
  product: ValidatedProduct & { _manuallyEdited?: boolean };
  tab: ReviewTab;
  isEditing: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onApprove: () => void;
  onReject: () => void;
  onMoveToReview: () => void;
  onRestore: () => void;
  onUpdateField: (field: string, value: string | number) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`transition-colors ${tab === "rejected" ? "opacity-60" : ""}`}>
      {/* Main row */}
      <div className="px-4 py-3 flex items-center gap-3">
        <button onClick={() => setExpanded(!expanded)} className="shrink-0 text-muted-foreground">
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>

        {/* Confidence with tooltip */}
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="shrink-0 w-10 text-center cursor-help">
                <span className={`text-sm font-bold font-mono ${
                  p._confidenceLevel === "high" ? "text-success" :
                  p._confidenceLevel === "medium" ? "text-secondary" : "text-destructive"
                }`}>
                  {p._confidence}%
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[220px] p-2">
              <p className="text-[10px] font-semibold mb-1">Score breakdown</p>
              <div className="space-y-0.5">
                {(p._confidenceReasons || []).slice(0, 5).map((r, i) => (
                  <div key={i} className={`text-[9px] flex items-center gap-1 ${r.delta > 0 ? "text-success" : "text-destructive"}`}>
                    <span className="font-mono">{r.delta > 0 ? "+" : ""}{r.delta}</span>
                    <span className="text-muted-foreground">{r.label}</span>
                  </div>
                ))}
              </div>
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
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-primary/30 text-primary shrink-0">
                Auto-corrected
              </Badge>
            )}
            {(p as any)._manuallyEdited && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-secondary/30 text-secondary shrink-0">
                Edited
              </Badge>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground truncate mt-0.5">
            {tab === "rejected" ? (
              <span className="text-destructive">{p._rejectReason}</span>
            ) : (
              <>
                {p.brand && <span>{p.brand}</span>}
                {p.cost > 0 && <span> · ${p.cost.toFixed(2)}</span>}
                {p.qty > 0 && <span> · Qty: {p.qty}</span>}
                {p.sku && <span> · {p.sku}</span>}
                {p.size && <span> · {p.size}</span>}
              </>
            )}
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-1 shrink-0">
          {tab === "accepted" && (
            <>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onStartEdit} title="Edit">
                <Edit3 className="w-3.5 h-3.5 text-muted-foreground" />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onMoveToReview} title="Move to Review">
                <AlertTriangle className="w-3.5 h-3.5 text-secondary" />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onReject} title="Reject">
                <X className="w-3.5 h-3.5 text-destructive" />
              </Button>
            </>
          )}
          {tab === "review" && (
            <>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px] text-success gap-1" onClick={onApprove}>
                <Check className="w-3.5 h-3.5" /> Accept
              </Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onStartEdit} title="Edit">
                <Edit3 className="w-3.5 h-3.5 text-muted-foreground" />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onReject} title="Reject">
                <X className="w-3.5 h-3.5 text-destructive" />
              </Button>
            </>
          )}
          {tab === "rejected" && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px] gap-1" onClick={onRestore}>
              <RotateCcw className="w-3 h-3" /> Restore
            </Button>
          )}
        </div>
      </div>

      {/* Expanded detail / edit area */}
      {(expanded || isEditing) && (
        <div className="px-4 pb-4 ml-[52px]">
          {isEditing ? (
            <div className="bg-muted/30 rounded-lg p-3 space-y-2">
              <div>
                <label className="text-[10px] text-muted-foreground mb-0.5 block">Product Title</label>
                <Input
                  defaultValue={p.name}
                  onBlur={e => onUpdateField("name", e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground mb-0.5 block">Vendor</label>
                  <Input
                    defaultValue={p.brand}
                    onBlur={e => onUpdateField("brand", e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground mb-0.5 block">Price</label>
                  <Input
                    type="number"
                    defaultValue={p.cost}
                    onBlur={e => onUpdateField("cost", parseFloat(e.target.value) || 0)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground mb-0.5 block">Quantity</label>
                  <Input
                    type="number"
                    defaultValue={p.qty}
                    onBlur={e => onUpdateField("qty", parseInt(e.target.value) || 0)}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground mb-0.5 block">Size</label>
                  <Input
                    defaultValue={p.size}
                    onBlur={e => onUpdateField("size", e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground mb-0.5 block">Colour</label>
                  <Input
                    defaultValue={p.colour}
                    onBlur={e => onUpdateField("colour", e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={onStopEdit}>Done editing</Button>
              </div>
            </div>
          ) : (
            <div className="bg-muted/20 rounded-lg p-3 space-y-2 text-[11px]">
              {/* Why this row was extracted / rejected */}
              <div className="bg-primary/5 border border-primary/10 rounded-md p-2">
                <span className="text-[10px] font-semibold text-primary block mb-0.5">
                  {p._rejected ? "❌ Why this row was rejected:" : "✅ Why this row was extracted:"}
                </span>
                <p className="text-[10px] text-muted-foreground">
                  {p._rejected
                    ? (p._rejectReason || "Invalid row data")
                    : ((p as any)._extractionReason || "Extracted by AI parser")}
                </p>
              </div>

              {/* AI parse notes if present */}
              {(p as any)._parseNotes && (
                <div className="bg-secondary/5 border border-secondary/10 rounded-md p-2">
                  <span className="text-[10px] font-semibold text-secondary block mb-0.5">🤖 AI Parse Note:</span>
                  <p className="text-[10px] text-muted-foreground">{(p as any)._parseNotes}</p>
                </div>
              )}

              {/* Raw vs suggested */}
              {tab === "review" && (
                <div className="space-y-1.5">
                  <DetailRow label="Raw extracted text" value={p._rawName || "(empty)"} mono />
                  <DetailRow label="Suggested title" value={p._suggestedTitle || "—"} highlight />
                  <DetailRow label="Suggested vendor" value={p._suggestedVendor} />
                  <DetailRow label="Suggested price" value={p._suggestedPrice > 0 ? `$${p._suggestedPrice.toFixed(2)}` : "—"} />
                  {p._issues.length > 0 && (
                    <div className="pt-1.5 border-t border-border/50">
                      <span className="text-muted-foreground font-medium">Reason for review:</span>
                      {p._issues.map((issue, i) => (
                        <p key={i} className="text-secondary mt-0.5">⚠ {issue}</p>
                      ))}
                    </div>
                  )}
                  {p._rejectReason && !p._rejected && (
                    <p className="text-secondary">⚠ {p._rejectReason}</p>
                  )}
                </div>
              )}

              {/* Corrections */}
              {p._corrections.length > 0 && (
                <div className={tab === "review" ? "pt-1.5 border-t border-border/50" : ""}>
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

              {/* Confidence breakdown with signals */}
              <div className="pt-1.5 border-t border-border/50">
                <DetailRow
                  label="Confidence"
                  value={`${p._confidence}% (${p._confidenceLevel})`}
                  color={p._confidenceLevel === "high" ? "text-success" : p._confidenceLevel === "medium" ? "text-secondary" : "text-destructive"}
                />
                <DetailRow label="Classification" value={p._classification} />
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

              {/* Rejection reason for rejected tab */}
              {tab === "rejected" && p._rejectReason && (
                <div className="pt-1.5 border-t border-border/50">
                  <DetailRow label="Rejection reason" value={p._rejectReason} color="text-destructive" />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, mono, highlight, color }: {
  label: string; value: string; mono?: boolean; highlight?: boolean; color?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground shrink-0 w-28">{label}:</span>
      <span className={`${mono ? "font-mono" : ""} ${highlight ? "font-medium text-foreground" : ""} ${color || ""}`}>
        {value}
      </span>
    </div>
  );
}
