import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { Send, Bot, CircleDot, Loader2, CheckCircle2, AlertTriangle, Clock, PauseCircle, ExternalLink } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type {
  SonicAgentAction,
  SonicAgentRun,
  AgentActionStatus,
} from "@/types/agent";

type ChatRole = "user" | "agent" | "system";

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  model?: string;
  pending?: boolean;
  action?: { action_id?: string; flow_name: string; autonomy_level?: string };
  approval?: { approval_id: string; title: string };
}

// Sonic Agent is reached via a server-side proxy edge function so the
// upstream API key never ships to the browser.
const AGENT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sonic-agent-proxy`;

const QUICK_ACTIONS = [
  { label: "Process inbox", message: "Check my inbox and process new invoices" },
  { label: "Today's briefing", message: "Give me today's briefing" },
  { label: "Slow stock report", message: "What slow stock should I markdown?" },
  { label: "Reorder check", message: "What should I reorder this week?" },
];

const STATUS_META: Record<AgentActionStatus | "default", { label: string; dot: string; icon: any }> = {
  pending: { label: "Pending", dot: "bg-muted-foreground", icon: Clock },
  executing: { label: "Executing", dot: "bg-blue-500", icon: Loader2 },
  awaiting_approval: { label: "Awaiting approval", dot: "bg-amber-500", icon: PauseCircle },
  approved: { label: "Approved", dot: "bg-emerald-500", icon: CheckCircle2 },
  rejected: { label: "Rejected", dot: "bg-rose-500", icon: AlertTriangle },
  completed: { label: "Completed", dot: "bg-emerald-500", icon: CheckCircle2 },
  failed: { label: "Failed", dot: "bg-rose-500", icon: AlertTriangle },
  rolled_back: { label: "Rolled back", dot: "bg-zinc-500", icon: AlertTriangle },
  default: { label: "Pending", dot: "bg-muted-foreground", icon: Clock },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[(status as AgentActionStatus) ?? "default"] ?? STATUS_META.default;
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
      <span className={`size-1.5 rounded-full ${meta.dot}`} />
      <Icon className={`size-3 ${status === "executing" ? "animate-spin" : ""}`} />
      {meta.label}
    </span>
  );
}

function TypingDots() {
  return (
    <div className="inline-flex gap-1" aria-label="Agent is thinking">
      <span className="size-1.5 rounded-full bg-foreground/60 animate-bounce [animation-delay:-0.3s]" />
      <span className="size-1.5 rounded-full bg-foreground/60 animate-bounce [animation-delay:-0.15s]" />
      <span className="size-1.5 rounded-full bg-foreground/60 animate-bounce" />
    </div>
  );
}

function RunPanel({
  run,
  actions,
  onActionClick,
}: {
  run: SonicAgentRun | null;
  actions: SonicAgentAction[];
  onActionClick: (a: SonicAgentAction) => void;
}) {
  if (!run) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        No active run. Try a quick action or ask the agent something.
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-base">
            <span>Current run</span>
            <StatusBadge status={run.status} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="text-muted-foreground">
            Trigger: <span className="text-foreground">{run.trigger_type}</span>
          </div>
          {run.dry_run && <Badge variant="outline">Dry run</Badge>}
          {run.plan_summary && (
            <p className="rounded-md bg-muted/50 p-2 text-foreground">{run.plan_summary}</p>
          )}
        </CardContent>
      </Card>

      <div>
        <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Actions ({actions.length})
        </h3>
        {actions.length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">No actions yet.</p>
        ) : (
          <ul className="space-y-2">
            {actions.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => onActionClick(a)}
                  className="w-full rounded-md border bg-card p-3 text-left transition hover:border-primary/50 hover:shadow-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm">{a.flow_name}</span>
                    <StatusBadge status={a.status} />
                  </div>
                  {a.diff_summary && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{a.diff_summary}</p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function Agent() {
  const [params, setParams] = useSearchParams();
  const urlRunId = params.get("run_id");

  const [shopId, setShopId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [runId, setRunId] = useState<string | null>(urlRunId);
  const [run, setRun] = useState<SonicAgentRun | null>(null);
  const [actions, setActions] = useState<SonicAgentAction[]>([]);
  const [actionDialog, setActionDialog] = useState<SonicAgentAction | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Resolve current user and primary shop
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled || !user) return;
      setUserId(user.id);
      const { data: membership } = await supabase
        .from("shop_users")
        .select("shop_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setShopId(membership?.shop_id ?? null);
    })();
    return () => { cancelled = true; };
  }, []);

  // Load run + actions when runId changes
  useEffect(() => {
    if (!runId) { setRun(null); setActions([]); return; }
    let cancelled = false;
    (async () => {
      const [{ data: r }, { data: a }] = await Promise.all([
        supabase.from("sonic_agent_runs").select("*").eq("id", runId).maybeSingle(),
        supabase.from("sonic_agent_actions").select("*").eq("run_id", runId).order("started_at"),
      ]);
      if (cancelled) return;
      setRun((r as SonicAgentRun) ?? null);
      setActions((a as SonicAgentAction[]) ?? []);
    })();
    return () => { cancelled = true; };
  }, [runId]);

  // Realtime: agent_actions and approvals for the active run
  useEffect(() => {
    if (!runId) return;
    const channel = supabase
      .channel(`agent-run-${runId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "sonic_agent_actions", filter: `run_id=eq.${runId}` },
        (payload) => {
          setActions((prev) => {
            const next = [...prev];
            const row = payload.new as SonicAgentAction;
            const idx = next.findIndex((x) => x.id === row.id);
            if (payload.eventType === "DELETE") {
              return next.filter((x) => x.id !== (payload.old as any).id);
            }
            if (idx === -1) next.push(row);
            else next[idx] = row;
            return next.sort((a, b) => (a.started_at ?? "").localeCompare(b.started_at ?? ""));
          });
        })
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "sonic_approval_queue", filter: `run_id=eq.${runId}` },
        (payload) => {
          const row = payload.new as { id: string; title: string };
          toast("Approval needed", {
            description: row.title,
            action: { label: "Review", onClick: () => { window.location.href = `/approvals?id=${row.id}`; } },
          });
          setMessages((m) => [
            ...m,
            { id: crypto.randomUUID(), role: "system", content: "Approval requested", approval: { approval_id: row.id, title: row.title } },
          ]);
        })
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "sonic_agent_runs", filter: `id=eq.${runId}` },
        (payload) => setRun(payload.new as SonicAgentRun))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [runId]);

  // Auto-scroll to bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const empty = messages.length === 0;

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;
      const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: trimmed };
      const placeholder: ChatMessage = { id: crypto.randomUUID(), role: "agent", content: "", pending: true };
      setMessages((m) => [...m, userMsg, placeholder]);
      setInput("");
      setSending(true);

      try {
        if (!AGENT_URL) {
          await new Promise((r) => setTimeout(r, 400));
          setMessages((m) =>
            m.map((x) =>
              x.id === placeholder.id
                ? {
                    ...x,
                    pending: false,
                    content:
                      "_Agent service not configured yet._ Set the `VITE_SONIC_AGENT_URL` environment variable to point at your deployed Sonic Agent service.",
                  }
                : x,
            ),
          );
          return;
        }

        const { data: { session } } = await supabase.auth.getSession();
        const resp = await fetch(`${AGENT_URL}/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({ message: trimmed, run_id: runId, shop_id: shopId, dry_run: dryRun }),
        });
        if (!resp.ok || !resp.body) throw new Error(`Agent service returned ${resp.status}`);

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let textSoFar = "";
        let model: string | undefined;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const evt = JSON.parse(data);
              if (evt.type === "run" && evt.run_id) {
                setRunId(evt.run_id);
                setParams((p) => { const n = new URLSearchParams(p); n.set("run_id", evt.run_id); return n; });
              } else if (evt.type === "model") {
                model = evt.model;
              } else if (evt.type === "token" && typeof evt.delta === "string") {
                textSoFar += evt.delta;
                setMessages((m) => m.map((x) => x.id === placeholder.id ? { ...x, content: textSoFar, model, pending: false } : x));
              } else if (evt.type === "action") {
                setMessages((m) => [...m, {
                  id: crypto.randomUUID(), role: "system",
                  content: `Action: ${evt.flow_name}`,
                  action: { action_id: evt.action_id, flow_name: evt.flow_name, autonomy_level: evt.autonomy_level },
                }]);
              } else if (evt.type === "approval_requested") {
                setMessages((m) => [...m, {
                  id: crypto.randomUUID(), role: "system",
                  content: "Approval requested",
                  approval: { approval_id: evt.approval_id, title: evt.title },
                }]);
              }
            } catch {
              // Plain text fallback — append as token
              textSoFar += data;
              setMessages((m) => m.map((x) => x.id === placeholder.id ? { ...x, content: textSoFar, pending: false } : x));
            }
          }
        }

        setMessages((m) => m.map((x) => x.id === placeholder.id ? { ...x, pending: false, content: textSoFar || x.content } : x));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setMessages((m) => m.map((x) => x.id === placeholder.id ? { ...x, pending: false, content: `_Error: ${msg}_` } : x));
        toast.error("Agent error", { description: msg });
      } finally {
        setSending(false);
      }
    },
    [sending, runId, shopId, dryRun, setParams],
  );

  const onSubmit = (e: React.FormEvent) => { e.preventDefault(); sendMessage(input); };

  const rightPanel = useMemo(
    () => <RunPanel run={run} actions={actions} onActionClick={setActionDialog} />,
    [run, actions],
  );

  return (
    <div className="flex h-[100dvh] flex-col bg-background">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar className="size-8 bg-indigo-500/10">
            <AvatarFallback className="bg-indigo-500/10 text-indigo-500"><Bot className="size-4" /></AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-base font-semibold leading-tight">Sonic Agent</h1>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CircleDot className={`size-3 ${AGENT_URL ? "text-emerald-500" : "text-amber-500"}`} />
              {AGENT_URL ? "Online" : "Not configured"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="dry-run" className="text-xs text-muted-foreground">Dry run</Label>
            <Switch id="dry-run" checked={dryRun} onCheckedChange={setDryRun} />
          </div>
          {/* Mobile run panel */}
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="md:hidden">Run</Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-[70vh] p-0">
              {rightPanel}
            </SheetContent>
          </Sheet>
        </div>
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {/* Chat column */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div
            ref={scrollRef}
            aria-live="polite"
            className="flex-1 overflow-y-auto px-4 py-6"
          >
            <div className="mx-auto flex max-w-2xl flex-col gap-4">
              {empty && (
                <Card className="border-indigo-500/20 bg-indigo-500/5">
                  <CardContent className="p-6">
                    <h2 className="mb-2 text-base font-semibold">Hi, I'm Sonic Agent.</h2>
                    <p className="text-sm text-muted-foreground">
                      I run your back-office tasks autonomously — invoices, briefings, slow-stock markdowns, reorder checks. Try a quick action below or just tell me what you need.
                    </p>
                  </CardContent>
                </Card>
              )}

              {messages.map((m) => {
                if (m.role === "user") {
                  return (
                    <div key={m.id} className="flex justify-end">
                      <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-primary-foreground">
                        <p className="whitespace-pre-wrap text-sm">{m.content}</p>
                      </div>
                    </div>
                  );
                }
                if (m.role === "system") {
                  return (
                    <div key={m.id} className="flex justify-center">
                      <div className="inline-flex flex-wrap items-center gap-2 rounded-full border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
                        {m.action ? (
                          <>
                            <CircleDot className="size-3" />
                            <span>Action: <span className="font-mono text-foreground">{m.action.flow_name}</span></span>
                          </>
                        ) : m.approval ? (
                          <>
                            <PauseCircle className="size-3 text-amber-500" />
                            <span>{m.approval.title}</span>
                            <Button asChild variant="link" size="sm" className="h-auto px-1 py-0 text-xs">
                              <Link to={`/approvals?id=${m.approval.approval_id}`}>
                                Review in inbox <ExternalLink className="ml-0.5 size-3" />
                              </Link>
                            </Button>
                          </>
                        ) : (
                          <span>{m.content}</span>
                        )}
                      </div>
                    </div>
                  );
                }
                // agent
                return (
                  <div key={m.id} className="flex gap-3">
                    <Avatar className="size-7 shrink-0 bg-indigo-500/10">
                      <AvatarFallback className="bg-indigo-500/10 text-indigo-500"><Bot className="size-3.5" /></AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 max-w-[80%]">
                      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">Sonic Agent</span>
                        {m.model && <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{m.model}</Badge>}
                      </div>
                      <div className="rounded-2xl rounded-tl-sm bg-secondary px-4 py-2 text-sm">
                        {m.pending && !m.content ? (
                          <TypingDots />
                        ) : (
                          <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                            <ReactMarkdown>{m.content}</ReactMarkdown>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Composer */}
          <div className="border-t bg-background">
            <div className="mx-auto w-full max-w-2xl px-4 py-3">
              <div className="mb-2 flex flex-wrap gap-2">
                {QUICK_ACTIONS.map((q) => (
                  <Button
                    key={q.label}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() => sendMessage(q.message)}
                    disabled={sending}
                  >
                    {q.label}
                  </Button>
                ))}
              </div>
              <form onSubmit={onSubmit} className="flex items-end gap-2">
                <Label htmlFor="agent-input" className="sr-only">Message the agent</Label>
                <Input
                  id="agent-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Tell the agent what you need…"
                  disabled={sending}
                  className="flex-1"
                />
                <Button type="submit" disabled={sending || !input.trim()} size="icon" aria-label="Send">
                  {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                </Button>
              </form>
            </div>
          </div>
        </main>

        {/* Run details — desktop */}
        <aside className="hidden w-[340px] shrink-0 border-l bg-muted/20 md:block">
          {rightPanel}
        </aside>
      </div>

      {/* Action detail dialog */}
      <Dialog open={!!actionDialog} onOpenChange={(o) => !o && setActionDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono text-base">{actionDialog?.flow_name}</DialogTitle>
          </DialogHeader>
          {actionDialog && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <StatusBadge status={actionDialog.status} />
                <Badge variant="outline">{actionDialog.autonomy_level}</Badge>
              </div>
              {actionDialog.diff_summary && (
                <div>
                  <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Summary</h4>
                  <p>{actionDialog.diff_summary}</p>
                </div>
              )}
              {actionDialog.error_message && (
                <div>
                  <h4 className="mb-1 text-xs font-semibold uppercase text-rose-500">Error</h4>
                  <p className="rounded bg-rose-500/10 p-2 text-rose-600">{actionDialog.error_message}</p>
                </div>
              )}
              {actionDialog.output_payload && (
                <div>
                  <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Output</h4>
                  <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">
                    {JSON.stringify(actionDialog.output_payload, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
