import { useState, useEffect, useCallback, useRef } from "react";
import {
  Plus, Trash2, Save, Upload, Search, Archive,
  ArchiveRestore, Loader2, Download, Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import Papa from "papaparse";

export interface CatalogItem {
  id: string;
  supplier_id: string;
  product_name: string;
  sku: string | null;
  barcode: string | null;
  color: string | null;
  size: string | null;
  cost: number;
  lead_time_days: number;
  min_order_qty: number;
  shopify_variant_id: string | null;
  notes: string | null;
  is_archived: boolean;
}

interface Props {
  supplierId: string;
  supplierName: string;
}

export default function SupplierCatalog({ supplierId, supplierName }: Props) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editItem, setEditItem] = useState<CatalogItem | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    product_name: "", sku: "", barcode: "", color: "", size: "",
    cost: "", lead_time_days: "14", min_order_qty: "1",
    shopify_variant_id: "", notes: "",
  });

  const loadItems = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("supplier_catalog_items")
      .select("*")
      .eq("supplier_id", supplierId)
      .order("product_name");
    setItems((data || []) as unknown as CatalogItem[]);
    setLoading(false);
  }, [supplierId]);

  useEffect(() => { loadItems(); }, [loadItems]);

  const resetForm = () => {
    setForm({ product_name: "", sku: "", barcode: "", color: "", size: "", cost: "", lead_time_days: "14", min_order_qty: "1", shopify_variant_id: "", notes: "" });
    setEditItem(null);
    setAddMode(false);
  };

  const handleSave = async () => {
    if (!form.product_name.trim()) { toast.error("Product name required"); return; }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    const payload = {
      user_id: user.id,
      supplier_id: supplierId,
      product_name: form.product_name.trim(),
      sku: form.sku.trim() || null,
      barcode: form.barcode.trim() || null,
      color: form.color.trim() || null,
      size: form.size.trim() || null,
      cost: parseFloat(form.cost) || 0,
      lead_time_days: parseInt(form.lead_time_days) || 14,
      min_order_qty: parseInt(form.min_order_qty) || 1,
      shopify_variant_id: form.shopify_variant_id.trim() || null,
      notes: form.notes.trim() || null,
    };

    if (editItem) {
      await supabase.from("supplier_catalog_items").update(payload).eq("id", editItem.id);
      toast.success("Catalog item updated");
    } else {
      await supabase.from("supplier_catalog_items").insert(payload);
      toast.success("Item added to catalog");
    }

    resetForm();
    setSaving(false);
    await loadItems();
  };

  const handleArchive = async (item: CatalogItem) => {
    await supabase.from("supplier_catalog_items").update({ is_archived: !item.is_archived }).eq("id", item.id);
    toast.success(item.is_archived ? "Item restored" : "Item archived");
    await loadItems();
  };

  const handleDelete = async (item: CatalogItem) => {
    if (!confirm(`Delete "${item.product_name}" from catalog?`)) return;
    await supabase.from("supplier_catalog_items").delete().eq("id", item.id);
    toast.success("Item deleted");
    await loadItems();
  };

  const startEdit = (item: CatalogItem) => {
    setForm({
      product_name: item.product_name,
      sku: item.sku || "",
      barcode: item.barcode || "",
      color: item.color || "",
      size: item.size || "",
      cost: String(item.cost || ""),
      lead_time_days: String(item.lead_time_days),
      min_order_qty: String(item.min_order_qty),
      shopify_variant_id: item.shopify_variant_id || "",
      notes: item.notes || "",
    });
    setEditItem(item);
    setAddMode(true);
  };

  // CSV import
  const handleCSVImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const rows = (results.data as Record<string, string>[]).filter(r =>
          r.product_name?.trim() || r.name?.trim() || r.Product?.trim()
        );

        if (rows.length === 0) { toast.error("No valid rows found in CSV"); return; }

        const inserts = rows.map(r => ({
          user_id: user.id,
          supplier_id: supplierId,
          product_name: (r.product_name || r.name || r.Product || "").trim(),
          sku: (r.sku || r.SKU || "").trim() || null,
          barcode: (r.barcode || r.Barcode || r.EAN || "").trim() || null,
          color: (r.color || r.colour || r.Color || "").trim() || null,
          size: (r.size || r.Size || "").trim() || null,
          cost: parseFloat(r.cost || r.Cost || r.price || "0") || 0,
          lead_time_days: parseInt(r.lead_time_days || r.lead_time || "14") || 14,
          min_order_qty: parseInt(r.min_order_qty || r.moq || r.MOQ || "1") || 1,
          shopify_variant_id: (r.shopify_variant_id || "").trim() || null,
          notes: (r.notes || r.Notes || "").trim() || null,
        }));

        const { error } = await supabase.from("supplier_catalog_items").insert(inserts);
        if (error) { toast.error("Import failed"); console.error(error); }
        else { toast.success(`${inserts.length} items imported`); await loadItems(); }

        if (fileRef.current) fileRef.current.value = "";
      },
    });
  };

  // CSV export
  const handleExport = () => {
    const visible = filtered;
    if (visible.length === 0) { toast.error("No items to export"); return; }
    const csv = Papa.unparse(visible.map(i => ({
      product_name: i.product_name, sku: i.sku || "", barcode: i.barcode || "",
      color: i.color || "", size: i.size || "", cost: i.cost,
      lead_time_days: i.lead_time_days, min_order_qty: i.min_order_qty,
      shopify_variant_id: i.shopify_variant_id || "", notes: i.notes || "",
    })));
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${supplierName}-catalog.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = items.filter(i => {
    if (!showArchived && i.is_archived) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return [i.product_name, i.sku, i.barcode, i.color, i.size].some(v => v?.toLowerCase().includes(q));
  });

  if (loading) return <div className="text-center py-8 text-sm text-muted-foreground">Loading catalog…</div>;

  // Add/edit form
  if (addMode) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">{editItem ? "Edit Catalog Item" : "Add to Catalog"}</h3>
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <label className="text-[10px] text-muted-foreground">Product name *</label>
            <Input value={form.product_name} onChange={e => setForm(p => ({ ...p, product_name: e.target.value }))} className="h-8 text-xs" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">SKU</label>
            <Input value={form.sku} onChange={e => setForm(p => ({ ...p, sku: e.target.value }))} className="h-8 text-xs font-mono" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Barcode</label>
            <Input value={form.barcode} onChange={e => setForm(p => ({ ...p, barcode: e.target.value }))} className="h-8 text-xs font-mono" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Colour</label>
            <Input value={form.color} onChange={e => setForm(p => ({ ...p, color: e.target.value }))} className="h-8 text-xs" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Size</label>
            <Input value={form.size} onChange={e => setForm(p => ({ ...p, size: e.target.value }))} className="h-8 text-xs" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Cost ($)</label>
            <Input type="number" step="0.01" value={form.cost} onChange={e => setForm(p => ({ ...p, cost: e.target.value }))} className="h-8 text-xs font-mono" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Lead time (days)</label>
            <Input type="number" value={form.lead_time_days} onChange={e => setForm(p => ({ ...p, lead_time_days: e.target.value }))} className="h-8 text-xs" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Min order qty</label>
            <Input type="number" value={form.min_order_qty} onChange={e => setForm(p => ({ ...p, min_order_qty: e.target.value }))} className="h-8 text-xs" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Shopify variant ID</label>
            <Input value={form.shopify_variant_id} onChange={e => setForm(p => ({ ...p, shopify_variant_id: e.target.value }))} className="h-8 text-xs font-mono" />
          </div>
          <div className="col-span-2">
            <label className="text-[10px] text-muted-foreground">Notes</label>
            <Input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} className="h-8 text-xs" />
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="flex-1 h-8 text-xs" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
            {editItem ? "Update" : "Add"}
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={resetForm}>Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[140px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search catalog…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setAddMode(true)}>
          <Plus className="w-3 h-3 mr-1" /> Add
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => fileRef.current?.click()}>
          <Upload className="w-3 h-3 mr-1" /> Import
        </Button>
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={handleExport}>
          <Download className="w-3 h-3 mr-1" /> CSV
        </Button>
        <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleCSVImport} />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{filtered.length} item{filtered.length !== 1 ? "s" : ""}</p>
        <button onClick={() => setShowArchived(!showArchived)} className="text-[10px] text-muted-foreground hover:text-foreground">
          {showArchived ? "Hide archived" : "Show archived"}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-8">
          <Package className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm font-medium">No catalog items</p>
          <p className="text-xs text-muted-foreground mt-1">Add products manually, import from CSV, or save items from invoices.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map(item => (
            <div
              key={item.id}
              className={`bg-card rounded-lg border border-border p-3 ${item.is_archived ? "opacity-60" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.product_name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {[item.sku && `SKU: ${item.sku}`, item.color, item.size].filter(Boolean).join(" • ")}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-mono font-semibold">${item.cost.toFixed(2)}</p>
                  <p className="text-[10px] text-muted-foreground">MOQ {item.min_order_qty} · {item.lead_time_days}d</p>
                </div>
              </div>
              {item.is_archived && <Badge variant="outline" className="text-[9px] mt-1">Archived</Badge>}
              <div className="flex gap-1 mt-2">
                <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => startEdit(item)}>Edit</Button>
                <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => handleArchive(item)}>
                  {item.is_archived ? <><ArchiveRestore className="w-3 h-3 mr-0.5" /> Restore</> : <><Archive className="w-3 h-3 mr-0.5" /> Archive</>}
                </Button>
                <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-destructive hover:text-destructive" onClick={() => handleDelete(item)}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Standalone picker for selecting catalog items into PO lines */
export function CatalogPicker({
  supplierId,
  onSelect,
}: {
  supplierId: string;
  onSelect: (items: CatalogItem[]) => void;
}) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("supplier_catalog_items")
        .select("*")
        .eq("supplier_id", supplierId)
        .eq("is_archived", false)
        .order("product_name");
      setItems((data || []) as unknown as CatalogItem[]);
      setLoading(false);
    })();
  }, [supplierId]);

  const filtered = items.filter(i => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [i.product_name, i.sku, i.barcode].some(v => v?.toLowerCase().includes(q));
  });

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (loading) return <div className="py-4 text-center text-xs text-muted-foreground">Loading catalog…</div>;
  if (items.length === 0) return <p className="py-4 text-center text-xs text-muted-foreground">No catalog items for this supplier.</p>;

  return (
    <div className="space-y-3">
      <Input placeholder="Search catalog…" value={search} onChange={e => setSearch(e.target.value)} className="h-8 text-xs" />
      <div className="max-h-60 overflow-y-auto space-y-1">
        {filtered.map(item => (
          <label key={item.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer text-xs">
            <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} className="rounded" />
            <span className="flex-1 truncate">{item.product_name}</span>
            {item.sku && <span className="font-mono text-muted-foreground">{item.sku}</span>}
            <span className="font-mono shrink-0">${item.cost.toFixed(2)}</span>
          </label>
        ))}
      </div>
      <Button
        size="sm"
        className="w-full h-8 text-xs"
        disabled={selected.size === 0}
        onClick={() => onSelect(items.filter(i => selected.has(i.id)))}
      >
        Add {selected.size} item{selected.size !== 1 ? "s" : ""} to PO
      </Button>
    </div>
  );
}

/** Utility: save invoice lines as catalog items for a supplier */
export async function saveInvoiceLinesToCatalog(
  supplierId: string,
  userId: string,
  lines: { product_title: string; sku?: string; unit_cost: number; color?: string; size?: string }[]
) {
  if (lines.length === 0) return 0;

  // Check for existing SKUs to avoid duplicates
  const { data: existing } = await supabase
    .from("supplier_catalog_items")
    .select("sku")
    .eq("supplier_id", supplierId)
    .eq("is_archived", false);

  const existingSkus = new Set((existing || []).map(e => e.sku?.toLowerCase()).filter(Boolean));

  const newItems = lines.filter(l => {
    if (!l.product_title?.trim()) return false;
    if (l.sku && existingSkus.has(l.sku.toLowerCase())) return false;
    return true;
  });

  if (newItems.length === 0) return 0;

  const { error } = await supabase.from("supplier_catalog_items").insert(
    newItems.map(l => ({
      user_id: userId,
      supplier_id: supplierId,
      product_name: l.product_title,
      sku: l.sku || null,
      color: l.color || null,
      size: l.size || null,
      cost: l.unit_cost || 0,
    }))
  );

  return error ? 0 : newItems.length;
}
