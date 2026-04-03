import { useState, useCallback, useRef, useMemo } from "react";
import {
  ChevronLeft, Upload, Download, Loader2, AlertTriangle, CheckCircle2,
  XCircle, Edit3, Trash2, RefreshCw, FileSpreadsheet, FolderOpen, ArrowRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from "@/components/ui/dialog";
import { toast } from "sonner";
import Papa from "papaparse";
import {
  getConnection, getCustomCollections, getSmartCollections,
  createCustomCollection, updateCustomCollection,
  createSmartCollection, updateSmartCollection,
  type ShopifyCollection
} from "@/lib/shopify-api";

interface Props { onBack: () => void; }

/* ─── Row model ─── */
interface ImportRow {
  _idx: number;
  _action: "create" | "update" | "skip";
  _status: "valid" | "warning" | "error";
  _notes: string[];
  _matchedId: number | null;
  // Fields
  id: string;
  handle: string;
  title: string;
  body_html: string;
  collection_type: string;
  image_url: string;
  seo_title: string;
  seo_description: string;
  sort_order: string;
  published: string;
  template_suffix: string;
  rule_column: string;
  rule_condition: string;
  rule_relation: string;
}

type Step = "upload" | "validate" | "preview" | "importing" | "done";

/* ─── Helpers ─── */
function normalizeHeader(h: string): string {
  return h.trim().toLowerCase()
    .replace(/[\s_-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

const FIELD_MAP: Record<string, keyof ImportRow> = {
  shopify_id: "id", id: "id",
  handle: "handle",
  title: "title",
  body_html: "body_html", body: "body_html", description: "body_html",
  collection_type: "collection_type", type: "collection_type",
  image_url: "image_url", image: "image_url",
  seo_title: "seo_title",
  seo_description: "seo_description",
  sort_order: "sort_order",
  published: "published", published_status: "published",
  template_suffix: "template_suffix",
  rule_column: "rule_column",
  rule_condition: "rule_condition",
  rule_relation: "rule_relation",
  rules_summary: "_skip" as any,
};

function parseRules(row: ImportRow): { column: string; relation: string; condition: string }[] {
  const cols = row.rule_column.split(",").map(s => s.trim()).filter(Boolean);
  const rels = row.rule_relation.split(",").map(s => s.trim()).filter(Boolean);
  const conds = row.rule_condition.split(",").map(s => s.trim()).filter(Boolean);
  const rules: { column: string; relation: string; condition: string }[] = [];
  for (let i = 0; i < cols.length; i++) {
    rules.push({
      column: cols[i] || "",
      relation: rels[i] || "equals",
      condition: conds[i] || "",
    });
  }
  return rules;
}

const ImportCollections = ({ onBack }: Props) => {
  const [step, setStep] = useState<Step>("upload");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [existingCollections, setExistingCollections] = useState<ShopifyCollection[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [importResults, setImportResults] = useState<{ title: string; action: string; status: "success" | "error"; error?: string }[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /* ─── Upload & Parse ─── */
  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith(".csv")) {
      toast.error("Please upload a CSV file");
      return;
    }

    setLoading(true);
    setStep("validate");
    setProgress(10);

    // Fetch existing collections for matching
    try {
      const conn = await getConnection();
      if (!conn) {
        toast.error("No Shopify connection found");
        setStep("upload");
        setLoading(false);
        return;
      }

      setProgress(30);
      const [custom, smart] = await Promise.all([
        getCustomCollections(),
        getSmartCollections(),
      ]);
      setExistingCollections([...custom, ...smart]);
      setProgress(50);
    } catch (err) {
      toast.error("Failed to fetch existing collections");
      setStep("upload");
      setLoading(false);
      return;
    }

    // Parse CSV
    const text = await file.text();
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });

    if (parsed.errors.length > 0) {
      toast.error(`CSV parsing errors: ${parsed.errors[0].message}`);
      setStep("upload");
      setLoading(false);
      return;
    }

    const headers = Object.keys(parsed.data[0] || {});
    const headerMap: Record<string, string> = {};
    headers.forEach(h => {
      const norm = normalizeHeader(h);
      const mapped = FIELD_MAP[norm];
      if (mapped && mapped !== ("_skip" as any)) headerMap[h] = mapped;
    });

    setProgress(70);

    // Build rows
    const importRows: ImportRow[] = (parsed.data as Record<string, string>[]).map((raw, idx) => {
      const row: ImportRow = {
        _idx: idx,
        _action: "create",
        _status: "valid",
        _notes: [],
        _matchedId: null,
        id: "", handle: "", title: "", body_html: "", collection_type: "custom",
        image_url: "", seo_title: "", seo_description: "", sort_order: "",
        published: "Yes", template_suffix: "", rule_column: "", rule_condition: "", rule_relation: "",
      };

      Object.entries(raw).forEach(([key, val]) => {
        const mapped = headerMap[key];
        if (mapped) (row as any)[mapped] = (val || "").trim();
      });

      return row;
    });

    // Validate & match
    const handleSet = new Set<string>();
    importRows.forEach(row => {
      // Required field check
      if (!row.title) {
        row._status = "error";
        row._notes.push("Title is required");
      }

      // Duplicate handle check
      if (row.handle) {
        if (handleSet.has(row.handle.toLowerCase())) {
          row._status = row._status === "error" ? "error" : "warning";
          row._notes.push("Duplicate handle in file");
        }
        handleSet.add(row.handle.toLowerCase());
      }

      // Generate handle if missing
      if (!row.handle && row.title) {
        row.handle = row.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      }

      // Smart collection rule validation
      if (row.collection_type.toLowerCase() === "smart") {
        if (!row.rule_column || !row.rule_condition) {
          row._status = row._status === "error" ? "error" : "warning";
          row._notes.push("Smart collection needs rules (column + condition)");
        }
      }

      // Match to existing
      const matchById = row.id ? existingCollections.find(c => String(c.id) === row.id) : null;
      const matchByHandle = !matchById && row.handle
        ? existingCollections.find(c => c.handle === row.handle)
        : null;
      const matchByTitle = !matchById && !matchByHandle && row.title
        ? existingCollections.find(c => c.title.toLowerCase() === row.title.toLowerCase())
        : null;
      const match = matchById || matchByHandle || matchByTitle;

      if (match) {
        row._action = "update";
        row._matchedId = match.id;
        if (!matchById && matchByTitle) {
          row._notes.push("Matched by title (less reliable)");
        }
      } else {
        row._action = "create";
      }
    });

    setRows(importRows);
    setProgress(100);
    setLoading(false);
    setStep("preview");
  }, [existingCollections]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  /* ─── Row actions ─── */
  const removeRow = (idx: number) => setRows(prev => prev.filter(r => r._idx !== idx));

  const updateRow = (idx: number, field: keyof ImportRow, value: string) => {
    setRows(prev => prev.map(r => r._idx === idx ? { ...r, [field]: value } : r));
  };

  /* ─── Import execution ─── */
  const executeImport = useCallback(async () => {
    setShowConfirm(false);
    setStep("importing");
    setProgress(0);

    const validRows = rows.filter(r => r._status !== "error");
    const results: typeof importResults = [];

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      setProgress(Math.round(((i + 1) / validRows.length) * 100));

      try {
        const isSmart = row.collection_type.toLowerCase() === "smart";
        const collectionData: Record<string, unknown> = {
          title: row.title,
          handle: row.handle,
        };

        if (row.body_html) collectionData.body_html = row.body_html;
        if (row.sort_order) collectionData.sort_order = row.sort_order;
        if (row.template_suffix) collectionData.template_suffix = row.template_suffix;
        if (row.published) collectionData.published = row.published.toLowerCase() !== "no";
        if (row.image_url) collectionData.image = { src: row.image_url };

        // SEO via metafields_global
        if (row.seo_title) collectionData.metafields_global_title_tag = row.seo_title;
        if (row.seo_description) collectionData.metafields_global_description_tag = row.seo_description;

        if (isSmart) {
          const rules = parseRules(row);
          if (rules.length > 0) collectionData.rules = rules;
        }

        if (row._action === "update" && row._matchedId) {
          if (isSmart) {
            await updateSmartCollection(row._matchedId, collectionData);
          } else {
            await updateCustomCollection(row._matchedId, collectionData);
          }
          results.push({ title: row.title, action: "Updated", status: "success" });
        } else {
          if (isSmart) {
            await createSmartCollection(collectionData);
          } else {
            await createCustomCollection(collectionData);
          }
          results.push({ title: row.title, action: "Created", status: "success" });
        }
      } catch (err) {
        results.push({
          title: row.title,
          action: row._action === "update" ? "Update failed" : "Create failed",
          status: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }

      // Rate limit
      if (i < validRows.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    setImportResults(results);
    setStep("done");
    const successCount = results.filter(r => r.status === "success").length;
    toast.success(`${successCount} collection${successCount !== 1 ? "s" : ""} processed`);
  }, [rows]);

  /* ─── Stats ─── */
  const stats = useMemo(() => {
    const creates = rows.filter(r => r._action === "create" && r._status !== "error").length;
    const updates = rows.filter(r => r._action === "update" && r._status !== "error").length;
    const errors = rows.filter(r => r._status === "error").length;
    const warnings = rows.filter(r => r._status === "warning").length;
    return { creates, updates, errors, warnings, total: rows.length };
  }, [rows]);

  const doneStats = useMemo(() => ({
    success: importResults.filter(r => r.status === "success").length,
    failed: importResults.filter(r => r.status === "error").length,
  }), [importResults]);

  /* ─── Export failed rows ─── */
  const exportFailed = useCallback(() => {
    const failed = importResults.filter(r => r.status === "error");
    const csv = Papa.unparse(failed.map(r => ({
      Title: r.title, Action: r.action, Error: r.error || "",
    })));
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "failed-collections.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [importResults]);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/95 backdrop-blur sticky top-0 z-10">
        <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold font-display truncate">Import Collections</h1>
          <p className="text-[10px] text-muted-foreground">Create or update Shopify collections from CSV</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-28">

        {/* ── STEP 1: Upload ── */}
        {step === "upload" && (
          <>
            <Card className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-primary" />
                <h2 className="text-sm font-semibold">Upload Collection CSV</h2>
              </div>
              <p className="text-xs text-muted-foreground">
                Upload a CSV file with your collections. Use the Export Collections tool to get a compatible template.
              </p>
            </Card>

            <div
              className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm font-medium">Drop CSV file here</p>
              <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={onFileSelect} />
            </div>

            <Card className="p-3 space-y-2">
              <h3 className="text-xs font-semibold">Required Fields</h3>
              <div className="flex flex-wrap gap-1.5">
                {["Title", "Handle"].map(f => (
                  <span key={f} className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium">{f}</span>
                ))}
              </div>
              <h3 className="text-xs font-semibold mt-2">Optional Fields</h3>
              <div className="flex flex-wrap gap-1.5">
                {["Body HTML", "Collection Type", "Image URL", "SEO Title", "SEO Description", "Sort Order", "Published", "Rule Column", "Rule Condition", "Rule Relation"].map(f => (
                  <span key={f} className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px]">{f}</span>
                ))}
              </div>
            </Card>
          </>
        )}

        {/* ── STEP 2: Validating ── */}
        {step === "validate" && loading && (
          <Card className="p-6 space-y-3">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
              <div>
                <p className="text-sm font-medium">
                  {progress < 30 ? "Connecting to Shopify…" : progress < 70 ? "Fetching existing collections…" : "Validating rows…"}
                </p>
                <p className="text-[10px] text-muted-foreground">Matching against your store's collections</p>
              </div>
            </div>
            <Progress value={progress} className="h-2" />
          </Card>
        )}

        {/* ── STEP 3: Preview ── */}
        {step === "preview" && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-4 gap-2">
              <Card className="p-2 text-center">
                <p className="text-lg font-bold text-primary">{stats.creates}</p>
                <p className="text-[9px] text-muted-foreground">Create</p>
              </Card>
              <Card className="p-2 text-center">
                <p className="text-lg font-bold text-foreground">{stats.updates}</p>
                <p className="text-[9px] text-muted-foreground">Update</p>
              </Card>
              <Card className="p-2 text-center">
                <p className={`text-lg font-bold ${stats.warnings > 0 ? "text-yellow-500" : "text-muted-foreground"}`}>{stats.warnings}</p>
                <p className="text-[9px] text-muted-foreground">Warnings</p>
              </Card>
              <Card className="p-2 text-center">
                <p className={`text-lg font-bold ${stats.errors > 0 ? "text-destructive" : "text-muted-foreground"}`}>{stats.errors}</p>
                <p className="text-[9px] text-muted-foreground">Errors</p>
              </Card>
            </div>

            {/* Row list */}
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {rows.map(row => (
                <Card key={row._idx} className={`p-3 ${row._status === "error" ? "border-destructive/40" : row._status === "warning" ? "border-yellow-500/40" : ""}`}>
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5">
                      {row._status === "valid" && <CheckCircle2 className="w-4 h-4 text-primary" />}
                      {row._status === "warning" && <AlertTriangle className="w-4 h-4 text-yellow-500" />}
                      {row._status === "error" && <XCircle className="w-4 h-4 text-destructive" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      {editIdx === row._idx ? (
                        <div className="space-y-1.5">
                          <Input value={row.title} onChange={e => updateRow(row._idx, "title", e.target.value)} placeholder="Title" className="h-7 text-xs" />
                          <Input value={row.handle} onChange={e => updateRow(row._idx, "handle", e.target.value)} placeholder="Handle" className="h-7 text-xs" />
                          <Input value={row.body_html} onChange={e => updateRow(row._idx, "body_html", e.target.value)} placeholder="Description" className="h-7 text-xs" />
                          <Button variant="ghost" size="sm" onClick={() => setEditIdx(null)} className="h-6 text-[10px]">Done</Button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-medium truncate">{row.title || "(no title)"}</p>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                              row._action === "create" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                            }`}>
                              {row._action}
                            </span>
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                              {row.collection_type || "custom"}
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground truncate">/{row.handle}</p>
                          {row._notes.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {row._notes.map((n, i) => (
                                <p key={i} className={`text-[9px] ${row._status === "error" ? "text-destructive" : "text-yellow-500"}`}>⚠ {n}</p>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="w-6 h-6" onClick={() => setEditIdx(editIdx === row._idx ? null : row._idx)}>
                        <Edit3 className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="w-6 h-6 text-destructive" onClick={() => removeRow(row._idx)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setStep("upload"); setRows([]); }}>
                Start Over
              </Button>
              <Button
                className="flex-1"
                onClick={() => setShowConfirm(true)}
                disabled={stats.creates + stats.updates === 0}
              >
                Apply Changes <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </>
        )}

        {/* ── STEP 4: Importing ── */}
        {step === "importing" && (
          <Card className="p-6 space-y-3">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
              <div>
                <p className="text-sm font-medium">Importing collections…</p>
                <p className="text-[10px] text-muted-foreground">{Math.round(progress)}% complete</p>
              </div>
            </div>
            <Progress value={progress} className="h-2" />
          </Card>
        )}

        {/* ── STEP 5: Done ── */}
        {step === "done" && (
          <>
            <div className="text-center py-4">
              <CheckCircle2 className="w-12 h-12 mx-auto text-primary mb-2" />
              <h2 className="text-lg font-bold">Import Complete</h2>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Card className="p-3 text-center">
                <p className="text-2xl font-bold text-primary">{doneStats.success}</p>
                <p className="text-[10px] text-muted-foreground">Successful</p>
              </Card>
              <Card className="p-3 text-center">
                <p className={`text-2xl font-bold ${doneStats.failed > 0 ? "text-destructive" : "text-muted-foreground"}`}>{doneStats.failed}</p>
                <p className="text-[10px] text-muted-foreground">Failed</p>
              </Card>
            </div>

            {/* Results list */}
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {importResults.map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-xs py-1.5 px-2 rounded-lg bg-muted/30">
                  {r.status === "success"
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
                    : <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
                  }
                  <span className="truncate flex-1">{r.title}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{r.action}</span>
                  {r.error && <span className="text-[9px] text-destructive shrink-0 max-w-[120px] truncate">{r.error}</span>}
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              {doneStats.failed > 0 && (
                <Button variant="outline" className="flex-1" onClick={exportFailed}>
                  <Download className="w-4 h-4 mr-1" /> Export Failed
                </Button>
              )}
              <Button className="flex-1" onClick={() => { setStep("upload"); setRows([]); setImportResults([]); }}>
                Import More
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Confirm dialog */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Import</DialogTitle>
            <DialogDescription>
              You are about to modify your Shopify collections. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            {stats.creates > 0 && <p>• Create <strong>{stats.creates}</strong> new collection{stats.creates !== 1 ? "s" : ""}</p>}
            {stats.updates > 0 && <p>• Update <strong>{stats.updates}</strong> existing collection{stats.updates !== 1 ? "s" : ""}</p>}
            {stats.errors > 0 && <p className="text-destructive">• Skip <strong>{stats.errors}</strong> row{stats.errors !== 1 ? "s" : ""} with errors</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirm(false)}>Cancel</Button>
            <Button onClick={executeImport}>Confirm & Import</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ImportCollections;
