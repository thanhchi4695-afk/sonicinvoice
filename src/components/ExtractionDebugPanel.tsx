import { useState } from "react";
import { ChevronDown, ChevronRight, Bug } from "lucide-react";

export interface ExtractionDebugInfo {
  extractor_used?: string | null;
  tables_found?: number | null;
  azure_ms?: number | null;
  classification_source?: string | null;
  raw_tables?: Array<{
    table_index: number;
    row_count: number;
    column_count: number;
    grid?: string[][];
  }>;
  cache_creation_tokens?: number | null;
  cache_read_tokens?: number | null;
  // Claude-PDF only
  supplier?: string | null;
  attempts?: number | null;
  grader_score?: number | null;
  grader_passed?: boolean | null;
  grader_summary?: string | null;
}

interface Props {
  info: ExtractionDebugInfo | null;
}

function graderDot(score: number | null | undefined): string {
  if (score == null) return "⚪";
  if (score >= 90) return "🟢";
  if (score >= 70) return "🟡";
  return "🔴";
}

export default function ExtractionDebugPanel({ info }: Props) {
  const [open, setOpen] = useState(false);
  // Render whenever an extractor has been selected — not only when Azure tables exist.
  if (!info?.extractor_used) return null;

  const azureUsed = info.extractor_used === "azure_layout+llm";
  const claudePdfUsed = info.extractor_used === "claude-pdf";

  const cacheBadge =
    (info.cache_read_tokens ?? 0) > 0 ? (
      <span className="rounded px-1.5 py-0.5 text-xs bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
        cache: HIT ({info.cache_read_tokens!.toLocaleString()} tokens saved)
      </span>
    ) : (info.cache_creation_tokens ?? 0) > 0 ? (
      <span className="rounded px-1.5 py-0.5 text-xs bg-sky-500/20 text-sky-600 dark:text-sky-400">
        cache: MISS ({info.cache_creation_tokens!.toLocaleString()} tokens cached)
      </span>
    ) : claudePdfUsed ? (
      <span className="rounded px-1.5 py-0.5 text-xs bg-muted text-muted-foreground">
        cache: n/a
      </span>
    ) : null;

  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/30 text-sm font-mono">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 hover:bg-muted/50 transition"
      >
        <span className="flex flex-wrap items-center gap-2">
          <Bug className="h-4 w-4 text-muted-foreground" />
          <span className="font-semibold">Extraction debug</span>
          <span
            className={`rounded px-1.5 py-0.5 text-xs ${
              azureUsed
                ? "bg-primary/20 text-primary"
                : claudePdfUsed
                  ? "bg-violet-500/20 text-violet-600 dark:text-violet-400"
                  : "bg-amber-500/20 text-amber-600 dark:text-amber-400"
            }`}
          >
            {info.extractor_used}
          </span>
          {azureUsed && typeof info.tables_found === "number" && (
            <span className="text-xs text-muted-foreground">tables: {info.tables_found}</span>
          )}
          {azureUsed && typeof info.azure_ms === "number" && (
            <span className="text-xs text-muted-foreground">azure: {info.azure_ms}ms</span>
          )}
          {info.classification_source && (
            <span className="text-xs text-muted-foreground">cls: {info.classification_source}</span>
          )}
          {claudePdfUsed && info.supplier && (
            <span className="text-xs text-muted-foreground">supplier: {info.supplier}</span>
          )}
          {claudePdfUsed && typeof info.grader_score === "number" && (
            <span className="text-xs text-muted-foreground">
              grader: {graderDot(info.grader_score)} {info.grader_score}/100
            </span>
          )}
          {claudePdfUsed && (info.attempts ?? 0) > 0 && (
            <span className="text-xs text-muted-foreground">attempts: {info.attempts}</span>
          )}
          {cacheBadge}
        </span>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>

      {open && (
        <div className="border-t border-border p-3 space-y-3 max-h-[400px] overflow-auto text-xs">
          {claudePdfUsed && (
            <div className="space-y-1">
              <Row label="Extractor" value="claude-pdf" />
              {typeof info.grader_score === "number" && (
                <Row
                  label="Grader"
                  value={`${graderDot(info.grader_score)} ${info.grader_score}/100 — ${
                    info.grader_summary ?? (info.grader_passed ? "passed" : "review needed")
                  }`}
                />
              )}
              <Row
                label="Cache"
                value={
                  (info.cache_read_tokens ?? 0) > 0
                    ? `HIT (${info.cache_read_tokens!.toLocaleString()} tokens saved)`
                    : (info.cache_creation_tokens ?? 0) > 0
                      ? `MISS (${info.cache_creation_tokens!.toLocaleString()} tokens cached)`
                      : "n/a"
                }
              />
              {info.supplier && (
                <Row
                  label="Supplier"
                  value={`${info.supplier}${info.classification_source ? ` (cls: ${info.classification_source})` : ""}`}
                />
              )}
              <Row label="Attempts" value={String(info.attempts ?? 1)} />
            </div>
          )}

          {azureUsed && (
            <>
              <div className="space-y-1">
                <Row label="Extractor" value="azure_layout+llm" />
                {typeof info.tables_found === "number" && (
                  <Row label="Tables found" value={String(info.tables_found)} />
                )}
                {info.classification_source && (
                  <Row label="cls" value={info.classification_source} />
                )}
              </div>
              {!info.raw_tables?.length && (
                <p className="text-muted-foreground">
                  No raw table data captured. (Azure returned no tables.)
                </p>
              )}
              {info.raw_tables?.slice(0, 3).map((t) => {
                const previewRows = (t.grid ?? []).slice(0, 6);
                return (
                  <div key={t.table_index}>
                    <div className="text-muted-foreground mb-1">
                      Table #{t.table_index} · {t.row_count} rows × {t.column_count} cols
                      {previewRows.length < t.row_count && (
                        <span> (showing first {previewRows.length})</span>
                      )}
                    </div>
                    <div className="overflow-x-auto rounded border border-border">
                      <table className="w-full border-collapse">
                        <tbody>
                          {previewRows.map((row, ri) => (
                            <tr key={ri} className={ri === 0 ? "bg-muted/50 font-semibold" : ""}>
                              {row.slice(0, 12).map((cell, ci) => (
                                <td
                                  key={ci}
                                  className="border border-border px-1.5 py-1 align-top whitespace-nowrap max-w-[140px] truncate"
                                  title={cell}
                                >
                                  {cell || <span className="text-muted-foreground">·</span>}
                                </td>
                              ))}
                              {row.length > 12 && (
                                <td className="px-1.5 py-1 text-muted-foreground">
                                  +{row.length - 12} more
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
              {(info.raw_tables?.length ?? 0) > 3 && (
                <p className="text-muted-foreground">
                  +{(info.raw_tables!.length - 3)} more table(s) not shown.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground w-24 shrink-0">{label}:</span>
      <span>{value}</span>
    </div>
  );
}
