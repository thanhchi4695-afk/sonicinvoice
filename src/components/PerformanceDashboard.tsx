import { useState, useEffect, useMemo } from "react";
import {
  ChevronLeft, TrendingUp, DollarSign, BarChart3, Eye, MousePointerClick,
  ShoppingCart, Target, ArrowUpRight, ArrowDownRight, Settings, AlertTriangle,
  RefreshCw, Calendar
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Area, AreaChart
} from "recharts";

/* ─── Types ─── */
interface PushRecord {
  id: string;
  created_at: string;
  products_created: number;
  products_updated: number;
  errors: number;
  store_url: string;
  source: string | null;
  summary: string | null;
}

interface CampaignMetrics {
  date: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  revenue: number;
}

interface Props {
  onBack: () => void;
}

/* ─── Helpers ─── */
const fmt = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtInt = (n: number) => n.toLocaleString();
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

type Range = "7d" | "30d" | "90d";

/* ─── Generate demo metrics from push history ─── */
function generateMetrics(pushHistory: PushRecord[], range: Range): CampaignMetrics[] {
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const now = new Date();
  const metrics: CampaignMetrics[] = [];
  const totalProducts = pushHistory.reduce((s, p) => s + p.products_created, 0);
  const baseMultiplier = Math.max(1, totalProducts / 10);

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];

    // Check if any pushes happened on or before this date
    const pushesBefore = pushHistory.filter(
      (p) => new Date(p.created_at) <= d
    ).length;

    if (pushesBefore === 0) continue;

    const dayVariance = 0.7 + Math.random() * 0.6;
    const weekday = d.getDay();
    const weekendFactor = weekday === 0 || weekday === 6 ? 0.7 : 1.1;
    const factor = dayVariance * weekendFactor * baseMultiplier;

    metrics.push({
      date: dateStr,
      impressions: Math.round(120 * factor),
      clicks: Math.round(8 * factor),
      spend: Math.round(25 * factor * 100) / 100,
      conversions: Math.round(1.2 * factor * 10) / 10,
      revenue: Math.round(85 * factor * 100) / 100,
    });
  }
  return metrics;
}

const PerformanceDashboard = ({ onBack }: Props) => {
  const [pushHistory, setPushHistory] = useState<PushRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>("30d");
  const [showSetup, setShowSetup] = useState(false);
  const [googleConnected] = useState(false); // Will be true when Google Ads API is connected

  // Load push history from database
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("shopify_push_history")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      setPushHistory((data as PushRecord[]) || []);
      setLoading(false);
    })();
  }, []);

  const metrics = useMemo(() => generateMetrics(pushHistory, range), [pushHistory, range]);

  const totals = useMemo(() => {
    const t = {
      impressions: 0, clicks: 0, spend: 0, conversions: 0, revenue: 0,
      productsPublished: 0, pushes: pushHistory.length, errors: 0,
    };
    metrics.forEach((m) => {
      t.impressions += m.impressions;
      t.clicks += m.clicks;
      t.spend += m.spend;
      t.conversions += m.conversions;
      t.revenue += m.revenue;
    });
    pushHistory.forEach((p) => {
      t.productsPublished += p.products_created;
      t.errors += p.errors;
    });
    return t;
  }, [metrics, pushHistory]);

  const roas = totals.spend > 0 ? totals.revenue / totals.spend : 0;
  const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  const convRate = totals.clicks > 0 ? (totals.conversions / totals.clicks) * 100 : 0;
  const cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;

  // Chart data for display
  const chartData = useMemo(() => {
    return metrics.map((m) => ({
      ...m,
      label: new Date(m.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      roas: m.spend > 0 ? m.revenue / m.spend : 0,
    }));
  }, [metrics]);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/95 backdrop-blur sticky top-0 z-10">
        <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold font-display truncate">Performance</h1>
          <p className="text-[10px] text-muted-foreground">ROAS, spend & conversion tracking</p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setShowSetup(!showSetup)}>
          <Settings className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-28">
        {/* Google Ads connection notice */}
        {!googleConnected && (
          <div className="rounded-lg bg-primary/10 border border-primary/20 p-3 flex items-start gap-3">
            <Target className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-semibold">Demo Mode</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Showing estimated metrics based on your publish history. Connect Google Ads API for real data.
              </p>
              <Button variant="outline" size="sm" className="mt-2 h-7 text-[10px]" onClick={() => setShowSetup(true)}>
                Connect Google Ads
              </Button>
            </div>
          </div>
        )}

        {/* Google Ads setup panel */}
        {showSetup && (
          <Card className="p-4 space-y-3 animate-in fade-in slide-in-from-top-2">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Settings className="w-4 h-4 text-primary" /> Google Ads Connection
            </h3>
            <p className="text-xs text-muted-foreground">
              To show real campaign data, you'll need to provide Google Ads API credentials.
            </p>
            <div className="space-y-2">
              {["Developer Token", "OAuth Client ID", "OAuth Client Secret", "Customer ID"].map((label) => (
                <div key={label}>
                  <label className="text-[10px] font-medium text-muted-foreground">{label}</label>
                  <Input className="h-8 text-xs mt-0.5" placeholder={`Enter ${label}...`} type="password" disabled />
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground italic">
              Google Ads API integration coming soon. Dashboard currently shows estimated metrics.
            </p>
            <Button variant="ghost" size="sm" className="w-full" onClick={() => setShowSetup(false)}>
              Close
            </Button>
          </Card>
        )}

        {/* Range selector */}
        <div className="flex gap-2">
          {(["7d", "30d", "90d"] as Range[]).map((r) => (
            <Button
              key={r}
              variant={range === r ? "default" : "outline"}
              size="sm"
              className="flex-1 h-8 text-xs"
              onClick={() => setRange(r)}
            >
              <Calendar className="w-3 h-3 mr-1" />
              {r === "7d" ? "7 Days" : r === "30d" ? "30 Days" : "90 Days"}
            </Button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-5 h-5 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 gap-3">
              <KPICard
                icon={TrendingUp}
                label="ROAS"
                value={`${roas.toFixed(2)}x`}
                trend={roas >= 3 ? "up" : roas >= 2 ? "neutral" : "down"}
                detail={roas >= 3 ? "Strong" : roas >= 2 ? "Good" : "Below target"}
              />
              <KPICard
                icon={DollarSign}
                label="Total Spend"
                value={fmt(totals.spend)}
                detail={`${fmt(totals.spend / Math.max(1, metrics.length))}/day avg`}
              />
              <KPICard
                icon={ShoppingCart}
                label="Revenue"
                value={fmt(totals.revenue)}
                trend="up"
                detail={`${fmtInt(Math.round(totals.conversions))} conversions`}
              />
              <KPICard
                icon={MousePointerClick}
                label="Clicks"
                value={fmtInt(totals.clicks)}
                detail={`${fmtPct(ctr)} CTR · ${fmt(cpc)} CPC`}
              />
            </div>

            {/* Pipeline Stats */}
            <Card className="p-4 space-y-3">
              <h3 className="text-xs font-semibold flex items-center gap-2">
                <BarChart3 className="w-3.5 h-3.5 text-primary" /> Pipeline Activity
              </h3>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-xl font-bold text-primary">{totals.productsPublished}</p>
                  <p className="text-[9px] text-muted-foreground">Published</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-foreground">{totals.pushes}</p>
                  <p className="text-[9px] text-muted-foreground">Pushes</p>
                </div>
                <div>
                  <p className={`text-xl font-bold ${totals.errors > 0 ? "text-destructive" : "text-primary"}`}>
                    {totals.errors}
                  </p>
                  <p className="text-[9px] text-muted-foreground">Errors</p>
                </div>
              </div>
            </Card>

            {/* Revenue Chart */}
            {chartData.length > 0 && (
              <Card className="p-4 space-y-3">
                <h3 className="text-xs font-semibold">Revenue vs Spend</h3>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "11px",
                        }}
                      />
                      <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" fill="url(#revGrad)" name="Revenue" />
                      <Area type="monotone" dataKey="spend" stroke="hsl(var(--destructive))" fill="none" name="Spend" strokeDasharray="4 4" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            )}

            {/* ROAS Chart */}
            {chartData.length > 0 && (
              <Card className="p-4 space-y-3">
                <h3 className="text-xs font-semibold">Daily ROAS</h3>
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "11px",
                        }}
                        formatter={(value: number) => [`${value.toFixed(2)}x`, "ROAS"]}
                      />
                      <Bar dataKey="roas" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="ROAS" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            )}

            {/* Conversion Funnel */}
            <Card className="p-4 space-y-3">
              <h3 className="text-xs font-semibold">Conversion Funnel</h3>
              <FunnelRow label="Impressions" value={totals.impressions} max={totals.impressions} />
              <FunnelRow label="Clicks" value={totals.clicks} max={totals.impressions} detail={fmtPct(ctr)} />
              <FunnelRow label="Conversions" value={Math.round(totals.conversions)} max={totals.impressions} detail={fmtPct(convRate)} />
            </Card>

            {/* Recent Pushes */}
            {pushHistory.length > 0 && (
              <Card className="p-4 space-y-3">
                <h3 className="text-xs font-semibold">Recent Publishes</h3>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {pushHistory.slice(0, 10).map((p) => (
                    <div key={p.id} className="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg bg-muted/30">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{p.source || "Manual push"}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(p.created_at).toLocaleDateString()} · {p.products_created} products
                        </p>
                      </div>
                      {p.errors > 0 && (
                        <span className="text-destructive text-[10px] flex items-center gap-0.5">
                          <AlertTriangle className="w-3 h-3" /> {p.errors}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Empty state */}
            {pushHistory.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">No publish history yet</p>
                <p className="text-xs mt-1">Use the Publish & Promote pipeline to see data here.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

/* ─── Sub-components ─── */
function KPICard({ icon: Icon, label, value, trend, detail }: {
  icon: React.ElementType; label: string; value: string;
  trend?: "up" | "down" | "neutral"; detail?: string;
}) {
  return (
    <Card className="p-3 space-y-1">
      <div className="flex items-center justify-between">
        <Icon className="w-4 h-4 text-primary" />
        {trend === "up" && <ArrowUpRight className="w-3.5 h-3.5 text-primary" />}
        {trend === "down" && <ArrowDownRight className="w-3.5 h-3.5 text-destructive" />}
      </div>
      <p className="text-xl font-bold">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      {detail && <p className="text-[9px] text-muted-foreground">{detail}</p>}
    </Card>
  );
}

function FunnelRow({ label, value, max, detail }: {
  label: string; value: number; max: number; detail?: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span>{label}</span>
        <span className="font-mono text-muted-foreground">
          {fmtInt(value)} {detail && <span className="text-primary ml-1">{detail}</span>}
        </span>
      </div>
      <Progress value={pct} className="h-2" />
    </div>
  );
}

export default PerformanceDashboard;
