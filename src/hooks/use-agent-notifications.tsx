import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AgentNotificationState {
  pendingApprovals: number;
  agentActive: boolean;
  ready: boolean;
}

const Ctx = createContext<AgentNotificationState>({
  pendingApprovals: 0,
  agentActive: false,
  ready: false,
});

export const useAgentNotifications = () => useContext(Ctx);

const ACTIVE_RUN_STATUSES = new Set(["planning", "executing", "awaiting_approval"]);

export const AgentNotificationsProvider = ({ children }: { children: ReactNode }) => {
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [agentActive, setAgentActive] = useState(false);
  const [ready, setReady] = useState(false);
  const seenApprovalIds = useRef<Set<string>>(new Set());
  const seenRunIds = useRef<Map<string, string>>(new Map()); // id -> last status

  useEffect(() => {
    let cancelled = false;
    let approvalsChannel: ReturnType<typeof supabase.channel> | null = null;
    let runsChannel: ReturnType<typeof supabase.channel> | null = null;
    let shopIds: string[] = [];

    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid || cancelled) return;

      const { data: shops } = await supabase
        .from("shop_users")
        .select("shop_id")
        .eq("user_id", uid);
      shopIds = (shops ?? []).map((s: any) => s.shop_id).filter(Boolean);
      if (shopIds.length === 0) {
        setReady(true);
        return;
      }

      // Seed counts + de-dup sets
      const { data: pendingRows } = await supabase
        .from("sonic_approval_queue")
        .select("id, status")
        .in("shop_id", shopIds)
        .eq("status", "pending");
      const pendIds = (pendingRows ?? []).map((r: any) => r.id);
      pendIds.forEach((id) => seenApprovalIds.current.add(id));
      if (!cancelled) setPendingApprovals(pendIds.length);

      const { data: activeRows } = await supabase
        .from("sonic_agent_runs")
        .select("id, status")
        .in("shop_id", shopIds)
        .in("status", ["planning", "executing", "awaiting_approval"]);
      (activeRows ?? []).forEach((r: any) => seenRunIds.current.set(r.id, r.status));
      if (!cancelled) setAgentActive((activeRows ?? []).length > 0);

      setReady(true);

      // Realtime — approvals
      approvalsChannel = supabase
        .channel("sonic-approvals-notify")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "sonic_approval_queue" },
          (payload) => {
            const row: any = payload.new ?? payload.old;
            if (!row || !shopIds.includes(row.shop_id)) return;

            if (payload.eventType === "INSERT" && row.status === "pending") {
              if (!seenApprovalIds.current.has(row.id)) {
                seenApprovalIds.current.add(row.id);
                setPendingApprovals((n) => n + 1);
                toast(`Approval needed: ${row.title ?? "Untitled"}`, {
                  description: "Review the agent's proposed actions",
                  action: {
                    label: "Review →",
                    onClick: () => {
                      window.location.href = "/approvals";
                    },
                  },
                });
              }
            } else if (payload.eventType === "UPDATE") {
              const wasPending = seenApprovalIds.current.has(row.id);
              const isPending = row.status === "pending";
              if (wasPending && !isPending) {
                seenApprovalIds.current.delete(row.id);
                setPendingApprovals((n) => Math.max(0, n - 1));
              } else if (!wasPending && isPending) {
                seenApprovalIds.current.add(row.id);
                setPendingApprovals((n) => n + 1);
              }
            } else if (payload.eventType === "DELETE") {
              if (seenApprovalIds.current.has(row.id)) {
                seenApprovalIds.current.delete(row.id);
                setPendingApprovals((n) => Math.max(0, n - 1));
              }
            }
          }
        )
        .subscribe();

      // Realtime — agent runs
      runsChannel = supabase
        .channel("sonic-runs-notify")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "sonic_agent_runs" },
          (payload) => {
            const row: any = payload.new ?? payload.old;
            if (!row || !shopIds.includes(row.shop_id)) return;

            const prev = seenRunIds.current.get(row.id);
            const status = row.status;

            if (status && ACTIVE_RUN_STATUSES.has(status)) {
              seenRunIds.current.set(row.id, status);
            } else {
              seenRunIds.current.delete(row.id);
            }
            setAgentActive(seenRunIds.current.size > 0);

            // Completion / failure toasts (transitions only)
            if (prev && !ACTIVE_RUN_STATUSES.has(status)) {
              if (status === "completed") {
                const summary = (row.plan_summary ?? "").toString().slice(0, 60);
                toast.success(`Agent completed${summary ? `: ${summary}` : ""}`);
              } else if (status === "failed") {
                toast.error(`Agent failed: ${row.error_message ?? "Unknown error"}`, {
                  action: {
                    label: "View details →",
                    onClick: () => {
                      window.location.href = `/agent?run_id=${row.id}`;
                    },
                  },
                });
              }
            }
          }
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (approvalsChannel) supabase.removeChannel(approvalsChannel);
      if (runsChannel) supabase.removeChannel(runsChannel);
    };
  }, []);

  return (
    <Ctx.Provider value={{ pendingApprovals, agentActive, ready }}>
      {children}
    </Ctx.Provider>
  );
};
