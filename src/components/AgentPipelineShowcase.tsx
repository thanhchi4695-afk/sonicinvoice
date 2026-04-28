// ════════════════════════════════════════════════════════════════
// AgentPipelineShowcase — 5-agent pipeline visual for the home
// screen with live status badges and an onboarding checklist.
// ════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { Eye, Layers, Sparkles, Rocket, Brain, ArrowRight, CheckCircle2, ChevronRight, PlayCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import AgentInfoPopover, { type AgentInfo } from "./AgentInfoPopover";
import AgentTourController, { type TourStep } from "./AgentTourController";

const AGENT_INFO: Record<string, AgentInfo> = {
  Watchdog: {
    name: "Watchdog",
    why: "Monitors your inbox so invoices land in the pipeline the moment a supplier sends them — no manual upload needed.",
    inputs: ["Connected Gmail account", "Sender allowlist (supplier emails)"],
    outputs: ["Detected invoice attachments queued for processing"],
    triggers: "Continuously, when Gmail monitoring is enabled.",
  },
  Classifier: {
    name: "Classifier",
    why: "Learns each supplier's invoice layout so extraction gets faster and more accurate after every run.",
    inputs: ["Invoice PDF / image", "Supplier profile + past corrections"],
    outputs: ["Structured line items (SKU, name, qty, cost)", "Confidence scores per field"],
    triggers: "When a new invoice enters the pipeline.",
  },
  Enrichment: {
    name: "Enrichment",
    why: "Wholesale invoices lack retail-ready data. This agent fetches descriptions, RRP, images and attributes from brand sites and stockists.",
    inputs: ["Classified invoice lines", "Brand + product attributes"],
    outputs: ["Product descriptions, RRP, hero images, tags"],
    triggers: "After classification, for any line missing retail attributes.",
  },
  Publishing: {
    name: "Publishing",
    why: "Pushes verified products straight to Shopify so eligible suppliers go from invoice → live listing hands-free.",
    inputs: ["Enriched products with HIGH confidence (≥90%)", "Shopify connection"],
    outputs: ["Live Shopify products + variants", "Inventory + pricing updates"],
    triggers: "When auto-publish is on and supplier is publish-eligible.",
  },
  Learning: {
    name: "Learning",
    why: "Every correction trains the supplier profile so future invoices need less manual review — confidence rises over time.",
    inputs: ["User corrections", "Run history per supplier"],
    outputs: ["Updated supplier profile", "Auto-publish eligibility flag"],
    triggers: "After every processed invoice.",
  },
};

interface Props {
  onOpenGuide?: () => void;
  onOpenAutomation?: () => void;
  onStartInvoice?: () => void;
  onOpenIntegrations?: () => void;
}

interface PipelineState {
  watchdogActive: boolean;
  classifierTrained: number;
  productsEnriched: number;
  publishingActive: boolean;
  publishingEligible: number;
  totalInvoicesLearned: number;
  // checklist
  storeConnected: boolean;
  hasFirstRun: boolean;
  gmailConnected: boolean;
  hasTrainedSupplier: boolean;
  autoPublishEnabled: boolean;
}

const AgentPipelineShowcase = ({ onOpenGuide, onOpenAutomation, onStartInvoice, onOpenIntegrations }: Props) => {
  const [s, setS] = useState<PipelineState | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [activeTourId, setActiveTourId] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return;

    const [gmail, settings, suppliers, prods, runs, platforms] = await Promise.all([
      supabase.from("gmail_connections").select("id").eq("user_id", userId).maybeSingle(),
      supabase.from("user_settings").select("automation_email_monitoring,automation_auto_publish").eq("user_id", userId).maybeSingle(),
      supabase.from("supplier_profiles").select("invoice_count,auto_publish_eligible").eq("user_id", userId),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("user_id", userId).not("description", "is", null),
      supabase.from("agent_runs").select("id", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("platform_connections").select("id").eq("user_id", userId).limit(1).maybeSingle(),
    ]);

    const supRows = (suppliers.data ?? []) as { invoice_count: number; auto_publish_eligible: boolean | null }[];
    const eligible = supRows.filter((r) => r.auto_publish_eligible).length;
    const totalInv = supRows.reduce((n, r) => n + (r.invoice_count ?? 0), 0);
    const trainedCount = supRows.length;
    const hasTrained = supRows.some((r) => (r.invoice_count ?? 0) >= 10);

    setS({
      watchdogActive: !!gmail.data && !!settings.data?.automation_email_monitoring,
      classifierTrained: trainedCount,
      productsEnriched: prods.count ?? 0,
      publishingActive: !!settings.data?.automation_auto_publish && eligible > 0,
      publishingEligible: eligible,
      totalInvoicesLearned: totalInv,
      storeConnected: !!platforms.data,
      hasFirstRun: (runs.count ?? 0) > 0,
      gmailConnected: !!gmail.data,
      hasTrainedSupplier: hasTrained,
      autoPublishEnabled: !!settings.data?.automation_auto_publish,
    });
  }

  if (!s) return null;

  const cards = [
    { name: "Watchdog", desc: "Email monitoring", icon: Eye, active: s.watchdogActive, meta: s.watchdogActive ? "Listening for invoices" : null, cta: !s.watchdogActive ? { label: "Connect Gmail", onClick: onOpenAutomation } : undefined },
    { name: "Classifier", desc: "Invoice intelligence", icon: Layers, active: true, meta: `${s.classifierTrained} suppliers trained` },
    { name: "Enrichment", desc: "Auto descriptions & prices", icon: Sparkles, active: true, meta: `${s.productsEnriched} products enriched` },
    { name: "Publishing", desc: "Auto-publish to Shopify", icon: Rocket, active: s.publishingActive, meta: `${s.publishingEligible} eligible suppliers`, cta: !s.publishingActive ? { label: "Enable", onClick: onOpenAutomation } : undefined },
    { name: "Learning", desc: "Smarter every invoice", icon: Brain, active: true, meta: `${s.totalInvoicesLearned} invoices learned` },
  ];

  const activeCount = cards.filter((c) => c.active).length;

  // Checklist
  const steps = [
    { key: "store", label: "Connect your store", desc: "Link Shopify or Lightspeed", done: s.storeConnected, action: { label: "Connect", onClick: onOpenIntegrations } },
    { key: "first", label: "Process your first invoice", desc: "Upload an invoice to start learning", done: s.hasFirstRun, action: { label: "Process invoice", onClick: onStartInvoice } },
    { key: "gmail", label: "Connect Gmail", desc: "Enable automatic email monitoring", done: s.gmailConnected, action: { label: "Connect Gmail", onClick: onOpenAutomation } },
    { key: "train", label: "Train your top suppliers", desc: "Process 10 invoices from your main suppliers", done: s.hasTrainedSupplier, action: { label: "Process invoice", onClick: onStartInvoice } },
    { key: "auto", label: "Enable auto-publish", desc: "Turn on hands-free publishing", done: s.autoPublishEnabled, action: { label: "Enable in settings", onClick: onOpenAutomation } },
  ];
  const incomplete = steps.filter((st) => !st.done);
  const completedCount = steps.length - incomplete.length;

  return (
    <div className="space-y-4">
      {/* ── Pipeline header ─────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Your AI automation pipeline</h2>
          <p className="text-xs text-muted-foreground">5 agents working together to process invoices hands-free.</p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setTourOpen(true)} className="text-xs">
            <PlayCircle className="h-3 w-3" /> Tour
          </Button>
          {onOpenGuide && (
            <Button variant="ghost" size="sm" onClick={onOpenGuide} className="text-xs">
              See how it works <ChevronRight className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* ── 5 agent cards ───────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        {cards.map((c, i) => {
          const Icon = c.icon;
          const tourId = `pipeline-${c.name.toLowerCase()}`;
          const isActiveTourTarget = activeTourId === tourId;
          return (
            <div key={c.name} className="relative" data-tour-id={tourId}>
              <Card
                className={cn(
                  "flex h-full flex-col gap-2 p-3 transition-colors",
                  c.active ? "border-primary/30 bg-card" : "border-border bg-muted/20"
                )}
              >
                <div className="flex items-start justify-between">
                  <div className={cn("flex h-8 w-8 items-center justify-center rounded-md", c.active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex items-center gap-1">
                    {AGENT_INFO[c.name] && <AgentInfoPopover info={AGENT_INFO[c.name]} />}
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        c.active ? "bg-success" : "bg-muted-foreground/40"
                      )}
                      aria-label={c.active ? "active" : "inactive"}
                    />
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-foreground">{c.name}</p>
                  <p className="text-[10px] text-muted-foreground">{c.desc}</p>
                </div>
                {c.meta && <p className="text-[10px] text-muted-foreground">{c.meta}</p>}
                {c.cta && (
                  <Button size="sm" variant="outline" className="mt-auto h-6 text-[10px]" onClick={c.cta.onClick}>
                    {c.cta.label}
                  </Button>
                )}
              </Card>
              {/* arrow connector for desktop */}
              {i < cards.length - 1 && (
                <ArrowRight className="absolute right-[-10px] top-1/2 hidden h-3 w-3 -translate-y-1/2 text-muted-foreground/40 lg:block" />
              )}
            </div>
          );
        })}
      </div>

      {/* ── Pipeline status banner ──────────────────── */}
      {activeCount === 5 ? (
        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-xs text-success">
          <CheckCircle2 className="h-4 w-4" />
          Full automation active — invoices processed hands-free for eligible suppliers
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground">{activeCount} of 5</span> agents active
          </span>
          {onOpenAutomation && (
            <button onClick={onOpenAutomation} className="font-semibold text-primary hover:underline">
              Complete setup →
            </button>
          )}
        </div>
      )}

      {/* ── Onboarding checklist ────────────────────── */}
      {incomplete.length > 0 && (
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold text-foreground">Setup checklist</p>
            <span className="text-[10px] text-muted-foreground">{completedCount} of {steps.length} complete</span>
          </div>
          <Progress value={(completedCount / steps.length) * 100} className="mb-3 h-1.5" />
          <ul className="space-y-2">
            {incomplete.map((st) => (
              <li key={st.key} className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-2">
                <div>
                  <p className="text-xs font-medium text-foreground">{st.label}</p>
                  <p className="text-[10px] text-muted-foreground">{st.desc}</p>
                </div>
                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={st.action.onClick}>
                  {st.action.label}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
};

export default AgentPipelineShowcase;
