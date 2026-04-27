import { useState, useEffect, useMemo } from "react";
import { Download, RotateCcw, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";

interface ExportEntry {
  supplier: string;
  format: string;
  filename: string;
  productCount: number;
  date: string;
}

interface InvoiceHistoryRow {
  id: string;
  supplier_profile_id: string | null;
  supplier_name: string;
  format_type: string | null;
  match_method: string | null;
  invoice_count: number;
  updated_at: string;
  exported_at: string | null;
  edit_count: number | null;
  review_duration_seconds: number | null;
  processing_quality_score: number | null;
  original_file_path: string | null;
}

const FORMAT_LABELS: Record<string, string> = {
  shopify_full: "Shopify CSV Full",
  shopify_inventory: "Inventory CSV",
  shopify_price: "Price CSV",
  tags_only: "Tags CSV",
  xlsx: "Excel",
  summary_pdf: "Summary PDF",
};

type QualityBucket = "all" | "auto" | "good" | "manual" | "heavy";

interface QualityBadgeMeta {
  label: string;
  bucket: Exclude<QualityBucket, "all">;
  className: string;
}

function bucketForScore(score: number | null | undefined): QualityBadgeMeta {
  if (score == null) {
    return {
      label: "—",
      bucket: "manual",
      className: "bg-muted text-muted-foreground border-border",
    };
  }
  if (score >= 85) {
    return {
      label: "Auto",
      bucket: "auto",
      className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    };
  }
  if (score >= 65) {
    return {
      label: "Good",
      bucket: "good",
      className: "bg-teal-500/15 text-teal-400 border-teal-500/30",
    };
  }
  if (score >= 40) {
    return {
      label: "Manual",
      bucket: "manual",
      className: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    };
  }
  return {
    label: "Heavy edit",
    bucket: "heavy",
    className: "bg-red-500/15 text-red-400 border-red-500/30",
  };
}

function formatReviewMin(secs: number | null | undefined): string {
  if (secs == null) return "—";
  return `${(secs / 60).toFixed(1)} min`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

// Load SEO campaigns from localStorage (legacy)
function getCollabCampaigns(): { theme: string; partnerCount: number; date: string }[] {
  try {
    const campaigns = JSON.parse(localStorage.getItem("collab_campaigns") || "[]");
    return campaigns.map((c: any) => ({
      theme: c.theme || "Untitled campaign",
      partnerCount: c.partners?.length || 0,
      date: c.createdAt
        ? new Date(c.createdAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })
        : "",
    }));
  } catch { return []; }
}

function getExportHistory(): ExportEntry[] {
  try { return JSON.parse(localStorage.getItem("export_history") || "[]"); } catch { return []; }
}

const FILTER_TABS: { key: QualityBucket; label: string }[] = [
  { key: "all",    label: "All" },
  { key: "auto",   label: "Auto" },
  { key: "good",   label: "Good" },
  { key: "manual", label: "Manual" },
  { key: "heavy",  label: "Heavy edit" },
];

const HistoryScreen = () => {
  const confirmDialog = useConfirmDialog();
  const [invoices, setInvoices] = useState<InvoiceHistoryRow[]>([]);
  const [exports, setExports] = useState<ExportEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<QualityBucket>("all");
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);

  const loadInvoices = async () => {
    setLoading(true);
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) { setLoading(false); return; }

    const { data, error } = await supabase
      .from("invoice_patterns")
      .select(`
        id, supplier_profile_id, format_type, match_method, invoice_count,
        updated_at, exported_at, edit_count, review_duration_seconds,
        processing_quality_score, original_file_path,
        supplier_profiles ( supplier_name )
      `)
      .order("updated_at", { ascending: false })
      .limit(100);

    if (error) {
      console.warn("Failed to load invoice history:", error);
      setLoading(false);
      return;
    }

    const rows: InvoiceHistoryRow[] = (data || []).map((r: any) => ({
      id: r.id,
      supplier_profile_id: r.supplier_profile_id,
      supplier_name: r.supplier_profiles?.supplier_name || "Unknown supplier",
      format_type: r.format_type,
      match_method: r.match_method,
      invoice_count: r.invoice_count || 0,
      updated_at: r.updated_at,
      exported_at: r.exported_at,
      edit_count: r.edit_count,
      review_duration_seconds: r.review_duration_seconds,
      processing_quality_score: r.processing_quality_score,
      original_file_path: r.original_file_path,
    }));
    setInvoices(rows);
    setLoading(false);
  };

  useEffect(() => {
    loadInvoices();
    setExports(getExportHistory());
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return invoices;
    return invoices.filter((inv) => bucketForScore(inv.processing_quality_score).bucket === filter);
  }, [invoices, filter]);

  const seoCampaigns = getCollabCampaigns();

  const handleReprocess = async (inv: InvoiceHistoryRow) => {
    if (!inv.original_file_path) {
      toast.error("Original file not available", {
        description: "This invoice was uploaded before re-processing was enabled.",
      });
      return;
    }
    const confirmed = await confirmDialog({
      title: "Re-process this invoice?",
      description: "Sonic will use your latest supplier rules to re-extract data. The original extraction will be replaced.",
      confirmLabel: "Re-process",
    });
    if (!confirmed) return;

    setReprocessingId(inv.id);
    try {
      const { error } = await supabase.functions.invoke("reprocess-invoice", {
        body: { invoice_pattern_id: inv.id },
      });
      if (error) {
        toast.error("Re-process failed", { description: error.message || "Please try again." });
        return;
      }
      toast.success("Invoice re-processed", {
        description: "Open it from the Invoices tab to review the new extraction.",
      });
      await loadInvoices();
    } catch (err: any) {
      toast.error("Re-process failed", { description: err?.message || "Please try again." });
    } finally {
      setReprocessingId(null);
    }
  };

  const handleReExport = (inv: InvoiceHistoryRow) => {
    const match = exports.find((e) => e.supplier.toLowerCase() === inv.supplier_name.toLowerCase());
    if (!match) {
      toast.error("No export found", { description: "Run this invoice through the export step first." });
      return;
    }
    toast.info("Re-export queued", {
      description: `Open ${match.supplier} from the Invoices tab and re-run export to get the latest CSV.`,
    });
  };

  const handleDownloadOriginal = async (inv: InvoiceHistoryRow) => {
    if (!inv.original_file_path) {
      toast.error("Original file not available");
      return;
    }
    try {
      const { data, error } = await supabase.storage
        .from("invoices")
        .createSignedUrl(inv.original_file_path, 60);
      if (error || !data?.signedUrl) {
        toast.error("Download failed", { description: error?.message || "Could not generate download link." });
        return;
      }
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      toast.error("Download failed", { description: err?.message || "Please try again." });
    }
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="px-4 pt-6 pb-24 animate-fade-in">
        <h1 className="text-2xl font-bold font-display mb-1">History</h1>
        <p className="text-muted-foreground text-sm mb-4">Past imports, sale runs & SEO campaigns</p>

        {/* Quality filter row */}
        <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
          <span className="text-xs text-muted-foreground mr-1 shrink-0">Show:</span>
          {FILTER_TABS.map((t, idx) => (
            <div key={t.key} className="flex items-center gap-1 shrink-0">
              {idx > 0 && <span className="text-muted-foreground/40 text-xs">·</span>}
              <button
                onClick={() => setFilter(t.key)}
                className={`text-xs px-2 py-1 rounded-md transition-colors ${
                  filter === t.key
                    ? "bg-primary/15 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          {loading && (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading history…</p>
          )}

          {!loading && filtered.length === 0 && invoices.length === 0 && (
            <div className="bg-card rounded-lg border border-border px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No invoices yet — uploaded invoices will appear here with their quality scores.
              </p>
            </div>
          )}

          {!loading && filtered.length === 0 && invoices.length > 0 && (
            <div className="bg-card rounded-lg border border-border px-4 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                No invoices match this filter. Try "All".
              </p>
            </div>
          )}

          {filtered.map((inv) => {
            const meta = bucketForScore(inv.processing_quality_score);
            const reviewMin = formatReviewMin(inv.review_duration_seconds);
            const tooltipText =
              `${inv.processing_quality_score ?? "—"}/100 · ` +
              `${inv.edit_count ?? 0} edits · ` +
              `${reviewMin} review time · ` +
              `processed via ${inv.match_method || "full_extraction"}`;
            const showReprocess =
              inv.processing_quality_score != null &&
              inv.processing_quality_score < 50 &&
              !!inv.original_file_path;
            const isReprocessing = reprocessingId === inv.id;

            return (
              <div key={inv.id} className="bg-card rounded-lg border border-border px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 bg-primary/15 text-primary">
                    Invoice
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium truncate">{inv.supplier_name}</p>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="outline" className={`text-[10px] py-0 px-1.5 ${meta.className}`}>
                            {meta.label}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs max-w-xs">
                          {tooltipText}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono-data mt-0.5">
                      {formatDate(inv.updated_at)}
                      {inv.format_type && ` · ${inv.format_type}`}
                      {` · ${inv.invoice_count} invoice${inv.invoice_count === 1 ? "" : "s"} learned`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {showReprocess && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleReprocess(inv)}
                            disabled={isReprocessing}
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isReprocessing ? "animate-spin" : ""}`} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          Re-process with updated rules
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {exports.some((e) => e.supplier.toLowerCase() === inv.supplier_name.toLowerCase()) && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleReExport(inv)}>
                            <RotateCcw className="w-3.5 h-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">Re-export latest CSV</TooltipContent>
                      </Tooltip>
                    )}
                    {inv.original_file_path && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDownloadOriginal(inv)}>
                            <Download className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">Download original invoice file</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* SEO campaigns (legacy localStorage) */}
          {seoCampaigns.map((c, i) => (
            <div key={`seo-${i}`} className="bg-card rounded-lg border border-border px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-400 shrink-0">
                  SEO
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{c.theme}</p>
                  <p className="text-xs text-muted-foreground font-mono-data">
                    {c.partnerCount} partners · {c.date}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
};

export default HistoryScreen;
