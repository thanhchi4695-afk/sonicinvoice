import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Loader2, Copy, Check, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { addAuditEntry } from "@/lib/audit-log";
import { toast } from "sonner";

interface GeoAgenticFlowProps {
  onBack: () => void;
}

interface AuditScores {
  contentGEO: { score: number; topWin: string; quickFix: string };
  technicalGEO: { score: number; topWin: string; quickFix: string };
  schema: { score: number; topWin: string; quickFix: string };
  entityEEAT: { score: number; topWin: string; quickFix: string };
  agenticReadiness: { score: number; topWin: string; quickFix: string };
}

interface Capsule {
  pageType: string;
  pageTopic: string;
  capsule: string;
  faqQuestion: string;
  generatedAt: string;
}

interface VisibilityPrompt {
  text: string;
  intent: string;
  result?: "yes" | "no" | "partial";
  competitor?: string;
}

const STEPS = ["Audit", "Content GEO", "Schema", "UCP Readiness", "Visibility"];

const AUDIT_CHECKLIST = [
  { key: "hasAnswerCapsule", label: "Homepage has an answer capsule (direct answer to 'what does store sell?') in first 40-60 words", category: "content" },
  { key: "blogAnswersQuestions", label: "Blog posts answer questions in the H2 headings", category: "content" },
  { key: "factDensity", label: "Content has statistics/facts every 150-200 words", category: "content" },
  { key: "noPromoLanguage", label: "Content avoids promotional language (curated, vibrant, stunning)", category: "content" },
  { key: "blogLength", label: "Blog posts are 800+ words covering full topics", category: "content" },
  { key: "aiCrawlersAllowed", label: "AI crawlers allowed in robots.txt (GPTBot, PerplexityBot, ClaudeBot)", category: "technical" },
  { key: "ssrRendered", label: "Content is server-side rendered (not JS-only)", category: "technical" },
  { key: "hasSitemap", label: "XML sitemap exists and is submitted", category: "technical" },
  { key: "hasLlmsTxt", label: "llms.txt file exists at /llms.txt", category: "technical" },
  { key: "robotsNotBlocking", label: "robots.txt does not block AI bots", category: "technical" },
  { key: "hasProductSchema", label: "Product schema (JSON-LD) on product pages", category: "schema" },
  { key: "hasOrgSchema", label: "Organization schema on homepage", category: "schema" },
  { key: "hasFaqSchema", label: "FAQPage schema on blog posts", category: "schema" },
  { key: "hasBreadcrumb", label: "BreadcrumbList schema on all pages", category: "schema" },
  { key: "hasLocalBusiness", label: "LocalBusiness schema (critical for local stores)", category: "schema" },
  { key: "brandConsistent", label: "Business name is consistent across all pages", category: "entity" },
  { key: "hasAuthorBios", label: "Author bios or About Us page exists", category: "entity" },
  { key: "hasReviews", label: "Customer reviews (Trustpilot, Google Reviews, etc.)", category: "entity" },
  { key: "thirdPartyMentions", label: "Store mentioned on 3rd party sites", category: "entity" },
  { key: "hasGBP", label: "Google Business Profile exists and is verified", category: "entity" },
  { key: "latestShopify", label: "Shopify store on latest version", category: "agentic" },
  { key: "completeDescriptions", label: "Product descriptions are 80+ words with 'what for' info", category: "agentic" },
  { key: "accurateStock", label: "All products have accurate in-stock status", category: "agentic" },
  { key: "completePricing", label: "All products have pricing with no hidden fees", category: "agentic" },
  { key: "hasFabricData", label: "Products include fabric/material composition", category: "agentic" },
];

const AI_BOTS = [
  { name: "GPTBot", agent: "GPTBot", owner: "OpenAI" },
  { name: "OAI-SearchBot", agent: "OAI-SearchBot", owner: "OpenAI Search" },
  { name: "ChatGPT-User", agent: "ChatGPT-User", owner: "ChatGPT" },
  { name: "PerplexityBot", agent: "PerplexityBot", owner: "Perplexity" },
  { name: "ClaudeBot", agent: "ClaudeBot", owner: "Anthropic" },
  { name: "Google-Extended", agent: "Google-Extended", owner: "Google AI" },
];

const SPLASH_FAQ_PAIRS = [
  { q: "What swimwear brands does Splash Swimwear stock?", a: "Splash Swimwear stocks 100+ brands including Seafolly, Funkita, Bond-Eye, Jantzen, Speedo, Baku, Roxy, and many more at our Darwin store and online." },
  { q: "Does Splash Swimwear ship Australia-wide?", a: "Yes, Splash Swimwear offers Australia-wide shipping from our Darwin store with free shipping on qualifying orders." },
  { q: "Where is Splash Swimwear located?", a: "Splash Swimwear is located in Darwin, Northern Territory, Australia." },
  { q: "Does Splash Swimwear stock D-G cup swimwear?", a: "Yes, Splash Swimwear stocks D-G cup swimwear from brands including Seafolly, Jantzen, and Freya, designed for fuller busts." },
  { q: "What is chlorine resistant swimwear?", a: "Chlorine resistant swimwear uses fabrics designed to withstand pool chemicals, lasting significantly longer than standard swimwear. Brands like Funkita and Speedo offer chlorine resistant ranges at Splash Swimwear." },
  { q: "Does Splash Swimwear have period swimwear?", a: "Yes, Splash Swimwear stocks period swimwear that allows swimming while menstruating, using leak-proof built-in technology." },
  { q: "What is the difference between a one-piece and a swimdress?", a: "A swimdress features a skirt attached to a one-piece base for more coverage, while a one-piece is form-fitting without a skirt. Both are available at Splash Swimwear in Darwin." },
  { q: "Does Splash Swimwear stock UV protection swimwear?", a: "Yes, Splash Swimwear stocks UPF 50+ sun protective swimwear including rashies and sunsuits suitable for Darwin's high UV conditions." },
  { q: "Can I buy swimwear online from Splash Swimwear?", a: "Yes, Splash Swimwear ships nationally from Darwin. Browse and purchase online at splashswimwear.com.au." },
  { q: "What sizes does Splash Swimwear stock?", a: "Splash Swimwear stocks sizes 6-24 across women's swimwear, including plus-size and mastectomy-friendly options from multiple brands." },
];

function scoreColor(score: number): string {
  if (score >= 90) return "text-teal-500";
  if (score >= 70) return "text-success";
  if (score >= 40) return "text-warning";
  return "text-destructive";
}

function scoreBg(score: number): string {
  if (score >= 90) return "bg-teal-500/15";
  if (score >= 70) return "bg-success/15";
  if (score >= 40) return "bg-warning/15";
  return "bg-destructive/15";
}

export default function GeoAgenticFlow({ onBack }: GeoAgenticFlowProps) {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);

  // Audit state
  const [storeUrl, setStoreUrl] = useState(() => localStorage.getItem("store_website") || "");
  const [storeName, setStoreName] = useState(() => localStorage.getItem("store_name") || "");
  const [storeCity, setStoreCity] = useState(() => localStorage.getItem("store_city") || "");
  const [niche, setNiche] = useState("");
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [auditScores, setAuditScores] = useState<AuditScores | null>(null);
  const [overallScore, setOverallScore] = useState(0);
  const [overallVerdict, setOverallVerdict] = useState("");
  const [priorityActions, setPriorityActions] = useState<string[]>([]);

  // Content GEO state
  const [contentTab, setContentTab] = useState<"capsule" | "rewrite">("capsule");
  const [pageType, setPageType] = useState("Homepage");
  const [pageTopic, setPageTopic] = useState("");
  const [capsules, setCapsules] = useState<Capsule[]>([]);
  const [currentCapsule, setCurrentCapsule] = useState<{ capsule: string; faqQuestion: string; wordCount: number } | null>(null);
  const [existingIntro, setExistingIntro] = useState("");
  const [rewrittenIntro, setRewrittenIntro] = useState("");
  const [rewriteChanges, setRewriteChanges] = useState<string[]>([]);

  // Schema state
  const [schemaTab, setSchemaTab] = useState<"local" | "faq" | "product" | "robots">("local");
  const [faqPairs, setFaqPairs] = useState<{ q: string; a: string }[]>([]);
  const [newFaqQ, setNewFaqQ] = useState("");
  const [newFaqA, setNewFaqA] = useState("");
  const [robotsTxt, setRobotsTxt] = useState("");
  const [storePhone, setStorePhone] = useState(() => localStorage.getItem("store_phone") || "");
  const [storeAddress, setStoreAddress] = useState(() => localStorage.getItem("store_address") || "");

  // UCP state
  const [ucpChecklist, setUcpChecklist] = useState<Record<string, boolean>>({});
  const [utilityTags, setUtilityTags] = useState<Record<string, string>>({});

  // Visibility state
  const [visPrompts, setVisPrompts] = useState<VisibilityPrompt[]>([]);

  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Load saved data
  useEffect(() => {
    try {
      const saved = localStorage.getItem("geo_audit");
      if (saved) {
        const d = JSON.parse(saved);
        if (d.scores) setAuditScores(d.scores);
        if (d.overallScore) setOverallScore(d.overallScore);
        if (d.overallVerdict) setOverallVerdict(d.overallVerdict);
        if (d.priorityActions) setPriorityActions(d.priorityActions);
        if (d.niche) setNiche(d.niche);
      }
      const caps = localStorage.getItem("geo_answer_capsules");
      if (caps) setCapsules(JSON.parse(caps));
      const schema = localStorage.getItem("geo_schema");
      if (schema) {
        const s = JSON.parse(schema);
        if (s.faqPairs) setFaqPairs(s.faqPairs);
      }
      const vis = localStorage.getItem("geo_visibility");
      if (vis) {
        const v = JSON.parse(vis);
        if (v.prompts) setVisPrompts(v.prompts);
      }
      const ucp = localStorage.getItem("geo_ucp");
      if (ucp) {
        const u = JSON.parse(ucp);
        if (u.checklistStatus) setUcpChecklist(u.checklistStatus);
        if (u.productUtilities) setUtilityTags(u.productUtilities);
      }
    } catch {}

    // Pre-fill FAQ for Splash
    if ((storeName.toLowerCase().includes("splash") || niche.toLowerCase().includes("swimwear")) && faqPairs.length === 0) {
      setFaqPairs(SPLASH_FAQ_PAIRS);
    }
  }, []);

  const callAI = async (action: string, extra: Record<string, any> = {}) => {
    const { data, error } = await supabase.functions.invoke("geo-agentic", {
      body: { action, storeName, storeUrl, storeCity, niche, locale: localStorage.getItem("store_locale") || "AU", ...extra },
    });
    if (error) throw error;
    return data?.result;
  };

  const handleAudit = async () => {
    if (!storeName || !storeUrl) { toast.error("Enter store name and URL"); return; }
    setLoading(true);
    try {
      const result = await callAI("audit", { checklist });
      if (result?.scores) {
        setAuditScores(result.scores);
        setOverallScore(result.overallScore || 0);
        setOverallVerdict(result.overallVerdict || "");
        setPriorityActions(result.priorityActions || []);
        localStorage.setItem("geo_audit", JSON.stringify({ auditDate: new Date().toISOString(), storeUrl, storeName, niche, storeCity, scores: result.scores, overallScore: result.overallScore, overallVerdict: result.overallVerdict, priorityActions: result.priorityActions }));
        addAuditEntry("GEO", `Audit: ${result.overallScore}/100 — ${niche} ${storeCity}`);
        toast.success(`GEO Audit complete: ${result.overallScore}/100`);
      }
    } catch (err: any) {
      toast.error(err?.message || "Audit failed");
    } finally { setLoading(false); }
  };

  const handleCapsule = async () => {
    if (!pageTopic) { toast.error("Enter a page topic"); return; }
    setLoading(true);
    try {
      const result = await callAI("capsule", { pageType, pageTopic });
      if (result?.answerCapsule) {
        setCurrentCapsule({ capsule: result.answerCapsule, faqQuestion: result.faqQuestion, wordCount: result.wordCount || result.answerCapsule.split(/\s+/).length });
        const newCapsule: Capsule = { pageType, pageTopic, capsule: result.answerCapsule, faqQuestion: result.faqQuestion, generatedAt: new Date().toISOString() };
        const updated = [...capsules, newCapsule];
        setCapsules(updated);
        localStorage.setItem("geo_answer_capsules", JSON.stringify(updated));
        toast.success("Answer capsule generated!");
      }
    } catch (err: any) {
      toast.error(err?.message || "Generation failed");
    } finally { setLoading(false); }
  };

  const handleRewrite = async () => {
    if (!existingIntro) { toast.error("Paste your existing intro"); return; }
    setLoading(true);
    try {
      const result = await callAI("rewrite_intro", { pageTopic, existingIntro });
      if (result?.rewrittenIntro) {
        setRewrittenIntro(result.rewrittenIntro);
        setRewriteChanges(result.changes || []);
        toast.success("Intro rewritten for GEO!");
      }
    } catch (err: any) {
      toast.error(err?.message || "Rewrite failed");
    } finally { setLoading(false); }
  };

  const handleUtilityTags = async () => {
    let products: any[] = [];
    try { products = JSON.parse(localStorage.getItem("invoice_lines") || "[]"); } catch {}
    if (products.length === 0) { toast.error("Import an invoice first"); return; }
    setLoading(true);
    try {
      const result = await callAI("utility_tags", { products: products.slice(0, 20) });
      if (result?.utilities) {
        const tags: Record<string, string> = {};
        result.utilities.forEach((u: any) => {
          const p = products[u.index];
          if (p) tags[p.handle || p.title] = u.phrase;
        });
        setUtilityTags(tags);
        localStorage.setItem("geo_ucp", JSON.stringify({ checklistStatus: ucpChecklist, productUtilities: tags }));
        toast.success(`Generated ${Object.keys(tags).length} utility tags`);
      }
    } catch (err: any) {
      toast.error(err?.message || "Generation failed");
    } finally { setLoading(false); }
  };

  const handleVisibilityPrompts = async () => {
    if (!niche) { toast.error("Enter your niche first (Step 1)"); return; }
    setLoading(true);
    try {
      const result = await callAI("visibility_prompts");
      if (result?.prompts) {
        setVisPrompts(result.prompts);
        localStorage.setItem("geo_visibility", JSON.stringify({ prompts: result.prompts, lastTested: new Date().toISOString() }));
        toast.success("Test prompts generated!");
      }
    } catch (err: any) {
      toast.error(err?.message || "Generation failed");
    } finally { setLoading(false); }
  };

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success("Copied!");
  };

  const generateLocalBusinessSchema = () => {
    return JSON.stringify({
      "@context": "https://schema.org",
      "@type": ["LocalBusiness", "ClothingStore"],
      name: storeName,
      url: storeUrl,
      telephone: storePhone,
      address: { "@type": "PostalAddress", streetAddress: storeAddress, addressLocality: storeCity, addressRegion: storeCity === "Darwin" ? "NT" : "", addressCountry: "AU" },
      priceRange: "$$",
    }, null, 2);
  };

  const generateFaqSchema = () => {
    return JSON.stringify({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqPairs.map(f => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    }, null, 2);
  };

  const checkRobotsTxt = (txt: string) => {
    return AI_BOTS.map(bot => ({
      ...bot,
      blocked: txt.toLowerCase().includes(`user-agent: ${bot.agent.toLowerCase()}`) && txt.toLowerCase().includes("disallow: /"),
      allowed: txt.toLowerCase().includes(`user-agent: ${bot.agent.toLowerCase()}`) && txt.toLowerCase().includes("allow: /"),
    }));
  };

  const generateLlmsTxt = () => {
    const collections = JSON.parse(localStorage.getItem("seo_collections_generated") || "[]");
    return `# ${storeName}\n\n${storeName} is a swimwear and resort wear retailer based in ${storeCity}, Australia.\n\n## Key pages\n- [Homepage](${storeUrl}): Main store with all products\n- [Blog](${storeUrl}/blogs/news): Swimwear guides and buying advice\n\n## Collections\n${collections.slice(0, 20).map((c: any) => `- [${c.title}](${storeUrl}/collections/${c.handle})`).join("\n")}\n`;
  };

  const ScoreGauge = ({ label, score, topWin, quickFix }: { label: string; score: number; topWin: string; quickFix: string }) => (
    <div className={`rounded-lg border border-border p-3 text-center ${scoreBg(score)}`}>
      <p className={`text-3xl font-bold ${scoreColor(score)}`}>{score}</p>
      <p className="text-xs font-medium mt-1">{label}</p>
      <p className="text-[10px] text-muted-foreground mt-2 text-left">🎯 {topWin}</p>
      <p className="text-[10px] text-muted-foreground text-left">⚡ {quickFix}</p>
    </div>
  );

  const citedCount = visPrompts.filter(p => p.result === "yes").length;
  const testedCount = visPrompts.filter(p => p.result).length;

  return (
    <div className="min-h-screen bg-background">
      <div className="px-4 pt-4 pb-2">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground mb-3">
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <h1 className="text-2xl font-bold font-display">GEO & Agentic Commerce</h1>
        <p className="text-sm text-muted-foreground mt-1">Get cited by AI. Get bought by AI agents.</p>

        <div className="flex items-center gap-1 mt-4 mb-4 overflow-x-auto">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-1 shrink-0">
              <button onClick={() => setStep(i)}
                className={`text-xs px-2.5 py-1.5 rounded-full font-medium transition-colors ${i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
                {i + 1}. {s}
              </button>
              {i < STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-muted-foreground" />}
            </div>
          ))}
        </div>
      </div>

      <div className="px-4 pb-24">
        {/* ───── STEP 0: AUDIT ───── */}
        {step === 0 && (
          <div className="space-y-4">
            <div className="bg-card rounded-lg border border-border p-4 space-y-3">
              <h2 className="text-base font-semibold">Store details</h2>
              <Input placeholder="Store name" value={storeName} onChange={e => setStoreName(e.target.value)} />
              <Input placeholder="Store URL" value={storeUrl} onChange={e => setStoreUrl(e.target.value)} />
              <Input placeholder="City" value={storeCity} onChange={e => setStoreCity(e.target.value)} />
              <Input placeholder="Niche (e.g. womens swimwear Darwin)" value={niche} onChange={e => setNiche(e.target.value)} />
            </div>

            <div className="bg-card rounded-lg border border-border p-4 space-y-2">
              <h2 className="text-base font-semibold">GEO readiness checklist</h2>
              <p className="text-xs text-muted-foreground">Tick what your store currently has. Be honest — this determines your score.</p>
              {AUDIT_CHECKLIST.map(item => (
                <label key={item.key} className="flex items-start gap-2 text-sm cursor-pointer py-1">
                  <Checkbox checked={!!checklist[item.key]} onCheckedChange={v => setChecklist(prev => ({ ...prev, [item.key]: !!v }))} className="mt-0.5" />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>

            <Button className="w-full h-12 text-base" onClick={handleAudit} disabled={loading}>
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Auditing...</> : "Run audit →"}
            </Button>

            {auditScores && (
              <div className="space-y-4">
                <div className={`rounded-lg border border-border p-4 text-center ${scoreBg(overallScore)}`}>
                  <p className={`text-5xl font-bold ${scoreColor(overallScore)}`}>{overallScore}</p>
                  <p className="text-sm font-medium mt-1">Overall GEO Score</p>
                  <p className={`text-xs mt-1 ${scoreColor(overallScore)}`}>{overallVerdict}</p>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                  <ScoreGauge label="Content GEO" score={auditScores.contentGEO.score} topWin={auditScores.contentGEO.topWin} quickFix={auditScores.contentGEO.quickFix} />
                  <ScoreGauge label="Technical GEO" score={auditScores.technicalGEO.score} topWin={auditScores.technicalGEO.topWin} quickFix={auditScores.technicalGEO.quickFix} />
                  <ScoreGauge label="Schema" score={auditScores.schema.score} topWin={auditScores.schema.topWin} quickFix={auditScores.schema.quickFix} />
                  <ScoreGauge label="Entity & E-E-A-T" score={auditScores.entityEEAT.score} topWin={auditScores.entityEEAT.topWin} quickFix={auditScores.entityEEAT.quickFix} />
                  <ScoreGauge label="Agentic (UCP)" score={auditScores.agenticReadiness.score} topWin={auditScores.agenticReadiness.topWin} quickFix={auditScores.agenticReadiness.quickFix} />
                </div>
                {priorityActions.length > 0 && (
                  <div className="bg-card rounded-lg border border-border p-4">
                    <h3 className="text-sm font-semibold mb-2">Priority actions</h3>
                    <ol className="text-sm space-y-1 list-decimal ml-4">
                      {priorityActions.map((a, i) => <li key={i}>{a}</li>)}
                    </ol>
                  </div>
                )}
                <Button className="w-full" onClick={() => setStep(1)}>Next: Content GEO →</Button>
              </div>
            )}
          </div>
        )}

        {/* ───── STEP 1: CONTENT GEO ───── */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="flex gap-1 border-b border-border">
              {(["capsule", "rewrite"] as const).map(tab => (
                <button key={tab} onClick={() => setContentTab(tab)}
                  className={`text-sm px-4 py-2 border-b-2 transition-colors ${contentTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}>
                  {tab === "capsule" ? "Answer Capsules" : "GEO Rewriter"}
                </button>
              ))}
            </div>

            {contentTab === "capsule" && (
              <div className="space-y-4">
                <div className="bg-card rounded-lg border border-border p-4 space-y-3">
                  <h2 className="text-base font-semibold">Generate answer capsule</h2>
                  <p className="text-xs text-muted-foreground">72% of pages cited by ChatGPT have an answer capsule in the first 40-60 words.</p>
                  <select value={pageType} onChange={e => setPageType(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
                    <option>Homepage</option>
                    <option>Collection page</option>
                    <option>Blog post</option>
                    <option>Product page</option>
                    <option>About page</option>
                    <option>Contact page</option>
                  </select>
                  <Input placeholder="Page topic (e.g. bikini tops Darwin)" value={pageTopic} onChange={e => setPageTopic(e.target.value)} />
                  <Button className="w-full" onClick={handleCapsule} disabled={loading}>
                    {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Generate answer capsule
                  </Button>
                </div>

                {currentCapsule && (
                  <div className="bg-card rounded-lg border-2 border-primary/30 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-primary">Answer capsule</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{currentCapsule.wordCount} words</span>
                    </div>
                    <p className="text-sm leading-relaxed">{currentCapsule.capsule}</p>
                    <div className="bg-muted/50 rounded p-3">
                      <p className="text-xs text-muted-foreground">FAQ Question:</p>
                      <p className="text-sm">{currentCapsule.faqQuestion}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => copyText(currentCapsule.capsule, "capsule")}>
                        {copiedId === "capsule" ? <Check className="w-3 h-3 mr-1" /> : <Copy className="w-3 h-3 mr-1" />} Copy capsule
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => copyText(`Q: ${currentCapsule.faqQuestion}\nA: ${currentCapsule.capsule}`, "faq")}>
                        {copiedId === "faq" ? <Check className="w-3 h-3 mr-1" /> : <Copy className="w-3 h-3 mr-1" />} Copy FAQ pair
                      </Button>
                    </div>
                  </div>
                )}

                {capsules.length > 0 && (
                  <div className="bg-card rounded-lg border border-border p-4">
                    <h3 className="text-sm font-semibold mb-2">Previous capsules ({capsules.length})</h3>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {capsules.map((c, i) => (
                        <div key={i} className="text-xs bg-muted/50 rounded p-2">
                          <span className="font-medium">{c.pageType}: {c.pageTopic}</span>
                          <p className="text-muted-foreground mt-0.5 truncate">{c.capsule}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {contentTab === "rewrite" && (
              <div className="space-y-4">
                <div className="bg-card rounded-lg border border-border p-4 space-y-3">
                  <h2 className="text-base font-semibold">GEO blog intro rewriter</h2>
                  <Input placeholder="Blog post title" value={pageTopic} onChange={e => setPageTopic(e.target.value)} />
                  <Textarea placeholder="Paste your existing intro paragraph..." value={existingIntro} onChange={e => setExistingIntro(e.target.value)} className="min-h-[120px]" />
                  <Button className="w-full" onClick={handleRewrite} disabled={loading}>
                    {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Rewrite for GEO
                  </Button>
                </div>
                {rewrittenIntro && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="bg-destructive/5 rounded-lg border border-destructive/20 p-4">
                      <p className="text-xs font-medium text-destructive mb-2">Original</p>
                      <p className="text-sm">{existingIntro}</p>
                    </div>
                    <div className="bg-success/5 rounded-lg border border-success/20 p-4">
                      <p className="text-xs font-medium text-success mb-2">Rewritten (GEO-optimised)</p>
                      <p className="text-sm">{rewrittenIntro}</p>
                      <Button size="sm" variant="outline" className="mt-3" onClick={() => copyText(rewrittenIntro, "rewrite")}>
                        {copiedId === "rewrite" ? <Check className="w-3 h-3 mr-1" /> : <Copy className="w-3 h-3 mr-1" />} Copy
                      </Button>
                    </div>
                    {rewriteChanges.length > 0 && (
                      <div className="lg:col-span-2 bg-card rounded-lg border border-border p-3">
                        <p className="text-xs font-medium mb-1">Changes made:</p>
                        <ul className="text-xs text-muted-foreground space-y-0.5 list-disc ml-4">
                          {rewriteChanges.map((c, i) => <li key={i}>{c}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(0)}>← Back</Button>
              <Button className="flex-1" onClick={() => setStep(2)}>Schema →</Button>
            </div>
          </div>
        )}

        {/* ───── STEP 2: SCHEMA ───── */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex gap-1 border-b border-border overflow-x-auto">
              {([["local", "LocalBusiness"], ["faq", "FAQ"], ["product", "Product"], ["robots", "robots.txt"]] as const).map(([key, label]) => (
                <button key={key} onClick={() => setSchemaTab(key as any)}
                  className={`text-xs px-3 py-2 border-b-2 shrink-0 transition-colors ${schemaTab === key ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}>
                  {label}
                </button>
              ))}
            </div>

            {schemaTab === "local" && (
              <div className="space-y-3">
                <div className="bg-card rounded-lg border border-border p-4 space-y-3">
                  <h2 className="text-base font-semibold">LocalBusiness + Organization schema</h2>
                  <Input placeholder="Store phone" value={storePhone} onChange={e => { setStorePhone(e.target.value); localStorage.setItem("store_phone", e.target.value); }} />
                  <Input placeholder="Street address" value={storeAddress} onChange={e => { setStoreAddress(e.target.value); localStorage.setItem("store_address", e.target.value); }} />
                </div>
                <div className="relative">
                  <pre className="text-xs bg-muted/50 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap font-mono-data">{generateLocalBusinessSchema()}</pre>
                  <Button variant="ghost" size="sm" className="absolute top-2 right-2" onClick={() => copyText(generateLocalBusinessSchema(), "lb")}>
                    {copiedId === "lb" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Place inside a <code>&lt;script type="application/ld+json"&gt;</code> tag in your theme's <code>&lt;head&gt;</code>.</p>
              </div>
            )}

            {schemaTab === "faq" && (
              <div className="space-y-3">
                <div className="bg-card rounded-lg border border-border p-4 space-y-3">
                  <h2 className="text-base font-semibold">FAQPage schema ({faqPairs.length} pairs)</h2>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {faqPairs.map((f, i) => (
                      <div key={i} className="bg-muted/50 rounded p-2 text-xs">
                        <p className="font-medium">Q: {f.q}</p>
                        <p className="text-muted-foreground">A: {f.a}</p>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2 border-t border-border pt-3">
                    <Input placeholder="Question" value={newFaqQ} onChange={e => setNewFaqQ(e.target.value)} />
                    <Textarea placeholder="Answer" value={newFaqA} onChange={e => setNewFaqA(e.target.value)} className="min-h-[60px]" />
                    <Button size="sm" variant="outline" onClick={() => {
                      if (newFaqQ && newFaqA) {
                        const updated = [...faqPairs, { q: newFaqQ, a: newFaqA }];
                        setFaqPairs(updated);
                        localStorage.setItem("geo_schema", JSON.stringify({ faqPairs: updated }));
                        setNewFaqQ(""); setNewFaqA("");
                      }
                    }}>Add FAQ pair</Button>
                  </div>
                </div>
                {faqPairs.length > 0 && (
                  <div className="relative">
                    <pre className="text-xs bg-muted/50 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap font-mono-data max-h-60 overflow-y-auto">{generateFaqSchema()}</pre>
                    <Button variant="ghost" size="sm" className="absolute top-2 right-2" onClick={() => copyText(generateFaqSchema(), "faqschema")}>
                      {copiedId === "faqschema" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {schemaTab === "product" && (
              <div className="space-y-3">
                <div className="bg-card rounded-lg border border-border p-4">
                  <h2 className="text-base font-semibold">Product schema (JSON-LD)</h2>
                  <p className="text-xs text-muted-foreground mt-1">Product schema is typically auto-generated by Shopify themes. Check your theme supports it.</p>
                  <p className="text-xs text-muted-foreground mt-2">Use Google's <a href="https://search.google.com/test/rich-results" target="_blank" className="text-primary underline">Rich Results Test</a> to verify your product pages have valid schema.</p>
                </div>
              </div>
            )}

            {schemaTab === "robots" && (
              <div className="space-y-3">
                <div className="bg-card rounded-lg border border-border p-4 space-y-3">
                  <h2 className="text-base font-semibold">robots.txt AI bot checker</h2>
                  <Textarea placeholder="Paste your robots.txt content here..." value={robotsTxt} onChange={e => setRobotsTxt(e.target.value)} className="min-h-[100px] font-mono-data text-xs" />
                  {robotsTxt && (
                    <div className="space-y-1">
                      {checkRobotsTxt(robotsTxt).map(bot => (
                        <div key={bot.name} className="flex items-center gap-2 text-sm">
                          <span>{bot.blocked ? "❌" : "✅"}</span>
                          <span className="font-medium">{bot.name}</span>
                          <span className="text-xs text-muted-foreground">({bot.owner})</span>
                          {bot.blocked && <span className="text-xs text-destructive">— BLOCKED</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="bg-card rounded-lg border border-border p-4 space-y-3">
                  <h2 className="text-base font-semibold">llms.txt generator</h2>
                  <div className="relative">
                    <pre className="text-xs bg-muted/50 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap font-mono-data max-h-48 overflow-y-auto">{generateLlmsTxt()}</pre>
                    <Button variant="ghost" size="sm" className="absolute top-2 right-2" onClick={() => copyText(generateLlmsTxt(), "llms")}>
                      {copiedId === "llms" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Upload to your store as /llms.txt via Shopify Admin → Content → Files.</p>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)}>← Back</Button>
              <Button className="flex-1" onClick={() => setStep(3)}>UCP Readiness →</Button>
            </div>
          </div>
        )}

        {/* ───── STEP 3: UCP READINESS ───── */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="bg-card rounded-lg border border-border p-4 space-y-3">
              <h2 className="text-base font-semibold">Google Agentic Commerce checklist</h2>
              <p className="text-xs text-muted-foreground">UCP (Universal Commerce Protocol) was co-developed by Shopify + Google in Jan 2026. It lets AI agents buy from your store directly.</p>
              {[
                { key: "agentic_storefronts", label: "Enable Agentic Storefronts in Shopify Admin → Settings → Apps" },
                { key: "gmc_connected", label: "Connect Google Merchant Center" },
                { key: "feed_healthy", label: "Verify product feed is healthy in Merchant Center" },
                { key: "business_agent", label: "Enable Google's Business Agent pilot (US retailers)" },
                { key: "direct_offers", label: "Apply for Direct Offers pilot (exclusive AI Mode deals)" },
              ].map(item => (
                <label key={item.key} className="flex items-start gap-2 text-sm cursor-pointer py-1">
                  <Checkbox checked={!!ucpChecklist[item.key]} onCheckedChange={v => {
                    const updated = { ...ucpChecklist, [item.key]: !!v };
                    setUcpChecklist(updated);
                    localStorage.setItem("geo_ucp", JSON.stringify({ checklistStatus: updated, productUtilities: utilityTags }));
                  }} className="mt-0.5" />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>

            <div className="bg-card rounded-lg border border-border p-4 space-y-3">
              <h2 className="text-base font-semibold">Product utility mapping</h2>
              <p className="text-xs text-muted-foreground">AI agents choose based on "what is this product FOR?" — generate utility tags for your products.</p>
              <Button onClick={handleUtilityTags} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Generate utility tags from invoice
              </Button>
              {Object.keys(utilityTags).length > 0 && (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {Object.entries(utilityTags).map(([key, val]) => (
                    <div key={key} className="flex items-center gap-2 text-xs bg-muted/50 rounded p-2">
                      <span className="font-medium truncate flex-1">{key}</span>
                      <span className="text-primary shrink-0">{val}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-muted/30 rounded-lg border border-border p-4">
              <h3 className="text-sm font-semibold">Model Context Protocol (MCP)</h3>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                MCP was co-developed with UCP. Shopify merchants on the Agentic plan automatically have MCP-compatible product endpoints.
                Products with complete descriptions, fabric data, utility tags, and care instructions become MCP-ready automatically.
                The Enrichment feature in Sonic Invoices builds this data — run enrichment before activating UCP.
              </p>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(2)}>← Back</Button>
              <Button className="flex-1" onClick={() => setStep(4)}>Visibility Check →</Button>
            </div>
          </div>
        )}

        {/* ───── STEP 4: VISIBILITY CHECK ───── */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="bg-card rounded-lg border border-border p-4 space-y-3">
              <h2 className="text-base font-semibold">Test your AI visibility</h2>
              <p className="text-xs text-muted-foreground">Generate test prompts, then manually check them in ChatGPT, Perplexity, and Google AI Mode.</p>
              <Button onClick={handleVisibilityPrompts} disabled={loading || visPrompts.length > 0}>
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {visPrompts.length > 0 ? `${visPrompts.length} prompts ready` : "Generate test prompts"}
              </Button>
            </div>

            {visPrompts.length > 0 && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-card rounded-lg border border-border p-3 text-center">
                    <p className="text-2xl font-bold text-primary">{testedCount}/{visPrompts.length}</p>
                    <p className="text-xs text-muted-foreground">Tested</p>
                  </div>
                  <div className="bg-card rounded-lg border border-border p-3 text-center">
                    <p className={`text-2xl font-bold ${citedCount > 3 ? "text-success" : citedCount > 0 ? "text-warning" : "text-destructive"}`}>{citedCount}</p>
                    <p className="text-xs text-muted-foreground">Cited</p>
                  </div>
                </div>

                <div className="space-y-2">
                  {visPrompts.map((p, i) => (
                    <div key={i} className="bg-card rounded-lg border border-border p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${p.intent === "discovery" ? "bg-primary/15 text-primary" : p.intent === "recommendation" ? "bg-success/15 text-success" : p.intent === "comparison" ? "bg-warning/15 text-warning" : "bg-accent/15 text-accent-foreground"}`}>
                          {p.intent}
                        </span>
                        <p className="text-sm flex-1">{p.text}</p>
                        <Button variant="ghost" size="sm" onClick={() => copyText(p.text, `prompt-${i}`)}>
                          {copiedId === `prompt-${i}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        </Button>
                      </div>
                      <div className="flex gap-1.5">
                        <a href={`https://chatgpt.com/?q=${encodeURIComponent(p.text)}`} target="_blank" className="text-[10px] px-2 py-1 rounded bg-muted hover:bg-muted/80 text-muted-foreground flex items-center gap-1">
                          ChatGPT <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                        <a href={`https://www.perplexity.ai/search?q=${encodeURIComponent(p.text)}`} target="_blank" className="text-[10px] px-2 py-1 rounded bg-muted hover:bg-muted/80 text-muted-foreground flex items-center gap-1">
                          Perplexity <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>
                      <div className="flex gap-2">
                        {(["yes", "no", "partial"] as const).map(r => (
                          <button key={r} onClick={() => {
                            const updated = [...visPrompts];
                            updated[i] = { ...updated[i], result: r };
                            setVisPrompts(updated);
                            localStorage.setItem("geo_visibility", JSON.stringify({ prompts: updated, lastTested: new Date().toISOString() }));
                          }}
                            className={`text-[10px] px-3 py-1 rounded-full border transition-colors ${p.result === r ? (r === "yes" ? "bg-success/15 border-success text-success" : r === "no" ? "bg-destructive/15 border-destructive text-destructive" : "bg-warning/15 border-warning text-warning") : "border-border text-muted-foreground"}`}>
                            {r === "yes" ? "✅ Cited" : r === "no" ? "❌ Not cited" : "⚠ Partial"}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <Button variant="outline" onClick={() => setStep(3)}>← Back</Button>
          </div>
        )}
      </div>
    </div>
  );
}
