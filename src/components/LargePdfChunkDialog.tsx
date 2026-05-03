import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { FileText, Scissors, FastForward, AlertTriangle } from "lucide-react";

export type LargePdfChoice = "split" | "first_page" | "continue" | "cancel";

interface Props {
  open: boolean;
  fileName: string;
  fileSizeBytes: number;
  pageCount: number | null;
  onChoose: (choice: LargePdfChoice, rememberDefault: boolean) => void;
}

export function LargePdfChunkDialog({ open, fileName, fileSizeBytes, pageCount, onChoose }: Props) {
  const [remember, setRemember] = useState(false);
  useEffect(() => { if (open) setRemember(false); }, [open]);

  const sizeMb = (fileSizeBytes / 1024 / 1024).toFixed(1);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onChoose("cancel", false); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Large PDF detected
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono text-xs">{fileName}</span> is {sizeMb} MB
            {pageCount ? ` (${pageCount} page${pageCount === 1 ? "" : "s"})` : ""}.
            Files this big often time out the 150 s extraction limit. Choose how
            you'd like to proceed:
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <button
            type="button"
            onClick={() => onChoose("split", remember)}
            className="w-full text-left rounded-md border border-border p-3 hover:bg-muted transition-colors flex items-start gap-3"
          >
            <Scissors className="w-4 h-4 mt-0.5 text-primary shrink-0" />
            <div>
              <div className="text-sm font-medium">Split into pages (recommended)</div>
              <div className="text-xs text-muted-foreground">
                Auto-split the PDF page-by-page, parse each, then merge results.
                Slower but reliable.
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onChoose("first_page", remember)}
            className="w-full text-left rounded-md border border-border p-3 hover:bg-muted transition-colors flex items-start gap-3"
          >
            <FileText className="w-4 h-4 mt-0.5 text-primary shrink-0" />
            <div>
              <div className="text-sm font-medium">Invoice page only (fastest)</div>
              <div className="text-xs text-muted-foreground">
                Just extract page 1. Best for forwarded emails where the rest is
                signatures/disclaimers.
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onChoose("continue", remember)}
            className="w-full text-left rounded-md border border-border p-3 hover:bg-muted transition-colors flex items-start gap-3"
          >
            <FastForward className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <div className="text-sm font-medium">Continue as-is</div>
              <div className="text-xs text-muted-foreground">
                Send the full PDF in one pass. May time out on large files.
              </div>
            </div>
          </button>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Switch id="remember-pdf-choice" checked={remember} onCheckedChange={setRemember} />
          <Label htmlFor="remember-pdf-choice" className="text-xs text-muted-foreground">
            Remember my choice for future large PDFs
          </Label>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onChoose("cancel", false)}>
            Cancel upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const KEY = "large_pdf_default_choice_v1";
export function getLargePdfDefault(): LargePdfChoice | null {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "split" || v === "first_page" || v === "continue") return v;
    return null;
  } catch { return null; }
}
export function setLargePdfDefault(choice: LargePdfChoice | null) {
  try {
    if (!choice || choice === "cancel") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch { /* ignore */ }
}
