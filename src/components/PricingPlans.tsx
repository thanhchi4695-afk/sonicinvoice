import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

interface PlanFeature {
  text: string;
  included: boolean;
}

interface PlanSection {
  title: string;
  features: PlanFeature[];
}

interface Plan {
  name: string;
  price: number;
  currency: string;
  period: string;
  trial?: string;
  badge?: string;
  intro?: string;
  sections: PlanSection[];
  bestFor: string;
}

const plans: Plan[] = [
  {
    name: "Essentials",
    price: 49,
    currency: "AUD / month",
    period: "/mo",
    trial: "14-day free trial · no credit card",
    sections: [
      {
        title: "Invoice intake",
        features: [
          { text: "PDF, Excel, CSV, photo upload", included: true },
          { text: "AI invoice parsing (50/month)", included: true },
          { text: "Shopify CSV export", included: true },
          { text: "Brand intelligence flywheel", included: true },
          { text: "7-layer tag generation", included: true },
          { text: "SEO title + meta writer", included: true },
          { text: "Stock check (new / refill / colour)", included: true },
          { text: "Margin calculator", included: true },
        ],
      },
      {
        title: "Basic tools",
        features: [
          { text: "Feed health check", included: true },
          { text: "Product health audit", included: true },
          { text: "Sonic chat (navigation + Q&A)", included: true },
        ],
      },
    ],
    bestFor: "Best for: stores new to Sonic, testing the platform",
  },
  {
    name: "Pro",
    price: 99,
    currency: "AUD / month",
    period: "/mo",
    badge: "Most popular",
    intro: "Everything in Essentials, plus:",
    sections: [
      {
        title: "Full invoice suite",
        features: [
          { text: "Unlimited invoice parsing", included: true },
          { text: "Email forwarding intake", included: true },
          { text: "JOOR + wholesale platform sync", included: true },
          { text: "Lookbook import (Dropbox, Drive)", included: true },
          { text: "Xero / MYOB accounting push", included: true },
          { text: "Purchase orders + order forms", included: true },
        ],
      },
      {
        title: "Marketing suite",
        features: [
          { text: "Google feed optimisation (AI)", included: true },
          { text: "Google Ads + Meta Ads setup", included: true },
          { text: "Collection SEO AI writer", included: true },
          { text: "Social media captions", included: true },
          { text: "Competitor intel", included: true },
        ],
      },
      {
        title: "Inventory",
        features: [
          { text: "Stock monitor + reorder alerts", included: true },
          { text: "Markdown ladder + bulk sale", included: true },
          { text: "P&L analysis", included: true },
          { text: "5 automation pipelines", included: true },
          { text: "Morning briefing", included: true },
        ],
      },
    ],
    bestFor: "Best for: active stores processing 10+ invoices/month",
  },
  {
    name: "Agent",
    price: 179,
    currency: "AUD / month",
    period: "/mo",
    intro: "Everything in Pro, plus:",
    sections: [
      {
        title: "Proactive employee",
        features: [
          { text: "Proactive brain — Sonic acts autonomously", included: true },
          { text: "Auto-approve tags + SEO after parse", included: true },
          { text: "Pipeline auto-chaining", included: true },
          { text: "Stock alert → reorder auto-draft", included: true },
          { text: "Preference learning (approval patterns)", included: true },
          { text: "Full task graph + audit trail", included: true },
        ],
      },
      {
        title: "Advanced intelligence",
        features: [
          { text: "Agentic invoice parse in chat", included: true },
          { text: "Batch tag fixer (audit + repair)", included: true },
          { text: "Feed error auto-fix", included: true },
          { text: "GEO / AI search optimisation", included: true },
          { text: "Multi-location inventory (up to 5)", included: true },
          { text: "Dedicated onboarding call", included: true },
          { text: "Same business day support", included: true },
        ],
      },
    ],
    bestFor: "Best for: high-volume stores, agencies managing multiple clients",
  },
];

interface CompareRow {
  tool: string;
  scope: string;
  price: string;
}

const comparisonRows: CompareRow[] = [
  { tool: "Simprosys", scope: "Google feed only", price: "$5–35 USD/mo" },
  { tool: "Matrixify", scope: "Bulk import only", price: "$20–200 USD/mo" },
  { tool: "Prediko / Fabrikatör", scope: "Inventory only", price: "$29–350 USD/mo" },
  { tool: "SEO + social + invoice apps", scope: "Stitched together", price: "$60–150 USD/mo" },
  { tool: "Jasper AI", scope: "Content only", price: "$69 USD/seat/mo" },
];

const PricingPlans = () => {
  return (
    <div className="space-y-10">
      {/* ── Hero ─────────────────────────────────── */}
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-foreground font-display">Choose your plan</h2>
        <p className="text-sm text-muted-foreground">
          All plans include a 14-day free trial. Save 17% with annual billing.
        </p>
      </div>

      {/* ── Plans ────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map((plan) => (
          <Card
            key={plan.name}
            className={`relative flex flex-col ${
              plan.badge ? "border-primary ring-1 ring-primary" : "border-border"
            }`}
          >
            <CardHeader className="pb-3 space-y-1">
              {plan.badge && (
                <Badge variant="outline" className="w-fit border-primary text-primary text-xs mb-1">
                  {plan.badge}
                </Badge>
              )}
              <h3 className="text-lg font-bold text-foreground uppercase tracking-wide">
                {plan.name}
              </h3>
              <p className="text-xs text-muted-foreground">{plan.currency}</p>
              <div className="flex items-baseline gap-0.5">
                <span className="text-4xl font-extrabold text-foreground">${plan.price}</span>
                <span className="text-sm text-muted-foreground">{plan.period}</span>
              </div>
              {plan.trial && (
                <p className="text-xs text-muted-foreground">{plan.trial}</p>
              )}
              {plan.intro && (
                <p className="text-xs text-foreground/80 pt-1">{plan.intro}</p>
              )}
            </CardHeader>

            <CardContent className="flex-1 space-y-4">
              {plan.sections.map((section) => (
                <div key={section.title} className="space-y-2">
                  <p className="text-[10px] font-semibold tracking-wider text-primary uppercase">
                    {section.title}
                  </p>
                  <ul className="space-y-1.5">
                    {section.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs">
                        {f.included ? (
                          <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-success" />
                        ) : (
                          <X className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                        )}
                        <span className={f.included ? "text-foreground" : "text-muted-foreground"}>
                          {f.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              <p className="text-xs text-muted-foreground italic pt-2 border-t border-border">
                {plan.bestFor}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Comparison ───────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div>
          <h3 className="text-base font-semibold font-display">
            What equivalent tools cost separately
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Sonic Pro replaces this entire stack for $99 AUD/month (≈$62 USD).
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="text-left font-medium py-2">Tool</th>
                <th className="text-left font-medium py-2">Scope</th>
                <th className="text-right font-medium py-2">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {comparisonRows.map((r) => (
                <tr key={r.tool}>
                  <td className="py-2 font-medium text-foreground">{r.tool}</td>
                  <td className="py-2 text-muted-foreground">{r.scope}</td>
                  <td className="py-2 text-right font-mono-data text-foreground">{r.price}</td>
                </tr>
              ))}
              <tr className="bg-primary/10">
                <td className="py-2.5 font-semibold text-primary">Sonic Pro</td>
                <td className="py-2.5 text-foreground">All of the above in one</td>
                <td className="py-2.5 text-right font-mono-data font-semibold text-primary">
                  $99 AUD/mo
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Annual ───────────────────────────────── */}
      <section className="rounded-xl border border-border bg-muted/20 p-5 space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold font-display">Annual billing — 2 months free</h3>
          <Badge variant="outline" className="border-primary text-primary text-[10px]">
            Save 17%
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Pay yearly and lock in the rate.
        </p>
        <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-sm">
          <li className="rounded-lg border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">Essentials</p>
            <p className="font-mono-data font-semibold">$490 / yr</p>
          </li>
          <li className="rounded-lg border border-primary bg-card p-3">
            <p className="text-xs text-primary">Pro</p>
            <p className="font-mono-data font-semibold">$990 / yr</p>
          </li>
          <li className="rounded-lg border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">Agent</p>
            <p className="font-mono-data font-semibold">$1,790 / yr</p>
          </li>
        </ul>
      </section>
    </div>
  );
};

export default PricingPlans;
