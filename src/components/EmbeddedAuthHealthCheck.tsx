import { useShopifyEmbedded } from "./ShopifyEmbeddedProvider";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";

/**
 * Lightweight diagnostic chip merchants & reviewers can see when running
 * embedded inside Shopify Admin. Confirms App Bridge + session token + Supabase
 * exchange all succeeded. Hidden in standalone mode.
 */
const EmbeddedAuthHealthCheck = () => {
  const { isEmbedded, authState, shop, authError } = useShopifyEmbedded();
  if (!isEmbedded) return null;

  // Sit above the mobile bottom tab bar (h-16 + safe-area) on small screens;
  // restore default bottom-3 on lg+ where the sidebar replaces the tab bar.
  const base =
    "fixed right-3 z-40 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur max-w-[20rem] bottom-[calc(4rem+env(safe-area-inset-bottom,0px)+0.75rem)] lg:bottom-3";

  if (authState === "loading") {
    return (
      <div className={`${base} bg-muted text-muted-foreground`}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Authenticating with Shopify…
      </div>
    );
  }

  if (authState === "authenticated") {
    return (
      <div className={`${base} bg-primary/10 text-primary hidden lg:inline-flex`}>
        <CheckCircle2 className="h-3.5 w-3.5" />
        Embedded session active{shop ? ` • ${shop}` : ""}
      </div>
    );
  }

  if (authState === "needs_install") {
    return (
      <div className={`${base} bg-destructive/10 text-destructive`} title={authError || ""}>
        <AlertTriangle className="h-3.5 w-3.5" />
        Reinstall required for {shop || "this shop"}
      </div>
    );
  }

  // Generic unauthenticated — App Bridge timed out, network error, etc.
  return (
    <div className={`${base} bg-destructive/10 text-destructive`} title={authError || ""}>
      <AlertTriangle className="h-3.5 w-3.5" />
      Embedded auth failed — try reloading
    </div>
  );
};

export default EmbeddedAuthHealthCheck;
