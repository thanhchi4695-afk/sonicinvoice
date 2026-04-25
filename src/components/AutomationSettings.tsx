import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Loader2, Bot, Mail, Zap, Check, X, Edit2, FileUp, Upload, RefreshCw, ArrowRight, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SupplierRow {
  id: string;
  supplier_name: string;
  invoice_count: number | null;
  confidence_score: number | null;
  correction_rate: number | null;
  email_domains: string[] | null;
  auto_publish_eligible: boolean | null;
  last_invoice_date: string | null;
}

interface AutomationSettings {
  automation_email_monitoring: boolean;
  automation_auto_extract: boolean;
  automation_auto_publish: boolean;
  automation_min_confidence: number;
}

interface AgentRunSummary {
  run_id: string;
  supplier_name: string | null;
  products_extracted: number;
  products_auto_approved: number;
  products_flagged: number;
  auto_publish_available: boolean;
  products?: any[];
}

interface AgentRunRow {
  id: string;
  started_at: string;
  supplier_name: string | null;
  supplier_profile_id: string | null;
  invoice_filename: string | null;
  products_extracted: number;
  products_auto_approved: number;
  products_flagged: number;
  auto_published: boolean;
  human_review_required: boolean;
  status: string;
  error_message: string | null;
  metadata?: any;
}

const DEFAULTS: AutomationSettings = {
  automation_email_monitoring: false,
  automation_auto_extract: false,
  automation_auto_publish: false,
  automation_min_confidence: 90,
};

export default function AutomationSettings() {
  const [settings, setSettings] = useState<AutomationSettings>(DEFAULTS);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [domainDraft, setDomainDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<AgentRunSummary | null>(null);
  const [runs, setRuns] = useState<AgentRunRow[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void load();
    void loadRuns();
  }, []);

  // Live polling while any run is "running"
  useEffect(() => {
    if (!runs.some((r) => r.status === "running")) return;
    const t = setInterval(() => { void loadRuns(); }, 10000);
    return () => clearInterval(t);
  }, [runs]);

  async function load() {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setLoading(false);
      return;
    }

    const [settingsRes, suppliersRes] = await Promise.all([
      supabase
        .from("user_settings")
        .select(
          "automation_email_monitoring, automation_auto_extract, automation_auto_publish, automation_min_confidence",
        )
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("supplier_profiles")
        .select(
          "id, supplier_name, invoice_count, confidence_score, correction_rate, email_domains, auto_publish_eligible, last_invoice_date",
        )
        .eq("user_id", userId)
        .order("confidence_score", { ascending: false })
        .limit(50),
    ]);

    if (settingsRes.data) setSettings({ ...DEFAULTS, ...(settingsRes.data as any) });
    if (suppliersRes.data) setSuppliers(suppliersRes.data as SupplierRow[]);
    setLoading(false);
  }

  async function loadRuns() {
    setLoadingRuns(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) { setLoadingRuns(false); return; }
    const { data } = await supabase
      .from("agent_runs")
      .select("id, started_at, supplier_name, supplier_profile_id, invoice_filename, products_extracted, products_auto_approved, products_flagged, auto_published, human_review_required, status, error_message, metadata")
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .limit(20);
    setRuns((data ?? []) as AgentRunRow[]);
    setLoadingRuns(false);
  }

  async function openRunForReview(run: AgentRunRow, productsFromMemory?: any[]) {
    let freshRun = run;
    let products: any[] = productsFromMemory ?? extractProductsFromRun(run);
    const { data: runData, error: runError } = await supabase
      .from("agent_runs")
      .select("*")
      .eq("id", run.id)
      .maybeSingle();
    if (!runError && runData) {
      freshRun = runData as AgentRunRow;
      products = extractProductsFromRun(freshRun);
    }
    if (products.length === 0) {
      try {
        const cached = sessionStorage.getItem(`sonic_watchdog_run_${run.id}`);
        if (cached) products = JSON.parse(cached) ?? [];
      } catch { /* ignore */ }
    }

    const payload = {
      run_id: freshRun.id,
      supplier_name: freshRun.supplier_name?.trim() || "Unknown supplier",
      supplier_profile_id: freshRun.supplier_profile_id,
      products_extracted: freshRun.products_extracted,
      products_flagged: freshRun.products_flagged,
      auto_publish_eligible: !freshRun.human_review_required,
      products,
    };

    try {
      sessionStorage.setItem("sonic_watchdog_run", JSON.stringify(payload));
    } catch { /* ignore quota */ }

    // Verify the write
    const verify = sessionStorage.getItem("sonic_watchdog_run");
    if (!verify) {
      console.error("[Watchdog] sessionStorage write failed");
      toast.error("Could not stash run for review");
      return;
    }
    console.log("[Watchdog] sonic_watchdog_run set:", verify.slice(0, 120), `· products=${products.length}`);

    window.dispatchEvent(new CustomEvent("sonic:navigate-flow", { detail: "invoice" }));
  }

  async function persist(next: AutomationSettings) {
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setSaving(false);
      return;
    }
    const { error } = await supabase
      .from("user_settings")
      .upsert({ user_id: userId, ...next }, { onConflict: "user_id" });
    setSaving(false);
    if (error) {
      toast.error("Could not save automation settings");
      return;
    }
    setSettings(next);
  }

  function update<K extends keyof AutomationSettings>(key: K, value: AutomationSettings[K]) {
    const next = { ...settings, [key]: value };
    // Cascading deps: turning off a parent disables children
    if (key === "automation_email_monitoring" && !value) {
      next.automation_auto_extract = false;
      next.automation_auto_publish = false;
    }
    if (key === "automation_auto_extract" && !value) {
      next.automation_auto_publish = false;
    }
    void persist(next);
  }

  async function saveDomains(supplierId: string) {
    const list = domainDraft
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const { error } = await supabase
      .from("supplier_profiles")
      .update({ email_domains: list })
      .eq("id", supplierId);
    if (error) {
      toast.error("Could not save domains");
      return;
    }
    setSuppliers((prev) =>
      prev.map((s) => (s.id === supplierId ? { ...s, email_domains: list } : s)),
    );
    setEditingId(null);
    setDomainDraft("");
    toast.success("Email domains saved");
  }

  async function runWatchdog(file: File) {
    setRunning(true);
    setLastRun(null);
    try {
      const base64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke("agent-watchdog", {
        body: {
          trigger_type: "manual",
          file_base64: base64,
          file_name: file.name,
          mime_type: file.type || "application/pdf",
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "Watchdog failed");
      const summary = data as AgentRunSummary;
      setLastRun(summary);
      // In-app notification (NotificationBell uses localStorage). Link → account so the
      // user lands on Automation Settings where the Run History "Review →" button
      // pre-loads the run's products into the Invoice review screen.
      pushNotification({
        title: "Invoice processed — review needed",
        message: `${summary.products_extracted} products extracted${
          summary.supplier_name ? ` from ${summary.supplier_name}` : ""
        }. ${summary.products_flagged} need your review.`,
        severity: summary.products_flagged === 0 ? "success" : "info",
        runId: summary.run_id,
      });
      // Stash products so a quick click straight from the toast/recent-run card works
      try {
        sessionStorage.setItem(
          `sonic_watchdog_run_${summary.run_id}`,
          JSON.stringify(summary.products ?? []),
        );
      } catch { /* ignore */ }
      void loadRuns();
      toast.success("Watchdog run complete");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  const eligibleSuppliers = useMemo(
    () =>
      suppliers.filter(
        (s) =>
          (s.confidence_score ?? 0) >= settings.automation_min_confidence &&
          (s.correction_rate ?? 1) <= 0.05,
      ).length,
    [suppliers, settings.automation_min_confidence],
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading automation settings…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Toggles */}
      <div className="space-y-3">
        <ToggleRow
          icon={<Mail className="w-4 h-4" />}
          title="Email monitoring"
          description="Watch the connected inbox for new supplier emails."
          checked={settings.automation_email_monitoring}
          onChange={(v) => update("automation_email_monitoring", v)}
          disabled={saving}
        />
        <ToggleRow
          icon={<Bot className="w-4 h-4" />}
          title="Auto-extract when email arrives"
          description="Automatically run invoice parsing when a new supplier email is detected."
          checked={settings.automation_auto_extract}
          onChange={(v) => update("automation_auto_extract", v)}
          disabled={saving || !settings.automation_email_monitoring}
        />
        <ToggleRow
          icon={<Zap className="w-4 h-4" />}
          title="Auto-publish for trained suppliers"
          description="Push to Shopify automatically once supplier confidence is above the threshold below."
          checked={settings.automation_auto_publish}
          onChange={(v) => update("automation_auto_publish", v)}
          disabled={saving || !settings.automation_auto_extract}
        />
      </div>

      {/* Confidence slider */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-baseline justify-between mb-2">
          <label className="text-sm font-medium">
            Only auto-publish when confidence is above
          </label>
          <span className="font-mono-data text-base text-primary">
            {settings.automation_min_confidence}%
          </span>
        </div>
        <Slider
          min={70}
          max={99}
          step={1}
          value={[settings.automation_min_confidence]}
          onValueChange={([v]) => update("automation_min_confidence", v)}
        />
        <p className="text-[11px] text-muted-foreground mt-2">
          {eligibleSuppliers} of {suppliers.length} suppliers currently meet this threshold and have ≤5% correction rate.
        </p>
      </div>

      {/* Manual trigger */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Test the Watchdog Agent</p>
            <p className="text-[11px] text-muted-foreground">
              Upload an invoice to simulate the agent receiving it from email.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => fileInput.current?.click()}
            disabled={running}
          >
            {running ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <Upload className="w-3 h-3 mr-1" />
            )}
            Run watchdog now
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.xlsx,.xls,.csv,.doc,.docx,.jpg,.jpeg,.png,.heic,.webp,application/pdf,image/*,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void runWatchdog(f);
              e.target.value = "";
            }}
          />
        </div>
        {lastRun && (
          <div className="rounded-md bg-muted/40 p-3 text-xs space-y-1">
            <p className="font-medium">
              {lastRun.supplier_name ?? "Unknown supplier"} — {lastRun.products_extracted} products
            </p>
            <p className="text-muted-foreground">
              {lastRun.products_auto_approved} auto-approved · {lastRun.products_flagged} need review
            </p>
            {lastRun.auto_publish_available ? (
              <Badge className="bg-success text-success-foreground">Auto-publish available</Badge>
            ) : (
              <Badge variant="secondary">Human review required</Badge>
            )}
          </div>
        )}
      </div>

      {/* Supplier table */}
      <div className="rounded-lg border border-border bg-card">
        <div className="px-4 py-2 border-b border-border">
          <p className="text-sm font-medium">Supplier confidence</p>
        </div>
        {suppliers.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">
            No supplier profiles yet — process some invoices and they'll show here.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {suppliers.map((s) => {
              const conf = s.confidence_score ?? 0;
              const corr = s.correction_rate ?? 0;
              const eligible =
                conf >= settings.automation_min_confidence && corr <= 0.05;
              return (
                <div key={s.id} className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{s.supplier_name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {s.invoice_count ?? 0} invoices ·{" "}
                        <span className={correctionClass(corr)}>{correctionLabel(corr)}</span>
                      </p>
                    </div>
                    <div className="text-right">
                      {eligible ? (
                        <Badge className="bg-success text-success-foreground">
                          <Check className="w-3 h-3 mr-1" /> Eligible
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Not yet</Badge>
                      )}
                    </div>
                  </div>

                  {/* Confidence bar */}
                  <div>
                    <div className="flex items-center justify-between text-[10px] mb-1">
                      <span className={confidenceLabelClass(conf)}>
                        {confidenceLabel(conf)}
                      </span>
                      <span className="font-mono-data text-muted-foreground">{conf}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full ${confidenceBarClass(conf)}`}
                        style={{ width: `${conf}%` }}
                      />
                    </div>
                  </div>

                  {/* Email domains */}
                  {editingId === s.id ? (
                    <div className="flex items-center gap-2">
                      <Input
                        autoFocus
                        value={domainDraft}
                        onChange={(e) => setDomainDraft(e.target.value)}
                        placeholder="seafolly.com, seafolly.com.au"
                        className="h-8 text-xs"
                      />
                      <Button size="sm" onClick={() => saveDomains(s.id)}>
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingId(null);
                          setDomainDraft("");
                        }}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] text-muted-foreground truncate">
                        {(s.email_domains ?? []).length === 0
                          ? "No email domains set"
                          : (s.email_domains ?? []).join(", ")}
                      </p>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingId(s.id);
                          setDomainDraft((s.email_domains ?? []).join(", "));
                        }}
                      >
                        <Edit2 className="w-3 h-3" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Agent Run History */}
      <div className="rounded-lg border border-border bg-card">
        <div className="px-4 py-2 border-b border-border flex items-center justify-between">
          <p className="text-sm font-medium">Agent Run History</p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void loadRuns()}
            disabled={loadingRuns}
            className="h-7 px-2"
            aria-label="Refresh agent runs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingRuns ? "animate-spin" : ""}`} />
          </Button>
        </div>
        {runs.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">
            No agent runs yet. Use 'Run watchdog now' above to test the agent.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {runs.map((r) => (
              <RunRow key={r.id} run={r} onReview={openRunForReview} onRetry={() => void loadRuns()} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RunRow({
  run,
  onReview,
}: {
  run: AgentRunRow;
  onReview: (r: AgentRunRow, products?: any[]) => void;
  onRetry: () => void;
}) {
  const date = new Date(run.started_at).toLocaleString(undefined, {
    day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  });
  const file = run.invoice_filename
    ? run.invoice_filename.length > 25
      ? run.invoice_filename.slice(0, 22) + "…"
      : run.invoice_filename
    : "—";
  const stored = (() => {
    try {
      const raw = sessionStorage.getItem(`sonic_watchdog_run_${run.id}`);
      return raw ? JSON.parse(raw) : undefined;
    } catch { return undefined; }
  })();

  return (
    <div className="grid grid-cols-[1fr_auto] gap-3 p-3 items-center">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{date}</p>
        <p className="text-sm font-medium truncate">
          {run.supplier_name ?? "Unknown supplier"}
          <span className="text-muted-foreground font-normal"> · {file}</span>
        </p>
        <p className="text-[11px] text-muted-foreground">
          {run.products_extracted} extracted · {run.products_flagged} flagged
        </p>
        {run.status === "failed" && run.error_message && (
          <p className="text-[11px] text-destructive mt-1 flex items-start gap-1">
            <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
            <span className="truncate">{run.error_message.slice(0, 50)}</span>
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <RunStatusBadge status={run.status} />
        {run.status === "awaiting_review" && (
          <Button size="sm" variant="teal" onClick={() => onReview(run, stored)} className="h-7 text-[11px] px-2 gap-1">
            Review <ArrowRight className="w-3 h-3" />
          </Button>
        )}
        {run.status === "published" && (
          <span className="text-[11px] text-muted-foreground">View history</span>
        )}
        {run.status === "failed" && (
          <Button size="sm" variant="outline" onClick={() => onReview(run, stored)} className="h-7 text-[11px] px-2">
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}

function extractProductsFromRun(run: AgentRunRow): any[] {
  const metadata = run.metadata ?? {};
  const candidates = [
    metadata?.products,
    metadata?.extracted_products,
    metadata?.parse_result?.products,
    metadata?.parse_summary?.products,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate;
  }
  return [];
}

function RunStatusBadge({ status }: { status: string }) {
  if (status === "awaiting_review") return <Badge className="bg-secondary text-secondary-foreground">Needs review</Badge>;
  if (status === "published") return <Badge className="bg-success text-success-foreground">Published</Badge>;
  if (status === "failed") return <Badge className="bg-destructive text-destructive-foreground">Failed</Badge>;
  if (status === "running") return <Badge className="bg-primary text-primary-foreground">Processing…</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

// ── Helpers ────────────────────────────────────────────────

function ToggleRow({
  icon,
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-3">
      <div className="flex gap-3 flex-1 min-w-0">
        <div className="text-muted-foreground mt-0.5">{icon}</div>
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-[11px] text-muted-foreground">{description}</p>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

function confidenceLabel(c: number): string {
  if (c >= 90) return "Auto-publish ready";
  if (c >= 70) return "Almost ready";
  if (c >= 50) return "Learning";
  return "Untrained";
}
function confidenceLabelClass(c: number): string {
  if (c >= 90) return "text-success";
  if (c >= 70) return "text-primary";
  if (c >= 50) return "text-secondary-foreground";
  return "text-destructive";
}
function confidenceBarClass(c: number): string {
  if (c >= 90) return "bg-success";
  if (c >= 70) return "bg-primary";
  if (c >= 50) return "bg-secondary";
  return "bg-destructive";
}
function correctionLabel(c: number): string {
  if (c < 0.05) return "Excellent corrections";
  if (c <= 0.15) return "Good corrections";
  return "Needs review";
}
function correctionClass(c: number): string {
  if (c < 0.05) return "text-success";
  if (c <= 0.15) return "text-secondary-foreground";
  return "text-destructive";
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip data URL prefix
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function pushNotification(opts: {
  title: string;
  message: string;
  severity?: "urgent" | "warning" | "info" | "success";
  runId?: string;
}) {
  try {
    const STORAGE_KEY = "notifications_suppliersync";
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    list.unshift({
      id: crypto.randomUUID(),
      severity: opts.severity ?? "info",
      title: opts.title,
      message: opts.message,
      timestamp: new Date().toISOString(),
      read: false,
      // Land on Account → Automation Settings, where the Run History table has
      // the "Review →" button to open the specific run in the Invoice flow.
      link: "account",
      ...(opts.runId ? { runId: opts.runId } : {}),
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 100)));
    // Notify any mounted NotificationBell to re-read (same-tab writes don't fire `storage`).
    window.dispatchEvent(new CustomEvent("sonic:notifications-updated"));
  } catch {
    /* ignore */
  }
}
