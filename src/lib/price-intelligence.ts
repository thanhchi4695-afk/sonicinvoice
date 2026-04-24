// Price Intelligence Engine — multi-source waterfall for accurate RRP matching

export interface PriceResult {
  price: number | null;
  source: string;
  confidence: number;
  method: string;
  allPrices: { price: number; store: string; currency: string; trusted: boolean }[];
  debugLog: string[];
  imageUrl?: string;
  description?: string;
  cached?: boolean;
  cachedAt?: string;
}

export interface PriceProduct {
  name: string;
  brand: string;
  barcode?: string;
  type?: string;
  tags?: string[];
  currentPrice?: number;
  costPrice?: number;
}

export interface PriceApiKeys {
  barcodeLookup?: string;
  serpApi?: string;
  goUpc?: string;
}

export interface PriceMatchSettings {
  confidenceThreshold: number; // 0-100
  salePriceHandling: 'original' | 'sale' | 'flag';
  auSourcesOnly: boolean;
  priceVarianceAlert: number; // percentage
  waterfallOrder: string[];
}

const DEFAULT_SETTINGS: PriceMatchSettings = {
  confidenceThreshold: 70,
  salePriceHandling: 'original',
  auSourcesOnly: true,
  priceVarianceAlert: 20,
  waterfallOrder: ['barcodeLookup', 'serpApi', 'goUpc', 'claude'],
};

const AU_TRUSTED_RETAILERS = [
  'bond-eye.com.au', 'seafolly.com.au', 'jantzen.com.au', 'ozresort.com.au',
  'splashswimwear.com.au', 'mecca.com.au', 'adorebeauty.com.au', 'sephora.com.au',
  'theiconic.com.au', 'myer.com.au', 'davidjones.com', 'countryroad.com.au',
  'jbhifi.com.au', 'priceline.com.au', 'chemistwarehouse.com.au',
  'kmart.com.au', 'bigw.com.au', 'target.com.au',
  // Boutique fashion brand DTC sites (RRP source of truth)
  'walnutmelbourne.com', 'walnut.com.au',
];

// Marketplaces and discount aggregators are excluded — they show sale/used/grey-market prices,
// not the brand's true RRP, so they skew the median downwards (e.g. Walnut $148.70 vs. RRP $149.95).
const UNTRUSTED_SOURCES = [
  'ebay', 'wish', 'aliexpress', 'amazon', 'temu', 'catch.com', 'trademe',
  'kogan', 'gumtree', 'mydeal', 'ozsale', 'thegrosby', 'shein',
];

/**
 * Derive the brand's own DTC domain candidates from the brand name.
 * "Walnut Melbourne" → ["walnutmelbourne.com", "walnutmelbourne.com.au", "walnut.com.au"]
 * Used to pin the brand's own website as the highest-trust RRP source.
 */
function brandDomainCandidates(brand: string): string[] {
  if (!brand) return [];
  const slug = brand.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!slug) return [];
  // "walnut melbourne" → also try first word ("walnut") on its own
  const firstWord = brand.toLowerCase().split(/\s+/)[0]?.replace(/[^a-z0-9]+/g, '') || '';
  const candidates = new Set<string>([
    `${slug}.com`,
    `${slug}.com.au`,
    `${slug}.co`,
    `www.${slug}.com`,
    `www.${slug}.com.au`,
  ]);
  if (firstWord && firstWord !== slug) {
    candidates.add(`${firstWord}.com.au`);
    candidates.add(`${firstWord}.com`);
  }
  return Array.from(candidates);
}

function isBrandOwnSite(source: string, brand: string): boolean {
  if (!source || !brand) return false;
  const lower = source.toLowerCase();
  return brandDomainCandidates(brand).some((d) => lower.includes(d));
}

// ── Cache ──────────────────────────────────────────────────
const CACHE_KEY = 'price_cache_sonic_invoice';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CacheEntry {
  price: number | null;
  currency: string;
  source: string;
  confidence: number;
  fetchedAt: string;
  expiresAt: string;
  allPrices?: PriceResult['allPrices'];
}

function getCacheKey(p: PriceProduct): string {
  if (p.barcode) return p.barcode;
  return `${p.brand} ${p.name}`.toLowerCase().trim();
}

export function getCache(): Record<string, CacheEntry> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function getCacheStats() {
  const cache = getCache();
  const entries = Object.values(cache);
  return {
    count: entries.length,
    validCount: entries.filter(e => new Date(e.expiresAt) > new Date()).length,
  };
}

export function clearCache() {
  localStorage.removeItem(CACHE_KEY);
}

function getCached(p: PriceProduct): CacheEntry | null {
  const cache = getCache();
  const key = getCacheKey(p);
  const entry = cache[key];
  if (!entry) return null;
  if (new Date(entry.expiresAt) < new Date()) {
    delete cache[key];
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    return null;
  }
  return entry;
}

function setCache(p: PriceProduct, result: PriceResult, currency: string) {
  const cache = getCache();
  const now = new Date();
  cache[getCacheKey(p)] = {
    price: result.price,
    currency,
    source: result.source,
    confidence: result.confidence,
    fetchedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CACHE_TTL_MS).toISOString(),
    allPrices: result.allPrices,
  };
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

// ── API Key Storage ────────────────────────────────────────
const API_KEYS_KEY = 'price_api_keys_sonic_invoice';

export function getApiKeys(): PriceApiKeys {
  try {
    return JSON.parse(localStorage.getItem(API_KEYS_KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveApiKeys(keys: PriceApiKeys) {
  localStorage.setItem(API_KEYS_KEY, JSON.stringify(keys));
}

// ── Settings Storage ───────────────────────────────────────
const SETTINGS_KEY = 'price_match_settings_sonic_invoice';

export function getSettings(): PriceMatchSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: PriceMatchSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

// ── Utility ────────────────────────────────────────────────
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function isTrustedSource(source: string): boolean {
  const lower = source.toLowerCase();
  if (UNTRUSTED_SOURCES.some(u => lower.includes(u))) return false;
  if (AU_TRUSTED_RETAILERS.some(t => lower.includes(t))) return true;
  if (lower.includes('.com.au')) return true;
  return false;
}

/**
 * Stricter fuzzy match: requires BOTH the brand AND meaningful name overlap.
 * Prevents matching a generic product (e.g. "Marrakesh Dress") on the wrong brand.
 * Falls back to a name-only match only when no brand is provided.
 */
function fuzzyMatch(title: string, product: PriceProduct): boolean {
  const t = title.toLowerCase();
  const words = product.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const wordHits = words.filter((w) => t.includes(w)).length;
  const wordMatch = wordHits >= Math.min(2, words.length);
  if (product.brand) {
    const brandLower = product.brand.toLowerCase();
    // Brand hit can be the full brand or its first word (e.g. "Walnut Melbourne" → "walnut")
    const brandFirst = brandLower.split(/\s+/)[0];
    const brandMatch = t.includes(brandLower) || (brandFirst.length >= 4 && t.includes(brandFirst));
    return brandMatch && wordMatch;
  }
  return wordMatch;
}

// ── Edge Function Proxy Caller ─────────────────────────────
async function callPriceProxy(body: {
  source: string;
  barcode?: string;
  query?: string;
  apiKey: string;
  currency?: string;
  locale?: string;
}): Promise<any> {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const url = `https://${projectId}.supabase.co/functions/v1/price-intelligence`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Proxy error: ${resp.status}`);
  return resp.json();
}

// ── Source 1: Barcode Lookup ───────────────────────────────
async function callBarcodeLookup(
  barcode: string, apiKey: string, currency: string
): Promise<{ price: number | null; confidence: number; reason: string; allPrices: PriceResult['allPrices'] }> {
  try {
    const data = await callPriceProxy({ source: 'barcodeLookup', barcode, apiKey, currency });
    if (!data.products || data.products.length === 0) {
      return { price: null, confidence: 0, reason: 'No products found', allPrices: [] };
    }
    const product = data.products[0];
    const stores: { price: number; store: string; currency: string; trusted: boolean }[] = [];
    for (const s of product.stores || []) {
      const p = parseFloat(s.store_price || s.price);
      if (isNaN(p) || p <= 0) continue;
      stores.push({ price: p, store: s.store_name || 'Unknown', currency: s.currency_code || 'USD', trusted: isTrustedSource(s.store_name || '') });
    }
    const auPrices = stores.filter(s => s.currency.toUpperCase() === currency.toUpperCase());
    if (auPrices.length === 0) {
      return { price: null, confidence: 40, reason: 'No ' + currency + ' prices', allPrices: stores };
    }
    // Remove outliers
    const med = median(auPrices.map(s => s.price));
    const filtered = auPrices.filter(s => s.price <= med * 3);
    // Mode-ish: most common price
    const freq: Record<number, number> = {};
    for (const s of filtered) freq[s.price] = (freq[s.price] || 0) + 1;
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
    const bestPrice = parseFloat(sorted[0][0]);
    const agreeing = sorted[0][1];
    const confidence = agreeing >= 3 ? 92 : agreeing === 2 ? 78 : 65;
    return { price: bestPrice, confidence, reason: 'Found', allPrices: stores };
  } catch (err: any) {
    return { price: null, confidence: 0, reason: err.message || 'API error', allPrices: [] };
  }
}

// ── Source 2: Google Shopping (SerpApi) ─────────────────────
async function callGoogleShopping(
  product: PriceProduct, apiKey: string, currency: string
): Promise<{ price: number | null; confidence: number; reason: string; allPrices: PriceResult['allPrices']; imageUrl?: string }> {
  try {
    const query = [product.brand, product.name].filter(Boolean).join(' ');
    const data = await callPriceProxy({ source: 'serpApi', query, apiKey, currency, locale: 'au' });
    const results = data.shopping_results || [];
    if (results.length === 0) {
      return { price: null, confidence: 0, reason: 'No shopping results', allPrices: [] };
    }
    const allPrices: PriceResult['allPrices'] = [];
    const trustedPrices: number[] = [];
    const brandSitePrices: number[] = [];
    let imageUrl: string | undefined;
    for (const r of results) {
      if (!fuzzyMatch(r.title || '', product)) continue;
      const sourceStr = r.source || r.link || '';
      const isBrand = isBrandOwnSite(sourceStr, product.brand);
      const trusted = isBrand || isTrustedSource(sourceStr);
      // Prefer old_price (was/RRP) over sale price
      const price = r.extracted_old_price || r.extracted_price;
      if (!price || price <= 0) continue;
      allPrices.push({ price, store: r.source || 'Unknown', currency, trusted });
      if (isBrand) brandSitePrices.push(price);
      if (trusted) trustedPrices.push(price);
      if (!imageUrl && r.thumbnail) imageUrl = r.thumbnail;
    }
    if (trustedPrices.length === 0 && allPrices.length === 0) {
      return { price: null, confidence: 0, reason: 'No matching results', allPrices: [] };
    }
    // Tier 1: brand's own DTC site is the source of truth for RRP — use it directly.
    if (brandSitePrices.length > 0) {
      const brandRrp = Math.max(...brandSitePrices); // highest = RRP, ignores any sale variants
      return { price: brandRrp, confidence: 95, reason: 'Brand DTC site', allPrices, imageUrl };
    }
    // Tier 2: trusted AU retailers — median of trusted listings.
    // Tier 3 (fallback only): mixed sources, lower confidence.
    const pricesToUse = trustedPrices.length > 0 ? trustedPrices : allPrices.map((p) => p.price);
    const rrp = median(pricesToUse);
    const confidence = trustedPrices.length >= 3 ? 90 : trustedPrices.length >= 1 ? 75 : 55;
    return { price: rrp, confidence, reason: 'Found', allPrices, imageUrl };
  } catch (err: any) {
    return { price: null, confidence: 0, reason: err.message || 'API error', allPrices: [] };
  }
}

// ── Source 3: Go-UPC ───────────────────────────────────────
async function callGoUpc(
  barcode: string, apiKey: string, currency: string
): Promise<{ price: number | null; confidence: number; reason: string; description?: string; imageUrl?: string }> {
  try {
    const data = await callPriceProxy({ source: 'goUpc', barcode, apiKey, currency });
    const product = data.product || data;
    const description = product.description || undefined;
    const imageUrl = product.imageUrl || product.image || undefined;
    // Go-UPC pricing is less structured
    if (product.msrp || product.price) {
      const price = parseFloat(product.msrp || product.price);
      if (!isNaN(price) && price > 0) {
        return { price, confidence: 60, reason: 'Found', description, imageUrl };
      }
    }
    return { price: null, confidence: 35, reason: 'No price data', description, imageUrl };
  } catch (err: any) {
    return { price: null, confidence: 0, reason: err.message || 'API error' };
  }
}

// ── Source 4: Server-side Firecrawl fallback ──────────────
// Uses the same edge functions as Phase 3 / Price Lookup so users without
// SerpApi/Barcode keys still get real RRP from the brand's own website.
//   1. price-lookup-search → resolve the brand product URL (DTC site preferred)
//   2. price-lookup-extract → scrape the page and pull retail_price_aud
async function callClaudeFallback(
  product: PriceProduct,
  _currency: string,
): Promise<{ price: number | null; confidence: number; source?: string; imageUrl?: string; description?: string }> {
  try {
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!projectId || !anonKey) return { price: null, confidence: 0 };

    const baseHeaders = {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    };

    // Step 1 — find a product URL (prefer brand DTC site).
    const searchResp = await fetch(
      `https://${projectId}.supabase.co/functions/v1/price-lookup-search`,
      {
        method: 'POST',
        headers: baseHeaders,
        body: JSON.stringify({
          product_name: product.name,
          supplier: product.brand,
          style_number: '',
          colour: '',
        }),
      },
    );
    if (!searchResp.ok) return { price: null, confidence: 0 };
    const searchData = await searchResp.json();
    const results: any[] = searchData?.results || [];
    if (results.length === 0) return { price: null, confidence: 0 };

    // Pick the top-ranked URL — search already sorted brand DTC first.
    const top = results.find((r) => r.url) || results[0];
    if (!top?.url) return { price: null, confidence: 0 };

    // Step 2 — scrape that URL and extract the AUD retail price.
    const extractResp = await fetch(
      `https://${projectId}.supabase.co/functions/v1/price-lookup-extract`,
      {
        method: 'POST',
        headers: baseHeaders,
        body: JSON.stringify({
          url: top.url,
          product_name: product.name,
          supplier: product.brand,
          supplier_cost: product.costPrice,
        }),
      },
    );
    if (!extractResp.ok) return { price: null, confidence: 0 };
    const extracted = await extractResp.json();
    const price = extracted?.retail_price_aud ?? extracted?.compare_at_price_aud ?? null;
    if (!price || price <= 0) return { price: null, confidence: 0 };

    const conf = Math.min(95, Math.max(60, extracted?.currency_confidence ?? 80));
    return {
      price: Number(price),
      confidence: conf,
      source: top.domain || extracted?.retailer_name || 'Brand site',
      imageUrl: extracted?.image_urls?.[0],
      description: extracted?.description,
    };
  } catch (err) {
    console.warn('[price-intelligence] fallback search failed:', err);
    return { price: null, confidence: 0 };
  }
}

// ── Main Waterfall Engine ──────────────────────────────────
export async function matchPrice(
  product: PriceProduct,
  currency: string = 'AUD',
  apiKeys?: PriceApiKeys,
  settings?: PriceMatchSettings,
  skipCache: boolean = false,
): Promise<PriceResult> {
  const keys = apiKeys || getApiKeys();
  const config = settings || getSettings();

  // Check cache first
  if (!skipCache) {
    const cached = getCached(product);
    if (cached && cached.price !== null) {
      return {
        price: cached.price,
        source: cached.source,
        confidence: cached.confidence,
        method: 'cache',
        allPrices: cached.allPrices || [],
        debugLog: ['✓ Using cached price from ' + cached.source + ' (' + cached.fetchedAt + ')'],
        cached: true,
        cachedAt: cached.fetchedAt,
      };
    }
  }

  const result: PriceResult = {
    price: null, source: '', confidence: 0, method: '', allPrices: [], debugLog: [],
  };

  // Source 1: Barcode Lookup
  if (keys.barcodeLookup && product.barcode) {
    const bl = await callBarcodeLookup(product.barcode, keys.barcodeLookup, currency);
    if (bl.price && bl.confidence >= 65) {
      result.price = bl.price;
      result.source = 'Barcode Lookup';
      result.confidence = bl.confidence;
      result.method = 'barcode_api';
      result.allPrices = bl.allPrices;
      result.debugLog.push('✓ Source 1 (Barcode Lookup): found');
      setCache(product, result, currency);
      return result;
    }
    result.debugLog.push('○ Source 1 (Barcode Lookup): ' + bl.reason);
  } else {
    result.debugLog.push('— Source 1 (Barcode Lookup): skipped ' +
      (!keys.barcodeLookup ? '(no API key)' : '(no barcode)'));
  }

  // Source 2: Google Shopping
  if (keys.serpApi) {
    const gs = await callGoogleShopping(product, keys.serpApi, currency);
    if (gs.price && gs.confidence >= 65) {
      result.price = gs.price;
      result.source = 'Google Shopping';
      result.confidence = gs.confidence;
      result.method = 'google_shopping';
      result.allPrices = gs.allPrices;
      if (gs.imageUrl) result.imageUrl = gs.imageUrl;
      result.debugLog.push('✓ Source 2 (Google Shopping): found');
      setCache(product, result, currency);
      return result;
    }
    result.debugLog.push('○ Source 2 (Google Shopping): ' + gs.reason);
  } else {
    result.debugLog.push('— Source 2 (Google Shopping): skipped (no API key)');
  }

  // Source 3: Go-UPC
  if (keys.goUpc && product.barcode) {
    const gu = await callGoUpc(product.barcode, keys.goUpc, currency);
    if (gu.price && gu.confidence >= 50) {
      result.price = gu.price;
      result.source = 'Go-UPC';
      result.confidence = gu.confidence;
      result.method = 'go_upc';
      result.debugLog.push('✓ Source 3 (Go-UPC): found');
      setCache(product, result, currency);
      return result;
    }
    if (gu.description) result.description = gu.description;
    if (gu.imageUrl) result.imageUrl = gu.imageUrl;
    result.debugLog.push('○ Source 3 (Go-UPC): ' + gu.reason);
  } else {
    result.debugLog.push('— Source 3 (Go-UPC): skipped ' +
      (!keys.goUpc ? '(no API key)' : '(no barcode)'));
  }

  // Source 4: Claude fallback
  result.debugLog.push('→ Source 4 (Claude AI): searching...');
  const claude = await callClaudeFallback(product, currency);
  result.price = claude.price;
  result.source = 'Claude AI Search';
  result.confidence = claude.confidence || 45;
  result.method = 'claude_web_search';
  result.debugLog.push(claude.price
    ? '✓ Source 4 (Claude AI): found'
    : '✗ Source 4 (Claude AI): not found');

  if (result.price) setCache(product, result, currency);
  return result;
}

// ── Batch match ────────────────────────────────────────────
export async function matchPricesBatch(
  products: PriceProduct[],
  currency: string = 'AUD',
  onProgress?: (done: number, total: number, current: PriceResult) => void,
): Promise<PriceResult[]> {
  const results: PriceResult[] = [];
  for (let i = 0; i < products.length; i++) {
    const r = await matchPrice(products[i], currency);
    results.push(r);
    onProgress?.(i + 1, products.length, r);
  }
  return results;
}

// ── Source badge helpers ───────────────────────────────────
export function getSourceBadge(method: string): { color: string; label: string } {
  switch (method) {
    case 'barcode_api': return { color: 'bg-success/15 text-success', label: '🟢 Barcode Lookup' };
    case 'google_shopping': return { color: 'bg-primary/15 text-primary', label: '🔵 Google Shopping' };
    case 'go_upc': return { color: 'bg-warning/15 text-warning', label: '🟡 Go-UPC' };
    case 'claude_web_search': return { color: 'bg-muted text-muted-foreground', label: '⚪ Claude AI' };
    case 'cache': return { color: 'bg-muted text-muted-foreground', label: '💾 Cached' };
    default: return { color: 'bg-muted text-muted-foreground', label: 'Unknown' };
  }
}

export function getConfidenceColor(c: number): string {
  if (c >= 80) return 'text-success';
  if (c >= 50) return 'text-warning';
  return 'text-destructive';
}

export function getConfidenceBarColor(c: number): string {
  if (c >= 80) return 'bg-success';
  if (c >= 50) return 'bg-warning';
  return 'bg-destructive';
}
