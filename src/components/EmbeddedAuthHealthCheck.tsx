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

  const base =
    "fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur max-w-[20rem]";

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
      <div className={`${base} bg-primary/10 text-primary`}>
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
