// Toggle card for the Brain Mode 5-stage pipeline.
// Default OFF — surfaced in the Custom Requirements panel of InvoiceFlow.
import { Brain } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useEffect, useState } from "react";
import { isBrainModeEnabled, setBrainModeEnabled } from "@/lib/brain-pipeline";

export function BrainModeToggle() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => { setEnabled(isBrainModeEnabled()); }, []);

  const handleChange = (next: boolean) => {
    setEnabled(next);
    setBrainModeEnabled(next);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 mt-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 flex-1 min-w-0">
          <Brain className="w-5 h-5 text-primary mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              Brain Mode <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/15 text-primary ml-1">Beta</span>
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              5-stage human-style pipeline: Orientation → Layout → Context → Extract → Validate.
              Slower (2 extra AI calls on first invoice from a supplier) but much more accurate.
              Recognised suppliers skip stages 1-2 automatically.
            </p>
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={handleChange} aria-label="Toggle Brain Mode" />
      </div>
    </div>
  );
}
