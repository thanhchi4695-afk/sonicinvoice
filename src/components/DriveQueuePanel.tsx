import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CheckCircle2, AlertCircle, Clock, RotateCw, X, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface QueueItem {
  id: string;
  file_name: string;
  status: "queued" | "processing" | "done" | "failed";
  error: string | null;
  created_at: string;
  finished_at: string | null;
  pattern_id: string | null;
  source: string;
  batch_id: string | null;
}

/**
 * DriveQueuePanel — Realtime-subscribed view of the user's processing_queue.
 * Replaces the in-memory drive batch state so navigation never loses progress
 * (Bug #3) and surfaces server-side worker progress (Bug #2, #10).
 */
export default function DriveQueuePanel() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const init = async () => {
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess.session?.user?.id;
      if (!userId) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("processing_queue")
        .select("id, file_name, status, error, created_at, finished_at, pattern_id, source, batch_id")
        .order("created_at", { ascending: false })
        .limit(50);
      if (!cancelled) {
        setItems((data || []) as QueueItem[]);
        setLoading(false);
      }

      channel = supabase
        .channel("processing_queue_panel")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "processing_queue", filter: `user_id=eq.${userId}` },
          (payload) => {
            setItems((prev) => {
              const row = (payload.new || payload.old) as QueueItem;
              if (payload.eventType === "DELETE") {
                return prev.filter((p) => p.id !== row.id);
              }
              const next = payload.new as QueueItem;
              const idx = prev.findIndex((p) => p.id === next.id);
              if (idx === -1) return [next, ...prev].slice(0, 50);
              const copy = [...prev];
              copy[idx] = next;
              return copy;
            });
          },
        )
        .subscribe();
    };

    void init();
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  const active = items.filter((i) => i.status === "queued" || i.status === "processing");
  const recent = items.filter((i) => i.status === "done" || i.status === "failed").slice(0, 5);
  const total = items.length;
  const done = items.filter((i) => i.status === "done").length;
  const failed = items.filter((i) => i.status === "failed").length;

  if (loading) return null;
  if (items.length === 0) return null;

  const handleRetry = async (id: string) => {
    const { error } = await supabase
      .from("processing_queue")
      .update({ status: "queued", error: null, started_at: null, finished_at: null, attempts: 0 })
      .eq("id", id);
    if (error) {
      toast.error("Could not retry", { description: error.message });
    } else {
      toast.success("Re-queued", { description: "The worker will pick it up within ~30s" });
    }
  };

  const handleCancel = async (id: string) => {
    const { error } = await supabase.from("processing_queue").delete().eq("id", id);
    if (error) toast.error("Could not cancel", { description: error.message });
  };

  const handleClearFinished = async () => {
    const ids = items.filter((i) => i.status === "done" || i.status === "failed").map((i) => i.id);
    if (ids.length === 0) return;
    const { error } = await supabase.from("processing_queue").delete().in("id", ids);
    if (error) toast.error("Could not clear", { description: error.message });
  };

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3" aria-live="polite">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold">
          Drive batch · {done}/{total} processed
          {failed > 0 && <span className="ml-2 text-destructive">· {failed} failed</span>}
        </p>
        {recent.length > 0 && (
          <button
            onClick={() => void handleClearFinished()}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            Clear finished
          </button>
        )}
      </div>

      {active.length > 0 && (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {active.map((q) => (
            <div key={q.id} className="flex items-center gap-2 text-xs">
              <span className="w-4 shrink-0 text-center">
                {q.status === "processing" ? (
                  <Loader2 className="w-3 h-3 animate-spin text-primary inline" />
                ) : (
                  <Clock className="w-3 h-3 text-muted-foreground inline" />
                )}
              </span>
              <span className="truncate flex-1">{q.file_name}</span>
              <span className="text-[10px] text-muted-foreground capitalize">{q.status}</span>
              <button
                onClick={() => void handleCancel(q.id)}
                className="text-[10px] text-muted-foreground hover:text-destructive"
                title="Remove from queue"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
          {recent.map((q) => (
            <div key={q.id} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2 text-xs">
                <span className="w-4 shrink-0 text-center">
                  {q.status === "done" ? (
                    <CheckCircle2 className="w-3 h-3 text-primary inline" />
                  ) : (
                    <AlertCircle className="w-3 h-3 text-destructive inline" />
                  )}
                </span>
                <span className={cn("truncate flex-1", q.status === "done" && "text-muted-foreground")}>
                  {q.file_name}
                </span>
                {q.status === "failed" && (
                  <button
                    onClick={() => void handleRetry(q.id)}
                    className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5"
                  >
                    <RotateCw className="w-3 h-3" /> Retry
                  </button>
                )}
              </div>
              {q.status === "failed" && q.error && (
                <p className="text-[10px] text-destructive/80 pl-6 truncate" title={q.error}>
                  {q.error}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1">
        <FileText className="w-3 h-3" />
        Files are downloaded server-side and saved as <strong>pending review</strong> in Processing History. You can navigate away — we'll keep working.
      </p>
    </div>
  );
}
