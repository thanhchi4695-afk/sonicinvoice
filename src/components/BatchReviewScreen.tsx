import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import {
  ChevronLeft, Download, Search, Filter, Check, AlertTriangle,
  CheckCircle2, Trash2, Tag, Layers, Copy as CopyIcon, ChevronDown,
  ArrowUpDown, Eye, FileCheck, Sparkles, RefreshCw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { getStoreConfig } from "@/lib/prompt-builder";
import { SmartNamingButton, runBulkSmartNaming } from "@/components/SmartNamingPanel";
import {
  validateForExport, generateShopifyCSV, inferCategory, generateHandles,
  type ScannedProductForExport,
} from "@/lib/shopify-csv-schema";

/* ─── types ─── */
export interface BatchProduct {
  id: string;
  title: string;
  type: string;
  vendor: string;
  description: string;
  tags: string;
  colour: string;
  sku: string;
  barcode: string;
  price: number;
  quantity: number;
  confidence: number;
  confidenceReason: string;
  matchSource: string;
  imageUrl: string | null;
}

interface Props {
  products: BatchProduct[];
  onBack: () => void;
  onSetProducts: (fn: (prev: BatchProduct[]) => BatchProduct[]) => void;
}

type SortKey = "title" | "price" | "quantity" | "confidence" | "status";
type FilterMode = "all" | "ready" | "fix" | "edited";

/* ─── helpers ─── */
const statusOf = (p: BatchProduct) => validateForExport(p);

function findDuplicates(products: BatchProduct[]): Map<number, number[]> {
  const dupes = new Map<number, number[]>();
  for (let i = 0; i < products.length; i++) {
    const group: number[] = [];
    for (let j = i + 1; j < products.length; j++) {
      if (
        (products[i].barcode && products[i].barcode === products[j].barcode) ||
        (products[i].sku && products[i].sku.toLowerCase() === products[j].sku.toLowerCase()) ||
        (products[i].title.toLowerCase() === products[j].title.toLowerCase())
      ) {
        group.push(j);
      }
    }
    if (group.length > 0) dupes.set(i, group);
  }
  return dupes;
}

/* ─── editable cell ─── */
const EditableCell = ({
  value, onChange, type = "text", mono = false, className = "",
}: {
  value: string | number;
  onChange: (v: string) => void;
  type?: "text" | "number";
  mono?: boolean;
  className?: string;
}) => {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(String(value));
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { setLocal(String(value)); }, [value]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  if (!editing) {
    return (
      <button
        className={`text-left w-full px-2 py-1.5 rounded hover:bg-muted/60 text-sm truncate transition-colors ${mono ? "font-mono" : ""} ${className}`}
        onClick={() => setEditing(true)}
        title="Click to edit"
      >
        {value || <span className="text-muted-foreground italic text-xs">—</span>}
      </button>
    );
  }

  return (
    <input
      ref={ref}
      type={type}
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => { onChange(local); setEditing(false); }}
      onKeyDown={e => {
        if (e.key === "Enter") { onChange(local); setEditing(false); }
        if (e.key === "Escape") { setLocal(String(value)); setEditing(false); }
        if (e.key === "Tab") { onChange(local); setEditing(false); }
      }}
      className={`w-full h-8 px-2 rounded bg-background border border-primary/40 text-sm text-foreground outline-none ${mono ? "font-mono" : ""}`}
    />
  );
};

/* ─── bulk action bar ─── */
const BulkBar = ({
  count, onSetVendor, onSetType, onAddTag, onDelete, onMarkReady, onSmartName,
}: {
  count: number;
  onSetVendor: () => void;
  onSetType: () => void;
  onAddTag: () => void;
  onDelete: () => void;
  onMarkReady: () => void;
  onSmartName: () => void;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-primary/10 border-b border-primary/20 shrink-0">
      <span className="text-xs font-semibold text-primary">{count} selected</span>
      <div className="flex-1" />
      <div className="relative">
        <Button size="sm" variant="outline" onClick={() => setOpen(!open)} className="h-7 text-xs gap-1">
          Bulk Actions <ChevronDown className="w-3 h-3" />
        </Button>
        {open && (
          <div className="absolute right-0 top-8 z-50 bg-card border border-border rounded-lg shadow-lg py-1 w-48">
            {[
              { label: "✨ Smart Name Selected", fn: onSmartName, highlight: true },
              { label: "Set Vendor", fn: onSetVendor },
              { label: "Set Product Type", fn: onSetType },
              { label: "Add Tags", fn: onAddTag },
              { label: "Mark as Ready", fn: onMarkReady },
              { label: "Delete Selected", fn: onDelete, destructive: true },
            ].map(a => (
              <button key={a.label} onClick={() => { a.fn(); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors ${(a as any).destructive ? "text-destructive" : (a as any).highlight ? "text-primary font-medium" : "text-foreground"}`}>
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/* ─── main component ─── */
const BatchReviewScreen = ({ products, onBack, onSetProducts }: Props) => {
  const config = getStoreConfig();
  const sym = config.currencySymbol || "$";

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [sortAsc, setSortAsc] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [bulkNaming, setBulkNaming] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  const duplicates = useMemo(() => findDuplicates(products), [products]);

  const filtered = useMemo(() => {
    let list = products.map((p, i) => ({ ...p, _idx: i, _valid: statusOf(p) }));

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        p.title.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.vendor.toLowerCase().includes(q) ||
        p.barcode.includes(q)
      );
    }

    if (filter === "ready") list = list.filter(p => p._valid.valid);
    if (filter === "fix") list = list.filter(p => !p._valid.valid);

    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "title": cmp = a.title.localeCompare(b.title); break;
        case "price": cmp = a.price - b.price; break;
        case "quantity": cmp = a.quantity - b.quantity; break;
        case "confidence": cmp = a.confidence - b.confidence; break;
        case "status": cmp = (a._valid.valid ? 1 : 0) - (b._valid.valid ? 1 : 0); break;
      }
      return sortAsc ? cmp : -cmp;
    });

    return list;
  }, [products, search, filter, sortKey, sortAsc]);

  const readyCount = products.filter(p => statusOf(p).valid).length;
  const fixCount = products.length - readyCount;
  const allReady = fixCount === 0 && products.length > 0;

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(p => p.id)));
  };

  const updateField = useCallback((idx: number, field: string, value: string | number) => {
    onSetProducts(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  }, [onSetProducts]);

  const promptBulk = (label: string, field: string) => {
    const val = prompt(`Enter ${label} for ${selected.size} items:`);
    if (val === null) return;
    onSetProducts(prev => prev.map(p => selected.has(p.id) ? { ...p, [field]: val } : p));
    toast.success(`Set ${label} for ${selected.size} items`);
    setSelected(new Set());
  };

  const bulkAddTag = () => {
    const tag = prompt("Enter tag to add:");
    if (!tag) return;
    onSetProducts(prev => prev.map(p => {
      if (!selected.has(p.id)) return p;
      const existing = p.tags ? p.tags.split(",").map(t => t.trim()) : [];
      if (existing.includes(tag.trim())) return p;
      return { ...p, tags: [...existing, tag.trim()].join(", ") };
    }));
    toast.success(`Added tag "${tag}" to ${selected.size} items`);
    setSelected(new Set());
  };

  const bulkDelete = () => {
    if (!confirm(`Delete ${selected.size} items?`)) return;
    onSetProducts(prev => prev.filter(p => !selected.has(p.id)));
    toast.success(`Deleted ${selected.size} items`);
    setSelected(new Set());
  };

  const handleExport = () => {
    if (!allReady) { toast.error(`Fix ${fixCount} items before exporting`); return; }
    const data: ScannedProductForExport[] = products.map(p => ({
      title: p.title, type: p.type, vendor: p.vendor, description: p.description,
      tags: p.tags, colour: p.colour, sku: p.sku, barcode: p.barcode,
      price: p.price, quantity: p.quantity,
    }));
    const csv = generateShopifyCSV(data);
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `scan-mode-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success(`Exported ${products.length} products`);
  };

  /* ─── CSV preview modal ─── */
  if (showPreview) {
    const handles = generateHandles(products.map(p => p.title));
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
          <button onClick={() => setShowPreview(false)}><ChevronLeft className="w-5 h-5 text-muted-foreground" /></button>
          <h2 className="font-semibold text-foreground text-sm">Shopify Import Preview</h2>
        </div>
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr>
                {["Handle", "Title", "Type", "Vendor", "SKU", "Barcode", "Price", "Qty"].map(h => (
                  <th key={h} className="text-left px-3 py-2 font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map((p, i) => (
                <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-muted-foreground">{handles[i]}</td>
                  <td className="px-3 py-2 font-medium text-foreground">{p.title}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.type}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.vendor || "—"}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{p.sku || "—"}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{p.barcode || "—"}</td>
                  <td className="px-3 py-2 text-foreground">{sym}{p.price.toFixed(2)}</td>
                  <td className="px-3 py-2 text-foreground">{p.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="shrink-0 px-4 py-3 border-t border-border bg-background safe-bottom">
          <Button className="w-full h-11" onClick={handleExport} disabled={!allReady}>
            <Download className="w-4 h-4 mr-2" /> Export CSV
          </Button>
        </div>
      </div>
    );
  }

  /* ─── main view ─── */
  const SortHeader = ({ label, k }: { label: string; k: SortKey }) => (
    <button onClick={() => toggleSort(k)}
      className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors">
      {label} <ArrowUpDown className="w-3 h-3" />
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
        <button onClick={onBack}><ChevronLeft className="w-5 h-5 text-muted-foreground" /></button>
        <div className="flex-1">
          <h2 className="font-semibold text-foreground text-sm">Batch Review</h2>
          <p className="text-xs text-muted-foreground">{products.length} products · {readyCount} ready · {fixCount} need fixing</p>
        </div>
        <Button size="sm" variant="ghost" onClick={async () => {
          setBulkNaming(true);
          setBulkProgress({ done: 0, total: products.length });
          try {
            const results = await runBulkSmartNaming(products, (done, total) => setBulkProgress({ done, total }));
            onSetProducts(prev => prev.map(p => {
              const r = results.get(p.id);
              if (!r) return p;
              return { ...p, title: r.recommended_title, type: r.product_type, description: r.short_description, tags: r.tags.join(", "), confidence: r.confidence_score, confidenceReason: r.confidence_reason };
            }));
            toast.success(`Smart named ${results.size} products`);
          } catch { toast.error("Bulk naming failed"); }
          finally { setBulkNaming(false); }
        }} disabled={bulkNaming} className="h-7 text-xs gap-1 text-primary">
          {bulkNaming ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> {bulkProgress.done}/{bulkProgress.total}</> : <><Sparkles className="w-3.5 h-3.5" /> Smart Name All</>}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowPreview(true)} className="h-7 text-xs gap-1">
          <Eye className="w-3.5 h-3.5" /> Preview
        </Button>
      </div>

      {/* Search + Filters */}
      <div className="px-4 py-2 border-b border-border space-y-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search title, SKU, vendor, barcode…"
            className="w-full h-9 rounded-lg bg-muted border border-border pl-9 pr-3 text-sm text-foreground" />
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          {([
            { k: "all" as FilterMode, label: `All (${products.length})` },
            { k: "ready" as FilterMode, label: `Ready (${readyCount})` },
            { k: "fix" as FilterMode, label: `Fix (${fixCount})` },
          ]).map(f => (
            <button key={f.k} onClick={() => setFilter(f.k)}
              className={`px-3 py-1 rounded-full text-[10px] font-medium whitespace-nowrap transition-colors ${filter === f.k ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Duplicate warnings */}
      {duplicates.size > 0 && (
        <div className="px-4 py-2 bg-warning/10 border-b border-warning/20 shrink-0">
          <p className="text-[10px] font-medium text-warning flex items-center gap-1">
            <CopyIcon className="w-3 h-3" /> {duplicates.size} possible duplicate group{duplicates.size > 1 ? "s" : ""} detected
          </p>
        </div>
      )}

      {/* Bulk bar */}
      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          onSetVendor={() => promptBulk("Vendor", "vendor")}
          onSetType={() => promptBulk("Product Type", "type")}
          onAddTag={bulkAddTag}
          onDelete={bulkDelete}
          onMarkReady={() => { setSelected(new Set()); }}
          onSmartName={async () => {
            const items = products.filter(p => selected.has(p.id));
            if (!items.length) return;
            setBulkNaming(true);
            setBulkProgress({ done: 0, total: items.length });
            try {
              const results = await runBulkSmartNaming(items, (done, total) => setBulkProgress({ done, total }));
              onSetProducts(prev => prev.map(p => {
                const r = results.get(p.id);
                if (!r) return p;
                return { ...p, title: r.recommended_title, type: r.product_type, description: r.short_description, tags: r.tags.join(", "), confidence: r.confidence_score, confidenceReason: r.confidence_reason };
              }));
              toast.success(`Smart named ${results.size} products`);
            } catch (e: any) {
              toast.error(e.message || "Bulk naming failed");
            } finally {
              setBulkNaming(false);
              setSelected(new Set());
            }
          }}
        />
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {/* Desktop table header */}
        <div className="hidden md:grid grid-cols-[40px_1fr_100px_100px_100px_100px_80px_60px_70px] gap-0 px-4 py-2 bg-muted/50 border-b border-border sticky top-0 z-10">
          <div className="flex items-center">
            <Checkbox checked={selected.size === filtered.length && filtered.length > 0}
              onCheckedChange={toggleAll} />
          </div>
          <SortHeader label="Title" k="title" />
          <span className="text-[10px] font-semibold text-muted-foreground uppercase">Type</span>
          <span className="text-[10px] font-semibold text-muted-foreground uppercase">Vendor</span>
          <span className="text-[10px] font-semibold text-muted-foreground uppercase">SKU</span>
          <span className="text-[10px] font-semibold text-muted-foreground uppercase">Barcode</span>
          <SortHeader label="Price" k="price" />
          <SortHeader label="Qty" k="quantity" />
          <SortHeader label="Status" k="status" />
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            {search ? "No matching products" : "No products to review"}
          </div>
        )}

        {/* Desktop table rows */}
        {filtered.map(p => {
          const isDupe = Array.from(duplicates.values()).some(g => g.includes(p._idx)) ||
                         duplicates.has(p._idx);
          return (
            <div key={p.id}>
              {/* Desktop row */}
              <div className={`hidden md:grid grid-cols-[40px_1fr_100px_100px_100px_100px_80px_60px_70px] gap-0 px-4 border-b border-border/50 items-center ${!p._valid.valid ? "bg-destructive/5" : "hover:bg-muted/30"} ${isDupe ? "ring-1 ring-inset ring-warning/30" : ""}`}>
                <div className="flex items-center py-1">
                  <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggleSelect(p.id)} />
                </div>
                <EditableCell value={p.title} onChange={v => updateField(p._idx, "title", v)} className="font-medium" />
                <EditableCell value={p.type} onChange={v => updateField(p._idx, "type", v)} />
                <EditableCell value={p.vendor} onChange={v => updateField(p._idx, "vendor", v)} />
                <EditableCell value={p.sku} onChange={v => updateField(p._idx, "sku", v)} mono />
                <EditableCell value={p.barcode} onChange={v => updateField(p._idx, "barcode", v)} mono />
                <EditableCell value={p.price} onChange={v => updateField(p._idx, "price", parseFloat(v) || 0)} type="number" />
                <EditableCell value={p.quantity} onChange={v => updateField(p._idx, "quantity", parseInt(v) || 0)} type="number" />
                <div className="px-2 py-1">
                  {p._valid.valid ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-success/15 text-success">
                      <CheckCircle2 className="w-2.5 h-2.5" /> Ready
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-destructive/15 text-destructive" title={p._valid.issues.join(", ")}>
                      <AlertTriangle className="w-2.5 h-2.5" /> Fix
                    </span>
                  )}
                </div>
              </div>

              {/* Mobile card */}
              <div className={`md:hidden border-b border-border/50 p-3 ${!p._valid.valid ? "bg-destructive/5" : ""}`}>
                <div className="flex items-start gap-2">
                  <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggleSelect(p.id)} className="mt-1" />
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <EditableCell value={p.title} onChange={v => updateField(p._idx, "title", v)} className="font-semibold !text-sm" />
                      {p._valid.valid ? (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-success/15 text-success shrink-0">
                          <CheckCircle2 className="w-2.5 h-2.5" /> Ready
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-destructive/15 text-destructive shrink-0">
                          <AlertTriangle className="w-2.5 h-2.5" /> Fix
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                      <div>
                        <span className="text-[9px] text-muted-foreground">Type</span>
                        <EditableCell value={p.type} onChange={v => updateField(p._idx, "type", v)} />
                      </div>
                      <div>
                        <span className="text-[9px] text-muted-foreground">Vendor</span>
                        <EditableCell value={p.vendor} onChange={v => updateField(p._idx, "vendor", v)} />
                      </div>
                      <div>
                        <span className="text-[9px] text-muted-foreground">Price</span>
                        <EditableCell value={p.price} onChange={v => updateField(p._idx, "price", parseFloat(v) || 0)} type="number" />
                      </div>
                      <div>
                        <span className="text-[9px] text-muted-foreground">Qty</span>
                        <EditableCell value={p.quantity} onChange={v => updateField(p._idx, "quantity", parseInt(v) || 0)} type="number" />
                      </div>
                    </div>
                    {!p._valid.valid && (
                      <div className="space-y-0.5">
                        {p._valid.issues.map((issue, j) => (
                          <p key={j} className="text-[9px] text-destructive">⚠ {issue}</p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom bar */}
      <div className="shrink-0 px-4 py-3 border-t border-border bg-background space-y-2 safe-bottom">
        <Button className="w-full h-12 text-base font-semibold" onClick={handleExport} disabled={!allReady}>
          <Download className="w-5 h-5 mr-2" />
          Export Shopify CSV ({readyCount} product{readyCount !== 1 ? "s" : ""})
        </Button>
        {!allReady && products.length > 0 && (
          <p className="text-center text-[10px] text-destructive">
            Fix {fixCount} item{fixCount > 1 ? "s" : ""} before exporting
          </p>
        )}
      </div>
    </div>
  );
};

export default BatchReviewScreen;
