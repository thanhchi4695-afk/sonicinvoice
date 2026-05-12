import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Play, RefreshCw, AlertTriangle, Brain, ChevronDown, ChevronRight, Globe, Pause } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import { BackButton } from "@/components/BackButton";
import PageHeader from "@/components/layout/PageHeader";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface AppSettings {
  id?: string;
  training_pipeline_enabled?: boolean | null;
  brand_context_injection_enabled?: boolean | null;
  daily_silent_parse_cap?: number | null;
}
interface MailboxRow {
  provider: "gmail" | "outlook" | "imap";
  id: string;
  email_address: string;
  is_active: boolean | null;
  historical_sweep_status: string | null;
  silent_parses_today: number | null;
  last_checked_at: string | null;
  reconnect_needed?: boolean;
  last_error?: string | null;
}
interface BrandPattern {
  id: string;
  brand_name: string | null;
  is_global: boolean | null;
  sample_count: number | null;
  avg_confidence: number | null;
  accuracy_rate: number | null;
  invoice_layout_fingerprint: any;
  column_map: Record<string, unknown> | null;
  header_row: number | null;
  paused_until: string | null;
  failed_streak: number | null;
  sender_domains: string[] | null;
  last_seen_at: string | null;
}
interface TrainingParse {
  id: string;
  brand_detected: string | null;
  attachment_filename: string | null;
  parse_confidence: number | null;
  parse_status: string | null;
  products_extracted: any;
  fields_detected: any;
  created_at: string;
}
interface CorrectionRow {
  id: string;
  supplier_key: string;
  field_corrected: string;
  value_before: string | null;
  value_after: string | null;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const fmtPct = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `${Math.round(Number(n) * 100)}%`;
const confColour = (n: number | null | undefined) => {
  const v = Number(n ?? 0);
  if (v >= 0.8) return "bg-success/15 text-success border-success/30";
  if (v >= 0.6) return "bg-amber-500/15 text-amber-500 border-amber-500/30";
  return "bg-destructive/15 text-destructive border-destructive/30";
};
const fmtAgo = (iso: string | null | undefined) => {
  if (!iso) return "never";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.round(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────
export default function AdminTrainingPipeline() {
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [settings, setSettings] = useState<AppSettings>({});
  const [mailboxes, setMailboxes] = useState<MailboxRow[]>([]);
  const [parsesToday, setParsesToday] = useState<number>(0);
  const [parsesThisWeek, setParsesThisWeek] = useState<number>(0);
  const [newPatterns, setNewPatterns] = useState<number>(0);
  const [patterns, setPatterns] = useState<BrandPattern[]>([]);
  const [recentParses, setRecentParses] = useState<TrainingParse[]>([]);
  const [corrections, setCorrections] = useState<CorrectionRow[]>([]);
  const [brandFilter, setBrandFilter] = useState("");
  const [correctionsBrand, setCorrectionsBrand] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const reconnectAlerts = useMemo(
    () => mailboxes.filter((m) => m.reconnect_needed),
    [mailboxes],
  );

  const loadAll = async () => {
    setLoading(true);
    const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

    const [settingsRes, gmailRes, outlookRes, imapRes, parsesRes, weekParsesRes, patternsRes, recentRes, corrRes, errRes] = await Promise.all([
      supabase.from("app_settings").select("id, training_pipeline_enabled, brand_context_injection_enabled, daily_silent_parse_cap").eq("singleton", true).maybeSingle(),
      supabase.from("gmail_connections").select("id, email_address, is_active, historical_sweep_status, silent_parses_today, silent_parses_today_date, last_checked_at"),
      supabase.from("outlook_connections").select("id, email_address, is_active, historical_sweep_status, silent_parses_today, silent_parses_today_date, last_checked_at"),
      supabase.from("imap_connections").select("id, email_address, is_active, historical_sweep_status, silent_parses_today, silent_parses_today_date, last_checked_at"),
      supabase.from("training_parses" as any).select("id", { count: "exact", head: true }).gte("created_at", todayStart.toISOString()),
      supabase.from("training_parses" as any).select("id", { count: "exact", head: true }).gte("created_at", weekAgo),
      supabase.from("brand_patterns").select("id, brand_name, is_global, sample_count, avg_confidence, accuracy_rate, invoice_layout_fingerprint, column_map, header_row, paused_until, failed_streak, sender_domains, last_seen_at, updated_at").order("sample_count", { ascending: false }).limit(200),
      supabase.from("training_parses" as any).select("id, brand_detected, attachment_filename, parse_confidence, parse_status, products_extracted, fields_detected, created_at").order("created_at", { ascending: false }).limit(150),
      supabase.from("corrections" as any).select("id, supplier_key, field_corrected, value_before, value_after, created_at").order("created_at", { ascending: false }).limit(200),
      supabase.from("gmail_found_invoices").select("from_email, silent_last_error, silent_status, silent_processed_at").not("silent_last_error", "is", null).order("silent_processed_at", { ascending: false }).limit(50),
    ]);

    setSettings(settingsRes.data || {});
    const isToday = (date: string | null) => {
      if (!date) return false;
      const d = new Date(date); d.setUTCHours(0, 0, 0, 0);
      return d.getTime() === todayStart.getTime();
    };
    const errMap = new Map<string, string>();
    for (const e of (errRes.data || []) as any[]) {
      const msg = String(e.silent_last_error || "");
      if (/unauthor|refresh failed|invalid_grant/i.test(msg)) {
        errMap.set((e.from_email || "").toLowerCase(), msg);
      }
    }
    const buildMb = (provider: MailboxRow["provider"], rows: any[]): MailboxRow[] =>
      (rows || []).map((r) => {
        const todayCount = isToday(r.silent_parses_today_date) ? (r.silent_parses_today ?? 0) : 0;
        const lastErr = errMap.get((r.email_address || "").toLowerCase()) || null;
        return {
          provider,
          id: r.id,
          email_address: r.email_address,
          is_active: r.is_active,
          historical_sweep_status: r.historical_sweep_status,
          silent_parses_today: todayCount,
          last_checked_at: r.last_checked_at,
          reconnect_needed: !!lastErr,
          last_error: lastErr,
        };
      });
    setMailboxes([
      ...buildMb("gmail", gmailRes.data || []),
      ...buildMb("outlook", outlookRes.data || []),
      ...buildMb("imap", imapRes.data || []),
    ]);
    setParsesToday(parsesRes.count ?? 0);
    setParsesThisWeek(weekParsesRes.count ?? 0);
    setPatterns((patternsRes.data || []) as BrandPattern[]);
    const newPat = (patternsRes.data || []).filter((p: any) => p.updated_at && new Date(p.updated_at).getTime() > Date.now() - 7 * 86_400_000).length;
    setNewPatterns(newPat);
    setRecentParses(((recentRes.data as any) || []) as TrainingParse[]);
    setCorrections(((corrRes.data as any) || []) as CorrectionRow[]);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  const updateSetting = async (key: keyof AppSettings, value: boolean) => {
    if (!settings.id) return;
    const patch: Record<string, boolean> = { [key]: value };
    const { error } = await supabase
      .from("app_settings")
      .update(patch as never)
      .eq("id", settings.id);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    setSettings((s) => ({ ...s, [key]: value }));
    toast({ title: `${key} → ${value ? "ON" : "OFF"}` });
  };

  const runDispatcher = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("silent-training-dispatcher", { body: {} });
      if (error) throw error;
      toast({ title: "Dispatcher run", description: `Processed: ${data?.processed ?? 0}, errors: ${data?.errors ?? 0}` });
      setTimeout(loadAll, 1500);
    } catch (e: any) {
      toast({ title: "Dispatcher failed", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const promoteGlobal = async (id: string) => {
    const { error } = await supabase.from("brand_patterns").update({ is_global: true }).eq("id", id);
    if (error) return toast({ title: "Promote failed", description: error.message, variant: "destructive" });
    toast({ title: "Promoted to global pattern" });
    loadAll();
  };
  const resetPattern = async (id: string) => {
    const { error } = await supabase.from("brand_patterns").update({
      column_map: null, sample_count: 0, avg_confidence: 0, failed_streak: 0, paused_until: null,
    }).eq("id", id);
    if (error) return toast({ title: "Reset failed", description: error.message, variant: "destructive" });
    toast({ title: "Pattern reset" });
    loadAll();
  };
  const clearBackoff = async (id: string) => {
    const { error } = await supabase.from("brand_patterns").update({ paused_until: null, failed_streak: 0 }).eq("id", id);
    if (error) return toast({ title: "Clear failed", description: error.message, variant: "destructive" });
    toast({ title: "Backoff cleared" });
    loadAll();
  };

  const filteredPatterns = useMemo(() => {
    const q = brandFilter.trim().toLowerCase();
    if (!q) return patterns;
    return patterns.filter((p) => (p.brand_name || "").toLowerCase().includes(q));
  }, [patterns, brandFilter]);

  const samplesForBrand = (brand: string | null) =>
    recentParses.filter((p) => (p.brand_detected || "") === (brand || "")).slice(0, 3);

  const correctionsForBrand = (brand: string | null) =>
    corrections.filter((c) => (c.supplier_key || "").toLowerCase() === (brand || "").toLowerCase());

  const filteredCorrections = useMemo(() => {
    if (correctionsBrand === "all") return corrections;
    return corrections.filter((c) => c.supplier_key === correctionsBrand);
  }, [corrections, correctionsBrand]);

  const mostCorrectedField = useMemo(() => {
    const counts = new Map<string, number>();
    corrections.forEach((c) => counts.set(c.field_corrected, (counts.get(c.field_corrected) || 0) + 1));
    let top = ""; let n = 0;
    counts.forEach((v, k) => { if (v > n) { top = k; n = v; } });
    return { field: top, count: n };
  }, [corrections]);

  const cap = settings.daily_silent_parse_cap ?? 500;

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-6xl px-4 py-6">
        <BackButton />
        <PageHeader
          title="Silent Training Pipeline"
          subtitle="Monitor brand pattern learning, manage the kill switch, and review parse quality before enabling live brand-context injection."
          actions={
            <Button variant="outline" size="sm" onClick={loadAll} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Refresh
            </Button>
          }
        />

        {reconnectAlerts.length > 0 && (
          <Card className="mb-4 border-destructive/40 bg-destructive/10">
            <CardContent className="py-3 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1 text-sm">
                <p className="font-semibold text-destructive">Mailbox reconnection needed</p>
                {reconnectAlerts.map((m) => (
                  <p key={m.id} className="text-xs text-destructive/80">
                    {m.provider}: <strong>{m.email_address}</strong> — {m.last_error?.slice(0, 120)}
                  </p>
                ))}
                <Link to="/settings" className="text-xs underline mt-1 inline-block">Reconnect in Email Connections →</Link>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Section 1 — Health summary tile */}
        <Card className="mb-4">
          <CardContent className="py-4 flex flex-wrap gap-6 items-center">
            <div className="flex items-center gap-2"><Brain className="w-5 h-5 text-primary" /><span className="font-display text-base">AI Learning</span></div>
            <Stat label="Parsed silently (7d)" value={parsesThisWeek} />
            <Stat label="Today" value={parsesToday} />
            <Stat label="New patterns (7d)" value={newPatterns} />
            <Stat label="Corrections (logged)" value={corrections.length} />
          </CardContent>
        </Card>

        {/* Section 2 — Pipeline status */}
        <Card className="mb-4">
          <CardHeader><CardTitle className="text-base">Pipeline status</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Training pipeline enabled</p>
                <p className="text-xs text-muted-foreground">Discover & silently parse invoices into <code>training_parses</code>.</p>
              </div>
              <Switch checked={!!settings.training_pipeline_enabled} onCheckedChange={(v) => updateSetting("training_pipeline_enabled", v)} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium flex items-center gap-2">
                  Brand context injection
                  <Badge variant="outline" className="bg-amber-500/15 text-amber-500 border-amber-500/30 text-[10px]">Only enable after reviewing brand pattern quality below</Badge>
                </p>
                <p className="text-xs text-muted-foreground">Inject learned column maps into live <code>parse-invoice</code> calls.</p>
              </div>
              <Switch checked={!!settings.brand_context_injection_enabled} onCheckedChange={(v) => updateSetting("brand_context_injection_enabled", v)} />
            </div>
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>Daily cap</span><span>{parsesToday} / {cap}</span>
              </div>
              <Progress value={Math.min(100, (parsesToday / Math.max(1, cap)) * 100)} />
            </div>
            <div className="pt-2">
              <Button size="sm" onClick={runDispatcher} disabled={running}>
                {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                Run dispatcher now
              </Button>
            </div>

            <div className="border-t border-border pt-3">
              <p className="text-xs font-medium mb-2 text-muted-foreground">Mailboxes</p>
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-1.5 font-medium">Email</th>
                    <th className="py-1.5 font-medium">Provider</th>
                    <th className="py-1.5 font-medium">Sweep</th>
                    <th className="py-1.5 font-medium">Today</th>
                    <th className="py-1.5 font-medium">Last check</th>
                    <th className="py-1.5 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {mailboxes.length === 0 && (
                    <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">No mailboxes connected.</td></tr>
                  )}
                  {mailboxes.map((m) => (
                    <tr key={`${m.provider}-${m.id}`} className="border-t border-border">
                      <td className="py-1.5">{m.email_address}</td>
                      <td className="py-1.5 text-muted-foreground">{m.provider}</td>
                      <td className="py-1.5"><Badge variant="outline" className="text-[10px]">{m.historical_sweep_status || "idle"}</Badge></td>
                      <td className="py-1.5">{m.silent_parses_today ?? 0}</td>
                      <td className="py-1.5 text-muted-foreground">{fmtAgo(m.last_checked_at)}</td>
                      <td className="py-1.5 text-right">
                        {m.reconnect_needed && (
                          <Link to="/settings" className="text-xs text-destructive underline">Reconnect</Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Section 3 — Brand pattern library */}
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>Brand pattern library</span>
              <Input value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} placeholder="Filter brand…" className="w-48 h-8 text-xs" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filteredPatterns.length === 0 && !loading && (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Brand patterns will appear here as invoices are parsed.
              </p>
            )}
            <div className="space-y-1">
              {filteredPatterns.map((p) => {
                const isPaused = p.paused_until && new Date(p.paused_until).getTime() > Date.now();
                const isExpanded = expanded === p.id;
                const conf = p.avg_confidence ?? p.accuracy_rate;
                return (
                  <div key={p.id} className="border border-border rounded">
                    <button
                      onClick={() => setExpanded(isExpanded ? null : p.id)}
                      className="w-full px-3 py-2 flex items-center gap-3 text-xs hover:bg-muted/30"
                    >
                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      <span className="font-medium flex-1 text-left">{p.brand_name || "(unnamed)"}</span>
                      {p.is_global && <Badge variant="outline" className="text-[10px]"><Globe className="w-3 h-3 mr-1" />global</Badge>}
                      <Badge variant="outline" className="text-[10px]">{p.sample_count ?? 0} parses</Badge>
                      <Badge variant="outline" className={`text-[10px] ${confColour(conf)}`}>{fmtPct(conf)}</Badge>
                      {p.invoice_layout_fingerprint && <span className="text-muted-foreground">{(p.invoice_layout_fingerprint as any)?.layoutType || "—"}</span>}
                      <span className="text-muted-foreground">{fmtAgo(p.last_seen_at)}</span>
                      {isPaused && <Badge variant="outline" className="text-[10px] bg-destructive/15 text-destructive border-destructive/30"><Pause className="w-3 h-3 mr-1" />paused</Badge>}
                    </button>
                    {isExpanded && (
                      <div className="px-3 pb-3 pt-1 border-t border-border bg-muted/20 space-y-3 text-xs">
                        <div>
                          <p className="font-medium mb-1">Last 3 silent parses</p>
                          {samplesForBrand(p.brand_name).length === 0 ? (
                            <p className="text-muted-foreground italic">No silent parses recorded for this brand yet.</p>
                          ) : (
                            <ul className="space-y-1">
                              {samplesForBrand(p.brand_name).map((s) => {
                                const products = Array.isArray(s.products_extracted) ? s.products_extracted : [];
                                return (
                                  <li key={s.id} className="border border-border rounded p-2 bg-background">
                                    <div className="flex justify-between gap-2">
                                      <span className="font-mono text-[11px] truncate">{s.attachment_filename || "(no file)"}</span>
                                      <Badge variant="outline" className={`text-[10px] ${confColour(s.parse_confidence)}`}>{fmtPct(s.parse_confidence)}</Badge>
                                    </div>
                                    <p className="text-muted-foreground mt-1">{products.length} products · status: {s.parse_status}</p>
                                    {products.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {products.slice(0, 3).map((prod: any, i: number) => (
                                          <Badge key={i} variant="outline" className="text-[10px] font-normal">
                                            {prod?.styleNumber || prod?.sku || prod?.productName || JSON.stringify(prod).slice(0, 30)}
                                          </Badge>
                                        ))}
                                      </div>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>

                        <div>
                          <p className="font-medium mb-1">Known column map</p>
                          {p.column_map && Object.keys(p.column_map).length ? (
                            <ul className="text-[11px] font-mono">
                              {Object.entries(p.column_map).map(([k, v]) => (
                                <li key={k}>{k} → {String(v)}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-muted-foreground italic">No column map learned yet.</p>
                          )}
                          {p.header_row !== null && <p className="text-muted-foreground mt-1">Header row: {p.header_row}</p>}
                          {p.sender_domains?.length ? (
                            <p className="text-muted-foreground mt-1">Sender domains: {p.sender_domains.join(", ")}</p>
                          ) : null}
                        </div>

                        <div>
                          <p className="font-medium mb-1">Corrections for this brand</p>
                          {correctionsForBrand(p.brand_name).length === 0 ? (
                            <p className="text-muted-foreground italic">None.</p>
                          ) : (
                            <ul className="space-y-0.5">
                              {correctionsForBrand(p.brand_name).slice(0, 8).map((c) => (
                                <li key={c.id} className="text-[11px]">
                                  <span className="font-medium">{c.field_corrected}:</span>{" "}
                                  <span className="text-muted-foreground">{c.value_before || "∅"} → {c.value_after || "∅"}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2 pt-1">
                          {!p.is_global && <Button size="sm" variant="outline" onClick={() => promoteGlobal(p.id)}>Promote to global</Button>}
                          <Button size="sm" variant="outline" onClick={() => resetPattern(p.id)}>Reset pattern</Button>
                          {isPaused && <Button size="sm" variant="outline" onClick={() => clearBackoff(p.id)}>Clear backoff</Button>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Section 4 — Corrections log */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>Corrections log</span>
              <select
                value={correctionsBrand}
                onChange={(e) => setCorrectionsBrand(e.target.value)}
                className="h-8 text-xs bg-card border border-border rounded px-2"
              >
                <option value="all">All brands</option>
                {Array.from(new Set(corrections.map((c) => c.supplier_key).filter(Boolean))).sort().map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {corrections.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No corrections logged yet. Corrections are captured when you edit products in the review screen before pushing to Shopify.
              </p>
            ) : (
              <>
                {mostCorrectedField.count > 0 && (
                  <p className="text-xs text-muted-foreground mb-2">
                    Most corrected field: <strong className="text-foreground">{mostCorrectedField.field}</strong> ({mostCorrectedField.count} corrections)
                  </p>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr className="text-left">
                        <th className="py-1.5 font-medium">Brand</th>
                        <th className="py-1.5 font-medium">Field</th>
                        <th className="py-1.5 font-medium">Before</th>
                        <th className="py-1.5 font-medium">After</th>
                        <th className="py-1.5 font-medium text-right">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCorrections.slice(0, 50).map((c) => (
                        <tr key={c.id} className="border-t border-border">
                          <td className="py-1.5">{c.supplier_key}</td>
                          <td className="py-1.5">{c.field_corrected}</td>
                          <td className="py-1.5 max-w-[180px] truncate text-muted-foreground" title={c.value_before || ""}>{c.value_before || "∅"}</td>
                          <td className="py-1.5 max-w-[180px] truncate" title={c.value_after || ""}>{c.value_after || "∅"}</td>
                          <td className="py-1.5 text-right text-muted-foreground">{fmtAgo(c.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const Stat = ({ label, value }: { label: string; value: number | string }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-lg font-display">{value}</p>
  </div>
);
