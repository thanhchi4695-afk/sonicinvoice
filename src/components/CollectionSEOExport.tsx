import { useState, useCallback, useEffect, useMemo } from "react";
import {
  ChevronLeft, Download, Upload, Search, AlertTriangle, CheckCircle2,
  FileSpreadsheet, RefreshCw, Loader2, FolderOpen, Sparkles, Eye,
  X, Check, Info, BarChart3, Edit3
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  getConnection, getCustomCollections, getSmartCollections,
  updateCollectionSEO, type ShopifyCollection
} from "@/lib/shopify-api";
import { supabase } from "@/integrations/supabase/client";
import Papa from "papaparse";

interface Props { onBack: () => void; }

interface CollectionRow {
  shopify_id: number;
  handle: string;
  title: string;
  body_html: string;
  image_url: string;
  published: boolean;
  sort_order: string;
  template_suffix: string;
  collection_type: "custom" | "smart";
  products_count: number;
  seo_title: string;
  seo_description: string;
  rules_json: string;
  created_at: string;
  updated_at: string;
}

interface SEOIssue {
  collection_id: number;
  title: string;
  handle: string;
  issues: string[];
}

interface ImportDiff {
  shopify_id: number;
  title: string;
  handle: string;
  collection_type: "custom" | "smart";
  changes: { field: string; old: string; new: string }[];
  warnings: string[];
}

type FetchState = "idle" | "fetching" | "ready" | "error";

function toRow(c: ShopifyCollection, type: "custom" | "smart"): CollectionRow {
  return {
    shopify_id: c.id,
    handle: c.handle,
    title: c.title,
    body_html: c.body_html || "",
    image_url: c.image?.src || "",
    published: !!c.published_at,
    sort_order: c.sort_order || "",
    template_suffix: c.template_suffix || "",
    collection_type: type,
    products_count: 0,
    seo_title: "",
    seo_description: "",
    rules_json: c.rules ? JSON.stringify(c.rules) : "",
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

const CACHE_KEY = "collection_seo_export_cache";
const CACHE_TTL = 5 * 60 * 1000;

function getCached(): { rows: CollectionRow[]; ts: number } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.ts > CACHE_TTL) return null;
    return parsed;
  } catch { return null; }
}

const CollectionSEOExport = ({ onBack }: Props) => {
  const [rows, setRows] = useState<CollectionRow[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [activeTab, setActiveTab] = useState("export");

  // Export filters
  const [filterType, setFilterType] = useState<"all" | "custom" | "smart">("all");
  const [filterPublished, setFilterPublished] = useState<"all" | "yes" | "no">("all");

  // SEO Workbench
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editSeoTitle, setEditSeoTitle] = useState("");
  const [editSeoDesc, setEditSeoDesc] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkPrefix, setBulkPrefix] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  // Import
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importDiffs, setImportDiffs] = useState<ImportDiff[]>([]);
  const [importState, setImportState] = useState<"idle" | "parsed" | "pushing" | "done">("idle");
  const [importProgress, setImportProgress] = useState(0);
  const [importResults, setImportResults] = useState<{ ok: number; fail: number }>({ ok: 0, fail: 0 });

  // AI
  const [aiLoadingId, setAiLoadingId] = useState<number | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<{ id: number; titles: string[]; descs: string[] } | null>(null);

  const fetchCollections = useCallback(async (force = false) => {
    if (!force) {
      const cached = getCached();
      if (cached) { setRows(cached.rows); setFetchState("ready"); return; }
    }
    setFetchState("fetching");
    setProgress(10);
    setErrorMsg("");
    try {
      const conn = await getConnection();
      if (!conn) { setErrorMsg("No Shopify connection found."); setFetchState("error"); return; }
      setProgress(30);
      const [custom, smart] = await Promise.all([getCustomCollections(), getSmartCollections()]);
      setProgress(80);
      const allRows = [
        ...custom.map(c => toRow(c, "custom")),
        ...smart.map(c => toRow(c, "smart")),
      ].sort((a, b) => a.title.localeCompare(b.title));
      setRows(allRows);
      localStorage.setItem(CACHE_KEY, JSON.stringify({ rows: allRows, ts: Date.now() }));
      setProgress(100);
      setFetchState("ready");
      toast.success(`Fetched ${allRows.length} collections`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Fetch failed");
      setFetchState("error");
    }
  }, []);

  useEffect(() => { if (fetchState === "idle") fetchCollections(); }, [fetchCollections, fetchState]);

  const filteredRows = useMemo(() => {
    let r = rows;
    if (filterType !== "all") r = r.filter(x => x.collection_type === filterType);
    if (filterPublished === "yes") r = r.filter(x => x.published);
    if (filterPublished === "no") r = r.filter(x => !x.published);
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      r = r.filter(x => x.title.toLowerCase().includes(s) || x.handle.toLowerCase().includes(s));
    }
    return r;
  }, [rows, filterType, filterPublished, searchTerm]);

  // ── Export ──
  const handleExport = useCallback(() => {
    const exportRows = filteredRows.map(r => ({
      "Shopify ID": r.shopify_id, Handle: r.handle, Title: r.title,
      "Body HTML": r.body_html, "Image URL": r.image_url,
      Published: r.published ? "true" : "false", "Sort Order": r.sort_order,
      "Template Suffix": r.template_suffix, "Collection Type": r.collection_type,
      "Products Count": r.products_count, "SEO Title": r.seo_title,
      "SEO Description": r.seo_description, "URL Handle": r.handle,
      "Rules JSON": r.rules_json,
      "Metafields:global:seo.title": r.seo_title,
      "Metafields:global:seo.description": r.seo_description,
    }));
    const csv = Papa.unparse(exportRows);
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `collections-seo-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${exportRows.length} collections`);
  }, [filteredRows]);

  // ── Import ──
  const handleImportParse = useCallback(() => {
    if (!importFile) return;
    Papa.parse(importFile, {
      header: true, skipEmptyLines: true,
      complete: (result) => {
        const diffs: ImportDiff[] = [];
        for (const csvRow of result.data as Record<string, string>[]) {
          const sid = parseInt(csvRow["Shopify ID"] || csvRow["Id"] || "0");
          if (!sid) continue;
          const existing = rows.find(r => r.shopify_id === sid);
          if (!existing) continue;
          const changes: { field: string; old: string; new: string }[] = [];
          const warnings: string[] = [];
          const newTitle = csvRow["Title"] || "";
          if (newTitle && newTitle !== existing.title) changes.push({ field: "title", old: existing.title, new: newTitle });
          const newBody = csvRow["Body HTML"] || "";
          if (newBody && newBody !== existing.body_html) changes.push({ field: "body_html", old: existing.body_html.slice(0, 80), new: newBody.slice(0, 80) });
          const newSeoTitle = csvRow["SEO Title"] || csvRow["Metafields:global:seo.title"] || "";
          if (newSeoTitle && newSeoTitle !== existing.seo_title) {
            changes.push({ field: "seo_title", old: existing.seo_title, new: newSeoTitle });
            if (newSeoTitle.length > 60) warnings.push(`SEO Title is ${newSeoTitle.length} chars (>60)`);
          }
          const newSeoDesc = csvRow["SEO Description"] || csvRow["Metafields:global:seo.description"] || "";
          if (newSeoDesc && newSeoDesc !== existing.seo_description) {
            changes.push({ field: "seo_description", old: existing.seo_description, new: newSeoDesc });
            if (newSeoDesc.length > 160) warnings.push(`SEO Description is ${newSeoDesc.length} chars (>160)`);
          }
          const newSort = csvRow["Sort Order"] || "";
          if (newSort && newSort !== existing.sort_order) changes.push({ field: "sort_order", old: existing.sort_order, new: newSort });
          const newTemplate = csvRow["Template Suffix"] || "";
          if (newTemplate && newTemplate !== existing.template_suffix) changes.push({ field: "template_suffix", old: existing.template_suffix, new: newTemplate });
          if (!newBody && !existing.body_html) warnings.push("Body HTML is empty (bad for SEO)");
          if (changes.length > 0) {
            diffs.push({ shopify_id: sid, title: existing.title, handle: existing.handle, collection_type: existing.collection_type, changes, warnings });
          }
        }
        setImportDiffs(diffs);
        setImportState("parsed");
        if (diffs.length === 0) toast.info("No changes detected in CSV");
        else toast.success(`Found ${diffs.length} collections with changes`);
      },
    });
  }, [importFile, rows]);

  const handleImportPush = useCallback(async () => {
    setImportState("pushing");
    let ok = 0, fail = 0;
    for (let i = 0; i < importDiffs.length; i++) {
      setImportProgress(Math.round(((i + 1) / importDiffs.length) * 100));
      const diff = importDiffs[i];
      const seoFields: Record<string, string> = {};
      for (const c of diff.changes) {
        if (c.field === "body_html") seoFields.body_html = c.new;
        if (c.field === "seo_title") seoFields.meta_title = c.new;
        if (c.field === "seo_description") seoFields.meta_description = c.new;
      }
      try {
        await updateCollectionSEO(diff.shopify_id, diff.collection_type, seoFields);
        ok++;
      } catch { fail++; }
      if (i < importDiffs.length - 1) await new Promise(r => setTimeout(r, 500));
    }
    setImportResults({ ok, fail });
    setImportState("done");
    localStorage.removeItem(CACHE_KEY);
    toast.success(`Updated ${ok} collections${fail ? `, ${fail} failed` : ""}`);
  }, [importDiffs]);

  // ── SEO Health ──
  const seoIssues = useMemo<SEOIssue[]>(() => {
    const issues: SEOIssue[] = [];
    const titleSet = new Map<string, number[]>();
    for (const r of rows) {
      const ri: string[] = [];
      if (!r.seo_title) ri.push("Missing SEO title");
      else if (r.seo_title.length > 60) ri.push(`SEO title too long (${r.seo_title.length}/60)`);
      if (!r.seo_description) ri.push("Missing SEO description");
      else if (r.seo_description.length > 160) ri.push(`SEO description too long (${r.seo_description.length}/160)`);
      if (!r.body_html) ri.push("Body HTML empty");
      if (ri.length) issues.push({ collection_id: r.shopify_id, title: r.title, handle: r.handle, issues: ri });
      const key = r.title.toLowerCase().trim();
      if (!titleSet.has(key)) titleSet.set(key, []);
      titleSet.get(key)!.push(r.shopify_id);
    }
    for (const [, ids] of titleSet) {
      if (ids.length > 1) {
        for (const id of ids) {
          const existing = issues.find(i => i.collection_id === id);
          if (existing) existing.issues.push("Duplicate title");
          else {
            const r = rows.find(x => x.shopify_id === id)!;
            issues.push({ collection_id: id, title: r.title, handle: r.handle, issues: ["Duplicate title"] });
          }
        }
      }
    }
    return issues;
  }, [rows]);

  // ── Workbench save ──
  const handleSaveSEO = useCallback(async (row: CollectionRow) => {
    setSavingId(row.shopify_id);
    try {
      await updateCollectionSEO(row.shopify_id, row.collection_type, {
        meta_title: editSeoTitle, meta_description: editSeoDesc,
      });
      setRows(prev => prev.map(r => r.shopify_id === row.shopify_id ? { ...r, seo_title: editSeoTitle, seo_description: editSeoDesc } : r));
      setEditingId(null);
      toast.success("SEO updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally { setSavingId(null); }
  }, [editSeoTitle, editSeoDesc]);

  // ── Bulk prefix ──
  const handleBulkPrefix = useCallback(async () => {
    if (!bulkPrefix || selectedIds.size === 0) return;
    const targets = rows.filter(r => selectedIds.has(r.shopify_id));
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const newTitle = `${bulkPrefix} ${t.seo_title || t.title}`;
      try {
        await updateCollectionSEO(t.shopify_id, t.collection_type, { meta_title: newTitle });
        setRows(prev => prev.map(r => r.shopify_id === t.shopify_id ? { ...r, seo_title: newTitle } : r));
      } catch { /* continue */ }
      if (i < targets.length - 1) await new Promise(r => setTimeout(r, 500));
    }
    setSelectedIds(new Set());
    setBulkPrefix("");
    toast.success(`Applied prefix to ${targets.length} collections`);
  }, [bulkPrefix, selectedIds, rows]);

  // ── AI SEO ──
  const handleAiOptimize = useCallback(async (row: CollectionRow) => {
    setAiLoadingId(row.shopify_id);
    setAiSuggestions(null);
    try {
      const { data, error } = await supabase.functions.invoke("collection-seo", {
        body: {
          collections: [{ title: row.title, handle: row.handle, body_html: row.body_html }],
          mode: "seo_only",
        },
      });
      if (error) throw error;
      const result = data?.results?.[0] || data;
      setAiSuggestions({
        id: row.shopify_id,
        titles: [result.seo_title || result.meta_title || `Buy ${row.title} Online`, `Shop ${row.title} | Free Shipping`, `${row.title} Collection – Best Deals`].filter(Boolean).slice(0, 3),
        descs: [result.seo_description || result.meta_description || `Explore our ${row.title} collection.`, `Shop the latest ${row.title} with fast shipping and easy returns.`, `Discover ${row.title} – curated picks at great prices.`].filter(Boolean).slice(0, 3),
      });
    } catch {
      setAiSuggestions({
        id: row.shopify_id,
        titles: [`Buy ${row.title} Online`, `Shop ${row.title} | Free Shipping`, `${row.title} – Best Deals`],
        descs: [`Explore our ${row.title} collection with fast shipping.`, `Shop the latest ${row.title} with easy returns.`, `Discover ${row.title} – curated picks at great prices.`],
      });
    } finally { setAiLoadingId(null); }
  }, []);

  const applyAiSuggestion = useCallback(async (row: CollectionRow, title: string, desc: string) => {
    setSavingId(row.shopify_id);
    try {
      await updateCollectionSEO(row.shopify_id, row.collection_type, { meta_title: title, meta_description: desc });
      setRows(prev => prev.map(r => r.shopify_id === row.shopify_id ? { ...r, seo_title: title, seo_description: desc } : r));
      setAiSuggestions(null);
      toast.success("AI SEO applied");
    } catch (err) {
      toast.error("Failed to apply");
    } finally { setSavingId(null); }
  }, []);

  const customCount = rows.filter(r => r.collection_type === "custom").length;
  const smartCount = rows.filter(r => r.collection_type === "smart").length;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/95 backdrop-blur sticky top-0 z-10">
        <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0"><ChevronLeft className="w-5 h-5" /></Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold font-display truncate">Collection SEO Manager</h1>
          <p className="text-[10px] text-muted-foreground">Export, optimize, and import collection SEO in bulk</p>
        </div>
        <Badge variant="outline" className="text-[10px]" title="Stocky didn't do this. We do. Export your collections, optimize SEO in bulk, and grow your traffic.">
          <Sparkles className="w-3 h-3 mr-1" /> New
        </Badge>
      </div>

      {/* Loading / Error */}
      {fetchState === "fetching" && (
        <Card className="m-4 p-6 space-y-3">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <p className="text-sm font-medium">{progress < 30 ? "Connecting…" : progress < 80 ? "Fetching collections…" : "Preparing…"}</p>
          </div>
          <Progress value={progress} className="h-2" />
        </Card>
      )}
      {fetchState === "error" && (
        <Card className="m-4 p-4 space-y-2">
          <div className="flex items-center gap-2 text-destructive"><AlertTriangle className="w-5 h-5" /><p className="text-sm font-medium">Error</p></div>
          <p className="text-xs text-muted-foreground">{errorMsg}</p>
          <Button variant="outline" size="sm" onClick={() => fetchCollections(true)}><RefreshCw className="w-4 h-4 mr-1" /> Retry</Button>
        </Card>
      )}

      {fetchState === "ready" && (
        <div className="flex-1 overflow-y-auto pb-28">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3 px-4 pt-4">
            <Card className="p-3 text-center"><p className="text-2xl font-bold text-primary">{rows.length}</p><p className="text-[10px] text-muted-foreground">Total</p></Card>
            <Card className="p-3 text-center"><p className="text-2xl font-bold">{customCount}</p><p className="text-[10px] text-muted-foreground">Custom</p></Card>
            <Card className="p-3 text-center"><p className="text-2xl font-bold">{smartCount}</p><p className="text-[10px] text-muted-foreground">Smart</p></Card>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="px-4 pt-4">
            <TabsList className="w-full grid grid-cols-4 h-9">
              <TabsTrigger value="export" className="text-xs"><Download className="w-3 h-3 mr-1" />Export</TabsTrigger>
              <TabsTrigger value="workbench" className="text-xs"><Edit3 className="w-3 h-3 mr-1" />SEO</TabsTrigger>
              <TabsTrigger value="import" className="text-xs"><Upload className="w-3 h-3 mr-1" />Import</TabsTrigger>
              <TabsTrigger value="health" className="text-xs"><BarChart3 className="w-3 h-3 mr-1" />Health</TabsTrigger>
            </TabsList>

            {/* ═══ TAB 1: EXPORT ═══ */}
            <TabsContent value="export" className="space-y-4 mt-4">
              <Card className="p-4 space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-2"><FolderOpen className="w-4 h-4 text-primary" /> Export Settings</h3>
                <div className="flex gap-2 flex-wrap">
                  {(["all", "custom", "smart"] as const).map(v => (
                    <Button key={v} size="sm" variant={filterType === v ? "default" : "outline"} onClick={() => setFilterType(v)} className="text-xs capitalize">{v}</Button>
                  ))}
                </div>
                <div className="flex gap-2 flex-wrap">
                  {(["all", "yes", "no"] as const).map(v => (
                    <Button key={v} size="sm" variant={filterPublished === v ? "default" : "outline"} onClick={() => setFilterPublished(v)} className="text-xs">
                      {v === "all" ? "All status" : v === "yes" ? "Published" : "Unpublished"}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{filteredRows.length} collection{filteredRows.length !== 1 ? "s" : ""} match filters</p>
              </Card>
              <Button className="w-full h-12 text-base font-semibold" onClick={handleExport} disabled={filteredRows.length === 0}>
                <Download className="w-5 h-5 mr-2" /> Export {filteredRows.length} Collections to CSV
              </Button>
              <p className="text-[10px] text-muted-foreground text-center">Matrixify-compatible format. Edit SEO fields in Excel/Google Sheets, then re-import.</p>
              <Button variant="ghost" className="w-full" onClick={() => fetchCollections(true)}><RefreshCw className="w-4 h-4 mr-2" /> Re-fetch</Button>
            </TabsContent>

            {/* ═══ TAB 2: SEO WORKBENCH ═══ */}
            <TabsContent value="workbench" className="space-y-3 mt-4">
              <div className="flex gap-2">
                <Input placeholder="Search collections…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="text-xs h-8" />
              </div>

              {/* Bulk edit bar */}
              {selectedIds.size > 0 && (
                <Card className="p-3 flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary" className="text-[10px]">{selectedIds.size} selected</Badge>
                  <Input placeholder="Add prefix…" value={bulkPrefix} onChange={e => setBulkPrefix(e.target.value)} className="flex-1 text-xs h-7 min-w-[120px]" />
                  <Button size="sm" className="text-xs h-7" onClick={handleBulkPrefix} disabled={!bulkPrefix}>Apply prefix</Button>
                  <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setSelectedIds(new Set())}>Clear</Button>
                </Card>
              )}

              {/* Collection list */}
              <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
                {filteredRows.map(r => (
                  <Card key={r.shopify_id} className="p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Checkbox checked={selectedIds.has(r.shopify_id)} onCheckedChange={v => {
                        const next = new Set(selectedIds);
                        v ? next.add(r.shopify_id) : next.delete(r.shopify_id);
                        setSelectedIds(next);
                      }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{r.title}</p>
                        <p className="text-[10px] text-muted-foreground truncate">/{r.handle}</p>
                      </div>
                      <Badge variant="outline" className="text-[9px]">{r.collection_type}</Badge>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => handleAiOptimize(r)} disabled={aiLoadingId === r.shopify_id}>
                        {aiLoadingId === r.shopify_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => {
                        setEditingId(editingId === r.shopify_id ? null : r.shopify_id);
                        setEditSeoTitle(r.seo_title);
                        setEditSeoDesc(r.seo_description);
                      }}>
                        <Edit3 className="w-3 h-3" />
                      </Button>
                    </div>

                    {/* AI suggestions */}
                    {aiSuggestions?.id === r.shopify_id && (
                      <Card className="p-3 bg-primary/5 space-y-2">
                        <p className="text-[10px] font-semibold text-primary">AI Suggestions</p>
                        {aiSuggestions.titles.map((t, i) => (
                          <div key={i} className="flex items-start gap-2 text-[10px]">
                            <div className="flex-1">
                              <p className="font-medium">{t} <span className="text-muted-foreground">({t.length}/60)</span></p>
                              <p className="text-muted-foreground">{aiSuggestions.descs[i]} <span>({aiSuggestions.descs[i]?.length}/160)</span></p>
                            </div>
                            <Button size="sm" variant="outline" className="h-6 text-[9px] shrink-0" onClick={() => applyAiSuggestion(r, t, aiSuggestions.descs[i] || "")} disabled={savingId === r.shopify_id}>
                              <Check className="w-3 h-3" />
                            </Button>
                          </div>
                        ))}
                        <Button size="sm" variant="ghost" className="text-[10px] h-6" onClick={() => setAiSuggestions(null)}>Dismiss</Button>
                      </Card>
                    )}

                    {/* Inline editor */}
                    {editingId === r.shopify_id && (
                      <div className="space-y-2 pl-6">
                        <div>
                          <label className="text-[10px] text-muted-foreground">SEO Title ({editSeoTitle.length}/60)</label>
                          <Input value={editSeoTitle} onChange={e => setEditSeoTitle(e.target.value)} className={`text-xs h-8 ${editSeoTitle.length > 60 ? "border-destructive" : ""}`} />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground">SEO Description ({editSeoDesc.length}/160)</label>
                          <Textarea value={editSeoDesc} onChange={e => setEditSeoDesc(e.target.value)} className={`text-xs min-h-[60px] ${editSeoDesc.length > 160 ? "border-destructive" : ""}`} />
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" className="text-xs h-7" onClick={() => handleSaveSEO(r)} disabled={savingId === r.shopify_id}>
                            {savingId === r.shopify_id ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Check className="w-3 h-3 mr-1" />} Save
                          </Button>
                          <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setEditingId(null)}>Cancel</Button>
                        </div>
                      </div>
                    )}
                  </Card>
                ))}
                {filteredRows.length === 0 && <p className="text-center text-xs text-muted-foreground py-8">No collections match</p>}
              </div>
            </TabsContent>

            {/* ═══ TAB 3: IMPORT ═══ */}
            <TabsContent value="import" className="space-y-4 mt-4">
              {importState === "idle" && (
                <Card className="p-6 space-y-4">
                  <h3 className="text-sm font-semibold">Import Collection SEO Updates</h3>
                  <p className="text-xs text-muted-foreground">Upload your edited CSV. We'll show a preview of changes before applying.</p>
                  <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
                    <input type="file" accept=".csv" className="hidden" id="csv-import" onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) { setImportFile(f); toast.success(`File: ${f.name}`); }
                    }} />
                    <label htmlFor="csv-import" className="cursor-pointer space-y-2 block">
                      <Upload className="w-8 h-8 mx-auto text-muted-foreground" />
                      <p className="text-xs text-muted-foreground">{importFile ? importFile.name : "Drop CSV or click to browse"}</p>
                    </label>
                  </div>
                  <Button className="w-full" onClick={handleImportParse} disabled={!importFile}><Eye className="w-4 h-4 mr-2" /> Preview Changes</Button>
                </Card>
              )}

              {importState === "parsed" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">{importDiffs.length} collections to update</h3>
                    <Button size="sm" variant="ghost" onClick={() => { setImportState("idle"); setImportDiffs([]); }}>
                      <X className="w-3 h-3 mr-1" /> Reset
                    </Button>
                  </div>
                  <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                    {importDiffs.map(d => (
                      <Card key={d.shopify_id} className="p-3 space-y-1.5">
                        <p className="text-xs font-medium">{d.title} <span className="text-muted-foreground">({d.handle})</span></p>
                        {d.changes.map((c, i) => (
                          <div key={i} className="text-[10px] grid grid-cols-[80px_1fr] gap-1">
                            <span className="font-medium capitalize">{c.field.replace("_", " ")}</span>
                            <span><span className="line-through text-muted-foreground">{c.old || "(empty)"}</span> → <span className="text-primary">{c.new}</span></span>
                          </div>
                        ))}
                        {d.warnings.map((w, i) => (
                          <div key={i} className="flex items-center gap-1 text-[10px] text-amber-600"><AlertTriangle className="w-3 h-3" />{w}</div>
                        ))}
                      </Card>
                    ))}
                  </div>
                  <Button className="w-full h-12 font-semibold" onClick={handleImportPush}>
                    <Check className="w-5 h-5 mr-2" /> Apply {importDiffs.length} Updates
                  </Button>
                </div>
              )}

              {importState === "pushing" && (
                <Card className="p-6 space-y-3">
                  <div className="flex items-center gap-3"><Loader2 className="w-5 h-5 animate-spin text-primary" /><p className="text-sm font-medium">Updating collections… ({importProgress}%)</p></div>
                  <Progress value={importProgress} className="h-2" />
                  <p className="text-[10px] text-muted-foreground">500ms delay between updates to respect rate limits</p>
                </Card>
              )}

              {importState === "done" && (
                <Card className="p-6 space-y-3 text-center">
                  <CheckCircle2 className="w-10 h-10 text-primary mx-auto" />
                  <p className="text-sm font-semibold">Import Complete</p>
                  <p className="text-xs text-muted-foreground">{importResults.ok} updated, {importResults.fail} failed</p>
                  <Button variant="outline" onClick={() => { setImportState("idle"); setImportDiffs([]); setImportFile(null); fetchCollections(true); }}>
                    <RefreshCw className="w-4 h-4 mr-2" /> Done
                  </Button>
                </Card>
              )}
            </TabsContent>

            {/* ═══ TAB 4: SEO HEALTH ═══ */}
            <TabsContent value="health" className="space-y-4 mt-4">
              <Card className="p-4 space-y-2">
                <h3 className="text-sm font-semibold flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" /> SEO Health Report</h3>
                {seoIssues.length === 0 ? (
                  <div className="flex items-center gap-2 text-primary py-4 justify-center">
                    <CheckCircle2 className="w-5 h-5" />
                    <p className="text-sm font-medium">All collections look great!</p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{seoIssues.length} collection{seoIssues.length !== 1 ? "s" : ""} with SEO issues</p>
                )}
              </Card>

              {/* Summary badges */}
              {seoIssues.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {[
                    { label: "Missing title", count: seoIssues.filter(i => i.issues.includes("Missing SEO title")).length },
                    { label: "Missing desc", count: seoIssues.filter(i => i.issues.includes("Missing SEO description")).length },
                    { label: "Empty body", count: seoIssues.filter(i => i.issues.includes("Body HTML empty")).length },
                    { label: "Duplicates", count: seoIssues.filter(i => i.issues.includes("Duplicate title")).length },
                  ].filter(b => b.count > 0).map(b => (
                    <Badge key={b.label} variant="secondary" className="text-[10px]">{b.label}: {b.count}</Badge>
                  ))}
                </div>
              )}

              <div className="space-y-2 max-h-[55vh] overflow-y-auto">
                {seoIssues.map(si => (
                  <Card key={si.collection_id} className="p-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium">{si.title}</p>
                        <p className="text-[10px] text-muted-foreground">/{si.handle}</p>
                      </div>
                      <Button size="sm" variant="outline" className="text-[10px] h-6" onClick={() => {
                        const row = rows.find(r => r.shopify_id === si.collection_id);
                        if (row) {
                          setActiveTab("workbench");
                          setEditingId(row.shopify_id);
                          setEditSeoTitle(row.seo_title);
                          setEditSeoDesc(row.seo_description);
                        }
                      }}>
                        <Edit3 className="w-3 h-3 mr-1" /> Fix
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {si.issues.map((iss, i) => (
                        <Badge key={i} variant="destructive" className="text-[9px]">{iss}</Badge>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
};

export default CollectionSEOExport;
