// Settings card: pin which Claude model the invoice parser uses for Stage 1.
import { useEffect, useState } from "react";
import {
  INVOICE_PARSER_MODELS,
  getInvoiceParserModel,
  setInvoiceParserModel,
  type InvoiceParserModelId,
} from "@/lib/invoice-parser-model";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function InvoiceParserModelSetting() {
  const [model, setModel] = useState<InvoiceParserModelId>("claude-sonnet-4-5-20250929");
  useEffect(() => {
    setModel(getInvoiceParserModel());
  }, []);

  const current = INVOICE_PARSER_MODELS.find((m) => m.id === model);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="space-y-3">
        <div>
          <Label className="text-sm font-medium">Invoice parser AI model</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pinned model used by the Claude PDF extraction stage for invoices.
          </p>
        </div>
        <Select
          value={model}
          onValueChange={(value) => {
            const next = value as InvoiceParserModelId;
            setModel(next);
            setInvoiceParserModel(next);
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INVOICE_PARSER_MODELS.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {current && (
          <p className="text-xs text-muted-foreground">{current.description}</p>
        )}
      </div>
    </div>
  );
}
