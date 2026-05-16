import { useEffect, useMemo, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, AlertTriangle, Sunrise } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface BriefingRun {
  id: string;
  plan_summary: string | null;
  completed_at: string | null;
  started_at: string | null;
}

interface ChipDef {
  label: string;
  to?: string;
  match: RegExp;
}

// Quick CTA chips per topic. Only render the chip if the bullet text matches.
const TOPIC_CHIPS: ChipDef[] = [
  { label: "Process inbox", to: "/agent", match: /inbox|invoice/i },
  { label: "Restock plan", to: "/dashboard", match: /stock|low|sold out/i },
  { label: "Run markdown", to: "/rules", match: /slow|markdown/i },
  { label: "View performance", to: "/dashboard", match: /ads|roas|performance/i },
  { label: "Audit log", to: "/audit-log", match: /night|autonomous|action|audit/i },
];

function relativeTime(iso: string | null) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  const diffMin = Math.round((Date.now() - t) / 60000);
  const d = new Date(iso);
  const hm = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (diffMin < 60) return `${diffMin}m ago`;
  const hours = diffMin / 60;
  if (hours < 18) return `today, ${hm}`;
  if (hours < 42) return `yesterday, ${hm}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + `, ${hm}`;
}

export default function DailyBriefing() {
  const [run, setRun] = useState<BriefingRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("sonic_agent_runs")
      .select("id, plan_summary, completed_at, started_at")
      .eq("trigger_type", "cron_daily_briefing")
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setRun((data as BriefingRun) ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const stale = useMemo(() => {
    if (!run?.completed_at) return false;
    return Date.now() - new Date(run.completed_at).getTime() > 36 * 3600 * 1000;
  }, [run]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch(
        `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/sonic-agent-api/runs/trigger`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ trigger_type: "cron_daily_briefing", force: true }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Briefing refresh queued");
      setTimeout(load, 1500);
    } catch (e: any) {
      toast.error(`Couldn't refresh briefing: ${e?.message ?? "unknown error"}`);
    } finally {
      setRefreshing(false);
    }
  };

  // Empty state
  if (!loading && !run) {
    return (
      <Card className="p-5 mb-6 bg-gradient-to-br from-amber-50/60 to-background dark:from-amber-950/20 border-amber-200/60 dark:border-amber-900/40">
        <div className="flex items-start gap-3">
          <Sunrise className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <h3 className="text-base font-semibold font-display">Morning Briefing</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Your first briefing arrives tomorrow at 8am. Until then, here's how the agent works →{" "}
              <Link to="/how-it-works" className="text-primary underline underline-offset-2">Learn more</Link>
            </p>
          </div>
        </div>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className="p-5 mb-6 animate-pulse">
        <div className="h-4 w-40 bg-muted rounded mb-3" />
        <div className="space-y-2">
          <div className="h-3 w-full bg-muted rounded" />
          <div className="h-3 w-5/6 bg-muted rounded" />
          <div className="h-3 w-4/6 bg-muted rounded" />
        </div>
      </Card>
    );
  }

  const summary = run?.plan_summary?.trim() || "";

  // Split into bullets so we can render chips per topic
  const bullets = summary
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^([-*\d]|\p{Emoji})/u.test(l));

  return (
    <Card className="p-5 mb-6 bg-gradient-to-br from-primary/5 to-background border-primary/20">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Sunrise className="w-5 h-5 text-primary" />
          <h3 className="text-base font-semibold font-display">Morning Briefing</h3>
          <span className="text-xs text-muted-foreground">{relativeTime(run?.completed_at ?? null)}</span>
          {stale && (
            <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300 gap-1">
              <AlertTriangle className="w-3 h-3" /> Briefing missed yesterday
            </Badge>
          )}
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label="Refresh briefing"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {bullets.length > 0 ? (
        <ul className="space-y-3">
          {bullets.map((b, i) => {
            const chips = TOPIC_CHIPS.filter((c) => c.match.test(b));
            return (
              <li key={i} className="text-sm leading-relaxed">
                <div className="prose prose-sm dark:prose-invert max-w-none [&_p]:my-0">
                  <ReactMarkdown>{b.replace(/^[-*]\s*/, "")}</ReactMarkdown>
                </div>
                {chips.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {chips.map((c) => (
                      <button
                        key={c.label}
                        onClick={() => c.to && navigate(c.to)}
                        className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown>{summary}</ReactMarkdown>
        </div>
      )}
    </Card>
  );
}
