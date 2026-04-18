import { useState, useEffect, useCallback } from "react";
import {
  ChevronLeft, ChevronRight, Plus, Pencil, Trash2,
  TrendingUp, TrendingDown, Minus, FileText, Package,
  BarChart3, Clock, DollarSign, Save, X, Search, RefreshCw,
  Receipt, ShoppingBag, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { DbSupplier } from "@/lib/db-schema-types";
import { isFuzzySupplierMatch } from "@/lib/invoice-persistence";
import { getCostHistory } from "@/components/InvoiceFlow";
import SupplierCatalog from "@/components/SupplierCatalog";

interface SupplierPanelProps {
  onBack: () => void;
  onStartInvoice: () => void;
}

type SupplierRow = DbSupplier;

interface LinkedInvoice {
  id: string;
  document_number: string | null;
  source_filename: string | null;
  date: string | null;
  total: number;
  gst: number;
  status: string;
  source_type: string;
  line_count: number;
  avg_confidence: number | null;
}

interface ProductCostSummary {
  product_title: string;
  sku: string | null;
  avgCost: number;
  minCost: number;
  maxCost: number;
  totalQty: number;
  entries: number;
  costTrend: "up" | "down" | "stable";
}

interface CorrectionRow {
  id: string;
  field_corrected: string | null;
  original_value: string | null;
  corrected_value: string | null;
  correction_reason: string | null;
  correction_reason_detail: string | null;
  field_category: string | null;
  created_at: string;
  invoice_id: string | null;
}

// ── Seed demo suppliers if table is empty ─────────────────
const DEMO_SUPPLIERS: Omit<SupplierRow, "id" | "user_id" | "created_at" | "updated_at">[] = [
  { name: "Jantzen", contact_info: { email: "orders@jantzen.com.au", rep: "Sarah M" }, currency: "AUD", notes: "MOQ $2,000. Net 30.", total_spend: 48500, avg_margin: 62 },
  { name: "Seafolly", contact_info: { email: "wholesale@seafolly.com.au", rep: "Tom B" }, currency: "AUD", notes: "Pre-season deadline Feb 28.", total_spend: 34200, avg_margin: 58 },
  { name: "Bond Eye", contact_info: { email: "sales@bondeye.com.au" }, currency: "AUD", notes: "Drop ship available.", total_spend: 18900, avg_margin: 65 },
  { name: "Baku", contact_info: { email: "orders@baku.com.au", rep: "Liz K" }, currency: "AUD", notes: "Returns within 14 days.", total_spend: 22100, avg_margin: 55 },
];

const SupplierPanel = ({ onBack, onStartInvoice }: SupplierPanelProps) => {
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [search, setSearch] = useState("");
  const [syncing, setSyncing] = useState(false);

  // Detail sub-data
  const [linkedInvoices, setLinkedInvoices] = useState<LinkedInvoice[]>([]);
  const [productCosts, setProductCosts] = useState<ProductCostSummary[]>([]);
  const [corrections, setCorrections] = useState<CorrectionRow[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailTab, setDetailTab] = useState<"overview" | "invoices" | "costs" | "catalog" | "corrections">("overview");

  // Form state
  const [form, setForm] = useState({ name: "", email: "", rep: "", phone: "", currency: "AUD", notes: "" });

  // ── Load suppliers ──────────────────────────────────────
  const loadSuppliers = useCallback(async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); return; }

    const { data, error } = await supabase
      .from("suppliers")
      .select("*")
      .order("total_spend", { ascending: false });

    if (error) {
      toast.error("Failed to load suppliers");
      setLoading(false);
      return;
    }

    if (!data || data.length === 0) {
      const inserts = DEMO_SUPPLIERS.map(d => ({
        ...d,
        user_id: session.user.id,
        contact_info: d.contact_info as Record<string, string>,
      }));
      const { data: seeded } = await supabase.from("suppliers").insert(inserts).select();
      setSuppliers((seeded || []) as unknown as SupplierRow[]);
    } else {
      setSuppliers(data as unknown as SupplierRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadSuppliers(); }, [loadSuppliers]);

  // ── Load detail data when supplier selected ────────────
  const loadSupplierDetail = useCallback(async (supplier: SupplierRow) => {
    setLoadingDetail(true);
    setDetailTab("overview");

    // Load linked invoices: match by supplier_id OR by fuzzy supplier_name
    // (so "Seafolly" supplier picks up docs stamped "Seafolly Pty Limited")
    const safeName = supplier.name.replace(/[%,()]/g, "");
    const { data: docs } = await supabase
      .from("documents")
      .select("id, document_number, source_filename, date, total, gst, status, source_type")
      .or(`supplier_id.eq.${supplier.id},supplier_name.ilike.%${safeName}%`)
      .order("date", { ascending: false })
      .limit(50);

    const docList = (docs || []);

    // Load document lines for cost analysis + per-invoice confidence
    if (docList.length > 0) {
      const docIds = docList.map(d => d.id);
      const { data: lines } = await supabase
        .from("document_lines")
        .select("product_title, sku, unit_cost, quantity, document_id, confidence")
        .in("document_id", docIds);

      // Aggregate per-invoice line count + avg confidence
      const perDoc: Record<string, { count: number; confSum: number; confN: number }> = {};
      for (const ln of lines || []) {
        const k = ln.document_id as string;
        if (!perDoc[k]) perDoc[k] = { count: 0, confSum: 0, confN: 0 };
        perDoc[k].count += 1;
        if (typeof ln.confidence === "number") {
          perDoc[k].confSum += Number(ln.confidence);
          perDoc[k].confN += 1;
        }
      }

      setLinkedInvoices(docList.map(d => ({
        ...(d as any),
        line_count: perDoc[d.id]?.count || 0,
        avg_confidence: perDoc[d.id]?.confN ? perDoc[d.id].confSum / perDoc[d.id].confN : null,
      })) as LinkedInvoice[]);

      if (lines && lines.length > 0) {
        // Group by product_title + sku
        const groups: Record<string, { costs: number[]; qtys: number[]; title: string; sku: string | null }> = {};
        for (const line of lines) {
          const key = `${line.product_title || "Unknown"}::${line.sku || ""}`;
          if (!groups[key]) {
            groups[key] = { costs: [], qtys: [], title: line.product_title || "Unknown", sku: line.sku };
          }
          groups[key].costs.push(Number(line.unit_cost));
          groups[key].qtys.push(Number(line.quantity));
        }

        const summaries: ProductCostSummary[] = Object.values(groups).map(g => {
          const avgCost = g.costs.reduce((a, b) => a + b, 0) / g.costs.length;
          const totalQty = g.qtys.reduce((a, b) => a + b, 0);
          const lastTwo = g.costs.slice(-2);
          const costTrend = lastTwo.length >= 2
            ? lastTwo[1] > lastTwo[0] * 1.02 ? "up" : lastTwo[1] < lastTwo[0] * 0.98 ? "down" : "stable"
            : "stable";
          return {
            product_title: g.title,
            sku: g.sku,
            avgCost,
            minCost: Math.min(...g.costs),
            maxCost: Math.max(...g.costs),
            totalQty,
            entries: g.costs.length,
            costTrend,
          };
        });

        summaries.sort((a, b) => b.totalQty - a.totalQty);
        setProductCosts(summaries);
      } else {
        setProductCosts([]);
      }
    } else {
      setLinkedInvoices([]);
      setProductCosts([]);
    }


    // Load correction_log entries for this supplier — fuzzy by supplier_name.
    const { data: corrRows } = await supabase
      .from("correction_log")
      .select("id, field_corrected, original_value, corrected_value, correction_reason, correction_reason_detail, field_category, created_at, invoice_id")
      .ilike("supplier_name", `%${safeName}%`)
      .order("created_at", { ascending: false })
      .limit(100);
    setCorrections((corrRows || []) as CorrectionRow[]);

    setLoadingDetail(false);
  }, []);

  useEffect(() => {
    const supplier = suppliers.find(s => s.id === selectedId);
    if (supplier) loadSupplierDetail(supplier);
  }, [selectedId, suppliers, loadSupplierDetail]);

  // ── Sync spend from documents table ─────────────────────
  const syncSpend = async () => {
    setSyncing(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setSyncing(false); return; }

    // Sum totals from documents grouped by supplier_name
    const { data: docs } = await supabase
      .from("documents")
      .select("supplier_name, total")
      .eq("user_id", session.user.id);

    // Also check accounting_push_history
    const { data: pushHistory } = await supabase
      .from("accounting_push_history")
      .select("supplier_name, total_inc_gst")
      .eq("user_id", session.user.id);

    // Bucket each document into the best fuzzy-matching supplier
    const spendMap: Record<string, number> = {};

    const bucketByFuzzy = (vendorName: string, amount: number) => {
      const match = suppliers.find(s => isFuzzySupplierMatch(vendorName, s.name));
      const key = match ? match.name : vendorName;
      spendMap[key] = (spendMap[key] || 0) + amount;
    };

    if (docs) {
      for (const row of docs) {
        const name = row.supplier_name || "";
        if (name) bucketByFuzzy(name, Number(row.total) || 0);
      }
    }

    if (pushHistory) {
      for (const row of pushHistory) {
        const name = row.supplier_name || "";
        if (name) bucketByFuzzy(name, Number(row.total_inc_gst) || 0);
      }
    }

    let updated = 0;
    for (const supplier of suppliers) {
      const spend = spendMap[supplier.name];
      if (spend && Math.abs(spend - Number(supplier.total_spend)) > 0.01) {
        await supabase.from("suppliers").update({ total_spend: spend }).eq("id", supplier.id);
        updated++;
      }
    }

    await loadSuppliers();
    toast.success(updated > 0 ? `${updated} supplier(s) spend updated` : "All spend is up to date");
    setSyncing(false);
  };

  // ── CRUD handlers ──────────────────────────────────────
  const handleAdd = async () => {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const contactInfo: Record<string, string> = {};
    if (form.email) contactInfo.email = form.email;
    if (form.rep) contactInfo.rep = form.rep;
    if (form.phone) contactInfo.phone = form.phone;

    const { error } = await supabase.from("suppliers").insert({
      user_id: session.user.id,
      name: form.name.trim(),
      contact_info: contactInfo,
      currency: form.currency || "AUD",
      notes: form.notes || null,
      total_spend: 0,
      avg_margin: null,
    });

    if (error) { toast.error("Failed to add supplier"); return; }
    toast.success(`${form.name} added`);
    setAddMode(false);
    setForm({ name: "", email: "", rep: "", phone: "", currency: "AUD", notes: "" });
    loadSuppliers();
  };

  const handleUpdate = async () => {
    if (!selectedId || !form.name.trim()) return;
    const contactInfo: Record<string, string> = {};
    if (form.email) contactInfo.email = form.email;
    if (form.rep) contactInfo.rep = form.rep;
    if (form.phone) contactInfo.phone = form.phone;

    const { error } = await supabase.from("suppliers").update({
      name: form.name.trim(),
      contact_info: contactInfo,
      currency: form.currency,
      notes: form.notes || null,
    }).eq("id", selectedId);

    if (error) { toast.error("Failed to update"); return; }
    toast.success("Supplier updated");
    setEditMode(false);
    loadSuppliers();
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete ${name}? This cannot be undone.`)) return;
    const { error } = await supabase.from("suppliers").delete().eq("id", id);
    if (error) { toast.error("Failed to delete"); return; }
    toast.success(`${name} deleted`);
    setSelectedId(null);
    loadSuppliers();
  };

  const saveNotes = async (id: string, notes: string) => {
    await supabase.from("suppliers").update({ notes }).eq("id", id);
  };

  const detail = suppliers.find(s => s.id === selectedId);
  const costHistory = getCostHistory();
  const filtered = suppliers.filter(s => s.name.toLowerCase().includes(search.toLowerCase()));

  const getPriceHistory = (supplierName: string) => {
    const results: { product: string; history: { date: string; cost: number; invoice: string }[] }[] = [];
    for (const [sku, entries] of Object.entries(costHistory)) {
      const supplierEntries = entries.filter((e: any) => e.supplier === supplierName);
      if (supplierEntries.length > 0) {
        results.push({ product: sku, history: supplierEntries.map((e: any) => ({ date: e.date, cost: e.cost, invoice: e.invoice })) });
      }
    }
    return results;
  };

  // ── Form view (add / edit) ─────────────────────────────
  if (addMode || editMode) {
    return (
      <div className="min-h-screen pb-24 animate-fade-in">
        <div className="sticky top-0 z-40 bg-background border-b border-border px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => { setAddMode(false); setEditMode(false); }} className="text-muted-foreground"><X className="w-5 h-5" /></button>
            <h2 className="text-lg font-semibold font-display">{addMode ? "Add Supplier" : "Edit Supplier"}</h2>
          </div>
        </div>
        <div className="px-4 pt-4 space-y-4">
          {[
            { label: "Supplier name *", key: "name", placeholder: "e.g. Seafolly" },
            { label: "Email", key: "email", placeholder: "orders@example.com" },
            { label: "Sales rep", key: "rep", placeholder: "Contact name" },
            { label: "Phone", key: "phone", placeholder: "+61 ..." },
            { label: "Currency", key: "currency", placeholder: "AUD" },
          ].map(f => (
            <div key={f.key}>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">{f.label}</label>
              <input
                value={(form as any)[f.key]}
                onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="w-full rounded-md bg-input border border-border px-3 py-2.5 text-sm"
              />
            </div>
          ))}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="MOQ, payment terms, etc."
              rows={3}
              className="w-full rounded-md bg-input border border-border px-3 py-2 text-sm resize-none"
            />
          </div>
          <Button className="w-full" onClick={addMode ? handleAdd : handleUpdate}>
            <Save className="w-4 h-4 mr-2" />{addMode ? "Add Supplier" : "Save Changes"}
          </Button>
        </div>
      </div>
    );
  }

  // ── Detail view ─────────────────────────────────────────
  if (detail) {
    const ci = (detail.contact_info || {}) as Record<string, string>;
    const priceHistory = getPriceHistory(detail.name);
    const margin = detail.avg_margin;

    // Performance metrics
    const invoiceCount = linkedInvoices.length;
    const totalProducts = productCosts.length;
    const avgOrderValue = invoiceCount > 0 ? linkedInvoices.reduce((a, inv) => a + Number(inv.total), 0) / invoiceCount : 0;
    const costIncreases = productCosts.filter(p => p.costTrend === "up").length;

    return (
      <div className="min-h-screen pb-24 animate-fade-in">
        <div className="sticky top-0 z-40 bg-background border-b border-border px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={() => setSelectedId(null)} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
              <h2 className="text-lg font-semibold font-display">{detail.name}</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setForm({
                    name: detail.name,
                    email: ci.email || "",
                    rep: ci.rep || "",
                    phone: ci.phone || "",
                    currency: detail.currency,
                    notes: detail.notes || "",
                  });
                  setEditMode(true);
                }}
                className="p-2 rounded-lg text-muted-foreground hover:bg-muted"
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button onClick={() => handleDelete(detail.id, detail.name)} className="p-2 rounded-lg text-destructive hover:bg-destructive/10">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="px-4 pt-4 space-y-4">
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Total spend", value: `$${Number(detail.total_spend).toLocaleString()}`, icon: DollarSign },
              { label: "Avg margin", value: margin ? `${margin}%` : "—", icon: BarChart3 },
              { label: "Invoices", value: String(invoiceCount), icon: Receipt },
              { label: "Products", value: String(totalProducts), icon: Package },
              { label: "Avg order", value: avgOrderValue > 0 ? `$${Math.round(avgOrderValue).toLocaleString()}` : "—", icon: ShoppingBag },
              { label: "Since", value: new Date(detail.created_at).toLocaleDateString("en-AU", { month: "short", year: "numeric" }), icon: Clock },
            ].map((s, i) => (
              <div key={i} className="bg-card rounded-lg border border-border p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <s.icon className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">{s.label}</span>
                </div>
                <p className="text-lg font-bold font-display">{s.value}</p>
              </div>
            ))}
          </div>

          {/* Cost increase warning */}
          {costIncreases > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-warning/10 border border-warning/30 rounded-lg text-xs text-warning">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {costIncreases} product(s) show recent cost increases
            </div>
          )}

          {/* Tab bar */}
          <div className="flex gap-1 bg-muted/50 rounded-lg p-1 overflow-x-auto">
            {(["overview", "invoices", "costs", "catalog", "corrections"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setDetailTab(tab)}
                className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${detailTab === tab ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
              >
                {tab === "overview" ? "Overview"
                  : tab === "invoices" ? `Invoices (${invoiceCount})`
                  : tab === "costs" ? `Costs (${totalProducts})`
                  : tab === "catalog" ? "Catalog"
                  : `Corrections (${corrections.length})`}
              </button>
            ))}
          </div>

          {loadingDetail ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Loading…</div>
          ) : (
            <>
              {/* Overview tab */}
              {detailTab === "overview" && (
                <div className="space-y-4">
                  {/* Contact info */}
                  {Object.keys(ci).length > 0 && (
                    <div className="bg-card rounded-lg border border-border p-4">
                      <h3 className="text-sm font-semibold mb-2">Contact</h3>
                      <div className="space-y-1 text-xs">
                        {ci.email && <p><span className="text-muted-foreground">Email:</span> {ci.email}</p>}
                        {ci.rep && <p><span className="text-muted-foreground">Rep:</span> {ci.rep}</p>}
                        {ci.phone && <p><span className="text-muted-foreground">Phone:</span> {ci.phone}</p>}
                      </div>
                    </div>
                  )}

                  {/* Supplier performance */}
                  <div className="bg-card rounded-lg border border-border p-4">
                    <h3 className="text-sm font-semibold mb-3">Performance</h3>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total units ordered</span>
                        <span className="font-medium">{productCosts.reduce((a, p) => a + p.totalQty, 0).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Unique products</span>
                        <span className="font-medium">{totalProducts}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Cost stability</span>
                        <span className="font-medium">
                          {productCosts.length === 0 ? "—" :
                            costIncreases === 0 ? "✅ Stable" :
                            `⚠️ ${costIncreases} increase${costIncreases > 1 ? "s" : ""}`}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Last invoice</span>
                        <span className="font-medium">
                          {linkedInvoices.length > 0 && linkedInvoices[0].date
                            ? new Date(linkedInvoices[0].date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })
                            : "—"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Cost history from localStorage (legacy) */}
                  {priceHistory.length > 0 && (
                    <div className="bg-card rounded-lg border border-border p-4">
                      <h3 className="text-sm font-semibold mb-3">Cost history (local)</h3>
                      <div className="space-y-2">
                        {priceHistory.slice(0, 5).map((ph, i) => (
                          <div key={i} className="text-xs">
                            <p className="font-medium mb-1">{ph.product}</p>
                            <div className="flex flex-wrap gap-2">
                              {ph.history.map((h, j) => {
                                const prev = j > 0 ? ph.history[j - 1].cost : null;
                                const change = prev ? ((h.cost - prev) / prev * 100) : null;
                                return (
                                  <span key={j} className="px-2 py-1 rounded bg-muted/50 font-mono">
                                    {new Date(h.date).toLocaleDateString("en-AU", { month: "short", year: "2-digit" })}: ${h.cost.toFixed(2)}
                                    {change !== null && (
                                      <span className={`ml-1 ${change > 5 ? "text-warning" : change < 0 ? "text-success" : ""}`}>
                                        ({change > 0 ? "+" : ""}{change.toFixed(1)}%)
                                      </span>
                                    )}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Notes */}
                  <div className="bg-card rounded-lg border border-border p-4">
                    <h3 className="text-sm font-semibold mb-2">Notes</h3>
                    <textarea
                      defaultValue={detail.notes || ""}
                      onBlur={e => saveNotes(detail.id, e.target.value)}
                      placeholder={`Notes about ${detail.name}...`}
                      rows={3}
                      className="w-full rounded-md bg-input border border-border px-3 py-2 text-sm resize-none placeholder:text-muted-foreground/50"
                    />
                  </div>
                </div>
              )}

              {/* Invoices tab */}
              {detailTab === "invoices" && (
                <div className="space-y-2">
                  {linkedInvoices.length === 0 ? (
                    <div className="bg-card rounded-lg border border-border p-6 text-center">
                      <Receipt className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No invoices found for {detail.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">Process an invoice to link it automatically</p>
                    </div>
                  ) : (
                    linkedInvoices.map(inv => {
                      const conf = inv.avg_confidence;
                      const confLabel = conf == null ? null : conf >= 0.9 ? "high" : conf >= 0.7 ? "med" : "low";
                      const confClass = conf == null ? "" : conf >= 0.9 ? "bg-success/15 text-success" : conf >= 0.7 ? "bg-warning/15 text-warning" : "bg-destructive/15 text-destructive";
                      return (
                        <div key={inv.id} className="bg-card rounded-lg border border-border p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">
                                {inv.source_filename || inv.document_number || "No number"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {inv.date ? new Date(inv.date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "No date"}
                                {" · "}{inv.line_count} product{inv.line_count === 1 ? "" : "s"}
                                {" · "}{inv.source_type}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-bold">${Number(inv.total).toFixed(2)}</p>
                              {inv.gst > 0 && <p className="text-[10px] text-muted-foreground">GST ${Number(inv.gst).toFixed(2)}</p>}
                            </div>
                          </div>
                          <div className="mt-1 flex items-center gap-1.5">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${inv.status === "pushed" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
                              {inv.status}
                            </span>
                            {confLabel && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${confClass}`}>
                                {Math.round((conf as number) * 100)}% {confLabel}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* Costs tab */}
              {detailTab === "costs" && (
                <div className="space-y-2">
                  {productCosts.length === 0 ? (
                    <div className="bg-card rounded-lg border border-border p-6 text-center">
                      <DollarSign className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No cost data yet</p>
                      <p className="text-xs text-muted-foreground mt-1">Cost tracking starts when invoices are processed</p>
                    </div>
                  ) : (
                    productCosts.map((pc, i) => (
                      <div key={i} className="bg-card rounded-lg border border-border p-3">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{pc.product_title}</p>
                            <p className="text-xs text-muted-foreground">
                              {pc.sku && `SKU: ${pc.sku} · `}{pc.totalQty} units across {pc.entries} invoice{pc.entries > 1 ? "s" : ""}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {pc.costTrend === "up" && <TrendingUp className="w-3 h-3 text-warning" />}
                            {pc.costTrend === "down" && <TrendingDown className="w-3 h-3 text-success" />}
                            {pc.costTrend === "stable" && <Minus className="w-3 h-3 text-muted-foreground" />}
                          </div>
                        </div>
                        <div className="flex gap-3 mt-2 text-[10px]">
                          <span className="px-2 py-0.5 rounded bg-muted">
                            Avg: <span className="font-mono font-bold">${pc.avgCost.toFixed(2)}</span>
                          </span>
                          {pc.minCost !== pc.maxCost && (
                            <>
                              <span className="px-2 py-0.5 rounded bg-muted">
                                Min: <span className="font-mono">${pc.minCost.toFixed(2)}</span>
                              </span>
                              <span className="px-2 py-0.5 rounded bg-muted">
                                Max: <span className="font-mono">${pc.maxCost.toFixed(2)}</span>
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
              {detailTab === "catalog" && (
                <SupplierCatalog supplierId={detail.id} supplierName={detail.name} />
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // ── List view ───────────────────────────────────────────
  return (
    <div className="min-h-screen pb-24 animate-fade-in">
      <div className="sticky top-0 z-40 bg-background border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
            <h2 className="text-lg font-semibold font-display">📊 Suppliers</h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={syncSpend} disabled={syncing} className="p-2 rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
            </button>
            <Button size="sm" onClick={() => { setForm({ name: "", email: "", rep: "", phone: "", currency: "AUD", notes: "" }); setAddMode(true); }}>
              <Plus className="w-4 h-4 mr-1" /> Add
            </Button>
          </div>
        </div>
        {/* Search */}
        <div className="mt-3 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search suppliers…"
            className="w-full pl-9 pr-3 py-2 rounded-md bg-input border border-border text-sm"
          />
        </div>
      </div>

      <div className="px-4 pt-4">
        {loading ? (
          <div className="text-center py-12 text-sm text-muted-foreground">Loading suppliers…</div>
        ) : filtered.length === 0 ? (
          <div className="bg-card border border-border rounded-lg p-8 text-center">
            <p className="text-sm text-muted-foreground mb-2">{search ? "No matches found." : "No suppliers yet."}</p>
            {!search && (
              <>
                <p className="text-xs text-muted-foreground mb-4">Add a supplier or process your first invoice.</p>
                <Button onClick={onStartInvoice}>→ Upload first invoice</Button>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Summary bar */}
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div className="bg-card rounded-lg border border-border p-3 text-center">
                <p className="text-xs text-muted-foreground">Suppliers</p>
                <p className="text-lg font-bold">{suppliers.length}</p>
              </div>
              <div className="bg-card rounded-lg border border-border p-3 text-center">
                <p className="text-xs text-muted-foreground">Total spend</p>
                <p className="text-lg font-bold">${suppliers.reduce((a, s) => a + Number(s.total_spend), 0).toLocaleString()}</p>
              </div>
              <div className="bg-card rounded-lg border border-border p-3 text-center">
                <p className="text-xs text-muted-foreground">Avg margin</p>
                <p className="text-lg font-bold">
                  {(() => {
                    const withMargin = suppliers.filter(s => s.avg_margin);
                    return withMargin.length ? `${Math.round(withMargin.reduce((a, s) => a + Number(s.avg_margin), 0) / withMargin.length)}%` : "—";
                  })()}
                </p>
              </div>
            </div>

            {filtered.map(s => {
              const spend = Number(s.total_spend);
              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className="w-full bg-card rounded-lg border border-border p-4 text-left active:bg-muted transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold">{s.name}</p>
                        {s.avg_margin && Number(s.avg_margin) >= 60 && <TrendingUp className="w-3.5 h-3.5 text-success" />}
                        {s.avg_margin && Number(s.avg_margin) < 50 && <TrendingDown className="w-3.5 h-3.5 text-destructive" />}
                        {(!s.avg_margin || (Number(s.avg_margin) >= 50 && Number(s.avg_margin) < 60)) && <Minus className="w-3.5 h-3.5 text-muted-foreground" />}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs text-muted-foreground">
                        <span>${spend.toLocaleString()} spend</span>
                        {s.avg_margin && <span>{s.avg_margin}% margin</span>}
                        <span>{s.currency}</span>
                      </div>
                      {s.notes && (
                        <p className="text-[10px] text-muted-foreground mt-1 truncate">{s.notes}</p>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default SupplierPanel;
