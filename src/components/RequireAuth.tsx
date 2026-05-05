import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useShopifyEmbedded } from "@/lib/shopify-embedded";

/**
 * Route guard. Redirects to /login when there is no Supabase session.
 * In Shopify-embedded mode, defers to the embedded auth state (the provider
 * handles its own session bootstrap, so we treat "authenticated" as signed in).
 */
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [status, setStatus] = useState<"loading" | "in" | "out">("loading");

  let embeddedAuthState: string | undefined;
  try {
    embeddedAuthState = useShopifyEmbedded()?.authState;
  } catch {
    embeddedAuthState = undefined;
  }

  useEffect(() => {
    let active = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!active) return;
      setStatus(session ? "in" : "out");
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      setStatus(session ? "in" : "out");
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  // Embedded Shopify: trust the provider.
  if (embeddedAuthState === "authenticated") return <>{children}</>;
  if (embeddedAuthState === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Initialising session…
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Initialising session…
      </div>
    );
  }
  if (status === "out") {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?redirect=${next}`} replace />;
  }
  return <>{children}</>;
}
