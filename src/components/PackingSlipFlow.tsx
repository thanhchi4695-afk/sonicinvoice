import { useState, useRef } from "react";
import { toast } from "sonner";
import {
  Upload, ChevronLeft, Loader2, Check, X, AlertTriangle,
  Download, Package, Search, Edit3, CheckCheck, FileText,
  ChevronDown, ChevronRight, Zap, RotateCcw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useStoreMode } from "@/hooks/use-store-mode";
import Papa from "papaparse";

interface PackingSlipFlowProps {
  onBack: () => void;
}

interface PackingSlipItem {
  style_code: string;
  colour_code: string;
  style_description: string;
  size: string;
  quantity: number;
  carton_number?: string;
  barcode?: string;
  // Computed fields
  _title: string;
  _confidence: number;
  _confidenceLevel: "high" | "medium" | "low";
  _rejected: boolean;
  _rejectReason?: string;
  _rowIndex: number;
  _manuallyEdited?: boolean;
}

interface GroupedProduct {
  handle: string;
  title: string;
  vendor: string;
  style_code: string;
  colour_code: string;
  variants: { size: string; qty: number; sku: string }[];
}

type Step = "upload" | "processing" | "review";
type ReviewTab = "accepted" | "review" | "rejected";
type ProcessMode = "create" | "update" | "review_only";

function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/(?:^|\s|[-/])\w/g, (m) => m.toUpperCase());
}

function generateHandle(title: string, code: string): string {
  return (title || code)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function scoreItem(item: PackingSlipItem): PackingSlipItem {
  let conf = 0;
  if (item.style_code?.trim()) conf += 25;
  if (item.style_description?.trim()?.length >= 3) conf += 30;
  if (item.size?.trim()) conf += 15;
  if (item.quantity > 0) conf += 15;
  if (item.colour_code?.trim()) conf += 10;
  if (item.barcode?.trim()) conf += 5;

  const level = conf >= 80 ? "high" : conf >= 50 ? "medium" : "low";
  return { ...item, _confidence: conf, _confidenceLevel: level };
}

function groupItems(items: PackingSlipItem[], vendor: string): GroupedProduct[] {
  const groups = new Map<string, GroupedProduct>();

  for (const item of items) {
    if (item._rejected) continue;
    const key = `${item.style_code}||${item.style_description}||${item.colour_code}`;
    if (!groups.has(key)) {
      const title = item._title || toTitleCase(item.style_description || item.style_code);
      groups.set(key, {
        handle: generateHandle(title, item.style_code),
        title,
        vendor,
        style_code: item.style_code,
        colour_code: item.colour_code,
        variants: [],
      });
    }
    const g = groups.get(key)!;
    const sku = item.style_code
      ? `${item.style_code}-${(item.colour_code || "").replace(/[^a-zA-Z0-9]/g, "")}-${item.size}`
      : "";
    g.variants.push({ size: item.size, qty: item.quantity, sku });
  }

  return Array.from(groups.values());
}

function exportToShopifyCSV(groups: GroupedProduct[]) {
  const rows: Record<string, string>[] = [];
  for (const g of groups) {
    g.variants.forEach((v, i) => {
      rows.push({
        Handle: g.handle,
        Title: i === 0 ? g.title : "",
        Vendor: i === 0 ? g.vendor : "",
        "Option1 Name": i === 0 ? "Color" : "",
        "Option1 Value": g.colour_code || "",
        "Option2 Name": i === 0 ? "Size" : "",
        "Option2 Value": v.size,
        "Variant SKU": v.sku,
        "Variant Inventory Qty": String(v.qty),
        "Variant Price": "",
        "Cost per item": "",
        Status: "draft",
        Published: "FALSE",
      });
    });
  }
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `packing-slip-products-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportInventoryCSV(groups: GroupedProduct[]) {
  const rows: Record<string, string>[] = [];
  for (const g of groups) {
    for (const v of g.variants) {
      rows.push({
        Handle: g.handle,
        Title: g.title,
        "Variant SKU": v.sku,
        Size: v.size,
        Color: g.colour_code,
        "Inventory Qty": String(v.qty),
      });
    }
  }
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `packing-slip-inventory-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PackingSlipFlow({ onBack }: PackingSlipFlowProps) {
  const [step, setStep] = useState<Step>("upload");
  const [items, setItems] = useState<PackingSlipItem[]>([]);
  const [supplier, setSupplier] = useState("");
  const [supplierInput, setSupplierInput] = useState("");
  const [activeTab, setActiveTab] = useState<ReviewTab>("accepted");
  const [searchQuery, setSearchQuery] = useState("");
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [processMode, setProcessMode] = useState<ProcessMode>("create");
  const [docConfidence, setDocConfidence] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mode = useStoreMode();

  // Upload & parse
  const handleFileUpload = async (file: File) => {
    setStep("processing");
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      let fileContent: string;

      if (["pdf", "jpg", "jpeg", "png", "webp", "heic"].includes(ext)) {
        const buf = await file.arrayBuffer();
        fileContent = btoa(
          new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), "")
        );
      } else {
        fileContent = await file.text();
      }

      const { data, error } = await supabase.functions.invoke("parse-invoice", {
        body: {
          fileContent,
          fileName: file.name,
          fileType: ext,
          supplierName: supplierInput || undefined,
          forceMode: "packing_slip",
        },
      });

      if (error) throw error;

      if (data.document_type === "invoice" || data.document_type === "tax_invoice" || data.document_type === "handwritten_invoice") {
        toast.info(
          data.document_type === "handwritten_invoice"
            ? "This looks like a handwritten tax invoice (it has prices). Please switch to Invoice mode to capture cost prices."
            : "This looks like an invoice, not a packing slip. Use Invoice mode instead.",
          { duration: 6000 }
        );
        setStep("upload");
        return;
      }

      const rawProducts = (data.products || []) as Record<string, unknown>[];
      if (rawProducts.length === 0) {
        toast.error(
          "Couldn't read any products from this packing slip. Tips: ensure good lighting, the page is flat, and handwriting is legible. Try cropping to just the line-items table.",
          { duration: 8000 }
        );
        setStep("upload");
        return;
      }

      setSupplier(data.supplier || supplierInput || "");
      setDocConfidence(data.confidence || 0);

      const parsed: PackingSlipItem[] = rawProducts.map((p, i) => {
        const desc = String(p.style_description || p.product_name || p.title || "");
        const item: PackingSlipItem = {
          style_code: String(p.style_code || p.sku || ""),
          colour_code: String(p.colour_code || p.colour || p.color || ""),
          style_description: desc,
          size: String(p.size || ""),
          quantity: Number(p.quantity) || 0,
          carton_number: p.carton_number ? String(p.carton_number) : undefined,
          barcode: p.barcode ? String(p.barcode) : undefined,
          _title: toTitleCase(desc),
          _confidence: 0,
          _confidenceLevel: "low",
          _rejected: false,
          _rowIndex: i,
        };
        return scoreItem(item);
      });

      // Filter out completely empty rows the AI may have hallucinated
      const nonEmpty = parsed.filter(p => p.style_description.trim() || p.style_code.trim());
      if (nonEmpty.length === 0) {
        toast.error("Extracted rows were empty. Please retake the photo with better lighting and focus, or use Invoice mode if the document has prices.", { duration: 8000 });
        setStep("upload");
        return;
      }

      setItems(nonEmpty);
      setStep("review");
      toast.success(`Extracted ${nonEmpty.length} items from packing slip`);
    } catch (err) {
      console.error("Packing slip parse error:", err);
      toast.error("Failed to parse packing slip. Please try again.");
      setStep("upload");
    }
  };

  // Categorize
  const accepted = items.filter((p) => !p._rejected && p._confidenceLevel === "high");
  const needsReview = items.filter((p) => !p._rejected && p._confidenceLevel !== "high");
  const rejected = items.filter((p) => p._rejected);
  const grouped = groupItems(items, supplier);

  const currentList = (() => {
    let list = activeTab === "accepted" ? accepted : activeTab === "review" ? needsReview : rejected;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (p) =>
          p.style_description?.toLowerCase().includes(q) ||
          p.style_code?.toLowerCase().includes(q) ||
          p.colour_code?.toLowerCase().includes(q)
      );
    }
    return list;
  })();

  const approveRow = (idx: number) => {
    setItems((prev) =>
      prev.map((p) =>
        p._rowIndex === idx
          ? { ...p, _rejected: false, _confidenceLevel: "high" as const, _confidence: Math.max(p._confidence, 80) }
          : p
      )
    );
  };

  const rejectRow = (idx: number) => {
    setItems((prev) =>
      prev.map((p) =>
        p._rowIndex === idx
          ? { ...p, _rejected: true, _rejectReason: "Manually rejected", _confidenceLevel: "low" as const, _confidence: 0 }
          : p
      )
    );
  };

  const restoreRow = (idx: number) => {
    setItems((prev) =>
      prev.map((p) =>
        p._rowIndex === idx
          ? scoreItem({ ...p, _rejected: false, _rejectReason: undefined })
          : p
      )
    );
  };

  const updateField = (idx: number, field: string, value: string | number) => {
    setItems((prev) =>
      prev.map((p) => {
        if (p._rowIndex !== idx) return p;
        const updated = { ...p, [field]: value, _manuallyEdited: true };
        if (field === "style_description") {
          updated._title = toTitleCase(String(value));
        }
        return scoreItem(updated);
      })
    );
  };

  const acceptAllHigh = () => {
    setItems((prev) =>
      prev.map((p) =>
        !p._rejected && p._confidence >= 70
          ? { ...p, _confidenceLevel: "high" as const, _confidence: Math.max(p._confidence, 80) }
          : p
      )
    );
  };

  // ─── UPLOAD STEP ───
  if (step === "upload") {
    return (
      <div className="px-4 pt-2 pb-24 animate-fade-in">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground mb-4 active:text-foreground">
          <ChevronLeft className="w-4 h-4" /> Back
        </button>

        <div className="flex items-center gap-2 mb-1">
          <Package className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-bold font-display">Packing Slip Mode</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          Upload a packing slip or delivery docket to extract products without pricing.
        </p>

        <div className="bg-card rounded-lg border border-border p-4 mb-4">
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Supplier name (optional)</label>
          <Input
            value={supplierInput}
            onChange={(e) => setSupplierInput(e.target.value)}
            placeholder="e.g. Sunseeker, Jantzen"
            className="h-9 text-sm"
          />
        </div>

        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-border rounded-xl p-10 text-center cursor-pointer hover:border-primary/40 transition-colors bg-card"
        >
          <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium">Upload packing slip</p>
          <p className="text-xs text-muted-foreground mt-1">PDF · Image · Excel · CSV</p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileUpload(file);
          }}
        />

        <div className="mt-6 bg-muted/30 rounded-lg p-4">
          <h3 className="text-xs font-semibold mb-2">What gets extracted:</h3>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>✓ Style code & colour code</li>
            <li>✓ Style description → product title</li>
            <li>✓ Size & quantity per variant</li>
            <li>✓ Auto-grouped into Shopify products</li>
            <li className="text-primary">✕ No pricing expected — it's a packing slip</li>
          </ul>
        </div>
      </div>
    );
  }

  // ─── PROCESSING STEP ───
  if (step === "processing") {
    return (
      <div className="px-4 pt-2 pb-24 animate-fade-in flex flex-col items-center justify-center min-h-[50vh]">
        <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
        <p className="text-sm font-medium">Extracting products from packing slip...</p>
        <p className="text-xs text-muted-foreground mt-1">This usually takes 5-10 seconds</p>
      </div>
    );
  }

  // ─── REVIEW STEP ───
  const tabs: { key: ReviewTab; label: string; count: number; icon: React.ReactNode; colorClass: string }[] = [
    { key: "accepted", label: "Accepted", count: accepted.length, icon: <Check className="w-3.5 h-3.5" />, colorClass: "text-success" },
    { key: "review", label: "Needs Review", count: needsReview.length, icon: <AlertTriangle className="w-3.5 h-3.5" />, colorClass: "text-secondary" },
    { key: "rejected", label: "Rejected", count: rejected.length, icon: <X className="w-3.5 h-3.5" />, colorClass: "text-destructive" },
  ];

  return (
    <div className="px-4 pt-2 pb-24 animate-fade-in">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground mb-3 active:text-foreground">
        <ChevronLeft className="w-4 h-4" /> Back
      </button>

      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <Package className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold font-display">Packing Slip Review</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        {supplier && <span className="font-medium">{supplier}</span>}
        {supplier && " · "}
        {items.length} items · {grouped.length} grouped products
        {docConfidence > 0 && ` · ${docConfidence}% doc confidence`}
      </p>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        <div className="bg-success/10 border border-success/20 rounded-lg p-2 text-center">
          <p className="text-lg font-bold text-success">{accepted.length}</p>
          <p className="text-[10px] text-muted-foreground">Accepted</p>
        </div>
        <div className="bg-secondary/10 border border-secondary/20 rounded-lg p-2 text-center">
          <p className="text-lg font-bold text-secondary">{needsReview.length}</p>
          <p className="text-[10px] text-muted-foreground">Review</p>
        </div>
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-2 text-center">
          <p className="text-lg font-bold text-destructive">{rejected.length}</p>
          <p className="text-[10px] text-muted-foreground">Rejected</p>
        </div>
        <div className="bg-primary/10 border border-primary/20 rounded-lg p-2 text-center">
          <p className="text-lg font-bold text-primary">{grouped.length}</p>
          <p className="text-[10px] text-muted-foreground">Products</p>
        </div>
      </div>

      {/* Mode selector */}
      <div className="flex gap-1.5 mb-3">
        {(["create", "update", "review_only"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setProcessMode(m)}
            className={`flex-1 py-2 rounded-md text-xs font-medium transition-colors ${
              processMode === m ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {m === "create" ? "Create Products" : m === "update" ? "Update Inventory" : "Review Only"}
          </button>
        ))}
      </div>

      {/* Vendor input */}
      <div className="mb-3">
        <Input
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
          placeholder="Vendor / Supplier name"
          className="h-8 text-xs"
        />
      </div>

      {/* Tab bar */}
      <div className="flex bg-muted/30 rounded-lg p-1 mb-3">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === t.key ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <span className={t.colorClass}>{t.icon}</span>
            {t.label}
            <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
              activeTab === t.key ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
            }`}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search items..." className="h-8 pl-8 text-xs" />
      </div>

      {/* Bulk actions */}
      {activeTab === "review" && needsReview.length > 0 && (
        <div className="mb-3">
          <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={acceptAllHigh}>
            <CheckCheck className="w-3 h-3" /> Accept all ≥70%
          </Button>
        </div>
      )}

      {/* Items list */}
      <div className="border border-border rounded-lg bg-card overflow-hidden max-h-[400px] overflow-y-auto">
        {currentList.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {activeTab === "accepted" && "No accepted items yet"}
            {activeTab === "review" && "✓ All items reviewed"}
            {activeTab === "rejected" && "No rejected items"}
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {currentList.map((item) => (
              <div key={item._rowIndex} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    {editingRow === item._rowIndex ? (
                      <div className="space-y-1.5">
                        <Input
                          value={item.style_description}
                          onChange={(e) => updateField(item._rowIndex, "style_description", e.target.value)}
                          className="h-7 text-xs"
                          placeholder="Style description"
                        />
                        <div className="flex gap-1.5">
                          <Input
                            value={item.style_code}
                            onChange={(e) => updateField(item._rowIndex, "style_code", e.target.value)}
                            className="h-7 text-xs flex-1"
                            placeholder="Style code"
                          />
                          <Input
                            value={item.colour_code}
                            onChange={(e) => updateField(item._rowIndex, "colour_code", e.target.value)}
                            className="h-7 text-xs flex-1"
                            placeholder="Colour"
                          />
                        </div>
                        <div className="flex gap-1.5">
                          <Input
                            value={item.size}
                            onChange={(e) => updateField(item._rowIndex, "size", e.target.value)}
                            className="h-7 text-xs flex-1"
                            placeholder="Size"
                          />
                          <Input
                            value={String(item.quantity)}
                            onChange={(e) => updateField(item._rowIndex, "quantity", parseInt(e.target.value) || 0)}
                            className="h-7 text-xs w-20"
                            placeholder="Qty"
                            type="number"
                          />
                        </div>
                        <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => setEditingRow(null)}>
                          Done
                        </Button>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm font-medium truncate">{item._title || item.style_description}</p>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {item.style_code && (
                            <Badge variant="outline" className="text-[10px] h-5">{item.style_code}</Badge>
                          )}
                          {item.colour_code && (
                            <Badge variant="secondary" className="text-[10px] h-5">{item.colour_code}</Badge>
                          )}
                          {item.size && (
                            <Badge variant="outline" className="text-[10px] h-5">Size {item.size}</Badge>
                          )}
                          <Badge variant="outline" className="text-[10px] h-5">Qty {item.quantity}</Badge>
                        </div>
                        {item._rejectReason && (
                          <p className="text-[10px] text-destructive mt-1">{item._rejectReason}</p>
                        )}
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      item._confidenceLevel === "high" ? "bg-success/15 text-success" :
                      item._confidenceLevel === "medium" ? "bg-secondary/15 text-secondary" :
                      "bg-destructive/15 text-destructive"
                    }`}>
                      {item._confidence}%
                    </span>
                    {editingRow !== item._rowIndex && (
                      <button onClick={() => setEditingRow(item._rowIndex)} className="p-1 rounded hover:bg-muted">
                        <Edit3 className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                    )}
                    {activeTab !== "accepted" && !item._rejected && (
                      <button onClick={() => approveRow(item._rowIndex)} className="p-1 rounded hover:bg-success/10">
                        <Check className="w-3.5 h-3.5 text-success" />
                      </button>
                    )}
                    {!item._rejected && (
                      <button onClick={() => rejectRow(item._rowIndex)} className="p-1 rounded hover:bg-destructive/10">
                        <X className="w-3.5 h-3.5 text-destructive" />
                      </button>
                    )}
                    {item._rejected && (
                      <button onClick={() => restoreRow(item._rowIndex)} className="p-1 rounded hover:bg-muted">
                        <RotateCcw className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Grouped products preview */}
      {grouped.length > 0 && (
        <div className="mt-4 border border-border rounded-lg bg-card overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/30 flex items-center gap-2">
            <Package className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-semibold">Grouped Products ({grouped.length})</span>
          </div>
          <div className="max-h-48 overflow-y-auto divide-y divide-border/50">
            {grouped.map((g, i) => (
              <div key={i} className="px-4 py-2">
                <p className="text-sm font-medium">{g.title}</p>
                <p className="text-[10px] text-muted-foreground">
                  {g.colour_code && `${g.colour_code} · `}
                  {g.variants.length} variant{g.variants.length !== 1 ? "s" : ""} ·{" "}
                  {g.variants.reduce((s, v) => s + v.qty, 0)} total units
                </p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {g.variants.map((v, j) => (
                    <span key={j} className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {v.size} ×{v.qty}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Export actions */}
      <div className="mt-4 space-y-2">
        {processMode === "create" && (
          <Button variant="teal" className="w-full h-11 text-sm gap-2" onClick={() => { exportToShopifyCSV(grouped); toast.success("Shopify draft CSV downloaded"); }}>
            <Download className="w-4 h-4" /> Export Shopify Draft CSV
          </Button>
        )}
        {processMode === "update" && (
          <Button variant="teal" className="w-full h-11 text-sm gap-2" onClick={() => { exportInventoryCSV(grouped); toast.success("Inventory update CSV downloaded"); }}>
            <Download className="w-4 h-4" /> Export Inventory Update CSV
          </Button>
        )}
        {processMode === "review_only" && (
          <div className="text-center text-xs text-muted-foreground py-3">
            Review mode — no export. Switch to Create or Update to download.
          </div>
        )}
        <Button variant="outline" className="w-full h-9 text-xs" onClick={() => { setStep("upload"); setItems([]); }}>
          <Upload className="w-3.5 h-3.5 mr-1" /> Upload another packing slip
        </Button>
      </div>
    </div>
  );
}
