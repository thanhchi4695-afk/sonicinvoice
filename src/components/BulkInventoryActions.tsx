import { useState, useRef, useMemo } from "react";
import Papa from "papaparse";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Download, Upload, MoreHorizontal, Loader2, AlertTriangle, Check, FileSpreadsheet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { addAuditEntry } from "@/lib/audit-log";

/* ═══════════════════════════════════════════════════════════
   INVENTORY EXPORT
   ═══════════════════════════════════════════════════════════ */

async function exportInventoryCSV() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { toast.error("Not signed in"); return; }

  const { data: variants } = await supabase
    .from("variants")
    .select("sku, color, size, quantity, cost, retail_price, product_id, barcode")
    .order("sku");

  if (!variants?.length) { toast.info("No inventory data to export"); return; }

  const productIds = [...new Set(variants.map(v => v.product_id))];
  const { data: products } = await supabase
    .from("products")
    .select("id, title, vendor, product_type")
    .in("id", productIds);

  const prodMap = new Map((products || []).map(p => [p.id, p]));

  // supplier info via supplier_catalog_items (best effort)
  const skus = variants.map(v => v.sku).filter(Boolean) as string[];
  const { data: catItems } = skus.length > 0
    ? await supabase.from("supplier_catalog_items").select("sku, supplier_id").in("sku", skus.slice(0, 200))
    : { data: [] };
  const supplierIds = [...new Set((catItems || []).map(c => c.supplier_id))];
  const { data: suppliers } = supplierIds.length > 0
    ? await supabase.from("suppliers").select("id, name").in("id", supplierIds)
    : { data: [] };
  const supMap = new Map((suppliers || []).map(s => [s.id, s.name]));
  const skuSupplier = new Map((catItems || []).map(c => [c.sku, supMap.get(c.supplier_id) || ""]));

  const rows = variants.map(v => {
    const p = prodMap.get(v.product_id);
    return {
      SKU: v.sku || "",
      Barcode: v.barcode || "",
      "Product Title": p?.title || "",
      Vendor: p?.vendor || "",
      "Product Type": p?.product_type || "",
      Color: v.color || "",
      Size: v.size || "",
      "On Hand": v.quantity,
      Cost: v.cost,
      "Retail Price": v.retail_price,
      Supplier: skuSupplier.get(v.sku || "") || "",
    };
  });

  const csv = "\uFEFF" + Papa.unparse(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `inventory-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success(`Exported ${rows.length} variants`);
}

/* ═══════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════ */

type ImportMode = "inventory" | "po";

interface PreviewRow {
  sku: string;
  qty: number;
  reason?: string;
  product_title?: string;
  cost?: number;
  supplier?: string;
  color?: string;
  size?: string;
}

interface ValidationError {
  row: number;
  message: string;
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */

interface BulkInventoryActionsProps {
  mode: "inventory" | "po";
  onComplete?: () => void;
}

export default function BulkInventoryActions({ mode, onComplete }: BulkInventoryActionsProps) {
  const [open, setOpen] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>(mode);
  const [step, setStep] = useState<"upload" | "preview" | "applying">("upload");
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [applying, setApplying] = useState(false);
  const [appliedCount, setAppliedCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep("upload");
    setRows([]);
    setErrors([]);
    setAppliedCount(0);
  };

  const handleFile = (file: File) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const data = result.data as Record<string, string>[];
        if (!data.length) { toast.error("No data found in file"); return; }
        const headers = Object.keys(data[0]).map(h => h.toLowerCase().trim());

        const errs: ValidationError[] = [];
        const parsed: PreviewRow[] = [];

        if (importMode === "inventory") {
          // Required: SKU, Qty (or Adjustment)
          const skuCol = findHeader(headers, "sku", "variant sku");
          const qtyCol = findHeader(headers, "qty", "quantity", "adjustment", "adjustment_qty", "on hand");
          const reasonCol = findHeader(headers, "reason");

          if (!skuCol) { toast.error("CSV must have a 'SKU' column"); return; }
          if (!qtyCol) { toast.error("CSV must have a 'Qty' or 'Adjustment' column"); return; }

          data.forEach((row, i) => {
            const sku = row[skuCol]?.trim();
            const qty = parseInt(row[qtyCol] || "0", 10);
            if (!sku) { errs.push({ row: i + 2, message: "Missing SKU" }); return; }
            if (isNaN(qty)) { errs.push({ row: i + 2, message: `Invalid qty "${row[qtyCol]}"` }); return; }
            parsed.push({
              sku,
              qty,
              reason: reasonCol ? row[reasonCol]?.trim() || "Bulk Import" : "Bulk Import",
              product_title: row[findHeader(headers, "product title", "title", "product") || ""]?.trim(),
            });
          });
        } else {
          // PO import: Supplier, Product, SKU, Qty, Cost
          const supplierCol = findHeader(headers, "supplier", "vendor", "supplier name");
          const titleCol = findHeader(headers, "product title", "product", "title", "product name", "name");
          const skuCol = findHeader(headers, "sku", "variant sku");
          const qtyCol = findHeader(headers, "qty", "quantity", "expected qty", "order qty");
          const costCol = findHeader(headers, "cost", "unit cost", "expected cost", "price");
          const colorCol = findHeader(headers, "color", "colour");
          const sizeCol = findHeader(headers, "size");

          if (!supplierCol) { toast.error("CSV must have a 'Supplier' column"); return; }
          if (!qtyCol) { toast.error("CSV must have a 'Qty' column"); return; }

          data.forEach((row, i) => {
            const supplier = row[supplierCol]?.trim();
            const qty = parseInt(row[qtyCol] || "0", 10);
            if (!supplier) { errs.push({ row: i + 2, message: "Missing supplier" }); return; }
            if (isNaN(qty) || qty <= 0) { errs.push({ row: i + 2, message: "Invalid qty" }); return; }
            parsed.push({
              sku: skuCol ? row[skuCol]?.trim() || "" : "",
              qty,
              supplier,
              product_title: titleCol ? row[titleCol]?.trim() || "" : "",
              cost: costCol ? parseFloat(row[costCol] || "0") || 0 : 0,
              color: colorCol ? row[colorCol]?.trim() : undefined,
              size: sizeCol ? row[sizeCol]?.trim() : undefined,
            });
          });
        }

        setRows(parsed);
        setErrors(errs);
        setStep("preview");
      },
      error: () => toast.error("Failed to parse CSV"),
    });
  };

  /* ── Apply inventory adjustments ── */
  const applyInventoryAdjustments = async () => {
    setApplying(true);
    setStep("applying");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Not signed in"); setApplying(false); return; }

    let success = 0;
    for (const row of rows) {
      // Update variant quantity
      const { data: variant } = await supabase
        .from("variants")
        .select("id, quantity")
        .eq("user_id", user.id)
        .eq("sku", row.sku)
        .maybeSingle();

      if (variant) {
        await supabase
          .from("variants")
          .update({ quantity: variant.quantity + row.qty })
          .eq("id", variant.id);

        await supabase.from("inventory_adjustments").insert({
          user_id: user.id,
          sku: row.sku,
          product_title: row.product_title || null,
          adjustment_qty: row.qty,
          reason: row.reason || "Bulk Import",
          location: "Main Store",
        });
        success++;
      }
      setAppliedCount(success);
    }

    addAuditEntry("bulk_inventory_adjust", `Adjusted ${success} variants from CSV import`);
    toast.success(`Applied ${success} adjustments (${rows.length - success} skipped — SKU not found)`);
    setApplying(false);
    onComplete?.();
    setTimeout(() => { setOpen(false); reset(); }, 1500);
  };

  /* ── Apply PO bulk creation ── */
  const applyPOCreation = async () => {
    setApplying(true);
    setStep("applying");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Not signed in"); setApplying(false); return; }

    // Group by supplier
    const groups = new Map<string, PreviewRow[]>();
    for (const row of rows) {
      const key = row.supplier || "Unknown";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    let poCount = 0;
    for (const [supplierName, lines] of groups) {
      // Find or create supplier
      let { data: supplier } = await supabase
        .from("suppliers")
        .select("id")
        .eq("user_id", user.id)
        .eq("name", supplierName)
        .maybeSingle();

      if (!supplier) {
        const { data: created } = await supabase
          .from("suppliers")
          .insert({ user_id: user.id, name: supplierName })
          .select("id")
          .single();
        supplier = created;
      }

      const poNumber = `PO-${new Date().getFullYear()}-BULK-${String(poCount + 1).padStart(3, "0")}`;
      const totalCost = lines.reduce((s, l) => s + l.qty * (l.cost || 0), 0);

      const { data: po } = await supabase
        .from("purchase_orders")
        .insert({
          user_id: user.id,
          po_number: poNumber,
          supplier_id: supplier?.id || null,
          supplier_name: supplierName,
          status: "draft",
          total_cost: totalCost,
        })
        .select("id")
        .single();

      if (po) {
        const poLines = lines.map(l => ({
          user_id: user.id,
          purchase_order_id: po.id,
          product_title: l.product_title || l.sku || "",
          sku: l.sku || null,
          color: l.color || null,
          size: l.size || null,
          expected_qty: l.qty,
          expected_cost: l.cost || 0,
        }));
        await supabase.from("purchase_order_lines").insert(poLines);
        poCount++;
      }
      setAppliedCount(poCount);
    }

    addAuditEntry("bulk_po_import", `Created ${poCount} POs from CSV import`);
    toast.success(`Created ${poCount} purchase orders from ${rows.length} line items`);
    setApplying(false);
    onComplete?.();
    setTimeout(() => { setOpen(false); reset(); }, 1500);
  };

  /* ── PO Export ── */
  const handlePOExport = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: pos } = await supabase.from("purchase_orders").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    if (!pos?.length) { toast.info("No purchase orders to export"); return; }

    const poIds = pos.map(p => p.id);
    const { data: allLines } = await supabase.from("purchase_order_lines").select("*").in("purchase_order_id", poIds);

    const csvRows = (allLines || []).map(l => {
      const po = pos.find(p => p.id === l.purchase_order_id);
      return {
        "PO Number": po?.po_number || "",
        Supplier: po?.supplier_name || "",
        Status: po?.status || "",
        "Expected Date": po?.expected_date || "",
        "Product Title": l.product_title,
        SKU: l.sku || "",
        Color: l.color || "",
        Size: l.size || "",
        "Expected Qty": l.expected_qty,
        "Received Qty": l.received_qty,
        "Expected Cost": l.expected_cost,
        "Actual Cost": l.actual_cost ?? "",
      };
    });

    const csv = "\uFEFF" + Papa.unparse(csvRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `purchase-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${csvRows.length} PO lines`);
  };

  // Preview stats
  const previewStats = useMemo(() => {
    if (importMode === "po") {
      const suppliers = new Set(rows.map(r => r.supplier));
      return { suppliers: suppliers.size, lines: rows.length, totalQty: rows.reduce((s, r) => s + r.qty, 0) };
    }
    const positive = rows.filter(r => r.qty > 0).length;
    const negative = rows.filter(r => r.qty < 0).length;
    return { positive, negative, total: rows.length };
  }, [rows, importMode]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <MoreHorizontal className="w-4 h-4 mr-1" /> Bulk
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {mode === "inventory" && (
            <>
              <DropdownMenuItem onClick={() => exportInventoryCSV()}>
                <Download className="w-4 h-4 mr-2" /> Export inventory CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setImportMode("inventory"); reset(); setOpen(true); }}>
                <Upload className="w-4 h-4 mr-2" /> Import inventory adjustments
              </DropdownMenuItem>
            </>
          )}
          {mode === "po" && (
            <>
              <DropdownMenuItem onClick={handlePOExport}>
                <Download className="w-4 h-4 mr-2" /> Export all POs to CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setImportMode("po"); reset(); setOpen(true); }}>
                <Upload className="w-4 h-4 mr-2" /> Bulk import POs from CSV
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={(v) => { if (!applying) { setOpen(v); if (!v) reset(); } }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5" />
              {importMode === "inventory" ? "Bulk Inventory Adjustment" : "Bulk PO Import"}
            </DialogTitle>
            <DialogDescription>
              {importMode === "inventory"
                ? "Upload a CSV with SKU and Qty columns to adjust inventory levels in bulk."
                : "Upload a CSV with Supplier, Product, SKU, Qty, Cost to create POs grouped by supplier."}
            </DialogDescription>
          </DialogHeader>

          {/* Upload step */}
          {step === "upload" && (
            <div className="space-y-4">
              <div
                className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm font-medium">Click to upload CSV</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {importMode === "inventory"
                    ? "Required columns: SKU, Qty (or Adjustment)"
                    : "Required columns: Supplier, Qty. Optional: Product Title, SKU, Cost, Color, Size"}
                </p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = "";
                }}
              />
            </div>
          )}

          {/* Preview step */}
          {step === "preview" && (
            <div className="space-y-4">
              {errors.length > 0 && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                  <p className="text-sm font-medium text-destructive flex items-center gap-1">
                    <AlertTriangle className="w-4 h-4" /> {errors.length} row(s) skipped
                  </p>
                  <ul className="text-xs text-muted-foreground mt-1 space-y-0.5 max-h-20 overflow-y-auto">
                    {errors.slice(0, 5).map((e, i) => (
                      <li key={i}>Row {e.row}: {e.message}</li>
                    ))}
                    {errors.length > 5 && <li>…and {errors.length - 5} more</li>}
                  </ul>
                </div>
              )}

              <div className="bg-muted/50 rounded-lg p-3">
                {importMode === "inventory" ? (
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div><p className="font-semibold text-lg">{(previewStats as any).total}</p><p className="text-muted-foreground">Total rows</p></div>
                    <div><p className="font-semibold text-lg text-green-600">+{(previewStats as any).positive}</p><p className="text-muted-foreground">Increases</p></div>
                    <div><p className="font-semibold text-lg text-red-500">{(previewStats as any).negative}</p><p className="text-muted-foreground">Decreases</p></div>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div><p className="font-semibold text-lg">{(previewStats as any).suppliers}</p><p className="text-muted-foreground">POs to create</p></div>
                    <div><p className="font-semibold text-lg">{(previewStats as any).lines}</p><p className="text-muted-foreground">Line items</p></div>
                    <div><p className="font-semibold text-lg">{(previewStats as any).totalQty}</p><p className="text-muted-foreground">Total units</p></div>
                  </div>
                )}
              </div>

              {/* Row preview */}
              <div className="border border-border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      {importMode === "po" && <th className="text-left p-2">Supplier</th>}
                      <th className="text-left p-2">SKU</th>
                      <th className="text-left p-2">Product</th>
                      <th className="text-right p-2">Qty</th>
                      {importMode === "po" && <th className="text-right p-2">Cost</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 20).map((r, i) => (
                      <tr key={i} className="border-t border-border">
                        {importMode === "po" && <td className="p-2">{r.supplier}</td>}
                        <td className="p-2 font-mono">{r.sku || "—"}</td>
                        <td className="p-2 truncate max-w-[120px]">{r.product_title || "—"}</td>
                        <td className="p-2 text-right font-mono">
                          <span className={r.qty > 0 ? "text-green-600" : r.qty < 0 ? "text-red-500" : ""}>
                            {r.qty > 0 ? `+${r.qty}` : r.qty}
                          </span>
                        </td>
                        {importMode === "po" && <td className="p-2 text-right font-mono">${r.cost?.toFixed(2)}</td>}
                      </tr>
                    ))}
                    {rows.length > 20 && (
                      <tr><td colSpan={5} className="p-2 text-center text-muted-foreground">…{rows.length - 20} more rows</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <DialogFooter className="gap-2">
                <Button variant="outline" size="sm" onClick={() => { reset(); }}>Cancel</Button>
                <Button
                  variant="teal"
                  size="sm"
                  disabled={rows.length === 0}
                  onClick={() => importMode === "inventory" ? applyInventoryAdjustments() : applyPOCreation()}
                >
                  <Check className="w-4 h-4 mr-1" />
                  {importMode === "inventory" ? `Apply ${rows.length} adjustments` : `Create ${(previewStats as any).suppliers} POs`}
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* Applying step */}
          {step === "applying" && (
            <div className="py-8 text-center space-y-3">
              {applying ? (
                <>
                  <Loader2 className="w-8 h-8 mx-auto animate-spin text-primary" />
                  <p className="text-sm font-medium">Processing… {appliedCount} / {importMode === "po" ? (previewStats as any).suppliers : rows.length}</p>
                </>
              ) : (
                <>
                  <Check className="w-8 h-8 mx-auto text-green-600" />
                  <p className="text-sm font-medium">Complete!</p>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── Helpers ── */

function findHeader(headers: string[], ...names: string[]): string | undefined {
  for (const n of names) {
    const found = headers.find(h => h === n.toLowerCase());
    if (found) return found;
  }
  // Also check original case via index
  return undefined;
}
