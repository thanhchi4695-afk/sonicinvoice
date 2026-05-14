import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkle, X, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const BANNER_DISMISS_KEY = "claude_banner_dismissed";

/** Returns whether the current user has at least one active Claude MCP token. */
export function useClaudeConnected() {
  const [connected, setConnected] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { count } = await supabase
        .from("sonic_mcp_tokens")
        .select("id", { count: "exact", head: true })
        .is("revoked_at", null);
      if (!cancelled) setConnected((count ?? 0) > 0);
    })();
    return () => { cancelled = true; };
  }, []);
  return connected;
}

/** Top-of-dashboard banner inviting the user to connect Claude. */
export function ClaudeConnectBanner() {
  const navigate = useNavigate();
  const connected = useClaudeConnected();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(BANNER_DISMISS_KEY) === "true"; } catch { return false; }
  });

  if (dismissed || connected !== false) return null;

  const dismiss = () => {
    try { localStorage.setItem(BANNER_DISMISS_KEY, "true"); } catch {}
    setDismissed(true);
  };

  return (
    <div className="relative mx-4 mt-4 rounded-lg border border-purple-500/30 bg-gradient-to-r from-purple-600/15 via-purple-500/10 to-fuchsia-500/15 px-4 py-3 flex items-center gap-3">
      <div className="h-9 w-9 shrink-0 rounded-md bg-purple-500/20 flex items-center justify-center">
        <Sparkle className="h-4 w-4 text-purple-300" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-foreground">Connect Claude AI to your store</div>
        <div className="text-xs text-muted-foreground truncate">
          Ask natural-language questions about your collections, gaps, and brands — answered with your real store data.
        </div>
      </div>
      <Button
        size="sm"
        className="bg-purple-600 hover:bg-purple-500 text-white shrink-0"
        onClick={() => navigate("/settings/claude-connector")}
      >
        Connect Claude
      </Button>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 shrink-0"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

interface ClaudeEmptyStateProps {
  heading: string;
  subheading?: string;
  prompts: string[];
}

/** Reusable Claude-forward empty state with copyable prompt chips. */
export function ClaudeEmptyState({ heading, subheading, prompts }: ClaudeEmptyStateProps) {
  const navigate = useNavigate();
  const connected = useClaudeConnected();
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const copy = async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      toast.success("Prompt copied");
      setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1500);
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  return (
    <Card>
      <CardContent className="py-12 flex flex-col items-center text-center gap-4">
        <div className="h-14 w-14 rounded-full bg-purple-500/15 flex items-center justify-center">
          <Sparkle className="h-7 w-7 text-purple-300" />
        </div>
        <div>
          <div className="text-lg font-semibold font-display">{heading}</div>
          {subheading && (
            <div className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">{subheading}</div>
          )}
        </div>
        <div className="flex flex-wrap justify-center gap-2 max-w-2xl">
          {prompts.map((p, i) => (
            <button
              key={i}
              onClick={() => copy(p, i)}
              className="group inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border border-purple-500/30 bg-purple-500/10 text-foreground hover:bg-purple-500/20 transition-colors"
              title="Click to copy"
            >
              {copiedIdx === i ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3 text-purple-300" />}
              <span className="text-left">"{p}"</span>
            </button>
          ))}
        </div>
        <Button
          className="bg-purple-600 hover:bg-purple-500 text-white"
          onClick={() => navigate("/settings/claude-connector")}
        >
          <Sparkle className="mr-2 h-4 w-4" />
          {connected ? "Open Claude settings" : "Connect Claude to find gaps"}
        </Button>
      </CardContent>
    </Card>
  );
}
