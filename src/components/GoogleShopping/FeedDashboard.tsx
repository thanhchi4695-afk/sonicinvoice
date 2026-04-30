import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  Clock,
  Send,
  AlertTriangle,
  Ban,
  Package,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ───────────────────────── Types ─────────────────────────

interface FeedCounts {
  total: number;
  eligible: number;
  pending: number;
  submitted: number;
  submittedWithWarnings: number;
  excluded: number;
}

interface TopError {
  code: string;
  label: string;
  count: number;
}

interface FeedStatusResponse {
  counts: FeedCounts;
  topErrors: TopError[];
  source: "gmc" | "shopify-fallback";
  fetchedAt: string;
  warning?: string;
}

interface CachedPayload extends FeedStatusResponse {
  cachedAt: number;
}

// ───────────────────────── Cache helpers ─────────────────────────

const CACHE_KEY = "google-feed-dashboard:v1";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const AUTO_REFRESH_MS = 5 * 60 * 1000;

function readCache(): CachedPayload | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPayload;
    if (Date.now() - parsed.cachedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(payload: FeedStatusResponse) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ ...payload, cachedAt: Date.now() }),
    );
  } catch {
    /* ignore quota errors */
  }
}

// ───────────────────────── Stat Card ─────────────────────────

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ElementType;
  tone: "default" | "success" | "info" | "warning" | "danger" | "muted";
  loading?: boolean;
}

const TONE_CLASS: Record<StatCardProps["tone"], string> = {
  default: "text-foreground bg-muted",
  success: "text-emerald-600 bg-emerald-500/10",
  info: "text-blue-600 bg-blue-500/10",
  warning: "text-amber-600 bg-amber-500/10",
  danger: "text-destructive bg-destructive/10",
  muted: "text-muted-foreground bg-muted",
};

function StatCard({ label, value, icon: Icon, tone, loading }: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground truncate">
              {label}
            </p>
            {loading ? (
              <Skeleton className="h-8 w-20 mt-2" />
            ) : (
              <p className="text-2xl font-semibold tabular-nums mt-1">
                {value.toLocaleString()}
              </p>
            )}
          </div>
          <div className={cn("p-2 rounded-md shrink-0", TONE_CLASS[tone])}>
            <Icon className="w-4 h-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ───────────────────────── Main component ─────────────────────────

interface FeedDashboardProps {
  onBack?: () => void;
}

export default function FeedDashboard({ onBack }: FeedDashboardProps) {
  const [data, setData] = useState<FeedStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<number | null>(null);

  const fetchStatus = useCallback(async (force = false) => {
    if (!force) {
      const cached = readCache();
      if (cached) {
        setData(cached);
        setLoading(false);
        return;
      }
    }
    if (force) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const { data: resp, error: invokeErr } = await supabase.functions.invoke(
        "google-merchant-status",
        { body: {} },
      );
      if (invokeErr) throw new Error(invokeErr.message);
      if (resp?.error) throw new Error(resp.error);
      const payload = resp as FeedStatusResponse;
      writeCache(payload);
      setData(payload);
      if (force) toast.success("Feed status refreshed");
    } catch (e) {
      const msg = (e as Error).message || "Failed to load feed status";
      setError(msg);
      if (force) toast.error(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus(false);
    intervalRef.current = window.setInterval(() => {
      fetchStatus(true);
    }, AUTO_REFRESH_MS);
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [fetchStatus]);

  const counts = data?.counts;
  const fetchedAtLabel = useMemo(() => {
    if (!data?.fetchedAt) return null;
    try {
      return new Date(data.fetchedAt).toLocaleTimeString();
    } catch {
      return null;
    }
  }, [data?.fetchedAt]);

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {onBack && (
            <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
          )}
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold truncate">
              Google Shopping Feed
            </h1>
            <p className="text-xs text-muted-foreground">
              Eligibility overview and Merchant Center status
              {fetchedAtLabel ? ` · last refreshed ${fetchedAtLabel}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {data?.source && (
            <Badge variant="outline" className="text-[10px]">
              {data.source === "gmc" ? "Live GMC" : "Shopify fallback"}
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchStatus(true)}
            disabled={refreshing || loading}
          >
            <RefreshCw className={cn("w-4 h-4 mr-1.5", refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Warnings */}
      {data?.warning && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{data.warning}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Stat grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          label="Total products"
          value={counts?.total ?? 0}
          icon={Package}
          tone="default"
          loading={loading}
        />
        <StatCard
          label="Eligible"
          value={counts?.eligible ?? 0}
          icon={CheckCircle2}
          tone="success"
          loading={loading}
        />
        <StatCard
          label="Pending"
          value={counts?.pending ?? 0}
          icon={Clock}
          tone="info"
          loading={loading}
        />
        <StatCard
          label="Submitted"
          value={counts?.submitted ?? 0}
          icon={Send}
          tone="info"
          loading={loading}
        />
        <StatCard
          label="With warnings"
          value={counts?.submittedWithWarnings ?? 0}
          icon={AlertTriangle}
          tone="warning"
          loading={loading}
        />
        <StatCard
          label="Excluded"
          value={counts?.excluded ?? 0}
          icon={Ban}
          tone="muted"
          loading={loading}
        />
      </div>

      {/* Top errors */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top issues to fix</CardTitle>
          <CardDescription>
            Errors are pulled from Merchant Center via{" "}
            <code className="text-[11px]">productstatuses.list</code>. Fix these
            to move products from <em>Disapproved</em> into <em>Eligible</em>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !data?.topErrors?.length ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No issues detected. Your products meet all required attributes.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {data.topErrors.map((err) => (
                <li
                  key={err.code}
                  className="flex items-center justify-between py-2.5"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{err.label}</p>
                      <p className="text-xs text-muted-foreground">
                        Code: <code>{err.code}</code>
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="tabular-nums shrink-0">
                    {err.count.toLocaleString()} products
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
