// ══════════════════════════════════════════════════════════
// CsvPreviewDialog
//
// Lets the user preview and download the Lightspeed X-Series and
// Shopify product CSVs generated from the CURRENT in-memory product
// groups — including any quantities the user edited in the Review
// screen's variant matrix.
//
// Pure frontend: derives CSVs on the fly from props, no DB writes.
// ══════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, FileSpreadsheet, Eye } from "lucide-react";
import { toast } from "sonner";
import {
  generateXSeriesCSV,
  getXSeriesSettings,
  titleCase,
  stripBrandPrefix,
  arrivalMonthTag,
  type XSeriesProduct,
} from "@/lib/lightspeed-xseries";
import { normaliseVendor } from "@/lib/normalise-vendor";

export interface PreviewProduct {
  name: string;
  brand: string;
  type: string;
  price: number;     // wholesale cost ex GST
  rrp: number;       // retail
  sku?: string;
  barcode?: string;
  colour?: string;
  size?: string;
  qty?: number;
  bodyHtml?: string;
  season?: string;
  invoiceDate?: string;
  /** vendor style code; falls back to first variant SKU */
  vendorCode?: string;
  variants?: { sku?: string; colour?: string; size?: string; qty?: number; price?: number; rrp?: number }[];
}

interface CsvPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: PreviewProduct[];
  supplierName: string;
  invoiceDate?: string;
}

// ── Build Shopify CSV (matches LightspeedExportDownload.handleShopifyDownload) ──
export function buildShopifyCsv(products: PreviewProduct[]): string {
  const headers = [
    "Handle", "Title", "Body (HTML)", "Vendor", "Type", "Tags",
    "Variant SKU", "Variant Price", "Cost per item", "Variant Inventory Qty",
    "Option1 Name", "Option1 Value", "Option2 Name", "Option2 Value",
  ];
  const rows: string[][] = [headers];
  for (const p of products) {
    const vendor = normaliseVendor(p.brand);
    const title = titleCase(stripBrandPrefix(p.name, p.brand));
    const handle = `${vendor}-${title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const tags = [vendor, p.type, "new arrivals"].filter(Boolean).join(", ");
    const variants = p.variants && p.variants.length > 0
      ? p.variants
      : [{ sku: p.sku || "", colour: p.colour || "", size: p.size || "", qty: p.qty ?? 0, price: p.price, rrp: p.rrp }];
    variants.forEach((v, i) => {
      rows.push([
        handle,
        i === 0 ? title : "",
        i === 0 ? (p.bodyHtml || "") : "",
        i === 0 ? vendor : "",
        i === 0 ? p.type : "",
        i === 0 ? tags : "",
        v.sku || "",
        String(v.rrp ?? p.rrp),
        String(v.price ?? p.price),
        String(v.qty ?? 0),
        v.colour ? "Colour" : "",
        v.colour || "",
        v.size ? "Size" : "",
        v.size || "",
      ]);
    });
  }
  return rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}

// ── Build Lightspeed X-Series CSV ──
function buildLightspeedCsv(products: PreviewProduct[], supplierName: string, invoiceDate?: string): string {
  const settings = getXSeriesSettings();
  const xProducts: XSeriesProduct[] = products.map(p => ({
    title: titleCase(stripBrandPrefix(p.name, p.brand)),
    brand: normaliseVendor(p.brand),
    type: p.type,
    price: p.price,
    rrp: p.rrp,
    description: (p.bodyHtml || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim() || undefined,
    season: p.season,
    arrivalDate: p.invoiceDate || invoiceDate,
    supplierCode: p.vendorCode || p.sku,
    supplierName,
    tags: [normaliseVendor(p.brand), p.type, arrivalMonthTag(p.invoiceDate || invoiceDate)].filter(Boolean).join(", "),
    variants: (p.variants || []).map(v => ({
      sku: v.sku,
      colour: v.colour,
      size: v.size,
      quantity: v.qty,
      supplyPrice: v.price,
      retailPrice: v.rrp,
    })),
  }));
  const { csv } = generateXSeriesCSV(xProducts, settings);
  return csv;
}

// ── Render the first N rows of a CSV as an HTML table ──
function CsvTable({ csv, maxRows = 25 }: { csv: string; maxRows?: number }) {
  const rows = useMemo(() => {
    // Lightweight CSV split — handles quoted commas
    const out: string[][] = [];
    const lines = csv.split(/\r?\n/).filter(Boolean).slice(0, maxRows + 1);
    for (const line of lines) {
      const cells: string[] = [];
      let cur = "", inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = !inQ;
        } else if (ch === "," && !inQ) {
          cells.push(cur); cur = "";
        } else cur += ch;
      }
      cells.push(cur);
      out.push(cells);
    }
    return out;
  }, [csv, maxRows]);

  if (rows.length === 0) return <p className="text-xs text-muted-foreground">No rows.</p>;
  const [header, ...body] = rows;
  return (
    <div className="overflow-auto max-h-[55vh] border border-border rounded-md">
      <table className="w-full text-xs">
        <thead className="bg-muted sticky top-0">
          <tr>
            {header.map((h, i) => (
              <th key={i} className="text-left px-2 py-1.5 font-semibold border-b border-border whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i} className={i % 2 ? "bg-muted/20" : ""}>
              {r.map((c, j) => (
                <td key={j} className="px-2 py-1 border-b border-border/50 font-mono-data whitespace-nowrap max-w-[280px] truncate" title={c}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CsvPreviewDialog({ open, onOpenChange, products, supplierName, invoiceDate }: CsvPreviewDialogProps) {
  const [format, setFormat] = useState<"shopify" | "lightspeed">("shopify");

  const csv = useMemo(() => {
    if (products.length === 0) return "";
    return format === "shopify"
      ? buildShopifyCsv(products)
      : buildLightspeedCsv(products, supplierName, invoiceDate);
  }, [format, products, supplierName, invoiceDate]);

  const totalQty = useMemo(
    () => products.reduce((s, p) => s + (p.variants || []).reduce((a, v) => a + (v.qty || 0), 0), 0),
    [products],
  );
  const variantCount = useMemo(
    () => products.reduce((s, p) => s + Math.max(p.variants?.length || 0, 1), 0),
    [products],
  );

  const download = () => {
    if (!csv) return;
    const month = new Date().toLocaleString("en", { month: "short", year: "2-digit" }).replace(" ", "");
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const tag = (supplierName || "products").toLowerCase().replace(/\s+/g, "-");
    const filename = format === "shopify"
      ? `${tag}_${month}_shopify_${date}.csv`
      : `${tag}_${month}_lightspeed_${date}.csv`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV downloaded", { description: `${filename} · ${variantCount} variants · ${totalQty} units` });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-primary" />
            Preview &amp; Download CSV
          </DialogTitle>
          <DialogDescription>
            Live preview using your edited quantities — {products.length} products, {variantCount} variants, total qty {totalQty}.
          </DialogDescription>
        </DialogHeader>

        {/* Format toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFormat("shopify")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border ${format === "shopify" ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border"}`}
          >
            Shopify
          </button>
          <button
            onClick={() => setFormat("lightspeed")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border ${format === "lightspeed" ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border"}`}
          >
            Lightspeed X-Series
          </button>
          <span className="ml-auto text-[11px] text-muted-foreground flex items-center gap-1">
            <Eye className="w-3 h-3" /> Showing first 25 rows
          </span>
        </div>

        {csv ? <CsvTable csv={csv} /> : <p className="text-sm text-muted-foreground py-8 text-center">No products to export.</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={download} disabled={!csv}>
            <Download className="w-4 h-4 mr-2" /> Download {format === "shopify" ? "Shopify" : "Lightspeed"} CSV
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
