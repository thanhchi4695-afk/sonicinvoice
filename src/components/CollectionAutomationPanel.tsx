import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, Bot, CheckCircle2, XCircle, Eye, History, Settings as SettingsIcon, Inbox } from "lucide-react";
import { createCollectionGraphQL } from "@/lib/shopify-api";
import HowToVideoButton from "@/components/HowToVideoButton";

type Settings = {
  weekly_health_check: boolean;
  weekly_digest_email: string | null;
  auto_approve_brand_collections: boolean;
  auto_approve_brand_stories: boolean;
  auto_approve_threshold_hours: number;
  seo_auto_generate: boolean;
  auto_archive_empty: boolean;
  seasonal_lifecycle: boolean;
  slack_webhook_url: string | null;
};

type ApprovalRow = {
  id: string;
  approval_type: string;
  collection_title: string | null;
  collection_handle: string | null;
  rationale: string | null;
  preview_data: any;
  status: string;
  auto_approve_at: string | null;
  created_at: string;
};

type WorkflowRow = {
  id: string;
  workflow_type: string;
  status: string;
  trigger_source: string | null;
  decisions: any[];
  actions_taken: any[];
  summary: string | null;
  created_at: string;
  completed_at: string | null;
};

const DEFAULTS: Settings = {
  weekly_health_check: true,
  weekly_digest_email: "",
  auto_approve_brand_collections: false,
  auto_approve_brand_stories: false,
  auto_approve_threshold_hours: 24,
  seo_auto_generate: true,
  auto_archive_empty: false,
  seasonal_lifecycle: false,
  slack_webhook_url: "",
};

function timeUntil(iso: string | null): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "now";
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return `${h}h ${m}m`;
}

function iconFor(type: string) {
  if (type === "create_collection") return "✨";
  if (type === "archive_collection") return "🗑️";
  if (type === "delete_collection") return "❌";
  if (type === "update_seo") return "📝";
  return "•";
}

export function CollectionAutomationPanel() {
  const [userId, setUserId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [savingSettings, setSavingSettings] = useState(false);
  const [queue, setQueue] = useState<ApprovalRow[]>([]);
  const [history, setHistory] = useState<WorkflowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUserId(user.id);
      await Promise.all([loadSettings(user.id), loadQueue(user.id), loadHistory(user.id)]);
      setLoading(false);
    })();
  }, []);

  async function loadSettings(uid: string) {
    const { data } = await supabase
      .from("collection_automation_settings")
      .select("*")
      .eq("user_id", uid)
      .maybeSingle();
    if (data) setSettings({ ...DEFAULTS, ...data });
  }
  async function loadQueue(uid: string) {
    const { data } = await supabase
      .from("collection_approval_queue")
      .select("*")
      .eq("user_id", uid)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    setQueue((data ?? []) as ApprovalRow[]);
  }
  async function loadHistory(uid: string) {
    const { data } = await supabase
      .from("collection_workflows")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(50);
    setHistory((data ?? []) as WorkflowRow[]);
  }

  async function saveSettings() {
    if (!userId) return;
    setSavingSettings(true);
    const { error } = await supabase
      .from("collection_automation_settings")
      .upsert({ user_id: userId, ...settings, updated_at: new Date().toISOString() });
    setSavingSettings(false);
    if (error) toast.error("Failed to save settings");
    else toast.success("Autopilot settings saved");
  }

  async function executeApproval(row: ApprovalRow) {
    // Only CREATE_COLLECTION and update_seo execute immediately client-side
    if (row.approval_type === "create_collection") {
      const pd = row.preview_data || {};
      const result = await createCollectionGraphQL({
        title: row.collection_title || "Untitled",
        rules: [{
          column: pd.rule_column || "vendor",
          relation: pd.rule_relation || "equals",
          condition: pd.rule_condition || row.collection_title || "",
        }],
        disjunctive: false,
      } as any).catch((e: any) => ({ error: e?.message }));
      if ((result as any)?.error) throw new Error((result as any).error);
      return result;
    }
    if (row.approval_type === "update_seo") {
      const { error } = await supabase.functions.invoke("collection-seo-agent", {
        body: {
          collection_handle: row.collection_handle,
          collection_title: row.collection_title,
        },
      });
      if (error) throw error;
      return { ok: true };
    }
    // archive/delete handled via shopify-proxy (best-effort)
    return { ok: true };
  }

  async function approve(row: ApprovalRow) {
    if (!userId) return;
    setActingId(row.id);
    try {
      await executeApproval(row);
      await supabase
        .from("collection_approval_queue")
        .update({ status: "approved", decided_at: new Date().toISOString(), decided_by: "user" })
        .eq("id", row.id);
      toast.success(`✅ ${row.collection_title} approved`);
      await loadQueue(userId);
      await loadHistory(userId);
    } catch (e: any) {
      toast.error(`Action failed: ${e?.message ?? e}`);
    } finally {
      setActingId(null);
    }
  }

  async function deny(row: ApprovalRow) {
    if (!userId) return;
    setActingId(row.id);
    await supabase
      .from("collection_approval_queue")
      .update({ status: "denied", decided_at: new Date().toISOString(), decided_by: "user" })
      .eq("id", row.id);
    toast(`❌ ${row.collection_title ?? "Item"} denied`);
    await loadQueue(userId);
    setActingId(null);
  }

  async function approveAll() {
    for (const row of queue) {
      // eslint-disable-next-line no-await-in-loop
      await approve(row);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center p-8"><Loader2 className="animate-spin" /></div>;
  }

  return (
    <Tabs defaultValue="settings" className="w-full">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Bot className="w-4 h-4 text-indigo-300" />
          <span>Collection Autopilot — automated brand & style-line collections</span>
        </div>
        <HowToVideoButton
          videoSrc="/howto/collection-autopilot.mp4"
          title="Collection Autopilot"
          description="Detects new brands & style lines after every Shopify push, drafts SEO, and queues approvals."
          label="Watch how Collection Autopilot works"
          size="md"
        />
      </div>
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="settings"><SettingsIcon className="w-4 h-4 mr-2" />Autopilot</TabsTrigger>
        <TabsTrigger value="queue">
          <Inbox className="w-4 h-4 mr-2" />Approvals
          {queue.length > 0 && <Badge variant="secondary" className="ml-2">{queue.length}</Badge>}
        </TabsTrigger>
        <TabsTrigger value="history"><History className="w-4 h-4 mr-2" />History</TabsTrigger>
      </TabsList>


      {/* SETTINGS */}
      <TabsContent value="settings">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="w-5 h-5" />Collection Autopilot
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>Weekly health check digest email</Label>
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="lisa@splashswimwear.com.au"
                  value={settings.weekly_digest_email ?? ""}
                  onChange={(e) => setSettings({ ...settings, weekly_digest_email: e.target.value })}
                />
                <Switch
                  checked={settings.weekly_health_check}
                  onCheckedChange={(v) => setSettings({ ...settings, weekly_health_check: v })}
                />
              </div>
            </div>

            <ToggleRow
              label="Auto-create brand collections"
              hint="When a new brand appears in an invoice"
              checked={settings.auto_approve_brand_collections}
              onChange={(v) => setSettings({ ...settings, auto_approve_brand_collections: v })}
            />
            <ToggleRow
              label="Auto-create brand story collections"
              hint="When a new style line has 3+ products"
              checked={settings.auto_approve_brand_stories}
              onChange={(v) => setSettings({ ...settings, auto_approve_brand_stories: v })}
            />
            <ToggleRow
              label="Auto-generate SEO for new collections"
              hint="Run SEO agent automatically after creation"
              checked={settings.seo_auto_generate}
              onChange={(v) => setSettings({ ...settings, seo_auto_generate: v })}
            />
            <ToggleRow
              label="Auto-archive empty collections"
              hint="When a collection drops to 0 products"
              checked={settings.auto_archive_empty}
              onChange={(v) => setSettings({ ...settings, auto_archive_empty: v })}
            />

            <div className="space-y-2">
              <Label>Auto-approve pending actions after</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={168}
                  value={settings.auto_approve_threshold_hours}
                  onChange={(e) => setSettings({ ...settings, auto_approve_threshold_hours: Number(e.target.value) || 24 })}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">hours (otherwise wait for manual approval)</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Slack webhook URL (optional)</Label>
              <Input
                placeholder="https://hooks.slack.com/services/..."
                value={settings.slack_webhook_url ?? ""}
                onChange={(e) => setSettings({ ...settings, slack_webhook_url: e.target.value })}
              />
            </div>

            <div className="pt-2">
              <Button onClick={saveSettings} disabled={savingSettings}>
                {savingSettings && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save autopilot settings
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* QUEUE */}
      <TabsContent value="queue">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Pending Approvals ({queue.length})</CardTitle>
            {queue.length > 0 && (
              <Button size="sm" variant="outline" onClick={approveAll}>Approve all</Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {queue.length === 0 && (
              <div className="text-sm text-muted-foreground py-8 text-center">
                No pending approvals. The autopilot is watching for new opportunities.
              </div>
            )}
            {queue.map((row) => (
              <div key={row.id} className="border rounded-lg p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">
                      {iconFor(row.approval_type)} {row.approval_type.replace("_", " ").toUpperCase()} — {row.collection_title}
                    </div>
                    <div className="text-sm text-muted-foreground italic mt-1">"{row.rationale}"</div>
                    {row.preview_data?.rule_column && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Rule: <code>{row.preview_data.rule_column} {row.preview_data.rule_relation} "{row.preview_data.rule_condition}"</code>
                      </div>
                    )}
                  </div>
                  <Badge variant="outline">Auto-approves in {timeUntil(row.auto_approve_at)}</Badge>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => approve(row)} disabled={actingId === row.id}>
                    <CheckCircle2 className="w-4 h-4 mr-1" />Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => deny(row)} disabled={actingId === row.id}>
                    <XCircle className="w-4 h-4 mr-1" />Deny
                  </Button>
                  {row.collection_handle && (
                    <Button size="sm" variant="ghost" asChild>
                      <a href={`/admin/collections/${row.collection_handle}`} target="_blank" rel="noreferrer">
                        <Eye className="w-4 h-4 mr-1" />Preview
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </TabsContent>

      {/* HISTORY */}
      <TabsContent value="history">
        <Card>
          <CardHeader><CardTitle>Workflow History</CardTitle></CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">No workflow runs yet.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr><th className="py-2">Date</th><th>Trigger</th><th>Decisions</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {history.map((run) => (
                    <>
                      <tr key={run.id} className="border-t">
                        <td className="py-2">{new Date(run.created_at).toLocaleDateString()}</td>
                        <td>{run.workflow_type}</td>
                        <td>{(run.decisions ?? []).length}</td>
                        <td>
                          <Badge variant={run.status === "complete" ? "default" : "secondary"}>{run.status}</Badge>
                        </td>
                        <td>
                          <Button size="sm" variant="ghost"
                            onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}>
                            {expandedRun === run.id ? "Hide" : "Details"}
                          </Button>
                        </td>
                      </tr>
                      {expandedRun === run.id && (
                        <tr key={`${run.id}-d`}>
                          <td colSpan={5} className="bg-muted/30 p-3 text-xs">
                            <div className="font-medium mb-2">Summary: {run.summary ?? "—"}</div>
                            {(run.decisions ?? []).map((d: any, i: number) => (
                              <div key={i} className="mb-2">
                                <span className="font-mono text-[11px] mr-2">{d.action}</span>
                                <strong>{d.title ?? d.handle}</strong>
                                <div className="text-muted-foreground italic">"{d.rationale}"</div>
                              </div>
                            ))}
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

function ToggleRow({ label, hint, checked, onChange }: {
  label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <div>
        <div className="font-medium text-sm">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export default CollectionAutomationPanel;
