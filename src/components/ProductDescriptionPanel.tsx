import { Fragment, useCallback, useMemo, useState } from "react";
import {
  ArrowLeft,
  Download,
  Loader2,
  RefreshCcw,
  ExternalLink,
  Info,
  ChevronDown,
  ChevronUp,
  Pencil,
  Bug,
  ImageOff,
  Image as ImageIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  useProductDescriptions,
  type DescriptionResult,
  type Attempt,
} from "@/hooks/use-product-descriptions";
import type { PriceMatchLineItem } from "@/lib/price-match-utils";
import EnrichProductButton from "@/components/EnrichProductButton";

type ExportFormat = "shopify" | "lightspeed";

interface Props {
  lineItems: PriceMatchLineItem[];
  onBack: () => void;
}

// ── Helpers ───────────────────────────────────────────────
function ck(item: Pick<PriceMatchLineItem, "style_number" | "brand" | "style_name">) {
  return (item.style_number || `${item.brand}|${item.style_name}`).toLowerCase().trim();
}
function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  const sec = Math.floor((Date.now() - t) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
function slugify(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function descriptionToHtml(desc: string): string {
  const paragraphs = desc
    .split(/\n{2,}|(?<=[.!?])\s{2,}/) // double newline or sentence boundary w/ double space
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length <= 1) {
    // fall back to splitting on sentences if it's all one chunk
    const sentences = desc.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    if (sentences.length > 1) {
      return sentences.map((s) => `<p>${escapeHtml(s)}</p>`).join("");
    }
    return `<p>${escapeHtml(desc.trim())}</p>`;
  }
  return paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
}
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}
function csvEscape(v: string | number): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}
function downloadCSV(rows: string[][], filename: string) {
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Confidence / source badges ────────────────────────────
function SourceBadge({ result }: { result: DescriptionResult }) {
  if (result.source_type === "ai_generated") {
    return (
      <Badge className="text-[10px] bg-accent text-accent-foreground hover:bg-accent/80">
        AI generated
      </Badge>
    );
  }
  if (result.source_type === "supplier") {
    return (
      <Badge className="text-[10px] bg-success text-success-foreground hover:bg-success/80">
        Supplier site
      </Badge>
    );
  }
  return (
    <Badge className="text-[10px] bg-primary text-primary-foreground hover:bg-primary/80">
      Retailer site
    </Badge>
  );
}

// ── Reason explainers ─────────────────────────────────────
function reasonLabel(r: Attempt["reason"]): string {
  switch (r) {
    case "ok": return "ok";
    case "empty_response": return "empty response";
    case "blocked": return "blocked";
    case "selector_not_matched": return "selector not matched";
    case "too_short": return "too short";
    case "no_search_results": return "no search results";
    case "fetch_error": return "fetch error";
    case "skipped": return "skipped";
  }
}

function FailureTooltip({
  attempts,
  label,
  overrideMessage,
}: {
  attempts: Attempt[];
  label: React.ReactNode;
  overrideMessage?: string;
}) {
  const last = attempts[attempts.length - 1];
  if (!last && !overrideMessage) return <>{label}</>;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help underline decoration-dotted">{label}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[340px] text-[10px] leading-snug">
          {overrideMessage ? (
            <div>{overrideMessage}</div>
          ) : last ? (
            <>
              <div>
                <span className="font-semibold">Tried:</span> {last.url}
              </div>
              <div>
                <span className="font-semibold">Status:</span> {last.status || "—"}
              </div>
              <div>
                <span className="font-semibold">Reason:</span> {reasonLabel(last.reason)}
              </div>
              {attempts.length > 1 && (
                <div className="mt-1 pt-1 border-t border-border/40 opacity-80">
                  {attempts.length} attempts total
                </div>
              )}
            </>
          ) : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function StatusBadge({
  status,
  isLoading,
}: {
  status: DescriptionResult["status"] | "pending";
  isLoading: boolean;
}) {
  if (isLoading)
    return (
      <Badge variant="secondary" className="text-[10px]">
        <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Fetching
      </Badge>
    );
  switch (status) {
    case "found":
      return (
        <Badge variant="secondary" className="text-[10px]">
          Found
        </Badge>
      );
    case "not_found":
      return (
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          Not Found
        </Badge>
      );
    case "error":
      return (
        <Badge variant="destructive" className="text-[10px]">
          Error
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-[10px]">
          Pending
        </Badge>
      );
  }
}

// ── Component ─────────────────────────────────────────────
const ProductDescriptionPanel = ({ lineItems, onBack }: Props) => {
  const { results, loading, fetchDescription, fetchAll, updateDescription } =
    useProductDescriptions();
  const [running, setRunning] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("shopify");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [debugMode, setDebugMode] = useState(false);

  const toggleExpand = (k: string) =>
    setExpanded((p) => {
      const n = new Set(p);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  const toggleEdit = (k: string) =>
    setEditing((p) => {
      const n = new Set(p);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  const handleFetchAll = useCallback(async () => {
    if (running || lineItems.length === 0) return;
    setRunning(true);
    await fetchAll(lineItems);
    setRunning(false);
    toast.success("Description fetch complete");
  }, [running, lineItems, fetchAll]);

  // ── Summary counts ───────────────────────────────────────
  const summary = useMemo(() => {
    let supplier = 0,
      retailer = 0,
      notFound = 0,
      edited = 0;
    for (const item of lineItems) {
      const r = results.get(ck(item));
      if (!r) continue;
      if (r.edited) edited++;
      if (r.status === "found") {
        if (r.confidence === "high") supplier++;
        else retailer++;
      } else if (r.status === "not_found") notFound++;
    }
    return { supplier, retailer, notFound, edited };
  }, [lineItems, results]);

  const exportableCount = useMemo(() => {
    let n = 0;
    for (const item of lineItems) {
      const r = results.get(ck(item));
      if (r?.description?.trim()) n++;
    }
    return n;
  }, [lineItems, results]);

  // ── CSV exports ──────────────────────────────────────────
  const exportShopify = () => {
    const headers = [
      "Handle",
      "Title",
      "Body (HTML)",
      "Vendor",
      "Type",
      "Tags",
      "Published",
      "Option1 Name",
      "Option1 Value",
      "Variant SKU",
      "Variant Price",
      "Variant Cost",
    ];
    const rows: string[][] = [headers];
    let exported = 0;
    for (const item of lineItems) {
      const r = results.get(ck(item));
      const desc = r?.description?.trim();
      if (!desc) continue;
      const fullName = r?.full_product_name?.trim() || item.style_name;
      rows.push([
        slugify(item.style_number || fullName),
        fullName,
        descriptionToHtml(desc),
        item.brand,
        item.product_type || "",
        "",
        "TRUE",
        "",
        "",
        item.style_number,
        Number(item.rrp_incl_gst || 0).toFixed(2),
        Number(item.cost_ex_gst || 0).toFixed(2),
      ]);
      exported++;
    }
    if (exported === 0) {
      toast.error("No descriptions to export yet");
      return;
    }
    const date = new Date().toISOString().slice(0, 10);
    downloadCSV(rows, `product-descriptions-shopify-${date}.csv`);
    toast.success(`Exported ${exported} of ${lineItems.length} products (Shopify)`);
  };

  const exportLightspeed = () => {
    const headers = [
      "product_name",
      "description",
      "brand",
      "sku",
      "price_including_tax",
      "supply_price",
      "product_type",
    ];
    const rows: string[][] = [headers];
    let exported = 0;
    for (const item of lineItems) {
      const r = results.get(ck(item));
      const desc = r?.description?.trim();
      if (!desc) continue;
      const fullName = r?.full_product_name?.trim() || item.style_name;
      rows.push([
        fullName,
        stripHtml(desc),
        item.brand,
        item.style_number,
        Number(item.rrp_incl_gst || 0).toFixed(2),
        Number(item.cost_ex_gst || 0).toFixed(2),
        item.product_type || "",
      ]);
      exported++;
    }
    if (exported === 0) {
      toast.error("No descriptions to export yet");
      return;
    }
    const date = new Date().toISOString().slice(0, 10);
    downloadCSV(rows, `product-descriptions-lightspeed-${date}.csv`);
    toast.success(`Exported ${exported} of ${lineItems.length} products (Lightspeed)`);
  };

  const handleExport = () => {
    if (format === "shopify") exportShopify();
    else exportLightspeed();
  };

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="px-4 pt-3 pb-24 animate-fade-in max-w-6xl mx-auto">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-3"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-2 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold font-display">Product Descriptions</h1>
          <p className="text-sm text-muted-foreground">
            Fetches descriptions from supplier websites first, then retailer sites. Ready
            to export for Shopify or Lightspeed import.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Format toggle */}
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            <button
              onClick={() => setFormat("shopify")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                format === "shopify"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              Export for Shopify
            </button>
            <button
              onClick={() => setFormat("lightspeed")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-border ${
                format === "lightspeed"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              Export for Lightspeed
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={exportableCount === 0}
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleFetchAll}
            disabled={running || lineItems.length === 0}
          >
            {running ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCcw className="w-3.5 h-3.5" />
            )}
            Fetch All
          </Button>
          <Button
            variant={debugMode ? "default" : "outline"}
            size="sm"
            onClick={() => setDebugMode((v) => !v)}
            title="Show fetch URLs, HTTP statuses, selectors and AI raw response"
          >
            <Bug className="w-3.5 h-3.5" />
            🔬 Debug Mode {debugMode ? "ON" : "OFF"}
          </Button>
          {(() => {
            let processed = 0, resized = 0, skipped = 0;
            for (const r of results.values()) {
              const s = r.image_stats;
              if (!s) continue;
              processed += s.processed || 0;
              resized += s.resized || 0;
              skipped += s.skipped || 0;
            }
            return (
              <div
                className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border bg-muted/40 text-[11px] font-mono"
                title="Live counter — updates as each Fetch completes"
              >
                <span className="text-foreground">
                  Images processed: <strong>{processed}</strong>
                </span>
                <span className="text-muted-foreground">|</span>
                <span className="text-amber-600 dark:text-amber-400">
                  Resized: <strong>{resized}</strong>
                </span>
                <span className="text-muted-foreground">|</span>
                <span className="text-destructive">
                  Skipped: <strong>{skipped}</strong>
                </span>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Info banner */}
      <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 mb-4 flex items-start gap-2">
        <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <p className="text-xs text-foreground">
          Descriptions are fetched from official supplier sites first, then Australian
          retailers. Always review before publishing.
        </p>
      </div>

      {/* Summary */}
      {results.size > 0 && (
        <div className="flex flex-wrap gap-2 mb-3 text-xs">
          <Badge className="bg-success text-success-foreground hover:bg-success/80">
            {summary.supplier} from supplier sites
          </Badge>
          <Badge className="bg-primary text-primary-foreground hover:bg-primary/80">
            {summary.retailer} from retailer sites
          </Badge>
          <Badge variant="outline">{summary.notFound} not found</Badge>
          {summary.edited > 0 && (
            <Badge variant="secondary">{summary.edited} edited manually</Badge>
          )}
          <Badge variant="outline" className="ml-auto">
            Exporting {exportableCount} of {lineItems.length}
          </Badge>
        </div>
      )}

      {/* Empty state */}
      {lineItems.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <p className="text-sm text-muted-foreground mb-2">No products to fetch yet.</p>
          <p className="text-xs text-muted-foreground">
            Open Product Descriptions from an invoice review screen to auto-load line items.
          </p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>Image</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lineItems.map((item) => {
                const key = ck(item);
                const r = results.get(key);
                const isLoading = !!loading.get(key);
                const isExpanded = expanded.has(key);
                const isEditing = editing.has(key);
                const desc = r?.description || "";
                const preview =
                  desc.length > 120 ? `${desc.slice(0, 120)}…` : desc;

                return (
                  <Fragment key={key}>
                  <TableRow className="align-top">
                    <TableCell className="max-w-[220px]">
                      <p className="text-xs font-medium">{item.style_name || "—"}</p>
                      {item.style_number && (
                        <p className="text-[10px] text-muted-foreground font-mono">
                          {item.style_number}
                        </p>
                      )}
                      {r?.full_product_name &&
                        r.full_product_name.toLowerCase().trim() !==
                          (item.style_name || "").toLowerCase().trim() && (
                          <p className="text-[10px] text-primary mt-1 leading-tight">
                            <span className="text-muted-foreground">Full name:</span>{" "}
                            {r.full_product_name}
                          </p>
                        )}
                    </TableCell>
                    <TableCell className="text-xs">{item.brand || "—"}</TableCell>
                    <TableCell className="min-w-[80px]">
                      {isLoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                      ) : r?.image_url ? (
                        <div className="flex flex-col items-start gap-1">
                          <img
                            src={r.image_url}
                            alt={item.style_name || ""}
                            className="w-12 h-12 rounded object-cover border border-border"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = "none";
                            }}
                          />
                          <Badge className="text-[9px] bg-success text-success-foreground hover:bg-success/80">
                            <ImageIcon className="w-2.5 h-2.5 mr-0.5" /> Found
                          </Badge>
                        </div>
                      ) : r ? (
                        <div className="flex items-center gap-1">
                          <ImageOff className="w-4 h-4 text-muted-foreground" />
                          <FailureTooltip
                            attempts={r.image_attempts || []}
                            overrideMessage={
                              (r.image_stats?.skipped ?? 0) > 0
                                ? "Image too large to process — resize failed"
                                : undefined
                            }
                            label={
                              <Badge
                                variant="outline"
                                className="text-[9px] text-muted-foreground"
                              >
                                ⚠️ No image
                              </Badge>
                            }
                          />
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="min-w-[140px]">
                      {r && (r.status === "found" || r.source_type === "ai_generated") ? (
                        <div className="flex flex-col gap-0.5">
                          <SourceBadge result={r} />
                          {r.source_url ? (
                            <a
                              href={r.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5 truncate max-w-[140px]"
                            >
                              {r.source_name || "View source"}
                              <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                            </a>
                          ) : r.source_name ? (
                            <span className="text-[10px] text-muted-foreground">
                              {r.source_name}
                            </span>
                          ) : null}
                          <span className="text-[10px] text-muted-foreground">
                            Fetched {relativeTime(r.fetched_at)}
                          </span>
                          {r.raw_word_count > r.word_count && r.word_count > 0 && (
                            <span className="text-[10px] text-muted-foreground">
                              {r.word_count}/{r.raw_word_count} words (truncated)
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="min-w-[260px]">
                      {isLoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : isEditing ? (
                        <div className="flex flex-col gap-1">
                          <Textarea
                            defaultValue={desc}
                            rows={5}
                            className="text-xs"
                            onBlur={(e) => {
                              updateDescription(key, e.target.value);
                              toggleEdit(key);
                            }}
                          />
                          <span className="text-[10px] text-muted-foreground">
                            Click outside to save
                          </span>
                        </div>
                      ) : r?.status === "not_found" ? (
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] text-muted-foreground italic">
                            No description found — write your own
                          </span>
                          <Textarea
                            placeholder="Type a description for this product…"
                            rows={3}
                            className="text-xs"
                            onBlur={(e) => {
                              if (e.target.value.trim()) updateDescription(key, e.target.value);
                            }}
                          />
                        </div>
                      ) : r?.status === "error" ? (
                        <span className="text-[10px] text-destructive">
                          {r.error_message || "Fetch failed"}
                        </span>
                      ) : desc ? (
                        <div className="flex items-start gap-1">
                          <button
                            onClick={() => toggleExpand(key)}
                            className="text-xs text-left hover:text-primary transition-colors"
                            title="Click to expand"
                          >
                            {isExpanded ? desc : preview}
                          </button>
                          <div className="flex flex-col gap-0.5 shrink-0">
                            {desc.length > 120 && (
                              <button
                                onClick={() => toggleExpand(key)}
                                className="text-muted-foreground hover:text-foreground"
                                aria-label={isExpanded ? "Collapse" : "Expand"}
                              >
                                {isExpanded ? (
                                  <ChevronUp className="w-3 h-3" />
                                ) : (
                                  <ChevronDown className="w-3 h-3" />
                                )}
                              </button>
                            )}
                            <button
                              onClick={() => toggleEdit(key)}
                              className="text-muted-foreground hover:text-foreground"
                              aria-label="Edit description"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          </div>
                          {r?.edited && (
                            <Badge variant="secondary" className="text-[9px] ml-1">
                              Edited
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {r?.status === "not_found" || r?.status === "error" ? (
                        <FailureTooltip
                          attempts={r.attempts || []}
                          label={
                            <StatusBadge
                              status={r?.status || "pending"}
                              isLoading={isLoading}
                            />
                          }
                        />
                      ) : (
                        <StatusBadge
                          status={r?.status || "pending"}
                          isLoading={isLoading}
                        />
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px]"
                          disabled={isLoading}
                          onClick={() => fetchDescription(item, { forceRefresh: !!r })}
                        >
                          {r ? <RefreshCcw className="w-3 h-3" /> : null}
                          {r ? "Refetch" : "Fetch"}
                        </Button>
                        <EnrichProductButton
                          invoiceProduct={{
                            brand: item.brand,
                            product_name: item.style_name,
                            sku: item.style_number,
                          }}
                          hasDescriptionAndImage={false}
                          onEnriched={(fields) => {
                            if (fields.description) {
                              updateDescription(key, fields.description);
                            }
                          }}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                  {debugMode && r && (
                    <TableRow key={key + "_debug"} className="bg-muted/30">
                      <TableCell colSpan={7} className="text-[10px] font-mono">
                        <div className="space-y-1 p-2">
                          <div className="font-semibold text-foreground">🔬 Debug trace</div>
                          {(r.attempts || []).map((a, i) => (
                            <div key={i} className="pl-2">
                              <span className="text-muted-foreground">{i + 1}.</span>{" "}
                              <span className="text-primary">{a.url}</span>
                              {" → "}
                              <span className={a.found ? "text-success" : "text-destructive"}>
                                HTTP {a.status || "n/a"}
                              </span>
                              {" — "}
                              <span>{reasonLabel(a.reason)}</span>
                              {a.selector ? <span className="text-muted-foreground"> [selector: {a.selector}]</span> : null}
                              {" — "}
                              <span>
                                {a.found ? "description found in HTML" : "no description"}
                              </span>
                            </div>
                          ))}
                          <div className="pt-1">
                            <span className="text-muted-foreground">Final status:</span>{" "}
                            <span className="text-foreground">
                              {r.status === "found"
                                ? r.word_count < 8
                                  ? "too-short"
                                  : "ready"
                                : "failed"}
                            </span>
                            {r.status === "found" && r.word_count < 8 && (
                              <span className="text-warning ml-2">
                                ⚠ AI returned only {r.word_count} words — threshold is normally 40+. Consider editing manually.
                              </span>
                            )}
                          </div>
                          <div className="pt-1">
                            <span className="text-muted-foreground">AI input preview:</span>{" "}
                            {r.ai_raw_preview ? (
                              <code className="text-foreground bg-background/60 px-1 py-0.5 rounded">
                                {r.ai_raw_preview}
                              </code>
                            ) : (
                              <span className="text-muted-foreground italic">
                                n/a — description scraped directly
                              </span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground mt-3 text-center">
        Descriptions sourced from official supplier and retailer websites. Always review
        before publishing.
      </p>
    </div>
  );
};

export default ProductDescriptionPanel;
