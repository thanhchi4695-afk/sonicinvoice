import { ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";
import { isShopifyEmbedded, getShopFromUrl, getHostFromUrl, getApiKey } from "@/lib/shopify-embedded";
import { getSessionToken } from "@/lib/shopify-session-token";
import { supabase } from "@/integrations/supabase/client";

interface EmbeddedContextValue {
  isEmbedded: boolean;
  shop: string | null;
  host: string | null;
  apiKey: string;
  /** Whether embedded session auth is complete */
  sessionReady: boolean;
}

const EmbeddedContext = createContext<EmbeddedContextValue>({
  isEmbedded: false,
  shop: null,
  host: null,
  apiKey: "",
  sessionReady: false,
});

export const useShopifyEmbedded = () => useContext(EmbeddedContext);

interface Props {
  children: ReactNode;
}

/**
 * Wraps the app and provides embedded-mode context.
 * When running inside Shopify Admin:
 *  1. Gets a session token from App Bridge
 *  2. Sends it to shopify-session-verify to get Supabase credentials
 *  3. Sets the Supabase session so all downstream queries are authenticated
 */
const ShopifyEmbeddedProvider = ({ children }: Props) => {
  const [sessionReady, setSessionReady] = useState(false);

  const base = useMemo(() => ({
    isEmbedded: isShopifyEmbedded(),
    shop: getShopFromUrl(),
    host: getHostFromUrl(),
    apiKey: getApiKey(),
  }), []);

  // ═══ Embedded session token authentication flow ═══
  useEffect(() => {
    if (!base.isEmbedded) {
      setSessionReady(true); // standalone — no token needed
      return;
    }

    let cancelled = false;

    const authenticate = async () => {
      try {
        // Step 1: Get session token from App Bridge
        const token = await getSessionToken();
        if (!token || cancelled) return;

        // Step 2: Exchange session token for Supabase session
        const { data, error } = await supabase.functions.invoke("shopify-session-verify", {
          body: { session_token: token },
        });

        if (error || !data?.access_token) {
          console.warn("[embedded-auth] Session verify failed:", error || data?.error);
          return;
        }

        // Step 3: Set Supabase session
        await supabase.auth.setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
        });

        if (!cancelled) setSessionReady(true);
      } catch (err) {
        console.error("[embedded-auth] Error:", err);
      }
    };

    authenticate();
    return () => { cancelled = true; };
  }, [base.isEmbedded]);

  const value = useMemo<EmbeddedContextValue>(() => ({
    ...base,
    sessionReady,
  }), [base, sessionReady]);

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
