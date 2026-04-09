// ── Invoice Category Intelligence Engine ──
// Learns from Xero/MYOB bill history to auto-categorise new invoices.
// Uses a 4-layer classification: supplier history → keyword rules → brand directory → AI fallback.

// ═══════════════════════════════════════════════
// LAYER 1: XERO CHART OF ACCOUNTS (Splash Swimwear)
// Learned from 549 real bills across 129 suppliers
// ═══════════════════════════════════════════════

export interface AccountCodeMapping {
  code: string;
  name: string;
  category: string;        // Human-friendly category
  taxType: string;         // Default GST treatment
  keywords: string[];      // Description keywords that trigger this code
  supplierPatterns: string[]; // Known suppliers for this code
}

// Complete chart of accounts derived from real Splash Swimwear Xero data
export const XERO_ACCOUNT_CODES: AccountCodeMapping[] = [
  // ── COST OF GOODS SOLD (stock purchases) ──
  {
    code: "51000",
    name: "Purchases - Swimwear",
    category: "Swimwear",
    taxType: "GST on Expenses",
    keywords: ["swimwear", "swim", "bikini", "one piece", "rashie", "boardshort", "goggle", "swimsuit"],
    supplierPatterns: [
      "seafolly", "bond eye", "baku", "speedo", "zoggs", "budgy smuggler",
      "capriosca", "kulani kinis", "monte & lou", "salty ink", "togs swimwear",
      "vacay swimwear", "way funky", "wacoal", "fernleigh", "om designs",
      "concept brands", "vision brands", "ambra",
    ],
  },
  {
    code: "51100",
    name: "Purchases - Clothing",
    category: "Clothing & Fashion",
    taxType: "GST on Expenses",
    keywords: ["clothing", "dress", "top", "skirt", "shorts", "pants", "shirt", "denim", "fashion", "apparel", "coverup", "kaftan", "romper", "jumpsuit"],
    supplierPatterns: [
      "rhythm", "rusty", "rock denim", "alma designs", "by frankie",
      "calvin klein", "function design", "desire fashion", "global fashion",
      "go girl", "itami", "just donna", "one love fashion", "portofino",
      "prem group", "sunny girl", "vw fashion", "zella the label",
      "bubblegum clothing", "brands for us", "cruz industries",
    ],
  },
  {
    code: "51200",
    name: "Purchases - Accessories & Gifts",
    category: "Accessories & Gifts",
    taxType: "GST on Expenses",
    keywords: ["accessory", "accessories", "gift", "candle", "sunglasses", "hat", "towel", "bag", "jewellery", "jewelry", "fragrance", "skincare", "home", "lifestyle", "socks", "thongs", "shoes"],
    supplierPatterns: [
      "adairs", "bling2o", "cinnamon creations", "dwbh", "designworks",
      "florabelle", "hammamas", "holster", "kami so", "kato designs",
      "kissed earth", "klipsta", "kung fu mary", "reef", "rigon headwear",
      "roadtrip essential", "sand cloud", "sky gazer", "sock it up",
      "somerside", "suit saver", "sundaise", "sunnylife", "sunshades eyewear",
      "the commonfolk", "the leisure collective", "the sales loop",
      "timber & co", "we are feel good", "bad on paper", "malakai",
      "bali in a bottle",
    ],
  },
  {
    code: "51300",
    name: "Purchases - Lingerie",
    category: "Lingerie & Underwear",
    taxType: "GST on Expenses",
    keywords: ["lingerie", "underwear", "bra", "brief", "undies", "intimates"],
    supplierPatterns: ["wacoal australia"],
  },
  {
    code: "53000",
    name: "Purchases - Hosiery",
    category: "Hosiery",
    taxType: "GST on Expenses",
    keywords: ["hosiery", "stockings", "tights", "leggings"],
    supplierPatterns: ["ambra", "skye group"],
  },

  // ── FREIGHT & SHIPPING ──
  {
    code: "61700",
    name: "Freight & Cartage",
    category: "Freight & Shipping",
    taxType: "GST on Expenses",
    keywords: ["freight", "shipping", "cartage", "delivery", "postage", "courier", "packaging", "packing", "carton"],
    supplierPatterns: ["transdirect", "trans direct", "pack city"],
  },
  {
    code: "61710",
    name: "Customs & Duties",
    category: "Customs & Import Duties",
    taxType: "GST Free Expenses",
    keywords: ["customs", "duty", "import duty", "clearance"],
    supplierPatterns: ["zonos"],
  },

  // ── OPERATING EXPENSES ──
  {
    code: "64200",
    name: "Rent",
    category: "Rent",
    taxType: "GST on Expenses",
    keywords: ["rent", "lease", "premises"],
    supplierPatterns: ["airraid property"],
  },
  {
    code: "64500",
    name: "Telephone & Internet",
    category: "Internet & Communications",
    taxType: "GST on Expenses",
    keywords: ["internet", "phone", "telco", "broadband", "nbn"],
    supplierPatterns: ["iinet", "telstra", "optus"],
  },
  {
    code: "61400",
    name: "IT & Software",
    category: "Software & IT",
    taxType: "GST on Expenses",
    keywords: ["software", "subscription", "saas", "app", "platform", "shopify", "xero"],
    supplierPatterns: ["xero australia", "shopify", "square", "lightspeed"],
  },
  {
    code: "61500",
    name: "Computer Equipment",
    category: "Computer & Tech",
    taxType: "GST on Expenses",
    keywords: ["computer", "printer", "ink", "toner", "laptop", "monitor"],
    supplierPatterns: ["ink station"],
  },
  {
    code: "64800",
    name: "Printing & Stationery",
    category: "Printing & Stationery",
    taxType: "GST on Expenses",
    keywords: ["printing", "stationery", "labels", "price tags", "ticket"],
    supplierPatterns: ["pricemark"],
  },
  {
    code: "61750",
    name: "Insurance",
    category: "Insurance",
    taxType: "GST on Expenses",
    keywords: ["insurance", "broker", "policy", "cover"],
    supplierPatterns: ["afa insurance"],
  },
  {
    code: "64845",
    name: "Merchant Fees",
    category: "Payment Processing",
    taxType: "GST on Expenses",
    keywords: ["merchant", "eftpos", "payment processing", "stripe", "square", "afterpay"],
    supplierPatterns: ["wavipay", "tyro", "stripe"],
  },
  {
    code: "63100",
    name: "Repairs & Maintenance",
    category: "Repairs & Maintenance",
    taxType: "GST on Expenses",
    keywords: ["repair", "maintenance", "fix", "service", "clean"],
    supplierPatterns: [],
  },
  {
    code: "63400",
    name: "Store Supplies",
    category: "Store Supplies",
    taxType: "GST on Expenses",
    keywords: ["supplies", "bags", "tissue", "wrap", "display", "mannequin", "hanger"],
    supplierPatterns: ["bee dee bags"],
  },
  {
    code: "408",
    name: "Waste Management",
    category: "Waste & Cleaning",
    taxType: "GST on Expenses",
    keywords: ["waste", "rubbish", "bin", "recycling", "cart", "cleanaway"],
    supplierPatterns: ["cleanaway"],
  },
  {
    code: "64525",
    name: "Bank Fees",
    category: "Bank Charges",
    taxType: "BAS Excluded",
    keywords: ["bank fee", "bank charge", "account fee"],
    supplierPatterns: [],
  },
  {
    code: "64750",
    name: "Staff Amenities",
    category: "Staff Costs",
    taxType: "GST on Expenses",
    keywords: ["staff", "amenities", "training", "uniform"],
    supplierPatterns: [],
  },

  // ── TAX ──
  {
    code: "825",
    name: "GST Paid",
    category: "Tax - GST",
    taxType: "BAS Excluded",
    keywords: ["gst", "bas", "activity statement"],
    supplierPatterns: ["ato", "australian taxation office"],
  },
];

// ═══════════════════════════════════════════════
// LAYER 2: SUPPLIER HISTORY LOOKUP
// Most reliable — same supplier always maps to same code
// ═══════════════════════════════════════════════

const SUPPLIER_HISTORY_KEY = "sonic_supplier_category_history";

export interface SupplierCategoryRecord {
  supplierName: string;
  accountCode: string;
  accountName: string;
  category: string;
  taxType: string;
  confidence: number;       // 0-100, increases with each confirmed push
  timesUsed: number;
  lastUsed: string;         // ISO date
  // For multi-category suppliers (e.g. Baku = 51000 swimwear + 61700 freight)
  secondaryCodes?: { code: string; name: string; category: string; frequency: number }[];
}

export function getSupplierHistory(): SupplierCategoryRecord[] {
  try {
    return JSON.parse(localStorage.getItem(SUPPLIER_HISTORY_KEY) || "[]");
  } catch { return []; }
}

export function saveSupplierHistory(records: SupplierCategoryRecord[]): void {
  localStorage.setItem(SUPPLIER_HISTORY_KEY, JSON.stringify(records));
}

/** Record a successful push — boosts confidence for this supplier→code pair */
export function recordSuccessfulPush(
  supplierName: string, accountCode: string, accountName: string,
  category: string, taxType: string
): void {
  const history = getSupplierHistory();
  const normalised = normaliseSupplier(supplierName);
  const existing = history.find(r => normaliseSupplier(r.supplierName) === normalised && r.accountCode === accountCode);

  if (existing) {
    existing.confidence = Math.min(100, existing.confidence + 5);
    existing.timesUsed++;
    existing.lastUsed = new Date().toISOString();
  } else {
    history.push({
      supplierName, accountCode, accountName, category, taxType,
      confidence: 60, timesUsed: 1, lastUsed: new Date().toISOString(),
    });
  }

  saveSupplierHistory(history);
}

/** Record a user correction — the user changed the AI suggestion */
export function recordCorrection(
  supplierName: string, wrongCode: string, correctCode: string,
  correctName: string, correctCategory: string, taxType: string
): void {
  const history = getSupplierHistory();
  const normalised = normaliseSupplier(supplierName);

  // Reduce confidence of wrong code
  const wrong = history.find(r => normaliseSupplier(r.supplierName) === normalised && r.accountCode === wrongCode);
  if (wrong) {
    wrong.confidence = Math.max(0, wrong.confidence - 15);
  }

  // Boost or create correct code
  const correct = history.find(r => normaliseSupplier(r.supplierName) === normalised && r.accountCode === correctCode);
  if (correct) {
    correct.confidence = Math.min(100, correct.confidence + 10);
    correct.timesUsed++;
    correct.lastUsed = new Date().toISOString();
  } else {
    history.push({
      supplierName, accountCode: correctCode, accountName: correctName,
      category: correctCategory, taxType,
      confidence: 70, timesUsed: 1, lastUsed: new Date().toISOString(),
    });
  }

  saveSupplierHistory(history);
}

// ═══════════════════════════════════════════════
// LAYER 3: KEYWORD CLASSIFICATION
// Analyses description text to determine category
// ═══════════════════════════════════════════════

function scoreKeywordMatch(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) score += kw.length; // Longer keywords = higher confidence
  }
  return score;
}

// ═══════════════════════════════════════════════
// LAYER 4: MULTI-LINE INVOICE INTELLIGENCE
// Some invoices have mixed lines:
//   - Product lines (51000) + freight line (61700)
//   - Product lines (51000) + credit note (53000)
// ═══════════════════════════════════════════════

export interface InvoiceCategorisation {
  accountCode: string;
  accountName: string;
  category: string;
  taxType: string;
  confidence: number;       // 0-100
  method: "supplier_history" | "supplier_pattern" | "keyword" | "ai_fallback" | "default";
  explanation: string;       // Human-readable reason for classification
  alternatives: { code: string; name: string; category: string; score: number }[];
  // For multi-line invoices
  isFreightLine?: boolean;
  freightCode?: string;
}

/** Main classification function — the 4-layer cascade */
export function classifyInvoice(
  supplierName: string,
  description: string,
  lineItems?: { description?: string; product_name?: string }[],
): InvoiceCategorisation {
  const normalised = normaliseSupplier(supplierName);

  // ── LAYER 1: Supplier history (highest confidence) ──
  const history = getSupplierHistory();
  const historyMatch = history
    .filter(r => normaliseSupplier(r.supplierName) === normalised)
    .sort((a, b) => b.confidence - a.confidence);

  if (historyMatch.length > 0 && historyMatch[0].confidence >= 50) {
    const best = historyMatch[0];
    return {
      accountCode: best.accountCode,
      accountName: best.accountName,
      category: best.category,
      taxType: best.taxType,
      confidence: best.confidence,
      method: "supplier_history",
      explanation: `Previously categorised as "${best.category}" (${best.timesUsed} times, ${best.confidence}% confidence)`,
      alternatives: historyMatch.slice(1).map(h => ({
        code: h.accountCode, name: h.accountName, category: h.category, score: h.confidence,
      })),
    };
  }

  // ── LAYER 2: Known supplier patterns (from Xero data) ──
  const patternMatch = XERO_ACCOUNT_CODES
    .map(acct => {
      const score = acct.supplierPatterns.some(p => normalised.includes(p.toLowerCase())) ? 80 : 0;
      return { ...acct, score };
    })
    .filter(a => a.score > 0)
    .sort((a, b) => b.score - a.score);

  if (patternMatch.length > 0) {
    const best = patternMatch[0];
    return {
      accountCode: best.code,
      accountName: best.name,
      category: best.category,
      taxType: best.taxType,
      confidence: 75,
      method: "supplier_pattern",
      explanation: `"${supplierName}" is a known ${best.category} supplier from Splash Swimwear's Xero history`,
      alternatives: patternMatch.slice(1).map(a => ({
        code: a.code, name: a.name, category: a.category, score: a.score,
      })),
    };
  }

  // ── LAYER 3: Keyword classification (from description + line items) ──
  const allText = [description, ...(lineItems || []).map(li => li.description || li.product_name || "")].join(" ");

  const keywordScores = XERO_ACCOUNT_CODES
    .map(acct => ({
      ...acct,
      score: scoreKeywordMatch(allText, acct.keywords),
    }))
    .filter(a => a.score > 0)
    .sort((a, b) => b.score - a.score);

  if (keywordScores.length > 0) {
    const best = keywordScores[0];
    return {
      accountCode: best.code,
      accountName: best.name,
      category: best.category,
      taxType: best.taxType,
      confidence: Math.min(70, 40 + best.score * 3),
      method: "keyword",
      explanation: `Description keywords match "${best.category}" pattern`,
      alternatives: keywordScores.slice(1, 4).map(a => ({
        code: a.code, name: a.name, category: a.category, score: a.score,
      })),
    };
  }

  // ── LAYER 4: Default fallback ──
  return {
    accountCode: "51000",
    accountName: "Purchases - Swimwear",
    category: "Swimwear",
    taxType: "GST on Expenses",
    confidence: 20,
    method: "default",
    explanation: "No match found — defaulting to Swimwear (most common category). Please verify and correct.",
    alternatives: [
      { code: "51100", name: "Purchases - Clothing", category: "Clothing & Fashion", score: 0 },
      { code: "51200", name: "Purchases - Accessories & Gifts", category: "Accessories & Gifts", score: 0 },
      { code: "61700", name: "Freight & Cartage", category: "Freight & Shipping", score: 0 },
    ],
  };
}

/** Detect if a specific line item is freight (not product) */
export function isFreightLine(description: string): boolean {
  const lower = (description || "").toLowerCase();
  const freightKeywords = ["freight", "shipping", "cartage", "delivery", "postage", "courier", "surcharge"];
  return freightKeywords.some(k => lower.includes(k));
}

/** Classify each line item individually — handles mixed invoices */
export function classifyInvoiceLines(
  supplierName: string,
  lineItems: { description?: string; product_name?: string; amount?: number }[],
): { productCode: InvoiceCategorisation; freightLines: number[] } {
  const productCode = classifyInvoice(supplierName, "", lineItems);
  const freightLines: number[] = [];

  lineItems.forEach((item, idx) => {
    if (isFreightLine(item.description || item.product_name || "")) {
      freightLines.push(idx);
    }
  });

  return { productCode, freightLines };
}

// ═══════════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════════

function normaliseSupplier(name: string): string {
  return (name || "").toLowerCase()
    .replace(/\bpty\b/g, "").replace(/\bltd\b/g, "")
    .replace(/\baust(ralia)?\b/g, "").replace(/\binc\b/g, "")
    .replace(/\bcorporation\b/g, "").replace(/\bgroup\b/g, "")
    .replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

/** Get all account codes for dropdown selection */
export function getAllAccountCodes(): { code: string; name: string; category: string }[] {
  return XERO_ACCOUNT_CODES.map(a => ({ code: a.code, name: a.name, category: a.category }));
}

/** Seed the supplier history from a Xero bills CSV export */
export function seedFromXeroBillsCSV(rows: Record<string, string>[]): number {
  const supplierCodeMap = new Map<string, Map<string, number>>();

  for (const row of rows) {
    const supplier = row["ContactName"] || "";
    const code = row["AccountCode"] || "";
    if (!supplier || !code) continue;

    if (!supplierCodeMap.has(supplier)) supplierCodeMap.set(supplier, new Map());
    const codes = supplierCodeMap.get(supplier)!;
    codes.set(code, (codes.get(code) || 0) + 1);
  }

  const history = getSupplierHistory();
  let seeded = 0;

  for (const [supplier, codes] of supplierCodeMap) {
    const sorted = [...codes.entries()].sort((a, b) => b[1] - a[1]);
    for (const [code, count] of sorted) {
      const normalised = normaliseSupplier(supplier);
      const existing = history.find(r => normaliseSupplier(r.supplierName) === normalised && r.accountCode === code);
      if (existing) {
        existing.timesUsed += count;
        existing.confidence = Math.min(100, existing.confidence + count * 3);
      } else {
        const acctDef = XERO_ACCOUNT_CODES.find(a => a.code === code);
        history.push({
          supplierName: supplier, accountCode: code,
          accountName: acctDef?.name || `Account ${code}`,
          category: acctDef?.category || "Unknown",
          taxType: "GST on Expenses",
          confidence: Math.min(95, 50 + count * 5),
          timesUsed: count,
          lastUsed: new Date().toISOString(),
        });
        seeded++;
      }
    }
  }

  saveSupplierHistory(history);
  return seeded;
}

/** Export classification stats for display */
export function getClassificationStats(): {
  totalSuppliers: number; totalRules: number;
  topCategories: { category: string; suppliers: number; spend: string }[];
} {
  const history = getSupplierHistory();
  const categoryMap = new Map<string, Set<string>>();

  for (const r of history) {
    if (!categoryMap.has(r.category)) categoryMap.set(r.category, new Set());
    categoryMap.get(r.category)!.add(normaliseSupplier(r.supplierName));
  }

  const topCategories = [...categoryMap.entries()]
    .map(([category, suppliers]) => ({
      category,
      suppliers: suppliers.size,
      spend: "",
    }))
    .sort((a, b) => b.suppliers - a.suppliers)
    .slice(0, 8);

  return {
    totalSuppliers: new Set(history.map(r => normaliseSupplier(r.supplierName))).size,
    totalRules: XERO_ACCOUNT_CODES.length,
    topCategories,
  };
}
