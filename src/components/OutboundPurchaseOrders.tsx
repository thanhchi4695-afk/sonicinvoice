import { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Plus, Trash2, Search, FileText, Send, ChevronLeft, Eye, Sparkles, Archive,
  Copy as CopyIcon, ArrowDownToLine, Settings as SettingsIcon, Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { addAuditEntry } from "@/lib/audit-log";
import {
  adjustInventory, findVariantBySKU, getConnection, getLocations,
} from "@/lib/shopify-api";

// ── Types ──────────────────────────────────────────────────
type POStatus = "draft" | "sent" | "partial" | "received" | "archived";

interface POLine {
  id: string;
  product_title: string;
  variant_title: string | null;
  sku: string | null;
  barcode: string | null;
  shopify_product_id: string | null;
  shopify_variant_id: string | null;
  cost_price: number;
  qty_ordered: number;
  qty_received: number;
  current_stock?: number;
}

interface PO {
  id: string;
  po_number: string;
  supplier_id: string | null;
  supplier_name: string;
  supplier_email: string | null;
  ship_to_location: string | null;
  po_date: string | null;
  expected_date: string | null;
  invoice_number: string | null;
  notes_supplier: string | null;
  notes_internal: string | null;
  status: POStatus;
  subtotal: number;
  shipping: number;
  tax: number;
  grand_total: number;
  total_cost: number;
  created_at: string;
  sent_at: string | null;
  archived_at: string | null;
  lines?: POLine[];
}

interface POSettings {
  store_name: string;
  store_address: string;
  store_abn: string;
  logo_url: string;
  payment_terms: string;
  email_subject_template: string;
  email_body_template: string;
  default_lead_time_days: number;
}

const DEFAULT_SETTINGS: POSettings = {
  store_name: "",
  store_address: "",
  store_abn: "",
  logo_url: "",
  payment_terms: "Net 30 days",
  email_subject_template: "Purchase Order {{po_number}} from {{store_name}}",
  email_body_template: "Hi {{supplier_name}},\n\nPlease find attached our purchase order {{po_number}} with an expected delivery date of {{expected_date}}.\n\nGrand total: {{grand_total}}.\n\nThank you,\n{{store_name}}",
  default_lead_time_days: 14,
};

const LOCATIONS = ["Darwin City", "Gateway"];

const fmtCurrency = (n: number) => `$${n.toFixed(2)}`;

const statusBadge = (s: POStatus) => {
  const map: Record<POStatus, string> = {
    draft: "bg-muted text-muted-foreground",
    sent: "bg-primary/15 text-primary",
    partial: "bg-warning/15 text-warning-foreground",
    received: "bg-success/15 text-success",
    archived: "bg-muted text-muted-foreground opacity-70",
  };
  return map[s] ?? map.draft;
};

interface Props {
  onBack: () => void;
}

export default function OutboundPurchaseOrders({ onBack }: Props) {
  const [view, setView] = useState<"list" | "edit" | "receive" | "settings">("list");
  const [pos, setPOs] = useState<PO[]>([]);
  const [activePO, setActivePO] = useState<PO | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterVendor, setFilterVendor] = useState<string>("");
  const [filterFrom, setFilterFrom] = useState<string>("");
  const [filterTo, setFilterTo] = useState<string>("");

  const loadPOs = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("purchase_orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      toast.error("Failed to load purchase orders");
    } else {
      setPOs((data || []) as unknown as PO[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadPOs();
  }, [loadPOs]);

  // Honor a "restock_po_seed" handoff from RestockSuggestionsPanel
  useEffect(() => {
    if (view !== "list") return;
    try {
      const raw = sessionStorage.getItem("restock_po_seed");
      if (!raw) return;
      const seed = JSON.parse(raw);
      if (!seed?.lines?.length) return;
      sessionStorage.removeItem("restock_po_seed");
      const today = new Date().toISOString().slice(0, 10);
      setActivePO({
        id: "",
        po_number: "",
        supplier_id: null,
        supplier_name: seed.vendor || "",
        supplier_email: "",
        ship_to_location: LOCATIONS[0],
        po_date: today,
        expected_date: "",
        invoice_number: "",
        notes_supplier: "",
        notes_internal: `Seeded from Restock Suggestions on ${today}`,
        status: "draft",
        subtotal: 0, shipping: 0, tax: 0, grand_total: 0, total_cost: 0,
        created_at: "", sent_at: null, archived_at: null,
        lines: seed.lines.map((l: any) => ({
          id: crypto.randomUUID(),
          product_title: l.product_title || "",
          variant_title: l.variant_title ?? null,
          sku: l.sku ?? null,
          barcode: l.barcode ?? null,
          shopify_product_id: l.shopify_product_id ?? null,
          shopify_variant_id: l.shopify_variant_id ?? null,
          cost_price: Number(l.cost_price ?? 0),
          qty_ordered: Number(l.qty_ordered ?? 0),
          qty_received: 0,
          current_stock: Number(l.current_stock ?? 0),
        })),
      });
      setView("edit");
      toast.success(`Loaded ${seed.lines.length} restock line${seed.lines.length === 1 ? "" : "s"} for ${seed.vendor || "vendor"}`);
    } catch {
      /* ignore malformed seeds */
    }
  }, [view]);

  const filteredPOs = useMemo(() => {
    return pos.filter(p => {
      if (filterStatus !== "all" && p.status !== filterStatus) return false;
      if (filterVendor && !(p.supplier_name || "").toLowerCase().includes(filterVendor.toLowerCase())) return false;
      if (filterFrom && p.po_date && p.po_date < filterFrom) return false;
      if (filterTo && p.po_date && p.po_date > filterTo) return false;
      return true;
    });
  }, [pos, filterStatus, filterVendor, filterFrom, filterTo]);

  const openEdit = async (po: PO | null) => {
    if (po) {
      const { data: lines } = await supabase
        .from("purchase_order_lines")
        .select("*")
        .eq("purchase_order_id", po.id);
      const mapped: POLine[] = (lines || []).map((l: any) => ({
        id: l.id,
        product_title: l.product_title || "",
        variant_title: l.variant_title || [l.color, l.size].filter(Boolean).join(" / ") || null,
        sku: l.sku,
        barcode: l.barcode,
        shopify_product_id: l.shopify_product_id,
        shopify_variant_id: l.shopify_variant_id,
        cost_price: Number(l.expected_cost ?? 0),
        qty_ordered: Number(l.expected_qty ?? 0),
        qty_received: Number(l.received_qty ?? 0),
      }));
      setActivePO({ ...po, lines: mapped });
    } else {
      const today = new Date().toISOString().slice(0, 10);
      setActivePO({
        id: "",
        po_number: "",
        supplier_id: null,
        supplier_name: "",
        supplier_email: "",
        ship_to_location: LOCATIONS[0],
        po_date: today,
        expected_date: "",
        invoice_number: "",
        notes_supplier: "",
        notes_internal: "",
        status: "draft",
        subtotal: 0, shipping: 0, tax: 0, grand_total: 0, total_cost: 0,
        created_at: "", sent_at: null, archived_at: null,
        lines: [],
      });
    }
    setView("edit");
  };

  const cloneP = async (po: PO) => {
    const { data: lines } = await supabase
      .from("purchase_order_lines").select("*").eq("purchase_order_id", po.id);
    setActivePO({
      ...po, id: "", po_number: "", status: "draft",
      created_at: "", sent_at: null, archived_at: null,
      po_date: new Date().toISOString().slice(0, 10),
      lines: (lines || []).map((l: any) => ({
        id: crypto.randomUUID(),
        product_title: l.product_title || "",
        variant_title: l.variant_title,
        sku: l.sku, barcode: l.barcode,
        shopify_product_id: l.shopify_product_id,
        shopify_variant_id: l.shopify_variant_id,
        cost_price: Number(l.expected_cost ?? 0),
        qty_ordered: Number(l.expected_qty ?? 0),
        qty_received: 0,
      })),
    });
    setView("edit");
    toast.success(`Cloned ${po.po_number}`);
  };

  const archivePO = async (po: PO) => {
    const { error } = await supabase
      .from("purchase_orders")
      .update({ status: "archived", archived_at: new Date().toISOString() })
      .eq("id", po.id);
    if (error) return toast.error(error.message);
    toast.success(`Archived ${po.po_number}`);
    addAuditEntry("po_archive", `Archived ${po.po_number}`);
    loadPOs();
  };

  // ── List View ──────────────────────────────────────────
  if (view === "list") {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onBack}><ChevronLeft className="w-4 h-4 mr-1" />Back</Button>
            <h1 className="text-xl font-bold font-display">Purchase Orders</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setView("settings")}><SettingsIcon className="w-4 h-4 mr-1" />Settings</Button>
            <Button onClick={() => openEdit(null)}><Plus className="w-4 h-4 mr-1" />New Purchase Order</Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 p-3 bg-card border border-border rounded-lg">
          <div>
            <Label className="text-xs">Status</Label>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className="block h-9 px-2 rounded-md border border-input bg-background text-sm">
              <option value="all">All</option>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="partial">Partially Received</option>
              <option value="received">Received</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div>
            <Label className="text-xs">Vendor</Label>
            <Input value={filterVendor} onChange={e => setFilterVendor(e.target.value)}
              placeholder="Search vendor" className="h-9 w-48" />
          </div>
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="h-9" />
          </div>
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading…</div>
          ) : filteredPOs.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <FileText className="w-10 h-10 mx-auto mb-2 opacity-40" />
              No purchase orders yet. Click "New Purchase Order" to create one.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">PO #</th>
                  <th className="px-3 py-2 text-left">Vendor</th>
                  <th className="px-3 py-2 text-left">Created</th>
                  <th className="px-3 py-2 text-left">Expected</th>
                  <th className="px-3 py-2 text-right">Lines</th>
                  <th className="px-3 py-2 text-right">Units</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPOs.map(po => (
                  <POListRow key={po.id} po={po}
                    onView={() => openEdit(po)}
                    onClone={() => cloneP(po)}
                    onArchive={() => archivePO(po)}
                    onReceive={() => { openEdit(po).then(() => setView("receive")); }}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  if (view === "settings") {
    return <POSettingsView onBack={() => setView("list")} />;
  }

  if (view === "receive" && activePO) {
    return <ReceiveView po={activePO} onBack={() => { setView("list"); loadPOs(); }} />;
  }

  if (view === "edit" && activePO) {
    return <EditView po={activePO} onBack={() => { setView("list"); loadPOs(); }} onReceive={() => setView("receive")} />;
  }

  return null;
}

// ─────────────────────────────────────────────────────────
// List row with line/unit aggregation
// ─────────────────────────────────────────────────────────
function POListRow({
  po, onView, onClone, onArchive, onReceive,
}: { po: PO; onView: () => void; onClone: () => void; onArchive: () => void; onReceive: () => void }) {
  const [agg, setAgg] = useState<{ lines: number; units: number } | null>(null);
  useEffect(() => {
    let mounted = true;
    supabase.from("purchase_order_lines")
      .select("expected_qty", { count: "exact" })
      .eq("purchase_order_id", po.id)
      .then(({ data, count }) => {
        if (!mounted) return;
        const units = (data || []).reduce((s, r: any) => s + Number(r.expected_qty || 0), 0);
        setAgg({ lines: count ?? data?.length ?? 0, units });
      });
    return () => { mounted = false; };
  }, [po.id]);
  const total = po.grand_total || po.total_cost || 0;
  return (
    <tr className="border-t border-border hover:bg-muted/30">
      <td className="px-3 py-2 font-mono text-xs">{po.po_number}</td>
      <td className="px-3 py-2">{po.supplier_name}</td>
      <td className="px-3 py-2 text-xs">{po.po_date || (po.created_at || "").slice(0, 10)}</td>
      <td className="px-3 py-2 text-xs">{po.expected_date || "—"}</td>
      <td className="px-3 py-2 text-right">{agg?.lines ?? "—"}</td>
      <td className="px-3 py-2 text-right">{agg?.units ?? "—"}</td>
      <td className="px-3 py-2 text-right">{fmtCurrency(total)}</td>
      <td className="px-3 py-2">
        <span className={`px-2 py-0.5 rounded text-xs ${statusBadge(po.status)}`}>{po.status}</span>
      </td>
      <td className="px-3 py-2 text-right">
        <div className="inline-flex gap-1">
          <Button size="sm" variant="ghost" onClick={onView} title="View"><Eye className="w-3.5 h-3.5" /></Button>
          {(po.status === "sent" || po.status === "partial") && (
            <Button size="sm" variant="ghost" onClick={onReceive} title="Receive">
              <ArrowDownToLine className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClone} title="Clone"><CopyIcon className="w-3.5 h-3.5" /></Button>
          {po.status !== "archived" && (
            <Button size="sm" variant="ghost" onClick={onArchive} title="Archive"><Archive className="w-3.5 h-3.5" /></Button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────
// Edit / Create View
// ─────────────────────────────────────────────────────────
function EditView({ po, onBack, onReceive }: { po: PO; onBack: () => void; onReceive: () => void }) {
  const [form, setForm] = useState<PO>(po);
  const [lines, setLines] = useState<POLine[]>(po.lines || []);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string; contact_info: any }[]>([]);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<POLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [settings, setSettings] = useState<POSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    supabase.from("suppliers").select("id, name, contact_info").order("name")
      .then(({ data }) => setSuppliers((data || []) as any));
    supabase.from("po_settings").select("*").maybeSingle()
      .then(({ data }) => { if (data) setSettings({ ...DEFAULT_SETTINGS, ...(data as any) }); });
  }, []);

  const subtotal = useMemo(() => lines.reduce((s, l) => s + l.cost_price * l.qty_ordered, 0), [lines]);
  const tax = useMemo(() => Number(form.tax) || 0, [form.tax]);
  const shipping = useMemo(() => Number(form.shipping) || 0, [form.shipping]);
  const grandTotal = subtotal + shipping + tax;

  // Auto-calc default tax (10% GST) if user hasn't overridden
  useEffect(() => {
    if (!form.id) {
      setForm(f => ({ ...f, tax: Number((subtotal * 0.1).toFixed(2)) }));
    }
  }, [subtotal, form.id]);

  const updateLine = (id: string, patch: Partial<POLine>) =>
    setLines(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
  const removeLine = (id: string) => setLines(prev => prev.filter(l => l.id !== id));

  const onSelectSupplier = (id: string) => {
    const s = suppliers.find(x => x.id === id);
    if (!s) return;
    const ci = s.contact_info || {};
    setForm(f => ({
      ...f, supplier_id: id, supplier_name: s.name,
      supplier_email: ci.email || f.supplier_email || "",
    }));
  };

  const doSearch = async () => {
    if (!search.trim()) return;
    setSearching(true);
    try {
      // Search local variants table
      const q = search.trim();
      const { data } = await supabase
        .from("variants")
        .select("id, sku, barcode, color, size, retail_price, cost, products!inner(id, title, vendor, shopify_product_id)")
        .or(`sku.ilike.%${q}%,barcode.eq.${q}`)
        .limit(50);
      const results: POLine[] = (data || []).map((v: any) => ({
        id: crypto.randomUUID(),
        product_title: v.products?.title || "",
        variant_title: [v.color, v.size].filter(Boolean).join(" / ") || null,
        sku: v.sku, barcode: v.barcode,
        shopify_product_id: v.products?.shopify_product_id || null,
        shopify_variant_id: v.id,
        cost_price: Number(v.cost ?? 0),
        qty_ordered: 1,
        qty_received: 0,
      }));
      // Also try product title search
      if (results.length < 10) {
        const { data: byTitle } = await supabase
          .from("products").select("id, title, vendor, shopify_product_id, variants(id, sku, barcode, color, size, cost)")
          .ilike("title", `%${q}%`).limit(10);
        (byTitle || []).forEach((p: any) => {
          (p.variants || []).forEach((v: any) => {
            results.push({
              id: crypto.randomUUID(),
              product_title: p.title, variant_title: [v.color, v.size].filter(Boolean).join(" / ") || null,
              sku: v.sku, barcode: v.barcode,
              shopify_product_id: p.shopify_product_id, shopify_variant_id: v.id,
              cost_price: Number(v.cost ?? 0), qty_ordered: 1, qty_received: 0,
            });
          });
        });
      }
      setSearchResults(results);
      if (!results.length) toast.info("No products found");
    } finally {
      setSearching(false);
    }
  };

  const addLineFromResult = (l: POLine) => {
    setLines(prev => [...prev, { ...l, id: crypto.randomUUID() }]);
    setSearchResults([]);
    setSearch("");
  };

  const [suggestionMeta, setSuggestionMeta] = useState<Record<string, string>>({});

  const suggestQuantities = async () => {
    if (!lines.length) return toast.info("Add products first, then suggest quantities");
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const skus = lines.map(l => l.sku).filter(Boolean) as string[];
    if (!skus.length) return toast.info("Lines need SKUs to forecast");

    // Per-supplier lead/restock from supplier_profiles.profile_data
    let leadDays = settings.default_lead_time_days || 14;
    let restockDays = 28;
    if (form.supplier_name) {
      const { data: prof } = await supabase
        .from("supplier_profiles")
        .select("profile_data")
        .ilike("supplier_name", form.supplier_name)
        .maybeSingle();
      const pd = (prof?.profile_data || {}) as Record<string, any>;
      if (Number(pd.lead_time_days) > 0) leadDays = Number(pd.lead_time_days);
      if (Number(pd.restock_period_days) > 0) restockDays = Number(pd.restock_period_days);
    }

    // Sales last 30d by SKU (via variants join)
    const { data: sales } = await supabase
      .from("sales_data")
      .select("quantity_sold, variants!inner(sku)")
      .gte("sold_at", since)
      .in("variants.sku", skus);
    const salesMap = new Map<string, number>();
    (sales || []).forEach((r: any) => {
      const sku = r.variants?.sku;
      if (!sku) return;
      salesMap.set(sku, (salesMap.get(sku) || 0) + Number(r.quantity_sold || 0));
    });

    const meta: Record<string, string> = {};
    setLines(prev => prev.map(l => {
      if (!l.sku) return l;
      const sold = salesMap.get(l.sku) || 0;
      const perDay = sold / 30;
      const current = l.current_stock || 0;
      const suggested = Math.max(0, Math.ceil(perDay * (leadDays + restockDays) - current));
      meta[l.id] = `Suggested ${suggested} = ceil(${perDay.toFixed(2)}/day × (${leadDays}+${restockDays} days) − ${current} available)`;
      return { ...l, qty_ordered: suggested };
    }));
    setSuggestionMeta(meta);
    toast.success(`Suggested quantities filled (lead ${leadDays}d + restock ${restockDays}d)`);
  };

  const save = async (newStatus?: POStatus): Promise<string | null> => {
    if (!form.supplier_name) { toast.error("Vendor is required"); return null; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Not authenticated"); return null; }
      const payload = {
        user_id: user.id,
        supplier_id: form.supplier_id,
        supplier_name: form.supplier_name,
        supplier_email: form.supplier_email,
        ship_to_location: form.ship_to_location,
        po_date: form.po_date || new Date().toISOString().slice(0, 10),
        expected_date: form.expected_date || null,
        invoice_number: form.invoice_number,
        notes: form.notes_internal,
        notes_supplier: form.notes_supplier,
        notes_internal: form.notes_internal,
        status: newStatus || form.status,
        subtotal, shipping, tax, grand_total: grandTotal,
        total_cost: grandTotal,
        ...(newStatus === "sent" ? { sent_at: new Date().toISOString() } : {}),
      };
      let poId = form.id;
      if (poId) {
        const { error } = await supabase.from("purchase_orders").update(payload).eq("id", poId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("purchase_orders")
          .insert({ ...payload, po_number: "AUTO" }).select("id, po_number").single();
        if (error) throw error;
        poId = data.id;
        setForm(f => ({ ...f, id: data.id, po_number: data.po_number }));
      }
      // Replace lines
      await supabase.from("purchase_order_lines").delete().eq("purchase_order_id", poId);
      if (lines.length) {
        const lineRows = lines.map(l => ({
          user_id: user.id,
          purchase_order_id: poId!,
          product_title: l.product_title,
          sku: l.sku,
          color: l.variant_title?.split(" / ")[0] ?? null,
          size: l.variant_title?.split(" / ")[1] ?? null,
          variant_title: l.variant_title,
          barcode: l.barcode,
          shopify_product_id: l.shopify_product_id,
          shopify_variant_id: l.shopify_variant_id,
          expected_cost: l.cost_price,
          expected_qty: l.qty_ordered,
          received_qty: l.qty_received,
        }));
        const { error } = await supabase.from("purchase_order_lines").insert(lineRows);
        if (error) throw error;
      }
      addAuditEntry(newStatus === "sent" ? "po_sent" : "po_save", `PO ${form.po_number || "new"} — ${lines.length} lines, total ${fmtCurrency(grandTotal)}`);
      toast.success(newStatus === "sent" ? "Saved & sent" : "Saved");
      return poId;
    } catch (e: any) {
      toast.error(e.message || "Save failed");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const sendToSupplier = async () => {
    if (!form.supplier_email) return toast.error("Supplier email required");
    const poId = await save("sent");
    if (!poId) return;
    // Best-effort email via edge function (if available); otherwise just mark as sent
    try {
      const { error } = await supabase.functions.invoke("send-po-email", {
        body: {
          po_id: poId,
          to: form.supplier_email,
          subject: renderTemplate(settings.email_subject_template, form, grandTotal, settings),
          body: renderTemplate(settings.email_body_template, form, grandTotal, settings),
        },
      });
      if (error) toast.warning("Saved as Sent. Email function unavailable — please configure email integration.");
      else toast.success("Email sent to supplier");
    } catch {
      toast.warning("Saved as Sent. Email integration not configured.");
    }
    onBack();
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}><ChevronLeft className="w-4 h-4 mr-1" />Back</Button>
          <h1 className="text-xl font-bold font-display">
            {form.id ? `Edit ${form.po_number}` : "New Purchase Order"}
          </h1>
          <span className={`px-2 py-0.5 rounded text-xs ${statusBadge(form.status)}`}>{form.status}</span>
        </div>
        <div className="flex gap-2">
          {(form.status === "sent" || form.status === "partial") && (
            <Button variant="outline" onClick={onReceive}><ArrowDownToLine className="w-4 h-4 mr-1" />Receive Stock</Button>
          )}
          <Button variant="outline" onClick={() => setPdfOpen(true)}><Eye className="w-4 h-4 mr-1" />Preview PDF</Button>
          <Button variant="outline" onClick={() => save()} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Save as Draft</Button>
          <Button onClick={sendToSupplier} disabled={saving}><Send className="w-4 h-4 mr-1" />Send to Supplier</Button>
        </div>
      </div>

      {/* Header */}
      <div className="bg-card border border-border rounded-lg p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
        <div>
          <Label>PO Number</Label>
          <Input value={form.po_number} placeholder="Auto-generated"
            onChange={e => setForm(f => ({ ...f, po_number: e.target.value }))} />
        </div>
        <div>
          <Label>Vendor *</Label>
          <select value={form.supplier_id || ""}
            onChange={e => onSelectSupplier(e.target.value)}
            className="block w-full h-10 px-3 rounded-md border border-input bg-background text-sm">
            <option value="">— Select vendor —</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {!form.supplier_id && (
            <Input className="mt-1" value={form.supplier_name}
              placeholder="Or type vendor name"
              onChange={e => setForm(f => ({ ...f, supplier_name: e.target.value }))} />
          )}
        </div>
        <div>
          <Label>Supplier Email</Label>
          <Input type="email" value={form.supplier_email || ""}
            onChange={e => setForm(f => ({ ...f, supplier_email: e.target.value }))} />
        </div>
        <div>
          <Label>Ship To</Label>
          <select value={form.ship_to_location || LOCATIONS[0]}
            onChange={e => setForm(f => ({ ...f, ship_to_location: e.target.value }))}
            className="block w-full h-10 px-3 rounded-md border border-input bg-background text-sm">
            {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div>
          <Label>PO Date</Label>
          <Input type="date" value={form.po_date || ""} onChange={e => setForm(f => ({ ...f, po_date: e.target.value }))} />
        </div>
        <div>
          <Label>Expected Delivery</Label>
          <Input type="date" value={form.expected_date || ""} onChange={e => setForm(f => ({ ...f, expected_date: e.target.value }))} />
        </div>
        <div>
          <Label>Invoice Number</Label>
          <Input value={form.invoice_number || ""} onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))} />
        </div>
        <div className="col-span-2 md:col-span-3 grid grid-cols-2 gap-3">
          <div>
            <Label>Notes to Supplier (printed on PO)</Label>
            <textarea className="w-full min-h-[60px] p-2 rounded-md border border-input bg-background text-sm"
              value={form.notes_supplier || ""} onChange={e => setForm(f => ({ ...f, notes_supplier: e.target.value }))} />
          </div>
          <div>
            <Label>Internal Notes</Label>
            <textarea className="w-full min-h-[60px] p-2 rounded-md border border-input bg-background text-sm"
              value={form.notes_internal || ""} onChange={e => setForm(f => ({ ...f, notes_internal: e.target.value }))} />
          </div>
        </div>
      </div>

      {/* Line items */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-sm">Line Items</h2>
          <Button size="sm" variant="outline" onClick={suggestQuantities}>
            <Sparkles className="w-3.5 h-3.5 mr-1" />Suggest quantities
          </Button>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search by title, SKU, or barcode" value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === "Enter" && doSearch()} />
          </div>
          <Button onClick={doSearch} disabled={searching}>{searching ? <Loader2 className="w-4 h-4 animate-spin" /> : "Search"}</Button>
        </div>

        {searchResults.length > 0 && (
          <div className="border border-border rounded-md max-h-60 overflow-y-auto">
            {searchResults.map(r => (
              <button key={r.id} onClick={() => addLineFromResult(r)}
                className="w-full text-left px-3 py-2 hover:bg-muted/50 flex items-center justify-between border-b border-border last:border-b-0">
                <div>
                  <div className="text-sm font-medium">{r.product_title}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.variant_title || "—"} · SKU {r.sku || "—"} · {fmtCurrency(r.cost_price)}
                  </div>
                </div>
                <Plus className="w-4 h-4" />
              </button>
            ))}
          </div>
        )}

        {lines.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-6">No products yet — search above</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left py-1">Product</th>
                <th className="text-left py-1">Variant</th>
                <th className="text-left py-1">SKU</th>
                <th className="text-right py-1">Cost</th>
                <th className="text-right py-1">Qty</th>
                <th className="text-right py-1">Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map(l => (
                <tr key={l.id} className="border-t border-border">
                  <td className="py-1">{l.product_title}</td>
                  <td className="py-1 text-xs">{l.variant_title || "—"}</td>
                  <td className="py-1 text-xs font-mono">{l.sku || "—"}</td>
                  <td className="py-1 text-right">
                    <Input type="number" step="0.01" className="w-24 h-8 text-right ml-auto"
                      value={l.cost_price}
                      onChange={e => updateLine(l.id, { cost_price: Number(e.target.value) })} />
                  </td>
                  <td className="py-1 text-right">
                    {suggestionMeta[l.id] ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Input type="number" className="w-20 h-8 text-right ml-auto"
                              value={l.qty_ordered}
                              onChange={e => updateLine(l.id, { qty_ordered: Number(e.target.value) })} />
                          </TooltipTrigger>
                          <TooltipContent><span className="text-xs">{suggestionMeta[l.id]}</span></TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <Input type="number" className="w-20 h-8 text-right ml-auto"
                        value={l.qty_ordered}
                        onChange={e => updateLine(l.id, { qty_ordered: Number(e.target.value) })} />
                    )}
                  </td>
                  <td className="py-1 text-right">{fmtCurrency(l.cost_price * l.qty_ordered)}</td>
                  <td className="py-1 text-right">
                    <Button size="sm" variant="ghost" onClick={() => removeLine(l.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Totals */}
        <div className="flex justify-end">
          <div className="w-72 space-y-1 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span>{fmtCurrency(subtotal)}</span></div>
            <div className="flex justify-between items-center">
              <span>Shipping</span>
              <Input type="number" step="0.01" className="w-24 h-7 text-right"
                value={form.shipping}
                onChange={e => setForm(f => ({ ...f, shipping: Number(e.target.value) }))} />
            </div>
            <div className="flex justify-between items-center">
              <span>Tax (GST 10%)</span>
              <Input type="number" step="0.01" className="w-24 h-7 text-right"
                value={form.tax}
                onChange={e => setForm(f => ({ ...f, tax: Number(e.target.value) }))} />
            </div>
            <div className="flex justify-between font-bold text-base border-t border-border pt-1">
              <span>Grand Total</span><span>{fmtCurrency(grandTotal)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* PDF preview modal */}
      <Dialog open={pdfOpen} onOpenChange={setPdfOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>PO Preview</DialogTitle>
            <DialogDescription>Preview the printable Purchase Order</DialogDescription>
          </DialogHeader>
          <PODocument po={{ ...form, subtotal, shipping, tax, grand_total: grandTotal, lines }} settings={settings} />
          <DialogFooter>
            <Button variant="outline" onClick={() => window.print()}>Print</Button>
            <Button onClick={() => setPdfOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// PO Document (PDF-style preview)
// ─────────────────────────────────────────────────────────
function PODocument({ po, settings }: { po: PO; settings: POSettings }) {
  return (
    <div className="bg-background text-foreground p-6 rounded-md border border-border">
      <div className="flex justify-between items-start mb-6">
        <div>
          {settings.logo_url && <img src={settings.logo_url} alt="logo" className="h-12 mb-2" />}
          <div className="font-bold text-lg">{settings.store_name || "Your Store"}</div>
          <div className="text-xs whitespace-pre-line">{settings.store_address}</div>
          {settings.store_abn && <div className="text-xs">ABN: {settings.store_abn}</div>}
        </div>
        <div className="text-right">
          <div className="font-bold text-xl">PURCHASE ORDER</div>
          <div className="text-sm font-mono">{po.po_number || "(unsaved)"}</div>
          <div className="text-xs">Date: {po.po_date}</div>
          <div className="text-xs">Expected: {po.expected_date || "—"}</div>
        </div>
      </div>
      <div className="mb-4">
        <div className="text-xs text-muted-foreground">Supplier</div>
        <div className="font-semibold">{po.supplier_name}</div>
        {po.supplier_email && <div className="text-xs">{po.supplier_email}</div>}
        <div className="text-xs">Ship to: {po.ship_to_location}</div>
      </div>
      <table className="w-full text-sm mb-4">
        <thead className="border-b border-border">
          <tr>
            <th className="text-left py-1">Product</th>
            <th className="text-left py-1">Variant</th>
            <th className="text-left py-1">SKU</th>
            <th className="text-right py-1">Qty</th>
            <th className="text-right py-1">Cost</th>
            <th className="text-right py-1">Total</th>
          </tr>
        </thead>
        <tbody>
          {(po.lines || []).map(l => (
            <tr key={l.id} className="border-b border-border/50">
              <td className="py-1">{l.product_title}</td>
              <td className="py-1 text-xs">{l.variant_title || "—"}</td>
              <td className="py-1 text-xs font-mono">{l.sku || "—"}</td>
              <td className="py-1 text-right">{l.qty_ordered}</td>
              <td className="py-1 text-right">{fmtCurrency(l.cost_price)}</td>
              <td className="py-1 text-right">{fmtCurrency(l.cost_price * l.qty_ordered)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex justify-end mb-4">
        <div className="w-64 text-sm space-y-0.5">
          <div className="flex justify-between"><span>Subtotal</span><span>{fmtCurrency(po.subtotal)}</span></div>
          <div className="flex justify-between"><span>Shipping</span><span>{fmtCurrency(po.shipping)}</span></div>
          <div className="flex justify-between"><span>Tax</span><span>{fmtCurrency(po.tax)}</span></div>
          <div className="flex justify-between font-bold border-t border-border pt-1">
            <span>Grand Total</span><span>{fmtCurrency(po.grand_total)}</span>
          </div>
        </div>
      </div>
      {po.notes_supplier && (
        <div className="text-xs"><div className="font-semibold mb-1">Notes:</div><div className="whitespace-pre-line">{po.notes_supplier}</div></div>
      )}
      <div className="text-xs mt-4 text-muted-foreground">Payment terms: {settings.payment_terms}</div>
    </div>
  );
}

function renderTemplate(t: string, po: PO, total: number, s: POSettings): string {
  return t
    .replace(/\{\{po_number\}\}/g, po.po_number || "")
    .replace(/\{\{supplier_name\}\}/g, po.supplier_name || "")
    .replace(/\{\{expected_date\}\}/g, po.expected_date || "")
    .replace(/\{\{grand_total\}\}/g, fmtCurrency(total))
    .replace(/\{\{store_name\}\}/g, s.store_name || "");
}

// ─────────────────────────────────────────────────────────
// Receive View
// ─────────────────────────────────────────────────────────
function ReceiveView({ po, onBack }: { po: PO; onBack: () => void }) {
  const [lines, setLines] = useState<POLine[]>(po.lines || []);
  const [receiveNow, setReceiveNow] = useState<Record<string, number>>(
    Object.fromEntries((po.lines || []).map(l => [l.id, Math.max(0, l.qty_ordered - l.qty_received)])),
  );
  const [pushing, setPushing] = useState(false);

  const onSave = async () => {
    setPushing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // 1) Resolve location
      const conn = await getConnection();
      let shopifyLocationId: string | null = null;
      if (conn) {
        const locs = await getLocations();
        const matched = locs.find(l => l.name?.toLowerCase().includes((po.ship_to_location || "").toLowerCase()));
        shopifyLocationId = matched?.id || locs[0]?.id || null;
      }

      const receiptLines: any[] = [];
      const pushErrors: string[] = [];
      for (const l of lines) {
        const qty = Number(receiveNow[l.id] || 0);
        if (qty <= 0) continue;
        let pushed = false;
        if (shopifyLocationId && l.sku) {
          try {
            const v = await findVariantBySKU(l.sku);
            if (v?.inventory_item_id) {
              await adjustInventory(shopifyLocationId, String(v.inventory_item_id), qty);
              pushed = true;
            }
          } catch (e: any) {
            pushErrors.push(`${l.sku}: ${e.message}`);
          }
        }
        receiptLines.push({
          line_id: l.id, sku: l.sku, product_title: l.product_title,
          variant_title: l.variant_title, qty_received: qty, pushed_to_shopify: pushed,
        });
      }

      if (!receiptLines.length) {
        toast.info("Nothing to receive");
        setPushing(false);
        return;
      }

      // 2) Update line received_qty
      for (const l of lines) {
        const qty = Number(receiveNow[l.id] || 0);
        if (qty > 0) {
          await supabase.from("purchase_order_lines")
            .update({ received_qty: l.qty_received + qty })
            .eq("id", l.id);
        }
      }

      // 3) Insert receipt
      const { error: receiptErr } = await supabase.from("po_receipts").insert({
        user_id: user.id, po_id: po.id,
        received_date: new Date().toISOString().slice(0, 10),
        received_by: user.email || "",
        line_items: receiptLines,
        shopify_push_status: pushErrors.length ? "partial" : "success",
        shopify_push_error: pushErrors.join("; ") || null,
        pushed_at: new Date().toISOString(),
      });
      if (receiptErr) throw receiptErr;

      // 4) Recompute PO status
      const { data: refreshedLines } = await supabase
        .from("purchase_order_lines").select("expected_qty, received_qty").eq("purchase_order_id", po.id);
      const allReceived = (refreshedLines || []).every((r: any) => Number(r.received_qty) >= Number(r.expected_qty));
      const anyReceived = (refreshedLines || []).some((r: any) => Number(r.received_qty) > 0);
      const newStatus: POStatus = allReceived ? "received" : anyReceived ? "partial" : po.status;
      await supabase.from("purchase_orders").update({ status: newStatus }).eq("id", po.id);

      addAuditEntry("po_receive", `Received ${receiptLines.length} line(s) on ${po.po_number} — status ${newStatus}`);
      if (pushErrors.length) toast.warning(`Receipt saved. Some Shopify pushes failed: ${pushErrors.length}`);
      else toast.success(`Received — status now ${newStatus}`);
      onBack();
    } catch (e: any) {
      toast.error(e.message || "Receive failed");
    } finally {
      setPushing(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}><ChevronLeft className="w-4 h-4 mr-1" />Back</Button>
        <h1 className="text-xl font-bold font-display">Receive Stock — {po.po_number}</h1>
      </div>
      <div className="bg-card border border-border rounded-lg p-4">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left py-2">Product</th>
              <th className="text-left py-2">SKU</th>
              <th className="text-right py-2">Ordered</th>
              <th className="text-right py-2">Already Received</th>
              <th className="text-right py-2">Receive Now</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(l => {
              const remaining = Math.max(0, l.qty_ordered - l.qty_received);
              return (
                <tr key={l.id} className="border-t border-border">
                  <td className="py-2">{l.product_title}<div className="text-xs text-muted-foreground">{l.variant_title}</div></td>
                  <td className="py-2 text-xs font-mono">{l.sku || "—"}</td>
                  <td className="py-2 text-right">{l.qty_ordered}</td>
                  <td className="py-2 text-right">{l.qty_received}</td>
                  <td className="py-2 text-right">
                    <Input type="number" min={0} max={remaining} className="w-24 h-8 text-right ml-auto"
                      value={receiveNow[l.id] ?? 0}
                      onChange={e => setReceiveNow(prev => ({ ...prev, [l.id]: Math.min(remaining, Math.max(0, Number(e.target.value))) }))} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end">
        <Button onClick={onSave} disabled={pushing}>
          {pushing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ArrowDownToLine className="w-4 h-4 mr-1" />}
          Save & Push to Shopify
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Settings View
// ─────────────────────────────────────────────────────────
function POSettingsView({ onBack }: { onBack: () => void }) {
  const [s, setS] = useState<POSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("po_settings").select("*").maybeSingle()
      .then(({ data }) => {
        if (data) setS({ ...DEFAULT_SETTINGS, ...(data as any) });
        setLoading(false);
      });
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase.from("po_settings")
        .upsert({ user_id: user.id, ...s }, { onConflict: "user_id" });
      if (error) throw error;
      toast.success("Settings saved");
      onBack();
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading…</div>;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}><ChevronLeft className="w-4 h-4 mr-1" />Back</Button>
        <h1 className="text-xl font-bold font-display">Purchase Order Settings</h1>
      </div>
      <div className="bg-card border border-border rounded-lg p-4 grid gap-3">
        <div><Label>Store Name</Label><Input value={s.store_name} onChange={e => setS(v => ({ ...v, store_name: e.target.value }))} /></div>
        <div><Label>Store Address</Label>
          <textarea className="w-full min-h-[60px] p-2 rounded-md border border-input bg-background text-sm"
            value={s.store_address} onChange={e => setS(v => ({ ...v, store_address: e.target.value }))} />
        </div>
        <div><Label>ABN</Label><Input value={s.store_abn} onChange={e => setS(v => ({ ...v, store_abn: e.target.value }))} /></div>
        <div><Label>Logo URL</Label><Input value={s.logo_url} onChange={e => setS(v => ({ ...v, logo_url: e.target.value }))} /></div>
        <div><Label>Payment Terms</Label><Input value={s.payment_terms} onChange={e => setS(v => ({ ...v, payment_terms: e.target.value }))} /></div>
        <div><Label>Default Lead Time (days)</Label>
          <Input type="number" value={s.default_lead_time_days}
            onChange={e => setS(v => ({ ...v, default_lead_time_days: Number(e.target.value) }))} />
        </div>
        <div><Label>Email Subject Template</Label>
          <Input value={s.email_subject_template} onChange={e => setS(v => ({ ...v, email_subject_template: e.target.value }))} />
          <p className="text-xs text-muted-foreground mt-1">Merge fields: {`{{po_number}}, {{supplier_name}}, {{expected_date}}, {{grand_total}}, {{store_name}}`}</p>
        </div>
        <div><Label>Email Body Template</Label>
          <textarea className="w-full min-h-[140px] p-2 rounded-md border border-input bg-background text-sm font-mono text-xs"
            value={s.email_body_template} onChange={e => setS(v => ({ ...v, email_body_template: e.target.value }))} />
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Save Settings</Button>
        </div>
      </div>
    </div>
  );
}
