// Collection Engine — maps tags to Shopify smart collections
import { getStoreConfig } from './prompt-builder';

export interface CollectionRule {
  name: string;
  triggerTags: string[]; // all must match (AND)
  matchMode: 'all' | 'any'; // default 'all'
}

const COLLECTIONS_KEY = 'collection_rules';

// ── Default swimwear collections ───────────────────────────
const SWIMWEAR_DEFAULTS: CollectionRule[] = [
  { name: "Womens Swimwear", triggerTags: ["Womens", "Swimwear"], matchMode: "all" },
  { name: "Womens One Pieces", triggerTags: ["Womens", "One Pieces"], matchMode: "all" },
  { name: "Womens Bikini Tops", triggerTags: ["Womens", "Bikini Tops"], matchMode: "all" },
  { name: "Womens Bikini Bottoms", triggerTags: ["Womens", "bikini bottoms"], matchMode: "all" },
  { name: "Womens Bikini Sets", triggerTags: ["Womens", "Bikini Set"], matchMode: "all" },
  { name: "Womens Tankini", triggerTags: ["Womens", "tankini tops"], matchMode: "all" },
  { name: "Womens Rashies", triggerTags: ["Womens", "rashies & sunsuits"], matchMode: "all" },
  { name: "Womens Clothing", triggerTags: ["Womens", "clothing"], matchMode: "all" },
  { name: "Womens Dresses", triggerTags: ["Womens", "Dresses"], matchMode: "all" },
  { name: "Womens Kaftans", triggerTags: ["Womens", "kaftans & cover ups"], matchMode: "all" },
  { name: "Mens Swimwear", triggerTags: ["mens", "mens swim"], matchMode: "all" },
  { name: "Kids Swimwear", triggerTags: ["kids", "Girls swimwear"], matchMode: "all" },
  { name: "Accessories", triggerTags: ["accessories"], matchMode: "any" },
  { name: "Hats", triggerTags: ["hats"], matchMode: "any" },
  { name: "Sunglasses", triggerTags: ["sunglasses"], matchMode: "any" },
  { name: "D-G Cup", triggerTags: ["d-g"], matchMode: "any" },
  { name: "Chlorine Resistant", triggerTags: ["chlorine resist"], matchMode: "any" },
  { name: "Plus Size", triggerTags: ["plus size"], matchMode: "any" },
  { name: "Tummy Control", triggerTags: ["tummy control"], matchMode: "any" },
  { name: "Mastectomy", triggerTags: ["mastectomy"], matchMode: "any" },
  { name: "New Arrivals", triggerTags: ["new arrivals"], matchMode: "any" },
];

const CLOTHING_DEFAULTS: CollectionRule[] = [
  { name: "Womens", triggerTags: ["Womens"], matchMode: "any" },
  { name: "Mens", triggerTags: ["Mens"], matchMode: "any" },
  { name: "Dresses", triggerTags: ["Dresses"], matchMode: "any" },
  { name: "Tops", triggerTags: ["Tops"], matchMode: "any" },
  { name: "Bottoms", triggerTags: ["Bottoms"], matchMode: "any" },
  { name: "Outerwear", triggerTags: ["Outerwear"], matchMode: "any" },
  { name: "Accessories", triggerTags: ["Accessories"], matchMode: "any" },
  { name: "New Arrivals", triggerTags: ["new arrivals"], matchMode: "any" },
];

const BEAUTY_DEFAULTS: CollectionRule[] = [
  { name: "Skincare", triggerTags: ["Skincare"], matchMode: "any" },
  { name: "Makeup", triggerTags: ["Makeup"], matchMode: "any" },
  { name: "Fragrance", triggerTags: ["Fragrance"], matchMode: "any" },
  { name: "Hair Care", triggerTags: ["Hair Care"], matchMode: "any" },
  { name: "Body Care", triggerTags: ["Body Care"], matchMode: "any" },
  { name: "New Arrivals", triggerTags: ["new arrivals"], matchMode: "any" },
];

const GENERAL_DEFAULTS: CollectionRule[] = [
  { name: "New Arrivals", triggerTags: ["new arrivals"], matchMode: "any" },
];

const INDUSTRY_DEFAULTS: Record<string, CollectionRule[]> = {
  swimwear: SWIMWEAR_DEFAULTS,
  clothing: CLOTHING_DEFAULTS,
  beauty: BEAUTY_DEFAULTS,
  health: GENERAL_DEFAULTS,
  electronics: GENERAL_DEFAULTS,
  home: GENERAL_DEFAULTS,
  sports: GENERAL_DEFAULTS,
  kids: GENERAL_DEFAULTS,
  general: GENERAL_DEFAULTS,
};

// ── Persistence ────────────────────────────────────────────
export function getCollectionRules(): CollectionRule[] {
  try {
    const raw = localStorage.getItem(COLLECTIONS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  const config = getStoreConfig();
  return INDUSTRY_DEFAULTS[config.industry] || GENERAL_DEFAULTS;
}

export function saveCollectionRules(rules: CollectionRule[]) {
  localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(rules));
}

export function resetCollectionRules() {
  localStorage.removeItem(COLLECTIONS_KEY);
}

// ── Matching ───────────────────────────────────────────────
export function matchCollections(productTags: string[]): string[] {
  const rules = getCollectionRules();
  const lower = productTags.map(t => t.toLowerCase());

  return rules.filter(rule => {
    if (rule.matchMode === 'any') {
      return rule.triggerTags.some(tt => lower.includes(tt.toLowerCase()));
    }
    return rule.triggerTags.every(tt => lower.includes(tt.toLowerCase()));
  }).map(r => r.name);
}

// Brand-based collections: any brand tag also creates a collection
export function matchCollectionsWithBrand(productTags: string[], brand: string): string[] {
  const collections = matchCollections(productTags);
  if (brand && !collections.includes(brand)) {
    collections.push(brand);
  }
  return collections;
}

// ── Coverage check ─────────────────────────────────────────
export interface CoverageResult {
  productName: string;
  collections: string[];
  hasSpecificCollection: boolean;
  suggestion?: string;
}

export function checkCoverage(
  products: { name: string; tags: string[]; brand: string; type: string }[]
): { results: CoverageResult[]; assignedCount: number; total: number } {
  const results = products.map(p => {
    const collections = matchCollectionsWithBrand(p.tags, p.brand);
    const meaningful = collections.filter(c => c !== "New Arrivals" && c !== p.brand);
    return {
      productName: p.name,
      collections,
      hasSpecificCollection: meaningful.length > 0,
      suggestion: meaningful.length === 0 ? `Check tags include '${p.type?.toLowerCase() || "a product type"}'` : undefined,
    };
  });
  return {
    results,
    assignedCount: results.filter(r => r.hasSpecificCollection).length,
    total: results.length,
  };
}
