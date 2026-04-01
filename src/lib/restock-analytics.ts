import type { InventoryVariant, ParsedInventory } from "./inventory-parser";

// ── Types ──

export type UrgencyLevel = "urgent" | "soon" | "monitor";

export interface SizeStatus {
  size: string;
  qty: number;
  status: "sold_out" | "low" | "ok";
  suggestedReorder: number;
}

export interface ProductAnalysis {
  productId: string;
  productName: string;
  brand: string;
  productType: string;
  sizes: SizeStatus[];
  issue: "size_hole" | "complete_stockout" | "low_stock" | "imbalanced" | "healthy";
  issueLabel: string;
  holesCount: number;
  totalSizes: number;
  priorityScore: number;
  urgency: UrgencyLevel;
  colour: string;
  price: number;
  costPrice: number;
}

export interface BrandHealth {
  brand: string;
  totalVariants: number;
  soldOut: number;
  lowStock: number;
  healthy: number;
  healthPercent: number;
  productsWithHoles: number;
  completeStockouts: number;
}

export interface AnalyticsResult {
  products: ProductAnalysis[];
  brands: BrandHealth[];
  summary: {
    totalProducts: number;
    productsWithHoles: number;
    totalHoles: number;
    completeStockouts: number;
    lowStockVariants: number;
    urgentCount: number;
    soonCount: number;
    monitorCount: number;
  };
}

export interface RestockSettings {
  lowStockThreshold: number;
  reorderMultiplier: number;
  coreSizes: string[];
  includeArchived: boolean;
}

export const DEFAULT_SETTINGS: RestockSettings = {
  lowStockThreshold: 2,
  reorderMultiplier: 1.2,
  coreSizes: ["8", "10", "12", "14", "S", "M", "L"],
  includeArchived: false,
};

export interface ReorderItem {
  productId: string;
  productName: string;
  brand: string;
  sku: string;
  colour: string;
  size: string;
  qty: number;
  unitCost: number;
  unitPrice: number;
}

// ── Analytics Engine ──

export function runAnalytics(
  inventory: ParsedInventory,
  settings: RestockSettings = DEFAULT_SETTINGS
): AnalyticsResult {
  const { variants } = inventory;
  const { lowStockThreshold, reorderMultiplier, coreSizes } = settings;

  // Group variants by product
  const productMap = new Map<string, InventoryVariant[]>();
  for (const v of variants) {
    const list = productMap.get(v.productId) || [];
    list.push(v);
    productMap.set(v.productId, list);
  }

  const products: ProductAnalysis[] = [];

  for (const [productId, pvariants] of productMap) {
    const first = pvariants[0];
    const sizes: SizeStatus[] = pvariants.map((v) => {
      const status: SizeStatus["status"] =
        v.qty === 0 ? "sold_out" : v.qty <= lowStockThreshold ? "low" : "ok";
      return { size: v.sizeValue || "OS", qty: v.qty, status, suggestedReorder: 0 };
    });

    const holes = sizes.filter((s) => s.status === "sold_out").length;
    const lowCount = sizes.filter((s) => s.status === "low").length;
    const allOut = holes === sizes.length && sizes.length > 0;

    // Suggested reorder quantities
    const nonZeroQtys = sizes.filter((s) => s.qty > 0).map((s) => s.qty);
    const avgQty = nonZeroQtys.length > 0
      ? nonZeroQtys.reduce((a, b) => a + b, 0) / nonZeroQtys.length
      : 4; // default if all sold out

    for (const s of sizes) {
      if (s.status === "sold_out") {
        s.suggestedReorder = Math.ceil(avgQty * reorderMultiplier);
      } else if (s.status === "low") {
        s.suggestedReorder = Math.ceil((avgQty - s.qty) * reorderMultiplier);
        if (s.suggestedReorder < 0) s.suggestedReorder = 0;
      }
    }

    // Determine issue type
    let issue: ProductAnalysis["issue"];
    let issueLabel: string;

    if (allOut) {
      issue = "complete_stockout";
      issueLabel = `Complete stockout — all ${sizes.length} sizes`;
    } else if (holes > 0) {
      issue = "size_hole";
      const missingNames = sizes.filter((s) => s.status === "sold_out").map((s) => s.size).join(", ");
      issueLabel = `Size hole — ${holes} of ${sizes.length} sold out (${missingNames})`;
    } else if (lowCount > 0) {
      // Check for imbalance
      if (sizes.length >= 3) {
        const qtys = sizes.map((s) => s.qty);
        const mean = qtys.reduce((a, b) => a + b, 0) / qtys.length;
        const sd = Math.sqrt(qtys.reduce((s, q) => s + (q - mean) ** 2, 0) / qtys.length);
        if (sd > 3 * mean && mean > 0) {
          issue = "imbalanced";
          issueLabel = "Size distribution imbalanced — uneven stock levels";
        } else {
          issue = "low_stock";
          issueLabel = `Low stock — ${lowCount} sizes at ≤${lowStockThreshold} units`;
        }
      } else {
        issue = "low_stock";
        issueLabel = `Low stock — ${lowCount} sizes at ≤${lowStockThreshold} units`;
      }
    } else {
      issue = "healthy";
      issueLabel = "All sizes healthy";
    }

    // Priority scoring
    let score = 0;
    if (allOut) score += 4;
    else if (holes > 0) score += 2;
    else if (lowCount > 0) score += 1;

    // Product value
    const allPrices = products.map((p) => p.price);
    if (first.price > 150) score += 2;
    else if (first.price > 80) score += 1;

    // Core size missing
    const missingSizes = sizes.filter((s) => s.status === "sold_out").map((s) => s.size);
    const coreCoreLower = coreSizes.map((s) => s.toLowerCase());
    if (missingSizes.some((s) => coreCoreLower.includes(s.toLowerCase()))) score += 2;
    else if (missingSizes.length > 0) score += 1;

    // Brand importance (default +1)
    score += 1;

    score = Math.min(score, 10);

    const urgency: UrgencyLevel = score >= 8 ? "urgent" : score >= 5 ? "soon" : "monitor";

    products.push({
      productId,
      productName: first.productName,
      brand: first.brand,
      productType: first.productType,
      sizes,
      issue,
      issueLabel,
      holesCount: holes,
      totalSizes: sizes.length,
      priorityScore: score,
      urgency,
      colour: first.colourValue || "",
      price: first.price,
      costPrice: first.costPrice,
    });
  }

  // Sort by priority descending
  products.sort((a, b) => b.priorityScore - a.priorityScore);

  // Brand health
  const brandMap = new Map<string, BrandHealth>();
  for (const p of products) {
    const brand = p.brand || "Unknown";
    if (!brandMap.has(brand)) {
      brandMap.set(brand, {
        brand, totalVariants: 0, soldOut: 0, lowStock: 0, healthy: 0,
        healthPercent: 0, productsWithHoles: 0, completeStockouts: 0,
      });
    }
    const bh = brandMap.get(brand)!;
    for (const s of p.sizes) {
      bh.totalVariants++;
      if (s.status === "sold_out") bh.soldOut++;
      else if (s.status === "low") bh.lowStock++;
      else bh.healthy++;
    }
    if (p.issue === "size_hole" || p.issue === "imbalanced") bh.productsWithHoles++;
    if (p.issue === "complete_stockout") bh.completeStockouts++;
  }

  const brands: BrandHealth[] = [];
  for (const bh of brandMap.values()) {
    bh.healthPercent = bh.totalVariants > 0
      ? Math.round((bh.healthy / bh.totalVariants) * 100) : 100;
    brands.push(bh);
  }
  brands.sort((a, b) => a.healthPercent - b.healthPercent);

  // Summary
  const flagged = products.filter((p) => p.issue !== "healthy");
  const summary = {
    totalProducts: products.length,
    productsWithHoles: products.filter((p) => p.issue === "size_hole" || p.issue === "imbalanced").length,
    totalHoles: products.reduce((s, p) => s + p.holesCount, 0),
    completeStockouts: products.filter((p) => p.issue === "complete_stockout").length,
    lowStockVariants: products.reduce((s, p) => s + p.sizes.filter((sz) => sz.status === "low").length, 0),
    urgentCount: flagged.filter((p) => p.urgency === "urgent").length,
    soonCount: flagged.filter((p) => p.urgency === "soon").length,
    monitorCount: flagged.filter((p) => p.urgency === "monitor").length,
  };

  return { products, brands, summary };
}

// ── Reorder helpers ──

export function buildReorderItems(products: ProductAnalysis[]): ReorderItem[] {
  const items: ReorderItem[] = [];
  for (const p of products) {
    for (const s of p.sizes) {
      if (s.suggestedReorder > 0) {
        items.push({
          productId: p.productId,
          productName: p.productName,
          brand: p.brand,
          sku: `${p.productId}-${s.size}`,
          colour: p.colour,
          size: s.size,
          qty: s.suggestedReorder,
          unitCost: p.costPrice,
          unitPrice: p.price,
        });
      }
    }
  }
  return items;
}

export function generateJoorCSV(items: ReorderItem[], brand: string): string {
  const brandItems = items.filter((i) => i.brand === brand);
  const headers = "Brand,Style Name,Style Number,Colour,Size,Order Qty,Wholesale Price\n";
  const rows = brandItems.map((i) =>
    `${i.brand},${i.productName},${i.productId},${i.colour},${i.size},${i.qty},${i.unitCost.toFixed(2)}`
  ).join("\n");
  return "\uFEFF" + headers + rows;
}

export function generateEmailTemplate(items: ReorderItem[], brand: string, storeName: string): string {
  const brandItems = items.filter((i) => i.brand === brand);
  const lines = brandItems.map((i) =>
    `  ${i.productName} — Size ${i.size} — ${i.qty} units`
  ).join("\n");

  return `Subject: Restock Order — ${brand} — ${storeName}

Hi [Sales Rep],

Following a review of our current inventory, we would like to place a restock order for the following items:

${lines}

Please confirm availability and expected delivery date.

Kind regards,
${storeName}`;
}
