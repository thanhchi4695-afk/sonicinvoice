import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Check, AlertTriangle, ChevronRight, Download } from "lucide-react";
import { toast } from "sonner";
import { detectGender, detectAgeGroup } from "@/lib/feed-health";

// ── Confidence scoring ──
function scoreConfidence(
  product: { title: string; tags: string; type: string },
  ageGroup: string,
  gender: string
): { score: number; level: "high" | "medium" | "low"; reasons: string[] } {
  const title = (product.title || "").toLowerCase();
  const tags = (product.tags || "").toLowerCase();
  const type = (product.type || "").toLowerCase();
  let score = 0;
  const reasons: string[] = [];

  if (tags.includes(ageGroup)) { score += 40; reasons.push(`tag contains "${ageGroup}"`); }
  if (title.includes(ageGroup)) { score += 30; reasons.push(`title contains "${ageGroup}"`); }
  if (type.includes(ageGroup)) { score += 20; reasons.push(`type contains "${ageGroup}"`); }
  if (ageGroup === "adult" && score === 0) { score = 70; reasons.push("defaulted to adult (safe default)"); }

  if (tags.includes(gender === "female" ? "womens" : gender)) { score += 40; reasons.push("tag contains gender indicator"); }
  if (title.includes(gender)) { score += 20; reasons.push("title contains gender"); }
  if (gender === "female" && score < 40 && !tags.includes("mens") && !tags.includes("boys")) {
    score += 30; reasons.push("defaulted to female (womens-dominant)");
  }

  const level = score >= 70 ? "high" : score >= 40 ? "medium" : "low";
  return { score, level, reasons };
}

interface DetectedRow {
  handle: string;
  title: string;
  vendor: string;
  type: string;
  tags: string;
  ageGroup: string;
  gender: string;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  overridden: boolean;
  variants: Array<{ sku: string }>;
}

interface Props { onBack: () => void }

const AGE_GROUPS = ["adult", "kids", "toddler", "infant", "newborn"] as const;
const GENDERS = ["female", "male", "unisex"] as const;

export default function GoogleAdsFlow({ onBack }: Props) {
  const [step, setStep] = useState(1);
  const [source, setSource] = useState<"invoice" | "csv">("invoice");
  const [rows, setRows] = useState<DetectedRow[]>([]);
  const [filterTab, setFilterTab] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── Step 1: Detect ──
  const detectFromInvoice = useCallback(() => {
    const raw = localStorage.getItem("invoice_lines");
    if (!raw) { toast.error("No invoice products found. Import an invoice first."); return; }
    const lines: any[] = JSON.parse(raw);
    const detected = runDetection(lines);
    setRows(detected);
    localStorage.setItem("google_ads_detections", JSON.stringify(detected));
    setStep(2);
  }, []);

  const handleCSVUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const csvLines = text.split("\n");
        const headers = csvLines[0].split(",").map(h => h.replace(/"/g, "").trim().toLowerCase());
        const titleIdx = headers.findIndex(h => h === "title");
        const handleIdx = headers.findIndex(h => h === "handle");
        const tagsIdx = headers.findIndex(h => h === "tags");
        const typeIdx = headers.findIndex(h => h.includes("type") || h.includes("product type"));
        const vendorIdx = headers.findIndex(h => h === "vendor");

        if (titleIdx < 0) { toast.error("CSV must have a 'Title' column"); return; }

        const products = [];
        for (let i = 1; i < csvLines.length; i++) {
          const cols = csvLines[i].split(",").map(c => c.replace(/"/g, "").trim());
          if (!cols[titleIdx]) continue;
          products.push({
            title: cols[titleIdx] || "",
            name: cols[titleIdx] || "",
            handle: cols[handleIdx] || "",
            tags: cols[tagsIdx] || "",
            type: cols[typeIdx] || "",
            vendor: cols[vendorIdx] || "",
            variants: [],
          });
        }
        const detected = runDetection(products);
        setRows(detected);
        localStorage.setItem("google_ads_detections", JSON.stringify(detected));
        setStep(2);
      } catch { toast.error("Failed to parse CSV"); }
    };
    reader.readAsText(file);
  }, []);

  function runDetection(lines: any[]): DetectedRow[] {
    return lines.map(line => {
      const feedProduct = {
        id: "",
        title: line.title || line.name || "",
        handle: line.handle || (line.title || line.name || "").toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").slice(0, 60),
        vendor: line.vendor || line.brand || "",
        productType: line.type || line.product_type || "",
        tags: typeof line.tags === "string" ? line.tags.split(",").map((t: string) => t.trim()) : (line.tags || []),
        imageUrl: null,
        variants: line.variants || [],
      };

      const gender = detectGender(feedProduct);
      const age = detectAgeGroup(feedProduct);
      const tagsStr = feedProduct.tags.join(", ");
      const conf = scoreConfidence(
        { title: feedProduct.title, tags: tagsStr, type: feedProduct.productType },
        age.value, gender.value
      );

      return {
        handle: feedProduct.handle,
        title: feedProduct.title,
        vendor: feedProduct.vendor,
        type: feedProduct.productType,
        tags: tagsStr,
        ageGroup: age.value,
        gender: gender.value,
        confidence: conf.level,
        reasons: conf.reasons,
        overridden: false,
        variants: line.variants || [{ sku: line.sku || "" }],
      };
    });
  }

  // ── Stats ──
  const highConf = rows.filter(r => r.confidence === "high").length;
  const medConf = rows.filter(r => r.confidence === "medium").length;
  const lowConf = rows.filter(r => r.confidence === "low").length;
  const byAge = AGE_GROUPS.map(a => ({ label: a, count: rows.filter(r => r.ageGroup === a).length }));
  const byGender = GENDERS.map(g => ({ label: g, count: rows.filter(r => r.gender === g).length }));

  // ── Bulk actions ──
  const bulkSet = (field: "ageGroup" | "gender", value: string) => {
    setRows(prev => prev.map(r => selected.has(r.handle) ? { ...r, [field]: value, overridden: true } : r));
    setSelected(new Set());
    toast.success(`Set ${field} to ${value} for ${selected.size} products`);
  };

  const toggleSelect = (handle: string) => {
    setSelected(prev => { const n = new Set(prev); n.has(handle) ? n.delete(handle) : n.add(handle); return n; });
  };

  // ── Filter ──
  const filteredRows = rows.filter(r => {
    if (filterTab === "low") return r.confidence === "low";
    if (filterTab === "kids") return ["kids", "toddler", "infant", "newborn"].includes(r.ageGroup);
    if (filterTab === "mens") return r.gender === "male";
    if (filterTab === "check") return hasWarning(r);
    return true;
  });

  function hasWarning(r: DetectedRow) {
    const t = r.title.toLowerCase();
    const tags = r.tags.toLowerCase();
    if (t.includes("kids") && r.ageGroup === "adult") return true;
    if ((t.includes("mens") || t.includes("boys")) && r.gender === "female") return true;
    if (r.type.toLowerCase().includes("boardshort") && r.gender === "female") return true;
    if (r.type.toLowerCase().includes("bikini") && r.gender === "male") return true;
    if (!tags) return true;
    return false;
  }

  // ── Export ──
  const exportMatrixify = useCallback(() => {
    const headers = [
      "Handle", "Command", "Variant SKU",
      "Variant Metafield: mm-google-shopping.age_group [single_line_text]",
      "Variant Metafield: mm-google-shopping.gender [single_line_text]",
    ];
    const csvRows = [headers.map(h => `"${h}"`).join(",")];
    let variantCount = 0;

    rows.forEach(row => {
      const variants = row.variants.length > 0 ? row.variants : [{ sku: "" }];
      variants.forEach(v => {
        csvRows.push([
          `"${row.handle}"`, `"MERGE"`, `"${v.sku || ""}"`,
          `"${row.ageGroup}"`, `"${row.gender}"`,
        ].join(","));
        variantCount++;
      });
    });

    downloadCSV("\uFEFF" + csvRows.join("\n"), "Products.csv");
    localStorage.setItem("google_ads_last_export", JSON.stringify({
      exportedAt: new Date().toISOString(), productCount: rows.length, variantRows: variantCount,
    }));
    toast.success(`Exported ${rows.length} products (${variantCount} variant rows)`);
  }, [rows]);

  const exportShopifyNative = useCallback(() => {
    const headers = ["Handle", "Google Shopping / Gender", "Google Shopping / Age Group"];
    const csvRows = [headers.map(h => `"${h}"`).join(",")];
    const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

    rows.forEach(row => {
      csvRows.push([
        `"${row.handle}"`, `"${titleCase(row.gender)}"`, `"${titleCase(row.ageGroup)}"`,
      ].join(","));
    });

    downloadCSV("\uFEFF" + csvRows.join("\n"), "Products-Shopify-Native.csv");
    toast.success("Exported Shopify native CSV");
  }, [rows]);

  function downloadCSV(csv: string, filename: string) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="min-h-screen pb-24">
      <div className="px-4 pt-4 pb-2">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground mb-3 hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xl">📢</span>
          <h1 className="text-xl font-bold">Google Ads Attributes</h1>
        </div>
        <p className="text-sm text-muted-foreground">Auto-detect age_group and gender for Google Shopping approval</p>
      </div>

      {/* Progress */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-1 text-xs">
          {["Detect", "Review", "Export"].map((label, i) => (
            <div key={label} className="flex items-center gap-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                step > i + 1 ? "bg-primary text-primary-foreground" :
                step === i + 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}>{step > i + 1 ? <Check className="w-3 h-3" /> : i + 1}</div>
              <span className={step === i + 1 ? "font-semibold text-foreground" : "text-muted-foreground"}>{label}</span>
              {i < 2 && <ChevronRight className="w-3 h-3 text-muted-foreground" />}
            </div>
          ))}
        </div>
      </div>

      <div className="px-4">
        {/* ── STEP 1 ── */}
        {step === 1 && (
          <div className="space-y-4">
            <Card>
              <CardContent className="pt-6 space-y-3">
                <p className="text-sm font-semibold">Auto-detect age group and gender</p>
                <p className="text-sm text-muted-foreground">Reads tags, type, and title — no API needed.</p>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={source === "invoice"} onChange={() => setSource("invoice")} className="accent-primary" />
                    <span className="text-sm">Current invoice products</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={source === "csv"} onChange={() => setSource("csv")} className="accent-primary" />
                    <span className="text-sm">Upload CSV (Handle + Title + Tags + Type + Vendor)</span>
                  </label>
                </div>
                {source === "invoice" ? (
                  <Button onClick={detectFromInvoice} className="w-full">Detect all products</Button>
                ) : (
                  <Input type="file" accept=".csv" onChange={handleCSVUpload} />
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── STEP 2 ── */}
        {step === 2 && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-2">
              <Card><CardContent className="pt-4 text-center">
                <p className="text-lg font-bold text-primary">{highConf}</p>
                <p className="text-[10px] text-muted-foreground">High confidence</p>
              </CardContent></Card>
              <Card><CardContent className="pt-4 text-center">
                <p className="text-lg font-bold text-secondary">{medConf}</p>
                <p className="text-[10px] text-muted-foreground">Medium</p>
              </CardContent></Card>
              <Card><CardContent className="pt-4 text-center">
                <p className="text-lg font-bold text-destructive">{lowConf}</p>
                <p className="text-[10px] text-muted-foreground">Low / review</p>
              </CardContent></Card>
            </div>

            <div className="flex flex-wrap gap-1">
              {byAge.filter(a => a.count > 0).map(a => (
                <Badge key={a.label} variant="outline" className="text-[10px]">{a.label}: {a.count}</Badge>
              ))}
              {byGender.filter(g => g.count > 0).map(g => (
                <Badge key={g.label} variant="secondary" className="text-[10px]">{g.label}: {g.count}</Badge>
              ))}
            </div>

            {lowConf > 0 && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-xs">
                <p className="font-medium">⚠ {lowConf} products have low confidence. Review before exporting.</p>
              </div>
            )}

            {/* Bulk actions */}
            {selected.size > 0 && (
              <div className="bg-muted rounded-lg p-2 flex flex-wrap gap-1 items-center text-xs">
                <span className="font-medium">{selected.size} selected:</span>
                {AGE_GROUPS.map(a => <Button key={a} size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => bulkSet("ageGroup", a)}>{a}</Button>)}
                <span className="text-muted-foreground mx-1">|</span>
                {GENDERS.map(g => <Button key={g} size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => bulkSet("gender", g)}>{g}</Button>)}
              </div>
            )}

            <Tabs value={filterTab} onValueChange={setFilterTab}>
              <TabsList className="w-full">
                <TabsTrigger value="all" className="flex-1 text-xs">All ({rows.length})</TabsTrigger>
                <TabsTrigger value="low" className="flex-1 text-xs">Review ({lowConf})</TabsTrigger>
                <TabsTrigger value="kids" className="flex-1 text-xs">Kids</TabsTrigger>
                <TabsTrigger value="mens" className="flex-1 text-xs">Mens</TabsTrigger>
                <TabsTrigger value="check" className="flex-1 text-xs">Check</TabsTrigger>
              </TabsList>
              <TabsContent value={filterTab}>
                <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
                  {filteredRows.map(row => (
                    <div key={row.handle} className="flex items-center gap-2 bg-card rounded-lg border p-2">
                      <input
                        type="checkbox"
                        checked={selected.has(row.handle)}
                        onChange={() => toggleSelect(row.handle)}
                        className="accent-primary shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{row.title}</p>
                        <div className="flex items-center gap-1 mt-0.5">
                          {row.vendor && <span className="text-[9px] text-muted-foreground">{row.vendor}</span>}
                          {hasWarning(row) && <AlertTriangle className="w-3 h-3 text-destructive" />}
                          {row.overridden && <Badge variant="outline" className="text-[8px] px-1 py-0">edited</Badge>}
                        </div>
                      </div>
                      <select
                        value={row.ageGroup}
                        onChange={e => setRows(prev => prev.map(r => r.handle === row.handle ? { ...r, ageGroup: e.target.value, overridden: true } : r))}
                        className="h-7 text-[10px] rounded border bg-background px-1"
                      >
                        {AGE_GROUPS.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                      <select
                        value={row.gender}
                        onChange={e => setRows(prev => prev.map(r => r.handle === row.handle ? { ...r, gender: e.target.value, overridden: true } : r))}
                        className="h-7 text-[10px] rounded border bg-background px-1"
                      >
                        {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
                      </select>
                      <Badge variant={row.confidence === "high" ? "default" : row.confidence === "medium" ? "secondary" : "destructive"} className="text-[8px] px-1.5 py-0 shrink-0">
                        {row.confidence}
                      </Badge>
                    </div>
                  ))}
                  {filteredRows.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No products match this filter</p>}
                </div>
              </TabsContent>
            </Tabs>

            <Button onClick={() => { localStorage.setItem("google_ads_detections", JSON.stringify(rows)); setStep(3); }} className="w-full">
              Continue to export <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* ── STEP 3 ── */}
        {step === 3 && (
          <div className="space-y-4">
            <Card>
              <CardContent className="pt-6 space-y-2 text-sm">
                <p className="font-semibold">Export summary</p>
                <p>Products: <strong>{rows.length}</strong></p>
                <p>Variant rows: <strong>{rows.reduce((s, r) => s + Math.max(r.variants.length, 1), 0)}</strong></p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {byAge.filter(a => a.count > 0).map(a => <Badge key={a.label} variant="outline" className="text-[10px]">{a.label}: {a.count}</Badge>)}
                  {byGender.filter(g => g.count > 0).map(g => <Badge key={g.label} variant="secondary" className="text-[10px]">{g.label}: {g.count}</Badge>)}
                </div>
              </CardContent>
            </Card>

            <Button onClick={exportMatrixify} className="w-full">
              <Download className="w-4 h-4 mr-2" /> Download Products.csv (Matrixify)
            </Button>

            <Button variant="outline" onClick={exportShopifyNative} className="w-full">
              <Download className="w-4 h-4 mr-2" /> Download for Shopify native import
            </Button>

            <p className="text-[10px] text-muted-foreground">
              ⚠ Shopify native format uses the older 'google' namespace. Matrixify format (above) is recommended.
            </p>

            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">How to import via Matrixify</summary>
              <ol className="list-decimal list-inside space-y-1 mt-2">
                <li>Open Matrixify → New Import</li>
                <li>Upload Products.csv</li>
                <li>Wait for analysis — confirm "Products" detected</li>
                <li>Click Import</li>
                <li>Verify in Google & YouTube app → Manage Products</li>
                <li>Errors clear within 24–48 hours as Google re-crawls</li>
              </ol>
              <p className="mt-2">Matrixify stores values in the mm-google-shopping namespace (correct for the Google & YouTube channel app).</p>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
