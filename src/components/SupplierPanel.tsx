import { useState, useEffect, useCallback } from "react";
import {
  ChevronLeft, ChevronRight, Plus, Pencil, Trash2,
  TrendingUp, TrendingDown, Minus, FileText, Package,
  BarChart3, Clock, DollarSign, Save, X, Search, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { DbSupplier } from "@/lib/db-schema-types";
import { getCostHistory } from "@/components/InvoiceFlow";

interface SupplierPanelProps {
  onBack: () => void;
  onStartInvoice: () => void;
}

type SupplierRow = DbSupplier;

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

    // Seed demos if empty
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

  // ── Sync spend from accounting_push_history ─────────────
  const syncSpend = async () => {
    setSyncing(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setSyncing(false); return; }

    const { data: pushHistory } = await supabase
      .from("accounting_push_history")
      .select("supplier_name, total_inc_gst")
      .eq("user_id", session.user.id);

    if (pushHistory && pushHistory.length > 0) {
      const spendMap: Record<string, number> = {};
      for (const row of pushHistory) {
        const name = row.supplier_name || "";
        spendMap[name] = (spendMap[name] || 0) + (Number(row.total_inc_gst) || 0);
      }

      for (const supplier of suppliers) {
        const spend = spendMap[supplier.name];
        if (spend && spend !== supplier.total_spend) {
          await supabase.from("suppliers").update({ total_spend: spend }).eq("id", supplier.id);
        }
      }
      await loadSuppliers();
      toast.success("Spend synced from accounting history");
    } else {
      toast("No accounting history found to sync");
    }
    setSyncing(false);
  };

  // ── Add supplier ────────────────────────────────────────
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

  // ── Update supplier ─────────────────────────────────────
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

  // ── Delete supplier ─────────────────────────────────────
  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete ${name}? This cannot be undone.`)) return;
    const { error } = await supabase.from("suppliers").delete().eq("id", id);
    if (error) { toast.error("Failed to delete"); return; }
    toast.success(`${name} deleted`);
    setSelectedId(null);
    loadSuppliers();
  };

  // ── Save notes inline ──────────────────────────────────
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
              { label: "Currency", value: detail.currency, icon: FileText },
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

          {/* Cost history */}
          {priceHistory.length > 0 && (
            <div className="bg-card rounded-lg border border-border p-4">
              <h3 className="text-sm font-semibold mb-3">Cost history</h3>
              <div className="space-y-2">
                {priceHistory.map((ph, i) => (
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
                        {s.avg_margin && Number(s.avg_margin) >= 60 && <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />}
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
