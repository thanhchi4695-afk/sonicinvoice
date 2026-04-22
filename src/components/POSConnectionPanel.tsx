import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Unplug, ExternalLink, Store, Barcode } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getConnection } from "@/lib/shopify-api";
import { toast } from "sonner";

const LS_DOMAIN_PREFIX_KEY = "ls_domain_prefix";

/** Extract just the prefix from any of these inputs:
 *   "stompshoes"
 *   "stompshoes.retail.lightspeed.app"
 *   "https://stompshoes.retail.lightspeed.app"
 *   "https://stompshoes.retail.lightspeed.app/some/path"
 */
function extractDomainPrefix(input: string): string {
  let s = (input || "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  s = s.replace(/\.retail\.lightspeed\.app$/, "");
  s = s.replace(/[^a-z0-9-]/g, "");
  return s;
}

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
  const [syncProgress, setSyncProgress] = useState<{
    phase: "scanning" | "updating" | "done";
    scanned?: number;
    processed?: number;
    total?: number;
    updated?: number;
    already?: number;
    noMatch?: number;
    errors?: number;
  } | null>(null);
  const [lsxDialogOpen, setLsxDialogOpen] = useState(false);
  const [lsxPrefixInput, setLsxPrefixInput] = useState(
    () => localStorage.getItem(LS_DOMAIN_PREFIX_KEY) || "",
  );

  const handleBarcodeSync = async () => {
    setSyncingBarcodes(true);
    setSyncProgress({ phase: "scanning", scanned: 0 });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not signed in");

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-barcodes-to-shopify`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      if (!res.ok || !res.body) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let final: Record<string, unknown> | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: Record<string, unknown>;
          try { evt = JSON.parse(line); } catch { continue; }
          switch (evt.type) {
            case "start":
              setSyncProgress({ phase: "scanning", scanned: 0, total: evt.total_lightspeed as number });
              break;
            case "shopify_scan":
              setSyncProgress(p => ({ ...(p || { phase: "scanning" }), phase: "scanning", scanned: evt.scanned as number }));
              break;
            case "shopify_scan_done":
              setSyncProgress(p => ({ ...(p || { phase: "scanning" }), phase: "updating", scanned: evt.total_shopify as number, processed: 0, updated: 0 }));
              break;
            case "progress":
              setSyncProgress(p => ({
                ...(p || { phase: "updating" }),
                phase: "updating",
                processed: evt.processed as number,
                total: evt.total as number,
                updated: evt.updated as number,
                already: evt.already as number,
                noMatch: evt.no_match as number,
                errors: evt.errors as number,
              }));
              break;
            case "done":
              final = evt;
              setSyncProgress(p => ({
                ...(p || { phase: "done" }),
                phase: "done",
                updated: evt.updated as number,
                already: evt.already_had_barcode as number,
                noMatch: evt.no_shopify_match as number,
                errors: (evt.errors as unknown[])?.length ?? 0,
              }));
              break;
            case "error":
              throw new Error(String(evt.message || "Sync failed"));
          }
        }
      }

      if (!final) throw new Error("Sync ended without result");
      const updated = (final.updated as number) ?? 0;
      const already = (final.already_had_barcode as number) ?? 0;
      const noMatch = (final.no_shopify_match as number) ?? 0;
      const errs = (final.errors as unknown[])?.length ?? 0;
      toast.success(
        `Updated ${updated} Shopify barcodes` +
          (already ? ` · ${already} already had one` : "") +
          (noMatch ? ` · ${noMatch} not matched in Shopify` : "") +
          (errs ? ` · ${errs} errors` : ""),
      );
      if (final.note) toast.info(String(final.note));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Barcode sync failed");
      setSyncProgress(null);
    } finally {
      setSyncingBarcodes(false);
      // Auto-clear progress display after a moment
      setTimeout(() => setSyncProgress(null), 8000);
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

    // X-Series: collect store prefix from the user first
    if (platform === "lightspeed_x") {
      setLsxPrefixInput(localStorage.getItem(LS_DOMAIN_PREFIX_KEY) || "");
      setLsxDialogOpen(true);
      return;
    }

    await startOAuth(platform);
  };

  const handleLsxConfirm = async () => {
    const prefix = extractDomainPrefix(lsxPrefixInput);
    if (!prefix) {
      toast.error("Please enter your Lightspeed store URL");
      return;
    }
    localStorage.setItem(LS_DOMAIN_PREFIX_KEY, prefix);
    setLsxDialogOpen(false);
    await startOAuth("lightspeed_x", prefix);
  };

  const startOAuth = async (platform: string, domainPrefix?: string) => {
    setConnecting(platform);
    try {
      const { data, error } = await supabase.functions.invoke("pos-proxy", {
        body: {
          action: "get_auth_url",
          platform,
          ...(domainPrefix ? { domain_prefix: domainPrefix } : {}),
        },
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
                  <div className="space-y-2">
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
                    {syncProgress && (
                      <div className="rounded-md bg-background border border-border p-2 space-y-1.5">
                        {syncProgress.phase === "scanning" && (
                          <p className="text-[11px] text-muted-foreground">
                            Scanning Shopify variants… <span className="font-mono text-foreground">{syncProgress.scanned ?? 0}</span> found
                            {syncProgress.total != null && (
                              <> · {syncProgress.total} Lightspeed rows queued</>
                            )}
                          </p>
                        )}
                        {syncProgress.phase === "updating" && (
                          <>
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-muted-foreground">
                                Updating barcodes…
                              </span>
                              <span className="font-mono text-foreground">
                                {syncProgress.processed ?? 0} / {syncProgress.total ?? 0}
                              </span>
                            </div>
                            <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary transition-all"
                                style={{
                                  width: `${syncProgress.total ? Math.min(100, ((syncProgress.processed ?? 0) / syncProgress.total) * 100) : 0}%`,
                                }}
                              />
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                              <span>✓ {syncProgress.updated ?? 0} updated</span>
                              <span>= {syncProgress.already ?? 0} already had</span>
                              <span>· {syncProgress.noMatch ?? 0} no match</span>
                              {(syncProgress.errors ?? 0) > 0 && (
                                <span className="text-destructive">! {syncProgress.errors} errors</span>
                              )}
                            </div>
                          </>
                        )}
                        {syncProgress.phase === "done" && (
                          <p className="text-[11px] text-muted-foreground">
                            Done · <span className="text-foreground">{syncProgress.updated ?? 0}</span> updated, {syncProgress.already ?? 0} already had, {syncProgress.noMatch ?? 0} not matched
                            {(syncProgress.errors ?? 0) > 0 && (
                              <>, <span className="text-destructive">{syncProgress.errors} errors</span></>
                            )}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      <Dialog open={lsxDialogOpen} onOpenChange={setLsxDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Connect Lightspeed X-Series</DialogTitle>
            <DialogDescription>
              Enter your Lightspeed store URL so we know which account to connect to.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="ls-prefix">Your Lightspeed store URL</Label>
            <div className="flex items-center gap-1 rounded-md border border-input bg-background pr-3 focus-within:ring-2 focus-within:ring-ring">
              <Input
                id="ls-prefix"
                value={lsxPrefixInput}
                onChange={(e) => setLsxPrefixInput(e.target.value)}
                placeholder="yourstore"
                className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleLsxConfirm();
                }}
              />
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                .retail.lightspeed.app
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              The URL you use to log into Lightspeed — just the part before
              <code className="mx-1 px-1 rounded bg-muted">.retail.lightspeed.app</code>.
              You can also paste the full URL.
            </p>
            {lsxPrefixInput && (
              <p className="text-[11px] text-muted-foreground font-mono">
                → {extractDomainPrefix(lsxPrefixInput) || "(invalid)"}.retail.lightspeed.app
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLsxDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleLsxConfirm} disabled={!extractDomainPrefix(lsxPrefixInput)}>
              Continue to Lightspeed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
