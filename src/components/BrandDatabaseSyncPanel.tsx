import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, RefreshCw, FlaskConical, FileText, AlertCircle, CheckCircle2, ExternalLink } from "lucide-react";

type Schedule = "monthly" | "weekly" | "daily" | "manual";

interface SyncLog {
  id: string;
  run_at: string;
  source: string;
  status: string;
  rows_in_sheet: number | null;
  rows_upserted: number | null;
  rows_skipped_db_newer: number | null;
  rows_skipped_no_change: number | null;
  rows_failed: number | null;
  error_text: string | null;
  duration_ms: number | null;
}

const STARTER_CSV_HEADERS = [
  "brand_name",
  "canonical_brand_name",
  "website_url",
  "is_shopify",
  "products_json_endpoint",
  "country_origin",
  "product_categories",
  "enrichment_enabled",
  "updated_at",
  "last_modified_by",
  "notes",
].join(",");

export default function BrandDatabaseSyncPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const [sheetUrl, setSheetUrl] = useState("");
  const [schedule, setSchedule] = useState<Schedule>("monthly");
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [lastStatus, setLastStatus] = useState<string | null>(null);
  const [brandCount, setBrandCount] = useState<number>(0);
  const [logs, setLogs] = useState<SyncLog[]>([]);

  const loadSettings = async () => {
    setLoading(true);
    const [{ data: settings }, { count }] = await Promise.all([
      supabase
        .from("app_settings")
        .select("brand_sync_sheet_url, brand_sync_schedule, brand_sync_last_run_at, brand_sync_last_status")
        .eq("singleton", true)
        .maybeSingle(),
      supabase.from("supplier_websites").select("id", { count: "exact", head: true }),
    ]);
    if (settings) {
      setSheetUrl(settings.brand_sync_sheet_url ?? "");
      setSchedule((settings.brand_sync_schedule as Schedule) ?? "monthly");
      setLastRunAt(settings.brand_sync_last_run_at);
      setLastStatus(settings.brand_sync_last_status);
    }
    setBrandCount(count ?? 0);
    setLoading(false);
  };

  const loadLogs = async () => {
    const { data } = await supabase
      .from("supplier_websites_sync_log")
      .select("*")
      .order("run_at", { ascending: false })
      .limit(10);
    setLogs((data ?? []) as SyncLog[]);
  };

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (showLog) loadLogs();
  }, [showLog]);

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("app_settings")
      .update({
        brand_sync_sheet_url: sheetUrl.trim() || null,
        brand_sync_schedule: schedule,
      })
      .eq("singleton", true);
    setSaving(false);
    if (error) {
      toast.error("Couldn't save settings", { description: error.message });
      return;
    }
    toast.success("Settings saved");
  };

  const handleTest = async () => {
    if (!sheetUrl.trim()) {
      toast.error("Paste a Google Sheet URL first");
      return;
    }
    setTesting(true);
    try {
      // Convert to CSV export URL client-side and HEAD it
      const m = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (!m) {
        toast.error("That doesn't look like a Google Sheets URL", {
          description: "Expected: https://docs.google.com/spreadsheets/d/...",
        });
        return;
      }
      const csvUrl = `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=0`;
      const res = await fetch(csvUrl, { method: "GET", redirect: "follow" });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          toast.error("Sheet is not published to web", {
            description:
              "In Google Sheets: File → Share → Publish to web → CSV → Publish.",
          });
        } else {
          toast.error(`Sheet fetch failed (HTTP ${res.status})`);
        }
        return;
      }
      const text = await res.text();
      const firstLine = text.split(/\r?\n/)[0] ?? "";
      const headers = firstLine.split(",").map((h) => h.trim().toLowerCase());
      const required = ["brand_name", "updated_at"];
      const missing = required.filter((h) => !headers.includes(h));
      if (missing.length) {
        toast.error("Sheet headers don't match", {
          description: `Missing: ${missing.join(", ")}. Click "Download starter sheet" for the right shape.`,
        });
        return;
      }
      const rowCount = text.split(/\r?\n/).filter((l) => l.trim()).length - 1;
      toast.success(`Connection OK — ${rowCount} data row${rowCount === 1 ? "" : "s"} found`);
    } catch (err) {
      toast.error("Couldn't reach the sheet", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSyncNow = async () => {
    if (!sheetUrl.trim()) {
      toast.error("Save a Sheet URL first");
      return;
    }
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-supplier-websites", {
        body: { source: "manual" },
      });
      if (error) throw error;
      const r = data as {
        rows_in_sheet?: number;
        upserted?: number;
        skipped_db_newer?: number;
        skipped_no_change?: number;
        failed?: number;
        status?: string;
      };
      toast.success(
        `Sync ${r.status ?? "complete"} — ${r.upserted ?? 0} upserted, ${r.skipped_no_change ?? 0} unchanged, ${r.skipped_db_newer ?? 0} kept (DB newer), ${r.failed ?? 0} failed`,
      );
      await loadSettings();
      if (showLog) await loadLogs();
    } catch (err) {
      toast.error("Sync failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleDownloadStarter = () => {
    const sample = [
      STARTER_CSV_HEADERS,
      `Walnut Melbourne,Walnut Melbourne,https://walnutmelbourne.com,yes,https://walnutmelbourne.com/products.json,AU,Footwear,yes,${new Date().toISOString()},sheet,Sample row — replace`,
    ].join("\n");
    const blob = new Blob([sample], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sonic-invoices-supplier-website-database.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="sheet-url" className="text-sm">Google Sheet URL</Label>
        <Input
          id="sheet-url"
          value={sheetUrl}
          onChange={(e) => setSheetUrl(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/..."
          className="mt-1 font-mono-data text-xs"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Sheet must be Published to Web as CSV (File → Share → Publish to web → CSV).
        </p>
      </div>

      <div>
        <Label className="text-sm mb-2 block">Sync schedule</Label>
        <RadioGroup
          value={schedule}
          onValueChange={(v) => setSchedule(v as Schedule)}
          className="space-y-1.5"
        >
          {([
            ["monthly", "Monthly (1st of month, ~02:00 AEST)"],
            ["weekly", "Weekly (Mondays, ~02:00 AEST)"],
            ["daily", "Daily (~02:00 AEST)"],
            ["manual", "Manual only"],
          ] as const).map(([v, label]) => (
            <div key={v} className="flex items-center gap-2">
              <RadioGroupItem value={v} id={`sched-${v}`} />
              <Label htmlFor={`sched-${v}`} className="text-sm font-normal cursor-pointer">
                {label}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>

      <div className="rounded-md bg-muted/40 p-3 text-xs space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Conflict resolution:</span>
          <Badge variant="secondary" className="text-[10px]">Last modified wins</Badge>
        </div>
        <div className="text-muted-foreground">
          {brandCount} brand{brandCount === 1 ? "" : "s"} in database
          {lastRunAt && (
            <>
              {" · Last sync: "}
              <span className="text-foreground">{new Date(lastRunAt).toLocaleString()}</span>
              {lastStatus && (
                <>
                  {" "}
                  <Badge
                    variant={lastStatus === "success" ? "default" : "destructive"}
                    className="text-[10px] ml-1"
                  >
                    {lastStatus}
                  </Badge>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
          Save settings
        </Button>
        <Button onClick={handleTest} variant="outline" size="sm" disabled={testing}>
          {testing ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <FlaskConical className="w-3 h-3 mr-1.5" />}
          Test connection
        </Button>
        <Button onClick={handleSyncNow} variant="outline" size="sm" disabled={syncing}>
          {syncing ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1.5" />}
          Sync now
        </Button>
        <Button onClick={() => setShowLog((s) => !s)} variant="ghost" size="sm">
          <FileText className="w-3 h-3 mr-1.5" />
          {showLog ? "Hide sync log" : "View sync log"}
        </Button>
        <Button onClick={handleDownloadStarter} variant="ghost" size="sm">
          Download starter sheet
        </Button>
      </div>

      {showLog && (
        <div className="rounded-md border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="text-left px-2 py-1.5">Run at</th>
                <th className="text-left px-2 py-1.5">Source</th>
                <th className="text-left px-2 py-1.5">Status</th>
                <th className="text-right px-2 py-1.5">In sheet</th>
                <th className="text-right px-2 py-1.5">Upserted</th>
                <th className="text-right px-2 py-1.5">DB newer</th>
                <th className="text-right px-2 py-1.5">Unchanged</th>
                <th className="text-right px-2 py-1.5">Failed</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-2 py-3 text-center text-muted-foreground">
                    No sync runs yet.
                  </td>
                </tr>
              )}
              {logs.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="px-2 py-1.5 font-mono-data">
                    {new Date(l.run_at).toLocaleString()}
                  </td>
                  <td className="px-2 py-1.5">{l.source}</td>
                  <td className="px-2 py-1.5">
                    {l.status === "success" ? (
                      <span className="inline-flex items-center gap-1 text-success">
                        <CheckCircle2 className="w-3 h-3" />
                        success
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-destructive" title={l.error_text ?? ""}>
                        <AlertCircle className="w-3 h-3" />
                        {l.status}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono-data">{l.rows_in_sheet ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right font-mono-data">{l.rows_upserted ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right font-mono-data">{l.rows_skipped_db_newer ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right font-mono-data">{l.rows_skipped_no_change ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right font-mono-data">{l.rows_failed ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer hover:text-foreground">
          How to set up your Sheet
        </summary>
        <ol className="mt-2 ml-4 space-y-1 list-decimal">
          <li>Click <strong>Download starter sheet</strong> above.</li>
          <li>
            Open <a href="https://docs.google.com/spreadsheets" target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-0.5">Google Sheets <ExternalLink className="w-3 h-3" /></a> → File → Import → Upload → select the CSV.
          </li>
          <li>File → Share → Publish to web → choose CSV format → Publish.</li>
          <li>Copy the file URL from your browser address bar (NOT the Publish URL).</li>
          <li>Paste it above and click <strong>Test connection</strong>.</li>
          <li>Click <strong>Sync now</strong> to seed the database.</li>
        </ol>
        <p className="mt-2">
          When editing a row, set <code>updated_at</code> to the current time (e.g. <code>{new Date().toISOString()}</code>) so the sync knows your edit is newer than what's in the database.
        </p>
      </details>
    </div>
  );
}
