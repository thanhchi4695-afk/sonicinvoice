// Barcode Catalog — localStorage-based barcode-to-product lookup

export interface BarcodeCatalogEntry {
  title: string;
  vendor: string;
  sku: string;
  type: string;
  addedDate: string;
}

export type BarcodeCatalog = Record<string, BarcodeCatalogEntry>;

const BARCODE_CATALOG_KEY = "barcode_catalog";

export function getBarcodeCatalog(): BarcodeCatalog {
  try { return JSON.parse(localStorage.getItem(BARCODE_CATALOG_KEY) || "{}"); } catch { return {}; }
}

export function saveBarcodeCatalog(catalog: BarcodeCatalog) {
  localStorage.setItem(BARCODE_CATALOG_KEY, JSON.stringify(catalog));
}

export function lookupBarcode(barcode: string): BarcodeCatalogEntry | null {
  if (!barcode) return null;
  const catalog = getBarcodeCatalog();
  return catalog[barcode] || null;
}

export function saveBarcodeToCatalog(barcode: string, entry: BarcodeCatalogEntry) {
  const catalog = getBarcodeCatalog();
  catalog[barcode] = entry;
  saveBarcodeCatalog(catalog);
}

export function removeBarcode(barcode: string) {
  const catalog = getBarcodeCatalog();
  delete catalog[barcode];
  saveBarcodeCatalog(catalog);
}

export function getBarcodeCatalogCount(): number {
  return Object.keys(getBarcodeCatalog()).length;
}

export type MatchSource = "barcode" | "sku" | "name" | "none";

export interface MatchResult {
  source: MatchSource;
  entry: BarcodeCatalogEntry | null;
  barcode?: string;
}

/** Run full matching priority: barcode → SKU → name (catalog memory) → none */
export function matchProduct(barcode?: string, sku?: string, name?: string): MatchResult {
  // 1. Barcode match
  if (barcode) {
    const entry = lookupBarcode(barcode);
    if (entry) return { source: "barcode", entry, barcode };
  }
  // 2. SKU match in barcode catalog
  if (sku) {
    const catalog = getBarcodeCatalog();
    const found = Object.entries(catalog).find(([, e]) => e.sku.toLowerCase() === sku.toLowerCase());
    if (found) return { source: "sku", entry: found[1], barcode: found[0] };
  }
  // 3. Name match in barcode catalog
  if (name) {
    const q = name.toLowerCase().trim();
    const catalog = getBarcodeCatalog();
    const found = Object.entries(catalog).find(([, e]) => e.title.toLowerCase().includes(q) || q.includes(e.title.toLowerCase()));
    if (found) return { source: "name", entry: found[1], barcode: found[0] };
  }
  return { source: "none", entry: null };
}

// Seed demo barcode catalog
(function seedBarcodeCatalog() {
  const catalog = getBarcodeCatalog();
  if (Object.keys(catalog).length > 0) return;
  const seed: BarcodeCatalog = {
    "9351234567890": { title: "Retro Racerback", vendor: "Jantzen", sku: "JA81520", type: "One Piece", addedDate: "2026-03-15" },
    "9350987654321": { title: "Collective Bikini Top", vendor: "Seafolly", sku: "SF10023", type: "Bikini Tops", addedDate: "2026-03-10" },
    "9312345678901": { title: "Mood Bandeau Blouson Singlet", vendor: "Jantzen", sku: "JA81525", type: "Tops", addedDate: "2026-03-20" },
    "9350111222333": { title: "Riviera High Waist Pant", vendor: "Baku", sku: "BK20015", type: "Bikini Bottoms", addedDate: "2026-03-18" },
    "9350444555666": { title: "Mara One Piece", vendor: "Bond Eye", sku: "BE10042", type: "One Piece", addedDate: "2026-03-22" },
  };
  saveBarcodeCatalog(seed);
})();

// ── Colour extraction from titles ──────────────────────────
export const COLOUR_ABBR: Record<string, string> = {
  'BLK': 'Black', 'WHT': 'White', 'NVY': 'Navy', 'IVY': 'Ivory',
  'RD': 'Red', 'GRN': 'Green', 'BLU': 'Blue', 'MLT': 'Multi',
  'ARM': 'Army', 'KHK': 'Khaki', 'PNK': 'Pink', 'GLD': 'Gold',
  'SIL': 'Silver', 'BRN': 'Brown', 'PRP': 'Purple',
  'YLW': 'Yellow', 'ORG': 'Orange', 'TRQ': 'Turquoise',
  'PRT': 'Print', 'CRM': 'Cream', 'GRY': 'Grey',
  'EMR': 'Emerald', 'CRL': 'Coral', 'RST': 'Rust',
  'NAV': 'Navy',
};

export function extractColourFromTitle(title: string): string {
  if (!title) return '';
  const dashMatch = title.match(/[-/]\s*([^-/]+)$/);
  if (!dashMatch) return '';
  const candidate = dashMatch[1].trim();
  const upper = candidate.toUpperCase();
  if (COLOUR_ABBR[upper]) return COLOUR_ABBR[upper];
  const sizePattern = /^(AU\d+|US\d+|XS|S|M|L|XL|XXL|OS|\d+)$/i;
  if (sizePattern.test(candidate)) return '';
  return candidate;
}

export function extractSizeFromTitle(title: string): string {
  if (!title) return '';
  const sizeMatch = title.match(/\b(AU\d+|US\d+|XS|XXS|S|M|L|XL|XXL|XXXL|One\s*Size|OS|Free\s*Size)\b/i);
  return sizeMatch ? sizeMatch[1] : '';
}

// ── GTIN validation ────────────────────────────────────────
export function validateGTIN(value: string): string {
  if (!value) return '';
  const digits = String(value).replace(/\D/g, '');
  if (![8, 12, 13].includes(digits.length)) return '';
  const arr = digits.split('').map(Number);
  const check = arr.pop()!;
  const sum = arr.reverse().reduce((acc, n, i) => acc + (i % 2 === 0 ? n * 3 : n), 0);
  const calculated = (10 - (sum % 10)) % 10;
  return calculated === check ? digits : '';
}
