import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LogOut, Check, X, Loader2, ChevronDown, ChevronUp, Eye, EyeOff, Unplug } from "lucide-react";
import {
  saveConnection, testConnection, getConnection, deleteConnection,
  getLocations, updateConnectionSettings, ShopifyConnection,
} from "@/lib/shopify-api";

const AccountScreen = () => {
  const [storeName, setStoreName] = useState("");
  const [currency, setCurrency] = useState("AUD");
  const [markup, setMarkup] = useState("2.35");
  const [rounding, setRounding] = useState("nearest_05");

  // Shopify connection
  const [shopifyUrl, setShopifyUrl] = useState("");
  const [shopifyToken, setShopifyToken] = useState("");
  const [shopifyVersion, setShopifyVersion] = useState("2024-10");
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [shopName, setShopName] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");
  const [showGuide, setShowGuide] = useState(false);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [defaultLocation, setDefaultLocation] = useState("");
  const [productStatus, setProductStatus] = useState("draft");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getConnection().then((conn) => {
      if (conn) {
        setShopifyUrl(conn.store_url);
        setShopifyConnected(true);
        setShopName(conn.shop_name || conn.store_url);
        setDefaultLocation(conn.default_location_id || "");
        setProductStatus(conn.product_status || "draft");
        setShopifyVersion(conn.api_version || "2024-10");
      }
    });
  }, []);

  const handleTestConnection = async () => {
    if (!shopifyUrl || !shopifyToken) {
      setTestStatus("error");
      setTestMessage("Enter both store URL and access token");
      return;
    }
    setTestStatus("testing");
    try {
      await saveConnection(shopifyUrl, shopifyToken, shopifyVersion);
      const result = await testConnection();
      setTestStatus("success");
      setTestMessage(`Connected to: ${result.shopName}`);
      setShopName(result.shopName);
      setShopifyConnected(true);
      // Load locations
      try {
        const locs = await getLocations();
        setLocations(locs.filter((l) => l.active));
        if (locs.length > 0 && !defaultLocation) {
          setDefaultLocation(String(locs[0].id));
        }
      } catch {}
    } catch (err) {
      setTestStatus("error");
      setTestMessage(err instanceof Error ? err.message : "Connection failed");
    }
  };

  const handleDisconnect = async () => {
    await deleteConnection();
    setShopifyConnected(false);
    setShopifyUrl("");
    setShopifyToken("");
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

  const maskedToken = shopifyToken
    ? "••••••••••••" + shopifyToken.slice(-4)
    : "";

  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <h1 className="text-2xl font-bold font-display mb-1">Account</h1>
      <p className="text-muted-foreground text-sm mb-6">Store settings & pricing rules</p>

      {/* Store Details */}
      <Section title="Store details">
        <Field label="Store name" value={storeName} onChange={setStoreName} placeholder="My Boutique" />
        <Field label="Store website" placeholder="myboutique.com.au" />
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Currency" value={currency} onChange={setCurrency}
            options={[{ v: "AUD", l: "AUD" }, { v: "USD", l: "USD" }, { v: "GBP", l: "GBP" }, { v: "NZD", l: "NZD" }, { v: "EUR", l: "EUR" }]}
          />
          <SelectField label="Locale" value="AU" onChange={() => {}}
            options={[{ v: "AU", l: "Australia" }, { v: "US", l: "US" }, { v: "UK", l: "UK" }, { v: "NZ", l: "NZ" }]}
          />
        </div>
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

        <Field
          label="Store URL"
          value={shopifyUrl}
          onChange={setShopifyUrl}
          placeholder="yourstore.myshopify.com"
        />

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Access token</label>
          <div className="relative">
            <input
              type={showToken ? "text" : "password"}
              value={shopifyToken}
              onChange={(e) => setShopifyToken(e.target.value)}
              placeholder="shpat_xxxxx"
              className="w-full h-10 rounded-md bg-input border border-border px-3 pr-10 text-sm"
            />
            <button
              onClick={() => setShowToken(!showToken)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            >
              {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {shopifyConnected && !shopifyToken && (
            <p className="text-xs text-muted-foreground mt-1">{maskedToken || "Token saved securely"}</p>
          )}
        </div>

        <SelectField
          label="API Version"
          value={shopifyVersion}
          onChange={setShopifyVersion}
          options={[
            { v: "2024-10", l: "2024-10" },
            { v: "2024-07", l: "2024-07" },
            { v: "2024-04", l: "2024-04" },
            { v: "2024-01", l: "2024-01" },
          ]}
        />

        {/* How to get token guide */}
        <button
          onClick={() => setShowGuide(!showGuide)}
          className="flex items-center gap-1 text-xs text-muted-foreground mt-1"
        >
          {showGuide ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          How to get your access token
        </button>
        {showGuide && (
          <ol className="text-xs text-muted-foreground mt-2 space-y-1.5 pl-4 list-decimal">
            <li>In Shopify Admin → Settings → Apps and sales channels</li>
            <li>Click "Develop apps" (top right)</li>
            <li>Click "Create an app" → name it "SkuPilot"</li>
            <li>Click "Configure Admin API scopes"</li>
            <li className="font-medium text-foreground">
              Enable: write_products, read_products, write_inventory, read_inventory, read_locations
            </li>
            <li>Click Save → Install app → Reveal token once</li>
            <li>Copy and paste the token here</li>
          </ol>
        )}

        {/* Test button */}
        <Button
          variant="outline"
          className="w-full h-10"
          onClick={handleTestConnection}
          disabled={testStatus === "testing"}
        >
          {testStatus === "testing" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {testStatus === "testing" ? "Testing..." : "Test connection"}
        </Button>

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

      <Button variant="teal" className="w-full mt-4 h-12 text-base">Save settings</Button>

      <Button variant="ghost" className="w-full mt-6 text-destructive h-12">
        <LogOut className="w-4 h-4 mr-2" /> Sign out
      </Button>
    </div>
  );
};

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
