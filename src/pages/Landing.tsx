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

      <main className="max-w-4xl mx-auto px-6 pt-12 pb-24 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold font-display mb-4 leading-tight">
          Supplier invoices to Shopify in minutes
        </h1>
        <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
          AI-powered invoice extraction, inventory sync, and Shopify product creation — built for boutique fashion retailers.
        </p>
        <div className="flex items-center justify-center gap-3 mb-16">
          <Link to="/login?signup=1">
            <Button variant="teal" size="lg">Start free trial</Button>
          </Link>
          <Link to="/login">
            <Button variant="outline" size="lg">Sign in</Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-left">
          <Feature title="Invoice → Shopify" body="Upload PDF, Excel or CSV. We extract every product, map to Shopify fields, and produce a ready-to-import file." />
          <Feature title="Stocky replacement" body="Purchase orders, demand forecasting, dead stock detection, stocktakes, and AI reorder intelligence." />
          <Feature title="Google Shopping & SEO" body="Fix Merchant Center disapprovals in bulk and ship AI-optimised collection SEO pages." />
        </div>
      </main>

      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} Sonic Invoice · sonicinvoices.com</span>
          <div className="flex items-center gap-4">
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

export default Landing;
