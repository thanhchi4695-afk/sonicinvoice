import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from "@/components/ui/dialog";
import {
  Check, X, Loader2, ShoppingBag, Rocket, AlertTriangle,
  ArrowRight, ArrowLeft, Globe, DollarSign, TrendingUp,
  ExternalLink, Package, Zap, BarChart3, CheckCircle2
} from "lucide-react";
import { BatchProduct } from "@/components/BatchReviewScreen";
import { PushProduct, getConnection, pushProductGraphQL, recordPush } from "@/lib/shopify-api";
import { generateGoogleFeedXML } from "@/lib/google-feed";
import { validateForExport } from "@/lib/shopify-csv-schema";

/* ─── types ─── */
interface Props {
  products: BatchProduct[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = "confirm" | "publish" | "google" | "ads" | "success";

interface PushResultItem {
  title: string;
  status: "pending" | "pushing" | "success" | "error";
  error?: string;
}

/* ─── step indicator ─── */
const STEPS: { key: Step; label: string; icon: React.ElementType }[] = [
  { key: "confirm", label: "Confirm", icon: Package },
  { key: "publish", label: "Publish", icon: ShoppingBag },
  { key: "google", label: "Google", icon: Globe },
  { key: "ads", label: "Ads", icon: TrendingUp },
  { key: "success", label: "Done", icon: CheckCircle2 },
];

const PublishAdsPipeline = ({ products, open, onOpenChange }: Props) => {
  const [step, setStep] = useState<Step>("confirm");
  const [pushing, setPushing] = useState(false);
  const [pushResults, setPushResults] = useState<PushResultItem[]>([]);
  const [pushDone, setPushDone] = useState(false);
  const [enableAds, setEnableAds] = useState(false);
  const [dailyBudget, setDailyBudget] = useState("30");
  const [adsLocation, setAdsLocation] = useState("Australia");
  const [feedGenerated, setFeedGenerated] = useState(false);

  const readyProducts = useMemo(
    () => products.filter((p) => validateForExport(p).valid),
    [products]
  );

  const stats = useMemo(() => {
    const totalQty = readyProducts.reduce((s, p) => s + (p.quantity || 0), 0);
    const avgPrice =
      readyProducts.length > 0
        ? readyProducts.reduce((s, p) => s + p.price, 0) / readyProducts.length
        : 0;
    const warnings = products.length - readyProducts.length;
    return { totalQty, avgPrice, warnings };
  }, [products, readyProducts]);

  const pushStats = useMemo(() => {
    const success = pushResults.filter((r) => r.status === "success").length;
    const errors = pushResults.filter((r) => r.status === "error").length;
    const total = pushResults.length;
    const progress = total > 0 ? ((success + errors) / total) * 100 : 0;
    return { success, errors, total, progress };
  }, [pushResults]);

  const stepIdx = STEPS.findIndex((s) => s.key === step);

  /* ─── Shopify push ─── */
  const handlePublish = useCallback(async () => {
    setPushing(true);
    setPushDone(false);

    const conn = await getConnection();
    if (!conn) {
      setPushResults([{ title: "Connection Error", status: "error", error: "No Shopify connection found" }]);
      setPushing(false);
      setPushDone(true);
      return;
    }

    const items: PushResultItem[] = readyProducts.map((p) => ({
      title: p.title,
      status: "pending" as const,
    }));
    setPushResults([...items]);

    for (let i = 0; i < readyProducts.length; i++) {
      items[i].status = "pushing";
      setPushResults([...items]);

      try {
        const p = readyProducts[i];
        const pushProduct: PushProduct = {
          title: p.title,
          body_html: p.description || "",
          vendor: p.vendor,
          product_type: p.type,
          status: "active",
          tags: p.tags,
          variants: [
            {
              price: String(p.price),
              sku: p.sku || "",
              inventory_management: "shopify",
              inventory_quantity: p.quantity || 0,
            },
          ],
        };
        if (p.imageUrl) pushProduct.images = [{ src: p.imageUrl }];
        await pushProductGraphQL(pushProduct);
        items[i].status = "success";
      } catch (err) {
        items[i] = {
          title: items[i].title,
          status: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
      setPushResults([...items]);
      if (i < readyProducts.length - 1) await new Promise((r) => setTimeout(r, 400));
    }

    const success = items.filter((r) => r.status === "success").length;
    const errors = items.filter((r) => r.status === "error").length;
    try {
      await recordPush({
        products_created: success,
        products_updated: 0,
        errors,
        store_url: conn.store_url,
        source: "publish-pipeline",
        summary: `Pipeline push: ${success} created, ${errors} errors`,
      });
    } catch {}

    setPushing(false);
    setPushDone(true);
  }, [readyProducts]);

  /* ─── Google feed generation ─── */
  const handleGenerateFeed = useCallback(() => {
    const feedProducts = readyProducts.map((p) => ({
      name: p.title,
      brand: p.vendor,
      type: p.type,
      price: p.price,
      rrp: p.price,
      tags: p.tags,
      description: p.description,
      colour: p.colour,
      sku: p.sku,
      barcode: p.barcode,
    }));
    const xml = generateMerchantXML(feedProducts, "https://yourstore.myshopify.com");
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "google-shopping-feed.xml";
    a.click();
    URL.revokeObjectURL(url);
    setFeedGenerated(true);
  }, [readyProducts]);

  /* ─── reset on close ─── */
  const handleOpenChange = (o: boolean) => {
    if (!o) {
      setStep("confirm");
      setPushResults([]);
      setPushDone(false);
      setPushing(false);
      setFeedGenerated(false);
    }
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto p-0">
        {/* Step indicator */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b border-border">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const isActive = i === stepIdx;
            const isDone = i < stepIdx;
            return (
              <div key={s.key} className="flex items-center gap-1">
                <div
                  className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold transition-colors ${
                    isDone
                      ? "bg-primary text-primary-foreground"
                      : isActive
                      ? "bg-primary/20 text-primary ring-2 ring-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {isDone ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                </div>
                <span className={`text-[10px] font-medium hidden sm:inline ${isActive ? "text-foreground" : "text-muted-foreground"}`}>
                  {s.label}
                </span>
                {i < STEPS.length - 1 && <ArrowRight className="w-3 h-3 text-muted-foreground mx-1" />}
              </div>
            );
          })}
        </div>

        <div className="p-4 space-y-4">
          {/* ── STEP 1: CONFIRM ── */}
          {step === "confirm" && (
            <>
              <DialogHeader className="p-0">
                <DialogTitle className="flex items-center gap-2">
                  <Package className="w-5 h-5 text-primary" /> Confirm Products
                </DialogTitle>
                <DialogDescription>Review your products before publishing to Shopify.</DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-primary/10 p-3 text-center">
                  <p className="text-2xl font-bold text-primary">{readyProducts.length}</p>
                  <p className="text-[10px] text-muted-foreground">Products</p>
                </div>
                <div className="rounded-lg bg-primary/10 p-3 text-center">
                  <p className="text-2xl font-bold text-primary">{stats.totalQty}</p>
                  <p className="text-[10px] text-muted-foreground">Total Qty</p>
                </div>
                <div className="rounded-lg bg-primary/10 p-3 text-center">
                  <p className="text-2xl font-bold text-primary">${stats.avgPrice.toFixed(0)}</p>
                  <p className="text-[10px] text-muted-foreground">Avg Price</p>
                </div>
              </div>

              {stats.warnings > 0 && (
                <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {stats.warnings} product{stats.warnings !== 1 ? "s" : ""} need fixes and will be skipped.
                </div>
              )}

              <div className="max-h-48 overflow-y-auto space-y-1 rounded-lg border border-border p-2">
                {readyProducts.map((p, i) => (
                  <div key={p.id} className="flex items-center justify-between text-xs py-1 px-2 rounded hover:bg-muted/50">
                    <span className="truncate flex-1">{p.title}</span>
                    <span className="text-muted-foreground shrink-0 ml-2">${p.price}</span>
                  </div>
                ))}
              </div>

              <Button className="w-full" onClick={() => setStep("publish")} disabled={readyProducts.length === 0}>
                Continue to Publish <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </>
          )}

          {/* ── STEP 2: PUBLISH ── */}
          {step === "publish" && (
            <>
              <DialogHeader className="p-0">
                <DialogTitle className="flex items-center gap-2">
                  <ShoppingBag className="w-5 h-5 text-primary" /> Publish to Shopify
                </DialogTitle>
                <DialogDescription>
                  Push {readyProducts.length} products as <strong>active</strong> listings with inventory tracking.
                </DialogDescription>
              </DialogHeader>

              {!pushDone && !pushing && (
                <Button className="w-full" onClick={handlePublish}>
                  <Rocket className="w-4 h-4 mr-2" /> Start Publishing
                </Button>
              )}

              {(pushing || pushDone) && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span>{pushing ? "Publishing…" : "Complete"}</span>
                    <span className="font-mono text-xs">{pushStats.success + pushStats.errors}/{pushStats.total}</span>
                  </div>
                  <Progress value={pushStats.progress} className="h-2" />

                  <div className="max-h-40 overflow-y-auto space-y-1 rounded-lg border border-border p-2">
                    {pushResults.map((r, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs py-1">
                        {r.status === "success" && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                        {r.status === "error" && <X className="w-3.5 h-3.5 text-destructive shrink-0" />}
                        {r.status === "pushing" && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />}
                        {r.status === "pending" && <div className="w-3.5 h-3.5 rounded-full bg-muted shrink-0" />}
                        <span className="truncate">{r.title}</span>
                        {r.error && <span className="text-destructive ml-auto text-[10px] shrink-0">{r.error}</span>}
                      </div>
                    ))}
                  </div>

                  {pushDone && pushStats.errors > 0 && (
                    <Button variant="outline" size="sm" className="w-full" onClick={handlePublish}>
                      Retry Failed Items
                    </Button>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setStep("confirm")} disabled={pushing}>
                  <ArrowLeft className="w-4 h-4 mr-1" /> Back
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => setStep("google")}
                  disabled={!pushDone || pushStats.success === 0}
                >
                  Continue to Google <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </>
          )}

          {/* ── STEP 3: GOOGLE CHANNEL ── */}
          {step === "google" && (
            <>
              <DialogHeader className="p-0">
                <DialogTitle className="flex items-center gap-2">
                  <Globe className="w-5 h-5 text-primary" /> Google Shopping Feed
                </DialogTitle>
                <DialogDescription>
                  Generate a Merchant Center-ready feed for your {pushStats.success} published products.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <div className="rounded-lg bg-muted/50 p-3 space-y-2">
                  <h4 className="text-xs font-semibold">Feed includes:</h4>
                  {["Title & description", "Price & availability", "Brand & category", "SKU & barcode (GTIN)"].map((item) => (
                    <div key={item} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Check className="w-3 h-3 text-primary" /> {item}
                    </div>
                  ))}
                </div>

                <Button className="w-full" onClick={handleGenerateFeed} disabled={feedGenerated}>
                  {feedGenerated ? (
                    <>
                      <Check className="w-4 h-4 mr-2" /> Feed Downloaded
                    </>
                  ) : (
                    <>
                      <Globe className="w-4 h-4 mr-2" /> Generate & Download Feed
                    </>
                  )}
                </Button>
              </div>

              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setStep("publish")}>
                  <ArrowLeft className="w-4 h-4 mr-1" /> Back
                </Button>
                <Button className="flex-1" onClick={() => setStep("ads")}>
                  Continue to Ads <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </>
          )}

          {/* ── STEP 4: ADS ── */}
          {step === "ads" && (
            <>
              <DialogHeader className="p-0">
                <DialogTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-primary" /> Google Ads Setup
                </DialogTitle>
                <DialogDescription>Optionally configure a Shopping campaign for your products.</DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
                  <div>
                    <p className="text-sm font-medium">Enable Google Shopping Ads</p>
                    <p className="text-[10px] text-muted-foreground">Create a basic campaign for your products</p>
                  </div>
                  <Switch checked={enableAds} onCheckedChange={setEnableAds} />
                </div>

                {enableAds && (
                  <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Daily Budget ($)</label>
                      <Input
                        type="number"
                        value={dailyBudget}
                        onChange={(e) => setDailyBudget(e.target.value)}
                        className="mt-1"
                        min={5}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Target Location</label>
                      <Input
                        value={adsLocation}
                        onChange={(e) => setAdsLocation(e.target.value)}
                        className="mt-1"
                      />
                    </div>

                    <div className="rounded-lg border border-border p-3 space-y-2">
                      <h4 className="text-xs font-semibold flex items-center gap-1.5">
                        <BarChart3 className="w-3.5 h-3.5 text-primary" /> Estimated Performance
                      </h4>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div>
                          <p className="text-lg font-bold text-primary">
                            {Math.round(parseFloat(dailyBudget || "0") * 15)}
                          </p>
                          <p className="text-[9px] text-muted-foreground">Daily Impressions</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-primary">
                            {Math.round(parseFloat(dailyBudget || "0") * 1.5)}
                          </p>
                          <p className="text-[9px] text-muted-foreground">Est. Clicks/Day</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-primary">
                            ${(parseFloat(dailyBudget || "0") * 30).toFixed(0)}
                          </p>
                          <p className="text-[9px] text-muted-foreground">Monthly Spend</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setStep("google")}>
                  <ArrowLeft className="w-4 h-4 mr-1" /> Back
                </Button>
                <Button className="flex-1" onClick={() => setStep("success")}>
                  {enableAds ? "Launch" : "Finish"} <Rocket className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </>
          )}

          {/* ── STEP 5: SUCCESS ── */}
          {step === "success" && (
            <>
              <div className="text-center space-y-3 py-4">
                <div className="mx-auto w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center">
                  <Zap className="w-7 h-7 text-primary" />
                </div>
                <DialogHeader className="p-0">
                  <DialogTitle>All Done! 🎉</DialogTitle>
                  <DialogDescription>Your products are live and ready to sell.</DialogDescription>
                </DialogHeader>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-primary/10 p-3 text-center">
                  <p className="text-xl font-bold text-primary">{pushStats.success}</p>
                  <p className="text-[10px] text-muted-foreground">Published</p>
                </div>
                {feedGenerated && (
                  <div className="rounded-lg bg-primary/10 p-3 text-center">
                    <p className="text-xl font-bold text-primary">
                      <Check className="w-5 h-5 inline" />
                    </p>
                    <p className="text-[10px] text-muted-foreground">Feed Synced</p>
                  </div>
                )}
                {enableAds && (
                  <div className="rounded-lg bg-primary/10 p-3 text-center">
                    <p className="text-xl font-bold text-primary">${dailyBudget}/d</p>
                    <p className="text-[10px] text-muted-foreground">Ads Budget</p>
                  </div>
                )}
                {pushStats.errors > 0 && (
                  <div className="rounded-lg bg-destructive/10 p-3 text-center">
                    <p className="text-xl font-bold text-destructive">{pushStats.errors}</p>
                    <p className="text-[10px] text-muted-foreground">Errors</p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Button className="w-full" variant="outline" onClick={() => handleOpenChange(false)}>
                  <ShoppingBag className="w-4 h-4 mr-2" /> Add More Products
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PublishAdsPipeline;
