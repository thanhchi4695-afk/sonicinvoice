import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ChevronDown, ChevronUp, Bot } from "lucide-react";
import { toast } from "sonner";

type Autonomy = "conservative" | "balanced" | "aggressive";
type FlowMode = "autonomous" | "approval" | "disabled";
type EmailDigest = "off" | "daily_8am" | "daily_5pm" | "on_new";

interface AgentSettings {
  enabled: boolean;
  dry_run: boolean;
  autonomy_level: Autonomy;
  flow_overrides: Record<string, FlowMode>;
  approval_expiry_days: number;
  email_digest: EmailDigest;
  notify_email: string;
  dollar_threshold: number;
}

const DEFAULTS: AgentSettings = {
  enabled: true,
  dry_run: true,
  autonomy_level: "balanced",
  flow_overrides: {},
  approval_expiry_days: 7,
  email_digest: "daily_8am",
  notify_email: "",
  dollar_threshold: 0,
};

// Curated flow list (representative set — extend as flows are wired up).
const FLOWS: { group: string; flows: { name: string; label: string }[] }[] = [
  {
    group: "Content & SEO",
    flows: [
      { name: "product_descriptions", label: "Product descriptions" },
      { name: "product_tags", label: "Product tags" },
      { name: "seo_titles", label: "SEO titles & meta" },
      { name: "collection_seo", label: "Collection SEO" },
      { name: "blog_plans", label: "Blog content plans" },
      { name: "internal_link_mesh", label: "Internal link mesh" },
    ],
  },
  {
    group: "Catalog & Inventory",
    flows: [
      { name: "invoice_parse", label: "Invoice parsing" },
      { name: "stock_check", label: "Stock check" },
      { name: "reorder_drafts", label: "Reorder drafts" },
      { name: "slow_stock_review", label: "Slow stock review" },
      { name: "shopify_push", label: "Shopify product push" },
      { name: "lightspeed_push", label: "Lightspeed push" },
    ],
  },
  {
    group: "Pricing & Money",
    flows: [
      { name: "price_match", label: "Competitor price match" },
      { name: "markdown_ladder", label: "Markdown ladder" },
      { name: "po_create", label: "Purchase order creation" },
      { name: "xero_bill_sync", label: "Xero bill sync" },
      { name: "myob_bill_sync", label: "MYOB bill sync" },
    ],
  },
  {
    group: "Marketing & Ads",
    flows: [
      { name: "meta_ads_check", label: "Meta ads health check" },
      { name: "meta_ads_publish", label: "Meta ads publish" },
      { name: "klaviyo_campaign", label: "Klaviyo email campaign" },
      { name: "social_post", label: "Social media post" },
      { name: "google_shopping_feed", label: "Google Shopping feed" },
    ],
  },
];

function presetDefault(level: Autonomy, flowName: string): FlowMode {
  const moneyAds = new Set([
    "po_create",
    "xero_bill_sync",
    "myob_bill_sync",
    "meta_ads_publish",
    "price_match",
    "markdown_ladder",
  ]);
  const social = new Set(["social_post", "klaviyo_campaign"]);
  if (level === "conservative") return "approval";
  if (level === "aggressive") {
    if (flowName === "po_create") return "approval"; // still gate POs
    return "autonomous";
  }
  // balanced
  if (moneyAds.has(flowName)) return "approval";
  if (social.has(flowName)) return "approval";
  return "autonomous";
}

const AgentSettingsSection = () => {
  const [shopId, setShopId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");
  const [settings, setSettings] = useState<AgentSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      setUserEmail(auth.user?.email ?? "");
      if (!uid) {
        setLoading(false);
        return;
      }
      const { data: shopRow } = await supabase
        .from("shop_users")
        .select("shop_id")
        .eq("user_id", uid)
        .limit(1)
        .maybeSingle();
      if (!shopRow?.shop_id) {
        setLoading(false);
        return;
      }
      setShopId(shopRow.shop_id);

      const { data: rows } = await supabase
        .from("sonic_agent_settings")
        .select("key, value")
        .eq("shop_id", shopRow.shop_id);

      const next: AgentSettings = { ...DEFAULTS, notify_email: auth.user?.email ?? "" };
      (rows ?? []).forEach((r: any) => {
        if (r.key in next) {
          (next as any)[r.key] = (r.value as any)?.v ?? (next as any)[r.key];
        }
      });
      setSettings(next);
      setLoading(false);
    })();
  }, []);

  const saveKey = (key: keyof AgentSettings, val: unknown) => {
    if (!shopId) return;
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(async () => {
      const { error } = await supabase
        .from("sonic_agent_settings")
        .upsert(
          { shop_id: shopId, key, value: { v: val } as any },
          { onConflict: "shop_id,key" }
        );
      if (error) toast.error(`Couldn't save ${key}`);
      else toast.success("Saved");
    }, 400);
  };

  const update = <K extends keyof AgentSettings>(key: K, val: AgentSettings[K]) => {
    setSettings((s) => ({ ...s, [key]: val }));
    saveKey(key, val);
  };

  const updateFlowOverride = (flow: string, mode: FlowMode | "default") => {
    const next = { ...settings.flow_overrides };
    if (mode === "default") delete next[flow];
    else next[flow] = mode;
    update("flow_overrides", next);
  };

  const effectiveMode = useMemo(
    () => (flow: string): FlowMode =>
      settings.flow_overrides[flow] ?? presetDefault(settings.autonomy_level, flow),
    [settings.autonomy_level, settings.flow_overrides]
  );

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading agent settings…</p>;
  }

  if (!shopId) {
    return (
      <p className="text-sm text-muted-foreground">
        Connect a shop first to configure the agent.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* Master kill switch */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Bot className="w-5 h-5 text-primary" />
            <div>
              <p className="text-base font-semibold">
                Agent is {settings.enabled ? "ON" : "OFF"}
              </p>
              <p className="text-xs text-muted-foreground">
                When off, cron jobs pause and the chat panel shows a paused notice.
              </p>
            </div>
          </div>
          <Switch
            checked={settings.enabled}
            onCheckedChange={(v) => update("enabled", v)}
          />
        </div>
      </div>

      {/* Dry-run */}
      <div
        className={`rounded-xl border p-4 ${
          settings.dry_run
            ? "border-amber-500/50 bg-amber-500/5"
            : "border-border bg-card"
        }`}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertTriangle
              className={`w-5 h-5 mt-0.5 ${
                settings.dry_run ? "text-amber-500" : "text-muted-foreground"
              }`}
            />
            <div>
              <p className="text-sm font-semibold">Dry-run mode</p>
              <p className="text-xs text-muted-foreground">
                Agent simulates actions and writes to the audit log only — no real
                Shopify, Xero, or Meta writes.
              </p>
              {settings.dry_run && (
                <Badge variant="outline" className="mt-2 border-amber-500/50 text-amber-600">
                  Simulating — no real changes
                </Badge>
              )}
            </div>
          </div>
          <Switch
            checked={settings.dry_run}
            disabled={!settings.enabled}
            onCheckedChange={(v) => update("dry_run", v)}
          />
        </div>
      </div>

      <Separator />

      {/* Autonomy level */}
      <div>
        <Label className="text-sm font-semibold">Autonomy level</Label>
        <p className="text-xs text-muted-foreground mb-2">
          Default behavior for all flows. You can override individual flows below.
        </p>
        <Select
          value={settings.autonomy_level}
          onValueChange={(v) => update("autonomy_level", v as Autonomy)}
        >
          <SelectTrigger className="w-full md:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="conservative">
              Conservative — every action needs approval
            </SelectItem>
            <SelectItem value="balanced">
              Balanced — content autonomous, money/ads gated
            </SelectItem>
            <SelectItem value="aggressive">
              Aggressive — social auto-publish, ±5% price match
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Advanced overrides */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium hover:text-primary">
          {advancedOpen ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
          Advanced flow overrides
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 space-y-4">
          {FLOWS.map((g) => (
            <div key={g.group} className="rounded-lg border border-border">
              <div className="px-3 py-2 border-b border-border bg-muted/30 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {g.group}
              </div>
              <div className="divide-y divide-border">
                {g.flows.map((f) => {
                  const override = settings.flow_overrides[f.name];
                  const eff = effectiveMode(f.name);
                  return (
                    <div
                      key={f.name}
                      className="flex items-center justify-between px-3 py-2 gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm">{f.label}</p>
                        <p className="text-[11px] text-muted-foreground">
                          Effective: <span className="font-mono">{eff}</span>
                          {!override && " (preset default)"}
                        </p>
                      </div>
                      <Select
                        value={override ?? "default"}
                        onValueChange={(v) =>
                          updateFlowOverride(f.name, v as FlowMode | "default")
                        }
                      >
                        <SelectTrigger className="w-40 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">Use preset</SelectItem>
                          <SelectItem value="autonomous">Autonomous</SelectItem>
                          <SelectItem value="approval">Approval</SelectItem>
                          <SelectItem value="disabled">Disabled</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>

      <Separator />

      {/* Approval expiry */}
      <div>
        <Label className="text-sm font-semibold">
          Approval expiry — {settings.approval_expiry_days}{" "}
          {settings.approval_expiry_days === 1 ? "day" : "days"}
        </Label>
        <p className="text-xs text-muted-foreground mb-2">
          Pending approvals auto-expire after this many days.
        </p>
        <Slider
          min={1}
          max={30}
          step={1}
          value={[settings.approval_expiry_days]}
          onValueChange={([v]) => update("approval_expiry_days", v)}
          className="max-w-md"
        />
      </div>

      <Separator />

      {/* Notifications */}
      <div className="space-y-3">
        <Label className="text-sm font-semibold">Notifications</Label>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Email digest of pending approvals</p>
            <Select
              value={settings.email_digest}
              onValueChange={(v) => update("email_digest", v as EmailDigest)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="daily_8am">Daily 8am</SelectItem>
                <SelectItem value="daily_5pm">Daily 5pm</SelectItem>
                <SelectItem value="on_new">On every new approval</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Send to</p>
            <Input
              type="email"
              placeholder={userEmail || "you@example.com"}
              value={settings.notify_email}
              onChange={(e) => update("notify_email", e.target.value)}
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Dollar threshold */}
      <div>
        <Label className="text-sm font-semibold">
          Auto-approve threshold — ${settings.dollar_threshold}
        </Label>
        <p className="text-xs text-muted-foreground mb-2">
          Auto-approve POs and ad spend changes under this amount. $0 means always
          require approval.
        </p>
        <Slider
          min={0}
          max={500}
          step={50}
          value={[settings.dollar_threshold]}
          onValueChange={([v]) => update("dollar_threshold", v)}
          className="max-w-md"
        />
      </div>

      <p className="text-[11px] text-muted-foreground bg-muted/40 rounded-md p-2 border border-border">
        Settings save instantly. The agent re-reads them at the start of each run, so
        changes propagate within one cron tick.
      </p>
    </div>
  );
};

export default AgentSettingsSection;
