import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";

interface SyncResult {
  inserted: number;
  updated: number;
  skipped: number;
  errored: number;
  errors: { brand_name: string; reason: string }[];
}

interface LastLog {
  synced_at: string;
  rows_inserted: number;
  rows_updated: number;
  rows_skipped: number;
  rows_errored: number;
  error_details: { brand_name: string; reason: string }[];
}

export default function BrandDatabaseUserSyncSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [url, setUrl] = useState("");
  const [savedUrl, setSavedUrl] = useState("");
  const [result, setResult] = useState<SyncResult | null>(null);
  const [lastLog, setLastLog] = useState<LastLog | null>(null);
  const [showFailures, setShowFailures] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) {
      setLoading(false);
      return;
    }
    const [{ data: settings }, { data: logs }] = await Promise.all([
      supabase
        .from("user_settings")
        .select("brand_sync_url")
        .eq("user_id", uid)
        .maybeSingle(),
      supabase
        .from("brand_sync_log")
        .select(
          "synced_at, rows_inserted, rows_updated, rows_skipped, rows_errored, error_details",
        )
        .eq("user_id", uid)
        .order("synced_at", { ascending: false })
        .limit(1),
    ]);
    if (settings?.brand_sync_url) {
      setUrl(settings.brand_sync_url);
      setSavedUrl(settings.brand_sync_url);
    }
    if (logs && logs.length > 0) {
      setLastLog(logs[0] as unknown as LastLog);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const validateUrl = (u: string): string | null => {
    if (!u.trim()) return "Paste a CSV URL first";
    try {
      const parsed = new URL(u.trim());
      if (parsed.protocol !== "https:") return "URL must start with https://";
      return null;
    } catch {
      return "That doesn't look like a valid URL";
    }
  };

  const handleSave = async () => {
    const err = validateUrl(url);
    if (err) {
      toast.error(err);
      return;
    }
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) {
      toast.error("Sign in to save settings");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("user_settings")
      .upsert(
        { user_id: uid, brand_sync_url: url.trim() },
        { onConflict: "user_id" },
      );
    setSaving(false);
    if (error) {
      toast.error("Couldn't save", { description: error.message });
      return;
    }
    setSavedUrl(url.trim());
    toast.success("CSV URL saved");
  };

  const handleSync = async () => {
    const target = savedUrl || url.trim();
    const err = validateUrl(target);
    if (err) {
      toast.error(err);
      return;
    }
    setSyncing(true);
    setResult(null);
    setShowFailures(false);
    try {
      const { data, error } = await supabase.functions.invoke(
        "sync-brand-database",
        { body: { csv_url: target } },
      );
      if (error) throw error;
      const r = data as SyncResult;
      setResult(r);
      const totalChanged = r.inserted + r.updated;
      if (r.errored > 0) {
        toast.warning(
          `Sync complete with ${r.errored} error${r.errored === 1 ? "" : "s"}`,
          {
            description: `${r.inserted} inserted · ${r.updated} updated · ${r.skipped} unchanged`,
          },
        );
      } else {
        toast.success(
          `${totalChanged} brand${totalChanged === 1 ? "" : "s"} synced`,
          {
            description: `${r.inserted} inserted · ${r.updated} updated · ${r.skipped} unchanged`,
          },
        );
      }
      await load();
    } catch (e) {
      toast.error("Sync failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasFailures = result && result.errored > 0 && result.errors.length > 0;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground -mt-1">
        Sync brand enrichment data from a Google Sheet into your private brand
        database. Updated monthly — or sync manually anytime.
      </p>

      <div>
        <label className="text-xs font-medium text-foreground block mb-1">
          Published CSV URL
        </label>
        <div className="flex gap-2">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/e/.../pub?output=csv"
            className="font-mono-data text-xs"
          />
          <Button onClick={handleSave} disabled={saving} size="sm">
            {saving && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
            Save
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          onClick={handleSync}
          variant="teal"
          size="sm"
          disabled={syncing || !savedUrl}
        >
          {syncing ? (
            <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3 mr-1.5" />
          )}
          Sync now
        </Button>
        {!savedUrl && (
          <span className="text-xs text-muted-foreground">
            Save a URL first
          </span>
        )}
      </div>

      {result && (
        <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-success font-medium">
              ✅ {result.inserted} inserted
            </span>
            <span className="text-muted-foreground">·</span>
            <span>{result.updated} updated</span>
            <span className="text-muted-foreground">·</span>
            <span>{result.skipped} unchanged</span>
            <span className="text-muted-foreground">·</span>
            <span
              className={
                result.errored > 0 ? "text-destructive" : "text-muted-foreground"
              }
            >
              {result.errored} errors
            </span>
          </div>
          {hasFailures && (
            <div>
              <button
                onClick={() => setShowFailures((s) => !s)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {showFailures ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                {showFailures ? "Hide" : "Show"} failures
              </button>
              {showFailures && (
                <table className="w-full mt-2 text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="text-left py-1 px-2">Brand</th>
                      <th className="text-left py-1 px-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.map((err, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="py-1 px-2 font-mono-data">
                          {err.brand_name}
                        </td>
                        <td className="py-1 px-2 text-muted-foreground">
                          {err.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}

      {lastLog && !result && (
        <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
          <span>Last synced:</span>
          <span className="text-foreground">
            {new Date(lastLog.synced_at).toLocaleString()}
          </span>
          <Badge variant="secondary" className="text-[10px]">
            {lastLog.rows_inserted}+ {lastLog.rows_updated}↻ {lastLog.rows_skipped}=
            {lastLog.rows_errored > 0 ? ` ${lastLog.rows_errored}✕` : ""}
          </Badge>
        </div>
      )}
      {lastLog && result && (
        <div className="text-xs text-muted-foreground">
          Last synced: {new Date(lastLog.synced_at).toLocaleString()}
        </div>
      )}
    </div>
  );
}
