import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  RefreshCcw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  ShieldCheck,
  Calculator,
  Info,
  Tag,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { ApplyDiscountsModal } from "@/components/pricing/ApplyDiscountsModal";
import type { RecommendedPriceChange } from "@/lib/shopify/priceManager";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  processAllProductsAndGenerateReport,
  type PricingReport,
  type BatchProgress,
} from "@/lib/pricing/batch-processor";
import { enforceFloor } from "@/lib/pricing/margin-protection";
import type { PricingRecommendation } from "@/lib/ai-pricing-orchestrator";

type RecRow = PricingReport["recommendations"][number];

const PHASE_BADGE: Record<string, string> = {
  launch: "bg-primary/15 text-primary border-primary/30",
  mid_life: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  clearance: "bg-destructive/15 text-destructive border-destructive/30",
};
const ACTION_BADGE: Record<string, string> = {
  HOLD: "bg-muted text-muted-foreground",
  DISCOUNT: "bg-amber-500/15 text-amber-500 border border-amber-500/30",
  DEEP_DISCOUNT: "bg-destructive/15 text-destructive border border-destructive/30",
};

const PAGE_SIZE = 25;

function fmt$(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function pct(n: number | null | undefined, decimals = 1) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(decimals)}%`;
}

export default function PricingIntelligence() {
  const [report, setReport] = useState<PricingReport | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [skipAi, setSkipAi] = useState(false);
  const [page, setPage] = useState(0);
  const [whatIfRow, setWhatIfRow] = useState<RecRow | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [applyOpen, setApplyOpen] = useState(false);

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function runReport() {
    setRunning(true);
    setProgress({ processed: 0, total: 0, currentTitle: null });
    try {
      const r = await processAllProductsAndGenerateReport({
        skipAi,
        onProgress: setProgress,
      });
      setReport(r);
      setPage(0);
      toast.success(
        `Report ready: ${r.summary.totalProducts} products analysed (${r.summary.healthyCount} healthy, ${r.summary.atRiskCount} at risk, ${r.summary.breachedCount} breached).`,
      );
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to run report");
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  // ── Kanban grouping ─────────────────────────────────────────
  const groups = useMemo(() => {
    const g = { safe: [] as RecRow[], at_risk: [] as RecRow[], breached: [] as RecRow[] };
    if (!report) return g;
    for (const r of report.recommendations) g[r.analysis.marginStatus].push(r);
    return g;
  }, [report]);

  function groupImpact(rows: RecRow[]): number {
    return +rows
      .reduce((sum, r) => {
        if (r.suggestedNewPrice == null) return sum;
        return sum + (r.suggestedNewPrice - r.analysis.currentPrice);
      }, 0)
      .toFixed(2);
  }

  // ── Pagination ─────────────────────────────────────────────
  const allRecs = report?.recommendations ?? [];
  const totalPages = Math.max(1, Math.ceil(allRecs.length / PAGE_SIZE));
  const pageRows = allRecs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1400px] p-4 lg:p-8 space-y-6">
        {/* ── Header ── */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/dashboard">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Dashboard
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight font-syne flex items-center gap-2">
                <Sparkles className="h-6 w-6 text-primary" />
                Pricing Intelligence
              </h1>
              <p className="text-sm text-muted-foreground">
                AI-powered pricing analysis with hard margin protection.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch id="skip-ai" checked={skipAi} onCheckedChange={setSkipAi} />
              <Label htmlFor="skip-ai" className="text-xs text-muted-foreground">
                Fast mode (no AI reasons)
              </Label>
            </div>
            <Button onClick={runReport} disabled={running} className="gap-2">
              <RefreshCcw className={`h-4 w-4 ${running ? "animate-spin" : ""}`} />
              {running ? "Analysing…" : "Refresh Report"}
            </Button>
          </div>
        </div>

        {/* ── Progress ── */}
        {running && progress && (
          <Card>
            <CardContent className="py-4">
              <div className="text-sm text-muted-foreground mb-2">
                {progress.processed} / {progress.total || "—"}{" "}
                {progress.currentTitle ? `· ${progress.currentTitle}` : ""}
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: progress.total
                      ? `${(progress.processed / progress.total) * 100}%`
                      : "0%",
                  }}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Empty state ── */}
        {!report && !running && (
          <Card>
            <CardContent className="py-16 text-center">
              <Sparkles className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <h3 className="text-lg font-semibold mb-1">No report yet</h3>
              <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
                Click <strong>Refresh Report</strong> to analyse your catalog. We'll group every
                product by margin health and recommend an action for each one.
              </p>
              <Button onClick={runReport}>Run analysis</Button>
            </CardContent>
          </Card>
        )}

        {/* ── Report body ── */}
        {report && (
          <>
            {/* Summary KPI bar */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard
                label="Products analysed"
                value={String(report.summary.totalProducts)}
                hint={`Generated ${new Date(report.summary.generatedAt).toLocaleString()}`}
              />
              <KpiCard
                label="Recommended actions"
                value={`${report.summary.actionCounts.DISCOUNT + report.summary.actionCounts.DEEP_DISCOUNT}`}
                hint={`${report.summary.actionCounts.HOLD} hold · ${report.summary.actionCounts.DISCOUNT} discount · ${report.summary.actionCounts.DEEP_DISCOUNT} deep discount`}
              />
              <KpiCard
                label="Estimated revenue impact"
                value={fmt$(report.summary.estimatedRevenueImpact)}
                hint="Per-unit, if every recommendation is applied"
                trend={report.summary.estimatedRevenueImpact < 0 ? "down" : "up"}
              />
              <KpiCard
                label="Margin breaches"
                value={String(report.summary.breachedCount)}
                hint="Products selling below cost + 5% fees"
                trend={report.summary.breachedCount > 0 ? "down" : "up"}
              />
            </div>

            {/* ── Charts ── */}
            <ChartsSection report={report} />

            {/* ── Kanban ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <KanbanColumn
                title="Healthy"
                tone="safe"
                icon={<ShieldCheck className="h-4 w-4" />}
                rows={groups.safe}
                impact={groupImpact(groups.safe)}
              />
              <KanbanColumn
                title="At risk"
                tone="warn"
                icon={<AlertTriangle className="h-4 w-4" />}
                rows={groups.at_risk}
                impact={groupImpact(groups.at_risk)}
              />
              <KanbanColumn
                title="Breached"
                tone="danger"
                icon={<TrendingDown className="h-4 w-4" />}
                rows={groups.breached}
                impact={groupImpact(groups.breached)}
              />
            </div>

            {/* ── Table ── */}
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle className="text-base">Detailed recommendations</CardTitle>
                <div className="flex items-center gap-2">
                  {selectedIds.size > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {selectedIds.size} selected
                    </span>
                  )}
                  {selectedIds.size > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={clearSelection}
                      className="h-8"
                    >
                      Clear
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={selectedIds.size === 0}
                    onClick={() => setApplyOpen(true)}
                    className="gap-2 h-8"
                  >
                    <Tag className="h-3.5 w-3.5" />
                    Apply Selected{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm font-mono">
                    <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="w-8 px-2 py-2">
                          <Checkbox
                            checked={
                              pageRows.filter((r) => r.suggestedNewPrice != null).length > 0 &&
                              pageRows
                                .filter((r) => r.suggestedNewPrice != null)
                                .every((r) => selectedIds.has(r.productId))
                            }
                            onCheckedChange={(checked) => {
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                const applicable = pageRows.filter(
                                  (r) => r.suggestedNewPrice != null,
                                );
                                if (checked) applicable.forEach((r) => next.add(r.productId));
                                else applicable.forEach((r) => next.delete(r.productId));
                                return next;
                              });
                            }}
                            aria-label="Select all on page"
                          />
                        </th>
                        <th className="text-left px-3 py-2 font-medium">Product</th>
                        <th className="text-left px-3 py-2 font-medium">Phase</th>
                        <th className="text-right px-3 py-2 font-medium">Days</th>
                        <th className="text-left px-3 py-2 font-medium">Margin</th>
                        <th className="text-right px-3 py-2 font-medium">Current</th>
                        <th className="text-right px-3 py-2 font-medium">Floor</th>
                        <th className="text-right px-3 py-2 font-medium">Comp avg</th>
                        <th className="text-left px-3 py-2 font-medium">Action</th>
                        <th className="text-right px-3 py-2 font-medium">New price</th>
                        <th className="text-right px-3 py-2 font-medium">Off</th>
                        <th className="text-center px-3 py-2 font-medium">Why</th>
                        <th className="text-right px-3 py-2 font-medium">Sim</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((r, idx) => (
                        <tr
                          key={r.productId}
                          className={`h-8 border-t border-border ${
                            idx % 2 === 0 ? "" : "bg-muted/20"
                          }`}
                        >
                          <td className="px-2 py-1 text-center">
                            <Checkbox
                              checked={selectedIds.has(r.productId)}
                              disabled={r.suggestedNewPrice == null}
                              onCheckedChange={() => toggleSelected(r.productId)}
                              aria-label={`Select ${r.title}`}
                            />
                          </td>
                          <td className="px-3 py-1 font-sans truncate max-w-[260px]">
                            {r.title}
                            {r.vendor && (
                              <span className="text-muted-foreground"> · {r.vendor}</span>
                            )}
                          </td>
                          <td className="px-3 py-1">
                            <Badge variant="outline" className={PHASE_BADGE[r.analysis.currentPhase]}>
                              {r.analysis.currentPhase.replace("_", "-")}
                            </Badge>
                          </td>
                          <td className="px-3 py-1 text-right">{r.analysis.daysInInventory}</td>
                          <td className="px-3 py-1">
                            <MarginBadge status={r.analysis.marginStatus} />
                          </td>
                          <td className="px-3 py-1 text-right">{fmt$(r.analysis.currentPrice)}</td>
                          <td className="px-3 py-1 text-right">{fmt$(r.analysis.floorPrice)}</td>
                          <td className="px-3 py-1 text-right">
                            {fmt$(r.analysis.competitorAveragePrice)}
                            {r.analysis.competitorPriceGap != null && (
                              <span
                                className={`ml-1 text-xs ${
                                  r.analysis.competitorPriceGap > 0
                                    ? "text-destructive"
                                    : "text-primary"
                                }`}
                              >
                                ({r.analysis.competitorPriceGap > 0 ? "+" : ""}
                                {r.analysis.competitorPriceGap.toFixed(0)}%)
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-1">
                            <span
                              className={`px-2 py-0.5 rounded text-xs ${ACTION_BADGE[r.action]}`}
                            >
                              {r.action.replace("_", " ")}
                            </span>
                          </td>
                          <td className="px-3 py-1 text-right">{fmt$(r.suggestedNewPrice)}</td>
                          <td className="px-3 py-1 text-right">
                            {pct(r.discountPercentage)}
                            {r.marginFloorEnforced && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <ShieldCheck className="inline h-3 w-3 ml-1 text-primary" />
                                </TooltipTrigger>
                                <TooltipContent>Capped at margin floor</TooltipContent>
                              </Tooltip>
                            )}
                          </td>
                          <td className="px-3 py-1 text-center">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="h-3.5 w-3.5 text-muted-foreground inline-block cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent className="max-w-sm font-sans">
                                {r.reason}
                              </TooltipContent>
                            </Tooltip>
                          </td>
                          <td className="px-3 py-1 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2"
                              onClick={() => setWhatIfRow(r)}
                            >
                              <Calculator className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {pageRows.length === 0 && (
                        <tr>
                          <td colSpan={13} className="text-center py-8 text-muted-foreground">
                            No products to show.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between p-3 border-t border-border text-xs text-muted-foreground">
                    <span>
                      Page {page + 1} of {totalPages} · {allRecs.length} total
                    </span>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={page === 0}
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                      >
                        Previous
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={page >= totalPages - 1}
                        onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {/* ── What-if simulator ── */}
        <WhatIfModal row={whatIfRow} onClose={() => setWhatIfRow(null)} />

        <ApplyDiscountsModal
          open={applyOpen}
          onClose={() => setApplyOpen(false)}
          changes={
            (report?.recommendations ?? [])
              .filter(
                (r) =>
                  selectedIds.has(r.productId) && r.suggestedNewPrice != null,
              )
              .map<RecommendedPriceChange>((r) => ({
                productId: r.productId,
                title: r.title,
                newPrice: r.suggestedNewPrice as number,
                originalPrice: r.analysis.currentPrice,
                reason: r.reason,
                discountPercentage: r.discountPercentage,
              }))
          }
          onApplied={(results) => {
            // Drop successful ones from selection
            const okIds = new Set(results.filter((r) => r.ok).map((r) => r.productId));
            setSelectedIds((prev) => {
              const next = new Set(prev);
              okIds.forEach((id) => next.delete(id));
              return next;
            });
          }}
        />
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────

function ChartsSection({ report }: { report: PricingReport }) {
  const recs = report.recommendations;

  const phaseData = useMemo(() => {
    const counts: Record<string, number> = { launch: 0, mid_life: 0, clearance: 0 };
    for (const r of recs) counts[r.analysis.currentPhase] = (counts[r.analysis.currentPhase] ?? 0) + 1;
    return [
      { name: "Launch", value: counts.launch, fill: "hsl(var(--primary))" },
      { name: "Mid-life", value: counts.mid_life, fill: "hsl(var(--chart-2, 38 92% 50%))" },
      { name: "Clearance", value: counts.clearance, fill: "hsl(var(--destructive))" },
    ];
  }, [recs]);

  const marginData = useMemo(() => {
    const counts: Record<string, number> = { safe: 0, at_risk: 0, breached: 0 };
    for (const r of recs) counts[r.analysis.marginStatus] = (counts[r.analysis.marginStatus] ?? 0) + 1;
    return [
      { status: "Safe", count: counts.safe, fill: "hsl(var(--primary))" },
      { status: "At risk", count: counts.at_risk, fill: "hsl(var(--chart-2, 38 92% 50%))" },
      { status: "Breached", count: counts.breached, fill: "hsl(var(--destructive))" },
    ];
  }, [recs]);

  const actionData = useMemo(() => {
    const c = report.summary.actionCounts;
    return [
      { action: "Hold", count: c.HOLD, fill: "hsl(var(--muted-foreground))" },
      { action: "Discount", count: c.DISCOUNT, fill: "hsl(var(--chart-2, 38 92% 50%))" },
      { action: "Deep", count: c.DEEP_DISCOUNT, fill: "hsl(var(--destructive))" },
    ];
  }, [report]);

  const chartConfig: ChartConfig = {
    value: { label: "Products" },
    count: { label: "Products" },
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Lifecycle phase</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[220px] w-full">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent hideLabel />} />
              <Pie data={phaseData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80}>
                {phaseData.map((d) => (
                  <Cell key={d.name} fill={d.fill} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
          <div className="flex justify-around text-xs mt-2">
            {phaseData.map((d) => (
              <div key={d.name} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm" style={{ background: d.fill }} />
                <span className="text-muted-foreground">{d.name}</span>
                <span className="font-mono">{d.value}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Margin health</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[220px] w-full">
            <BarChart data={marginData}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="status" tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
              <ChartTooltip content={<ChartTooltipContent hideLabel />} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {marginData.map((d) => (
                  <Cell key={d.status} fill={d.fill} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Recommended actions</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[220px] w-full">
            <BarChart data={actionData} layout="vertical">
              <CartesianGrid horizontal={false} strokeDasharray="3 3" />
              <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="action" tickLine={false} axisLine={false} width={60} />
              <ChartTooltip content={<ChartTooltipContent hideLabel />} />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {actionData.map((d) => (
                  <Cell key={d.action} fill={d.fill} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  trend,
}: {
  label: string;
  value: string;
  hint?: string;
  trend?: "up" | "down";
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
          {label}
        </div>
        <div className="text-2xl font-bold font-mono flex items-center gap-2">
          {value}
          {trend === "up" && <TrendingUp className="h-4 w-4 text-primary" />}
          {trend === "down" && <TrendingDown className="h-4 w-4 text-destructive" />}
        </div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function MarginBadge({ status }: { status: PricingRecommendation["analysis"]["marginStatus"] }) {
  const map: Record<string, string> = {
    safe: "bg-primary/15 text-primary border-primary/30",
    at_risk: "bg-amber-500/15 text-amber-500 border-amber-500/30",
    breached: "bg-destructive/15 text-destructive border-destructive/30",
  };
  return (
    <Badge variant="outline" className={map[status]}>
      {status.replace("_", " ")}
    </Badge>
  );
}

function KanbanColumn({
  title,
  tone,
  icon,
  rows,
  impact,
}: {
  title: string;
  tone: "safe" | "warn" | "danger";
  icon: React.ReactNode;
  rows: RecRow[];
  impact: number;
}) {
  const toneClass =
    tone === "safe"
      ? "border-primary/40"
      : tone === "warn"
        ? "border-amber-500/40"
        : "border-destructive/40";

  return (
    <Card className={`border-l-4 ${toneClass}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            {icon}
            {title}
            <span className="text-muted-foreground font-mono">({rows.length})</span>
          </CardTitle>
          <span
            className={`text-xs font-mono ${impact < 0 ? "text-destructive" : "text-primary"}`}
          >
            {impact >= 0 ? "+" : ""}
            {fmt$(impact)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ScrollArea className="h-72">
          <ul className="space-y-1 text-xs font-mono">
            {rows.slice(0, 50).map((r) => (
              <li
                key={r.productId}
                className="flex items-center justify-between py-1 px-2 rounded hover:bg-muted/50"
              >
                <span className="truncate font-sans">{r.title}</span>
                <span className="ml-2 shrink-0 text-muted-foreground">
                  {r.action === "HOLD" ? "—" : pct(r.discountPercentage, 0)}
                </span>
              </li>
            ))}
            {rows.length === 0 && (
              <li className="text-center text-muted-foreground py-4">No products</li>
            )}
            {rows.length > 50 && (
              <li className="text-center text-muted-foreground pt-2">
                +{rows.length - 50} more…
              </li>
            )}
          </ul>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

// ── What-If Simulator ───────────────────────────────────────────
function WhatIfModal({ row, onClose }: { row: RecRow | null; onClose: () => void }) {
  const initialPct = row?.discountPercentage ?? 0;
  const [discountPct, setDiscountPct] = useState<number>(initialPct);

  // Reset slider when row changes
  useMemo(() => {
    setDiscountPct(row?.discountPercentage ?? 0);
  }, [row?.productId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!row) return null;
  const cost = row.analysis.currentPrice - (row.analysis.currentPrice - row.analysis.floorPrice / 1.05); // floor = cost*1.05 → cost = floor/1.05
  const trueCost = row.analysis.floorPrice > 0 ? row.analysis.floorPrice / 1.05 : null;

  const proposed = +(row.analysis.currentPrice * (1 - discountPct / 100)).toFixed(2);
  const enforced = enforceFloor(proposed, trueCost);
  const finalPrice = enforced.price;
  const clamped = enforced.clamped;
  const marginPerUnit = trueCost != null ? +(finalPrice - trueCost).toFixed(2) : null;

  // Naive sales projection placeholder: every 10% off → +20% units sold (elasticity=2.0)
  const elasticity = 2.0;
  const projectedUplift = elasticity * (discountPct / 100); // 0.20 = +20%
  const projectedUnitsMultiplier = 1 + projectedUplift;

  return (
    <Dialog open={!!row} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-4 w-4" />
            What-If Simulator
          </DialogTitle>
          <DialogDescription className="truncate">{row.title}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <Stat label="Current" value={fmt$(row.analysis.currentPrice)} />
            <Stat label="Floor" value={fmt$(row.analysis.floorPrice)} />
            <Stat label="AI rec" value={fmt$(row.suggestedNewPrice)} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm">Discount</Label>
              <span className="font-mono text-sm">{discountPct.toFixed(0)}%</span>
            </div>
            <Slider
              min={0}
              max={50}
              step={1}
              value={[discountPct]}
              onValueChange={(v) => setDiscountPct(v[0])}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Stat
              label="New price"
              value={fmt$(finalPrice)}
              hint={clamped ? "Capped at floor" : undefined}
              tone={clamped ? "warn" : "default"}
            />
            <Stat
              label="Margin / unit"
              value={marginPerUnit != null ? fmt$(marginPerUnit) : "—"}
              tone={marginPerUnit != null && marginPerUnit < 0 ? "danger" : "default"}
            />
          </div>

          <div className="rounded-md border border-border bg-muted/20 p-3 text-xs">
            <div className="text-muted-foreground mb-1 uppercase tracking-wider">
              Sales projection (placeholder)
            </div>
            <div className="font-mono">
              Estimated unit sales: ×{projectedUnitsMultiplier.toFixed(2)} of baseline
            </div>
            <div className="text-muted-foreground mt-1">
              Assumes elasticity of 2.0 (every 10% off → +20% units). Real velocity data lands in
              the next milestone.
            </div>
          </div>

          {row.reason && (
            <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs">
              <div className="text-primary font-semibold mb-1 flex items-center gap-1">
                <Sparkles className="h-3 w-3" /> AI rationale
              </div>
              <div className="text-foreground/90">{row.reason}</div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "warn" | "danger";
}) {
  const toneClass =
    tone === "warn"
      ? "text-amber-500"
      : tone === "danger"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="rounded-md border border-border p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-base font-mono font-bold ${toneClass}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
