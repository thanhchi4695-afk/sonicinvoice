import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Link, Sparkles, X, ChevronRight, Clipboard } from "lucide-react";
import { detectFromUrl, detectFromText, detectFromFile, type ContextResult, type ContextAction } from "@/lib/context-engine";
import { toast } from "sonner";

interface ContextDetectorProps {
  onStartFlow: (flow: string) => void;
}

export default function ContextDetector({ onStartFlow }: ContextDetectorProps) {
  const [pastedUrl, setPastedUrl] = useState("");
  const [result, setResult] = useState<ContextResult | null>(null);
  const [showInput, setShowInput] = useState(false);

  const handlePaste = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    // Detect if it's a URL or text
    const isUrl = /^https?:\/\//.test(trimmed) || /\.(com|com\.au|co|io|net)/.test(trimmed);
    const detected = isUrl ? detectFromUrl(trimmed) : detectFromText(trimmed);

    if (detected.confidence > 0) {
      setResult(detected);
    } else {
      toast.info("Couldn't detect a platform — try uploading a file instead");
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handlePaste(pastedUrl);
  };

  const handleClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setPastedUrl(text);
        handlePaste(text);
      }
    } catch {
      toast.error("Clipboard access denied");
    }
  };

  if (result && result.confidence > 0) {
    return (
      <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">{result.highlight_message}</p>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary" className="text-[10px]">{result.platform_detected}</Badge>
                {result.supplier_name && (
                  <span className="text-[11px] text-muted-foreground">{result.supplier_name}</span>
                )}
                <span className="text-[10px] text-muted-foreground">{result.confidence}% confidence</span>
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { setResult(null); setPastedUrl(""); }}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {result.recommended_actions.slice(0, 4).map((action, i) => (
            <button
              key={i}
              onClick={() => onStartFlow(action.flow)}
              className="flex items-center gap-2 p-2.5 rounded-lg border border-border bg-background hover:bg-accent/50 transition-colors text-left group"
            >
              <span className="text-lg">{action.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{action.label}</p>
                <p className="text-[10px] text-muted-foreground truncate">{action.description}</p>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (!showInput) {
    return (
      <button
        onClick={() => setShowInput(true)}
        className="w-full flex items-center gap-2 p-3 rounded-xl border border-dashed border-border hover:border-primary/40 hover:bg-primary/5 transition-colors group"
      >
        <Link className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
        <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
          Paste a supplier URL, email, or Drive link for smart suggestions…
        </span>
      </button>
    );
  }

  return (
    <div className="flex gap-2">
      <div className="flex-1 relative">
        <Input
          placeholder="Paste URL, email text, or Drive link…"
          value={pastedUrl}
          onChange={(e) => setPastedUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          className="pr-9 text-xs h-9"
        />
        <button
          onClick={handleClipboard}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          title="Paste from clipboard"
        >
          <Clipboard className="w-3.5 h-3.5" />
        </button>
      </div>
      <Button size="sm" className="h-9" onClick={() => handlePaste(pastedUrl)} disabled={!pastedUrl.trim()}>
        Detect
      </Button>
      <Button variant="ghost" size="sm" className="h-9 px-2" onClick={() => { setShowInput(false); setPastedUrl(""); }}>
        <X className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}
