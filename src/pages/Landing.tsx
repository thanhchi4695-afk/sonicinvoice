import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { isShopifyEmbedded } from "@/lib/shopify-embedded";

/**
 * Public marketing landing page.
 * - Unauthenticated visitors see brand copy + CTA to /login.
 * - Authenticated visitors are sent straight to /dashboard.
 * - Embedded (Shopify Admin) visitors bypass this entirely and go to /dashboard.
 */
const Landing = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (isShopifyEmbedded()) {
      navigate(
        {
          pathname: "/dashboard",
          search: location.search,
        },
        { replace: true }
      );
      return;
    }
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) {
        navigate("/dashboard", { replace: true });
      } else {
        // Make absolutely sure stale localStorage doesn't fake an authed state later
        localStorage.removeItem("onboarding_complete");
        setChecking(false);
      }
    });
    return () => { cancelled = true; };
  }, [location.search, navigate]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between max-w-6xl mx-auto px-6 py-5">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold font-display">Sonic Invoice</span>
          <span className="text-[10px] text-muted-foreground border border-border rounded-full px-2 py-0.5">sonicinvoices.com</span>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/login">
            <Button variant="ghost" size="sm">Sign in</Button>
          </Link>
          <Link to="/login?signup=1">
            <Button variant="teal" size="sm">Get started</Button>
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 pt-12 pb-20 text-center">
        <span className="inline-block text-xs uppercase tracking-widest text-primary border border-primary/30 rounded-full px-3 py-1 mb-5">
          Stock Intake Automation
        </span>
        <h1 className="text-4xl sm:text-5xl font-bold font-display mb-4 leading-tight">
          The stock intake layer your Shopify store is missing
        </h1>
        <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
          Sonic Invoices turns supplier invoices into Shopify-ready products in minutes — not hours.
          The first Stock Intake Automation tool built for Australian independent retail.
        </p>
        <div className="flex items-center justify-center gap-3 mb-16">
          <Link to="/login?signup=1">
            <Button variant="teal" size="lg">See how it works</Button>
          </Link>
          <Link to="/case-study">
            <Button variant="outline" size="lg">Read the case study</Button>
          </Link>
        </div>

        <section className="mb-20 text-left">
          <h2 className="text-2xl font-bold font-display text-center mb-8">
            The gap no tool was filling
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <GapCol
              title="Selling tools"
              items={["Shopify", "Klaviyo", "Google Ads"]}
              tone="muted"
            />
            <GapCol
              title="Marketing tools"
              items={["Meta Ads", "SEO", "Email"]}
              tone="muted"
            />
            <GapCol
              title="Stock intake — the missing piece"
              items={["Supplier invoices", "Manual data entry", "Hours of re-keying"]}
              tone="primary"
            />
          </div>
        </section>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-left mb-20">
          <Feature title="Invoice → Shopify" body="Upload PDF, Excel or CSV. We extract every product, map to Shopify fields, and produce a ready-to-import file." />
          <Feature title="Stocky replacement" body="Purchase orders, demand forecasting, dead stock detection, stocktakes, and AI reorder intelligence." />
          <Feature title="Google Shopping & SEO" body="Fix Merchant Center disapprovals in bulk and ship AI-optimised collection SEO pages." />
        </div>

        <section className="text-left rounded-xl border border-border bg-card p-6">
          <h2 className="text-xl font-bold font-display mb-2">What is Stock Intake Automation?</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Stock intake is everything between a supplier sending you product and that product
            being live for sale: parsing invoices, matching SKUs, setting wholesale and retail
            prices, grouping variants, writing titles, generating barcodes, and pushing to
            Shopify. Sonic Invoices automates the entire chain with an AI flywheel that learns
            your suppliers brand by brand. Explore our open <Link to="/brand-guide" className="text-primary underline">AU brand directory</Link>.
          </p>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} Sonic Invoice · Stock Intake Automation for boutique retail</span>
          <div className="flex items-center gap-4">
            <Link to="/brand-guide" className="hover:text-foreground">Brand Guide</Link>
            <Link to="/case-study" className="hover:text-foreground">Case Study</Link>
            <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link to="/support" className="hover:text-foreground">Support</Link>
            <Link to="/login" className="hover:text-foreground">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

const Feature = ({ title, body }: { title: string; body: string }) => (
  <div className="rounded-xl border border-border bg-card p-5">
    <h3 className="font-semibold mb-2">{title}</h3>
    <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
  </div>
);

const GapCol = ({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "muted" | "primary";
}) => (
  <div
    className={
      "rounded-xl p-5 " +
      (tone === "primary"
        ? "border-2 border-primary bg-primary/5"
        : "border border-border bg-card")
    }
  >
    <h3 className={"font-semibold mb-3 " + (tone === "primary" ? "text-primary" : "")}>
      {title}
    </h3>
    <ul className="space-y-1.5 text-sm text-muted-foreground">
      {items.map((i) => (
        <li key={i}>• {i}</li>
      ))}
    </ul>
  </div>
);

export default Landing;
