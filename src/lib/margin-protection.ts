// ── Margin Protection Engine ──
// Real-time validation system to prevent selling below cost and protect minimum margins.

export type MarginStatus = "safe" | "warning" | "blocked" | "no_cost";

export interface MarginSettings {
  mode: "strict" | "relaxed";
  globalMinMargin: number; // e.g. 30 (%)
  warningThreshold: number; // e.g. 35 (%) — show yellow below this
  enableGoogleShoppingWarnings: boolean;
}

export interface MarginCheckResult {
  cost: number | null;
  price: number;
  margin_percentage: number | null;
  status: MarginStatus;
  reason: string;
  costSource: "invoice" | "shopify" | "manual" | "none";
}

export interface BulkMarginSummary {
  total: number;
  safe: number;
  warning: number;
  blocked: number;
  noCost: number;
  results: (MarginCheckResult & { handle: string; title: string })[];
}

const SETTINGS_KEY = "margin_protection_settings";

export function getMarginSettings(): MarginSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    mode: "strict",
    globalMinMargin: 30,
    warningThreshold: 35,
    enableGoogleShoppingWarnings: true,
  };
}

export function saveMarginSettings(s: MarginSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

/** Calculate margin % from price and cost. Returns null if either is missing/zero. */
export function calcMargin(price: number, cost: number): number | null {
  if (!price || price <= 0 || !cost || cost < 0) return null;
  return ((price - cost) / price) * 100;
}

/** Determine cost from available sources */
export function resolveCost(product: {
  costPrice?: number;
  cost?: number;
  shopifyCost?: number;
  manualCost?: number;
}): { cost: number | null; source: MarginCheckResult["costSource"] } {
  if (product.costPrice && product.costPrice > 0) return { cost: product.costPrice, source: "invoice" };
  if (product.cost && product.cost > 0) return { cost: product.cost, source: "invoice" };
  if (product.shopifyCost && product.shopifyCost > 0) return { cost: product.shopifyCost, source: "shopify" };
  if (product.manualCost && product.manualCost > 0) return { cost: product.manualCost, source: "manual" };
  return { cost: null, source: "none" };
}

/** Check a single product against margin rules */
export function checkMargin(
  price: number,
  costData: { cost: number | null; source: MarginCheckResult["costSource"] },
  settings?: MarginSettings
): MarginCheckResult {
  const s = settings || getMarginSettings();

  if (!costData.cost || costData.source === "none") {
    return { cost: null, price, margin_percentage: null, status: "no_cost", reason: "No cost data available", costSource: "none" };
  }

  const margin = calcMargin(price, costData.cost);

  if (margin === null) {
    return { cost: costData.cost, price, margin_percentage: null, status: "no_cost", reason: "Cannot calculate margin", costSource: costData.source };
  }

  if (price < costData.cost) {
    return { cost: costData.cost, price, margin_percentage: margin, status: "blocked", reason: "Price is below cost", costSource: costData.source };
  }

  if (margin < s.globalMinMargin) {
    if (s.mode === "strict") {
      return { cost: costData.cost, price, margin_percentage: margin, status: "blocked", reason: `Margin ${margin.toFixed(1)}% is below minimum ${s.globalMinMargin}%`, costSource: costData.source };
    }
    return { cost: costData.cost, price, margin_percentage: margin, status: "warning", reason: `Margin ${margin.toFixed(1)}% is below minimum ${s.globalMinMargin}%`, costSource: costData.source };
  }

  if (margin < s.warningThreshold) {
    return { cost: costData.cost, price, margin_percentage: margin, status: "warning", reason: `Low margin (${margin.toFixed(1)}%)`, costSource: costData.source };
  }

  return { cost: costData.cost, price, margin_percentage: margin, status: "safe", reason: "Margin is healthy", costSource: costData.source };
}

/** Validate multiple prices for one product (regular, sale, compare-at) */
export function checkMultiPrice(
  product: { costPrice?: number; cost?: number; shopifyCost?: number; manualCost?: number },
  prices: { regular: number; sale?: number; compareAt?: number },
  settings?: MarginSettings
): { regular: MarginCheckResult; sale?: MarginCheckResult; compareAt?: MarginCheckResult; worstStatus: MarginStatus } {
  const costData = resolveCost(product);
  const s = settings || getMarginSettings();
  const regular = checkMargin(prices.regular, costData, s);
  const sale = prices.sale ? checkMargin(prices.sale, costData, s) : undefined;
  const compareAt = prices.compareAt ? checkMargin(prices.compareAt, costData, s) : undefined;

  const statuses = [regular.status, sale?.status, compareAt?.status].filter(Boolean) as MarginStatus[];
  const worst: MarginStatus = statuses.includes("blocked") ? "blocked" : statuses.includes("warning") ? "warning" : statuses.includes("no_cost") ? "no_cost" : "safe";

  return { regular, sale, compareAt, worstStatus: worst };
}

/** Bulk validate an array of products */
export function bulkMarginCheck(
  products: { handle: string; title: string; price: number; costPrice?: number; cost?: number; shopifyCost?: number; manualCost?: number }[],
  settings?: MarginSettings
): BulkMarginSummary {
  const s = settings || getMarginSettings();
  const results = products.map(p => {
    const costData = resolveCost(p);
    const result = checkMargin(p.price, costData, s);
    return { ...result, handle: p.handle, title: p.title };
  });

  return {
    total: results.length,
    safe: results.filter(r => r.status === "safe").length,
    warning: results.filter(r => r.status === "warning").length,
    blocked: results.filter(r => r.status === "blocked").length,
    noCost: results.filter(r => r.status === "no_cost").length,
    results,
  };
}

/** Get color class for margin status */
export function marginStatusColor(status: MarginStatus): string {
  switch (status) {
    case "safe": return "text-primary";
    case "warning": return "text-warning";
    case "blocked": return "text-destructive";
    case "no_cost": return "text-muted-foreground";
  }
}

/** Get bg color class for margin status */
export function marginStatusBg(status: MarginStatus): string {
  switch (status) {
    case "safe": return "bg-primary/15";
    case "warning": return "bg-warning/15";
    case "blocked": return "bg-destructive/15";
    case "no_cost": return "bg-muted";
  }
}

/** Log a pricing action to the margin audit trail */
export function logMarginAction(entry: {
  product: string;
  oldPrice: number;
  newPrice: number;
  cost: number | null;
  marginBefore: number | null;
  marginAfter: number | null;
  source: string;
}) {
  const LOG_KEY = "margin_audit_log";
  try {
    const existing = JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
    existing.unshift({ ...entry, timestamp: new Date().toISOString() });
    if (existing.length > 500) existing.length = 500;
    localStorage.setItem(LOG_KEY, JSON.stringify(existing));
  } catch {}
}

export function getMarginAuditLog(): any[] {
  try { return JSON.parse(localStorage.getItem("margin_audit_log") || "[]"); } catch { return []; }
}
