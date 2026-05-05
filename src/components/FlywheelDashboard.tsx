import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Zap } from "lucide-react";

interface Row {
  brand_name: string;
  sample_count: number;
  accuracy_rate: number | null;
  supplier_sku_format: string | null;
  size_schema: string | null;
  updated_at: string | null;
}

const fmtPct = (n: number | null) =>
  n == null ? "—" : `${Math.round(n * 100)}%`;
const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString() : "—";

export default function FlywheelDashboard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data } = await supabase
        .from("brand_patterns" as any)
        .select("brand_name,sample_count,accuracy_rate,supplier_sku_format,size_schema,updated_at")
        .eq("user_id", user.id)
        .order("sample_count", { ascending: false })
        .limit(500);
      setRows((data as any) || []);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? rows.filter((r) => r.brand_name?.toLowerCase().includes(t)) : rows;
  }, [rows, q]);

  const totals = useMemo(() => {
    const invoices = rows.reduce((s, r) => s + (r.sample_count || 0), 0);
    const brands = rows.length;
    const weighted =
      invoices > 0
        ? rows.reduce((s, r) => s + (r.accuracy_rate || 0) * (r.sample_count || 0), 0) / invoices
        : 0;
    return { invoices, brands, accuracy: weighted };
  }, [rows]);

  return (
    <section className="px-4 py-6 max-w-6xl mx-auto">
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-5 h-5 text-primary" />
          <h1 className="text-2xl sm:text-3xl font-bold font-display">Flywheel</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Every invoice you parse trains a brand-specific pattern. Accuracy rises with each
          correction. This is your private learning loop.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Stat label="Brands learned" value={totals.brands.toString()} />
        <Stat label="Invoices parsed" value={totals.invoices.toLocaleString()} />
        <Stat label="Avg accuracy" value={fmtPct(totals.accuracy || null)} />
      </div>

      <div className="mb-4 max-w-sm">
        <Input
          placeholder="Search brand…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search brand"
        />
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          No brands learned yet. Parse your first invoice to start the flywheel.
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full font-mono-data text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Brand</th>
                <th className="px-4 py-2 font-medium">Invoices</th>
                <th className="px-4 py-2 font-medium">Accuracy</th>
                <th className="px-4 py-2 font-medium">SKU format</th>
                <th className="px-4 py-2 font-medium">Sizes</th>
                <th className="px-4 py-2 font-medium">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const acc = r.accuracy_rate ? Math.round(r.accuracy_rate * 100) : null;
                const tone =
                  acc == null ? "secondary" : acc >= 90 ? "default" : acc >= 70 ? "secondary" : "destructive";
                return (
                  <tr
                    key={r.brand_name}
                    className="border-t border-border h-8 hover:bg-muted/20 odd:bg-muted/5"
                  >
                    <td className="px-4 py-1.5 font-medium">{r.brand_name}</td>
                    <td className="px-4 py-1.5">{(r.sample_count || 0).toLocaleString()}</td>
                    <td className="px-4 py-1.5">
                      {acc != null ? <Badge variant={tone as any}>{acc}%</Badge> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-1.5 text-muted-foreground">{r.supplier_sku_format || "—"}</td>
                    <td className="px-4 py-1.5 text-muted-foreground">{r.size_schema || "—"}</td>
                    <td className="px-4 py-1.5 text-muted-foreground">{fmtDate(r.updated_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <Card className="p-5">
    <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
    <div className="mt-1 text-3xl font-bold font-display text-primary">{value}</div>
  </Card>
);
