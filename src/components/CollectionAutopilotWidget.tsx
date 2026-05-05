import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface Props {
  collapsed?: boolean;
  onOpen: () => void;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "Never run";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export const CollectionAutopilotWidget = ({ collapsed, onOpen }: Props) => {
  const [pending, setPending] = useState(0);
  const [lastRun, setLastRun] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const [{ count }, { data: lastRow }] = await Promise.all([
          supabase
            .from("collection_approval_queue" as any)
            .select("id", { count: "exact", head: true })
            .eq("user_id", user.id)
            .eq("status", "pending"),
          supabase
            .from("collection_workflows" as any)
            .select("created_at")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        if (cancelled) return;
        setPending(count ?? 0);
        setLastRun((lastRow as any)?.created_at ?? null);
      } catch {
        /* noop */
      }
    };
    load();
    const interval = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (collapsed) {
    return (
      <button
        onClick={onOpen}
        title={`Collection Autopilot${pending > 0 ? ` · ${pending} pending` : ""}`}
        className="relative flex justify-center w-full py-2 my-1 text-indigo-300 hover:text-indigo-200"
      >
        <Bot className="w-5 h-5" />
        {pending > 0 && (
          <span className="absolute top-1 right-2 w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
        )}
      </button>
    );
  }

  return (
    <button
      onClick={onOpen}
      className={cn(
        "block w-full text-left transition-colors",
        "rounded-[10px] px-3 py-2.5 my-1 mx-2",
        "hover:bg-indigo-950/60",
      )}
      style={{
        background: "rgba(30, 27, 75, 0.4)",
        border: "1px solid rgba(99, 102, 241, 0.3)",
      }}
    >
      <div className="flex items-center gap-2 text-indigo-100">
        <Bot className="w-4 h-4 shrink-0 text-indigo-300" />
        <span className="text-xs font-semibold truncate">Collection Autopilot</span>
      </div>
      <div className="flex items-center gap-1.5 mt-1">
        <span className="relative flex w-2 h-2 shrink-0">
          {pending > 0 && (
            <span className="absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75 animate-ping" />
          )}
          <span
            className={cn(
              "relative inline-flex rounded-full h-2 w-2",
              pending > 0 ? "bg-orange-400" : "bg-slate-500",
            )}
          />
        </span>
        <span className={cn("text-[11px]", pending > 0 ? "text-orange-300" : "text-slate-400")}>
          {pending > 0 ? `${pending} pending approval${pending === 1 ? "" : "s"}` : "No pending approvals"}
        </span>
      </div>
      <p className="text-[10px] text-slate-500 mt-0.5 truncate">
        Last ran: {formatRelative(lastRun)}
      </p>
    </button>
  );
};

export default CollectionAutopilotWidget;
