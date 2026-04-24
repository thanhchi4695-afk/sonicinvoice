import { useState, useCallback, useRef } from "react";
import {
  ChevronLeft, Upload, Check, AlertTriangle, FileText, Users,
  Package, Loader2, ArrowRight, CheckCircle, Info, ClipboardCheck,
  ArrowUpDown, Eye, ChevronDown, ChevronUp, Download, Search, Link2,
  ShoppingBag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { addAuditEntry } from "@/lib/audit-log";
import { normaliseVendor } from "@/lib/normalise-vendor";
import Papa from "papaparse";

/* ─── Types ─── */

type WizardStep = "intro" | "suppliers" | "purchase_orders" | "stocktakes" | "adjustments" | "catalog" | "importing" | "summary";

interface ColumnMapping {
  [field: string]: number;
}

interface ParsedCSV {
  headers: string[];
  rows: string[][];
  fileName: string;
}

interface StepConfig {
  id: string;
  label: string;
  icon: React.ElementType;
  requiredFields: { key: string; label: string; aliases: string[] }[];
  optional?: boolean;
}

interface UnmatchedItem {
  sku: string;
  productName: string;
  source: string;
  shopifyVariantId?: string;
}

const STEPS: StepConfig[] = [
  {
    id: "suppliers",
    label: "Suppliers",
    icon: Users,
    requiredFields: [
      { key: "name", label: "Name", aliases: ["supplier", "supplier name", "vendor", "name", "company"] },
      { key: "email", label: "Email", aliases: ["email", "e-mail", "contact email"] },
      { key: "phone", label: "Phone", aliases: ["phone", "telephone", "contact phone", "tel"] },
      { key: "address", label: "Address", aliases: ["address", "street", "location", "full address"] },
      { key: "lead_time", label: "Lead Time (days)", aliases: ["lead time", "lead_time", "lead time days", "delivery days", "lead time (days)"] },
      { key: "payment_terms", label: "Payment Terms", aliases: ["payment terms", "terms", "payment"] },
    ],
    optional: true,
  },
  {
    id: "purchase_orders",
    label: "Purchase Orders",
    icon: FileText,
    requiredFields: [
      { key: "po_number", label: "PO Number", aliases: ["po number", "po #", "po_number", "purchase order", "order number", "po"] },
      { key: "supplier", label: "Supplier", aliases: ["supplier", "vendor", "supplier name", "vendor name"] },
      { key: "order_date", label: "Order Date", aliases: ["ordered", "date ordered", "order date", "created", "date"] },
      { key: "expected_date", label: "Expected Date", aliases: ["expected", "expected date", "eta", "due date", "delivery date"] },
      { key: "status", label: "Status", aliases: ["status", "po status", "order status"] },
      { key: "sku", label: "Product SKU", aliases: ["sku", "variant sku", "item sku", "product sku"] },
      { key: "product", label: "Product Name", aliases: ["product", "product title", "product name", "item", "title"] },
      { key: "quantity", label: "Quantity", aliases: ["qty ordered", "quantity ordered", "ordered qty", "quantity", "qty"] },
      { key: "cost", label: "Cost", aliases: ["cost", "unit cost", "cost price", "wholesale", "price"] },
      { key: "received_qty", label: "Received Quantity", aliases: ["received", "received qty", "received quantity", "qty received"] },
    ],
  },
  {
    id: "stocktakes",
    label: "Stocktakes",
    icon: ClipboardCheck,
    requiredFields: [
      { key: "date", label: "Date", aliases: ["date", "counted at", "count date", "stocktake date"] },
      { key: "location", label: "Location", aliases: ["location", "store", "warehouse", "site"] },
      { key: "sku", label: "SKU", aliases: ["sku", "variant sku", "item sku", "barcode"] },
      { key: "system_qty", label: "System Quantity", aliases: ["system quantity", "system qty", "expected", "expected qty", "system"] },
      { key: "counted_qty", label: "Counted Quantity", aliases: ["counted", "counted qty", "counted quantity", "count", "physical count"] },
      { key: "variance", label: "Variance", aliases: ["variance", "diff", "difference", "discrepancy"] },
    ],
    optional: true,
  },
  {
    id: "adjustments",
    label: "Inventory Adjustments",
    icon: ArrowUpDown,
    requiredFields: [
      { key: "date", label: "Date", aliases: ["date", "adjusted at", "adjustment date", "created"] },
      { key: "sku", label: "SKU", aliases: ["sku", "variant sku", "item sku", "barcode"] },
      { key: "adjustment_qty", label: "Quantity Change", aliases: ["quantity change", "adjustment", "adjustment qty", "quantity", "qty", "change"] },
      { key: "reason", label: "Reason", aliases: ["reason", "type", "adjustment type"] },
      { key: "note", label: "Note", aliases: ["note", "notes", "description", "comment"] },
    ],
    optional: true,
  },
  {
    id: "catalog",
    label: "Products Catalog",
    icon: ShoppingBag,
    requiredFields: [
      { key: "sku", label: "SKU", aliases: ["sku", "variant sku", "item sku"] },
      { key: "product_name", label: "Product Name", aliases: ["product name", "product", "title", "item", "product title"] },
      { key: "brand", label: "Brand", aliases: ["brand", "vendor", "supplier", "manufacturer"] },
      { key: "cost", label: "Cost", aliases: ["cost", "unit cost", "wholesale", "cost price", "price"] },
      { key: "lead_time", label: "Lead Time", aliases: ["lead time", "lead_time", "lead time days", "delivery days"] },
      { key: "reorder_point", label: "Reorder Point", aliases: ["reorder point", "reorder", "min qty", "minimum", "min stock"] },
    ],
    optional: true,
  },
];

/* ─── Helpers ─── */

function autoMapColumns(headers: string[], fields: StepConfig["requiredFields"]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());
  for (const field of fields) {
    const idx = lowerHeaders.findIndex((h) => field.aliases.some((a) => h.includes(a)));
    if (idx >= 0) mapping[field.key] = idx;
  }
  return mapping;
}

function downloadSupplierTemplate() {
  const csv = "Name,Email,Phone,Address,Lead Time (days),Payment Terms\nExample Supplier,supplier@example.com,+61 400 000 000,\"123 Fashion St, Melbourne VIC 3000\",14,Net 30\n";
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "supplier_template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

/* ─── Component ─── */

interface StockyMigrationProps {
  onBack: () => void;
  onComplete?: () => void;
}

export default function StockyMigration({ onBack, onComplete }: StockyMigrationProps) {
  const [step, setStep] = useState<WizardStep>("intro");
  const [currentStepIdx, setCurrentStepIdx] = useState(0);

  const [csvData, setCsvData] = useState<Record<string, ParsedCSV | null>>({
    suppliers: null, purchase_orders: null, stocktakes: null, adjustments: null, catalog: null,
  });
  const [mappings, setMappings] = useState<Record<string, ColumnMapping>>({});
  const [previewOpen, setPreviewOpen] = useState(false);

  // Import state
  const [importProgress, setImportProgress] = useState(0);
  const [importStatus, setImportStatus] = useState("");
  const [importLog, setImportLog] = useState<string[]>([]);
  const [importSummary, setImportSummary] = useState<Record<string, number>>({});
  const [unmatchedItems, setUnmatchedItems] = useState<UnmatchedItem[]>([]);
  const [matchedCount, setMatchedCount] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentStep = STEPS[currentStepIdx];

  /* ─── CSV Upload ─── */
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data as string[][];
        if (rows.length < 2) { toast.error("File has no data rows"); return; }
        const headers = rows[0];
        const dataRows = rows.slice(1);
        const parsed: ParsedCSV = { headers, rows: dataRows, fileName: file.name };
        setCsvData((prev) => ({ ...prev, [currentStep.id]: parsed }));
        const autoMap = autoMapColumns(headers, currentStep.requiredFields);
        setMappings((prev) => ({ ...prev, [currentStep.id]: autoMap }));
        const mapped = Object.keys(autoMap).length;
        const total = currentStep.requiredFields.length;
        if (mapped === total) toast.success(`All ${total} fields auto-mapped`);
        else toast(`Mapped ${mapped}/${total} fields — please review`, { icon: "⚠️" });
      },
      error: () => toast.error("Failed to parse CSV"),
    });
    e.target.value = "";
  }, [currentStep]);

  const updateMapping = (stepId: string, field: string, colIdx: number) => {
    setMappings((prev) => ({ ...prev, [stepId]: { ...prev[stepId], [field]: colIdx } }));
  };

  /* ─── Navigation ─── */
  const goToStep = (idx: number) => { setCurrentStepIdx(idx); setStep(STEPS[idx].id as WizardStep); setPreviewOpen(false); };
  const nextStep = () => { if (currentStepIdx < STEPS.length - 1) goToStep(currentStepIdx + 1); else startImport(); };

  /* ─── Import Logic ─── */
  const startImport = async () => {
    setStep("importing");
    setImportProgress(0);
    setImportStatus("Starting import...");
    setImportLog([]);
    const summary: Record<string, number> = {};
    const allSkus: string[] = [];
    const unmatched: UnmatchedItem[] = [];
    let matched = 0;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Not authenticated"); setStep("intro"); return; }

    const totalSteps = STEPS.filter((s) => csvData[s.id]).length;
    let completedSteps = 0;
    const advance = (label: string) => { completedSteps++; setImportProgress(Math.round((completedSteps / Math.max(totalSteps + 1, 1)) * 100)); setImportStatus(label); };

    try {
      // ── 1. Suppliers ──
      const supplierCsv = csvData.suppliers;
      const supplierMap = mappings.suppliers;
      if (supplierCsv && supplierMap) {
        setImportStatus("Importing suppliers...");
        const suppliersToInsert = supplierCsv.rows
          .map((row) => ({
            user_id: user.id,
            name: (row[supplierMap.name] || "").trim(),
            contact_info: {
              email: (row[supplierMap.email] || "").trim(),
              phone: (row[supplierMap.phone] || "").trim(),
              address: (row[supplierMap.address] || "").trim(),
            },
            notes: [
              supplierMap.lead_time != null ? `Lead time: ${row[supplierMap.lead_time] || "N/A"} days` : "",
              supplierMap.payment_terms != null ? `Terms: ${row[supplierMap.payment_terms] || "N/A"}` : "",
            ].filter(Boolean).join(". ") || null,
          }))
          .filter((s) => s.name.length > 0);

        for (let i = 0; i < suppliersToInsert.length; i += 50) {
          const { error } = await supabase.from("suppliers").insert(suppliersToInsert.slice(i, i + 50));
          if (error) throw new Error(`Suppliers: ${error.message}`);
        }
        summary.suppliers = suppliersToInsert.length;
        setImportLog((prev) => [...prev, `✅ ${suppliersToInsert.length} suppliers imported`]);
        advance("Suppliers done");
      }

      // ── 2. Purchase Orders (with partial receipts, status = "migrated") ──
      const poCsv = csvData.purchase_orders;
      const poMap = mappings.purchase_orders;
      if (poCsv && poMap) {
        setImportStatus("Importing purchase orders...");
        const poGroups = new Map<string, { supplier: string; orderDate: string; expectedDate: string; lines: string[][] }>();

        for (const row of poCsv.rows) {
          const poNum = (row[poMap.po_number] || "").trim();
          if (!poNum) continue;
          if (!poGroups.has(poNum)) {
            poGroups.set(poNum, {
              supplier: (row[poMap.supplier] || "Unknown").trim(),
              orderDate: (row[poMap.order_date] || "").trim(),
              expectedDate: (row[poMap.expected_date] || "").trim(),
              lines: [],
            });
          }
          poGroups.get(poNum)!.lines.push(row);
        }

        let poCount = 0, lineCount = 0;

        for (const [poNum, group] of poGroups) {
          const totalCost = group.lines.reduce((s, row) => {
            const qty = parseFloat(row[poMap.quantity] || "0") || 0;
            const cost = parseFloat((row[poMap.cost] || "0").replace(/[$,]/g, "")) || 0;
            return s + qty * cost;
          }, 0);

          // Determine if partially received
          const hasPartial = group.lines.some((row) => {
            const ordered = parseInt(row[poMap.quantity] || "0") || 0;
            const received = parseInt(row[poMap.received_qty] || "0") || 0;
            return received > 0 && received < ordered;
          });

          const { data: poData, error: poErr } = await supabase
            .from("purchase_orders")
            .insert({
              user_id: user.id,
              po_number: poNum,
              supplier_name: normaliseVendor(group.supplier),
              expected_date: group.expectedDate || null,
              status: "migrated",
              total_cost: totalCost,
              notes: `Imported from Stocky on ${new Date().toLocaleDateString()}${hasPartial ? " (partial receipts)" : ""}`,
            })
            .select("id")
            .single();
          if (poErr) throw new Error(`PO ${poNum}: ${poErr.message}`);
          poCount++;

          const poLines = group.lines.map((row) => {
            const sku = (row[poMap.sku] || "").trim();
            if (sku) allSkus.push(sku);
            return {
              user_id: user.id,
              purchase_order_id: poData.id,
              product_title: (row[poMap.product] || "").trim(),
              sku: sku || null,
              expected_qty: parseInt(row[poMap.quantity] || "0") || 0,
              received_qty: parseInt(row[poMap.received_qty] || "0") || 0,
              expected_cost: parseFloat((row[poMap.cost] || "0").replace(/[$,]/g, "")) || 0,
            };
          });

          if (poLines.length > 0) {
            const { error: lineErr } = await supabase.from("purchase_order_lines").insert(poLines);
            if (lineErr) throw new Error(`PO lines: ${lineErr.message}`);
            lineCount += poLines.length;
          }
        }
        summary.purchase_orders = poCount;
        summary.po_lines = lineCount;
        setImportLog((prev) => [...prev, `✅ ${poCount} POs with ${lineCount} lines imported (status: migrated)`]);
        advance("Purchase orders done");
      }

      // ── 3. Stocktakes (source: stocky_migration, no auto-adjustments) ──
      const stockCsv = csvData.stocktakes;
      const stockMap = mappings.stocktakes;
      if (stockCsv && stockMap) {
        setImportStatus("Importing stocktakes (review required)...");
        const groups = new Map<string, { date: string; location: string; lines: string[][] }>();

        for (const row of stockCsv.rows) {
          const date = (row[stockMap.date] || new Date().toISOString().slice(0, 10)).trim();
          const location = (row[stockMap.location] || "Main Store").trim();
          const key = `${date}|${location}`;
          if (!groups.has(key)) groups.set(key, { date, location, lines: [] });
          groups.get(key)!.lines.push(row);
        }

        let stocktakeCount = 0, lineCount = 0;

        for (const [, group] of groups) {
          const { data: stData, error: stErr } = await supabase
            .from("stocktakes")
            .insert({
              user_id: user.id,
              location: group.location,
              counted_at: group.date,
              status: "draft",
              notes: "Source: stocky_migration — Review before applying adjustments",
            })
            .select("id")
            .single();
          if (stErr) throw new Error(`Stocktake: ${stErr.message}`);
          stocktakeCount++;

          const lines = group.lines.map((row) => {
            const sku = (row[stockMap.sku] || "").trim();
            if (sku) allSkus.push(sku);
            const systemQty = parseInt(row[stockMap.system_qty] || "0") || 0;
            const countedQty = parseInt(row[stockMap.counted_qty] || "0") || 0;
            const variance = stockMap.variance != null
              ? parseInt(row[stockMap.variance] || "0") || 0
              : countedQty - systemQty;
            return {
              user_id: user.id,
              stocktake_id: stData.id,
              sku: sku || null,
              expected_qty: systemQty,
              counted_qty: countedQty,
              variance,
            };
          });

          for (let i = 0; i < lines.length; i += 50) {
            const { error } = await supabase.from("stocktake_lines").insert(lines.slice(i, i + 50));
            if (error) throw new Error(`Stocktake lines: ${error.message}`);
          }
          lineCount += lines.length;
        }
        summary.stocktakes = stocktakeCount;
        summary.stocktake_lines = lineCount;
        setImportLog((prev) => [...prev, `✅ ${stocktakeCount} stocktakes with ${lineCount} lines (status: draft — review required)`]);
        advance("Stocktakes done");
      }

      // ── 4. Inventory Adjustments (source: stocky_migration) ──
      const adjCsv = csvData.adjustments;
      const adjMap = mappings.adjustments;
      if (adjCsv && adjMap) {
        setImportStatus("Importing inventory adjustments...");
        const adjustments = adjCsv.rows
          .map((row) => {
            const sku = (row[adjMap.sku] || "").trim();
            if (sku) allSkus.push(sku);
            const note = adjMap.note != null ? (row[adjMap.note] || "").trim() : "";
            return {
              user_id: user.id,
              sku: sku || null,
              adjustment_qty: parseInt(row[adjMap.adjustment_qty] || "0") || 0,
              reason: `${(row[adjMap.reason] || "").trim()}${note ? ` — ${note}` : ""} [stocky_migration]`,
              adjusted_at: (row[adjMap.date] || new Date().toISOString().slice(0, 10)).trim(),
            };
          })
          .filter((a) => a.sku);

        for (let i = 0; i < adjustments.length; i += 50) {
          const { error } = await supabase.from("inventory_adjustments").insert(adjustments.slice(i, i + 50));
          if (error) throw new Error(`Adjustments: ${error.message}`);
        }
        summary.adjustments = adjustments.length;
        setImportLog((prev) => [...prev, `✅ ${adjustments.length} adjustments imported [stocky_migration]`]);
        advance("Adjustments done");
      }

      // ── 5. Products Catalog ──
      const catCsv = csvData.catalog;
      const catMap = mappings.catalog;
      if (catCsv && catMap) {
        setImportStatus("Importing product catalog...");

        // We need a supplier to link catalog items — use brand or create "Stocky Import"
        const catalogItems = catCsv.rows.map((row) => {
          const sku = (row[catMap.sku] || "").trim();
          if (sku) allSkus.push(sku);
          return {
            sku,
            product_name: (row[catMap.product_name] || "").trim(),
            brand: (row[catMap.brand] || "").trim(),
            cost: parseFloat((row[catMap.cost] || "0").replace(/[$,]/g, "")) || 0,
            lead_time: parseInt(row[catMap.lead_time] || "14") || 14,
            reorder_point: parseInt(row[catMap.reorder_point] || "0") || 0,
          };
        }).filter((c) => c.sku || c.product_name);

        // Group by brand for supplier_catalog_items
        const brandGroups = new Map<string, typeof catalogItems>();
        for (const item of catalogItems) {
          const brand = item.brand || "Stocky Import";
          if (!brandGroups.has(brand)) brandGroups.set(brand, []);
          brandGroups.get(brand)!.push(item);
        }

        let catalogCount = 0;
        for (const [brand, items] of brandGroups) {
          // Find or create supplier
          let supplierId: string;
          const { data: existingSupplier } = await supabase
            .from("suppliers")
            .select("id")
            .eq("user_id", user.id)
            .eq("name", brand)
            .maybeSingle();

          if (existingSupplier) {
            supplierId = existingSupplier.id;
          } else {
            const { data: newSupplier, error: supErr } = await supabase
              .from("suppliers")
              .insert({ user_id: user.id, name: brand, notes: "Auto-created from Stocky catalog import" })
              .select("id")
              .single();
            if (supErr) throw new Error(`Supplier ${brand}: ${supErr.message}`);
            supplierId = newSupplier.id;
          }

          const toInsert = items.map((item) => ({
            user_id: user.id,
            supplier_id: supplierId,
            product_name: item.product_name || item.sku,
            sku: item.sku || null,
            cost: item.cost,
            lead_time_days: item.lead_time,
            min_order_qty: item.reorder_point || 1,
            notes: "Imported from Stocky catalog",
          }));

          for (let i = 0; i < toInsert.length; i += 50) {
            const { error } = await supabase.from("supplier_catalog_items").insert(toInsert.slice(i, i + 50));
            if (error) throw new Error(`Catalog items: ${error.message}`);
          }
          catalogCount += items.length;
        }
        summary.catalog_items = catalogCount;
        setImportLog((prev) => [...prev, `✅ ${catalogCount} catalog items imported`]);
        advance("Catalog done");
      }

      // ── SKU Matching ──
      setImportStatus("Matching SKUs to Shopify variants...");
      const uniqueSkus = [...new Set(allSkus.filter(Boolean))];

      if (uniqueSkus.length > 0) {
        // Batch lookup in chunks of 100
        const matchedSkus = new Set<string>();
        for (let i = 0; i < uniqueSkus.length; i += 100) {
          const chunk = uniqueSkus.slice(i, i + 100);
          const { data: variants } = await supabase
            .from("variants")
            .select("sku")
            .eq("user_id", user.id)
            .in("sku", chunk);
          if (variants) variants.forEach((v) => { if (v.sku) matchedSkus.add(v.sku); });
        }

        matched = matchedSkus.size;
        const unmatchedSkus = uniqueSkus.filter((s) => !matchedSkus.has(s));
        for (const sku of unmatchedSkus) {
          // Find product name from any imported data
          let productName = sku;
          for (const stepId of ["purchase_orders", "catalog", "stocktakes", "adjustments"] as const) {
            const csv = csvData[stepId];
            const map = mappings[stepId];
            if (!csv || !map) continue;
            const skuKey = map.sku ?? map.sku;
            if (skuKey == null) continue;
            const nameKey = (map as any).product ?? (map as any).product_name;
            const row = csv.rows.find((r) => (r[skuKey] || "").trim() === sku);
            if (row && nameKey != null) { productName = (row[nameKey] || sku).trim(); break; }
          }
          unmatched.push({ sku, productName, source: "stocky_migration" });
        }

        summary.matched_skus = matched;
        summary.unmatched_skus = unmatchedSkus.length;
        setImportLog((prev) => [...prev, `🔗 ${matched} SKUs matched to Shopify variants, ${unmatchedSkus.length} unmatched`]);
      }

      // ── Done ──
      setImportProgress(100);
      setImportStatus("Import complete!");
      setImportSummary(summary);
      setUnmatchedItems(unmatched);
      setMatchedCount(matched);
      addAuditEntry("Stocky Migration", `Imported: ${Object.entries(summary).map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`).join(", ")}`);
      setStep("summary");
      toast.success("Stocky migration complete!");
    } catch (err: any) {
      console.error("Import error:", err);
      toast.error(err.message || "Import failed");
      setImportLog((prev) => [...prev, `❌ Error: ${err.message}`]);
      setImportStatus("Import failed — check log for details");
    }
  };

  /* ─── Intro Step ─── */
  if (step === "intro") {
    return (
      <div className="px-4 pt-4 pb-24 animate-fade-in max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
          <div>
            <h2 className="text-lg font-semibold font-display">Stocky Migration Wizard</h2>
            <p className="text-xs text-muted-foreground">Import your Stocky data before it shuts down</p>
          </div>
        </div>

        <Card className="p-6 space-y-6">
          <div className="text-center space-y-3">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <Package className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold">5-Step Import</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Stocky is being sunset on August 31, 2026. Export your CSVs and import them here.
            </p>
          </div>

          <div className="space-y-2">
            {STEPS.map((s, i) => (
              <div key={s.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-bold">{i + 1}</div>
                <div className="flex-1">
                  <p className="text-sm font-medium">{s.label}</p>
                  <p className="text-[10px] text-muted-foreground">{s.requiredFields.map((f) => f.label).join(", ")}</p>
                </div>
                {s.optional && <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Optional</span>}
              </div>
            ))}
          </div>

          {/* Supplier template note */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Info className="w-4 h-4 text-primary" /> Stocky can't export suppliers
            </h4>
            <p className="text-xs text-muted-foreground">
              Download our template CSV, fill in your supplier details manually, then upload it in Step 1.
            </p>
            <Button variant="outline" size="sm" onClick={downloadSupplierTemplate}>
              <Download className="w-3.5 h-3.5 mr-1" /> Download Supplier Template
            </Button>
          </div>

          <div className="bg-muted/50 rounded-lg p-4 space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Info className="w-4 h-4 text-primary" /> How to export from Stocky
            </h4>
            <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Open Stocky in Shopify Admin</li>
              <li>Go to each section (POs, Stocktakes, etc.)</li>
              <li>Click <strong>Export</strong> → CSV</li>
              <li>Upload each CSV in the corresponding step</li>
            </ol>
          </div>

          <Button className="w-full h-12 text-base" onClick={() => goToStep(0)}>
            Start Migration <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </Card>
      </div>
    );
  }

  /* ─── Importing Step ─── */
  if (step === "importing") {
    return (
      <div className="px-4 pt-4 pb-24 animate-fade-in max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-5 h-5" />
          <h2 className="text-lg font-semibold font-display">Importing Data…</h2>
        </div>
        <Card className="p-6 space-y-6">
          <div className="text-center space-y-4">
            <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto" />
            <p className="text-sm font-medium">{importStatus}</p>
            <Progress value={importProgress} className="h-3" />
            <p className="text-xs text-muted-foreground">{importProgress}% complete</p>
          </div>
          {importLog.length > 0 && (
            <div className="bg-muted/30 rounded-lg p-3 space-y-1 max-h-40 overflow-y-auto">
              {importLog.map((entry, i) => <p key={i} className="text-xs font-mono">{entry}</p>)}
            </div>
          )}
        </Card>
      </div>
    );
  }

  /* ─── Summary Step ─── */
  if (step === "summary") {
    return (
      <div className="px-4 pt-4 pb-24 animate-fade-in max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
          <h2 className="text-lg font-semibold font-display">Migration Complete</h2>
        </div>

        <Card className="p-6 space-y-5">
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-3">
              <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
            </div>
            <h3 className="text-lg font-semibold">Everything imported!</h3>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(importSummary).map(([key, val]) => (
              <div key={key} className="bg-muted/50 rounded-lg p-3">
                <p className="text-2xl font-bold text-primary">{val}</p>
                <p className="text-xs text-muted-foreground capitalize">{key.replace(/_/g, " ")}</p>
              </div>
            ))}
          </div>

          {/* SKU Matching Summary */}
          {(matchedCount > 0 || unmatchedItems.length > 0) && (
            <div className="space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Link2 className="w-4 h-4" /> SKU Matching Results
              </h4>
              <div className="flex gap-3">
                <div className="flex-1 bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-green-600 dark:text-green-400">{matchedCount}</p>
                  <p className="text-[10px] text-muted-foreground">Matched to Shopify</p>
                </div>
                <div className="flex-1 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-yellow-600 dark:text-yellow-400">{unmatchedItems.length}</p>
                  <p className="text-[10px] text-muted-foreground">Unmatched</p>
                </div>
              </div>
            </div>
          )}

          {/* Unmatched items list */}
          {unmatchedItems.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-500" /> Unmatched SKUs
              </h4>
              <p className="text-xs text-muted-foreground">
                These SKUs were not found in your Shopify variants. You can manually map them later in the Inventory section.
              </p>
              <div className="bg-muted/30 rounded-lg max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">SKU</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Product</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unmatchedItems.slice(0, 50).map((item) => (
                      <tr key={item.sku} className="border-b border-border/50">
                        <td className="px-3 py-1.5 font-mono">{item.sku}</td>
                        <td className="px-3 py-1.5 truncate max-w-[200px]">{item.productName}</td>
                      </tr>
                    ))}
                    {unmatchedItems.length > 50 && (
                      <tr><td colSpan={2} className="px-3 py-2 text-muted-foreground text-center">…and {unmatchedItems.length - 50} more</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Important notes */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-2">
            <h4 className="text-xs font-semibold">Important notes:</h4>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>Purchase orders imported as <strong>Migrated</strong> — they won't trigger duplicate actions</li>
              <li>Stocktakes imported as <strong>Draft</strong> — review before applying adjustments</li>
              <li>Inventory adjustments tagged with <strong>[stocky_migration]</strong> for traceability</li>
            </ul>
          </div>

          {importLog.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">View import log</summary>
              <div className="bg-muted/30 rounded-lg p-3 mt-2 space-y-1 max-h-40 overflow-y-auto">
                {importLog.map((entry, i) => <p key={i} className="font-mono">{entry}</p>)}
              </div>
            </details>
          )}

          <Button className="w-full" onClick={() => { if (onComplete) onComplete(); else onBack(); }}>
            Go to Dashboard <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </Card>
      </div>
    );
  }

  /* ─── CSV Upload + Column Mapping Step ─── */
  const csv = csvData[currentStep.id];
  const mapping = mappings[currentStep.id] || {};
  const mappedFieldCount = Object.keys(mapping).length;
  const totalFieldCount = currentStep.requiredFields.length;
  const Icon = currentStep.icon;

  return (
    <div className="px-4 pt-4 pb-24 animate-fade-in max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => currentStepIdx > 0 ? goToStep(currentStepIdx - 1) : setStep("intro")} className="text-muted-foreground">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold font-display">Step {currentStepIdx + 1}: {currentStep.label}</h2>
          <p className="text-xs text-muted-foreground">{csv ? `${csv.rows.length} rows from ${csv.fileName}` : "Upload your CSV export"}</p>
        </div>
        {currentStep.optional && <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Optional</span>}
      </div>

      <div className="flex gap-1 mb-4">
        {STEPS.map((s, i) => (
          <button key={s.id} onClick={() => goToStep(i)} className={`flex-1 h-1.5 rounded-full transition-colors ${i < currentStepIdx ? "bg-primary" : i === currentStepIdx ? "bg-primary/60" : "bg-muted"}`} />
        ))}
      </div>

      {!csv ? (
        <Card className="p-6 space-y-4">
          <div className="text-center space-y-3">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <Icon className="w-7 h-7 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground">
              Upload your Stocky <strong>{currentStep.label}</strong> CSV export
            </p>
          </div>

          {currentStep.id === "suppliers" && (
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 text-xs text-blue-700 dark:text-blue-300">
              <p className="font-semibold mb-1">Stocky can't export suppliers</p>
              <p>Use our template to manually create your supplier list, then upload it here.</p>
              <Button variant="outline" size="sm" className="mt-2" onClick={downloadSupplierTemplate}>
                <Download className="w-3.5 h-3.5 mr-1" /> Download Template
              </Button>
            </div>
          )}

          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-xs font-semibold mb-1">Expected columns:</p>
            <div className="flex flex-wrap gap-1">
              {currentStep.requiredFields.map((f) => (
                <span key={f.key} className="text-[10px] px-2 py-0.5 bg-muted rounded-full text-muted-foreground">{f.label}</span>
              ))}
            </div>
          </div>

          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFileUpload} />
          <Button className="w-full h-12" onClick={() => fileInputRef.current?.click()}>
            <Upload className="w-5 h-5 mr-2" /> Upload CSV
          </Button>

          {currentStep.optional && (
            <Button variant="ghost" className="w-full text-muted-foreground" onClick={nextStep}>
              Skip this step <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          )}
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Column Mapping</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full ${mappedFieldCount === totalFieldCount ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"}`}>
                {mappedFieldCount}/{totalFieldCount} mapped
              </span>
            </div>
            <div className="space-y-2">
              {currentStep.requiredFields.map((field) => (
                <div key={field.key} className="flex items-center gap-3">
                  <label className="text-xs font-medium w-32 shrink-0 truncate">{field.label}</label>
                  <div className="flex items-center gap-1 flex-1">
                    {mapping[field.key] != null ? <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 shrink-0" />}
                    <select
                      className="flex-1 h-8 text-xs rounded-md border border-input bg-background px-2"
                      value={mapping[field.key] ?? -1}
                      onChange={(e) => updateMapping(currentStep.id, field.key, parseInt(e.target.value))}
                    >
                      <option value={-1}>— Select column —</option>
                      {csv.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <button onClick={() => setPreviewOpen(!previewOpen)} className="flex items-center justify-between w-full text-sm font-semibold">
              <span className="flex items-center gap-2"><Eye className="w-4 h-4" /> Preview ({Math.min(csv.rows.length, 5)} rows)</span>
              {previewOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {previewOpen && (
              <div className="mt-3 overflow-x-auto">
                <table className="text-xs w-full border-collapse">
                  <thead>
                    <tr>{currentStep.requiredFields.map((f) => <th key={f.key} className="text-left px-2 py-1 border-b border-border font-medium text-muted-foreground">{f.label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {csv.rows.slice(0, 5).map((row, ri) => (
                      <tr key={ri}>
                        {currentStep.requiredFields.map((f) => (
                          <td key={f.key} className="px-2 py-1 border-b border-border/50 truncate max-w-[150px]">
                            {mapping[f.key] != null ? row[mapping[f.key]] || "—" : <span className="text-muted-foreground">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => {
              setCsvData((prev) => ({ ...prev, [currentStep.id]: null }));
              setMappings((prev) => { const next = { ...prev }; delete next[currentStep.id]; return next; });
            }}>Re-upload</Button>
            <Button className="flex-1" onClick={nextStep}>
              {currentStepIdx < STEPS.length - 1 ? <>Next Step <ArrowRight className="w-4 h-4 ml-1" /></> : <>Import All Data <Check className="w-4 h-4 ml-1" /></>}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
