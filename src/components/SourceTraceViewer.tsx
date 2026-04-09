import { useState, useMemo, useCallback } from "react";
import {
  X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Eye, EyeOff,
  MapPin, AlertTriangle, Maximize2, Minimize2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { SourceTrace, SourceBoundingBox, FieldSourceTrace, ValidatedProduct } from "@/lib/invoice-validator";

// Field-type color map
const FIELD_COLORS: Record<string, { bg: string; border: string; label: string }> = {
  title:    { bg: "rgba(59,130,246,0.18)", border: "rgba(59,130,246,0.7)",  label: "Title" },
  sku:      { bg: "rgba(168,85,247,0.18)", border: "rgba(168,85,247,0.7)",  label: "SKU" },
  quantity: { bg: "rgba(34,197,94,0.18)",  border: "rgba(34,197,94,0.7)",   label: "Qty" },
  cost:     { bg: "rgba(249,115,22,0.18)", border: "rgba(249,115,22,0.7)",  label: "Cost" },
  size:     { bg: "rgba(234,179,8,0.18)",  border: "rgba(234,179,8,0.7)",   label: "Size" },
  colour:   { bg: "rgba(236,72,153,0.18)", border: "rgba(236,72,153,0.7)",  label: "Colour" },
  vendor:   { bg: "rgba(20,184,166,0.18)", border: "rgba(20,184,166,0.7)",  label: "Vendor" },
  barcode:  { bg: "rgba(156,163,175,0.18)",border: "rgba(156,163,175,0.7)", label: "Barcode" },
  unknown:  { bg: "rgba(156,163,175,0.12)",border: "rgba(156,163,175,0.5)", label: "Unknown" },
};

interface SourceTraceViewerProps {
  product: ValidatedProduct;
  invoicePages: string[]; // base64 or URL per page
  onClose: () => void;
  allProducts?: ValidatedProduct[]; // for debug overlay
  showDebugZones?: boolean;
}

export default function SourceTraceViewer({
  product, invoicePages, onClose, allProducts, showDebugZones = false,
}: SourceTraceViewerProps) {
  const trace = product._sourceTrace;
  const [currentPage, setCurrentPage] = useState(trace?.page ? trace.page - 1 : 0);
  const [hoveredField, setHoveredField] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [showAllZones, setShowAllZones] = useState(showDebugZones);

  const totalPages = invoicePages.length;
  const pageImage = invoicePages[currentPage] || "";

  // Get boxes for current page
  const pageBoxes = useMemo(() => {
    if (!trace) return [];
    return trace.allBoxes.filter(b => b.page === currentPage + 1);
  }, [trace, currentPage]);

  // All products' boxes for debug mode
  const allDebugBoxes = useMemo(() => {
    if (!showAllZones || !allProducts) return [];
    return allProducts
      .filter(p => p._sourceTrace)
      .flatMap(p => p._sourceTrace!.allBoxes.filter(b => b.page === currentPage + 1));
  }, [showAllZones, allProducts, currentPage]);

  // Field traces for traceability panel
  const fieldTraces = useMemo(() => {
    if (!trace) return [];
    return trace.fieldTraces;
  }, [trace]);

  const navigateToPage = useCallback((page: number) => {
    if (page >= 0 && page < totalPages) setCurrentPage(page);
  }, [totalPages]);

  // When clicking a field trace, navigate to its page
  const handleFieldClick = useCallback((ft: FieldSourceTrace) => {
    navigateToPage(ft.page - 1);
    setHoveredField(ft.field);
    setTimeout(() => setHoveredField(null), 2000);
  }, [navigateToPage]);

  const isLowConfidence = product._confidenceLevel === "low";

  return (
    <div className={`flex flex-col bg-card border border-border rounded-xl shadow-lg overflow-hidden ${expanded ? "fixed inset-4 z-50" : "h-full"}`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/20">
        <MapPin className="w-4 h-4 text-primary shrink-0" />
        <span className="text-xs font-semibold truncate flex-1">Source Trace — {product.name || product._rawName || "Row"}</span>
        <div className="flex items-center gap-1">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowAllZones(!showAllZones)}>
                  {showAllZones ? <EyeOff className="w-3.5 h-3.5 text-primary" /> : <Eye className="w-3.5 h-3.5 text-muted-foreground" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><span className="text-[10px]">{showAllZones ? "Hide" : "Show"} AI extraction zones</span></TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setExpanded(!expanded)}>
            {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </Button>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left: Invoice page viewer */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Page nav + zoom */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-muted/10">
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => navigateToPage(currentPage - 1)} disabled={currentPage === 0}>
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <span className="text-[10px] text-muted-foreground font-mono">
              Page {currentPage + 1} / {totalPages || 1}
            </span>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => navigateToPage(currentPage + 1)} disabled={currentPage >= totalPages - 1}>
              <ChevronRight className="w-3.5 h-3.5" />
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

          {/* Invoice image with overlays */}
          <div className="flex-1 overflow-auto bg-muted/5 p-2">
            {pageImage ? (
              <div className="relative inline-block" style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}>
                <img src={pageImage} alt={`Invoice page ${currentPage + 1}`} className="max-w-full block" draggable={false} />

                {/* Highlight boxes for this product */}
                {pageBoxes.map((box, i) => {
                  const color = FIELD_COLORS[box.fieldType || "unknown"];
                  const isHovered = hoveredField === box.fieldType;
                  const isFaded = hoveredField !== null && !isHovered;
                  return (
                    <div
                      key={`box-${i}`}
                      className="absolute pointer-events-none transition-opacity duration-200"
                      style={{
                        left: `${box.x * 100}%`,
                        top: `${box.y * 100}%`,
                        width: `${box.width * 100}%`,
                        height: `${box.height * 100}%`,
                        backgroundColor: color.bg,
                        border: `2px solid ${color.border}`,
                        borderStyle: isLowConfidence ? "dashed" : "solid",
                        opacity: isFaded ? 0.2 : 1,
                        borderRadius: "2px",
                      }}
                    >
                      {isHovered && (
                        <span className="absolute -top-4 left-0 text-[8px] font-bold px-1 py-0.5 rounded" style={{ backgroundColor: color.border, color: "#fff" }}>
                          {color.label}: {box.text}
                        </span>
                      )}
                    </div>
                  );
                })}

                {/* Low confidence warning overlay */}
                {isLowConfidence && pageBoxes.length > 0 && (
                  <div className="absolute top-2 right-2 bg-destructive/90 text-white text-[9px] px-2 py-1 rounded-md flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Low confidence — please verify
                  </div>
                )}

                {/* Debug: all extraction zones */}
                {showAllZones && allDebugBoxes.map((box, i) => (
                  <div
                    key={`debug-${i}`}
                    className="absolute pointer-events-none"
                    style={{
                      left: `${box.x * 100}%`,
                      top: `${box.y * 100}%`,
                      width: `${box.width * 100}%`,
                      height: `${box.height * 100}%`,
                      border: "1px dashed rgba(156,163,175,0.5)",
                      backgroundColor: "rgba(156,163,175,0.05)",
                      borderRadius: "1px",
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
                <span>No invoice page image available</span>
              </div>
            )}
          </div>
        </div>

        {/* Right: Field traceability panel */}
        <div className="w-64 border-l border-border flex flex-col bg-muted/10 shrink-0">
          <div className="px-3 py-2 border-b border-border/50">
            <p className="text-[10px] font-semibold text-foreground">Field Traceability</p>
            <p className="text-[9px] text-muted-foreground">Hover a field to highlight its source</p>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Color legend */}
            <div className="px-3 py-2 border-b border-border/30">
              <p className="text-[9px] text-muted-foreground mb-1.5 font-medium">Colour Legend</p>
              <div className="flex flex-wrap gap-1">
                {Object.entries(FIELD_COLORS).filter(([k]) => k !== "unknown").map(([key, val]) => (
                  <span key={key} className="inline-flex items-center gap-0.5 text-[8px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: val.bg, border: `1px solid ${val.border}` }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: val.border }} />
                    {val.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Field traces */}
            {fieldTraces.length > 0 ? (
              <div className="divide-y divide-border/30">
                {fieldTraces.map((ft, i) => (
                  <button
                    key={i}
                    className={`w-full text-left px-3 py-2.5 hover:bg-muted/30 transition-colors ${hoveredField === ft.field ? "bg-primary/5" : ""}`}
                    onMouseEnter={() => setHoveredField(ft.field)}
                    onMouseLeave={() => setHoveredField(null)}
                    onClick={() => handleFieldClick(ft)}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: FIELD_COLORS[ft.field]?.border || FIELD_COLORS.unknown.border }}
                      />
                      <span className="text-[10px] font-semibold text-foreground capitalize">{ft.field}</span>
                      <Badge variant="outline" className="text-[8px] h-3.5 px-1 ml-auto">p.{ft.page}</Badge>
                    </div>
                    <p className="text-[10px] text-foreground font-mono truncate">{ft.value || "—"}</p>
                    {ft.extractionMethod && (
                      <p className="text-[9px] text-muted-foreground mt-0.5">→ {ft.extractionMethod}</p>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-3 py-6 text-center">
                <MapPin className="w-5 h-5 text-muted-foreground/50 mx-auto mb-2" />
                <p className="text-[10px] text-muted-foreground">No source trace data</p>
                <p className="text-[9px] text-muted-foreground mt-1">
                  {trace?.approximated
                    ? "Approximate regions shown — exact coordinates unavailable"
                    : "Source positions not captured for this invoice"
                  }
                </p>
              </div>
            )}

            {/* Source snapshot — zoomed-in region */}
            {pageBoxes.length > 0 && pageImage && (
              <div className="px-3 py-2 border-t border-border/30">
                <p className="text-[9px] text-muted-foreground font-medium mb-1.5">Source Snapshot</p>
                <SourceSnapshot pageImage={pageImage} boxes={pageBoxes} />
              </div>
            )}
          </div>

          {/* Approximation notice */}
          {trace?.approximated && (
            <div className="px-3 py-2 border-t border-border bg-secondary/5">
              <p className="text-[9px] text-secondary flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                Approximate positions — exact coordinates unavailable
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Source Snapshot: cropped preview of extraction area ──
function SourceSnapshot({ pageImage, boxes }: { pageImage: string; boxes: SourceBoundingBox[] }) {
  if (boxes.length === 0) return null;

  // Calculate bounding area covering all boxes with padding
  const minX = Math.max(0, Math.min(...boxes.map(b => b.x)) - 0.02);
  const minY = Math.max(0, Math.min(...boxes.map(b => b.y)) - 0.02);
  const maxX = Math.min(1, Math.max(...boxes.map(b => b.x + b.width)) + 0.02);
  const maxY = Math.min(1, Math.max(...boxes.map(b => b.y + b.height)) + 0.02);

  const cropWidth = maxX - minX;
  const cropHeight = maxY - minY;

  if (cropWidth <= 0 || cropHeight <= 0) return null;

  return (
    <div
      className="relative overflow-hidden rounded-md border border-border bg-white"
      style={{ height: "80px" }}
    >
      <div
        className="absolute"
        style={{
          left: `${-(minX / cropWidth) * 100}%`,
          top: `${-(minY / cropHeight) * 100}%`,
          width: `${(1 / cropWidth) * 100}%`,
          height: `${(1 / cropHeight) * 100}%`,
        }}
      >
        <img src={pageImage} alt="Source region" className="w-full h-full object-contain" draggable={false} />
        {/* Miniature highlight boxes */}
        {boxes.map((box, i) => {
          const color = FIELD_COLORS[box.fieldType || "unknown"];
          return (
            <div
              key={i}
              className="absolute pointer-events-none"
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.width * 100}%`,
                height: `${box.height * 100}%`,
                border: `1.5px solid ${color.border}`,
                backgroundColor: color.bg,
                borderRadius: "1px",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Inline Source Preview (compact, for embedding next to a row) ──
export function InlineSourcePreview({
  product, invoicePages, onClick,
}: {
  product: ValidatedProduct;
  invoicePages: string[];
  onClick?: () => void;
}) {
  const trace = product._sourceTrace;
  if (!trace || invoicePages.length === 0) return null;

  const pageImage = invoicePages[trace.page - 1];
  if (!pageImage) return null;

  const boxes = trace.allBoxes.filter(b => b.page === trace.page);
  if (boxes.length === 0) return null;

  return (
    <button
      onClick={onClick}
      className="relative w-16 h-12 rounded border border-border overflow-hidden shrink-0 hover:ring-2 hover:ring-primary/30 transition-all group"
      title="Click to view source trace"
    >
      <img src={pageImage} alt="Source" className="w-full h-full object-cover" draggable={false} />
      {boxes.slice(0, 3).map((box, i) => {
        const color = FIELD_COLORS[box.fieldType || "unknown"];
        return (
          <div
            key={i}
            className="absolute pointer-events-none"
            style={{
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.width * 100}%`,
              height: `${box.height * 100}%`,
              border: `1px solid ${color.border}`,
              backgroundColor: color.bg,
            }}
          />
        );
      })}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
        <MapPin className="w-3 h-3 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <Badge variant="outline" className="absolute bottom-0.5 right-0.5 text-[7px] h-3 px-0.5 bg-background/80">p.{trace.page}</Badge>
    </button>
  );
}
