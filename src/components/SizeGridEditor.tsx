import { useState } from "react";
import { AlertTriangle, Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface SizeQty {
  size: string;
  qty: number;
  confidence?: "high" | "medium" | "low";
  handwritten?: boolean;
}

interface SizeGridEditorProps {
  /** Current variants with size/qty data */
  sizes: SizeQty[];
  /** Style code or product name for context */
  label?: string;
  unitCost?: number;
  currencySymbol?: string;
  /** Called when user edits any quantity or adds/removes a size */
  onChange: (updated: SizeQty[]) => void;
  readOnly?: boolean;
}

export default function SizeGridEditor({
  sizes,
  label,
  unitCost,
  currencySymbol = "$",
  onChange,
  readOnly = false,
}: SizeGridEditorProps) {
  const [addingSize, setAddingSize] = useState(false);
  const [newSize, setNewSize] = useState("");

  const totalQty = sizes.reduce((s, v) => s + v.qty, 0);
  const hasUncertain = sizes.some(s => s.confidence === "low" || s.handwritten);

  const updateQty = (idx: number, qty: number) => {
    const updated = sizes.map((s, i) => (i === idx ? { ...s, qty: Math.max(0, qty) } : s));
    onChange(updated);
  };

  const removeSize = (idx: number) => {
    onChange(sizes.filter((_, i) => i !== idx));
  };

  const addSize = () => {
    if (!newSize.trim()) return;
    onChange([...sizes, { size: newSize.trim(), qty: 0, confidence: "high" }]);
    setNewSize("");
    setAddingSize(false);
  };

  return (
    <div className="rounded-lg border border-border bg-muted/10 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border/50">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-foreground uppercase tracking-wide">Size Grid</span>
          {label && <span className="text-[10px] text-muted-foreground">— {label}</span>}
          {hasUncertain && (
            <Badge variant="outline" className="text-[8px] px-1 py-0 h-4 border-warning/40 text-warning gap-0.5">
              <AlertTriangle className="w-2.5 h-2.5" /> Handwritten
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-muted-foreground">Total:</span>
          <span className="font-bold text-foreground font-mono">{totalQty}</span>
          {unitCost != null && unitCost > 0 && (
            <span className="text-muted-foreground ml-1">
              ({currencySymbol}{(totalQty * unitCost).toFixed(2)})
            </span>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="px-3 py-2">
        <div className="flex flex-wrap gap-1.5">
          {sizes.map((s, i) => (
            <div
              key={i}
              className={`relative flex flex-col items-center rounded-lg border px-2.5 py-1.5 min-w-[52px] transition-colors ${
                s.confidence === "low" || s.handwritten
                  ? "border-warning/40 bg-warning/5"
                  : s.qty > 0
                  ? "border-primary/30 bg-primary/5"
                  : "border-border bg-background"
              }`}
            >
              {/* Size label */}
              <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                {s.size}
              </span>

              {/* Quantity input */}
              {readOnly ? (
                <span className="text-sm font-bold font-mono text-foreground">{s.qty}</span>
              ) : (
                <input
                  type="number"
                  min={0}
                  value={s.qty}
                  onChange={e => updateQty(i, parseInt(e.target.value) || 0)}
                  className="w-10 h-6 text-center text-sm font-bold font-mono bg-transparent border-0 border-b border-border/50 focus:border-primary focus:outline-none text-foreground [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              )}

              {/* Confidence indicator */}
              {s.confidence === "low" && (
                <span className="text-[7px] text-warning mt-0.5">uncertain</span>
              )}
              {s.handwritten && s.confidence !== "low" && (
                <span className="text-[7px] text-warning/70 mt-0.5">handwritten</span>
              )}

              {/* Remove button */}
              {!readOnly && (
                <button
                  onClick={() => removeSize(i)}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-destructive/80 text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 hover:!opacity-100 transition-opacity"
                  title="Remove size"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          ))}

          {/* Add size button */}
          {!readOnly && (
            addingSize ? (
              <div className="flex items-end gap-1">
                <div className="flex flex-col items-center">
                  <Input
                    value={newSize}
                    onChange={e => setNewSize(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && addSize()}
                    placeholder="XL"
                    className="w-14 h-6 text-center text-[10px] px-1"
                    autoFocus
                  />
                </div>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={addSize}>
                  <Check className="w-3 h-3 text-success" />
                </Button>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { setAddingSize(false); setNewSize(""); }}>
                  <X className="w-3 h-3 text-muted-foreground" />
                </Button>
              </div>
            ) : (
              <button
                onClick={() => setAddingSize(true)}
                className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-2.5 py-1.5 min-w-[52px] hover:border-primary/50 hover:bg-primary/5 transition-colors"
              >
                <Plus className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[8px] text-muted-foreground mt-0.5">Add</span>
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
