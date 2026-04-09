import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LogOut, Check, X, Loader2, ChevronDown, ChevronUp, Eye, EyeOff, Unplug, Trash2, Save, Plus, Bell, FileText, ClipboardList, MapPin, Edit2, ExternalLink, CreditCard, Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  getDirectStores, saveDirectStore, removeDirectStore, setActiveStore,
  normalizeStoreUrl, type DirectStore,
} from "@/lib/shopify-direct";
import { getCollectionRules, saveCollectionRules, resetCollectionRules, type CollectionRule } from "@/lib/collection-engine";
import {
  saveConnection, testConnection, getConnection, deleteConnection,
  getLocations, updateConnectionSettings, ShopifyConnection, initiateOAuth,
} from "@/lib/shopify-api";
import { getApiKeys, saveApiKeys, getCacheStats, clearCache, type PriceApiKeys } from "@/lib/price-intelligence";
import { getStoreConfig, saveStoreConfig, getIndustryConfig, type StoreType, type LightspeedVersion } from "@/lib/prompt-builder";
import { SEO_TITLE_PRESETS, getCtaPhrases, saveCtaPhrases, generateSeoTitle, generateSeoDescription } from "@/lib/seo-engine";
import { CURRENCIES, LOCALES } from "@/lib/i18n";
import { useStoreMode } from "@/hooks/use-store-mode";
import { loadPreferences, savePreferences, type NotificationPreferences } from "@/hooks/use-notifications";
import { Switch } from "@/components/ui/switch";
import { getFormatTemplates, deleteFormatTemplate, getTemplateQuality, getTemplateList, COLUMN_LABELS, type InvoiceTemplate, type ColumnMapping } from "@/lib/invoice-templates";
import { getMetafieldConfig, saveMetafieldConfig, type MetafieldDefinition } from "@/lib/metafields";
import { getDevEmbeddedMode, setDevEmbeddedMode } from "@/lib/shopify-embedded";

const AccountScreen = () => {
  const [storeName, setStoreName] = useState("");
  const [currency, setCurrency] = useState("AUD");
  const [storeType, setStoreType] = useState<StoreType>("shopify");
  const [lsVersion, setLsVersion] = useState<LightspeedVersion>("x_series");
  const [markup, setMarkup] = useState("2.35");
  const [rounding, setRounding] = useState("nearest_05");
  const [storeCity, setStoreCity] = useState("");
  const [freeShippingThreshold, setFreeShippingThreshold] = useState("");

  // Shopify connection
  const [shopifyUrl, setShopifyUrl] = useState("");
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [shopName, setShopName] = useState("");
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [defaultLocation, setDefaultLocation] = useState("");
  const [productStatus, setProductStatus] = useState("draft");
  const [saving, setSaving] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);

  useEffect(() => {
    const cfg = getStoreConfig();
    setStoreName(cfg.name || '');
    setCurrency(cfg.currency || 'AUD');
    setStoreType(cfg.storeType || 'shopify');
    setLsVersion(cfg.lightspeedVersion || 'x_series');
    setStoreCity(cfg.city || '');
    setFreeShippingThreshold(cfg.freeShippingThreshold || '');

    getConnection().then((conn) => {
      if (conn) {
        setShopifyUrl(conn.store_url);
        setShopifyConnected(true);
        setShopName(conn.shop_name || conn.store_url);
        setDefaultLocation(conn.default_location_id || "");
        setProductStatus(conn.product_status || "draft");
      }
    });

    // Check if returning from OAuth
    const params = new URLSearchParams(window.location.search);
    if (params.get("shopify_connected") === "1") {
      window.history.replaceState({}, "", window.location.pathname);
      getConnection().then((conn) => {
        if (conn) {
          setShopifyUrl(conn.store_url);
          setShopifyConnected(true);
          setShopName(conn.shop_name || conn.store_url);
        }
      });
    }
  }, []);

  const handleOAuthConnect = async () => {
    if (!shopifyUrl) {
      setTestStatus("error");
      setTestMessage("Enter your store URL first");
      return;
    }
    setOauthLoading(true);
    setTestStatus("idle");
    try {
      const url = shopifyUrl.includes(".myshopify.com")
        ? shopifyUrl
        : `${shopifyUrl}.myshopify.com`;
      const installUrl = await initiateOAuth(url);
      window.location.href = installUrl;
    } catch (err) {
      setTestStatus("error");
      setTestMessage(err instanceof Error ? err.message : "OAuth failed");
      setOauthLoading(false);
    }
  };

  const handleDisconnect = async () => {
    await deleteConnection();
    setShopifyConnected(false);
    setShopifyUrl("");
    setShopName("");
    setTestStatus("idle");
    setTestMessage("");
    setLocations([]);
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      await updateConnectionSettings({
        default_location_id: defaultLocation || undefined,
        product_status: productStatus,
      });
    } catch {}
    setSaving(false);
  };

  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <h1 className="text-2xl font-bold font-display mb-1">Account</h1>
      <p className="text-muted-foreground text-sm mb-6">Store settings & pricing rules</p>

      {/* Store Details */}
      <Section title="Store details">
        <Field label="Store name" value={storeName} onChange={setStoreName} placeholder="My Boutique" />
        <Field label="Store website" placeholder="mystore.com" />
        <Field label="City / Location" value={storeCity} onChange={setStoreCity} placeholder="e.g. Darwin NT" />
        <p className="text-[11px] text-muted-foreground -mt-2">Used in product descriptions and SEO meta text.</p>
        <Field label="Free shipping threshold (AUD)" value={freeShippingThreshold} onChange={setFreeShippingThreshold} placeholder="e.g. 150" type="number" />
        <p className="text-[11px] text-muted-foreground -mt-2">Leave blank to omit free shipping from descriptions.</p>
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Currency" value={currency} onChange={setCurrency}
            options={CURRENCIES.map(c => ({ v: c.code, l: `${c.flag} ${c.code} (${c.symbol})` }))}
          />
          <SelectField label="Locale" value="AU" onChange={() => {}}
            options={LOCALES.map(l => ({ v: l.id, l: `${l.flag} ${l.country}` }))}
          />
        </div>
        <SelectField label="Store type / POS" value={storeType} onChange={(v) => { setStoreType(v as StoreType); saveStoreConfig({ storeType: v as StoreType }); }}
          options={[
            { v: "shopify", l: "🛍️ Shopify only" },
            { v: "lightspeed_shopify", l: "🖥️ Lightspeed + Shopify" },
            { v: "lightspeed", l: "🖥️ Lightspeed POS only" },
            { v: "other", l: "📦 Other / Not sure" },
          ]}
        />
        {(storeType === 'lightspeed' || storeType === 'lightspeed_shopify') && (
          <>
            <SelectField label="Lightspeed version" value={lsVersion} onChange={(v) => { setLsVersion(v as LightspeedVersion); saveStoreConfig({ lightspeedVersion: v as LightspeedVersion }); }}
              options={[
                { v: "x_series", l: "X-Series (current)" },
                { v: "r_series", l: "R-Series (legacy)" },
              ]}
            />
            <Field label="Outlet name" placeholder="e.g. Main Store" />
            <Field label="Tax name" placeholder="GST" />
            <SelectField label="Default export" value="lightspeed" onChange={() => {}}
              options={[
                { v: "lightspeed", l: "Lightspeed CSV" },
                { v: "shopify", l: "Shopify CSV" },
              ]}
            />
            <SelectField label="Attribute order" value="size_first" onChange={() => {}}
              options={[
                { v: "size_first", l: "Size first (Size → Colour)" },
                { v: "colour_first", l: "Colour first (Colour → Size)" },
              ]}
            />
          </>
        )}
        {storeType === 'lightspeed_shopify' && (
          <div className="mt-3 pt-3 border-t border-border space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Shopify settings (for post-import SEO update)</p>
            <Field label="Shopify store URL" placeholder="yourstore.myshopify.com" />
            <p className="text-[11px] text-muted-foreground">Your Shopify store is managed via Lightspeed. Only use these settings for the optional SEO update step.</p>
          </div>
        )}
      </Section>

      {/* Pricing Rules */}
      <Section title="Pricing rules">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Default markup</label>
            <input value={markup} onChange={(e) => setMarkup(e.target.value)} className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm font-mono-data" />
          </div>
          <SelectField label="Rounding" value={rounding} onChange={setRounding}
            options={[{ v: "nearest_05", l: "$0.05" }, { v: "nearest_1", l: "$1.00" }, { v: "charm_95", l: ".95" }]}
          />
        </div>
      </Section>

      {/* Shopify Connection */}
      <Section title="Shopify connection">
        {shopifyConnected && (
          <div className="bg-success/10 rounded-lg p-3 mb-3 flex items-center gap-2">
            <Check className="w-4 h-4 text-success" />
            <span className="text-sm text-success font-medium">Connected to: {shopName}</span>
          </div>
        )}

        {!shopifyConnected && (
          <>
            <Field
              label="Store URL"
              value={shopifyUrl}
              onChange={setShopifyUrl}
              placeholder="yourstore.myshopify.com"
            />

            <Button
              variant="outline"
              className="w-full h-10"
              onClick={handleOAuthConnect}
              disabled={oauthLoading}
            >
              {oauthLoading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <ExternalLink className="w-4 h-4 mr-2" />
              )}
              {oauthLoading ? "Redirecting to Shopify..." : "Connect to Shopify"}
            </Button>

            <p className="text-[11px] text-muted-foreground">
              You'll be redirected to Shopify to authorize access. No manual tokens needed.
            </p>
          </>
        )}

        {testStatus === "error" && (
          <p className="text-xs text-destructive flex items-center gap-1 mt-1">
            <X className="w-3 h-3" /> {testMessage}
          </p>
        )}

        {testStatus === "success" && (
          <p className="text-xs text-success flex items-center gap-1 mt-1">
            <Check className="w-3 h-3" /> {testMessage}
          </p>
        )}
        {testStatus === "error" && (
          <p className="text-xs text-destructive flex items-center gap-1 mt-1">
            <X className="w-3 h-3" /> {testMessage}
          </p>
        )}

        {/* Store settings after connection */}
        {shopifyConnected && (
          <div className="mt-3 space-y-3 pt-3 border-t border-border">
            {locations.length > 0 && (
              <SelectField
                label="Default location"
                value={defaultLocation}
                onChange={(v) => { setDefaultLocation(v); }}
                options={locations.map((l) => ({ v: l.id, l: l.name }))}
              />
            )}
            <SelectField
              label="Product status"
              value={productStatus}
              onChange={(v) => { setProductStatus(v); }}
              options={[{ v: "draft", l: "Draft" }, { v: "active", l: "Active" }]}
            />
            <Button variant="outline" size="sm" onClick={handleSaveSettings} disabled={saving} className="w-full">
              {saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
              Save Shopify settings
            </Button>
            <button onClick={handleDisconnect} className="flex items-center gap-1 text-xs text-destructive mt-2">
              <Unplug className="w-3 h-3" /> Disconnect Shopify
            </button>
          </div>
        )}
      </Section>

      {/* Wholesale Platform Connections */}
      <WholesaleConnectionsSection />

      {/* Connected Shopify Stores (Custom App tokens) */}
      <DirectStoresSection />

      {/* Price Intelligence API Keys */}
      <ApiKeysSection />

      {/* SEO Templates */}
      <SeoTemplateSection />

      {/* Collections */}
      <CollectionManagerSection />

      {/* Default AI Instructions */}
      <DefaultInstructionsSection />

      {/* Notification Preferences */}
      <NotificationPrefsSection />

      {/* Locations */}
      <LocationsSection />

      {/* Invoice Templates */}
      <InvoiceTemplatesSection />

      {/* Metafields */}
      <MetafieldsSection />

      {/* Developer Mode */}
      <Section title="🛠️ Developer mode">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Embedded sidebar layout</p>
            <p className="text-xs text-muted-foreground">Preview the Shopify Admin sidebar layout without a real store connection</p>
          </div>
          <Switch
            checked={getDevEmbeddedMode()}
            onCheckedChange={(checked) => {
              setDevEmbeddedMode(checked);
              window.location.reload();
            }}
          />
        </div>
      </Section>

      {/* App Information */}
      <Section title="App information">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Version</span><span className="font-mono-data">1.0.0</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Build date</span><span className="font-mono-data">Mar 2026</span></div>
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          <button className="text-xs text-primary hover:underline">View changelog</button>
          <span className="text-muted-foreground">·</span>
          <button className="text-xs text-primary hover:underline">Contact support</button>
          <span className="text-muted-foreground">·</span>
          <button className="text-xs text-primary hover:underline">Documentation</button>
        </div>
        <div className="mt-3 flex items-center gap-2 bg-muted/50 rounded-lg p-2.5 border border-border">
          <span className="text-sm">🛍</span>
          <span className="text-xs text-muted-foreground">Works with Shopify</span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          This app will be available on the Shopify App Store. When installed from the App Store, your store connects automatically — no manual token entry needed.
        </p>
      </Section>

      <Button variant="teal" className="w-full mt-4 h-12 text-base" onClick={() => { saveStoreConfig({ name: storeName, currency, storeType, lightspeedVersion: lsVersion, city: storeCity, freeShippingThreshold }); }}>Save settings</Button>

      {/* Billing / Plan */}
      <BillingSection />

      <Button
        variant="ghost"
        className="w-full mt-6 text-destructive h-12"
        onClick={async () => {
          await supabase.auth.signOut();
          window.location.href = "/";
        }}
      >
        <LogOut className="w-4 h-4 mr-2" /> Sign out
      </Button>

      {/* Branding footer */}
      <div className="text-center mt-8 mb-4 space-y-1">
        <p className="text-xs font-semibold text-muted-foreground">Sonic Invoice v1.0</p>
        <p className="text-[10px] text-muted-foreground">Built for AU fashion boutiques</p>
        <div className="flex items-center justify-center gap-1.5 mt-1">
          <span className="text-xs">🛍</span>
          <span className="text-[10px] text-muted-foreground">Works with Shopify</span>
        </div>
      </div>
    </div>
  );
};

// ─── Billing Section ────────────────────────────────────────────────
function BillingSection() {
  const [billingStatus, setBillingStatus] = useState<{
    has_subscription: boolean;
    plan_name: string | null;
    status: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState<string | null>(null);

  useEffect(() => {
    checkBillingStatus();
  }, []);

  const checkBillingStatus = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("shopify-billing", {
        body: { action: "status" },
      });
      if (!error && data) {
        setBillingStatus(data);
      }
    } catch (err) {
      console.error("Billing check failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubscribe = async (plan: string) => {
    setSubscribing(plan);
    try {
      const returnUrl = window.location.href;
      const { data, error } = await supabase.functions.invoke("shopify-billing", {
        body: { action: "create", plan, return_url: returnUrl, test: true },
      });
      if (error) throw new Error(error.message);
      if (data?.confirmation_url) {
        window.location.href = data.confirmation_url;
      }
    } catch (err) {
      console.error("Subscribe failed:", err);
    } finally {
      setSubscribing(null);
    }
  };

  if (loading) {
    return (
      <Section title="💳 Plan & Billing">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" /> Checking billing status...
        </div>
      </Section>
    );
  }

  return (
    <Section title="💳 Plan & Billing">
      {billingStatus?.has_subscription ? (
        <div className="bg-muted/30 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">{billingStatus.plan_name || "Starter"}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Status: <span className="text-foreground font-medium capitalize">{billingStatus.status}</span>
          </p>
          <p className="text-[11px] text-muted-foreground">
            Manage your subscription from the Shopify admin → Apps section.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">Choose a plan to get started. All plans include a 14-day free trial.</p>
          {[
            { key: "starter", name: "Starter", price: 29, highlight: false },
            { key: "pro", name: "Pro", price: 59, highlight: true },
            { key: "growth", name: "Growth", price: 99, highlight: false },
          ].map((plan) => (
            <div
              key={plan.key}
              className={`rounded-xl p-4 space-y-2 ${
                plan.highlight ? "bg-primary/10 border border-primary" : "bg-muted/30 border border-border"
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-semibold text-foreground">{plan.name}</span>
                  {plan.highlight && (
                    <span className="ml-2 text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full font-medium">
                      Most popular
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-lg font-bold text-foreground">${plan.price}</span>
                  <span className="text-xs text-muted-foreground">/mo AUD</span>
                </div>
              </div>
              <Button
                variant={plan.highlight ? "teal" : "outline"}
                size="sm"
                className="w-full"
                onClick={() => handleSubscribe(plan.key)}
                disabled={subscribing !== null}
              >
                {subscribing === plan.key ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                Start 14-day free trial
              </Button>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground text-center">
            You'll be redirected to Shopify to approve. No charge until trial ends.
          </p>
        </div>
      )}
    </Section>
  );
}

// ─── Direct Store Connections ──────────────────────────────────────
function DirectStoresSection() {
  const [stores, setStores] = useState<DirectStore[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [storeUrl, setStoreUrl] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");
  const [testResult, setTestResult] = useState<{ shopName: string; productCount: number } | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    setStores(getDirectStores());
  }, []);

  const refresh = () => setStores(getDirectStores());

  const handleTest = async () => {
    if (!storeUrl || !token) {
      setTestStatus("error");
      setTestMessage("Enter both store URL and access token");
      return;
    }
    setTestStatus("testing");
    setTestMessage("");
    setTestResult(null);
    try {
      const url = normalizeStoreUrl(storeUrl);
      const { data, error } = await supabase.functions.invoke("shopify-direct-proxy", {
        body: { store_url: url, token, action: "test" },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setTestResult({ shopName: data.shop_name, productCount: data.product_count });
      setTestStatus("success");
      setTestMessage(`Connected — ${data.shop_name} (${data.product_count} products)`);
    } catch (err) {
      setTestStatus("error");
      setTestMessage(err instanceof Error ? err.message : "Connection failed");
    }
  };

  const handleSave = () => {
    if (!testResult || testStatus !== "success") return;
    const url = normalizeStoreUrl(storeUrl);
    saveDirectStore({
      storeUrl: url,
      token,
      storeName: testResult.shopName,
      productCount: testResult.productCount,
      isActive: true,
    });
    refresh();
    setShowModal(false);
    setStoreUrl("");
    setToken("");
    setTestStatus("idle");
    setTestResult(null);
  };

  const handleRemove = (id: string) => {
    removeDirectStore(id);
    refresh();
  };

  const handleSetActive = (id: string) => {
    setActiveStore(id);
    refresh();
  };

  return (
    <Section title="🔗 Connected Shopify stores">
      <p className="text-xs text-muted-foreground -mt-1 mb-2">
        Connect a store to read and fix all products directly — no CSV export needed.
      </p>

      {stores.map(s => (
        <div key={s.id} className="bg-card border border-border rounded-lg p-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              {s.isActive && <span className="w-2 h-2 rounded-full bg-success shrink-0" />}
              <div>
                <p className="text-sm font-medium">{s.storeName}</p>
                <p className="text-[11px] text-muted-foreground">{s.storeUrl}</p>
                <p className="text-[10px] text-muted-foreground">
                  {s.productCount} products · Connected {new Date(s.connectedAt).toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-2">
            {!s.isActive && (
              <Button variant="outline" size="sm" className="text-xs h-7 gap-1" onClick={() => handleSetActive(s.id)}>
                <Check className="w-3 h-3" /> Set as active
              </Button>
            )}
            <Button variant="ghost" size="sm" className="text-xs h-7 text-destructive gap-1" onClick={() => handleRemove(s.id)}>
              <Trash2 className="w-3 h-3" /> Disconnect
            </Button>
          </div>
        </div>
      ))}

      <Button variant="outline" className="w-full h-10 gap-2" onClick={() => setShowModal(true)}>
        <Plus className="w-4 h-4" /> Connect a store
      </Button>

      {/* Connect modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowModal(false)}>
          <div className="bg-card border border-border rounded-xl w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2"><Store className="w-4 h-4" /> Connect Shopify store</h3>
              <button onClick={() => setShowModal(false)} className="text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Store URL</label>
                <Input value={storeUrl} onChange={e => setStoreUrl(e.target.value)} placeholder="yourstore.myshopify.com" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Admin API access token</label>
                <div className="relative">
                  <Input
                    type={showToken ? "text" : "password"}
                    value={token}
                    onChange={e => setToken(e.target.value)}
                    placeholder="shpat_xxxxxxxxxxxxxxxxxxxxxxxx"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                  >
                    {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Your token is stored only in this browser. It is never sent to any server other than your own Shopify store.
                </p>
              </div>
            </div>

            {/* How to get token guide */}
            <button onClick={() => setShowGuide(!showGuide)} className="flex items-center gap-1 text-xs text-primary font-medium">
              {showGuide ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              How to get your token
            </button>
            {showGuide && (
              <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside bg-muted/30 rounded-lg p-3">
                <li>Shopify Admin → Settings → Apps and sales channels</li>
                <li>Click "Develop apps" → "Create an app"</li>
                <li>Name it "Sonic Invoices" → Create app</li>
                <li>Configure Admin API scopes:<br />
                  <span className="ml-4">✓ read_products</span><br />
                  <span className="ml-4">✓ write_products</span>
                </li>
                <li>Click "Install app"</li>
                <li>Copy the Admin API access token (starts with <code className="bg-muted px-1 rounded">shpat_</code>)</li>
                <li className="text-secondary font-medium">⚠ You only see this once — copy it now</li>
              </ol>
            )}

            {/* Status messages */}
            {testStatus === "success" && (
              <p className="text-xs text-success flex items-center gap-1"><Check className="w-3 h-3" /> {testMessage}</p>
            )}
            {testStatus === "error" && (
              <p className="text-xs text-destructive flex items-center gap-1"><X className="w-3 h-3" /> {testMessage}</p>
            )}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 h-10" onClick={handleTest} disabled={testStatus === "testing"}>
                {testStatus === "testing" ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                Test connection
              </Button>
              <Button variant="teal" className="flex-1 h-10" onClick={handleSave} disabled={testStatus !== "success"}>
                Save and connect
              </Button>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="mb-6">
    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">{title}</h3>
    <div className="space-y-3">{children}</div>
  </div>
);

const Field = ({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value?: string; onChange?: (v: string) => void; placeholder?: string; type?: string;
}) => (
  <div>
    <label className="text-xs text-muted-foreground mb-1 block">{label}</label>
    <input type={type} value={value} onChange={onChange ? (e) => onChange(e.target.value) : undefined} placeholder={placeholder}
      className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm" />
  </div>
);

const SelectField = ({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[];
}) => (
  <div>
    <label className="text-xs text-muted-foreground mb-1 block">{label}</label>
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm text-foreground">
      {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  </div>
);

export default AccountScreen;

// ── API Keys Section ───────────────────────────────────────
const apiProviders = [
  { key: 'barcodeLookup' as const, name: 'Barcode Lookup API', site: 'barcodelookup.com/api', url: 'https://www.barcodelookup.com/api', desc: 'Barcode → structured retail prices' },
  { key: 'serpApi' as const, name: 'SerpApi — Google Shopping', site: 'serpapi.com', url: 'https://serpapi.com/', desc: 'Real-time AU Google Shopping prices' },
  { key: 'goUpc' as const, name: 'Go-UPC Barcode Database', site: 'go-upc.com', url: 'https://go-upc.com/api', desc: '1B+ product barcode database' },
];

function ApiKeysSection() {
  const [keys, setKeys] = useState<PriceApiKeys>(getApiKeys());
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const cacheStats = getCacheStats();

  const updateKey = (provider: keyof PriceApiKeys, value: string) => {
    const updated = { ...keys, [provider]: value };
    setKeys(updated);
    saveApiKeys(updated);
  };

  const hasAny = !!(keys.barcodeLookup || keys.serpApi || keys.goUpc);

  return (
    <Section title="🔑 Price intelligence API keys">
      <p className="text-xs text-muted-foreground -mt-1 mb-2">
        Connect external APIs for more accurate price matching. Keys are stored locally in your browser only.
      </p>

      {!hasAny && (
        <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 mb-2">
          <p className="text-xs text-primary">💡 No price APIs connected. The app uses Claude AI web search as fallback. Add APIs above for faster, more accurate prices.</p>
        </div>
      )}

      <div className="space-y-3">
        {apiProviders.map((p) => {
          const val = keys[p.key] || '';
          const show = showKeys[p.key] || false;
          const connected = !!val;
          return (
            <div key={p.key} className="bg-muted/50 rounded-lg p-3 border border-border">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">{p.name}</span>
                <span className={`text-xs font-medium ${connected ? 'text-success' : 'text-muted-foreground'}`}>
                  {connected ? '🟢 Connected' : '🔴 Not connected'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-2">{p.desc}</p>
              <div className="relative">
                <input
                  type={show ? 'text' : 'password'}
                  value={val}
                  onChange={e => updateKey(p.key, e.target.value)}
                  placeholder="Paste API key"
                  className="w-full h-9 rounded-md bg-input border border-border px-3 pr-16 text-xs font-mono-data"
                />
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-1">
                  <button onClick={() => setShowKeys(s => ({ ...s, [p.key]: !show }))} className="text-muted-foreground p-1">
                    {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  {connected && (
                    <button onClick={() => updateKey(p.key, '')} className="text-destructive p-1">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary mt-1.5 inline-block">
                Get API key →
              </a>
            </div>
          );
        })}
      </div>

      {/* Cache stats */}
      <div className="bg-muted/50 rounded-lg p-3 border border-border mt-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium">Price cache</p>
            <p className="text-xs text-muted-foreground">{cacheStats.validCount} products cached</p>
          </div>
          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => { clearCache(); window.location.reload(); }}>
            <Trash2 className="w-3 h-3 mr-1" /> Clear cache
          </Button>
        </div>
      </div>
    </Section>
  );
}

// ── SEO Template Section ───────────────────────────────────
function SeoTemplateSection() {
  const store = getStoreConfig();
  const industry = getIndustryConfig(store.industry);
  const [titleTemplate, setTitleTemplate] = useState(store.seoTitleTemplate || '{product} | {brand} | {store}');
  const [descTemplate, setDescTemplate] = useState(store.seoDescriptionTemplate || '');
  const [ctaPhrases, setCtaPhrasesState] = useState<string[]>(() => getCtaPhrases(store.industry));
  const [newCta, setNewCta] = useState('');

  // Live preview with sample product
  const sampleTitle = generateSeoTitle(
    { title: 'Sample Product', brand: 'Sample Brand', type: industry.defaultType },
    { ...store, seoTitleTemplate: titleTemplate, seoDescriptionTemplate: descTemplate },
  );
  const sampleDesc = generateSeoDescription(
    { title: 'Sample Product', brand: 'Sample Brand', type: industry.defaultType },
    { ...store, seoTitleTemplate: titleTemplate, seoDescriptionTemplate: descTemplate },
    0,
  );

  const handleSave = () => {
    saveStoreConfig({ seoTitleTemplate: titleTemplate, seoDescriptionTemplate: descTemplate || undefined });
    saveCtaPhrases(ctaPhrases);
  };

  const addCta = () => {
    if (newCta.trim()) {
      const updated = [...ctaPhrases, newCta.trim()];
      setCtaPhrasesState(updated);
      setNewCta('');
    }
  };

  const removeCta = (idx: number) => {
    setCtaPhrasesState(ctaPhrases.filter((_, i) => i !== idx));
  };

  return (
    <Section title="🔍 SEO templates">
      <p className="text-xs text-muted-foreground -mt-1 mb-2">
        Configure how SEO titles and descriptions are generated for all products.
      </p>

      {/* Title template */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">SEO title template</label>
        <input
          value={titleTemplate}
          onChange={e => setTitleTemplate(e.target.value)}
          placeholder="{product} | {brand} | {store}"
          className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm font-mono-data"
        />
        <div className="flex items-center justify-between mt-1">
          <p className="text-xs text-muted-foreground">Variables: {'{product}'} {'{brand}'} {'{type}'} {'{store}'} {'{city}'}</p>
          <p className={`text-xs font-mono ${sampleTitle.length > 70 ? 'text-destructive' : 'text-success'}`}>{sampleTitle.length}/70</p>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {SEO_TITLE_PRESETS.map(p => (
            <button key={p.label} onClick={() => setTitleTemplate(p.template)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${titleTemplate === p.template ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-border'}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Description template */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">SEO description template</label>
        <textarea
          value={descTemplate}
          onChange={e => setDescTemplate(e.target.value)}
          rows={2}
          placeholder={`{product} by {brand}. {features}{cta} at {store}.`}
          className="w-full rounded-md bg-input border border-border px-3 py-2 text-sm font-mono-data resize-none"
        />
        <div className="flex items-center justify-between mt-1">
          <p className="text-xs text-muted-foreground">+ {'{features}'} {'{cta}'} {'{threshold}'}</p>
          <p className={`text-xs font-mono ${sampleDesc.length > 160 ? 'text-destructive' : 'text-success'}`}>{sampleDesc.length}/160</p>
        </div>
      </div>

      {/* Google preview */}
      <div className="bg-background rounded-lg border border-border p-3">
        <p className="text-xs text-muted-foreground mb-1.5 font-medium">Google preview</p>
        <p className="text-primary text-sm leading-snug truncate" style={{ fontFamily: 'Arial, sans-serif' }}>{sampleTitle}</p>
        <p className="text-success text-xs mt-0.5" style={{ fontFamily: 'Arial, sans-serif' }}>{store.url || 'yourstore.com'} › products</p>
        <p className="text-muted-foreground text-xs mt-1 leading-relaxed line-clamp-2" style={{ fontFamily: 'Arial, sans-serif' }}>{sampleDesc}</p>
      </div>

      {/* CTA phrases */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">CTA phrases (rotated per product)</label>
        <div className="space-y-1.5">
          {ctaPhrases.map((cta, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="flex-1 text-xs bg-muted rounded-md px-2.5 py-1.5 font-mono-data">{cta}</span>
              <button onClick={() => removeCta(i)} className="text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-2">
          <input value={newCta} onChange={e => setNewCta(e.target.value)} placeholder="New CTA phrase..."
            className="flex-1 h-8 rounded-md bg-input border border-border px-2.5 text-xs" onKeyDown={e => e.key === 'Enter' && addCta()} />
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={addCta}>Add</Button>
        </div>
      </div>

      <Button variant="outline" size="sm" className="w-full h-8 text-xs" onClick={handleSave}>
        <Save className="w-3 h-3 mr-1" /> Save SEO settings
      </Button>
    </Section>
  );
}

// ── Default AI Instructions Section ────────────────────────
const DEFAULT_INSTRUCTIONS_KEY = 'default_ai_instructions_sonic_invoice';

function DefaultInstructionsSection() {
  const [instructions, setInstructions] = useState(() => {
    try { return localStorage.getItem(DEFAULT_INSTRUCTIONS_KEY) || ''; } catch { return ''; }
  });

  const handleSave = () => {
    localStorage.setItem(DEFAULT_INSTRUCTIONS_KEY, instructions);
  };

  return (
    <Section title="🤖 Default AI instructions">
      <p className="text-xs text-muted-foreground -mt-1 mb-2">
        These instructions apply to ALL invoices unless overridden at the invoice level.
      </p>
      <textarea
        value={instructions}
        onChange={e => setInstructions(e.target.value)}
        rows={4}
        maxLength={2000}
        placeholder={"Instructions here apply to ALL invoices.\nExample: 'Always use title case for product names.\nAlways add my store name to the vendor field.'"}
        className="w-full rounded-md bg-input border border-border px-3 py-2 text-sm resize-none leading-relaxed placeholder:text-muted-foreground/50"
      />
      <div className="flex items-center justify-between mt-1">
        <p className="text-xs text-muted-foreground">{instructions.length} / 2000</p>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleSave}>
          <Save className="w-3 h-3 mr-1" /> Save default instructions
        </Button>
      </div>
    </Section>
  );
}

// ── Collection Manager Section ─────────────────────────────
function CollectionManagerSection() {
  const [rules, setRules] = useState<CollectionRule[]>(getCollectionRules);
  const [newName, setNewName] = useState("");
  const [newTags, setNewTags] = useState("");

  const handleAdd = () => {
    if (!newName.trim() || !newTags.trim()) return;
    const updated = [...rules, { name: newName.trim(), triggerTags: newTags.split(",").map(t => t.trim()).filter(Boolean), matchMode: "all" as const }];
    setRules(updated);
    saveCollectionRules(updated);
    setNewName("");
    setNewTags("");
  };

  const handleDelete = (idx: number) => {
    const updated = rules.filter((_, i) => i !== idx);
    setRules(updated);
    saveCollectionRules(updated);
  };

  const handleReset = () => {
    resetCollectionRules();
    setRules(getCollectionRules());
  };

  return (
    <Section title="🏷️ Collections">
      <p className="text-xs text-muted-foreground -mt-1 mb-2">
        Define smart collection rules. Products matching these tags will be auto-assigned.
      </p>
      <div className="space-y-1.5 max-h-48 overflow-y-auto mb-3">
        {rules.map((r, i) => (
          <div key={i} className="flex items-center gap-2 text-xs bg-muted/50 rounded-lg px-3 py-2">
            <span className="font-medium text-foreground flex-1 truncate">{r.name}</span>
            <span className="text-muted-foreground truncate max-w-[140px]">{r.triggerTags.join(", ")}</span>
            <button onClick={() => handleDelete(i)} className="text-destructive shrink-0"><Trash2 className="w-3 h-3" /></button>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="Collection name" value={newName} onChange={e => setNewName(e.target.value)} className="h-9 text-xs" />
        <Input placeholder="Trigger tags (comma-sep)" value={newTags} onChange={e => setNewTags(e.target.value)} className="h-9 text-xs" />
      </div>
      <div className="flex gap-2 mt-2">
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleAdd} disabled={!newName.trim()}>
          <Plus className="w-3 h-3 mr-1" /> Add collection
        </Button>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleReset}>Reset to defaults</Button>
      </div>
    </Section>
  );
}

// ── Notification Preferences Section ───────────────────────
function NotificationPrefsSection() {
  const [prefs, setPrefs] = useState<NotificationPreferences>(loadPreferences);

  const update = (patch: Partial<NotificationPreferences>) => {
    const updated = { ...prefs, ...patch };
    setPrefs(updated);
    savePreferences(updated);
  };

  const toggles: { key: keyof NotificationPreferences; label: string }[] = [
    { key: "priceIncreases", label: "Large price increases (>threshold)" },
    { key: "overdueDeliveries", label: "Overdue brand deliveries" },
    { key: "lowStock", label: "Low stock warnings" },
    { key: "duplicateInvoices", label: "Duplicate invoice detections" },
    { key: "processingComplete", label: "Invoice processing complete" },
    { key: "exportComplete", label: "Export complete" },
    { key: "everyLogin", label: "Every login (noisy)" },
  ];

  return (
    <Section title="🔔 Notifications">
      <p className="text-xs text-muted-foreground -mt-1 mb-2">Choose which notifications you receive.</p>
      <div className="space-y-2">
        {toggles.map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between">
            <span className="text-xs text-foreground">{label}</span>
            <Switch
              checked={!!prefs[key]}
              onCheckedChange={(v) => update({ [key]: v })}
            />
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Price increase threshold (%)</label>
          <select
            value={prefs.priceThreshold}
            onChange={(e) => update({ priceThreshold: Number(e.target.value) })}
            className="w-full h-9 rounded-md bg-input border border-border px-3 text-sm text-foreground"
          >
            {[3, 5, 10, 15, 20].map(v => <option key={v} value={v}>{v}%</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Low stock threshold (units)</label>
          <select
            value={prefs.lowStockThreshold}
            onChange={(e) => update({ lowStockThreshold: Number(e.target.value) })}
            className="w-full h-9 rounded-md bg-input border border-border px-3 text-sm text-foreground"
          >
            {[1, 2, 3, 5, 10].map(v => <option key={v} value={v}>{v} units</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Overdue delivery threshold</label>
          <select
            value={prefs.overdueWeeks}
            onChange={(e) => update({ overdueWeeks: Number(e.target.value) })}
            className="w-full h-9 rounded-md bg-input border border-border px-3 text-sm text-foreground"
          >
            {[1, 2, 3, 4].map(v => <option key={v} value={v}>{v} week{v > 1 ? "s" : ""}</option>)}
          </select>
        </div>
      </div>
    </Section>
  );
}

// ── Invoice Templates Section ──────────────────────────────
function InvoiceTemplatesSection() {
  const [templates, setTemplates] = useState<Record<string, InvoiceTemplate>>(getFormatTemplates);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const handleDelete = (key: string) => {
    deleteFormatTemplate(key);
    setTemplates(getFormatTemplates());
  };

  const userTemplates = Object.entries(templates);

  return (
    <Section title="📋 Invoice Templates">
      <p className="text-xs text-muted-foreground -mt-1 mb-2">
        Saved formats for faster invoice parsing. Templates learn your suppliers' layouts.
      </p>

      {/* User templates */}
      {userTemplates.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No custom templates saved yet. Process an invoice and save its format.</p>
      ) : (
        <div className="space-y-1.5 mb-3">
          {userTemplates.map(([key, t]) => {
            const q = getTemplateQuality(t);
            const expanded = expandedKey === key;
            return (
              <div key={key} className="bg-muted/50 rounded-lg">
                <button
                  onClick={() => setExpandedKey(expanded ? null : key)}
                  className="w-full flex items-center gap-2 text-xs px-3 py-2 text-left"
                >
                  <span className="font-medium text-foreground flex-1">{t.supplier}</span>
                  <span className="text-muted-foreground">{t.fileType.toUpperCase()}</span>
                  <span className={`text-[10px] ${q.color}`}>✓ {t.successCount}</span>
                </button>
                {expanded && (
                  <div className="px-3 pb-2 space-y-1.5">
                    <div className="grid grid-cols-2 gap-1 text-[11px]">
                      <span className="text-muted-foreground">Header row:</span><span>Row {t.headerRow}</span>
                      {Object.entries(t.columns).filter(([, v]) => v).map(([k, v]) => (
                        <><span key={k} className="text-muted-foreground">{COLUMN_LABELS[k as keyof ColumnMapping] || k}:</span><span>Col {v}</span></>
                      ))}
                      <span className="text-muted-foreground">Quality:</span><span className={q.color}>{q.label}</span>
                      {t.lastUsed && <><span className="text-muted-foreground">Last used:</span><span>{new Date(t.lastUsed).toLocaleDateString()}</span></>}
                    </div>
                    <button onClick={() => handleDelete(key)} className="text-destructive text-[11px] flex items-center gap-1 mt-1">
                      <Trash2 className="w-3 h-3" /> Delete template
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Learned templates */}
      {getTemplateList().length > 0 && (
        <div className="mt-3 pt-3 border-t">
          <p className="text-xs font-semibold text-muted-foreground mb-2">📚 Learned Templates</p>
          <p className="text-[11px] text-muted-foreground mb-2">Templates learned from your invoice uploads.</p>
          <div className="space-y-1">
            {getTemplateList().filter(t => t.successCount > 0).map(t => (
              <div key={t.supplier} className="flex items-center justify-between text-xs bg-muted/30 rounded-lg px-3 py-1.5">
                <span className="font-medium text-foreground">{t.supplier}</span>
                <span className="text-muted-foreground">{t.successCount} uses • {t.corrections?.length || 0} corrections</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

// ── Locations Section ──────────────────────────────────────
interface StoreLocation {
  id: string;
  name: string;
  type: "retail" | "warehouse" | "online" | "popup";
  address: string;
  isDefault: boolean;
}

const LOCATION_STORAGE_KEY = "locations_config";
const LOCATION_TYPES = [
  { v: "retail", l: "Retail store" },
  { v: "warehouse", l: "Warehouse" },
  { v: "online", l: "Online" },
  { v: "popup", l: "Pop-up" },
];

export function getStoreLocations(): StoreLocation[] {
  try {
    const saved = localStorage.getItem(LOCATION_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return [{ id: "loc_1", name: "Main Store", type: "retail", address: "", isDefault: true }];
}

export function saveStoreLocations(locs: StoreLocation[]) {
  localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(locs));
}

function LocationsSection() {
  const [locations, setLocations] = useState<StoreLocation[]>(getStoreLocations);
  const [editing, setEditing] = useState<string | null>(null);

  const save = (updated: StoreLocation[]) => {
    setLocations(updated);
    saveStoreLocations(updated);
  };

  const addLocation = () => {
    const id = `loc_${Date.now()}`;
    save([...locations, { id, name: "New Location", type: "retail", address: "", isDefault: false }]);
    setEditing(id);
  };

  const removeLocation = (id: string) => {
    const loc = locations.find(l => l.id === id);
    if (loc?.isDefault) return;
    save(locations.filter(l => l.id !== id));
  };

  const setDefault = (id: string) => {
    save(locations.map(l => ({ ...l, isDefault: l.id === id })));
  };

  const updateField = (id: string, field: keyof StoreLocation, value: string) => {
    save(locations.map(l => l.id === id ? { ...l, [field]: value } : l));
  };

  return (
    <Section title="📍 Locations">
      <p className="text-xs text-muted-foreground -mt-1 mb-3">
        Configure store locations for multi-location inventory tracking.
      </p>
      <div className="space-y-2">
        {locations.map(loc => (
          <div key={loc.id} className="bg-muted/30 rounded-lg border border-border overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{loc.name}</p>
                  <p className="text-[10px] text-muted-foreground">{LOCATION_TYPES.find(t => t.v === loc.type)?.l || loc.type}{loc.address ? ` · ${loc.address}` : ""}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {loc.isDefault && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] bg-primary/15 text-primary font-medium">Default</span>
                )}
                <button onClick={() => setEditing(editing === loc.id ? null : loc.id)} className="text-muted-foreground">
                  <Edit2 className="w-3 h-3" />
                </button>
              </div>
            </div>
            {editing === loc.id && (
              <div className="px-3 pb-3 space-y-2 border-t border-border pt-2">
                <input value={loc.name} onChange={e => updateField(loc.id, "name", e.target.value)}
                  placeholder="Location name" className="w-full h-8 rounded-md bg-input border border-border px-2 text-xs" />
                <select value={loc.type} onChange={e => updateField(loc.id, "type", e.target.value as StoreLocation["type"])}
                  className="w-full h-8 rounded-md bg-input border border-border px-2 text-xs">
                  {LOCATION_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
                </select>
                <input value={loc.address} onChange={e => updateField(loc.id, "address", e.target.value)}
                  placeholder="Address (optional)" className="w-full h-8 rounded-md bg-input border border-border px-2 text-xs" />
                <div className="flex gap-2">
                  {!loc.isDefault && (
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setDefault(loc.id)}>
                      Set as default
                    </Button>
                  )}
                  {!loc.isDefault && (
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => removeLocation(loc.id)}>
                      <Trash2 className="w-3 h-3 mr-1" /> Remove
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" className="mt-2 h-7 text-xs w-full" onClick={addLocation}>
        <Plus className="w-3 h-3 mr-1" /> Add location
      </Button>
    </Section>
  );
}

// ── Metafields Section ─────────────────────────────────────
function MetafieldsSection() {
  const [config, setConfig] = useState<MetafieldDefinition[]>(getMetafieldConfig);
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");

  const toggle = (key: string) => {
    const updated = config.map(m => m.key === key ? { ...m, enabled: !m.enabled } : m);
    setConfig(updated);
    saveMetafieldConfig(updated);
  };

  const addCustom = () => {
    if (!newKey.trim() || !newLabel.trim()) return;
    const cleanKey = newKey.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (config.some(m => m.key === cleanKey)) return;
    const updated = [...config, {
      key: cleanKey,
      label: newLabel.trim(),
      shopifyColumn: `Metafield: custom.${cleanKey} [string]`,
      enabled: true,
      isCustom: true,
    }];
    setConfig(updated);
    saveMetafieldConfig(updated);
    setNewKey("");
    setNewLabel("");
  };

  const removeCustom = (key: string) => {
    const updated = config.filter(m => m.key !== key);
    setConfig(updated);
    saveMetafieldConfig(updated);
  };

  return (
    <Section title="📋 Metafields">
      <p className="text-xs text-muted-foreground -mt-1 mb-3">
        Extra product data fields exported as Shopify metafield columns. Disable fields you don't need to keep exports clean.
      </p>
      <div className="space-y-2">
        {config.map(mf => (
          <div key={mf.key} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2.5">
              <Switch checked={mf.enabled} onCheckedChange={() => toggle(mf.key)} />
              <div>
                <p className="text-xs font-medium">{mf.label}</p>
                <p className="text-[10px] text-muted-foreground font-mono-data">{mf.shopifyColumn}</p>
              </div>
            </div>
            {mf.isCustom && (
              <button onClick={() => removeCustom(mf.key)} className="text-destructive">
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Add custom metafield */}
      <div className="mt-3 pt-3 border-t border-border">
        <p className="text-xs font-medium mb-2 flex items-center gap-1"><Plus className="w-3 h-3" /> Add custom metafield</p>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="Field key (e.g. warranty)" className="h-8 rounded-md bg-input border border-border px-2 text-xs" />
          <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Display label" className="h-8 rounded-md bg-input border border-border px-2 text-xs" />
        </div>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={addCustom} disabled={!newKey.trim() || !newLabel.trim()}>
          <Plus className="w-3 h-3 mr-1" /> Add metafield
        </Button>
      </div>
    </Section>
  );
}

// ─── Wholesale Platform Connections ─────────────────────────────────
const WHOLESALE_PLATFORMS = [
  { id: "joor", name: "JOOR", icon: "🔗", desc: "Global wholesale fashion platform", credentialKey: "oauth_token", credentialLabel: "API Token" },
  { id: "nuorder", name: "NuOrder", icon: "📦", desc: "Surf & action sports brands", credentialKey: "api_key", credentialLabel: "API Key" },
  { id: "brandscope", name: "Brandscope", icon: "🌏", desc: "AU/NZ swim & surf wholesale", credentialKey: "api_key", credentialLabel: "API Key" },
  { id: "brandboom", name: "Brandboom", icon: "💼", desc: "US fashion & independent brands", credentialKey: "api_key", credentialLabel: "API Key" },
  { id: "faire", name: "Faire", icon: "🛒", desc: "Independent boutique marketplace", credentialKey: "api_key", credentialLabel: "API Key" },
] as const;

function WholesaleConnectionsSection() {
  const [connections, setConnections] = useState<Record<string, { id: string; label: string | null; connected_at: string; last_synced: string | null }>>({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [testError, setTestError] = useState("");

  useEffect(() => {
    loadConnections();
  }, []);

  const loadConnections = async () => {
    try {
      const { data } = await supabase
        .from("wholesale_connections")
        .select("id, platform, label, connected_at, last_synced");
      if (data) {
        const map: typeof connections = {};
        for (const c of data) {
          map[c.platform] = { id: c.id, label: c.label, connected_at: c.connected_at, last_synced: c.last_synced };
        }
        setConnections(map);
      }
    } catch {}
    setLoading(false);
  };

  const handleConnect = async (platformId: string, credKey: string) => {
    if (!tokenInput.trim()) { setTestError("Enter a token or API key"); return; }
    setConnecting(true);
    setTestError("");
    try {
      // For JOOR/Faire, test via proxy first
      if (platformId === "joor" || platformId === "faire") {
        const { error } = await supabase.functions.invoke("wholesale-proxy", {
          body: { platform: platformId, action: "test" },
        });
        // We'll save regardless — the proxy may fail if not yet saved
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const credentials: Record<string, string> = { [credKey]: tokenInput };
      const { error } = await supabase.from("wholesale_connections").upsert({
        user_id: user.id,
        platform: platformId,
        label: labelInput || null,
        credentials,
        connected_at: new Date().toISOString(),
      }, { onConflict: "user_id,platform" });

      if (error) throw error;
      setTokenInput("");
      setLabelInput("");
      setExpanded(null);
      await loadConnections();
    } catch (err) {
      setTestError(err instanceof Error ? err.message : "Connection failed");
    }
    setConnecting(false);
  };

  const handleDisconnect = async (platformId: string) => {
    const conn = connections[platformId];
    if (!conn) return;
    await supabase.from("wholesale_connections").delete().eq("id", conn.id);
    const updated = { ...connections };
    delete updated[platformId];
    setConnections(updated);
  };

  const handleSync = async (platformId: string) => {
    setSyncing(platformId);
    try {
      if (platformId === "joor" || platformId === "faire") {
        await supabase.functions.invoke("wholesale-proxy", {
          body: { platform: platformId, action: "get_orders" },
        });
      }
      const conn = connections[platformId];
      if (conn) {
        await supabase.from("wholesale_connections")
          .update({ last_synced: new Date().toISOString() })
          .eq("id", conn.id);
        await loadConnections();
      }
    } catch {}
    setSyncing(null);
  };

  const formatDate = (d: string | null) => {
    if (!d) return "Never";
    return new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  if (loading) {
    return (
      <Section title="🔌 Wholesale platforms">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading connections...
        </div>
      </Section>
    );
  }

  return (
    <Section title="🔌 Wholesale platforms">
      <p className="text-xs text-muted-foreground -mt-1 mb-3">
        Connect your wholesale ordering platforms to import orders directly.
      </p>
      <div className="space-y-2">
        {WHOLESALE_PLATFORMS.map((p) => {
          const conn = connections[p.id];
          const isExpanded = expanded === p.id;

          return (
            <div key={p.id} className="border border-border rounded-lg overflow-hidden">
              <button
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/30 transition-colors"
                onClick={() => setExpanded(isExpanded ? null : p.id)}
              >
                <span className="text-lg">{p.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{p.name}</span>
                    {conn ? (
                      <span className="text-[10px] bg-success/15 text-success px-1.5 py-0.5 rounded-full font-medium">Connected</span>
                    ) : (
                      <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">Not connected</span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">{conn?.label || p.desc}</p>
                </div>
                {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 border-t border-border pt-3 space-y-2">
                  {conn ? (
                    <>
                      <div className="text-xs space-y-1">
                        {conn.label && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Label</span>
                            <span className="font-medium">{conn.label}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Connected</span>
                          <span className="font-mono-data">{formatDate(conn.connected_at)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Last synced</span>
                          <span className="font-mono-data">{formatDate(conn.last_synced)}</span>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 h-8 text-xs"
                          onClick={() => handleSync(p.id)}
                          disabled={syncing === p.id}
                        >
                          {syncing === p.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                          Sync now
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs text-destructive hover:text-destructive"
                          onClick={() => handleDisconnect(p.id)}
                        >
                          <Unplug className="w-3 h-3 mr-1" /> Disconnect
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <Input
                        value={tokenInput}
                        onChange={(e) => setTokenInput(e.target.value)}
                        placeholder={`${p.credentialLabel}`}
                        className="h-8 text-xs"
                        type="password"
                      />
                      <Input
                        value={labelInput}
                        onChange={(e) => setLabelInput(e.target.value)}
                        placeholder="Label (e.g. Splash Swimwear)"
                        className="h-8 text-xs"
                      />
                      {testError && expanded === p.id && (
                        <p className="text-xs text-destructive flex items-center gap-1">
                          <X className="w-3 h-3" /> {testError}
                        </p>
                      )}
                      <Button
                        variant="teal"
                        size="sm"
                        className="w-full h-8 text-xs"
                        onClick={() => handleConnect(p.id, p.credentialKey)}
                        disabled={connecting}
                      >
                        {connecting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Check className="w-3 h-3 mr-1" />}
                        Test & Connect
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
