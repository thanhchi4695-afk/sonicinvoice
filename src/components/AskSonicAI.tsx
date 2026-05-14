// AskSonicAI — floating expert chat panel (Claude-powered Q&A about the user's store).
// Separate from SonicChat (which is an action-routing intent classifier).
import { useEffect, useRef, useState } from "react";
import { Sparkles, Send, X, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Msg { role: "user" | "assistant"; content: string }

const SUGGESTIONS = [
  "Which collections need SEO content?",
  "What's my worst performing collection right now?",
  "How do I improve my meta description score?",
  "What should I focus on this week?",
];

export default function AskSonicAI() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setAuthed(!!data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setAuthed(!!s?.user));
    return () => { sub.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history, loading, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("sonic:open-ask", onOpen);
    return () => window.removeEventListener("sonic:open-ask", onOpen);
  }, []);

  async function send(text: string) {
    const msg = text.trim();
    if (!msg || loading) return;
    const next = [...history, { role: "user" as const, content: msg }];
    setHistory(next);
    setInput("");
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("sonic-ask", {
        body: { message: msg, conversation_history: history },
      });
      if (error) throw error;
      const reply = (data as { reply?: string; error?: string })?.reply
        || (data as { error?: string })?.error
        || "Sorry, I couldn't generate a reply.";
      setHistory([...next, { role: "assistant", content: reply }]);
    } catch (e) {
      setHistory([...next, { role: "assistant", content: `Error: ${(e as Error).message}` }]);
    } finally {
      setLoading(false);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  const [tooltipDismissed, setTooltipDismissed] = useState(() => {
    try { return localStorage.getItem("sonic-ask-tooltip-dismissed") === "true"; } catch { return false; }
  });

  if (!authed) return null;

  const dismissTooltip = () => {
    try { localStorage.setItem("sonic-ask-tooltip-dismissed", "true"); } catch {}
    setTooltipDismissed(true);
  };

  return (
    <>
      {/* Floating trigger */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className={cn(
            "fixed right-4 bottom-24 lg:right-6 lg:bottom-6 z-[60] flex items-center gap-2 rounded-full",
            "bg-primary text-primary-foreground px-4 py-3 shadow-lg",
            "hover:scale-105 transition-transform"
          )}
          aria-label="Ask Sonic AI"
        >
          <Sparkles className="w-4 h-4" />
          <span className="text-sm font-semibold">Ask Sonic AI</span>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed inset-x-2 bottom-20 top-16 lg:inset-auto lg:bottom-6 lg:right-6 lg:top-auto lg:w-[380px] lg:h-[560px] z-[60] flex flex-col rounded-2xl border border-border bg-background shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-primary/5">
            <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold leading-tight">Ask Sonic AI</div>
              <div className="text-[11px] text-muted-foreground">Knows your store, brands & inventory</div>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)} aria-label="Close">
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {history.length === 0 && (
              <div className="space-y-3">
                <div className="text-xs text-muted-foreground">
                  Powered by Claude. Ask anything about your store, SEO, tagging, pricing, or Australian retail.
                </div>
                <div className="flex flex-col gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="text-left text-xs px-3 py-2 rounded-lg border border-border hover:bg-muted transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {history.map((m, i) => (
              <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  )}
                >
                  {m.role === "assistant" ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1">
                      <ReactMarkdown>{m.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <span className="whitespace-pre-wrap">{m.content}</span>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl px-3 py-2 flex items-center gap-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Thinking…</span>
                </div>
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t border-border p-2 flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="Ask about your store…"
              rows={1}
              className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 max-h-32"
            />
            <Button size="icon" onClick={() => send(input)} disabled={!input.trim() || loading} aria-label="Send">
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
