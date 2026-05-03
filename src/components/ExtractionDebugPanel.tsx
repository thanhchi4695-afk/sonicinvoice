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
}

interface Props {
  info: ExtractionDebugInfo | null;
}

export default function ExtractionDebugPanel({ info }: Props) {
  const [open, setOpen] = useState(false);
  if (!info || (!info.extractor_used && !info.tables_found && !info.raw_tables?.length)) {
    return null;
  }

  const azureUsed = info.extractor_used === "azure_layout+llm";

  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/30 text-sm font-mono">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 hover:bg-muted/50 transition"
      >
        <span className="flex items-center gap-2">
          <Bug className="h-4 w-4 text-muted-foreground" />
          <span className="font-semibold">Extraction debug</span>
          <span
            className={`rounded px-1.5 py-0.5 text-xs ${
              azureUsed
                ? "bg-primary/20 text-primary"
                : "bg-amber-500/20 text-amber-600 dark:text-amber-400"
            }`}
          >
            {info.extractor_used || "unknown"}
          </span>
          {typeof info.tables_found === "number" && (
            <span className="text-xs text-muted-foreground">
              tables: {info.tables_found}
            </span>
          )}
          {typeof info.azure_ms === "number" && (
            <span className="text-xs text-muted-foreground">
              azure: {info.azure_ms}ms
            </span>
          )}
          {info.classification_source && (
            <span className="text-xs text-muted-foreground">
              cls: {info.classification_source}
            </span>
          )}
        </span>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>

      {open && (
        <div className="border-t border-border p-3 space-y-4 max-h-[400px] overflow-auto">
          {!info.raw_tables?.length && (
            <p className="text-xs text-muted-foreground">
              No raw table data captured. (Azure was not used or returned no tables.)
            </p>
          )}
          {info.raw_tables?.slice(0, 3).map((t) => {
            const previewRows = (t.grid ?? []).slice(0, 6);
            return (
              <div key={t.table_index}>
                <div className="text-xs text-muted-foreground mb-1">
                  Table #{t.table_index} · {t.row_count} rows × {t.column_count} cols
                  {previewRows.length < t.row_count && (
                    <span> (showing first {previewRows.length})</span>
                  )}
                </div>
                <div className="overflow-x-auto rounded border border-border">
                  <table className="w-full border-collapse text-xs">
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
            <p className="text-xs text-muted-foreground">
              +{(info.raw_tables!.length - 3)} more table(s) not shown.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
