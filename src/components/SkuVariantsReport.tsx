import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
  Download,
  Save,
  Settings2,
  ChevronLeft,
  ChevronRight,
  Zap,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { addAuditEntry } from "@/lib/audit-log";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format, subDays } from "date-fns";
import LocationFilter from "@/components/LocationFilter";
import { useShopifyLocations } from "@/hooks/use-shopify-locations";
import {
  type RestockStatus,
  RESTOCK_STATUS_LABEL,
  loadRestockOverrides,
  buildSupplierDefaultMap,
  resolveRestockStatus,
} from "@/lib/restock-status";
import RestockStatusCell from "@/components/RestockStatusCell";

// ── Types ────────────────────────────────────────────────────────────

interface Row {
  variantId: string;
  productId: string;
  shopifyProductId: string;
  shopifyVariantId: string;
  vendor: string;
  productTitle: string;
  productType: string;
  variantTitle: string;
  sku: string;
  barcode: string;
  available: number;
  byLocation: Record<string, number>;
  cost: number;
  retailPrice: number;
  marginPct: number;
  units30: number;
  units90: number;
  units365: number;
  refunds30: number;
  cancelled30: number;
  salesPerDay: number;
  daysUntilDepletion: number;
  abc: "A" | "B" | "C" | "U";
  revenue365: number;
  onOrder: number;
  lastReceivedAt: Date | null;
  firstReceivedAt: Date | null;
  totalRetailValue: number;
  totalCostValue: number;
  restockStatus: import("@/lib/restock-status").RestockStatus;
  shopDomain: string | null;
}

type FilterState = {
  vendors: string[];
  productTypes: string[];
  abc: ("A" | "B" | "C" | "U")[];
  availMin: string;
  availMax: string;
  daysMin: string;
  daysMax: string;
  s30Min: string;
  s30Max: string;
  marginMin: string;
  marginMax: string;
  hasBarcode: boolean;
  zeroOnly: boolean;
};

const DEFAULT_FILTERS: FilterState = {
  vendors: [],
  productTypes: [],
  abc: [],
  availMin: "",
  availMax: "",
  daysMin: "",
  daysMax: "",
  s30Min: "",
  s30Max: "",
  marginMin: "",
  marginMax: "",
  hasBarcode: false,
  zeroOnly: false,
};

// ── Column definitions ───────────────────────────────────────────────

type ColKey =
  | "vendor" | "productTitle" | "variantTitle" | "sku" | "barcode"
  | "available" | "cost" | "retailPrice" | "marginPct"
  | "units30" | "units90" | "units365" | "salesPerDay"
  | "daysUntilDepletion" | "abc" | "onOrder" | "lastReceivedAt"
  | "shopifyProductId" | "shopifyVariantId" | "productType"
  | "compareAtPrice" | "totalRetailValue" | "totalCostValue"
  | "refunds30" | "cancelled30" | "firstReceivedAt" | "weight";

interface ColDef {
  key: ColKey;
  label: string;
  defaultVisible: boolean;
  numeric?: boolean;
  width?: string;
}

const COLUMNS: ColDef[] = [
  { key: "vendor", label: "Vendor", defaultVisible: true },
  { key: "productTitle", label: "Product", defaultVisible: true },
  { key: "variantTitle", label: "Variant", defaultVisible: true },
  { key: "sku", label: "SKU", defaultVisible: true },
  { key: "barcode", label: "Barcode", defaultVisible: true },
  { key: "available", label: "Available", defaultVisible: true, numeric: true },
  { key: "cost", label: "Cost", defaultVisible: true, numeric: true },
  { key: "retailPrice", label: "Retail", defaultVisible: true, numeric: true },
  { key: "marginPct", label: "Margin %", defaultVisible: true, numeric: true },
  { key: "units30", label: "Sold 30d", defaultVisible: true, numeric: true },
  { key: "units90", label: "Sold 90d", defaultVisible: true, numeric: true },
  { key: "units365", label: "Sold 12mo", defaultVisible: true, numeric: true },
  { key: "salesPerDay", label: "Sales/day", defaultVisible: true, numeric: true },
  { key: "daysUntilDepletion", label: "Days to depletion", defaultVisible: true, numeric: true },
  { key: "abc", label: "ABC", defaultVisible: true },
  { key: "onOrder", label: "On order", defaultVisible: true, numeric: true },
  { key: "lastReceivedAt", label: "Last received", defaultVisible: true },
  // Optional (off by default)
  { key: "shopifyProductId", label: "Shopify product ID", defaultVisible: false },
  { key: "shopifyVariantId", label: "Shopify variant ID", defaultVisible: false },
  { key: "productType", label: "Product type", defaultVisible: false },
  { key: "compareAtPrice", label: "Compare-at price", defaultVisible: false, numeric: true },
  { key: "totalRetailValue", label: "Total retail value", defaultVisible: false, numeric: true },
  { key: "totalCostValue", label: "Total cost value", defaultVisible: false, numeric: true },
  { key: "refunds30", label: "Refunds 30d", defaultVisible: false, numeric: true },
  { key: "cancelled30", label: "Cancelled 30d", defaultVisible: false, numeric: true },
  { key: "firstReceivedAt", label: "First received", defaultVisible: false },
  { key: "weight", label: "Weight", defaultVisible: false, numeric: true },
  { key: "restockStatus", label: "Restock", defaultVisible: true },
];

const DEFAULT_COLS: Record<ColKey, boolean> = COLUMNS.reduce((acc, c) => {
  acc[c.key] = c.defaultVisible;
  return acc;
}, {} as Record<ColKey, boolean>);

// ── Cache ────────────────────────────────────────────────────────────

const CACHE_KEY = "sku_variants_report_cache_v1";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const REPORT_KEY = "sku_variants";
const PAGE_SIZE = 100;

interface CachedPayload {
  fetchedAt: number;
  rows: Row[];
}

function loadCache(): CachedPayload | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPayload;
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    parsed.rows.forEach((r) => {
      r.lastReceivedAt = r.lastReceivedAt ? new Date(r.lastReceivedAt) : null;
      r.firstReceivedAt = r.firstReceivedAt ? new Date(r.firstReceivedAt) : null;
    });
    return parsed;
  } catch {
    return null;
  }
}

function saveCache(rows: Row[]) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ fetchedAt: Date.now(), rows }),
    );
  } catch {
    /* ignore */
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function fmtNum(n: number, dp = 0) {
  if (!isFinite(n)) return "∞";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

function fmtMoney(n: number) {
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function abcBadge(grade: Row["abc"]) {
  const map: Record<Row["abc"], string> = {
    A: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
    B: "bg-blue-500/15 text-blue-700 border-blue-500/30",
    C: "bg-amber-500/15 text-amber-700 border-amber-500/30",
    U: "bg-muted text-muted-foreground border-border",
  };
  return (
    <Badge variant="outline" className={cn("text-[10px] font-mono", map[grade])}>
      {grade}
    </Badge>
  );
}

function csvEscape(v: unknown) {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

function downloadCSV(rows: Row[]) {
  if (!rows.length) {
    toast.error("Nothing to export");
    return;
  }
  // Always export ALL columns, regardless of UI toggles
  const headers = COLUMNS.map((c) => c.label);
  const lines = rows.map((r) =>
    COLUMNS.map((c) => {
      switch (c.key) {
        case "vendor": return r.vendor;
        case "productTitle": return r.productTitle;
        case "variantTitle": return r.variantTitle;
        case "sku": return r.sku;
        case "barcode": return r.barcode;
        case "available": return r.available;
        case "cost": return r.cost.toFixed(2);
        case "retailPrice": return r.retailPrice.toFixed(2);
        case "marginPct": return r.marginPct.toFixed(1);
        case "units30": return r.units30;
        case "units90": return r.units90;
        case "units365": return r.units365;
        case "salesPerDay": return r.salesPerDay.toFixed(2);
        case "daysUntilDepletion":
          return isFinite(r.daysUntilDepletion) ? r.daysUntilDepletion : "∞";
        case "abc": return r.abc;
        case "onOrder": return r.onOrder;
        case "lastReceivedAt": return r.lastReceivedAt ? format(r.lastReceivedAt, "yyyy-MM-dd") : "";
        case "shopifyProductId": return r.shopifyProductId;
        case "shopifyVariantId": return r.shopifyVariantId;
        case "productType": return r.productType;
        case "compareAtPrice": return ""; // not tracked
        case "totalRetailValue": return r.totalRetailValue.toFixed(2);
        case "totalCostValue": return r.totalCostValue.toFixed(2);
        case "refunds30": return r.refunds30;
        case "cancelled30": return r.cancelled30;
        case "firstReceivedAt": return r.firstReceivedAt ? format(r.firstReceivedAt, "yyyy-MM-dd") : "";
        case "weight": return ""; // not tracked
      }
    })
      .map(csvEscape)
      .join(","),
  );
  const csv = [headers.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sku-variants-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  addAuditEntry("Export CSV", "sku-variants-report.csv");
}

// ── Component ────────────────────────────────────────────────────────

const SkuVariantsReport = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  const { selected: globalLocSelected, selectedLocation: globalLocObj } =
    useShopifyLocations();

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [visibleCols, setVisibleCols] = useState<Record<ColKey, boolean>>(DEFAULT_COLS);
  const [sortKey, setSortKey] = useState<ColKey>("vendor");
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(1);

  const [savedReports, setSavedReports] = useState<
    { id: string; report_name: string; filter_state: FilterState; column_state: Record<ColKey, boolean> }[]
  >([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");

  // ── Fetch saved reports ──
  const fetchSavedReports = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("user_saved_reports")
      .select("id, report_name, filter_state, column_state")
      .eq("user_id", user.id)
      .eq("report_key", REPORT_KEY)
      .order("created_at", { ascending: false });
    setSavedReports((data || []) as any);
  }, []);

  useEffect(() => {
    fetchSavedReports();
  }, [fetchSavedReports]);

  // ── Fetch data ──
  const fetchData = useCallback(async (force = false) => {
    if (!force) {
      const cached = loadCache();
      if (cached) {
        setRows(cached.rows);
        setFetchedAt(cached.fetchedAt);
        return;
      }
    }
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const since30 = subDays(new Date(), 30).toISOString();
      const since90 = subDays(new Date(), 90).toISOString();
      const since365 = subDays(new Date(), 365).toISOString();

      const [variantsRes, productsRes, inventoryRes, sales365Res, poRes, poLinesRes, importsRes] =
        await Promise.all([
          supabase.from("variants")
            .select("id, sku, color, size, barcode, product_id, retail_price, cost, quantity, shopify_variant_id")
            .eq("user_id", user.id),
          supabase.from("products")
            .select("id, title, vendor, product_type, shopify_product_id")
            .eq("user_id", user.id),
          supabase.from("inventory")
            .select("variant_id, location, quantity")
            .eq("user_id", user.id),
          supabase.from("sales_data")
            .select("variant_id, quantity_sold, sold_at, refund_amount")
            .eq("user_id", user.id)
            .gte("sold_at", since365),
          supabase.from("purchase_orders")
            .select("id, status")
            .eq("user_id", user.id)
            .in("status", ["draft", "sent", "partial", "partially_received"]),
          supabase.from("purchase_order_lines")
            .select("purchase_order_id, shopify_variant_id, sku, expected_qty, received_qty")
            .eq("user_id", user.id),
          supabase.from("inventory_import_runs")
            .select("style_number, completed_at, started_at, source")
            .eq("user_id", user.id)
            .order("completed_at", { ascending: false })
            .limit(2000),
        ]);

      const variants = variantsRes.data || [];
      const products = productsRes.data || [];
      const inventory = inventoryRes.data || [];
      const sales = (sales365Res.data || []) as any[];
      const openPOs = new Set((poRes.data || []).map((p) => p.id));
      const poLines = poLinesRes.data || [];
      const imports = importsRes.data || [];

      // ── Prefer cached ABC grades from the dedicated ABC report when available ──
      const { data: cachedAbc } = await supabase
        .from("product_abc_grades")
        .select("variant_id, grade")
        .eq("user_id", user.id)
        .eq("period_days", 365);
      const cachedAbcMap = new Map<string, "A" | "B" | "C" | "U">(
        (cachedAbc || []).map((r) => [r.variant_id as string, r.grade as "A" | "B" | "C" | "U"]),
      );

      const productMap = new Map(products.map((p) => [p.id, p]));

      // sales aggregation per variant + windows
      const sales30 = new Map<string, number>();
      const sales90 = new Map<string, number>();
      const sales365Map = new Map<string, number>();
      const refunds30 = new Map<string, number>();
      const revenue365 = new Map<string, number>();
      const t30 = Date.parse(since30);
      const t90 = Date.parse(since90);

      sales.forEach((s) => {
        if (!s.variant_id) return;
        const t = s.sold_at ? Date.parse(s.sold_at) : 0;
        const q = s.quantity_sold || 0;
        sales365Map.set(s.variant_id, (sales365Map.get(s.variant_id) || 0) + q);
        if (t >= t90) sales90.set(s.variant_id, (sales90.get(s.variant_id) || 0) + q);
        if (t >= t30) {
          sales30.set(s.variant_id, (sales30.get(s.variant_id) || 0) + q);
          if ((s.refund_amount || 0) > 0) {
            refunds30.set(s.variant_id, (refunds30.get(s.variant_id) || 0) + 1);
          }
        }
      });

      // revenue by variant for ABC grading (uses retail × qty as approximation)
      const variantById = new Map(variants.map((v) => [v.id, v]));
      sales365Map.forEach((qty, vid) => {
        const v = variantById.get(vid);
        if (v) revenue365.set(vid, qty * (v.retail_price || 0));
      });

      // ABC grading: sort variants by revenue desc, cumulative %
      const totalRevenue = Array.from(revenue365.values()).reduce((a, b) => a + b, 0);
      const sortedByRev = Array.from(revenue365.entries()).sort((a, b) => b[1] - a[1]);
      const abcMap = new Map<string, "A" | "B" | "C" | "U">();
      let cum = 0;
      sortedByRev.forEach(([vid, rev]) => {
        if (totalRevenue <= 0) return;
        cum += rev;
        const pct = cum / totalRevenue;
        if (pct <= 0.8) abcMap.set(vid, "A");
        else if (pct <= 0.95) abcMap.set(vid, "B");
        else abcMap.set(vid, "C");
      });

      // location-aware inventory
      const invByVariant = new Map<string, Record<string, number>>();
      inventory.forEach((i) => {
        const m = invByVariant.get(i.variant_id) || {};
        m[i.location || "Unknown"] = (m[i.location || "Unknown"] || 0) + (i.quantity || 0);
        invByVariant.set(i.variant_id, m);
      });

      // on-order: open PO lines per variant (variant_id via shopify_variant_id or sku)
      const onOrderByVariant = new Map<string, number>();
      const variantBySku = new Map<string, string>();
      const variantByShopifyId = new Map<string, string>();
      variants.forEach((v) => {
        if (v.sku) variantBySku.set(v.sku, v.id);
        if (v.shopify_variant_id) variantByShopifyId.set(v.shopify_variant_id, v.id);
      });
      poLines.forEach((l) => {
        if (!openPOs.has(l.purchase_order_id)) return;
        const remaining = (l.expected_qty || 0) - (l.received_qty || 0);
        if (remaining <= 0) return;
        let vid: string | undefined;
        if (l.shopify_variant_id) vid = variantByShopifyId.get(l.shopify_variant_id);
        if (!vid && l.sku) vid = variantBySku.get(l.sku);
        if (vid) onOrderByVariant.set(vid, (onOrderByVariant.get(vid) || 0) + remaining);
      });

      // last & first received from import runs (style_number ~ sku prefix)
      // Best-effort: match by style_number == sku
      const lastRecBySku = new Map<string, Date>();
      const firstRecBySku = new Map<string, Date>();
      imports.forEach((r) => {
        if (!r.style_number) return;
        const ts = r.completed_at || r.started_at;
        if (!ts) return;
        const d = new Date(ts);
        const cur = lastRecBySku.get(r.style_number);
        if (!cur || d > cur) lastRecBySku.set(r.style_number, d);
        const first = firstRecBySku.get(r.style_number);
        if (!first || d < first) firstRecBySku.set(r.style_number, d);
      });

      // Restock status sources
      const [{ data: cacheRaw }, { data: profilesRaw }, restockOverrides] = await Promise.all([
        supabase
          .from("product_catalog_cache" as any)
          .select("platform_variant_id, restock_status, shop_domain")
          .eq("user_id", user.id),
        supabase
          .from("supplier_profiles")
          .select("supplier_name, profile_data")
          .eq("user_id", user.id),
        loadRestockOverrides(user.id),
      ]);
      const cacheStatusByVid = new Map<string, string>();
      const cacheShopByVid = new Map<string, string>();
      ((cacheRaw as any[]) || []).forEach((r) => {
        if (r?.platform_variant_id) {
          if (r?.restock_status) cacheStatusByVid.set(String(r.platform_variant_id), String(r.restock_status));
          if (r?.shop_domain) cacheShopByVid.set(String(r.platform_variant_id), String(r.shop_domain));
        }
      });
      const supplierDefaultsMap = buildSupplierDefaultMap(profilesRaw as any);

      const out: Row[] = variants.map((v) => {
        const product = productMap.get(v.product_id);
        const variantTitle = [v.color, v.size].filter(Boolean).join(" / ") || "—";
        const byLoc = invByVariant.get(v.id) || {};
        const totalAvail = Object.values(byLoc).reduce((a, b) => a + b, 0) || (v.quantity || 0);
        const u30 = sales30.get(v.id) || 0;
        const u90 = sales90.get(v.id) || 0;
        const u365 = sales365Map.get(v.id) || 0;
        const spd = u30 / 30;
        const days = spd > 0 ? Math.floor(totalAvail / spd) : Infinity;
        const margin = (v.retail_price || 0) > 0
          ? (((v.retail_price || 0) - (v.cost || 0)) / (v.retail_price || 0)) * 100
          : 0;
        const grade: Row["abc"] =
          cachedAbcMap.get(v.id) ??
          (u365 === 0 ? "U" : (abcMap.get(v.id) || "C"));
        const lastRec = v.sku ? lastRecBySku.get(v.sku) || null : null;
        const firstRec = v.sku ? firstRecBySku.get(v.sku) || null : null;
        const platformVid = v.shopify_variant_id || null;
        const vendor = product?.vendor || "—";

        return {
          variantId: v.id,
          productId: v.product_id,
          shopifyProductId: product?.shopify_product_id || "",
          shopifyVariantId: v.shopify_variant_id || "",
          vendor,
          productTitle: product?.title || "—",
          productType: product?.product_type || "",
          variantTitle,
          sku: v.sku || "",
          barcode: v.barcode || "",
          available: totalAvail,
          byLocation: byLoc,
          cost: v.cost || 0,
          retailPrice: v.retail_price || 0,
          marginPct: margin,
          units30: u30,
          units90: u90,
          units365: u365,
          refunds30: refunds30.get(v.id) || 0,
          cancelled30: 0,
          salesPerDay: spd,
          daysUntilDepletion: days,
          abc: grade,
          revenue365: revenue365.get(v.id) || 0,
          onOrder: onOrderByVariant.get(v.id) || 0,
          lastReceivedAt: lastRec,
          firstReceivedAt: firstRec,
          totalRetailValue: totalAvail * (v.retail_price || 0),
          totalCostValue: totalAvail * (v.cost || 0),
          restockStatus: resolveRestockStatus({
            platformVariantId: platformVid,
            vendor,
            cacheStatus: platformVid ? cacheStatusByVid.get(String(platformVid)) ?? null : null,
            overrides: restockOverrides,
            supplierDefaults: supplierDefaultsMap,
          }),
          shopDomain: platformVid ? cacheShopByVid.get(String(platformVid)) ?? null : null,
        };
      });

      setRows(out);
      setFetchedAt(Date.now());
      saveCache(out);
    } catch (err) {
      console.error("[SkuVariantsReport] fetch failed", err);
      toast.error("Failed to load report");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  // ── Filtering ──
  const vendors = useMemo(
    () => Array.from(new Set(rows.map((r) => r.vendor))).filter(Boolean).sort(),
    [rows],
  );
  const productTypes = useMemo(
    () => Array.from(new Set(rows.map((r) => r.productType))).filter(Boolean).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    let out = rows;

    // location filter (apply to available + days)
    if (globalLocSelected !== "all" && globalLocObj) {
      const ln = globalLocObj.name;
      out = out.map((r) => {
        const a = r.byLocation[ln] ?? 0;
        const spd = r.salesPerDay;
        return {
          ...r,
          available: a,
          daysUntilDepletion: spd > 0 ? Math.floor(a / spd) : Infinity,
          totalRetailValue: a * r.retailPrice,
          totalCostValue: a * r.cost,
        };
      });
    }

    if (filters.vendors.length > 0) out = out.filter((r) => filters.vendors.includes(r.vendor));
    if (filters.productTypes.length > 0) out = out.filter((r) => filters.productTypes.includes(r.productType));
    if (filters.abc.length > 0) out = out.filter((r) => filters.abc.includes(r.abc));

    const num = (s: string) => (s.trim() === "" ? null : Number(s));
    const aMin = num(filters.availMin), aMax = num(filters.availMax);
    if (aMin !== null) out = out.filter((r) => r.available >= aMin);
    if (aMax !== null) out = out.filter((r) => r.available <= aMax);

    const dMin = num(filters.daysMin), dMax = num(filters.daysMax);
    if (dMin !== null) out = out.filter((r) => isFinite(r.daysUntilDepletion) && r.daysUntilDepletion >= dMin);
    if (dMax !== null) out = out.filter((r) => isFinite(r.daysUntilDepletion) && r.daysUntilDepletion <= dMax);

    const sMin = num(filters.s30Min), sMax = num(filters.s30Max);
    if (sMin !== null) out = out.filter((r) => r.units30 >= sMin);
    if (sMax !== null) out = out.filter((r) => r.units30 <= sMax);

    const mMin = num(filters.marginMin), mMax = num(filters.marginMax);
    if (mMin !== null) out = out.filter((r) => r.marginPct >= mMin);
    if (mMax !== null) out = out.filter((r) => r.marginPct <= mMax);

    if (filters.hasBarcode) out = out.filter((r) => !!r.barcode);
    if (filters.zeroOnly) out = out.filter((r) => r.available <= 0);

    return out;
  }, [rows, filters, globalLocSelected, globalLocObj]);

  const sorted = useMemo(() => {
    const out = [...filtered];
    out.sort((a, b) => {
      // default: vendor asc, then product asc
      if (sortKey === "vendor") {
        const v = a.vendor.localeCompare(b.vendor);
        if (v !== 0) return sortAsc ? v : -v;
        return a.productTitle.localeCompare(b.productTitle);
      }
      const av: any = (a as any)[sortKey];
      const bv: any = (b as any)[sortKey];
      if (typeof av === "number" && typeof bv === "number") {
        return sortAsc ? av - bv : bv - av;
      }
      return sortAsc ? String(av ?? "").localeCompare(String(bv ?? "")) : String(bv ?? "").localeCompare(String(av ?? ""));
    });
    return out;
  }, [filtered, sortKey, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = useMemo(
    () => sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [sorted, page],
  );

  // reset page when filters change
  useEffect(() => { setPage(1); }, [filters, globalLocSelected]);

  const handleSort = (key: ColKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  // ── Save / load reports ──
  const handleSave = async () => {
    if (!saveName.trim()) {
      toast.error("Name required");
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("user_saved_reports").insert({
      user_id: user.id,
      report_key: REPORT_KEY,
      report_name: saveName.trim(),
      filter_state: filters as any,
      column_state: visibleCols as any,
    });
    if (error) {
      toast.error("Save failed");
      return;
    }
    toast.success("Report saved");
    setSaveDialogOpen(false);
    setSaveName("");
    fetchSavedReports();
  };

  const handleLoadSaved = (id: string) => {
    const r = savedReports.find((s) => s.id === id);
    if (!r) return;
    setFilters({ ...DEFAULT_FILTERS, ...(r.filter_state as any) });
    setVisibleCols({ ...DEFAULT_COLS, ...(r.column_state as any) });
    toast.success(`Loaded "${r.report_name}"`);
  };

  const handleDeleteSaved = async (id: string) => {
    const { error } = await supabase.from("user_saved_reports").delete().eq("id", id);
    if (error) { toast.error("Delete failed"); return; }
    toast.success("Saved report deleted");
    fetchSavedReports();
  };

  // ── Render ──
  const visibleColDefs = COLUMNS.filter((c) => visibleCols[c.key]);

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <div>
            <CardTitle className="text-base">SKU / Variants Report</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {sorted.length.toLocaleString()} rows
              {fetchedAt && <> · refreshed {format(new Date(fetchedAt), "HH:mm")}</>}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <LocationFilter showLabel={false} size="sm" />
            <Button size="sm" variant="outline" onClick={() => fetchData(true)} disabled={loading}>
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1", loading && "animate-spin")} />
              Refresh
            </Button>
            <Button size="sm" variant="outline" onClick={() => downloadCSV(sorted)}>
              <Download className="h-3.5 w-3.5 mr-1" /> CSV
            </Button>
            <Button size="sm" variant="outline" onClick={() => setSaveDialogOpen(true)}>
              <Save className="h-3.5 w-3.5 mr-1" /> Save report
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Filter bar */}
        <div className="flex flex-wrap gap-2 items-center">
          {/* Vendor multi */}
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline">
                Vendor {filters.vendors.length > 0 && <Badge variant="secondary" className="ml-1 text-[10px]">{filters.vendors.length}</Badge>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64">
              <ScrollArea className="h-64">
                <div className="space-y-1">
                  {vendors.map((v) => (
                    <label key={v} className="flex items-center gap-2 text-xs cursor-pointer">
                      <Checkbox
                        checked={filters.vendors.includes(v)}
                        onCheckedChange={(c) => setFilters((f) => ({
                          ...f,
                          vendors: c ? [...f.vendors, v] : f.vendors.filter((x) => x !== v),
                        }))}
                      />
                      {v}
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>

          {/* Product type multi */}
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline">
                Product type {filters.productTypes.length > 0 && <Badge variant="secondary" className="ml-1 text-[10px]">{filters.productTypes.length}</Badge>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64">
              <ScrollArea className="h-64">
                <div className="space-y-1">
                  {productTypes.map((t) => (
                    <label key={t} className="flex items-center gap-2 text-xs cursor-pointer">
                      <Checkbox
                        checked={filters.productTypes.includes(t)}
                        onCheckedChange={(c) => setFilters((f) => ({
                          ...f,
                          productTypes: c ? [...f.productTypes, t] : f.productTypes.filter((x) => x !== t),
                        }))}
                      />
                      {t}
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>

          {/* ABC grade multi */}
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline">
                ABC {filters.abc.length > 0 && <Badge variant="secondary" className="ml-1 text-[10px]">{filters.abc.length}</Badge>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-40">
              <div className="space-y-1">
                {(["A", "B", "C", "U"] as const).map((g) => (
                  <label key={g} className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox
                      checked={filters.abc.includes(g)}
                      onCheckedChange={(c) => setFilters((f) => ({
                        ...f,
                        abc: c ? [...f.abc, g] : f.abc.filter((x) => x !== g),
                      }))}
                    />
                    {g} {g === "A" && "(top 80%)"}{g === "B" && "(next 15%)"}{g === "C" && "(bottom 5%)"}{g === "U" && "(unsold)"}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* Range filters */}
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline">Ranges</Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-2">
              <RangeRow label="Available qty" min={filters.availMin} max={filters.availMax}
                onMin={(v) => setFilters((f) => ({ ...f, availMin: v }))}
                onMax={(v) => setFilters((f) => ({ ...f, availMax: v }))} />
              <RangeRow label="Days to depletion" min={filters.daysMin} max={filters.daysMax}
                onMin={(v) => setFilters((f) => ({ ...f, daysMin: v }))}
                onMax={(v) => setFilters((f) => ({ ...f, daysMax: v }))} />
              <RangeRow label="Sales 30d" min={filters.s30Min} max={filters.s30Max}
                onMin={(v) => setFilters((f) => ({ ...f, s30Min: v }))}
                onMax={(v) => setFilters((f) => ({ ...f, s30Max: v }))} />
              <RangeRow label="Margin %" min={filters.marginMin} max={filters.marginMax}
                onMin={(v) => setFilters((f) => ({ ...f, marginMin: v }))}
                onMax={(v) => setFilters((f) => ({ ...f, marginMax: v }))} />
            </PopoverContent>
          </Popover>

          {/* Toggles */}
          <div className="flex items-center gap-2 px-2 py-1 border rounded-md text-xs">
            <Switch
              checked={filters.hasBarcode}
              onCheckedChange={(c) => setFilters((f) => ({ ...f, hasBarcode: c }))}
            />
            <Label className="text-xs">Has barcode</Label>
          </div>
          <div className="flex items-center gap-2 px-2 py-1 border rounded-md text-xs">
            <Switch
              checked={filters.zeroOnly}
              onCheckedChange={(c) => setFilters((f) => ({ ...f, zeroOnly: c }))}
            />
            <Label className="text-xs">Zero stock</Label>
          </div>

          <Button
            size="sm"
            variant="secondary"
            onClick={() => setFilters((f) => ({ ...f, abc: ["C", "U"] }))}
          >
            <Zap className="h-3.5 w-3.5 mr-1" /> Slow movers
          </Button>

          <Button size="sm" variant="ghost" onClick={() => setFilters(DEFAULT_FILTERS)}>
            Clear
          </Button>

          {/* Columns chooser */}
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="ml-auto">
                <Settings2 className="h-3.5 w-3.5 mr-1" /> Columns
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64">
              <ScrollArea className="h-72">
                <div className="space-y-1">
                  {COLUMNS.map((c) => (
                    <label key={c.key} className="flex items-center gap-2 text-xs cursor-pointer">
                      <Checkbox
                        checked={visibleCols[c.key]}
                        onCheckedChange={(v) => setVisibleCols((s) => ({ ...s, [c.key]: !!v }))}
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>
        </div>

        {/* Saved reports row */}
        {savedReports.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Saved:</span>
            {savedReports.map((s) => (
              <div key={s.id} className="flex items-center gap-1 border rounded-md px-2 py-0.5">
                <button className="hover:underline" onClick={() => handleLoadSaved(s.id)}>
                  {s.report_name}
                </button>
                <button
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => handleDeleteSaved(s.id)}
                  title="Delete"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Table */}
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {visibleColDefs.map((c) => (
                  <TableHead
                    key={c.key}
                    className={cn("whitespace-nowrap cursor-pointer select-none text-xs", c.numeric && "text-right")}
                    onClick={() => handleSort(c.key)}
                  >
                    {c.label}
                    {sortKey === c.key && (sortAsc ? " ↑" : " ↓")}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && pageRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={visibleColDefs.length} className="text-center text-muted-foreground py-8">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!loading && pageRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={visibleColDefs.length} className="text-center text-muted-foreground py-8">
                    No matching variants
                  </TableCell>
                </TableRow>
              )}
              {pageRows.map((r) => (
                <TableRow key={r.variantId}>
                  {visibleColDefs.map((c) => (
                    <TableCell key={c.key} className={cn("text-xs whitespace-nowrap", c.numeric && "text-right")}>
                      {renderCell(r, c.key)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div>
            Page {page} of {totalPages} · showing {pageRows.length} of {sorted.length.toLocaleString()}
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(1)}>«</Button>
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>»</Button>
          </div>
        </div>
      </CardContent>

      {/* Save dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save report</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="e.g. Seafolly slow movers"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Saves current filters and visible columns.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

// ── Cell renderer ──
function renderCell(r: Row, key: ColKey) {
  switch (key) {
    case "vendor": return <span className="font-medium">{r.vendor}</span>;
    case "productTitle": return r.productTitle;
    case "variantTitle": return r.variantTitle;
    case "sku": return <span className="font-mono">{r.sku || "—"}</span>;
    case "barcode": return <span className="font-mono">{r.barcode || "—"}</span>;
    case "available": return fmtNum(r.available);
    case "cost": return fmtMoney(r.cost);
    case "retailPrice": return fmtMoney(r.retailPrice);
    case "marginPct": return `${r.marginPct.toFixed(1)}%`;
    case "units30": return fmtNum(r.units30);
    case "units90": return fmtNum(r.units90);
    case "units365": return fmtNum(r.units365);
    case "salesPerDay": return r.salesPerDay.toFixed(2);
    case "daysUntilDepletion":
      return isFinite(r.daysUntilDepletion) ? fmtNum(r.daysUntilDepletion) : "∞";
    case "abc": return abcBadge(r.abc);
    case "onOrder": return r.onOrder > 0 ? <Badge variant="outline" className="text-[10px]">{r.onOrder}</Badge> : "—";
    case "lastReceivedAt": return r.lastReceivedAt ? format(r.lastReceivedAt, "yyyy-MM-dd") : "—";
    case "shopifyProductId": return <span className="font-mono">{r.shopifyProductId || "—"}</span>;
    case "shopifyVariantId": return <span className="font-mono">{r.shopifyVariantId || "—"}</span>;
    case "productType": return r.productType || "—";
    case "compareAtPrice": return "—";
    case "totalRetailValue": return fmtMoney(r.totalRetailValue);
    case "totalCostValue": return fmtMoney(r.totalCostValue);
    case "refunds30": return fmtNum(r.refunds30);
    case "cancelled30": return fmtNum(r.cancelled30);
    case "firstReceivedAt": return r.firstReceivedAt ? format(r.firstReceivedAt, "yyyy-MM-dd") : "—";
    case "weight": return "—";
  }
}

function RangeRow({
  label, min, max, onMin, onMax,
}: {
  label: string; min: string; max: string;
  onMin: (v: string) => void; onMax: (v: string) => void;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-1 mt-1">
        <Input className="h-7 text-xs" placeholder="Min" value={min} onChange={(e) => onMin(e.target.value)} />
        <span className="text-muted-foreground">–</span>
        <Input className="h-7 text-xs" placeholder="Max" value={max} onChange={(e) => onMax(e.target.value)} />
      </div>
    </div>
  );
}

export default SkuVariantsReport;
