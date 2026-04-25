// Phase 3 — Agent Activity dashboard + automation status banner.
// Lightweight, read-only summary that sits at the top of Automation Settings.

import { useEffect, useState } from "react";
import { Activity, Zap, Mail, Inbox, Package, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

interface Stats {
  emails_scanned_today: number;
  invoices_found_today: number;
  products_extracted: number;
  products_published: number;
}

interface FeedItem {
  id: string;
  ts: string;
  kind: "scan" | "extracted" | "published" | "review" | "failed";
  text: string;
  status: string;
}

interface Props {
  hasGmail: boolean;
  monitoringOn: boolean;
  eligibleSuppliers: number;
}

export default function AgentActivityCard({ hasGmail, monitoringOn, eligibleSuppliers }: Props) {
  const [stats, setStats] = useState<Stats>({
    emails_scanned_today: 0,
    invoices_found_today: 0,
    products_extracted: 0,
    products_published: 0,
  });
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) { setLoading(false); return; }

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayIso = today.toISOString();

    const [{ data: invToday }, { data: runs }] = await Promise.all([
      supabase.from("gmail_found_invoices").select("id", { count: "exact" })
        .eq("user_id", userId).gte("created_at", todayIso),
      supabase.from("agent_runs")
        .select("id, started_at, supplier_name, status, products_extracted, products_flagged, auto_published, error_message")
        .eq("user_id", userId)
        .order("started_at", { ascending: false })
        .limit(10),
    ]);

    const runsAll = runs ?? [];
    const totalExtracted = runsAll.reduce((s, r: any) => s + (r.products_extracted ?? 0), 0);
    const totalPublished = runsAll
      .filter((r: any) => r.auto_published)
      .reduce((s, r: any) => s + (r.products_extracted ?? 0), 0);

    setStats({
      emails_scanned_today: invToday?.length ?? 0,
      invoices_found_today: invToday?.length ?? 0,
      products_extracted: totalExtracted,
      products_published: totalPublished,
    });

    setFeed(runsAll.map((r: any) => {
      const supplier = r.supplier_name || "Unknown supplier";
      if (r.status === "failed") return mkItem(r, "failed", `Processing failed — ${(r.error_message || "").slice(0, 60)}`);
      if (r.auto_published || r.status === "published") return mkItem(r, "published", `${supplier} — ${r.products_extracted} products live in Shopify`);
      if (r.status === "awaiting_review") return mkItem(r, "review", `${supplier} — ${r.products_flagged || r.products_extracted} products awaiting your review`);
      return mkItem(r, "extracted", `${supplier} invoice extracted — ${r.products_extracted} products`);
    }));
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  // Realtime: refresh on any agent_runs change
  useEffect(() => {
    const ch = supabase
      .channel("agent_runs_dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "agent_runs" }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  return (
    <div className="space-y-3">
      <StatusBanner hasGmail={hasGmail} monitoringOn={monitoringOn} eligibleSuppliers={eligibleSuppliers} />
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <p className="text-sm font-semibold">Agent activity</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat icon={<Mail className="w-3.5 h-3.5" />} label="Scanned today" value={stats.emails_scanned_today} />
          <Stat icon={<Inbox className="w-3.5 h-3.5" />} label="Invoices found" value={stats.invoices_found_today} />
          <Stat icon={<Package className="w-3.5 h-3.5" />} label="Products extracted" value={stats.products_extracted} />
          <Stat icon={<CheckCircle2 className="w-3.5 h-3.5" />} label="Published" value={stats.products_published} />
        </div>

        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Recent activity</p>
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>
          ) : feed.length === 0 ? (
            <p className="text-xs text-muted-foreground">No activity yet.</p>
          ) : (
            <ul className="space-y-2">
              {feed.map((f) => (
                <li key={f.id} className="flex items-start gap-2 text-xs">
                  <Zap className="w-3 h-3 mt-0.5 text-primary shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{f.text}</p>
                    <p className="text-[10px] text-muted-foreground">{relTime(f.ts)}</p>
                  </div>
                  <FeedBadge kind={f.kind} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBanner({ hasGmail, monitoringOn, eligibleSuppliers }: Props) {
  if (!hasGmail) {
    return (
      <Banner tone="amber" icon={<AlertCircle className="w-4 h-4" />}
        text="Automation inactive — connect Gmail and enable email monitoring to start processing invoices automatically." />
    );
  }
  if (!monitoringOn) {
    return (
      <Banner tone="muted" icon={<Mail className="w-4 h-4" />}
        text="Gmail connected · Monitoring paused — turn on Email monitoring to start." />
    );
  }
  if (eligibleSuppliers === 0) {
    return (
      <Banner tone="info" icon={<CheckCircle2 className="w-4 h-4" />}
        text="Monitoring active · No suppliers trained yet — process 10+ invoices from each supplier to enable auto-publish." />
    );
  }
  const mins = nextCheckMinutes();
  return (
    <Banner tone="success" icon={<CheckCircle2 className="w-4 h-4" />}
      text={`Fully automated · ${eligibleSuppliers} supplier${eligibleSuppliers === 1 ? "" : "s"} auto-publishing · Next check in ${mins} minute${mins === 1 ? "" : "s"}`} />
  );
}

function Banner({ tone, icon, text }: { tone: "amber" | "muted" | "info" | "success"; icon: React.ReactNode; text: string }) {
  const cls =
    tone === "amber" ? "bg-warning/10 border-warning/40 text-warning-foreground"
    : tone === "muted" ? "bg-muted/40 border-border text-muted-foreground"
    : tone === "info" ? "bg-primary/10 border-primary/40 text-primary"
    : "bg-success/10 border-success/40 text-success";
  return (
    <div className={`flex items-center gap-2 rounded-lg border p-3 text-xs ${cls}`}>
      {icon}<span>{text}</span>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-2.5">
      <div className="flex items-center gap-1 text-muted-foreground text-[10px]">{icon}<span>{label}</span></div>
      <p className="font-mono-data text-lg mt-0.5">{value}</p>
    </div>
  );
}

function FeedBadge({ kind }: { kind: FeedItem["kind"] }) {
  if (kind === "published") return <Badge className="bg-success text-success-foreground text-[10px]">Published</Badge>;
  if (kind === "failed") return <Badge className="bg-destructive text-destructive-foreground text-[10px]">Failed</Badge>;
  if (kind === "review") return <Badge variant="secondary" className="text-[10px]">Review</Badge>;
  if (kind === "extracted") return <Badge className="bg-primary text-primary-foreground text-[10px]">Extracted</Badge>;
  return <Badge variant="outline" className="text-[10px]">Scan</Badge>;
}

function mkItem(r: any, kind: FeedItem["kind"], text: string): FeedItem {
  return { id: r.id, ts: r.started_at, kind, text, status: r.status };
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function nextCheckMinutes(): number {
  const now = new Date();
  const m = now.getMinutes();
  const next = Math.ceil((m + 0.01) / 15) * 15;
  return Math.max(1, next - m);
}
