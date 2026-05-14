import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, ArrowLeft } from "lucide-react";

interface CallRow {
  id: string;
  tool_name: string;
  status: string;
  duration_ms: number | null;
  error_message: string | null;
  arguments: Record<string, unknown> | null;
  called_at: string;
}

const fmtArgs = (a: Record<string, unknown> | null) => {
  if (!a || Object.keys(a).length === 0) return "—";
  return Object.entries(a).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ");
};

export default function ClaudeActivity() {
  const [rows, setRows] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("mcp_tool_calls")
      .select("id, tool_name, status, duration_ms, error_message, arguments, called_at")
      .order("called_at", { ascending: false })
      .limit(200);
    setRows((data ?? []) as CallRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const successCount = rows.filter(r => r.status === "success").length;
  const errorCount = rows.filter(r => r.status === "error").length;
  const avgMs = rows.length
    ? Math.round(rows.reduce((s, r) => s + (r.duration_ms ?? 0), 0) / rows.length)
    : 0;

  return (
    <div className="container mx-auto max-w-6xl py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Link to="/settings/claude-connector" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" /> Back to connector
          </Link>
          <h1 className="text-2xl font-semibold">Claude activity</h1>
          <p className="text-sm text-muted-foreground">
            Every tool call Claude.ai made via your Sonic Invoices MCP connector.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Total calls</CardTitle></CardHeader><CardContent className="text-2xl font-mono">{rows.length}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Success / Error</CardTitle></CardHeader><CardContent className="text-2xl font-mono">{successCount} / <span className="text-destructive">{errorCount}</span></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Avg duration</CardTitle></CardHeader><CardContent className="text-2xl font-mono">{avgMs} ms</CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent calls</CardTitle></CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {loading ? "Loading…" : "No tool calls yet. Connect Claude.ai and ask it about your store."}
            </div>
          ) : (
            <div className="divide-y">
              {rows.map(r => (
                <div key={r.id} className="px-4 py-3 grid grid-cols-12 gap-3 items-center text-sm">
                  <div className="col-span-3 font-mono text-xs">{r.tool_name}</div>
                  <div className="col-span-1">
                    <Badge variant={r.status === "success" ? "secondary" : "destructive"}>{r.status}</Badge>
                  </div>
                  <div className="col-span-1 font-mono text-xs text-muted-foreground">{r.duration_ms ?? 0}ms</div>
                  <div className="col-span-5 font-mono text-xs text-muted-foreground truncate" title={fmtArgs(r.arguments)}>
                    {fmtArgs(r.arguments)}
                  </div>
                  <div className="col-span-2 text-xs text-muted-foreground text-right">
                    {new Date(r.called_at).toLocaleString()}
                  </div>
                  {r.error_message && (
                    <div className="col-span-12 mt-1 text-xs text-destructive font-mono break-all">
                      {r.error_message}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
