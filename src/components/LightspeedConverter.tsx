import { useState, useRef } from "react";
import { ChevronLeft, Upload, Check, AlertTriangle, ChevronDown, ChevronUp, Download, FileText, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import Papa from "papaparse";
import { addAuditEntry } from "@/lib/audit-log";

interface Props { onBack: () => void; }

interface ParsedData {
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
  productCount: number;
  variantCount: number;
  barcodeDetected: number;
  barcodeEmpty: number;
  locations: string[];
}

interface ConvertOptions {
  includeInactive: boolean;
  includeZeroPrice: boolean;
  stockOnlyPositive: boolean;
}

const SHOPIFY_COLUMNS = [
  "Handle","Title","Body (HTML)","Vendor","Product Category","Type","Tags","Published",
  "Option1 Name","Option1 Value","Option2 Name","Option2 Value",
  "Variant SKU","Variant Barcode","Variant Price","Variant Compare At Price",
  "Variant Inventory Qty","Variant Inventory Tracker","Variant Inventory Policy",
  "Variant Fulfillment Service","Variant Requires Shipping","Variant Taxable",
  "Cost per item","Status",
];

const COLUMN_MAP: { ls: string; shopify: string; fallback?: string }[] = [
  { ls: "handle", shopify: "Handle" },
  { ls: "name", shopify: "Title" },
  { ls: "description", shopify: "Body (HTML)" },
  { ls: "brand_name", shopify: "Vendor" },
  { ls: "product_category", shopify: "Type" },
  { ls: "tags", shopify: "Tags" },
  { ls: "retail_price", shopify: "Variant Price" },
  { ls: "supply_price", shopify: "Cost per item" },
  { ls: "sku", shopify: "Variant SKU" },
  { ls: "[auto-detected]", shopify: "Variant Barcode" },
  { ls: "variant_option_one_name", shopify: "Option1 Name" },
  { ls: "variant_option_one_value", shopify: "Option1 Value" },
  { ls: "variant_option_two_name", shopify: "Option2 Name" },
  { ls: "variant_option_two_value", shopify: "Option2 Value" },
  { ls: "active", shopify: "Status" },
];

function isBarcodeCandidate(sku: string): boolean {
  const clean = (sku || "").trim();
  return /^\d{12,13}$/.test(clean);
}

function getInventoryColumns(headers: string[]): string[] {
  return headers.filter(h => /^inventory_/i.test(h));
}

function sumInventory(row: Record<string, string>, cols: string[]): number {
  return cols.reduce((sum, c) => sum + (parseInt(row[c] || "0", 10) || 0), 0);
}

function parseFile(file: File): Promise<ParsedData> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const headers = result.meta.fields || [];
        const rows = result.data as Record<string, string>[];
        if (!headers.map(h => h.toLowerCase()).includes("handle")) {
          reject(new Error("NO_HANDLE"));
          return;
        }
        if (rows.length < 2) {
          reject(new Error("TOO_FEW"));
          return;
        }
        const handles = new Set(rows.map(r => r.handle || r.Handle || ""));
        const invCols = getInventoryColumns(headers);
        const locations = invCols.map(c => c.replace(/^inventory_/i, "").replace(/_/g, " "));
        let barcodeDetected = 0, barcodeEmpty = 0;
        rows.forEach(r => {
          const sku = r.sku || r.SKU || "";
          if (isBarcodeCandidate(sku)) barcodeDetected++;
          else barcodeEmpty++;
        });
        resolve({
          fileName: file.name,
          headers,
          rows,
          productCount: handles.size,
          variantCount: rows.length,
          barcodeDetected,
          barcodeEmpty,
          locations: locations.length ? locations : ["Main Outlet"],
        });
      },
      error: () => reject(new Error("PARSE_ERROR")),
    });
  });
}

function convertToShopify(data: ParsedData, options: ConvertOptions): { csv: string; productCount: number; variantCount: number } {
  const rows = data.rows;
  const invCols = getInventoryColumns(data.headers);

  // Group by handle
  const groups = new Map<string, Record<string, string>[]>();
  rows.forEach(r => {
    const h = r.handle || r.Handle || "";
    if (!groups.has(h)) groups.set(h, []);
    groups.get(h)!.push(r);
  });

  const output: Record<string, string>[] = [];
  let productCount = 0;

  groups.forEach((variants, handle) => {
    const first = variants[0];
    const isActive = (first.active || "1") === "1";
    if (!options.includeInactive && !isActive) return;

    const price = parseFloat(first.retail_price || first.Retail_Price || "0");
    if (!options.includeZeroPrice && price === 0) return;

    productCount++;

    variants.forEach((v, vi) => {
      const isFirst = vi === 0;
      const sku = v.sku || v.SKU || "";
      const barcode = isBarcodeCandidate(sku) ? sku.trim() : "";
      const qty = invCols.length ? sumInventory(v, invCols) : parseInt(v.inventory || "0", 10) || 0;

      if (options.stockOnlyPositive && qty <= 0) return;

      const opt1Name = v.variant_option_one_name || "";
      const opt1Val = v.variant_option_one_value || "";
      const opt2Name = v.variant_option_two_name || "";
      const opt2Val = v.variant_option_two_value || "";

      const row: Record<string, string> = {};
      SHOPIFY_COLUMNS.forEach(c => row[c] = "");

      row["Handle"] = handle;
      row["Variant SKU"] = sku;
      row["Variant Barcode"] = barcode;
      row["Variant Price"] = v.retail_price || v.Retail_Price || "";
      row["Variant Compare At Price"] = "";
      row["Variant Inventory Qty"] = String(qty);
      row["Variant Inventory Tracker"] = "shopify";
      row["Variant Inventory Policy"] = "deny";
      row["Variant Fulfillment Service"] = "manual";
      row["Variant Requires Shipping"] = "TRUE";
      row["Variant Taxable"] = "TRUE";
      row["Cost per item"] = v.supply_price || v.Supply_Price || "";
      row["Option1 Value"] = opt1Val || (isFirst ? "Default Title" : "");
      row["Option2 Value"] = opt2Val;

      if (isFirst) {
        row["Title"] = v.name || v.Name || "";
        row["Body (HTML)"] = v.description || v.Description || "";
        row["Vendor"] = v.brand_name || v.Brand_Name || "";
        row["Type"] = v.product_category || v.Product_Category || "";
        row["Tags"] = v.tags || v.Tags || "";
        row["Published"] = isActive ? "TRUE" : "FALSE";
        row["Option1 Name"] = opt1Name || "Title";
        row["Option2 Name"] = opt2Name;
        row["Status"] = isActive ? "active" : "draft";
      }

      output.push(row);
    });
  });

  const csv = "\uFEFF" + Papa.unparse(output, { columns: SHOPIFY_COLUMNS });
  return { csv, productCount, variantCount: output.length };
}

export default function LightspeedConverter({ onBack }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [data, setData] = useState<ParsedData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<ConvertOptions>({ includeInactive: false, includeZeroPrice: false, stockOnlyPositive: false });
  const [result, setResult] = useState<{ csv: string; productCount: number; variantCount: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const parsed = await parseFile(file);
      setData(parsed);
      setStep(2);
    } catch (e: any) {
      if (e.message === "NO_HANDLE") setError("This does not look like a Lightspeed product export. The file must have a 'handle' column. Check you exported from Products, not Inventory.");
      else if (e.message === "TOO_FEW") setError("File appears to be empty or has no product rows.");
      else setError("Could not parse the file. Please check it's a valid CSV.");
    }
  };

  const handleConvert = () => {
    if (!data) return;
    const r = convertToShopify(data, options);
    setResult(r);
    setStep(3);
    addAuditEntry("Convert", `Lightspeed export · ${r.productCount} products · ${r.variantCount} variants`);
  };

  const handleDownload = () => {
    if (!result) return;
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lightspeed_shopify_${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-32">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground mb-4 hover:text-foreground">
        <ChevronLeft className="w-4 h-4" /> Back
      </button>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {[1, 2, 3].map(s => (
          <div key={s} className={`flex items-center gap-1.5 text-xs font-medium ${step >= s ? "text-primary" : "text-muted-foreground"}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${step > s ? "bg-primary text-primary-foreground" : step === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              {step > s ? <Check className="w-3 h-3" /> : s}
            </div>
            {s === 1 ? "Upload" : s === 2 ? "Preview" : "Download"}
            {s < 3 && <ArrowRight className="w-3 h-3 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* STEP 1 — UPLOAD */}
      {step === 1 && (
        <>
          <h1 className="text-xl font-bold mb-1">Upload your Lightspeed export</h1>
          <p className="text-sm text-muted-foreground mb-6">We'll convert it to a Shopify-ready CSV with barcodes mapped where possible.</p>

          <div
            className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => fileRef.current?.click()}
            onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
            onDragOver={(e) => e.preventDefault()}
          >
            <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium">Drop your Lightspeed product export here</p>
            <p className="text-xs text-muted-foreground mt-1">Export from Lightspeed: Products → Export → CSV</p>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
          </div>

          {error && (
            <div className="mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <Collapsible className="mt-6">
            <CollapsibleTrigger className="flex items-center gap-2 text-sm text-primary hover:underline">
              <ChevronDown className="w-4 h-4" /> How to export from Lightspeed X-Series
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 p-4 bg-muted/50 rounded-lg text-sm space-y-1">
              <p>1. Lightspeed Retail → Products</p>
              <p>2. Click the Export button (top right)</p>
              <p>3. Select: All products</p>
              <p>4. Format: CSV</p>
              <p>5. Upload the downloaded file here</p>
            </CollapsibleContent>
          </Collapsible>
        </>
      )}

      {/* STEP 2 — PREVIEW */}
      {step === 2 && data && (
        <>
          <h1 className="text-xl font-bold mb-1">Review before downloading</h1>
          <p className="text-sm text-muted-foreground mb-4">Check the mapping and options below.</p>

          {/* Scan summary */}
          <Card className="mb-4">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Check className="w-4 h-4 text-success" />
                <span className="text-sm font-semibold">{data.fileName} loaded</span>
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                <p>{data.productCount} products · {data.variantCount} variant rows</p>
                <p>{data.barcodeDetected} rows with barcode auto-detected from SKU</p>
                <p>{data.barcodeEmpty} rows with barcode column empty (ready to fill in)</p>
                <p>Locations found: {data.locations.join(", ")}</p>
              </div>
            </CardContent>
          </Card>

          {/* Barcode warning */}
          <Card className="mb-4 border-secondary/30">
            <CardContent className="p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-secondary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold mb-1">⚠ Barcode column is empty for most products</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Lightspeed's export does not include barcodes. After downloading, open the file and paste your barcodes into the 'Variant Barcode' column. Match them using the 'Variant SKU' column (Lightspeed stock number).
                  </p>
                  {data.barcodeDetected > 0 && (
                    <p className="text-xs text-success mt-2">{data.barcodeDetected} products had barcodes auto-detected because their Lightspeed SKU was a 12–13 digit EAN/UPC barcode.</p>
                  )}
                </div>
              </div>

              <Collapsible className="mt-3">
                <CollapsibleTrigger className="flex items-center gap-1 text-xs text-primary hover:underline">
                  <ChevronDown className="w-3 h-3" /> Why are barcodes missing?
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 p-3 bg-muted/50 rounded text-xs text-muted-foreground leading-relaxed">
                  Lightspeed X-Series stores barcodes separately from product data in their system. Their standard Product Export CSV does not include the barcode field — this is a known limitation confirmed by Lightspeed support. The Variant SKU column in the output contains Lightspeed's internal stock number (e.g. 49566), which you can use to match and add the correct EAN/UPC barcode from your supplier invoices or Lightspeed's product detail pages.
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>

          {/* Column mapping */}
          <Card className="mb-4">
            <CardContent className="p-4">
              <p className="text-sm font-semibold mb-3">Column mapping</p>
              <div className="space-y-1">
                {COLUMN_MAP.map(m => {
                  const found = m.ls === "[auto-detected]" || data.headers.some(h => h.toLowerCase() === m.ls.toLowerCase());
                  const invMatch = m.ls.startsWith("inventory_") ? data.headers.some(h => h.toLowerCase().startsWith("inventory_")) : true;
                  const isBarcode = m.ls === "[auto-detected]";
                  return (
                    <div key={m.shopify} className="flex items-center text-xs gap-2">
                      <span className="w-40 font-mono-data text-muted-foreground truncate">{m.ls}</span>
                      <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                      <span className="flex-1 font-medium">{m.shopify}</span>
                      <span className={isBarcode ? "text-secondary" : found ? "text-success" : "text-muted-foreground"}>
                        {isBarcode ? "⚠ N/A for most" : found ? "✓" : "—"}
                      </span>
                    </div>
                  );
                })}
                {getInventoryColumns(data.headers).map(c => (
                  <div key={c} className="flex items-center text-xs gap-2">
                    <span className="w-40 font-mono-data text-muted-foreground truncate">{c}</span>
                    <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className="flex-1 font-medium">Variant Inventory Qty</span>
                    <span className="text-success">✓</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Preview table */}
          <Card className="mb-4">
            <CardContent className="p-4">
              <p className="text-sm font-semibold mb-3">Product preview (first 10 rows)</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {["Handle","Title","SKU","Barcode","Price","Stock","Status"].map(h => (
                        <th key={h} className="text-left py-1 pr-3 font-medium text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.slice(0, 10).map((r, i) => {
                      const sku = r.sku || r.SKU || "";
                      const invCols = getInventoryColumns(data.headers);
                      return (
                        <tr key={i} className="border-b border-border/50">
                          <td className="py-1 pr-3 font-mono-data truncate max-w-[100px]">{r.handle || r.Handle}</td>
                          <td className="py-1 pr-3 truncate max-w-[120px]">{r.name || r.Name}</td>
                          <td className="py-1 pr-3 font-mono-data">{sku}</td>
                          <td className="py-1 pr-3 font-mono-data">{isBarcodeCandidate(sku) ? sku : "—"}</td>
                          <td className="py-1 pr-3 font-mono-data">{r.retail_price || r.Retail_Price || "—"}</td>
                          <td className="py-1 pr-3 font-mono-data">{invCols.length ? sumInventory(r, invCols) : r.inventory || "0"}</td>
                          <td className="py-1 pr-3">{(r.active || "1") === "1" ? "Active" : "Draft"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Options */}
          <Card className="mb-6">
            <CardContent className="p-4 space-y-3">
              <p className="text-sm font-semibold">Options</p>
              {[
                { key: "includeInactive" as const, label: "Include inactive products (currently: excluded)" },
                { key: "includeZeroPrice" as const, label: "Include products with $0 price" },
                { key: "stockOnlyPositive" as const, label: "Export only products with stock > 0" },
              ].map(opt => (
                <label key={opt.key} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={options[opt.key]} onChange={() => setOptions(p => ({ ...p, [opt.key]: !p[opt.key] }))} className="rounded border-border" />
                  {opt.label}
                </label>
              ))}
            </CardContent>
          </Card>

          <Button className="w-full h-12 text-base" onClick={handleConvert}>
            Next → Download <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        </>
      )}

      {/* STEP 3 — DOWNLOAD */}
      {step === 3 && result && (
        <>
          <div className="text-center py-8">
            <div className="w-16 h-16 rounded-full bg-success/15 flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-success" />
            </div>
            <h1 className="text-xl font-bold mb-1">Your file is ready</h1>
            <p className="text-sm text-muted-foreground">{result.productCount} products · {result.variantCount} variant rows converted</p>
          </div>

          <Button variant="success" className="w-full h-14 text-lg mb-6" onClick={handleDownload}>
            <Download className="w-5 h-5 mr-2" /> Download Shopify CSV
          </Button>

          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-2 text-sm text-primary hover:underline w-full">
              <ChevronDown className="w-4 h-4" /> How to import into Shopify
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 p-4 bg-muted/50 rounded-lg text-sm space-y-1.5">
              <p>1. Shopify Admin → Products → Import</p>
              <p>2. Click 'Add file' → select the downloaded CSV</p>
              <p>3. Tick ☑ 'Overwrite existing products with matching handle'</p>
              <p>4. Click 'Upload and continue'</p>
              <p>5. Review the preview — check prices and variants</p>
              <p>6. Click 'Import products'</p>
              <div className="mt-3 p-3 bg-secondary/10 rounded border border-secondary/20 text-xs leading-relaxed">
                <p className="font-semibold mb-1">⚠ About barcodes:</p>
                <p>The 'Variant Barcode' column in the downloaded file is empty for most products because Lightspeed does not export barcodes. To add barcodes:</p>
                <p className="mt-1">a) Open the downloaded CSV in Excel</p>
                <p>b) Find the 'Variant Barcode' column (column N)</p>
                <p>c) Match each row using 'Variant SKU' (Lightspeed stock number) to find the right barcode</p>
                <p>d) Paste the barcodes in, then re-import (with Overwrite ticked)</p>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Button variant="ghost" className="w-full mt-6" onClick={() => { setStep(1); setData(null); setResult(null); setError(null); }}>
            <FileText className="w-4 h-4 mr-2" /> Import another file
          </Button>
        </>
      )}
    </div>
  );
}
