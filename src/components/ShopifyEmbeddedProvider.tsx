import { ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";
import { isShopifyEmbedded, getShopFromUrl, getHostFromUrl, getApiKey } from "@/lib/shopify-embedded";
import { getSessionToken } from "@/lib/shopify-session-token";
import { supabase } from "@/integrations/supabase/client";
import { addAuditEntry } from "@/lib/audit-log";

export type EmbeddedAuthState = "loading" | "authenticated" | "unauthenticated";

interface EmbeddedContextValue {
  isEmbedded: boolean;
  shop: string | null;
  host: string | null;
  apiKey: string;
  /** Whether embedded session auth is complete (legacy compat) */
  sessionReady: boolean;
  /** Granular auth state for the embedded flow */
  authState: EmbeddedAuthState;
}

const EmbeddedContext = createContext<EmbeddedContextValue>({
  isEmbedded: false,
  shop: null,
  host: null,
  apiKey: "",
  sessionReady: false,
  authState: "loading",
});

export const useShopifyEmbedded = () => useContext(EmbeddedContext);

interface Props {
  children: ReactNode;
}

/**
 * Single source of truth for Shopify embedded authentication.
 * When running inside Shopify Admin:
 *  1. Gets a session token from App Bridge (once)
 *  2. Sends it to shopify-session-verify to get Supabase credentials (once)
 *  3. Sets the Supabase session so all downstream queries are authenticated
 *
 * Consumers use `useShopifyEmbedded()` to read authState — no component
 * should duplicate this flow.
 */
const ShopifyEmbeddedProvider = ({ children }: Props) => {
  const [authState, setAuthState] = useState<EmbeddedAuthState>("loading");

  const base = useMemo(() => ({
    isEmbedded: isShopifyEmbedded(),
    shop: getShopFromUrl(),
    host: getHostFromUrl(),
    apiKey: getApiKey(),
  }), []);

  // ═══ Embedded session token authentication flow (runs ONCE) ═══
  useEffect(() => {
    if (!base.isEmbedded) {
      // Standalone mode — provider is not responsible for auth
      setAuthState("unauthenticated");
      return;
    }

    let cancelled = false;

    const authenticate = async () => {
      try {
        // Step 1: Get session token from App Bridge
        const token = await getSessionToken();
        if (!token || cancelled) {
          if (!cancelled) setAuthState("unauthenticated");
          return;
        }

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        if (!supabaseUrl) {
          console.warn("[embedded-auth] Missing backend URL");
          setAuthState("unauthenticated");
          return;
        }

        // Step 2: Exchange session token for backend session
        const response = await fetch(`${supabaseUrl}/functions/v1/shopify-session-verify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ session_token: token }),
        });
        const data = await response.json().catch(() => null);

        if (cancelled) return;

        if (!response.ok || !data?.access_token || !data?.refresh_token) {
          console.warn("[embedded-auth] Session verify failed:", data?.error || response.statusText);
          setAuthState("unauthenticated");
          return;
        }

        // Step 3: Set Supabase session (single call — no other component should do this)
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
        });

        if (sessionError) {
          console.warn("[embedded-auth] Failed to set session:", sessionError);
          setAuthState("unauthenticated");
          return;
        }

        if (!cancelled) {
          setAuthState("authenticated");
          localStorage.setItem("onboarding_complete", "true");
          addAuditEntry("Login", `Embedded session auth for ${data.shop || base.shop}`);
        }
      } catch (err) {
        console.error("[embedded-auth] Error:", err);
        if (!cancelled) setAuthState("unauthenticated");
      }
    };

    authenticate();
    return () => { cancelled = true; };
  }, [base.isEmbedded, base.shop]);

  const value = useMemo<EmbeddedContextValue>(() => ({
    ...base,
    sessionReady: authState === "authenticated",
    authState,
  }), [base, authState]);

  if (value.isEmbedded && value.apiKey && value.host) {
    return (
      <EmbeddedContext.Provider value={value}>
        <div className="shopify-embedded-app">
          {children}
        </div>
      </EmbeddedContext.Provider>
    );
  }

  return (
    <EmbeddedContext.Provider value={value}>
      {children}
    </EmbeddedContext.Provider>
  );
};

export default ShopifyEmbeddedProvider;
