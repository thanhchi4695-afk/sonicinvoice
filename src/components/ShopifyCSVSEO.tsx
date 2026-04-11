import { useState, useCallback, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronLeft, Upload, Download, AlertTriangle, CheckCircle, FileText, Sparkles, SplitSquareVertical, RefreshCw, Eye, BarChart3, BookOpen } from "lucide-react";
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
  rowIndices: number[];
  skuFallback?: string;
  flagged?: boolean;
}

interface SEOResult {
  handle: string;
  oldSeoTitle: string;
  oldSeoDesc: string;
  seoTitle: string;
  seoDescription: string;
  confidence: number;
  reason: string;
  changed: boolean;
  flagged: boolean;
  flagReason: string;
  usedFallback: boolean;
}

interface AuditEntry {
  handle: string;
  issue: string;
  severity: "info" | "warn" | "error";
}

const MAX_ROWS_PER_FILE = 5000;
const MAX_FILE_SIZE_MB = 10;
const SEO_TITLE_COL = "SEO Title";
const SEO_DESC_COL = "SEO Description";
const REQUIRED_COLS = ["Handle", "Title", "Body (HTML)", SEO_TITLE_COL, SEO_DESC_COL];
const PRESERVE_COLS = ["Handle", "Variant SKU", "Image Src"];

type Step = "upload" | "preview" | "processing" | "validating" | "results";

export default function ShopifyCSVSEO({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<Step>("upload");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [products, setProducts] = useState<ProductGroup[]>([]);
  const [results, setResults] = useState<SEOResult[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [fileName, setFileName] = useState("");
  const [previewMode, setPreviewMode] = useState(false);
  const [showImportGuide, setShowImportGuide] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const abortRef = useRef(false);

  const store = useMemo(() => getStoreConfig(), []);
  const storeName = store.name || "Shop";

  // ── Helpers ──────────────────────────────────────────────
  const safeFallbackTitle = (title: string) =>
    `${title} | ${storeName}`.slice(0, 70);

  const safeFallbackDesc = (title: string) =>
    `Shop ${title} at ${storeName}. Discover premium styles with fast shipping Australia-wide.`.slice(0, 160);

  // ── CSV Upload & Parse ──────────────────────────────────
  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setProgressMsg("Parsing CSV…");

    Papa.parse(file, {
      header: false,
      skipEmptyLines: false,
      complete: (res) => {
        const rows = res.data as string[][];
        if (rows.length < 2) { toast.error("CSV has no data rows"); return; }

        const headers = rows[0];
        const dataRows = rows.slice(1);

        // Validate required columns
        const missing = REQUIRED_COLS.filter(c => !headers.includes(c));
        if (missing.length > 0) {
          toast.error(`Missing required columns: ${missing.join(", ")}`);
          return;
        }

        // Check for duplicate headers
        const dupes = headers.filter((h, i) => headers.indexOf(h) !== i);
        if (dupes.length > 0) {
          toast.error(`Duplicate headers detected: ${[...new Set(dupes)].join(", ")}`);
          return;
        }

        setCsvHeaders(headers);
        setCsvRows(dataRows);

        const handleIdx = headers.indexOf("Handle");
        const titleIdx = headers.indexOf("Title");
        const vendorIdx = headers.indexOf("Vendor");
        const typeIdx = headers.indexOf("Type");
        const tagsIdx = headers.indexOf("Tags");
        const bodyIdx = headers.indexOf("Body (HTML)");
        const skuIdx = headers.indexOf("Variant SKU");
        const seoTitleIdx = headers.indexOf(SEO_TITLE_COL);
        const seoDescIdx = headers.indexOf(SEO_DESC_COL);

        const groups = new Map<string, ProductGroup>();
        const auditLog: AuditEntry[] = [];

        dataRows.forEach((row, i) => {
          let handle = row[handleIdx]?.trim() || "";

          if (!handle && skuIdx !== -1 && row[skuIdx]?.trim()) {
            handle = `__sku_${row[skuIdx].trim()}`;
            auditLog.push({ handle, issue: `Row ${i + 2}: Missing Handle, using Variant SKU fallback`, severity: "warn" });
          }
          if (!handle) return;

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
            const g = groups.get(handle)!;
            g.rowIndices.push(i);
            if (!g.title && row[titleIdx]) g.title = row[titleIdx];
            if (!g.vendor && vendorIdx !== -1 && row[vendorIdx]) g.vendor = row[vendorIdx];
            if (!g.type && typeIdx !== -1 && row[typeIdx]) g.type = row[typeIdx];
          }
        });

        setProducts(Array.from(groups.values()));
        setAudit(auditLog);
        setStep("preview");
        toast.success(`Parsed ${dataRows.length} rows → ${groups.size} unique products`);
      },
      error: (err) => toast.error(`CSV parse error: ${err.message}`),
    });
  }, []);

  // ── AI SEO Generation ───────────────────────────────────
  const runOptimization = useCallback(async (onlyFlagged = false) => {
    setStep("processing");
    setProgress(0);
    abortRef.current = false;

    const targetProducts = onlyFlagged
      ? products.filter(p => results.find(r => r.handle === p.handle)?.flagged)
      : previewMode ? products.slice(0, 10) : products;

    if (targetProducts.length === 0) {
      toast.info("No products to process");
      setStep("results");
      return;
    }

    const batchSize = 15;
    const allResults: SEOResult[] = onlyFlagged
      ? results.filter(r => !r.flagged) // keep non-flagged results
      : [];
    const auditLog = onlyFlagged ? [...audit] : [];

    setProgressMsg("Grouping products…");
    await new Promise(r => setTimeout(r, 100));

    for (let i = 0; i < targetProducts.length; i += batchSize) {
      if (abortRef.current) break;
      const batch = targetProducts.slice(i, i + batchSize);
      const pctBase = Math.round((i / targetProducts.length) * 90);
      setProgress(pctBase);
      setProgressMsg(`Generating SEO content… ${i + 1}–${Math.min(i + batchSize, targetProducts.length)} of ${targetProducts.length}`);

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
        const aiResults = data?.results || [];

        batch.forEach((p, j) => {
          const r = aiResults[j] || {};
          let seoTitle = (r.seo_title || "").slice(0, 70) || safeFallbackTitle(p.title);
          let seoDesc = (r.seo_description || "").slice(0, 160) || safeFallbackDesc(p.title);
          let flagged = false;
          let flagReason = "";
          let usedFallback = false;

          // ── Accuracy: title alignment check ──
          const titleWords = p.title.toLowerCase().split(/\s+/).filter(w => w.length > 2);
          const seoLower = seoTitle.toLowerCase();
          const aligned = titleWords.length === 0 || titleWords.some(w => seoLower.includes(w));
          if (!aligned) {
            seoTitle = safeFallbackTitle(p.title);
            seoDesc = safeFallbackDesc(p.title);
            flagged = true;
            flagReason = "SEO Title didn't match product — replaced with safe fallback";
            usedFallback = true;
            auditLog.push({ handle: p.handle, issue: flagReason, severity: "warn" });
          }

          // ── Check: product name missing from SEO when it should be ──
          if (!usedFallback && p.title.length > 3) {
            const mainWord = p.title.split(/\s+/)[0]?.toLowerCase();
            if (mainWord && mainWord.length > 2 && !seoLower.includes(mainWord)) {
              flagged = true;
              flagReason = "Product name may be missing from SEO Title";
              auditLog.push({ handle: p.handle, issue: flagReason, severity: "info" });
            }
          }

          // ── Length enforcement ──
          if (seoTitle.length > 70) { seoTitle = seoTitle.slice(0, 67) + "..."; }
          if (seoDesc.length > 160) { seoDesc = seoDesc.slice(0, 157) + "..."; }

          if (seoTitle.length > 60) auditLog.push({ handle: p.handle, issue: `SEO Title ${seoTitle.length}c (>60 optimal)`, severity: "info" });

          const changed = seoTitle !== p.existingSeoTitle || seoDesc !== p.existingSeoDesc;

          allResults.push({
            handle: p.handle,
            oldSeoTitle: p.existingSeoTitle,
            oldSeoDesc: p.existingSeoDesc,
            seoTitle,
            seoDescription: seoDesc,
            confidence: r.confidence || 50,
            reason: r.reason || "",
            changed,
            flagged,
            flagReason,
            usedFallback,
          });
        });
      } catch (err: any) {
        batch.forEach(p => {
          allResults.push({
            handle: p.handle,
            oldSeoTitle: p.existingSeoTitle,
            oldSeoDesc: p.existingSeoDesc,
            seoTitle: safeFallbackTitle(p.title),
            seoDescription: safeFallbackDesc(p.title),
            confidence: 10,
            reason: `API error: ${err.message}`,
            changed: true,
            flagged: true,
            flagReason: `AI error — used safe fallback`,
            usedFallback: true,
          });
          auditLog.push({ handle: p.handle, issue: `AI error, used safe fallback: ${err.message}`, severity: "error" });
        });
      }

      if (i + batchSize < targetProducts.length) await new Promise(r => setTimeout(r, 800));
    }

    // ── Duplicate detection ──────────────────────────────
    setProgress(92);
    setProgressMsg("Detecting duplicates & mismatches…");
    const titleCounts = new Map<string, string[]>();
    const descCounts = new Map<string, string[]>();
    allResults.forEach(r => {
      const t = r.seoTitle.toLowerCase();
      const d = r.seoDescription.toLowerCase();
      titleCounts.set(t, [...(titleCounts.get(t) || []), r.handle]);
      descCounts.set(d, [...(descCounts.get(d) || []), r.handle]);
    });

    for (const [title, handles] of titleCounts) {
      if (handles.length > 1 && title.length > 15) {
        handles.forEach(h => {
          const r = allResults.find(x => x.handle === h);
          if (r && !r.flagged) {
            r.flagged = true;
            r.flagReason = `Duplicate SEO Title shared with ${handles.length - 1} other product(s)`;
            auditLog.push({ handle: h, issue: r.flagReason, severity: "warn" });
          }
        });
      }
    }
    for (const [desc, handles] of descCounts) {
      if (handles.length > 1 && desc.length > 30) {
        handles.forEach(h => {
          const r = allResults.find(x => x.handle === h);
          if (r && !r.flagged) {
            r.flagged = true;
            r.flagReason = `Duplicate SEO Description shared with ${handles.length - 1} other product(s)`;
            auditLog.push({ handle: h, issue: r.flagReason, severity: "warn" });
          }
        });
      }
    }

    // ── Validation layer ─────────────────────────────────
    setProgress(95);
    setProgressMsg("Validating output…");
    setStep("validating");
    const errors = runValidation(csvHeaders, csvRows, allResults);
    setValidationErrors(errors);

    setResults(allResults);
    setAudit(auditLog);
    setProgress(100);
    setStep("results");

    const flagCount = allResults.filter(r => r.flagged).length;
    const fbCount = allResults.filter(r => r.usedFallback).length;
    toast.success(`SEO generated for ${allResults.length} products${flagCount ? ` (${flagCount} flagged)` : ""}${fbCount ? ` (${fbCount} fallbacks)` : ""}`);
  }, [products, results, audit, previewMode, store, safeFallbackTitle, safeFallbackDesc]);

  // ── Validation ──────────────────────────────────────────
  function runValidation(headers: string[], rows: string[][], seoResults: SEOResult[]): string[] {
    const errors: string[] = [];
    // Header integrity
    if (headers.length === 0) errors.push("No headers found");
    const dupeH = headers.filter((h, i) => headers.indexOf(h) !== i);
    if (dupeH.length) errors.push(`Duplicate headers: ${[...new Set(dupeH)].join(", ")}`);
    PRESERVE_COLS.forEach(c => { if (!headers.includes(c) && c !== "Image Src") errors.push(`Missing column: ${c}`); });
    // SEO length validation
    seoResults.forEach(r => {
      if (r.seoTitle.length > 70) errors.push(`${r.handle}: SEO Title exceeds 70 chars`);
      if (r.seoDescription.length > 160) errors.push(`${r.handle}: SEO Desc exceeds 160 chars`);
    });
    return errors;
  }

  // ── Build Output Rows ───────────────────────────────────
  const buildOutputRows = useCallback((): string[][] => {
    const seoTitleIdx = csvHeaders.indexOf(SEO_TITLE_COL);
    const seoDescIdx = csvHeaders.indexOf(SEO_DESC_COL);
    const handleIdx = csvHeaders.indexOf("Handle");

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

  // ── Handle-aware splitting ──────────────────────────────
  const splitByHandle = useCallback((outputRows: string[][]): string[][][] => {
    const handleIdx = csvHeaders.indexOf("Handle");
    const chunks: string[][][] = [];
    let current: string[][] = [];
    let currentHandle = "";

    for (const row of outputRows) {
      const h = row[handleIdx]?.trim() || currentHandle;
      if (current.length >= MAX_ROWS_PER_FILE && h !== currentHandle) {
        chunks.push(current);
        current = [];
      }
      current.push(row);
      if (h) currentHandle = h;
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
  }, [csvHeaders]);

  // ── Download ────────────────────────────────────────────
  const downloadCSV = useCallback(() => {
    if (validationErrors.length > 0) {
      toast.error("Validation errors found — fix before export");
      return;
    }
    const outputRows = buildOutputRows();
    const singleCsv = Papa.unparse([csvHeaders, ...outputRows]);
    const sizeBytes = new Blob([singleCsv]).size;
    const needsSplit = outputRows.length > MAX_ROWS_PER_FILE || sizeBytes > MAX_FILE_SIZE_MB * 1024 * 1024;

    if (!needsSplit) {
      downloadBlob(singleCsv, fileName.replace(/\.csv$/i, "") + "_seo_optimized.csv");
      toast.success("Downloaded optimized CSV");
    } else {
      const chunks = splitByHandle(outputRows);
      chunks.forEach((chunk, idx) => {
        const csv = Papa.unparse([csvHeaders, ...chunk]);
        downloadBlob(csv, `shopify_seo_optimized_part_${idx + 1}.csv`);
      });
      toast.success(`Downloaded ${chunks.length} split CSV files (handle-safe)`);
    }
  }, [csvHeaders, buildOutputRows, fileName, validationErrors, splitByHandle]);

  const downloadQAReport = useCallback(() => {
    const qaHeaders = ["Handle", "Product Title", "Old SEO Title", "New SEO Title", "Old SEO Desc", "New SEO Desc", "Confidence", "Status", "Warning/Reason"];
    const qaRows = results.map(r => {
      const product = products.find(p => p.handle === r.handle);
      return [
        r.handle,
        product?.title || "",
        r.oldSeoTitle,
        r.seoTitle,
        r.oldSeoDesc,
        r.seoDescription,
        String(r.confidence),
        r.flagged ? "Flagged" : r.changed ? "Updated" : "Unchanged",
        r.flagReason || r.reason,
      ];
    });
    const csv = Papa.unparse([qaHeaders, ...qaRows]);
    downloadBlob(csv, "seo_qa_report.csv");
    toast.success("Downloaded QA report");
  }, [results, products]);

  const downloadAudit = useCallback(() => {
    const csv = Papa.unparse([["Handle", "Issue", "Severity"], ...audit.map(a => [a.handle, a.issue, a.severity])]);
    downloadBlob(csv, "seo_audit_report.csv");
  }, [audit]);

  // ── Stats ───────────────────────────────────────────────
  const changedCount = results.filter(r => r.changed).length;
  const flaggedCount = results.filter(r => r.flagged).length;
  const fallbackCount = results.filter(r => r.usedFallback).length;
  const avgConfidence = results.length ? Math.round(results.reduce((s, r) => s + r.confidence, 0) / results.length) : 0;

  const titleLengthDist = useMemo(() => {
    const optimal = results.filter(r => r.seoTitle.length >= 50 && r.seoTitle.length <= 60).length;
    const acceptable = results.filter(r => (r.seoTitle.length >= 45 && r.seoTitle.length < 50) || (r.seoTitle.length > 60 && r.seoTitle.length <= 70)).length;
    const tooLong = results.filter(r => r.seoTitle.length > 70).length;
    const short = results.length - optimal - acceptable - tooLong;
    return { optimal, acceptable, tooLong, short };
  }, [results]);

  const outputChunkCount = useMemo(() => {
    if (csvRows.length <= MAX_ROWS_PER_FILE) return 1;
    return splitByHandle(buildOutputRows()).length;
  }, [csvRows, splitByHandle, buildOutputRows]);

  // ── Render ──────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}><ChevronLeft className="h-4 w-4" /></Button>
        <h1 className="text-lg font-bold">Shopify CSV SEO Optimizer</h1>
        <Badge variant="secondary">Production</Badge>
      </div>

      {/* ── Upload ── */}
      {step === "upload" && (
        <div className="border-2 border-dashed rounded-xl p-12 text-center space-y-4">
          <Upload className="h-12 w-12 mx-auto text-muted-foreground" />
          <div>
            <h2 className="font-semibold text-lg">Upload Shopify Product Export CSV</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Export from Shopify Admin → Products → Export → CSV for Excel.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-lg cursor-pointer hover:opacity-90 transition-opacity">
            <Upload className="h-4 w-4" /> Select CSV file
            <input type="file" accept=".csv" className="hidden" onChange={handleFile} />
          </label>
          <div className="text-xs text-muted-foreground space-y-1 mt-4">
            <p>✅ Only modifies SEO Title & SEO Description — all other data preserved exactly</p>
            <p>✅ Validates output against Shopify import rules before export</p>
            <p>✅ Auto-splits large files keeping product groups intact</p>
            <p>✅ Generates QA report for manual review</p>
          </div>
        </div>
      )}

      {/* ── Preview ── */}
      {step === "preview" && (
        <div className="space-y-4">
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <Stat value={csvRows.length} label="Total rows" />
              <Stat value={products.length} label="Unique products" />
              <Stat value={csvHeaders.length} label="Columns" />
              <Stat value={products.filter(p => !p.existingSeoTitle).length} label="Missing SEO" />
            </div>
          </div>

          {audit.length > 0 && <AuditBanner entries={audit} />}

          <div className="border rounded-lg overflow-hidden">
            <div className="bg-muted/50 px-3 py-2 text-xs font-medium">Product preview (first 10)</div>
            <div className="divide-y max-h-60 overflow-y-auto">
              {products.slice(0, 10).map(p => (
                <div key={p.handle} className="px-3 py-2 text-xs flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium truncate block">{p.title || p.handle}</span>
                    <span className="text-muted-foreground">{p.vendor} · {p.type} · {p.rowIndices.length} row{p.rowIndices.length !== 1 ? "s" : ""}</span>
                  </div>
                  {p.existingSeoTitle
                    ? <Badge variant="outline" className="text-[10px] ml-2">Has SEO</Badge>
                    : <Badge variant="destructive" className="text-[10px] ml-2">No SEO</Badge>}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 bg-muted/30 rounded-lg p-3">
            <Checkbox id="preview-mode" checked={previewMode} onCheckedChange={(c) => setPreviewMode(!!c)} />
            <label htmlFor="preview-mode" className="text-sm cursor-pointer flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5" /> Preview mode — process first 10 products only
            </label>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("upload")}>← Back</Button>
            <Button onClick={() => runOptimization(false)} className="flex-1 gap-2">
              <Sparkles className="h-4 w-4" />
              {previewMode ? "Preview 10 products" : `Generate SEO for ${products.length} products`}
            </Button>
          </div>
        </div>
      )}

      {/* ── Processing ── */}
      {(step === "processing" || step === "validating") && (
        <div className="space-y-4 py-8">
          <div className="text-center space-y-2">
            <Sparkles className="h-8 w-8 mx-auto animate-pulse text-primary" />
            <h2 className="font-semibold">{step === "validating" ? "Validating output…" : "Generating SEO content…"}</h2>
            <p className="text-sm text-muted-foreground">{progressMsg}</p>
          </div>
          <Progress value={progress} className="h-2" />
          <div className="flex justify-between text-xs text-muted-foreground px-1">
            <span>Parsing</span><span>Grouping</span><span>AI SEO</span><span>Validate</span><span>Done</span>
          </div>
          <Button variant="outline" size="sm" className="mx-auto block" onClick={() => { abortRef.current = true; }}>Cancel</Button>
        </div>
      )}

      {/* ── Results ── */}
      {step === "results" && (
        <div className="space-y-4">
          {/* Summary stats */}
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
              <Stat value={changedCount} label="Updated" className="text-success" />
              <Stat value={results.length - changedCount} label="Unchanged" />
              <Stat value={flaggedCount} label="Flagged" className={flaggedCount > 0 ? "text-warning" : ""} />
              <Stat value={fallbackCount} label="Fallbacks" className={fallbackCount > 0 ? "text-warning" : ""} />
              <Stat value={`${avgConfidence}%`} label="Avg confidence" />
            </div>
          </div>

          {previewMode && (
            <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 text-xs">
              <p className="font-medium">Preview mode — showing first 10 products only</p>
              <p className="text-muted-foreground mt-1">Review the results below, then run full optimization when ready.</p>
              <Button size="sm" className="mt-2 gap-1.5" onClick={() => { setPreviewMode(false); runOptimization(false); }}>
                <Sparkles className="h-3 w-3" /> Process all {products.length} products
              </Button>
            </div>
          )}

          {/* Validation errors */}
          {validationErrors.length > 0 && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
              <p className="text-sm font-medium text-destructive flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" /> Validation failed — export blocked
              </p>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {validationErrors.slice(0, 5).map((e, i) => <li key={i}>• {e}</li>)}
                {validationErrors.length > 5 && <li>…and {validationErrors.length - 5} more</li>}
              </ul>
            </div>
          )}

          {/* Audit warnings */}
          {audit.filter(a => a.severity !== "info").length > 0 && <AuditBanner entries={audit.filter(a => a.severity !== "info")} />}

          {/* Length distribution */}
          <div className="border rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium mb-2"><BarChart3 className="h-3.5 w-3.5" /> SEO Title Length Distribution</div>
            <div className="flex gap-1 h-5">
              {titleLengthDist.short > 0 && <div className="bg-muted rounded" style={{ flex: titleLengthDist.short }} title={`Short (<45): ${titleLengthDist.short}`} />}
              {titleLengthDist.optimal > 0 && <div className="bg-success/60 rounded" style={{ flex: titleLengthDist.optimal }} title={`Optimal (50-60): ${titleLengthDist.optimal}`} />}
              {titleLengthDist.acceptable > 0 && <div className="bg-warning/60 rounded" style={{ flex: titleLengthDist.acceptable }} title={`Acceptable (45-50, 60-70): ${titleLengthDist.acceptable}`} />}
              {titleLengthDist.tooLong > 0 && <div className="bg-destructive/60 rounded" style={{ flex: titleLengthDist.tooLong }} title={`Too long (>70): ${titleLengthDist.tooLong}`} />}
            </div>
            <div className="flex gap-4 mt-1.5 text-[10px] text-muted-foreground">
              <span>🟢 Optimal: {titleLengthDist.optimal}</span>
              <span>🟡 Acceptable: {titleLengthDist.acceptable}</span>
              <span>⚪ Short: {titleLengthDist.short}</span>
              <span>🔴 Too long: {titleLengthDist.tooLong}</span>
            </div>
          </div>

          {/* Results table */}
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-muted/50 px-3 py-2 text-xs font-medium flex justify-between">
              <span>SEO Results</span>
              <span className="text-muted-foreground">{results.length} products</span>
            </div>
            <div className="divide-y max-h-96 overflow-y-auto">
              {results.map(r => (
                <div key={r.handle} className={`px-3 py-2 text-xs space-y-1 ${r.flagged ? "bg-warning/5" : ""}`}>
                  <div className="flex items-center gap-2">
                    {r.flagged ? <AlertTriangle className="h-3 w-3 text-warning shrink-0" />
                      : r.confidence >= 70 ? <CheckCircle className="h-3 w-3 text-success shrink-0" />
                      : <AlertTriangle className="h-3 w-3 text-muted-foreground shrink-0" />}
                    <span className="font-medium truncate">{r.handle}</span>
                    <Badge variant="outline" className="text-[10px] ml-auto">{r.confidence}%</Badge>
                    {r.changed && <Badge className="text-[10px] bg-success/20 text-success border-0">Changed</Badge>}
                    {r.usedFallback && <Badge className="text-[10px] bg-warning/20 text-warning border-0">Fallback</Badge>}
                  </div>
                  <div className="pl-5 space-y-0.5 text-muted-foreground">
                    {r.oldSeoTitle && r.seoTitle !== r.oldSeoTitle && (
                      <p className="line-through opacity-50">{r.oldSeoTitle}</p>
                    )}
                    <p><strong>Title:</strong> {r.seoTitle} <span className="opacity-50">({r.seoTitle.length}c)</span></p>
                    {r.oldSeoDesc && r.seoDescription !== r.oldSeoDesc && (
                      <p className="line-through opacity-50">{r.oldSeoDesc}</p>
                    )}
                    <p><strong>Desc:</strong> {r.seoDescription} <span className="opacity-50">({r.seoDescription.length}c)</span></p>
                    {r.flagReason && <p className="text-warning text-[10px]">⚠ {r.flagReason}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Split notice */}
          {outputChunkCount > 1 && (
            <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 flex items-start gap-2">
              <SplitSquareVertical className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-medium">Auto-split: {outputChunkCount} files</p>
                <p className="text-muted-foreground">Product groups kept intact across files. Max {MAX_ROWS_PER_FILE} rows per file.</p>
              </div>
            </div>
          )}

          {/* Import guide */}
          <div className="border rounded-lg overflow-hidden">
            <button className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium bg-muted/50 hover:bg-muted/70 transition-colors" onClick={() => setShowImportGuide(!showImportGuide)}>
              <BookOpen className="h-3.5 w-3.5" /> How to import back to Shopify
              <span className="ml-auto text-muted-foreground">{showImportGuide ? "▲" : "▼"}</span>
            </button>
            {showImportGuide && (
              <div className="p-3 text-xs space-y-1.5 text-muted-foreground">
                <p>1. Go to <strong>Shopify Admin → Products → Import</strong></p>
                <p>2. Upload the first CSV file</p>
                <p>3. Select <strong>"Overwrite existing products that have the same handle"</strong></p>
                <p>4. Wait for import to complete</p>
                {outputChunkCount > 1 && (
                  <>
                    <p>5. Repeat for each remaining part file</p>
                    <p className="text-warning">⚠ Do NOT upload all split files at the same time</p>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <Button onClick={downloadCSV} className="gap-2 flex-1" disabled={validationErrors.length > 0}>
              <Download className="h-4 w-4" /> Download CSV{outputChunkCount > 1 ? `s (${outputChunkCount})` : ""}
            </Button>
            <Button variant="outline" onClick={downloadQAReport} className="gap-2">
              <FileText className="h-4 w-4" /> QA Report
            </Button>
            <Button variant="outline" onClick={downloadAudit} className="gap-2">
              <FileText className="h-4 w-4" /> Audit
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {flaggedCount > 0 && (
              <Button variant="outline" onClick={() => runOptimization(true)} className="gap-2">
                <RefreshCw className="h-4 w-4" /> Regenerate {flaggedCount} flagged
              </Button>
            )}
            <Button variant="ghost" onClick={() => { setStep("upload"); setResults([]); setProducts([]); setCsvRows([]); setCsvHeaders([]); setAudit([]); setValidationErrors([]); setPreviewMode(false); }}>
              New CSV
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────
function Stat({ value, label, className }: { value: string | number; label: string; className?: string }) {
  return (
    <div>
      <div className={`text-2xl font-bold ${className || ""}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function AuditBanner({ entries }: { entries: AuditEntry[] }) {
  return (
    <div className="bg-warning/10 border border-warning/20 rounded-lg p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-warning">
        <AlertTriangle className="h-4 w-4" /> {entries.length} audit note{entries.length !== 1 ? "s" : ""}
      </div>
      <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
        {entries.slice(0, 5).map((a, i) => (
          <p key={i} className="text-xs text-muted-foreground">{a.handle}: {a.issue}</p>
        ))}
        {entries.length > 5 && <p className="text-xs text-muted-foreground">…and {entries.length - 5} more</p>}
      </div>
    </div>
  );
}

function downloadBlob(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
