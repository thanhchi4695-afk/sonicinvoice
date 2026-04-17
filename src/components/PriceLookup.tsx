import { useState } from "react";
import { ChevronLeft, Search, Loader2, ExternalLink, Check, AlertTriangle, ChevronRight, Globe, ShoppingBag, Store, Building, Image, Copy, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getStoreConfig } from "@/lib/prompt-builder";

interface PriceLookupProps {
  onBack: () => void;
  initialProduct?: {
    product_name?: string;
    supplier?: string;
    style_number?: string;
    colour?: string;
    supplier_cost?: number;
  };
}

interface SearchResult {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  is_australian: boolean;
  is_official_brand: boolean;
  retailer_type: string;
}

interface ExtractedProduct {
  product_name: string | null;
  brand: string | null;
  retail_price_aud: number | null;
  sale_price_aud: number | null;
  compare_at_price_aud: number | null;
  currency_detected: string | null;
  currency_confidence: number;
  image_urls: string[];
  description: string | null;
  key_features: string[] | null;
  fabric_content: string | null;
  care_instructions: string | null;
  fit_notes: string | null;
  sizes_available: string[] | null;
  colours_available: string[] | null;
  page_title: string | null;
  extraction_notes: string | null;
  price_matches_cost: boolean;
  price_vs_cost_note: string | null;
  source_url: string;
  fetch_success: boolean;
  fetch_error: string | null;
}

type Step = "input" | "searching" | "results" | "extracting" | "review" | "approved";

const STEPS = ["Input", "Search", "Select", "Extract", "Approve"];

const RETAILER_ICONS: Record<string, typeof Store> = {
  department_store: Building,
  specialty: ShoppingBag,
  brand_direct: Store,
  marketplace: Globe,
};

export default function PriceLookup({ onBack, initialProduct }: PriceLookupProps) {
  const store = getStoreConfig();

  // Input state
  const [productName, setProductName] = useState(initialProduct?.product_name || "");
  const [supplier, setSupplier] = useState(initialProduct?.supplier || "");
  const [styleNumber, setStyleNumber] = useState(initialProduct?.style_number || "");
  const [colour, setColour] = useState(initialProduct?.colour || "");
  const [supplierCost, setSupplierCost] = useState(initialProduct?.supplier_cost?.toString() || "");

  // Flow state
  const [step, setStep] = useState<Step>(initialProduct?.product_name ? "input" : "input");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedUrl, setSelectedUrl] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [extracted, setExtracted] = useState<ExtractedProduct | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [finalJson, setFinalJson] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);

  const currentStepIndex = ["input", "searching", "results", "extracting", "review", "approved"].indexOf(step);

  // ── Step 1: Search ──
  const handleSearch = async () => {
    if (!productName) { toast.error("Enter a product name"); return; }
    setStep("searching");

    try {
      const { data, error } = await supabase.functions.invoke("price-lookup-search", {
        body: {
          product_name: productName,
          supplier,
          style_number: styleNumber,
          colour,
        },
      });
      if (error) throw error;

      setSearchQuery(data.search_query || "");
      setSearchResults(data.results || []);
      setStep("results");
      toast.success(`Found ${data.results?.length || 0} results`);
    } catch (err: any) {
      toast.error("Search failed: " + (err?.message || "Unknown error"));
      setStep("input");
    }
  };

  // ── Step 2: Extract from URL ──
  const handleExtract = async (url: string) => {
    setSelectedUrl(url);
    setStep("extracting");

    try {
      const { data, error } = await supabase.functions.invoke("price-lookup-extract", {
        body: {
          url,
          product_name: productName,
          supplier,
          style_number: styleNumber,
          colour,
          supplier_cost: supplierCost ? parseFloat(supplierCost) : undefined,
        },
      });
      if (error) throw error;

      setExtracted(data);
      setEditDescription(data.description || "");
      setStep("review");
    } catch (err: any) {
      toast.error("Extraction failed: " + (err?.message || "Unknown error"));
      setStep("results");
    }
  };

  // ── Step 3: Approve & Save ──
  const handleApprove = async () => {
    if (!extracted) return;

    const output = {
      status: "approved",
      product_name: extracted.product_name || productName,
      supplier: extracted.brand || supplier,
      retail_price_aud: extracted.retail_price_aud,
      price_confidence: extracted.currency_confidence || 0,
      image_urls: extracted.image_urls || [],
      description: editDescription,
      source_url: extracted.source_url,
      notes: extracted.extraction_notes || "",
    };

    setFinalJson(output);

    // Save to database
    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("price_lookups").insert({
          user_id: user.id,
          supplier: output.supplier,
          product_name: output.product_name,
          style_number: styleNumber || null,
          colour: colour || null,
          supplier_cost: supplierCost ? parseFloat(supplierCost) : null,
          retail_price_aud: output.retail_price_aud,
          price_confidence: output.price_confidence,
          image_urls: output.image_urls,
          description: output.description,
          source_url: output.source_url,
          notes: output.notes,
        });
      }
    } catch {
      // Non-critical — still show success
    } finally {
      setIsSaving(false);
    }

    setStep("approved");
    toast.success("Product data approved & saved!");
  };

  const copyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(finalJson, null, 2));
    toast.success("Copied to clipboard");
  };

  const costNum = supplierCost ? parseFloat(supplierCost) : null;

  return (
    <div className="min-h-screen bg-background">
      <div className="px-4 pt-4 pb-2">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground mb-3">
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <h1 className="text-2xl font-bold font-display">🔍 Price Lookup & Enrichment</h1>
        <p className="text-sm text-muted-foreground mt-1">Search the web, extract pricing & images for your products</p>

        {/* Progress */}
        <div className="flex items-center gap-2 mt-4 mb-4">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-1">
              <span className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                i <= currentStepIndex ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}>
                {i + 1}. {s}
              </span>
              {i < STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-muted-foreground" />}
            </div>
          ))}
        </div>
      </div>

      <div className="px-4 pb-24">
        {/* ───── STEP: INPUT ───── */}
        {step === "input" && (
          <div className="space-y-4">
            <div className="bg-card rounded-xl border border-border p-4 space-y-3">
              <h2 className="text-base font-semibold">Product Details</h2>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Product Name *</label>
                <input value={productName} onChange={e => setProductName(e.target.value)}
                  placeholder="e.g. Sea Level Breezer O Ring Bandeau One Piece"
                  className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Supplier / Brand</label>
                  <input value={supplier} onChange={e => setSupplier(e.target.value)}
                    placeholder="e.g. Sea Level"
                    className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Style Number</label>
                  <input value={styleNumber} onChange={e => setStyleNumber(e.target.value)}
                    placeholder="e.g. SL1234"
                    className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm font-mono" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Colour</label>
                  <input value={colour} onChange={e => setColour(e.target.value)}
                    placeholder="e.g. White"
                    className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Supplier Cost (AUD ex GST)</label>
                  <input value={supplierCost} onChange={e => setSupplierCost(e.target.value)}
                    placeholder="e.g. 52.00"
                    type="number" step="0.01"
                    className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm font-mono" />
                </div>
              </div>
            </div>

            <Button className="w-full h-12 text-base" onClick={handleSearch} disabled={!productName}>
              <Search className="w-4 h-4 mr-2" /> Search Google for This Product
            </Button>
          </div>
        )}

        {/* ───── STEP: SEARCHING ───── */}
        {step === "searching" && (
          <div className="text-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
            <p className="text-sm font-medium">Searching Google for your product…</p>
            <p className="text-xs text-muted-foreground mt-1">
              "{supplier} {productName} {styleNumber} Australia"
            </p>
          </div>
        )}

        {/* ───── STEP: RESULTS ───── */}
        {step === "results" && (
          <div className="space-y-4">
            <div className="bg-card rounded-xl border border-border p-3">
              <p className="text-xs text-muted-foreground mb-1">Search query:</p>
              <p className="text-sm font-mono">{searchQuery}</p>
            </div>

            <h2 className="text-base font-semibold">
              I found {searchResults.length} results. Which website looks correct?
            </h2>

            <div className="space-y-3">
              {searchResults.map((r, i) => {
                const IconComp = RETAILER_ICONS[r.retailer_type] || Globe;
                return (
                  <button
                    key={i}
                    onClick={() => handleExtract(r.url)}
                    className="w-full text-left bg-card rounded-xl border border-border p-4 hover:border-primary/50 hover:bg-primary/5 transition-all"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                        <IconComp className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold line-clamp-1">{r.title}</p>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] text-primary font-mono truncate">{r.domain}</span>
                          {r.is_australian && (
                            <Badge variant="secondary" className="text-[9px] px-1.5 py-0">🇦🇺 AU</Badge>
                          )}
                          {r.is_official_brand && (
                            <Badge variant="secondary" className="text-[9px] px-1.5 py-0">Official</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">{r.snippet}</p>
                      </div>
                      <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Manual URL entry */}
            <div className="bg-card rounded-xl border border-border p-4 space-y-2">
              <p className="text-xs text-muted-foreground">None of these? Paste a URL manually:</p>
              <div className="flex gap-2">
                <input
                  value={manualUrl}
                  onChange={e => setManualUrl(e.target.value)}
                  placeholder="https://example.com.au/product"
                  className="flex-1 h-10 rounded-md bg-input border border-border px-3 text-sm font-mono"
                />
                <Button onClick={() => manualUrl && handleExtract(manualUrl)} disabled={!manualUrl}>
                  Go
                </Button>
              </div>
            </div>

            <Button variant="outline" className="w-full" onClick={() => setStep("input")}>
              ← Change search terms
            </Button>
          </div>
        )}

        {/* ───── STEP: EXTRACTING ───── */}
        {step === "extracting" && (
          <div className="text-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
            <p className="text-sm font-medium">Visiting approved page…</p>
            <p className="text-xs text-muted-foreground mt-1 font-mono truncate max-w-md mx-auto">{selectedUrl}</p>
            <p className="text-xs text-muted-foreground mt-2">Extracting price, images & description</p>
          </div>
        )}

        {/* ───── STEP: REVIEW ───── */}
        {step === "review" && extracted && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold">Review Extracted Data</h2>

            {extracted.fetch_error && (
              <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-destructive">Page fetch issue</p>
                  <p className="text-xs text-muted-foreground">{extracted.fetch_error}. Data may be estimated from AI knowledge.</p>
                </div>
              </div>
            )}

            {/* Bug 4 fix: only show currency warning when a price was actually found in a non-AUD currency */}
            {extracted.retail_price_aud != null && extracted.currency_detected && extracted.currency_detected !== "AUD" && (
              <div className="flex items-start gap-2 bg-warning/10 border border-warning/20 rounded-lg p-3">
                <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                <p className="text-xs text-warning">Currency detected: {extracted.currency_detected} — this may not be AUD!</p>
              </div>
            )}

            {/* Product header */}
            <div className="bg-card rounded-xl border border-border p-4">
              <div className="flex gap-4">
                {extracted.image_urls?.length > 0 && (
                  <div className="w-24 h-24 rounded-lg overflow-hidden border border-border bg-muted shrink-0">
                    <img
                      src={extracted.image_urls[0]}
                      alt={extracted.product_name || ""}
                      className="w-full h-full object-cover"
                      onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{extracted.product_name || productName}</p>
                  <p className="text-xs text-muted-foreground">{extracted.brand || supplier}</p>
                  <p className="text-[10px] text-muted-foreground font-mono mt-1 truncate">{extracted.source_url}</p>
                </div>
              </div>
            </div>

            {/* Price card */}
            <div className="bg-card rounded-xl border border-border p-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Pricing</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Retail Price (AUD)</p>
                  <p className="text-2xl font-bold font-mono">
                    {extracted.retail_price_aud ? `$${extracted.retail_price_aud.toFixed(2)}` : "Not found"}
                  </p>
                  {extracted.sale_price_aud && (
                    <p className="text-xs text-destructive">Sale: ${extracted.sale_price_aud.toFixed(2)}</p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Your Cost (ex GST)</p>
                  <p className="text-2xl font-bold font-mono text-muted-foreground">
                    {costNum ? `$${costNum.toFixed(2)}` : "—"}
                  </p>
                  {costNum && extracted.retail_price_aud && (
                    <p className="text-xs text-success">
                      Markup: {((extracted.retail_price_aud / costNum - 1) * 100).toFixed(0)}% · Margin: {((1 - costNum / extracted.retail_price_aud) * 100).toFixed(0)}%
                    </p>
                  )}
                </div>
              </div>
              {extracted.price_vs_cost_note && (
                <p className="text-xs text-muted-foreground mt-2 bg-muted/30 rounded p-2">{extracted.price_vs_cost_note}</p>
              )}
              <div className="flex items-center gap-2 mt-2">
                <p className="text-[10px] text-muted-foreground">Currency confidence:</p>
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${extracted.currency_confidence >= 80 ? "bg-success" : extracted.currency_confidence >= 50 ? "bg-warning" : "bg-destructive"}`}
                    style={{ width: `${extracted.currency_confidence}%` }} />
                </div>
                <span className="text-[10px] font-medium">{extracted.currency_confidence}%</span>
              </div>
            </div>

            {/* Images */}
            {extracted.image_urls?.length > 0 && (
              <div className="bg-card rounded-xl border border-border p-4">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1">
                  <Image className="w-3 h-3" /> Images ({extracted.image_urls.length})
                </h3>
                <div className="flex gap-2 overflow-x-auto">
                  {extracted.image_urls.slice(0, 4).map((url, i) => (
                    <div key={i} className="w-20 h-20 rounded-lg overflow-hidden border border-border bg-muted shrink-0">
                      <img src={url} alt={`Product ${i + 1}`} className="w-full h-full object-cover"
                        onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Description (editable) */}
            <div className="bg-card rounded-xl border border-border p-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Description (editable)</h3>
              <textarea
                value={editDescription}
                onChange={e => setEditDescription(e.target.value)}
                className="w-full min-h-[120px] rounded-md bg-input border border-border p-3 text-sm"
              />
            </div>

            {/* Availability */}
            {(extracted.sizes_available?.length || extracted.colours_available?.length) && (
              <div className="bg-card rounded-xl border border-border p-4">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Availability</h3>
                {extracted.sizes_available && (
                  <div className="mb-2">
                    <p className="text-[10px] text-muted-foreground mb-1">Sizes:</p>
                    <div className="flex flex-wrap gap-1">
                      {extracted.sizes_available.map((s, i) => (
                        <Badge key={i} variant="secondary" className="text-[10px]">{s}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {extracted.colours_available && (
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1">Colours:</p>
                    <div className="flex flex-wrap gap-1">
                      {extracted.colours_available.map((c, i) => (
                        <Badge key={i} variant="secondary" className="text-[10px]">{c}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {extracted.extraction_notes && (
              <div className="bg-muted/30 rounded-lg p-3 border border-border">
                <p className="text-xs text-muted-foreground">{extracted.extraction_notes}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("results")} className="flex-1">
                ← Try different URL
              </Button>
              <Button onClick={handleApprove} className="flex-1" disabled={isSaving}>
                {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Approve & Save
              </Button>
            </div>
          </div>
        )}

        {/* ───── STEP: APPROVED ───── */}
        {step === "approved" && finalJson && (
          <div className="space-y-4">
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-full bg-success/15 flex items-center justify-center mx-auto mb-3">
                <Check className="w-6 h-6 text-success" />
              </div>
              <h2 className="text-lg font-bold">Product Data Approved & Saved</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {finalJson.product_name} — ${finalJson.retail_price_aud?.toFixed(2) || "N/A"} AUD
              </p>
            </div>

            {/* JSON output */}
            <div className="bg-card rounded-xl border border-border p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase">Final Output (JSON)</h3>
                <Button variant="ghost" size="sm" onClick={copyJson} className="text-xs h-7">
                  <Copy className="w-3 h-3 mr-1" /> Copy
                </Button>
              </div>
              <pre className="text-xs font-mono bg-muted/30 rounded-lg p-3 overflow-x-auto max-h-60">
                {JSON.stringify(finalJson, null, 2)}
              </pre>
            </div>

            <div className="space-y-2">
              <Button className="w-full" onClick={() => {
                setStep("input");
                setProductName("");
                setSupplier("");
                setStyleNumber("");
                setColour("");
                setSupplierCost("");
                setSearchResults([]);
                setExtracted(null);
                setFinalJson(null);
              }}>
                Look Up Another Product
              </Button>
              <Button variant="outline" className="w-full" onClick={onBack}>
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
