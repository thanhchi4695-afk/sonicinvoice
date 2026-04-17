import { useState, useMemo, useRef } from "react";
import { Upload, ChevronLeft, Search, Trash2, Eye, X, Check, BookOpen, ChevronDown, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addAuditEntry } from "@/lib/audit-log";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  getCatalogs, addCatalog, deleteCatalog, searchCatalogs, getTotalCatalogProducts,
  type SupplierCatalog, type CatalogProduct,
} from "@/lib/catalog-memory";

interface CatalogMemoryPanelProps {
  onBack: () => void;
}

const DEMO_EXTRACT: CatalogProduct[] = [
  { title: "Wave Runner Bikini Top", sku: "WR-2026-BT", barcode: "9359876543210", colour: "Aqua", size: "8-14", type: "Bikini Tops", rrp: 89.95 },
  { title: "Wave Runner High Waist Pant", sku: "WR-2026-HW", barcode: "9359876543211", colour: "Aqua", size: "8-14", type: "Bikini Bottoms", rrp: 79.95 },
  { title: "Wave Runner One Piece", sku: "WR-2026-OP", barcode: "9359876543212", colour: "Sunset", size: "8-16", type: "One Piece", rrp: 169.95 },
  { title: "Coastal Wrap Dress", sku: "WR-2026-WD", barcode: "9359876543213", colour: "White", size: "S-L", type: "Coverups", rrp: 129.95 },
  { title: "Reef Rash Vest", sku: "WR-2026-RV", barcode: "9359876543214", colour: "Navy", size: "8-14", type: "Rashies", rrp: 99.95 },
];

const CatalogMemoryPanel = ({ onBack }: CatalogMemoryPanelProps) => {
  const [catalogs, setCatalogs] = useState(getCatalogs);
  const [supplierName, setSupplierName] = useState("");
  const [processing, setProcessing] = useState(false);
  const [processed, setProcessed] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewingCatalog, setViewingCatalog] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [viewSearch, setViewSearch] = useState("");

  const searchResults = useMemo(() => searchCatalogs(searchQuery), [searchQuery, catalogs]);
  const totalProducts = catalogs.reduce((s, c) => s + c.products.length, 0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = () => {
    if (!supplierName.trim()) return;
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !supplierName.trim()) return;
    setProcessing(true);
    setProcessed(false);

    try {
      // Convert file to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1] || "");
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const { data, error } = await supabase.functions.invoke("catalog-pdf-extract", {
        body: { file_base64: base64, file_mime: file.type, supplier: supplierName.trim() },
      });

      if (error) throw error;
      const extracted: CatalogProduct[] = (data?.products || []).map((p: any) => ({
        title: String(p.title || "").trim(),
        sku: String(p.sku || "").trim(),
        barcode: String(p.barcode || "").trim(),
        colour: String(p.colour || "").trim(),
        size: String(p.size || "").trim(),
        type: String(p.type || "").trim(),
        rrp: typeof p.rrp === "number" ? p.rrp : parseFloat(p.rrp) || 0,
        description: String(p.description || "").trim() || undefined,
        fabric: String(p.fabric || "").trim() || undefined,
        care: String(p.care || "").trim() || undefined,
      })).filter((p: CatalogProduct) => p.title);

      if (extracted.length === 0) {
        toast.error("No products extracted — try a clearer file or different format");
        setProcessing(false);
        return;
      }

      const newCatalog: SupplierCatalog = {
        supplier: supplierName.trim(),
        products: extracted,
        uploadedAt: new Date().toISOString(),
        fileName: file.name,
      };
      addCatalog(newCatalog);
      setCatalogs(getCatalogs());
      const withDesc = extracted.filter(p => p.description).length;
      setProcessedCount(extracted.length);
      setProcessed(true);
      addAuditEntry("Catalog", `${supplierName} catalog uploaded — ${extracted.length} products learned (${withDesc} with descriptions)`);
      toast.success(`${extracted.length} products learned${withDesc > 0 ? ` · ${withDesc} with descriptions` : ""}`);
    } catch (err: any) {
      toast.error("Catalog extraction failed: " + (err?.message || "Unknown error"));
    } finally {
      setProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = (supplier: string) => {
    deleteCatalog(supplier);
    setCatalogs(getCatalogs());
    setDeleteConfirm(null);
    setViewingCatalog(null);
    addAuditEntry("Catalog", `${supplier} catalog deleted`);
  };

  const viewedCatalog = catalogs.find(c => c.supplier === viewingCatalog);
  const filteredViewProducts = viewedCatalog
    ? viewSearch
      ? viewedCatalog.products.filter(p =>
          p.title.toLowerCase().includes(viewSearch.toLowerCase()) ||
          p.sku.toLowerCase().includes(viewSearch.toLowerCase())
        )
      : viewedCatalog.products
    : [];

  return (
    <div className="min-h-screen pb-24 animate-fade-in">
      <div className="sticky top-0 z-40 bg-background border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
          <h2 className="text-lg font-semibold font-display">📚 Catalog Memory</h2>
          <span className="ml-auto text-xs text-muted-foreground font-mono-data">{totalProducts} products learned</span>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-6">
        {/* SECTION A — Upload */}
        <div className="bg-card rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold mb-1">Upload supplier catalog</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Upload a brand's full product list (PDF, Excel, or CSV). The app learns every SKU, barcode, and product name so future invoices from that supplier match automatically.
          </p>

          {processed ? (
            <div className="bg-success/10 border border-success/20 rounded-lg p-4 text-center">
              <Check className="w-8 h-8 text-success mx-auto mb-2" />
              <p className="text-sm font-semibold text-success">
                ✅ {supplierName} catalog saved — {processedCount} products learned.
              </p>
              <p className="text-xs text-muted-foreground mt-1">Future {supplierName} invoice lines will match automatically.</p>
              <Button variant="outline" size="sm" className="mt-3 text-xs" onClick={() => { setProcessed(false); setSupplierName(""); }}>
                Upload another catalog
              </Button>
            </div>
          ) : processing ? (
            <div className="text-center py-8">
              <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm font-medium">Processing {supplierName} catalog…</p>
              <p className="text-xs text-muted-foreground mt-1">Extracting SKUs, barcodes, and product names</p>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={supplierName}
                onChange={e => setSupplierName(e.target.value)}
                placeholder="Supplier name (e.g. Jantzen)"
                className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm mb-3"
              />
              <button
                onClick={handleUpload}
                className="w-full h-36 rounded-lg border-2 border-dashed border-border bg-muted/30 flex flex-col items-center justify-center gap-2 active:bg-muted transition-colors mb-3"
              >
                <Upload className="w-6 h-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Drop or select catalog file</p>
                <p className="text-[10px] text-muted-foreground/60">PDF · Excel · CSV</p>
              </button>
              <Button
                className="w-full h-11"
                onClick={handleUpload}
                disabled={!supplierName.trim()}
              >
                <BookOpen className="w-4 h-4 mr-2" /> Process Catalog
              </Button>
            </>
          )}
        </div>

        {/* SECTION B — Catalog Library */}
        <div>
          <h3 className="text-sm font-semibold mb-3">Catalog library</h3>

          {/* Global search */}
          <div className="relative mb-3">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search catalog memory…"
              className="w-full h-10 rounded-md bg-input border border-border pl-9 pr-3 text-sm"
            />
          </div>

          {/* Search results */}
          {searchQuery.trim() && (
            <div className="bg-card rounded-lg border border-border mb-4">
              <div className="px-3 py-2 border-b border-border bg-muted/30">
                <p className="text-xs font-medium">{searchResults.length} result{searchResults.length !== 1 ? "s" : ""} across all catalogs</p>
              </div>
              {searchResults.length === 0 ? (
                <p className="text-xs text-muted-foreground p-3">No products found matching "{searchQuery}"</p>
              ) : (
                <div className="divide-y divide-border max-h-64 overflow-y-auto">
                  {searchResults.map((r, i) => (
                    <div key={i} className="px-3 py-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{r.title}</span>
                        <span className="text-[10px] text-muted-foreground">{r.supplier}</span>
                      </div>
                      <p className="text-muted-foreground font-mono-data text-[10px] mt-0.5">
                        SKU: {r.sku || "—"} · {r.barcode || "No barcode"} · ${r.rrp.toFixed(2)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Catalog table */}
          {catalogs.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="text-sm font-medium">No catalogs uploaded yet</p>
              <p className="text-xs mt-1">Upload your first supplier catalog above to start building catalog memory.</p>
            </div>
          ) : (
            <div className="bg-card rounded-lg border border-border overflow-hidden">
              <div className="px-3 py-2 border-b border-border bg-muted/30">
                <div className="grid grid-cols-[1fr_80px_90px_70px] gap-2 text-[10px] font-semibold text-muted-foreground uppercase">
                  <span>Supplier</span>
                  <span>Products</span>
                  <span>Uploaded</span>
                  <span>Actions</span>
                </div>
              </div>
              <div className="divide-y divide-border">
                {catalogs.map(cat => (
                  <div key={cat.supplier} className="grid grid-cols-[1fr_80px_90px_70px] gap-2 items-center px-3 py-2.5 text-xs">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{cat.supplier}</p>
                      <p className="text-[10px] text-muted-foreground font-mono-data">{cat.fileName}</p>
                    </div>
                    <span className="font-mono-data">{cat.products.length}</span>
                    <span className="text-muted-foreground font-mono-data text-[10px]">
                      {new Date(cat.uploadedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setViewingCatalog(cat.supplier)}
                        className="p-1.5 rounded hover:bg-muted transition-colors"
                        title="View"
                      >
                        <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(cat.supplier)}
                        className="p-1.5 rounded hover:bg-destructive/10 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-card rounded-xl border border-border shadow-lg max-w-sm w-full p-5 space-y-3">
            <h3 className="font-semibold text-sm">Delete {deleteConfirm} catalog?</h3>
            <p className="text-xs text-muted-foreground">
              This removes all {catalogs.find(c => c.supplier === deleteConfirm)?.products.length || 0} learned products for {deleteConfirm}. Future invoices will need web search to match these products.
            </p>
            <div className="flex gap-2">
              <Button variant="destructive" size="sm" className="flex-1" onClick={() => handleDelete(deleteConfirm)}>
                Delete catalog
              </Button>
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* View catalog modal */}
      {viewingCatalog && viewedCatalog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-card rounded-xl border border-border shadow-lg max-w-lg w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div>
                <h3 className="font-semibold text-sm">{viewedCatalog.supplier} catalog</h3>
                <p className="text-[10px] text-muted-foreground">{viewedCatalog.products.length} products</p>
              </div>
              <button onClick={() => { setViewingCatalog(null); setViewSearch(""); }} className="text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-4 py-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  value={viewSearch}
                  onChange={e => setViewSearch(e.target.value)}
                  placeholder="Search products…"
                  className="w-full h-8 rounded-md bg-input border border-border pl-8 pr-3 text-xs"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              <div className="space-y-1">
                {filteredViewProducts.map((p, i) => (
                  <div key={i} className="bg-muted/30 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">{p.title}</span>
                      <span className="text-[10px] text-muted-foreground font-mono-data">${p.rrp.toFixed(2)}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground font-mono-data mt-0.5">
                      SKU: {p.sku} · {p.barcode || "No barcode"} · {p.colour} · {p.size} · {p.type}
                    </p>
                  </div>
                ))}
                {filteredViewProducts.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">No products match "{viewSearch}"</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CatalogMemoryPanel;
