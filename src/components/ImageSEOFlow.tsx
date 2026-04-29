import { useState, useCallback, useMemo, useEffect } from "react";
import { ChevronLeft, Link2, Store, Upload, Loader2, Settings2, Rocket, CheckCircle2, XCircle, RefreshCw, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_FILENAME_TEMPLATE,
  DEFAULT_ALT_TEMPLATE,
  STANDARD_VARS,
  previewSample,
  type TemplateVariables,
} from "@/lib/image-seo/template-engine";
import { runJobs, pushJobsToShopify, type ImageSeoJob } from "@/lib/image-seo/bulk-orchestrator";

interface Props {
  onBack: () => void;
}

const STORAGE_KEY = "image-seo-settings-v1";

interface Settings {
  filenameTemplate: string;
  altTemplate: string;
  maxDimension: number;
  quality: number;
  pushToShopify: boolean;
  business: string;
}

const DEFAULT_SETTINGS: Settings = {
  filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
  altTemplate: DEFAULT_ALT_TEMPLATE,
  maxDimension: 2048,
  quality: 82,
  pushToShopify: false,
  business: "",
};

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const FN_BASE = `https://${PROJECT_ID}.functions.supabase.co`;

interface ShopifyProduct {
  id: string;
  handle: string;
  title: string;
  vendor: string;
  productType: string;
  sku: string | null;
  images: Array<{ id: string; url: string; altText: string | null; width: number; height: number }>;
}

function formatBytes(b?: number): string {
  if (!b) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

export default function ImageSEOFlow({ onBack }: Props) {
  const [tab, setTab] = useState<"url" | "shopify" | "upload">("url");
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  const [showSettings, setShowSettings] = useState(false);

  // Tab state
  const [urlInput, setUrlInput] = useState("");
  const [extractedImages, setExtractedImages] = useState<string[]>([]);
  const [extractedInfo, setExtractedInfo] = useState<TemplateVariables>({});
  const [extracting, setExtracting] = useState(false);

  const [shopifyProducts, setShopifyProducts] = useState<ShopifyProduct[]>([]);
  const [shopifyCursor, setShopifyCursor] = useState<string | null>(null);
  const [shopifyHasMore, setShopifyHasMore] = useState(false);
  const [shopifyLoading, setShopifyLoading] = useState(false);
  const [shopifySearch, setShopifySearch] = useState("");
  const [selectedShopifyProductIds, setSelectedShopifyProductIds] = useState<Set<string>>(new Set());

  const [uploadFiles, setUploadFiles] = useState<File[]>([]);

  // Run state
  const [jobs, setJobs] = useState<ImageSeoJob[]>([]);
  const [running, setRunning] = useState(false);
  const [pushing, setPushing] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const filenamePreview = useMemo(
    () => previewSample(settings.filenameTemplate, "filename"),
    [settings.filenameTemplate],
  );
  const altPreview = useMemo(
    () => previewSample(settings.altTemplate, "alt"),
    [settings.altTemplate],
  );

  // ──────────────────────────────────────────────────────────────────
  // URL mode: extract images from a product page
  // ──────────────────────────────────────────────────────────────────
  const handleExtract = async () => {
    if (!urlInput.trim()) {
      toast.error("Paste a product URL first");
      return;
    }
    setExtracting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const resp = await fetch(`${FN_BASE}/image-seo-process`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ action: "extract_from_page", pageUrl: urlInput.trim() }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || `Extract failed (${resp.status})`);
      setExtractedImages(json.imageUrls || []);
      setExtractedInfo(json.productInfo || {});
      if (!json.imageUrls?.length) toast.warning("No images found on the page");
      else toast.success(`Found ${json.imageUrls.length} image${json.imageUrls.length === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Extract failed");
    } finally {
      setExtracting(false);
    }
  };

  // ──────────────────────────────────────────────────────────────────
  // Shopify mode: paginated product picker
  // ──────────────────────────────────────────────────────────────────
  const loadShopify = useCallback(async (reset = false) => {
    setShopifyLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const resp = await fetch(`${FN_BASE}/image-seo-shopify-list`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          cursor: reset ? null : shopifyCursor,
          query: shopifySearch.trim() || null,
          pageSize: 25,
        }),
      });
      const json = await resp.json();
      if (!resp.ok) {
        if (json.needs_reauth) {
          toast.error("Shopify reconnection required — please re-launch the app");
        } else {
          toast.error(json.error || `Load failed (${resp.status})`);
        }
        return;
      }
      setShopifyProducts((prev) => reset ? json.products : [...prev, ...json.products]);
      setShopifyCursor(json.pageInfo?.endCursor ?? null);
      setShopifyHasMore(Boolean(json.pageInfo?.hasNextPage));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Load failed");
    } finally {
      setShopifyLoading(false);
    }
  }, [shopifyCursor, shopifySearch]);

  useEffect(() => {
    if (tab === "shopify" && shopifyProducts.length === 0 && !shopifyLoading) {
      loadShopify(true);
    }
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleProduct = (id: string) => {
    setSelectedShopifyProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ──────────────────────────────────────────────────────────────────
  // Upload mode
  // ──────────────────────────────────────────────────────────────────
  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    setUploadFiles(arr);
    toast.success(`${arr.length} image${arr.length === 1 ? "" : "s"} ready`);
  };

  // ──────────────────────────────────────────────────────────────────
  // Run pipeline
  // ──────────────────────────────────────────────────────────────────
  const buildJobsForCurrentTab = (): ImageSeoJob[] => {
    if (tab === "url") {
      return extractedImages.map((url, i) => ({
        id: `u-${i}-${Date.now()}`,
        sourceType: "url",
        imageUrl: url,
        variables: { ...extractedInfo, business: settings.business, index: i },
        status: "queued",
      }));
    }
    if (tab === "shopify") {
      const out: ImageSeoJob[] = [];
      for (const p of shopifyProducts) {
        if (!selectedShopifyProductIds.has(p.id)) continue;
        p.images.forEach((img, i) => {
          out.push({
            id: `s-${p.id}-${img.id}`,
            sourceType: "shopify",
            imageUrl: img.url,
            shopifyProductId: p.id,
            shopifyMediaId: img.id,
            variables: {
              vendor: p.vendor,
              brand: p.vendor,
              title: p.title,
              sku: p.sku ?? undefined,
              product_type: p.productType,
              business: settings.business,
              index: i,
            },
            status: "queued",
          });
        });
      }
      return out;
    }
    // upload
    return uploadFiles.map((f, i) => ({
      id: `up-${i}-${Date.now()}`,
      sourceType: "upload",
      file: f,
      variables: {
        title: f.name.replace(/\.[^.]+$/, ""),
        business: settings.business,
        index: i,
      },
      status: "queued",
    }));
  };

  const handleRun = async () => {
    const initial = buildJobsForCurrentTab();
    if (!initial.length) {
      toast.error("Nothing to optimize yet");
      return;
    }
    setJobs(initial);
    setRunning(true);
    try {
      await runJobs(initial, {
        filenameTemplate: settings.filenameTemplate,
        altTemplate: settings.altTemplate,
        maxDimension: settings.maxDimension,
        quality: settings.quality,
        concurrency: 4,
        onUpdate: (updated) => {
          setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
        },
      });
      toast.success("Optimization complete");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  };

  const handlePush = async () => {
    if (tab !== "shopify") {
      toast.error("Push to Shopify is only available in the Shopify mode");
      return;
    }
    const ready = jobs.filter((j) => j.status === "done" && j.shopifyProductId);
    if (!ready.length) {
      toast.error("No completed Shopify jobs to push");
      return;
    }
    setPushing(true);
    try {
      const { successes, failures } = await pushJobsToShopify(ready, (updated) => {
        setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
      });
      if (failures === 0) toast.success(`Pushed ${successes} image${successes === 1 ? "" : "s"} to Shopify`);
      else toast.warning(`Pushed ${successes}, ${failures} failed`);
    } finally {
      setPushing(false);
    }
  };

  const totalSavings = useMemo(() => {
    const totalOrig = jobs.reduce((s, j) => s + (j.originalSize || 0), 0);
    const totalNew = jobs.reduce((s, j) => s + (j.newSize || 0), 0);
    if (!totalOrig) return null;
    return { totalOrig, totalNew, pct: Math.round((1 - totalNew / totalOrig) * 100) };
  }, [jobs]);

  return (
    <div className="container mx-auto max-w-6xl space-y-4 px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Image SEO</h1>
          <p className="text-sm text-muted-foreground">
            Bulk compress, rename and alt-text product images. Push back to Shopify.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowSettings((s) => !s)}>
          <Settings2 className="mr-2 h-4 w-4" />
          {showSettings ? "Hide" : "Templates"}
        </Button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Templates &amp; output</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="fn-template">Filename template</Label>
              <Input
                id="fn-template"
                value={settings.filenameTemplate}
                onChange={(e) => setSettings({ ...settings, filenameTemplate: e.target.value })}
                className="font-mono text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Preview: <span className="font-mono text-foreground">{filenamePreview}</span>
              </p>
            </div>
            <div>
              <Label htmlFor="alt-template">Alt-text template</Label>
              <Input
                id="alt-template"
                value={settings.altTemplate}
                onChange={(e) => setSettings({ ...settings, altTemplate: e.target.value })}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Preview: <span className="text-foreground">{altPreview}</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              <span className="text-muted-foreground">Variables:</span>
              {STANDARD_VARS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => navigator.clipboard.writeText(`{${v}}`).then(() => toast.success(`Copied {${v}}`))}
                  className="rounded border bg-muted px-2 py-0.5 font-mono text-foreground hover:bg-muted/70"
                >{`{${v}}`}</button>
              ))}
            </div>
            <div>
              <Label htmlFor="business">Business name (for {`{business}`} variable)</Label>
              <Input
                id="business"
                value={settings.business}
                onChange={(e) => setSettings({ ...settings, business: e.target.value })}
                placeholder="e.g. Aria Boutique"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label>Max dimension: {settings.maxDimension}px</Label>
                <Slider
                  value={[settings.maxDimension]}
                  min={512}
                  max={2400}
                  step={64}
                  onValueChange={([v]) => setSettings({ ...settings, maxDimension: v })}
                />
              </div>
              <div>
                <Label>Quality: {settings.quality}</Label>
                <Slider
                  value={[settings.quality]}
                  min={50}
                  max={95}
                  step={1}
                  onValueChange={([v]) => setSettings({ ...settings, quality: v })}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="url"><Link2 className="mr-2 h-4 w-4" />Paste URL</TabsTrigger>
          <TabsTrigger value="shopify"><Store className="mr-2 h-4 w-4" />Shopify bulk</TabsTrigger>
          <TabsTrigger value="upload"><Upload className="mr-2 h-4 w-4" />Direct upload</TabsTrigger>
        </TabsList>

        {/* URL TAB */}
        <TabsContent value="url" className="space-y-3">
          <Card>
            <CardContent className="space-y-3 pt-6">
              <Label htmlFor="url">Product URL</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="url"
                  type="url"
                  placeholder="https://yourstore.com/products/silk-midi-dress"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  className="flex-1"
                />
                <Button onClick={handleExtract} disabled={extracting}>
                  {extracting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Fetch images
                </Button>
              </div>
              {extractedImages.length > 0 && (
                <>
                  <div className="flex flex-wrap gap-2 pt-2 text-xs text-muted-foreground">
                    {extractedInfo.title && <Badge variant="secondary">Title: {String(extractedInfo.title)}</Badge>}
                    {extractedInfo.vendor && <Badge variant="secondary">Vendor: {String(extractedInfo.vendor)}</Badge>}
                    {extractedInfo.sku && <Badge variant="secondary">SKU: {String(extractedInfo.sku)}</Badge>}
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-2 sm:grid-cols-4 md:grid-cols-6">
                    {extractedImages.map((u, i) => (
                      <div key={i} className="aspect-square overflow-hidden rounded border bg-muted">
                        <img src={u} alt="" loading="lazy" className="h-full w-full object-cover" />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* SHOPIFY TAB */}
        <TabsContent value="shopify" className="space-y-3">
          <Card>
            <CardContent className="space-y-3 pt-6">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  placeholder="Search products (vendor, title, tag)…"
                  value={shopifySearch}
                  onChange={(e) => setShopifySearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && loadShopify(true)}
                  className="flex-1"
                />
                <Button variant="outline" onClick={() => loadShopify(true)} disabled={shopifyLoading}>
                  {shopifyLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Reload
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {selectedShopifyProductIds.size} of {shopifyProducts.length} selected
              </p>
              <div className="max-h-[480px] space-y-1.5 overflow-y-auto">
                {shopifyProducts.map((p) => {
                  const sel = selectedShopifyProductIds.has(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleProduct(p.id)}
                      className={`flex w-full items-center gap-3 rounded border p-2 text-left transition-colors ${
                        sel ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                      }`}
                    >
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-muted">
                        {p.images[0]
                          ? <img src={p.images[0].url} alt="" loading="lazy" className="h-full w-full object-cover" />
                          : <ImageIcon className="m-auto h-5 w-5 text-muted-foreground" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{p.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {p.vendor || "—"} · {p.images.length} image{p.images.length === 1 ? "" : "s"}
                        </p>
                      </div>
                      {sel && <CheckCircle2 className="h-4 w-4 text-primary" />}
                    </button>
                  );
                })}
                {shopifyHasMore && (
                  <Button variant="outline" size="sm" className="w-full" onClick={() => loadShopify(false)} disabled={shopifyLoading}>
                    {shopifyLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Load more
                  </Button>
                )}
              </div>
              <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-3">
                <div>
                  <p className="text-sm font-medium">Push optimized images back to Shopify</p>
                  <p className="text-xs text-muted-foreground">Replaces product images and sets new alt text.</p>
                </div>
                <Switch
                  checked={settings.pushToShopify}
                  onCheckedChange={(v) => setSettings({ ...settings, pushToShopify: v })}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* UPLOAD TAB */}
        <TabsContent value="upload" className="space-y-3">
          <Card>
            <CardContent className="pt-6">
              <label
                htmlFor="files"
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/30 p-10 text-center hover:bg-muted/50"
              >
                <Upload className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">Click to choose images, or drop them here</p>
                <p className="text-xs text-muted-foreground">JPG, PNG, WebP — converted to optimized WebP</p>
                <input
                  id="files"
                  type="file"
                  multiple
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleFiles(e.target.files)}
                />
              </label>
              {uploadFiles.length > 0 && (
                <p className="mt-3 text-sm text-muted-foreground">{uploadFiles.length} file(s) ready</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Run controls */}
      <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">
          {jobs.length > 0 && totalSavings && (
            <>Saved <span className="font-medium text-foreground">{totalSavings.pct}%</span> ({formatBytes(totalSavings.totalOrig)} → {formatBytes(totalSavings.totalNew)})</>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {tab === "shopify" && settings.pushToShopify && jobs.some((j) => j.status === "done") && (
            <Button variant="outline" onClick={handlePush} disabled={pushing || running}>
              {pushing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}
              Push to Shopify
            </Button>
          )}
          <Button onClick={handleRun} disabled={running}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}
            Optimize
          </Button>
        </div>
      </div>

      {/* Results table */}
      {jobs.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Results ({jobs.length})</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="p-2">Image</th>
                  <th className="p-2">New filename</th>
                  <th className="p-2">Alt text</th>
                  <th className="p-2 text-right">Size</th>
                  <th className="p-2 text-right">Saved</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j, idx) => (
                  <tr key={j.id} className={`border-t ${idx % 2 ? "bg-muted/20" : ""}`} style={{ height: 32 }}>
                    <td className="p-2">
                      <div className="h-8 w-8 overflow-hidden rounded bg-muted">
                        {j.newUrl
                          ? <img src={j.newUrl} alt="" className="h-full w-full object-cover" />
                          : j.imageUrl
                            ? <img src={j.imageUrl} alt="" className="h-full w-full object-cover" />
                            : <ImageIcon className="m-auto h-4 w-4 text-muted-foreground" />}
                      </div>
                    </td>
                    <td className="p-2 font-mono">{j.newFilename || "—"}</td>
                    <td className="p-2 max-w-[280px] truncate" title={j.altText}>{j.altText || "—"}</td>
                    <td className="p-2 text-right font-mono">
                      {j.newSize ? formatBytes(j.newSize) : "—"}
                    </td>
                    <td className="p-2 text-right font-mono text-success">
                      {typeof j.savingsPct === "number" ? `${j.savingsPct}%` : "—"}
                    </td>
                    <td className="p-2">
                      {j.status === "queued" && <Badge variant="outline">queued</Badge>}
                      {j.status === "processing" && <Badge variant="secondary"><Loader2 className="mr-1 h-3 w-3 animate-spin" />processing</Badge>}
                      {j.status === "done" && <Badge variant="default" className="bg-success text-success-foreground">done</Badge>}
                      {j.status === "pushed" && <Badge variant="default" className="bg-primary"><Rocket className="mr-1 h-3 w-3" />pushed</Badge>}
                      {j.status === "error" && (
                        <Badge variant="destructive" title={j.error}>
                          <XCircle className="mr-1 h-3 w-3" />
                          error
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
