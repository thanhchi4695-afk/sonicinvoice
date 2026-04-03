import { useState } from "react";
import { Check, X, AlertTriangle, ArrowRight, Bug, ChevronDown, ChevronRight, Eye, RotateCcw, ShieldCheck, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ValidationDebugInfo, ValidatedProduct, ConfidenceSignal } from "@/lib/invoice-validator";

interface InvoiceAutoCorrectPanelProps {
  debug: ValidationDebugInfo;
  products: ValidatedProduct[];
  onApproveRow: (rowIndex: number) => void;
  onRejectRow: (rowIndex: number) => void;
}

type ReviewTab = "accepted" | "review" | "rejected";

export default function InvoiceAutoCorrectPanel({
  debug,
  products,
  onApproveRow,
  onRejectRow,
}: InvoiceAutoCorrectPanelProps) {
  const [activeTab, setActiveTab] = useState<ReviewTab>("accepted");
  const [showDebug, setShowDebug] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const accepted = products.filter(p => !p._rejected && p._confidenceLevel === "high");
  const needsReview = products.filter(p => !p._rejected && p._confidenceLevel !== "high");
  const rejected = products.filter(p => p._rejected);

  const tabs: { key: ReviewTab; label: string; count: number; icon: React.ReactNode; color: string }[] = [
    { key: "accepted", label: "Accepted", count: accepted.length, icon: <Check className="w-3.5 h-3.5" />, color: "text-success" },
    { key: "review", label: "Needs Review", count: needsReview.length, icon: <AlertTriangle className="w-3.5 h-3.5" />, color: "text-warning" },
    { key: "rejected", label: "Rejected", count: rejected.length, icon: <X className="w-3.5 h-3.5" />, color: "text-destructive" },
  ];

  const currentList = activeTab === "accepted" ? accepted : activeTab === "review" ? needsReview : rejected;

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">AI Auto-Correct</h3>
          <span className="text-[10px] text-muted-foreground ml-auto">
            {debug.corrections.length} corrections · {debug.detectedVendor}
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground">
          {debug.totalRaw} rows analysed → {debug.accepted} clean, {debug.needsReview} flagged, {debug.rejected} removed
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex bg-muted/20 border-b border-border">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors border-b-2 ${
              activeTab === t.key
                ? "border-primary bg-card text-foreground"
                : "border-transparent text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <span className={t.color}>{t.icon}</span>
            {t.label}
            <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
              activeTab === t.key ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
            }`}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="max-h-[400px] overflow-y-auto">
        {currentList.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            {activeTab === "accepted" && "No auto-accepted rows yet"}
            {activeTab === "review" && "✓ No rows need review — all clean!"}
            {activeTab === "rejected" && "No rows were rejected"}
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {currentList.map((p) => (
              <ProductRow
                key={p._rowIndex}
                product={p}
                tab={activeTab}
                expanded={expandedRow === p._rowIndex}
                onToggle={() => setExpandedRow(expandedRow === p._rowIndex ? null : p._rowIndex)}
                onApprove={() => onApproveRow(p._rowIndex)}
                onReject={() => onRejectRow(p._rowIndex)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Debug toggle */}
      <div className="border-t border-border">
        <button
          onClick={() => setShowDebug(!showDebug)}
          className="w-full flex items-center gap-2 px-4 py-2 text-[10px] text-muted-foreground hover:bg-muted/30 transition-colors"
        >
          <Bug className="w-3 h-3" />
          Raw Debug Data
          {showDebug ? <ChevronDown className="w-3 h-3 ml-auto" /> : <ChevronRight className="w-3 h-3 ml-auto" />}
        </button>
        {showDebug && (
          <div className="px-4 pb-3 max-h-48 overflow-y-auto">
            <table className="w-full text-[9px]">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-1 pr-1">#</th>
                  <th className="py-1 pr-1">Raw Text</th>
                  <th className="py-1 pr-1">Class</th>
                  <th className="py-1 pr-1">→ Title</th>
                  <th className="py-1 pr-1">→ Price</th>
                  <th className="py-1 pr-1">→ Vendor</th>
                  <th className="py-1">Score</th>
                </tr>
              </thead>
              <tbody>
                {products.map(p => (
                  <tr key={p._rowIndex} className={`border-b border-border/20 ${p._rejected ? "opacity-30" : ""}`}>
                    <td className="py-0.5 pr-1 font-mono">{p._rowIndex + 1}</td>
                    <td className="py-0.5 pr-1 max-w-[100px] truncate">{p._rawName || "—"}</td>
                    <td className="py-0.5 pr-1">
                      <span className={`px-1 py-0.5 rounded text-[8px] ${
                        p._classification === "product_title" ? "bg-success/15 text-success" :
                        p._classification === "vendor" ? "bg-primary/15 text-primary" :
                        p._classification === "unit_price" ? "bg-warning/15 text-warning" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {p._classification}
                      </span>
                    </td>
                    <td className="py-0.5 pr-1 max-w-[100px] truncate">{p._suggestedTitle || "—"}</td>
                    <td className="py-0.5 pr-1 font-mono">{p._suggestedPrice > 0 ? `$${p._suggestedPrice.toFixed(2)}` : "—"}</td>
                    <td className="py-0.5 pr-1 max-w-[60px] truncate">{p._suggestedVendor}</td>
                    <td className="py-0.5">
                      <span className={`font-bold ${
                        p._confidenceLevel === "high" ? "text-success" :
                        p._confidenceLevel === "medium" ? "text-warning" : "text-destructive"
                      }`}>
                        {p._confidence}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Individual row component ──

function ProductRow({
  product: p,
  tab,
  expanded,
  onToggle,
  onApprove,
  onReject,
}: {
  product: ValidatedProduct;
  tab: ReviewTab;
  expanded: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="px-4 py-2.5">
      {/* Main row */}
      <div className="flex items-center gap-2">
        <button onClick={onToggle} className="shrink-0">
          {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
        </button>

        {/* Confidence badge with tooltip */}
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={`shrink-0 text-[10px] font-bold min-w-[32px] text-center cursor-help ${
                p._confidenceLevel === "high" ? "text-success" :
                p._confidenceLevel === "medium" ? "text-warning" : "text-destructive"
              }`}>
                {p._confidence}%
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[220px] p-2">
              <p className="text-[10px] font-semibold mb-1">Confidence breakdown</p>
              <div className="space-y-0.5">
                {(p._confidenceReasons || []).slice(0, 5).map((r, i) => (
                  <div key={i} className={`text-[9px] flex items-center gap-1 ${r.delta > 0 ? "text-success" : "text-destructive"}`}>
                    <span>{r.delta > 0 ? "+" : ""}{r.delta}</span>
                    <span className="text-muted-foreground">{r.label}</span>
                  </div>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Product info */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate">
            {p._rejected ? (
              <span className="line-through text-muted-foreground">{p._rawName || "(empty)"}</span>
            ) : (
              p.name || p._rawName
            )}
          </p>
          <p className="text-[10px] text-muted-foreground truncate">
            {p._rejected ? p._rejectReason : (
              <>
                {p.brand && <span>{p.brand}</span>}
                {p.cost > 0 && <span> · ${p.cost.toFixed(2)}</span>}
                {p.sku && <span> · SKU: {p.sku}</span>}
                {p._corrections.length > 0 && (
                  <span className="text-primary"> · {p._corrections.length} fix{p._corrections.length > 1 ? "es" : ""}</span>
                )}
              </>
            )}
          </p>
        </div>

        {/* Actions */}
        {tab === "review" && (
          <div className="flex gap-1 shrink-0">
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onApprove} title="Accept">
              <Check className="w-3.5 h-3.5 text-success" />
            </Button>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onReject} title="Reject">
              <X className="w-3.5 h-3.5 text-destructive" />
            </Button>
          </div>
        )}
        {tab === "rejected" && (
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={onApprove}>
            <RotateCcw className="w-3 h-3 mr-1" /> Restore
          </Button>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="ml-8 mt-2 bg-muted/30 rounded-md p-2.5 space-y-1.5 text-[10px]">
          <DetailRow label="Raw extracted text" value={p._rawName || "(empty)"} mono />
          {!p._rejected && (
            <>
              <DetailRow label="Suggested title" value={p._suggestedTitle || "—"} highlight />
              <DetailRow label="Suggested price" value={p._suggestedPrice > 0 ? `$${p._suggestedPrice.toFixed(2)}` : "—"} />
              <DetailRow label="Suggested vendor" value={p._suggestedVendor} />
            </>
          )}
          <DetailRow
            label="Confidence"
            value={`${p._confidence}% (${p._confidenceLevel})`}
            color={p._confidenceLevel === "high" ? "text-success" : p._confidenceLevel === "medium" ? "text-warning" : "text-destructive"}
          />
          <DetailRow label="Classification" value={p._classification} />
          {p._rejectReason && <DetailRow label="Reason" value={p._rejectReason} color="text-destructive" />}
          {p._corrections.length > 0 && (
            <div className="pt-1 border-t border-border/50">
              <span className="text-muted-foreground">Corrections:</span>
              {p._corrections.map((c, ci) => (
                <div key={ci} className="flex items-center gap-1 mt-0.5">
                  <span className="text-muted-foreground">{c.field}:</span>
                  <span className="text-destructive line-through">{c.from || "(empty)"}</span>
                  <ArrowRight className="w-2.5 h-2.5 text-muted-foreground" />
                  <span className="text-success">{c.to}</span>
                  <span className="text-muted-foreground ml-1">({c.reason})</span>
                </div>
              ))}
            </div>
          )}
          {p._issues.length > 0 && (
            <div className="pt-1 border-t border-border/50">
              <span className="text-muted-foreground">Notes:</span>
              {p._issues.map((issue, ii) => (
                <p key={ii} className="text-warning">⚠ {issue}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, mono, highlight, color }: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
  color?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground shrink-0 w-24">{label}:</span>
      <span className={`${mono ? "font-mono" : ""} ${highlight ? "font-medium text-foreground" : ""} ${color || ""}`}>
        {value}
      </span>
    </div>
  );
}
