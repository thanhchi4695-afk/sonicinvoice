// ──────────────────────────────────────────────────────────────
// Teach Sonic Wizard
// Shown when the universal classifier confidence is < 60%.
// User points the AI to the supplier name, product name, price,
// quantity, and GST treatment. The captured column_map is saved
// straight into the supplier brain so this never repeats.
// ──────────────────────────────────────────────────────────────
import { useState } from "react";
import { Sparkles, ChevronRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import type { InvoicePattern } from "@/lib/universal-classifier";

interface Props {
  initialSupplier?: string;
  onCancel: () => void;
  onComplete: (template: {
    supplier_name: string;
    detected_pattern: InvoicePattern;
    column_map: Record<string, string>;
    gst_treatment: "inc" | "ex" | "nz_inc";
    has_rrp: boolean;
  }) => void;
}

const STEPS = [
  { key: "supplier", label: "Supplier" },
  { key: "product",  label: "Product name column" },
  { key: "price",    label: "Price column" },
  { key: "gst",      label: "GST treatment" },
  { key: "qty",      label: "Quantity column" },
  { key: "review",   label: "Review" },
] as const;

export default function TeachSonicWizard({ initialSupplier = "", onCancel, onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [supplier, setSupplier] = useState(initialSupplier);
  const [productCol, setProductCol] = useState("");
  const [priceCol, setPriceCol] = useState("");
  const [qtyCol, setQtyCol] = useState("");
  const [gst, setGst] = useState<"inc" | "ex" | "nz_inc">("ex");
  const [hasRrp, setHasRrp] = useState(false);

  const next = () => setStep(s => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep(s => Math.max(s - 1, 0));

  const finish = () => {
    onComplete({
      supplier_name: supplier.trim(),
      detected_pattern: "A",
      column_map: {
        [productCol.trim()]: "product_name",
        [priceCol.trim()]: gst === "inc" ? "cost_inc_gst" : "cost_ex_gst",
        [qtyCol.trim()]: "quantity",
      },
      gst_treatment: gst,
      has_rrp: hasRrp,
    });
  };

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-4">
      <div className="flex items-start gap-2.5">
        <Sparkles className="w-5 h-5 text-primary mt-0.5" />
        <div>
          <p className="text-sm font-semibold">Teach Sonic Invoice your supplier's format</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            We couldn't confidently recognise this layout. Answer 5 quick questions and we'll
            remember it forever.
          </p>
        </div>
      </div>

      {/* Stepper */}
      <ol className="flex items-center gap-1 text-[10px] text-muted-foreground">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex items-center gap-1">
            <span className={`px-2 py-0.5 rounded-full ${i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-primary/20 text-primary" : "bg-muted"}`}>
              {i < step ? <Check className="w-3 h-3 inline" /> : i + 1}
            </span>
            {i < STEPS.length - 1 && <ChevronRight className="w-3 h-3" />}
          </li>
        ))}
      </ol>

      {/* Step body */}
      <div className="space-y-2">
        {step === 0 && (
          <>
            <Label className="text-xs">What is the supplier name?</Label>
            <Input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="e.g. Seafolly Australia" autoFocus />
          </>
        )}
        {step === 1 && (
          <>
            <Label className="text-xs">Type the column header that contains the product name</Label>
            <Input value={productCol} onChange={e => setProductCol(e.target.value)} placeholder="e.g. Description" autoFocus />
          </>
        )}
        {step === 2 && (
          <>
            <Label className="text-xs">Type the column header that contains the wholesale price</Label>
            <Input value={priceCol} onChange={e => setPriceCol(e.target.value)} placeholder="e.g. Unit Price" autoFocus />
            <label className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
              <input type="checkbox" checked={hasRrp} onChange={e => setHasRrp(e.target.checked)} />
              This invoice also shows RRP
            </label>
          </>
        )}
        {step === 3 && (
          <>
            <Label className="text-xs">Is the price including or excluding GST?</Label>
            <RadioGroup value={gst} onValueChange={(v) => setGst(v as typeof gst)} className="mt-1">
              <label className="flex items-center gap-2 text-xs">
                <RadioGroupItem value="ex" /> Excluding GST (10% added at total)
              </label>
              <label className="flex items-center gap-2 text-xs">
                <RadioGroupItem value="inc" /> Including GST
              </label>
              <label className="flex items-center gap-2 text-xs">
                <RadioGroupItem value="nz_inc" /> NZ supplier (15% GST included)
              </label>
            </RadioGroup>
          </>
        )}
        {step === 4 && (
          <>
            <Label className="text-xs">Type the column header that contains quantity</Label>
            <Input value={qtyCol} onChange={e => setQtyCol(e.target.value)} placeholder="e.g. Qty" autoFocus />
          </>
        )}
        {step === 5 && (
          <div className="text-xs space-y-1.5 bg-background/50 rounded-md p-3 border border-border">
            <div><span className="text-muted-foreground">Supplier:</span> <strong>{supplier}</strong></div>
            <div><span className="text-muted-foreground">Product column:</span> <strong>{productCol}</strong></div>
            <div><span className="text-muted-foreground">Price column:</span> <strong>{priceCol}</strong> ({gst})</div>
            <div><span className="text-muted-foreground">Quantity column:</span> <strong>{qtyCol}</strong></div>
            <div><span className="text-muted-foreground">RRP shown:</span> <strong>{hasRrp ? "yes" : "no"}</strong></div>
          </div>
        )}
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="ghost" size="sm" onClick={step === 0 ? onCancel : back}>
          {step === 0 ? "Cancel" : "Back"}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button size="sm" onClick={next} disabled={
            (step === 0 && !supplier.trim()) ||
            (step === 1 && !productCol.trim()) ||
            (step === 2 && !priceCol.trim()) ||
            (step === 4 && !qtyCol.trim())
          }>
            Next
          </Button>
        ) : (
          <Button size="sm" onClick={finish}>Save template</Button>
        )}
      </div>
    </div>
  );
}
