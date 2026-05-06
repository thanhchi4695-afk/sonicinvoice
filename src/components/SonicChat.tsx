import { useEffect, useRef, useState } from "react";
import { MessageCircle, X, Send, Loader2, Copy, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { checkAndAutoApprove } from "@/lib/auto-approve";
import SupplierEmailCard from "@/components/SupplierEmailCard";
import ProductDescriptionCard, { type ProductDescription } from "@/components/ProductDescriptionCard";
import {
  executeChatAction,
  executeGatedAction,
  runInlineAction,
  runParseFromChat,
  type SonicDecision,
} from "@/lib/sonic-chat-actions";
import {
  applyTagsAndSeo,
  buildShopifyCsv,
  csvDownloadUrl,
  type ParsedRow,
} from "@/lib/parse-from-chat";

type ChatRole = "user" | "assistant" | "proactive";
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
  autoApproved?: { taskId: string; taskType: string; undone?: boolean } | null;
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
  email?: {
    supplierName: string;
    emailType: string;
    subject: string;
    body: string;
    productDetails: string;
    userName: string;
    storeName: string;
    toneVariant: number;
  } | null;
  description?: ProductDescription | null;
  quickReplies?: string[] | null;
  // Proactive (auto-injected by the brain via realtime)
  proactive?: {
    task_id: string;
    observation: string;
    proposed_action: string;
    permission_question: string | null;
    requires_permission: boolean;
    pipeline_to_run: string | null;
    resolved?: "approved" | "dismissed" | null;
  } | null;
  isStreaming?: boolean;
}

const FALLBACK_REPLY =
  "Sorry — I had trouble processing that. Try again in a moment.";

export default function SonicChat() {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [hasActiveParse, setHasActiveParse] = useState(false);
  const [pendingPipeline, setPendingPipeline] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Track auth
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Realtime: inject proactive-brain tasks into the chat the moment they appear
  // Load morning briefing once per day on first open
  useEffect(() => {
    if (!userId) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const shownKey = `briefing_shown_${today.toISOString().split("T")[0]}`;
    if (sessionStorage.getItem(shownKey)) return;

    (async () => {
      const { data: briefing } = await supabase
        .from("agent_tasks")
        .select("id, observation, created_at")
        .eq("user_id", userId)
        .eq("task_type", "morning_briefing")
        .eq("status", "completed")
        .gte("created_at", today.toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (briefing?.observation) {
        const msg: ChatMessage = {
          id: `briefing-${briefing.id}`,
          role: "proactive",
          content: briefing.observation,
          created_at: briefing.created_at ?? new Date().toISOString(),
          proactive: {
            task_id: null,
            observation: briefing.observation,
            proposed_action: "",
            permission_question: null,
            requires_permission: false,
            pipeline_to_run: null,
            resolved: null,
          },
        };
        setMessages((m) => (m.some((x) => x.id === msg.id) ? m : [...m, msg]));
        sessionStorage.setItem(shownKey, "1");
      }
    })();
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let proactiveEnabled = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const onProactiveInsert = async (payload: { new: Record<string, any> }) => {
      const t = payload.new as Record<string, any>;
      if (!proactiveEnabled) return;
      if (t.status !== "permission_requested" && t.status !== "suggested") return;

      // Sprint 4 — try auto-approve first for low-risk tasks
      if (t.status === "permission_requested" && t.task_type) {
        const wasAutoApproved = await checkAndAutoApprove(t.id, t.task_type, userId);
        if (wasAutoApproved) {
          const note: ChatMessage = {
            id: `auto-${t.id}`,
            role: "assistant",
            content: `Done: ${t.observation ?? t.task_type} (auto-completed based on your preferences)`,
            created_at: new Date().toISOString(),
            autoApproved: { taskId: t.id, taskType: t.task_type, undone: false },
          };
          setMessages((m) => (m.some((x) => x.id === note.id) ? m : [...m, note]));
          return;
        }
      }

      const msg: ChatMessage = {
        id: `proactive-${t.id}`,
        role: "proactive",
        content: t.observation ?? "Sonic noticed something.",
        created_at: t.created_at ?? new Date().toISOString(),
        proactive: {
          task_id: t.id,
          observation: t.observation ?? "",
          proposed_action: t.proposed_action ?? "",
          permission_question: t.permission_question ?? null,
          requires_permission: t.status === "permission_requested",
          pipeline_to_run: t.pipeline_id ?? null,
          resolved: null,
        },
      };
      setMessages((m) => (m.some((x) => x.id === msg.id) ? m : [...m, msg]));
      // Auto-open the panel so the user actually sees the suggestion
      setOpen(true);
    };

    const subscribe = () => {
      channel = supabase
        .channel(`proactive-tasks-${userId}-${Date.now()}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "agent_tasks",
            filter: `user_id=eq.${userId}`,
          },
          onProactiveInsert,
        )
        .subscribe();
    };

    subscribe();

    // Bug 1 fix: re-subscribe when the tab becomes visible again. Mobile OS
    // (and some desktop browsers) kill the websocket when backgrounded, which
    // causes proactive messages to silently stop arriving.
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const state = (channel as { state?: string } | null)?.state;
      if (state === "joined" || state === "joining") return;
      if (channel) supabase.removeChannel(channel);
      subscribe();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Honor user preference: disable proactive injection when toggled off
    supabase
      .from("user_preferences")
      .select("proactive_mode_enabled")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (data && data.proactive_mode_enabled === false) {
          proactiveEnabled = false;
        }
      });

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (channel) supabase.removeChannel(channel);
    };
  }, [userId]);

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

  async function handleSend(override?: string) {
    const text = (override ?? input).trim();
    if (!text || sending || !userId) return;
    setSending(true);
    if (!override) setInput("");

    const optimisticUser: ChatMessage = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimisticUser]);

    let decision: SonicDecision = {} as SonicDecision;
    let isGated = false;
    let actionData: Record<string, unknown> | null = null;

    try {
      // Best-effort persist user message — don't block UI on DB errors.
      try {
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
      } catch (e) {
        console.warn("chat_messages user insert failed:", e);
      }

      // Call Sonic intent classifier — streamed via SSE so tokens arrive
      // word-by-word for snappy perceived latency.
      let assistantText = FALLBACK_REPLY;
      let actionTaken: string | null = "none";
      const streamingId = `stream-${Date.now()}`;
      let streamingBubbleAdded = false;

      try {
        const history = messages.slice(-8).map((m) => ({ role: m.role, content: m.content }));
        const { data: { session } } = await supabase.auth.getSession();
        const authHeader = session?.access_token ? `Bearer ${session.access_token}` : "";
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

        const ac = new AbortController();
        const timeoutId = setTimeout(() => ac.abort(), 30000);

        const resp = await fetch(`${supabaseUrl}/functions/v1/sonic-chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
            apikey: anonKey,
          },
          body: JSON.stringify({ message: text, history, state: {} }),
          signal: ac.signal,
        });

        if (!resp.ok || !resp.body) {
          clearTimeout(timeoutId);
          let errMsg = FALLBACK_REPLY;
          try {
            const j = await resp.json();
            if (j?.error) errMsg = j.error;
          } catch { /* ignore */ }
          assistantText = errMsg;
        } else {
          // Add an optimistic streaming bubble that we fill in as tokens arrive.
          setMessages((m) => [
            ...m,
            {
              id: streamingId,
              role: "assistant",
              content: "",
              created_at: new Date().toISOString(),
              isStreaming: true,
            },
          ]);
          streamingBubbleAdded = true;

          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let streamedText = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split("\n\n");
            buffer = events.pop() ?? "";
            for (const evt of events) {
              if (!evt.startsWith("data: ")) continue;
              try {
                const json = JSON.parse(evt.slice(6));
                if (json.done) {
                  assistantText = json.response_text ?? streamedText;
                  actionTaken = json.action ?? "none";
                  actionData = json as Record<string, unknown>;
                } else if (json.token) {
                  streamedText += json.token;
                  setMessages((m) =>
                    m.map((x) =>
                      x.id === streamingId ? { ...x, content: streamedText } : x,
                    ),
                  );
                }
              } catch {
                // skip malformed line
              }
            }
          }
          clearTimeout(timeoutId);
          if (!actionData && streamedText) assistantText = streamedText;
        }
      } catch (e) {
        console.error("sonic-chat stream failed:", e);
        assistantText = e instanceof Error ? e.message : FALLBACK_REPLY;
      }

      decision = (actionData ?? {}) as SonicDecision;
      isGated = !!decision.requires_permission && !!decision.action && decision.action !== "none";

      const asstInsert: {
        user_id: string;
        role: string;
        content: string;
        action_taken?: string;
        action_data?: Record<string, unknown>;
      } = { user_id: userId, role: "assistant", content: assistantText };
      if (actionTaken) asstInsert.action_taken = actionTaken;
      if (actionData) asstInsert.action_data = actionData;

      let asstRow: ChatMessage | null = null;
      try {
        const { data } = await supabase
          .from("chat_messages")
          .insert([asstInsert as never])
          .select("id, role, content, created_at, action_taken, action_data")
          .single();
        asstRow = (data as ChatMessage) ?? null;
      } catch (e) {
        console.warn("chat_messages assistant insert failed:", e);
      }

      const enriched: ChatMessage = asstRow
        ? { ...asstRow, pending: isGated }
        : {
            id: `local-${Date.now()}`,
            role: "assistant",
            content: assistantText,
            created_at: new Date().toISOString(),
            action_taken: actionTaken ?? undefined,
            action_data: actionData ?? undefined,
            pending: isGated,
          };
      // Replace the streaming placeholder bubble with the persisted/enriched one.
      setMessages((m) => {
        const filtered = streamingBubbleAdded ? m.filter((x) => x.id !== streamingId) : m;
        return [...filtered, enriched];
      });
    } finally {
      // ALWAYS clear the spinner so the chat can never get stuck "loading".
      setSending(false);
    }

    // Sprint 3: auto-execute safe actions (after spinner is cleared).
    if (actionData && !isGated) {
      try {
        const inline = await runInlineAction(decision, text);
        if (inline) {
          await postAssistantNote(
            inline.text,
            inline.copyable ?? null,
            inline.seo ?? null,
            inline.margin ?? null,
            inline.email ?? null,
            inline.description ?? null,
            inline.quickReplies ?? null,
          );
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
      } catch (e) {
        console.error("post-response action failed:", e);
      }
    }
  }

  async function postAssistantNote(
    text: string,
    copyable: string | null = null,
    seo: ChatMessage["seo"] = null,
    margin: ChatMessage["margin"] = null,
    email: ChatMessage["email"] = null,
    description: ChatMessage["description"] = null,
    quickReplies: string[] | null = null,
  ) {
    if (!userId) return;
    const { data } = await supabase
      .from("chat_messages")
      .insert([{ user_id: userId, role: "assistant", content: text } as never])
      .select("id, role, content, created_at")
      .single();
    if (data) {
      setMessages((m) => [...m, { ...(data as ChatMessage), copyable, seo, margin, email, description, quickReplies }]);
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
        setHasActiveParse(true);
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
        setHasActiveParse(false);
      }
      return;
    }

    if (decision.action === "export_csv") {
      try {
        const invoiceId = String(decision.params?.invoice_id ?? "last");
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          await postAssistantNote("Sign in to export a CSV.");
          return;
        }

        // Fetch the invoice job — "last" → most recent done invoice_read; otherwise by id.
        let job: { id: string; result: Record<string, unknown> | null } | null = null;
        if (invoiceId === "last" || invoiceId === "all") {
          const { data } = await supabase
            .from("invoice_processing_jobs")
            .select("id, result")
            .eq("user_id", user.id)
            .eq("job_kind", "invoice_read")
            .eq("status", "done")
            .order("completed_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          job = data as typeof job;
        } else {
          const { data } = await supabase
            .from("invoice_processing_jobs")
            .select("id, result")
            .eq("id", invoiceId)
            .maybeSingle();
          job = data as typeof job;
        }

        const products = (job?.result as { products?: ParsedRow[]; brand?: string } | null)?.products ?? [];
        const brand = (job?.result as { brand?: string } | null)?.brand ?? "shopify";
        if (!products.length) {
          await postAssistantNote("No parsed invoice found to export. Parse one first, then ask me to export.");
          return;
        }

        const enriched = applyTagsAndSeo(products, brand);
        const csv = buildShopifyCsv(enriched);
        const url = csvDownloadUrl(csv);
        const filename = `${brand.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}.csv`;

        // Trigger the actual browser download immediately.
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();

        await postAssistantDownload(
          `CSV downloaded — ${enriched.length} rows from ${brand}.`,
          { url, filename, label: "Download again" },
        );
      } catch (e: any) {
        console.error("export_csv failed:", e);
        await postAssistantNote(`✕ Could not export CSV: ${e?.message ?? "unknown error"}`);
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

  // ── Proactive task handlers ────────────────────────────────────────
  async function handleProactiveApprove(taskId: string, taskType?: string) {
    setMessages((arr) =>
      arr.map((x) =>
        x.proactive?.task_id === taskId
          ? { ...x, proactive: { ...x.proactive, resolved: "approved" } }
          : x,
      ),
    );
    try {
      await supabase
        .from("agent_tasks")
        .update({ status: "approved", approved_at: new Date().toISOString() })
        .eq("id", taskId);
      // Best-effort: kick off the matching action via the existing chat action runner.
      const action = taskType ?? "none";
      if (action && action !== "none") {
        try {
          await executeChatAction(action as never);
        } catch (e) {
          console.warn("[proactive] executeChatAction failed:", e);
        }
      }
    } catch (e) {
      console.warn("[proactive] approve update failed:", e);
    }
    await postAssistantNote("On it.");
  }

  async function handleProactiveDismiss(taskId: string) {
    setMessages((arr) =>
      arr.map((x) =>
        x.proactive?.task_id === taskId
          ? { ...x, proactive: { ...x.proactive, resolved: "dismissed" } }
          : x,
      ),
    );
    try {
      await supabase
        .from("agent_tasks")
        .update({ status: "skipped", dismissed_at: new Date().toISOString() })
        .eq("id", taskId);
    } catch (e) {
      console.warn("[proactive] dismiss update failed:", e);
    }
    await postAssistantNote("Got it, skipping.");
  }

  function handlePipelineLaunch(pipelineKey: string) {
    setPendingPipeline(pipelineKey);
  }

  function confirmPipelineLaunch() {
    if (!pendingPipeline) return;
    window.dispatchEvent(
      new CustomEvent("sonic:launch-pipeline", { detail: { pipeline: pendingPipeline } }),
    );
    setPendingPipeline(null);
    setOpen(false);
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
                {m.role === "proactive" && m.proactive ? (
                  <div className="w-full max-w-[90%] space-y-2 rounded-r-xl border-l-2 border-teal-400 bg-muted/60 px-3 py-2 text-sm">
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-teal-500">
                      <span className="rounded bg-teal-500/15 px-1.5 py-0.5 font-semibold">Sonic</span>
                      <span>noticed</span>
                    </div>
                    <div className="text-foreground">{m.proactive.observation}</div>
                    {m.proactive.proposed_action && (
                      <div className="text-xs text-muted-foreground">{m.proactive.proposed_action}</div>
                    )}
                    {m.proactive.permission_question && !m.proactive.resolved && (
                      <div className="text-sm text-foreground">{m.proactive.permission_question}</div>
                    )}
                    {m.proactive.requires_permission && !m.proactive.resolved && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button
                          size="sm"
                          onClick={() =>
                            handleProactiveApprove(
                              m.proactive!.task_id,
                              (m.action_data as Record<string, unknown> | null)?.task_type as string | undefined,
                            )
                          }
                        >
                          Yes, go ahead
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleProactiveDismiss(m.proactive!.task_id)}
                        >
                          Not now
                        </Button>
                        {m.proactive.pipeline_to_run && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handlePipelineLaunch(m.proactive!.pipeline_to_run!)}
                          >
                            Run full pipeline instead
                          </Button>
                        )}
                      </div>
                    )}
                    {m.proactive.resolved && (
                      <div className="text-xs text-muted-foreground">
                        {m.proactive.resolved === "approved" ? "Approved" : "Dismissed"}
                      </div>
                    )}
                  </div>
                ) : (
                  !m.seo && !m.margin && !m.email && !m.description && (
                    <div
                      className={cn(
                        "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed",
                        m.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground",
                      )}
                    >
                      {m.content}
                      {m.isStreaming && (
                        <span className="sonic-blink ml-px inline-block h-[1em] w-[2px] align-text-bottom bg-current" />
                      )}
                    </div>
                  )
                )}
                {m.role === "assistant" && m.description && (
                  <ProductDescriptionCard
                    description={m.description}
                    hasActiveParse={hasActiveParse}
                    onUpdate={(next) =>
                      setMessages((arr) =>
                        arr.map((x) => (x.id === m.id ? { ...x, description: next } : x)),
                      )
                    }
                  />
                )}
                {m.role === "assistant" && m.email && (
                  <SupplierEmailCard
                    msgId={m.id}
                    email={m.email}
                    onUpdateBody={(newBody) =>
                      setMessages((arr) =>
                        arr.map((x) =>
                          x.id === m.id && x.email
                            ? { ...x, email: { ...x.email, body: newBody } }
                            : x,
                        ),
                      )
                    }
                    onRegenerate={async () => {
                      if (!m.email) return;
                      const nextTone = ((m.email.toneVariant ?? 0) + 1) % 3;
                      try {
                        const { data, error } = await supabase.functions.invoke(
                          "sonic-supplier-email",
                          {
                            body: {
                              supplier_name: m.email.supplierName,
                              email_type: m.email.emailType,
                              product_details: m.email.productDetails,
                              user_name: m.email.userName,
                              store_name: m.email.storeName,
                              tone_variant: nextTone,
                            },
                          },
                        );
                        if (error) throw error;
                        if (data?.error) throw new Error(data.error);
                        setMessages((arr) =>
                          arr.map((x) =>
                            x.id === m.id && x.email
                              ? {
                                  ...x,
                                  email: {
                                    ...x.email,
                                    subject: String(data?.subject ?? x.email.subject),
                                    body: String(data?.body ?? x.email.body),
                                    toneVariant: nextTone,
                                  },
                                }
                              : x,
                          ),
                        );
                        toast.success("Regenerated with a different tone");
                      } catch (err) {
                        console.error(err);
                        toast.error("Couldn't regenerate");
                      }
                    }}
                  />
                )}
                {m.role === "assistant" && m.margin && (
                  <div className="w-full max-w-[85%] space-y-2 rounded-2xl border border-border bg-muted p-3 text-sm">
                    <div className="grid grid-cols-2 gap-y-1 font-mono text-xs">
                      <span className="text-muted-foreground">Cost (ex GST)</span>
                      <span className="text-right">${m.margin.cost.toFixed(2)}</span>
                      <span className="text-muted-foreground">Markup applied</span>
                      <span className="text-right">
                        ×{m.margin.multiplier} ({m.margin.category}
                        {m.margin.categoryInferred ? ", inferred" : ""})
                      </span>
                    </div>
                    <div className="border-t border-border" />
                    <div className="grid grid-cols-2 gap-y-1 font-mono text-xs">
                      <span className="font-semibold">Recommended RRP</span>
                      <span className="text-right font-semibold">${m.margin.rrp.toFixed(2)}</span>
                      <span className="text-muted-foreground">RRP ex GST</span>
                      <span className="text-right">${m.margin.rrpExGst.toFixed(2)}</span>
                      <span className="text-muted-foreground">Gross margin</span>
                      <span className="text-right">{m.margin.marginPct.toFixed(1)}%</span>
                      <span className="text-muted-foreground">Gross profit</span>
                      <span className="text-right">${m.margin.grossProfit.toFixed(2)}</span>
                    </div>
                    <div className="rounded bg-background/60 p-2 text-xs">
                      Compare at price for a 20% sale:{" "}
                      <span className="font-semibold">${m.margin.compareAt.toFixed(2)}</span>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        window.dispatchEvent(
                          new CustomEvent("sonic:apply-margin-prices", {
                            detail: {
                              cost: m.margin!.cost,
                              rrp: m.margin!.rrp,
                              rrpExGst: m.margin!.rrpExGst,
                              compareAt: m.margin!.compareAt,
                              brand: m.margin!.brand,
                              category: m.margin!.category,
                            },
                          }),
                        );
                        toast.success("Prices applied to active line");
                      }}
                    >
                      Use these prices
                    </Button>
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
                {m.role === "assistant" && m.autoApproved && !m.autoApproved.undone && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const { taskId, taskType } = m.autoApproved!;
                      const { error } = await supabase
                        .from("agent_tasks")
                        .update({
                          status: "skipped",
                          result_summary: `Undone by user before Shopify import (${taskType})`,
                          completed_at: null,
                          approved_at: null,
                        })
                        .eq("id", taskId);
                      if (error) {
                        toast.error("Couldn't undo");
                        return;
                      }
                      setMessages((prev) =>
                        prev.map((x) =>
                          x.id === m.id
                            ? {
                                ...x,
                                content: `Undone: ${taskType}. The auto-approval has been reverted — re-run from Sonic when you're ready.`,
                                autoApproved: { ...x.autoApproved!, undone: true },
                              }
                            : x,
                        ),
                      );
                      toast.success("Auto-approval undone");
                    }}
                  >
                    <RotateCcw className="mr-1 h-3 w-3" /> Undo auto-approval
                  </Button>
                )}
                {m.role === "assistant" && m.autoApproved?.undone && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="text-[11px] text-muted-foreground">Undone — task marked skipped.</div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        const { taskType } = m.autoApproved!;
                        const actionMap: Record<string, string> = {
                          generate_tags: "open_tag_engine",
                          generate_seo: "open_seo_writer",
                          stock_check: "open_stock_monitor",
                        };
                        const action = actionMap[taskType];
                        if (!action) {
                          toast.error("Can't re-run this task type");
                          return;
                        }
                        try {
                          const { data: u } = await supabase.auth.getUser();
                          if (u.user?.id) {
                            await supabase.from("agent_tasks").insert({
                              user_id: u.user.id,
                              task_type: taskType,
                              status: "approved",
                              observation: "Re-run from Sonic after undo",
                              trigger_source: "user_rerun",
                              approved_at: new Date().toISOString(),
                            });
                          }
                          executeChatAction({
                            action,
                            params: {},
                            requires_permission: false,
                            intent: "action",
                            confidence: 1,
                          } as never);
                          setMessages((prev) =>
                            prev.map((x) =>
                              x.id === m.id
                                ? {
                                    ...x,
                                    content: `Re-running ${taskType} from Sonic…`,
                                    autoApproved: null,
                                  }
                                : x,
                            ),
                          );
                          toast.success("Re-running from Sonic");
                        } catch (e) {
                          console.warn("[rerun] failed:", e);
                          toast.error("Couldn't re-run");
                        }
                      }}
                    >
                      <RotateCcw className="mr-1 h-3 w-3" /> Re-run from Sonic
                    </Button>
                  </div>
                )}
                {m.role === "assistant" && m.resolved && (
                  <div className="text-xs text-muted-foreground">
                    {m.resolved === "confirmed" ? "Confirmed" : "Cancelled"}
                  </div>
                )}
                {m.role === "assistant" && m.quickReplies && m.quickReplies.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {m.quickReplies.map((q) => (
                      <button
                        key={q}
                        type="button"
                        disabled={sending}
                        onClick={() => handleSend(q)}
                        className="rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-50"
                      >
                        {q}
                      </button>
                    ))}
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

      <AlertDialog open={!!pendingPipeline} onOpenChange={(o) => !o && setPendingPipeline(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run full pipeline?</AlertDialogTitle>
            <AlertDialogDescription>
              This will launch the <span className="font-mono">{pendingPipeline}</span> pipeline,
              which can perform multiple bulk updates across your catalogue. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPipelineLaunch}>Run pipeline</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
