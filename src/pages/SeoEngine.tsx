import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import ProductSeoAuditPanel from "@/components/ProductSeoAuditPanel";

const VERTICALS = ["ALL", "FOOTWEAR", "SWIMWEAR", "CLOTHING", "ACCESSORIES", "LIFESTYLE"] as const;

interface Suggestion {
  id: string;
  suggested_title: string;
  suggested_handle: string;
  collection_type: string;
  product_count: number;
  status: string;
  completeness_score?: number | null;
  taxonomy_level?: number | null;
}
interface Output {
  suggestion_id: string;
  layer: number;
  seo_title: string | null;
  meta_description: string | null;
  status: string;
  rules_status: string;
  rules_validated_count?: number | null;
  validation_errors: any;
}

export default function SeoEngine() {
  const { toast } = useToast();
  const [vertical, setVertical] = useState<typeof VERTICALS[number]>("ALL");
  const [storeName, setStoreName] = useState("Stomp Shoes Darwin");
  const [storeCity, setStoreCity] = useState("Darwin");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [outputs, setOutputs] = useState<Record<string, Output>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    const { data: s } = await supabase
      .from("collection_suggestions")
      .select("id,suggested_title,suggested_handle,collection_type,product_count,status,completeness_score,taxonomy_level")
      .order("completeness_score", { ascending: true, nullsFirst: true })
      .limit(200);
    setSuggestions((s ?? []) as Suggestion[]);
    const { data: o } = await supabase
      .from("collection_seo_outputs")
      .select("suggestion_id,layer,seo_title,meta_description,status,rules_status,rules_validated_count,validation_errors");
    const m: Record<string, Output> = {};
    (o ?? []).forEach((row: any) => { m[row.suggestion_id] = row; });
    setOutputs(m);
    setLoading(false);
  }

  async function validateRules(ids?: string[]) {
    try {
      const { data, error } = await supabase.functions.invoke("seo-rules-validator", {
        body: ids?.length ? { suggestion_ids: ids } : { limit: 25 },
      });
      if (error) throw error;
      toast({ title: "Rules validated", description: `${data?.results?.length ?? 0} checked` });
      await load();
    } catch (e: any) {
      toast({ title: "Validation failed", description: String(e?.message || e), variant: "destructive" });
    }
  }

  async function generate(id: string) {
    setRunning(id);
    try {
      const { data, error } = await supabase.functions.invoke("seo-collection-engine", {
        body: {
          suggestion_id: id,
          vertical: vertical === "ALL" ? "FOOTWEAR" : vertical,
          store_name: storeName,
          store_city: storeCity,
        },
      });
      if (error) throw error;
      toast({ title: "SEO generated", description: `Layer ${data?.layer}` });
      await load();
    } catch (e: any) {
      toast({ title: "Failed", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setRunning(null);
    }
  }

  async function generateAll() {
    for (const s of suggestions) {
      if (outputs[s.id]) continue;
      await generate(s.id);
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">SEO Engine</h1>
            <p className="text-sm text-muted-foreground">
              Universal four-layer collection SEO across brand, type, occasion and trend.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              className="bg-card border border-border rounded px-2 py-1 text-sm"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              placeholder="Store name"
            />
            <input
              className="bg-card border border-border rounded px-2 py-1 text-sm w-28"
              value={storeCity}
              onChange={(e) => setStoreCity(e.target.value)}
              placeholder="City"
            />
            <Button onClick={generateAll} disabled={!!running}>
              Generate all missing
            </Button>
            <Button variant="outline" onClick={() => validateRules()}>
              Validate rules
            </Button>
          </div>
        </header>

        <div className="flex gap-2 flex-wrap">
          {VERTICALS.map((v) => (
            <Button
              key={v}
              size="sm"
              variant={v === vertical ? "default" : "outline"}
              onClick={() => setVertical(v)}
            >
              {v}
            </Button>
          ))}
        </div>

        <Card className="p-0 overflow-hidden">
          {loading ? (
            <div className="p-6 text-muted-foreground">Loading…</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="p-2">Collection</th>
                  <th className="p-2">L</th>
                  <th className="p-2">Score</th>
                  <th className="p-2">Type</th>
                  <th className="p-2">Products</th>
                  <th className="p-2">Title</th>
                  <th className="p-2">Meta</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Rules</th>
                  <th className="p-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s) => {
                  const o = outputs[s.id];
                  const titleLen = o?.seo_title?.length ?? 0;
                  const metaLen = o?.meta_description?.length ?? 0;
                  const metaOk = metaLen >= 150 && metaLen <= 160;
                  return (
                    <tr key={s.id} className="border-t border-border/40 h-8">
                      <td className="p-2 truncate max-w-[260px]">{s.suggested_title}</td>
                      <td className="p-2 text-xs">{s.taxonomy_level ?? "—"}</td>
                      <td className="p-2">
                        {typeof s.completeness_score === "number" ? (
                          <Badge
                            variant={s.completeness_score >= 80 ? "secondary" : "outline"}
                            className={
                              s.completeness_score >= 80 ? "bg-emerald-500/15 text-emerald-500"
                              : s.completeness_score >= 50 ? "bg-amber-500/15 text-amber-500"
                              : "bg-destructive/15 text-destructive"
                            }
                          >
                            {s.completeness_score}
                          </Badge>
                        ) : "—"}
                      </td>
                      <td className="p-2 text-xs text-muted-foreground">{s.collection_type}</td>
                      <td className="p-2">{s.product_count}</td>
                      <td className="p-2">
                        {o?.seo_title ? (
                          <span className={titleLen > 60 ? "text-destructive" : ""}>
                            {titleLen}/60
                          </span>
                        ) : "—"}
                      </td>
                      <td className="p-2">
                        {o?.meta_description ? (
                          <span className={metaOk ? "text-emerald-500" : "text-amber-500"}>
                            {metaLen}/150-160
                          </span>
                        ) : "—"}
                      </td>
                      <td className="p-2">
                        {o ? (
                          <Badge variant={o.validation_errors ? "destructive" : "secondary"}>
                            {o.status}
                            {o.validation_errors ? ` · ${(o.validation_errors as any[]).length} issues` : ""}
                          </Badge>
                        ) : (
                          <Badge variant="outline">no SEO</Badge>
                        )}
                      </td>
                      <td className="p-2">
                        {o ? (
                          <Badge
                            variant={
                              o.rules_status === "validated" ? "secondary"
                              : o.rules_status === "insufficient" ? "destructive"
                              : o.rules_status === "error" ? "destructive"
                              : "outline"
                            }
                          >
                            {o.rules_status}{typeof o.rules_validated_count === "number" ? ` · ${o.rules_validated_count}` : ""}
                          </Badge>
                        ) : "—"}
                      </td>
                      <td className="p-2 space-x-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={running === s.id}
                          onClick={() => generate(s.id)}
                        >
                          {running === s.id ? "Generating…" : o ? "Regenerate" : "Generate"}
                        </Button>
                        {o && (
                          <Button size="sm" variant="ghost" onClick={() => validateRules([s.id])}>
                            Validate
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
