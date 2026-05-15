import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Mail, FolderOpen, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type Settings = {
  user_id: string;
  gmail_enabled: boolean;
  gmail_query: string;
  drive_enabled: boolean;
  drive_folder_id: string | null;
  drive_folder_name: string | null;
  gmail_last_polled_at: string | null;
  drive_last_polled_at: string | null;
};

type Upload = {
  id: string;
  source: string;
  original_filename: string | null;
  supplier: string | null;
  status: string;
  invoice_date: string | null;
  total: number | null;
  created_at: string;
};

const DEFAULT_GMAIL_QUERY = "has:attachment filename:pdf (invoice OR receipt OR statement)";

export default function AutoIngest() {
  const [userId, setUserId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<"gmail" | "drive" | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUserId(user.id);
      const { data: s } = await supabase
        .from("auto_ingest_settings").select("*")
        .eq("user_id", user.id).maybeSingle();
      setSettings(s ?? {
        user_id: user.id,
        gmail_enabled: false, gmail_query: DEFAULT_GMAIL_QUERY,
        drive_enabled: false, drive_folder_id: null, drive_folder_name: null,
        gmail_last_polled_at: null, drive_last_polled_at: null,
      });
      await loadUploads(user.id);
      setLoading(false);
    })();
  }, []);

  async function loadUploads(uid: string) {
    const { data } = await supabase
      .from("invoice_uploads")
      .select("id, source, original_filename, supplier, status, invoice_date, total, created_at")
      .eq("user_id", uid)
      .in("source", ["gmail", "drive"])
      .order("created_at", { ascending: false })
      .limit(50);
    setUploads((data ?? []) as Upload[]);
  }

  async function save(patch: Partial<Settings>) {
    if (!userId || !settings) return;
    setSaving(true);
    const next = { ...settings, ...patch };
    setSettings(next);
    const { error } = await supabase.from("auto_ingest_settings")
      .upsert({ user_id: userId, ...patch }, { onConflict: "user_id" });
    setSaving(false);
    if (error) toast.error(`Save failed: ${error.message}`);
  }

  async function runIngest(kind: "gmail" | "drive") {
    if (!userId) return;
    setRunning(kind);
    try {
      const { data, error } = await supabase.functions.invoke(
        kind === "gmail" ? "auto-ingest-gmail" : "auto-ingest-drive",
        { body: {} },
      );
      if (error) throw error;
      const created = (data as { created?: number })?.created ?? 0;
      const skipped = (data as { skipped?: number })?.skipped ?? 0;
      toast.success(`${kind === "gmail" ? "Gmail" : "Drive"}: imported ${created}, skipped ${skipped}`);
      await loadUploads(userId);
    } catch (e) {
      toast.error(`Run failed: ${(e as Error).message}`);
    } finally {
      setRunning(null);
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin" /></div>;
  if (!userId) return <div className="p-8">Please <Link to="/login" className="underline">sign in</Link>.</div>;
  if (!settings) return null;

  return (
    <div className="container max-w-4xl py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Auto-Ingest</h1>
        <p className="text-muted-foreground mt-1">
          Automatically pull invoice PDFs from Gmail and Google Drive into the processing queue.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Mail className="w-5 h-5" /> Gmail</CardTitle>
          <CardDescription>
            Scans your connected Gmail inbox for emails matching the search query and imports any PDF attachments.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="gmail-enabled">Enable Gmail auto-import</Label>
            <Switch id="gmail-enabled" checked={settings.gmail_enabled}
              onCheckedChange={(v) => save({ gmail_enabled: v })} disabled={saving} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="gmail-query">Search query</Label>
            <Input id="gmail-query" value={settings.gmail_query}
              onChange={(e) => setSettings({ ...settings, gmail_query: e.target.value })}
              onBlur={() => save({ gmail_query: settings.gmail_query })} />
            <p className="text-xs text-muted-foreground">Uses Gmail search syntax. Default: <code>{DEFAULT_GMAIL_QUERY}</code></p>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Last run: {settings.gmail_last_polled_at ? new Date(settings.gmail_last_polled_at).toLocaleString() : "never"}
            </span>
            <Button onClick={() => runIngest("gmail")} disabled={!settings.gmail_enabled || running !== null} size="sm">
              {running === "gmail" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Run now
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FolderOpen className="w-5 h-5" /> Google Drive</CardTitle>
          <CardDescription>
            Watches a Drive folder for new PDFs and imports them. Paste the folder ID from its URL
            (<code>drive.google.com/drive/folders/<b>FOLDER_ID</b></code>).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="drive-enabled">Enable Drive auto-import</Label>
            <Switch id="drive-enabled" checked={settings.drive_enabled}
              onCheckedChange={(v) => save({ drive_enabled: v })} disabled={saving} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="drive-folder">Folder ID</Label>
              <Input id="drive-folder" value={settings.drive_folder_id ?? ""}
                onChange={(e) => setSettings({ ...settings, drive_folder_id: e.target.value })}
                onBlur={() => save({ drive_folder_id: settings.drive_folder_id })}
                placeholder="1AbC..." />
            </div>
            <div className="space-y-1">
              <Label htmlFor="drive-name">Folder label (optional)</Label>
              <Input id="drive-name" value={settings.drive_folder_name ?? ""}
                onChange={(e) => setSettings({ ...settings, drive_folder_name: e.target.value })}
                onBlur={() => save({ drive_folder_name: settings.drive_folder_name })}
                placeholder="Invoices Inbox" />
            </div>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Last run: {settings.drive_last_polled_at ? new Date(settings.drive_last_polled_at).toLocaleString() : "never"}
            </span>
            <Button onClick={() => runIngest("drive")}
              disabled={!settings.drive_enabled || !settings.drive_folder_id || running !== null} size="sm">
              {running === "drive" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Run now
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent imports</CardTitle>
          <CardDescription>Latest 50 invoices ingested from Gmail or Drive.</CardDescription>
        </CardHeader>
        <CardContent>
          {uploads.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing yet. Enable a source and click "Run now".</p>
          ) : (
            <div className="space-y-1">
              {uploads.map(u => (
                <div key={u.id} className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
                  <div className="flex items-center gap-3 min-w-0">
                    <Badge variant="outline" className="capitalize">{u.source}</Badge>
                    <span className="truncate">{u.original_filename ?? "(unnamed)"}</span>
                    {u.supplier && <span className="text-muted-foreground truncate">— {u.supplier}</span>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Badge variant={u.status === "exported" ? "default" : u.status === "failed" ? "destructive" : "secondary"}>
                      {u.status}
                    </Badge>
                    <span className="text-muted-foreground tabular-nums">
                      {new Date(u.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
