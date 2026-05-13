import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface Kw {
  id: string;
  vertical: string;
  bucket: string;
  keyword: string;
  region: string;
  city: string | null;
  search_intent: string | null;
}

const VERTICALS = ["ALL", "FOOTWEAR", "SWIMWEAR", "CLOTHING", "ACCESSORIES", "LIFESTYLE"];

export default function SeoKeywords() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Kw[]>([]);
  const [vertical, setVertical] = useState("ALL");
  const [newKw, setNewKw] = useState({ vertical: "FOOTWEAR", bucket: "high_volume", keyword: "", city: "" });

  useEffect(() => { void load(); }, []);

  async function load() {
    const { data } = await supabase
      .from("seo_keyword_library")
      .select("*")
      .order("vertical")
      .order("bucket");
    setRows((data ?? []) as Kw[]);
  }

  const filtered = vertical === "ALL" ? rows : rows.filter((r) => r.vertical === vertical);
  const byBucket = filtered.reduce<Record<string, Kw[]>>((acc, r) => {
    (acc[r.bucket] ||= []).push(r);
    return acc;
  }, {});

  async function addKeyword() {
    if (!newKw.keyword.trim()) return;
    const { error } = await supabase.from("seo_keyword_library").insert({
      vertical: newKw.vertical,
      bucket: newKw.bucket,
      keyword: newKw.keyword.trim(),
      city: newKw.city.trim() || null,
    });
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else { setNewKw((s) => ({ ...s, keyword: "", city: "" })); await load(); }
  }

  async function remove(id: string) {
    await supabase.from("seo_keyword_library").delete().eq("id", id);
    await load();
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header>
          <h1 className="text-2xl font-bold">Keyword Library</h1>
          <p className="text-sm text-muted-foreground">
            Pre-loaded keyword buckets that the SEO Engine pulls from per vertical and layer.
          </p>
        </header>

        <div className="flex gap-2 flex-wrap">
          {VERTICALS.map((v) => (
            <Button key={v} size="sm" variant={v === vertical ? "default" : "outline"} onClick={() => setVertical(v)}>
              {v}
            </Button>
          ))}
        </div>

        <Card className="p-3 flex flex-wrap gap-2 items-end">
          <select className="bg-card border border-border rounded px-2 py-1 text-sm" value={newKw.vertical}
            onChange={(e) => setNewKw({ ...newKw, vertical: e.target.value })}>
            {VERTICALS.filter((v) => v !== "ALL").map((v) => <option key={v}>{v}</option>)}
          </select>
          <select className="bg-card border border-border rounded px-2 py-1 text-sm" value={newKw.bucket}
            onChange={(e) => setNewKw({ ...newKw, bucket: e.target.value })}>
            {["high_volume","type_specific","local","brand_long_tail","occasion","material","colour","feature"].map((b) =>
              <option key={b}>{b}</option>)}
          </select>
          <input className="bg-card border border-border rounded px-2 py-1 text-sm flex-1 min-w-[200px]"
            placeholder="keyword" value={newKw.keyword} onChange={(e) => setNewKw({ ...newKw, keyword: e.target.value })} />
          <input className="bg-card border border-border rounded px-2 py-1 text-sm w-32"
            placeholder="city (optional)" value={newKw.city} onChange={(e) => setNewKw({ ...newKw, city: e.target.value })} />
          <Button onClick={addKeyword}>Add</Button>
        </Card>

        {Object.entries(byBucket).map(([bucket, list]) => (
          <Card key={bucket} className="p-4">
            <h3 className="font-semibold mb-2">{bucket} <span className="text-xs text-muted-foreground">({list.length})</span></h3>
            <div className="flex flex-wrap gap-2">
              {list.map((k) => (
                <Badge key={k.id} variant="secondary" className="cursor-pointer" onClick={() => remove(k.id)}>
                  {k.vertical} · {k.keyword}{k.city ? ` · ${k.city}` : ""} ✕
                </Badge>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
