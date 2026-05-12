import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, FolderOpen } from "lucide-react";

interface WatchRow {
  id: string;
  folder_id: string;
  folder_name: string | null;
  enabled: boolean;
  last_sync_at: string | null;
  last_error: string | null;
}

interface IngestRow {
  drive_file_id: string;
  drive_file_name: string | null;
  status: string;
  error: string | null;
  ingested_at: string;
}

function extractFolderId(input: string): string {
  const m = input.match(/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : input.trim();
}

export default function DriveWatcher() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [row, setRow] = useState<WatchRow | null>(null);
  const [folderInput, setFolderInput] = useState("");
  const [folderName, setFolderName] = useState("");
  const [history, setHistory] = useState<IngestRow[]>([]);
  const { toast } = useToast();

  async function load() {
    setLoading(true);
    const { data: w } = await supabase
      .from("drive_watch_settings")
      .select("*")
      .maybeSingle();
    setRow(w as WatchRow | null);
    if (w) {
      setFolderInput((w as WatchRow).folder_id);
      setFolderName((w as WatchRow).folder_name || "");
    }
    const { data: h } = await supabase
      .from("drive_ingested_files")
      .select("drive_file_id,drive_file_name,status,error,ingested_at")
      .order("ingested_at", { ascending: false })
      .limit(25);
    setHistory((h as IngestRow[]) || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function save() {
    setSaving(true);
    const folderId = extractFolderId(folderInput);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast({ title: "Sign in first" }); setSaving(false); return; }
    const payload = {
      user_id: user.id,
      folder_id: folderId,
      folder_name: folderName || null,
      enabled: true,
    };
    const { error } = await supabase
      .from("drive_watch_settings")
      .upsert(payload, { onConflict: "user_id" });
    setSaving(false);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Drive folder saved" });
    load();
  }

  async function toggleEnabled(next: boolean) {
    if (!row) return;
    await supabase.from("drive_watch_settings").update({ enabled: next }).eq("id", row.id);
    load();
  }

  async function syncNow() {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("drive-invoice-watcher", { body: {} });
      if (error) throw error;
      toast({ title: "Sync complete", description: `Scanned ${data?.scanned ?? 0}, new ${data?.new ?? 0}, errors ${data?.errors ?? 0}` });
      load();
    } catch (e: any) {
      toast({ title: "Sync failed", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="container mx-auto max-w-3xl p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Google Drive Auto-Import</h1>
        <p className="text-muted-foreground mt-1">
          Drop new invoices into a Drive folder — Sonic ingests them every hour and trains Supplier Brain automatically.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FolderOpen className="h-5 w-5" /> Watched folder</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Folder URL or ID</label>
            <Input
              placeholder="https://drive.google.com/drive/folders/…"
              value={folderInput}
              onChange={(e) => setFolderInput(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Label (optional)</label>
            <Input placeholder="Weekly invoices" value={folderName} onChange={(e) => setFolderName(e.target.value)} />
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={saving || !folderInput}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save folder
            </Button>
            {row && (
              <>
                <Button variant="outline" onClick={syncNow} disabled={syncing}>
                  {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  Sync now
                </Button>
                <div className="flex items-center gap-2 ml-auto text-sm">
                  <span>Enabled</span>
                  <Switch checked={row.enabled} onCheckedChange={toggleEnabled} />
                </div>
              </>
            )}
          </div>
          {row && (
            <div className="text-xs text-muted-foreground">
              Last sync: {row.last_sync_at ? new Date(row.last_sync_at).toLocaleString() : "never"}
              {row.last_error && <span className="text-destructive"> · {row.last_error}</span>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent ingestions</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing yet. Add a folder above and drop an invoice into it.</p>
          ) : (
            <ul className="divide-y">
              {history.map((h) => (
                <li key={h.drive_file_id} className="py-2 flex items-center justify-between text-sm">
                  <span className="truncate mr-3">{h.drive_file_name || h.drive_file_id}</span>
                  <span className={
                    h.status === "completed" ? "text-emerald-600" :
                    h.status === "error" ? "text-destructive" : "text-muted-foreground"
                  }>{h.status}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
