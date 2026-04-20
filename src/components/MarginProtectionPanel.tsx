import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ChevronLeft, ShieldCheck, ShieldAlert, ShieldX, HelpCircle, TrendingUp, AlertTriangle, Download, Loader2 } from "lucide-react";
import {
  getMarginSettings, saveMarginSettings, bulkMarginCheck,
  marginStatusColor, marginStatusBg, getMarginAuditLog,
  type MarginSettings, type BulkMarginSummary, type MarginStatus,
} from "@/lib/margin-protection";
import { useInvoiceSession } from "@/stores/invoice-session-store";
import InvoiceSessionBanner from "@/components/InvoiceSessionBanner";
import { supabase } from "@/integrations/supabase/client";

interface VariantRow {
  id: string;
  sku: string | null;
  cost: number | null;
  retail_price: number | null;
  product_title: string;
  vendor: string | null;
}

export default function MarginProtectionPanel({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState<MarginSettings>(getMarginSettings);
  const [activeTab, setActiveTab] = useState("dashboard");
  const { sessionProducts, hasSession } = useInvoiceSession();

  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [noCostCount, setNoCostCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Fetch from Supabase variants joined with product titles
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      // Total count (incl. null cost) for "No Cost" stat
      const { count: totalCount } = await supabase
        .from("variants")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);

      const { data, error } = await supabase
        .from("variants")
        .select("id, sku, cost, retail_price, products(title, vendor)")
        .eq("user_id", user.id)
        .not("cost", "is", null)
        .not("retail_price", "is", null);

      if (cancelled) return;
      if (error) {
        console.error(error);
        toast.error("Failed to load catalog variants");
      } else {
        const rows: VariantRow[] = (data || []).map((v: any) => ({
          id: v.id,
          sku: v.sku,
          cost: v.cost != null ? Number(v.cost) : null,
          retail_price: v.retail_price != null ? Number(v.retail_price) : null,
          product_title: v.products?.title || v.sku || "Untitled",
          vendor: v.products?.vendor ?? null,
        }));
        setVariants(rows);
        setNoCostCount(Math.max(0, (totalCount ?? 0) - rows.length));
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Build product list: prefer Supabase variants, fall back to invoice session
  const products = useMemo(() => {
    if (variants.length > 0) {
      return variants.map(v => ({
        handle: (v.sku || v.product_title).toLowerCase().replace(/\s+/g, "-"),
        title: v.product_title,
        price: v.retail_price ?? 0,
        costPrice: v.cost ?? 0,
        sku: v.sku || "",
        vendor: v.vendor || "",
      }));
    }
    if (hasSession) {
      return sessionProducts.map(p => ({
        handle: (p.sku || p.product_title).toLowerCase().replace(/\s+/g, "-"),
        title: p.product_title,
        price: Number(p.rrp) || 0,
        costPrice: Number(p.unit_cost) || 0,
        sku: p.sku || "",
        vendor: p.vendor || "",
      }));
    }
    return [];
  }, [variants, hasSession, sessionProducts]);

  const summary: BulkMarginSummary = useMemo(
    () => bulkMarginCheck(products, settings),
    [products, settings]
  );

  // Override noCost with DB count if we have variants from DB
  const displayNoCost = variants.length > 0 ? noCostCount : summary.noCost;

  const auditLog = useMemo(() => getMarginAuditLog().slice(0, 50), []);

  const minPriceFor = (cost: number) => cost / (1 - settings.globalMinMargin / 100);

  const findProductMeta = (handle: string) =>
    products.find(p => p.handle === handle);

  const exportPriceFloor = () => {
    const blocked = summary.results.filter(r => r.status === "blocked" && r.cost);
    if (blocked.length === 0) {
      toast.info("No blocked products to export");
      return;
    }
    const headers = ["Product", "Brand", "SKU", "Current RRP", "Min Price Required", "Current Margin %", "Target Margin %"];
    const rows = blocked.map(r => {
      const meta = findProductMeta(r.handle);
      const minPrice = r.cost ? minPriceFor(r.cost) : 0;
      return [
        `"${r.title.replace(/"/g, '""')}"`,
        `"${(meta?.vendor || "").replace(/"/g, '""')}"`,
        `"${meta?.sku || ""}"`,
        r.price.toFixed(2),
        minPrice.toFixed(2),
        r.margin_percentage?.toFixed(1) || "",
        settings.globalMinMargin.toString(),
      ].join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    downloadCsv(csv, `margin-protection-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${blocked.length} blocked products`);
  };

  const exportMarginReport = () => {
    if (summary.results.length === 0) {
      toast.info("No products to export");
      return;
    }
    const headers = ["Product", "SKU", "Cost", "RRP", "Gross Margin %", "Status", "Min Safe Price"];
    const rows = summary.results.map(r => {
      const meta = findProductMeta(r.handle);
      const minPrice = r.cost ? minPriceFor(r.cost) : 0;
      return [
        `"${r.title.replace(/"/g, '""')}"`,
        `"${meta?.sku || ""}"`,
        r.cost != null ? r.cost.toFixed(2) : "",
        r.price.toFixed(2),
        r.margin_percentage != null ? r.margin_percentage.toFixed(1) : "",
        r.status,
        minPrice ? minPrice.toFixed(2) : "",
      ].join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    downloadCsv(csv, `margin-report-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${summary.results.length} products`);
  };

  const downloadCsv = (csv: string, filename: string) => {
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const updateSetting = <K extends keyof MarginSettings>(key: K, val: MarginSettings[K]) => {
    const next = { ...settings, [key]: val };
    setSettings(next);
    saveMarginSettings(next);
  };

  const statusIcon = (s: MarginStatus) => {
    switch (s) {
      case "safe": return <ShieldCheck className="w-4 h-4 text-primary" />;
      case "warning": return <ShieldAlert className="w-4 h-4 text-warning" />;
      case "blocked": return <ShieldX className="w-4 h-4 text-destructive" />;
      case "no_cost": return <HelpCircle className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const emptyMessage = (
    <Card className="border-dashed"><CardContent className="p-8 text-center text-muted-foreground text-sm">
      No products with cost data found. Process an invoice to load products with cost prices,
      or add cost prices to your existing catalog products.
    </CardContent></Card>
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 pb-32">
      <button onClick={onBack} className="flex items-center gap-1 text-muted-foreground mb-4 text-sm">
        <ChevronLeft className="w-4 h-4" /> Back
      </button>
      <h1 className="text-2xl font-bold mb-1">🛡️ Margin Protection</h1>
      <p className="text-muted-foreground text-sm mb-4">Prevent selling below cost and protect minimum profit margins.</p>
      <InvoiceSessionBanner />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4 w-full">
          <TabsTrigger value="dashboard" className="flex-1">Dashboard</TabsTrigger>
          <TabsTrigger value="products" className="flex-1">Products</TabsTrigger>
          <TabsTrigger value="settings" className="flex-1">Settings</TabsTrigger>
          <TabsTrigger value="audit" className="flex-1">Audit Log</TabsTrigger>
        </TabsList>

        {/* ── Dashboard ── */}
        <TabsContent value="dashboard">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {([
              { label: "Safe", count: summary.safe, color: "text-primary", bg: "bg-primary/15", icon: <ShieldCheck className="w-5 h-5" /> },
              { label: "Warning", count: summary.warning, color: "text-warning", bg: "bg-warning/15", icon: <ShieldAlert className="w-5 h-5" /> },
              { label: "Blocked", count: summary.blocked, color: "text-destructive", bg: "bg-destructive/15", icon: <ShieldX className="w-5 h-5" /> },
              { label: "No Cost", count: displayNoCost, color: "text-muted-foreground", bg: "bg-muted", icon: <HelpCircle className="w-5 h-5" /> },
            ] as const).map((s, i) => (
              <Card key={i} className="border-border">
                <CardContent className="p-4 text-center">
                  <div className={`inline-flex items-center justify-center w-10 h-10 rounded-full ${s.bg} ${s.color} mb-2`}>
                    {s.icon}
                  </div>
                  <p className={`text-2xl font-bold ${s.color}`}>{s.count}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="mb-4">
            <CardHeader className="pb-2"><CardTitle className="text-sm">Protection Status</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${settings.mode === "strict" ? "bg-destructive" : "bg-warning"}`} />
                <span className="text-sm font-medium">{settings.mode === "strict" ? "Strict Mode" : "Relaxed Mode"}</span>
                <span className="text-xs text-muted-foreground ml-auto">Min margin: {settings.globalMinMargin}%</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {settings.mode === "strict"
                  ? "Products below minimum margin will be blocked from pricing changes."
                  : "Products below minimum margin will show a warning but can be overridden."}
              </p>
            </CardContent>
          </Card>

          {loading ? (
            <Card className="border-dashed"><CardContent className="p-8 text-center text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading catalog…
            </CardContent></Card>
          ) : summary.total === 0 ? emptyMessage : null}

          {summary.blocked > 0 && (
            <Card className="border-destructive/30 mb-4">
              <CardHeader className="pb-2"><CardTitle className="text-sm text-destructive flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Attention Required</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm">{summary.blocked} product{summary.blocked > 1 ? "s" : ""} {summary.blocked > 1 ? "are" : "is"} priced below the minimum margin threshold.</p>
                <Button size="sm" variant="outline" className="mt-2 text-xs" onClick={() => setActiveTab("products")}>
                  Review flagged products
                </Button>
              </CardContent>
            </Card>
          )}

          {summary.total > 0 && (
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={exportMarginReport}>
                <Download className="w-3.5 h-3.5 mr-1" /> Export margin report
              </Button>
            </div>
          )}
        </TabsContent>

        {/* ── Products ── */}
        <TabsContent value="products">
          {loading ? (
            <Card className="border-dashed"><CardContent className="p-8 text-center text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading…
            </CardContent></Card>
          ) : summary.total === 0 ? emptyMessage : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground px-1 mb-2 flex-wrap gap-2">
                <span>{summary.total} products</span>
                <div className="flex items-center gap-2 flex-wrap">
                  <span>{summary.safe} safe · {summary.warning} warning · {summary.blocked} blocked</span>
                  <Button size="sm" variant="outline" onClick={exportMarginReport} className="h-7 text-xs">
                    <Download className="w-3 h-3 mr-1" /> Margin report
                  </Button>
                  {summary.blocked > 0 && (
                    <Button size="sm" variant="outline" onClick={exportPriceFloor} className="h-7 text-xs">
                      <Download className="w-3 h-3 mr-1" /> Price floor
                    </Button>
                  )}
                </div>
              </div>
              {summary.results.map((r, i) => {
                const meta = findProductMeta(r.handle);
                return (
                  <div key={i} className={`p-3 rounded-lg border ${r.status === "blocked" ? "border-destructive/30 bg-destructive/5" : r.status === "warning" ? "border-warning/30 bg-warning/5" : "border-border"}`}>
                    <div className="flex items-center gap-3">
                      {statusIcon(r.status)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{r.title}</p>
                        {meta?.sku && <p className="text-[10px] text-muted-foreground font-mono">SKU: {meta.sku}</p>}
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
                          <span>Cost: {r.cost !== null ? `$${r.cost.toFixed(2)}` : "—"}</span>
                          <span>RRP: ${r.price.toFixed(2)}</span>
                          <span className={marginStatusColor(r.status)}>
                            Margin: {r.margin_percentage !== null ? `${r.margin_percentage.toFixed(1)}%` : "—"}
                          </span>
                        </div>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${marginStatusBg(r.status)} ${marginStatusColor(r.status)}`}>
                        {r.status}
                      </span>
                    </div>
                    {r.status === "blocked" && r.cost && (
                      <div className="mt-2 ml-7 text-xs text-destructive">
                        Min price at {settings.globalMinMargin}% margin: <span className="font-semibold">${minPriceFor(r.cost).toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Settings ── */}
        <TabsContent value="settings">
          <div className="space-y-6">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Protection Mode</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Strict Mode</p>
                    <p className="text-xs text-muted-foreground">Block pricing below minimum margin</p>
                  </div>
                  <Switch checked={settings.mode === "strict"} onCheckedChange={v => updateSetting("mode", v ? "strict" : "relaxed")} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Margin Thresholds</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Minimum margin (%)</Label>
                  <Input type="number" value={settings.globalMinMargin} onChange={e => updateSetting("globalMinMargin", Number(e.target.value))} min={0} max={90} />
                  <p className="text-[10px] text-muted-foreground mt-1">Products below this margin will be blocked (strict) or warned (relaxed)</p>
                </div>
                <div>
                  <Label>Warning threshold (%)</Label>
                  <Input type="number" value={settings.warningThreshold} onChange={e => updateSetting("warningThreshold", Number(e.target.value))} min={0} max={95} />
                  <p className="text-[10px] text-muted-foreground mt-1">Products below this but above minimum show a yellow warning</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Google Shopping</CardTitle></CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Show discount code warnings</p>
                    <p className="text-xs text-muted-foreground">Warn when using discount codes instead of sale prices</p>
                  </div>
                  <Switch checked={settings.enableGoogleShoppingWarnings} onCheckedChange={v => updateSetting("enableGoogleShoppingWarnings", v)} />
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Audit Log ── */}
        <TabsContent value="audit">
          {auditLog.length === 0 ? (
            <Card className="border-dashed"><CardContent className="p-8 text-center text-muted-foreground text-sm">
              No margin actions logged yet. Pricing changes will appear here.
            </CardContent></Card>
          ) : (
            <div className="space-y-2">
              {auditLog.map((entry, i) => (
                <div key={i} className="flex items-start gap-3 p-3 border rounded-lg text-xs">
                  <TrendingUp className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{entry.product}</p>
                    <p className="text-muted-foreground">
                      ${entry.oldPrice?.toFixed(2)} → ${entry.newPrice?.toFixed(2)}
                      {entry.marginBefore !== null && entry.marginAfter !== null && (
                        <> · Margin: {entry.marginBefore?.toFixed(1)}% → {entry.marginAfter?.toFixed(1)}%</>
                      )}
                    </p>
                    <p className="text-muted-foreground">{entry.source} · {new Date(entry.timestamp).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
