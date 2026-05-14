import { lazy, Suspense, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import RouteSeo from "@/components/RouteSeo";

const AuthScreen = lazy(() => import("@/components/AuthScreen"));

/**
 * Canonical /login route.
 * Existing authed users skip straight to /dashboard.
 * On successful auth, navigate to /dashboard (the in-app shell).
 */
const Login = () => {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate("/dashboard", { replace: true });
    });
  }, [navigate]);

  return (
    <>
      <RouteSeo
        title="Sign in or create an account · Sonic Invoices"
        description="Sign in to Sonic Invoices to manage Shopify products, bulk discounts, Google Shopping feeds, and supplier invoice imports."
        path="/login"
        noindex
      />
      <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      }
    >
      <AuthScreen onAuth={() => navigate("/dashboard", { replace: true })} />
    </Suspense>
  );
};

export default Login;
