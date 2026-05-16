import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface Props {
  /** The flow name as it appears in sonic_agent_actions.flow_name */
  flowName: string;
  /** Optional human-readable label for the toast/button */
  flowLabel?: string;
  className?: string;
}

interface LastAction {
  id: string;
  status: string;
  completed_at: string | null;
  started_at: string;
  run_id: string;
}

const STATUS_ICON: Record<string, JSX.Element> = {
  completed: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />,
  failed: <XCircle className="w-3.5 h-3.5 text-destructive" />,
  rolled_back: <XCircle className="w-3.5 h-3.5 text-amber-500" />,
  executing: <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />,
  pending: <Clock className="w-3.5 h-3.5 text-muted-foreground" />,
};

const AgentDelegateBanner = ({ flowName, flowLabel, className }: Props) => {
  const [last, setLast] = useState<LastAction | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [shopId, setShopId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) {
        setLoading(false);
        return;
      }
      const { data: shopRow } = await supabase
        .from("shop_users")
        .select("shop_id")
        .eq("user_id", uid)
        .limit(1)
        .maybeSingle();
      if (!shopRow?.shop_id) {
        setLoading(false);
        return;
      }
      setShopId(shopRow.shop_id);

      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      // Join via run -> shop_id
      const { data: actions } = await supabase
        .from("sonic_agent_actions")
        .select("id, status, completed_at, started_at, run_id, sonic_agent_runs!inner(shop_id)")
        .eq("flow_name", flowName)
        .eq("sonic_agent_runs.shop_id", shopRow.shop_id)
        .gte("started_at", cutoff)
        .order("started_at", { ascending: false })
        .limit(1);

      if (actions && actions.length > 0) {
        const a: any = actions[0];
        setLast({
          id: a.id,
          status: a.status,
          completed_at: a.completed_at,
          started_at: a.started_at,
          run_id: a.run_id,
        });
      }
      setLoading(false);
    })();
  }, [flowName]);

  const delegate = async () => {
    if (!shopId) {
      toast.error("Connect a shop to delegate to the agent");
      return;
    }
    setTriggering(true);
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sonic-agent-api/runs/trigger`;
      const { data: sess } = await supabase.auth.getSession();
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${sess.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          shop_id: shopId,
          trigger_type: "user_chat",
          trigger_payload: {
            request: `Run the ${flowLabel ?? flowName} flow`,
            flow_name: flowName,
          },
          force: true,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      toast.success("Agent run queued", {
        description: "Track progress in the agent panel",
        action: {
          label: "Open →",
          onClick: () => {
            window.location.href = json.run_id ? `/agent?run_id=${json.run_id}` : "/agent";
          },
        },
      });
    } catch (e: any) {
      toast.error(`Couldn't delegate: ${e?.message ?? "Unknown error"}`);
    } finally {
      setTriggering(false);
    }
  };

  if (loading) return null;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/60 px-3 py-2 ${className ?? ""}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Sparkles className="w-4 h-4 text-primary shrink-0" />
        {last ? (
          <div className="flex items-center gap-2 text-xs min-w-0">
            <span className="text-muted-foreground">Last agent run:</span>
            <span className="text-foreground">
              {formatDistanceToNow(new Date(last.completed_at ?? last.started_at), {
                addSuffix: true,
              })}
            </span>
            <Badge variant="outline" className="gap-1 text-[10px]">
              {STATUS_ICON[last.status] ?? null}
              {last.status}
            </Badge>
            <a
              href={`/agent?run_id=${last.run_id}`}
              className="text-primary hover:underline whitespace-nowrap"
            >
              View →
            </a>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            No recent agent activity for this flow
          </span>
        )}
      </div>
      <Button size="sm" variant="outline" onClick={delegate} disabled={triggering}>
        {triggering ? (
          <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
        ) : (
          <Sparkles className="w-3.5 h-3.5 mr-1.5" />
        )}
        Delegate to agent
      </Button>
    </div>
  );
};

export default AgentDelegateBanner;
