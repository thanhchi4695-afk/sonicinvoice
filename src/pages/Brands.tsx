import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Loader2, RefreshCw, Plus, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

type Vertical = "FOOTWEAR" | "SWIMWEAR" | "CLOTHING" | "ACCESSORIES" | "LIFESTYLE";

const PRIORITY_BRANDS: Array<{ name: string; domain: string; tier: 1 | 2; vertical: Vertical; store: "Splash" | "Stomp" }> = [
  // Splash Swimwear
  { name: "Seafolly", domain: "seafolly.com", tier: 1, vertical: "SWIMWEAR", store: "Splash" },
  { name: "Bond Eye", domain: "bondeye.com.au", tier: 1, vertical: "SWIMWEAR", store: "Splash" },
  { name: "Sea Level", domain: "sealevelswim.com.au", tier: 1, vertical: "SWIMWEAR", store: "Splash" },
  { name: "Baku", domain: "baku.com.au", tier: 1, vertical: "SWIMWEAR", store: "Splash" },
  { name: "JETS", domain: "jetsswimwear.com.au", tier: 1, vertical: "SWIMWEAR", store: "Splash" },
  { name: "Sunseeker", domain: "sunseekerswimwear.com.au", tier: 1, vertical: "SWIMWEAR", store: "Splash" },
  { name: "Tigerlily", domain: "tigerlily.com.au", tier: 1, vertical: "SWIMWEAR", store: "Splash" },
  { name: "Rhythm", domain: "rhythmlivin.com", tier: 2, vertical: "SWIMWEAR", store: "Splash" },
  { name: "Jantzen", domain: "jantzen.com.au", tier: 2, vertical: "SWIMWEAR", store: "Splash" },
  { name: "OM Designs", domain: "omdesigns.com.au", tier: 2, vertical: "SWIMWEAR", store: "Splash" },
  { name: "Jaase", domain: "jaase.com", tier: 2, vertical: "CLOTHING", store: "Splash" },
  { name: "Le Specs", domain: "lespecs.com", tier: 2, vertical: "ACCESSORIES", store: "Splash" },
  { name: "Elcee the Label", domain: "elceethelabel.com.au", tier: 2, vertical: "CLOTHING", store: "Splash" },
  // Stomp Shoes Darwin
  { name: "Walnut Melbourne", domain: "walnutmelbourne.com", tier: 1, vertical: "FOOTWEAR", store: "Stomp" },
  { name: "Django and Juliette", domain: "djangoandjuliette.com.au", tier: 1, vertical: "FOOTWEAR", store: "Stomp" },
  { name: "Colorado", domain: "colorado.com.au", tier: 1, vertical: "FOOTWEAR", store: "Stomp" },
  { name: "Mollini", domain: "mollini.com.au", tier: 1, vertical: "FOOTWEAR", store: "Stomp" },
  { name: "Siren", domain: "sirenshoes.com.au", tier: 1, vertical: "FOOTWEAR", store: "Stomp" },
  { name: "Top End", domain: "topendshoes.com.au", tier: 1, vertical: "FOOTWEAR", store: "Stomp" },
  { name: "Olga Berg", domain: "olgaberg.com.au", tier: 2, vertical: "ACCESSORIES", store: "Stomp" },
  { name: "Louenhide", domain: "louenhide.com", tier: 2, vertical: "ACCESSORIES", store: "Stomp" },
  { name: "Peta and Jain", domain: "petaandjain.com", tier: 2, vertical: "ACCESSORIES", store: "Stomp" },
  { name: "Nude Footwear", domain: "nudefootwear.com.au", tier: 2, vertical: "FOOTWEAR", store: "Stomp" },
  { name: "Alias Mae", domain: "aliasmae.com.au", tier: 2, vertical: "FOOTWEAR", store: "Stomp" },
];

const VERTICALS: Array<"ALL" | Vertical> = ["ALL", "FOOTWEAR", "SWIMWEAR", "CLOTHING", "ACCESSORIES", "LIFESTYLE"];

interface BrandRow {
  id: string;
  brand_name: string;
  brand_domain: string | null;
  collection_structure_type: string | null;
  brand_tone: string | null;
  brand_tone_sample: string | null;
  category_vocabulary: Record<string, string> | null;
  print_story_names: string[] | null;
  subcategory_list: string[] | null;
  seo_primary_keyword: string | null;
  seo_secondary_keywords: string[] | null;
  blog_topics_used: string[] | null;
  blog_sample_titles: string[] | null;
  collection_nav_urls: string[] | null;
  crawl_confidence: number | null;
  crawl_status: string;
  crawl_error: string | null;
  pages_fetched: number | null;
  last_crawled_at: string | null;
  manually_verified: boolean;
}

export default function Brands() {
  const [rows, setRows] = useState<BrandRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [crawlingId, setCrawlingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<BrandRow | null>(null);
  const [newName, setNewName] = useState("");
  const [newDomain, setNewDomain] = useState("");

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("brand_intelligence")
      .select("*")
      .order("brand_name");
    if (error) toast.error(error.message);
    setRows((data as unknown as BrandRow[]) || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function ensureSeedRow(name: string, domain: string) {
    const existing = rows.find((r) => r.brand_name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Please sign in"); return null; }
    const { data, error } = await supabase
      .from("brand_intelligence")
      .insert({ user_id: user.id, brand_name: name, brand_domain: domain })
      .select("id")
      .single();
    if (error) { toast.error(error.message); return null; }
    return data.id;
  }

  async function crawl(name: string, domain: string | null, id?: string, vertical?: Vertical) {
    setCrawlingId(id ?? name);
    try {
      const { data, error } = await supabase.functions.invoke("brand-intelligence-crawler", {
        body: { brand_id: id, brand_name: name, brand_domain: domain || undefined, industry_vertical: vertical },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      toast.success(`${name}: crawled (${data.pages_fetched} pages, ${Math.round((data.confidence || 0) * 100)}% confidence)`);
      await load();
    } catch (e) {
      toast.error(`${name}: ${e instanceof Error ? e.message : "crawl failed"}`);
    } finally {
      setCrawlingId(null);
    }
  }

  async function seedAndCrawl(b: { name: string; domain: string; vertical: Vertical }) {
    const id = await ensureSeedRow(b.name, b.domain);
    if (id) await crawl(b.name, b.domain, id, b.vertical);
  }

  async function addBrand() {
    if (!newName.trim()) return;
    const id = await ensureSeedRow(newName.trim(), newDomain.trim());
    if (id) {
      setNewName(""); setNewDomain("");
      await load();
      toast.success("Brand added — click Crawl to fetch intelligence");
    }
  }

  async function toggleVerified(row: BrandRow) {
    const { error } = await supabase
      .from("brand_intelligence")
      .update({ manually_verified: !row.manually_verified, verified_at: !row.manually_verified ? new Date().toISOString() : null })
      .eq("id", row.id);
    if (error) return toast.error(error.message);
    await load();
    if (selected?.id === row.id) setSelected({ ...row, manually_verified: !row.manually_verified });
  }

  async function removeBrand(row: BrandRow) {
    if (!confirm(`Remove ${row.brand_name}?`)) return;
    const { error } = await supabase.from("brand_intelligence").delete().eq("id", row.id);
    if (error) return toast.error(error.message);
    toast.success("Removed");
    await load();
  }

  const seeded = new Set(rows.map((r) => r.brand_name.toLowerCase()));
  const unseeded = PRIORITY_BRANDS.filter((b) => !seeded.has(b.name.toLowerCase()));

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Brand Intelligence</h1>
        <p className="text-muted-foreground mt-1">
          Sonic learns each brand's category vocabulary, collection structure, tone, and blog topics from their official website.
          This intelligence drives brand-native collections and content.
        </p>
      </div>

      {unseeded.length > 0 && (
        <Card className="p-4 mb-6">
          <h2 className="font-semibold mb-2">Pre-seed Splash brands</h2>
          <div className="flex flex-wrap gap-2">
            {unseeded.map((b) => (
              <Button
                key={b.name}
                variant="outline"
                size="sm"
                disabled={!!crawlingId}
                onClick={() => seedAndCrawl(b)}
              >
                {crawlingId === b.name ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
                {b.name} <span className="text-muted-foreground ml-1">P{b.tier}</span>
              </Button>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-4 mb-6">
        <h2 className="font-semibold mb-2">Add custom brand</h2>
        <div className="flex flex-wrap gap-2">
          <Input placeholder="Brand name" value={newName} onChange={(e) => setNewName(e.target.value)} className="max-w-xs" />
          <Input placeholder="Domain (optional, e.g. brand.com.au)" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} className="max-w-xs" />
          <Button onClick={addBrand}><Plus className="h-4 w-4 mr-1" /> Add</Button>
        </div>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          No brands yet. Pre-seed one above or add a custom brand to get started.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-3">Brand</th>
                <th className="p-3">Domain</th>
                <th className="p-3">Status</th>
                <th className="p-3">Structure</th>
                <th className="p-3">Tone</th>
                <th className="p-3">Confidence</th>
                <th className="p-3">Last crawled</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const stale = r.last_crawled_at && (Date.now() - new Date(r.last_crawled_at).getTime() > 90 * 24 * 60 * 60 * 1000);
                return (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <td className="p-3 font-medium">
                      <button className="hover:underline" onClick={() => setSelected(r)}>{r.brand_name}</button>
                      {r.manually_verified && <CheckCircle2 className="inline h-3.5 w-3.5 ml-1 text-green-600" />}
                    </td>
                    <td className="p-3 text-muted-foreground">{r.brand_domain || "—"}</td>
                    <td className="p-3">
                      {r.crawl_status === "crawling" && <Badge variant="secondary"><Loader2 className="h-3 w-3 animate-spin mr-1" /> Crawling</Badge>}
                      {r.crawl_status === "crawled" && <Badge variant="default">Crawled</Badge>}
                      {r.crawl_status === "failed" && <Badge variant="destructive" title={r.crawl_error || ""}><AlertCircle className="h-3 w-3 mr-1" /> Failed</Badge>}
                      {r.crawl_status === "not_crawled" && <Badge variant="outline">Not crawled</Badge>}
                    </td>
                    <td className="p-3">{r.collection_structure_type || "—"}</td>
                    <td className="p-3">{r.brand_tone || "—"}</td>
                    <td className="p-3">{r.crawl_confidence != null ? `${Math.round(r.crawl_confidence * 100)}%` : "—"}</td>
                    <td className="p-3 text-muted-foreground">
                      {r.last_crawled_at ? new Date(r.last_crawled_at).toLocaleDateString() : "—"}
                      {stale && <Badge variant="outline" className="ml-2">Needs re-crawl</Badge>}
                    </td>
                    <td className="p-3 text-right space-x-2 whitespace-nowrap">
                      <Button size="sm" variant="ghost" disabled={crawlingId === r.id} onClick={() => crawl(r.brand_name, r.brand_domain, r.id)}>
                        {crawlingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setSelected(r)}>View</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  {selected.brand_name}
                  {selected.manually_verified && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                </SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-4 text-sm">
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Domain</div>
                  <div>{selected.brand_domain || "—"}</div>
                </div>
                {selected.crawl_error && (
                  <div className="bg-destructive/10 text-destructive p-2 rounded text-xs">
                    {selected.crawl_error}
                  </div>
                )}
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Collection structure</div>
                  <div>{selected.collection_structure_type || "—"}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Brand tone</div>
                  <div>{selected.brand_tone || "—"}</div>
                  {selected.brand_tone_sample && (
                    <p className="text-muted-foreground italic mt-1">"{selected.brand_tone_sample}"</p>
                  )}
                </div>
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Category vocabulary</div>
                  {selected.category_vocabulary && Object.keys(selected.category_vocabulary).length > 0 ? (
                    <ul className="space-y-1 mt-1">
                      {Object.entries(selected.category_vocabulary).map(([their, generic]) => (
                        <li key={their}><span className="font-medium">{their}</span> → <span className="text-muted-foreground">{generic}</span></li>
                      ))}
                    </ul>
                  ) : <div className="text-muted-foreground">—</div>}
                </div>
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Print/story names</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(selected.print_story_names ?? []).map((p) => <Badge key={p} variant="secondary">{p}</Badge>)}
                    {!selected.print_story_names?.length && <span className="text-muted-foreground">—</span>}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted-foreground">SEO keywords</div>
                  <div className="font-medium">{selected.seo_primary_keyword || "—"}</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(selected.seo_secondary_keywords ?? []).map((k) => <Badge key={k} variant="outline">{k}</Badge>)}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Blog topics detected</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(selected.blog_topics_used ?? []).map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
                    {!selected.blog_topics_used?.length && <span className="text-muted-foreground">—</span>}
                  </div>
                </div>
                {selected.blog_sample_titles && selected.blog_sample_titles.length > 0 && (
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">Sample blog titles</div>
                    <ul className="list-disc ml-5 mt-1 space-y-1">
                      {selected.blog_sample_titles.map((t) => <li key={t}>{t}</li>)}
                    </ul>
                  </div>
                )}
                <div className="text-xs text-muted-foreground border-t pt-3">
                  Confidence: {selected.crawl_confidence != null ? `${Math.round(selected.crawl_confidence * 100)}%` : "—"} •
                  {selected.pages_fetched ?? 0} pages •
                  Last crawled: {selected.last_crawled_at ? new Date(selected.last_crawled_at).toLocaleString() : "never"}
                </div>
                <div className="flex gap-2 pt-2">
                  <Button onClick={() => crawl(selected.brand_name, selected.brand_domain, selected.id)} disabled={crawlingId === selected.id}>
                    {crawlingId === selected.id ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                    Re-crawl
                  </Button>
                  <Button variant="outline" onClick={() => toggleVerified(selected)}>
                    {selected.manually_verified ? "Unverify" : "Mark verified"}
                  </Button>
                  <Button variant="ghost" className="text-destructive ml-auto" onClick={() => { removeBrand(selected); setSelected(null); }}>
                    Remove
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
