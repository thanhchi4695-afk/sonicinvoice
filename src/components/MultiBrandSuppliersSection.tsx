import { useEffect, useState } from "react";
import { Plus, Trash2, Save, Loader2, Sparkles, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────────────────
// Multi-brand suppliers settings
// Some suppliers (e.g. Skye Group, Way Funky) invoice multiple distinct
// fashion brands under one company name. The classify-extract-validate edge
// function looks up rows from `multi_brand_suppliers` keyed by the invoice
// company name and assigns a brand per line item using the SKU prefix.
//
// This panel lets staff:
//   • Load the 5 known starter rules with one click
//   • Add / edit / delete their own (company name + sku_prefix → brand mappings)
// ─────────────────────────────────────────────────────────────────────────────

type BrandRule = { sku_prefix: string; brand: string };

interface Row {
  id?: string;
  invoice_company_name: string;
  brand_rules: BrandRule[];
  _dirty?: boolean;
  _saving?: boolean;
}

const STARTER_RULES: Row[] = [
  {
    invoice_company_name: "Skye Group",
    brand_rules: [
      { sku_prefix: "JAN", brand: "Jantzen" },
      { sku_prefix: "SUN", brand: "Sunseeker" },
    ],
  },
  {
    invoice_company_name: "Way Funky",
    brand_rules: [
      { sku_prefix: "FKT", brand: "Funkita" },
      { sku_prefix: "FTK", brand: "Funky Trunks" },
      { sku_prefix: "FKG", brand: "Funkita Girls" },
    ],
  },
  {
    invoice_company_name: "Seafolly Pty Ltd",
    brand_rules: [
      { sku_prefix: "S", brand: "Seafolly" },
      { sku_prefix: "J", brand: "Jets Swimwear" },
    ],
  },
  {
    invoice_company_name: "Sunshades Eyewear",
    brand_rules: [
      { sku_prefix: "LSP", brand: "Le Specs" },
      { sku_prefix: "AIR", brand: "Aire" },
      { sku_prefix: "LSU", brand: "Le Specs Underground" },
      { sku_prefix: "LSH", brand: "Le Specs Hers" },
    ],
  },
  {
    invoice_company_name: "Wacoal",
    brand_rules: [
      { sku_prefix: "WA", brand: "Wacoal" },
      { sku_prefix: "FAN", brand: "Fantasie" },
      { sku_prefix: "FR", brand: "Freya" },
      { sku_prefix: "EL", brand: "Elomi" },
      { sku_prefix: "GO", brand: "Goddess" },
    ],
  },
];

export default function MultiBrandSuppliersSection() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setRows([]); return; }
      const { data, error } = await supabase
        .from("multi_brand_suppliers")
        .select("id, invoice_company_name, brand_rules")
        .eq("user_id", user.id)
        .order("invoice_company_name");
      if (error) { toast.error(error.message); return; }
      setRows((data ?? []).map((r) => ({
        id: r.id,
        invoice_company_name: r.invoice_company_name,
        brand_rules: Array.isArray(r.brand_rules) ? (r.brand_rules as BrandRule[]) : [],
      })));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const updateRow = (idx: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, ...patch, _dirty: true } : r));
  };

  const updateRule = (rowIdx: number, ruleIdx: number, patch: Partial<BrandRule>) => {
    setRows((prev) => prev.map((r, i) => {
      if (i !== rowIdx) return r;
      const rules = r.brand_rules.map((rule, j) => j === ruleIdx ? { ...rule, ...patch } : rule);
      return { ...r, brand_rules: rules, _dirty: true };
    }));
  };

  const addRule = (rowIdx: number) => {
    setRows((prev) => prev.map((r, i) => i === rowIdx
      ? { ...r, brand_rules: [...r.brand_rules, { sku_prefix: "", brand: "" }], _dirty: true }
      : r));
  };

  const removeRule = (rowIdx: number, ruleIdx: number) => {
    setRows((prev) => prev.map((r, i) => i === rowIdx
      ? { ...r, brand_rules: r.brand_rules.filter((_, j) => j !== ruleIdx), _dirty: true }
      : r));
  };

  const addRow = () => {
    setRows((prev) => [...prev, { invoice_company_name: "", brand_rules: [{ sku_prefix: "", brand: "" }], _dirty: true }]);
  };

  const saveRow = async (idx: number) => {
    const row = rows[idx];
    if (!row.invoice_company_name.trim()) { toast.error("Invoice company name required"); return; }
    const cleanRules = row.brand_rules
      .map((r) => ({ sku_prefix: r.sku_prefix.trim().toUpperCase(), brand: r.brand.trim() }))
      .filter((r) => r.sku_prefix && r.brand);
    if (cleanRules.length === 0) { toast.error("Add at least one SKU prefix → brand rule"); return; }

    updateRow(idx, { _saving: true });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Not signed in"); updateRow(idx, { _saving: false }); return; }

    const { error } = await supabase
      .from("multi_brand_suppliers")
      .upsert({
        ...(row.id ? { id: row.id } : {}),
        user_id: user.id,
        invoice_company_name: row.invoice_company_name.trim(),
        brand_rules: cleanRules,
      } as never, { onConflict: "user_id,invoice_company_name" });

    if (error) { toast.error(error.message); updateRow(idx, { _saving: false }); return; }
    toast.success(`Saved ${row.invoice_company_name}`);
    await load();
  };

  const deleteRow = async (idx: number) => {
    const row = rows[idx];
    if (!row.id) {
      // Unsaved — just drop locally.
      setRows((prev) => prev.filter((_, i) => i !== idx));
      return;
    }
    if (!confirm(`Delete multi-brand rule for "${row.invoice_company_name}"?`)) return;
    const { error } = await supabase.from("multi_brand_suppliers").delete().eq("id", row.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Deleted");
    await load();
  };

  const seedStarters = async () => {
    setSeeding(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Not signed in"); return; }
      const inserts = STARTER_RULES.map((r) => ({
        user_id: user.id,
        invoice_company_name: r.invoice_company_name,
        brand_rules: r.brand_rules,
      }));
      const { error } = await supabase
        .from("multi_brand_suppliers")
        .upsert(inserts as never, { onConflict: "user_id,invoice_company_name" });
      if (error) { toast.error(error.message); return; }
      toast.success(`Loaded ${inserts.length} starter multi-brand rules`);
      await load();
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-secondary" />
            Multi-brand suppliers
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            When a single company invoices multiple brands, we auto-assign each line item to
            the right brand based on its SKU prefix.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={seedStarters} disabled={seeding}>
            {seeding ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
            Load starter rules
          </Button>
          <Button size="sm" onClick={addRow}>
            <Plus className="w-3.5 h-3.5 mr-1" /> New
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-4 text-center">
          <AlertTriangle className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            No multi-brand rules yet. Click <span className="font-semibold">Load starter rules</span> to import the 5 known suppliers
            (Skye Group, Way Funky, Seafolly Pty Ltd, Sunshades Eyewear, Wacoal).
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row, idx) => (
            <div key={row.id ?? `new-${idx}`} className="rounded-md border border-border p-3 space-y-2 bg-background">
              <div className="flex items-center gap-2">
                <Input
                  value={row.invoice_company_name}
                  placeholder="Invoice company name (e.g. Skye Group)"
                  className="h-8 text-sm flex-1"
                  onChange={(e) => updateRow(idx, { invoice_company_name: e.target.value })}
                />
                <Button size="sm" variant="ghost" onClick={() => deleteRow(idx)} title="Delete">
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </Button>
              </div>
              <div className="space-y-1.5">
                {row.brand_rules.map((rule, ruleIdx) => (
                  <div key={ruleIdx} className="flex items-center gap-1.5">
                    <Input
                      value={rule.sku_prefix}
                      placeholder="SKU prefix"
                      className="h-7 text-xs font-mono w-28 uppercase"
                      onChange={(e) => updateRule(idx, ruleIdx, { sku_prefix: e.target.value.toUpperCase() })}
                    />
                    <span className="text-xs text-muted-foreground">→</span>
                    <Input
                      value={rule.brand}
                      placeholder="Brand name"
                      className="h-7 text-xs flex-1"
                      onChange={(e) => updateRule(idx, ruleIdx, { brand: e.target.value })}
                    />
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => removeRule(idx, ruleIdx)} title="Remove rule">
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => addRule(idx)}>
                  <Plus className="w-3 h-3 mr-1" /> Add rule
                </Button>
                <Button
                  size="sm"
                  variant={row._dirty ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => saveRow(idx)}
                  disabled={row._saving || !row._dirty}
                >
                  {row._saving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
                  {row._dirty ? "Save changes" : "Saved"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
