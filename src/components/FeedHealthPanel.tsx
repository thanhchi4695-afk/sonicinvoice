import { useState, useCallback } from "react";
import { ChevronLeft, Activity, Check, AlertTriangle, Loader2, Eye, ShoppingCart, Pencil, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getActiveDirectStore } from "@/lib/shopify-direct";
import {
  type FeedHealthProduct,
  type FeedHealthRow,
  type DetectedAttributes,
  detectAttributes,
  parseShopifyProduct,
} from "@/lib/feed-health";

type Step = "idle" | "scanning" | "reviewing" | "pushing" | "done";

export default function FeedHealthPanel({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<Step>("idle");
  const [rows, setRows] = useState<FeedHealthRow[]>([]);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 });
  const [pushProgress, setPushProgress] = useState({ done: 0, total: 0, failed: 0 });
  const [tab, setTab] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [namespace, setNamespace] = useState("custom");
  const [detailRow, setDetailRow] = useState<FeedHealthRow | null>(null);
  const [editField, setEditField] = useState<{ id: string; field: string } | null>(null);

  const directStore = getActiveDirectStore();

  // Helper to call the appropriate proxy
  const callProxy = async (body: Record<string, unknown>) => {
    if (directStore) {
      const { data, error } = await supabase.functions.invoke("shopify-direct-proxy", {
        body: { store_url: directStore.storeUrl, token: directStore.token, ...body },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data;
    }
    // Fallback to OAuth proxy
    const { data, error } = await supabase.functions.invoke("shopify-proxy", { body });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data;
  };

  // ── SCAN ──────────────────────────────────────
  const startScan = async () => {
    setStep("scanning");
    setScanProgress({ done: 0, total: 0 });
    setRows([]);

    const allProducts: FeedHealthRow[] = [];
    let pageInfo: string | null = null;
    let totalFetched = 0;

    try {
      do {
        const data = await callProxy({
          action: "get_products_page",
          limit: 250,
          page_info: pageInfo || undefined,
        });

        const products = (data.products || []).map((raw: any) => {
          const product = parseShopifyProduct(raw);
          const detected = detectAttributes(product);
          return { product, detected, pushed: false, edited: false } as FeedHealthRow;
        });

        allProducts.push(...products);
        totalFetched += products.length;
        pageInfo = data.nextPageInfo || null;

        setScanProgress({ done: totalFetched, total: totalFetched + (pageInfo ? 250 : 0) });
        setRows([...allProducts]);

        // Small delay for rate limiting
        if (pageInfo) await new Promise(r => setTimeout(r, 300));
      } while (pageInfo);

      setScanProgress({ done: totalFetched, total: totalFetched });
      setStep("reviewing");
      toast.success(`Scanned ${totalFetched} products`);
    } catch (err) {
      console.error("Scan error:", err);
      toast.error(err instanceof Error ? err.message : "Scan failed");
      if (allProducts.length > 0) {
        setStep("reviewing");
      } else {
        setStep("idle");
      }
    }
  };

  // ── PUSH ──────────────────────────────────────
  const pushMetafields = async (ids?: string[]) => {
    const toPush = ids
      ? rows.filter(r => ids.includes(r.product.id))
      : rows;

    if (toPush.length === 0) return;

    setStep("pushing");
    setPushProgress({ done: 0, total: toPush.length, failed: 0 });

    const BATCH = 8; // 8 products × 3 metafields = 24 (max 25)
    let success = 0;
    let failed = 0;

    for (let i = 0; i < toPush.length; i += BATCH) {
      const batch = toPush.slice(i, i + BATCH);

      const metafields = batch.flatMap(r => {
        const mf: Array<{ ownerId: string; namespace: string; key: string; value: string; type: string }> = [];
        if (r.detected.gender) mf.push({
          ownerId: r.product.id, namespace, key: "gender",
          value: r.detected.gender, type: "single_line_text_field",
        });
        if (r.detected.ageGroup) mf.push({
          ownerId: r.product.id, namespace, key: "age_group",
          value: r.detected.ageGroup, type: "single_line_text_field",
        });
        if (r.detected.color) mf.push({
          ownerId: r.product.id, namespace, key: "color",
          value: r.detected.color, type: "single_line_text_field",
        });
        return mf;
      });

      if (metafields.length === 0) { success += batch.length; continue; }

      try {
        await callProxy({ action: "set_metafields", metafields });
        success += batch.length;
        setRows(prev => prev.map(r => {
          if (batch.find(b => b.product.id === r.product.id)) {
            return { ...r, pushed: true };
          }
          return r;
        }));
      } catch {
        failed += batch.length;
      }

      setPushProgress({ done: success + failed, total: toPush.length, failed });

      // Rate limit
      if (i + BATCH < toPush.length) await new Promise(r => setTimeout(r, 500));
    }

    setPushProgress({ done: success + failed, total: toPush.length, failed });
    setStep("done");
    toast.success(`Pushed ${success} products${failed > 0 ? `, ${failed} failed` : ""}`);
  };

  // ── EDIT HANDLERS ──────────────────────────────
  const updateDetected = (productId: string, field: keyof DetectedAttributes, value: string) => {
    setRows(prev => prev.map(r => {
      if (r.product.id !== productId) return r;
      return { ...r, detected: { ...r.detected, [field]: value }, edited: true };
    }));
    if (detailRow?.product.id === productId) {
      setDetailRow(prev => prev ? { ...prev, detected: { ...prev.detected, [field]: value }, edited: true } : null);
    }
    setEditField(null);
  };

  // ── FILTERS ──────────────────────────────────
  const filtered = useCallback(() => {
    if (tab === "all") return rows;
    if (tab === "review") return rows.filter(r => r.detected.genderConf === "low" || r.detected.ageConf === "low" || r.detected.colorConf === "low" || !r.detected.color);
    if (tab === "no_color") return rows.filter(r => !r.detected.color);
    if (tab === "pushed") return rows.filter(r => r.pushed);
    return rows;
  }, [rows, tab]);

  const counts = {
    all: rows.length,
    review: rows.filter(r => r.detected.genderConf === "low" || r.detected.ageConf === "low" || !r.detected.color).length,
    no_color: rows.filter(r => !r.detected.color).length,
    pushed: rows.filter(r => r.pushed).length,
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const current = filtered();

  // ── IDLE VIEW ──────────────────────────────────
  if (step === "idle") {
    return (
      <div className="px-4 pt-6 pb-24 animate-fade-in">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
          <div>
            <h2 className="text-lg font-semibold font-display flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" /> Google Feed Health
            </h2>
            <p className="text-xs text-muted-foreground">Fix gender, age_group, and color for Google Shopping</p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-5 mb-4">
          <h3 className="text-sm font-semibold mb-2">How it works</h3>
          <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
            <li>Scans all products from your Shopify store</li>
            <li>Detects gender, age group, and color from titles, tags, and variants</li>
            <li>Review and edit detected values</li>
            <li>Push corrected metafields directly to Shopify via GraphQL</li>
            <li>Map metafields in your Google feed app (Simprosys / Google & YouTube)</li>
          </ol>
        </div>

        {/* Connected store indicator */}
        {directStore ? (
          <div className="bg-success/10 border border-success/20 rounded-lg p-3 mb-4 flex items-center gap-2">
            <Store className="w-4 h-4 text-success" />
            <div>
              <p className="text-xs font-medium text-success">{directStore.storeName}</p>
              <p className="text-[10px] text-muted-foreground">{directStore.storeUrl} · {directStore.productCount} products</p>
            </div>
          </div>
        ) : (
          <div className="bg-secondary/10 border border-secondary/20 rounded-lg p-3 mb-4">
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-secondary">No store connected.</span> Go to Account → Connected Shopify stores to connect one, or use the OAuth connection.
            </p>
          </div>
        )}

        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mb-4">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-primary">Why this matters:</span> Google requires gender, age_group, and color for apparel products.
            Missing values = disapproved listings = lost impressions.
          </p>
        </div>

        <Button variant="teal" className="w-full h-12 text-base" onClick={startScan}>
          <Activity className="w-4 h-4 mr-2" /> Scan store products
        </Button>
      </div>
    );
  }

  // ── SCANNING VIEW ──────────────────────────────
  if (step === "scanning") {
    return (
      <div className="px-4 pt-6 pb-24 animate-fade-in">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
          <h2 className="text-lg font-semibold font-display">Google Feed Health</h2>
        </div>
        <div className="bg-card border border-border rounded-lg p-6 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
          <p className="text-sm font-medium mb-2">Scanning your store…</p>
          <p className="text-xs text-muted-foreground mb-3">
            {scanProgress.done > 0 ? `${scanProgress.done} products scanned` : "Connecting to Shopify…"}
          </p>
          {scanProgress.total > 0 && (
            <Progress value={(scanProgress.done / scanProgress.total) * 100} className="h-2" />
          )}
        </div>
      </div>
    );
  }

  // ── PUSHING VIEW ──────────────────────────────
  if (step === "pushing") {
    return (
      <div className="px-4 pt-6 pb-24 animate-fade-in">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
          <h2 className="text-lg font-semibold font-display">Google Feed Health</h2>
        </div>
        <div className="bg-card border border-border rounded-lg p-6 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
          <p className="text-sm font-medium mb-2">Pushing metafields to Shopify…</p>
          <p className="text-xs text-muted-foreground mb-3">
            {pushProgress.done} of {pushProgress.total} products
            {pushProgress.failed > 0 && <span className="text-destructive"> · {pushProgress.failed} failed</span>}
          </p>
          <Progress value={(pushProgress.done / pushProgress.total) * 100} className="h-2" />
        </div>
      </div>
    );
  }

  // ── DONE VIEW ──────────────────────────────────
  if (step === "done") {
    return (
      <div className="px-4 pt-6 pb-24 animate-fade-in">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
          <h2 className="text-lg font-semibold font-display">Google Feed Health</h2>
        </div>

        <div className="bg-success/10 border border-success/20 rounded-lg p-5 mb-4 text-center">
          <Check className="w-8 h-8 text-success mx-auto mb-2" />
          <p className="text-sm font-semibold mb-1">Push complete</p>
          <p className="text-xs text-muted-foreground">
            {pushProgress.done - pushProgress.failed} products updated
            {pushProgress.failed > 0 && ` · ${pushProgress.failed} failed`}
          </p>
        </div>

        <div className="bg-card border border-border rounded-lg p-4 mb-4">
          <p className="text-xs font-semibold mb-2">Next steps</p>
          {namespace === "custom" ? (
            <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
              <li>In Simprosys → Settings → Shopify Metafields Mapping</li>
              <li>Map <code className="bg-muted px-1 rounded">custom.gender</code> → Gender</li>
              <li>Map <code className="bg-muted px-1 rounded">custom.age_group</code> → Age Group</li>
              <li>Map <code className="bg-muted px-1 rounded">custom.color</code> → Color</li>
              <li>Sync products in Simprosys</li>
            </ol>
          ) : (
            <p className="text-xs text-muted-foreground">Values are live in Shopify. Google re-crawls within 24–48 hours.</p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-card border border-border rounded-lg p-3 text-center">
            <p className="text-lg font-bold text-success">{pushProgress.done - pushProgress.failed}</p>
            <p className="text-[10px] text-muted-foreground">Updated</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-3 text-center">
            <p className="text-lg font-bold text-destructive">{pushProgress.failed}</p>
            <p className="text-[10px] text-muted-foreground">Errors</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-3 text-center">
            <p className="text-lg font-bold">{counts.no_color}</p>
            <p className="text-[10px] text-muted-foreground">No color</p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setStep("reviewing")}>Review products</Button>
          <Button variant="teal" className="flex-1" onClick={onBack}>Done</Button>
        </div>
      </div>
    );
  }

  // ── REVIEWING VIEW ──────────────────────────────
  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold font-display">Google Feed Health</h2>
          <p className="text-xs text-muted-foreground">{rows.length} products scanned</p>
        </div>
      </div>

      {/* Namespace selector */}
      <div className="flex gap-2 mb-3">
        <button onClick={() => setNamespace("custom")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${namespace === "custom" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}>
          custom.* (Simprosys)
        </button>
        <button onClick={() => setNamespace("mm-google-shopping")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${namespace === "mm-google-shopping" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}>
          mm-google-shopping.*
        </button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        <div className="bg-card border border-border rounded-lg p-2 text-center">
          <p className="text-sm font-bold">{counts.all}</p>
          <p className="text-[10px] text-muted-foreground">Total</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-2 text-center">
          <p className="text-sm font-bold text-secondary">{counts.review}</p>
          <p className="text-[10px] text-muted-foreground">Review</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-2 text-center">
          <p className="text-sm font-bold text-destructive">{counts.no_color}</p>
          <p className="text-[10px] text-muted-foreground">No color</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-2 text-center">
          <p className="text-sm font-bold text-success">{counts.pushed}</p>
          <p className="text-[10px] text-muted-foreground">Pushed</p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="mb-3">
        <TabsList className="w-full">
          <TabsTrigger value="all" className="flex-1 text-xs">All</TabsTrigger>
          <TabsTrigger value="review" className="flex-1 text-xs">Review</TabsTrigger>
          <TabsTrigger value="no_color" className="flex-1 text-xs">No color</TabsTrigger>
          <TabsTrigger value="pushed" className="flex-1 text-xs">Pushed</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Actions */}
      <div className="flex gap-2 mb-3">
        <Button variant="teal" size="sm" className="flex-1 gap-1"
          onClick={() => pushMetafields(selected.size > 0 ? Array.from(selected) : undefined)}>
          <ShoppingCart className="w-3.5 h-3.5" />
          {selected.size > 0 ? `Push ${selected.size} selected` : `Push all (${rows.length})`}
        </Button>
      </div>

      {/* Product table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  checked={selected.size === current.length && current.length > 0}
                  onCheckedChange={() => {
                    if (selected.size === current.length) setSelected(new Set());
                    else setSelected(new Set(current.map(r => r.product.id)));
                  }}
                />
              </TableHead>
              <TableHead className="text-xs">Product</TableHead>
              <TableHead className="text-xs hidden sm:table-cell">Gender</TableHead>
              <TableHead className="text-xs hidden sm:table-cell">Age</TableHead>
              <TableHead className="text-xs">Color</TableHead>
              <TableHead className="text-xs w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {current.slice(0, 100).map(r => (
              <TableRow key={r.product.id}>
                <TableCell>
                  <Checkbox checked={selected.has(r.product.id)} onCheckedChange={() => toggleSelect(r.product.id)} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {r.product.imageUrl && (
                      <img src={r.product.imageUrl} alt="" className="w-7 h-7 rounded object-cover shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate max-w-[180px]">{r.product.title}</p>
                      <p className="text-[10px] text-muted-foreground">{r.product.vendor}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <InlineEdit
                    value={r.detected.gender}
                    confidence={r.detected.genderConf}
                    options={["female", "male", "unisex"]}
                    onSave={v => updateDetected(r.product.id, "gender", v)}
                  />
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <InlineEdit
                    value={r.detected.ageGroup}
                    confidence={r.detected.ageConf}
                    options={["adult", "kids", "toddler", "infant", "newborn"]}
                    onSave={v => updateDetected(r.product.id, "ageGroup", v)}
                  />
                </TableCell>
                <TableCell>
                  {r.detected.color ? (
                    <InlineEdit
                      value={r.detected.color}
                      confidence={r.detected.colorConf}
                      onSave={v => updateDetected(r.product.id, "color", v)}
                    />
                  ) : (
                    <Badge variant="destructive" className="text-[10px]">Missing</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <button onClick={() => setDetailRow(r)} className="text-muted-foreground hover:text-foreground">
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {current.length > 100 && (
          <div className="p-2 text-center text-xs text-muted-foreground border-t border-border">
            Showing first 100 of {current.length} products
          </div>
        )}
      </div>

      {/* Detail modal */}
      <Dialog open={!!detailRow} onOpenChange={open => { if (!open) setDetailRow(null); }}>
        <DialogContent className="max-w-md">
          {detailRow && (
            <>
              <DialogHeader>
                <DialogTitle className="text-sm">{detailRow.product.title}</DialogTitle>
                <DialogDescription className="text-xs">{detailRow.product.vendor} · {detailRow.product.productType}</DialogDescription>
              </DialogHeader>
              {detailRow.product.imageUrl && (
                <img src={detailRow.product.imageUrl} alt="" className="w-full h-32 object-contain rounded-lg bg-muted" />
              )}
              <div className="space-y-3">
                <DetailField label="Gender" value={detailRow.detected.gender} confidence={detailRow.detected.genderConf} reason={detailRow.detected.genderReason}
                  options={["female", "male", "unisex"]}
                  onSave={v => updateDetected(detailRow.product.id, "gender", v)} />
                <DetailField label="Age Group" value={detailRow.detected.ageGroup} confidence={detailRow.detected.ageConf} reason={detailRow.detected.ageReason}
                  options={["adult", "kids", "toddler", "infant", "newborn"]}
                  onSave={v => updateDetected(detailRow.product.id, "ageGroup", v)} />
                <DetailField label="Color" value={detailRow.detected.color || "—"} confidence={detailRow.detected.colorConf} reason={`Detected via ${detailRow.detected.colorMethod}`}
                  onSave={v => updateDetected(detailRow.product.id, "color", v)} />
              </div>
              <div className="bg-muted/50 rounded-lg p-2 text-[10px] text-muted-foreground">
                <p>Tags: {detailRow.product.tags.join(", ") || "none"}</p>
                <p>ID: {detailRow.product.id}</p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Inline Edit Component ──────────────────────
function InlineEdit({ value, confidence, options, onSave }: {
  value: string;
  confidence: "high" | "medium" | "low";
  options?: string[];
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  const confColor = confidence === "high" ? "text-success" : confidence === "medium" ? "text-secondary" : "text-destructive";

  if (editing) {
    if (options) {
      return (
        <select
          autoFocus
          defaultValue={value}
          onChange={e => { onSave(e.target.value); setEditing(false); }}
          onBlur={() => setEditing(false)}
          className="h-6 text-xs bg-input border border-border rounded px-1"
        >
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    return (
      <input
        autoFocus
        defaultValue={value}
        onBlur={e => { if (e.target.value.trim()) onSave(e.target.value.trim()); setEditing(false); }}
        onKeyDown={e => { if (e.key === "Enter" && (e.target as HTMLInputElement).value.trim()) { onSave((e.target as HTMLInputElement).value.trim()); setEditing(false); } }}
        className="h-6 w-full text-xs bg-input border border-border rounded px-1"
      />
    );
  }

  return (
    <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-xs hover:underline group">
      <span className={confColor}>●</span>
      <span>{value}</span>
      <Pencil className="w-2.5 h-2.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
    </button>
  );
}

// ── Detail Field Component ──────────────────────
function DetailField({ label, value, confidence, reason, options, onSave }: {
  label: string;
  value: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  options?: string[];
  onSave: (v: string) => void;
}) {
  const confBadge = confidence === "high"
    ? <Badge variant="secondary" className="text-[10px] bg-success/20 text-success">High</Badge>
    : confidence === "medium"
    ? <Badge variant="secondary" className="text-[10px] bg-secondary/20 text-secondary">Medium</Badge>
    : <Badge variant="destructive" className="text-[10px]">Low</Badge>;

  return (
    <div className="bg-muted/30 rounded-lg p-2.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium">{label}</span>
        {confBadge}
      </div>
      <InlineEdit value={value} confidence={confidence} options={options} onSave={onSave} />
      <p className="text-[10px] text-muted-foreground mt-1">{reason}</p>
    </div>
  );
}
