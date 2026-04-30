import { useState } from "react";
import { ShieldCheck, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  applyRecommendedPriceChanges,
  type RecommendedPriceChange,
  type ApplyProgress,
  type ApplyResult,
} from "@/lib/shopify/priceManager";

export interface ApplyDiscountsModalProps {
  open: boolean;
  onClose: () => void;
  changes: RecommendedPriceChange[];
  /** Called after a successful apply so the parent can refresh state. */
  onApplied?: (results: ApplyResult[]) => void;
}

export function ApplyDiscountsModal({
  open,
  onClose,
  changes,
  onApplied,
}: ApplyDiscountsModalProps) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ApplyProgress | null>(null);
  const [results, setResults] = useState<ApplyResult[] | null>(null);

  const totalImpactPerUnit = changes.reduce(
    (sum, c) => sum + (c.newPrice - c.originalPrice),
    0,
  );

  function close() {
    if (running) return;
    setProgress(null);
    setResults(null);
    onClose();
  }

  async function confirm() {
    setRunning(true);
    setResults(null);
    try {
      const res = await applyRecommendedPriceChanges(changes, setProgress);
      setResults(res);
      const okCount = res.filter((r) => r.ok).length;
      const failCount = res.length - okCount;
      if (failCount === 0) {
        toast.success(`Applied ${okCount} price update${okCount === 1 ? "" : "s"} to Shopify.`);
      } else {
        toast.warning(`Applied ${okCount}, ${failCount} failed. See modal for details.`);
      }
      onApplied?.(res);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to apply prices");
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Apply AI-recommended prices
          </DialogTitle>
          <DialogDescription>
            We'll push these new prices to Shopify with{" "}
            <code className="text-xs">productVariantsBulkUpdate</code>. The
            previous price becomes <code className="text-xs">compareAtPrice</code>{" "}
            so on-sale badges show up. All prices respect your margin floor.
          </DialogDescription>
        </DialogHeader>

        {/* Summary bar */}
        <div className="grid grid-cols-3 gap-3 py-2">
          <SummaryStat label="Products" value={String(changes.length)} />
          <SummaryStat
            label="Per-unit impact"
            value={`${totalImpactPerUnit >= 0 ? "+" : ""}$${totalImpactPerUnit.toFixed(2)}`}
            tone={totalImpactPerUnit < 0 ? "warn" : "ok"}
          />
          <SummaryStat
            label="Status"
            value={running ? "Applying…" : results ? "Done" : "Ready"}
          />
        </div>

        <ScrollArea className="h-[280px] rounded border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Product</th>
                <th className="text-right px-3 py-2 font-medium">From</th>
                <th className="text-right px-3 py-2 font-medium">To</th>
                <th className="text-right px-3 py-2 font-medium">Off</th>
                <th className="text-center px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {changes.map((c) => {
                const result = results?.find((r) => r.productId === c.productId);
                return (
                  <tr key={c.productId} className="border-t border-border">
                    <td className="px-3 py-2 font-sans truncate max-w-[260px]">
                      {c.title}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground line-through">
                      ${c.originalPrice.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">
                      ${c.newPrice.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {c.discountPercentage != null
                        ? `${c.discountPercentage.toFixed(1)}%`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {result ? (
                        result.ok ? (
                          <CheckCircle2 className="h-4 w-4 text-primary inline" />
                        ) : (
                          <span title={result.error}>
                            <AlertTriangle className="h-4 w-4 text-destructive inline" />
                          </span>
                        )
                      ) : running &&
                        progress &&
                        changes[progress.index]?.productId === c.productId ? (
                        <Loader2 className="h-4 w-4 animate-spin inline" />
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          pending
                        </Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollArea>

        {running && progress && (
          <div className="text-xs text-muted-foreground">
            Updating {progress.index + 1} / {progress.total}
            {progress.currentTitle ? ` · ${progress.currentTitle}` : ""}
          </div>
        )}

        {results && (
          <div className="text-xs text-muted-foreground">
            ✓ {results.filter((r) => r.ok).length} updated · ✗{" "}
            {results.filter((r) => !r.ok).length} failed
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={running}>
            {results ? "Close" : "Cancel"}
          </Button>
          {!results && (
            <Button onClick={confirm} disabled={running || changes.length === 0}>
              {running ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Applying…
                </>
              ) : (
                <>Confirm & apply to Shopify</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn";
}) {
  const toneClass =
    tone === "warn"
      ? "text-amber-500"
      : tone === "ok"
        ? "text-primary"
        : "text-foreground";
  return (
    <div className="rounded border border-border p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`text-lg font-mono font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}
