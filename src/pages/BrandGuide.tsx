import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

interface BrandRow {
  brand_name: string;
  invoices_parsed: number;
  avg_accuracy: number | null;
  supplier_sku_format: string | null;
  size_schema: string | null;
  retailers: number;
  last_seen_at: string | null;
}

const setMeta = (name: string, content: string) => {
  let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
};

export default function BrandGuide() {
  const [rows, setRows] = useState<BrandRow[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "AU Fashion Brand Invoice Parsing Guide | Sonic Invoices";
    setMeta(
      "description",
      "Open directory of Australian fashion brand invoice formats: SKU patterns, size schemas, and AI parsing accuracy from real retailer data."
    );
    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = `${window.location.origin}/brand-guide`;
  }, []);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("get_public_brand_guide" as any);
      if (!error && data) setRows(data as BrandRow[]);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => r.brand_name.toLowerCase().includes(t));
  }, [rows, q]);

  const jsonLd = useMemo(
    () => ({
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: "AU Fashion Brand Invoice Parsing Guide",
      description:
        "Aggregated parsing accuracy and invoice format patterns for Australian fashion brands.",
      creator: { "@type": "Organization", name: "Sonic Invoices" },
      url: `${typeof window !== "undefined" ? window.location.origin : ""}/brand-guide`,
    }),
    []
  );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <header className="border-b border-border">
        <div className="container mx-auto max-w-6xl px-6 py-10">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← Sonic Invoices
          </Link>
          <h1 className="mt-4 font-[Syne] text-4xl font-bold tracking-tight md:text-5xl">
            AU Fashion Brand Invoice Guide
          </h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Open data from real retailer invoice parsing. SKU patterns, size schemas, and live AI
            accuracy scores — built by the Sonic Invoices flywheel.
          </p>
          <div className="mt-6 max-w-md">
            <Input
              placeholder="Search brand…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search brand"
            />
          </div>
        </div>
      </header>

      <section className="container mx-auto max-w-6xl px-6 py-10">
        {loading ? (
          <p className="text-muted-foreground">Loading brands…</p>
        ) : filtered.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            No brands yet. As retailers parse invoices, this directory grows automatically.
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full font-[IBM_Plex_Mono] text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Brand</th>
                  <th className="px-4 py-3 font-medium">Invoices</th>
                  <th className="px-4 py-3 font-medium">Accuracy</th>
                  <th className="px-4 py-3 font-medium">SKU format</th>
                  <th className="px-4 py-3 font-medium">Size schema</th>
                  <th className="px-4 py-3 font-medium">Retailers</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const acc = r.avg_accuracy ? Math.round(r.avg_accuracy * 100) : null;
                  const tone =
                    acc == null ? "secondary" : acc >= 90 ? "default" : acc >= 70 ? "secondary" : "destructive";
                  return (
                    <tr key={r.brand_name} className="border-t border-border hover:bg-muted/20">
                      <td className="px-4 py-3 font-medium">{r.brand_name}</td>
                      <td className="px-4 py-3">{r.invoices_parsed.toLocaleString()}</td>
                      <td className="px-4 py-3">
                        {acc != null ? <Badge variant={tone as any}>{acc}%</Badge> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{r.supplier_sku_format || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{r.size_schema || "—"}</td>
                      <td className="px-4 py-3">{r.retailers}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-6 text-xs text-muted-foreground">
          Aggregated, anonymised data. No invoice contents or retailer identities are exposed.
        </p>
      </section>
    </main>
  );
}
