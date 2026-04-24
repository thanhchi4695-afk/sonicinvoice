// BudgetPill — compact monthly agent spend indicator.
// Subscribes to agent_budgets for the current user. Shows spent/cap with a
// progress bar, and switches to amber/destructive tones near the cap. Renders
// nothing if there is no row yet (the edge function creates it on first run).
import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface BudgetRow {
  user_id: string;
  monthly_cap_cents: number;
  spent_cents: number;
  degraded: boolean;
  month_start: string;
}

interface BudgetPillProps {
  /** Compact = single line for headers; Full = card layout for settings pages */
  variant?: "compact" | "full";
  className?: string;
}

const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function BudgetPill({ variant = "compact", className }: BudgetPillProps) {
  const [row, setRow] = useState<BudgetRow | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id ?? null);
    })();
  }, []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("agent_budgets")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (!cancelled) setRow((data as BudgetRow | null) ?? null);
    })();

    const channel = supabase
      .channel(`agent-budget-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_budgets", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          setRow(payload.new as BudgetRow);
        },
      )
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [userId]);

  if (!row) return null;

  const cap = Math.max(1, row.monthly_cap_cents);
  const pct = Math.min(100, Math.round((row.spent_cents / cap) * 100));
  const tone = row.degraded || pct >= 100
    ? "text-destructive border-destructive/40 bg-destructive/10"
    : pct >= 80
    ? "text-amber-600 border-amber-500/40 bg-amber-500/10"
    : "text-muted-foreground border-border bg-muted/30";

  if (variant === "compact") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border",
          tone,
          className,
        )}
        title={`Agent spend this month: ${fmt(row.spent_cents)} of ${fmt(cap)}${row.degraded ? " — budget saver mode active" : ""}`}
      >
        <Wallet className="w-2.5 h-2.5" />
        {fmt(row.spent_cents)}/{fmt(cap)}
      </span>
    );
  }

  return (
    <div className={cn("rounded-lg border border-border bg-card p-4", className)}>
      <div className="flex items-center gap-2 mb-2">
        <Wallet className="w-4 h-4 text-primary" />
        <h4 className="text-sm font-semibold flex-1">Agent budget</h4>
        <span className="text-xs text-muted-foreground">
          {fmt(row.spent_cents)} of {fmt(cap)}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full transition-all",
            row.degraded || pct >= 100 ? "bg-destructive" : pct >= 80 ? "bg-amber-500" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
        {row.degraded
          ? "Budget cap reached. Agent runs in budget-saver mode (deterministic decisions, no AI calls) until next month."
          : pct >= 80
          ? "Approaching the monthly cap. Once reached, the agent automatically falls back to deterministic rules."
          : "Monthly soft cap on AI decision calls. Resets on the 1st of each month."}
      </p>
    </div>
  );
}
