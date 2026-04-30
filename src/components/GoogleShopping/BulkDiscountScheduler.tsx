/**
 * BulkDiscountScheduler
 *
 * Lets a merchant filter products, choose a discount strategy, preview
 * the impact, and apply prices either immediately or on a schedule.
 * Scheduled runs are persisted in `bulk_discount_schedules` and reverted
 * automatically once `ends_at` passes (handled by the markdown ladder
 * cron). Every change is audit-logged.
 */

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  ArrowLeft,
  CalendarIcon,
  Filter,
  Loader2,
  Wand2,
  Eye,
  PlayCircle,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

import { supabase } from "@/integrations/supabase/client";
import {
  applyBulkPriceUpdates,
  type VariantPriceUpdate,
} from "@/lib/shopify/bulkPriceUpdater";
import { addAuditEntry } from "@/lib/audit-log";

// ───────────────────────── Types ─────────────────────────

type AgeBucket = "any" | "30+" | "60+" | "90+";
type SellThrough = "any" | "low" | "medium" | "high";
type Strategy = "percentage" | "fixed_amount" | "match_competitor" | "clearance";
type Gender = "any" | "male" | "female" | "unisex";
type AgeGroup = "any" | "adult" | "kids" | "newborn" | "infant" | "toddler";

interface ProductRow {
  id: string;            // gid
  title: string;
  handle: string;
  productType: string | null;
  collection: string | null;
  vendor: string | null;
  inventoryAgeDays: number;
  unitsSoldPerWeek: number;
  competitorPrice: number | null;
  cost: number | null;
  gender: string | null;
  ageGroup: string | null;
  customLabels: (string | null)[];
  variants: Array<{
    id: string;
    sku: string | null;
    title: string;
    price: number;
  }>;
}

interface PreviewRow {
  product: ProductRow;
  variantId: string;
  variantTitle: string;
  sku: string | null;
  currentPrice: number;
  newPrice: number;
  discountPct: number;
  marginAfterPct: number | null;
  blocked: boolean;
  blockReason?: string;
}

interface Props {
  onBack?: () => void;
}

const MARGIN_FLOOR_PCT = 10;          // never below cost + 10%
const PAGE_SIZE = 250;

// ────────────────────── Helpers ──────────────────────

function ageMatches(days: number, bucket: AgeBucket) {
  if (bucket === "any") return true;
  if (bucket === "30+") return days >= 30;
  if (bucket === "60+") return days >= 60;
  if (bucket === "90+") return days >= 90;
  return true;
}

function sellThroughMatches(unitsPerWeek: number, b: SellThrough) {
  if (b === "any") return true;
  if (b === "low") return unitsPerWeek < 1;
  if (b === "medium") return unitsPerWeek >= 1 && unitsPerWeek < 5;
  if (b === "high") return unitsPerWeek >= 5;
  return true;
}

function computeNewPrice(
  current: number,
  competitor: number | null,
  cost: number | null,
  strategy: Strategy,
  value: number,
): { newPrice: number; blocked: boolean; reason?: string } {
  let candidate = current;
  switch (strategy) {
    case "percentage":
      candidate = +(current * (1 - value / 100)).toFixed(2);
      break;
    case "fixed_amount":
      candidate = +Math.max(0, current - value).toFixed(2);
      break;
    case "match_competitor":
      if (competitor && competitor > 0) {
        // Beat by `value` percent (default 5).
        candidate = +(competitor * (1 - value / 100)).toFixed(2);
      } else {
        return { newPrice: current, blocked: true, reason: "No competitor price" };
      }
      break;
    case "clearance":
      // 60% off by default for clearance, capped by `value` if provided
      candidate = +(current * (1 - (value || 60) / 100)).toFixed(2);
      break;
  }

  // Margin floor — cost + 10%
  if (cost && cost > 0) {
    const floor = +(cost * (1 + MARGIN_FLOOR_PCT / 100)).toFixed(2);
    if (candidate < floor) {
      return {
        newPrice: floor,
        blocked: false,
        reason: `Capped at margin floor ${floor.toFixed(2)}`,
      };
    }
  }
  if (candidate >= current) {
    return { newPrice: current, blocked: true, reason: "No discount produced" };
  }
  return { newPrice: candidate, blocked: false };
}

// ────────────────────── Component ──────────────────────

export default function BulkDiscountScheduler({ onBack }: Props) {
  // Filters
  const [collection, setCollection] = useState("");
  const [productType, setProductType] = useState("");
  const [ageBucket, setAgeBucket] = useState<AgeBucket>("any");
  const [sellThrough, setSellThrough] = useState<SellThrough>("any");
  const [gender, setGender] = useState<Gender>("any");
  const [ageGroup, setAgeGroup] = useState<AgeGroup>("any");
  const [customLabel, setCustomLabel] = useState("");

  // Strategy
  const [strategy, setStrategy] = useState<Strategy>("percentage");
  const [discountValue, setDiscountValue] = useState<number>(20);
  const [scheduleName, setScheduleName] = useState("Sale");
  const [useGoogleAutoPricing, setUseGoogleAutoPricing] = useState(true);

  // Schedule
  const [scheduleNow, setScheduleNow] = useState(true);
  const [startsAt, setStartsAt] = useState<Date | undefined>();
  const [endsAt, setEndsAt] = useState<Date | undefined>();

  // Data state
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  // Initial fetch
  useEffect(() => {
    void loadProducts();
  }, []);

  async function loadProducts() {
    setLoading(true);
    setError(null);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke(
        "google-merchant-status",
        {
          body: { action: "list", pageSize: PAGE_SIZE, includeBulkData: true },
        },
      );
      if (invokeErr) throw new Error(invokeErr.message);
      if (data?.error) throw new Error(data.error);
      const rows = (data?.rows ?? []) as Partial<ProductRow>[];
      // Defensive normalisation (the edge fn may not return every field yet)
      const normalised: ProductRow[] = rows.map((r) => ({
        id: r.id ?? "",
        title: r.title ?? "Untitled",
        handle: r.handle ?? "",
        productType: r.productType ?? null,
        collection: (r as { collection?: string }).collection ?? null,
        vendor: (r as { vendor?: string }).vendor ?? null,
        inventoryAgeDays:
          (r as { inventoryAgeDays?: number }).inventoryAgeDays ?? 0,
        unitsSoldPerWeek:
          (r as { unitsSoldPerWeek?: number }).unitsSoldPerWeek ?? 0,
        competitorPrice:
          (r as { competitorPrice?: number | null }).competitorPrice ?? null,
        cost: (r as { cost?: number | null }).cost ?? null,
        gender: (r as { gender?: string }).gender ?? null,
        ageGroup: (r as { ageGroup?: string }).ageGroup ?? null,
        customLabels:
          (r as { customLabels?: (string | null)[] }).customLabels ?? [],
        variants:
          (r as { variants?: ProductRow["variants"] }).variants ?? [],
      }));
      setProducts(normalised);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load products");
    } finally {
      setLoading(false);
    }
  }

  // Filtered products
  const filteredProducts = useMemo(() => {
    const cl = customLabel.trim().toLowerCase();
    const col = collection.trim().toLowerCase();
    const pt = productType.trim().toLowerCase();
    return products.filter((p) => {
      if (col && !(p.collection ?? "").toLowerCase().includes(col)) return false;
      if (pt && !(p.productType ?? "").toLowerCase().includes(pt)) return false;
      if (!ageMatches(p.inventoryAgeDays, ageBucket)) return false;
      if (!sellThroughMatches(p.unitsSoldPerWeek, sellThrough)) return false;
      if (gender !== "any" && (p.gender ?? "").toLowerCase() !== gender) return false;
      if (ageGroup !== "any" && (p.ageGroup ?? "").toLowerCase() !== ageGroup) return false;
      if (cl) {
        const hit = p.customLabels.some((v) =>
          (v ?? "").toLowerCase().includes(cl),
        );
        if (!hit) return false;
      }
      return true;
    });
  }, [
    products,
    collection,
    productType,
    ageBucket,
    sellThrough,
    gender,
    ageGroup,
    customLabel,
  ]);

  // Preview rows
  const previewRows = useMemo<PreviewRow[]>(() => {
    const out: PreviewRow[] = [];
    for (const p of filteredProducts) {
      for (const v of p.variants) {
        const { newPrice, blocked, reason } = computeNewPrice(
          v.price,
          p.competitorPrice,
          p.cost,
          strategy,
          discountValue,
        );
        const discountPct =
          v.price > 0 ? +(((v.price - newPrice) / v.price) * 100).toFixed(1) : 0;
        const marginAfterPct =
          p.cost && p.cost > 0 && newPrice > 0
            ? +(((newPrice - p.cost) / newPrice) * 100).toFixed(1)
            : null;
        out.push({
          product: p,
          variantId: v.id,
          variantTitle: v.title,
          sku: v.sku,
          currentPrice: v.price,
          newPrice,
          discountPct,
          marginAfterPct,
          blocked,
          blockReason: reason,
        });
      }
    }
    return out;
  }, [filteredProducts, strategy, discountValue]);

  const applicableRows = useMemo(
    () => previewRows.filter((r) => !r.blocked),
    [previewRows],
  );

  const totalRevenueImpact = useMemo(
    () => applicableRows.reduce((s, r) => s + (r.newPrice - r.currentPrice), 0),
    [applicableRows],
  );

  // ────────── Apply ──────────
  async function handleApply() {
    if (applicableRows.length === 0) {
      toast.error("No products match — adjust filters or strategy");
      return;
    }
    if (!scheduleNow && (!startsAt || !endsAt)) {
      toast.error("Pick start AND end dates, or apply immediately");
      return;
    }
    if (!scheduleNow && startsAt && endsAt && endsAt <= startsAt) {
      toast.error("End date must be after start date");
      return;
    }

    setApplying(true);
    const updates: VariantPriceUpdate[] = applicableRows.map((r) => ({
      productId: r.product.id,
      variantId: r.variantId,
      newPrice: r.newPrice,
      originalPrice: r.currentPrice,
      sku: r.sku,
      title: r.product.title,
      autoPricingMinPrice: useGoogleAutoPricing
        ? r.product.cost
          ? +(r.product.cost * (1 + MARGIN_FLOOR_PCT / 100)).toFixed(2)
          : r.newPrice
        : null,
    }));

    try {
      // 1. Persist the schedule first so we have an id for audit + revert.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const filterSnapshot = {
        collection,
        productType,
        ageBucket,
        sellThrough,
        gender,
        ageGroup,
        customLabel,
      };

      const insertPayload = {
        user_id: user.id,
        name: scheduleName.trim() || "Untitled sale",
        status: scheduleNow ? "active" : "pending",
        strategy,
        discount_value: discountValue,
        filter_snapshot: filterSnapshot,
        variants_snapshot: updates as unknown as object[],
        affected_count: updates.length,
        starts_at: scheduleNow ? new Date().toISOString() : startsAt?.toISOString(),
        ends_at: endsAt?.toISOString() ?? null,
        applied_at: scheduleNow ? new Date().toISOString() : null,
        use_google_auto_pricing: useGoogleAutoPricing,
      };
      const { data: schedule, error: insertErr } = await (supabase
        .from("bulk_discount_schedules") as unknown as {
          insert: (v: unknown) => {
            select: (cols: string) => { single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }> };
          };
        })
        .insert(insertPayload)
        .select("id")
        .single();
      if (insertErr) throw insertErr;

      addAuditEntry(
        "bulk_discount_scheduled",
        JSON.stringify({
          scheduleId: schedule?.id,
          name: scheduleName,
          strategy,
          discountValue,
          affected: updates.length,
          startsAt: startsAt?.toISOString() ?? "now",
          endsAt: endsAt?.toISOString() ?? null,
          filters: filterSnapshot,
        }),
      );

      if (scheduleNow) {
        // 2. Apply to Shopify immediately.
        const result = await applyBulkPriceUpdates(updates, {
          scheduleName,
          scheduleId: schedule?.id,
          reason: `Bulk ${strategy} ${discountValue}`,
        });

        await (supabase.from("bulk_discount_schedules") as unknown as {
          update: (v: unknown) => { eq: (col: string, val: string) => Promise<unknown> };
        })
          .update({
            status: result.failed === 0 ? "active" : "failed",
            last_error:
              result.failed > 0 ? `${result.failed} variants failed` : null,
          })
          .eq("id", schedule!.id);

        toast.success(
          `Applied to ${result.ok} variant${result.ok === 1 ? "" : "s"}` +
            (result.failed ? `, ${result.failed} failed` : ""),
        );
      } else {
        toast.success(
          `Scheduled — runs ${format(startsAt!, "PPP")}, reverts ${format(endsAt!, "PPP")}`,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Apply failed";
      toast.error(msg);
    } finally {
      setApplying(false);
    }
  }

  // ────────── Render ──────────

  return (
    <div className="max-w-[1400px] mx-auto p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {onBack && (
            <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
          )}
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold">
              Bulk discount scheduler
            </h1>
            <p className="text-xs text-muted-foreground">
              Filter products, choose a strategy, preview, schedule.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid lg:grid-cols-[360px_1fr] gap-4">
        {/* Filters + Strategy */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Filter className="w-4 h-4" /> Filters
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Collection</Label>
                <Input
                  value={collection}
                  onChange={(e) => setCollection(e.target.value)}
                  placeholder="e.g. Summer"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Product type</Label>
                <Input
                  value={productType}
                  onChange={(e) => setProductType(e.target.value)}
                  placeholder="e.g. Dresses"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Inventory age</Label>
                <Select value={ageBucket} onValueChange={(v) => setAgeBucket(v as AgeBucket)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any</SelectItem>
                    <SelectItem value="30+">&gt; 30 days</SelectItem>
                    <SelectItem value="60+">&gt; 60 days</SelectItem>
                    <SelectItem value="90+">&gt; 90 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Sell-through</Label>
                <Select value={sellThrough} onValueChange={(v) => setSellThrough(v as SellThrough)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any</SelectItem>
                    <SelectItem value="low">Low (&lt;1/wk)</SelectItem>
                    <SelectItem value="medium">Medium (1–5/wk)</SelectItem>
                    <SelectItem value="high">High (&gt;5/wk)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Gender</Label>
                <Select value={gender} onValueChange={(v) => setGender(v as Gender)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="unisex">Unisex</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Age group</Label>
                <Select value={ageGroup} onValueChange={(v) => setAgeGroup(v as AgeGroup)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any</SelectItem>
                    <SelectItem value="adult">Adult</SelectItem>
                    <SelectItem value="kids">Kids</SelectItem>
                    <SelectItem value="toddler">Toddler</SelectItem>
                    <SelectItem value="infant">Infant</SelectItem>
                    <SelectItem value="newborn">Newborn</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                Custom label (any of custom_label_0–4)
              </Label>
              <Input
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder='e.g. "winter sale" or "best sellers"'
              />
            </div>

            <Separator />

            <div className="space-y-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Wand2 className="w-4 h-4" /> Strategy
              </CardTitle>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Sale name</Label>
                  <Input
                    value={scheduleName}
                    onChange={(e) => setScheduleName(e.target.value)}
                    placeholder="e.g. Winter clearance"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Type</Label>
                  <Select value={strategy} onValueChange={(v) => setStrategy(v as Strategy)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percentage">% off</SelectItem>
                      <SelectItem value="fixed_amount">Fixed amount</SelectItem>
                      <SelectItem value="match_competitor">Match competitor</SelectItem>
                      <SelectItem value="clearance">Clearance</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    {strategy === "fixed_amount"
                      ? "Amount off"
                      : strategy === "match_competitor"
                        ? "Beat by %"
                        : "Discount %"}
                  </Label>
                  <Input
                    type="number"
                    value={discountValue}
                    onChange={(e) => setDiscountValue(Number(e.target.value) || 0)}
                    min={0}
                    max={strategy === "fixed_amount" ? 9999 : 95}
                  />
                </div>
              </div>

              <label className="flex items-center justify-between text-xs pt-2">
                <span>Set Google auto_pricing_min_price</span>
                <Switch
                  checked={useGoogleAutoPricing}
                  onCheckedChange={setUseGoogleAutoPricing}
                />
              </label>
            </div>

            <Separator />

            <div className="space-y-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Clock className="w-4 h-4" /> Schedule
              </CardTitle>
              <label className="flex items-center justify-between text-xs">
                <span>Apply immediately</span>
                <Switch checked={scheduleNow} onCheckedChange={setScheduleNow} />
              </label>
              {!scheduleNow && (
                <div className="grid grid-cols-2 gap-2">
                  <DateField label="Start" value={startsAt} onChange={setStartsAt} />
                  <DateField
                    label="End (auto-revert)"
                    value={endsAt}
                    onChange={setEndsAt}
                  />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Preview */}
        <Card>
          <CardHeader className="py-3 flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Eye className="w-4 h-4" /> Preview
              <Badge variant="outline" className="ml-2 font-normal">
                {applicableRows.length} variants ·{" "}
                {filteredProducts.length} products
              </Badge>
              {previewRows.length > applicableRows.length && (
                <Badge variant="outline" className="font-normal text-amber-500 border-amber-500/30">
                  {previewRows.length - applicableRows.length} skipped
                </Badge>
              )}
            </CardTitle>
            <Button
              size="sm"
              onClick={handleApply}
              disabled={applying || loading || applicableRows.length === 0}
            >
              {applying && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              <PlayCircle className="w-4 h-4 mr-1.5" />
              {scheduleNow ? "Apply now" : "Schedule"}
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : previewRows.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-foreground">
                No variants match. Loosen the filters.
              </div>
            ) : (
              <ScrollArea className="h-[60vh]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Variant</TableHead>
                      <TableHead className="text-right">Current</TableHead>
                      <TableHead className="text-right">New</TableHead>
                      <TableHead className="text-right">Discount</TableHead>
                      <TableHead className="text-right">Margin after</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewRows.slice(0, 500).map((r) => (
                      <TableRow
                        key={r.variantId}
                        className={cn(r.blocked && "opacity-60")}
                        style={{ height: 32 }}
                      >
                        <TableCell className="max-w-[260px] truncate" title={r.product.title}>
                          {r.product.title}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.variantTitle}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          ${r.currentPrice.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          ${r.newPrice.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.discountPct.toFixed(1)}%
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.marginAfterPct != null ? `${r.marginAfterPct.toFixed(1)}%` : "—"}
                        </TableCell>
                        <TableCell>
                          {r.blocked ? (
                            <span className="text-xs text-amber-500 inline-flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> {r.blockReason}
                            </span>
                          ) : r.blockReason ? (
                            <span className="text-xs text-muted-foreground">{r.blockReason}</span>
                          ) : (
                            <span className="text-xs text-emerald-500">OK</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {previewRows.length > 500 && (
                  <p className="p-3 text-xs text-muted-foreground text-center">
                    Showing first 500 of {previewRows.length} rows.
                  </p>
                )}
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      {applicableRows.length > 0 && (
        <p className="text-xs text-muted-foreground text-right">
          Estimated price impact (sum of new − current):{" "}
          <span className="font-mono">${totalRevenueImpact.toFixed(2)}</span>
        </p>
      )}
    </div>
  );
}

// ────────────────── Date sub-component ──────────────────

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Date | undefined;
  onChange: (d: Date | undefined) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "w-full justify-start text-left font-normal h-9",
              !value && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="w-4 h-4 mr-1.5" />
            {value ? format(value, "PPP") : "Pick date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value}
            onSelect={onChange}
            initialFocus
            disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
