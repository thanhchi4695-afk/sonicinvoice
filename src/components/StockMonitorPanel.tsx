import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Bell, Settings, AlertTriangle, CheckCircle, Package, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { addAuditEntry } from "@/lib/audit-log";
import { triggerStockAlertBrain } from "@/lib/stock-alert-trigger";

/* ─── Types ───────────────────────────────────────── */

interface MonitorSettings {
  enabled: boolean;
  ongoingTag: string;
  defaultThreshold: number;
  alertMode: "instant" | "digest_daily" | "digest_weekly";
  digestHour: number;
  notifyEmail: string;
  notifyCCEmails: string;
}

interface StockAlert {
  id: string;
  productTitle: string;
  productHandle: string;
  variantTitle: string;
  variantSku: string;
  availableQty: number;
  threshold: number;
  alertType: "low" | "critical" | "zero";
  notified: boolean;
  notifiedAt: string | null;
  resolved: boolean;
  resolvedAt: string | null;
  resolvedQty: number | null;
  locationName: string;
  createdAt: string;
}

interface MonitoredProduct {
  productId: string;
  productTitle: string;
  productHandle: string;
  variantId: string;
  variantTitle: string;
  variantSku: string;
  isOngoing: boolean;
  customThreshold: number | null;
  currentStock: number;
  locationName: string;
}

/* ─── Defaults ────────────────────────────────────── */

const DEFAULT_SETTINGS: MonitorSettings = {
  enabled: true,
  ongoingTag: "ongoing",
  defaultThreshold: 2,
  alertMode: "instant",
  digestHour: 8,
  notifyEmail: "",
  notifyCCEmails: "",
};

function loadSettings(): MonitorSettings {
  try {
    const raw = localStorage.getItem("stock_monitor_settings");
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

function saveSettings(s: MonitorSettings) {
  localStorage.setItem("stock_monitor_settings", JSON.stringify(s));
}

function loadAlerts(): StockAlert[] {
  try { return JSON.parse(localStorage.getItem("stock_monitor_alerts") || "[]"); }
  catch { return []; }
}

function saveAlerts(a: StockAlert[]) {
  localStorage.setItem("stock_monitor_alerts", JSON.stringify(a));
}

function loadMonitored(): MonitoredProduct[] {
  try { return JSON.parse(localStorage.getItem("stock_monitor_products") || "[]"); }
  catch { return []; }
}

function saveMonitored(p: MonitoredProduct[]) {
  localStorage.setItem("stock_monitor_products", JSON.stringify(p));
}

/* ─── Component ───────────────────────────────────── */

interface Props { onBack: () => void; }

const StockMonitorPanel = ({ onBack }: Props) => {
  const [settings, setSettings] = useState<MonitorSettings>(loadSettings);
  const [alerts, setAlerts] = useState<StockAlert[]>(loadAlerts);
  const [monitored, setMonitored] = useState<MonitoredProduct[]>(loadMonitored);
  const [scanning, setScanning] = useState(false);
  const [activeTab, setActiveTab] = useState("alerts");
  const [alertFilter, setAlertFilter] = useState<"all" | "zero" | "critical" | "low">("all");

  useEffect(() => { saveSettings(settings); }, [settings]);
  useEffect(() => { saveAlerts(alerts); }, [alerts]);
  useEffect(() => { saveMonitored(monitored); }, [monitored]);

  const activeAlerts = alerts.filter(a => !a.resolved);
  const filteredAlerts = activeAlerts.filter(a => alertFilter === "all" || a.alertType === alertFilter);
  const zeroCount = activeAlerts.filter(a => a.alertType === "zero").length;
  const criticalCount = activeAlerts.filter(a => a.alertType === "critical").length;
  const lowCount = activeAlerts.filter(a => a.alertType === "low").length;

  /* ─── Scan Shopify for ongoing products ─────────── */
  const scanProducts = async () => {
    setScanning(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { toast.error("Please sign in first"); setScanning(false); return; }

      const { data: conn } = await supabase
        .from("shopify_connections")
        .select("*")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (!conn) {
        toast.error("Connect your Shopify store first (Account → Connect Store)");
        setScanning(false);
        return;
      }

      toast.info("Scanning products for ongoing tag...");

      // Fetch products via proxy
      const tags = settings.ongoingTag.split(",").map(t => t.trim().toLowerCase());
      const allProducts: MonitoredProduct[] = [];
      const newAlerts: StockAlert[] = [];
      let page = 1;
      let hasMore = true;

      while (hasMore && page <= 10) {
        const resp = await supabase.functions.invoke("shopify-direct-proxy", {
          body: {
            method: "GET",
            endpoint: `/admin/api/${conn.api_version}/products.json?limit=250&page=${page}&fields=id,title,handle,tags,variants`,
          },
        });

        const products = resp.data?.data?.products || resp.data?.products || [];
        if (!products.length) { hasMore = false; break; }

        for (const p of products) {
          const productTags = (p.tags || "").split(",").map((t: string) => t.trim().toLowerCase());
          const isOngoing = tags.some(tag => productTags.includes(tag));
          if (!isOngoing) continue;

          for (const v of (p.variants || [])) {
            const stock = v.inventory_quantity ?? 0;
            const locationName = conn.shop_name || "Primary";

            allProducts.push({
              productId: String(p.id),
              productTitle: p.title,
              productHandle: p.handle,
              variantId: String(v.id),
              variantTitle: v.title || "Default",
              variantSku: v.sku || "",
              isOngoing: true,
              customThreshold: null,
              currentStock: stock,
              locationName,
            });

            // Check threshold
            const threshold = settings.defaultThreshold;
            if (stock <= threshold) {
              const alertType: "zero" | "critical" | "low" =
                stock === 0 ? "zero" : stock === 1 ? "critical" : "low";

              // Deduplicate
              const existing = alerts.find(
                a => a.variantTitle === (v.title || "Default") &&
                  a.productTitle === p.title && !a.resolved
              );
              if (!existing) {
                newAlerts.push({
                  id: `scan_${p.id}_${v.id}_${Date.now()}`,
                  productTitle: p.title,
                  productHandle: p.handle,
                  variantTitle: v.title || "Default",
                  variantSku: v.sku || "",
                  availableQty: stock,
                  threshold,
                  alertType,
                  notified: false,
                  notifiedAt: null,
                  resolved: false,
                  resolvedAt: null,
                  resolvedQty: null,
                  locationName,
                  createdAt: new Date().toISOString(),
                });
              }
            }
          }
        }

        if (products.length < 250) hasMore = false;
        else page++;
      }

      setMonitored(allProducts);
      if (newAlerts.length) {
        setAlerts(prev => [...newAlerts, ...prev]);

        // Fire-and-forget: notify Sonic so the chat surfaces a reorder suggestion.
        (async () => {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return;
          const grouped = new Map<string, typeof newAlerts>();
          for (const a of newAlerts) {
            const key = a.productTitle;
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key)!.push(a);
          }
          for (const [productTitle, group] of grouped) {
            triggerStockAlertBrain({
              userId: user.id,
              brandName: productTitle,
              lowSizes: group.map(g => g.variantTitle),
              currentQty: group.reduce((sum, g) => sum + g.availableQty, 0),
              threshold: group[0].threshold,
            }).catch(() => {});
          }
        })();
      }

      addAuditEntry("Stock Monitor", `Scanned ${allProducts.length} ongoing variants, ${newAlerts.length} new alerts`);
      toast.success(`Found ${allProducts.length} ongoing variants. ${newAlerts.length} below threshold.`);
    } catch (err) {
      console.error("Scan error:", err);
      toast.error("Scan failed. Check your Shopify connection.");
    } finally {
      setScanning(false);
    }
  };

  const resolveAlert = (id: string) => {
    setAlerts(prev => prev.map(a =>
      a.id === id ? { ...a, resolved: true, resolvedAt: new Date().toISOString() } : a
    ));
    toast.success("Alert resolved — marked as reordered");
  };

  const resolveAll = () => {
    setAlerts(prev => prev.map(a => a.resolved ? a : { ...a, resolved: true, resolvedAt: new Date().toISOString() }));
    toast.success("All alerts resolved");
  };

  const setCustomThreshold = (variantId: string, threshold: number) => {
    setMonitored(prev => prev.map(p =>
      p.variantId === variantId ? { ...p, customThreshold: threshold } : p
    ));
  };

  const alertBadgeColor = (type: string) => {
    if (type === "zero") return "bg-destructive text-destructive-foreground";
    if (type === "critical") return "bg-orange-500 text-white";
    return "bg-yellow-500 text-white";
  };

  const alertLabel = (type: string) => {
    if (type === "zero") return "OUT OF STOCK";
    if (type === "critical") return "1 LEFT";
    return "LOW STOCK";
  };

  const timeSince = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="w-5 h-5" /></Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold font-display flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary" /> Stock Monitor
          </h1>
          <p className="text-sm text-muted-foreground">Track ongoing styles &amp; get reorder alerts</p>
        </div>
        {activeAlerts.length > 0 && (
          <Badge className="bg-destructive text-destructive-foreground">{activeAlerts.length} alert{activeAlerts.length !== 1 ? "s" : ""}</Badge>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full mb-4">
          <TabsTrigger value="alerts" className="flex-1">Alerts {activeAlerts.length > 0 && `(${activeAlerts.length})`}</TabsTrigger>
          <TabsTrigger value="products" className="flex-1">Products ({monitored.length})</TabsTrigger>
          <TabsTrigger value="settings" className="flex-1"><Settings className="w-3.5 h-3.5 mr-1" /> Settings</TabsTrigger>
        </TabsList>

        {/* ─── ALERTS TAB ─────────────────────────── */}
        <TabsContent value="alerts">
          {activeAlerts.length === 0 ? (
            <Card>
              <CardContent className="pt-8 pb-8 text-center">
                <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
                <h3 className="text-lg font-semibold mb-1">All ongoing styles are well stocked</h3>
                <p className="text-sm text-muted-foreground">
                  You'll be alerted the moment any size of a tagged ongoing style drops to {settings.defaultThreshold} unit{settings.defaultThreshold !== 1 ? "s" : ""} or below.
                </p>
                <Button variant="outline" className="mt-4" onClick={scanProducts} disabled={scanning}>
                  <RefreshCw className={`w-4 h-4 mr-2 ${scanning ? "animate-spin" : ""}`} />
                  {scanning ? "Scanning..." : "Scan products now"}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Filter pills */}
              <div className="flex gap-2 mb-4 flex-wrap">
                <Button size="sm" variant={alertFilter === "all" ? "default" : "outline"} onClick={() => setAlertFilter("all")}>All ({activeAlerts.length})</Button>
                {zeroCount > 0 && <Button size="sm" variant={alertFilter === "zero" ? "default" : "outline"} onClick={() => setAlertFilter("zero")}>🔴 Out of stock ({zeroCount})</Button>}
                {criticalCount > 0 && <Button size="sm" variant={alertFilter === "critical" ? "default" : "outline"} onClick={() => setAlertFilter("critical")}>🟠 Critical ({criticalCount})</Button>}
                {lowCount > 0 && <Button size="sm" variant={alertFilter === "low" ? "default" : "outline"} onClick={() => setAlertFilter("low")}>🟡 Low ({lowCount})</Button>}
              </div>

              <div className="flex justify-between items-center mb-3">
                <p className="text-xs text-muted-foreground">{filteredAlerts.length} alert{filteredAlerts.length !== 1 ? "s" : ""}</p>
                <Button size="sm" variant="ghost" onClick={resolveAll} className="text-xs">Mark all resolved</Button>
              </div>

              <div className="space-y-2">
                {filteredAlerts.map(alert => (
                  <Card key={alert.id} className="overflow-hidden">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm truncate">{alert.productTitle}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {alert.variantTitle}{alert.variantSku ? ` · SKU: ${alert.variantSku}` : ""}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">📍 {alert.locationName}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-2xl font-bold font-display">{alert.availableQty}</span>
                          <p className="text-[10px] text-muted-foreground">units left</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-3">
                        <div className="flex items-center gap-2">
                          <Badge className={alertBadgeColor(alert.alertType)}>{alertLabel(alert.alertType)}</Badge>
                          <span className="text-[10px] text-muted-foreground">{timeSince(alert.createdAt)}</span>
                        </div>
                        <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => resolveAlert(alert.id)}>
                          ✓ Ordered
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}

          {/* Scan button at bottom */}
          {activeAlerts.length > 0 && (
            <Button variant="outline" className="w-full mt-4" onClick={scanProducts} disabled={scanning}>
              <RefreshCw className={`w-4 h-4 mr-2 ${scanning ? "animate-spin" : ""}`} />
              {scanning ? "Scanning..." : "Refresh stock scan"}
            </Button>
          )}
        </TabsContent>

        {/* ─── PRODUCTS TAB ───────────────────────── */}
        <TabsContent value="products">
          {monitored.length === 0 ? (
            <Card>
              <CardContent className="pt-6 pb-6">
                <div className="bg-muted/50 rounded-lg p-4 mb-4">
                  <h3 className="font-semibold text-sm flex items-center gap-2 mb-2">
                    <Package className="w-4 h-4" /> No ongoing products found
                  </h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    Tag products as "<span className="font-mono-data">{settings.ongoingTag}</span>" in Shopify Admin to start monitoring.
                  </p>
                  <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
                    <li>Go to Shopify Admin → Products</li>
                    <li>Open a product you always keep in stock</li>
                    <li>Scroll to Tags → type "<span className="font-mono-data">{settings.ongoingTag}</span>" → Save</li>
                    <li>Repeat for all core/permanent styles</li>
                    <li>Click "Scan all products" below</li>
                  </ol>
                </div>
                <Button className="w-full" onClick={scanProducts} disabled={scanning}>
                  <RefreshCw className={`w-4 h-4 mr-2 ${scanning ? "animate-spin" : ""}`} />
                  {scanning ? "Scanning..." : "Scan all products now"}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex justify-between items-center mb-3">
                <p className="text-sm text-muted-foreground">{monitored.length} ongoing variant{monitored.length !== 1 ? "s" : ""} monitored</p>
                <Button size="sm" variant="outline" onClick={scanProducts} disabled={scanning}>
                  <RefreshCw className={`w-3.5 h-3.5 mr-1 ${scanning ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>
              <div className="space-y-1.5">
                {monitored.map((p, i) => {
                  const effectiveThreshold = p.customThreshold ?? settings.defaultThreshold;
                  const isLow = p.currentStock <= effectiveThreshold;
                  return (
                    <Card key={`${p.variantId}-${i}`} className={isLow ? "border-destructive/30" : ""}>
                      <CardContent className="p-3">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{p.productTitle}</p>
                            <p className="text-xs text-muted-foreground">{p.variantTitle}{p.variantSku ? ` · ${p.variantSku}` : ""}</p>
                          </div>
                          <div className="text-center shrink-0 w-12">
                            <span className={`text-lg font-bold font-display ${isLow ? "text-destructive" : "text-green-600"}`}>{p.currentStock}</span>
                            <p className="text-[9px] text-muted-foreground">stock</p>
                          </div>
                          <div className="shrink-0 w-16">
                            <Input
                              type="number"
                              min={1}
                              max={99}
                              value={p.customThreshold ?? settings.defaultThreshold}
                              onChange={e => setCustomThreshold(p.variantId, parseInt(e.target.value) || 1)}
                              className="h-7 text-xs text-center w-full"
                            />
                            <p className="text-[9px] text-muted-foreground text-center mt-0.5">threshold</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </TabsContent>

        {/* ─── SETTINGS TAB ───────────────────────── */}
        <TabsContent value="settings">
          <Card>
            <CardHeader><CardTitle className="text-base">Monitor Settings</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              {/* Enable toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Monitor enabled</p>
                  <p className="text-xs text-muted-foreground">Watch inventory changes in real time</p>
                </div>
                <Button
                  size="sm"
                  variant={settings.enabled ? "default" : "outline"}
                  onClick={() => setSettings(s => ({ ...s, enabled: !s.enabled }))}
                >
                  {settings.enabled ? "● On" : "○ Off"}
                </Button>
              </div>

              {/* Tag */}
              <div>
                <label className="text-sm font-medium block mb-1">Ongoing product tag</label>
                <Input
                  value={settings.ongoingTag}
                  onChange={e => setSettings(s => ({ ...s, ongoingTag: e.target.value }))}
                  placeholder="ongoing"
                />
                <p className="text-xs text-muted-foreground mt-1">Add this tag to products in Shopify. Separate multiple with commas.</p>
              </div>

              {/* Threshold */}
              <div>
                <label className="text-sm font-medium block mb-1">Default reorder threshold</label>
                <Input
                  type="number"
                  min={1}
                  max={99}
                  value={settings.defaultThreshold}
                  onChange={e => setSettings(s => ({ ...s, defaultThreshold: parseInt(e.target.value) || 2 }))}
                />
                <p className="text-xs text-muted-foreground mt-1">Alert when any variant reaches this quantity or below.</p>
              </div>

              {/* Email */}
              <div>
                <label className="text-sm font-medium block mb-1">Notification email</label>
                <Input
                  type="email"
                  value={settings.notifyEmail}
                  onChange={e => setSettings(s => ({ ...s, notifyEmail: e.target.value }))}
                  placeholder="owner@mystore.com"
                />
              </div>

              <div>
                <label className="text-sm font-medium block mb-1">CC emails (optional)</label>
                <Input
                  value={settings.notifyCCEmails}
                  onChange={e => setSettings(s => ({ ...s, notifyCCEmails: e.target.value }))}
                  placeholder="buyer@example.com, manager@example.com"
                />
              </div>

              {/* Alert mode */}
              <div>
                <label className="text-sm font-medium block mb-2">Alert mode</label>
                <div className="space-y-2">
                  {(["instant", "digest_daily", "digest_weekly"] as const).map(mode => (
                    <label key={mode} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="alertMode"
                        checked={settings.alertMode === mode}
                        onChange={() => setSettings(s => ({ ...s, alertMode: mode }))}
                        className="accent-primary"
                      />
                      <span className="text-sm">
                        {mode === "instant" && "Instant — email immediately when stock drops"}
                        {mode === "digest_daily" && "Daily digest — one summary per day"}
                        {mode === "digest_weekly" && "Weekly digest — one email per week (Monday)"}
                      </span>
                    </label>
                  ))}
                </div>
                {settings.alertMode !== "instant" && (
                  <div className="mt-2 ml-6">
                    <label className="text-xs text-muted-foreground block mb-1">Send at hour (UTC)</label>
                    <Input
                      type="number"
                      min={0}
                      max={23}
                      value={settings.digestHour}
                      onChange={e => setSettings(s => ({ ...s, digestHour: parseInt(e.target.value) || 8 }))}
                      className="w-20 h-8 text-sm"
                    />
                  </div>
                )}
              </div>

              <Button className="w-full" onClick={() => {
                saveSettings(settings);
                addAuditEntry("Stock Monitor", "Settings updated");
                toast.success("Settings saved");
              }}>
                Save settings
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default StockMonitorPanel;
