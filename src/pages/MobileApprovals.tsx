import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, PanInfo } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { SonicApprovalQueueItem } from "@/types/agent";

const REJECT_REASONS = ["Wrong selection", "Wrong amount", "Bad timing", "Other"];

function fmtMoney(n: number | undefined, ccy = "AUD") {
  if (n === undefined || n === null) return null;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function vibrate(ms: number | number[]) {
  try { (navigator as any).vibrate?.(ms); } catch {}
}

const MobileApprovals = () => {
  const [items, setItems] = useState<SonicApprovalQueueItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [firstName, setFirstName] = useState<string>("");
  const [showRejectChips, setShowRejectChips] = useState(false);
  const [actioning, setActioning] = useState(false);

  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 0, 200], [-15, 0, 15]);
  const approveOpacity = useTransform(x, [0, 80, 160], [0, 0.5, 1]);
  const rejectOpacity = useTransform(x, [-160, -80, 0], [1, 0.5, 0]);

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const email = auth.user?.email ?? "";
      setFirstName((auth.user?.user_metadata?.full_name ?? email.split("@")[0] ?? "").split(" ")[0]);
      const uid = auth.user?.id;
      if (!uid) { setLoading(false); return; }

      const { data: shops } = await supabase
        .from("shop_users")
        .select("shop_id")
        .eq("user_id", uid);
      const shopIds = (shops ?? []).map((s: any) => s.shop_id);
      if (shopIds.length === 0) { setLoading(false); return; }

      const { data } = await supabase
        .from("sonic_approval_queue")
        .select("*")
        .in("shop_id", shopIds)
        .eq("status", "pending")
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true });
      setItems((data ?? []) as any);
      setLoading(false);
    })();
  }, []);

  const current = items[idx];
  const total = items.length;

  const next = () => {
    setShowRejectChips(false);
    x.set(0);
    setIdx((i) => i + 1);
  };

  const approve = async () => {
    if (!current || actioning) return;
    setActioning(true);
    vibrate([10, 30, 10]);
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("sonic_approval_queue")
      .update({
        status: "approved",
        approved_at: new Date().toISOString(),
        approved_by: auth.user?.id ?? null,
      })
      .eq("id", current.id);
    setActioning(false);
    if (error) {
      toast.error("Couldn't approve");
      x.set(0);
      return;
    }
    next();
  };

  const reject = async (reason: string) => {
    if (!current || actioning) return;
    setActioning(true);
    vibrate(50);
    const { error } = await supabase
      .from("sonic_approval_queue")
      .update({
        status: "rejected",
        rejection_reason: reason,
      })
      .eq("id", current.id);
    setActioning(false);
    if (error) {
      toast.error("Couldn't reject");
      x.set(0);
      setShowRejectChips(false);
      return;
    }
    next();
  };

  const onDragEnd = (_e: any, info: PanInfo) => {
    const dx = info.offset.x;
    if (dx > 140) {
      approve();
    } else if (dx < -140) {
      vibrate(20);
      setShowRejectChips(true);
      x.set(-80);
    } else {
      x.set(0);
    }
  };

  const categoryColor = useMemo(() => {
    switch (current?.category) {
      case "money_out": return "bg-amber-500/15 text-amber-400 border-amber-500/30";
      case "live_ads": return "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30";
      case "live_catalog": return "bg-teal-500/15 text-teal-400 border-teal-500/30";
      default: return "bg-muted text-muted-foreground border-border";
    }
  }, [current?.category]);

  if (loading) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const done = !current;

  return (
    <div className="min-h-dvh bg-background text-foreground flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { window.location.href = "/approvals"; }}
          className="text-muted-foreground"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Exit review
        </Button>
        {!done && (
          <div className="text-xs text-muted-foreground font-mono">
            {idx + 1} of {total}
          </div>
        )}
      </div>

      {/* Progress dots */}
      {!done && total > 1 && (
        <div className="flex gap-1 px-4 pb-3 shrink-0">
          {items.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i < idx ? "bg-primary/40" : i === idx ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>
      )}

      {/* Card stack */}
      <div className="flex-1 relative px-4 pb-4">
        <AnimatePresence mode="wait">
          {done ? (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute inset-x-4 inset-y-0 flex flex-col items-center justify-center text-center"
            >
              <div className="text-6xl mb-4">🌴</div>
              <h1 className="text-2xl font-bold mb-2">All caught up</h1>
              <p className="text-muted-foreground">
                Have a great day{firstName ? `, ${firstName}` : ""}.
              </p>
              <Button
                className="mt-8"
                onClick={() => { window.location.href = "/"; }}
              >
                Back to dashboard
              </Button>
            </motion.div>
          ) : (
            <motion.div
              key={current!.id}
              drag={showRejectChips || actioning ? false : "x"}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.8}
              style={{ x, rotate }}
              onDragEnd={onDragEnd}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="absolute inset-x-0 inset-y-0 mx-4 rounded-3xl border border-border bg-card shadow-2xl flex flex-col overflow-hidden touch-none"
            >
              {/* Swipe overlays */}
              <motion.div
                style={{ opacity: approveOpacity }}
                className="absolute inset-0 bg-emerald-500/15 flex items-start justify-start p-6 pointer-events-none"
              >
                <div className="border-4 border-emerald-500 text-emerald-500 font-black text-3xl rounded-xl px-3 py-1 rotate-[-12deg]">
                  APPROVE
                </div>
              </motion.div>
              <motion.div
                style={{ opacity: rejectOpacity }}
                className="absolute inset-0 bg-destructive/15 flex items-start justify-end p-6 pointer-events-none"
              >
                <div className="border-4 border-destructive text-destructive font-black text-3xl rounded-xl px-3 py-1 rotate-[12deg]">
                  REJECT
                </div>
              </motion.div>

              {/* Header */}
              <div className="p-5 pb-3 border-b border-border">
                <Badge variant="outline" className={`mb-2 ${categoryColor}`}>
                  {current!.category.replace("_", " ")}
                </Badge>
                <h2 className="text-xl font-bold leading-snug">{current!.title}</h2>
              </div>

              {/* Impact */}
              <div className="px-5 py-6 text-center border-b border-border">
                {current!.estimated_impact?.money_out !== undefined ? (
                  <>
                    <p className="text-xs uppercase text-muted-foreground tracking-wider mb-1">
                      Estimated impact
                    </p>
                    <p className="text-4xl font-bold font-mono text-amber-400">
                      {fmtMoney(
                        Number(current!.estimated_impact.money_out),
                        (current!.estimated_impact.currency as string) ?? "AUD"
                      )}
                    </p>
                  </>
                ) : current!.estimated_impact?.products_affected !== undefined ? (
                  <>
                    <p className="text-xs uppercase text-muted-foreground tracking-wider mb-1">
                      Products affected
                    </p>
                    <p className="text-4xl font-bold font-mono text-teal-400">
                      {String(current!.estimated_impact.products_affected)}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No quantified impact</p>
                )}
              </div>

              {/* Description + actions */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {current!.description && (
                  <p className="text-sm text-foreground/90 whitespace-pre-wrap">
                    {current!.description}
                  </p>
                )}
                {Array.isArray(current!.proposed_actions) && current!.proposed_actions.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                      Proposed actions
                    </p>
                    <ol className="space-y-2">
                      {current!.proposed_actions.map((a, i) => (
                        <li
                          key={i}
                          className="rounded-lg border border-border bg-muted/30 p-3 text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-muted-foreground">
                              {i + 1}.
                            </span>
                            <span className="font-medium">{a.flow_name}</span>
                          </div>
                          {a.summary && (
                            <p className="mt-1 text-xs text-muted-foreground">{a.summary}</p>
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>

              {/* Bottom action bar OR reject chips */}
              {showRejectChips ? (
                <div className="p-4 border-t border-border bg-card space-y-2">
                  <p className="text-xs text-muted-foreground text-center mb-1">
                    Why are you rejecting this?
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {REJECT_REASONS.map((r) => (
                      <Button
                        key={r}
                        variant="outline"
                        className="h-12"
                        disabled={actioning}
                        onClick={() => reject(r)}
                      >
                        {r}
                      </Button>
                    ))}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full mt-1"
                    onClick={() => { setShowRejectChips(false); x.set(0); }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="p-4 border-t border-border bg-card grid grid-cols-2 gap-3">
                  <Button
                    variant="outline"
                    size="lg"
                    className="h-16 text-base border-destructive/40 text-destructive hover:bg-destructive/10"
                    disabled={actioning}
                    onClick={() => { vibrate(20); setShowRejectChips(true); }}
                  >
                    <X className="w-5 h-5 mr-2" /> Reject
                  </Button>
                  <Button
                    size="lg"
                    className="h-16 text-base"
                    disabled={actioning}
                    onClick={approve}
                  >
                    {actioning ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        <Check className="w-5 h-5 mr-2" /> Approve
                      </>
                    )}
                  </Button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {!done && (
        <p className="text-[10px] text-center text-muted-foreground pb-2 shrink-0">
          Swipe right to approve · swipe left to reject
        </p>
      )}
    </div>
  );
};

export default MobileApprovals;
