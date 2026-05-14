// Floating Claude Custom App button — opens a popup dialog with connector info.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkle, X, ExternalLink, Copy, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const SAMPLE_PROMPTS = [
  "Which collections need SEO content?",
  "Show me low-stock styles this week",
  "Which brands are underperforming?",
];

export default function ClaudePopupButton() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setAuthed(!!data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setAuthed(!!s?.user));
    return () => { sub.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!authed) return;
    supabase
      .from("sonic_mcp_tokens")
      .select("id", { count: "exact", head: true })
      .is("revoked_at", null)
      .then(({ count }) => setConnected((count ?? 0) > 0));
  }, [authed, open]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("sonic:open-claude", onOpen);
    return () => window.removeEventListener("sonic:open-claude", onOpen);
  }, []);

  const copy = async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(idx);
      toast.success("Prompt copied");
      setTimeout(() => setCopied((c) => (c === idx ? null : c)), 1500);
    } catch {
      toast.error("Couldn't copy");
    }
  };

  if (!authed) return null;

  return (
    <>
      {/* Floating trigger — bottom-left so it doesn't overlap Ask Sonic (bottom-right) */}
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "fixed left-4 bottom-24 lg:left-6 lg:bottom-6 z-[60] flex items-center gap-2 rounded-full",
          "bg-purple-600 hover:bg-purple-500 text-white px-4 py-3 shadow-lg",
          "hover:scale-105 transition-transform"
        )}
        aria-label="Claude Custom App"
      >
        <Sparkle className="w-4 h-4" />
        <span className="text-sm font-semibold">Claude</span>
        {connected === false && (
          <span className="ml-1 h-2 w-2 rounded-full bg-amber-300 shadow-[0_0_6px_rgba(252,211,77,0.7)]" />
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-md bg-purple-500/15 flex items-center justify-center">
                <Sparkle className="h-4 w-4 text-purple-400" />
              </div>
              <div>
                <DialogTitle className="font-display">Claude Custom App</DialogTitle>
                <DialogDescription className="text-xs">
                  {connected
                    ? "Connected. Ask Claude about your store from claude.ai."
                    : "Connect Claude to query your store with natural language."}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Try asking Claude
            </div>
            <div className="space-y-1.5">
              {SAMPLE_PROMPTS.map((p, i) => (
                <button
                  key={i}
                  onClick={() => copy(p, i)}
                  className="group flex items-center gap-2 w-full text-left text-xs px-3 py-2 rounded-lg border border-purple-500/30 bg-purple-500/5 hover:bg-purple-500/10 transition-colors"
                  title="Click to copy"
                >
                  {copied === i ? (
                    <Check className="h-3 w-3 text-emerald-400 shrink-0" />
                  ) : (
                    <Copy className="h-3 w-3 text-purple-300 shrink-0" />
                  )}
                  <span className="flex-1">"{p}"</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              <X className="mr-1 h-4 w-4" />
              Close
            </Button>
            <Button
              className="bg-purple-600 hover:bg-purple-500 text-white"
              onClick={() => {
                setOpen(false);
                navigate("/settings/claude-connector");
              }}
            >
              <ExternalLink className="mr-1 h-4 w-4" />
              {connected ? "Manage connection" : "Connect Claude"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
