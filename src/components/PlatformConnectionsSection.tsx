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
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      void loadAll();
    });

    void loadAll();

    return () => {
      subscription.unsubscribe();
    };
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
      const [{ data: { user } }, ls, counts] = await Promise.all([
        supabase.auth.getUser(),
        loadLightspeedConn(),
        loadCatalogCounts(),
      ]);

      let shopifySyncMeta: { shop_domain: string | null; last_synced_at: string | null } | null = null;
      let platformCount = 0;
      if (user) {
        const [{ data }, activePlatforms] = await Promise.all([
          supabase
          .from("platform_connections")
          .select("shop_domain, last_synced_at")
          .eq("user_id", user.id)
          .eq("platform", "shopify")
          .eq("is_active", true)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from("platform_connections")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user.id)
            .eq("is_active", true),
        ]);
        shopifySyncMeta = data;
        platformCount = activePlatforms.count ?? 0;
      }

      if (shopifySyncMeta?.shop_domain) {
        setShopifyConnected(true);
        setShopifyDomain(shopifySyncMeta.shop_domain);
        setShopifyLastSynced(shopifySyncMeta?.last_synced_at ?? null);
      } else {
        setShopifyConnected(false);
        setShopifyDomain("");
        setShopifyLastSynced(null);
      }
      setConnectedPlatformCount(platformCount);
      setLsConn(ls);
      setShopifyCount(counts.shopify);
      setLsCount(counts.lightspeed);
    } finally {
      setLoading(false);
    }
  };

  const loadLightspeedConn = async (): Promise<LightspeedConn | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase
      .from("pos_connections")
      .select("ls_x_domain_prefix, ls_r_account_id, last_synced")
      .eq("user_id", user.id)
      .in("platform", ["lightspeed_x", "lightspeed_r"])
      .maybeSingle();
    if (!data) return null;
    if (!data.ls_x_domain_prefix && !data.ls_r_account_id) return null;
    return data as LightspeedConn;
  };

  const loadCatalogCounts = async (): Promise<{ shopify: number; lightspeed: number }> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { shopify: 0, lightspeed: 0 };
    const [s, l] = await Promise.all([
      supabase
        .from("product_catalog_cache")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("platform", "shopify"),
      supabase
        .from("product_catalog_cache")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("platform", "lightspeed"),
    ]);
    return { shopify: s.count ?? 0, lightspeed: l.count ?? 0 };
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

      if (job as SyncJob | null) {
        const currentJob = job as SyncJob;
        const synced = currentJob.products_synced ?? 0;
        const total = currentJob.total_products ?? 0;
        setShopifySyncProgress(total > 0 ? `${synced.toLocaleString()} / ${total.toLocaleString()} products` : `${synced.toLocaleString()} products`);

        if (currentJob.status === "done") {
          const counts = await loadCatalogCounts();
          setShopifyCount(counts.shopify);
          setShopifyLastSynced(currentJob.completed_at ?? new Date().toISOString());
          toast.success(`Catalog synced — ${(currentJob.total_products ?? currentJob.products_synced ?? counts.shopify).toLocaleString()} products ready`, {
            description: "Stock check is ready for fast invoice matching.",
          });
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
  const handleShopifyConnect = async () => {
    if (!shopifyInput.trim()) {
      toast.error("Enter your Shopify store domain first");
      return;
    }
    setShopifyOAuthLoading(true);
    try {
      const url = shopifyInput.includes(".myshopify.com")
        ? shopifyInput.trim()
        : `${shopifyInput.trim()}.myshopify.com`;
      const installUrl = await initiateOAuth(url);
      window.location.href = installUrl;
    } catch (err) {
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
    if (!domain || !token) {
      toast.error("Enter both store domain and access token");
      return;
    }
    setCustomAppSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "shopify-custom-app-verify",
        { body: { shop_domain: domain, access_token: token } },
      );
      if (error) {
        // Try to surface the function's JSON error body
        const msg =
          (error as { context?: { body?: string } })?.context?.body ||
          error.message ||
          "Verification failed";
        let parsed = msg;
        try {
          const j = JSON.parse(msg);
          if (j?.error) parsed = j.error;
        } catch { /* ignore */ }
        throw new Error(parsed);
      }
      if (!data?.success) {
        throw new Error(data?.error || "Verification failed");
      }
      toast.success(`Connected to ${data.shop_name}`);
      setCustomAppDomain("");
      setCustomAppToken("");
      setShowCustomApp(false);
      void loadAll();

      // Auto-populate catalog cache on first connect so the invoice fast path
      // works immediately on the user's very first invoice.
      void (async () => {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return;
          const { data: syncData, error: syncError } = await supabase.functions.invoke("sync-shopify-catalog", {
            body: {
              user_id: user.id,
              shop_domain: domain,
              access_token: token,
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
      toast.error(err instanceof Error ? err.message : "Failed to verify token");
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
      const counts = await loadCatalogCounts();
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

              <div className="pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowCustomApp((v) => !v)}
                  className="text-[11px] text-muted-foreground hover:text-foreground hover:underline w-full text-left flex items-center gap-1"
                >
                  <KeyRound className="w-3 h-3" />
                  {showCustomApp ? "Hide" : "Connect via Custom App Token (for testing)"}
                </button>
                {showCustomApp && (
                  <div className="space-y-2 mt-2">
                    <Input
                      placeholder="yourstore.myshopify.com"
                      value={customAppDomain}
                      onChange={(e) => setCustomAppDomain(e.target.value)}
                      className="h-8 text-xs"
                    />
                    <Input
                      placeholder="shpat_..."
                      type="password"
                      value={customAppToken}
                      onChange={(e) => setCustomAppToken(e.target.value)}
                      className="h-8 text-xs font-mono"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={handleCustomAppSave}
                      disabled={customAppSaving || !customAppDomain.trim() || !customAppToken.trim()}
                    >
                      {customAppSaving ? (
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                      )}
                      Verify & Save
                    </Button>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      Required scopes: <span className="font-mono">read_products, write_products, read_inventory, write_inventory, read_locations</span>
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
