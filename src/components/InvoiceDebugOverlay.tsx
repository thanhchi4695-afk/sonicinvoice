import { useState, useMemo } from "react";
import {
  Eye, EyeOff, Layers, X, AlertTriangle, ChevronDown, ChevronRight,
  ZoomIn, ZoomOut, Maximize2, Minimize2, Grid3X3, Ban, ScanLine
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ValidatedProduct, ParsingPlan, PageZones } from "@/lib/invoice-validator";

// ── Zone colors ──
const ZONE_COLORS: Record<string, { bg: string; border: string; label: string }> = {
  header:       { bg: "rgba(156,163,175,0.12)", border: "rgba(156,163,175,0.6)", label: "Header" },
  invoice_info: { bg: "rgba(59,130,246,0.10)",  border: "rgba(59,130,246,0.5)",  label: "Invoice Info" },
  line_items:   { bg: "rgba(34,197,94,0.08)",   border: "rgba(34,197,94,0.5)",   label: "Line Items" },
  totals:       { bg: "rgba(249,115,22,0.10)",  border: "rgba(249,115,22,0.5)",  label: "Totals" },
  footer:       { bg: "rgba(156,163,175,0.10)", border: "rgba(156,163,175,0.5)", label: "Footer" },
};

// ── Row field region colors ──
const ROW_FIELD_COLORS: Record<string, string> = {
  sku:         "rgba(168,85,247,0.25)",
  description: "rgba(59,130,246,0.20)",
  size:        "rgba(234,179,8,0.20)",
  cost:        "rgba(249,115,22,0.20)",
  line_total:  "rgba(236,72,153,0.20)",
};

type DebugMode = "rows" | "rejected" | "zones";

interface InvoiceDebugOverlayProps {
  invoicePages: string[];
  products: ValidatedProduct[];
  rejectedRows?: { raw_text: string; rejection_reason: string }[];
  parsingPlan?: ParsingPlan;
  onClose: () => void;
}

export default function InvoiceDebugOverlay({
  invoicePages,
  products,
  rejectedRows = [],
  parsingPlan,
  onClose,
}: InvoiceDebugOverlayProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [activeMode, setActiveMode] = useState<Set<DebugMode>>(new Set(["rows"]));
  const [hoveredRowIdx, setHoveredRowIdx] = useState<number | null>(null);
  const [detailPanel, setDetailPanel] = useState(true);

  const totalPages = invoicePages.length;
  const pageImage = invoicePages[currentPage] || "";
  const pageZones = parsingPlan?.page_zones;

  const toggleMode = (mode: DebugMode) => {
    setActiveMode(prev => {
      const next = new Set(prev);
      if (next.has(mode)) next.delete(mode); else next.add(mode);
      return next;
    });
  };

  // Products with row position data for this page
  const pageProducts = useMemo(() => {
    return products.filter(p => {
      const page = (p as any)._sourcePage || 1;
      return page === currentPage + 1;
    });
  }, [products, currentPage]);

  // Detected product rows with y positions
  const detectedRows = useMemo(() => {
    return pageProducts
      .filter(p => !p._rejected)
      .map(p => ({
        product: p,
        yStart: (p as any)._rowYStart || (p._sourceTrace?.allBoxes?.[0]?.y) || 0,
        yEnd: (p as any)._rowYEnd || ((p._sourceTrace?.allBoxes?.[0]?.y || 0) + (p._sourceTrace?.allBoxes?.[0]?.height || 0.04)),
        anchorCode: (p as any)._anchorCode || p.sku || "",
        confidence: p._confidence,
        sourceTrace: p._sourceTrace,
      }))
      .filter(r => r.yStart > 0 || r.yEnd > 0)
      .sort((a, b) => a.yStart - b.yStart);
  }, [pageProducts]);

  // Rejected products with approximate positions
  const rejectedProducts = useMemo(() => {
    return pageProducts
      .filter(p => p._rejected)
      .map(p => ({
        product: p,
        yStart: (p as any)._rowYStart || 0,
        yEnd: (p as any)._rowYEnd || 0,
        reason: p._rejectReason || "Rejected",
        name: p._rawName || p.name || "(unknown)",
      }))
      .filter(r => r.yStart > 0 || r.yEnd > 0);
  }, [pageProducts]);

  // Also include AI-rejected rows that were never products
  const aiRejectedItems = useMemo(() => {
    return rejectedRows.map((r, i) => ({
      index: i,
      text: r.raw_text,
      reason: r.rejection_reason,
    }));
  }, [rejectedRows]);

  const confColor = (conf: number) =>
    conf >= 80 ? "text-success" : conf >= 50 ? "text-secondary" : "text-destructive";

  const confBorderColor = (conf: number) =>
    conf >= 80 ? "rgba(34,197,94,0.6)" : conf >= 50 ? "rgba(234,179,8,0.6)" : "rgba(239,68,68,0.6)";

  return (
    <div className={`flex flex-col bg-card border border-border rounded-xl shadow-lg overflow-hidden ${expanded ? "fixed inset-4 z-50" : "h-full"}`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/20">
        <ScanLine className="w-4 h-4 text-primary shrink-0" />
        <span className="text-xs font-semibold flex-1">Extraction Debug View</span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setExpanded(!expanded)}>
            {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </Button>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Debug mode toggles */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/50 bg-muted/10 flex-wrap">
        <span className="text-[10px] text-muted-foreground font-medium mr-1">Show:</span>
        {([
          { key: "rows" as DebugMode, label: "Detected Rows", icon: <Layers className="w-3 h-3" />, count: detectedRows.length },
          { key: "rejected" as DebugMode, label: "Rejected Rows", icon: <Ban className="w-3 h-3" />, count: rejectedProducts.length + aiRejectedItems.length },
          { key: "zones" as DebugMode, label: "Page Zones", icon: <Grid3X3 className="w-3 h-3" />, count: pageZones ? Object.keys(pageZones).length : 0 },
        ]).map(m => (
          <button
            key={m.key}
            onClick={() => toggleMode(m.key)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border transition-colors ${
              activeMode.has(m.key)
                ? "bg-primary/10 border-primary/30 text-primary"
                : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/50"
            }`}
          >
            {m.icon}
            {m.label}
            <span className={`px-1 py-0 rounded-full text-[8px] font-bold ${activeMode.has(m.key) ? "bg-primary/20" : "bg-muted"}`}>
              {m.count}
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left: Invoice image with overlays */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Page nav + zoom */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-muted/5">
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setCurrentPage(p => Math.max(0, p - 1))} disabled={currentPage === 0}>
              <ChevronDown className="w-3.5 h-3.5 rotate-90" />
            </Button>
            <span className="text-[10px] text-muted-foreground font-mono">
              Page {currentPage + 1} / {totalPages || 1}
            </span>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))} disabled={currentPage >= totalPages - 1}>
              <ChevronDown className="w-3.5 h-3.5 -rotate-90" />
            </Button>
            <div className="flex-1" />
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}>
              <ZoomOut className="w-3.5 h-3.5" />
            </Button>
            <span className="text-[10px] font-mono text-muted-foreground w-10 text-center">{Math.round(zoom * 100)}%</span>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setZoom(z => Math.min(3, z + 0.25))}>
              <ZoomIn className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Image canvas */}
          <div className="flex-1 overflow-auto bg-muted/5 p-2">
            {pageImage ? (
              <div className="relative inline-block" style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}>
                <img src={pageImage} alt={`Invoice page ${currentPage + 1}`} className="max-w-full block" draggable={false} />

                {/* Page zone overlays */}
                {activeMode.has("zones") && pageZones && Object.entries(pageZones).map(([zoneKey, zone]) => {
                  if (!zone) return null;
                  const color = ZONE_COLORS[zoneKey] || ZONE_COLORS.header;
                  return (
                    <div
                      key={`zone-${zoneKey}`}
                      className="absolute left-0 w-full pointer-events-none"
                      style={{
                        top: `${zone.y_start * 100}%`,
                        height: `${(zone.y_end - zone.y_start) * 100}%`,
                        backgroundColor: color.bg,
                        borderTop: `2px dashed ${color.border}`,
                        borderBottom: `2px dashed ${color.border}`,
                      }}
                    >
                      <span
                        className="absolute top-0 left-1 text-[8px] font-bold px-1 py-0.5 rounded-b"
                        style={{ backgroundColor: color.border, color: "#fff" }}
                      >
                        {color.label}
                      </span>
                    </div>
                  );
                })}

                {/* Detected product row overlays */}
                {activeMode.has("rows") && detectedRows.map((row, i) => {
                  const isHovered = hoveredRowIdx === i;
                  const borderColor = confBorderColor(row.confidence);
                  return (
                    <div
                      key={`row-${i}`}
                      className="absolute left-[2%] w-[96%] cursor-pointer transition-all duration-150"
                      style={{
                        top: `${row.yStart * 100}%`,
                        height: `${Math.max((row.yEnd - row.yStart) * 100, 2)}%`,
                        border: `2px solid ${borderColor}`,
                        backgroundColor: isHovered ? `${borderColor.replace("0.6", "0.15")}` : "transparent",
                        borderRadius: "3px",
                        zIndex: isHovered ? 10 : 1,
                      }}
                      onMouseEnter={() => setHoveredRowIdx(i)}
                      onMouseLeave={() => setHoveredRowIdx(null)}
                    >
                      {/* Anchor code label */}
                      <span
                        className="absolute -top-3.5 left-1 text-[8px] font-bold px-1 py-0.5 rounded"
                        style={{ backgroundColor: borderColor, color: "#fff" }}
                      >
                        {row.anchorCode || `Row ${i + 1}`}
                      </span>
                      {/* Confidence badge */}
                      <span
                        className="absolute -top-3.5 right-1 text-[8px] font-bold px-1 py-0.5 rounded bg-background/90 border"
                        style={{ borderColor }}
                      >
                        {row.confidence}%
                      </span>

                      {/* Field region highlights within row */}
                      {isHovered && row.sourceTrace?.allBoxes?.filter(b => b.page === currentPage + 1).map((box, bi) => {
                        const fieldColor = ROW_FIELD_COLORS[box.fieldType || ""] || "rgba(156,163,175,0.15)";
                        return (
                          <div
                            key={`field-${bi}`}
                            className="absolute pointer-events-none"
                            style={{
                              left: `${((box.x - 0.02) / 0.96) * 100}%`,
                              top: `${((box.y - row.yStart) / (row.yEnd - row.yStart)) * 100}%`,
                              width: `${(box.width / 0.96) * 100}%`,
                              height: `${(box.height / (row.yEnd - row.yStart)) * 100}%`,
                              backgroundColor: fieldColor,
                              border: `1px solid ${fieldColor.replace("0.2", "0.6")}`,
                              borderRadius: "1px",
                            }}
                          >
                            <span className="absolute -bottom-3 left-0 text-[7px] font-bold text-foreground/70 whitespace-nowrap">
                              {box.fieldType}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                {/* Rejected row overlays */}
                {activeMode.has("rejected") && rejectedProducts.map((row, i) => (
                  <div
                    key={`rej-${i}`}
                    className="absolute left-[2%] w-[96%] pointer-events-none"
                    style={{
                      top: `${row.yStart * 100}%`,
                      height: `${Math.max((row.yEnd - row.yStart) * 100, 2)}%`,
                      border: "2px dashed rgba(239,68,68,0.5)",
                      backgroundColor: "rgba(239,68,68,0.06)",
                      borderRadius: "3px",
                    }}
                  >
                    <span className="absolute -top-3.5 left-1 text-[7px] font-bold px-1 py-0.5 rounded bg-destructive text-white">
                      ✕ {row.name.slice(0, 20)}
                    </span>
                    <span className="absolute -bottom-3 left-1 text-[7px] text-destructive/80 italic">
                      {row.reason.slice(0, 40)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
                No invoice page image available
              </div>
            )}
          </div>
        </div>

        {/* Right: Detail panel */}
        {detailPanel && (
          <div className="w-72 border-l border-border flex flex-col bg-muted/10 shrink-0">
            <div className="px-3 py-2 border-b border-border/50 flex items-center gap-2">
              <p className="text-[10px] font-semibold text-foreground flex-1">Row Details</p>
              <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => setDetailPanel(false)}>
                <EyeOff className="w-3 h-3" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Hovered row detail */}
              {hoveredRowIdx !== null && detectedRows[hoveredRowIdx] ? (
                <HoveredRowDetail row={detectedRows[hoveredRowIdx]} />
              ) : (
                <div className="px-3 py-4 text-center text-[10px] text-muted-foreground">
                  Hover a row on the image to see details
                </div>
              )}

              {/* Detected rows list */}
              <div className="border-t border-border/30">
                <div className="px-3 py-2">
                  <p className="text-[10px] font-semibold text-foreground flex items-center gap-1">
                    <Layers className="w-3 h-3" /> Detected Rows ({detectedRows.length})
                  </p>
                </div>
                <div className="divide-y divide-border/20 max-h-48 overflow-y-auto">
                  {detectedRows.map((row, i) => (
                    <button
                      key={i}
                      className={`w-full text-left px-3 py-1.5 hover:bg-muted/30 transition-colors ${hoveredRowIdx === i ? "bg-primary/5" : ""}`}
                      onMouseEnter={() => setHoveredRowIdx(i)}
                      onMouseLeave={() => setHoveredRowIdx(null)}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-mono font-bold text-primary">{row.anchorCode || `#${i + 1}`}</span>
                        <span className="text-[9px] text-muted-foreground truncate flex-1">{row.product.name || row.product._rawName || "—"}</span>
                        <span className={`text-[9px] font-bold ${confColor(row.confidence)}`}>{row.confidence}%</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Rejected rows list */}
              {(rejectedProducts.length > 0 || aiRejectedItems.length > 0) && (
                <div className="border-t border-border/30">
                  <div className="px-3 py-2">
                    <p className="text-[10px] font-semibold text-destructive flex items-center gap-1">
                      <Ban className="w-3 h-3" /> Rejected ({rejectedProducts.length + aiRejectedItems.length})
                    </p>
                  </div>
                  <div className="divide-y divide-border/20 max-h-48 overflow-y-auto">
                    {rejectedProducts.map((row, i) => (
                      <div key={`rp-${i}`} className="px-3 py-1.5">
                        <p className="text-[9px] text-foreground truncate">{row.name}</p>
                        <p className="text-[8px] text-destructive">{row.reason}</p>
                      </div>
                    ))}
                    {aiRejectedItems.map((r, i) => (
                      <div key={`ai-${i}`} className="px-3 py-1.5">
                        <p className="text-[9px] text-muted-foreground truncate">{r.text}</p>
                        <p className="text-[8px] text-destructive">{r.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Page zones summary */}
              {pageZones && (
                <div className="border-t border-border/30">
                  <div className="px-3 py-2">
                    <p className="text-[10px] font-semibold text-foreground flex items-center gap-1">
                      <Grid3X3 className="w-3 h-3" /> Page Zones
                    </p>
                  </div>
                  <div className="px-3 pb-2 space-y-1">
                    {Object.entries(pageZones).map(([key, zone]) => {
                      if (!zone) return null;
                      const color = ZONE_COLORS[key];
                      return (
                        <div key={key} className="flex items-center gap-2 text-[9px]">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color?.border || "#999" }} />
                          <span className="text-muted-foreground flex-1">{color?.label || key}</span>
                          <span className="font-mono text-muted-foreground">
                            {(zone.y_start * 100).toFixed(0)}–{(zone.y_end * 100).toFixed(0)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        {!detailPanel && (
          <Button variant="ghost" size="sm" className="absolute right-2 top-16 h-6 w-6 p-0 z-10" onClick={() => setDetailPanel(true)}>
            <Eye className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Hovered row detail card ──
function HoveredRowDetail({ row }: {
  row: {
    product: ValidatedProduct;
    yStart: number;
    yEnd: number;
    anchorCode: string;
    confidence: number;
    sourceTrace?: ValidatedProduct["_sourceTrace"];
  };
}) {
  const p = row.product;
  const confColor = row.confidence >= 80 ? "text-success" : row.confidence >= 50 ? "text-secondary" : "text-destructive";

  return (
    <div className="px-3 py-3 border-b border-border/30 bg-primary/5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-bold font-mono text-primary">{row.anchorCode || "—"}</span>
        <span className={`text-[10px] font-bold ${confColor}`}>{row.confidence}%</span>
      </div>

      <p className="text-[11px] font-semibold text-foreground truncate mb-1">{p.name || p._rawName || "(untitled)"}</p>

      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[9px]">
        <DetailItem label="Style Code" value={p.sku} />
        <DetailItem label="Colour" value={p.colour} />
        <DetailItem label="Size" value={p.size} />
        <DetailItem label="Qty" value={p.qty > 0 ? String(p.qty) : "—"} />
        <DetailItem label="Unit Cost" value={p.cost > 0 ? `$${p.cost.toFixed(2)}` : "—"} />
        <DetailItem label="Line Total" value={p._lineTotal ? `$${p._lineTotal.toFixed(2)}` : "—"} />
        <DetailItem label="Page" value={`p.${((p as any)._sourcePage || 1)}`} />
        <DetailItem label="Y Position" value={`${(row.yStart * 100).toFixed(1)}–${(row.yEnd * 100).toFixed(1)}%`} />
      </div>

      {p._extractionReason && (
        <div className="mt-2 p-1.5 bg-primary/5 rounded text-[9px] text-muted-foreground">
          <span className="font-semibold text-primary">Why: </span>{p._extractionReason}
        </div>
      )}

      {p._parseNotes && (
        <div className="mt-1 p-1.5 bg-secondary/5 rounded text-[9px] text-muted-foreground">
          <span className="font-semibold text-secondary">Note: </span>{p._parseNotes}
        </div>
      )}

      {/* Confidence breakdown */}
      {p._confidenceReasons?.length > 0 && (
        <div className="mt-2 border-t border-border/30 pt-1.5">
          <p className="text-[8px] font-semibold text-muted-foreground mb-0.5">Score Breakdown</p>
          <div className="space-y-0.5">
            {p._confidenceReasons.slice(0, 6).map((r, i) => (
              <div key={i} className={`text-[8px] flex items-center gap-1 ${r.delta > 0 ? "text-success" : "text-destructive"}`}>
                <span className="font-mono w-6 text-right">{r.delta > 0 ? "+" : ""}{r.delta}</span>
                <span className="text-muted-foreground">{r.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}: </span>
      <span className="text-foreground font-medium">{value || "—"}</span>
    </div>
  );
}
