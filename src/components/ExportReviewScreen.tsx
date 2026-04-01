import { useState } from "react";
import { Download, Check, AlertTriangle, FileSpreadsheet, FileText, Tag, Package, DollarSign, ChevronLeft, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useStoreMode } from "@/hooks/use-store-mode";
import Papa from "papaparse";
import { getEnabledMetafields } from "@/lib/metafields";
import { generateGoogleFeedXML, generateGoogleFeedTSV } from "@/lib/google-feed";

export interface ExportProduct {
  name: string;
  brand: string;
  type: string;
  colour?: string;
  size?: string;
  sku?: string;
  barcode?: string;
  price: number;
  rrp: number;
  status: string;
  hasImage?: boolean;
  hasSeo?: boolean;
  hasTags?: boolean;
  confidence?: "high" | "medium" | "low";
  isNew?: boolean;
  metafields?: Record<string, string>;
}

interface ExportReviewScreenProps {
  products: ExportProduct[];
  supplierName: string;
  onBack: () => void;
}

type ExportFormat = "shopify_full" | "shopify_inventory" | "shopify_price" | "tags_only" | "xlsx" | "summary_pdf" | "google_xml" | "google_tsv";

const FORMAT_CARDS: { id: ExportFormat; icon: React.ReactNode; label: string; desc: string; best: string }[] = [
  { id: "shopify_full", icon: <FileText className="w-5 h-5 text-primary" />, label: "Shopify CSV (Full)", desc: "Complete CSV with all fields for Shopify bulk import. Includes: title, description, type, vendor, tags, SEO, price, compare-at price, cost, images.", best: "New products, full product setup" },
  { id: "shopify_inventory", icon: <Package className="w-5 h-5 text-primary" />, label: "Shopify CSV (Inventory only)", desc: "Lightweight CSV with SKU, barcode, and quantity only. For updating stock on existing Shopify products.", best: "Restocking existing products" },
  { id: "shopify_price", icon: <DollarSign className="w-5 h-5 text-primary" />, label: "Shopify CSV (Price update)", desc: "CSV with price and compare-at price columns only. For updating RRP after a supplier price change.", best: "Seasonal price updates" },
  { id: "tags_only", icon: <Tag className="w-5 h-5 text-primary" />, label: "Tags only CSV", desc: "CSV with title and tags only. For updating tags on products already in Shopify.", best: "Tag cleanup on existing catalog" },
  { id: "xlsx", icon: <FileSpreadsheet className="w-5 h-5 text-primary" />, label: "Excel (.xlsx)", desc: "Same data as Shopify CSV but in Excel format. Useful for manual review or sharing with your accountant.", best: "Finance review, manual checking" },
  { id: "summary_pdf", icon: <FileText className="w-5 h-5 text-secondary" />, label: "Summary PDF", desc: "A printable summary of the invoice — supplier, date, products, quantities, costs, and totals.", best: "Filing, accounting, manager review" },
  { id: "google_xml", icon: <ShoppingCart className="w-5 h-5 text-primary" />, label: "Google Shopping feed (XML)", desc: "Google Merchant Center-ready XML product feed with categories, gender, age group, and custom labels.", best: "Google Shopping ads, Merchant Center" },
  { id: "google_tsv", icon: <ShoppingCart className="w-5 h-5 text-primary" />, label: "Google Shopping feed (TSV)", desc: "Tab-separated feed for Google Merchant Center. Same data as XML but in spreadsheet-friendly format.", best: "Google Merchant Center bulk upload" },
];

function generateFilename(supplier: string, format: ExportFormat): string {
  const d = new Date();
  const month = d.toLocaleString("en", { month: "short", year: "2-digit" }).replace(" ", "");
  const date = d.toISOString().slice(0, 10).replace(/-/g, "");
  const tag = (supplier || "products").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 20);
  const typeMap: Record<ExportFormat, string> = {
    shopify_full: "full",
    shopify_inventory: "inventory",
    shopify_price: "price",
    tags_only: "tags",
    xlsx: "review",
    summary_pdf: "summary",
    google_xml: "google_feed",
    google_tsv: "google_feed",
  };
  const ext = format === "xlsx" ? "xlsx" : format === "summary_pdf" ? "pdf" : format === "google_xml" ? "xml" : format === "google_tsv" ? "tsv" : "csv";
  return `${tag}_${month}_${typeMap[format]}_${date}.${ext}`;
}

const ExportReviewScreen = ({ products, supplierName, onBack }: ExportReviewScreenProps) => {
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>("shopify_full");
  const [filterHigh, setFilterHigh] = useState(true);
  const [filterMedium, setFilterMedium] = useState(true);
  const [filterLow, setFilterLow] = useState(false);
  const [filterNew, setFilterNew] = useState(true);
  const [filterUpdates, setFilterUpdates] = useState(true);
  const [filterMissingImages, setFilterMissingImages] = useState(true);
  const mode = useStoreMode();

  // Assign defaults
  const enriched = products.map((p, i) => ({
    ...p,
    hasImage: p.hasImage ?? i < products.length - 2,
    hasSeo: p.hasSeo ?? true,
    hasTags: p.hasTags ?? true,
    confidence: p.confidence ?? (i === products.length - 1 ? "low" as const : i > products.length - 3 ? "medium" as const : "high" as const),
    isNew: p.isNew ?? i < products.length - 1,
  }));

  const highCount = enriched.filter(p => p.confidence === "high").length;
  const medCount = enriched.filter(p => p.confidence === "medium").length;
  const lowCount = enriched.filter(p => p.confidence === "low").length;
  const withImages = enriched.filter(p => p.hasImage).length;
  const withoutImages = enriched.filter(p => !p.hasImage).length;
  const newProducts = enriched.filter(p => p.isNew).length;
  const updateProducts = enriched.filter(p => !p.isNew).length;

  const filtered = enriched.filter(p => {
    if (p.confidence === "high" && !filterHigh) return false;
    if (p.confidence === "medium" && !filterMedium) return false;
    if (p.confidence === "low" && !filterLow) return false;
    if (p.isNew && !filterNew) return false;
    if (!p.isNew && !filterUpdates) return false;
    if (!p.hasImage && !filterMissingImages) return false;
    return true;
  });

  const avgConfidence = Math.round(
    (filtered.reduce((s, p) => s + (p.confidence === "high" ? 95 : p.confidence === "medium" ? 75 : 40), 0) / Math.max(filtered.length, 1))
  );

  const warnings: string[] = [];
  if (withoutImages > 0) warnings.push(`${withoutImages} product${withoutImages > 1 ? "s have" : " has"} no image URL — will import without a photo`);
  if (lowCount > 0 && filterLow) warnings.push(`${lowCount} product${lowCount > 1 ? "s have" : " has"} LOW confidence — review before importing`);

  const downloadFile = (content: string, filename: string, mime = "text/csv") => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const handleExport = () => {
    const filename = generateFilename(supplierName, selectedFormat);
    const prods = filtered;

    if (selectedFormat === "shopify_full") {
      const enabledMeta = getEnabledMetafields();
      const rows = prods.map(p => {
        const handle = `${p.name}-${p.brand}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
        const row: Record<string, string> = {
          Handle: handle, Title: `${p.brand} ${p.name}`, "Body (HTML)": `<p>${p.name} by ${p.brand}. Premium ${p.type.toLowerCase()}.</p>`,
          Vendor: p.brand, Type: p.type, Tags: `${p.brand}, ${p.type}, New Arrival`,
          Published: "TRUE", "Variant Price": p.rrp.toFixed(2), "Variant Compare At Price": "",
          "Variant SKU": p.sku || "", "Variant Barcode": p.barcode || "", "Image Src": "", Status: "draft",
          "SEO Title": `${p.name} | ${p.brand}`.slice(0, 70),
          "SEO Description": `Shop ${p.name} by ${p.brand}. Premium ${p.type.toLowerCase()}.`.slice(0, 160),
        };
        // Add metafield columns where at least one product has data
        for (const mf of enabledMeta) {
          const val = p.metafields?.[mf.key] || "";
          row[mf.shopifyColumn] = val;
        }
        return row;
      });
      // Filter out metafield columns where ALL values are empty
      const metaColsToInclude = enabledMeta
        .filter(mf => rows.some(r => r[mf.shopifyColumn]?.trim()))
        .map(mf => mf.shopifyColumn);
      const baseColumns = ["Handle", "Title", "Body (HTML)", "Vendor", "Type", "Tags", "Published", "Variant Price", "Variant Compare At Price", "Variant SKU", "Image Src", "Status", "SEO Title", "SEO Description"];
      downloadFile("\uFEFF" + Papa.unparse(rows, { columns: [...baseColumns, ...metaColsToInclude] }), filename);
    } else if (selectedFormat === "shopify_inventory") {
      const rows = prods.map(p => ({
        Handle: `${p.name}-${p.brand}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        "Variant SKU": "", Barcode: "", "Variant Inventory Qty": "1", "Variant Inventory Policy": "deny",
      }));
      downloadFile("\uFEFF" + Papa.unparse(rows), filename);
    } else if (selectedFormat === "shopify_price") {
      const rows = prods.map(p => ({
        Handle: `${p.name}-${p.brand}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        "Variant SKU": "", "Variant Price": p.rrp.toFixed(2), "Variant Compare At Price": "",
      }));
      downloadFile("\uFEFF" + Papa.unparse(rows), filename);
    } else if (selectedFormat === "tags_only") {
      const rows = prods.map(p => ({
        Handle: `${p.name}-${p.brand}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        Title: `${p.brand} ${p.name}`, Tags: `${p.brand}, ${p.type}, New Arrival`,
      }));
      downloadFile("\uFEFF" + Papa.unparse(rows), filename);
    } else if (selectedFormat === "google_xml") {
      const xml = generateGoogleFeedXML(prods.map(p => ({
        name: p.name, brand: p.brand, type: p.type, price: p.price, rrp: p.rrp,
        colour: p.colour, size: p.size,
        tags: p.hasTags ? `${p.brand}, ${p.type}, New Arrival` : '',
      })), supplierName);
      downloadFile(xml, filename, "application/xml;charset=utf-8");
    } else if (selectedFormat === "google_tsv") {
      const tsv = generateGoogleFeedTSV(prods.map(p => ({
        name: p.name, brand: p.brand, type: p.type, price: p.price, rrp: p.rrp,
        colour: p.colour, size: p.size,
        tags: p.hasTags ? `${p.brand}, ${p.type}, New Arrival` : '',
      })));
      downloadFile("\uFEFF" + tsv, filename, "text/tab-separated-values;charset=utf-8");
    } else if (selectedFormat === "xlsx" || selectedFormat === "summary_pdf") {
      // Fallback to CSV for now
      const rows = prods.map(p => ({
        Product: p.name, Brand: p.brand, Type: p.type,
        Cost: p.price.toFixed(2), RRP: p.rrp.toFixed(2), Confidence: p.confidence,
      }));
      downloadFile("\uFEFF" + Papa.unparse(rows), filename.replace(/\.(xlsx|pdf)$/, ".csv"));
    }

    // Save export to history
    const exports = JSON.parse(localStorage.getItem("export_history") || "[]");
    exports.unshift({
      supplier: supplierName, format: selectedFormat, filename,
      productCount: filtered.length, date: new Date().toISOString(),
    });
    localStorage.setItem("export_history", JSON.stringify(exports.slice(0, 100)));
  };

  return (
    <div className="px-4 pt-4 pb-24 animate-fade-in">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
        <h2 className="text-lg font-semibold font-display">Export review</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* LEFT — Summary */}
        <div className="space-y-3">
          <div className="bg-card rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold mb-3">Export summary</h3>
            <div className="grid grid-cols-2 gap-y-2 text-sm">
              <span className="text-muted-foreground">Products to export:</span>
              <span className="font-semibold font-mono-data">{filtered.length}</span>
              <span className="text-muted-foreground">New products:</span>
              <span className="font-mono-data">{filtered.filter(p => p.isNew).length}</span>
              <span className="text-muted-foreground">Stock updates:</span>
              <span className="font-mono-data">{filtered.filter(p => !p.isNew).length}</span>
              <span className="text-muted-foreground">With images:</span>
              <span className="font-mono-data">{filtered.filter(p => p.hasImage).length}</span>
              <span className="text-muted-foreground">Without images:</span>
              <span className={`font-mono-data ${filtered.filter(p => !p.hasImage).length > 0 ? "text-warning" : ""}`}>
                {filtered.filter(p => !p.hasImage).length}
              </span>
              <span className="text-muted-foreground">With SEO:</span>
              <span className="font-mono-data">{filtered.filter(p => p.hasSeo).length}</span>
              <span className="text-muted-foreground">With tags:</span>
              <span className="font-mono-data">{filtered.filter(p => p.hasTags).length}</span>
              <span className="text-muted-foreground">Avg confidence:</span>
              <span className={`font-mono-data font-semibold ${avgConfidence >= 80 ? "text-success" : avgConfidence >= 60 ? "text-warning" : "text-destructive"}`}>
                {avgConfidence}% ({avgConfidence >= 80 ? "High" : avgConfidence >= 60 ? "Medium" : "Low"})
              </span>
            </div>
          </div>

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 space-y-1">
              {warnings.map((w, i) => (
                <p key={i} className="text-xs text-warning flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {w}
                </p>
              ))}
            </div>
          )}

          {/* Filters */}
          <div className="bg-card rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold mb-3">Include in export</h3>
            <div className="space-y-2.5">
              <label className="flex items-center gap-2.5 text-sm">
                <Checkbox checked={filterHigh} onCheckedChange={v => setFilterHigh(!!v)} />
                <span>High confidence lines ({highCount})</span>
              </label>
              <label className="flex items-center gap-2.5 text-sm">
                <Checkbox checked={filterMedium} onCheckedChange={v => setFilterMedium(!!v)} />
                <span>Medium confidence lines ({medCount})</span>
              </label>
              <label className="flex items-center gap-2.5 text-sm">
                <Checkbox checked={filterLow} onCheckedChange={v => setFilterLow(!!v)} />
                <span className="text-warning">Low confidence lines ({lowCount})</span>
              </label>

              <div className="border-t border-border pt-2.5 mt-2.5 space-y-2.5">
                <label className="flex items-center gap-2.5 text-sm">
                  <Checkbox checked={filterNew} onCheckedChange={v => setFilterNew(!!v)} />
                  <span>New products ({newProducts})</span>
                </label>
                <label className="flex items-center gap-2.5 text-sm">
                  <Checkbox checked={filterUpdates} onCheckedChange={v => setFilterUpdates(!!v)} />
                  <span>Inventory updates ({updateProducts})</span>
                </label>
                <label className="flex items-center gap-2.5 text-sm">
                  <Checkbox checked={filterMissingImages} onCheckedChange={v => setFilterMissingImages(!!v)} />
                  <span>Products missing images ({withoutImages})</span>
                </label>
              </div>
            </div>

            <div className="flex gap-2 mt-3">
              <Button variant="ghost" size="sm" className="text-xs"
                onClick={() => { setFilterHigh(true); setFilterMedium(true); setFilterLow(true); setFilterNew(true); setFilterUpdates(true); setFilterMissingImages(true); }}>
                Select all
              </Button>
              <Button variant="ghost" size="sm" className="text-xs"
                onClick={() => { setFilterHigh(false); setFilterMedium(false); setFilterLow(false); setFilterNew(false); setFilterUpdates(false); setFilterMissingImages(false); }}>
                Deselect all
              </Button>
            </div>

            <p className="text-xs text-muted-foreground mt-2 font-mono-data">Will export: {filtered.length} products</p>
          </div>
        </div>

        {/* RIGHT — Format selection */}
        <div className="space-y-3">
          <div className="bg-card rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold mb-3">Export format</h3>
            <div className="space-y-2">
              {FORMAT_CARDS.map(fmt => (
                <button
                  key={fmt.id}
                  onClick={() => setSelectedFormat(fmt.id)}
                  className={`w-full rounded-lg border-2 p-3 text-left transition-all ${
                    selectedFormat === fmt.id ? "border-primary bg-primary/5" : "border-border bg-card hover:border-muted-foreground/30"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 shrink-0">{fmt.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold">{fmt.label}</p>
                        {selectedFormat === fmt.id && <Check className="w-4 h-4 text-primary shrink-0" />}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{fmt.desc}</p>
                      <p className="text-[10px] text-primary/70 mt-1">Best for: {fmt.best}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Download */}
          <Button variant="success" className="w-full h-14 text-base" onClick={handleExport} disabled={filtered.length === 0}>
            <Download className="w-5 h-5 mr-2" />
            Download {FORMAT_CARDS.find(f => f.id === selectedFormat)?.label} — {filtered.length} products
          </Button>
          <p className="text-[10px] text-muted-foreground text-center font-mono-data">
            {generateFilename(supplierName, selectedFormat)}
          </p>
        </div>
      </div>
    </div>
  );
};

export default ExportReviewScreen;
