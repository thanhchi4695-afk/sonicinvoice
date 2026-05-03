import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Shield,
  Plus,
  Activity,
  Ban,
  CheckCircle2,
  Clock,
  Loader2,
  Key,
  ListChecks,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useMarginRules } from "@/components/guardian/use-margin-rules";
import { ConditionBuilderDialog } from "@/components/guardian/ConditionBuilderDialog";
import {
  RuleTemplatePicker,
  type RuleTemplate,
} from "@/components/guardian/RuleTemplatePicker";
import { RuleListPage } from "@/components/guardian/RuleListPage";
import { ExtensionTokensPanel } from "@/components/guardian/ExtensionTokensPanel";

interface DecisionRow {
  id: string;
  rule_id: string | null;
  decision_outcome:
    | "allowed"
    | "blocked"
    | "pending_approval"
    | "approved"
    | "denied"
    | "expired";
  created_at: string;
  cart_snapshot: { brand?: string; sku?: string; margin_pct?: number } | null;
}

const OUTCOME_META: Record<DecisionRow["decision_outcome"], { label: string; tone: string; icon: typeof CheckCircle2 }> = {
  allowed: { label: "Allowed", tone: "bg-emerald-500/15 text-emerald-500", icon: CheckCircle2 },
  blocked: { label: "Blocked", tone: "bg-destructive/15 text-destructive", icon: Ban },
  pending_approval: { label: "Pending", tone: "bg-amber-500/15 text-amber-500", icon: Clock },
  approved: { label: "Approved", tone: "bg-emerald-500/15 text-emerald-500", icon: CheckCircle2 },
  denied: { label: "Denied", tone: "bg-destructive/15 text-destructive", icon: Ban },
  expired: { label: "Expired", tone: "bg-muted text-muted-foreground", icon: Clock },
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const Rules = () => {
  const { rules, loading: rulesLoading } = useMarginRules();
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [decisionsLoading, setDecisionsLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [template, setTemplate] = useState<RuleTemplate["seed"] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setDecisionsLoading(true);
      const { data } = await supabase
        .from("margin_agent_decisions")
        .select("id, rule_id, decision_outcome, created_at, cart_snapshot")
        .order("created_at", { ascending: false })
        .limit(8);
      if (!cancelled) {
        setDecisions((data as unknown as DecisionRow[]) ?? []);
        setDecisionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const ruleNameById = useMemo(() => {
    const map = new Map<string, string>();
    rules.forEach((r) => map.set(r.id, r.name));
    return map;
  }, [rules]);

  const stats = useMemo(() => {
    const active = rules.filter((r) => r.is_active).length;
    const blockedToday = decisions.filter(
      (d) =>
        d.decision_outcome === "blocked" &&
        new Date(d.created_at).toDateString() === new Date().toDateString(),
    ).length;
    const pending = decisions.filter((d) => d.decision_outcome === "pending_approval").length;
    return { total: rules.length, active, blockedToday, pending };
  }, [rules, decisions]);

  const handleNewRule = () => {
    setTemplate(null);
    setPickerOpen(true);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      {/* Hero / overview */}
      <header className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="rounded-md bg-amber-500/15 p-3 text-amber-500">
            <Shield className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold font-display">Margin Guardian</h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              No-code rules that protect your margin floor across JOOR, NuOrder, POs, and
              invoice review. Block risky carts, auto-correct prices, and route approvals
              to Slack or email.
            </p>
          </div>
        </div>
        <Button size="lg" onClick={handleNewRule} className="shrink-0">
          <Plus className="h-4 w-4" />
          New rule
        </Button>
      </header>

      {/* Stats */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={ListChecks}
          label="Total rules"
          value={rulesLoading ? "—" : String(stats.total)}
          tone="text-foreground"
        />
        <StatCard
          icon={Shield}
          label="Active"
          value={rulesLoading ? "—" : String(stats.active)}
          tone="text-emerald-500"
        />
        <StatCard
          icon={Ban}
          label="Blocked today"
          value={decisionsLoading ? "—" : String(stats.blockedToday)}
          tone="text-destructive"
        />
        <StatCard
          icon={Clock}
          label="Pending approval"
          value={decisionsLoading ? "—" : String(stats.pending)}
          tone="text-amber-500"
        />
      </section>

      {/* Recent activity */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" />
            Recent rule activity
          </CardTitle>
          <Link
            to="#rules-list"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            View all rules ↓
          </Link>
        </CardHeader>
        <CardContent>
          {decisionsLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading activity…
            </div>
          ) : decisions.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No rule decisions yet. Once a rule fires on a JOOR / NuOrder cart, it'll
              show up here.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {decisions.map((d) => {
                const meta = OUTCOME_META[d.decision_outcome];
                const Icon = meta.icon;
                const ruleName = d.rule_id ? ruleNameById.get(d.rule_id) ?? "Unknown rule" : "—";
                const brand = d.cart_snapshot?.brand;
                const margin = d.cart_snapshot?.margin_pct;
                return (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="flex min-w-0 items-center gap-3">
                      <Badge className={`${meta.tone} gap-1`} variant="secondary">
                        <Icon className="h-3 w-3" />
                        {meta.label}
                      </Badge>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{ruleName}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {brand ? `${brand} · ` : ""}
                          {margin != null ? `${margin}% margin` : "—"}
                        </div>
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {timeAgo(d.created_at)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Rule list */}
      <section id="rules-list" className="scroll-mt-6">
        <RuleListPage />
      </section>

      {/* Extension tokens */}
      <section>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Key className="h-4 w-4" />
              Chrome extension tokens
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ExtensionTokensPanel />
          </CardContent>
        </Card>
      </section>

      {/* Hero CTA dialogs */}
      <RuleTemplatePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(seed) => {
          setTemplate(seed);
          setPickerOpen(false);
          setBuilderOpen(true);
        }}
      />
      <ConditionBuilderDialog
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        rule={null}
        template={template}
        defaultPriority={rules.length}
      />
    </div>
  );
};

interface StatCardProps {
  icon: typeof Shield;
  label: string;
  value: string;
  tone: string;
}

function StatCard({ icon: Icon, label, value, tone }: StatCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className={`flex items-center gap-2 text-xs font-medium uppercase tracking-wide ${tone}`}>
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold">{value}</div>
    </div>
  );
}

export default Rules;
