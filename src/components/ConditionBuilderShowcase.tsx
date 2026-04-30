import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Shield,
  ChevronRight,
  CheckCircle2,
  Square,
  ArrowRight,
  Zap,
  MessageSquare,
  History,
  FlaskConical,
  Sparkles,
  Play,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

/**
 * Homepage showcase for the visual Condition Builder (Margin Guardian).
 * Self-contained: drop into any home view. Uses /rules as the primary CTA.
 */
const ConditionBuilderShowcase = () => {
  return (
    <section
      aria-labelledby="condition-builder-heading"
      className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/5 via-card to-card p-5 lg:p-7"
    >
      {/* Decorative glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl"
      />

      {/* Eyebrow */}
      <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
        <Sparkles className="h-3 w-3" /> New · Margin Guardian
      </div>

      {/* Headline */}
      <h2
        id="condition-builder-heading"
        className="font-display text-2xl font-bold leading-tight text-foreground lg:text-3xl"
      >
        Protect your margins without writing a single rule.
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Our visual Condition Builder lets you set profit guardrails in plain
        English. No code. No complex logic. Just click, choose, and save.
      </p>

      {/* Two-column body: mockup + how-it-works */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-5">
        {/* ── Annotated mockup ─────────────────────────── */}
        <div className="lg:col-span-3">
          <div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
            {/* Mock window header */}
            <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2">
              <div className="flex items-center gap-2">
                <Shield className="h-3.5 w-3.5 text-primary" />
                <span className="text-[11px] font-semibold text-foreground">
                  Margin Guardian — Condition Builder
                </span>
              </div>
              <div className="flex gap-1">
                <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
                <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
                <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
              </div>
            </div>

            <div className="space-y-3 p-3 font-mono text-[11px]">
              {/* WHEN block */}
              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                    WHEN
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    ① Choose your conditions
                  </span>
                </div>
                <div className="space-y-1.5 rounded-md border border-border bg-card p-2">
                  <Condition
                    field="Brand"
                    op="is exactly"
                    value="SunnySwim"
                    suffix="AND"
                  />
                  <Condition
                    field="Margin %"
                    op="is below"
                    value="45%"
                    suffix="AND"
                  />
                  <Condition
                    field="Total PO value"
                    op="is greater than"
                    value="$5,000"
                  />
                </div>
              </div>

              {/* THEN block */}
              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-500">
                    THEN
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    ② Pick your actions
                  </span>
                </div>
                <div className="space-y-1 rounded-md border border-border bg-card p-2">
                  <ActionRow checked icon={Shield} label="Block checkout" />
                  <ActionRow
                    checked
                    icon={MessageSquare}
                    label="Send Slack approval to #buying-team"
                  />
                  <ActionRow
                    checked={false}
                    icon={Zap}
                    label="Auto-correct price to 40% margin"
                  />
                </div>
              </div>

              {/* Footer buttons */}
              <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
                <span className="text-[10px] text-muted-foreground">
                  ③ Test before you trust
                </span>
                <div className="flex gap-1.5">
                  <span className="rounded-md border border-border bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
                    Save Rule
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[10px] font-semibold text-primary-foreground">
                    <FlaskConical className="h-3 w-3" /> Test live cart
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── How it works ─────────────────────────────── */}
        <div className="lg:col-span-2">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            How it works
          </h3>
          <ol className="space-y-3">
            <Step
              n={1}
              title="Set the line"
              you="Choose conditions: brand, margin %, total $"
              sonic="Builds a real-time profit rule"
            />
            <Step
              n={2}
              title="Decide the action"
              you="Block, alert via Slack, or auto-correct"
              sonic="Waits, ready to act"
            />
            <Step
              n={3}
              title="Forget about it"
              you="Keep buying on JOOR as usual"
              sonic="Watches every cart, protects margin"
            />
          </ol>
        </div>
      </div>

      {/* ── Selling-point bullets ─────────────────────── */}
      <ul className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { icon: Sparkles, text: "No-code visual builder" },
          { icon: Zap, text: "Real-time on JOOR & NuOrder" },
          { icon: MessageSquare, text: "Approve from Slack on your phone" },
          { icon: FlaskConical, text: "Dry-run rules on a live cart" },
          { icon: History, text: "Audit trail for every decision" },
          { icon: Shield, text: "Strict & relaxed margin modes" },
        ].map(({ icon: Icon, text }) => (
          <li
            key={text}
            className="flex items-center gap-2 rounded-md border border-border/50 bg-card/50 px-3 py-2 text-xs text-foreground"
          >
            <Icon className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
            {text}
          </li>
        ))}
      </ul>

      {/* ── CTA ───────────────────────────────────────── */}
      <div className="mt-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          Try the Condition Builder free — connect JOOR in 2 minutes.
        </p>
        <Link
          to="/rules/setup"
          className="group inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
        >
          Start protecting margins
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </section>
  );
};

// ─── Sub-components ─────────────────────────────────────────────

const Condition = ({
  field,
  op,
  value,
  suffix,
}: {
  field: string;
  op: string;
  value: string;
  suffix?: string;
}) => (
  <div className="flex flex-wrap items-center gap-1.5">
    <span className="rounded bg-muted px-1.5 py-0.5 text-foreground">
      {field}
    </span>
    <span className="text-muted-foreground">{op}</span>
    <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-semibold text-primary">
      {value}
    </span>
    {suffix && (
      <span className="ml-auto text-[10px] font-bold text-muted-foreground">
        {suffix}
      </span>
    )}
  </div>
);

const ActionRow = ({
  checked,
  icon: Icon,
  label,
}: {
  checked: boolean;
  icon: React.ElementType;
  label: string;
}) => (
  <div className="flex items-center gap-2">
    {checked ? (
      <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
    ) : (
      <Square className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/50" />
    )}
    <Icon className="h-3 w-3 text-muted-foreground" />
    <span className={checked ? "text-foreground" : "text-muted-foreground"}>
      {label}
    </span>
  </div>
);

const Step = ({
  n,
  title,
  you,
  sonic,
}: {
  n: number;
  title: string;
  you: string;
  sonic: string;
}) => (
  <li className="flex gap-3">
    <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
      {n}
    </div>
    <div className="flex-1 space-y-1">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground/80">You:</span> {you}
      </p>
      <p className="flex items-start gap-1 text-xs text-muted-foreground">
        <ChevronRight className="mt-0.5 h-3 w-3 flex-shrink-0 text-primary" />
        <span>
          <span className="font-medium text-foreground/80">Sonic:</span> {sonic}
        </span>
      </p>
    </div>
  </li>
);

export default ConditionBuilderShowcase;
