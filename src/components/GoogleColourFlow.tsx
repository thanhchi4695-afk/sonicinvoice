import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Check, AlertTriangle, Eye, Download, Palette, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { extractColourFromTitle, extractColourFromVariant, type FeedHealthProduct } from "@/lib/feed-health";
import { supabase } from "@/integrations/supabase/client";

// ── Known swimwear colour vocabulary for keyword fallback ──
const SWIMWEAR_COLOURS = [
  "black ivory", "black white", "navy white", "rose gold", "dusty pink", "dusty rose",
  "light blue", "dark green", "hot pink", "pale blue", "deep red", "burnt orange",
  "bottle green", "sky blue", "cobalt blue", "blue bits", "green green grass",
  "kulin colour", "pink punk", "girls gone wild", "electric dreams",
  "cafe au lait",
  "black", "white", "navy", "ivory", "stone", "sand", "coral", "blush", "teal",
  "khaki", "red", "blue", "green", "pink", "yellow", "orange", "purple", "grey",
  "gray", "bronze", "gold", "silver", "nude", "tan", "olive", "cream", "midnight",
  "aqua", "mint", "indigo", "rose", "lilac", "lemon", "amber", "copper", "rust",
  "terracotta", "sage", "forest", "chocolate", "coffee", "caramel", "bluebell",
  "lavender", "peach", "emerald", "jade", "ruby", "sapphire", "merlot", "dusk",
  "cloud", "storm", "pepper", "slate", "espresso", "creme", "cafe",
].sort((a, b) => b.length - a.length);

function findKnownColourInTitle(title: string): string | null {
  const t = title.toLowerCase();
  for (const colour of SWIMWEAR_COLOURS) {
    const regex = new RegExp(`(?<![a-z])${colour.replace(/ /g, "\\s+")}(?![a-z])`, "i");
    if (regex.test(t)) {
      return colour.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    }
  }
  return null;
}

function isValidColour(s: string): boolean {
  const t = s.trim();
  if (t.length < 2 || t.length > 40) return false;
  if (/^\d+$/.test(t)) return false;
  if (t.startsWith("#")) return false;
  if (/^(N\/A|see image|variety|n\/a)$/i.test(t)) return false;
  if (/\d{2,}/.test(t)) return false;
  if (!/[a-zA-Z]/.test(t)) return false;
  const reject = ["womens", "mens", "girls", "boys", "kids", "one size", "regular", "petite", "plus"];
  if (reject.includes(t.toLowerCase())) return false;
  return true;
}

export interface ColourRow {
  handle: string;
  title: string;
  imageUrl: string;
  colour: string | null;
  rawDetected: string | null;
  method: string;
  confidence: "high" | "medium" | "low";
  overridden: boolean;
  variants: Array<{ sku: string }>;
}

interface Props { onBack: () => void }

export default function GoogleColourFlow({ onBack }: Props) {
  const [step, setStep] = useState(1);
  const [source, setSource] = useState<"invoice" | "csv">("invoice");
  const [rows, setRows] = useState<ColourRow[]>([]);
  const [visionRunning, setVisionRunning] = useState(false);
  const [visionProgress, setVisionProgress] = useState({ done: 0, total: 0 });
  const [filterTab, setFilterTab] = useState("all");

  // ── Step 1: Detect ──
  const detectFromInvoice = useCallback(() => {
    const raw = localStorage.getItem("invoice_lines");
    if (!raw) { toast.error("No invoice products found. Import an invoice first."); return; }
    const lines: any[] = JSON.parse(raw);
    const detected: ColourRow[] = lines.map(line => {
      // Tier 1: title parsing (extended with keyword fallback)
      let result = extractColourFromTitle(line.title || line.name || "");
      
      // Keyword fallback if tier 1 found nothing
      if (!result.colour) {
        const kw = findKnownColourInTitle(line.title || line.name || "");
        if (kw) result = { colour: kw, method: "title_keyword", confidence: "medium" };
      }

      // Tier 2: variant option
      if (!result.colour && line.variants?.length) {
        const vc = extractColourFromVariant(line.variants);
        if (vc) result = { colour: vc, method: "variant_option", confidence: "high" };
      }

      // Also check colour field from line
      if (!result.colour && line.colour && isValidColour(line.colour)) {
        result = { colour: line.colour, method: "line_field", confidence: "high" };
      }

      return {
        handle: (line.handle || `${(line.brand || "")} ${(line.title || line.name || "")}`.trim())
          .toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").slice(0, 60),
        title: line.title || line.name || "",
        imageUrl: line.imageUrl || line.image || "",
        colour: result.colour,
        rawDetected: result.colour,
        method: result.method,
        confidence: result.colour ? (result.confidence as "high" | "medium" | "low") : "low",
        overridden: false,
        variants: line.variants || [{ sku: line.sku || "" }],
      };
    });
    setRows(detected);
    localStorage.setItem("google_colours", JSON.stringify(detected));
    setStep(2);
  }, []);

  const handleCSVUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const lines = text.split("\n");
        const headers = lines[0].split(",").map(h => h.replace(/"/g, "").trim().toLowerCase());
        const titleIdx = headers.findIndex(h => h === "title");
        const handleIdx = headers.findIndex(h => h === "handle");
        const imgIdx = headers.findIndex(h => h.includes("image"));
        const skuIdx = headers.findIndex(h => h.includes("sku") || h.includes("variant sku"));

        if (titleIdx < 0) { toast.error("CSV must have a 'Title' column"); return; }

        const detected: ColourRow[] = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(",").map(c => c.replace(/"/g, "").trim());
          const title = cols[titleIdx] || "";
          if (!title) continue;

          let result = extractColourFromTitle(title);
          if (!result.colour) {
            const kw = findKnownColourInTitle(title);
            if (kw) result = { colour: kw, method: "title_keyword", confidence: "medium" };
          }

          detected.push({
            handle: cols[handleIdx] || title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").slice(0, 60),
            title,
            imageUrl: cols[imgIdx] || "",
            colour: result.colour,
            rawDetected: result.colour,
            method: result.method,
            confidence: result.colour ? (result.confidence as any) : "low",
            overridden: false,
            variants: [{ sku: cols[skuIdx] || "" }],
          });
        }
        setRows(detected);
        localStorage.setItem("google_colours", JSON.stringify(detected));
        setStep(2);
      } catch { toast.error("Failed to parse CSV"); }
    };
    reader.readAsText(file);
  }, []);

  // ── Stats ──
  const highConf = rows.filter(r => r.colour && r.confidence === "high").length;
  const medConf = rows.filter(r => r.colour && r.confidence === "medium").length;
  const noColour = rows.filter(r => !r.colour).length;

  // ── Step 2: Vision (optional) ──
  const runVision = useCallback(async () => {
    const missing = rows.filter(r => !r.colour && r.imageUrl);
    if (missing.length === 0) { toast.info("All products already have colours"); return; }
    setVisionRunning(true);
    setVisionProgress({ done: 0, total: missing.length });

    for (let i = 0; i < missing.length; i++) {
      const row = missing[i];
      try {
        const { data, error } = await supabase.functions.invoke("scan-mode-ai", {
          body: {
            imageUrl: row.imageUrl,
            prompt: `Identify the main colour of the product in this image. Title: "${row.title}". Return ONLY the colour name (e.g. "Black", "Emerald", "Cafe"). Max 40 characters. Use "/" for multi-colour (e.g. "Black/White"). No hex codes, no sentences.`,
          },
        });

        if (!error && data?.colour) {
          const colour = (data.colour || data.product_title || "").trim();
          if (isValidColour(colour)) {
            setRows(prev => prev.map(r =>
              r.handle === row.handle ? { ...r, colour, rawDetected: colour, method: "vision", confidence: "medium" as const } : r
            ));
          }
        }
      } catch { /* skip */ }
      setVisionProgress({ done: i + 1, total: missing.length });
      if (i < missing.length - 1) await new Promise(r => setTimeout(r, 700));
    }
    setVisionRunning(false);
    toast.success("Vision analysis complete");
  }, [rows]);

  // ── Step 3: Edit ──
  const updateColour = (handle: string, val: string) => {
    setRows(prev => prev.map(r =>
      r.handle === handle ? { ...r, colour: val || null, overridden: true, method: val ? "manual" : r.method } : r
    ));
  };

  // ── Step 4: Export ──
  const exportCSV = useCallback((combined = false) => {
    const validRows = rows.filter(r => r.colour && isValidColour(r.colour!));
    if (validRows.length === 0) { toast.error("No valid colours to export"); return; }

    const adsData = combined ? (() => {
      try { return JSON.parse(localStorage.getItem("google_ads_detections") || "[]"); } catch { return []; }
    })() : [];

    const headers = [
      "Handle", "Command", "Variant SKU",
      "Variant Metafield: mm-google-shopping.color [single_line_text]",
      ...(combined ? [
        "Metafield: mm-google-shopping.gender [single_line_text]",
        "Metafield: mm-google-shopping.age_group [single_line_text]",
      ] : []),
    ];

    const csvRows = [headers.map(h => `"${h}"`).join(",")];

    validRows.forEach(row => {
      const adsRow = adsData.find((a: any) => a.handle === row.handle);
      const variants = row.variants.length > 0 ? row.variants : [{ sku: "" }];
      variants.forEach(v => {
        const line = [
          `"${row.handle}"`,
          `"MERGE"`,
          `"${v.sku || ""}"`,
          `"${row.colour}"`,
          ...(combined ? [
            `"${adsRow?.gender || ""}"`,
            `"${adsRow?.ageGroup || ""}"`,
          ] : []),
        ];
        csvRows.push(line.join(","));
      });
    });

    const csv = "\uFEFF" + csvRows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Products.csv";
    a.click();
    URL.revokeObjectURL(url);

    const totalVariants = validRows.reduce((s, r) => s + Math.max(r.variants.length, 1), 0);
    localStorage.setItem("google_colours_last_export", JSON.stringify({
      exportedAt: new Date().toISOString(),
      productCount: validRows.length,
      variantRows: totalVariants,
    }));
    toast.success(`Exported ${validRows.length} products (${totalVariants} variant rows)`);
  }, [rows]);

  const filteredRows = rows.filter(r => {
    if (filterTab === "high") return r.colour && r.confidence === "high";
    if (filterTab === "needs_check") return !r.colour || r.confidence === "low" || r.confidence === "medium";
    if (filterTab === "vision") return r.method === "vision";
    if (filterTab === "edited") return r.overridden;
    return true;
  });

  const hasAdsData = (() => {
    try { return JSON.parse(localStorage.getItem("google_ads_detections") || "[]").length > 0; } catch { return false; }
  })();

  const validExportCount = rows.filter(r => r.colour && isValidColour(r.colour!)).length;

  return (
    <div className="min-h-screen pb-24">
      {/* Header */}
      <div className="px-4 pt-4 pb-2">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground mb-3 hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-2 mb-1">
          <Palette className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-bold">Google Colours</h1>
        </div>
        <p className="text-sm text-muted-foreground">Auto-detect product colours for Google Shopping</p>
      </div>

      {/* Progress steps */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-1 text-xs">
          {["Detect", "Vision", "Review", "Export"].map((label, i) => (
            <div key={label} className="flex items-center gap-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                step > i + 1 ? "bg-primary text-primary-foreground" :
                step === i + 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}>{step > i + 1 ? <Check className="w-3 h-3" /> : i + 1}</div>
              <span className={step === i + 1 ? "font-semibold text-foreground" : "text-muted-foreground"}>{label}</span>
              {i < 3 && <ChevronRight className="w-3 h-3 text-muted-foreground" />}
            </div>
          ))}
        </div>
      </div>

      <div className="px-4">
        {/* ── STEP 1: Detect ── */}
        {step === 1 && (
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Detect colours from product titles</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">Reads colour names directly from titles — no API needed for most products.</p>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={source === "invoice"} onChange={() => setSource("invoice")} className="accent-primary" />
                    <span className="text-sm">Current invoice products</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={source === "csv"} onChange={() => setSource("csv")} className="accent-primary" />
                    <span className="text-sm">Upload CSV (Handle + Title + Image Src)</span>
                  </label>
                </div>
                {source === "invoice" ? (
                  <Button onClick={detectFromInvoice} className="w-full">Detect all</Button>
                ) : (
                  <Input type="file" accept=".csv" onChange={handleCSVUpload} />
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── STEP 2: Summary + Vision ── */}
        {step === 2 && (
          <div className="space-y-4">
            <Card>
              <CardContent className="pt-6 space-y-2">
                <p className="text-sm font-semibold">{rows.length} products detected</p>
                <div className="space-y-1 text-sm">
                  <div className="flex items-center gap-2"><Check className="w-4 h-4 text-primary" /> High confidence: {highConf}</div>
                  <div className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-secondary" /> Medium confidence: {medConf}</div>
                  <div className="flex items-center gap-2"><Eye className="w-4 h-4 text-destructive" /> No colour found: {noColour}</div>
                </div>
              </CardContent>
            </Card>

            {noColour > 0 && (
              <Card className="border-secondary/30">
                <CardContent className="pt-6 space-y-3">
                  <p className="text-sm">{noColour} products need Vision analysis to detect colour from images.</p>
                  <p className="text-xs text-muted-foreground">~{noColour} images × ~$0.01 ≈ ~${(noColour * 0.01).toFixed(2)}</p>
                  {visionRunning ? (
                    <div className="space-y-2">
                      <Progress value={(visionProgress.done / visionProgress.total) * 100} className="h-2" />
                      <p className="text-xs text-muted-foreground">Analysing image {visionProgress.done} of {visionProgress.total}…</p>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button onClick={runVision} size="sm">Run Vision on {noColour} products</Button>
                      <Button variant="ghost" size="sm" onClick={() => setStep(3)}>Skip → Review</Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {!visionRunning && (
              <Button onClick={() => setStep(3)} className="w-full">Continue to review <ChevronRight className="w-4 h-4 ml-1" /></Button>
            )}
          </div>
        )}

        {/* ── STEP 3: Review ── */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="bg-secondary/10 border border-secondary/20 rounded-lg p-3 text-xs">
              <p className="font-medium">⚠ Google requires the colour value to match your product page exactly.</p>
              <p className="text-muted-foreground mt-1">Funkita print names like "Kulin Colour" and "Blue Bits" are valid — they appear on the page.</p>
            </div>

            <Tabs value={filterTab} onValueChange={setFilterTab}>
              <TabsList className="w-full">
                <TabsTrigger value="all" className="flex-1 text-xs">All ({rows.length})</TabsTrigger>
                <TabsTrigger value="high" className="flex-1 text-xs">High ({highConf})</TabsTrigger>
                <TabsTrigger value="needs_check" className="flex-1 text-xs">Check ({noColour + medConf})</TabsTrigger>
                <TabsTrigger value="vision" className="flex-1 text-xs">Vision</TabsTrigger>
                <TabsTrigger value="edited" className="flex-1 text-xs">Edited</TabsTrigger>
              </TabsList>
              <TabsContent value={filterTab}>
                <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                  {filteredRows.map(row => (
                    <div key={row.handle} className="flex items-center gap-2 bg-card rounded-lg border p-2">
                      {row.imageUrl && (
                        <img src={row.imageUrl} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{row.title}</p>
                        <div className="flex items-center gap-1 mt-0.5">
                          <Badge variant={row.confidence === "high" ? "default" : row.confidence === "medium" ? "secondary" : "destructive"} className="text-[9px] px-1.5 py-0">
                            {row.method === "vision" ? "Vision" : row.method === "manual" ? "Manual" : row.method.includes("title") ? "Title" : row.method === "variant_option" ? "Variant" : row.method === "line_field" ? "Field" : "—"}
                          </Badge>
                        </div>
                      </div>
                      <Input
                        value={row.colour || ""}
                        onChange={e => updateColour(row.handle, e.target.value)}
                        placeholder="Enter colour"
                        className={`w-32 h-8 text-xs ${row.colour && !isValidColour(row.colour) ? "border-destructive" : ""}`}
                      />
                      {row.colour && isValidColour(row.colour) && <Check className="w-4 h-4 text-primary shrink-0" />}
                      {row.colour && !isValidColour(row.colour) && <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />}
                    </div>
                  ))}
                  {filteredRows.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No products match this filter</p>}
                </div>
              </TabsContent>
            </Tabs>

            <Button onClick={() => setStep(4)} className="w-full">Continue to export <ChevronRight className="w-4 h-4 ml-1" /></Button>
          </div>
        )}

        {/* ── STEP 4: Export ── */}
        {step === 4 && (
          <div className="space-y-4">
            <Card>
              <CardContent className="pt-6 space-y-3">
                <p className="text-sm font-semibold">Export summary</p>
                <div className="text-sm space-y-1">
                  <p>Products with colour: <strong>{validExportCount}</strong></p>
                  <p>Skipped (no valid colour): <strong>{rows.length - validExportCount}</strong></p>
                  <p>Variant rows: <strong>{rows.filter(r => r.colour && isValidColour(r.colour!)).reduce((s, r) => s + Math.max(r.variants.length, 1), 0)}</strong></p>
                  <div className="text-xs text-muted-foreground mt-2 space-y-0.5">
                    <p>From title: {rows.filter(r => r.method.includes("title")).length}</p>
                    <p>From variant: {rows.filter(r => r.method === "variant_option").length}</p>
                    <p>From vision: {rows.filter(r => r.method === "vision").length}</p>
                    <p>Manual: {rows.filter(r => r.method === "manual").length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Button onClick={() => exportCSV(false)} className="w-full" disabled={validExportCount === 0}>
              <Download className="w-4 h-4 mr-2" /> Download Products.csv
            </Button>

            {hasAdsData && (
              <Button variant="outline" onClick={() => exportCSV(true)} className="w-full" disabled={validExportCount === 0}>
                <Download className="w-4 h-4 mr-2" /> Download combined CSV (colour + age/gender)
              </Button>
            )}

            <Card className="border-muted">
              <CardContent className="pt-4 text-xs text-muted-foreground space-y-2">
                <p className="font-medium text-foreground">After importing via Matrixify:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Go to Google Merchant Center Next</li>
                  <li>Products → Needs attention → Prioritized fixes</li>
                  <li>The "Add missing colors" notification should clear within 24–48 hours</li>
                </ol>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
