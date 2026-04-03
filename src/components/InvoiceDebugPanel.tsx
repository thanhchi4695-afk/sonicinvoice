import { useState } from "react";
import { Bug, ChevronDown, ChevronRight, Check, X, ArrowRight } from "lucide-react";
import type { ValidationDebugInfo, ValidatedProduct } from "@/lib/invoice-validator";

interface InvoiceDebugPanelProps {
  debug: ValidationDebugInfo;
  products: ValidatedProduct[];
}

export default function InvoiceDebugPanel({ debug, products }: InvoiceDebugPanelProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"summary" | "rejected" | "corrections" | "all">("summary");

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted/50 transition-colors"
      >
        <Bug className="w-3.5 h-3.5" />
        Debug View
        {open ? <ChevronDown className="w-3 h-3 ml-auto" /> : <ChevronRight className="w-3 h-3 ml-auto" />}
        <span className="ml-1 text-[10px] font-normal">
          {debug.accepted} accepted · {debug.rejected} rejected · {debug.corrections.length} corrections
        </span>
      </button>

      {open && (
        <div className="border-t border-border">
          {/* Tabs */}
          <div className="flex gap-1 p-2 bg-muted/30">
            {(["summary", "rejected", "corrections", "all"] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${
                  tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {t === "summary" ? "Summary" : t === "rejected" ? `Rejected (${debug.rejected})` : t === "corrections" ? `Fixes (${debug.corrections.length})` : `All rows (${debug.totalRaw})`}
              </button>
            ))}
          </div>

          <div className="p-3 max-h-64 overflow-y-auto text-[10px]">
            {tab === "summary" && (
              <div className="space-y-1.5">
                <Row label="Total raw rows" value={String(debug.totalRaw)} />
                <Row label="Accepted products" value={String(debug.accepted)} good />
                <Row label="Rejected rows" value={String(debug.rejected)} bad={debug.rejected > 0} />
                <Row label="Auto-corrections" value={String(debug.corrections.length)} />
                <Row label="Detected vendor" value={debug.detectedVendor} />
              </div>
            )}

            {tab === "rejected" && (
              <div className="space-y-1">
                {debug.rejectedRows.length === 0 && <p className="text-muted-foreground">No rejected rows</p>}
                {debug.rejectedRows.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 py-1 border-b border-border/50 last:border-0">
                    <X className="w-3 h-3 text-destructive mt-0.5 shrink-0" />
                    <div>
                      <span className="font-mono text-muted-foreground">Row {r.row + 1}:</span>{" "}
                      <span className="font-medium">"{r.name}"</span>
                      <p className="text-muted-foreground">{r.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === "corrections" && (
              <div className="space-y-1">
                {debug.corrections.length === 0 && <p className="text-muted-foreground">No corrections applied</p>}
                {debug.corrections.map((c, i) => (
                  <div key={i} className="flex items-center gap-1.5 py-1 border-b border-border/50 last:border-0">
                    <span className="font-mono text-muted-foreground">Row {c.row + 1}</span>
                    <span className="font-medium">{c.field}:</span>
                    <span className="text-destructive line-through">{c.from || "(empty)"}</span>
                    <ArrowRight className="w-3 h-3 text-muted-foreground" />
                    <span className="text-success">{c.to}</span>
                  </div>
                ))}
              </div>
            )}

            {tab === "all" && (
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-1 pr-2">#</th>
                    <th className="py-1 pr-2">Status</th>
                    <th className="py-1 pr-2">Product</th>
                    <th className="py-1 pr-2">Price</th>
                    <th className="py-1 pr-2">Vendor</th>
                    <th className="py-1">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p, i) => (
                    <tr key={i} className={`border-b border-border/30 ${p._rejected ? "opacity-40 line-through" : ""}`}>
                      <td className="py-1 pr-2 font-mono text-muted-foreground">{i + 1}</td>
                      <td className="py-1 pr-2">
                        {p._rejected ? (
                          <X className="w-3 h-3 text-destructive" />
                        ) : (
                          <Check className="w-3 h-3 text-success" />
                        )}
                      </td>
                      <td className="py-1 pr-2 max-w-[150px] truncate">{p.name || "(empty)"}</td>
                      <td className="py-1 pr-2 font-mono">{p.cost > 0 ? `$${p.cost.toFixed(2)}` : "—"}</td>
                      <td className="py-1 pr-2 truncate max-w-[80px]">{p.brand}</td>
                      <td className="py-1">
                        <span className={`font-medium ${
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
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, good, bad }: { label: string; value: string; good?: boolean; bad?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium ${good ? "text-success" : bad ? "text-destructive" : ""}`}>{value}</span>
    </div>
  );
}
