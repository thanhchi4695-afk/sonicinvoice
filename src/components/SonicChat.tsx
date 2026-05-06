import { useEffect, useRef, useState } from "react";
import { MessageCircle, X, Send, Loader2, Copy } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  executeChatAction,
  executeGatedAction,
  runInlineAction,
  runParseFromChat,
  type SonicDecision,
} from "@/lib/sonic-chat-actions";

type ChatRole = "user" | "assistant";
interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  created_at: string;
  action_taken?: string | null;
  action_data?: Record<string, unknown> | null;
  pending?: boolean;
  resolved?: "confirmed" | "cancelled" | null;
  download?: { url: string; filename: string; label: string } | null;
  copyable?: string | null;
  seo?: {
    title: string;
    description: string;
    titleLen: number;
    descLen: number;
    titleOver: boolean;
    descOver: boolean;
  } | null;
  margin?: {
    cost: number;
    brand: string | null;
    category: string;
    categoryInferred: boolean;
    multiplier: number;
    rrp: number;
    rrpExGst: number;
    grossProfit: number;
    marginPct: number;
    compareAt: number;
  } | null;
}

const FALLBACK_REPLY =
  "Sorry — I had trouble processing that. Try again in a moment.";

export default function SonicChat() {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Track auth
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Load history when opened
  useEffect(() => {
    if (!open || !userId) return;
    supabase
      .from("chat_messages")
      .select("id, role, content, created_at, action_taken, action_data")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(100)
      .then(({ data }) => {
        if (data) setMessages(data as ChatMessage[]);
      });
  }, [open, userId]);

  // Auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending || !userId) return;
    setSending(true);
    setInput("");

    const optimisticUser: ChatMessage = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimisticUser]);

    const { data: userRow } = await supabase
      .from("chat_messages")
      .insert({ user_id: userId, role: "user", content: text })
      .select("id, role, content, created_at")
      .single();

    if (userRow) {
      setMessages((m) =>
        m.map((msg) => (msg.id === optimisticUser.id ? (userRow as ChatMessage) : msg)),
      );
    }

    // Call Sonic intent classifier
    let assistantText = FALLBACK_REPLY;
    let actionTaken: string | null = "none";
    let actionData: Record<string, unknown> | null = null;
    try {
      const history = messages.slice(-8).map((m) => ({ role: m.role, content: m.content }));
      const { data, error } = await supabase.functions.invoke("sonic-chat", {
        body: { message: text, history, state: {} },
      });
      if (error) throw error;
      if (data?.response_text) {
        assistantText = data.response_text;
        actionTaken = data.action ?? "none";
        actionData = data;
      } else if (data?.error) {
        assistantText = data.error;
      }
    } catch (e) {
      console.error("sonic-chat invoke failed:", e);
    }

    const asstInsert: {
      user_id: string;
      role: string;
      content: string;
      action_taken?: string;
      action_data?: Record<string, unknown>;
    } = { user_id: userId, role: "assistant", content: assistantText };
    if (actionTaken) asstInsert.action_taken = actionTaken;
    if (actionData) asstInsert.action_data = actionData;

    const { data: asstRow } = await supabase
      .from("chat_messages")
      .insert([asstInsert as never])
      .select("id, role, content, created_at, action_taken, action_data")
      .single();

    const decision = (actionData ?? {}) as SonicDecision;
    const isGated = !!decision.requires_permission && decision.action && decision.action !== "none";

    if (asstRow) {
      const enriched: ChatMessage = {
        ...(asstRow as ChatMessage),
        pending: isGated,
      };
      setMessages((m) => [...m, enriched]);
    }
    setSending(false);

    // Sprint 3: auto-execute safe actions
    if (actionData && !isGated) {
      // Inline-result actions (tag builder, SEO writer) post their output as a
      // follow-up assistant message instead of navigating.
      const inline = await runInlineAction(decision, text);
      if (inline) {
        await postAssistantNote(inline.text, inline.copyable ?? null, inline.seo ?? null, inline.margin ?? null);
      } else {
        const ran = executeChatAction(decision);
        const closeOn = new Set([
          "navigate_tab",
          "open_case_study",
          "open_brand_guide",
          "open_file_picker",
          "show_last_invoice",
          "show_brand_accuracy",
          "show_flywheel_summary",
          "list_trained_brands",
          "open_correction_ui",
          "scan_email_inbox",
        ]);
        if (ran && decision.action && closeOn.has(decision.action)) {
          setTimeout(() => setOpen(false), 400);
        }
      }
    }
  }

  async function postAssistantNote(
    text: string,
    copyable: string | null = null,
    seo: ChatMessage["seo"] = null,
    margin: ChatMessage["margin"] = null,
  ) {
    if (!userId) return;
    const { data } = await supabase
      .from("chat_messages")
      .insert([{ user_id: userId, role: "assistant", content: text } as never])
      .select("id, role, content, created_at")
      .single();
    if (data) {
      setMessages((m) => [...m, { ...(data as ChatMessage), copyable, seo, margin }]);
    }
  }

  async function handleConfirm(msg: ChatMessage) {
    const decision = (msg.action_data ?? {}) as SonicDecision;
    setMessages((m) =>
      m.map((x) => (x.id === msg.id ? { ...x, pending: false, resolved: "confirmed" } : x)),
    );

    if (decision.action === "parse_from_chat") {
      // Find the most recent user message — that's the pasted invoice text.
      const lastUser = [...messages].reverse().find((x) => x.role === "user");
      const text =
        (decision.params?.invoice_text as string | undefined) ?? lastUser?.content ?? "";
      const supplier = (decision.params?.supplier as string | undefined) ?? undefined;
      try {
        const result = await runParseFromChat(text, supplier, async (line) => {
          await postAssistantNote(line);
        });
        const filename = `${(result.brand || "shopify").toLowerCase().replace(/\s+/g, "-")}-${Date.now()}.csv`;
        await postAssistantDownload(
          `Done — your CSV is ready (${result.rowCount} products).`,
          { url: result.csvUrl, filename, label: "Download CSV" },
        );
      } catch (e: any) {
        await postAssistantNote(`✕ ${e?.message ?? "Pipeline failed"}`);
      }
      return;
    }

    const ran = executeGatedAction(decision);
    await postAssistantNote(
      ran ? "Done — running that now." : "I couldn't run that action. Try again.",
    );
  }

  async function postAssistantDownload(
    text: string,
    download: { url: string; filename: string; label: string },
  ) {
    if (!userId) return;
    const { data } = await supabase
      .from("chat_messages")
      .insert([{ user_id: userId, role: "assistant", content: text } as never])
      .select("id, role, content, created_at")
      .single();
    if (data) {
      setMessages((m) => [...m, { ...(data as ChatMessage), download }]);
    }
  }

  async function handleCancel(msg: ChatMessage) {
    setMessages((m) =>
      m.map((x) => (x.id === msg.id ? { ...x, pending: false, resolved: "cancelled" } : x)),
    );
    await postAssistantNote("Got it, cancelled.");
  }

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open Sonic chat"
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition hover:scale-105 hover:shadow-primary/50"
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      )}

      {/* Slide-out panel */}
      <div
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-[380px] flex-col border-l border-border bg-background shadow-2xl transition-transform duration-300",
          open ? "translate-x-0" : "translate-x-full",
        )}
        role="dialog"
        aria-label="Sonic chat"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
              <MessageCircle className="h-4 w-4" />
            </div>
            <div>
              <div className="font-heading text-sm font-semibold">Sonic</div>
              <div className="text-xs text-muted-foreground">Your AI assistant</div>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close chat">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Thread */}
        <ScrollArea className="flex-1">
          <div ref={scrollRef} className="flex flex-col gap-3 p-4">
            {!userId && (
              <div className="text-sm text-muted-foreground">Sign in to chat with Sonic.</div>
            )}
            {userId && messages.length === 0 && (
              <div className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
                Hi — I'm Sonic. Ask me anything about your invoices, brands, or exports. Try
                "show flywheel" or "parse a new invoice".
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={cn("flex flex-col gap-2", m.role === "user" ? "items-end" : "items-start")}>
                {!m.seo && (
                  <div
                    className={cn(
                      "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed",
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground",
                    )}
                  >
                    {m.content}
                  </div>
                )}
                {m.role === "assistant" && m.seo && (
                  <div className="w-full max-w-[85%] space-y-3 rounded-2xl border border-border bg-muted p-3 text-sm">
                    <div>
                      <div className="mb-1 flex items-center gap-2">
                        <span className="font-semibold">SEO Title</span>
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-xs font-medium",
                            m.seo.titleOver
                              ? "bg-destructive/15 text-destructive"
                              : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                          )}
                        >
                          {m.seo.titleLen}/65
                        </span>
                      </div>
                      <div className="rounded bg-background/60 p-2 text-foreground">{m.seo.title}</div>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center gap-2">
                        <span className="font-semibold">Meta Description</span>
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-xs font-medium",
                            m.seo.descOver
                              ? "bg-destructive/15 text-destructive"
                              : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                          )}
                        >
                          {m.seo.descLen}/155
                        </span>
                      </div>
                      <div className="rounded bg-background/60 p-2 text-foreground">{m.seo.description}</div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(m.seo!.title);
                            toast.success("Copied!");
                          } catch {
                            toast.error("Copy failed");
                          }
                        }}
                      >
                        <Copy className="mr-1 h-3 w-3" /> Copy title
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(m.seo!.description);
                            toast.success("Copied!");
                          } catch {
                            toast.error("Copy failed");
                          }
                        }}
                      >
                        <Copy className="mr-1 h-3 w-3" /> Copy description
                      </Button>
                    </div>
                  </div>
                )}
                {m.role === "assistant" && m.pending && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleConfirm(m)}>
                      ✓ Yes, do it
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleCancel(m)}>
                      Cancel
                    </Button>
                  </div>
                )}
                {m.role === "assistant" && m.copyable && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(m.copyable!);
                        toast.success("Copied!");
                      } catch {
                        toast.error("Copy failed");
                      }
                    }}
                  >
                    <Copy className="mr-1 h-3 w-3" /> Copy tags
                  </Button>
                )}
                {m.role === "assistant" && m.download && (
                  <a
                    href={m.download.url}
                    download={m.download.filename}
                    className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                  >
                    ⬇ {m.download.label}
                  </a>
                )}
                {m.role === "assistant" && m.resolved && (
                  <div className="text-xs text-muted-foreground">
                    {m.resolved === "confirmed" ? "Confirmed" : "Cancelled"}
                  </div>
                )}
              </div>
            ))}
            {sending && (
              <div className="self-start rounded-2xl bg-muted px-3 py-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2 border-t border-border p-3"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={userId ? "Ask Sonic…" : "Sign in to chat"}
            disabled={!userId || sending}
            className="flex-1"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!userId || sending || !input.trim()}
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </>
  );
}
