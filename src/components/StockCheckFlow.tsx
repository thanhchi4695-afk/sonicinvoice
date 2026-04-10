import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import {
  ArrowLeft, Check, Loader2, AlertTriangle, Package, Plus,
  RefreshCw, Download, ChevronDown, Search, X, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  matchAllLineItems, groupMatchResults,
  type InvoiceLineItem, type ShopifyVariant, type MatchResult,
  type GroupedMatch, type MatchOutcome,
} from "@/lib/stock-matcher";
import { getLocations } from "@/lib/shopify-api";
import Papa from "papaparse";

interface StockCheckFlowProps {
  lineItems: InvoiceLineItem[];
  onBack: () => void;
  onComplete?: () => void;
}

type Screen = "checking" | "review" | "applying" | "done";

interface ApplyStatus {
  key: string;
  label: string;
  status: "pending" | "running" | "success" | "error";
  error?: string;
}

const StockCheckFlow = ({ lineItems, onBack, onComplete }: StockCheckFlowProps) => {
  const [screen, setScreen] = useState<Screen>("checking");
  const [checkProgress, setCheckProgress] = useState<{ done: number; total: number }>({ done: 0, total: lineItems.length });
  const [checkStatuses, setCheckStatuses] = useState<Map<number, { status: string; label: string }>>(new Map());
  const [matchResults, setMatchResults] = useState<MatchResult[]>([]);
  const [groups, setGroups] = useState<GroupedMatch[]>([]);
  const [overrides, setOverrides] = useState<Map<string, MatchOutcome>>(new Map());
  const [locations, setLocations] = useState<{ id: string; name: string; active: boolean }[]>([]);
  const [selectedLocation, setSelectedLocation] = useState("");
  const [applyStatuses, setApplyStatuses] = useState<ApplyStatus[]>([]);
  const [applySummary, setApplySummary] = useState<{ refills: number; newColours: number; newProducts: number; skipped: number; totalUnits: number }>({ refills: 0, newColours: 0, newProducts: 0, skipped: 0, totalUnits: 0 });
  const [searchProduct, setSearchProduct] = useState<{ groupKey: string; query: string; results: ShopifyVariant[] } | null>(null);

  // ── Run batch lookup on mount ──
  useEffect(() => {
    runBatchLookup();
    loadLocations();
  }, []);

  const loadLocations = async () => {
    try {
      const locs = await getLocations();
      setLocations(locs);
      const active = locs.find(l => l.active);
      if (active) setSelectedLocation(active.id);
      else if (locs.length > 0) setSelectedLocation(locs[0].id);
    } catch {
      // Non-fatal — user can still review
    }
  };

  const runBatchLookup = async () => {
    setScreen("checking");
    const lookupItems = lineItems.map(item => ({
      sku: item.sku || undefined,
      barcode: item.barcode || undefined,
      stylePrefix: extractStylePrefix(item.styleNumber || item.sku) || undefined,
      titleQuery: item.styleName ? `title:${item.styleName.split(" ").slice(0, 3).join(" ")}${item.brand ? ` vendor:${item.brand}` : ""}` : undefined,
    }));

    // Show progress per item
    const BATCH = 10;
    let allShopifyVariants: ShopifyVariant[] = [];

    for (let i = 0; i < lookupItems.length; i += BATCH) {
      const batch = lookupItems.slice(i, i + BATCH);
      try {
        const { data, error } = await supabase.functions.invoke("shopify-proxy", {
          body: { action: "batch_lookup", lookup_items: batch },
        });
        if (!error && data?.variants) {
          const mapped = mapVariants(data.variants);
          allShopifyVariants = deduplicateVariants([...allShopifyVariants, ...mapped]);
        }
      } catch {
        // Continue with what we have
      }

      const done = Math.min(i + BATCH, lookupItems.length);
      setCheckProgress({ done, total: lookupItems.length });

      // Update per-item statuses
      const newStatuses = new Map(checkStatuses);
      for (let j = i; j < done; j++) {
        newStatuses.set(j, { status: "done", label: lineItems[j].styleName || lineItems[j].sku });
      }
      setCheckStatuses(new Map(newStatuses));
    }

    // Run matching
    const results = matchAllLineItems(lineItems, allShopifyVariants);
    setMatchResults(results);
    const grouped = groupMatchResults(results);
    setGroups(grouped);
    setScreen("review");
  };

  // ── Apply all changes ──
  const applyChanges = useCallback(async () => {
    setScreen("applying");
    const locationGid = selectedLocation.startsWith("gid://") ? selectedLocation : `gid://shopify/Location/${selectedLocation}`;

    const statuses: ApplyStatus[] = groups.map((g, i) => ({
      key: `${g.styleNumber}::${g.colour}::${i}`,
      label: `${g.styleName} — ${g.colour}`,
      status: "pending" as const,
    }));
    setApplyStatuses([...statuses]);

    let refills = 0, newColours = 0, newProducts = 0, skipped = 0, totalUnits = 0;

    // Sort: refills first, then new colours, then new products
    const sorted = [...groups].sort((a, b) => {
      const order: Record<MatchOutcome, number> = { refill: 0, new_colour: 1, new_product: 2 };
      const oa = overrides.get(`${a.styleNumber}::${a.colour}`) || a.outcome;
      const ob = overrides.get(`${b.styleNumber}::${b.colour}`) || b.outcome;
      return order[oa] - order[ob];
    });

    for (let i = 0; i < sorted.length; i++) {
      const g = sorted[i];
      const key = `${g.styleNumber}::${g.colour}::${groups.indexOf(g)}`;
      const outcome = overrides.get(`${g.styleNumber}::${g.colour}`) || g.outcome;
      const idx = statuses.findIndex(s => s.key === key);
      if (idx >= 0) { statuses[idx].status = "running"; setApplyStatuses([...statuses]); }

      try {
        if (outcome === "refill") {
          // Adjust inventory for each size
          const changes = g.sizes
            .filter(s => s.matchedVariant)
            .map(s => ({
              inventoryItemId: s.matchedVariant!.inventoryItemId,
              locationId: locationGid,
              delta: s.qty,
            }));

          if (changes.length > 0) {
            const { error } = await supabase.functions.invoke("shopify-proxy", {
              body: { action: "graphql_adjust_inventory", inventory_changes: changes },
            });
            if (error) throw new Error(error.message);
          }
          refills++;
          totalUnits += g.totalQty;
        } else if (outcome === "new_colour" && g.matchedProduct) {
          // Create new variants on existing product
          const newVariants = g.sizes.map(s => ({
            price: String(s.lineItem.rrp || "0.00"),
            sku: s.lineItem.sku || undefined,
            barcode: s.lineItem.barcode || undefined,
            options: [g.colour, s.size],
            qty: s.qty,
            locationId: locationGid,
            cost: s.lineItem.wholesale ? String(s.lineItem.wholesale) : undefined,
          }));

          const { error } = await supabase.functions.invoke("shopify-proxy", {
            body: {
              action: "graphql_create_variant",
              product_id_gid: g.matchedProduct.id,
              new_variants: newVariants,
            },
          });
          if (error) throw new Error(error.message);
          newColours++;
          totalUnits += g.totalQty;
        } else if (outcome === "new_product") {
          // Create new product via existing graphql_create_product
          const variants = g.sizes.map(s => ({
            option1: g.colour,
            option2: s.size,
            price: String(s.lineItem.rrp || "0.00"),
            sku: s.lineItem.sku || "",
            cost: s.lineItem.wholesale ? String(s.lineItem.wholesale) : undefined,
            inventory_management: "shopify",
          }));

          const product = {
            title: g.styleName || `${g.brand} ${g.styleNumber}`,
            vendor: g.brand,
            product_type: g.sizes[0]?.lineItem.productType || "",
            status: "draft",
            tags: [g.brand, g.sizes[0]?.lineItem.season, g.sizes[0]?.lineItem.collection].filter(Boolean).join(", "),
            options: [{ name: "Colour" }, { name: "Size" }],
            variants,
            images: g.imageUrl ? [{ src: g.imageUrl }] : [],
          };

          const { error } = await supabase.functions.invoke("shopify-proxy", {
            body: { action: "graphql_create_product", product },
          });
          if (error) throw new Error(error.message);
          newProducts++;
          totalUnits += g.totalQty;
        }

        if (idx >= 0) { statuses[idx].status = "success"; setApplyStatuses([...statuses]); }
      } catch (err) {
        if (idx >= 0) {
          statuses[idx].status = "error";
          statuses[idx].error = err instanceof Error ? err.message : "Unknown error";
          setApplyStatuses([...statuses]);
        }
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 500));
    }

    setApplySummary({ refills, newColours, newProducts, skipped, totalUnits });
    setScreen("done");
  }, [groups, overrides, selectedLocation]);

  const getOutcome = (g: GroupedMatch): MatchOutcome =>
    overrides.get(`${g.styleNumber}::${g.colour}`) || g.outcome;

  const setOutcome = (g: GroupedMatch, outcome: MatchOutcome) => {
    const key = `${g.styleNumber}::${g.colour}`;
    setOverrides(new Map(overrides).set(key, outcome));
  };

  const outcomeCounts = groups.reduce(
    (acc, g) => {
      const o = getOutcome(g);
      acc[o] = (acc[o] || 0) + 1;
      return acc;
    },
    {} as Record<MatchOutcome, number>
  );

  const downloadReport = () => {
    const rows = groups.map(g => ({
      Style: g.styleNumber,
      Name: g.styleName,
      Brand: g.brand,
      Colour: g.colour,
      Outcome: getOutcome(g),
      Confidence: g.confidence,
      Sizes: g.sizes.map(s => `${s.size}(×${s.qty})`).join(", "),
      TotalQty: g.totalQty,
      MatchedProduct: g.matchedProduct?.title || "",
      Action: g.suggestedAction,
    }));
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `stock-check-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  // ── SCREEN: CHECKING ──
  if (screen === "checking") {
    return (
      <div className="px-4 pt-4 pb-24 max-w-4xl mx-auto animate-fade-in">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="w-5 h-5" /></Button>
          <h1 className="text-xl font-semibold">Checking your Shopify store…</h1>
        </div>
        <Progress value={(checkProgress.done / checkProgress.total) * 100} className="mb-4 h-2" />
        <p className="text-sm text-muted-foreground mb-4">{checkProgress.done} / {checkProgress.total} items checked</p>
        <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
          {lineItems.map((item, i) => {
            const st = checkStatuses.get(i);
            return (
              <div key={i} className="flex items-center gap-2 text-sm py-1">
                {st?.status === "done" ? (
                  <Check className="w-4 h-4 text-primary shrink-0" />
                ) : (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />
                )}
                <span className="truncate">{item.styleName || item.sku} — {item.colour} / {item.size}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── SCREEN: REVIEW ──
  if (screen === "review") {
    return (
      <div className="px-4 pt-4 pb-24 max-w-5xl mx-auto animate-fade-in">
        <div className="flex items-center gap-3 mb-4">
          <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="w-5 h-5" /></Button>
          <h1 className="text-xl font-semibold">Invoice stock check</h1>
        </div>

        {/* Summary bar */}
        <div className="bg-card rounded-lg border p-4 mb-4 flex flex-wrap items-center gap-3">
          <Badge className="bg-primary/15 text-primary border-primary/30">{outcomeCounts.refill || 0} Refills</Badge>
          <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30">{outcomeCounts.new_colour || 0} New colours</Badge>
          <Badge className="bg-rose-500/15 text-rose-600 border-rose-500/30">{outcomeCounts.new_product || 0} New products</Badge>
          <div className="flex-1" />
          {/* Location selector */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Location:</span>
            <select
              value={selectedLocation}
              onChange={e => setSelectedLocation(e.target.value)}
              className="bg-muted rounded px-2 py-1 text-sm border"
            >
              {locations.map(l => (
                <option key={l.id} value={l.id}>{l.name}{l.active ? "" : " (inactive)"}</option>
              ))}
            </select>
          </div>
          <Button onClick={applyChanges} disabled={groups.length === 0}>
            <Check className="w-4 h-4 mr-1" /> Apply all changes
          </Button>
        </div>

        {/* Review table */}
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Status</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Sizes & Qty</TableHead>
                <TableHead>Shopify match</TableHead>
                <TableHead className="w-20">Conf.</TableHead>
                <TableHead className="w-36">Override</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g, i) => {
                const outcome = getOutcome(g);
                const isLowConf = g.confidence < 70;
                return (
                  <TableRow key={i} className={isLowConf ? "bg-purple-500/5" : ""}>
                    <TableCell>
                      <OutcomeBadge outcome={outcome} />
                      {isLowConf && (
                        <div className="flex items-center gap-1 mt-1 text-[10px] text-purple-500">
                          <AlertTriangle className="w-3 h-3" /> Review
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">{g.styleName || g.styleNumber}</div>
                      <div className="text-xs text-muted-foreground">{g.brand} — {g.colour}</div>
                      {g.imageUrl && (
                        <img src={g.imageUrl} alt="" className="w-10 h-10 rounded mt-1 object-cover" />
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="text-xs space-y-0.5">
                        {g.sizes.map((s, si) => (
                          <span key={si} className="inline-block bg-muted rounded px-1.5 py-0.5 mr-1">
                            {s.size} ×{s.qty}
                          </span>
                        ))}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">Total: {g.totalQty} units</div>
                    </TableCell>
                    <TableCell>
                      {g.matchedProduct ? (
                        <div className="text-xs">
                          <div className="font-medium">{g.matchedProduct.title}</div>
                          {outcome === "refill" && g.sizes[0]?.matchedVariant && (
                            <div className="text-muted-foreground">
                              Current stock: {g.sizes[0].matchedVariant.inventoryQty}
                              → {g.sizes[0].matchedVariant.inventoryQty + g.totalQty}
                            </div>
                          )}
                          {outcome === "new_colour" && (
                            <div className="text-muted-foreground">
                              New colour: {g.colour}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">No match — new product</span>
                      )}
                      <div className="text-[10px] text-muted-foreground mt-1">
                        {g.reasons[0]}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <div className="flex">
                          {[...Array(5)].map((_, ci) => (
                            <div
                              key={ci}
                              className={`w-1.5 h-1.5 rounded-full mr-0.5 ${ci < Math.round(g.confidence / 20) ? "bg-primary" : "bg-muted"}`}
                            />
                          ))}
                        </div>
                        <span className="text-xs">{g.confidence}%</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <select
                        value={outcome}
                        onChange={e => setOutcome(g, e.target.value as MatchOutcome)}
                        className="text-xs bg-muted rounded px-1.5 py-1 border w-full"
                      >
                        <option value="refill">Refill</option>
                        <option value="new_colour">New colour</option>
                        <option value="new_product">New product</option>
                      </select>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }

  // ── SCREEN: APPLYING ──
  if (screen === "applying") {
    const done = applyStatuses.filter(s => s.status === "success" || s.status === "error").length;
    return (
      <div className="px-4 pt-4 pb-24 max-w-4xl mx-auto animate-fade-in">
        <h1 className="text-xl font-semibold mb-4">Applying changes…</h1>
        <Progress value={(done / applyStatuses.length) * 100} className="mb-4 h-2" />
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {applyStatuses.map(s => (
            <div key={s.key} className="flex items-center gap-2 text-sm py-1">
              {s.status === "success" && <Check className="w-4 h-4 text-primary shrink-0" />}
              {s.status === "error" && <X className="w-4 h-4 text-destructive shrink-0" />}
              {s.status === "running" && <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />}
              {s.status === "pending" && <div className="w-4 h-4 rounded-full border border-muted-foreground/30 shrink-0" />}
              <span className="truncate">{s.label}</span>
              {s.error && <span className="text-xs text-destructive ml-auto">{s.error}</span>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── SCREEN: DONE ──
  return (
    <div className="px-4 pt-4 pb-24 max-w-4xl mx-auto animate-fade-in">
      <div className="text-center py-8">
        <div className="w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center mx-auto mb-4">
          <Check className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-xl font-semibold mb-2">Stock check complete</h1>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-card border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-primary">{applySummary.refills}</div>
          <div className="text-xs text-muted-foreground">Inventory updates</div>
        </div>
        <div className="bg-card border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-amber-500">{applySummary.newColours}</div>
          <div className="text-xs text-muted-foreground">New colours added</div>
        </div>
        <div className="bg-card border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-rose-500">{applySummary.newProducts}</div>
          <div className="text-xs text-muted-foreground">New products created</div>
        </div>
        <div className="bg-card border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold">{applySummary.totalUnits}</div>
          <div className="text-xs text-muted-foreground">Total units</div>
        </div>
      </div>

      {applyStatuses.some(s => s.status === "error") && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 mb-4">
          <p className="text-sm font-medium text-destructive mb-2">Some items had errors:</p>
          {applyStatuses.filter(s => s.status === "error").map(s => (
            <div key={s.key} className="text-xs text-destructive/80">{s.label}: {s.error}</div>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="outline" onClick={downloadReport}>
          <Download className="w-4 h-4 mr-1" /> Download report
        </Button>
        <Button onClick={() => { onComplete?.(); onBack(); }}>
          Done
        </Button>
      </div>
    </div>
  );
};

// ── Sub-components ──

function OutcomeBadge({ outcome }: { outcome: MatchOutcome }) {
  switch (outcome) {
    case "refill":
      return <Badge className="bg-primary/15 text-primary border-primary/30 text-[10px]">Refill</Badge>;
    case "new_colour":
      return <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30 text-[10px]">New colour</Badge>;
    case "new_product":
      return <Badge className="bg-rose-500/15 text-rose-600 border-rose-500/30 text-[10px]">New product</Badge>;
  }
}

// ── Helpers ──

function extractStylePrefix(sku: string): string {
  if (!sku) return "";
  const parts = sku.split(/[-_]/);
  return parts.length > 1 ? parts[0] : "";
}

function mapVariants(raw: unknown[]): ShopifyVariant[] {
  return (raw || []).map((v: unknown) => {
    const vObj = v as Record<string, unknown>;
    const prod = vObj.product as Record<string, unknown> | undefined;
    const prodVariants = (prod?.variants || []) as unknown[];
    return {
      id: String(vObj.id || ""),
      sku: String(vObj.sku || ""),
      barcode: String(vObj.barcode || ""),
      title: String(vObj.title || ""),
      inventoryItemId: String(vObj.inventoryItemId || ""),
      inventoryQty: Number(vObj.inventoryQty || 0),
      price: String(vObj.price || "0"),
      option1: String(vObj.option1 || ""),
      option2: String(vObj.option2 || ""),
      image: vObj.image ? String(vObj.image) : undefined,
      product: prod ? {
        id: String(prod.id || ""),
        title: String(prod.title || ""),
        vendor: String(prod.vendor || ""),
        productType: String(prod.productType || ""),
        tags: Array.isArray(prod.tags) ? prod.tags.map(String) : [],
        options: (prod.options || []) as { name: string; values: string[] }[],
        variants: prodVariants.map((pv: unknown) => {
          const pvObj = pv as Record<string, unknown>;
          return {
            id: String(pvObj.id || ""),
            sku: String(pvObj.sku || ""),
            barcode: String(pvObj.barcode || ""),
            title: String(pvObj.title || ""),
            inventoryItemId: String(pvObj.inventoryItemId || ""),
            inventoryQty: Number(pvObj.inventoryQty || 0),
            price: String(pvObj.price || "0"),
            option1: String(pvObj.option1 || ""),
            option2: String(pvObj.option2 || ""),
            image: pvObj.image ? String(pvObj.image) : undefined,
            product: null as unknown as ShopifyVariant["product"],
          };
        }),
      } : {
        id: "", title: "", vendor: "", productType: "", tags: [], options: [],
        variants: [],
      },
    };
  });
}

function deduplicateVariants(variants: ShopifyVariant[]): ShopifyVariant[] {
  const seen = new Set<string>();
  return variants.filter(v => {
    if (seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  });
}

export default StockCheckFlow;
