import { useState, useEffect } from "react";
import { CreditCard, Loader2, Check, Zap, Shield, FileText, Package, Users, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Progress } from "@/components/ui/progress";

const PLANS = [
  {
    key: "starter",
    name: "Starter",
    price: 29,
    highlight: false,
    invoiceLimit: 50,
    teamLimit: 1,
    features: ["Up to 50 invoices/mo", "Basic SEO tools", "1 team member", "Email support"],
  },
  {
    key: "pro",
    name: "Pro",
    price: 59,
    highlight: true,
    invoiceLimit: null as number | null,
    teamLimit: 5,
    features: ["Unlimited invoices", "AI feed optimisation", "5 team members", "Priority support", "Margin protection"],
  },
  {
    key: "growth",
    name: "Growth",
    price: 99,
    highlight: false,
    invoiceLimit: null as number | null,
    teamLimit: null as number | null,
    features: ["Everything in Pro", "Unlimited team", "API access", "Dedicated support", "Custom integrations"],
  },
];

interface UsageMetrics {
  invoicesThisMonth: number;
  totalProducts: number;
  totalSuppliers: number;
  totalDocuments: number;
}

const BillingScreen = () => {
  const [billingStatus, setBillingStatus] = useState<{
    has_subscription: boolean;
    plan_name: string | null;
    status: string;
    connected?: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageMetrics>({ invoicesThisMonth: 0, totalProducts: 0, totalSuppliers: 0, totalDocuments: 0 });

  useEffect(() => {
    checkBillingStatus();
    loadUsageMetrics();
  }, []);

  const checkBillingStatus = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("shopify-billing", {
        body: { action: "status" },
      });
      if (!error && data) {
        setBillingStatus(data);
      }
    } catch {
      // Silently ignore
    } finally {
      setLoading(false);
    }
  };

  const loadUsageMetrics = async () => {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [docsRes, productsRes, suppliersRes, allDocsRes] = await Promise.all([
      supabase.from("documents").select("id", { count: "exact", head: true }).gte("created_at", startOfMonth.toISOString()),
      supabase.from("products").select("id", { count: "exact", head: true }),
      supabase.from("suppliers").select("id", { count: "exact", head: true }),
      supabase.from("documents").select("id", { count: "exact", head: true }),
    ]);

    setUsage({
      invoicesThisMonth: docsRes.count ?? 0,
      totalProducts: productsRes.count ?? 0,
      totalSuppliers: suppliersRes.count ?? 0,
      totalDocuments: allDocsRes.count ?? 0,
    });
  };

  const handleSubscribe = async (plan: string) => {
    setSubscribing(plan);
    try {
      const returnUrl = window.location.href;
      const { data, error } = await supabase.functions.invoke("shopify-billing", {
        body: { action: "create", plan, return_url: returnUrl, test: true },
      });
      if (error) throw new Error(error.message);
      if (data?.confirmation_url) {
        window.location.href = data.confirmation_url;
      }
    } catch (err) {
      console.error("Subscribe failed:", err);
    } finally {
      setSubscribing(null);
    }
  };

  return (
    <div className="px-4 pt-2 pb-24 animate-fade-in">
      <h1 className="text-2xl font-bold font-display mb-1">Plan & Billing</h1>
      <p className="text-sm text-muted-foreground mb-6">Manage your subscription and billing details</p>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Checking billing status...</span>
        </div>
      ) : billingStatus?.has_subscription ? (
        <div className="space-y-4">
          <div className="bg-primary/10 border border-primary/30 rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-primary" />
              <span className="text-lg font-semibold">{billingStatus.plan_name || "Starter"}</span>
              <span className="ml-auto text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full font-medium capitalize">
                {billingStatus.status}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Manage your subscription from the Shopify admin → Apps section.
            </p>
          </div>

          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold mb-3">Upgrade your plan</h3>
            <p className="text-xs text-muted-foreground mb-4">Switch to a higher tier for more features and capacity.</p>
            <div className="space-y-3">
              {PLANS.filter(p => p.name !== billingStatus.plan_name).map((plan) => (
                <div key={plan.key} className="flex items-center justify-between bg-muted/30 rounded-lg px-4 py-3">
                  <div>
                    <span className="text-sm font-medium">{plan.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">${plan.price}/mo AUD</span>
                  </div>
                  <Button variant="outline" size="sm" className="text-xs" onClick={() => handleSubscribe(plan.key)} disabled={subscribing !== null}>
                    {subscribing === plan.key ? <Loader2 className="w-3 h-3 animate-spin" /> : "Switch"}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {billingStatus?.status === "not_connected" && (
            <div className="bg-muted/30 border border-border rounded-xl p-4 flex items-start gap-3 mb-2">
              <Shield className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">Connect Shopify first</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Link your Shopify store in the Account tab to enable billing and subscriptions.
                </p>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">Choose a plan to get started. All plans include a <strong>14-day free trial</strong>.</p>

          {PLANS.map((plan) => (
            <div
              key={plan.key}
              className={`rounded-xl p-5 space-y-3 ${
                plan.highlight
                  ? "bg-primary/10 border-2 border-primary"
                  : "bg-card border border-border"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{plan.name}</span>
                  {plan.highlight && (
                    <span className="text-[10px] bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-medium">
                      Most popular
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-xl font-bold text-foreground">${plan.price}</span>
                  <span className="text-xs text-muted-foreground">/mo AUD</span>
                </div>
              </div>

              <ul className="space-y-1.5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>

              <Button
                variant={plan.highlight ? "teal" : "outline"}
                size="sm"
                className="w-full"
                onClick={() => handleSubscribe(plan.key)}
                disabled={subscribing !== null || billingStatus?.status === "not_connected"}
              >
                {subscribing === plan.key ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Zap className="w-3 h-3 mr-1" />}
                Start 14-day free trial
              </Button>
            </div>
          ))}

          <p className="text-[10px] text-muted-foreground text-center mt-2">
            You'll be redirected to Shopify to approve. No charge until trial ends.
          </p>
        </div>
      )}
    </div>
  );
};

export default BillingScreen;
