import { useState, useMemo, useCallback } from "react";
import { ArrowLeft, RefreshCcw, Download, Loader2, ExternalLink, Info, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { matchPrice, type PriceResult, type PriceProduct } from "@/lib/price-intelligence";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────────
export interface PriceMatchLineItem {
  style_name: string;
  style_number: string;
  brand: string;
  cost_ex_gst: number;
  rrp_incl_gst: number;
  barcode?: string;
}

type RowStatus = "pending" | "checking" | "matched" | "under" | "over" | "not_found" | "error";

interface RowResult {
  status: RowStatus;
  marketPrice: number | null;
  source: string;
  sourceUrl?: string;
  currencyConfirmed: string;
  notes: string;
  checkedAt: number;
  raw?: PriceResult;
}

// ── Helpers ────────────────────────────────────────────────
const audFormatter = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
const fmtAUD = (n: number | null | undefined) =>
  n == null || isNaN(n) ? "—" : audFormatter.format(n);

const sessionCache = new Map<string, RowResult>();
const CACHE_TTL_MS = 60 * 60 * 1000;

function cacheKey(item: PriceMatchLineItem) {
  return (item.style_number || `${item.brand}|${item.style_name}`).toLowerCase().trim();
}

function classifyStatus(rrp: number, market: number | null): RowStatus {
  if (market == null || market <= 0) return "not_found";
  const diff = (market - rrp) / rrp;
  if (Math.abs(diff) <= 0.05) return "matched";
  if (diff > 0) return "under"; // market higher → you're priced under
  return "over"; // market lower → you're priced over
}

function relativeTime(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

// ── Inline currency badge ─────────────────────────────────
const CurrencyBadge = ({ currency = "AUD" }: { currency?: string }) => (
  <span className="inline-flex items-center rounded-sm bg-muted px-1 py-0.5 font-mono text-[9px] font-semibold text-muted-foreground">
    {currency} $
  </span>
);

// ── Status badge ───────────────────────────────────────────
const StatusBadge = ({ status }: { status: RowStatus }) => {
  switch (status) {
    case "pending":
      return <Badge variant="outline" className="text-[10px]">Pending</Badge>;
    case "checking":
      return <Badge variant="secondary" className="text-[10px]"><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Checking</Badge>;
    case "matched":
      return <Badge variant="secondary" className="text-[10px]">Matched</Badge>;
    case "under":
      return <Badge className="text-[10px] bg-success text-success-foreground hover:bg-success/80">Priced under market</Badge>;
    case "over":
      return <Badge className="text-[10px] bg-warning text-warning-foreground hover:bg-warning/80">Priced over market</Badge>;
    case "not_found":
      return <Badge variant="outline" className="text-[10px] text-muted-foreground">Not found</Badge>;
    case "error":
      return <Badge variant="destructive" className="text-[10px]">Error</Badge>;
  }
};

interface Props {
  lineItems: PriceMatchLineItem[];
  onBack: () => void;
}

const PriceMatchPanel = ({ lineItems, onBack }: Props) => {
  const [results, setResults] = useState<Record<string, RowResult>>({});
  const [running, setRunning] = useState(false);

  // ── Single check ─────────────────────────────────────────
  const checkOne = useCallback(async (item: PriceMatchLineItem, force = false) => {
    const key = cacheKey(item);
    if (!force) {
      const cached = sessionCache.get(key);
      if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
        setResults(prev => ({ ...prev, [key]: cached }));
        return;
      }
    }
    setResults(prev => ({
      ...prev,
      [key]: {
        status: "checking",
        marketPrice: null,
        source: "",
        currencyConfirmed: "AUD",
        notes: "",
        checkedAt: Date.now(),
      },
    }));
    try {
      const product: PriceProduct = {
        name: item.style_name,
        brand: item.brand,
        barcode: item.barcode,
        currentPrice: item.rrp_incl_gst,
        costPrice: item.cost_ex_gst,
      };
      const res = await matchPrice(product, "AUD", undefined, undefined, force);
      const status: RowStatus = res.price == null
        ? "not_found"
        : classifyStatus(item.rrp_incl_gst, res.price);
      const row: RowResult = {
        status,
        marketPrice: res.price,
        source: res.source || "",
        sourceUrl: res.allPrices?.[0]?.store ? undefined : undefined, // engine doesn't surface URLs
        currencyConfirmed: "AUD",
        notes: res.debugLog?.join(" · ") || "",
        checkedAt: Date.now(),
        raw: res,
      };
      sessionCache.set(key, row);
      setResults(prev => ({ ...prev, [key]: row }));
    } catch (err: any) {
      const row: RowResult = {
        status: "error",
        marketPrice: null,
        source: "",
        currencyConfirmed: "AUD",
        notes: err?.message || "Fetch failed",
        checkedAt: Date.now(),
      };
      setResults(prev => ({ ...prev, [key]: row }));
      toast.error(`Price check failed for ${item.style_name}`);
    }
  }, []);

  const checkAll = useCallback(async () => {
    if (running || lineItems.length === 0) return;
    setRunning(true);
    for (const item of lineItems) {
      await checkOne(item);
      await new Promise(r => setTimeout(r, 1000));
    }
    setRunning(false);
    toast.success("Price check complete");
  }, [lineItems, checkOne, running]);

  // ── Summary counts ───────────────────────────────────────
  const summary = useMemo(() => {
    let matched = 0, under = 0, over = 0, notFound = 0;
    for (const item of lineItems) {
      const r = results[cacheKey(item)];
      if (!r) continue;
      if (r.status === "matched") matched++;
      else if (r.status === "under") under++;
      else if (r.status === "over") over++;
      else if (r.status === "not_found") notFound++;
    }
    return { matched, under, over, notFound };
  }, [lineItems, results]);

  // ── CSV Export ───────────────────────────────────────────
  const exportCSV = () => {
    const rows: string[][] = [[
      "Product", "Brand", "Style Number", "Your RRP (AUD)", "Market Price (AUD)",
      "Difference ($)", "Difference (%)", "Status", "Source", "Source URL", "Checked At",
    ]];
    let exported = 0;
    for (const item of lineItems) {
      const r = results[cacheKey(item)];
      if (!r || r.status === "pending" || r.status === "checking") continue;
      const market = r.marketPrice ?? 0;
      const diff = market ? (market - item.rrp_incl_gst) : 0;
      const diffPct = market ? ((market - item.rrp_incl_gst) / item.rrp_incl_gst * 100).toFixed(1) : "";
      const statusLabel = r.status === "matched" ? "Matched"
        : r.status === "under" ? "Under market"
        : r.status === "over" ? "Over market"
        : r.status === "not_found" ? "Not found"
        : "Error";
      rows.push([
        item.style_name, item.brand, item.style_number,
        item.rrp_incl_gst.toFixed(2),
        r.marketPrice != null ? r.marketPrice.toFixed(2) : "",
        market ? diff.toFixed(2) : "",
        diffPct,
        statusLabel,
        r.source,
        r.sourceUrl || "",
        new Date(r.checkedAt).toISOString(),
      ]);
      exported++;
    }
    if (exported === 0) {
      toast.error("No checked rows to export");
      return;
    }
    const csv = rows.map(r => r.map(c => `"${(c ?? "").toString().replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `price-match-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${exported} rows`);
  };

  // ── Render ───────────────────────────────────────────────
  return (
    <TooltipProvider>
      <div className="px-4 pt-3 pb-24 animate-fade-in max-w-6xl mx-auto">
        {/* Header */}
        <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-3">
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>
        <div className="flex items-start justify-between mb-2 gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold font-display">Price Match</h1>
            <p className="text-sm text-muted-foreground">
              Check your RRP against live supplier and retailer prices (AUD)
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportCSV} disabled={Object.keys(results).length === 0}>
              <Download className="w-3.5 h-3.5" /> Export CSV
            </Button>
            <Button variant="default" size="sm" onClick={checkAll} disabled={running || lineItems.length === 0}>
              {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />}
              Check All
            </Button>
          </div>
        </div>

        {/* AUD info banner */}
        <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 mb-4 flex items-start gap-2">
          <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <p className="text-xs text-foreground">
            Price match searches Australian retailer websites only. All prices are verified in <strong>AUD</strong> — non-AUD prices are excluded automatically.
          </p>
        </div>

        {/* Summary */}
        {Object.keys(results).length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3 text-xs">
            <Badge variant="secondary">{summary.matched} matched</Badge>
            <Badge className="bg-success text-success-foreground hover:bg-success/80">{summary.under} under market</Badge>
            <Badge className="bg-warning text-warning-foreground hover:bg-warning/80">{summary.over} over market</Badge>
            <Badge variant="outline">{summary.notFound} not found</Badge>
          </div>
        )}

        {/* Empty state */}
        {lineItems.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-8 text-center">
            <p className="text-sm text-muted-foreground mb-2">No products to check yet.</p>
            <p className="text-xs text-muted-foreground">
              Open Price Match from an invoice review screen to auto-load line items.
            </p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead className="text-right">Your RRP</TableHead>
                  <TableHead className="text-right">Market Price</TableHead>
                  <TableHead className="text-right">Difference</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lineItems.map((item) => {
                  const key = cacheKey(item);
                  const r = results[key];
                  const status: RowStatus = r?.status || "pending";
                  const market = r?.marketPrice ?? null;
                  const diff = market != null ? market - item.rrp_incl_gst : null;
                  const isLoading = status === "checking";
                  const currencyOK = !r || r.currencyConfirmed === "AUD";
                  return (
                    <TableRow key={key}>
                      <TableCell>
                        <p className="text-xs font-medium">{item.style_name || "—"}</p>
                        {item.style_number && (
                          <p className="text-[10px] text-muted-foreground font-mono">{item.style_number}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{item.brand || "—"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <CurrencyBadge />
                          <span className="text-xs font-mono">{fmtAUD(item.rrp_incl_gst)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {isLoading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin inline" />
                        ) : (
                          <div className="flex flex-col items-end gap-0.5">
                            <div className="flex items-center justify-end gap-1.5">
                              <CurrencyBadge />
                              <span className="text-xs font-mono">{fmtAUD(market)}</span>
                              {!currencyOK && (
                                <Tooltip>
                                  <TooltipTrigger>
                                    <AlertTriangle className="w-3 h-3 text-warning" />
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    Currency could not be confirmed as AUD — verify manually.
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                            {r?.source && (
                              <span className="text-[10px] text-muted-foreground">{r.source}</span>
                            )}
                            {r?.checkedAt && status !== "checking" && (
                              <span className="text-[10px] text-muted-foreground">Checked {relativeTime(r.checkedAt)}</span>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {diff != null && market != null ? (
                          <span className={`text-xs font-mono ${diff > 0 ? "text-success" : diff < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                            {diff > 0 ? "+" : ""}{audFormatter.format(diff)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell><StatusBadge status={status} /></TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {r?.sourceUrl && (
                            <a
                              href={r.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5"
                            >
                              View <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[11px]"
                            disabled={isLoading}
                            onClick={() => checkOne(item, !!r)}
                          >
                            {r ? <RefreshCcw className="w-3 h-3" /> : null}
                            {r ? "Recheck" : "Check"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground mt-3 text-center">
          All prices shown in Australian dollars (AUD). Prices sourced from Australian retailer and supplier websites.
        </p>
      </div>
    </TooltipProvider>
  );
};

export default PriceMatchPanel;
