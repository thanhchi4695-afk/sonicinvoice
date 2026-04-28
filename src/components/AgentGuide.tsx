// ════════════════════════════════════════════════════════════════
// AgentGuide — In-app guide for the 5-agent automation system.
// Each section explains what the agent does, how to activate it,
// what runs automatically, and what needs human input.
// ════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { Eye, Layers, Sparkles, Rocket, Brain, ArrowLeft, CheckCircle2, AlertCircle, ExternalLink, Search, Building2, Globe2, ShieldCheck, Workflow } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  onBack?: () => void;
  onOpenAutomation?: () => void;
}

interface Stats {
  gmailConnected: boolean;
  gmailEmail: string | null;
  gmailLastChecked: string | null;
  emailMonitoring: boolean;
  autoPublish: boolean;
  totalSuppliers: number;
  trainedSuppliers: SupplierMini[];
  productsEnriched: number;
  productsWithDesc: number;
  productsWithImage: number;
  eligibleSuppliers: SupplierMini[];
  totalInvoices: number;
  sharedSuppliers: number;
  sharedRetailers: number;
  verifiedSuppliers: number;
}

interface SupplierMini {
  supplier_name: string;
  invoice_count: number;
  confidence_score: number;
  correction_rate: number | null;
  auto_publish_eligible: boolean | null;
}

const AgentGuide = ({ onBack, onOpenAutomation }: Props) => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) { setLoading(false); return; }

    const [gmail, settings, suppliers, prods, shared] = await Promise.all([
      supabase.from("gmail_connections").select("email_address,last_checked_at").eq("user_id", userId).maybeSingle(),
      supabase.from("user_settings").select("automation_email_monitoring,automation_auto_publish").eq("user_id", userId).maybeSingle(),
      supabase.from("supplier_profiles").select("supplier_name,invoice_count,confidence_score,correction_rate,auto_publish_eligible").eq("user_id", userId).order("invoice_count", { ascending: false }).limit(20),
      supabase.from("products").select("id,description,image_url", { count: "exact", head: false }).eq("user_id", userId).limit(5000),
      supabase.from("shared_supplier_profiles").select("supplier_name,contributing_users,is_verified").limit(500),
    ]);

    const trainedSuppliers = (suppliers.data ?? []) as SupplierMini[];
    const productRows = prods.data ?? [];
    const sharedRows = shared.data ?? [];
    const allRetailers = new Set<number>();
    sharedRows.forEach((r: any) => allRetailers.add(r.contributing_users ?? 0));

    setStats({
      gmailConnected: !!gmail.data,
      gmailEmail: gmail.data?.email_address ?? null,
      gmailLastChecked: gmail.data?.last_checked_at ?? null,
      emailMonitoring: !!settings.data?.automation_email_monitoring,
      autoPublish: !!settings.data?.automation_auto_publish,
      totalSuppliers: trainedSuppliers.length,
      trainedSuppliers: trainedSuppliers.slice(0, 5),
      productsEnriched: productRows.length,
      productsWithDesc: productRows.filter((p: any) => p.description).length,
      productsWithImage: productRows.filter((p: any) => p.image_url).length,
      eligibleSuppliers: trainedSuppliers.filter((s) => s.auto_publish_eligible),
      totalInvoices: trainedSuppliers.reduce((n, s) => n + (s.invoice_count ?? 0), 0),
      sharedSuppliers: sharedRows.length,
      sharedRetailers: sharedRows.reduce((n: number, r: any) => Math.max(n, r.contributing_users ?? 0), 0),
      verifiedSuppliers: sharedRows.filter((r: any) => r.is_verified).length,
    });
    setLoading(false);
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 pb-24 lg:p-6">
      <div className="flex items-center gap-3">
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        )}
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">How automation works</h1>
          <p className="text-sm text-muted-foreground">5 AI agents that turn invoice chaos into a hands-free pipeline.</p>
        </div>
      </div>

      <AgentSection
        number={1}
        name="The Watchdog"
        icon={Eye}
        accent="text-primary"
        description="Watches your Gmail inbox and detects supplier invoice emails automatically."
        active={stats?.gmailConnected && stats?.emailMonitoring}
        statusActive={stats?.gmailEmail ? `Active — watching ${stats.gmailEmail}` : "Active"}
        statusInactive="Not connected"
        statusExtra={stats?.gmailLastChecked ? `Last checked: ${formatTime(stats.gmailLastChecked)}` : null}
        activate={[
          "Go to Account → Automation",
          'Click "Connect Gmail"',
          "Sign in with your Google account",
          'Turn on "Email monitoring"',
        ]}
        automatic={[
          "Gmail inbox scanned every 15 minutes",
          "Invoice emails detected by supplier domain or attachment filename",
          "Invoice file downloaded automatically",
          "Watchdog Agent triggered immediately",
        ]}
        manual={[
          "Connect Gmail once (takes 2 minutes)",
          "Add supplier email domains to help detection (optional)",
          "Review any invoices flagged as needing attention",
        ]}
        cta={!stats?.gmailConnected || !stats?.emailMonitoring ? { label: "Activate Watchdog", onClick: onOpenAutomation } : undefined}
      />

      <AgentSection
        number={2}
        name="The Classifier"
        icon={Layers}
        accent="text-blue-500"
        description="Identifies your supplier and reads the invoice layout before extracting any products — like a human reading a document for the first time."
        active
        statusActive="Always active"
        statusInactive=""
        activate={["Always active — runs automatically on every invoice upload.", "No setup required."]}
        automatic={[
          "Stage 1: Identifies supplier name, document type, currency, GST treatment",
          "Stage 2: Maps column headers to standard fields (cost, RRP, SKU, etc.)",
          "Stage 3: Validates all extracted data and flags issues",
          "For known suppliers: skips Stage 1 and uses your saved template",
        ]}
        manual={[
          "Review any amber-flagged products on the Review screen",
          "Correct any misread fields — each correction trains the system",
        ]}
      >
        {stats && stats.trainedSuppliers.length > 0 && (
          <div className="mt-3 rounded-lg border border-border bg-muted/20">
            <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Top trained suppliers
            </div>
            <div className="divide-y divide-border">
              {stats.trainedSuppliers.map((s) => (
                <div key={s.supplier_name} className="flex items-center justify-between px-3 py-2 text-xs">
                  <span className="font-medium text-foreground">{s.supplier_name}</span>
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <span>{s.invoice_count} invoices</span>
                    <Badge variant={s.confidence_score >= 90 ? "default" : "secondary"} className="text-[10px]">
                      {Math.round(s.confidence_score ?? 0)}%
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </AgentSection>

      <AgentSection
        number={3}
        name="The Enrichment Agent"
        icon={Sparkles}
        accent="text-purple-500"
        description="Automatically fetches product descriptions, images, and market prices from Australian brand websites and retailers — while you review."
        active
        statusActive="Always active"
        statusInactive=""
        activate={["Always active — runs automatically after every invoice is processed.", "No setup required."]}
        automatic={[
          "Runs in parallel for all new products",
          "Fetches description from brand website",
          "Searches for product images",
          "Checks Australian retailers for current market RRP",
          "Updates the Review screen live as results arrive",
        ]}
        manual={[
          "Nothing — enrichment is fully automatic",
          "You can override any fetched data on the Review screen",
          'If enrichment fails, a "Fetch failed" badge appears with a Retry button',
        ]}
      >
        {stats && (
          <div className="mt-3 rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{stats.productsEnriched}</span> products enriched ·{" "}
            <span className="font-semibold text-foreground">{stats.productsWithDesc}</span> descriptions ·{" "}
            <span className="font-semibold text-foreground">{stats.productsWithImage}</span> images
          </div>
        )}
      </AgentSection>

      <AgentSection
        number={4}
        name="The Publishing Agent"
        icon={Rocket}
        accent="text-success"
        description="Pushes approved products directly to your Shopify or Lightspeed store without manual CSV upload or import."
        active={stats?.autoPublish && (stats?.eligibleSuppliers.length ?? 0) > 0}
        statusActive={`Active — ${stats?.eligibleSuppliers.length ?? 0} eligible suppliers`}
        statusInactive="Auto-publish disabled"
        activate={[
          "Manual: always available via the Push to Shopify button on the Review screen",
          "For automatic: Connect Shopify (Settings → Integrations)",
          'Account → Automation → Enable "Auto-publish for trained suppliers"',
          "Process 10+ invoices from a supplier to reach 90% confidence",
        ]}
        automatic={[
          "Products from suppliers above 90% confidence are published automatically",
          "Retries any failed products up to 3×",
          'Sends notification when complete: "23 Seafolly products are now live"',
        ]}
        manual={[
          "Approve any products below confidence threshold on the Review screen",
          "Connect Shopify once",
        ]}
        cta={!stats?.autoPublish ? { label: "Open Automation Settings", onClick: onOpenAutomation } : undefined}
      >
        {stats && stats.eligibleSuppliers.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {stats.eligibleSuppliers.slice(0, 6).map((s) => (
              <Badge key={s.supplier_name} variant="default" className="bg-success text-success-foreground">
                ✓ {s.supplier_name}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            Process 10 invoices from any supplier to unlock auto-publishing for that supplier.
          </p>
        )}
      </AgentSection>

      <AgentSection
        number={5}
        name="The Learning Agent"
        icon={Brain}
        accent="text-amber-500"
        description="Records every correction you make and updates the Supplier Brain so the next invoice from the same supplier needs fewer corrections."
        active
        statusActive="Always active"
        statusInactive=""
        activate={["Always active — runs automatically after every accepted invoice.", "No setup required."]}
        automatic={[
          "Records correction count per invoice",
          "Updates supplier confidence score",
          "Contributes to shared supplier network (anonymised — structure only, never your prices or quantities)",
          "Triggers auto-publish eligibility when confidence reaches 90%",
        ]}
        manual={[
          "Nothing — learning is fully automatic",
          "The more invoices you process, the smarter it gets",
        ]}
      >
        {stats && (
          <div className="mt-3 space-y-2">
            <div className="rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">
              Sonic Invoice has learned from{" "}
              <span className="font-semibold text-foreground">{stats.sharedSuppliers}</span> suppliers across{" "}
              <span className="font-semibold text-foreground">{stats.sharedRetailers}</span> retailers.{" "}
              <span className="font-semibold text-foreground">{stats.verifiedSuppliers}</span> are community-verified.
            </div>
            {stats.trainedSuppliers[0] && (
              <div className="rounded-lg border border-border bg-card p-3 text-xs">
                <span className="font-semibold text-foreground">{stats.trainedSuppliers[0].supplier_name}:</span>{" "}
                {stats.trainedSuppliers[0].invoice_count} invoices ·{" "}
                {Math.round(stats.trainedSuppliers[0].confidence_score ?? 0)}% confidence ·{" "}
                {Math.round((stats.trainedSuppliers[0].correction_rate ?? 0) * 100)}% correction rate
                {stats.trainedSuppliers[0].auto_publish_eligible && (
                  <span className="ml-2 text-success">· Auto-publish eligible ✓</span>
                )}
              </div>
            )}
          </div>
        )}
      </AgentSection>

      {loading && <p className="text-center text-xs text-muted-foreground">Loading live stats…</p>}
    </div>
  );
};

// ── Section component ──────────────────────────────────────────
interface SectionProps {
  number: number;
  name: string;
  icon: React.ElementType;
  accent: string;
  description: string;
  active?: boolean;
  statusActive: string;
  statusInactive: string;
  statusExtra?: string | null;
  activate: string[];
  automatic: string[];
  manual: string[];
  cta?: { label: string; onClick?: () => void };
  children?: React.ReactNode;
}

const AgentSection = ({
  number, name, icon: Icon, accent, description,
  active, statusActive, statusInactive, statusExtra,
  activate, automatic, manual, cta, children,
}: SectionProps) => (
  <Card>
    <CardHeader className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg bg-muted ${accent}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Agent {number}</p>
            <CardTitle className="text-lg">{name}</CardTitle>
          </div>
        </div>
        {active ? (
          <Badge className="bg-success text-success-foreground">
            <CheckCircle2 className="mr-1 h-3 w-3" /> {statusActive}
          </Badge>
        ) : (
          <Badge variant="secondary">
            <AlertCircle className="mr-1 h-3 w-3" /> {statusInactive}
          </Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>
      {statusExtra && <p className="text-xs text-muted-foreground">{statusExtra}</p>}
    </CardHeader>
    <CardContent className="space-y-4 text-sm">
      <Block title="How to activate" items={activate} />
      <Block title="What happens automatically" items={automatic} />
      <Block title="What needs your input" items={manual} />
      {children}
      {cta && (
        <Button size="sm" onClick={cta.onClick} variant="outline">
          {cta.label} <ExternalLink className="h-3 w-3" />
        </Button>
      )}
    </CardContent>
  </Card>
);

const Block = ({ title, items }: { title: string; items: string[] }) => (
  <div>
    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
    <ul className="space-y-1 pl-4">
      {items.map((it, i) => (
        <li key={i} className="list-disc text-muted-foreground marker:text-muted-foreground/50">
          {it}
        </li>
      ))}
    </ul>
  </div>
);

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}

export default AgentGuide;
