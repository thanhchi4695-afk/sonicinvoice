import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Loader2, RefreshCw, Plus, CheckCircle2, AlertCircle, Zap } from "lucide-react";
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
  industry_vertical: string | null;
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
  iconic_reference?: any;
  whitefox_reference?: any;
  // New spec fields
  priority: number | null;
  needs_manual_review: boolean | null;
  size_range: string | null;
  key_fabric_technologies: string[] | null;
  price_range_aud: { min?: number; max?: number } | null;
  collections_created: number | null;
}

export default function Brands() {
  const [rows, setRows] = useState<BrandRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [crawlingId, setCrawlingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<BrandRow | null>(null);
  const [newName, setNewName] = useState("");
  const [newDomain, setNewDomain] = useState("");
  const [verticalFilter, setVerticalFilter] = useState<"ALL" | Vertical>("ALL");
  const [killSwitch, setKillSwitch] = useState<boolean>(true);
  const [iconicRefreshingId, setIconicRefreshingId] = useState<string | null>(null);
  const [whitefoxRefreshingId, setWhitefoxRefreshingId] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number; current: string } | null>(null);

  async function load() {
    setLoading(true);
    const [{ data, error }, { data: settings }] = await Promise.all([
      supabase.from("brand_intelligence").select("*").order("brand_name"),
      supabase.from("app_settings").select("brand_intelligence_enabled").maybeSingle(),
    ]);
    if (error) toast.error(error.message);
    setRows((data as unknown as BrandRow[]) || []);
    setKillSwitch(settings?.brand_intelligence_enabled !== false);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // Auto-seed the 13 Splash brands (and the Stomp set) per spec — runs once
  // per visit when the signed-in user is missing any of the priority brands.
  useEffect(() => {
    if (loading || rows.length === 0 && !loading) {
      // wait until first load completes (rows may legitimately be empty)
    }
    autoSeedPriorityBrands();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  async function autoSeedPriorityBrands() {
    if (loading) return;
    const seenNames = new Set(rows.map((r) => r.brand_name.toLowerCase()));
    const missing = PRIORITY_BRANDS.filter((b) => !seenNames.has(b.name.toLowerCase()));
    if (missing.length === 0) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const payload = missing.map((b) => ({
      user_id: user.id,
      brand_name: b.name,
      brand_domain: b.domain,
      industry_vertical: b.vertical,
      priority: b.tier,
      crawl_status: "not_crawled",
    }));
    const { error } = await supabase.from("brand_intelligence").insert(payload);
    if (error) {
      console.warn("auto-seed brands failed", error.message);
      return;
    }
    await load();
  }

  async function toggleKillSwitch() {
    const next = !killSwitch;
    setKillSwitch(next);
    const { error } = await supabase.from("app_settings").update({ brand_intelligence_enabled: next }).eq("singleton", true);
    if (error) { toast.error(error.message); setKillSwitch(!next); return; }
    toast.success(`Brand intelligence ${next ? "enabled" : "paused"}`);
  }


  async function ensureSeedRow(name: string, domain: string, priority?: number, vertical?: Vertical) {
    const existing = rows.find((r) => r.brand_name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Please sign in"); return null; }
    const { data, error } = await supabase
      .from("brand_intelligence")
      .insert({ user_id: user.id, brand_name: name, brand_domain: domain, priority: priority ?? null, industry_vertical: vertical ?? null, crawl_status: "not_crawled" })
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

  async function seedAndCrawl(b: { name: string; domain: string; vertical: Vertical; tier?: 1 | 2 }) {
    const id = await ensureSeedRow(b.name, b.domain, b.tier, b.vertical);
    if (id) await crawl(b.name, b.domain, id, b.vertical);
  }

  async function crawlAllPriority1(storeFilter?: "Splash" | "Stomp") {
    const allP1 = PRIORITY_BRANDS.filter((b) => b.tier === 1 && (!storeFilter || b.store === storeFilter));
    // Skip brands already completed (per spec)
    const completedNames = new Set(
      rows.filter((r) => r.crawl_status === "completed" || r.crawl_status === "crawled").map((r) => r.brand_name.toLowerCase())
    );
    const targets = allP1.filter((b) => !completedNames.has(b.name.toLowerCase()));
    if (targets.length === 0) {
      toast.info(`All ${storeFilter ?? ""} Priority 1 brands already completed.`);
      return;
    }
    const label = storeFilter ? `${storeFilter} Priority 1` : "All Priority 1";
    if (!confirm(`Crawl ${targets.length} ${label} brands sequentially (~${targets.length * 8} Firecrawl credits)? This may take several minutes.`)) return;
    await runBatch(label, targets);
  }

  async function crawlAll() {
    const targets = PRIORITY_BRANDS;
    const estCredits = targets.length * 8;
    if (!confirm(`This will use approximately ${estCredits} Firecrawl credits. Continue?`)) return;
    await runBatch("All brands", targets);
  }

  async function runBatch(label: string, targets: typeof PRIORITY_BRANDS) {
    setBatchProgress({ done: 0, total: targets.length, current: targets[0].name });
    let ok = 0, fail = 0;
    for (let i = 0; i < targets.length; i++) {
      const b = targets[i];
      setBatchProgress({ done: i, total: targets.length, current: b.name });
      try {
        const id = await ensureSeedRow(b.name, b.domain, b.tier, b.vertical);
        if (!id) { fail++; continue; }
        const { data, error } = await supabase.functions.invoke("brand-intelligence-crawler", {
          body: { brand_id: id, brand_name: b.name, brand_domain: b.domain, industry_vertical: b.vertical },
        });
        if (error || (data as { error?: string })?.error) { fail++; }
        else { ok++; }
      } catch { fail++; }
      // Gentle pacing between Firecrawl runs
      if (i < targets.length - 1) await new Promise((r) => setTimeout(r, 1500));
    }
    setBatchProgress(null);
    await load();
    toast.success(`${label}: ${ok} crawled, ${fail} failed`);
  }

  async function refreshIconic(id: string, name: string) {
    setIconicRefreshingId(id);
    try {
      const { data, error } = await supabase.functions.invoke("iconic-brand-refresh", { body: { brand_id: id } });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      const d = data as { hasChanges?: boolean; changes?: string[]; captured_at?: string };
      toast.success(`${name}: ICONIC refreshed`, {
        description: (d.changes ?? []).slice(0, 3).join(" • ") || "No changes detected",
      });
      await load();
    } catch (e) {
      toast.error(`${name}: ${e instanceof Error ? e.message : "ICONIC refresh failed"}`);
    } finally {
      setIconicRefreshingId(null);
    }
  }

  async function refreshWhitefox(id: string, name: string) {
    setWhitefoxRefreshingId(id);
    try {
      const { data, error } = await supabase.functions.invoke("whitefox-reference-refresh", { body: { brand_id: id } });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      const d = data as { hasChanges?: boolean; changes?: string[]; pages_scraped?: number };
      toast.success(`${name}: White Fox refreshed (${d.pages_scraped ?? 0} pages)`, {
        description: (d.changes ?? []).slice(0, 3).join(" • ") || "No changes detected",
      });
      await load();
    } catch (e) {
      toast.error(`${name}: ${e instanceof Error ? e.message : "White Fox refresh failed"}`);
    } finally {
      setWhitefoxRefreshingId(null);
    }
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
  const unseededAll = PRIORITY_BRANDS.filter((b) => !seeded.has(b.name.toLowerCase()));
  const matchesVertical = (v: string | null | undefined) =>
    verticalFilter === "ALL" || (v ?? "").toUpperCase() === verticalFilter;
  const unseeded = unseededAll.filter((b) => matchesVertical(b.vertical));
  const filteredRows = rows.filter((r) => matchesVertical(r.industry_vertical));
  const verticalCount = (v: "ALL" | Vertical) =>
    v === "ALL" ? rows.length : rows.filter((r) => (r.industry_vertical ?? "").toUpperCase() === v).length;

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Brand Intelligence</h1>
          <p className="text-muted-foreground mt-1">
            Sonic learns each brand's category vocabulary, collection structure, tone, and blog topics from their official website.
            This intelligence drives brand-native collections and content.
          </p>
        </div>
        <Button
          variant={killSwitch ? "outline" : "destructive"}
          size="sm"
          onClick={toggleKillSwitch}
          title="Globally pause/enable brand-aware collection generation"
        >
          {killSwitch ? "Brand intel: ON" : "Brand intel: PAUSED"}
        </Button>
      </div>

      {/* Vertical filter tabs */}
      <div className="flex flex-wrap gap-1 mb-4 border-b">
        {VERTICALS.map((v) => {
          const active = verticalFilter === v;
          const count = verticalCount(v);
          return (
            <button
              key={v}
              onClick={() => setVerticalFilter(v)}
              className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                active ? "border-primary text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {v === "ALL" ? "All" : v[0] + v.slice(1).toLowerCase()}
              <span className="ml-1.5 text-xs text-muted-foreground">{count}</span>
            </button>
          );
        })}
      </div>

      {unseeded.length > 0 && (
        <Card className="p-4 mb-6 space-y-3">
          {(["Splash", "Stomp"] as const).map((store) => {
            const items = unseeded.filter((b) => b.store === store);
            if (items.length === 0) return null;
            return (
              <div key={store}>
                <h2 className="font-semibold mb-2 text-sm">Pre-seed {store} brands</h2>
                <div className="flex flex-wrap gap-2">
                  {items.map((b) => (
                    <Button
                      key={b.name}
                      variant="outline"
                      size="sm"
                      disabled={!!crawlingId}
                      onClick={() => seedAndCrawl(b)}
                      title={`${b.vertical} · ${b.domain}`}
                    >
                      {crawlingId === b.name ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
                      {b.name}
                      <span className="text-muted-foreground ml-1 text-xs">{b.vertical[0]}{b.vertical.slice(1).toLowerCase()} · P{b.tier}</span>
                    </Button>
                  ))}
                </div>
              </div>
            );
          })}
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

      <Card className="p-4 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-semibold text-sm">Batch crawl</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Seeds (if missing) and crawls every Priority 1 brand sequentially with Firecrawl pacing.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!!batchProgress || !!crawlingId} onClick={() => crawlAllPriority1("Splash")}>
              {batchProgress ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Zap className="h-3 w-3 mr-1" />}
              Crawl Splash Priority 1
            </Button>
            <Button size="sm" variant="outline" disabled={!!batchProgress || !!crawlingId} onClick={() => crawlAllPriority1("Stomp")}>
              {batchProgress ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Zap className="h-3 w-3 mr-1" />}
              Crawl Stomp Priority 1
            </Button>
            <Button size="sm" variant="default" disabled={!!batchProgress || !!crawlingId} onClick={() => crawlAllPriority1()}>
              {batchProgress ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Zap className="h-3 w-3 mr-1" />}
              Crawl all Priority 1
            </Button>
            <Button size="sm" variant="secondary" disabled={!!batchProgress || !!crawlingId} onClick={crawlAll}>
              {batchProgress ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Zap className="h-3 w-3 mr-1" />}
              Crawl all
            </Button>
          </div>
        </div>
        {batchProgress && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Crawling {batchProgress.current}…</span>
              <span>{batchProgress.done} / {batchProgress.total}</span>
            </div>
            <div className="h-1.5 w-full rounded bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${Math.round((batchProgress.done / batchProgress.total) * 100)}%` }}
              />
            </div>
          </div>
        )}
      </Card>

      {loading ? (
        <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : filteredRows.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          {rows.length === 0
            ? "No brands yet. Pre-seed one above or add a custom brand to get started."
            : `No brands in the ${verticalFilter === "ALL" ? "selected" : verticalFilter.toLowerCase()} vertical.`}
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
              {filteredRows.map((r) => {
                const stale = r.last_crawled_at && (Date.now() - new Date(r.last_crawled_at).getTime() > 90 * 24 * 60 * 60 * 1000);
                return (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <td className="p-3 font-medium">
                      <button className="hover:underline" onClick={() => setSelected(r)}>{r.brand_name}</button>
                      {r.manually_verified && <CheckCircle2 className="inline h-3.5 w-3.5 ml-1 text-green-600" />}
                    </td>
                    <td className="p-3 text-muted-foreground">{r.brand_domain || "—"}</td>
                    <td className="p-3 space-x-1">
                      {r.crawl_status === "crawling" && <Badge variant="secondary"><Loader2 className="h-3 w-3 animate-spin mr-1" /> Crawling…</Badge>}
                      {(r.crawl_status === "completed" || r.crawl_status === "crawled") && (
                        <Badge className="bg-green-600 hover:bg-green-600 text-white">
                          Completed{r.crawl_confidence != null ? ` (${Math.round(r.crawl_confidence * 100)}%)` : ""}
                        </Badge>
                      )}
                      {r.crawl_status === "failed" && <Badge variant="destructive" title={r.crawl_error || ""}><AlertCircle className="h-3 w-3 mr-1" /> Failed</Badge>}
                      {r.crawl_status === "not_crawled" && <Badge variant="outline">Not crawled</Badge>}
                      {r.needs_manual_review && !r.manually_verified && (
                        <Badge className="bg-orange-500 hover:bg-orange-500 text-white" title="Confidence below 60% — review brand profile and re-crawl or verify manually">
                          <AlertCircle className="h-3 w-3 mr-1" /> Needs review
                        </Badge>
                      )}
                    </td>
                    <td className="p-3">{r.collection_structure_type || "—"}</td>
                    <td className="p-3">{r.brand_tone || "—"}</td>
                    <td className="p-3">{r.crawl_confidence != null ? `${Math.round(r.crawl_confidence * 100)}%` : "—"}</td>
                    <td className="p-3 text-muted-foreground">
                      {r.last_crawled_at ? new Date(r.last_crawled_at).toLocaleDateString() : "—"}
                      {stale && <Badge variant="outline" className="ml-2">Needs re-crawl</Badge>}
                    </td>
                    <td className="p-3 text-right space-x-2 whitespace-nowrap">
                      <Button size="sm" variant="ghost" disabled={crawlingId === r.id} onClick={() => crawl(r.brand_name, r.brand_domain, r.id)} title="Re-crawl brand">
                        {crawlingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      </Button>
                      {r.industry_vertical === "FOOTWEAR" && (
                        <Button size="sm" variant="ghost" disabled={iconicRefreshingId === r.id} onClick={() => refreshIconic(r.id, r.brand_name)} title="Refresh ICONIC reference">
                          {iconicRefreshingId === r.id ? <Loader2 className="h-3 w-3 animate-spin text-amber-500" /> : <Zap className="h-3 w-3 text-amber-500" />}
                        </Button>
                      )}
                      {(r.industry_vertical === "CLOTHING" || r.industry_vertical === "SWIMWEAR") && (
                        <Button size="sm" variant="ghost" disabled={whitefoxRefreshingId === r.id} onClick={() => refreshWhitefox(r.id, r.brand_name)} title="Refresh White Fox reference">
                          {whitefoxRefreshingId === r.id ? <Loader2 className="h-3 w-3 animate-spin text-teal-500" /> : <Zap className="h-3 w-3 text-teal-500" />}
                        </Button>
                      )}
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
                {/* New extracted fields */}
                {(selected.size_range || (selected.key_fabric_technologies?.length ?? 0) > 0 || selected.price_range_aud) && (
                  <div className="border-t pt-3 grid grid-cols-2 gap-3">
                    {selected.size_range && (
                      <div>
                        <div className="text-xs uppercase text-muted-foreground">Size range</div>
                        <div>{selected.size_range}</div>
                      </div>
                    )}
                    {selected.price_range_aud && (selected.price_range_aud.min != null || selected.price_range_aud.max != null) && (
                      <div>
                        <div className="text-xs uppercase text-muted-foreground">Price range (AUD)</div>
                        <div>${selected.price_range_aud.min ?? "?"} – ${selected.price_range_aud.max ?? "?"}</div>
                      </div>
                    )}
                    {(selected.key_fabric_technologies?.length ?? 0) > 0 && (
                      <div className="col-span-2">
                        <div className="text-xs uppercase text-muted-foreground">Key fabrics / technologies</div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {selected.key_fabric_technologies!.map((f) => <Badge key={f} variant="outline">{f}</Badge>)}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Confidence breakdown widget */}
                <div className="border-t pt-3">
                  <div className="text-xs uppercase text-muted-foreground mb-2">Confidence breakdown</div>
                  {(() => {
                    const vocab = Object.keys(selected.category_vocabulary ?? {}).length;
                    const blogs = (selected.blog_topics_used?.length ?? 0);
                    const prints = (selected.print_story_names?.length ?? 0);
                    const items = [
                      { label: "Category vocabulary > 3", ok: vocab > 3, weight: 0.3, detail: `${vocab} terms` },
                      { label: "Collection structure", ok: !!selected.collection_structure_type, weight: 0.2, detail: selected.collection_structure_type ?? "—" },
                      { label: "Blog topics > 2", ok: blogs > 2, weight: 0.2, detail: `${blogs} topics` },
                      { label: "Brand tone detected", ok: !!selected.brand_tone, weight: 0.2, detail: selected.brand_tone ?? "—" },
                      { label: "Print/story names > 1", ok: prints > 1, weight: 0.1, detail: `${prints} names` },
                    ];
                    return (
                      <ul className="space-y-1 text-xs">
                        {items.map((it) => (
                          <li key={it.label} className="flex items-center justify-between">
                            <span className="flex items-center gap-1.5">
                              {it.ok
                                ? <CheckCircle2 className="h-3 w-3 text-green-600" />
                                : <AlertCircle className="h-3 w-3 text-muted-foreground" />}
                              {it.label}
                              <span className="text-muted-foreground">(+{it.weight.toFixed(2)})</span>
                            </span>
                            <span className="text-muted-foreground">{it.detail}</span>
                          </li>
                        ))}
                      </ul>
                    );
                  })()}
                </div>

                <div className="text-xs text-muted-foreground border-t pt-3">
                  Confidence: {selected.crawl_confidence != null ? `${Math.round(selected.crawl_confidence * 100)}%` : "—"} •
                  Priority: {selected.priority != null ? `P${selected.priority}` : "—"} •
                  Collections created: {selected.collections_created ?? 0} •
                  {selected.pages_fetched ?? 0} pages •
                  Last crawled: {selected.last_crawled_at ? new Date(selected.last_crawled_at).toLocaleString() : "never"}
                </div>
                <div className="flex gap-2 pt-2">
                  <Button onClick={() => crawl(selected.brand_name, selected.brand_domain, selected.id)} disabled={crawlingId === selected.id}>
                    {crawlingId === selected.id ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                    Re-crawl
                  </Button>
                  {selected.industry_vertical === "FOOTWEAR" && (
                    <Button variant="secondary" onClick={() => refreshIconic(selected.id, selected.brand_name)} disabled={iconicRefreshingId === selected.id}>
                      {iconicRefreshingId === selected.id ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Zap className="h-4 w-4 mr-1" />}
                      Refresh ICONIC
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => toggleVerified(selected)}>
                    {selected.manually_verified ? "Unverify" : "Mark verified"}
                  </Button>
                  <Button variant="ghost" className="text-destructive ml-auto" onClick={() => { removeBrand(selected); setSelected(null); }}>
                    Remove
                  </Button>
                </div>
                {selected.iconic_reference && (
                  <div className="border-t pt-3 mt-2">
                    <div className="text-xs uppercase text-muted-foreground mb-2 flex items-center gap-1">
                      <Zap className="h-3 w-3 text-amber-500" /> ICONIC Reference
                      <span className="text-muted-foreground normal-case">{selected.iconic_reference.captured_at ? ` · ${new Date(selected.iconic_reference.captured_at).toLocaleDateString()}` : ""}</span>
                    </div>
                    {selected.iconic_reference.h1 && (
                      <div className="mb-2"><span className="text-xs text-muted-foreground">H1:</span> <span className="font-medium">{selected.iconic_reference.h1}</span></div>
                    )}
                    {selected.iconic_reference.opening_copy && (
                      <div className="mb-2 text-muted-foreground italic">{selected.iconic_reference.opening_copy}</div>
                    )}
                    {selected.iconic_reference.sub_collection_links?.length > 0 && (
                      <div className="mb-2">
                        <div className="text-xs text-muted-foreground mb-1">Sub-collections ({selected.iconic_reference.sub_collection_links.length})</div>
                        <div className="flex flex-wrap gap-1">
                          {selected.iconic_reference.sub_collection_links.slice(0, 8).map((u: string, i: number) => (
                            <Badge key={i} variant="outline" className="text-xs">{u.split("/").pop() || u}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {selected.iconic_reference.faq_pairs?.length > 0 && (
                      <div className="mb-2">
                        <div className="text-xs text-muted-foreground mb-1">FAQ ({selected.iconic_reference.faq_pairs.length})</div>
                        <div className="space-y-1">
                          {selected.iconic_reference.faq_pairs.slice(0, 3).map((p: any, i: number) => (
                            <div key={i} className="text-xs bg-muted/30 p-1.5 rounded">
                              <div className="font-medium">{p.q}</div>
                              <div className="text-muted-foreground">{p.a}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {selected.iconic_reference.top_phrases?.length > 0 && (
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Top phrases</div>
                        <div className="flex flex-wrap gap-1">
                          {selected.iconic_reference.top_phrases.slice(0, 6).map((p: any, i: number) => (
                            <Badge key={i} variant="secondary" className="text-xs">{p.phrase}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
