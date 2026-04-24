import { useState, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Settings, Save, Zap } from "lucide-react";
import { autoDetectMappings, type ColumnMappings, type RegexPatterns } from "@/lib/rule-based-extractor";
import { normaliseVendor } from "@/lib/normalise-vendor";

interface SupplierTemplateTeachProps {
  open: boolean;
  onClose: () => void;
  supplierName: string;
  /** Column headers detected from the uploaded file */
  detectedHeaders: string[];
  /** Sample extracted products so user can see what mapped where */
  sampleProducts: Array<{ name: string; sku: string; colour: string; size: string; qty: number; cost: number; rrp: number }>;
}

const FIELD_LABELS: Record<keyof ColumnMappings, string> = {
  product_name: "Product Name",
  sku: "SKU / Style No.",
  barcode: "Barcode / EAN",
  colour: "Colour",
  size: "Size",
  quantity: "Quantity",
  cost: "Cost Price",
  rrp: "RRP / Retail",
  brand: "Brand",
  type: "Category / Type",
};

const SupplierTemplateTeach = ({ open, onClose, supplierName, detectedHeaders, sampleProducts }: SupplierTemplateTeachProps) => {
  const [mappings, setMappings] = useState<ColumnMappings>({});
  const [regexPatterns, setRegexPatterns] = useState<RegexPatterns>({});
  const [headerRow, setHeaderRow] = useState(1);
  const [saving, setSaving] = useState(false);

  // Auto-detect on open
  useEffect(() => {
    if (open && detectedHeaders.length > 0) {
      setMappings(autoDetectMappings(detectedHeaders));
    }
  }, [open, detectedHeaders]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session) {
        toast.error("Please log in to save templates");
        return;
      }

      const { error } = await supabase.from("supplier_templates" as any).upsert({
        user_id: session.session.user.id,
        supplier_name: normaliseVendor(supplierName),
        column_mappings: mappings,
        regex_patterns: regexPatterns,
        header_row: headerRow,
        file_type: "csv",
        notes: "",
        success_count: 0,
        error_count: 0,
      } as any, { onConflict: "user_id,supplier_name" });

      if (error) throw error;
      toast.success(`Template saved for ${supplierName}`, { description: "Future invoices will use rule-based extraction — no AI needed!" });
      onClose();
    } catch (err: any) {
      toast.error("Failed to save template", { description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const updateMapping = (field: keyof ColumnMappings, value: string) => {
    setMappings(prev => ({ ...prev, [field]: value || undefined }));
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-primary" />
            Teach AI: {supplierName}
          </DialogTitle>
          <DialogDescription>
            Map this supplier's columns so future invoices are extracted instantly without AI.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Header row */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Header row number</label>
            <input
              type="number"
              min={1}
              max={20}
              value={headerRow}
              onChange={e => setHeaderRow(parseInt(e.target.value) || 1)}
              className="w-20 h-8 rounded-md border border-border bg-input px-2 text-sm ml-2"
            />
          </div>

          {/* Column mappings */}
          <div>
            <h4 className="text-sm font-semibold mb-2">Column Mappings</h4>
            <p className="text-xs text-muted-foreground mb-3">Select which column in the invoice maps to each field.</p>
            <div className="space-y-2">
              {(Object.entries(FIELD_LABELS) as [keyof ColumnMappings, string][]).map(([field, label]) => (
                <div key={field} className="flex items-center gap-2">
                  <span className="text-xs w-28 text-muted-foreground">{label}</span>
                  <select
                    value={mappings[field] || ""}
                    onChange={e => updateMapping(field, e.target.value)}
                    className="flex-1 h-8 rounded-md border border-border bg-input px-2 text-sm"
                  >
                    <option value="">— Not mapped —</option>
                    {detectedHeaders.map(h => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* Regex patterns */}
          <div>
            <h4 className="text-sm font-semibold mb-2">Optional: Regex Patterns</h4>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-muted-foreground">Skip rows matching (noise filter)</label>
                <input
                  value={regexPatterns.skip_row_pattern || ""}
                  onChange={e => setRegexPatterns(prev => ({ ...prev, skip_row_pattern: e.target.value }))}
                  placeholder="e.g. ^(total|subtotal|gst|freight)"
                  className="w-full h-8 rounded-md border border-border bg-input px-2 text-xs mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">SKU pattern (validate)</label>
                <input
                  value={regexPatterns.sku_pattern || ""}
                  onChange={e => setRegexPatterns(prev => ({ ...prev, sku_pattern: e.target.value }))}
                  placeholder="e.g. ^[A-Z]{2,4}-\\d{3,6}"
                  className="w-full h-8 rounded-md border border-border bg-input px-2 text-xs mt-1"
                />
              </div>
            </div>
          </div>

          {/* Preview */}
          {sampleProducts.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2">Preview ({sampleProducts.length} products)</h4>
              <div className="max-h-40 overflow-y-auto border border-border rounded-md">
                <table className="w-full text-xs">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-2 py-1 text-left">Name</th>
                      <th className="px-2 py-1 text-left">SKU</th>
                      <th className="px-2 py-1 text-right">Qty</th>
                      <th className="px-2 py-1 text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sampleProducts.slice(0, 5).map((p, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-2 py-1 truncate max-w-[150px]">{p.name}</td>
                        <td className="px-2 py-1">{p.sku}</td>
                        <td className="px-2 py-1 text-right">{p.qty}</td>
                        <td className="px-2 py-1 text-right">${p.cost.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !mappings.product_name}>
            {saving ? <Zap className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SupplierTemplateTeach;
