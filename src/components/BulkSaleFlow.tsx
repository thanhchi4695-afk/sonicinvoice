import { useState } from "react";
import { Upload, ChevronLeft, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BulkSaleFlowProps {
  onBack: () => void;
}

const BulkSaleFlow = ({ onBack }: BulkSaleFlowProps) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [direction, setDirection] = useState<"apply" | "end">("apply");
  const [discount, setDiscount] = useState(20);

  const mockTags = ["Baku", "Seafolly", "Bikini Tops", "Mar26", "Dec24", "underwire", "One Pieces", "Jantzen", "plus size", "new arrivals"];

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  };

  const selectedCount = selectedTags.length * 5; // mock product count

  return (
    <div className="min-h-screen pb-24 animate-fade-in">
      <div className="sticky top-0 z-40 bg-background border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-muted-foreground">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h2 className="text-lg font-semibold font-display">Bulk sale pricing</h2>
        </div>
      </div>

      {step === 1 && (
        <div className="px-4 pt-6">
          <button
            onClick={() => setStep(2)}
            className="w-full h-48 rounded-lg border-2 border-dashed border-border bg-card flex flex-col items-center justify-center gap-3 active:bg-muted"
          >
            <div className="w-14 h-14 rounded-full bg-secondary/10 flex items-center justify-center">
              <Upload className="w-6 h-6 text-secondary" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">Upload Shopify product export</p>
              <p className="text-xs text-muted-foreground mt-1">CSV or Excel</p>
            </div>
          </button>
          <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
            Export from Shopify Admin → Products → Export → CSV for Excel
          </p>
        </div>
      )}

      {step === 2 && (
        <div className="px-4 pt-4">
          <p className="text-sm text-muted-foreground mb-3">Select tags to filter products:</p>
          <div className="flex flex-wrap gap-2 mb-4">
            {mockTags.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  selectedTags.includes(tag)
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>

          {selectedCount > 0 && (
            <p className="text-sm font-medium text-primary mb-4">{selectedCount} products selected</p>
          )}

          <div className="space-y-3 mb-4">
            <div className="flex gap-2">
              <button
                onClick={() => setDirection("apply")}
                className={`flex-1 h-11 rounded-lg text-sm font-medium transition-colors ${
                  direction === "apply" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
              >
                Apply sale
              </button>
              <button
                onClick={() => setDirection("end")}
                className={`flex-1 h-11 rounded-lg text-sm font-medium transition-colors ${
                  direction === "end" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
              >
                End sale
              </button>
            </div>
          </div>

          {direction === "apply" && (
            <div className="mb-6">
              <label className="text-sm text-muted-foreground mb-2 block">Discount</label>
              <div className="flex gap-2 mb-3">
                {[10, 20, 25, 30, 50].map((pct) => (
                  <button
                    key={pct}
                    onClick={() => setDiscount(pct)}
                    className={`flex-1 h-10 rounded-lg text-sm font-medium font-mono-data transition-colors ${
                      discount === pct ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {pct}%
                  </button>
                ))}
              </div>

              {/* Preview table */}
              {selectedCount > 0 && (
                <div className="bg-card rounded-lg border border-border overflow-hidden">
                  <div className="px-3 py-2 border-b border-border">
                    <p className="text-xs font-medium text-muted-foreground">Preview</p>
                  </div>
                  <div className="divide-y divide-border">
                    {[
                      { name: "Baku Riviera One Piece", price: 189.95 },
                      { name: "Seafolly Active Top", price: 109.95 },
                      { name: "Baku Collective Pant", price: 89.95 },
                    ].map((p, i) => {
                      const newPrice = Math.round(p.price * (1 - discount / 100) * 100) / 100;
                      return (
                        <div key={i} className="px-3 py-2 flex items-center text-xs">
                          <span className="flex-1 truncate">{p.name}</span>
                          <span className="text-muted-foreground font-mono-data w-16 text-right">${p.price}</span>
                          <span className="text-muted-foreground mx-2">→</span>
                          <span className="text-primary font-mono-data font-semibold w-16 text-right">${newPrice.toFixed(2)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          <Button variant="amber" className="w-full h-12 text-base" disabled={selectedCount === 0}>
            <Download className="w-4 h-4 mr-2" /> Download updated file
          </Button>
        </div>
      )}
    </div>
  );
};

export default BulkSaleFlow;
