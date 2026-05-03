import { useEffect, useState } from "react";
import { ArrowLeft, FileText, Loader2, Play, Eye, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/audit-log";

interface Props {
  patternId: string;
  onBack: () => void;
  onResume: () => void;
  onOpenHistory: (patternId: string) => void;
}

interface PatternRow {
  id: string;
  created_at: string;
  original_filename: string | null;
  original_file_path: string | null;
  original_file_mime: string | null;
  supplier_profile_id: string | null;
  review_status: string | null;
  variants_extracted: number | null;
  edit_count: number | null;
  rows_seen: number | null;
  processing_duration_seconds: number | null;
  processing_quality_score: number | null;
  match_method: string | null;
  format_type: string | null;
  exported_at: string | null;
  fields_corrected: string[] | null;
}

interface DocumentRow {
  id: string;
  document_number: string | null;
  date: string | null;
  total: number;
  currency: string;
  status: string;
  source_filename: string | null;
  supplier_name: string | null;
}

interface LineRow {
  id: string;
  product_title: string | null;
  sku: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  unit_cost: number;
  total_cost: number;
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  reviewed: { label: "Done", cls: "bg-success/15 text-success border-success/20" },
  needs_review: { label: "Needs review", cls: "bg-warning/15 text-warning border-warning/20" },
  draft: { label: "Draft", cls: "bg-muted text-muted-foreground border-border" },
  failed: { label: "Failed", cls: "bg-destructive/15 text-destructive border-destructive/20" },
};

const InvoiceDetailScreen = ({ patternId, onBack, onResume, onOpenHistory }: Props) => {
  const [loading, setLoading] = useState(true);
  const [pattern, setPattern] = useState<PatternRow | null>(null);
  const [supplierName, setSupplierName] = useState<string>("");
  const [doc, setDoc] = useState<DocumentRow | null>(null);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const { data: p } = await supabase
        .from("invoice_patterns")
        .select("id, created_at, original_filename, original_file_path, original_file_mime, supplier_profile_id, review_status, variants_extracted, edit_count, rows_seen, processing_duration_seconds, processing_quality_score, match_method, format_type, exported_at, fields_corrected")
        .eq("id", patternId)
        .maybeSingle();
      if (!active || !p) { setLoading(false); return; }
      setPattern(p as PatternRow);

      // Supplier name
      if (p.supplier_profile_id) {
        const { data: sp } = await supabase
          .from("supplier_profiles")
          .select("supplier_name")
          .eq("id", p.supplier_profile_id)
          .maybeSingle();
        if (sp?.supplier_name) setSupplierName(sp.supplier_name as string);
      }

      // Try to locate a matching document by source_filename (best-effort)
      if (p.original_filename) {
        const { data: docs } = await supabase
          .from("documents")
          .select("id, document_number, date, total, currency, status, source_filename, supplier_name")
          .eq("source_filename", p.original_filename)
          .order("created_at", { ascending: false })
          .limit(1);
        if (docs && docs.length > 0) {
          const d = docs[0] as DocumentRow;
          setDoc(d);
          const { data: ln } = await supabase
            .from("document_lines")
            .select("id, product_title, sku, color, size, quantity, unit_cost, total_cost")
            .eq("document_id", d.id)
            .order("created_at", { ascending: true })
            .limit(500);
          setLines((ln ?? []) as LineRow[]);
        }
      }

      // Signed URL for the original file (if stored)
      if (p.original_file_path) {
        const { data: signed } = await supabase
          .storage
          .from("invoice-originals")
          .createSignedUrl(p.original_file_path, 60 * 10);
        if (signed?.signedUrl) setSignedUrl(signed.signedUrl);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [patternId]);

  if (loading) {
    return (
      <div className="px-4 py-12 max-w-4xl mx-auto text-center text-sm text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Loading invoice…
      </div>
    );
  }

  if (!pattern) {
    return (
      <div className="px-4 py-12 max-w-4xl mx-auto text-center">
        <p className="text-sm text-muted-foreground mb-4">This invoice could not be found.</p>
        <Button onClick={onBack} variant="outline" size="sm">Back to invoices</Button>
      </div>
    );
  }

  const statusKey = (pattern.review_status ?? "draft");
  const status = STATUS_BADGE[statusKey] ?? STATUS_BADGE.draft;
  const isDraft = statusKey === "draft" || statusKey === "needs_review";

  const fmtMoney = (n: number, ccy = doc?.currency || "AUD") =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: ccy }).format(n);

  return (
    <div className="px-4 py-6 sm:py-8 max-w-5xl mx-auto">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back to invoices
      </button>

      {/* Header */}
      <header className="flex items-start gap-4 mb-6">
        <div className="w-12 h-12 rounded-md bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shrink-0">
          <FileText className="w-6 h-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold font-display truncate">
              {supplierName || "Unknown vendor"}
            </h1>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${status.cls}`}>{status.label}</span>
          </div>
          <p className="text-xs text-muted-foreground font-mono-data truncate">
            {pattern.original_filename ?? "—"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {formatRelativeTime(pattern.created_at)}
            {pattern.processing_duration_seconds ? ` · processed in ${pattern.processing_duration_seconds}s` : ""}
            {pattern.match_method ? ` · ${pattern.match_method}` : ""}
          </p>
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          <Button size="sm" variant={isDraft ? "default" : "outline"} onClick={onResume}>
            {isDraft ? <><Play className="w-3.5 h-3.5 mr-1.5" /> Resume</> : <><Eye className="w-3.5 h-3.5 mr-1.5" /> Open in flow</>}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onOpenHistory(pattern.id)}>
            View history
          </Button>
        </div>
      </header>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Stat label="Lines extracted" value={String(pattern.variants_extracted ?? lines.length ?? 0)} />
        <Stat label="Rows seen" value={String(pattern.rows_seen ?? "—")} />
        <Stat label="User edits" value={String(pattern.edit_count ?? 0)} />
        <Stat
          label="Quality score"
          value={pattern.processing_quality_score != null ? `${pattern.processing_quality_score}%` : "—"}
        />
      </div>

      {/* Document summary */}
      {doc && (
        <section className="rounded-lg border border-border bg-card p-4 mb-6">
          <h2 className="text-sm font-semibold mb-3">Invoice document</h2>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <Field label="Number" value={doc.document_number || "—"} />
            <Field label="Date" value={doc.date || "—"} />
            <Field label="Status" value={doc.status} />
            <Field label="Total" value={fmtMoney(doc.total)} />
          </dl>
        </section>
      )}

      {/* Lines */}
      {lines.length > 0 && (
        <section className="rounded-lg border border-border bg-card overflow-hidden mb-6">
          <header className="px-3 py-2 border-b border-border bg-muted/20">
            <h2 className="text-sm font-semibold">Line items ({lines.length})</h2>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono-data">
              <thead className="text-[10px] uppercase text-muted-foreground bg-muted/10">
                <tr>
                  <th className="text-left px-3 py-2">Product</th>
                  <th className="text-left px-3 py-2">SKU</th>
                  <th className="text-left px-3 py-2">Colour</th>
                  <th className="text-left px-3 py-2">Size</th>
                  <th className="text-right px-3 py-2">Qty</th>
                  <th className="text-right px-3 py-2">Unit</th>
                  <th className="text-right px-3 py-2">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.map((l, i) => (
                  <tr key={l.id} className={i % 2 ? "bg-muted/10" : ""} style={{ height: 32 }}>
                    <td className="px-3 truncate max-w-[220px]">{l.product_title || "—"}</td>
                    <td className="px-3 text-muted-foreground">{l.sku || "—"}</td>
                    <td className="px-3">{l.color || "—"}</td>
                    <td className="px-3">{l.size || "—"}</td>
                    <td className="px-3 text-right">{l.quantity}</td>
                    <td className="px-3 text-right">{fmtMoney(Number(l.unit_cost))}</td>
                    <td className="px-3 text-right">{fmtMoney(Number(l.total_cost))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!doc && (
        <p className="text-xs text-muted-foreground mb-6">
          No matching document record found. The structured line items may not have been
          persisted yet — click <strong>Resume</strong> to finish processing this invoice.
        </p>
      )}

      {/* Original file */}
      {signedUrl && (
        <a
          href={signedUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Open original file
        </a>
      )}
    </div>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md border border-border bg-card p-3">
    <div className="text-[10px] uppercase text-muted-foreground tracking-wide">{label}</div>
    <div className="text-lg font-semibold font-display mt-0.5">{value}</div>
  </div>
);

const Field = ({ label, value }: { label: string; value: string }) => (
  <div>
    <dt className="text-[10px] uppercase text-muted-foreground tracking-wide">{label}</dt>
    <dd className="font-medium mt-0.5">{value}</dd>
  </div>
);

export default InvoiceDetailScreen;
