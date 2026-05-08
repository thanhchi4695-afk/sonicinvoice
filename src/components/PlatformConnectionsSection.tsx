import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import {
  Loader2,
  RefreshCw,
  Unplug,
  ExternalLink,
  Store,
  Zap,
  AlertTriangle,
  CheckCircle2,
  KeyRound,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  deleteConnection,
  initiateOAuth,
} from "@/lib/shopify-api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const AUTO_SYNC_KEY = "platform_auto_sync_enabled";
const AUTO_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const STALE_WARN_MS = 24 * 60 * 60 * 1000; // 24h
const LOAD_TIMEOUT_MS = 8000;
const SHOPIFY_OAUTH_TIMEOUT_MS = 12000;
const CUSTOM_APP_VERIFY_TIMEOUT_MS = 60000;
const CUSTOM_APP_AUTH_LOOKUP_TIMEOUT_MS = 2500;

function withTimeout<T>(promise: PromiseLike<T>, fallback: T, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve(promise).catch((error) => {
      console.warn(`[PlatformConnections] ${label} failed:`, error);
      return fallback;
    }),
    new Promise<T>((resolve) => {
      timer = setTimeout(() => {
        console.warn(`[PlatformConnections] ${label} timed out`);
        resolve(fallback);
      }, LOAD_TIMEOUT_MS);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function withRejectingTimeout<T>(promise: PromiseLike<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

interface CustomAppVerifyPayload {
  shop_domain: string;
  access_token?: string;
  client_id?: string;
  client_secret?: string;
}

interface CustomAppVerifyResponse {
  success?: boolean;
  error?: string;
  shop_name?: string;
  shop_domain?: string;
}

function getStoredAccessToken(): string | null {
  try {
    const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined;
    if (!projectRef) return null;
    const raw = localStorage.getItem(`sb-${projectRef}-auth-token`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { access_token?: string } | null;
    return parsed?.access_token || null;
  } catch {
    return null;
  }
}

async function getCurrentAccessToken(): Promise<string | null> {
  const sessionToken = await withRejectingTimeout(
    supabase.auth.getSession().then(({ data }) => data.session?.access_token || null),
    CUSTOM_APP_AUTH_LOOKUP_TIMEOUT_MS,
    "Auth lookup timed out",
  ).catch(() => null);

  return sessionToken || getStoredAccessToken();
}

async function verifyCustomAppCredentials(payload: CustomAppVerifyPayload): Promise<CustomAppVerifyResponse> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!supabaseUrl || !publishableKey) {
    throw new Error("Backend configuration missing. Refresh the app and try again.");
  }

  const accessToken = await getCurrentAccessToken();
  if (!accessToken) {
    throw new Error("Please sign in again before verifying Shopify credentials.");
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), CUSTOM_APP_VERIFY_TIMEOUT_MS);

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/shopify-custom-app-verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: publishableKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await response.text();
    let body: CustomAppVerifyResponse = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      if (!response.ok) throw new Error(text || "Verification failed");
    }

    if (!response.ok) {
      throw new Error(body.error || `Verification failed (${response.status})`);
    }

    return body;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Shopify did not respond within 60 seconds. Try the Admin API access token option if Client ID + Secret keeps timing out.");
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}

interface CatalogStats {
  shopifyCount: number;
  lightspeedCount: number;
  total: number;
  lastSyncedAt: string | null;
}

interface LightspeedConn {
  ls_x_domain_prefix: string | null;
  ls_r_account_id: string | null;
  last_synced: string | null;
}

interface SyncJob {
  id: string;
  status: "running" | "done" | "failed";
  products_synced: number;
  total_products: number | null;
  error_message: string | null;
  completed_at: string | null;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

function normalizeShopifyDomain(input: string): string {
  const domain = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!domain) return "";
  return domain.includes(".myshopify.com") ? domain : `${domain}.myshopify.com`;
}

export default function PlatformConnectionsSection() {
  const [loading, setLoading] = useState(true);

  // Shopify
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [shopifyDomain, setShopifyDomain] = useState("");
  const [shopifyLastSynced, setShopifyLastSynced] = useState<string | null>(null);
  const [shopifyCount, setShopifyCount] = useState(0);
  const [shopifyInput, setShopifyInput] = useState("");
  const [shopifyOAuthLoading, setShopifyOAuthLoading] = useState(false);
  const [shopifySyncing, setShopifySyncing] = useState(false);
  const [shopifySyncProgress, setShopifySyncProgress] = useState<string | null>(null);
  const [connectedPlatformCount, setConnectedPlatformCount] = useState(0);
  const [showCustomApp, setShowCustomApp] = useState(false);
  const [customAppDomain, setCustomAppDomain] = useState("");
  const [customAppToken, setCustomAppToken] = useState("");
  const [customAppMode, setCustomAppMode] = useState<"token" | "client">("token");
  const [customAppClientId, setCustomAppClientId] = useState("");
  const [customAppClientSecret, setCustomAppClientSecret] = useState("");
  const [customAppSaving, setCustomAppSaving] = useState(false);

  // Lightspeed
  const [lsConn, setLsConn] = useState<LightspeedConn | null>(null);
  const [lsCount, setLsCount] = useState(0);
  const [lsConnecting, setLsConnecting] = useState<"x" | "r" | null>(null);
  const [lsSyncing, setLsSyncing] = useState(false);
  const [showLsOptions, setShowLsOptions] = useState(false);
  const [lsRForm, setLsRForm] = useState({ server_url: "", account_id: "", api_key: "" });
  const [showLsRForm, setShowLsRForm] = useState(false);

  // Auto-sync
  const [autoSync, setAutoSync] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AUTO_SYNC_KEY) === "1";
    } catch {
      return false;
    }
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stats: CatalogStats = useMemo(() => {
    const lastShop = shopifyLastSynced ? new Date(shopifyLastSynced).getTime() : 0;
    const lastLs = lsConn?.last_synced ? new Date(lsConn.last_synced).getTime() : 0;
    const newest = Math.max(lastShop, lastLs);
    return {
      shopifyCount,
      lightspeedCount: lsCount,
      total: shopifyCount + lsCount,
      lastSyncedAt: newest > 0 ? new Date(newest).toISOString() : null,
    };
  }, [shopifyCount, lsCount, shopifyLastSynced, lsConn?.last_synced]);

  const cacheStale = useMemo(() => {
    if (!stats.lastSyncedAt) return stats.total > 0; // have items but unknown age
    return Date.now() - new Date(stats.lastSyncedAt).getTime() > STALE_WARN_MS;
  }, [stats.lastSyncedAt, stats.total]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      // Only reload on actual sign-in/out — token refreshes don't change the data we read
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        void loadAll();
      }
    });

    void loadAll();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "sonic:shopify-connected") return;
      setShopifyOAuthLoading(false);
      toast.success("Shopify connected");
      void loadAll();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Auto-sync interval
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (!autoSync) return;
    intervalRef.current = setInterval(() => {
      void runAutoSync();
    }, AUTO_SYNC_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSync, shopifyConnected, lsConn]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const authRes = await withTimeout(
        supabase.auth.getUser(),
        { data: { user: null }, error: null } as Awaited<ReturnType<typeof supabase.auth.getUser>>,
        "auth lookup",
      );
      const user = authRes.data.user;
      if (!user) {
        setShopifyConnected(false);
        setShopifyDomain("");
        setShopifyLastSynced(null);
        setLsConn(null);
        setShopifyCount(0);
        setLsCount(0);
        setConnectedPlatformCount(0);
        return;
      }

      const [ls, counts, shopifyMetaRes, platformsRes] = await withTimeout(
        Promise.all([
          loadLightspeedConn(user.id).catch(() => null),
          loadCatalogCounts(user.id).catch(() => ({ shopify: 0, lightspeed: 0 })),
          (async () => {
            try {
              return await supabase
                .from("platform_connections")
                .select("shop_domain, last_synced_at")
                .eq("user_id", user.id)
                .eq("platform", "shopify")
                .eq("is_active", true)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
            } catch {
              return { data: null, error: null } as any;
            }
          })(),
          (async () => {
            try {
              return await supabase
                .from("platform_connections")
                .select("id", { count: "exact", head: true })
                .eq("user_id", user.id)
                .eq("is_active", true);
            } catch {
              return { count: 0, error: null } as any;
            }
          })(),
        ]),
        [
          null,
          { shopify: 0, lightspeed: 0 },
          { data: null, error: null },
          { count: 0, error: null },
        ] as const,
        "connection queries",
      ) as [
        LightspeedConn | null,
        { shopify: number; lightspeed: number },
        { data: { shop_domain: string | null; last_synced_at: string | null } | null },
        { count: number | null }
      ];

      const shopifySyncMeta = shopifyMetaRes.data;
      const platformCount = platformsRes.count ?? 0;

      if (shopifySyncMeta?.shop_domain) {
        setShopifyConnected(true);
        setShopifyDomain(shopifySyncMeta.shop_domain);
        setShopifyLastSynced(shopifySyncMeta?.last_synced_at ?? null);
      } else {
        // Fallback to shopify_connections (source of truth)
        try {
          const { data: legacyConn } = await supabase
            .from("shopify_connections")
            .select("store_url, updated_at, shop_name")
            .eq("user_id", user.id)
            .maybeSingle();

          if (legacyConn?.store_url) {
            setShopifyConnected(true);
            setShopifyDomain(legacyConn.store_url);
            setShopifyLastSynced(legacyConn.updated_at ?? null);

            // Repair platform_connections row so this fallback isn't needed next time
            supabase
              .from("platform_connections")
              .upsert({
                user_id: user.id,
                platform: "shopify",
                shop_domain: legacyConn.store_url,
                is_active: true,
                needs_reauth: false,
              }, { onConflict: "user_id,platform" })
              .then(({ error }) => {
                if (!error) console.log("[PlatformConnections] repaired missing platform_connections row");
              });
          } else {
            setShopifyConnected(false);
            setShopifyDomain("");
            setShopifyLastSynced(null);
          }
        } catch {
          setShopifyConnected(false);
          setShopifyDomain("");
          setShopifyLastSynced(null);
        }
      }
      setConnectedPlatformCount(platformCount);
      setLsConn(ls);
      setShopifyCount(counts.shopify);
      setLsCount(counts.lightspeed);
    } finally {
      setLoading(false);
    }
  };

  const loadLightspeedConn = async (userId: string): Promise<LightspeedConn | null> => {
    const { data } = await supabase
      .from("pos_connections")
      .select("ls_x_domain_prefix, ls_r_account_id, last_synced")
      .eq("user_id", userId)
      .in("platform", ["lightspeed_x", "lightspeed_r"])
      .maybeSingle();
    if (!data) return null;
    if (!data.ls_x_domain_prefix && !data.ls_r_account_id) return null;
    return data as LightspeedConn;
  };

  const loadCatalogCounts = async (userId: string): Promise<{ shopify: number; lightspeed: number }> => {
    try {
      const [s, l] = await Promise.all([
        supabase
          .from("product_catalog_cache")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("platform", "shopify"),
        supabase
          .from("product_catalog_cache")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("platform", "lightspeed"),
      ]);
      return { shopify: s.count ?? 0, lightspeed: l.count ?? 0 };
    } catch {
      return { shopify: 0, lightspeed: 0 };
    }
  };

  const pollShopifySyncJob = async (jobId: string) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 15 * 60 * 1000) {
      const { data: job, error } = await (supabase as any)
        .from("sync_jobs")
        .select("id,status,products_synced,total_products,error_message,completed_at")
        .eq("id", jobId)
        .maybeSingle();
      if (error) throw error;

      const currentJob = job as SyncJob | null;
      if (currentJob) {
        const synced = currentJob.products_synced ?? 0;
        const total = currentJob.total_products ?? 0;
        setShopifySyncProgress(
          total > 0
            ? `${synced.toLocaleString()} / ${total.toLocaleString()} products`
            : `${synced.toLocaleString()} products`,
        );

        if (currentJob.status === "done") {
          const { data: { user: u } } = await supabase.auth.getUser();
          const counts = u ? await loadCatalogCounts(u.id) : { shopify: 0, lightspeed: 0 };
          setShopifyCount(counts.shopify);
          setShopifyLastSynced(currentJob.completed_at ?? new Date().toISOString());
          toast.success(
            `Catalog synced — ${(currentJob.total_products ?? currentJob.products_synced ?? counts.shopify).toLocaleString()} products ready`,
            { description: "Stock check is ready for fast invoice matching." },
          );
          return;
        }

        if (currentJob.status === "failed") {
          throw new Error(currentJob.error_message || "Catalog sync failed");
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    throw new Error("Catalog sync is still running. Check again in a few minutes.");
  };

  // ── Shopify actions ───────────────────────────────────────
  const openCustomAppConnect = () => {
    const domain = normalizeShopifyDomain(shopifyInput);
    if (!domain) {
      toast.error("Enter your Shopify store domain first");
      return;
    }
    setCustomAppDomain(domain);
    setShowCustomApp(true);
  };

  const handleShopifyConnect = async () => {
    if (!shopifyInput.trim()) {
      toast.error("Enter your Shopify store domain first");
      return;
    }
    const url = normalizeShopifyDomain(shopifyInput);
    if (url === "splashswimweardarwin.myshopify.com") {
      openCustomAppConnect();
      toast.message("Use the Custom App token for this store", {
        description: "The OAuth install window is only for Shopify App Store installs.",
      });
      return;
    }
    const popup = window.open("", "shopify_oauth", "width=960,height=820");
    setShopifyOAuthLoading(true);
    try {
      const installUrl = await Promise.race([
        initiateOAuth(url),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), SHOPIFY_OAUTH_TIMEOUT_MS)),
      ]);

      if (!installUrl) {
        popup?.close();
        throw new Error("Shopify took too long to respond. Please try again.");
      }

      if (popup && !popup.closed) {
        popup.location.href = installUrl;
        toast.success("Shopify authorization opened in a new window");
        setShopifyOAuthLoading(false);
        return;
      }

      window.location.assign(installUrl);
      window.setTimeout(() => setShopifyOAuthLoading(false), 2500);
    } catch (err) {
      popup?.close();
      toast.error(err instanceof Error ? err.message : "OAuth failed");
      setShopifyOAuthLoading(false);
    }
  };

  const handleShopifyDisconnect = async () => {
    await deleteConnection();
    setShopifyConnected(false);
    setShopifyDomain("");
    setShopifyLastSynced(null);
    setShopifyCount(0);
    toast.success("Shopify disconnected");
  };

  const handleCustomAppSave = async () => {
    const domain = customAppDomain.trim();
    const token = customAppToken.trim();
    const clientId = customAppClientId.trim();
    const clientSecret = customAppClientSecret.trim();

    if (!domain) {
      toast.error("Enter your store domain");
      return;
    }
    if (customAppMode === "token" && !token) {
      toast.error("Enter the Admin API access token");
      return;
    }
    if (customAppMode === "client" && (!clientId || !clientSecret)) {
      toast.error("Enter both Client ID and Client Secret");
      return;
    }

    setCustomAppSaving(true);
    toast.loading("Verifying Shopify credentials…", { id: "shopify-custom-verify" });
    try {
      const payload: CustomAppVerifyPayload = { shop_domain: domain };
      if (customAppMode === "token") {
        payload.access_token = token;
      } else {
        payload.client_id = clientId;
        payload.client_secret = clientSecret;
      }
      const data = await verifyCustomAppCredentials(payload);
      if (!data?.success) {
        throw new Error(data?.error || "Verification failed");
      }
      toast.dismiss("shopify-custom-verify");
      toast.success(`Connected to ${data.shop_name}`);
      setCustomAppSaving(false);
      setCustomAppDomain("");
      setCustomAppToken("");
      setCustomAppClientId("");
      setCustomAppClientSecret("");
      setShowCustomApp(false);
      void loadAll();

      // Auto-populate catalog cache on first connect
      void (async () => {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return;
          const { data: syncData, error: syncError } = await supabase.functions.invoke("sync-shopify-catalog", {
            body: {
              user_id: user.id,
              shop_domain: domain,
              mode: "full",
            },
          });
          if (syncError) throw syncError;
          if (syncData?.job_id) await pollShopifySyncJob(syncData.job_id);
        } catch (e) {
          console.warn("Background catalog sync failed:", e);
        } finally {
          setShopifySyncProgress(null);
        }
      })();
    } catch (err) {
      toast.dismiss("shopify-custom-verify");
      toast.error(err instanceof Error ? err.message : "Failed to verify");
    } finally {
      setCustomAppSaving(false);
    }
  };

  const handleShopifySync = async () => {
    setShopifySyncing(true);
    setShopifySyncProgress(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { data, error } = await supabase.functions.invoke("sync-shopify-catalog", {
        body: { user_id: user.id },
      });
      if (error) throw error;
      if (!data?.job_id) throw new Error("Sync did not return a job id");
      toast.success("Catalog sync started", {
        description: "Products are being cached in the background.",
      });
      await pollShopifySyncJob(data.job_id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setShopifySyncing(false);
      setShopifySyncProgress(null);
    }
  };

  // ── Lightspeed actions ────────────────────────────────────
  const handleLightspeedXConnect = async () => {
    setLsConnecting("x");
    try {
      const { data, error } = await supabase.functions.invoke("pos-proxy", {
        body: { action: "get_auth_url", platform: "lightspeed_x" },
      });
      if (error) throw new Error(error.message);
      if (!data?.url) throw new Error("No auth URL returned");
      const popup = window.open(data.url, "lightspeed_x_oauth", "width=600,height=700");
      if (!popup) {
        toast.error("Please allow popups for OAuth");
        return;
      }
      const handler = (event: MessageEvent) => {
        if (event.data?.type === "POS_AUTH_SUCCESS" && event.data?.platform === "lightspeed_x") {
          window.removeEventListener("message", handler);
          void loadAll();
          toast.success("Connected to Lightspeed X-Series");
        }
        if (event.data?.type === "POS_AUTH_ERROR") {
          window.removeEventListener("message", handler);
          toast.error("Lightspeed connection failed");
        }
      };
      window.addEventListener("message", handler);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start connection");
    } finally {
      setLsConnecting(null);
    }
  };

  const handleLightspeedRSubmit = async () => {
    if (!lsRForm.server_url || !lsRForm.account_id || !lsRForm.api_key) {
      toast.error("Fill in all R-Series fields");
      return;
    }
    setLsConnecting("r");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase.from("pos_connections").upsert(
        {
          user_id: user.id,
          platform: "lightspeed_r",
          ls_r_account_id: lsRForm.account_id,
          ls_r_access_token: lsRForm.api_key,
        },
        { onConflict: "user_id,platform" },
      );
      if (error) throw error;
      toast.success("Lightspeed R-Series saved");
      setShowLsRForm(false);
      setShowLsOptions(false);
      setLsRForm({ server_url: "", account_id: "", api_key: "" });
      void loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setLsConnecting(null);
    }
  };

  const handleLightspeedDisconnect = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from("pos_connections")
      .delete()
      .eq("user_id", user.id)
      .in("platform", ["lightspeed_x", "lightspeed_r"]);
    setLsConn(null);
    setLsCount(0);
    toast.success("Lightspeed disconnected");
  };

  const handleLightspeedSync = async () => {
    setLsSyncing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase.functions.invoke("sync-lightspeed-catalog", {
        body: { user_id: user.id },
      });
      if (error) throw error;
      toast.success("Lightspeed catalog synced");
      const counts = await loadCatalogCounts(user.id);
      setLsCount(counts.lightspeed);
      setLsConn((c) => (c ? { ...c, last_synced: new Date().toISOString() } : c));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setLsSyncing(false);
    }
  };

  // ── Auto-sync ─────────────────────────────────────────────
  const runAutoSync = async () => {
    if (shopifyConnected) await handleShopifySync().catch(() => {});
    if (lsConn) await handleLightspeedSync().catch(() => {});
  };

  const handleAutoSyncToggle = (val: boolean) => {
    setAutoSync(val);
    try {
      localStorage.setItem(AUTO_SYNC_KEY, val ? "1" : "0");
    } catch {}
    if (val) toast.success("Auto-sync enabled (every 6 h)");
  };

  // ── Render ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading platform connections…
      </div>
    );
  }

  const lsAccount = lsConn?.ls_x_domain_prefix
    ? `${lsConn.ls_x_domain_prefix}.retail.lightspeed.app`
    : lsConn?.ls_r_account_id
    ? `R-Series · Account #${lsConn.ls_r_account_id}`
    : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* SHOPIFY CARD */}
        <Card className="p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/15 flex items-center justify-center text-lg">
                🛍
              </div>
              <div>
                <div className="font-semibold text-sm">Shopify</div>
                {shopifyConnected ? (
                  <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-[10px] mt-0.5">
                    Connected
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] mt-0.5">
                    Not connected
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {shopifyConnected ? (
            <>
              <div className="text-xs space-y-1 font-mono">
                <div className="text-muted-foreground truncate">{shopifyDomain}</div>
                <div className="text-muted-foreground">
                  {shopifyCount.toLocaleString()} products cached
                </div>
                <div className="text-muted-foreground">
                  {shopifySyncProgress ? `Syncing ${shopifySyncProgress}` : `Synced ${formatRelative(shopifyLastSynced)}`}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleShopifySync}
                  disabled={shopifySyncing}
                  className="flex-1"
                >
                  {shopifySyncing ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3 mr-1" />
                  )}
                  {shopifySyncing ? "Syncing…" : "Sync now"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleShopifyDisconnect}
                  className="text-destructive hover:text-destructive"
                >
                  <Unplug className="w-3 h-3 mr-1" /> Disconnect
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-1 items-center">
                <Input
                  placeholder="yourstore"
                  value={shopifyInput}
                  onChange={(e) => setShopifyInput(e.target.value)}
                  className="h-9 text-sm"
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  .myshopify.com
                </span>
              </div>
              <Button
                size="sm"
                className="w-full"
                onClick={handleShopifyConnect}
                disabled={shopifyOAuthLoading || !shopifyInput.trim()}
              >
                {shopifyOAuthLoading ? (
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                ) : (
                  <ExternalLink className="w-3 h-3 mr-1" />
                )}
                Connect Shopify
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full"
                onClick={openCustomAppConnect}
                disabled={shopifyOAuthLoading || !shopifyInput.trim()}
              >
                <KeyRound className="w-3 h-3 mr-1" />
                Connect Custom App Token
              </Button>
              <p className="text-[10px] text-muted-foreground leading-snug">
                Use this if Sonic Invoice is installed from the Shopify App Store.
                If your store uses a <strong>Custom App</strong> (created in Settings →
                Apps → Develop apps), use the token option below instead — OAuth
                will return a 404 from Shopify for custom apps.
              </p>

              <div className="pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowCustomApp((v) => !v)}
                  className="text-[11px] text-muted-foreground hover:text-foreground hover:underline w-full text-left flex items-center gap-1"
                >
                  <KeyRound className="w-3 h-3" />
                  {showCustomApp ? "Hide token form" : "Show token form"}
                </button>
                {showCustomApp && (
                  <div className="space-y-2 mt-2">
                    <div className="flex gap-1 p-0.5 bg-muted rounded-md">
                      <button
                        type="button"
                        onClick={() => setCustomAppMode("token")}
                        className={`flex-1 text-[11px] py-1 rounded ${customAppMode === "token" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}
                      >
                        Access Token
                      </button>
                      <button
                        type="button"
                        onClick={() => setCustomAppMode("client")}
                        className={`flex-1 text-[11px] py-1 rounded ${customAppMode === "client" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}
                      >
                        Client ID + Secret
                      </button>
                    </div>
                    <Input
                      placeholder="yourstore.myshopify.com"
                      value={customAppDomain}
                      onChange={(e) => setCustomAppDomain(e.target.value)}
                      className="h-8 text-xs"
                    />
                    {customAppMode === "token" ? (
                      <Input
                        placeholder="shpat_..."
                        type="password"
                        value={customAppToken}
                        onChange={(e) => setCustomAppToken(e.target.value)}
                        className="h-8 text-xs font-mono"
                      />
                    ) : (
                      <>
                        <Input
                          placeholder="Client ID"
                          value={customAppClientId}
                          onChange={(e) => setCustomAppClientId(e.target.value)}
                          className="h-8 text-xs font-mono"
                        />
                        <Input
                          placeholder="Client Secret"
                          type="password"
                          value={customAppClientSecret}
                          onChange={(e) => setCustomAppClientSecret(e.target.value)}
                          className="h-8 text-xs font-mono"
                        />
                      </>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={handleCustomAppSave}
                      disabled={
                        customAppSaving ||
                        !customAppDomain.trim() ||
                        (customAppMode === "token"
                          ? !customAppToken.trim()
                          : !customAppClientId.trim() || !customAppClientSecret.trim())
                      }
                    >
                      {customAppSaving ? (
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                      )}
                      Verify & Save
                    </Button>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      {customAppMode === "client"
                        ? "Uses Shopify Dev Dashboard client_credentials grant. App must be installed on the store."
                        : <>Required scopes: <span className="font-mono">read_products, write_products, read_inventory, write_inventory, read_locations</span></>}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>

        {/* LIGHTSPEED CARD */}
        <Card className="p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center text-lg">
                ⚡
              </div>
              <div>
                <div className="font-semibold text-sm">Lightspeed</div>
                {lsConn ? (
                  <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-[10px] mt-0.5">
                    Connected
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] mt-0.5">
                    Not connected
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {lsConn ? (
            <>
              <div className="text-xs space-y-1 font-mono">
                <div className="text-muted-foreground truncate">{lsAccount}</div>
                <div className="text-muted-foreground">
                  {lsCount.toLocaleString()} products cached
                </div>
                <div className="text-muted-foreground">
                  Synced {formatRelative(lsConn.last_synced)}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleLightspeedSync}
                  disabled={lsSyncing}
                  className="flex-1"
                >
                  {lsSyncing ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3 mr-1" />
                  )}
                  {lsSyncing ? "Syncing…" : "Sync now"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleLightspeedDisconnect}
                  className="text-destructive hover:text-destructive"
                >
                  <Unplug className="w-3 h-3 mr-1" /> Disconnect
                </Button>
              </div>
            </>
          ) : !showLsOptions ? (
            <Button size="sm" className="w-full" onClick={() => setShowLsOptions(true)}>
              <ExternalLink className="w-3 h-3 mr-1" /> Connect Lightspeed
            </Button>
          ) : (
            <div className="space-y-2">
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-start"
                onClick={handleLightspeedXConnect}
                disabled={lsConnecting === "x"}
              >
                {lsConnecting === "x" ? (
                  <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                ) : (
                  <Zap className="w-3 h-3 mr-2" />
                )}
                Lightspeed X (Cloud) — OAuth
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-start"
                onClick={() => setShowLsRForm((v) => !v)}
              >
                <Store className="w-3 h-3 mr-2" />
                Lightspeed R (On-premise) — API key
              </Button>
              {showLsRForm && (
                <div className="space-y-2 pt-2 border-t border-border">
                  <Input
                    placeholder="Server URL (e.g. https://...)"
                    value={lsRForm.server_url}
                    onChange={(e) =>
                      setLsRForm((f) => ({ ...f, server_url: e.target.value }))
                    }
                    className="h-8 text-xs"
                  />
                  <Input
                    placeholder="Account ID"
                    value={lsRForm.account_id}
                    onChange={(e) =>
                      setLsRForm((f) => ({ ...f, account_id: e.target.value }))
                    }
                    className="h-8 text-xs"
                  />
                  <Input
                    placeholder="API Key"
                    type="password"
                    value={lsRForm.api_key}
                    onChange={(e) =>
                      setLsRForm((f) => ({ ...f, api_key: e.target.value }))
                    }
                    className="h-8 text-xs"
                  />
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={handleLightspeedRSubmit}
                    disabled={lsConnecting === "r"}
                  >
                    {lsConnecting === "r" ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                    )}
                    Save R-Series credentials
                  </Button>
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  setShowLsOptions(false);
                  setShowLsRForm(false);
                }}
                className="text-[11px] text-muted-foreground hover:underline w-full text-center"
              >
                Cancel
              </button>
            </div>
          )}
        </Card>
      </div>

      {/* CATALOG HEALTH */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm font-medium">Catalog health</div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Auto-sync (6 h)</span>
            <Switch checked={autoSync} onCheckedChange={handleAutoSyncToggle} />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <div className="text-muted-foreground">Total products cached</div>
            <div className="text-lg font-semibold mt-0.5">
              {stats.total.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Last full sync</div>
            <div className="text-lg font-semibold mt-0.5">
              {formatRelative(stats.lastSyncedAt)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Connected platforms</div>
            <div className="text-lg font-semibold mt-0.5">
              {connectedPlatformCount}
            </div>
          </div>
        </div>

        {cacheStale && (shopifyConnected || lsConn) && (
          <div
            className={cn(
              "flex items-start gap-2 p-3 rounded-md border text-xs",
              "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400",
            )}
          >
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Your product catalog may be outdated.</div>
              <div className="opacity-90">
                Sync now for accurate stock matching.
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto shrink-0"
              onClick={() => void runAutoSync()}
              disabled={shopifySyncing || lsSyncing}
            >
              {(shopifySyncing || lsSyncing) ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3 mr-1" />
              )}
              Sync all
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
