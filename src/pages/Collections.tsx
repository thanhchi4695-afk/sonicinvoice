import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Sparkles, Trash2, CheckCircle2, RefreshCw } from "lucide-react";
import RequireAuth from "@/components/RequireAuth";

type Suggestion = {
  id: string;
  collection_type: string;
  suggested_title: string;
  suggested_handle: string;
  product_count: number;
  confidence_score: number;
  sample_titles: string[];
  sample_images: string[];
  rule_set: unknown;
  seo_title: string | null;
  seo_description: string | null;
  description_html: string | null;
  status: string;
  shopify_collection_id: string | null;
  error_message: string | null;
  created_at: string;
};

type Blog = {
  id: string;
  suggestion_id: string;
  blog_type: string;
  title: string;
  content_html: string;
  status: string;
  created_at: string;
};

const TYPE_FILTERS = [
  { id: "all", label: "All" },
  { id: "brand", label: "Brand" },
  { id: "brand_category", label: "Brand + Category" },
  { id: "type", label: "Type" },
  { id: "niche", label: "Niche" },
  { id: "print", label: "Print" },
  { id: "archive", label: "Archive" },
  { id: "colour", label: "Colour" },
  { id: "occasion", label: "Occasion" },
  { id: "trend", label: "Trend" },
  { id: "sale", label: "Sale" },
  { id: "back_in_stock", label: "Back in Stock" },
];

const VOICE_OPTIONS = [
  { id: "aspirational_youth", label: "Aspirational youth (White Fox)" },
  { id: "local_warmth", label: "Local warmth (boutique)" },
  { id: "professional_editorial", label: "Professional editorial (ICONIC)" },
  { id: "luxury_refined", label: "Luxury refined" },
];

function typeBadgeColor(t: string) {
  const map: Record<string, string> = {
    brand: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    brand_category: "bg-orange-500/15 text-orange-300 border-orange-500/30",
    type: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    niche: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    print: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
    archive: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    colour: "bg-violet-500/15 text-violet-300 border-violet-500/30",
    occasion: "bg-teal-500/15 text-teal-300 border-teal-500/30",
    trend: "bg-pink-500/15 text-pink-300 border-pink-500/30",
    sale: "bg-red-500/15 text-red-300 border-red-500/30",
    back_in_stock: "bg-lime-500/15 text-lime-300 border-lime-500/30",
  };
  return map[t] ?? "bg-muted text-muted-foreground";
}

function CollectionsInner() {
  const [tab, setTab] = useState("suggestions");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [blogs, setBlogs] = useState<Blog[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<Suggestion>>>({});
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [voice, setVoice] = useState<string>("local_warmth");
  const [savingVoice, setSavingVoice] = useState(false);

  async function load() {
    setLoading(true);
    const [{ data: s }, { data: b }, { data: scan }, { data: conn }] = await Promise.all([
      supabase.from("collection_suggestions").select("*").order("confidence_score", { ascending: false }),
      supabase.from("collection_blogs").select("*").order("created_at", { ascending: false }),
      supabase.from("collection_scans").select("*").order("started_at", { ascending: false }).limit(1),
      supabase.from("shopify_connections").select("brand_voice_style").maybeSingle(),
    ]);
    setSuggestions((s as Suggestion[]) ?? []);
    setBlogs((b as Blog[]) ?? []);
    setLastScan(scan?.[0]?.started_at ?? null);
    if (conn?.brand_voice_style) setVoice(conn.brand_voice_style as string);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function saveVoice(next: string) {
    setVoice(next);
    setSavingVoice(true);
    const { error } = await supabase.from("shopify_connections").update({ brand_voice_style: next as never }).neq("id", "00000000-0000-0000-0000-000000000000");
    setSavingVoice(false);
    if (error) toast.error(error.message);
    else toast.success("Brand voice updated");
  }

  const filtered = useMemo(() => {
    if (filter === "all") return suggestions.filter((s) => s.status !== "rejected");
    return suggestions.filter((s) => s.collection_type === filter && s.status !== "rejected");
  }, [suggestions, filter]);

  async function runScan() {
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke("collection-intelligence", { body: { triggered_by: "manual" } });
      if (error) throw error;
      toast.success(`Scan complete — ${data.suggestions_created} suggestions from ${data.products_scanned} products`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  async function generate(id: string) {
    setGenerating(id);
    try {
      const { data, error } = await supabase.functions.invoke("collection-content-generator", { body: { suggestion_id: id } });
      if (error) throw error;
      const r = data?.results?.[0];
      if (r?.ok) toast.success("Content generated");
      else toast.error(r?.error ?? "Generation failed");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(null);
    }
  }

  async function approve(id: string) {
    setPublishing(id);
    try {
      const s = suggestions.find((x) => x.id === id);
      if (s && (!s.description_html || s.status === "pending")) {
        await generate(id);
      }
      // Save any edits before publish
      const e = edits[id];
      if (e) {
        const patch: Record<string, unknown> = { ...e };
        delete patch.rule_set;
        await supabase.from("collection_suggestions").update(patch as never).eq("id", id);
      }
      const { data, error } = await supabase.functions.invoke("collection-publish", { body: { suggestion_id: id } });
      if (error) throw error;
      toast.success("Published to Shopify as draft");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setPublishing(null);
    }
  }

  async function reject(id: string) {
    await supabase.from("collection_suggestions").update({ status: "rejected" }).eq("id", id);
    toast.success("Suggestion rejected");
    await load();
  }

  function setEdit(id: string, key: keyof Suggestion, value: string) {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [key]: value } }));
  }

  const pendingBlogs = blogs.filter((b) => b.status === "pending");

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AI Collection Engine</h1>
          <p className="text-sm text-muted-foreground">
            {lastScan ? `Last scan: ${new Date(lastScan).toLocaleString()}` : "No scans yet"}
          </p>
        </div>
        <Button onClick={runScan} disabled={scanning}>
          {scanning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Scan store
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="suggestions">Suggestions ({filtered.length})</TabsTrigger>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="blogs">Blog drafts ({pendingBlogs.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="suggestions" className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {TYPE_FILTERS.map((f) => (
              <Button key={f.id} size="sm" variant={filter === f.id ? "default" : "outline"} onClick={() => setFilter(f.id)}>
                {f.label}
              </Button>
            ))}
          </div>

          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-muted-foreground">No suggestions. Click "Scan store" to detect collection opportunities.</CardContent></Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((s) => {
                const isExpanded = expanded === s.id;
                const e = edits[s.id] ?? {};
                return (
                  <Card key={s.id} className="overflow-hidden">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base leading-tight">{s.suggested_title}</CardTitle>
                        <Badge className={`${typeBadgeColor(s.collection_type)} border`}>{s.collection_type.replace("_", "+")}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">{s.product_count} products • {Math.round(s.confidence_score * 100)}% confidence</div>
                      <Progress value={s.confidence_score * 100} className="h-1" />
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {s.sample_images.length > 0 && (
                        <div className="flex gap-1 overflow-hidden">
                          {s.sample_images.slice(0, 3).map((src, i) => (
                            <img key={i} src={src} alt="" className="h-16 w-16 object-cover rounded border" loading="lazy" />
                          ))}
                        </div>
                      )}
                      {s.status === "error" && s.error_message && (
                        <div className="text-xs text-destructive">{s.error_message}</div>
                      )}
                      {isExpanded && (
                        <div className="space-y-2 pt-2 border-t">
                          {s.status === "content_ready" || s.description_html ? (
                            <>
                              <div>
                                <label className="text-xs font-medium">SEO Title</label>
                                <Input
                                  defaultValue={s.seo_title ?? ""}
                                  onChange={(ev) => setEdit(s.id, "seo_title", ev.target.value)}
                                  maxLength={70}
                                />
                              </div>
                              <div>
                                <label className="text-xs font-medium">Meta Description</label>
                                <Textarea
                                  defaultValue={s.seo_description ?? ""}
                                  onChange={(ev) => setEdit(s.id, "seo_description", ev.target.value)}
                                  rows={2}
                                  maxLength={170}
                                />
                              </div>
                              <div>
                                <label className="text-xs font-medium">Description HTML</label>
                                <Textarea
                                  defaultValue={s.description_html ?? ""}
                                  onChange={(ev) => setEdit(s.id, "description_html", ev.target.value)}
                                  rows={6}
                                />
                              </div>
                            </>
                          ) : (
                            <Button size="sm" variant="secondary" onClick={() => generate(s.id)} disabled={generating === s.id} className="w-full">
                              {generating === s.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                              Generate SEO content
                            </Button>
                          )}
                          <div className="text-xs">
                            <div className="font-medium mb-1">Smart rule</div>
                            <pre className="bg-muted p-2 rounded text-[10px] overflow-x-auto">{JSON.stringify(s.rule_set, null, 2)}</pre>
                          </div>
                        </div>
                      )}
                      <div className="flex items-center gap-2 pt-2">
                        <Button size="sm" onClick={() => approve(s.id)} disabled={publishing === s.id || s.status === "published"}>
                          {publishing === s.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                          {s.status === "published" ? "Published" : "Approve"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setExpanded(isExpanded ? null : s.id)}>
                          {isExpanded ? "Collapse" : "Edit"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => reject(s.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="active">
          <Card><CardContent className="py-8 text-sm text-muted-foreground">
            Already-published collections appear here after the next scan. Use the Suggestions tab to push new ones.
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="blogs" className="space-y-3">
          {pendingBlogs.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-muted-foreground">No blog drafts yet. Approving a suggestion will queue 3 drafts.</CardContent></Card>
          ) : pendingBlogs.map((b) => (
            <Card key={b.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{b.title}</CardTitle>
                  <Badge variant="outline">{b.blog_type}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: b.content_html }} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={async () => {
                    await supabase.from("collection_blogs").update({ status: "approved" }).eq("id", b.id);
                    toast.success("Blog approved");
                    load();
                  }}>Approve</Button>
                  <Button size="sm" variant="ghost" onClick={async () => {
                    await supabase.from("collection_blogs").update({ status: "rejected" }).eq("id", b.id);
                    load();
                  }}>Reject</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function CollectionsPage() {
  return (
    <RequireAuth>
      <CollectionsInner />
    </RequireAuth>
  );
}
