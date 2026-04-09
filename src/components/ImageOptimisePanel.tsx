import { useState, useEffect, useMemo } from "react";
import { ChevronLeft, Image, Sparkles, AlertTriangle, CheckCircle2, XCircle, Search, RefreshCw, Edit3, Eye, FileText, Copy, ShieldCheck, Link2, Upload, Minimize2, HardDrive, Target, Layers, ZoomIn, Smartphone, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { compressImageFromUrl, formatBytes } from "@/lib/image-compress";

interface ProductImage {
  id: string;
  title: string;
  vendor: string;
  productType: string;
  colour: string;
  description: string;
  imageUrl: string;
  tags: string[];
  shopifyProductId?: string | null;
  altText?: string;
  seoFilename?: string;
  keywords?: string[];
  searchIntent?: string;
  caption?: string;
  qualityStatus?: "ok" | "missing" | "broken" | "low_quality" | "duplicate" | "mismatch";
  qualityIssue?: string;
  qualityRecommendation?: string;
  mismatchConfidence?: number;
  matchStatus?: "likely" | "uncertain" | "mismatch";
  matchReason?: string;
  approved?: boolean;
  edited?: boolean;
  synced?: boolean;
  // Compression fields
  originalSize?: number;
  compressedSize?: number;
  compressedUrl?: string;
  compressed?: boolean;
  needsCompression?: boolean;
  compressionReason?: string;
  // Conversion audit fields
  conversionScore?: number;
  consistency?: number;
  consistencyNote?: string;
  variantMapping?: number;
  variantNote?: string;
  zoomReadiness?: number;
  zoomNote?: string;
  mobileOptimization?: number;
  mobileNote?: string;
  heroScore?: number;
  heroNote?: string;
  topIssue?: string;
  conversionRecommendation?: string;
}

interface Props { onBack: () => void; }

export default function ImageOptimisePanel({ onBack }: Props) {
  const [products, setProducts] = useState<ProductImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [validating, setValidating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [analysingSize, setAnalysingSize] = useState(false);
  const [auditingConversion, setAuditingConversion] = useState(false);
  const [compressionProgress, setCompressionProgress] = useState({ current: 0, total: 0 });
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState("dashboard");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAltText, setEditAltText] = useState("");
  const [filterTab, setFilterTab] = useState<"all" | "missing_alt" | "missing_img" | "issues" | "duplicates" | "mismatches">("all");

  useEffect(() => { loadProducts(); }, []);

  const loadProducts = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }
      const { data: prods } = await supabase
        .from("products")
        .select("id, title, vendor, product_type, image_url, description, shopify_product_id")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(500);
      if (prods) {
        setProducts(prods.map(p => ({
          id: p.id, title: p.title || "", vendor: p.vendor || "",
          productType: p.product_type || "", colour: "", description: p.description || "",
          imageUrl: p.image_url || "", tags: [],
          shopifyProductId: p.shopify_product_id,
          qualityStatus: p.image_url ? undefined : "missing",
        })));
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const stats = useMemo(() => {
    const total = products.length;
    const missingAlt = products.filter(p => !p.altText).length;
    const missingImage = products.filter(p => !p.imageUrl).length;
    const issues = products.filter(p => p.qualityStatus && !["ok", undefined].includes(p.qualityStatus as any)).length;
    const duplicates = products.filter(p => p.qualityStatus === "duplicate").length;
    const mismatches = products.filter(p => p.qualityStatus === "mismatch" || p.matchStatus === "mismatch").length;
    const optimized = products.filter(p => p.altText && p.approved).length;
    const needsCompression = products.filter(p => p.needsCompression).length;
    const compressed = products.filter(p => p.compressed).length;
    const totalOriginalSize = products.reduce((s, p) => s + (p.originalSize || 0), 0);
    const totalCompressedSize = products.reduce((s, p) => s + (p.compressedSize || p.originalSize || 0), 0);
    const totalSaved = totalOriginalSize - totalCompressedSize;
    return { total, missingAlt, missingImage, issues, duplicates, mismatches, optimized, needsCompression, compressed, totalOriginalSize, totalSaved };
  }, [products]);

  const filtered = useMemo(() => {
    let list = products;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p => p.title.toLowerCase().includes(q) || p.vendor.toLowerCase().includes(q));
    }
    switch (filterTab) {
      case "missing_alt": return list.filter(p => !p.altText);
      case "missing_img": return list.filter(p => !p.imageUrl);
      case "issues": return list.filter(p => p.qualityStatus && !["ok"].includes(p.qualityStatus));
      case "duplicates": return list.filter(p => p.qualityStatus === "duplicate");
      case "mismatches": return list.filter(p => p.qualityStatus === "mismatch" || p.matchStatus === "mismatch");
      default: return list;
    }
  }, [products, search, filterTab]);

  // ── Generate Alt Text ──
  const generateAltText = async (subset?: ProductImage[]) => {
    const targets = subset || products.filter(p => !p.altText);
    if (targets.length === 0) { toast.info("All products already have alt text"); return; }
    setGenerating(true);
    try {
      let processed = 0;
      for (let i = 0; i < targets.length; i += 25) {
        const batch = targets.slice(i, i + 25);
        const { data, error } = await supabase.functions.invoke("image-optimise", {
          body: {
            action: "generate_alt_text",
            products: batch.map(p => ({
              title: p.title, vendor: p.vendor, colour: p.colour,
              productType: p.productType, tags: p.tags, description: p.description,
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
                match.searchIntent = data.results[idx].search_intent;
                match.caption = data.results[idx].caption;
              }
            });
            return updated;
          });
          processed += batch.length;
        }
      }
      toast.success(`Generated SEO alt text for ${processed} products`);
    } catch (e: any) { toast.error(e.message || "Failed to generate alt text"); }
    setGenerating(false);
  };

  // ── Analyse Quality ──
  const analyseQuality = async () => {
    setAnalysing(true);
    try {
      for (let i = 0; i < products.length; i += 30) {
        const batch = products.slice(i, i + 30);
        const { data, error } = await supabase.functions.invoke("image-optimise", {
          body: {
            action: "analyse_quality",
            products: batch.map(p => ({ title: p.title, imageUrl: p.imageUrl, vendor: p.vendor, productType: p.productType, description: p.description })),
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
                match.mismatchConfidence = r.mismatch_confidence;
              }
            });
            return updated;
          });
        }
      }
      toast.success("Quality + duplicate + mismatch analysis complete");
    } catch (e: any) { toast.error(e.message || "Analysis failed"); }
    setAnalysing(false);
  };

  // ── Validate Matches ──
  const validateMatches = async () => {
    const withImages = products.filter(p => p.imageUrl);
    if (withImages.length === 0) { toast.info("No products with images to validate"); return; }
    setValidating(true);
    try {
      for (let i = 0; i < withImages.length; i += 20) {
        const batch = withImages.slice(i, i + 20);
        const { data, error } = await supabase.functions.invoke("image-optimise", {
          body: {
            action: "validate_match",
            products: batch.map(p => ({ title: p.title, vendor: p.vendor, productType: p.productType, colour: p.colour, description: p.description, imageUrl: p.imageUrl })),
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
                match.matchStatus = r.match;
                match.matchReason = r.reason;
                if (r.match === "mismatch") match.qualityStatus = "mismatch";
              }
            });
            return updated;
          });
        }
      }
      toast.success("Image-to-product validation complete");
    } catch (e: any) { toast.error(e.message || "Validation failed"); }
    setValidating(false);
  };

  // ── Push to Shopify ──
  const pushToShopify = async () => {
    const approved = products.filter(p => p.approved && p.altText && p.shopifyProductId && !p.synced);
    if (approved.length === 0) { toast.info("No approved products with Shopify links to sync"); return; }
    setSyncing(true);
    try {
      let synced = 0;
      for (let i = 0; i < approved.length; i += 10) {
        const batch = approved.slice(i, i + 10);
        const { data, error } = await supabase.functions.invoke("shopify-proxy", {
          body: {
            action: "update_image_alt",
            image_updates: batch.map(p => ({
              shopify_product_id: p.shopifyProductId,
              alt_text: p.altText,
              seo_filename: p.seoFilename,
              keywords: p.keywords,
            })),
          },
        });
        if (error) throw error;
        if (data?.results) {
          const successIds = new Set(
            data.results.filter((r: any) => r.status === "success").map((r: any) => r.shopify_product_id)
          );
          setProducts(prev => prev.map(p => {
            if (p.shopifyProductId && successIds.has(p.shopifyProductId)) {
              return { ...p, synced: true };
            }
            return p;
          }));
          synced += successIds.size;
          const errors = data.results.filter((r: any) => r.status === "error");
          if (errors.length > 0) {
            console.warn("Shopify sync errors:", errors);
          }
        }
      }
      toast.success(`Pushed alt text to ${synced} Shopify products`);
    } catch (e: any) { toast.error(e.message || "Shopify sync failed"); }
    setSyncing(false);
  };

  const approveAll = () => {
    setProducts(prev => prev.map(p => p.altText ? { ...p, approved: true } : p));
    toast.success("All products with alt text approved");
  };

  // ── Analyse Image Sizes ──
  const analyseSizes = async () => {
    const withImages = products.filter(p => p.imageUrl);
    if (withImages.length === 0) { toast.info("No products with images"); return; }
    setAnalysingSize(true);
    try {
      for (let i = 0; i < withImages.length; i += 50) {
        const batch = withImages.slice(i, i + 50);
        const { data, error } = await supabase.functions.invoke("image-compress", {
          body: {
            action: "analyse_sizes",
            images: batch.map(p => ({ product_id: p.id, image_url: p.imageUrl })),
          },
        });
        if (error) throw error;
        if (data?.results) {
          setProducts(prev => {
            const updated = [...prev];
            for (const r of data.results) {
              const match = updated.find(u => u.id === r.product_id);
              if (match) {
                match.originalSize = r.original_size;
                match.needsCompression = r.needs_compression;
                match.compressionReason = r.reason;
              }
            }
            return updated;
          });
        }
      }
      toast.success("Image size analysis complete");
    } catch (e: any) { toast.error(e.message || "Size analysis failed"); }
    setAnalysingSize(false);
  };

  // ── Compress Images ──
  const compressImages = async (subset?: ProductImage[]) => {
    const targets = (subset || products).filter(p => p.imageUrl && !p.compressed && (p.needsCompression !== false));
    if (targets.length === 0) { toast.info("No images to compress"); return; }
    setCompressing(true);
    setCompressionProgress({ current: 0, total: targets.length });
    let compressed = 0;
    let totalSaved = 0;

    for (let i = 0; i < targets.length; i++) {
      setCompressionProgress({ current: i + 1, total: targets.length });
      try {
        // Client-side Canvas compression
        const result = await compressImageFromUrl(targets[i].imageUrl, {
          maxWidth: 2048,
          maxHeight: 2048,
          quality: 0.82,
          format: "image/jpeg",
        });

        // Upload compressed image to storage via edge function
        const { data, error } = await supabase.functions.invoke("image-compress", {
          body: {
            action: "upload_compressed",
            product_id: targets[i].id,
            base64: result.base64,
            content_type: "image/jpeg",
            original_size: result.originalSize,
          },
        });

        if (error) throw error;

        setProducts(prev => prev.map(p => p.id === targets[i].id ? {
          ...p,
          compressed: true,
          originalSize: result.originalSize,
          compressedSize: result.compressedSize,
          compressedUrl: data?.compressed_url,
        } : p));

        totalSaved += result.originalSize - result.compressedSize;
        compressed++;
      } catch (e) {
        console.warn(`Failed to compress ${targets[i].title}:`, e);
      }
    }

    toast.success(`Compressed ${compressed} images (saved ${formatBytes(totalSaved)})`);
    setCompressing(false);
  };

  // ── Conversion Audit ──
  const runConversionAudit = async () => {
    const withImages = products.filter(p => p.imageUrl);
    if (withImages.length === 0) { toast.info("No products with images to audit"); return; }
    setAuditingConversion(true);
    try {
      for (let i = 0; i < withImages.length; i += 25) {
        const batch = withImages.slice(i, i + 25);
        const { data, error } = await supabase.functions.invoke("image-optimise", {
          body: {
            action: "conversion_audit",
            products: batch.map(p => ({
              title: p.title, vendor: p.vendor, colour: p.colour,
              productType: p.productType, imageUrl: p.imageUrl,
              variantCount: 0, hasMultipleImages: false, imageDimensions: "",
            })),
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
                match.conversionScore = r.overall_score;
                match.consistency = r.consistency;
                match.consistencyNote = r.consistency_note;
                match.variantMapping = r.variant_mapping;
                match.variantNote = r.variant_note;
                match.zoomReadiness = r.zoom_readiness;
                match.zoomNote = r.zoom_note;
                match.mobileOptimization = r.mobile_optimization;
                match.mobileNote = r.mobile_note;
                match.heroScore = r.hero_score;
                match.heroNote = r.hero_note;
                match.topIssue = r.top_issue;
                match.conversionRecommendation = r.recommendation;
              }
            });
            return updated;
          });
        }
      }
      toast.success("Conversion audit complete");
    } catch (e: any) { toast.error(e.message || "Conversion audit failed"); }
    setAuditingConversion(false);
  };

  const conversionStats = useMemo(() => {
    const audited = products.filter(p => p.conversionScore != null);
    if (audited.length === 0) return null;
    const avg = (key: keyof ProductImage) => Math.round(audited.reduce((s, p) => s + ((p[key] as number) || 0), 0) / audited.length);
    return {
      count: audited.length,
      overall: avg("conversionScore"),
      consistency: avg("consistency"),
      variantMapping: avg("variantMapping"),
      zoomReadiness: avg("zoomReadiness"),
      mobileOptimization: avg("mobileOptimization"),
      heroScore: avg("heroScore"),
    };
  }, [products]);

  const scoreColor = (score: number) => score >= 80 ? "text-green-600" : score >= 50 ? "text-yellow-600" : "text-destructive";
  const scoreBg = (score: number) => score >= 80 ? "bg-green-500" : score >= 50 ? "bg-yellow-500" : "bg-destructive";

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const selectAll = () => {
    setSelectedIds(selectedIds.size === filtered.length ? new Set() : new Set(filtered.map(p => p.id)));
  };
  const generateSelected = () => {
    const sel = products.filter(p => selectedIds.has(p.id));
    if (sel.length === 0) { toast.info("Select products first"); return; }
    generateAltText(sel);
  };
  const startEdit = (p: ProductImage) => { setEditingId(p.id); setEditAltText(p.altText || ""); };
  const saveEdit = () => {
    if (!editingId) return;
    setProducts(prev => prev.map(p => p.id === editingId ? { ...p, altText: editAltText, edited: true } : p));
    setEditingId(null); toast.success("Alt text updated");
  };

  const statusIcon = (s?: string) => {
    switch (s) {
      case "ok": return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "missing": return <XCircle className="w-4 h-4 text-destructive" />;
      case "broken": return <AlertTriangle className="w-4 h-4 text-destructive" />;
      case "low_quality": return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case "duplicate": return <Copy className="w-4 h-4 text-yellow-500" />;
      case "mismatch": return <Link2 className="w-4 h-4 text-destructive" />;
      default: return <span className="w-4 h-4 rounded-full bg-muted inline-block" />;
    }
  };

  const matchBadge = (s?: string) => {
    switch (s) {
      case "likely": return <Badge variant="outline" className="text-[10px] border-green-500/50 text-green-600">✓ Match</Badge>;
      case "uncertain": return <Badge variant="outline" className="text-[10px] border-yellow-500/50 text-yellow-600">? Uncertain</Badge>;
      case "mismatch": return <Badge variant="destructive" className="text-[10px]">✗ Mismatch</Badge>;
      default: return null;
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
        <h1 className="text-lg font-bold flex items-center gap-2"><Image className="w-5 h-5 text-primary" />Image SEO Intelligence</h1>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full grid grid-cols-6">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="alt_text">Alt Text</TabsTrigger>
          <TabsTrigger value="compress">Compress</TabsTrigger>
          <TabsTrigger value="quality">Quality</TabsTrigger>
          <TabsTrigger value="validation">Validation</TabsTrigger>
          <TabsTrigger value="review">Review</TabsTrigger>
        </TabsList>

        {/* ── Dashboard ── */}
        <TabsContent value="dashboard" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Total Products", value: stats.total, color: "text-foreground" },
              { label: "Missing Alt Text", value: stats.missingAlt, color: "text-yellow-500" },
              { label: "Missing Images", value: stats.missingImage, color: "text-destructive" },
              { label: "Optimised", value: stats.optimized, color: "text-green-500" },
            ].map(s => (
              <Card key={s.label}>
                <CardContent className="p-4 text-center">
                  <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Duplicates", value: stats.duplicates, icon: Copy },
              { label: "Mismatches", value: stats.mismatches, icon: Link2 },
              { label: "Quality Issues", value: stats.issues, icon: AlertTriangle },
            ].map(s => (
              <Card key={s.label}>
                <CardContent className="p-3 flex items-center gap-2">
                  <s.icon className={`w-4 h-4 ${s.value > 0 ? "text-yellow-500" : "text-muted-foreground"}`} />
                  <div>
                    <div className="text-lg font-bold">{s.value}</div>
                    <div className="text-xs text-muted-foreground">{s.label}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {stats.total > 0 && (
            <Card>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>SEO Optimisation Progress</span>
                  <span className="font-medium">{Math.round((stats.optimized / stats.total) * 100)}%</span>
                </div>
                <Progress value={(stats.optimized / stats.total) * 100} className="h-2" />
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Button onClick={() => generateAltText()} disabled={generating} className="gap-2">
              <Sparkles className="w-4 h-4" />{generating ? "Generating…" : "Generate All Alt Text + Keywords"}
            </Button>
            <Button variant="outline" onClick={analyseQuality} disabled={analysing} className="gap-2">
              <Eye className="w-4 h-4" />{analysing ? "Analysing…" : "Analyse Quality + Duplicates"}
            </Button>
            <Button variant="outline" onClick={validateMatches} disabled={validating} className="gap-2">
              <ShieldCheck className="w-4 h-4" />{validating ? "Validating…" : "Validate Image Matches"}
            </Button>
            <Button variant="outline" onClick={approveAll} className="gap-2">
              <CheckCircle2 className="w-4 h-4" />Approve All
            </Button>
            <Button onClick={pushToShopify} disabled={syncing || products.filter(p => p.approved && p.shopifyProductId && !p.synced).length === 0} className="gap-2 col-span-full">
              <Upload className="w-4 h-4" />{syncing ? "Pushing to Shopify…" : `Push to Shopify (${products.filter(p => p.approved && p.shopifyProductId && !p.synced).length})`}
            </Button>
          </div>
        </TabsContent>

        {/* ── Alt Text ── */}
        <TabsContent value="alt_text" className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search products…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8" />
            </div>
            <Button size="sm" onClick={generateSelected} disabled={generating || selectedIds.size === 0} className="gap-1">
              <Sparkles className="w-3 h-3" />Generate ({selectedIds.size})
            </Button>
            <Button size="sm" variant="outline" onClick={selectAll}>
              {selectedIds.size === filtered.length ? "Deselect" : "Select All"}
            </Button>
          </div>

          <div className="flex gap-1 flex-wrap">
            {([["all", "All"], ["missing_alt", "Missing Alt"], ["missing_img", "No Image"]] as const).map(([k, l]) => (
              <Badge key={k} variant={filterTab === k ? "default" : "outline"} className="cursor-pointer text-xs" onClick={() => setFilterTab(k)}>{l}</Badge>
            ))}
          </div>

          <div className="space-y-2 max-h-[55vh] overflow-y-auto">
            {filtered.map(p => (
              <Card key={p.id} className={p.approved ? "border-green-500/30" : ""}>
                <CardContent className="p-3 flex gap-3 items-start">
                  <Checkbox checked={selectedIds.has(p.id)} onCheckedChange={() => toggleSelect(p.id)} className="mt-1" />
                  <div className="w-12 h-12 rounded bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                      <Image className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="font-medium text-sm truncate">{p.title}</div>
                    <div className="text-xs text-muted-foreground">{p.vendor}{p.productType && ` · ${p.productType}`}</div>
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
                        <Button size="sm" variant="ghost" onClick={() => startEdit(p)} className="h-5 w-5 p-0"><Edit3 className="w-3 h-3" /></Button>
                      </div>
                    ) : (
                      <Badge variant="outline" className="text-xs text-yellow-600">No alt text</Badge>
                    )}
                    {p.searchIntent && (
                      <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Search className="w-3 h-3" />Intent: "{p.searchIntent}"
                      </div>
                    )}
                    {p.caption && (
                      <div className="text-[10px] text-muted-foreground italic">💬 {p.caption}</div>
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
                  <div className="flex flex-col items-end gap-1">
                    {p.approved && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                    {matchBadge(p.matchStatus)}
                  </div>
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

        {/* ── Compress ── */}
        <TabsContent value="compress" className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Minimize2 className="w-4 h-4 text-primary" />Image Compression
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-3">
              <p>Compress product images for faster page loads and better Shopify performance. Images are resized to max 2048×2048 and re-encoded at optimal quality.</p>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" onClick={analyseSizes} disabled={analysingSize} className="gap-1">
                  <HardDrive className="w-3 h-3" />{analysingSize ? "Analysing…" : "Analyse File Sizes"}
                </Button>
                <Button size="sm" onClick={() => compressImages()} disabled={compressing} className="gap-1">
                  <Minimize2 className="w-3 h-3" />{compressing ? `Compressing ${compressionProgress.current}/${compressionProgress.total}…` : "Compress All"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Compression stats */}
          {(stats.compressed > 0 || stats.needsCompression > 0) && (
            <div className="grid grid-cols-3 gap-3">
              <Card>
                <CardContent className="p-3 text-center">
                  <div className="text-lg font-bold text-yellow-500">{stats.needsCompression}</div>
                  <div className="text-xs text-muted-foreground">Need Compression</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <div className="text-lg font-bold text-green-500">{stats.compressed}</div>
                  <div className="text-xs text-muted-foreground">Compressed</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <div className="text-lg font-bold text-primary">{formatBytes(stats.totalSaved)}</div>
                  <div className="text-xs text-muted-foreground">Total Saved</div>
                </CardContent>
              </Card>
            </div>
          )}

          {compressing && (
            <Card>
              <CardContent className="p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Compressing images…</span>
                  <span>{compressionProgress.current}/{compressionProgress.total}</span>
                </div>
                <Progress value={(compressionProgress.current / compressionProgress.total) * 100} className="h-2" />
              </CardContent>
            </Card>
          )}

          <div className="space-y-2 max-h-[45vh] overflow-y-auto">
            {products
              .filter(p => p.imageUrl && (p.originalSize != null || p.compressed))
              .sort((a, b) => (b.originalSize || 0) - (a.originalSize || 0))
              .map(p => (
                <Card key={p.id} className={p.compressed ? "border-green-500/30" : p.needsCompression ? "border-yellow-500/30" : ""}>
                  <CardContent className="p-3 flex gap-3 items-center">
                    <div className="w-10 h-10 rounded bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {p.imageUrl ? <img src={p.imageUrl} alt="" className="w-full h-full object-cover" /> : <Image className="w-4 h-4 text-muted-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{p.title}</div>
                      <div className="text-xs text-muted-foreground">{p.vendor}</div>
                      {p.compressionReason && <div className="text-xs text-yellow-600">{p.compressionReason}</div>}
                    </div>
                    <div className="text-right flex-shrink-0 space-y-0.5">
                      <div className="text-xs font-medium">{formatBytes(p.originalSize || 0)}</div>
                      {p.compressed && p.compressedSize != null && (
                        <div className="text-[10px] text-green-600">→ {formatBytes(p.compressedSize)} ({Math.round((1 - p.compressedSize / (p.originalSize || 1)) * 100)}% saved)</div>
                      )}
                    </div>
                    {p.compressed ? (
                      <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                    ) : p.needsCompression ? (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => compressImages([p])} disabled={compressing}>
                        Compress
                      </Button>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">OK</Badge>
                    )}
                  </CardContent>
                </Card>
              ))}
            {!products.some(p => p.originalSize != null) && (
              <div className="text-center py-8 text-muted-foreground text-sm">
                Run "Analyse File Sizes" to check which images need compression.
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Quality ── */}
        <TabsContent value="quality" className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Button onClick={analyseQuality} disabled={analysing} className="gap-2">
              <RefreshCw className={`w-4 h-4 ${analysing ? "animate-spin" : ""}`} />
              {analysing ? "Analysing…" : "Run Full Analysis"}
            </Button>
            <div className="flex gap-1 ml-auto">
              {([["issues", "Issues"], ["duplicates", "Duplicates"], ["mismatches", "Mismatches"]] as const).map(([k, l]) => (
                <Badge key={k} variant={filterTab === k ? "default" : "outline"} className="cursor-pointer text-xs" onClick={() => setFilterTab(k)}>{l}</Badge>
              ))}
            </div>
          </div>

          <div className="space-y-2 max-h-[55vh] overflow-y-auto">
            {filtered
              .filter(p => p.qualityStatus && p.qualityStatus !== "ok")
              .map(p => (
                <Card key={p.id} className={p.qualityStatus === "mismatch" ? "border-destructive/30" : "border-yellow-500/30"}>
                  <CardContent className="p-3 flex gap-3 items-center">
                    {statusIcon(p.qualityStatus)}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{p.title}</div>
                      <div className="text-xs text-muted-foreground">{p.vendor}</div>
                      {p.qualityIssue && <div className="text-xs text-yellow-600 mt-0.5">{p.qualityIssue}</div>}
                      {p.qualityRecommendation && <div className="text-xs text-muted-foreground">{p.qualityRecommendation}</div>}
                      {p.mismatchConfidence != null && p.mismatchConfidence > 0 && (
                        <div className="text-[10px] text-muted-foreground">Mismatch confidence: {p.mismatchConfidence}%</div>
                      )}
                    </div>
                    <Badge variant={["missing", "broken", "mismatch"].includes(p.qualityStatus!) ? "destructive" : "outline"} className="text-xs">
                      {p.qualityStatus?.replace("_", " ")}
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            {filtered.filter(p => p.qualityStatus && p.qualityStatus !== "ok").length === 0 && (
              <div className="text-center py-8 text-muted-foreground text-sm">
                {products.some(p => p.qualityStatus) ? "All images look good! ✅" : "Run analysis to detect issues."}
              </div>
            )}
          </div>

          {products.some(p => p.qualityStatus) && (
            <Card>
              <CardContent className="p-4">
                <div className="text-sm font-medium mb-2">Summary</div>
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-center text-xs">
                  {(["ok", "missing", "broken", "low_quality", "duplicate", "mismatch"] as const).map(s => (
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

        {/* ── Validation ── */}
        <TabsContent value="validation" className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary" />Image-to-Product Validation
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-2">
              <p>AI analyses image URLs against product data to detect mismatches — wrong brand images, swapped product photos, or placeholder images.</p>
              <Button onClick={validateMatches} disabled={validating} className="gap-2">
                <ShieldCheck className="w-4 h-4" />{validating ? "Validating…" : "Run Validation"}
              </Button>
            </CardContent>
          </Card>

          <div className="space-y-2 max-h-[55vh] overflow-y-auto">
            {products
              .filter(p => p.matchStatus)
              .sort((a, b) => {
                const order = { mismatch: 0, uncertain: 1, likely: 2 };
                return (order[a.matchStatus!] ?? 3) - (order[b.matchStatus!] ?? 3);
              })
              .map(p => (
                <Card key={p.id} className={p.matchStatus === "mismatch" ? "border-destructive/30" : ""}>
                  <CardContent className="p-3 flex gap-3 items-center">
                    <div className="w-10 h-10 rounded bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Image className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{p.title}</div>
                      <div className="text-xs text-muted-foreground">{p.vendor}</div>
                      {p.matchReason && <div className="text-xs text-muted-foreground mt-0.5">{p.matchReason}</div>}
                    </div>
                    {matchBadge(p.matchStatus)}
                  </CardContent>
                </Card>
              ))}
            {!products.some(p => p.matchStatus) && (
              <div className="text-center py-8 text-muted-foreground text-sm">Run validation to check image-to-product matches.</div>
            )}
          </div>
        </TabsContent>

        {/* ── Review ── */}
        <TabsContent value="review" className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" onClick={approveAll} className="gap-1"><CheckCircle2 className="w-3 h-3" />Approve All</Button>
            <Button size="sm" onClick={pushToShopify} disabled={syncing || products.filter(p => p.approved && p.shopifyProductId && !p.synced).length === 0} className="gap-1">
              <Upload className="w-3 h-3" />{syncing ? "Pushing…" : "Push to Shopify"}
            </Button>
            <Badge variant="outline">{products.filter(p => p.altText && !p.approved).length} pending</Badge>
            <Badge variant="outline" className="text-green-600">{products.filter(p => p.synced).length} synced</Badge>
          </div>

          <div className="space-y-2 max-h-[55vh] overflow-y-auto">
            {products.filter(p => p.altText && !p.approved).map(p => (
              <Card key={p.id}>
                <CardContent className="p-3 flex gap-3 items-start">
                  <div className="w-16 h-16 rounded bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {p.imageUrl ? <img src={p.imageUrl} alt="" className="w-full h-full object-cover" /> : <Image className="w-6 h-6 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="font-medium text-sm">{p.title}</div>
                    <div className="text-xs text-muted-foreground">Alt: "{p.altText}"</div>
                    {p.searchIntent && <div className="text-[10px] text-muted-foreground">🔍 {p.searchIntent}</div>}
                    {p.seoFilename && <div className="text-[10px] text-muted-foreground">📄 {p.seoFilename}</div>}
                    {p.keywords && p.keywords.length > 0 && (
                      <div className="flex gap-1 flex-wrap">{p.keywords.slice(0, 5).map((k, i) => <Badge key={i} variant="secondary" className="text-[10px] h-4">{k}</Badge>)}</div>
                    )}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => startEdit(p)} className="h-7 w-7 p-0"><Edit3 className="w-3 h-3" /></Button>
                    <Button size="sm" onClick={() => setProducts(prev => prev.map(pp => pp.id === p.id ? { ...pp, approved: true } : pp))} className="h-7 text-xs">Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => setProducts(prev => prev.map(pp => pp.id === p.id ? { ...pp, altText: undefined, seoFilename: undefined, keywords: undefined, searchIntent: undefined, caption: undefined } : pp))} className="h-7 text-xs">Skip</Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            {products.filter(p => p.altText && !p.approved).length === 0 && (
              <div className="text-center py-8 text-muted-foreground text-sm">
                {products.some(p => p.approved) ? "All done! ✅" : "Generate alt text first."}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
