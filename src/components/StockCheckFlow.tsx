import { useState, useEffect, useCallback } from "react";
import WhatsNextSuggestions from "@/components/WhatsNextSuggestions";
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
import { getEnabledPOSPlatforms } from "@/components/POSConnectionPanel";
import {
  normaliseXProduct, normaliseRItem, toShopifyVariantFormat,
} from "@/lib/pos-normaliser";
import Papa from "papaparse";

interface StockCheckFlowProps {
  lineItems: InvoiceLineItem[];
  onBack: () => void;
  onComplete?: () => void;
  onStartFlow?: (flow: string) => void;
}

type Screen = "checking" | "review" | "applying" | "done";

interface ApplyStatus {
  key: string;
  label: string;
  status: "pending" | "running" | "success" | "error";
  error?: string;
}

const StockCheckFlow = ({ lineItems, onBack, onComplete, onStartFlow }: StockCheckFlowProps) => {
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
  const [searchProduct, setSearchProduct] = useState<{ groupKey: string; query: string; results: ShopifyVariant[]; loading: boolean } | null>(null);

  const hasLineItems = lineItems.length > 0;

  // ── Run batch lookup on mount ──
  useEffect(() => {
    if (!hasLineItems) return; // #11 — don't run a lookup with nothing to match
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
    const enabledPlatforms = getEnabledPOSPlatforms();
    const hasShopify = enabledPlatforms.includes("shopify") || enabledPlatforms.length === 0;
    const hasLSX = enabledPlatforms.includes("lightspeed_x");
    const hasLSR = enabledPlatforms.includes("lightspeed_r");

    const lookupItems = lineItems.map(item => ({
      sku: item.sku || undefined,
      barcode: item.barcode || undefined,
      stylePrefix: extractStylePrefix(item.styleNumber || item.sku) || undefined,
      titleQuery: item.styleName ? `title:${item.styleName.split(" ").slice(0, 3).join(" ")}${item.brand ? ` vendor:${item.brand}` : ""}` : undefined,
      styleName: item.styleName || undefined,
      styleNumber: item.styleNumber || undefined,
    }));

    const BATCH = 10;
    let allShopifyVariants: ShopifyVariant[] = [];

    for (let i = 0; i < lookupItems.length; i += BATCH) {
      const batch = lookupItems.slice(i, i + BATCH);
      const lookupPromises: Promise<void>[] = [];

      // ── Shopify lookup (existing path) ──
      if (hasShopify) {
        lookupPromises.push(
          supabase.functions.invoke("shopify-proxy", {
            body: { action: "batch_lookup", lookup_items: batch },
          }).then(({ data, error }) => {
            if (!error && data?.variants) {
              const mapped = mapVariants(data.variants);
              allShopifyVariants = deduplicateVariants([...allShopifyVariants, ...mapped]);
            }
          }).catch(() => {})
        );
      }

      // ── Lightspeed X-Series lookup ──
      if (hasLSX) {
        lookupPromises.push(
          supabase.functions.invoke("pos-proxy", {
            body: { action: "batch_lookup", platform: "lightspeed_x", items: batch },
          }).then(({ data, error }) => {
            if (!error && data?.results) {
              const normalised = (data.results as { found: Record<string, unknown>[] }[])
                .flatMap(r => (r.found || []).map(normaliseXProduct));
              const asVariants = toShopifyVariantFormat(normalised) as unknown as ShopifyVariant[];
              allShopifyVariants = deduplicateVariants([...allShopifyVariants, ...asVariants]);
            }
          }).catch(() => {})
        );
      }

      // ── Lightspeed R-Series lookup ──
      if (hasLSR) {
        lookupPromises.push(
          supabase.functions.invoke("pos-proxy", {
            body: { action: "batch_lookup", platform: "lightspeed_r", items: batch },
          }).then(({ data, error }) => {
            if (!error && data?.results) {
              const normalised = (data.results as { found: Record<string, unknown>[] }[])
                .flatMap(r => (r.found || []).map(normaliseRItem));
              const asVariants = toShopifyVariantFormat(normalised) as unknown as ShopifyVariant[];
              allShopifyVariants = deduplicateVariants([...allShopifyVariants, ...asVariants]);
            }
          }).catch(() => {})
        );
      }

      await Promise.all(lookupPromises);

      const done = Math.min(i + BATCH, lookupItems.length);
      setCheckProgress({ done, total: lookupItems.length });

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
          const refillSizes = g.sizes.filter(s => s.matchedVariant);
          const changes = refillSizes.map(s => ({
            inventoryItemId: s.matchedVariant!.inventoryItemId,
            locationId: locationGid,
            delta: s.qty,
          }));

          if (changes.length > 0) {
            // ── Audit: record BEFORE Shopify call (with idempotency) ──
            const { data: { user } } = await supabase.auth.getUser();
            const locationName = locations.find(l => l.id === selectedLocation)?.name || null;
            const beforeSnapshot = refillSizes.map(s => ({
              inventoryItemId: s.matchedVariant!.inventoryItemId,
              sku: s.matchedVariant!.sku,
              size: s.size,
              currentQty: s.matchedVariant!.inventoryQty ?? null,
              delta: s.qty,
            }));
            const idempotencyKey = await hashIdempotency({
              groupKey: `${g.styleNumber}::${g.colour}`,
              location: locationGid,
              changes,
            });

            let auditRunId: string | null = null;
            if (user) {
              const { data: inserted, error: insertErr } = await supabase
                .from("inventory_import_runs")
                .insert({
                  user_id: user.id,
                  run_status: "started",
                  source: "stock_check_refill",
                  supplier_name: g.brand || null,
                  location_id: selectedLocation || null,
                  location_name: locationName,
                  group_key: `${g.styleNumber}::${g.colour}`,
                  style_number: g.styleNumber || null,
                  colour: g.colour || null,
                  product_title: g.styleName || null,
                  shopify_product_id: g.matchedProduct?.id || null,
                  changes,
                  before_snapshot: beforeSnapshot,
                  units_applied: g.totalQty,
                  idempotency_key: idempotencyKey,
                })
                .select("id")
                .maybeSingle();

              if (insertErr) {
                // Duplicate idempotency key → skip the actual Shopify call
                if (insertErr.code === "23505") {
                  throw new Error("Already applied (idempotent skip)");
                }
                console.warn("audit insert failed", insertErr);
              } else {
                auditRunId = inserted?.id || null;
              }
            }

            const { error } = await supabase.functions.invoke("shopify-proxy", {
              body: { action: "graphql_adjust_inventory", inventory_changes: changes },
            });

            if (error) {
              if (auditRunId) {
                await supabase
                  .from("inventory_import_runs")
                  .update({
                    run_status: "error",
                    error_message: error.message,
                    completed_at: new Date().toISOString(),
                  })
                  .eq("id", auditRunId);
              }
              throw new Error(error.message);
            }

            // ── Audit: record AFTER success ──
            if (auditRunId) {
              const afterSnapshot = beforeSnapshot.map(b => ({
                ...b,
                newQty: b.currentQty != null ? b.currentQty + b.delta : null,
              }));
              await supabase
                .from("inventory_import_runs")
                .update({
                  run_status: "success",
                  after_snapshot: afterSnapshot,
                  completed_at: new Date().toISOString(),
                })
                .eq("id", auditRunId);
            }
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
    // When switching to refill without a matched product, open search
    if (outcome === "refill" && !g.matchedProduct) {
      setSearchProduct({ groupKey: key, query: "", results: [], loading: false });
    }
  };

  const searchShopifyProducts = async (query: string) => {
    if (!searchProduct || query.length < 2) return;
    setSearchProduct(prev => prev ? { ...prev, query, loading: true, results: [] } : null);
    try {
      const { data, error } = await supabase.functions.invoke("shopify-proxy", {
        body: { action: "batch_lookup", lookup_items: [{ titleQuery: `title:${query}` }] },
      });
      if (!error && data?.variants) {
        const mapped = mapVariants(data.variants);
        // Deduplicate by product id
        const seenProducts = new Set<string>();
        const unique = mapped.filter(v => {
          if (seenProducts.has(v.product.id)) return false;
          seenProducts.add(v.product.id);
          return true;
        });
        setSearchProduct(prev => prev ? { ...prev, results: unique, loading: false } : null);
      } else {
        setSearchProduct(prev => prev ? { ...prev, results: [], loading: false } : null);
      }
    } catch {
      setSearchProduct(prev => prev ? { ...prev, results: [], loading: false } : null);
    }
  };

  const selectSearchedProduct = (variant: ShopifyVariant) => {
    if (!searchProduct) return;
    const key = searchProduct.groupKey;
    // Determine current override for this group
    const currentOverride = overrides.get(key);
    // Find the group to check if colour exists in selected product
    const targetGroup = groups.find(g => `${g.styleNumber}::${g.colour}` === key);
    const colourExistsInProduct = targetGroup && variant.product.variants.some(pv =>
      (pv.option1 || "").toLowerCase().includes(targetGroup.colour.toLowerCase())
    );
    // If colour exists → refill; otherwise preserve current override or default to new_colour
    const resolvedOutcome: MatchOutcome = colourExistsInProduct ? "refill" : (currentOverride === "refill" ? "new_colour" : (currentOverride || "new_colour"));

    setGroups(prev => prev.map(g => {
      const gKey = `${g.styleNumber}::${g.colour}`;
      if (gKey === key) {
        return {
          ...g,
          matchedProduct: variant.product,
          sizes: g.sizes.map(s => {
            const matched = variant.product.variants.find(pv =>
              (pv.option1 || "").toLowerCase().includes(g.colour.toLowerCase()) &&
              (pv.option2 || "").trim().toUpperCase() === s.size.trim().toUpperCase()
            );
            return matched ? { ...s, matchedVariant: matched } : s;
          }),
          outcome: resolvedOutcome,
          reasons: [`Manually matched to "${variant.product.title}"`],
          suggestedAction: resolvedOutcome === "refill"
            ? `Add ${g.totalQty} units to "${variant.product.title}"`
            : `Add "${g.colour}" as new variant to "${variant.product.title}"`,
        };
      }
      return g;
    }));
    setOverrides(new Map(overrides).set(key, resolvedOutcome));
    setSearchProduct(null);
    toast.success(`Matched to "${variant.product.title}"${resolvedOutcome === "new_colour" ? " (new colour)" : ""}`);
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

  // ── EMPTY STATE: opened without an invoice context (#11) ──
  if (!hasLineItems) {
    return (
      <div className="px-4 pt-6 pb-24 max-w-2xl mx-auto animate-fade-in">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="w-5 h-5" /></Button>
          <h1 className="text-xl font-semibold">Invoice stock check</h1>
        </div>
        <div className="bg-card rounded-lg border border-dashed border-border p-8 text-center">
          <Search className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-base font-semibold mb-1">Pick an invoice to stock-check</p>
          <p className="text-sm text-muted-foreground mb-5 max-w-md mx-auto">
            Stock check compares one invoice against your catalog and POS so you can see
            refills vs new colours vs new products at a glance.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="teal" onClick={() => onStartFlow?.("processing_history")}>
              Open recent invoices
            </Button>
            <Button variant="outline" onClick={() => onStartFlow?.("invoice")}>
              Upload a new invoice
            </Button>
          </div>
        </div>
      </div>
    );
  }

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
            {locations.length === 0 ? (
              <span className="text-xs text-warning bg-warning/10 border border-warning/30 rounded px-2 py-1">
                No locations found — connect a POS in Settings
              </span>
            ) : (
              <select
                value={selectedLocation}
                onChange={e => setSelectedLocation(e.target.value)}
                className="bg-muted rounded px-2 py-1 text-sm border"
              >
                <option value="">Select location…</option>
                {locations.map(l => (
                  <option key={l.id} value={l.id}>{l.name}{l.active ? "" : " (inactive)"}</option>
                ))}
              </select>
            )}
          </div>
          <Button
            onClick={() => {
              if (!selectedLocation) {
                toast.error("Choose a destination location before applying changes.");
                return;
              }
              if (groups.length === 0) {
                toast.error("Nothing to apply — no items detected.");
                return;
              }
              applyChanges();
            }}
            disabled={groups.length === 0 || !selectedLocation}
          >
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
                <TableHead>POS match</TableHead>
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
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium">{g.matchedProduct.title}</span>
                            <PlatformBadge platform={g.platform} />
                          </div>
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
                      <div className="space-y-1.5">
                        <select
                          value={outcome}
                          onChange={e => setOutcome(g, e.target.value as MatchOutcome)}
                          className="text-xs bg-muted rounded px-1.5 py-1 border w-full"
                        >
                          <option value="refill">Refill</option>
                          <option value="new_colour">New colour</option>
                          <option value="new_product">New product</option>
                        </select>
                        {(outcome === "refill" || outcome === "new_colour") && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-[10px] h-6 w-full"
                            onClick={() => setSearchProduct({ groupKey: `${g.styleNumber}::${g.colour}`, query: "", results: [], loading: false })}
                          >
                            <Search className="w-3 h-3 mr-1" /> {g.matchedProduct ? "Change product" : "Find product"}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Product search overlay */}
        {searchProduct && (
          <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-start justify-center pt-[10vh]">
            <div className="bg-card border rounded-xl shadow-lg w-full max-w-lg mx-4 max-h-[70vh] flex flex-col">
              <div className="flex items-center gap-2 p-4 border-b">
                <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                <Input
                  autoFocus
                  placeholder="Search Shopify products by name…"
                  value={searchProduct.query}
                  onChange={e => {
                    const q = e.target.value;
                    setSearchProduct(prev => prev ? { ...prev, query: q } : null);
                  }}
                  onKeyDown={e => {
                    if (e.key === "Enter") searchShopifyProducts(searchProduct.query);
                  }}
                  className="border-0 shadow-none focus-visible:ring-0 h-8"
                />
                <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={() => setSearchProduct(null)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="px-4 pt-2 pb-1">
                <Button
                  size="sm"
                  variant="secondary"
                  className="text-xs"
                  disabled={searchProduct.query.length < 2 || searchProduct.loading}
                  onClick={() => searchShopifyProducts(searchProduct.query)}
                >
                  {searchProduct.loading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Search className="w-3 h-3 mr-1" />}
                  Search
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {searchProduct.loading && (
                  <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin mr-2" /> Searching…
                  </div>
                )}
                {!searchProduct.loading && searchProduct.results.length === 0 && searchProduct.query.length >= 2 && (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    No products found. Try different search terms.
                  </div>
                )}
                {searchProduct.results.map(v => (
                  <button
                    key={v.product.id}
                    onClick={() => selectSearchedProduct(v)}
                    className="w-full text-left rounded-lg border p-3 hover:bg-accent transition-colors"
                  >
                    <div className="font-medium text-sm">{v.product.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{v.product.vendor}{v.product.productType ? ` — ${v.product.productType}` : ""}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {v.product.variants.length} variant{v.product.variants.length !== 1 ? "s" : ""}
                      {v.product.variants.slice(0, 3).map(pv => pv.sku).filter(Boolean).length > 0 && (
                        <> · SKUs: {v.product.variants.slice(0, 3).map(pv => pv.sku).filter(Boolean).join(", ")}</>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
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

      {onStartFlow && (
        <WhatsNextSuggestions
          completedFlow="stock_check"
          context={{ hasNewProducts: applySummary.newProducts > 0, hasNewVariants: applySummary.newColours > 0, hasRefills: applySummary.refills > 0 }}
          onStartFlow={onStartFlow}
          onGoHome={onBack}
        />
      )}
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

function PlatformBadge({ platform }: { platform?: "shopify" | "lightspeed_x" | "lightspeed_r" }) {
  if (!platform) return null;
  const labels: Record<string, { label: string; icon: string }> = {
    shopify: { label: "Shopify", icon: "🛍" },
    lightspeed_x: { label: "LS X-Series", icon: "⚡" },
    lightspeed_r: { label: "LS R-Series", icon: "💡" },
  };
  const info = labels[platform] || { label: platform, icon: "📦" };
  return (
    <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 font-normal gap-0.5">
      <span>{info.icon}</span> {info.label}
    </Badge>
  );
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
