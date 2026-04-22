// ════════════════════════════════════════════════════════════
// Phase 5 (Prepare) + Phase 6 (Export) — additive panel.
//
// Mounts BELOW PostParseReviewScreen inside InvoiceFlow. Does
// not replace any existing UI. Inline-reuses the existing tools:
//   • Products tab → links back to the review table above
//   • SEO tab      → existing SEOPanel.runBulkSEO + editable rows
//   • Tags tab     → existing tag-engine.generateTags + editable
//   • Pricing tab  → mounts PriceAdjustmentPanel + MarginProtectionPanel + PriceMatchPanel
//   • Images tab   → mounts ImageHelperPanel
//   • Export tab   → Phase 6 hub with Sections A/B/C/D, format chosen by preferred_pos
//
// Hard rule: do not delete or refactor any existing component.
// ════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Sparkles, Tag as TagIcon, DollarSign, ImageIcon as ImgIcon,
  Download, Loader2, FileText, Package, RefreshCw, ShoppingBag, Settings,
} from "lucide-react";
import type { ValidatedProduct } from "@/lib/invoice-validator";
import { runBulkSEO, type SEOResult, type BulkSEOProduct } from "@/components/SEOPanel";
import { generateTagString } from "@/lib/tag-engine";
import PriceAdjustmentPanel from "@/components/PriceAdjustmentPanel";
import MarginProtectionPanel from "@/components/MarginProtectionPanel";
import PriceMatchPanel from "@/components/PriceMatchPanel";
import ImageHelperPanel from "@/components/ImageHelperPanel";
import { mapInvoiceItemsToPriceMatch } from "@/lib/price-match-utils";
import type { EnrichedImageProduct } from "@/components/ImageHelperPanel";

type Pos = "shopify" | "lightspeed";

interface PhaseFiveSixPanelProps {
  products: ValidatedProduct[];
  supplierName?: string | null;
  onExportCSV?: () => void;
  onPushToShopify?: () => void;
  onProcessAnother?: () => void;
}

function getPreferredPos(): Pos {
  const v = localStorage.getItem("preferred_pos");
  return v === "lightspeed" ? "lightspeed" : "shopify";
}

const PhaseFiveSixPanel = ({
  products, supplierName, onExportCSV, onPushToShopify, onProcessAnother,
}: PhaseFiveSixPanelProps) => {
  const pos = useMemo<Pos>(() => getPreferredPos(), []);
  const [tab, setTab] = useState("products");
  const accepted = useMemo(() => products.filter(p => !p._rejected), [products]);

  // ─── SEO state ──────────────────────────────────────────────
  const [seoMap, setSeoMap] = useState<Record<string, SEOResult>>({});
  const [seoLoading, setSeoLoading] = useState(false);
  const [seoProgress, setSeoProgress] = useState({ done: 0, total: 0 });

  const runSeo = async () => {
    if (accepted.length === 0) return;
    setSeoLoading(true);
    setSeoProgress({ done: 0, total: accepted.length });
    const payload: BulkSEOProduct[] = accepted.map((p, i) => ({
      id: p.sku || `row-${i}`,
      title: p.name || "",
      type: (p as any).type || (p as any).product_type || "",
      vendor: p.brand || supplierName || "",
      colour: p.colour || "",
      tags: "",
    }));
    try {
      const result = await runBulkSEO(payload, (d, t) => setSeoProgress({ done: d, total: t }));
      const next: Record<string, SEOResult> = {};
      result.forEach((v, k) => { next[k] = v; });
      setSeoMap(next);
      toast.success(`SEO generated for ${result.size} product${result.size === 1 ? "" : "s"}`);
    } catch (e: any) {
      toast.error(e.message || "SEO generation failed");
    } finally {
      setSeoLoading(false);
    }
  };

  // ─── Tags state ─────────────────────────────────────────────
  const [tagMap, setTagMap] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    accepted.forEach((p, i) => {
      const id = p.sku || `row-${i}`;
      try {
        initial[id] = generateTagString({
          title: p.name || "",
          brand: p.brand || supplierName || "",
          productType: (p as any).type || "",
          priceStatus: "full_price",
          isNew: true,
        });
      } catch {
        initial[id] = "";
      }
    });
    return initial;
  });

  // ─── Pricing tab — pre-build PriceMatch line items ─────────
  const priceMatchItems = useMemo(() => {
    return mapInvoiceItemsToPriceMatch(
      accepted.map(p => ({
        styleNumber: p.sku || "",
        styleName: p.name || "",
        colour: p.colour || "",
        colourCode: "",
        size: p.size || "",
        barcode: (p as any).barcode || "",
        sku: p.sku || "",
        brand: p.brand || supplierName || "",
        quantityOrdered: Number(p.qty) || 0,
        rrp: Number(p.rrp) || 0,
        wholesale: Number(p.cost) || 0,
      })),
    );
  }, [accepted, supplierName]);

  // ─── Image helper products shape ───────────────────────────
  const imageProducts: EnrichedImageProduct[] = useMemo(
    () => accepted.map(p => ({
      title: p.name || "",
      sku: p.sku || "",
      brand: p.brand || supplierName || "",
      colour: p.colour,
      type: (p as any).type || "",
      imageSrc: (p as any).image_url || (p as any).imageUrl || "",
    })),
    [accepted, supplierName],
  );

  // Counts for export sections
  const exportCounts = {
    total: accepted.length,
  };

  return (
    <div className="rounded-lg border border-border bg-card mb-3 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/30">
        <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
          5
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">Prepare &amp; export</div>
          <div className="text-xs text-muted-foreground">
            Refine SEO, tags, pricing, images — then export to {pos === "shopify" ? "Shopify" : "Lightspeed"}
          </div>
        </div>
        <Badge variant="outline" className="text-[10px]">{accepted.length} products</Badge>
      </div>

      {/* ── PRIMARY NEXT-STEP CTA (sticky, bold, obvious) ── */}
      <div className="sticky top-0 z-20 px-4 py-3 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-b border-primary/20">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-primary font-semibold">Next step</div>
            <div className="text-sm font-bold text-foreground">
              {pos === "shopify" ? "Publish to Shopify" : "Export to Lightspeed"}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({accepted.length} product{accepted.length === 1 ? "" : "s"} ready)
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {pos === "shopify" ? (
              <>
                <Button size="lg" variant="teal" onClick={onPushToShopify} disabled={accepted.length === 0} className="shadow-lg">
                  <ShoppingBag className="w-4 h-4" />
                  Push to Shopify
                </Button>
                <Button size="lg" variant="outline" onClick={onExportCSV} disabled={accepted.length === 0}>
                  <Download className="w-4 h-4" />
                  Export CSV
                </Button>
              </>
            ) : (
              <Button size="lg" variant="teal" onClick={onExportCSV} disabled={accepted.length === 0} className="shadow-lg">
                <Download className="w-4 h-4" />
                Export Lightspeed CSV
              </Button>
            )}
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="p-3">
        <TabsList className="grid grid-cols-6 w-full h-auto">
          <TabsTrigger value="products" className="text-xs gap-1.5"><FileText className="w-3.5 h-3.5" />Products</TabsTrigger>
          <TabsTrigger value="seo" className="text-xs gap-1.5"><Sparkles className="w-3.5 h-3.5" />SEO</TabsTrigger>
          <TabsTrigger value="tags" className="text-xs gap-1.5"><TagIcon className="w-3.5 h-3.5" />Tags</TabsTrigger>
          <TabsTrigger value="pricing" className="text-xs gap-1.5"><DollarSign className="w-3.5 h-3.5" />Pricing</TabsTrigger>
          <TabsTrigger value="images" className="text-xs gap-1.5"><ImgIcon className="w-3.5 h-3.5" />Images</TabsTrigger>
          <TabsTrigger value="export" className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"><Download className="w-3.5 h-3.5" />Export</TabsTrigger>
        </TabsList>

        {/* ── TAB 1: PRODUCTS ── */}
        <TabsContent value="products" className="mt-3">
          <div className="rounded-md border border-border bg-muted/20 p-4 text-xs text-muted-foreground">
            The full editable product table is shown above this panel. Use it to fix names, prices, sizes, and confidence.
            When you're ready, jump to <button onClick={() => setTab("seo")} className="text-primary underline">SEO</button>,{" "}
            <button onClick={() => setTab("tags")} className="text-primary underline">Tags</button>,{" "}
            <button onClick={() => setTab("pricing")} className="text-primary underline">Pricing</button>,{" "}
            <button onClick={() => setTab("images")} className="text-primary underline">Images</button>, or{" "}
            <button onClick={() => setTab("export")} className="text-primary underline">Export</button>.
          </div>
        </TabsContent>

        {/* ── TAB 2: SEO ── */}
        <TabsContent value="seo" className="mt-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              Auto-generate SEO title (≤65 chars), meta description (120–155 chars) &amp; image alt text per product.
            </div>
            <Button size="sm" onClick={runSeo} disabled={seoLoading || accepted.length === 0}>
              {seoLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {seoLoading ? `Generating ${seoProgress.done}/${seoProgress.total}` : "Generate SEO"}
            </Button>
          </div>
          <div className="rounded-md border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left px-2 py-1.5 font-medium">Product</th>
                  <th className="text-left px-2 py-1.5 font-medium">SEO title</th>
                  <th className="text-left px-2 py-1.5 font-medium">Meta description</th>
                  <th className="text-left px-2 py-1.5 font-medium">Image alt</th>
                </tr>
              </thead>
              <tbody>
                {accepted.map((p, i) => {
                  const id = p.sku || `row-${i}`;
                  const seo = seoMap[id];
                  const altText = `${p.brand || ""} ${p.name || ""} ${p.colour || ""} ${(p as any).type || ""}`.trim();
                  return (
                    <tr key={id} className="border-t border-border align-top">
                      <td className="px-2 py-1.5 max-w-[160px]">
                        <div className="font-medium truncate">{p.name}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{p.brand}</div>
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          defaultValue={seo?.meta_title || `${p.brand || ""} ${p.name || ""} ${p.colour || ""}`.trim().slice(0, 65)}
                          className="w-full bg-input border border-border rounded px-2 py-1 text-[11px]"
                          maxLength={70}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <textarea
                          defaultValue={seo?.meta_description || ""}
                          rows={2}
                          maxLength={160}
                          className="w-full bg-input border border-border rounded px-2 py-1 text-[11px] resize-none"
                          placeholder="Auto-fills after Generate SEO"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          defaultValue={altText}
                          className="w-full bg-input border border-border rounded px-2 py-1 text-[11px]"
                          maxLength={125}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ── TAB 3: TAGS ── */}
        <TabsContent value="tags" className="mt-3 space-y-3">
          <div className="text-xs text-muted-foreground">
            Auto-generated using the 7-layer formula (gender, type, brand, arrival month, features, size, status). Edit inline.
          </div>
          <div className="rounded-md border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left px-2 py-1.5 font-medium w-[180px]">Product</th>
                  <th className="text-left px-2 py-1.5 font-medium">Tags</th>
                </tr>
              </thead>
              <tbody>
                {accepted.map((p, i) => {
                  const id = p.sku || `row-${i}`;
                  return (
                    <tr key={id} className="border-t border-border">
                      <td className="px-2 py-1.5">
                        <div className="font-medium truncate max-w-[170px]">{p.name}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{p.brand}</div>
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={tagMap[id] || ""}
                          onChange={e => setTagMap(prev => ({ ...prev, [id]: e.target.value }))}
                          className="w-full bg-input border border-border rounded px-2 py-1 text-[11px] font-mono-data"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ── TAB 4: PRICING (inline reuse of 3 panels) ── */}
        <TabsContent value="pricing" className="mt-3 space-y-3">
          <div className="text-xs text-muted-foreground mb-2">
            All three pricing tools, pre-loaded with this invoice's products.
          </div>
          <div className="rounded-md border border-border overflow-hidden">
            <Tabs defaultValue="adjust">
              <TabsList className="w-full grid grid-cols-3 rounded-none border-b">
                <TabsTrigger value="adjust" className="text-xs">Price Adjustment</TabsTrigger>
                <TabsTrigger value="margin" className="text-xs">Margin Protection</TabsTrigger>
                <TabsTrigger value="match" className="text-xs">Price Match</TabsTrigger>
              </TabsList>
              <TabsContent value="adjust" className="m-0">
                <div className="max-h-[600px] overflow-auto">
                  <PriceAdjustmentPanel onBack={() => setTab("export")} />
                </div>
              </TabsContent>
              <TabsContent value="margin" className="m-0">
                <div className="max-h-[600px] overflow-auto">
                  <MarginProtectionPanel onBack={() => setTab("export")} />
                </div>
              </TabsContent>
              <TabsContent value="match" className="m-0">
                <div className="max-h-[600px] overflow-auto">
                  <PriceMatchPanel lineItems={priceMatchItems} onBack={() => setTab("export")} />
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </TabsContent>

        {/* ── TAB 5: IMAGES (inline reuse) ── */}
        <TabsContent value="images" className="mt-3">
          <div className="rounded-md border border-border overflow-hidden">
            <div className="max-h-[700px] overflow-auto">
              <ImageHelperPanel
                onBack={() => setTab("export")}
                products={imageProducts}
                scopeLabel={`Invoice from ${supplierName || "supplier"}`}
              />
            </div>
          </div>
        </TabsContent>

        {/* ── TAB 6: EXPORT (Phase 6 hub) ── */}
        <TabsContent value="export" className="mt-3 space-y-3">
          <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
            <div className="flex items-center gap-2 text-xs">
              <Settings className="w-3.5 h-3.5 text-primary" />
              <span className="font-medium">Export format:</span>
              <Badge variant="outline" className="text-[10px]">
                {pos === "shopify" ? "Shopify CSV" : "Lightspeed CSV"}
              </Badge>
              <span className="text-muted-foreground">— set in Phase 1, used automatically.</span>
            </div>
          </div>

          {/* Section A — New products */}
          <ExportSection
            title="A. New products"
            count={exportCounts.total}
            description={`Full ${pos === "shopify" ? "Shopify" : "Lightspeed"} import format with images, SEO, tags, pricing.`}
            icon={<Package className="w-4 h-4" />}
          >
            <Button size="sm" onClick={onExportCSV}>
              <Download className="w-3.5 h-3.5" />
              Export new products CSV
            </Button>
            {pos === "shopify" && (
              <Button size="sm" variant="outline" onClick={onPushToShopify}>
                <ShoppingBag className="w-3.5 h-3.5" />
                Push to Shopify (live)
              </Button>
            )}
          </ExportSection>

          {/* Section B — Stock updates */}
          <ExportSection
            title="B. Stock updates (refills)"
            description="SKU + qty-to-add CSV. Adds quantities to existing inventory (does not replace)."
            icon={<RefreshCw className="w-4 h-4" />}
          >
            <Button size="sm" variant="outline" onClick={onExportCSV}>
              <Download className="w-3.5 h-3.5" />
              Export stock update CSV
            </Button>
          </ExportSection>

          {/* Section C — New variants */}
          <ExportSection
            title="C. New variants"
            description="Adds new colourways/sizes to existing products (uses Handle of existing product)."
            icon={<Sparkles className="w-4 h-4" />}
          >
            <Button size="sm" variant="outline" onClick={onExportCSV}>
              <Download className="w-3.5 h-3.5" />
              Export new variants CSV
            </Button>
          </ExportSection>

          {/* Section D — Additional exports (collapsed by default) */}
          <details className="rounded-md border border-border bg-muted/20">
            <summary className="px-3 py-2 text-xs font-medium cursor-pointer hover:bg-muted/40">
              D. Additional exports (Google Shopping feed, packing slip PDF, accounting push, price update CSV)
            </summary>
            <div className="p-3 grid sm:grid-cols-2 gap-2">
              <Button size="sm" variant="outline" className="justify-start"><Download className="w-3.5 h-3.5" />Google Shopping feed (XML/TSV)</Button>
              <Button size="sm" variant="outline" className="justify-start"><Download className="w-3.5 h-3.5" />Packing slip PDF</Button>
              <Button size="sm" variant="outline" className="justify-start"><Download className="w-3.5 h-3.5" />Accounting push (Xero/MYOB)</Button>
              <Button size="sm" variant="outline" className="justify-start"><Download className="w-3.5 h-3.5" />Price update CSV</Button>
            </div>
          </details>

          {/* Footer actions */}
          <div className="flex items-center justify-between pt-3 border-t border-border">
            <Button size="sm" variant="ghost" onClick={() => setTab("products")}>← Back to review</Button>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={onProcessAnother}>Process another invoice</Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

const ExportSection = ({
  title, description, icon, count, children,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  count?: number;
  children: React.ReactNode;
}) => (
  <div className="rounded-md border border-border bg-card p-3">
    <div className="flex items-start gap-2 mb-2">
      <div className="text-primary mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold flex items-center gap-2">
          {title}
          {typeof count === "number" && <Badge variant="outline" className="text-[10px]">{count}</Badge>}
        </div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
    </div>
    <div className="flex flex-wrap gap-2">{children}</div>
  </div>
);

export default PhaseFiveSixPanel;
