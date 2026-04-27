import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, Plus, ClipboardCheck, Loader2, ScanBarcode, Check, AlertTriangle,
  Search, Archive, Eye,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getLocations, findVariantBySKU, setInventory } from "@/lib/shopify-api";

/* ─── Types ─── */
interface StocktakeRow {
  id: string;
  stocktake_number: string;
  name: string | null;
  location: string;
  scope: string;
  status: string;
  created_by: string | null;
  created_at: string;
  count_submitted_at: string | null;
  adjustments_applied_at: string | null;
  line_count?: number;
  counted_count?: number;
}

interface Line {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  shopify_inventory_item_id: string | null;
  product_title: string | null;
  variant_title: string | null;
  vendor: string | null;
  product_type: string | null;
  sku: string | null;
  barcode: string | null;
  expected_qty: number | null;
  counted_qty: number;
  is_counted: boolean;
  variance: number | null;
  push_status: string;
  push_error: string | null;
}

type Screen = "list" | "new" | "counting" | "variance";

/* ─── Beep ─── */
function playBeep() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880; gain.gain.value = 0.08;
    osc.start(); osc.stop(ctx.currentTime + 0.08);
    setTimeout(() => ctx.close(), 200);
  } catch { /* ignore */ }
}

export default function StocktakeModule({ onBack }: { onBack: () => void }) {
  const [screen, setScreen] = useState<Screen>("list");
  const [stocktakes, setStocktakes] = useState<StocktakeRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeRow, setActiveRow] = useState<StocktakeRow | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);

  // New stocktake form
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [formLocation, setFormLocation] = useState("");
  const [formName, setFormName] = useState("");
  const [formScope, setFormScope] = useState<"all" | "vendor" | "type">("all");
  const [formVendors, setFormVendors] = useState<string[]>([]);
  const [formTypes, setFormTypes] = useState<string[]>([]);
  const [formNotes, setFormNotes] = useState("");
  const [allVendors, setAllVendors] = useState<string[]>([]);
  const [allTypes, setAllTypes] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  // Counting screen
  const [scanMode, setScanMode] = useState(false);
  const [scanInput, setScanInput] = useState("");
  const [search, setSearch] = useState("");
  const [filterCounted, setFilterCounted] = useState<"all" | "counted" | "uncounted">("all");
  const [filterVendor, setFilterVendor] = useState<string>("__all__");
  const [submitting, setSubmitting] = useState(false);
  const [applying, setApplying] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);

  /* ─── Load list ─── */
  const loadList = useCallback(async () => {
    setLoading(true);
    const { data: stRows, error } = await supabase
      .from("stocktakes")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Failed to load stocktakes");
      setLoading(false); return;
    }

    // Get counts per stocktake
    const ids = (stRows || []).map(r => r.id);
    const counts: Record<string, { total: number; counted: number }> = {};
    if (ids.length > 0) {
      const { data: lineRows } = await supabase
        .from("stocktake_lines")
        .select("stocktake_id, is_counted")
        .in("stocktake_id", ids);
      (lineRows || []).forEach((l: { stocktake_id: string; is_counted: boolean }) => {
        const c = counts[l.stocktake_id] || { total: 0, counted: 0 };
        c.total += 1;
        if (l.is_counted) c.counted += 1;
        counts[l.stocktake_id] = c;
      });
    }

    setStocktakes((stRows || []).map(r => ({
      ...(r as StocktakeRow),
      line_count: counts[r.id]?.total ?? 0,
      counted_count: counts[r.id]?.counted ?? 0,
    })));
    setLoading(false);
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  /* ─── Load locations + vendors/types when opening "new" ─── */
  const openNew = async () => {
    setScreen("new");
    setFormLocation(""); setFormName(""); setFormScope("all");
    setFormVendors([]); setFormTypes([]); setFormNotes("");

    try {
      const locs = await getLocations();
      setLocations(locs.filter(l => l.active).map(l => ({ id: l.id, name: l.name })));
    } catch {
      toast.warning("Could not fetch Shopify locations — using fallback");
      setLocations([{ id: "default", name: "Main Store" }]);
    }

    const { data: prods } = await supabase
      .from("products")
      .select("vendor, product_type");
    const vSet = new Set<string>(); const tSet = new Set<string>();
    (prods || []).forEach((p: { vendor: string | null; product_type: string | null }) => {
      if (p.vendor) vSet.add(p.vendor);
      if (p.product_type) tSet.add(p.product_type);
    });
    setAllVendors([...vSet].sort());
    setAllTypes([...tSet].sort());
  };

  /* ─── Create stocktake ─── */
  const createStocktake = async () => {
    if (!formLocation) { toast.error("Pick a location"); return; }
    setCreating(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Not signed in"); setCreating(false); return; }

    // Build product filter
    let q = supabase
      .from("products")
      .select("id, title, vendor, product_type, variants(id, sku, barcode, color, size, shopify_variant_id, quantity)")
      .eq("user_id", user.id);
    if (formScope === "vendor" && formVendors.length > 0) q = q.in("vendor", formVendors);
    if (formScope === "type" && formTypes.length > 0) q = q.in("product_type", formTypes);

    const { data: prodRows, error: prodErr } = await q;
    if (prodErr) { toast.error("Failed to load catalog"); setCreating(false); return; }

    type ProdShape = {
      id: string; title: string; vendor: string | null; product_type: string | null;
      variants: { id: string; sku: string | null; barcode: string | null; color: string | null; size: string | null; shopify_variant_id: string | null; quantity: number }[];
    };
    const variants: { product: ProdShape; v: ProdShape["variants"][number] }[] = [];
    (prodRows as ProdShape[] | null || []).forEach(p => {
      (p.variants || []).forEach(v => variants.push({ product: p, v }));
    });

    if (variants.length === 0) {
      toast.error("No variants found in scope");
      setCreating(false); return;
    }

    // Insert stocktake parent
    const { data: st, error: stErr } = await supabase
      .from("stocktakes")
      .insert({
        user_id: user.id,
        location: formLocation,
        name: formName || null,
        scope: formScope === "all" ? "all" : formScope,
        scope_vendors: formVendors,
        scope_product_types: formTypes,
        notes: formNotes || null,
        status: "in_progress",
        created_by: user.email || null,
      } as never)
      .select()
      .single();
    if (stErr || !st) {
      toast.error("Failed to create stocktake: " + (stErr?.message ?? ""));
      setCreating(false); return;
    }

    // Insert lines (chunk to avoid limits)
    const stocktakeId = (st as { id: string }).id;
    const linePayload = variants.map(({ product, v }) => ({
      user_id: user.id,
      stocktake_id: stocktakeId,
      product_id: product.id,
      variant_id: v.shopify_variant_id || v.id,
      product_title: product.title,
      variant_title: [v.color, v.size].filter(Boolean).join(" / ") || null,
      vendor: product.vendor,
      product_type: product.product_type,
      sku: v.sku,
      barcode: v.barcode,
      expected_qty: v.quantity ?? 0, // local mirror; refreshed at submit time if available
      counted_qty: 0,
      is_counted: false,
      push_status: "pending",
    }));

    const CHUNK = 500;
    for (let i = 0; i < linePayload.length; i += CHUNK) {
      const slice = linePayload.slice(i, i + CHUNK);
      const { error: lErr } = await supabase.from("stocktake_lines").insert(slice as never);
      if (lErr) {
        toast.error(`Failed to insert lines (${i}): ${lErr.message}`);
        setCreating(false); return;
      }
    }

    toast.success(`Created ${(st as { stocktake_number: string }).stocktake_number} with ${variants.length} variants`);
    setCreating(false);
    await loadList();
    openStocktake(stocktakeId);
  };

  /* ─── Open a stocktake (counting / variance view) ─── */
  const openStocktake = async (id: string) => {
    setActiveId(id);
    setLinesLoading(true);

    const { data: st } = await supabase.from("stocktakes").select("*").eq("id", id).single();
    setActiveRow(st as StocktakeRow);

    const { data: ls, error } = await supabase
      .from("stocktake_lines")
      .select("*")
      .eq("stocktake_id", id)
      .order("product_title", { ascending: true });

    if (error) { toast.error("Failed to load lines"); setLinesLoading(false); return; }
    setLines((ls || []).map(l => ({
      id: (l as { id: string }).id,
      product_id: (l as { product_id: string | null }).product_id,
      variant_id: (l as { variant_id: string | null }).variant_id,
      shopify_inventory_item_id: (l as { shopify_inventory_item_id: string | null }).shopify_inventory_item_id ?? null,
      product_title: (l as { product_title: string | null }).product_title,
      variant_title: (l as { variant_title: string | null }).variant_title,
      vendor: (l as { vendor: string | null }).vendor,
      product_type: (l as { product_type: string | null }).product_type,
      sku: (l as { sku: string | null }).sku,
      barcode: (l as { barcode: string | null }).barcode,
      expected_qty: (l as { expected_qty: number | null }).expected_qty,
      counted_qty: (l as { counted_qty: number }).counted_qty || 0,
      is_counted: (l as { is_counted: boolean }).is_counted ?? false,
      variance: (l as { variance: number | null }).variance ?? null,
      push_status: (l as { push_status: string }).push_status || "pending",
      push_error: (l as { push_error: string | null }).push_error,
    })));
    setLinesLoading(false);

    const status = (st as { status: string } | null)?.status;
    if (status === "in_progress") setScreen("counting");
    else setScreen("variance");
  };

  /* ─── Counting actions ─── */
  const updateLineLocal = (lineId: string, patch: Partial<Line>) => {
    setLines(prev => prev.map(l => l.id === lineId ? { ...l, ...patch } : l));
  };

  const persistLine = async (lineId: string, patch: { counted_qty?: number; is_counted?: boolean }) => {
    await supabase.from("stocktake_lines").update(patch as never).eq("id", lineId);
  };

  const handleCountChange = (lineId: string, val: string) => {
    const n = parseInt(val, 10);
    const qty = isNaN(n) ? 0 : n;
    updateLineLocal(lineId, { counted_qty: qty, is_counted: true });
    persistLine(lineId, { counted_qty: qty, is_counted: true });
  };

  const handleScan = async (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const match = lines.find(l => l.barcode === code || l.sku === code);
    if (!match) {
      toast.error(`Not found: ${code}`);
      return;
    }
    const newQty = (match.counted_qty || 0) + 1;
    updateLineLocal(match.id, { counted_qty: newQty, is_counted: true });
    persistLine(match.id, { counted_qty: newQty, is_counted: true });
    playBeep();
    toast.success(`+1 ${match.product_title} (${newQty})`);
    setScanInput("");
    // refocus
    setTimeout(() => scanInputRef.current?.focus(), 0);
  };

  /* ─── Submit count ─── */
  const submitCount = async () => {
    if (!activeId) return;
    setSubmitting(true);
    // Compute variance per line and persist
    const updates = lines.map(l => ({
      id: l.id,
      variance: (l.counted_qty || 0) - (l.expected_qty ?? 0),
    }));
    // Variance is a generated column — already computed by DB. We just mark submission.
    await supabase
      .from("stocktakes")
      .update({ status: "count_completed", count_submitted_at: new Date().toISOString() } as never)
      .eq("id", activeId);

    // Refresh local state
    setLines(prev => prev.map(l => ({
      ...l,
      variance: (l.counted_qty || 0) - (l.expected_qty ?? 0),
    })));
    setSubmitting(false);
    setScreen("variance");
    await loadList();
    toast.success("Count submitted — variances revealed");
    void updates;
  };

  /* ─── Apply adjustments to Shopify ─── */
  const applyAdjustments = async () => {
    if (!activeId || !activeRow) return;
    setApplying(true);

    const variancesToPush = lines.filter(l => (l.variance ?? 0) !== 0);
    if (variancesToPush.length === 0) {
      toast.info("No variances to push");
      await supabase
        .from("stocktakes")
        .update({ status: "adjustments_applied", adjustments_applied_at: new Date().toISOString() } as never)
        .eq("id", activeId);
      setApplying(false);
      await loadList();
      setScreen("list");
      return;
    }

    let okCount = 0; let errCount = 0;
    for (const line of variancesToPush) {
      try {
        // Resolve inventory_item_id (lazy — store back when found)
        let invItem = line.shopify_inventory_item_id;
        if (!invItem && line.sku) {
          const match = await findVariantBySKU(line.sku);
          invItem = match?.inventory_item_id || null;
          if (invItem) {
            await supabase
              .from("stocktake_lines")
              .update({ shopify_inventory_item_id: invItem } as never)
              .eq("id", line.id);
          }
        }
        if (!invItem) throw new Error("No inventory_item_id");

        await setInventory(activeRow.location, invItem, line.counted_qty);
        await supabase
          .from("stocktake_lines")
          .update({ push_status: "success", push_error: null } as never)
          .eq("id", line.id);
        updateLineLocal(line.id, { push_status: "success", push_error: null });
        okCount += 1;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        await supabase
          .from("stocktake_lines")
          .update({ push_status: "error", push_error: msg } as never)
          .eq("id", line.id);
        updateLineLocal(line.id, { push_status: "error", push_error: msg });
        errCount += 1;
      }
      // Throttle slightly to be polite to Shopify
      await new Promise(r => setTimeout(r, 250));
    }

    // Write a stock_adjustments summary row
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      try {
        await supabase.from("inventory_adjustments").insert({
          user_id: user.id,
          location: activeRow.location,
          adjustment_qty: variancesToPush.reduce((s, l) => s + (l.variance ?? 0), 0),
          reason: `Stocktake #${activeRow.stocktake_number}`,
          product_title: `Stocktake covering ${variancesToPush.length} variant(s)`,
        } as never);
      } catch { /* non-fatal */ }
    }

    await supabase
      .from("stocktakes")
      .update({
        status: "adjustments_applied",
        adjustments_applied_at: new Date().toISOString(),
      } as never)
      .eq("id", activeId);

    setApplying(false);
    await loadList();
    toast.success(`Applied: ${okCount} ok, ${errCount} errors`);
  };

  /* ─── Archive ─── */
  const archiveStocktake = async (id: string) => {
    if (!confirm("Archive this stocktake?")) return;
    await supabase.from("stocktakes").update({ status: "archived" } as never).eq("id", id);
    await loadList();
  };

  /* ─── Filtered lines ─── */
  const filteredLines = useMemo(() => {
    let out = lines;
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter(l =>
        (l.product_title || "").toLowerCase().includes(q) ||
        (l.sku || "").toLowerCase().includes(q) ||
        (l.barcode || "").toLowerCase().includes(q));
    }
    if (filterCounted === "counted") out = out.filter(l => l.is_counted);
    else if (filterCounted === "uncounted") out = out.filter(l => !l.is_counted);
    if (filterVendor !== "__all__") out = out.filter(l => l.vendor === filterVendor);
    return out;
  }, [lines, search, filterCounted, filterVendor]);

  const vendorsInStocktake = useMemo(() => {
    const s = new Set<string>();
    lines.forEach(l => { if (l.vendor) s.add(l.vendor); });
    return [...s].sort();
  }, [lines]);

  const countedCount = lines.filter(l => l.is_counted).length;
  const totalCount = lines.length;
  const progress = totalCount > 0 ? Math.round((countedCount / totalCount) * 100) : 0;

  /* ─── Variance summary ─── */
  const varianceSummary = useMemo(() => {
    const withVar = lines.filter(l => (l.variance ?? 0) !== 0);
    const over = lines.reduce((s, l) => s + Math.max(0, l.variance ?? 0), 0);
    const under = lines.reduce((s, l) => s + Math.min(0, l.variance ?? 0), 0);
    return { count: withVar.length, over, under };
  }, [lines]);

  /* ─── Status badge ─── */
  const statusBadge = (s: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      in_progress: { label: "In Progress", cls: "bg-blue-500/10 text-blue-700 border-blue-500/30" },
      count_completed: { label: "Count Completed", cls: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
      adjustments_applied: { label: "Adjustments Applied", cls: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" },
      archived: { label: "Archived", cls: "bg-muted text-muted-foreground" },
      draft: { label: "Draft", cls: "bg-muted text-muted-foreground" },
    };
    const m = map[s] || { label: s, cls: "bg-muted text-muted-foreground" };
    return <Badge variant="outline" className={m.cls}>{m.label}</Badge>;
  };

  /* ─── Render: List ─── */
  if (screen === "list") {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <ClipboardCheck className="w-6 h-6 text-primary" /> Stocktakes
              </h1>
              <p className="text-sm text-muted-foreground">Count physical inventory and reconcile with Shopify</p>
            </div>
          </div>
          <Button onClick={openNew}>
            <Plus className="w-4 h-4 mr-1" /> New Stocktake
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
            ) : stocktakes.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">No stocktakes yet — create your first one</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stocktake #</TableHead>
                    <TableHead>Date Started</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Progress</TableHead>
                    <TableHead>Created By</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stocktakes.map(s => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono">{s.stocktake_number || s.id.slice(0, 8)}</TableCell>
                      <TableCell>{new Date(s.created_at).toLocaleDateString()}</TableCell>
                      <TableCell>{s.location}</TableCell>
                      <TableCell>{statusBadge(s.status)}</TableCell>
                      <TableCell className="text-sm">{s.counted_count ?? 0} / {s.line_count ?? 0}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{s.created_by || "—"}</TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button size="sm" variant="ghost" onClick={() => openStocktake(s.id)}>
                          {s.status === "in_progress" ? "Continue" : <><Eye className="w-3.5 h-3.5 mr-1" />View</>}
                        </Button>
                        {s.status !== "archived" && (
                          <Button size="sm" variant="ghost" onClick={() => archiveStocktake(s.id)}>
                            <Archive className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ─── Render: New Stocktake ─── */
  if (screen === "new") {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setScreen("list")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to list
        </Button>
        <Card>
          <CardHeader><CardTitle>New Stocktake — Setup</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Location *</Label>
              <Select value={formLocation} onValueChange={setFormLocation}>
                <SelectTrigger><SelectValue placeholder="Pick a location" /></SelectTrigger>
                <SelectContent>
                  {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Stocktake name (optional)</Label>
              <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. End of month April 2026" />
            </div>
            <div>
              <Label>Scope</Label>
              <Select value={formScope} onValueChange={(v: "all" | "vendor" | "type") => setFormScope(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All products</SelectItem>
                  <SelectItem value="vendor">By vendor</SelectItem>
                  <SelectItem value="type">By product type</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {formScope === "vendor" && (
              <div>
                <Label>Vendors</Label>
                <div className="border rounded-md p-2 max-h-48 overflow-y-auto space-y-1">
                  {allVendors.map(v => (
                    <label key={v} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={formVendors.includes(v)} onChange={e => {
                        setFormVendors(prev => e.target.checked ? [...prev, v] : prev.filter(x => x !== v));
                      }} />
                      {v}
                    </label>
                  ))}
                </div>
              </div>
            )}
            {formScope === "type" && (
              <div>
                <Label>Product types</Label>
                <div className="border rounded-md p-2 max-h-48 overflow-y-auto space-y-1">
                  {allTypes.map(t => (
                    <label key={t} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={formTypes.includes(t)} onChange={e => {
                        setFormTypes(prev => e.target.checked ? [...prev, t] : prev.filter(x => x !== t));
                      }} />
                      {t}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div>
              <Label>Notes (optional)</Label>
              <Textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} rows={3} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setScreen("list")}>Cancel</Button>
              <Button onClick={createStocktake} disabled={creating || !formLocation}>
                {creating ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Creating…</> : "Create & start counting"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ─── Render: Counting ─── */
  if (screen === "counting" && activeRow) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => { setScreen("list"); setActiveId(null); }}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <div>
              <h2 className="text-xl font-bold">{activeRow.stocktake_number} — Counting</h2>
              <p className="text-xs text-muted-foreground">
                {activeRow.location} · {activeRow.name || "Untitled"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant={scanMode ? "default" : "outline"} size="sm" onClick={() => {
              setScanMode(s => !s);
              setTimeout(() => scanInputRef.current?.focus(), 50);
            }}>
              <ScanBarcode className="w-4 h-4 mr-1" /> {scanMode ? "Scan: ON" : "Scan Mode"}
            </Button>
            <Button onClick={submitCount} disabled={submitting || countedCount === 0}>
              {submitting ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Submitting…</> : "Submit Count"}
            </Button>
          </div>
        </div>

        {scanMode && (
          <Card className="border-primary/40 bg-primary/5">
            <CardContent className="p-3 flex items-center gap-3">
              <ScanBarcode className="w-5 h-5 text-primary" />
              <Input
                ref={scanInputRef}
                value={scanInput}
                onChange={e => setScanInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleScan(scanInput);
                  }
                }}
                placeholder="Scan a barcode (or SKU) and press Enter"
                className="font-mono text-base"
                autoFocus
                data-barcode-ignore
              />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-3 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by product, SKU, barcode" className="pl-8" />
              </div>
              <Select value={filterCounted} onValueChange={(v: "all" | "counted" | "uncounted") => setFilterCounted(v)}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="counted">Counted only</SelectItem>
                  <SelectItem value="uncounted">Not counted</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterVendor} onValueChange={setFilterVendor}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All vendors</SelectItem>
                  {vendorsInStocktake.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="text-sm font-medium ml-auto">
                {countedCount} / {totalCount} counted
              </div>
            </div>
            <Progress value={progress} className="h-2" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {linesLoading ? (
              <div className="p-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Variant</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Barcode</TableHead>
                    {/* Expected qty hidden during counting — anti-anchoring */}
                    <TableHead className="w-32">Count qty</TableHead>
                    <TableHead className="w-24">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLines.map(l => (
                    <TableRow key={l.id} className={l.is_counted ? "bg-emerald-500/5" : ""}>
                      <TableCell>
                        {l.is_counted ? <Check className="w-4 h-4 text-emerald-600" /> : null}
                      </TableCell>
                      <TableCell className="font-medium">{l.product_title}</TableCell>
                      <TableCell>{l.variant_title || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{l.sku || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{l.barcode || "—"}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          value={l.is_counted ? l.counted_qty : ""}
                          onChange={e => handleCountChange(l.id, e.target.value)}
                          className="h-8 w-20 text-right"
                          placeholder="0"
                        />
                      </TableCell>
                      <TableCell>
                        {l.is_counted
                          ? <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/30">Counted</Badge>
                          : <Badge variant="outline" className="text-muted-foreground">Not counted</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ─── Render: Variance / Apply ─── */
  if (screen === "variance" && activeRow) {
    const varianceColor = (v: number | null) => {
      if (v === null) return "text-muted-foreground";
      if (v === 0) return "text-emerald-600";
      if (Math.abs(v) <= 5) return "text-amber-600";
      return "text-destructive";
    };
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => { setScreen("list"); setActiveId(null); }}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <div>
              <h2 className="text-xl font-bold">{activeRow.stocktake_number} — Variance Review</h2>
              <p className="text-xs text-muted-foreground">{activeRow.location} · {statusBadge(activeRow.status)}</p>
            </div>
          </div>
          {activeRow.status === "count_completed" && (
            <Button onClick={applyAdjustments} disabled={applying}>
              {applying ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Applying…</> : "Apply Adjustments to Shopify"}
            </Button>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Card><CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Variants with variance</div>
            <div className="text-2xl font-bold flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />{varianceSummary.count}
            </div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Total units over</div>
            <div className="text-2xl font-bold text-emerald-600">+{varianceSummary.over}</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Total units under</div>
            <div className="text-2xl font-bold text-destructive">{varianceSummary.under}</div>
          </CardContent></Card>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Variant</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Expected</TableHead>
                  <TableHead className="text-right">Counted</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead>Push</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map(l => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.product_title}</TableCell>
                    <TableCell>{l.variant_title || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{l.sku || "—"}</TableCell>
                    <TableCell className="text-right">{l.expected_qty ?? 0}</TableCell>
                    <TableCell className="text-right">{l.counted_qty}</TableCell>
                    <TableCell className={`text-right font-semibold ${varianceColor(l.variance)}`}>
                      {l.variance !== null ? (l.variance > 0 ? `+${l.variance}` : l.variance) : "—"}
                    </TableCell>
                    <TableCell>
                      {l.push_status === "success" && <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/30">✓</Badge>}
                      {l.push_status === "error" && <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30" title={l.push_error || ""}>Error</Badge>}
                      {l.push_status === "pending" && <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}
