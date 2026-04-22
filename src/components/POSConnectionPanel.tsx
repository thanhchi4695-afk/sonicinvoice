import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, Unplug, ExternalLink, Store, Barcode } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getConnection } from "@/lib/shopify-api";
import { toast } from "sonner";

interface POSConnection {
  id: string;
  platform: string;
  shopify_connected: boolean;
  shopify_domain: string | null;
  ls_x_domain_prefix: string | null;
  ls_r_account_id: string | null;
  connected_at: string;
  last_synced: string | null;
}

const PLATFORMS = [
  {
    id: "shopify",
    name: "Shopify",
    icon: "🛍",
    desc: "Your Shopify store's product catalog",
  },
  {
    id: "lightspeed_x",
    name: "Lightspeed X-Series",
    icon: "⚡",
    desc: "Vend / X-Series POS",
  },
  {
    id: "lightspeed_r",
    name: "Lightspeed R-Series",
    icon: "💡",
    desc: "Lightspeed Retail (legacy)",
  },
];

const STOCK_CHECK_PREFS_KEY = "pos_stock_check_prefs";

function getStockCheckPrefs(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(STOCK_CHECK_PREFS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveStockCheckPrefs(prefs: Record<string, boolean>) {
  localStorage.setItem(STOCK_CHECK_PREFS_KEY, JSON.stringify(prefs));
}

export default function POSConnectionPanel() {
  const [connections, setConnections] = useState<POSConnection[]>([]);
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [shopifyDomain, setShopifyDomain] = useState("");
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [stockCheckPrefs, setStockCheckPrefs] = useState<Record<string, boolean>>(getStockCheckPrefs);
  const [syncingBarcodes, setSyncingBarcodes] = useState(false);

  const handleBarcodeSync = async () => {
    setSyncingBarcodes(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-barcodes-to-shopify", { body: {} });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      const updated = data?.updated ?? 0;
      const already = data?.already_had_barcode ?? 0;
      const noMatch = data?.no_shopify_match ?? 0;
      const errs = (data?.errors || []).length;
      toast.success(
        `Updated ${updated} Shopify barcodes` +
          (already ? ` · ${already} already had one` : "") +
          (noMatch ? ` · ${noMatch} not matched in Shopify` : "") +
          (errs ? ` · ${errs} errors` : ""),
      );
      if (data?.note) toast.info(data.note);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Barcode sync failed");
    } finally {
      setSyncingBarcodes(false);
    }
  };

  useEffect(() => {
    loadConnections();
  }, []);

  const loadConnections = async () => {
    setLoading(true);
    try {
      // Check Shopify connection (existing table)
      const shopifyConn = await getConnection();
      if (shopifyConn) {
        setShopifyConnected(true);
        setShopifyDomain(shopifyConn.store_url);
        // Auto-enable for stock check
        if (stockCheckPrefs.shopify === undefined) {
          const updated = { ...stockCheckPrefs, shopify: true };
          setStockCheckPrefs(updated);
          saveStockCheckPrefs(updated);
        }
      }

      // Check Lightspeed connections
      const { data } = await supabase
        .from("pos_connections")
        .select("*");
      setConnections((data as unknown as POSConnection[]) || []);
    } catch (err) {
      console.error("Failed to load POS connections:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async (platform: string) => {
    if (platform === "shopify") {
      // Shopify connection is handled in Account Settings
      toast.info("Use the Shopify Connection section above to connect your store.");
      return;
    }

    setConnecting(platform);
    try {
      const { data, error } = await supabase.functions.invoke("pos-proxy", {
        body: { action: "get_auth_url", platform },
      });
      if (error) throw new Error(error.message);
      if (!data?.url) throw new Error("No auth URL returned");

      // Open OAuth popup
      const popup = window.open(data.url, `${platform}_oauth`, "width=600,height=700");
      if (!popup) {
        toast.error("Please allow popups for OAuth");
        return;
      }

      // Listen for completion
      const handler = (event: MessageEvent) => {
        if (event.data?.type === "POS_AUTH_SUCCESS" && event.data?.platform === platform) {
          window.removeEventListener("message", handler);
          loadConnections();
          toast.success(`Connected to ${platform === "lightspeed_x" ? "Lightspeed X-Series" : "Lightspeed R-Series"}`);
          // Auto-enable for stock check
          const updated = { ...stockCheckPrefs, [platform]: true };
          setStockCheckPrefs(updated);
          saveStockCheckPrefs(updated);
        }
        if (event.data?.type === "POS_AUTH_ERROR") {
          window.removeEventListener("message", handler);
          toast.error("Connection failed. Please try again.");
        }
      };
      window.addEventListener("message", handler);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start connection");
    } finally {
      setConnecting(null);
    }
  };

  const handleDisconnect = async (platform: string) => {
    if (platform === "shopify") {
      toast.info("Disconnect Shopify from the Shopify Connection section above.");
      return;
    }
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from("pos_connections").delete()
        .eq("user_id", user.id)
        .eq("platform", platform);
      setConnections(prev => prev.filter(c => c.platform !== platform));
      const updated = { ...stockCheckPrefs };
      delete updated[platform];
      setStockCheckPrefs(updated);
      saveStockCheckPrefs(updated);
      toast.success("Disconnected");
    } catch {
      toast.error("Failed to disconnect");
    }
  };

  const toggleStockCheck = (platform: string, enabled: boolean) => {
    const updated = { ...stockCheckPrefs, [platform]: enabled };
    setStockCheckPrefs(updated);
    saveStockCheckPrefs(updated);
  };

  const getConnectionStatus = (platformId: string) => {
    if (platformId === "shopify") {
      return shopifyConnected
        ? { connected: true, detail: shopifyDomain }
        : { connected: false, detail: "" };
    }
    const conn = connections.find(c => c.platform === platformId);
    if (!conn) return { connected: false, detail: "" };
    if (platformId === "lightspeed_x" && conn.ls_x_domain_prefix) {
      return { connected: true, detail: `${conn.ls_x_domain_prefix}.retail.lightspeed.app` };
    }
    if (platformId === "lightspeed_r" && conn.ls_r_account_id) {
      return { connected: true, detail: `Account #${conn.ls_r_account_id}` };
    }
    return { connected: false, detail: "" };
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading POS connections…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground -mt-1 mb-2">
        Connect your point-of-sale systems for invoice stock checking. The app will search connected platforms to detect refills vs new products.
      </p>

      {PLATFORMS.map(p => {
        const status = getConnectionStatus(p.id);
        const isChecked = stockCheckPrefs[p.id] ?? false;

        return (
          <div
            key={p.id}
            className="bg-muted/30 rounded-xl p-4 border border-border"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-lg">{p.icon}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{p.name}</span>
                    {status.connected ? (
                      <Badge className="bg-primary/15 text-primary border-primary/30 text-[10px]">Connected</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">Not connected</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{p.desc}</p>
                  {status.connected && status.detail && (
                    <p className="text-xs text-muted-foreground mt-1 font-mono">{status.detail}</p>
                  )}
                </div>
              </div>

              <div>
                {status.connected ? (
                  <button
                    onClick={() => handleDisconnect(p.id)}
                    className="text-xs text-destructive hover:underline flex items-center gap-1"
                  >
                    <Unplug className="w-3 h-3" /> Disconnect
                  </button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleConnect(p.id)}
                    disabled={connecting === p.id}
                    className="text-xs"
                  >
                    {connecting === p.id ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <ExternalLink className="w-3 h-3 mr-1" />
                    )}
                    Connect
                  </Button>
                )}
              </div>
            </div>

            {status.connected && (
              <div className="mt-3 pt-3 border-t border-border space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Use for stock checking</span>
                  <Switch
                    checked={isChecked}
                    onCheckedChange={(val) => toggleStockCheck(p.id, val)}
                  />
                </div>
                {(p.id === "lightspeed_x" || p.id === "lightspeed_r") && shopifyConnected && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleBarcodeSync}
                    disabled={syncingBarcodes}
                    className="text-xs w-full"
                  >
                    {syncingBarcodes ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <Barcode className="w-3 h-3 mr-1" />
                    )}
                    Sync barcodes to Shopify
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Helper: get which platforms are enabled for stock checking */
export function getEnabledPOSPlatforms(): string[] {
  const prefs = getStockCheckPrefs();
  return Object.entries(prefs)
    .filter(([_, enabled]) => enabled)
    .map(([platform]) => platform);
}
