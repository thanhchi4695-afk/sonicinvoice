import { useEffect, useMemo, useState, useCallback } from "react";
import { ArrowLeft, Loader2, Sparkles, ShoppingCart, RefreshCw, Search, Ban } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import LocationFilter from "@/components/LocationFilter";
import { useShopifyLocations } from "@/hooks/use-shopify-locations";
import { toast } from "sonner";
import { addAuditEntry } from "@/lib/audit-log";
import {
  buildSupplierDefaultMap,
  loadRestockOverrides,
  REFILL_ROW_BG,
  RESTOCK_STATUS_BADGE,
  RESTOCK_STATUS_EMOJI,
  RESTOCK_STATUS_LABEL,
  resolveRestockStatus,
  setRestockStatusBulk,
  type RestockStatus,
} from "@/lib/restock-status";

interface Props {
  onBack: () => void;
  onOpenPO?: () => void;
}

type Urgency = "critical" | "low" | "plan" | "none";

interface SupplierLeadInfo {
  profile_id: string;
  supplier_name: string;
  lead_time_days: number;
  restock_period_days: number;
  /** dirty flag — if true we save when user clicks "Save lead times" */
  dirty?: boolean;
}

interface RestockRow {
  key: string;                        // unique row key
  vendor: string;
  product_title: string;
  variant_title: string;
  sku: string | null;
  barcode: string | null;
  shopify_product_id: string | null;
  shopify_variant_id: string | null;
  available_qty: number;
  current_cost: number;
  sales_per_day: number;              // last 30d / 30
  lead_time: number;
  restock_period: number;
  suggested_qty: number;
  override_qty: number;
  days_to_depletion: number;          // Infinity when no sales
  urgency: Urgency;
}

const DEFAULT_LEAD = 14;
const DEFAULT_RESTOCK = 28;

const urgencyBadge: Record<Urgency, { label: string; cls: string; emoji: string }> = {
  critical: { label: "Critical", emoji: "🔴", cls: "bg-destructive/15 text-destructive border-destructive/30" },
  low:      { label: "Low",      emoji: "🟠", cls: "bg-warning/15 text-warning-foreground border-warning/30" },
  plan:     { label: "Plan",     emoji: "🟡", cls: "bg-secondary/30 text-secondary-foreground border-secondary/40" },
  none:     { label: "—",        emoji: "",   cls: "bg-muted text-muted-foreground" },
};

function urgencyFor(daysToDepletion: number): Urgency {
  if (!Number.isFinite(daysToDepletion)) return "plan";
  if (daysToDepletion <= 7) return "critical";
  if (daysToDepletion <= 14) return "low";
  if (daysToDepletion <= 30) return "plan";
  return "none";
}

function formatDays(d: number) {
  if (!Number.isFinite(d)) return "∞";
  return Math.max(0, Math.round(d)).toString();
}

export default function RestockSuggestionsPanel({ onBack, onOpenPO }: Props) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<RestockRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [vendorFilter, setVendorFilter] = useState<string[]>([]);
  const [urgencyFilter, setUrgencyFilter] = useState<"all" | Urgency>("all");
  const [minQty, setMinQty] = useState(1);
  const [search, setSearch] = useState("");
  const [supplierLeads, setSupplierLeads] = useState<Map<string, SupplierLeadInfo>>(new Map());
  const [savingLeads, setSavingLeads] = useState(false);

  const { selected: globalLocSelected, locations: globalLocs } = useShopifyLocations();
  const globalLocObj = useMemo(
    () => globalLocs.find((l) => l.id === globalLocSelected),
    [globalLocs, globalLocSelected],
  );

  // ── Load everything ───────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Not authenticated"); setLoading(false); return; }

      // 1. Catalog (current qty, cost, etc.)
      const { data: catalog } = await supabase
        .from("product_catalog_cache")
        .select("vendor, sku, barcode, product_title, variant_title, current_qty, current_cost, platform_product_id, platform_variant_id")
        .eq("user_id", user.id)
        .limit(20000);

      // 2. Sales last 30 days, joined to variants for SKU
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data: sales } = await supabase
        .from("sales_data")
        .select("quantity_sold, sold_at, variant_id, variants!inner(sku)")
        .eq("user_id", user.id)
        .gte("sold_at", since)
        .limit(50000);

      const sold30: Map<string, number> = new Map();
      (sales || []).forEach((s: any) => {
        const sku = s.variants?.sku;
        if (!sku) return;
        sold30.set(sku, (sold30.get(sku) || 0) + Number(s.quantity_sold || 0));
      });

      // 3. Supplier profiles → lead_time / restock_period
      const { data: profiles } = await supabase
        .from("supplier_profiles")
        .select("id, supplier_name, profile_data")
        .eq("user_id", user.id);

      const leadMap = new Map<string, SupplierLeadInfo>();
      (profiles || []).forEach((p: any) => {
        const pd = (p.profile_data || {}) as Record<string, any>;
        leadMap.set((p.supplier_name || "").toLowerCase(), {
          profile_id: p.id,
          supplier_name: p.supplier_name,
          lead_time_days: Number(pd.lead_time_days) > 0 ? Number(pd.lead_time_days) : DEFAULT_LEAD,
          restock_period_days: Number(pd.restock_period_days) > 0 ? Number(pd.restock_period_days) : DEFAULT_RESTOCK,
        });
      });
      setSupplierLeads(leadMap);

      // 4. Build restock rows
      const out: RestockRow[] = [];
      (catalog || []).forEach((c: any) => {
        const vendor = (c.vendor || "Unknown").toString();
        const lead = leadMap.get(vendor.toLowerCase())?.lead_time_days ?? DEFAULT_LEAD;
        const restock = leadMap.get(vendor.toLowerCase())?.restock_period_days ?? DEFAULT_RESTOCK;
        const available = Math.max(0, Number(c.current_qty || 0));
        const sold = c.sku ? (sold30.get(c.sku) || 0) : 0;
        const perDay = sold / 30;
        const suggested = Math.max(0, Math.ceil(perDay * (lead + restock) - available));
        if (suggested <= 0) return; // only show items needing restock
        const dtd = perDay > 0 ? available / perDay : Infinity;
        out.push({
          key: `${c.platform_variant_id || c.sku || c.product_title}-${c.variant_title || ""}`,
          vendor,
          product_title: c.product_title || "",
          variant_title: c.variant_title || "",
          sku: c.sku,
          barcode: c.barcode,
          shopify_product_id: c.platform_product_id,
          shopify_variant_id: c.platform_variant_id,
          available_qty: available,
          current_cost: Number(c.current_cost || 0),
          sales_per_day: perDay,
          lead_time: lead,
          restock_period: restock,
          suggested_qty: suggested,
          override_qty: suggested,
          days_to_depletion: dtd,
          urgency: urgencyFor(dtd),
        });
      });

      out.sort((a, b) => a.days_to_depletion - b.days_to_depletion);
      setRows(out);
    } catch (e: any) {
      toast.error(e.message || "Failed to load restock suggestions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Vendors list (for filter) ──
  const vendors = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => s.add(r.vendor));
    return Array.from(s).sort();
  }, [rows]);

  // ── Apply filters ──
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (vendorFilter.length && !vendorFilter.includes(r.vendor)) return false;
      if (urgencyFilter !== "all" && r.urgency !== urgencyFilter) return false;
      if ((r.override_qty ?? r.suggested_qty) < minQty) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !r.product_title.toLowerCase().includes(q) &&
          !r.vendor.toLowerCase().includes(q) &&
          !(r.sku || "").toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [rows, vendorFilter, urgencyFilter, minQty, search]);

  // Recalculate suggestion when supplier lead/restock changes locally
  const updateLead = (vendor: string, patch: Partial<SupplierLeadInfo>) => {
    const key = vendor.toLowerCase();
    setSupplierLeads((prev) => {
      const next = new Map(prev);
      const existing = next.get(key) ?? {
        profile_id: "",
        supplier_name: vendor,
        lead_time_days: DEFAULT_LEAD,
        restock_period_days: DEFAULT_RESTOCK,
      };
      next.set(key, { ...existing, ...patch, dirty: true });
      return next;
    });
    // recalc affected rows immediately
    setRows((prev) =>
      prev.map((r) => {
        if (r.vendor.toLowerCase() !== key) return r;
        const lead = patch.lead_time_days ?? r.lead_time;
        const restock = patch.restock_period_days ?? r.restock_period;
        const suggested = Math.max(0, Math.ceil(r.sales_per_day * (lead + restock) - r.available_qty));
        const overrideEqualsOldSuggestion = r.override_qty === r.suggested_qty;
        return {
          ...r,
          lead_time: lead,
          restock_period: restock,
          suggested_qty: suggested,
          override_qty: overrideEqualsOldSuggestion ? suggested : r.override_qty,
        };
      })
    );
  };

  const persistLeads = async () => {
    setSavingLeads(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const dirty = Array.from(supplierLeads.values()).filter((l) => l.dirty);
      for (const l of dirty) {
        if (l.profile_id) {
          // fetch existing profile_data, merge, write back
          const { data: existing } = await supabase
            .from("supplier_profiles")
            .select("profile_data")
            .eq("id", l.profile_id)
            .maybeSingle();
          const merged = {
            ...(existing?.profile_data as Record<string, any> || {}),
            lead_time_days: l.lead_time_days,
            restock_period_days: l.restock_period_days,
          };
          await supabase
            .from("supplier_profiles")
            .update({ profile_data: merged })
            .eq("id", l.profile_id);
        } else {
          await supabase.from("supplier_profiles").insert({
            user_id: user.id,
            supplier_name: l.supplier_name,
            profile_data: {
              lead_time_days: l.lead_time_days,
              restock_period_days: l.restock_period_days,
            } as any,
          });
        }
      }
      toast.success(`Saved lead times for ${dirty.length} supplier${dirty.length === 1 ? "" : "s"}`);
      addAuditEntry("restock_lead_save", `${dirty.length} supplier(s) updated`);
      // Clear dirty flags
      setSupplierLeads((prev) => {
        const next = new Map(prev);
        next.forEach((v, k) => next.set(k, { ...v, dirty: false }));
        return next;
      });
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    } finally {
      setSavingLeads(false);
    }
  };

  // ── Selection ──
  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((r) => r.key)));
  };
  const toggleOne = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // ── Create PO from selected ──
  const createPOFromSelected = () => {
    const lines = filtered.filter((r) => selected.has(r.key) && r.override_qty > 0);
    if (!lines.length) { toast.info("Select at least one line"); return; }
    // Group by vendor — if multiple vendors, send first only and warn
    const vendorsInSelection = Array.from(new Set(lines.map((l) => l.vendor)));
    if (vendorsInSelection.length > 1) {
      toast.warning(`Selection spans ${vendorsInSelection.length} vendors — only "${vendorsInSelection[0]}" will be added. Group your selection by vendor.`);
    }
    const vendor = vendorsInSelection[0];
    const seeded = lines
      .filter((l) => l.vendor === vendor)
      .map((l) => ({
        product_title: l.product_title,
        variant_title: l.variant_title || null,
        sku: l.sku,
        barcode: l.barcode,
        shopify_product_id: l.shopify_product_id,
        shopify_variant_id: l.shopify_variant_id,
        cost_price: l.current_cost,
        qty_ordered: l.override_qty,
        qty_received: 0,
        current_stock: l.available_qty,
      }));
    sessionStorage.setItem("restock_po_seed", JSON.stringify({
      vendor,
      lines: seeded,
      created_at: Date.now(),
    }));
    addAuditEntry("restock_create_po", `Seeding PO with ${seeded.length} lines for ${vendor}`);
    if (onOpenPO) onOpenPO();
    else window.dispatchEvent(new CustomEvent("sonic:set-flow", { detail: "purchase_orders" }));
  };

  // ── Affected supplier list (lead-time editor) ──
  const affectedSuppliers = useMemo(() => {
    const s = new Map<string, SupplierLeadInfo>();
    filtered.forEach((r) => {
      const key = r.vendor.toLowerCase();
      if (!s.has(key)) {
        s.set(key, supplierLeads.get(key) ?? {
          profile_id: "",
          supplier_name: r.vendor,
          lead_time_days: r.lead_time,
          restock_period_days: r.restock_period,
        });
      }
    });
    return Array.from(s.values()).sort((a, b) => a.supplier_name.localeCompare(b.supplier_name));
  }, [filtered, supplierLeads]);

  const dirtyCount = Array.from(supplierLeads.values()).filter((l) => l.dirty).length;

  return (
    <TooltipProvider>
    <div className="p-6 max-w-[1400px] mx-auto space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
          <h1 className="text-xl font-semibold">Restock Suggestions</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />Refresh
          </Button>
          <Button size="sm" onClick={createPOFromSelected} disabled={!selected.size}>
            <ShoppingCart className="w-3.5 h-3.5 mr-1" />Create PO from selected ({selected.size})
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Based on current stock levels and sales velocity, these products need reordering. Review and create a PO directly from this list. Suggested qty = (sales/day × (lead + restock period)) − available qty.
      </p>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <Label className="text-xs">Search</Label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input className="pl-8 h-9" placeholder="Title, SKU, vendor…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Vendor</Label>
            <Select
              value={vendorFilter.length === 1 ? vendorFilter[0] : "all"}
              onValueChange={(v) => setVendorFilter(v === "all" ? [] : [v])}
            >
              <SelectTrigger className="h-9"><SelectValue placeholder="All vendors" /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="all">All vendors ({vendors.length})</SelectItem>
                {vendors.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Urgency</Label>
            <Select value={urgencyFilter} onValueChange={(v) => setUrgencyFilter(v as any)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="critical">🔴 Critical (≤7 days)</SelectItem>
                <SelectItem value="low">🟠 Low (8–14 days)</SelectItem>
                <SelectItem value="plan">🟡 Plan (15–30 days)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Min suggested qty</Label>
            <Input type="number" min={0} className="h-9" value={minQty} onChange={(e) => setMinQty(Number(e.target.value) || 0)} />
          </div>
          <LocationFilter size="sm" />
        </CardContent>
      </Card>

      {/* Supplier lead-time editor */}
      {affectedSuppliers.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>Supplier lead times ({affectedSuppliers.length})</span>
              {dirtyCount > 0 && (
                <Button size="sm" onClick={persistLeads} disabled={savingLeads}>
                  {savingLeads ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
                  Save {dirtyCount} change{dirtyCount === 1 ? "" : "s"}
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {affectedSuppliers.map((s) => (
                <div key={s.supplier_name} className="flex items-center gap-2 border border-border rounded-md p-2">
                  <span className="text-xs font-medium flex-1 truncate">{s.supplier_name}</span>
                  <div className="flex items-center gap-1">
                    <Label className="text-[10px] text-muted-foreground">Lead</Label>
                    <Input
                      type="number" min={0} className="h-7 w-14 text-right text-xs"
                      value={s.lead_time_days}
                      onChange={(e) => updateLead(s.supplier_name, { lead_time_days: Number(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <Label className="text-[10px] text-muted-foreground">Restock</Label>
                    <Input
                      type="number" min={0} className="h-7 w-14 text-right text-xs"
                      value={s.restock_period_days}
                      onChange={(e) => updateLead(s.supplier_name, { restock_period_days: Number(e.target.value) || 0 })}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardContent className="pt-4">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading restock suggestions…
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-12">
              No restock suggestions. Either everything is well stocked, or there's no recent sales data to forecast against.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <Checkbox
                        checked={selected.size > 0 && selected.size === filtered.length}
                        onCheckedChange={toggleAll}
                      />
                    </TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Variant</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Avail</TableHead>
                    <TableHead className="text-right">Sales/day</TableHead>
                    <TableHead className="text-right">Lead</TableHead>
                    <TableHead className="text-right">Restock</TableHead>
                    <TableHead className="text-right">Suggested</TableHead>
                    <TableHead className="text-right">Override</TableHead>
                    <TableHead className="text-right">Days left</TableHead>
                    <TableHead>Urgency</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.slice(0, 500).map((r) => {
                    const u = urgencyBadge[r.urgency];
                    return (
                      <TableRow key={r.key}>
                        <TableCell>
                          <Checkbox checked={selected.has(r.key)} onCheckedChange={() => toggleOne(r.key)} />
                        </TableCell>
                        <TableCell className="text-xs">{r.vendor}</TableCell>
                        <TableCell className="text-xs max-w-[240px] truncate" title={r.product_title}>{r.product_title}</TableCell>
                        <TableCell className="text-xs">{r.variant_title || "—"}</TableCell>
                        <TableCell className="text-xs font-mono">{r.sku || "—"}</TableCell>
                        <TableCell className="text-right text-xs">{r.available_qty}</TableCell>
                        <TableCell className="text-right text-xs">{r.sales_per_day.toFixed(2)}</TableCell>
                        <TableCell className="text-right text-xs">{r.lead_time}</TableCell>
                        <TableCell className="text-right text-xs">{r.restock_period}</TableCell>
                        <TableCell className="text-right text-xs">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="font-semibold cursor-help underline decoration-dotted">{r.suggested_qty}</span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <span className="text-xs">
                                Suggested {r.suggested_qty} = ceil({r.sales_per_day.toFixed(2)} × ({r.lead_time}+{r.restock_period}) − {r.available_qty})
                              </span>
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number" min={0}
                            className="h-7 w-20 text-right ml-auto text-xs"
                            value={r.override_qty}
                            onChange={(e) => {
                              const v = Number(e.target.value) || 0;
                              setRows((prev) => prev.map((x) => x.key === r.key ? { ...x, override_qty: v } : x));
                            }}
                          />
                        </TableCell>
                        <TableCell className="text-right text-xs">{formatDays(r.days_to_depletion)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={u.cls + " text-[10px]"}>{u.emoji} {u.label}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {filtered.length > 500 && (
                <p className="text-xs text-muted-foreground text-center mt-2">Showing first 500 of {filtered.length}. Narrow filters to see more.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {globalLocSelected !== "all" && globalLocObj && (
        <p className="text-[11px] text-muted-foreground italic">
          Note: location filter ({globalLocObj.name}) is informational here — restock totals are computed across all locations from the catalog cache.
        </p>
      )}
    </div>
    </TooltipProvider>
  );
}
