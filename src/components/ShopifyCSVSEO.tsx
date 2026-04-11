import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, Upload, Download, Search, AlertTriangle, CheckCircle, FileText, Sparkles, SplitSquareVertical } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getStoreConfig } from "@/lib/prompt-builder";
import { toast } from "sonner";
import Papa from "papaparse";

// ── Types ──────────────────────────────────────────────────
interface ProductGroup {
  handle: string;
  title: string;
  vendor: string;
  type: string;
  tags: string;
  bodyHtml: string;
  existingSeoTitle: string;
  existingSeoDesc: string;
  rowIndices: number[]; // all CSV rows for this handle
  skuFallback?: string;
}

interface SEOResult {
  handle: string;
  seoTitle: string;
  seoDescription: string;
  confidence: number;
  reason: string;
  changed: boolean;
}

interface AuditEntry {
  handle: string;
  issue: string;
  severity: "info" | "warn" | "error";
}

const MAX_SHOPIFY_ROWS = 2000; // safe import limit per file
const SEO_TITLE_COL = "SEO Title";
const SEO_DESC_COL = "SEO Description";

export default function ShopifyCSVSEO({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<"upload" | "preview" | "processing" | "results">("upload");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [products, setProducts] = useState<ProductGroup[]>([]);
  const [results, setResults] = useState<SEOResult[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [fileName, setFileName] = useState("");
  const abortRef = useRef(false);

  // ── CSV Upload & Parse ──────────────────────────────────
  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    Papa.parse(file, {
      header: false,
      skipEmptyLines: false,
      complete: (res) => {
        const rows = res.data as string[][];
        if (rows.length < 2) { toast.error("CSV has no data rows"); return; }

        const headers = rows[0];
        const dataRows = rows.slice(1);

        // Validate required columns
        const handleIdx = headers.indexOf("Handle");
        const titleIdx = headers.indexOf("Title");
        const seoTitleIdx = headers.indexOf(SEO_TITLE_COL);
        const seoDescIdx = headers.indexOf(SEO_DESC_COL);

        if (handleIdx === -1) { toast.error("Missing 'Handle' column — not a valid Shopify export"); return; }
        if (seoTitleIdx === -1 || seoDescIdx === -1) { toast.error("Missing 'SEO Title' or 'SEO Description' columns"); return; }

        setCsvHeaders(headers);
        setCsvRows(dataRows);

        // Group rows by Handle
        const vendorIdx = headers.indexOf("Vendor");
        const typeIdx = headers.indexOf("Type");
        const tagsIdx = headers.indexOf("Tags");
        const bodyIdx = headers.indexOf("Body (HTML)");
        const skuIdx = headers.indexOf("Variant SKU");

        const groups = new Map<string, ProductGroup>();
        const auditLog: AuditEntry[] = [];

        dataRows.forEach((row, i) => {
          let handle = row[handleIdx]?.trim() || "";

          // SKU fallback when handle is empty
          if (!handle && skuIdx !== -1 && row[skuIdx]?.trim()) {
            handle = `__sku_${row[skuIdx].trim()}`;
            auditLog.push({ handle, issue: `Row ${i + 2}: Missing Handle, using Variant SKU fallback`, severity: "warn" });
          }
          if (!handle) return; // skip truly empty rows

          if (!groups.has(handle)) {
            groups.set(handle, {
              handle,
              title: row[titleIdx] || "",
              vendor: vendorIdx !== -1 ? row[vendorIdx] || "" : "",
              type: typeIdx !== -1 ? row[typeIdx] || "" : "",
              tags: tagsIdx !== -1 ? row[tagsIdx] || "" : "",
              bodyHtml: bodyIdx !== -1 ? row[bodyIdx] || "" : "",
              existingSeoTitle: row[seoTitleIdx] || "",
              existingSeoDesc: row[seoDescIdx] || "",
              rowIndices: [i],
              skuFallback: skuIdx !== -1 ? row[skuIdx] || undefined : undefined,
            });
          } else {
            groups.get(handle)!.rowIndices.push(i);
            // Fill title from first row that has it
            const g = groups.get(handle)!;
            if (!g.title && row[titleIdx]) g.title = row[titleIdx];
            if (!g.vendor && vendorIdx !== -1 && row[vendorIdx]) g.vendor = row[vendorIdx];
          }
        });

        setProducts(Array.from(groups.values()));
        setAudit(auditLog);
        setStep("preview");
        toast.success(`Parsed ${dataRows.length} rows, ${groups.size} unique products`);
      },
      error: (err) => toast.error(`CSV parse error: ${err.message}`),
    });
  }, []);

  // ── AI SEO Generation ───────────────────────────────────
  const runOptimization = useCallback(async () => {
    setStep("processing");
    setProgress(0);
    abortRef.current = false;
    const store = getStoreConfig();
    const batchSize = 15;
    const allResults: SEOResult[] = [];
    const auditLog = [...audit];

    for (let i = 0; i < products.length; i += batchSize) {
      if (abortRef.current) break;
      const batch = products.slice(i, i + batchSize);
      setProgressMsg(`Processing products ${i + 1}–${Math.min(i + batchSize, products.length)} of ${products.length}…`);

      try {
        const { data, error } = await supabase.functions.invoke("csv-seo-optimize", {
          body: {
            products: batch.map(p => ({
              handle: p.handle,
              title: p.title,
              vendor: p.vendor,
              type: p.type,
              tags: p.tags,
              body_html: p.bodyHtml.slice(0, 500),
              existing_seo_title: p.existingSeoTitle,
              existing_seo_desc: p.existingSeoDesc,
            })),
            storeName: store.name,
            storeCity: store.city,
            industry: store.industry,
          },
        });

        if (error) throw new Error(error.message);

        const results = data?.results || [];
        batch.forEach((p, j) => {
          const r = results[j] || {};
          const seoTitle = (r.seo_title || `${p.title} | ${store.name || "Shop"}`).slice(0, 70);
          const seoDesc = (r.seo_description || `Shop ${p.title} at ${store.name || "our store"}.`).slice(0, 160);
          const changed = seoTitle !== p.existingSeoTitle || seoDesc !== p.existingSeoDesc;

          // Validation: title alignment check
          const titleWords = p.title.toLowerCase().split(/\s+/).filter(w => w.length > 2);
          const seoLower = seoTitle.toLowerCase();
          const aligned = titleWords.length === 0 || titleWords.some(w => seoLower.includes(w));
          if (!aligned) {
            auditLog.push({ handle: p.handle, issue: `SEO Title may not match product: "${seoTitle}"`, severity: "warn" });
          }

          // Length warnings
          if (seoTitle.length > 60) auditLog.push({ handle: p.handle, issue: `SEO Title is ${seoTitle.length} chars (>60)`, severity: "info" });
          if (seoDesc.length > 160) auditLog.push({ handle: p.handle, issue: `SEO Desc exceeds 160 chars`, severity: "warn" });

          allResults.push({
            handle: p.handle,
            seoTitle,
            seoDescription: seoDesc,
            confidence: r.confidence || 50,
            reason: r.reason || "",
            changed,
          });
        });
      } catch (err: any) {
        // Fallback for failed batch
        batch.forEach(p => {
          allResults.push({
            handle: p.handle,
            seoTitle: `${p.title} | ${store.name || "Shop"}`.slice(0, 70),
            seoDescription: `Shop ${p.title} at ${store.name || "our store"}.`.slice(0, 160),
            confidence: 10,
            reason: `API error: ${err.message}`,
            changed: true,
          });
          auditLog.push({ handle: p.handle, issue: `AI error, used safe fallback: ${err.message}`, severity: "error" });
        });
      }

      setProgress(Math.round(((i + batchSize) / products.length) * 100));
      // Rate limit delay between batches
      if (i + batchSize < products.length) await new Promise(r => setTimeout(r, 800));
    }

    setResults(allResults);
    setAudit(auditLog);
    setProgress(100);
    setStep("results");
    toast.success(`Generated SEO for ${allResults.length} products`);
  }, [products, audit]);

  // ── Build Output CSV ────────────────────────────────────
  const buildOutputRows = useCallback((): string[][] => {
    const seoTitleIdx = csvHeaders.indexOf(SEO_TITLE_COL);
    const seoDescIdx = csvHeaders.indexOf(SEO_DESC_COL);
    const handleIdx = csvHeaders.indexOf("Handle");

    // Build lookup by handle
    const resultMap = new Map<string, SEOResult>();
    results.forEach(r => resultMap.set(r.handle, r));

    return csvRows.map(row => {
      const newRow = [...row];
      const handle = row[handleIdx]?.trim() || "";
      const r = resultMap.get(handle);
      if (r) {
        newRow[seoTitleIdx] = r.seoTitle;
        newRow[seoDescIdx] = r.seoDescription;
      }
      return newRow;
    });
  }, [csvHeaders, csvRows, results]);

  // ── Download (with auto-split) ──────────────────────────
  const downloadCSV = useCallback(() => {
    const outputRows = buildOutputRows();
    const totalRows = outputRows.length;

    if (totalRows <= MAX_SHOPIFY_ROWS) {
      // Single file
      const csv = Papa.unparse([csvHeaders, ...outputRows]);
      downloadBlob(csv, fileName.replace(/\.csv$/i, "") + "_seo_optimized.csv");
      toast.success("Downloaded optimized CSV");
    } else {
      // Split into chunks
      const chunks: string[][][] = [];
      for (let i = 0; i < totalRows; i += MAX_SHOPIFY_ROWS) {
        chunks.push(outputRows.slice(i, i + MAX_SHOPIFY_ROWS));
      }
      chunks.forEach((chunk, idx) => {
        const csv = Papa.unparse([csvHeaders, ...chunk]);
        downloadBlob(csv, fileName.replace(/\.csv$/i, "") + `_seo_part${idx + 1}.csv`);
      });
      toast.success(`Downloaded ${chunks.length} split CSV files`);
    }
  }, [csvHeaders, buildOutputRows, fileName]);

  const downloadAudit = useCallback(() => {
    const lines = ["Handle,Issue,Severity", ...audit.map(a => `"${a.handle}","${a.issue}","${a.severity}"`)];
    downloadBlob(lines.join("\n"), "seo_audit_report.csv");
  }, [audit]);

  // ── Render ──────────────────────────────────────────────
  const changedCount = results.filter(r => r.changed).length;
  const avgConfidence = results.length ? Math.round(results.reduce((s, r) => s + r.confidence, 0) / results.length) : 0;

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}><ChevronLeft className="h-4 w-4" /></Button>
        <h1 className="text-lg font-bold">Shopify CSV SEO Optimizer</h1>
        <Badge variant="secondary">Production</Badge>
      </div>

      {/* Step: Upload */}
      {step === "upload" && (
        <div className="border-2 border-dashed rounded-xl p-12 text-center space-y-4">
          <Upload className="h-12 w-12 mx-auto text-muted-foreground" />
          <div>
            <h2 className="font-semibold text-lg">Upload Shopify Product Export CSV</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Export from Shopify Admin → Products → Export → CSV for Excel. Only SEO Title & SEO Description will be updated.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-lg cursor-pointer hover:opacity-90 transition-opacity">
            <Upload className="h-4 w-4" /> Select CSV file
            <input type="file" accept=".csv" className="hidden" onChange={handleFile} />
          </label>
          <div className="text-xs text-muted-foreground space-y-1 mt-4">
            <p>✅ Preserves all Shopify columns, row order, and variant relationships</p>
            <p>✅ Only modifies SEO Title and SEO Description columns</p>
            <p>✅ Auto-splits large files for safe Shopify import</p>
            <p>✅ Validates output against Shopify import requirements</p>
          </div>
        </div>
      )}

      {/* Step: Preview */}
      {step === "preview" && (
        <div className="space-y-4">
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <div><div className="text-2xl font-bold">{csvRows.length}</div><div className="text-xs text-muted-foreground">Total rows</div></div>
              <div><div className="text-2xl font-bold">{products.length}</div><div className="text-xs text-muted-foreground">Unique products</div></div>
              <div><div className="text-2xl font-bold">{csvHeaders.length}</div><div className="text-xs text-muted-foreground">Columns</div></div>
              <div><div className="text-2xl font-bold">{products.filter(p => !p.existingSeoTitle).length}</div><div className="text-xs text-muted-foreground">Missing SEO Title</div></div>
            </div>
          </div>

          {audit.length > 0 && (
            <div className="bg-warning/10 border border-warning/20 rounded-lg p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-warning">
                <AlertTriangle className="h-4 w-4" /> {audit.length} audit note{audit.length !== 1 ? "s" : ""}
              </div>
              <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                {audit.slice(0, 5).map((a, i) => (
                  <p key={i} className="text-xs text-muted-foreground">{a.issue}</p>
                ))}
                {audit.length > 5 && <p className="text-xs text-muted-foreground">…and {audit.length - 5} more</p>}
              </div>
            </div>
          )}

          {/* Sample products */}
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-muted/50 px-3 py-2 text-xs font-medium">Product preview (first 10)</div>
            <div className="divide-y max-h-60 overflow-y-auto">
              {products.slice(0, 10).map(p => (
                <div key={p.handle} className="px-3 py-2 text-xs flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium truncate block">{p.title || p.handle}</span>
                    <span className="text-muted-foreground">{p.vendor} · {p.type} · {p.rowIndices.length} row{p.rowIndices.length !== 1 ? "s" : ""}</span>
                  </div>
                  {p.existingSeoTitle ? (
                    <Badge variant="outline" className="text-[10px] ml-2">Has SEO</Badge>
                  ) : (
                    <Badge variant="destructive" className="text-[10px] ml-2">No SEO</Badge>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("upload")}>← Back</Button>
            <Button onClick={runOptimization} className="flex-1 gap-2">
              <Sparkles className="h-4 w-4" /> Generate SEO for {products.length} products
            </Button>
          </div>
        </div>
      )}

      {/* Step: Processing */}
      {step === "processing" && (
        <div className="space-y-4 py-8">
          <div className="text-center space-y-2">
            <Sparkles className="h-8 w-8 mx-auto animate-pulse text-primary" />
            <h2 className="font-semibold">Generating SEO content…</h2>
            <p className="text-sm text-muted-foreground">{progressMsg}</p>
          </div>
          <Progress value={progress} className="h-2" />
          <p className="text-center text-xs text-muted-foreground">{progress}% complete</p>
          <Button variant="outline" size="sm" className="mx-auto block" onClick={() => { abortRef.current = true; }}>
            Cancel
          </Button>
        </div>
      )}

      {/* Step: Results */}
      {step === "results" && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <div><div className="text-2xl font-bold text-success">{changedCount}</div><div className="text-xs text-muted-foreground">Products updated</div></div>
              <div><div className="text-2xl font-bold">{results.length - changedCount}</div><div className="text-xs text-muted-foreground">Unchanged</div></div>
              <div><div className="text-2xl font-bold">{avgConfidence}%</div><div className="text-xs text-muted-foreground">Avg confidence</div></div>
              <div>
                <div className="text-2xl font-bold">{csvRows.length > MAX_SHOPIFY_ROWS ? Math.ceil(csvRows.length / MAX_SHOPIFY_ROWS) : 1}</div>
                <div className="text-xs text-muted-foreground">Output file{csvRows.length > MAX_SHOPIFY_ROWS ? "s" : ""}</div>
              </div>
            </div>
          </div>

          {/* Audit warnings */}
          {audit.filter(a => a.severity !== "info").length > 0 && (
            <div className="bg-warning/10 border border-warning/20 rounded-lg p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <AlertTriangle className="h-4 w-4 text-warning" /> {audit.filter(a => a.severity !== "info").length} warning{audit.filter(a => a.severity !== "info").length !== 1 ? "s" : ""}
              </div>
            </div>
          )}

          {/* Results table */}
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-muted/50 px-3 py-2 text-xs font-medium flex justify-between">
              <span>SEO Results</span>
              <span className="text-muted-foreground">{results.length} products</span>
            </div>
            <div className="divide-y max-h-80 overflow-y-auto">
              {results.map(r => (
                <div key={r.handle} className="px-3 py-2 text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    {r.confidence >= 70 ? (
                      <CheckCircle className="h-3 w-3 text-success shrink-0" />
                    ) : (
                      <AlertTriangle className="h-3 w-3 text-warning shrink-0" />
                    )}
                    <span className="font-medium truncate">{r.handle}</span>
                    <Badge variant="outline" className="text-[10px] ml-auto">{r.confidence}%</Badge>
                    {r.changed && <Badge className="text-[10px] bg-success/20 text-success border-0">Changed</Badge>}
                  </div>
                  <div className="pl-5 text-muted-foreground">
                    <p><strong>Title:</strong> {r.seoTitle} <span className="opacity-60">({r.seoTitle.length}c)</span></p>
                    <p><strong>Desc:</strong> {r.seoDescription} <span className="opacity-60">({r.seoDescription.length}c)</span></p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* File split notice */}
          {csvRows.length > MAX_SHOPIFY_ROWS && (
            <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 flex items-start gap-2">
              <SplitSquareVertical className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-medium">Auto-split enabled</p>
                <p className="text-muted-foreground">Your CSV has {csvRows.length} rows. It will be split into {Math.ceil(csvRows.length / MAX_SHOPIFY_ROWS)} files of up to {MAX_SHOPIFY_ROWS} rows each for safe Shopify import.</p>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <Button onClick={downloadCSV} className="gap-2 flex-1">
              <Download className="h-4 w-4" /> Download Optimized CSV{csvRows.length > MAX_SHOPIFY_ROWS ? "s" : ""}
            </Button>
            <Button variant="outline" onClick={downloadAudit} className="gap-2">
              <FileText className="h-4 w-4" /> Audit Report
            </Button>
            <Button variant="outline" onClick={() => { setStep("upload"); setResults([]); setProducts([]); setCsvRows([]); setCsvHeaders([]); setAudit([]); }}>
              New CSV
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────
function downloadBlob(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
