import { useEffect, useState } from "react";
import { Bot, ChevronRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

function relTime(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? "1h ago" : `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(iso).toLocaleDateString();
}

interface ActivityItem {
  text: string;
  at: string | null;
}

interface Props {
  onOpenAutopilot: () => void;
}

const HomeAutopilotCard = ({ onOpenAutopilot }: Props) => {
  const [loading, setLoading] = useState(true);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setLoading(false); return; }

        const [{ data: wfRows }, { count }] = await Promise.all([
          supabase
            .from("collection_workflows" as any)
            .select("summary, actions_taken, completed_at, created_at, status")
            .eq("user_id", user.id)
            .eq("status", "complete")
            .order("completed_at", { ascending: false, nullsFirst: false })
            .limit(5),
          supabase
            .from("collection_approval_queue" as any)
            .select("id", { count: "exact", head: true })
            .eq("user_id", user.id)
            .eq("status", "pending"),
        ]);

        if (cancelled) return;

        const items: ActivityItem[] = [];
        for (const row of (wfRows || []) as any[]) {
          const at = row.completed_at || row.created_at;
          const actions = Array.isArray(row.actions_taken) ? row.actions_taken : [];
          if (actions.length > 0) {
            for (const a of actions.slice(0, 2)) {
              const verb = a?.type === "ARCHIVE_COLLECTION" ? "Archived" :
                           a?.type === "GENERATE_SEO" ? "SEO updated for" :
                           "Created";
              const name = a?.title || a?.collection_title || a?.handle || "collection";
              items.push({ text: `${verb} "${name}"`, at });
              if (items.length >= 5) break;
            }
          } else if (row.summary) {
            items.push({ text: row.summary, at });
          }
          if (items.length >= 5) break;
        }

        setActivity(items.slice(0, 3));
        setPending(count ?? 0);
      } catch {
        /* noop */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return null;

  const hasRun = activity.length > 0;

  return (
    <div
      className="rounded-xl p-4 mb-4"
      style={{
        background: "rgba(30, 27, 75, 0.4)",
        border: "1px solid rgba(99, 102, 241, 0.3)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-indigo-300" />
          <span className="text-sm font-semibold text-foreground">Collection Autopilot</span>
        </div>
        <div className="flex items-center gap-1.5">
          <HowToVideoButton
            videoSrc="/howto/collection-autopilot.mp4"
            title="Collection Autopilot"
            description="See how Autopilot detects new brands & style lines, drafts SEO, and queues approvals."
            label="Watch how Collection Autopilot works"
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[11px] text-indigo-300 hover:text-indigo-200 hover:bg-indigo-500/10"
            onClick={onOpenAutopilot}
          >
            {hasRun ? "Configure" : "Set up"} <ChevronRight className="w-3 h-3 ml-0.5" />
          </Button>
        </div>
      </div>

      {hasRun ? (
        <>
          <p className="text-[11px] text-muted-foreground mb-2">Recent activity:</p>
          <ul className="space-y-1 mb-3">
            {activity.map((a, i) => (
              <li key={i} className="text-xs text-foreground/90 flex items-start gap-1.5">
                <span className="text-indigo-400 mt-0.5">•</span>
                <span className="flex-1 truncate">
                  {a.text}
                  {a.at && <span className="text-muted-foreground"> — {relTime(a.at)}</span>}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between pt-2 border-t border-indigo-500/20">
            <div className="flex items-center gap-1.5">
              <span className="relative flex w-2 h-2">
                {pending > 0 && (
                  <span className="absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75 animate-ping" />
                )}
                <span className={`relative inline-flex rounded-full h-2 w-2 ${pending > 0 ? "bg-orange-400" : "bg-slate-500"}`} />
              </span>
              <span className={`text-xs ${pending > 0 ? "text-orange-300 font-medium" : "text-muted-foreground"}`}>
                {pending > 0 ? `${pending} pending approval${pending === 1 ? "" : "s"}` : "No pending approvals"}
              </span>
            </div>
            {pending > 0 && (
              <Button
                size="sm"
                className="h-7 text-[11px] bg-indigo-500 hover:bg-indigo-400 text-white"
                onClick={onOpenAutopilot}
              >
                Review now <ChevronRight className="w-3 h-3 ml-0.5" />
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
            Automatically create and manage Shopify collections after every invoice.
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-foreground/80 mb-3">
            <span>✨ Brand stories</span>
            <span>🏷️ Brand pages</span>
            <span>📂 Categories</span>
            <span>⭐ Feature collections</span>
          </div>
          <Button
            className="w-full h-9 bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-semibold"
            onClick={onOpenAutopilot}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Enable Collection Autopilot
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </>
      )}
    </div>
  );
};

export default HomeAutopilotCard;
