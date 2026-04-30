import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Shield,
  CheckCircle2,
  Circle,
  ArrowLeft,
  ArrowRight,
  Loader2,
  Plug,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  RuleTemplatePicker,
  type RuleTemplate,
} from "@/components/guardian/RuleTemplatePicker";
import { ConditionBuilderDialog } from "@/components/guardian/ConditionBuilderDialog";
import { useMarginRules } from "@/components/guardian/use-margin-rules";
import { toast } from "sonner";

type JoorStatus = "checking" | "connected" | "disconnected";

const RulesSetup = () => {
  const navigate = useNavigate();
  const { rules } = useMarginRules();

  const [joorStatus, setJoorStatus] = useState<JoorStatus>("checking");
  const [joorLabel, setJoorLabel] = useState<string>("");
  const [picked, setPicked] = useState<RuleTemplate["seed"] | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [hadRulesAtStart] = useState(() => rules.length);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setJoorStatus("disconnected");
        return;
      }
      const { data, error } = await supabase
        .from("joor_connections")
        .select("token_label")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (error || !data) {
        setJoorStatus("disconnected");
      } else {
        setJoorLabel(data.token_label || "JOOR Account");
        setJoorStatus("connected");
      }
    })();
  }, []);

  // When a new rule appears (saved), this effect detects success and routes to /rules.
  useEffect(() => {
    if (showBuilder) return; // wait until dialog closed
    if (rules.length > hadRulesAtStart) {
      toast.success("Rule saved — Margin Guardian is live");
      navigate("/rules");
    }
  }, [rules.length, showBuilder, hadRulesAtStart, navigate]);

  const steps = [
    {
      n: 1,
      title: "Connect JOOR",
      description: "We need read access to your wholesale carts.",
      done: joorStatus === "connected",
    },
    {
      n: 2,
      title: "Pick a starting template",
      description: "Choose a common guardrail or start from blank.",
      done: !!picked,
    },
    {
      n: 3,
      title: "Save your first rule",
      description: "Tweak the conditions and actions, then save.",
      done: false,
    },
  ];

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="border-b border-border bg-card/40 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 lg:px-6">
          <Link
            to="/"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Back to home"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <h1 className="font-display text-base font-semibold">
              Margin Guardian — First-run setup
            </h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 lg:px-6 lg:py-10 space-y-6">
        {/* Hero */}
        <section className="space-y-2">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
            <Sparkles className="h-3 w-3" /> 3-step setup · about 2 minutes
          </div>
          <h2 className="font-display text-2xl font-bold lg:text-3xl">
            Start protecting your margins
          </h2>
          <p className="text-sm text-muted-foreground">
            Connect JOOR, pick a template, save your rule. Sonic does the rest.
          </p>
        </section>

        {/* Stepper */}
        <ol className="space-y-2">
          {steps.map((s) => (
            <li
              key={s.n}
              className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
            >
              {s.done ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
              ) : (
                <Circle className="mt-0.5 h-5 w-5 flex-shrink-0 text-muted-foreground/40" />
              )}
              <div className="flex-1">
                <p className="text-sm font-semibold">
                  Step {s.n}. {s.title}
                </p>
                <p className="text-xs text-muted-foreground">{s.description}</p>
              </div>
            </li>
          ))}
        </ol>

        {/* ─── Step 1: JOOR connection card ─────────────────── */}
        <section
          aria-labelledby="joor-step"
          className="rounded-xl border border-border bg-card p-5"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 id="joor-step" className="font-semibold">
                1. JOOR connection
              </h3>
              <p className="text-xs text-muted-foreground">
                Required so Guardian can watch live carts and PO totals.
              </p>
            </div>
            <JoorBadge status={joorStatus} label={joorLabel} />
          </div>

          {joorStatus === "checking" && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking your account…
            </p>
          )}

          {joorStatus === "disconnected" && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400" />
                <p>
                  No JOOR account linked. Connect one to enable live cart
                  watching. You can still save a rule now and it'll activate
                  automatically once JOOR is connected.
                </p>
              </div>
              <Link
                to="/?tab=account&open=joor"
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-muted"
              >
                <Plug className="h-3.5 w-3.5" />
                Connect JOOR in Account Settings
              </Link>
            </div>
          )}

          {joorStatus === "connected" && (
            <p className="text-xs text-muted-foreground">
              Connected as{" "}
              <span className="font-medium text-foreground">{joorLabel}</span>.
              Cart events will be evaluated against your rules in real time.
            </p>
          )}
        </section>

        {/* ─── Step 2 + 3: Template + save ──────────────────── */}
        <section
          aria-labelledby="rule-step"
          className="rounded-xl border border-border bg-card p-5"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 id="rule-step" className="font-semibold">
                2. Pick a starting template
              </h3>
              <p className="text-xs text-muted-foreground">
                Reuse a proven guardrail, then customise the conditions.
              </p>
            </div>
            {picked && (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                {picked.name}
              </span>
            )}
          </div>

          <button
            onClick={() => setShowPicker(true)}
            className="w-full rounded-md border border-dashed border-border bg-muted/30 px-3 py-3 text-left text-sm hover:bg-muted/50"
          >
            <span className="font-medium text-foreground">
              {picked ? "Change template" : "Browse templates"}
            </span>
            <span className="block text-xs text-muted-foreground">
              5 common guardrails available — Slack alerts, checkout blocks,
              auto-corrections.
            </span>
          </button>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {picked
                ? "Open the builder to review and save."
                : "Pick a template to enable the builder."}
            </p>
            <button
              onClick={() => setShowBuilder(true)}
              disabled={!picked}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Open builder & save
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </section>

        {/* Existing rules notice */}
        {rules.length > 0 && (
          <p className="text-center text-xs text-muted-foreground">
            You already have {rules.length} rule{rules.length === 1 ? "" : "s"}.{" "}
            <Link to="/rules" className="text-primary hover:underline">
              Skip setup and manage rules →
            </Link>
          </p>
        )}
      </main>

      {/* Pickers / dialogs */}
      <RuleTemplatePicker
        open={showPicker}
        onOpenChange={setShowPicker}
        onPick={(seed) => {
          if (seed) setPicked(seed);
          setShowPicker(false);
          // Auto-open builder after pick for momentum.
          setTimeout(() => setShowBuilder(true), 150);
        }}
      />
      <ConditionBuilderDialog
        open={showBuilder}
        onOpenChange={setShowBuilder}
        rule={null}
        template={picked ?? undefined}
        defaultPriority={rules.length}
      />
    </div>
  );
};

const JoorBadge = ({ status, label }: { status: JoorStatus; label: string }) => {
  if (status === "checking") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Checking
      </span>
    );
  }
  if (status === "connected") {
    return (
      <span
        title={label}
        className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary"
      >
        <CheckCircle2 className="h-3 w-3" /> Connected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
      <AlertCircle className="h-3 w-3" /> Not connected
    </span>
  );
};

export default RulesSetup;
