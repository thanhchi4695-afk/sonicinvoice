import { useState, useEffect, useMemo } from "react";
import { ChevronLeft, Image, Sparkles, AlertTriangle, CheckCircle2, XCircle, Search, RefreshCw, Download, Edit3, Eye, FileText, Zap, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ProductImage {
  id: string;
  title: string;
  vendor: string;
  productType: string;
  colour: string;
  imageUrl: string;
  tags: string[];
  // AI-generated fields
  altText?: string;
  seoFilename?: string;
  keywords?: string[];
  qualityStatus?: "ok" | "missing" | "broken" | "low_quality" | "duplicate";
  qualityIssue?: string;
  qualityRecommendation?: string;
  approved?: boolean;
  edited?: boolean;
}

interface Props {
  onBack: () => void;
}

export default function ImageOptimisePanel({ onBack }: Props) {
  const [products, setProducts] = useState<ProductImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState("dashboard");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAltText, setEditAltText] = useState("");

  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }

      const { data: prods } = await supabase
        .from("products")
        .select("id, title, vendor, product_type, image_url")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(500);

      if (prods) {
        setProducts(prods.map(p => ({
          id: p.id,
          title: p.title || "",
          vendor: p.vendor || "",
          productType: p.product_type || "",
          colour: "",
          imageUrl: p.image_url || "",
          tags: [],
          qualityStatus: p.image_url ? undefined : "missing",
        })));
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  // ── Stats ──
  const stats = useMemo(() => {
    const total = products.length;
    const missingAlt = products.filter(p => !p.altText).length;
    const missingImage = products.filter(p => !p.imageUrl).length;
    const issues = products.filter(p => p.qualityStatus && p.qualityStatus !== "ok").length;
    const optimized = products.filter(p => p.altText && p.approved).length;
    return { total, missingAlt, missingImage, issues, optimized };
  }, [products]);

  const filtered = useMemo(() => {
    if (!search) return products;
    const q = search.toLowerCase();
    return products.filter(p =>
      p.title.toLowerCase().includes(q) || p.vendor.toLowerCase().includes(q)
    );
  }, [products, search]);

  // ── Generate Alt Text ──
  const generateAltText = async (subset?: ProductImage[]) => {
    const targets = subset || products.filter(p => !p.altText);
    if (targets.length === 0) { toast.info("All products already have alt text"); return; }

    setGenerating(true);
    try {
      const batches = [];
      for (let i = 0; i < targets.length; i += 25) {
        batches.push(targets.slice(i, i + 25));
      }

      let processed = 0;
      for (const batch of batches) {
        const { data, error } = await supabase.functions.invoke("image-optimise", {
          body: {
            action: "generate_alt_text",
            products: batch.map(p => ({
              title: p.title,
              vendor: p.vendor,
              colour: p.colour,
              productType: p.productType,
              tags: p.tags,
            })),
          },
        });

        if (error) throw error;

        if (data?.results) {
          setProducts(prev => {
            const updated = [...prev];
            batch.forEach((bp, idx) => {
              const match = updated.find(u => u.id === bp.id);
              if (match && data.results[idx]) {
                match.altText = data.results[idx].alt_text;
                match.seoFilename = data.results[idx].seo_filename;
                match.keywords = data.results[idx].keywords;
              }
            });
            return updated;
          });
          processed += batch.length;
        }
      }
      toast.success(`Generated alt text for ${processed} products`);
    } catch (e: any) {
      toast.error(e.message || "Failed to generate alt text");
    }
    setGenerating(false);
  };

  // ── Analyse Quality ──
  const analyseQuality = async () => {
    setAnalysing(true);
    try {
      const batches = [];
      for (let i = 0; i < products.length; i += 30) {
        batches.push(products.slice(i, i + 30));
      }

      for (const batch of batches) {
        const { data, error } = await supabase.functions.invoke("image-optimise", {
          body: {
            action: "analyse_quality",
            products: batch.map(p => ({ title: p.title, imageUrl: p.imageUrl })),
          },
        });

        if (error) throw error;
        if (data?.results) {
          setProducts(prev => {
            const updated = [...prev];
            batch.forEach((bp, idx) => {
              const match = updated.find(u => u.id === bp.id);
              const r = data.results.find((rr: any) => rr.index === idx);
              if (match && r) {
                match.qualityStatus = r.status;
                match.qualityIssue = r.issue;
                match.qualityRecommendation = r.recommendation;
              }
            });
            return updated;
          });
        }
      }
      toast.success("Image quality analysis complete");
    } catch (e: any) {
      toast.error(e.message || "Analysis failed");
    }
    setAnalysing(false);
  };

  // ── Approve / Edit ──
  const approveAll = () => {
    setProducts(prev => prev.map(p => p.altText ? { ...p, approved: true } : p));
    toast.success("All products with alt text approved");
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(p => p.id)));
    }
  };

  const generateSelected = () => {
    const sel = products.filter(p => selectedIds.has(p.id));
    if (sel.length === 0) { toast.info("Select products first"); return; }
    generateAltText(sel);
  };

  const startEdit = (p: ProductImage) => {
    setEditingId(p.id);
    setEditAltText(p.altText || "");
  };

  const saveEdit = () => {
    if (!editingId) return;
    setProducts(prev => prev.map(p => p.id === editingId ? { ...p, altText: editAltText, edited: true } : p));
    setEditingId(null);
    toast.success("Alt text updated");
  };

  const statusIcon = (s?: string) => {
    switch (s) {
      case "ok": return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "missing": return <XCircle className="w-4 h-4 text-destructive" />;
      case "broken": return <AlertTriangle className="w-4 h-4 text-destructive" />;
      case "low_quality": return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case "duplicate": return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      default: return <span className="w-4 h-4 rounded-full bg-muted inline-block" />;
    }
  };

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack}><ChevronLeft className="w-4 h-4 mr-1" />Back</Button>
        <div className="text-center py-12 text-muted-foreground">Loading products…</div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}><ChevronLeft className="w-4 h-4 mr-1" />Back</Button>
        <h1 className="text-lg font-bold flex items-center gap-2"><Image className="w-5 h-5 text-primary" />Image Optimisation AI</h1>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full grid grid-cols-4">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="alt_text">Alt Text</TabsTrigger>
          <TabsTrigger value="quality">Quality</TabsTrigger>
          <TabsTrigger value="review">Review</TabsTrigger>
        </TabsList>

        {/* ── Dashboard Tab ── */}
        <TabsContent value="dashboard" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-foreground">{stats.total}</div>
                <div className="text-xs text-muted-foreground">Total Products</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-yellow-500">{stats.missingAlt}</div>
                <div className="text-xs text-muted-foreground">Missing Alt Text</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-destructive">{stats.missingImage}</div>
                <div className="text-xs text-muted-foreground">Missing Images</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-green-500">{stats.optimized}</div>
                <div className="text-xs text-muted-foreground">Optimised</div>
              </CardContent>
            </Card>
          </div>

          {stats.total > 0 && (
            <Card>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Optimisation Progress</span>
                  <span className="font-medium">{Math.round((stats.optimized / stats.total) * 100)}%</span>
                </div>
                <Progress value={(stats.optimized / stats.total) * 100} className="h-2" />
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Button onClick={() => generateAltText()} disabled={generating} className="gap-2">
              <Sparkles className="w-4 h-4" />{generating ? "Generating…" : "Auto-Generate All Alt Text"}
            </Button>
            <Button variant="outline" onClick={analyseQuality} disabled={analysing} className="gap-2">
              <Eye className="w-4 h-4" />{analysing ? "Analysing…" : "Analyse Image Quality"}
            </Button>
            <Button variant="outline" onClick={approveAll} className="gap-2">
              <CheckCircle2 className="w-4 h-4" />Approve All
            </Button>
          </div>

          {stats.issues > 0 && (
            <Card className="border-yellow-500/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-yellow-500" />{stats.issues} Image Issues Found
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Run quality analysis to see broken, missing, or low-quality images. Switch to the Quality tab for details.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Alt Text Tab ── */}
        <TabsContent value="alt_text" className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search products…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8" />
            </div>
            <Button size="sm" onClick={generateSelected} disabled={generating || selectedIds.size === 0} className="gap-1">
              <Sparkles className="w-3 h-3" />Generate Selected ({selectedIds.size})
            </Button>
            <Button size="sm" variant="outline" onClick={selectAll}>
              {selectedIds.size === filtered.length ? "Deselect All" : "Select All"}
            </Button>
          </div>

          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {filtered.map(p => (
              <Card key={p.id} className={`${p.approved ? "border-green-500/30" : ""}`}>
                <CardContent className="p-3 flex gap-3 items-start">
                  <Checkbox
                    checked={selectedIds.has(p.id)}
                    onCheckedChange={() => toggleSelect(p.id)}
                    className="mt-1"
                  />
                  <div className="w-12 h-12 rounded bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                      <Image className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="font-medium text-sm truncate">{p.title}</div>
                    <div className="text-xs text-muted-foreground">{p.vendor} {p.productType && `· ${p.productType}`}</div>
                    {editingId === p.id ? (
                      <div className="space-y-1">
                        <Textarea value={editAltText} onChange={e => setEditAltText(e.target.value)} rows={2} className="text-xs" />
                        <div className="flex gap-1">
                          <Button size="sm" onClick={saveEdit} className="h-6 text-xs">Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} className="h-6 text-xs">Cancel</Button>
                        </div>
                      </div>
                    ) : p.altText ? (
                      <div className="flex items-start gap-1">
                        <p className="text-xs text-foreground/80 italic flex-1">"{p.altText}"</p>
                        <Button size="sm" variant="ghost" onClick={() => startEdit(p)} className="h-5 w-5 p-0">
                          <Edit3 className="w-3 h-3" />
                        </Button>
                      </div>
                    ) : (
                      <Badge variant="outline" className="text-xs text-yellow-600">No alt text</Badge>
                    )}
                    {p.seoFilename && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <FileText className="w-3 h-3" />{p.seoFilename}
                      </div>
                    )}
                    {p.keywords && p.keywords.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {p.keywords.map((k, i) => (
                          <Badge key={i} variant="secondary" className="text-[10px] h-4">{k}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  {p.approved && <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />}
                </CardContent>
              </Card>
            ))}
            {filtered.length === 0 && (
              <div className="text-center py-8 text-muted-foreground text-sm">
                {products.length === 0 ? "No products found. Import products first." : "No matching products."}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Quality Tab ── */}
        <TabsContent value="quality" className="space-y-3">
          <div className="flex gap-2">
            <Button onClick={analyseQuality} disabled={analysing} className="gap-2">
              <RefreshCw className={`w-4 h-4 ${analysing ? "animate-spin" : ""}`} />
              {analysing ? "Analysing…" : "Run Quality Analysis"}
            </Button>
          </div>

          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {products
              .filter(p => p.qualityStatus && p.qualityStatus !== "ok")
              .map(p => (
                <Card key={p.id} className="border-yellow-500/30">
                  <CardContent className="p-3 flex gap-3 items-center">
                    {statusIcon(p.qualityStatus)}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{p.title}</div>
                      <div className="text-xs text-muted-foreground">{p.vendor}</div>
                      {p.qualityIssue && <div className="text-xs text-yellow-600 mt-0.5">{p.qualityIssue}</div>}
                      {p.qualityRecommendation && <div className="text-xs text-muted-foreground">{p.qualityRecommendation}</div>}
                    </div>
                    <Badge variant={p.qualityStatus === "missing" || p.qualityStatus === "broken" ? "destructive" : "outline"} className="text-xs">
                      {p.qualityStatus}
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            {products.filter(p => p.qualityStatus && p.qualityStatus !== "ok").length === 0 && (
              <div className="text-center py-8 text-muted-foreground text-sm">
                {products.some(p => p.qualityStatus) ? "All images look good! ✅" : "Run quality analysis to detect issues."}
              </div>
            )}
          </div>

          {products.some(p => p.qualityStatus) && (
            <Card>
              <CardContent className="p-4">
                <div className="text-sm font-medium mb-2">Summary</div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-center text-xs">
                  {(["ok", "missing", "broken", "low_quality", "duplicate"] as const).map(s => (
                    <div key={s} className="flex items-center gap-1 justify-center">
                      {statusIcon(s)}
                      <span>{products.filter(p => p.qualityStatus === s).length} {s.replace("_", " ")}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Review Tab ── */}
        <TabsContent value="review" className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" onClick={approveAll} className="gap-1">
              <CheckCircle2 className="w-3 h-3" />Approve All
            </Button>
            <Badge variant="outline">{products.filter(p => p.altText && !p.approved).length} pending review</Badge>
          </div>

          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {products
              .filter(p => p.altText && !p.approved)
              .map(p => (
                <Card key={p.id}>
                  <CardContent className="p-3 flex gap-3 items-start">
                    <div className="w-16 h-16 rounded bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Image className="w-6 h-6 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="font-medium text-sm">{p.title}</div>
                      <div className="text-xs text-muted-foreground">Alt: "{p.altText}"</div>
                      {p.seoFilename && <div className="text-xs text-muted-foreground">File: {p.seoFilename}</div>}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <Button size="sm" variant="ghost" onClick={() => startEdit(p)} className="h-7 w-7 p-0">
                        <Edit3 className="w-3 h-3" />
                      </Button>
                      <Button size="sm" onClick={() => {
                        setProducts(prev => prev.map(pp => pp.id === p.id ? { ...pp, approved: true } : pp));
                      }} className="h-7 text-xs">
                        Approve
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => {
                        setProducts(prev => prev.map(pp => pp.id === p.id ? { ...pp, altText: undefined, seoFilename: undefined, keywords: undefined } : pp));
                      }} className="h-7 text-xs">
                        Skip
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            {products.filter(p => p.altText && !p.approved).length === 0 && (
              <div className="text-center py-8 text-muted-foreground text-sm">
                {products.some(p => p.approved) ? "All done! All alt text has been approved. ✅" : "Generate alt text first, then review here."}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
