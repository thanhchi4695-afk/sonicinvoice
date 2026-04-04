import { useState, useCallback } from "react";
import { ChevronLeft, Sparkles, Check, AlertTriangle, X, Plus, Pencil, Eye, Loader2, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ProductDetailAttribute {
  section: string;
  name: string;
  value: string;
}

interface FeedProduct {
  id: string;
  title: string;
  vendor: string;
  productType: string;
  description: string;
  imageUrl: string;
  tags: string[];
  status: "not_analysed" | "analysed" | "pushed" | "failed";
  attributes: ProductDetailAttribute[];
  confidence: string;
  imageQualityNote: string | null;
  error?: string;
}

// Demo products for testing
const DEMO_PRODUCTS: FeedProduct[] = [
  {
    id: "demo-1", title: "Funkita Ladies Single Strap One Piece - Kulin Colour, 12",
    vendor: "Funkita", productType: "One Pieces",
    description: "The Funkita Single Strap One Piece is a bold swimsuit with a unique single strap design.",
    imageUrl: "https://cdn.shopify.com/s/files/1/0266/5817/1851/products/FS16L02889_1.jpg",
    tags: ["chlorine resist", "one piece", "funkita"],
    status: "not_analysed", attributes: [], confidence: "", imageQualityNote: null,
  },
  {
    id: "demo-2", title: "Baku Positano Rio Loop Side Bikini Bottom - Emerald",
    vendor: "Baku", productType: "Bikini Bottoms",
    description: "The Baku Positano Rio Loop Side Bikini Bottom features loop detail side panels.",
    imageUrl: "https://cdn.shopify.com/s/files/1/0266/5817/1851/products/BB5040_2.jpg",
    tags: ["bikini", "baku"],
    status: "not_analysed", attributes: [], confidence: "", imageQualityNote: null,
  },
  {
    id: "demo-3", title: "Jets Jetset D/DD Twist Top - Black Ivory",
    vendor: "Jets", productType: "Bikini Tops",
    description: "The Jets Jetset D/DD Twist Top features underwire support and twist front detail.",
    imageUrl: "https://cdn.shopify.com/s/files/1/0266/5817/1851/products/J10597_1.jpg",
    tags: ["underwire", "d-dd", "jets"],
    status: "not_analysed", attributes: [], confidence: "", imageQualityNote: null,
  },
  {
    id: "demo-4", title: "Seafolly Beach Bound Sunsuit Kids - Pink",
    vendor: "Seafolly", productType: "Kids Swimwear",
    description: "Seafolly Beach Bound Sunsuit with long sleeves and UPF 50+ sun protection for kids.",
    imageUrl: "https://cdn.shopify.com/s/files/1/0266/5817/1851/products/56604_1.jpg",
    tags: ["sun protection", "kids", "seafolly", "upf 50+"],
    status: "not_analysed", attributes: [], confidence: "", imageQualityNote: null,
  },
];

export default function AIFeedOptimisation({ onBack }: { onBack: () => void }) {
  const [products, setProducts] = useState<FeedProduct[]>(DEMO_PRODUCTS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [tab, setTab] = useState("all");
  const [detailProduct, setDetailProduct] = useState<FeedProduct | null>(null);
  const [editingAttr, setEditingAttr] = useState<{ idx: number; field: "value" } | null>(null);
  const [namespace, setNamespace] = useState("custom");

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const filtered = filteredProducts();
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(p => p.id)));
  };

  const filteredProducts = useCallback(() => {
    if (tab === "all") return products;
    if (tab === "not_analysed") return products.filter(p => p.status === "not_analysed");
    if (tab === "analysed") return products.filter(p => p.status === "analysed" || p.status === "pushed");
    if (tab === "failed") return products.filter(p => p.status === "failed");
    return products;
  }, [products, tab]);

  const analyseProducts = async (ids: string[]) => {
    const toProcess = products.filter(p => ids.includes(p.id));
    if (toProcess.length === 0) return;

    setProcessing(true);
    setProgress({ done: 0, total: toProcess.length });

    // Process in batches of 3
    const BATCH = 3;
    for (let i = 0; i < toProcess.length; i += BATCH) {
      const batch = toProcess.slice(i, i + BATCH);
      try {
        const { data, error } = await supabase.functions.invoke("ai-feed-optimise", {
          body: {
            products: batch.map(p => ({
              title: p.title,
              vendor: p.vendor,
              productType: p.productType,
              description: p.description,
              imageUrl: p.imageUrl,
              tags: p.tags,
            })),
          },
        });

        if (error) throw new Error(error.message);

        const results = data?.results || [];
        setProducts(prev => prev.map(p => {
          const batchIdx = batch.findIndex(b => b.id === p.id);
          if (batchIdx === -1) return p;
          const r = results.find((r: any) => r.index === batchIdx);
          if (!r) return p;
          return {
            ...p,
            status: r.error ? "failed" as const : "analysed" as const,
            attributes: r.attributes || [],
            confidence: r.confidence || "low",
            imageQualityNote: r.imageQualityNote,
            error: r.error,
          };
        }));
      } catch (err) {
        console.error("Batch error:", err);
        setProducts(prev => prev.map(p => {
          if (!batch.find(b => b.id === p.id)) return p;
          return { ...p, status: "failed" as const, error: err instanceof Error ? err.message : "Unknown error" };
        }));
      }

      setProgress(prev => ({ ...prev, done: Math.min(i + BATCH, toProcess.length) }));
    }

    setProcessing(false);
    toast.success(`Analysed ${toProcess.length} products`);
  };

  const updateAttribute = (productId: string, attrIdx: number, newValue: string) => {
    setProducts(prev => prev.map(p => {
      if (p.id !== productId) return p;
      const attrs = [...p.attributes];
      attrs[attrIdx] = { ...attrs[attrIdx], value: newValue };
      return { ...p, attributes: attrs };
    }));
    if (detailProduct?.id === productId) {
      setDetailProduct(prev => {
        if (!prev) return null;
        const attrs = [...prev.attributes];
        attrs[attrIdx] = { ...attrs[attrIdx], value: newValue };
        return { ...prev, attributes: attrs };
      });
    }
  };

  const addAttribute = (productId: string) => {
    const newAttr: ProductDetailAttribute = { section: "Style", name: "New Attribute", value: "Value" };
    setProducts(prev => prev.map(p => {
      if (p.id !== productId || p.attributes.length >= 12) return p;
      return { ...p, attributes: [...p.attributes, newAttr] };
    }));
    if (detailProduct?.id === productId) {
      setDetailProduct(prev => prev ? { ...prev, attributes: [...prev.attributes, newAttr] } : null);
    }
  };

  const removeAttribute = (productId: string, attrIdx: number) => {
    setProducts(prev => prev.map(p => {
      if (p.id !== productId) return p;
      return { ...p, attributes: p.attributes.filter((_, i) => i !== attrIdx) };
    }));
    if (detailProduct?.id === productId) {
      setDetailProduct(prev => prev ? { ...prev, attributes: prev.attributes.filter((_, i) => i !== attrIdx) } : null);
    }
  };

  const filtered = filteredProducts();
  const counts = {
    all: products.length,
    not_analysed: products.filter(p => p.status === "not_analysed").length,
    analysed: products.filter(p => p.status === "analysed" || p.status === "pushed").length,
    failed: products.filter(p => p.status === "failed").length,
  };

  const costEstimate = (selected.size || counts.not_analysed) * 0.01;

  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
        <div>
          <h2 className="text-lg font-semibold font-display flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" /> AI Feed Optimisation
          </h2>
          <p className="text-xs text-muted-foreground">Generate Google Shopping product_detail attributes from images</p>
        </div>
      </div>

      {/* How it works */}
      <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mb-4">
        <p className="text-xs font-semibold text-primary mb-1.5">How it works</p>
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
          <li>Select products to optimise</li>
          <li>AI analyses each product image and data</li>
          <li>Attributes appear in Google's "About this product" panel</li>
          <li>Powers Google Shopping refinement filters (silhouette, neckline, pattern…)</li>
        </ol>
      </div>

      {/* Namespace selector */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setNamespace("custom")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${namespace === "custom" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}
        >
          custom.* (Simprosys)
        </button>
        <button
          onClick={() => setNamespace("mm-google-shopping")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${namespace === "mm-google-shopping" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}
        >
          mm-google-shopping.* (native)
        </button>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="mb-4">
        <TabsList className="w-full">
          <TabsTrigger value="all" className="flex-1 text-xs">All ({counts.all})</TabsTrigger>
          <TabsTrigger value="not_analysed" className="flex-1 text-xs">Unanalysed ({counts.not_analysed})</TabsTrigger>
          <TabsTrigger value="analysed" className="flex-1 text-xs">Analysed ({counts.analysed})</TabsTrigger>
          <TabsTrigger value="failed" className="flex-1 text-xs">Failed ({counts.failed})</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Action buttons */}
      <div className="flex gap-2 mb-4">
        <Button
          variant="teal"
          size="sm"
          className="flex-1 gap-1"
          disabled={processing || (selected.size === 0 && counts.not_analysed === 0)}
          onClick={() => {
            const ids = selected.size > 0 ? Array.from(selected) : products.filter(p => p.status === "not_analysed").map(p => p.id);
            analyseProducts(ids);
          }}
        >
          <Sparkles className="w-3.5 h-3.5" />
          {processing ? "Analysing..." : selected.size > 0 ? `Analyse ${selected.size} selected` : `Analyse all (${counts.not_analysed})`}
        </Button>
      </div>

      {/* Cost estimate */}
      {!processing && (selected.size > 0 || counts.not_analysed > 0) && (
        <div className="bg-muted/50 rounded-lg p-2 mb-4 text-xs text-muted-foreground flex justify-between">
          <span>{selected.size || counts.not_analysed} products × ~$0.01/ea</span>
          <span className="font-semibold text-foreground">~${costEstimate.toFixed(2)} AUD</span>
        </div>
      )}

      {/* Progress */}
      {processing && (
        <div className="bg-card border border-border rounded-lg p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span className="text-sm font-medium">Analysing products…</span>
          </div>
          <Progress value={(progress.done / progress.total) * 100} className="h-2 mb-1" />
          <p className="text-xs text-muted-foreground">{progress.done} of {progress.total} complete</p>
        </div>
      )}

      {/* Product table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"><Checkbox checked={selected.size === filtered.length && filtered.length > 0} onCheckedChange={toggleAll} /></TableHead>
              <TableHead className="text-xs">Product</TableHead>
              <TableHead className="text-xs hidden sm:table-cell">Status</TableHead>
              <TableHead className="text-xs hidden md:table-cell">Attributes</TableHead>
              <TableHead className="text-xs w-16">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(p => (
              <TableRow key={p.id}>
                <TableCell><Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggleSelect(p.id)} /></TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {p.imageUrl && (
                      <img src={p.imageUrl} alt="" className="w-8 h-8 rounded object-cover shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate max-w-[200px]">{p.title}</p>
                      <p className="text-[10px] text-muted-foreground">{p.vendor}</p>
                      {/* Mobile status */}
                      <div className="sm:hidden mt-1">
                        <StatusBadge status={p.status} confidence={p.confidence} />
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <StatusBadge status={p.status} confidence={p.confidence} />
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {p.attributes.length > 0 ? (
                    <div className="flex flex-wrap gap-1 max-w-[250px]">
                      {p.attributes.slice(0, 3).map((a, i) => (
                        <Badge key={i} variant="secondary" className="text-[10px] px-1.5 py-0">
                          {a.name}: {a.value}
                        </Badge>
                      ))}
                      {p.attributes.length > 3 && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          +{p.attributes.length - 3}
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {p.attributes.length > 0 ? (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDetailProduct(p)}>
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                  ) : (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => analyseProducts([p.id])}>
                      <Sparkles className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Simprosys instructions */}
      {counts.analysed > 0 && (
        <div className="bg-success/5 border border-success/20 rounded-lg p-3 mt-4">
          <p className="text-xs font-semibold text-success mb-1">Simprosys Setup</p>
          <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
            <li>In Simprosys → Settings → Shopify Metafields Mapping</li>
            <li>Click "Add mapping"</li>
            <li>Set Shopify Metafield: <code className="text-foreground bg-muted px-1 rounded">{namespace}.product_detail_attributes</code></li>
            <li>Set Feed Attribute: Product Detail</li>
            <li>Sync products — attributes appear in Google within 24–48 hours</li>
          </ol>
        </div>
      )}

      {/* Attribute Detail Modal */}
      <Dialog open={!!detailProduct} onOpenChange={open => { if (!open) { setDetailProduct(null); setEditingAttr(null); } }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          {detailProduct && (
            <>
              <DialogHeader>
                <DialogTitle className="text-sm">{detailProduct.title}</DialogTitle>
                <DialogDescription className="text-xs">
                  {detailProduct.attributes.length} attributes · Confidence: {detailProduct.confidence}
                  {detailProduct.imageQualityNote && ` · Image: ${detailProduct.imageQualityNote}`}
                </DialogDescription>
              </DialogHeader>

              {detailProduct.imageUrl && (
                <img src={detailProduct.imageUrl} alt="" className="w-full h-40 object-contain rounded-lg bg-muted" />
              )}

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Section</TableHead>
                    <TableHead className="text-xs">Attribute</TableHead>
                    <TableHead className="text-xs">Value</TableHead>
                    <TableHead className="text-xs w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailProduct.attributes.map((a, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs py-1.5">{a.section}</TableCell>
                      <TableCell className="text-xs py-1.5">{a.name}</TableCell>
                      <TableCell className="text-xs py-1.5">
                        {editingAttr?.idx === i ? (
                          <input
                            autoFocus
                            defaultValue={a.value}
                            onBlur={e => { updateAttribute(detailProduct.id, i, e.target.value); setEditingAttr(null); }}
                            onKeyDown={e => { if (e.key === "Enter") { updateAttribute(detailProduct.id, i, (e.target as HTMLInputElement).value); setEditingAttr(null); } }}
                            className="w-full h-6 px-1 text-xs bg-input border border-border rounded"
                          />
                        ) : (
                          <button onClick={() => setEditingAttr({ idx: i, field: "value" })} className="hover:underline text-left">
                            {a.value}
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button onClick={() => removeAttribute(detailProduct.id, i)} className="text-muted-foreground hover:text-destructive">
                          <X className="w-3 h-3" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {detailProduct.attributes.length < 12 && (
                <Button variant="outline" size="sm" className="w-full gap-1 text-xs" onClick={() => addAttribute(detailProduct.id)}>
                  <Plus className="w-3 h-3" /> Add attribute
                </Button>
              )}

              {/* Google format preview */}
              <div className="bg-muted/50 rounded-lg p-3 mt-2">
                <p className="text-[10px] font-semibold text-muted-foreground mb-1">Google format preview</p>
                <div className="font-mono text-[10px] text-foreground/80 space-y-0.5">
                  {detailProduct.attributes.map((a, i) => (
                    <p key={i}>{a.section}:{a.name}:{a.value}</p>
                  ))}
                </div>
              </div>

              <Button variant="teal" size="sm" className="w-full gap-1" onClick={() => { setDetailProduct(null); toast.success("Changes saved"); }}>
                <Check className="w-3.5 h-3.5" /> Save changes
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusBadge({ status, confidence }: { status: string; confidence: string }) {
  if (status === "not_analysed") return <Badge variant="outline" className="text-[10px]">Not analysed</Badge>;
  if (status === "failed") return <Badge variant="destructive" className="text-[10px]">Failed</Badge>;
  if (status === "pushed") return <Badge className="text-[10px] bg-success text-success-foreground">Pushed</Badge>;
  return (
    <Badge variant="secondary" className="text-[10px] gap-0.5">
      <Check className="w-2.5 h-2.5" />
      {confidence === "high" ? "High" : confidence === "medium" ? "Medium" : "Low"}
    </Badge>
  );
}
