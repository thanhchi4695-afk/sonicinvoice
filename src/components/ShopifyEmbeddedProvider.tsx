import { ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";
import { isShopifyEmbedded, getShopFromUrl, getHostFromUrl, getApiKey } from "@/lib/shopify-embedded";
import { getSessionToken } from "@/lib/shopify-session-token";
import { supabase } from "@/integrations/supabase/client";
import { addAuditEntry } from "@/lib/audit-log";

export type EmbeddedAuthState = "loading" | "authenticated" | "needs_install" | "unauthenticated";

interface EmbeddedContextValue {
  isEmbedded: boolean;
  shop: string | null;
  host: string | null;
  apiKey: string;
  /** Whether embedded session auth is complete (legacy compat) */
  sessionReady: boolean;
  /** Granular auth state for the embedded flow */
  authState: EmbeddedAuthState;
  /** Last error message (if any) for diagnostics */
  authError: string | null;
}

const EmbeddedContext = createContext<EmbeddedContextValue>({
  isEmbedded: false,
  shop: null,
  host: null,
  apiKey: "",
  sessionReady: false,
  authState: "loading",
  authError: null,
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
  const [authError, setAuthError] = useState<string | null>(null);

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
        // Step 1: Get session token from App Bridge (waits for AB to load)
        const token = await getSessionToken();
        if (cancelled) return;
        if (!token) {
          setAuthError("App Bridge did not initialise — try reloading the app from Shopify Admin.");
          setAuthState("unauthenticated");
          return;
        }

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        if (!supabaseUrl) {
          console.warn("[embedded-auth] Missing backend URL");
          setAuthError("Backend URL missing.");
          setAuthState("unauthenticated");
          return;
        }

        // Step 2: Exchange session token for backend session (12s safety timeout)
        const verifyController = new AbortController();
        const verifyTimer = window.setTimeout(() => verifyController.abort(), 12000);
        let response: Response;
        try {
          response = await fetch(`${supabaseUrl}/functions/v1/shopify-session-verify`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ session_token: token }),
            signal: verifyController.signal,
          });
        } finally {
          window.clearTimeout(verifyTimer);
        }
        const data = await response.json().catch(() => null);

        if (cancelled) return;

        if (response.status === 404 && data?.needs_install) {
          console.warn("[embedded-auth] Shop not installed:", data?.error);
          if (data?.install_url) {
            try {
              window.top?.location.assign(data.install_url);
            } catch {
              window.location.assign(data.install_url);
            }
            return;
          }
          setAuthError(data?.error || "App not installed for this shop");
          setAuthState("needs_install");
          return;
        }

        if (!response.ok || !data?.access_token || !data?.refresh_token) {
          console.warn("[embedded-auth] Session verify failed:", data?.error || response.statusText);
          setAuthError(data?.error || `Verify failed (${response.status})`);
          setAuthState("unauthenticated");
          return;
        }

        // Step 3: Persist session WITHOUT calling supabase.auth.setSession().
        // setSession() acquires a navigator.locks lock with `steal: true`, which
        // throws "Lock broken by another request with the 'steal' option" when
        // Shopify Admin loads the embedded app in multiple iframes (e.g. nav
        // prefetch + visible iframe). We write the auth payload directly into
        // the storage key supabase-js reads on init, then nudge it with
        // getSession() (which is lock-free for reads).
        console.log("[embedded-auth] Verify OK, persisting session to storage…");
        try {
          const projectRef = (import.meta.env.VITE_SUPABASE_PROJECT_ID as string) || "";
          const storageKey = `sb-${projectRef}-auth-token`;
          const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
          const expiresAt = typeof data.expires_at === "number"
            ? data.expires_at
            : Math.floor(Date.now() / 1000) + expiresIn;
          const payload = {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_in: expiresIn,
            expires_at: expiresAt,
            token_type: "bearer",
            user: data.user ?? null,
          };
          localStorage.setItem(storageKey, JSON.stringify(payload));
        } catch (storageErr) {
          // Partitioned storage in iframe — that's OK, queries below still
          // include the Authorization header from supabase-js memory state.
          console.warn("[embedded-auth] localStorage write failed (partitioned?):", storageErr);
        }

        // Refresh in-memory auth state without acquiring the steal-lock.
        try {
          await Promise.race([
            supabase.auth.getSession(),
            new Promise((resolve) => setTimeout(resolve, 2000)),
          ]);
        } catch { /* ignore */ }

        if (cancelled) return;

        console.log("[embedded-auth] Session persisted — authenticated");
        setAuthError(null);
        setAuthState("authenticated");
        localStorage.setItem("onboarding_complete", "true");
        addAuditEntry("Login", `Embedded session auth for ${data.shop || base.shop}`);
      } catch (err) {
        console.error("[embedded-auth] Error:", err);
        if (!cancelled) {
          setAuthError(err instanceof Error ? err.message : String(err));
          setAuthState("unauthenticated");
        }
      }
    };

    authenticate();
    return () => { cancelled = true; };
  }, [base.isEmbedded, base.shop]);

  const value = useMemo<EmbeddedContextValue>(() => ({
    ...base,
    sessionReady: authState === "authenticated",
    authState,
    authError,
  }), [base, authState, authError]);

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
