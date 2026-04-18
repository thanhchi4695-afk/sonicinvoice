import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Package, Plus, Sparkles, AlertCircle } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { ReconciliationLine } from "@/lib/stock-matcher";

interface CatalogVariant {
  platform_variant_id: string | null;
  platform_product_id: string;
  product_title: string | null;
  variant_title: string | null;
  sku: string | null;
  barcode: string | null;
  colour: string | null;
  size: string | null;
  current_qty: number | null;
  current_cost: number | null;
  current_price: number | null;
  platform: string;
}

interface NearMatch {
  product_id: string;
  product_title: string;
  sku: string | null;
  similarity: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  line: ReconciliationLine | null;
  decision?: "new" | "old";
  onDecision?: (d: "new" | "old") => void;
  onReclassifyAsRefill?: (matchedProductId: string) => void;
  shopDomain?: string | null;
}

// ── Similarity (Dice coefficient on bigrams) ──────────────
function similarity(a: string, b: string): number {
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  if (!x || !y) return 0;
  if (x === y) return 1;
  const bigrams = (s: string) => {
    const out: string[] = [];
    for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
    return out;
  };
  const ba = bigrams(x);
  const bb = bigrams(y);
  if (ba.length === 0 || bb.length === 0) return 0;
  const map = new Map<string, number>();
  ba.forEach((g) => map.set(g, (map.get(g) ?? 0) + 1));
  let hits = 0;
  bb.forEach((g) => {
    const c = map.get(g) ?? 0;
    if (c > 0) {
      hits++;
      map.set(g, c - 1);
    }
  });
  return (2 * hits) / (ba.length + bb.length);
}

function costTone(invoice?: number | null, current?: number | null): {
  tone: "ok" | "warn" | "bad" | "none";
  pct: number | null;
} {
  if (invoice == null || current == null || current === 0) return { tone: "none", pct: null };
  const pct = (invoice - current) / current;
  const abs = Math.abs(pct);
  if (abs < 0.001) return { tone: "ok", pct };
  if (abs <= 0.1) return { tone: "warn", pct };
  return { tone: "bad", pct };
}

export default function VariantDetailDrawer({
  open,
  onOpenChange,
  line,
  decision,
  onDecision,
  onReclassifyAsRefill,
  shopDomain,
}: Props) {
  const [variants, setVariants] = useState<CatalogVariant[]>([]);
  const [nearMatches, setNearMatches] = useState<NearMatch[]>([]);
  const [loading, setLoading] = useState(false);

  const matchType = line?.match_type;
  const isRefill = matchType?.startsWith("exact_refill") ?? false;
  const isNewVariant =
    matchType?.startsWith("new_variant") || matchType?.startsWith("new_colour");
  const isNew = matchType === "new";
  const isConflict = matchType?.endsWith("_conflict") ?? false;

  // Load full variant grid for matched product, or near-matches for new products
  useEffect(() => {
    if (!open || !line) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setVariants([]);
      setNearMatches([]);
      try {
        if (line.matched_product_id) {
          const { data } = await supabase
            .from("product_catalog_cache")
            .select(
              "platform_variant_id, platform_product_id, product_title, variant_title, sku, barcode, colour, size, current_qty, current_cost, current_price, platform",
            )
            .eq("platform_product_id", line.matched_product_id)
            .order("size", { ascending: true });
          if (!cancelled) setVariants((data as CatalogVariant[] | null) ?? []);
        } else if (isNew && line.invoice_product_name) {
          // Pull a slice of the user's catalog and rank by similarity client-side
          const { data } = await supabase
            .from("product_catalog_cache")
            .select("platform_product_id, product_title, sku")
            .limit(500);
          if (!cancelled && data) {
            const seen = new Map<string, NearMatch>();
            for (const row of data as { platform_product_id: string; product_title: string | null; sku: string | null }[]) {
              if (!row.product_title) continue;
              const score = similarity(line.invoice_product_name!, row.product_title);
              if (score < 0.6) continue;
              const existing = seen.get(row.platform_product_id);
              if (!existing || existing.similarity < score) {
                seen.set(row.platform_product_id, {
                  product_id: row.platform_product_id,
                  product_title: row.product_title,
                  sku: row.sku,
                  similarity: score,
                });
              }
            }
            const ranked = Array.from(seen.values())
              .sort((a, b) => b.similarity - a.similarity)
              .slice(0, 3);
            setNearMatches(ranked);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, line, isNew]);

  const matchedVariant = useMemo(() => {
    if (!line?.matched_variant_id) return null;
    return variants.find((v) => v.platform_variant_id === line.matched_variant_id) ?? null;
  }, [variants, line]);

  const headerVariant = matchedVariant ?? variants[0] ?? null;
  const productTitle =
    headerVariant?.product_title || line?.invoice_product_name || "Unknown product";

  const platformLink = (() => {
    if (!line?.matched_product_id) return null;
    if (shopDomain && headerVariant?.platform === "shopify") {
      return `https://${shopDomain}/admin/products/${line.matched_product_id}`;
    }
    return null;
  })();

  const cost = costTone(line?.invoice_cost, headerVariant?.current_cost ?? null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col">
        {line && (
          <>
            <SheetHeader className="p-6 pb-4 border-b">
              <div className="flex items-start gap-3">
                <div className="w-14 h-14 rounded-md bg-muted flex items-center justify-center shrink-0">
                  <Package className="w-6 h-6 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate text-base">{productTitle}</SheetTitle>
                  <SheetDescription className="flex flex-wrap items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-[10px]">
                      {matchType}
                    </Badge>
                    {headerVariant?.sku && (
                      <span className="text-xs">SKU {headerVariant.sku}</span>
                    )}
                    {headerVariant?.barcode && (
                      <span className="text-xs">· {headerVariant.barcode}</span>
                    )}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <ScrollArea className="flex-1">
              <div className="p-6 space-y-5">
                {/* ── EXACT REFILL ── */}
                {isRefill && (
                  <>
                    <VariantGrid
                      variants={variants}
                      matchedVariantId={line.matched_variant_id}
                      invoiceQty={line.invoice_qty}
                      loading={loading}
                    />
                    <CostComparison
                      invoiceCost={line.invoice_cost}
                      currentCost={headerVariant?.current_cost ?? null}
                      currentRRP={headerVariant?.current_price ?? null}
                      tone={cost.tone}
                      pct={cost.pct}
                    />
                    {platformLink && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={platformLink} target="_blank" rel="noreferrer">
                          <ExternalLink className="w-4 h-4 mr-1" /> View in Shopify
                        </a>
                      </Button>
                    )}
                  </>
                )}

                {/* ── NEW VARIANT ── */}
                {isNewVariant && (
                  <>
                    <div className="text-sm text-muted-foreground">
                      Adding a new {line.invoice_colour ? "colour" : "size"} to this existing
                      product:
                    </div>
                    <VariantGrid
                      variants={variants}
                      matchedVariantId={null}
                      invoiceQty={line.invoice_qty}
                      newVariantPreview={{
                        colour: line.invoice_colour,
                        size: line.invoice_size,
                        qty: line.invoice_qty,
                      }}
                      loading={loading}
                    />
                    <Card className="p-3">
                      <div className="text-xs font-medium mb-2">CSV preview row</div>
                      <pre className="text-[11px] bg-muted/50 rounded p-2 overflow-x-auto">
{`Handle: ${headerVariant?.product_title ? slug(headerVariant.product_title) : "—"}
Option1: ${line.invoice_size ?? line.invoice_colour ?? "—"}
Variant SKU: ${line.invoice_sku ?? "—"}
Variant Cost: ${fmt(line.invoice_cost)}
Variant Price: ${fmt(line.invoice_rrp)}
Inventory Qty: ${line.invoice_qty}`}
                      </pre>
                    </Card>
                  </>
                )}

                {/* ── NEW PRODUCT ── */}
                {isNew && (
                  <>
                    <Card className="p-4 border-emerald-500/30">
                      <div className="text-xs font-medium text-emerald-600 mb-2">
                        Will be created as new product
                      </div>
                      <div className="space-y-1 text-sm">
                        <div className="font-medium">{line.invoice_product_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3">
                          {line.invoice_colour && <span>Colour: {line.invoice_colour}</span>}
                          {line.invoice_size && <span>Size: {line.invoice_size}</span>}
                          {line.invoice_sku && <span>SKU: {line.invoice_sku}</span>}
                        </div>
                        <div className="text-xs flex flex-wrap gap-x-3 mt-1">
                          <span>Cost: {fmt(line.invoice_cost)}</span>
                          <span>RRP: {fmt(line.invoice_rrp)}</span>
                          <span>Qty: {line.invoice_qty}</span>
                        </div>
                      </div>
                    </Card>

                    <div>
                      <div className="text-xs font-medium mb-2 flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5" />
                        Closest catalog matches
                      </div>
                      {loading && (
                        <div className="text-xs text-muted-foreground">Searching…</div>
                      )}
                      {!loading && nearMatches.length === 0 && (
                        <div className="text-xs text-muted-foreground">
                          No similar products found — confirmed as new.
                        </div>
                      )}
                      {!loading && nearMatches.length > 0 && (
                        <div className="space-y-2">
                          {nearMatches.map((nm) => (
                            <Card key={nm.product_id} className="p-3 flex items-center gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium truncate">
                                  {nm.product_title}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {nm.sku ? `SKU ${nm.sku} · ` : ""}
                                  {Math.round(nm.similarity * 100)}% similar
                                </div>
                              </div>
                              {onReclassifyAsRefill && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => onReclassifyAsRefill(nm.product_id)}
                                >
                                  This is the same product
                                </Button>
                              )}
                            </Card>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* ── CONFLICT ── */}
                {isConflict && (
                  <Card className="p-4 border-amber-500/40">
                    <div className="flex items-center gap-2 text-amber-600 text-sm font-medium mb-3">
                      <AlertCircle className="w-4 h-4" />
                      {line.conflict_reason ?? "Conflict detected"}
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div className="rounded-md border border-border p-3">
                        <div className="text-[11px] text-muted-foreground uppercase">
                          Invoice says
                        </div>
                        <div className="text-lg font-semibold">{fmt(line.invoice_cost)}</div>
                      </div>
                      <div className="rounded-md border border-border p-3">
                        <div className="text-[11px] text-muted-foreground uppercase">
                          Your system has
                        </div>
                        <div className="text-lg font-semibold">
                          {fmt(line.matched_current_cost)}
                        </div>
                      </div>
                    </div>
                    {line.cost_delta_pct != null && (
                      <div className="text-xs text-muted-foreground mb-3">
                        Difference: {line.cost_delta_pct > 0 ? "+" : ""}
                        {(line.cost_delta_pct * 100).toFixed(1)}%
                      </div>
                    )}
                    {onDecision && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant={decision === "new" ? "default" : "outline"}
                          onClick={() => onDecision("new")}
                          className="flex-1"
                        >
                          Accept new price
                        </Button>
                        <Button
                          size="sm"
                          variant={decision === "old" ? "default" : "outline"}
                          onClick={() => onDecision("old")}
                          className="flex-1"
                        >
                          Keep current
                        </Button>
                      </div>
                    )}
                  </Card>
                )}
              </div>
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Sub components ────────────────────────────────────────

function VariantGrid({
  variants,
  matchedVariantId,
  invoiceQty,
  newVariantPreview,
  loading,
}: {
  variants: CatalogVariant[];
  matchedVariantId: string | null;
  invoiceQty: number;
  newVariantPreview?: { colour: string | null; size: string | null; qty: number };
  loading: boolean;
}) {
  if (loading) {
    return <div className="text-xs text-muted-foreground">Loading variants…</div>;
  }
  if (variants.length === 0 && !newVariantPreview) {
    return (
      <div className="text-xs text-muted-foreground">
        No variant data cached for this product.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="h-8 text-xs">Colour</TableHead>
            <TableHead className="h-8 text-xs">Size</TableHead>
            <TableHead className="h-8 text-xs text-right">Current</TableHead>
            <TableHead className="h-8 text-xs text-right">After</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {variants.map((v) => {
            const isMatched = v.platform_variant_id === matchedVariantId;
            const after = isMatched ? (v.current_qty ?? 0) + invoiceQty : v.current_qty ?? 0;
            return (
              <TableRow
                key={v.platform_variant_id ?? `${v.sku}-${v.size}-${v.colour}`}
                className={cn(isMatched && "bg-blue-500/10")}
              >
                <TableCell className="py-2 text-xs">{v.colour ?? "—"}</TableCell>
                <TableCell className="py-2 text-xs">{v.size ?? "—"}</TableCell>
                <TableCell className="py-2 text-xs text-right">
                  {v.current_qty ?? "—"}
                </TableCell>
                <TableCell className="py-2 text-xs text-right">
                  {isMatched ? (
                    <span className="inline-flex items-center gap-1">
                      <span className="font-medium">{after}</span>
                      <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white text-[10px] px-1.5 py-0">
                        +{invoiceQty}
                      </Badge>
                    </span>
                  ) : (
                    after
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          {newVariantPreview && (
            <TableRow className="border-t border-dashed border-amber-500/60 bg-amber-500/10">
              <TableCell className="py-2 text-xs text-amber-700 dark:text-amber-400">
                {newVariantPreview.colour ?? "—"}
              </TableCell>
              <TableCell className="py-2 text-xs text-amber-700 dark:text-amber-400">
                {newVariantPreview.size ?? "—"}
              </TableCell>
              <TableCell className="py-2 text-xs text-right text-muted-foreground">—</TableCell>
              <TableCell className="py-2 text-xs text-right">
                <span className="inline-flex items-center gap-1">
                  <span className="font-medium">{newVariantPreview.qty}</span>
                  <Badge className="bg-amber-600 hover:bg-amber-600 text-white text-[10px] px-1.5 py-0">
                    <Plus className="w-2.5 h-2.5 mr-0.5" />
                    New
                  </Badge>
                </span>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function CostComparison({
  invoiceCost,
  currentCost,
  currentRRP,
  tone,
  pct,
}: {
  invoiceCost: number | null;
  currentCost: number | null;
  currentRRP: number | null;
  tone: "ok" | "warn" | "bad" | "none";
  pct: number | null;
}) {
  const toneClass =
    tone === "ok"
      ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
      : tone === "warn"
        ? "border-amber-500/40 text-amber-700 dark:text-amber-400"
        : tone === "bad"
          ? "border-destructive/40 text-destructive"
          : "border-border text-muted-foreground";
  return (
    <Card className={cn("p-3 border", toneClass)}>
      <div className="text-xs flex flex-wrap gap-x-4 gap-y-1">
        <span>Invoice cost: <strong>{fmt(invoiceCost)}</strong></span>
        <span>Current: <strong>{fmt(currentCost)}</strong></span>
        {currentRRP != null && <span>RRP: <strong>{fmt(currentRRP)}</strong></span>}
        {pct != null && (
          <span>
            Δ {pct > 0 ? "+" : ""}
            {(pct * 100).toFixed(1)}%
          </span>
        )}
      </div>
    </Card>
  );
}

// ── Tiny utils ────────────────────────────────────────────
function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}
function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}
