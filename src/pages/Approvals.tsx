import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  ExternalLink,
  Megaphone,
  Package,
  Palmtree,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

import type {
  ApprovalCategory,
  ApprovalPriority,
  SonicApprovalQueueItem,
  ProposedAction,
  EstimatedImpact,
} from "@/types/agent";

type Filter = "all" | ApprovalCategory;
type SortKey = "newest" | "priority" | "impact";

const CATEGORY_META: Record<
  ApprovalCategory,
  { label: string; stripe: string; icon: typeof Banknote }
> = {
  money_out: { label: "Money Out", stripe: "bg-amber-500", icon: Banknote },
  live_ads: { label: "Live Ads", stripe: "bg-red-500", icon: Megaphone },
  live_catalog: { label: "Live Catalog", stripe: "bg-blue-500", icon: Package },
  other: { label: "Other", stripe: "bg-slate-500", icon: ShieldAlert },
};

const PRIORITY_RANK: Record<ApprovalPriority, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const PRIORITY_VARIANT: Record<
  ApprovalPriority,
  "default" | "secondary" | "destructive" | "outline"
> = {
  urgent: "destructive",
  high: "destructive",
  medium: "default",
  low: "secondary",
};

const REJECT_REASONS = [
  "Wrong product selection",
  "Wrong amount",
  "Bad timing",
  "Other",
];

const SKIP_CONFIRM_KEY = "sonic_approvals_skip_confirm";
function getSkippedCategories(): Set<ApprovalCategory> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SKIP_CONFIRM_KEY) || "[]"));
  } catch {
    return new Set();
  }
}
function setSkippedCategory(cat: ApprovalCategory) {
  const s = getSkippedCategories();
  s.add(cat);
  localStorage.setItem(SKIP_CONFIRM_KEY, JSON.stringify([...s]));
}

function formatImpact(impact: EstimatedImpact | null | undefined): string | null {
  if (!impact) return null;
  if (typeof impact.money_out === "number") {
    const curr = impact.currency || "USD";
    return `${new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: curr,
    }).format(impact.money_out)} spend`;
  }
  if (typeof impact.products_affected === "number") {
    return `${impact.products_affected} products affected`;
  }
  const firstKey = Object.keys(impact)[0];
  if (firstKey) return `${impact[firstKey]} ${firstKey.replace(/_/g, " ")}`;
  return null;
}

function isExpired(item: SonicApprovalQueueItem): boolean {
  return !!item.expires_at && new Date(item.expires_at) < new Date();
}

export default function Approvals() {
  const [items, setItems] = useState<SonicApprovalQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<
    { ids: string[]; category: ApprovalCategory } | null
  >(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<string[] | null>(null);
  const [rejectReason, setRejectReason] = useState<string>("Wrong product selection");
  const [rejectNote, setRejectNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Initial load + realtime
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data, error } = await supabase
        .from("sonic_approval_queue")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (!mounted) return;
      if (error) toast.error(error.message);
      setItems((data as any) || []);
      setLoading(false);
    })();

    const channel = supabase
      .channel("sonic-approvals")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sonic_approval_queue" },
        (payload) => {
          setItems((prev) => {
            if (payload.eventType === "INSERT") {
              const row = payload.new as SonicApprovalQueueItem;
              if (row.status !== "pending") return prev;
              if (prev.find((x) => x.id === row.id)) return prev;
              toast.message("New approval request", { description: row.title });
              return [row, ...prev];
            }
            if (payload.eventType === "UPDATE") {
              const row = payload.new as SonicApprovalQueueItem;
              if (row.status !== "pending") {
                return prev.filter((x) => x.id !== row.id);
              }
              return prev.map((x) => (x.id === row.id ? row : x));
            }
            if (payload.eventType === "DELETE") {
              return prev.filter((x) => x.id !== (payload.old as any).id);
            }
            return prev;
          });
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  const filtered = useMemo(() => {
    let list = items;
    if (filter !== "all") list = list.filter((x) => x.category === filter);
    if (sort === "priority") {
      list = [...list].sort(
        (a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority],
      );
    } else if (sort === "impact") {
      list = [...list].sort(
        (a, b) =>
          Number(b.estimated_impact?.money_out ?? 0) -
          Number(a.estimated_impact?.money_out ?? 0),
      );
    }
    return list;
  }, [items, filter, sort]);

  const active = useMemo(
    () => items.find((x) => x.id === activeId) || filtered[0] || null,
    [items, activeId, filtered],
  );

  const selectedItems = useMemo(
    () => items.filter((x) => selected.has(x.id)),
    [items, selected],
  );

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function callDecide(
    approvalId: string,
    decision: "approve" | "reject",
    reason?: string,
  ) {
    const { data, error } = await supabase.functions.invoke(
      `sonic-approval-decide/${approvalId}`,
      { body: { decision, reason } },
    );
    if (error) throw new Error(error.message);
    if ((data as any)?.error) throw new Error((data as any).error);
    return data;
  }

  async function runApprove(ids: string[]) {
    setBusy(true);
    try {
      const results = await Promise.allSettled(
        ids.map((id) => callDecide(id, "approve")),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const fail = results.length - ok;
      if (ok) toast.success(`Approved ${ok}`);
      if (fail) toast.error(`${fail} failed`);
      setSelected(new Set());
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function runReject(ids: string[]) {
    setBusy(true);
    try {
      const reason = rejectReason === "Other" ? rejectNote : rejectReason;
      const results = await Promise.allSettled(
        ids.map((id) => callDecide(id, "reject", reason)),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const fail = results.length - ok;
      if (ok) toast.success(`Rejected ${ok}`);
      if (fail) toast.error(`${fail} failed`);
      setSelected(new Set());
      setRejectOpen(false);
      setRejectNote("");
      setRejectReason("Wrong product selection");
    } finally {
      setBusy(false);
    }
  }

  function requestApprove(ids: string[]) {
    if (ids.length === 0) return;
    const cats = new Set(
      items.filter((x) => ids.includes(x.id)).map((x) => x.category),
    );
    if (cats.size > 1) {
      toast.error("Mixed categories", {
        description: "Bulk approval requires items from a single category.",
      });
      return;
    }
    const cat = [...cats][0];
    if (getSkippedCategories().has(cat)) {
      void runApprove(ids);
      return;
    }
    setConfirmTarget({ ids, category: cat });
    setConfirmOpen(true);
  }

  function requestReject(ids: string[]) {
    if (ids.length === 0) return;
    setRejectTarget(ids);
    setRejectOpen(true);
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 py-6">
        {/* Top bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">Approval Inbox</h1>
            <Badge variant="secondary" className="text-base">
              {items.length}
            </Badge>
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="priority">Highest priority</SelectItem>
              <SelectItem value="impact">Highest impact</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Filter chips */}
        <div className="flex flex-wrap gap-2 mb-4">
          {(["all", "money_out", "live_ads", "live_catalog"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-3 py-1.5 rounded-full text-sm border transition",
                filter === f
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-foreground border-border hover:bg-muted",
              )}
            >
              {f === "all" ? "All" : CATEGORY_META[f as ApprovalCategory].label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 ? (
          <Card className="p-10 text-center">
            <Palmtree className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <div className="text-lg font-medium">
              Inbox zero. Nothing waiting for your approval right now. 🌴
            </div>
            <Link
              to="/audit"
              className="text-sm text-primary hover:underline mt-2 inline-block"
            >
              Looking for past approvals? View history →
            </Link>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {/* List */}
            <div className="md:col-span-3 space-y-3">
              {filtered.map((item) => {
                const meta = CATEGORY_META[item.category];
                const Icon = meta.icon;
                const isActive = active?.id === item.id;
                const isMoneyOut = item.category === "money_out";
                const expired = isExpired(item);
                const impact = formatImpact(item.estimated_impact);
                return (
                  <Card
                    key={item.id}
                    onClick={() => setActiveId(item.id)}
                    className={cn(
                      "relative overflow-hidden cursor-pointer transition border",
                      isActive ? "border-primary border-2" : "hover:shadow-md",
                      isMoneyOut && "py-1",
                    )}
                  >
                    <div className={cn("absolute left-0 top-0 bottom-0 w-1", meta.stripe)} />
                    <div className="flex items-start gap-3 p-4 pl-5">
                      <Checkbox
                        checked={selected.has(item.id)}
                        onCheckedChange={() => toggleSelect(item.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Icon className="w-4 h-4 text-muted-foreground" />
                          <h3
                            className={cn(
                              "font-semibold truncate",
                              isMoneyOut ? "text-lg" : "text-base",
                            )}
                          >
                            {item.title}
                          </h3>
                        </div>
                        {item.description && (
                          <p className="text-sm text-muted-foreground line-clamp-1 mb-2">
                            {item.description}
                          </p>
                        )}
                        {impact && (
                          <div
                            className={cn(
                              "text-sm",
                              isMoneyOut && "font-bold text-amber-600 dark:text-amber-400",
                            )}
                          >
                            {impact}
                          </div>
                        )}
                        {expired && (
                          <div className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            Expired — re-trigger if still relevant
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <Badge variant={PRIORITY_VARIANT[item.priority]}>
                          {item.priority}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(item.created_at), {
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>

            {/* Detail panel */}
            <div className="md:col-span-2">
              {active && (
                <Card className="p-5 md:sticky md:top-4">
                  <ApprovalDetail
                    item={active}
                    onApprove={() => requestApprove([active.id])}
                    onReject={() => requestReject([active.id])}
                    busy={busy}
                  />
                </Card>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {selectedItems.length >= 2 && (
        <div className="fixed bottom-0 inset-x-0 bg-card border-t border-border p-3 flex items-center justify-between gap-3 shadow-lg z-40">
          <div className="text-sm">
            <strong>{selectedItems.length}</strong> selected
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => requestReject(selectedItems.map((x) => x.id))}
              disabled={busy}
            >
              <XCircle className="w-4 h-4 mr-1" />
              Reject {selectedItems.length}
            </Button>
            <Button
              onClick={() => requestApprove(selectedItems.map((x) => x.id))}
              disabled={busy}
            >
              <CheckCircle2 className="w-4 h-4 mr-1" />
              Approve {selectedItems.length}
            </Button>
          </div>
        </div>
      )}

      {/* Approve confirmation */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve {confirmTarget?.ids.length || 0}?</DialogTitle>
            <DialogDescription>
              This will trigger the proposed actions immediately.
            </DialogDescription>
          </DialogHeader>
          {confirmTarget && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                id="skip"
                onCheckedChange={(v) => {
                  if (v && confirmTarget) setSkippedCategory(confirmTarget.category);
                }}
              />
              Don't ask again for {CATEGORY_META[confirmTarget.category].label}
            </label>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => confirmTarget && runApprove(confirmTarget.ids)}
              disabled={busy}
            >
              Yes, approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject {rejectTarget?.length || 0}?</DialogTitle>
            <DialogDescription>Tell the agent why so it can learn.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={rejectReason} onValueChange={setRejectReason}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REJECT_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {rejectReason === "Other" && (
              <Textarea
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="Add a note…"
                rows={3}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => rejectTarget && runReject(rejectTarget)}
              disabled={busy}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ApprovalDetail({
  item,
  onApprove,
  onReject,
  busy,
}: {
  item: SonicApprovalQueueItem;
  onApprove: () => void;
  onReject: () => void;
  busy: boolean;
}) {
  const meta = CATEGORY_META[item.category];
  const expired = isExpired(item);
  const actions: ProposedAction[] = Array.isArray(item.proposed_actions)
    ? item.proposed_actions
    : [];
  const impact = item.estimated_impact || {};

  return (
    <div className="space-y-4">
      <div>
        <Badge className={cn("mb-2", meta.stripe, "text-white border-0")}>
          {meta.label}
        </Badge>
        <h2 className="text-xl font-semibold">{item.title}</h2>
        {item.description && (
          <p className="text-sm text-muted-foreground mt-1">{item.description}</p>
        )}
      </div>

      {Object.keys(impact).length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
            Estimated Impact
          </h3>
          <table className="w-full text-sm">
            <tbody>
              {Object.entries(impact).map(([k, v]) => (
                <tr key={k} className="border-b border-border last:border-0">
                  <td className="py-1.5 text-muted-foreground capitalize">
                    {k.replace(/_/g, " ")}
                  </td>
                  <td className="py-1.5 text-right font-medium">{String(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
          Proposed Actions ({actions.length})
        </h3>
        <ol className="space-y-2 list-decimal list-inside">
          {actions.map((a, i) => (
            <li key={i} className="text-sm">
              <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                {a.flow_name}
              </span>
              {a.summary && <span className="ml-2">{a.summary}</span>}
              <details className="mt-1 ml-5">
                <summary className="text-xs text-muted-foreground cursor-pointer">
                  payload
                </summary>
                <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-x-auto">
                  {JSON.stringify(a.input_payload, null, 2)}
                </pre>
              </details>
            </li>
          ))}
        </ol>
      </div>

      {item.run_id && (
        <Link
          to={`/agent?run_id=${item.run_id}`}
          className="text-sm text-primary hover:underline inline-flex items-center gap-1"
        >
          View originating run <ExternalLink className="w-3 h-3" />
        </Link>
      )}

      {expired && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          Expired — re-trigger if still relevant
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <Button
          className="flex-1 bg-green-600 hover:bg-green-700 text-white"
          onClick={onApprove}
          disabled={busy || expired}
        >
          <CheckCircle2 className="w-4 h-4 mr-1" />
          Approve
        </Button>
        <Button
          variant="outline"
          className="flex-1"
          onClick={onReject}
          disabled={busy}
        >
          <XCircle className="w-4 h-4 mr-1" />
          Reject
        </Button>
      </div>
    </div>
  );
}
