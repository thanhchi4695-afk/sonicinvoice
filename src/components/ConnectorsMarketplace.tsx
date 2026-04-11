import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, ExternalLink, Check, X, Loader2, ChevronDown, ChevronUp, Plug } from "lucide-react";
import { toast } from "sonner";

/* ── Connector registry ─────────────────────────────────────── */

interface Connector {
  id: string;
  name: string;
  icon: string;
  desc: string;
  authType: "oauth" | "api_key" | "coming_soon";
  category: string;
  docsUrl?: string;
}

const CONNECTORS: Connector[] = [
  // Wholesale
  { id: "joor", name: "JOOR", icon: "🛒", desc: "Wholesale order management for fashion brands", authType: "api_key", category: "Wholesale" },
  { id: "nuorder", name: "NuOrder", icon: "📦", desc: "B2B wholesale e-commerce platform", authType: "api_key", category: "Wholesale" },
  { id: "brandscope", name: "Brandscope", icon: "🔍", desc: "Australian wholesale marketplace", authType: "api_key", category: "Wholesale" },
  { id: "brandboom", name: "Brandboom", icon: "💥", desc: "Online wholesale showroom platform", authType: "api_key", category: "Wholesale" },
  { id: "faire", name: "Faire", icon: "🌿", desc: "Online wholesale marketplace for independent retailers", authType: "api_key", category: "Wholesale" },
  { id: "ankorstore", name: "Ankorstore", icon: "🇪🇺", desc: "European B2B wholesale marketplace", authType: "coming_soon", category: "Wholesale" },
  { id: "tundra", name: "Tundra", icon: "🇺🇸", desc: "US direct-to-retailer wholesale platform", authType: "coming_soon", category: "Wholesale" },

  // Accounting
  { id: "xero", name: "Xero", icon: "📘", desc: "Cloud accounting for small business", authType: "oauth", category: "Accounting" },
  { id: "myob", name: "MYOB", icon: "📗", desc: "Australian accounting & payroll software", authType: "oauth", category: "Accounting" },
  { id: "quickbooks", name: "QuickBooks", icon: "📒", desc: "Intuit accounting for SMBs", authType: "coming_soon", category: "Accounting" },
  { id: "sage", name: "Sage", icon: "📕", desc: "Business management & accounting", authType: "coming_soon", category: "Accounting" },

  // Shipping
  { id: "shipstation", name: "ShipStation", icon: "🚢", desc: "Multi-carrier shipping & order management", authType: "coming_soon", category: "Shipping" },
  { id: "shippo", name: "Shippo", icon: "📬", desc: "Shipping API for e-commerce", authType: "coming_soon", category: "Shipping" },

  // Marketplaces
  { id: "amazon", name: "Amazon", icon: "📦", desc: "Pull orders as invoices from Amazon Seller Central", authType: "coming_soon", category: "Marketplaces" },
  { id: "ebay", name: "eBay", icon: "🏷️", desc: "Import eBay orders and sync inventory", authType: "coming_soon", category: "Marketplaces" },
  { id: "etsy", name: "Etsy", icon: "🧶", desc: "Handmade & vintage marketplace integration", authType: "coming_soon", category: "Marketplaces" },

  // POS
  { id: "lightspeed_x", name: "Lightspeed X-Series", icon: "⚡", desc: "Vend / X-Series point of sale", authType: "oauth", category: "POS" },
  { id: "lightspeed_r", name: "Lightspeed R-Series", icon: "💡", desc: "Lightspeed Retail (legacy) POS", authType: "oauth", category: "POS" },
  { id: "square", name: "Square", icon: "⬜", desc: "POS, payments & business tools", authType: "coming_soon", category: "POS" },
  { id: "toast", name: "Toast", icon: "🍞", desc: "Restaurant & hospitality POS", authType: "coming_soon", category: "POS" },
];

const CATEGORIES = ["Wholesale", "Accounting", "Shipping", "Marketplaces", "POS"];

/* ── Persistence helpers ─────────────────────────────────────── */

const LS_KEY = "connectors_marketplace";

interface InstalledConnector {
  id: string;
  installedAt: string;
  credentials?: Record<string, string>;
}

function getInstalled(): InstalledConnector[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { return []; }
}

function saveInstalled(list: InstalledConnector[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(list));
}

/* ── Component ───────────────────────────────────────────────── */

interface Props {
  onBack?: () => void;
}

export default function ConnectorsMarketplace({ onBack }: Props) {
  const [installed, setInstalled] = useState<InstalledConnector[]>(getInstalled);
  const [search, setSearch] = useState("");
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [setupId, setSetupId] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [saving, setSaving] = useState(false);

  const isInstalled = (id: string) => installed.some(c => c.id === id);

  const handleInstall = (connector: Connector) => {
    if (connector.authType === "coming_soon") {
      toast.info(`${connector.name} integration is coming soon!`);
      return;
    }
    if (connector.authType === "oauth") {
      // For OAuth connectors that already exist in the app, redirect to account settings
      toast.info(`Connect ${connector.name} from the relevant section in Account Settings.`);
      return;
    }
    // API key flow
    setSetupId(connector.id);
    setApiKeyInput("");
  };

  const handleSaveApiKey = (connector: Connector) => {
    if (!apiKeyInput.trim()) {
      toast.error("Please enter an API key");
      return;
    }
    setSaving(true);
    setTimeout(() => {
      const entry: InstalledConnector = {
        id: connector.id,
        installedAt: new Date().toISOString(),
        credentials: { api_key: apiKeyInput.trim() },
      };
      const updated = [...installed.filter(c => c.id !== connector.id), entry];
      setInstalled(updated);
      saveInstalled(updated);
      setSetupId(null);
      setApiKeyInput("");
      setSaving(false);
      toast.success(`${connector.name} connected successfully!`);
    }, 600);
  };

  const handleUninstall = (id: string) => {
    const updated = installed.filter(c => c.id !== id);
    setInstalled(updated);
    saveInstalled(updated);
    toast.success("Connector removed");
  };

  const filtered = search.trim()
    ? CONNECTORS.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.desc.toLowerCase().includes(search.toLowerCase()) ||
        c.category.toLowerCase().includes(search.toLowerCase())
      )
    : CONNECTORS;

  return (
    <div className="space-y-4 pb-32">
      {onBack && (
        <button onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground mb-2">
          ← Back
        </button>
      )}

      <div className="flex items-center gap-2">
        <Plug className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">Connectors Marketplace</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Browse and install integrations to connect your wholesale platforms, accounting, shipping, marketplaces and POS systems.
      </p>

      {/* Installed count */}
      {installed.length > 0 && (
        <div className="flex items-center gap-2">
          <Badge className="bg-primary/15 text-primary border-primary/30 text-xs">
            {installed.length} installed
          </Badge>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search connectors…"
          className="pl-9 h-9 text-sm"
        />
      </div>

      {/* Categories */}
      {CATEGORIES.map(cat => {
        const catConnectors = filtered.filter(c => c.category === cat);
        if (catConnectors.length === 0) return null;
        const isExpanded = expandedCat === cat || search.trim().length > 0;
        const installedInCat = catConnectors.filter(c => isInstalled(c.id)).length;

        return (
          <div key={cat} className="border border-border rounded-xl overflow-hidden">
            <button
              onClick={() => setExpandedCat(isExpanded && !search ? null : cat)}
              className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{cat}</span>
                <Badge variant="outline" className="text-[10px]">{catConnectors.length}</Badge>
                {installedInCat > 0 && (
                  <Badge className="bg-primary/15 text-primary border-primary/30 text-[10px]">
                    {installedInCat} active
                  </Badge>
                )}
              </div>
              {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>

            {isExpanded && (
              <div className="divide-y divide-border">
                {catConnectors.map(connector => {
                  const active = isInstalled(connector.id);
                  const isSettingUp = setupId === connector.id;

                  return (
                    <div key={connector.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-lg flex-shrink-0">{connector.icon}</span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium">{connector.name}</span>
                              {active && (
                                <Badge className="bg-primary/15 text-primary border-primary/30 text-[10px]">
                                  <Check className="w-2.5 h-2.5 mr-0.5" /> Connected
                                </Badge>
                              )}
                              {connector.authType === "coming_soon" && (
                                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                                  Coming soon
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{connector.desc}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {active ? (
                            <button
                              onClick={() => handleUninstall(connector.id)}
                              className="text-xs text-destructive hover:underline flex items-center gap-1"
                            >
                              <X className="w-3 h-3" /> Remove
                            </button>
                          ) : (
                            <Button
                              size="sm"
                              variant={connector.authType === "coming_soon" ? "outline" : "default"}
                              onClick={() => handleInstall(connector)}
                              className="text-xs h-7 px-3"
                              disabled={connector.authType === "coming_soon"}
                            >
                              {connector.authType === "coming_soon" ? "Soon" : "Install"}
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* API key setup inline */}
                      {isSettingUp && (
                        <div className="mt-3 p-3 bg-muted/40 rounded-lg space-y-2">
                          <p className="text-xs text-muted-foreground">
                            Enter your {connector.name} API key to connect. You can find this in your {connector.name} account settings.
                          </p>
                          <div className="flex gap-2">
                            <Input
                              value={apiKeyInput}
                              onChange={e => setApiKeyInput(e.target.value)}
                              placeholder={`${connector.name} API key`}
                              className="h-8 text-xs flex-1"
                              type="password"
                            />
                            <Button
                              size="sm"
                              className="h-8 text-xs"
                              onClick={() => handleSaveApiKey(connector)}
                              disabled={saving}
                            >
                              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Connect"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 text-xs"
                              onClick={() => { setSetupId(null); setApiKeyInput(""); }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
