import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

interface PlanFeature {
  text: string;
  included: boolean;
}

interface Plan {
  name: string;
  price: number;
  currency: string;
  period: string;
  trial: string;
  badge?: string;
  intro?: string;
  features: PlanFeature[];
  bestFor: string;
}

const plans: Plan[] = [
  {
    name: "Starter",
    price: 29,
    currency: "AUD",
    period: "/month",
    trial: "14-day free trial",
    intro: "CORE FEATURES",
    features: [
      { text: "Invoice processing — AI reads PDFs, Excel & email invoices", included: true },
      { text: "Push products to Shopify (up to 500 products)", included: true },
      { text: "Tag engine — 7-layer auto-tagging", included: true },
      { text: "Google Feed Health — bulk scan & fix missing attributes", included: true },
      { text: "Lightspeed CSV export", included: true },
      { text: "Basic SEO descriptions (5/month)", included: true },
      { text: "Stock monitor — low stock alerts", included: true },
      { text: "AI Feed Optimisation — not included", included: false },
      { text: "Inventory planning (Stocky replacement) — not included", included: false },
      { text: "Social media posting — not included", included: false },
    ],
    bestFor: "Best for: solo boutiques, new Shopify stores, stores under 500 products",
  },
  {
    name: "Pro",
    price: 59,
    currency: "AUD",
    period: "/month",
    trial: "14-day free trial",
    badge: "Most popular",
    intro: "EVERYTHING IN STARTER, PLUS",
    features: [
      { text: "Unlimited products", included: true },
      { text: "AI Feed Optimisation — colour, gender, age_group auto-push to Google", included: true },
      { text: "Full SEO suite — Organic, Collection, GEO/Agentic SEO", included: true },
      { text: "Competitor intelligence", included: true },
      { text: "Inventory planning — purchase orders, demand forecasting, ABC analysis, stocktakes (Stocky replacement)", included: true },
      { text: "Bulk sale flows & markdown ladder", included: true },
      { text: "Price adjustment & margin protection", included: true },
      { text: "Social media — Facebook & Instagram AI captions + posting", included: true },
      { text: "Weekly inventory email reports", included: true },
      { text: "Google Ads setup wizard — not included", included: false },
    ],
    bestFor: "Best for: growing stores, multi-brand retailers, stores needing SEO & inventory tools",
  },
  {
    name: "Growth",
    price: 99,
    currency: "AUD",
    period: "/month",
    trial: "14-day free trial",
    intro: "EVERYTHING IN PRO, PLUS",
    features: [
      { text: "Google Ads — Performance Max campaign creation & management", included: true },
      { text: "Meta Ads setup wizard", included: true },
      { text: "Style grouping — related products metafields", included: true },
      { text: "Auto-collection builder", included: true },
      { text: "Priority support — same business day response", included: true },
      { text: "Dedicated onboarding call", included: true },
      { text: "Multi-location inventory (up to 5 locations)", included: true },
      { text: "Catalog memory — AI remembers your products", included: true },
    ],
    bestFor: "Best for: multi-location retailers, high-volume stores, agencies managing multiple brands",
  },
];

const PricingPlans = () => {
  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-foreground">Choose your plan</h2>
        <p className="text-sm text-muted-foreground">All plans include a 14-day free trial. Cancel anytime.</p>
      </div>

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
              <h3 className="text-lg font-bold text-foreground">{plan.name}</h3>
              <p className="text-xs text-muted-foreground">{plan.currency}</p>
              <div className="flex items-baseline gap-0.5">
                <span className="text-4xl font-extrabold text-foreground">${plan.price}</span>
                <span className="text-sm text-muted-foreground">{plan.period}</span>
              </div>
              <p className="text-xs text-muted-foreground">{plan.trial}</p>
            </CardHeader>

            <CardContent className="flex-1 space-y-4">
              {plan.intro && (
                <p className="text-xs font-semibold tracking-wider text-primary uppercase">{plan.intro}</p>
              )}

              <ul className="space-y-2.5">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    {f.included ? (
                      <Check className="w-4 h-4 mt-0.5 shrink-0 text-success" />
                    ) : (
                      <X className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className={f.included ? "text-foreground" : "text-muted-foreground"}>
                      {f.text}
                    </span>
                  </li>
                ))}
              </ul>

              <p className="text-xs text-muted-foreground italic pt-2 border-t border-border">
                {plan.bestFor}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default PricingPlans;
