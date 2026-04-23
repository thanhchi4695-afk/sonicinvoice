import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft, ChevronDown, ChevronRight, Search, History as HistoryIcon,
  FileText, Sparkles, Brain, Fingerprint, ScrollText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { formatDuration } from "@/lib/processing-timing";

interface Props {
  onBack: () => void;
  onOpenInvoiceFlow?: () => void;
}

/** Row sourced from invoice_patterns — Processing History is a derived view. */
interface PatternRow {
  id: string;
  supplier_profile_id: string | null;
  original_filename: string | null;
  format_type: string | null;
  match_method: string | null;
  processing_quality_score: number | null;
  edit_count: number | null;
  review_duration_seconds: number | null;
  processing_duration_seconds: number | null;
  rows_added: number | null;
  rows_deleted: number | null;
  invoice_count: number;
  fields_corrected: string[] | null;
  column_map: Record<string, string> | null;
  sample_headers: unknown;
  field_confidence_history: unknown;
  created_at: string;
  updated_at: string;
}

interface CorrectionRow {
  id: string;
  field_corrected: string | null;
  original_value: string | null;
  corrected_value: string | null;
  correction_reason: string | null;
  created_at: string;
  invoice_pattern_id: string | null;
}

interface SupplierLookup { id: string; supplier_name: string }

const matchMethodMeta = (m: string | null) => {
  switch (m) {
    case "fingerprint_match":
      return { label: "Fingerprint", icon: Fingerprint, cls: "bg-success/15 text-success border-success/30" };
    case "supplier_match":
      return { label: "Supplier match", icon: Brain, cls: "bg-primary/15 text-primary border-primary/30" };
    case "full_extraction":
    default:
      return { label: "Full extraction", icon: Sparkles, cls: "bg-secondary/15 text-secondary-foreground border-secondary/30" };
  }
};

const qualityFromEdits = (editCount: number) => {
  if (editCount === 0) return { label: "Auto", cls: "bg-success/15 text-success border-success/30" };
  if (editCount < 3) return { label: "Good", cls: "bg-primary/15 text-primary border-primary/30" };
  if (editCount <= 10) return { label: "Manual", cls: "bg-amber-500/15 text-amber-500 border-amber-500/30" };
  return { label: "Heavy edit", cls: "bg-destructive/15 text-destructive border-destructive/30" };
};

const ProcessingHistoryPanel = ({ onBack, onOpenInvoiceFlow }: Props) => {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PatternRow[]>([]);
  const [supplierMap, setSupplierMap] = useState<Record<string, string>>({});
  const [corrByPattern, setCorrByPattern] = useState<Record<string, CorrectionRow[]>>({});
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess?.session?.user?.id;
      if (!userId) { setLoading(false); return; }

      const [{ data: patterns }, { data: suppliers }, { data: corrections }] = await Promise.all([
        supabase
          .from("invoice_patterns")
          .select("id, supplier_profile_id, original_filename, format_type, match_method, processing_quality_score, edit_count, review_duration_seconds, processing_duration_seconds, rows_added, rows_deleted, invoice_count, fields_corrected, column_map, sample_headers, field_confidence_history, created_at, updated_at")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(200),
        supabase
          .from("supplier_profiles")
          .select("id, supplier_name")
          .eq("user_id", userId),
        supabase
          .from("correction_log")
          .select("id, field_corrected, original_value, corrected_value, correction_reason, created_at, invoice_pattern_id")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(1000),
      ]);

      if (cancelled) return;

      const sMap: Record<string, string> = {};
      (suppliers as SupplierLookup[] | null)?.forEach((s) => { sMap[s.id] = s.supplier_name; });

      const cMap: Record<string, CorrectionRow[]> = {};
      (corrections as CorrectionRow[] | null)?.forEach((c) => {
        if (!c.invoice_pattern_id) return;
        (cMap[c.invoice_pattern_id] ??= []).push(c);
      });

      setSupplierMap(sMap);
      setCorrByPattern(cMap);
      setRows((patterns as PatternRow[] | null) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const sup = (r.supplier_profile_id && supplierMap[r.supplier_profile_id]) || "";
      const file = r.original_filename || "";
      return sup.toLowerCase().includes(q) || file.toLowerCase().includes(q) || (r.match_method ?? "").toLowerCase().includes(q);
    });
  }, [rows, supplierMap, search]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="px-4 pt-4 pb-24 animate-fade-in">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold font-display flex items-center gap-2">
            <HistoryIcon className="w-5 h-5 text-primary" /> Processing History
          </h2>
          <p className="text-xs text-muted-foreground">Every invoice you've processed — sourced from learned patterns</p>
        </div>
        {onOpenInvoiceFlow && (
          <Button size="sm" variant="teal" onClick={onOpenInvoiceFlow}>
            <FileText className="w-4 h-4" /> Process invoice
          </Button>
        )}
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by supplier, filename, or match method…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 h-9 text-xs bg-card border-border"
        />
      </div>

      <Card className="bg-card border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium w-6"></th>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Filename</th>
                <th className="px-3 py-2 font-medium">Supplier</th>
                <th className="px-3 py-2 font-medium text-right">Edits</th>
                <th className="px-3 py-2 font-medium text-right">Quality score</th>
                <th className="px-3 py-2 font-medium">Method</th>
                <th className="px-3 py-2 font-medium">Quality</th>
                <th className="px-3 py-2 font-medium text-right">Time</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">Loading history…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">
                  No processed invoices yet. Process an invoice to start building history.
                </td></tr>
              )}
              {!loading && filtered.map((r) => {
                const supplier = (r.supplier_profile_id && supplierMap[r.supplier_profile_id]) || "Unknown supplier";
                const editCount = r.edit_count ?? (r.fields_corrected?.length ?? 0);
                const quality = qualityFromEdits(editCount);
                const method = matchMethodMeta(r.match_method);
                const MethodIcon = method.icon;
                const isOpen = expanded.has(r.id);
                const corrections = corrByPattern[r.id] ?? [];
                return (
                  <>
                    <tr
                      key={r.id}
                      className="border-t border-border hover:bg-muted/30 cursor-pointer"
                      onClick={() => toggleExpand(r.id)}
                    >
                      <td className="px-3 py-2 text-muted-foreground">
                        {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{format(new Date(r.updated_at), "d MMM yyyy")}</td>
                      <td className="px-3 py-2 max-w-[220px] truncate" title={r.original_filename ?? "uploaded image"}>
                        {r.original_filename || <span className="text-muted-foreground italic">uploaded image</span>}
                      </td>
                      <td className="px-3 py-2">{supplier}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{editCount}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.processing_quality_score != null ? `${r.processing_quality_score}%` : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={`${method.cls} text-[10px] gap-1`}>
                          <MethodIcon className="w-3 h-3" /> {method.label}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={`${quality.cls} text-[10px]`}>{quality.label}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {formatDuration(r.processing_duration_seconds ?? r.review_duration_seconds)}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={`${r.id}-detail`} className="border-t border-border bg-muted/20">
                        <td colSpan={9} className="px-4 py-4">
                          <div className="grid gap-4 lg:grid-cols-2">
                            <section>
                              <h4 className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                                <ScrollText className="w-3.5 h-3.5 text-primary" /> Corrections ({corrections.length})
                              </h4>
                              {corrections.length === 0 ? (
                                <p className="text-xs text-muted-foreground">No corrections recorded for this invoice.</p>
                              ) : (
                                <ul className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                                  {corrections.map((c) => (
                                    <li key={c.id} className="text-[11px] bg-card border border-border rounded p-2">
                                      <div className="flex items-center justify-between mb-0.5">
                                        <span className="font-medium">{c.field_corrected || "field"}</span>
                                        <span className="text-muted-foreground">{c.correction_reason || "unspecified"}</span>
                                      </div>
                                      <div className="flex items-center gap-1.5 text-muted-foreground">
                                        <span className="line-through">{c.original_value || "—"}</span>
                                        <ChevronRight className="w-3 h-3" />
                                        <span className="text-foreground">{c.corrected_value || "—"}</span>
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </section>
                            <section>
                              <h4 className="text-xs font-semibold mb-2">Column map</h4>
                              {!r.column_map || Object.keys(r.column_map).length === 0 ? (
                                <p className="text-xs text-muted-foreground">No column map saved.</p>
                              ) : (
                                <ul className="space-y-1 text-[11px] bg-card border border-border rounded p-2 max-h-64 overflow-y-auto">
                                  {Object.entries(r.column_map).map(([k, v]) => (
                                    <li key={k} className="flex items-center justify-between gap-2">
                                      <span className="text-muted-foreground truncate">{k}</span>
                                      <ChevronRight className="w-3 h-3 text-muted-foreground" />
                                      <span className="font-medium truncate">{String(v)}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
                                <div>Format: <span className="text-foreground">{r.format_type || "—"}</span></div>
                                <div>Rows added: <span className="text-foreground">{r.rows_added ?? 0}</span></div>
                                <div>Rows deleted: <span className="text-foreground">{r.rows_deleted ?? 0}</span></div>
                                <div>Pattern uses: <span className="text-foreground">{r.invoice_count}</span></div>
                              </div>
                            </section>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-[10px] text-muted-foreground mt-3">
        Sourced from learned invoice patterns. Quality is derived from the number of edits made during review.
      </p>
    </div>
  );
};

export default ProcessingHistoryPanel;
