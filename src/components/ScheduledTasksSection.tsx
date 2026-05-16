import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Play, Clock, AlertTriangle, Pencil } from "lucide-react";
import { toast } from "sonner";
import cronstrue from "cronstrue";
import { CronExpressionParser } from "cron-parser";

interface Task {
  id: string;
  shop_id: string;
  name: string;
  description: string | null;
  cron_expression: string;
  timezone: string;
  enabled: boolean;
  trigger_type: string;
  trigger_payload: Record<string, unknown> | null;
  last_run_at: string | null;
  next_run_at: string | null;
}

const TIMEZONES = [
  "Australia/Darwin", "Australia/Sydney", "Australia/Melbourne", "Australia/Perth",
  "Australia/Brisbane", "Australia/Adelaide", "Pacific/Auckland", "UTC",
  "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Paris",
];

const DEFAULT_TASKS = [
  {
    name: "Daily Operations Briefing",
    description: "Morning summary of inbox, stock, slow movers, ads, and overnight actions.",
    cron_expression: "0 8 * * *",
    timezone: "Australia/Darwin",
    trigger_type: "cron_daily_briefing",
  },
  {
    name: "Weekly Slow Stock Review",
    description: "Identify slow-moving stock and propose markdown actions.",
    cron_expression: "0 8 * * 1",
    timezone: "Australia/Darwin",
    trigger_type: "cron_slow_stock",
  },
  {
    name: "Weekly Reorder Review",
    description: "Review reorder points and propose POs for low-stock styles.",
    cron_expression: "0 8 * * 3",
    timezone: "Australia/Darwin",
    trigger_type: "cron_reorder",
  },
  {
    name: "Daily Ad Performance Check",
    description: "Check ad performance and flag anomalies.",
    cron_expression: "0 16 * * *",
    timezone: "Australia/Darwin",
    trigger_type: "cron_ad_check",
  },
];

function describeCron(expr: string, tz: string): string {
  try {
    const human = cronstrue.toString(expr, { use24HourTimeFormat: false });
    return `${human} (${tz})`;
  } catch {
    return expr;
  }
}

function previewRuns(expr: string, tz: string, count = 5): Date[] {
  try {
    const it = CronExpressionParser.parse(expr, { tz });
    return Array.from({ length: count }, () => it.next().toDate());
  } catch {
    return [];
  }
}

function isCronValid(expr: string): boolean {
  try { CronExpressionParser.parse(expr); return true; } catch { return false; }
}

function rel(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60000);
  if (m < 60) return diff >= 0 ? `${m}m ago` : `in ${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return diff >= 0 ? `${h}h ago` : `in ${h}h`;
  return d.toLocaleString();
}

function expectedIntervalMs(expr: string): number | null {
  try {
    const it = CronExpressionParser.parse(expr);
    const a = it.next().toDate().getTime();
    const b = it.next().toDate().getTime();
    return b - a;
  } catch { return null; }
}

export default function ScheduledTasksSection() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [shopId, setShopId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) { setLoading(false); return; }

    const { data: shopRows } = await supabase
      .from("shop_users")
      .select("shop_id")
      .eq("user_id", uid)
      .limit(1);
    const sid = shopRows?.[0]?.shop_id ?? null;
    setShopId(sid);

    if (!sid) { setTasks([]); setLoading(false); return; }

    // Seed defaults if any are missing
    const { data: existing } = await supabase
      .from("sonic_scheduled_tasks")
      .select("trigger_type")
      .eq("shop_id", sid);
    const have = new Set((existing ?? []).map((r) => r.trigger_type));
    const missing = DEFAULT_TASKS.filter((d) => !have.has(d.trigger_type));
    if (missing.length > 0) {
      await supabase.from("sonic_scheduled_tasks").insert(
        missing.map((d) => ({ ...d, shop_id: sid, enabled: true })),
      );
    }

    const { data } = await supabase
      .from("sonic_scheduled_tasks")
      .select("*")
      .eq("shop_id", sid)
      .order("name");
    setTasks((data ?? []) as Task[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const toggleEnabled = async (t: Task, enabled: boolean) => {
    setTasks((prev) => prev.map((x) => x.id === t.id ? { ...x, enabled } : x));
    const { error } = await supabase
      .from("sonic_scheduled_tasks")
      .update({ enabled })
      .eq("id", t.id);
    if (error) {
      toast.error(`Couldn't update: ${error.message}`);
      setTasks((prev) => prev.map((x) => x.id === t.id ? { ...x, enabled: !enabled } : x));
    } else {
      toast.success(`${enabled ? "Enabled" : "Paused"} "${t.name}"`);
    }
  };

  const runNow = async (t: Task) => {
    if (!shopId) return;
    const { error } = await supabase.from("sonic_agent_runs").insert({
      shop_id: shopId,
      trigger_type: t.trigger_type,
      trigger_payload: { ...(t.trigger_payload ?? {}), force: true },
      status: "pending",
    });
    if (error) toast.error(`Couldn't trigger: ${error.message}`);
    else toast.success("Triggered. Agent will start within a minute.");
  };

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading scheduled tasks…
        </div>
      ) : !shopId ? (
        <p className="text-sm text-muted-foreground p-4">
          Connect a shop to manage scheduled tasks.
        </p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground p-4">No scheduled tasks yet.</p>
      ) : (
        tasks.map((t) => {
          const interval = expectedIntervalMs(t.cron_expression);
          const behind = !!(t.last_run_at && interval &&
            Date.now() - new Date(t.last_run_at).getTime() > interval * 2);
          return (
            <Card key={t.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-sm font-semibold">{t.name}</h4>
                    {!t.enabled && <Badge variant="outline">Paused</Badge>}
                    {behind && (
                      <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300 gap-1">
                        <AlertTriangle className="w-3 h-3" /> Behind schedule
                      </Badge>
                    )}
                  </div>
                  {t.description && (
                    <p className="text-xs text-muted-foreground mt-1">{t.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {describeCron(t.cron_expression, t.timezone)}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Last run: {rel(t.last_run_at)} · Next run: {rel(t.next_run_at)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch checked={t.enabled} onCheckedChange={(v) => toggleEnabled(t, v)} />
                  <Button size="sm" variant="outline" onClick={() => runNow(t)}>
                    <Play className="w-3 h-3 mr-1" /> Run now
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(t)} aria-label="Edit task">
                    <Pencil className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </Card>
          );
        })
      )}

      <EditDialog
        task={editing}
        onClose={() => setEditing(null)}
        onSaved={async () => { setEditing(null); await load(); }}
      />
    </div>
  );
}

function EditDialog({
  task, onClose, onSaved,
}: { task: Task | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cron, setCron] = useState("");
  const [tz, setTz] = useState("Australia/Darwin");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (task) {
      setName(task.name);
      setDescription(task.description ?? "");
      setCron(task.cron_expression);
      setTz(task.timezone || "Australia/Darwin");
    }
  }, [task]);

  const valid = isCronValid(cron);
  const preview = useMemo(() => valid ? previewRuns(cron, tz, 5) : [], [cron, tz, valid]);

  const save = async () => {
    if (!task || !valid) return;
    setSaving(true);
    const { error } = await supabase
      .from("sonic_scheduled_tasks")
      .update({ name, description, cron_expression: cron, timezone: tz })
      .eq("id", task.id);
    setSaving(false);
    if (error) toast.error(`Save failed: ${error.message}`);
    else { toast.success("Saved"); onSaved(); }
  };

  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit scheduled task</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="desc">Description</Label>
            <Textarea id="desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cron">Cron expression</Label>
            <Input id="cron" value={cron} onChange={(e) => setCron(e.target.value)} className="font-mono" />
            {!valid ? (
              <p className="text-xs text-destructive mt-1">Invalid cron expression</p>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">{describeCron(cron, tz)}</p>
            )}
          </div>
          <div>
            <Label htmlFor="tz">Timezone</Label>
            <Select value={tz} onValueChange={setTz}>
              <SelectTrigger id="tz"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((z) => <SelectItem key={z} value={z}>{z}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {preview.length > 0 && (
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="text-xs font-medium mb-1.5">Next 5 runs</p>
              <ul className="text-xs space-y-0.5 font-mono text-muted-foreground">
                {preview.map((d, i) => (
                  <li key={i}>{d.toLocaleString([], { timeZone: tz })} ({tz})</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!valid || saving}>
            {saving && <Loader2 className="w-3 h-3 mr-1 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
