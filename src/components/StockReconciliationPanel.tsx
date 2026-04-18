import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Package,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { ReconciliationLine, MatchType } from "@/lib/stock-matcher";

export interface ExportSets {
  newProducts: ReconciliationLine[];
  refills: ReconciliationLine[];
  newVariants: ReconciliationLine[];
  all: ReconciliationLine[];
}

export interface ReconciliationResult {
  session_id: string;
  summary: {
    total: number;
    new_products: number;
    exact_refills: number;
    new_variants: number;
    new_colours: number;
    conflicts: number;
  };
  lines: ReconciliationLine[];
  catalog_freshness: "live" | "cached" | "refreshed";
  platform_connected: boolean;
  platform?: "shopify" | "lightspeed" | "both";
  catalog_meta?: {
    products: number;
    variants: number;
    last_synced_at?: string | null;
  };
}

interface Props {
  reconciliationResult: ReconciliationResult;
  invoiceLines?: unknown[];
  onBack: () => void;
  onExport: (exportSets: ExportSets) => void;
  onRefreshCatalog?: () => Promise<void> | void;
}

type GroupKey = "new" | "refill" | "variant" | "review";

const GROUP_META: Record<
  GroupKey,
  { label: string; border: string; badge: string; tone: string }
> = {
  new: {
    label: "New products",
    border: "border-l-emerald-500",
    badge: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
    tone: "text-emerald-600",
  },
  refill: {
    label: "Exact refills",
    border: "border-l-blue-500",
    badge: "bg-blue-500/15 text-blue-600 border-blue-500/30",
    tone: "text-blue-600",
  },
  variant: {
    label: "New variants",
    border: "border-l-amber-500",
    badge: "bg-amber-500/15 text-amber-600 border-amber-500/30",
    tone: "text-amber-600",
  },
  review: {
    label: "Needs review",
    border: "border-l-destructive",
    badge: "bg-destructive/15 text-destructive border-destructive/30",
    tone: "text-destructive",
  },
};

function classifyGroup(line: ReconciliationLine): GroupKey {
  if (line.match_type.endsWith("_conflict")) return "review";
  if (line.match_type === "new") return "new";
  if (line.match_type === "exact_refill") return "refill";
  return "variant";
}

function matchBadgeLabel(t: MatchType): string {
  if (t.endsWith("_conflict")) return "Review";
  if (t === "new") return "New";
  if (t === "exact_refill") return "Refill";
  if (t === "new_variant") return "New size";
  if (t === "new_colour") return "New colour";
  return t;
}

function formatRelative(iso?: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

export function StockReconciliationPanel({
  reconciliationResult,
  onBack,
  onExport,
  onRefreshCatalog,
}: Props) {
  const { lines, summary, platform, platform_connected, catalog_meta, catalog_freshness } =
    reconciliationResult;

  const [selected, setSelected] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(lines.map((_, i) => [i, true])),
  );
  const [conflictDecisions, setConflictDecisions] = useState<Record<number, "new" | "old">>(
    {},
  );
  const [openGroups, setOpenGroups] = useState<Record<GroupKey, boolean>>({
    new: true,
    refill: true,
    variant: true,
    review: true,
  });
  const [refreshing, setRefreshing] = useState(false);

  const grouped = useMemo(() => {
    const g: Record<GroupKey, { line: ReconciliationLine; idx: number }[]> = {
      new: [],
      refill: [],
      variant: [],
      review: [],
    };
    lines.forEach((line, idx) => {
      g[classifyGroup(line)].push({ line, idx });
    });
    return g;
  }, [lines]);

  const counts = {
    new: grouped.new.length,
    refill: grouped.refill.length,
    variant: grouped.variant.length,
    review: grouped.review.length,
  };

  const selectedLines = useMemo(
    () => lines.filter((_, i) => selected[i]),
    [lines, selected],
  );

  const exportSets: ExportSets = useMemo(() => {
    const newProducts = selectedLines.filter((l) => l.match_type === "new");
    const refills = selectedLines.filter(
      (l) => l.match_type === "exact_refill" || l.match_type === "exact_refill_conflict",
    );
    const newVariants = selectedLines.filter(
      (l) =>
        l.match_type === "new_variant" ||
        l.match_type === "new_colour" ||
        l.match_type === "new_variant_conflict" ||
        l.match_type === "new_colour_conflict",
    );
    return { newProducts, refills, newVariants, all: selectedLines };
  }, [selectedLines]);

  const handleRefresh = async () => {
    if (!onRefreshCatalog) return;
    setRefreshing(true);
    try {
      await onRefreshCatalog();
    } finally {
      setRefreshing(false);
    }
  };

  const platformLabel =
    platform === "lightspeed"
      ? "Lightspeed"
      : platform === "both"
      ? "Shopify + Lightspeed"
      : "Shopify";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <h2 className="text-lg font-semibold">Stock Reconciliation</h2>
        <div className="w-16" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="New products"
          value={counts.new}
          accent="text-emerald-600"
          ring="ring-emerald-500/30"
        />
        <StatCard
          label="Exact refills"
          value={counts.refill}
          accent="text-blue-600"
          ring="ring-blue-500/30"
        />
        <StatCard
          label="New variants / colours"
          value={counts.variant}
          accent="text-amber-600"
          ring="ring-amber-500/30"
        />
        <StatCard
          label="Needs review"
          value={counts.review}
          accent="text-destructive"
          ring="ring-destructive/30"
        />
      </div>

      <Card className="p-3 flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Package className="w-4 h-4" />
          {platform_connected ? (
            <span>
              Checked against <span className="font-medium text-foreground">{platformLabel}</span>
              {catalog_meta?.products != null && (
                <>
                  {" · "}
                  <span className="text-foreground">
                    {catalog_meta.products.toLocaleString()}
                  </span>{" "}
                  products
                </>
              )}
              {catalog_meta?.variants != null && (
                <>
                  {" · "}
                  <span className="text-foreground">
                    {catalog_meta.variants.toLocaleString()}
                  </span>{" "}
                  variants
                </>
              )}
              {" · Synced "}
              <span className="text-foreground">
                {formatRelative(catalog_meta?.last_synced_at)}
              </span>
              {catalog_freshness === "refreshed" && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  Just refreshed
                </Badge>
              )}
            </span>
          ) : (
            <span>No platform connected — matching ran on local data only.</span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing || !onRefreshCatalog}
        >
          <RefreshCw className={cn("w-4 h-4 mr-1", refreshing && "animate-spin")} />
          {refreshing ? "Refreshing…" : "Refresh catalog"}
        </Button>
      </Card>

      <div className="space-y-3">
        {(["new", "refill", "variant", "review"] as GroupKey[]).map((key) => {
          const meta = GROUP_META[key];
          const rows = grouped[key];
          if (rows.length === 0) return null;
          const isOpen = openGroups[key];
          return (
            <Card key={key} className={cn("border-l-4 overflow-hidden", meta.border)}>
              <button
                type="button"
                onClick={() =>
                  setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }))
                }
                className="w-full flex items-center gap-2 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
              >
                {isOpen ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
                <span className={cn("font-semibold", meta.tone)}>{meta.label}</span>
                <span className="text-sm text-muted-foreground">({rows.length})</span>
              </button>
              {isOpen && (
                <div className="divide-y divide-border">
                  {rows.map(({ line, idx }) => (
                    <LineRow
                      key={idx}
                      line={line}
                      checked={!!selected[idx]}
                      onToggle={(v) =>
                        setSelected((prev) => ({ ...prev, [idx]: v }))
                      }
                      decision={conflictDecisions[idx]}
                      onDecision={(d) =>
                        setConflictDecisions((prev) => ({ ...prev, [idx]: d }))
                      }
                      groupBadge={meta.badge}
                    />
                  ))}
                </div>
              )}
            </Card>
          );
        })}

        {lines.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">
            No invoice lines to reconcile.
          </Card>
        )}
      </div>

      <Card className="p-4">
        <div className="text-sm font-medium mb-3">Export</div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
          <Button
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={exportSets.newProducts.length === 0}
            onClick={() => onExport(exportSets)}
          >
            Export {exportSets.newProducts.length} new products
          </Button>
          <Button
            className="bg-blue-600 hover:bg-blue-700 text-white"
            disabled={exportSets.refills.length === 0}
            onClick={() =>
              onExport({
                ...exportSets,
                newProducts: [],
                newVariants: [],
                all: exportSets.refills,
              })
            }
          >
            Export {exportSets.refills.length} stock updates
          </Button>
          <Button
            className="bg-amber-600 hover:bg-amber-700 text-white"
            disabled={exportSets.newVariants.length === 0}
            onClick={() =>
              onExport({
                ...exportSets,
                newProducts: [],
                refills: [],
                all: exportSets.newVariants,
              })
            }
          >
            Export {exportSets.newVariants.length} new variants
          </Button>
          <Button
            variant="secondary"
            disabled={exportSets.all.length === 0}
            onClick={() => onExport(exportSets)}
          >
            Export all ({exportSets.all.length})
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Unticked rows are excluded from every export. Summary totals always reflect all
          lines.
        </p>
      </Card>

      <div className="text-xs text-muted-foreground text-center">
        Session {reconciliationResult.session_id.slice(0, 8)} ·{" "}
        {summary.total} line{summary.total === 1 ? "" : "s"} ·{" "}
        {summary.conflicts} conflict{summary.conflicts === 1 ? "" : "s"}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
  ring,
}: {
  label: string;
  value: number;
  accent: string;
  ring: string;
}) {
  return (
    <Card className={cn("p-4 ring-1", ring)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-2xl font-bold mt-1", accent)}>{value}</div>
    </Card>
  );
}

function LineRow({
  line,
  checked,
  onToggle,
  decision,
  onDecision,
  groupBadge,
}: {
  line: ReconciliationLine;
  checked: boolean;
  onToggle: (v: boolean) => void;
  decision?: "new" | "old";
  onDecision: (d: "new" | "old") => void;
  groupBadge: string;
}) {
  const isConflict = line.match_type.endsWith("_conflict");
  const isRefill = line.match_type.startsWith("exact_refill");
  const isNewVariant =
    line.match_type.startsWith("new_variant") || line.match_type.startsWith("new_colour");

  const afterQty =
    isRefill && line.matched_current_qty != null
      ? line.matched_current_qty + line.invoice_qty
      : null;

  const matchedProductLabel =
    line.matched_product_id ? `Product #${line.matched_product_id.slice(-6)}` : null;

  return (
    <div className="px-4 py-3 hover:bg-muted/30">
      <div className="flex items-start gap-3">
        <Checkbox
          checked={checked}
          onCheckedChange={(v) => onToggle(v === true)}
          className="mt-1"
        />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="font-medium truncate">
              {line.invoice_product_name || line.invoice_sku || "Unnamed line"}
            </span>
            <Badge variant="outline" className={cn("text-xs", groupBadge)}>
              {matchBadgeLabel(line.match_type)}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
            {line.invoice_sku && <span>SKU: {line.invoice_sku}</span>}
            {line.invoice_colour && <span>Colour: {line.invoice_colour}</span>}
            {line.invoice_size && <span>Size: {line.invoice_size}</span>}
            <span>Qty: {line.invoice_qty}</span>
            {line.invoice_cost != null && (
              <span>Cost: ${line.invoice_cost.toFixed(2)}</span>
            )}
          </div>

          {isRefill && line.matched_current_qty != null && afterQty != null && (
            <div className="mt-2 text-xs">
              <span className="text-muted-foreground">Current stock: </span>
              <span className="font-medium">{line.matched_current_qty}</span>
              <span className="text-muted-foreground"> → After import: </span>
              <span className="font-medium text-blue-600">{afterQty}</span>
            </div>
          )}

          {isNewVariant && matchedProductLabel && (
            <div className="mt-2 text-xs flex items-center gap-1 text-muted-foreground">
              <span>Adding to:</span>
              <span className="font-medium text-foreground">{matchedProductLabel}</span>
              <ExternalLink className="w-3 h-3" />
            </div>
          )}

          {isConflict && line.conflict_reason && (
            <div className="mt-2 space-y-2">
              <div className="text-xs text-amber-600">{line.conflict_reason}</div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={decision === "new" ? "default" : "outline"}
                  onClick={() => onDecision("new")}
                  className="h-7 text-xs"
                >
                  Accept new cost
                </Button>
                <Button
                  size="sm"
                  variant={decision === "old" ? "default" : "outline"}
                  onClick={() => onDecision("old")}
                  className="h-7 text-xs"
                >
                  Keep old cost
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
