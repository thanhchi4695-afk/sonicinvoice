import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { addAuditEntry } from "@/lib/audit-log";
import { ChevronLeft, ChevronRight, Copy, RefreshCw, CheckCircle2, Circle, ArrowRight, Search } from "lucide-react";

interface ClusterPost {
  title: string;
  keyword: string;
  slug: string;
  intent: string;
  volume: string;
  collectionLinks: string[];
  pillarAnchorText: string;
  postType: string;
}

interface TopicMap {
  pillar: { title: string; keyword: string; slug: string; description: string };
  clusters: ClusterPost[];
  crossLinks: { from: string; to: string; anchorText: string }[];
  topicalGaps: string[];
}

interface BlogPost {
  slug: string;
  title: string;
  keyword: string;
  metaTitle: string;
  metaDescription: string;
  html: string;
  wordCount: number;
  readTime: string;
  status: "not_written" | "writing" | "done" | "published";
  generatedAt?: string;
  publishedAt?: string;
}

interface GapResult {
  gaps: { topic: string; keyword: string; priority: string; reason: string }[];
  duplicates: { post1: string; post2: string; recommendation: string }[];
  topThreeNext: string[];
}

const SPLASH_TOPIC_MAP: TopicMap = {
  pillar: { title: "Womens Swimwear Australia — The Complete Guide", keyword: "womens swimwear Australia", slug: "womens-swimwear-australia-guide", description: "The ultimate guide to women's swimwear in Australia" },
  clusters: [
    { title: "How to Choose the Right Bikini Top for Your Body", keyword: "how to choose bikini top", slug: "how-to-choose-bikini-top", intent: "informational", volume: "high", collectionLinks: ["Bikini Tops"], pillarAnchorText: "womens swimwear Australia", postType: "buying_guide" },
    { title: "What is Chlorine Resistant Swimwear?", keyword: "chlorine resistant swimwear", slug: "what-is-chlorine-resistant-swimwear", intent: "informational", volume: "medium", collectionLinks: ["Chlorine Resistant"], pillarAnchorText: "Australian swimwear", postType: "feature_guide" },
    { title: "Best One Piece Swimsuits for Sun Protection", keyword: "one piece swimsuit sun protection", slug: "best-one-piece-sun-protection", intent: "commercial", volume: "medium", collectionLinks: ["One Pieces", "Sun Protection"], pillarAnchorText: "womens swimwear", postType: "comparison" },
    { title: "D-G Cup Swimwear: A Complete Buying Guide", keyword: "D cup swimwear Australia", slug: "d-g-cup-swimwear-guide", intent: "commercial", volume: "high", collectionLinks: ["D-G Cup"], pillarAnchorText: "swimwear Australia", postType: "buying_guide" },
    { title: "How to Care for Your Swimwear to Make it Last", keyword: "how to care for swimwear", slug: "how-to-care-for-swimwear", intent: "informational", volume: "medium", collectionLinks: ["Suit Saver"], pillarAnchorText: "swimwear", postType: "care_guide" },
    { title: "Best Swimwear Brands Australia 2026", keyword: "best swimwear brands Australia", slug: "best-swimwear-brands-australia", intent: "commercial", volume: "high", collectionLinks: ["Shop By Brands"], pillarAnchorText: "womens swimwear Australia", postType: "brand" },
    { title: "Where to Buy Swimwear in Darwin", keyword: "swimwear Darwin", slug: "where-to-buy-swimwear-darwin", intent: "navigational", volume: "medium", collectionLinks: [], pillarAnchorText: "womens swimwear Australia", postType: "location" },
    { title: "Tummy Control Swimwear: What Works and What Doesn't", keyword: "tummy control swimwear Australia", slug: "tummy-control-swimwear-guide", intent: "commercial", volume: "high", collectionLinks: ["Tummy Control"], pillarAnchorText: "Australian swimwear", postType: "problem_solving" },
    { title: "Period Swimwear: Everything You Need to Know", keyword: "period swimwear Australia", slug: "period-swimwear-guide", intent: "informational", volume: "medium", collectionLinks: ["Period Swimwear"], pillarAnchorText: "womens swimwear", postType: "feature_guide" },
    { title: "Seafolly vs Bond Eye: Which Brand is Right for You?", keyword: "Seafolly vs Bond Eye", slug: "seafolly-vs-bond-eye", intent: "commercial", volume: "low", collectionLinks: ["Seafolly", "Bond Eye"], pillarAnchorText: "swimwear brands Australia", postType: "comparison" },
    { title: "What to Pack for a Beach Holiday in Darwin NT", keyword: "beach holiday Darwin", slug: "beach-holiday-darwin-packing", intent: "informational", volume: "low", collectionLinks: ["Accessories", "Rashies & Sunsuits"], pillarAnchorText: "swimwear Australia", postType: "seasonal" },
    { title: "New Swimwear Arrivals — What's In Store This Season", keyword: "new swimwear Australia 2026", slug: "new-swimwear-arrivals-season", intent: "commercial", volume: "medium", collectionLinks: ["New Arrivals"], pillarAnchorText: "womens swimwear Australia", postType: "seasonal" },
  ],
  crossLinks: [
    { from: "how-to-choose-bikini-top", to: "d-g-cup-swimwear-guide", anchorText: "D-G cup swimwear guide" },
    { from: "what-is-chlorine-resistant-swimwear", to: "how-to-care-for-swimwear", anchorText: "caring for your swimwear" },
    { from: "tummy-control-swimwear-guide", to: "best-one-piece-sun-protection", anchorText: "one piece swimsuits with sun protection" },
  ],
  topicalGaps: [
    "Mastectomy swimwear guide",
    "Plus size swimwear Australia",
    "Modest swimwear options",
    "Swimwear for lap swimming vs beach",
    "How to measure for swimwear online",
  ],
};

const POST_TYPE_ICONS: Record<string, string> = {
  buying_guide: "🛒", feature_guide: "✨", care_guide: "🧴", comparison: "⚖️",
  location: "📍", brand: "🏷", seasonal: "🌸", problem_solving: "🔧", guide: "📖",
};

const VOLUME_COLORS: Record<string, string> = {
  high: "bg-destructive/15 text-destructive",
  medium: "bg-warning/15 text-warning",
  low: "bg-muted text-muted-foreground",
};

const INTENT_COLORS: Record<string, string> = {
  informational: "bg-primary/15 text-primary",
  commercial: "bg-accent/15 text-accent-foreground",
  navigational: "bg-secondary text-secondary-foreground",
};

export default function OrganicSEOFlow({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState(1);
  const [niche, setNiche] = useState("");
  const [storeName, setStoreName] = useState("");
  const [storeUrl, setStoreUrl] = useState("");
  const [storeCity, setStoreCity] = useState("");
  const [existingCollections, setExistingCollections] = useState("");
  const [topicMap, setTopicMap] = useState<TopicMap | null>(null);
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [selectedPostSlug, setSelectedPostSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [writingSlug, setWritingSlug] = useState<string | null>(null);
  const [gapInput, setGapInput] = useState("");
  const [gapResult, setGapResult] = useState<GapResult | null>(null);
  const [gapMode, setGapMode] = useState<"map" | "sitemap">("map");

  useEffect(() => {
    setStoreName(localStorage.getItem("store_name") || "");
    setStoreUrl(localStorage.getItem("store_website") || "");
    setStoreCity(localStorage.getItem("store_city") || "");
    const saved = localStorage.getItem("seo_topic_map");
    if (saved) { try { setTopicMap(JSON.parse(saved)); } catch {} }
    const savedPosts = localStorage.getItem("seo_posts");
    if (savedPosts) { try { setPosts(JSON.parse(savedPosts)); } catch {} }
  }, []);

  const isSplash = storeName.toLowerCase().includes("splash") || niche.toLowerCase().includes("swimwear");

  const generateTopicMap = async () => {
    if (isSplash) {
      setTopicMap(SPLASH_TOPIC_MAP);
      localStorage.setItem("seo_topic_map", JSON.stringify(SPLASH_TOPIC_MAP));
      toast.success("Pre-built swimwear topic map loaded");
      addAuditEntry("SEO", `Topic map loaded — ${SPLASH_TOPIC_MAP.clusters.length + 1} posts`);
      return;
    }
    if (!niche.trim()) { toast.error("Enter your store niche"); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("organic-seo", {
        body: {
          action: "generate_topic_map", niche, storeName, storeUrl, storeCity,
          existingCollections: existingCollections.split("\n").filter(Boolean),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setTopicMap(data);
      localStorage.setItem("seo_topic_map", JSON.stringify(data));
      toast.success(`Topic map generated — ${(data.clusters?.length || 0) + 1} posts`);
      addAuditEntry("SEO", `Topic map — ${niche} — ${(data.clusters?.length || 0) + 1} posts`);
    } catch (e: any) {
      toast.error(e.message || "Failed to generate topic map");
    } finally { setLoading(false); }
  };

  const writePost = async (postData: ClusterPost | TopicMap["pillar"], isPillar = false) => {
    if (!topicMap) return;
    const slug = postData.slug;
    setWritingSlug(slug);
    setPosts(prev => {
      const existing = prev.find(p => p.slug === slug);
      if (existing) return prev.map(p => p.slug === slug ? { ...p, status: "writing" as const } : p);
      return [...prev, { slug, title: postData.title, keyword: postData.keyword, metaTitle: "", metaDescription: "", html: "", wordCount: 0, readTime: "", status: "writing" as const }];
    });

    try {
      const clusterCrossLinks = topicMap.crossLinks
        .filter(l => l.from === slug)
        .map(l => {
          const target = topicMap.clusters.find(c => c.slug === l.to) || topicMap.pillar;
          return { ...l, title: target.title, slug: l.to };
        });

      const { data, error } = await supabase.functions.invoke("organic-seo", {
        body: {
          action: "write_blog_post",
          storeName, storeUrl, storeCity,
          cluster: isPillar ? null : postData,
          pillar: topicMap.pillar,
          crossLinks: clusterCrossLinks,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const newPost: BlogPost = {
        slug: data.slug || slug,
        title: postData.title,
        keyword: postData.keyword,
        metaTitle: data.metaTitle || "",
        metaDescription: data.metaDescription || "",
        html: data.html || "",
        wordCount: data.wordCount || 0,
        readTime: data.readTime || "",
        status: "done",
        generatedAt: new Date().toISOString(),
      };
      setPosts(prev => {
        const updated = prev.map(p => p.slug === slug ? newPost : p);
        localStorage.setItem("seo_posts", JSON.stringify(updated));
        return updated;
      });
      setSelectedPostSlug(slug);
      toast.success(`"${postData.title}" written — ${data.wordCount || '?'} words`);
    } catch (e: any) {
      toast.error(e.message || "Failed to write post");
      setPosts(prev => prev.map(p => p.slug === slug ? { ...p, status: "not_written" as const } : p));
    } finally { setWritingSlug(null); }
  };

  const runGapAnalysis = async () => {
    setLoading(true);
    try {
      const titles = gapMode === "map"
        ? [topicMap?.pillar.title, ...(topicMap?.clusters.map(c => c.title) || [])].filter(Boolean) as string[]
        : gapInput.split("\n").filter(Boolean);

      const { data, error } = await supabase.functions.invoke("organic-seo", {
        body: { action: "gap_analysis", niche: niche || topicMap?.pillar.keyword || "", storeCity, existingPosts: titles },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setGapResult(data);
      toast.success(`Found ${data.gaps?.length || 0} topic gaps`);
    } catch (e: any) {
      toast.error(e.message || "Gap analysis failed");
    } finally { setLoading(false); }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  const selectedPost = posts.find(p => p.slug === selectedPostSlug);
  const allPosts = topicMap ? [
    { ...topicMap.pillar, intent: "informational", volume: "high", collectionLinks: [], pillarAnchorText: "", postType: "guide", isPillar: true },
    ...topicMap.clusters.map(c => ({ ...c, isPillar: false })),
  ] : [];

  const linkChecklist = topicMap ? [
    ...topicMap.clusters.map(c => ({ from: c.title, to: topicMap.pillar.title, type: "cluster→pillar" })),
    ...topicMap.clusters.map(c => ({ from: topicMap.pillar.title, to: c.title, type: "pillar→cluster" })),
    ...topicMap.crossLinks.map(l => {
      const fromPost = topicMap.clusters.find(c => c.slug === l.from) || topicMap.pillar;
      const toPost = topicMap.clusters.find(c => c.slug === l.to) || topicMap.pillar;
      return { from: fromPost.title, to: toPost.title, type: "cross-link" };
    }),
  ] : [];

  const completedLinks = linkChecklist.filter(l => {
    const fromPost = posts.find(p => p.title === l.from);
    const toPost = posts.find(p => p.title === l.to);
    return fromPost?.status === "done" || fromPost?.status === "published";
  });

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 pb-32">
      <button onClick={onBack} className="flex items-center gap-1 text-muted-foreground mb-4 text-sm">
        <ChevronLeft className="w-4 h-4" /> Back
      </button>
      <h1 className="text-2xl font-bold mb-1">📈 Organic SEO</h1>
      <p className="text-muted-foreground text-sm mb-6">Build topical authority and drive free Google traffic to your store.</p>

      {/* Progress bar */}
      <div className="flex items-center gap-1 mb-8">
        {["Topic Map", "Blog Posts", "Internal Links", "Gap Check"].map((label, i) => (
          <button key={i} onClick={() => (topicMap || i === 0) && setStep(i + 1)}
            className={`flex-1 text-center py-2 rounded text-xs font-medium transition-colors ${step === i + 1 ? "bg-primary text-primary-foreground" : step > i + 1 ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── STEP 1: Topic Map ── */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <Label>Store niche / core topic</Label>
            <Input placeholder="e.g. womens swimwear Darwin Australia" value={niche} onChange={e => setNiche(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Store name</Label><Input value={storeName} onChange={e => setStoreName(e.target.value)} /></div>
            <div><Label>Store URL</Label><Input value={storeUrl} onChange={e => setStoreUrl(e.target.value)} /></div>
          </div>
          <div><Label>Target city/region</Label><Input value={storeCity} onChange={e => setStoreCity(e.target.value)} /></div>
          <div>
            <Label>Existing collections (optional, one per line)</Label>
            <Textarea placeholder={"e.g.\nBikini Tops\nOne Pieces\nNew Arrivals"} value={existingCollections} onChange={e => setExistingCollections(e.target.value)} rows={4} />
          </div>
          <Button className="w-full h-12" onClick={generateTopicMap} disabled={loading}>
            {loading ? "Generating..." : "✦ Generate topic map"}
          </Button>

          {topicMap && (
            <div className="mt-6 space-y-4">
              {/* Pillar card */}
              <Card className="border-primary/40 bg-primary/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <span className="text-lg">🏛</span> PILLAR: {topicMap.pillar.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">🔑 {topicMap.pillar.keyword}</p>
                  {topicMap.pillar.description && <p className="text-xs text-muted-foreground mt-1">{topicMap.pillar.description}</p>}
                </CardContent>
              </Card>

              {/* Cluster grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {topicMap.clusters.map((c, i) => (
                  <Card key={i} className="border-border">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-2 mb-2">
                        <span>{POST_TYPE_ICONS[c.postType] || "📄"}</span>
                        <h3 className="text-sm font-medium leading-tight">{c.title}</h3>
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">🔑 {c.keyword}</p>
                      <div className="flex gap-1 flex-wrap">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${INTENT_COLORS[c.intent] || ""}`}>{c.intent}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${VOLUME_COLORS[c.volume] || ""}`}>{c.volume}</span>
                      </div>
                      {c.collectionLinks.length > 0 && (
                        <p className="text-[10px] text-muted-foreground mt-2">🔗 {c.collectionLinks.join(", ")}</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Cross-links table */}
              {topicMap.crossLinks.length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Internal Links Plan</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-1">
                      {topicMap.crossLinks.map((l, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{l.from}</span>
                          <ArrowRight className="w-3 h-3" />
                          <span className="font-medium text-foreground">{l.to}</span>
                          <span className="text-primary">"{l.anchorText}"</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              <Button className="w-full" onClick={() => setStep(2)}>
                Next: Write blog posts <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── STEP 2: Blog Post Generator ── */}
      {step === 2 && topicMap && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Left panel — post list */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold mb-2">Posts ({allPosts.length})</h3>
            {allPosts.map((p, i) => {
              const post = posts.find(pp => pp.slug === p.slug);
              const status = post?.status || "not_written";
              return (
                <button key={i} onClick={() => { if (status === "done" || status === "published") setSelectedPostSlug(p.slug); }}
                  className={`w-full text-left p-2 rounded border text-xs transition-colors ${selectedPostSlug === p.slug ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}>
                  <div className="flex items-center gap-2">
                    {status === "done" || status === "published" ? <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" /> :
                      status === "writing" ? <RefreshCw className="w-3.5 h-3.5 text-warning animate-spin shrink-0" /> :
                        <Circle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                    <span className="truncate font-medium">{p.title}</span>
                  </div>
                  {(p as any).isPillar && <span className="text-[10px] text-primary ml-5">PILLAR</span>}
                </button>
              );
            })}
            <div className="flex gap-2 mt-3">
              <Button size="sm" className="flex-1 text-xs" disabled={!!writingSlug}
                onClick={() => {
                  if (selectedPostSlug) {
                    const p = allPosts.find(pp => pp.slug === selectedPostSlug);
                    if (p) writePost(p, (p as any).isPillar);
                  }
                }}>
                {writingSlug ? "Writing..." : "Write selected"}
              </Button>
            </div>
            <Button size="sm" variant="outline" className="w-full text-xs" disabled={!!writingSlug}
              onClick={async () => {
                for (const p of allPosts) {
                  const existing = posts.find(pp => pp.slug === p.slug);
                  if (!existing || existing.status === "not_written") {
                    await writePost(p, (p as any).isPillar);
                  }
                }
              }}>
              Write all posts
            </Button>
          </div>

          {/* Right panel — post preview */}
          <div className="md:col-span-2">
            {selectedPost && selectedPost.html ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{selectedPost.title}</CardTitle>
                  <p className="text-xs text-muted-foreground">{selectedPost.wordCount} words · {selectedPost.readTime}</p>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="preview">
                    <TabsList className="mb-3">
                      <TabsTrigger value="preview">Preview</TabsTrigger>
                      <TabsTrigger value="html">HTML</TabsTrigger>
                      <TabsTrigger value="meta">Meta</TabsTrigger>
                    </TabsList>
                    <TabsContent value="preview">
                      <div className="prose prose-sm max-w-none border rounded p-4 max-h-[500px] overflow-y-auto"
                        dangerouslySetInnerHTML={{ __html: selectedPost.html }} />
                    </TabsContent>
                    <TabsContent value="html">
                      <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-[500px] whitespace-pre-wrap">{selectedPost.html}</pre>
                    </TabsContent>
                    <TabsContent value="meta">
                      <div className="space-y-3">
                        <div>
                          <Label>SEO Title ({selectedPost.metaTitle.length}/60)</Label>
                          <Input value={selectedPost.metaTitle} readOnly />
                        </div>
                        <div>
                          <Label>Meta Description ({selectedPost.metaDescription.length}/160)</Label>
                          <Textarea value={selectedPost.metaDescription} readOnly rows={2} />
                        </div>
                        <div>
                          <Label>Slug</Label>
                          <Input value={selectedPost.slug} readOnly />
                          <p className="text-[10px] text-muted-foreground mt-1">{storeUrl}/blogs/news/{selectedPost.slug}</p>
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                  <div className="flex gap-2 mt-4 flex-wrap">
                    <Button size="sm" variant="outline" onClick={() => copyToClipboard(selectedPost.html, "HTML")}>
                      <Copy className="w-3 h-3 mr-1" /> Copy HTML
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => {
                      const all = allPosts.find(p => p.slug === selectedPost.slug);
                      if (all) writePost(all, (all as any).isPillar);
                    }} disabled={!!writingSlug}>
                      <RefreshCw className="w-3 h-3 mr-1" /> Regenerate
                    </Button>
                    <Button size="sm" onClick={() => {
                      setPosts(prev => {
                        const updated = prev.map(p => p.slug === selectedPost.slug ? { ...p, status: "published" as const, publishedAt: new Date().toISOString() } : p);
                        localStorage.setItem("seo_posts", JSON.stringify(updated));
                        return updated;
                      });
                      addAuditEntry("Blog", `"${selectedPost.title}" — published`);
                      toast.success("Marked as published");
                    }}>
                      <CheckCircle2 className="w-3 h-3 mr-1" /> Mark as published
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="flex items-center justify-center h-64 text-muted-foreground text-sm border rounded-lg border-dashed">
                Select a post and click "Write selected" to generate it
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── STEP 3: Internal Links ── */}
      {step === 3 && topicMap && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Link Checklist</h3>
            <span className="text-xs text-muted-foreground">{completedLinks.length}/{linkChecklist.length} links</span>
          </div>
          <div className="space-y-1 max-h-[500px] overflow-y-auto">
            {linkChecklist.map((l, i) => {
              const fromDone = posts.find(p => p.title === l.from)?.status === "done" || posts.find(p => p.title === l.from)?.status === "published";
              return (
                <div key={i} className="flex items-center gap-2 text-xs py-1">
                  {fromDone ? <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" /> : <Circle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                  <span className="truncate">{l.from}</span>
                  <ArrowRight className="w-3 h-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{l.to}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${l.type === "cross-link" ? "bg-accent/15 text-accent-foreground" : "bg-muted text-muted-foreground"}`}>{l.type}</span>
                </div>
              );
            })}
          </div>

          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="text-xs">📘 Shopify Implementation Guide</Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Card className="mt-2"><CardContent className="p-4 text-xs text-muted-foreground space-y-2">
                <p>1. Shopify Admin → Online Store → Blog Posts → Add blog post</p>
                <p>2. Set blog to 'News' (default) or create a new blog</p>
                <p>3. Paste HTML from Sonic Invoices into Content (switch to HTML mode)</p>
                <p>4. Set SEO Title and Meta Description from Sonic Invoices</p>
                <p>5. Set URL slug from Sonic Invoices</p>
                <p>6. Publish</p>
                <p className="font-medium text-foreground mt-3">After all posts are published:</p>
                <p>7. Verify all links are live on each post</p>
                <p>8. The pillar post should have the most internal links pointing to it</p>
              </CardContent></Card>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}

      {/* ── STEP 4: Gap Check ── */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="flex gap-2 mb-3">
            <Button size="sm" variant={gapMode === "map" ? "default" : "outline"} onClick={() => setGapMode("map")} className="text-xs">
              From topic map
            </Button>
            <Button size="sm" variant={gapMode === "sitemap" ? "default" : "outline"} onClick={() => setGapMode("sitemap")} className="text-xs">
              From sitemap / titles
            </Button>
          </div>

          {gapMode === "map" && topicMap?.topicalGaps && topicMap.topicalGaps.length > 0 && !gapResult && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Gaps identified during topic map generation:</p>
              {topicMap.topicalGaps.map((g, i) => (
                <div key={i} className="flex items-center justify-between border rounded p-3">
                  <span className="text-sm">{g}</span>
                  <Button size="sm" variant="outline" className="text-xs shrink-0" onClick={() => { setNiche(g); setStep(2); }}>
                    Write post <ArrowRight className="w-3 h-3 ml-1" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {gapMode === "sitemap" && (
            <div>
              <Label>Paste existing blog post titles (one per line)</Label>
              <Textarea rows={6} value={gapInput} onChange={e => setGapInput(e.target.value)}
                placeholder={"How to choose a bikini top\nBest swimwear brands Australia\n..."} />
            </div>
          )}

          <Button className="w-full" onClick={runGapAnalysis} disabled={loading}>
            <Search className="w-4 h-4 mr-2" /> {loading ? "Analysing..." : "Find gaps"}
          </Button>

          {gapResult && (
            <div className="space-y-4 mt-4">
              {gapResult.topThreeNext?.length > 0 && (
                <Card className="border-primary/40 bg-primary/5">
                  <CardHeader className="pb-2"><CardTitle className="text-sm">🎯 Top 3 posts to write next</CardTitle></CardHeader>
                  <CardContent>
                    {gapResult.topThreeNext.map((t, i) => (
                      <p key={i} className="text-sm font-medium">{i + 1}. {t}</p>
                    ))}
                  </CardContent>
                </Card>
              )}

              {gapResult.gaps?.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Topic Gaps ({gapResult.gaps.length})</h3>
                  {gapResult.gaps.map((g, i) => (
                    <div key={i} className="border rounded p-3 flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{g.topic}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${g.priority === "high" ? "bg-destructive/15 text-destructive" : g.priority === "medium" ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground"}`}>{g.priority}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">🔑 {g.keyword}</p>
                        <p className="text-xs text-muted-foreground">{g.reason}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {gapResult.duplicates?.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">⚠️ Potential Duplicates</h3>
                  {gapResult.duplicates.map((d, i) => (
                    <div key={i} className="border border-warning/30 rounded p-3 text-xs">
                      <p><strong>{d.post1}</strong> vs <strong>{d.post2}</strong></p>
                      <p className="text-muted-foreground mt-1">{d.recommendation}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
