import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, FolderOpen, Plus, Trash2, Clock } from "lucide-react";

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
  folder_id: string | null;
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
  const [adding, setAdding] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [rows, setRows] = useState<WatchRow[]>([]);
  const [folderInput, setFolderInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [history, setHistory] = useState<IngestRow[]>([]);
  const { toast } = useToast();

  async function load() {
    setLoading(true);
    const { data: w } = await supabase
      .from("drive_watch_settings")
      .select("*")
      .order("created_at", { ascending: true });
    setRows((w as WatchRow[]) || []);
    const { data: h } = await supabase
      .from("drive_ingested_files")
      .select("drive_file_id,drive_file_name,folder_id,status,error,ingested_at")
      .order("ingested_at", { ascending: false })
      .limit(50);
    setHistory((h as IngestRow[]) || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addFolder() {
    if (!folderInput) return;
    setAdding(true);
    const folderId = extractFolderId(folderInput);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast({ title: "Sign in first" }); setAdding(false); return; }
    const { error } = await supabase.from("drive_watch_settings").upsert({
      user_id: user.id,
      folder_id: folderId,
      folder_name: labelInput || null,
      enabled: true,
      last_sync_at: null,
    }, { onConflict: "user_id,folder_id" });
    setAdding(false);
    if (error) { toast({ title: "Add failed", description: error.message, variant: "destructive" }); return; }
    setFolderInput(""); setLabelInput("");
    toast({ title: "Folder added", description: "Will auto-sync hourly. Click Sync now to pull right away." });
    load();
  }

  async function toggleEnabled(row: WatchRow, next: boolean) {
    await supabase.from("drive_watch_settings").update({ enabled: next }).eq("id", row.id);
    load();
  }

  async function removeFolder(row: WatchRow) {
    if (!confirm(`Stop watching "${row.folder_name || row.folder_id}"?`)) return;
    await supabase.from("drive_watch_settings").delete().eq("id", row.id);
    load();
  }

  async function syncFolder(row: WatchRow) {
    setSyncingId(row.id);
    try {
      const { data, error } = await supabase.functions.invoke("drive-invoice-watcher", {
        body: { folder_id: row.folder_id },
      });
      if (error) throw error;
      toast({ title: "Sync started", description: data?.message || "Processing in background." });
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        await load();
      }
    } catch (e: any) {
      toast({ title: "Sync failed", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setSyncingId(null);
    }
  }

  async function syncAll() {
    setSyncingId("all");
    try {
      const { data, error } = await supabase.functions.invoke("drive-invoice-watcher", { body: {} });
      if (error) throw error;
      toast({ title: "Syncing all folders", description: `Processing ${data?.folders ?? rows.length} folders in background.` });
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        await load();
      }
    } catch (e: any) {
      toast({ title: "Sync failed", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setSyncingId(null);
    }
  }

  return (
    <div className="container mx-auto max-w-4xl p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Google Drive Auto-Import</h1>
        <p className="text-muted-foreground mt-1">
          Add as many Drive folders as you like. Sonic checks each one every hour and trains Supplier Brain automatically — no manual work needed.
        </p>
        <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
          <Clock className="h-3 w-3" /> Hourly auto-sync is active.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5" /> Add a folder</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="https://drive.google.com/drive/folders/…"
            value={folderInput}
            onChange={(e) => setFolderInput(e.target.value)}
          />
          <Input placeholder="Label (e.g. Splash Swimwear)" value={labelInput} onChange={(e) => setLabelInput(e.target.value)} />
          <Button onClick={addFolder} disabled={adding || !folderInput}>
            {adding ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
            Add folder
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><FolderOpen className="h-5 w-5" /> Watched folders ({rows.length})</CardTitle>
          {rows.length > 0 && (
            <Button variant="outline" size="sm" onClick={syncAll} disabled={!!syncingId}>
              {syncingId === "all" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Sync all now
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No folders yet. Add one above.</p>
          ) : (
            <ul className="divide-y">
              {rows.map((r) => (
                <li key={r.id} className="py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{r.folder_name || r.folder_id}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {r.folder_id} · Last sync: {r.last_sync_at ? new Date(r.last_sync_at).toLocaleString() : "never"}
                      {r.last_error && <span className="text-destructive"> · {r.last_error}</span>}
                    </div>
                  </div>
                  <Switch checked={r.enabled} onCheckedChange={(v) => toggleEnabled(r, v)} />
                  <Button variant="outline" size="sm" onClick={() => syncFolder(r)} disabled={!!syncingId}>
                    {syncingId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => removeFolder(r)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent ingestions (all folders)</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <ul className="divide-y">
              {history.map((h) => {
                const folder = rows.find((r) => r.folder_id === h.folder_id);
                return (
                  <li key={h.drive_file_id} className="py-2 flex items-center justify-between text-sm gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{h.drive_file_name || h.drive_file_id}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {folder?.folder_name || h.folder_id || "—"} · {new Date(h.ingested_at).toLocaleString()}
                      </div>
                    </div>
                    <span className={
                      h.status === "completed" ? "text-emerald-600" :
                      h.status === "error" ? "text-destructive" : "text-muted-foreground"
                    }>{h.status}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
