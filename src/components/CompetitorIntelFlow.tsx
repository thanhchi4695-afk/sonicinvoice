import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { ArrowLeft, ChevronRight, Plus, X, Search, Check, Download, Copy, RefreshCw, Loader2 } from "lucide-react";
import { getBrandDirectory, type BrandDirectoryEntry } from "@/lib/brand-directory";
import { supabase } from "@/integrations/supabase/client";

interface CompetitorIntelFlowProps { onBack: () => void; }

interface Competitor { name: string; url: string; enabled: boolean; }
interface SupplierSource { name: string; url: string; enabled: boolean; extractPrints: boolean; extractTips: boolean; extractFaqs: boolean; extractCollections: boolean; }

interface CompetitorCollection {
  title: string; url: string; categoryType: string; navLevel: string;
  productCount: number | null; hasDescription: boolean; descriptionPreview: string;
  metaTitle: string; metaDescription: string;
}
interface CompetitorData { competitorName: string; totalCollections: number; collections: CompetitorCollection[]; notableFeatures: string[]; extractedAt: string; }
interface SupplierPrint { name: string; story: string; mood: string; colours: string; editorialText: string; }
interface SupplierTip { productType: string; tip: string; source: string; }
interface SupplierFaq { question: string; answer: string; category: string; }
interface SupplierData { brandName: string; prints: SupplierPrint[]; stylingTips: SupplierTip[]; faqs: SupplierFaq[]; brandCollections: { name: string; description: string; url: string }[]; extractedAt: string; }

interface Gap {
  title: string; handle: string; source: string; categoryType: string;
  priority: number; productCount: number; competitorDescription?: string;
  printStory?: string; printMood?: string; vendor?: string;
  selected: boolean; generated?: any;
}

const DEFAULT_COMPETITORS: Competitor[] = [
  { name: "Swimwear Galore", url: "https://swimweargalore.com.au/collections/", enabled: true },
  { name: "Splish Splash Swimwear", url: "https://splishsplashswimwear.com.au/collections/", enabled: true },
];

function toHandle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "").replace(/^-+/, "");
}

function loadCachedCompetitor(name: string): CompetitorData | null {
  try {
    const key = `intel_competitor_${toHandle(name)}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const age = (Date.now() - new Date(data.extractedAt).getTime()) / 86400000;
    if (age > 30) return null;
    return data;
  } catch { return null; }
}
function saveCachedCompetitor(data: CompetitorData) {
  localStorage.setItem(`intel_competitor_${toHandle(data.competitorName)}`, JSON.stringify(data));
}
function loadCachedSupplier(name: string): SupplierData | null {
  try {
    const key = `intel_supplier_${toHandle(name)}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const age = (Date.now() - new Date(data.extractedAt).getTime()) / 86400000;
    if (age > 30) return null;
    return data;
  } catch { return null; }
}
function saveCachedSupplier(data: SupplierData) {
  localStorage.setItem(`intel_supplier_${toHandle(data.brandName)}`, JSON.stringify(data));
}

const STEPS = ["Sources", "Crawl & Extract", "Gap Analysis", "Generate Descriptions"];

const CompetitorIntelFlow = ({ onBack }: CompetitorIntelFlowProps) => {
  const [step, setStep] = useState(0);
  const [competitors, setCompetitors] = useState<Competitor[]>(DEFAULT_COMPETITORS);
  const [suppliers, setSuppliers] = useState<SupplierSource[]>(() => {
    const brands = getBrandDirectory().filter(b => b.industry === "swimwear" && b.website);
    return brands.slice(0, 8).map(b => ({
      name: b.name, url: `https://${b.website}`, enabled: true,
      extractPrints: true, extractTips: true, extractFaqs: true, extractCollections: true,
    }));
  });
  const [catalogSource, setCatalogSource] = useState<"invoice" | "catalog">("invoice");
  const [competitorData, setCompetitorData] = useState<CompetitorData[]>([]);
  const [supplierDataList, setSupplierDataList] = useState<SupplierData[]>([]);
  const [crawlLog, setCrawlLog] = useState<string[]>([]);
  const [crawling, setCrawling] = useState(false);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [gapFilter, setGapFilter] = useState("all");
  const [generating, setGenerating] = useState(false);
  const [generatedCount, setGeneratedCount] = useState(0);
  const [showPreview, setShowPreview] = useState<string | null>(null);

  // Load cached data on mount
  useState(() => {
    const cached: CompetitorData[] = [];
    const cachedSup: SupplierData[] = [];
    competitors.forEach(c => { const d = loadCachedCompetitor(c.name); if (d) cached.push(d); });
    suppliers.forEach(s => { const d = loadCachedSupplier(s.name); if (d) cachedSup.push(d); });
    if (cached.length > 0) setCompetitorData(cached);
    if (cachedSup.length > 0) setSupplierDataList(cachedSup);
  });

  const addCompetitor = () => {
    setCompetitors(prev => [...prev, { name: "", url: "", enabled: true }]);
  };

  const addSupplier = () => {
    setSuppliers(prev => [...prev, { name: "", url: "", enabled: true, extractPrints: true, extractTips: true, extractFaqs: true, extractCollections: true }]);
  };

  const callIntel = async (action: string, payload: any): Promise<any> => {
    const { data, error } = await supabase.functions.invoke("competitor-intel", { body: { action, payload } });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data?.data;
  };

  const startCrawl = useCallback(async () => {
    setCrawling(true);
    setCrawlLog([]);
    const allComp: CompetitorData[] = [];
    const allSup: SupplierData[] = [];
    const storeName = localStorage.getItem("store_name") || "Splash Swimwear";

    // Competitors
    for (const comp of competitors.filter(c => c.enabled && c.name && c.url)) {
      const cached = loadCachedCompetitor(comp.name);
      if (cached) {
        setCrawlLog(prev => [...prev, `✓ ${comp.name} — loaded from cache (${cached.totalCollections} collections)`]);
        allComp.push(cached);
        continue;
      }
      setCrawlLog(prev => [...prev, `⟳ ${comp.name} — reading collections...`]);
      try {
        const result = await callIntel("extract_competitor", { competitorName: comp.name, competitorUrl: comp.url, storeName });
        const data: CompetitorData = { ...result, extractedAt: new Date().toISOString() };
        saveCachedCompetitor(data);
        allComp.push(data);
        setCrawlLog(prev => [...prev.slice(0, -1), `✓ ${comp.name} — ${data.totalCollections || data.collections?.length || 0} collections extracted`]);
      } catch (err: any) {
        setCrawlLog(prev => [...prev.slice(0, -1), `✗ ${comp.name} — ${err.message}`]);
      }
      await new Promise(r => setTimeout(r, 500));
    }

    // Suppliers
    for (const sup of suppliers.filter(s => s.enabled && s.name && s.url)) {
      const cached = loadCachedSupplier(sup.name);
      if (cached) {
        setCrawlLog(prev => [...prev, `✓ ${sup.name} — loaded from cache`]);
        allSup.push(cached);
        continue;
      }
      setCrawlLog(prev => [...prev, `⟳ ${sup.name} — reading brand site...`]);
      try {
        const result = await callIntel("extract_supplier", { brandName: sup.name, brandUrl: sup.url });
        const data: SupplierData = { ...result, extractedAt: new Date().toISOString() };
        saveCachedSupplier(data);
        allSup.push(data);
        const stats = `${data.prints?.length || 0} prints, ${data.stylingTips?.length || 0} tips, ${data.faqs?.length || 0} FAQs`;
        setCrawlLog(prev => [...prev.slice(0, -1), `✓ ${sup.name} — ${stats}`]);
      } catch (err: any) {
        setCrawlLog(prev => [...prev.slice(0, -1), `✗ ${sup.name} — ${err.message}`]);
      }
      await new Promise(r => setTimeout(r, 500));
    }

    setCompetitorData(allComp);
    setSupplierDataList(allSup);
    setCrawling(false);
    toast.success("Research complete");

    // Auto-run gap analysis
    runGapAnalysis(allComp, allSup);
    setStep(2);
  }, [competitors, suppliers]);

  const runGapAnalysis = (compData: CompetitorData[], supData: SupplierData[]) => {
    let ownProducts: any[] = [];
    try {
      if (catalogSource === "invoice") {
        ownProducts = JSON.parse(localStorage.getItem("invoice_lines") || "[]");
      } else {
        ownProducts = JSON.parse(localStorage.getItem("catalog_products") || "[]");
      }
    } catch { /* empty */ }

    const existingHandles = new Set<string>();
    try {
      const seo = JSON.parse(localStorage.getItem("seo_generated_collections") || "[]");
      seo.forEach((c: any) => existingHandles.add(c.handle));
    } catch { /* empty */ }

    const detectedGaps: Gap[] = [];

    // From competitors
    compData.forEach(comp => {
      (comp.collections || []).forEach(coll => {
        const handle = toHandle(coll.title);
        if (existingHandles.has(handle)) return;

        const typeWeights: Record<string, number> = {
          speciality: 30, product_type: 25, brand: 20, age_split: 15, seasonal: 10, other: 5,
        };
        let priority = typeWeights[coll.categoryType] || 5;
        if (coll.hasDescription) priority += 20;
        const matchCount = ownProducts.filter(p =>
          (p.type || p.product_type || "").toLowerCase().includes(coll.title.toLowerCase().split(" ")[0])
        ).length;
        priority += matchCount * 3;

        detectedGaps.push({
          title: coll.title, handle, source: comp.competitorName,
          categoryType: coll.categoryType, priority, productCount: matchCount,
          competitorDescription: coll.descriptionPreview || undefined,
          selected: priority >= 50,
        });
      });
    });

    // From supplier prints
    supData.forEach(brand => {
      (brand.prints || []).forEach(print => {
        if (!print.name) return;
        const handle = toHandle(`${brand.brandName} ${print.name}`);
        if (existingHandles.has(handle)) return;
        const matchCount = ownProducts.filter(p =>
          (p.vendor || p.brand || "").toLowerCase() === brand.brandName.toLowerCase() &&
          (p.title || "").toLowerCase().includes(print.name.toLowerCase())
        ).length;
        if (matchCount === 0 && ownProducts.length > 0) return;

        detectedGaps.push({
          title: `${brand.brandName} ${print.name}`,
          handle, source: `${brand.brandName} brand site`,
          categoryType: "brand_print", priority: 20 + matchCount * 5,
          productCount: matchCount, printStory: print.story,
          printMood: print.mood, vendor: brand.brandName,
          selected: false,
        });
      });
    });

    // Deduplicate by handle
    const seen = new Set<string>();
    const unique = detectedGaps.filter(g => {
      if (seen.has(g.handle)) return false;
      seen.add(g.handle);
      return true;
    });

    setGaps(unique.sort((a, b) => b.priority - a.priority));
  };

  const generateDescriptions = useCallback(async () => {
    const selected = gaps.filter(g => g.selected && !g.generated);
    if (selected.length === 0) { toast.error("No collections selected"); return; }

    setGenerating(true);
    setGeneratedCount(0);
    const storeName = localStorage.getItem("store_name") || "Splash Swimwear";
    const storeCity = localStorage.getItem("store_city") || "Darwin";
    const storeUrl = localStorage.getItem("store_website") || "";

    for (let i = 0; i < selected.length; i++) {
      const gap = selected[i];
      try {
        const compExamples = competitorData.flatMap(c => c.collections || [])
          .filter(c => c.hasDescription && c.title.toLowerCase().includes(gap.title.split(" ")[0].toLowerCase()))
          .slice(0, 2).map(c => ({ from: c.metaTitle || "competitor", text: c.descriptionPreview }));

        const tips = supplierDataList.flatMap(s => s.stylingTips || [])
          .filter(t => gap.title.toLowerCase().split(" ").some(w => t.productType.toLowerCase().includes(w)))
          .slice(0, 3);

        const faqItems = supplierDataList.flatMap(s => s.faqs || [])
          .filter(f => gap.title.toLowerCase().split(" ").some(w => f.question.toLowerCase().includes(w)) || f.category === "sizing")
          .slice(0, 3);

        const result = await callIntel("generate_description", {
          collection: gap, competitorExamples: compExamples,
          stylingTips: tips, faqs: faqItems,
          printStory: gap.printStory, relatedLinks: [],
          storeName, storeCity, storeUrl,
        });

        setGaps(prev => prev.map(g => g.handle === gap.handle ? { ...g, generated: result } : g));
        setGeneratedCount(i + 1);
      } catch (err: any) {
        toast.error(`Failed: ${gap.title} — ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 700));
    }

    setGenerating(false);
    toast.success("Descriptions generated");
    setStep(3);
  }, [gaps, competitorData, supplierDataList]);

  const toggleGap = (handle: string) => {
    setGaps(prev => prev.map(g => g.handle === handle ? { ...g, selected: !g.selected } : g));
  };

  const exportApproved = () => {
    const approved = gaps.filter(g => g.generated);
    if (approved.length === 0) { toast.error("No descriptions to export"); return; }

    // Save to collection SEO storage
    try {
      const existing = JSON.parse(localStorage.getItem("seo_generated_collections") || "[]");
      approved.forEach(g => {
        existing.push({
          handle: g.handle, title: g.title,
          description: g.generated.description,
          seoTitle: g.generated.seoTitle,
          seoDescription: g.generated.seoDescription,
          generatedAt: new Date().toISOString(),
          source: "competitor_intel",
        });
      });
      localStorage.setItem("seo_generated_collections", JSON.stringify(existing));
    } catch { /* ignore */ }

    // History entry
    try {
      const hist = JSON.parse(localStorage.getItem("export_history") || "[]");
      const sources = [...new Set(gaps.filter(g => g.generated).map(g => g.source))].slice(0, 3).join(", ");
      hist.unshift({
        type: "intel", label: `${approved.length} descriptions written — ${sources}`,
        date: new Date().toISOString(),
      });
      localStorage.setItem("export_history", JSON.stringify(hist.slice(0, 50)));
    } catch { /* ignore */ }

    toast.success(`${approved.length} descriptions saved to collection export queue`);
  };

  const filteredGaps = gapFilter === "all" ? gaps :
    gapFilter === "high" ? gaps.filter(g => g.priority >= 50) :
    gapFilter === "speciality" ? gaps.filter(g => g.categoryType === "speciality") :
    gapFilter === "print" ? gaps.filter(g => g.categoryType === "brand_print") :
    gapFilter === "product_type" ? gaps.filter(g => g.categoryType === "product_type") :
    gaps;

  const highCount = gaps.filter(g => g.priority >= 50).length;
  const medCount = gaps.filter(g => g.priority >= 25 && g.priority < 50).length;
  const selectedCount = gaps.filter(g => g.selected).length;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-32">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground mb-4 hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <h1 className="text-2xl font-bold mb-1">🔎 Competitor Intel</h1>
      <p className="text-muted-foreground text-sm mb-6">Spy on competitors and suppliers. Find collection gaps. Generate descriptions that outrank them.</p>

      {/* Progress */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-1.5">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
              i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
            }`}>{i + 1}</div>
            <span className={`text-[11px] ${i === step ? "text-foreground font-medium" : "text-muted-foreground"}`}>{s}</span>
            {i < STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* STEP 1 — Sources */}
      {step === 0 && (
        <div className="space-y-5">
          {/* Competitors */}
          <Card>
            <CardContent className="pt-5 space-y-3">
              <h2 className="font-semibold text-sm">Competitor Stores</h2>
              {competitors.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Checkbox checked={c.enabled} onCheckedChange={v => setCompetitors(prev => prev.map((x, j) => j === i ? { ...x, enabled: !!v } : x))} />
                  <Input value={c.name} onChange={e => setCompetitors(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="Name" className="h-8 text-xs flex-1" />
                  <Input value={c.url} onChange={e => setCompetitors(prev => prev.map((x, j) => j === i ? { ...x, url: e.target.value } : x))} placeholder="URL" className="h-8 text-xs flex-1" />
                  <button onClick={() => setCompetitors(prev => prev.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive"><X className="w-3.5 h-3.5" /></button>
                </div>
              ))}
              <Button size="sm" variant="ghost" onClick={addCompetitor}><Plus className="w-3 h-3 mr-1" /> Add competitor</Button>
            </CardContent>
          </Card>

          {/* Suppliers */}
          <Card>
            <CardContent className="pt-5 space-y-3">
              <h2 className="font-semibold text-sm">Supplier Brands</h2>
              <p className="text-xs text-muted-foreground">Auto-loaded from your brand directory</p>
              {suppliers.map((s, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Checkbox checked={s.enabled} onCheckedChange={v => setSuppliers(prev => prev.map((x, j) => j === i ? { ...x, enabled: !!v } : x))} />
                    <span className="text-xs font-medium flex-1">{s.name || "New brand"}</span>
                    <Input value={s.url} onChange={e => setSuppliers(prev => prev.map((x, j) => j === i ? { ...x, url: e.target.value } : x))} placeholder="URL" className="h-7 text-[11px] w-48" />
                    <button onClick={() => setSuppliers(prev => prev.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive"><X className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              ))}
              <Button size="sm" variant="ghost" onClick={addSupplier}><Plus className="w-3 h-3 mr-1" /> Add brand</Button>
            </CardContent>
          </Card>

          {/* Catalog source */}
          <Card>
            <CardContent className="pt-5 space-y-2">
              <h2 className="font-semibold text-sm">Your catalog (for comparison)</h2>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="radio" checked={catalogSource === "invoice"} onChange={() => setCatalogSource("invoice")} className="accent-primary" />
                Current invoice products
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="radio" checked={catalogSource === "catalog"} onChange={() => setCatalogSource("catalog")} className="accent-primary" />
                Catalog memory
              </label>
            </CardContent>
          </Card>

          <Button onClick={() => { setStep(1); startCrawl(); }} className="w-full h-12 text-base">
            Start research <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}

      {/* STEP 2 — Crawl */}
      {step === 1 && (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-5">
              <h2 className="font-semibold text-sm mb-3">
                {crawling ? "Gathering intelligence..." : "Research complete"}
              </h2>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {crawlLog.map((log, i) => (
                  <div key={i} className={`text-xs font-mono px-2 py-1 rounded ${
                    log.startsWith("✓") ? "text-primary bg-primary/5" :
                    log.startsWith("✗") ? "text-destructive bg-destructive/5" :
                    "text-muted-foreground bg-muted/50"
                  }`}>{log}</div>
                ))}
                {crawling && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground px-2 py-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Processing...
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {!crawling && (
            <Button onClick={() => setStep(2)} className="w-full">
              View gap analysis <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          )}
        </div>
      )}

      {/* STEP 3 — Gap Analysis */}
      {step === 2 && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-card border rounded-lg p-3 text-center">
              <div className="text-2xl font-bold">{gaps.length}</div>
              <div className="text-xs text-muted-foreground">Gaps found</div>
            </div>
            <div className="bg-card border rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-destructive">{highCount}</div>
              <div className="text-xs text-muted-foreground">High priority</div>
            </div>
            <div className="bg-card border rounded-lg p-3 text-center">
              <div className="text-2xl font-bold">{medCount}</div>
              <div className="text-xs text-muted-foreground">Medium</div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-1.5 flex-wrap">
            {[
              { val: "all", label: `All (${gaps.length})` },
              { val: "high", label: `High priority (${highCount})` },
              { val: "speciality", label: "Speciality" },
              { val: "print", label: "Print stories" },
              { val: "product_type", label: "Product types" },
            ].map(f => (
              <button key={f.val} onClick={() => setGapFilter(f.val)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                  gapFilter === f.val ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:text-foreground"
                }`}>{f.label}</button>
            ))}
          </div>

          {/* Gap list */}
          <div className="space-y-2">
            {filteredGaps.map(gap => (
              <Card key={gap.handle} className={gap.selected ? "border-primary/40" : ""}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-start gap-3">
                    <Checkbox checked={gap.selected} onCheckedChange={() => toggleGap(gap.handle)} className="mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{gap.title}</span>
                        <Badge variant={gap.priority >= 50 ? "destructive" : gap.priority >= 25 ? "secondary" : "outline"} className="text-[10px]">
                          {gap.priority >= 50 ? "High" : gap.priority >= 25 ? "Medium" : "Low"}
                        </Badge>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{gap.categoryType}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Source: {gap.source} · {gap.productCount > 0 ? `${gap.productCount} matching products` : "Check stock"}
                      </div>
                      {gap.competitorDescription && (
                        <p className="text-[11px] text-muted-foreground mt-1 italic line-clamp-2">"{gap.competitorDescription}"</p>
                      )}
                      {gap.printStory && (
                        <p className="text-[11px] text-primary/80 mt-1">🎨 Print story available</p>
                      )}
                      {gap.generated && (
                        <div className="mt-2 space-y-1">
                          <Badge variant="default" className="text-[10px]"><Check className="w-3 h-3 mr-0.5" /> Description generated</Badge>
                          <button onClick={() => setShowPreview(showPreview === gap.handle ? null : gap.handle)} className="text-[11px] text-primary hover:underline ml-2">
                            {showPreview === gap.handle ? "Hide" : "Preview"}
                          </button>
                          {showPreview === gap.handle && (
                            <div className="bg-muted/50 rounded p-3 mt-2 text-xs">
                              <div className="font-semibold text-[11px] mb-1">SEO Title: {gap.generated.seoTitle}</div>
                              <div className="text-muted-foreground text-[10px] mb-2">{gap.generated.seoDescription}</div>
                              <div className="prose prose-xs max-w-none" dangerouslySetInnerHTML={{ __html: gap.generated.description }} />
                              <div className="text-[10px] text-muted-foreground mt-2">
                                {gap.generated.wordCount} words · {gap.generated.stylingTipsUsed || 0} tips · {gap.generated.faqsIncluded || 0} FAQs
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {gaps.length === 0 && (
            <div className="text-center text-muted-foreground text-sm py-8">
              No gaps detected. Try crawling more competitors or loading more products.
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={generateDescriptions} disabled={generating || selectedCount === 0} className="flex-1 h-11">
              {generating ? (
                <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Generating {generatedCount}/{selectedCount}...</>
              ) : (
                <>Generate {selectedCount} descriptions <ChevronRight className="w-4 h-4 ml-1" /></>
              )}
            </Button>
          </div>

          <Button variant="ghost" onClick={() => setStep(0)} className="w-full">← Back to sources</Button>
        </div>
      )}

      {/* STEP 4 — Generated descriptions */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-card border rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-primary">{gaps.filter(g => g.generated).length}</div>
              <div className="text-xs text-muted-foreground">Generated</div>
            </div>
            <div className="bg-card border rounded-lg p-3 text-center">
              <div className="text-2xl font-bold">{gaps.filter(g => g.selected && !g.generated).length}</div>
              <div className="text-xs text-muted-foreground">Pending</div>
            </div>
          </div>

          {gaps.filter(g => g.generated).map(gap => (
            <Card key={gap.handle}>
              <CardContent className="py-4 px-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{gap.title}</h3>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={gap.priority >= 50 ? "destructive" : "secondary"} className="text-[10px]">
                      {gap.priority >= 50 ? "High" : "Medium"}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">{gap.categoryType}</Badge>
                  </div>
                </div>

                <div className="text-[11px] text-muted-foreground">
                  Source: {gap.source} · {gap.generated.wordCount} words · {gap.generated.stylingTipsUsed || 0} tips · {gap.generated.faqsIncluded || 0} FAQs · {gap.generated.internalLinksUsed?.length || 0} links
                </div>

                <div className="bg-muted/40 rounded p-3">
                  <div className="text-xs font-semibold mb-1">{gap.generated.seoTitle}</div>
                  <div className="text-[11px] text-muted-foreground mb-2">{gap.generated.seoDescription}</div>
                  <div className="prose prose-xs max-w-none text-xs" dangerouslySetInnerHTML={{ __html: gap.generated.description }} />
                </div>

                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => {
                    navigator.clipboard.writeText(gap.generated.description);
                    toast.success("HTML copied");
                  }}><Copy className="w-3 h-3 mr-1" /> Copy HTML</Button>
                  <Button size="sm" variant="ghost" onClick={() => {
                    setGaps(prev => prev.map(g => g.handle === gap.handle ? { ...g, generated: undefined, selected: true } : g));
                    setStep(2);
                    toast("Removed — regenerate when ready");
                  }}><RefreshCw className="w-3 h-3 mr-1" /> Regenerate</Button>
                </div>
              </CardContent>
            </Card>
          ))}

          <Button onClick={exportApproved} className="w-full h-12 text-base">
            <Download className="w-4 h-4 mr-2" /> Add all to collection export queue
          </Button>

          <Button variant="ghost" onClick={() => setStep(2)} className="w-full">← Back to gap analysis</Button>
        </div>
      )}
    </div>
  );
};

export default CompetitorIntelFlow;
