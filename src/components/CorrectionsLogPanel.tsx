import { useEffect, useMemo, useState } from "react";
import { ScrollText, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";

interface Row {
  id: string;
  supplier_key: string;
  shopify_vendor: string | null;
  sku: string | null;
  field_corrected: string;
  value_before: string | null;
  value_after: string | null;
  correction_type: string;
  created_at: string;
}

const TYPE_COLOURS: Record<string, string> = {
  field_edit: "bg-primary/15 text-primary border-primary/30",
  row_reject: "bg-destructive/15 text-destructive border-destructive/30",
  row_accept: "bg-success/15 text-success border-success/30",
  vendor_override: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  type_override: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  size_correction: "bg-secondary/15 text-secondary-foreground border-secondary/30",
  colour_correction: "bg-secondary/15 text-secondary-foreground border-secondary/30",
};

/**
 * Corrections capture log — every user edit, reject, vendor/type override
 * recorded from the Review screen. Feeds the grader rubric and (later)
 * Claude Managed Agents Dreaming.
 */
export default function CorrectionsLogPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("corrections" as never)
        .select("id, supplier_key, shopify_vendor, sku, field_corrected, value_before, value_after, correction_type, created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (cancelled) return;
      if (error) {
        console.warn("[corrections] load failed:", error);
        setRows([]);
      } else {
        setRows((data as unknown as Row[]) || []);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const suppliers = useMemo(
    () => Array.from(new Set(rows.map((r) => r.supplier_key).filter(Boolean))).sort(),
    [rows],
  );
  const fieldTypes = useMemo(
    () => Array.from(new Set(rows.map((r) => r.correction_type))).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (supplierFilter !== "all" && r.supplier_key !== supplierFilter) return false;
      if (typeFilter !== "all" && r.correction_type !== typeFilter) return false;
      if (!q) return true;
      return [r.supplier_key, r.sku, r.field_corrected, r.value_before, r.value_after]
        .some((v) => (v || "").toLowerCase().includes(q));
    });
  }, [rows, search, supplierFilter, typeFilter]);

  return (
    <div className="animate-fade-in">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search supplier, SKU, field, value…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-xs bg-card border-border"
          />
        </div>
        <select
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value)}
          className="h-9 text-xs bg-card border border-border rounded px-2"
        >
          <option value="all">All suppliers</option>
          {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="h-9 text-xs bg-card border border-border rounded px-2"
        >
          <option value="all">All types</option>
          {fieldTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <Card className="bg-card border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Supplier</th>
                <th className="px-3 py-2 font-medium">SKU</th>
                <th className="px-3 py-2 font-medium">Field</th>
                <th className="px-3 py-2 font-medium">Before</th>
                <th className="px-3 py-2 font-medium">After</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium text-right">When</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">Loading corrections…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                  No corrections logged yet. Edit, reject, or override product rows on the Review screen and they'll appear here.
                </td></tr>
              )}
              {!loading && filtered.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-2 whitespace-nowrap">{r.supplier_key}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{r.sku || "—"}</td>
                  <td className="px-3 py-2">{r.field_corrected}</td>
                  <td className="px-3 py-2 max-w-[180px] truncate text-muted-foreground" title={r.value_before || ""}>
                    {r.value_before || <span className="italic">(blank)</span>}
                  </td>
                  <td className="px-3 py-2 max-w-[180px] truncate" title={r.value_after || ""}>
                    {r.value_after || <span className="italic text-muted-foreground">(blank)</span>}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={`text-[10px] ${TYPE_COLOURS[r.correction_type] || ""}`}>
                      {r.correction_type.replace(/_/g, " ")}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground whitespace-nowrap">
                    {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="mt-3 text-[11px] text-muted-foreground flex items-center gap-1.5">
        <ScrollText className="w-3 h-3" />
        Showing {filtered.length} of {rows.length} corrections · feeds the grader rubric on the next invoice from each supplier.
      </p>
    </div>
  );
}
