// AskSonicAI — floating expert chat panel (Claude-powered Q&A about the user's store).
// Visual design: lime-accent dark panel with context strip + avatar bubbles.
// Functionality unchanged: invokes `sonic-ask` edge fn and renders markdown reply.
import { useEffect, useMemo, useRef, useState } from "react";
import { Send, X, Sparkle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface Msg { role: "user" | "assistant"; content: string }

const SUGGESTIONS = [
  "Which collections need SEO most urgently?",
  "What competitor gaps should I act on?",
  "Tagging rules for plus-size swimwear?",
  "Which collections are ready to publish?",
];

const CONTEXTS = [
  { id: "all", label: "All data" },
  { id: "collections", label: "Collections" },
  { id: "brands", label: "Brands" },
  { id: "seo", label: "SEO gaps" },
  { id: "markdown", label: "Markdown / pricing" },
  { id: "tagging", label: "Tagging rules" },
] as const;

export default function AskSonicAI() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [ctx, setCtx] = useState<string>("all");
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

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }

  async function send(text: string) {
    const msg = text.trim();
    if (!msg || loading) return;
    const next = [...history, { role: "user" as const, content: msg }];
    setHistory(next);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("sonic-ask", {
        body: { message: msg, conversation_history: history, context: ctx },
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

  const lime = "#a3e635";
  const limeDim = "rgba(163,230,53,0.12)";
  const limeBorder = "rgba(163,230,53,0.25)";

  const showQuickPrompts = useMemo(() => history.length === 0, [history.length]);

  if (!authed) return null;

  const dismissTooltip = () => {
    try { localStorage.setItem("sonic-ask-tooltip-dismissed", "true"); } catch {}
    setTooltipDismissed(true);
  };

  return (
    <>
      {/* Floating trigger */}
      {!open && (
        <>
          <button
            onClick={() => setOpen(true)}
            className="fixed right-4 bottom-24 lg:right-6 lg:bottom-6 z-[60] flex items-center gap-2 rounded-full px-4 py-3 shadow-lg hover:scale-105 transition-transform font-semibold text-sm"
            style={{ background: lime, color: "#000" }}
            aria-label="Ask Sonic AI"
          >
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-black/10 text-[11px] font-extrabold">S</span>
            <span>Ask Sonic AI</span>
          </button>

          {!tooltipDismissed && (
            <div className="fixed right-4 bottom-[8.5rem] lg:right-6 lg:bottom-20 z-[61] w-56">
              <div className="rounded-xl border border-border bg-card shadow-xl p-3 space-y-2">
                <p className="text-xs text-foreground leading-relaxed">
                  Tap to open your AI assistant. Ask about your store, SEO, inventory, or pricing anytime.
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">You can toggle it here</span>
                  <button
                    onClick={dismissTooltip}
                    className="text-[10px] font-semibold hover:underline"
                    style={{ color: lime }}
                  >
                    Got it
                  </button>
                </div>
              </div>
              <div className="absolute -bottom-1.5 right-6 lg:right-8 w-3 h-3 bg-card border-r border-b border-border rotate-45" />
            </div>
          )}
        </>
      )}

      {/* Panel */}
      {open && (
        <div
          className="fixed inset-x-2 bottom-20 top-16 lg:inset-auto lg:bottom-6 lg:right-6 lg:top-auto lg:w-[400px] lg:h-[640px] z-[60] flex flex-col rounded-2xl shadow-2xl overflow-hidden"
          style={{ background: "#0a0a0a", color: "#f0f0f0", border: "1px solid #242424" }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 shrink-0" style={{ borderBottom: "1px solid #242424" }}>
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-base font-extrabold text-black"
              style={{ background: lime }}
            >
              S
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold tracking-tight">AskSonicAI</div>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ background: lime }}
              />
              <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: "#737373" }}>
                Live
              </span>
            </div>
            <button
              className="ml-1 h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-white/5"
              onClick={() => window.dispatchEvent(new CustomEvent("sonic:open-claude"))}
              aria-label="Switch to Claude"
              title="Switch to Claude Custom App"
            >
              <Sparkle className="w-4 h-4 text-purple-400" />
            </button>
            <button
              className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-white/5"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              <X className="w-4 h-4" style={{ color: "#a3a3a3" }} />
            </button>
          </div>

          {/* Context strip */}
          <div
            className="flex gap-2 px-4 py-3 overflow-x-auto shrink-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ borderBottom: "1px solid #242424" }}
          >
            {CONTEXTS.map((c) => {
              const active = ctx === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setCtx(c.id)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors"
                  style={{
                    background: active ? limeDim : "#141414",
                    border: `1px solid ${active ? limeBorder : "#242424"}`,
                    color: active ? lime : "#737373",
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: "currentColor" }}
                  />
                  {c.label}
                </button>
              );
            })}
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
            {history.length === 0 && (
              <div className="flex gap-2.5 items-start">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0"
                  style={{ background: limeDim, border: `1px solid ${limeBorder}`, color: lime }}
                >
                  S
                </div>
                <div
                  className="max-w-[80%] rounded-2xl px-3.5 py-3 text-[13px] leading-relaxed"
                  style={{ background: "#141414", border: "1px solid #242424", borderBottomLeftRadius: 4 }}
                >
                  <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: lime }}>
                    AskSonicAI
                  </div>
                  Hi! I'm connected to your live Sonic Invoices store. I can see your collections, SEO scores, brands, and competitor gaps.
                  <br /><br />
                  Ask me anything — what to fix, what to markdown, which collections need content, or tagging rules.
                </div>
              </div>
            )}

            {history.map((m, i) => {
              const isUser = m.role === "user";
              return (
                <div key={i} className={cn("flex gap-2.5 items-start", isUser && "flex-row-reverse")}>
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                    style={
                      isUser
                        ? { background: "#141414", border: "1px solid #242424", color: "#737373" }
                        : { background: limeDim, border: `1px solid ${limeBorder}`, color: lime }
                    }
                  >
                    {isUser ? "You" : "S"}
                  </div>
                  <div
                    className="max-w-[80%] rounded-2xl px-3.5 py-3 text-[13px] leading-relaxed"
                    style={
                      isUser
                        ? { background: limeDim, border: `1px solid ${limeBorder}`, borderBottomRightRadius: 4, color: "#f0f0f0" }
                        : { background: "#141414", border: "1px solid #242424", borderBottomLeftRadius: 4, color: "#f0f0f0" }
                    }
                  >
                    <div
                      className={cn("text-[10px] font-bold uppercase tracking-wider mb-1.5", isUser && "text-right")}
                      style={{ color: isUser ? "#737373" : lime }}
                    >
                      {isUser ? "You" : "AskSonicAI"}
                    </div>
                    {isUser ? (
                      <span className="whitespace-pre-wrap">{m.content}</span>
                    ) : (
                      <div className="prose prose-sm prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_code]:bg-white/10 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[11px]">
                        <ReactMarkdown>{m.content}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {loading && (
              <div className="flex gap-2.5 items-start">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0"
                  style={{ background: limeDim, border: `1px solid ${limeBorder}`, color: lime }}
                >
                  S
                </div>
                <div
                  className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl text-[12px]"
                  style={{ background: "#141414", border: "1px solid #242424", borderBottomLeftRadius: 4, color: "#737373" }}
                >
                  <span>Checking your store data</span>
                  <span className="inline-flex gap-0.5">
                    <span className="w-1 h-1 rounded-full inline-block animate-[blink_1.2s_ease-in-out_infinite]" style={{ background: lime }} />
                    <span className="w-1 h-1 rounded-full inline-block animate-[blink_1.2s_ease-in-out_infinite_0.2s]" style={{ background: lime }} />
                    <span className="w-1 h-1 rounded-full inline-block animate-[blink_1.2s_ease-in-out_infinite_0.4s]" style={{ background: lime }} />
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Quick prompts */}
          {showQuickPrompts && (
            <div className="px-4 pb-3 flex gap-2 flex-wrap shrink-0">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="px-3 py-1.5 rounded-full text-[12px] text-left transition-colors hover:text-white"
                  style={{ background: "#141414", border: "1px solid #242424", color: "#737373" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = lime;
                    e.currentTarget.style.background = limeDim;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "#242424";
                    e.currentTarget.style.background = "#141414";
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input bar */}
          <div className="px-4 py-3 flex items-end gap-2.5 shrink-0" style={{ borderTop: "1px solid #242424" }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => { setInput(e.target.value); autoResize(e.currentTarget); }}
              onKeyDown={onKey}
              placeholder="Ask about your store, collections, SEO scores…"
              rows={1}
              className="flex-1 resize-none rounded-xl px-3.5 py-2.5 text-[13px] leading-snug outline-none transition-colors min-h-[42px] max-h-[120px] placeholder:text-[#525252]"
              style={{ background: "#141414", border: "1px solid #242424", color: "#f0f0f0" }}
              onFocus={(e) => (e.currentTarget.style.borderColor = lime)}
              onBlur={(e) => (e.currentTarget.style.borderColor = "#242424")}
            />
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || loading}
              aria-label="Send"
              className="w-[38px] h-[38px] rounded-[10px] flex items-center justify-center shrink-0 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 active:scale-95"
              style={{ background: lime }}
            >
              <Send className="w-4 h-4" style={{ color: "#000" }} />
            </button>
          </div>

          <style>{`
            @keyframes blink { 0%, 80%, 100% { opacity: 0.2; } 40% { opacity: 1; } }
          `}</style>
        </div>
      )}
    </>
  );
}
