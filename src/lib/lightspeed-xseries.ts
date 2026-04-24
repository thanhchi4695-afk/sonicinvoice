// Lightspeed X-Series CSV export utilities
// Schema matches the official Lightspeed product-export CSV
// (see user-uploads://product-export-12.csv for the canonical header).
import Papa from 'papaparse';
import { getPublishStatus, lightspeedActiveValue } from './publish-status';
import { normaliseVendor } from './normalise-vendor';
import { expandLineBySize } from './size-run-expander';

// ── Types ──────────────────────────────────────────────────
export interface XSeriesVariant {
  size?: string;
  colour?: string;
  sku?: string;        // variant SKU (will be made unique per size if collisions)
  quantity?: number;   // extracted_qty from invoice (NOT received_qty)
  supplyPrice?: number; // per-variant cost ex GST (overrides product.price)
  retailPrice?: number; // per-variant RRP (overrides product.rrp)
}

export interface XSeriesProduct {
  title: string;
  brand: string;
  type: string;          // → product_category
  price: number;         // supply/cost price (ex GST) — fallback when variant has none
  rrp: number;           // retail price — fallback when variant has none
  description?: string;
  tags?: string;
  supplierCode?: string; // style-level code, lives in supplier_code column
  supplierName?: string;
  season?: string;       // e.g. "W26" — used in description fallback + tags
  arrivalDate?: string;  // ISO date — used to derive arrival month tag (Apr26)
  variants?: XSeriesVariant[];
}

export interface XSeriesSettings {
  outletName: string;       // e.g. "Main Outlet"
  taxName: string;          // e.g. "Default Tax" or "GST"
  useReorderPoints: boolean;
  reorderPoint: number;
  reorderAmount: number;    // → restock_level_<outlet>
  nameFormat: 'brand_first' | 'product_only';
  attributeOrder: 'size_first' | 'colour_first' | 'auto';
  trackInventory: boolean;
}

export interface XSeriesValidationError {
  row: number;
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

const DEFAULT_SETTINGS: XSeriesSettings = {
  outletName: 'Main Outlet',
  taxName: 'Default Tax',
  useReorderPoints: false,
  reorderPoint: 2,
  reorderAmount: 6,
  nameFormat: 'product_only', // B1 #5 — never prefix the brand into the name column
  attributeOrder: 'colour_first', // matches real export (Colour, Size)
  trackInventory: true,
};

// ── Lightspeed export conventions (from canonical product-export_4.csv) ──
// Lightspeed's own X-Series exports emit:
//   • brand_name / supplier_name in UPPERCASE
//   • name, product_category and variant values in UPPERCASE
//   • tags joined with ";" (semicolons), not commas
//   • loyalty_value_default = retail × 0.055 (3 dp)
//   • tax_value = retail / 11 (5 dp)  // 10% GST component, ex-GST share
// We mirror those so re-imports round-trip cleanly.
const LOYALTY_RATE = 0.055;
function lsCase(s: string | null | undefined): string {
  return (s || '').toString().trim().toUpperCase();
}
function joinTagsLs(tags: string | string[] | null | undefined): string {
  if (!tags) return '';
  const arr = Array.isArray(tags)
    ? tags
    : String(tags).split(/[,;]/);
  return arr
    .map(t => t.trim())
    .filter(Boolean)
    .join(';');
}
function loyaltyDefault(retail: number): string {
  if (!retail || retail <= 0) return '';
  return (retail * LOYALTY_RATE).toFixed(3);
}
function taxValue(retail: number): string {
  if (!retail || retail <= 0) return '';
  return (retail / 11).toFixed(5);
}

const LS_SETTINGS_KEY = 'ls_xseries_settings';

export function getXSeriesSettings(): XSeriesSettings {
  try {
    const saved = localStorage.getItem(LS_SETTINGS_KEY);
    if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
  } catch {}
  return DEFAULT_SETTINGS;
}

export function saveXSeriesSettings(s: Partial<XSeriesSettings>) {
  const current = getXSeriesSettings();
  localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify({ ...current, ...s }));
}

// ── Title-case helpers (B1 #5) ─────────────────────────────
const ACRONYM_RE = /^[A-Z0-9&]{2,}$/;

/** Title-case a product/colour name while preserving intentional acronyms (G2M, UPF). */
export function titleCase(raw: string | null | undefined): string {
  if (!raw) return '';
  return String(raw)
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(word => {
      if (ACRONYM_RE.test(word) && word.length <= 4) return word; // G2M, UPF, ABC
      // Handle hyphenated words: "tie-side" -> "Tie-Side"
      if (word.includes('-')) {
        return word.split('-').map(p =>
          p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : p,
        ).join('-');
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Strip a brand from a product title if it's been prefixed (or suffixed,
 * or wrapped in [BRACKETS]) onto the name.
 *
 * Walnut Round 2 evidence: AI-extracted titles arrive as
 *   "WALNUT MELBOURNE [WALNUT MELBOURNE] MARRAKESH DRESS"
 * which needs the brand stripped from BOTH the leading position AND
 * the bracketed insertion. We run repeatedly until stable so even
 * triplicate brand prefixes ("BRAND BRAND BRAND Marrakesh") collapse
 * down to just "Marrakesh".
 */
export function stripBrandPrefix(name: string, brand: string): string {
  if (!name || !brand) return name || '';
  const b = brand.trim();
  if (!b) return name.trim();
  const escaped = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match: leading "BRAND ", trailing " BRAND", or anywhere "[BRAND]" / "(BRAND)".
  const leadingRe = new RegExp(`^${escaped}\\s+`, 'i');
  const trailingRe = new RegExp(`\\s+${escaped}$`, 'i');
  const bracketedRe = new RegExp(`\\s*[\\[\\(]\\s*${escaped}\\s*[\\]\\)]\\s*`, 'gi');
  let prev = '';
  let cur = name.trim();
  // Iterate to a fixed point so repeated prefixes/brackets all collapse.
  while (cur !== prev) {
    prev = cur;
    cur = cur
      .replace(bracketedRe, ' ')
      .replace(leadingRe, '')
      .replace(trailingRe, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  return cur;
}

/** Three-letter month + 2-digit year. September is the only 4-letter exception ("Sept26"). */
export function arrivalMonthTag(date: Date | string | null | undefined): string {
  const d = date ? new Date(date) : new Date();
  if (isNaN(d.getTime())) return arrivalMonthTag(new Date());
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
  const m = months[d.getMonth()];
  const yy = String(d.getFullYear()).slice(-2);
  return `${m}${yy}`;
}

// ── Handle generation ──────────────────────────────────────
// Walnut Round 2, Bug #7: handle was "walnut-melbourne-walnut-melbourne-…"
// because the brand was being slugged in once from `brand` and once more
// from a brand-prefixed `title`. Strip the brand off the title first so the
// final slug only contains the brand once: "walnut-melbourne-marrakesh-dress".
export function generateHandle(title: string, brand: string): string {
  const cleanTitle = stripBrandPrefix(title, brand);
  return `${brand} ${cleanTitle}`
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/(^-|-$)/g, '');
}

function ensureUniqueHandles(handles: string[]): string[] {
  const counts: Record<string, number> = {};
  return handles.map(h => {
    counts[h] = (counts[h] || 0) + 1;
    return counts[h] > 1 ? `${h}-${counts[h]}` : h;
  });
}

// ── SKU generation ─────────────────────────────────────────
function sanitiseSku(s: string): string {
  return s.replace(/[^a-zA-Z0-9-]/g, '');
}

function generateVariantSku(baseCode: string, colour: string, size: string): string {
  const c = colour.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 3);
  const s = size.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return sanitiseSku(`${baseCode}${c}${s}`);
}

// ── Size sort ──────────────────────────────────────────────
const SIZE_ORDER = ['6', '8', '10', '12', '14', '16', '18', '20', '22', '24', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
function sizeRank(s: string): number {
  const idx = SIZE_ORDER.indexOf(s.toUpperCase());
  return idx >= 0 ? idx : 999;
}

// ── Description fallback (B1 #4) ───────────────────────────
function buildDescription(p: XSeriesProduct, colour: string): string {
  if (p.description && p.description.trim()) return p.description.replace(/[\r\n]+/g, ' ');
  const parts: string[] = [];
  const name = titleCase(stripBrandPrefix(p.title, p.brand));
  const col = titleCase(colour);
  const brand = normaliseVendor(p.brand);
  parts.push(col ? `${name} in ${col}.` : `${name}.`);
  if (brand) parts.push(`${brand}${p.season ? ` ${p.season}` : ''} collection.`);
  return parts.join(' ').trim();
}

// ── CSV Row builder ────────────────────────────────────────
// Column order MIRRORS the Lightspeed product-export header exactly.
interface CsvRow {
  id: string;
  handle: string;
  sku: string;
  composite_name: string;
  composite_sku: string;
  composite_quantity: string;
  name: string;
  description: string;
  product_category: string;
  variant_option_one_name: string;
  variant_option_one_value: string;
  variant_option_two_name: string;
  variant_option_two_value: string;
  variant_option_three_name: string;
  variant_option_three_value: string;
  tags: string;
  supply_price: string;
  retail_price: string;
  loyalty_value: string;
  loyalty_value_default: string;
  tax_name: string;
  tax_value: string;
  account_code: string;
  account_code_purchase: string;
  brand_name: string;
  supplier_name: string;
  supplier_code: string;
  active: string;
  track_inventory: string;
  [key: string]: string; // dynamic inventory_<outlet>, reorder_point_<outlet>, restock_level_<outlet>
}

export function generateXSeriesCSV(
  products: XSeriesProduct[],
  settings?: Partial<XSeriesSettings>,
): { csv: string; errors: XSeriesValidationError[]; rowCount: number } {
  const s = { ...getXSeriesSettings(), ...settings };
  const outletKey = s.outletName.replace(/\s+/g, '_');
  const stockCol = `inventory_${outletKey}`;
  const reorderPointCol = `reorder_point_${outletKey}`;
  const restockLevelCol = `restock_level_${outletKey}`;

  const allRows: CsvRow[] = [];
  const errors: XSeriesValidationError[] = [];
  const activeFlag = lightspeedActiveValue(getPublishStatus());

  // Generate unique handles per product
  const rawHandles = products.map(p => generateHandle(p.title, p.brand));
  const uniqueHandles = ensureUniqueHandles(rawHandles);

  products.forEach((product, pi) => {
    const handle = uniqueHandles[pi];

    // B1 #5 — clean name and brand. Strip duplicate brand prefix, title-case.
    const cleanBrand = normaliseVendor(product.brand);
    const cleanTitle = titleCase(stripBrandPrefix(product.title, product.brand));
    const displayName = s.nameFormat === 'brand_first'
      ? `${cleanBrand} ${cleanTitle}`.trim()
      : cleanTitle;

    // B1 #6 — supplier_code is style-level (parent). Variant SKUs are per-variant.
    const styleCode = product.supplierCode
      || sanitiseSku(`${cleanBrand.replace(/\s/g, '').toUpperCase().slice(0, 3)}${String(pi + 1).padStart(3, '0')}`);

    // B1 #1 — fan out any "8-16" range survivors into N variants with per-cell qty.
    // (The parse-invoice prompt already aims for one row per Size:/Qty: cell,
    //  but this is a belt-and-braces guard for ranges that slip through.)
    const expandedVariants: XSeriesVariant[] = (product.variants || []).flatMap(v => {
      const expanded = expandLineBySize({
        sku: v.sku,
        size: v.size,
        qty: v.quantity ?? 0,
      });
      return expanded.map(e => ({
        ...v,
        sku: e.sku,
        size: e.size,
        quantity: e.qty,
      }));
    }).filter(v => (v.quantity ?? 0) > 0); // B1 #1 — skip zero-qty cells (no row for empty matrix slots)

    const hasVariants = expandedVariants.length > 0;

    const baseRow = (): CsvRow => ({
      id: '', // blank → Lightspeed creates new
      handle,
      sku: '',
      composite_name: '',
      composite_sku: '',
      composite_quantity: '',
      // Lightspeed's own export uses UPPERCASE for the name column.
      name: lsCase(displayName),
      description: '',
      product_category: lsCase(product.type || ''),
      variant_option_one_name: '',
      variant_option_one_value: '',
      variant_option_two_name: '',
      variant_option_two_value: '',
      variant_option_three_name: '',
      variant_option_three_value: '',
      tags: '',
      // B1 #2 — supply_price = cost ex GST, retail_price = RRP. NEVER the same number.
      supply_price: (product.price || 0).toFixed(2),
      retail_price: (product.rrp || 0).toFixed(2),
      loyalty_value: '',
      loyalty_value_default: loyaltyDefault(product.rrp || 0),
      tax_name: s.taxName,
      tax_value: taxValue(product.rrp || 0),
      account_code: '',
      account_code_purchase: '',
      brand_name: lsCase(cleanBrand),
      supplier_name: lsCase(product.supplierName || cleanBrand),
      supplier_code: styleCode, // style-level
      active: activeFlag,
      track_inventory: s.trackInventory ? '1' : '0',
      [stockCol]: '0',
      [reorderPointCol]: s.useReorderPoints ? String(s.reorderPoint) : '',
      [restockLevelCol]: s.useReorderPoints ? String(s.reorderAmount) : '',
    });

    if (!hasVariants) {
      const row = baseRow();
      row.sku = sanitiseSku(styleCode);
      row.description = buildDescription(product, '');
      row.tags = joinTagsLs(product.tags);
      row[stockCol] = '0';
      allRows.push(row);
      return;
    }

    // Sort variants
    const sorted = [...expandedVariants].sort((a, b) => {
      if (s.attributeOrder === 'size_first') {
        const sd = sizeRank(a.size || '') - sizeRank(b.size || '');
        return sd !== 0 ? sd : (a.colour || '').localeCompare(b.colour || '');
      }
      const cd = (a.colour || '').localeCompare(b.colour || '');
      return cd !== 0 ? cd : sizeRank(a.size || '') - sizeRank(b.size || '');
    });

    const [attr1Name, attr2Name] = s.attributeOrder === 'size_first'
      ? ['Size', 'Colour']
      : ['Colour', 'Size'];

    sorted.forEach((v, vi) => {
      const isFirst = vi === 0;
      // B1 #6 — append size to style code so each variant SKU is unique.
      // Walnut Round 2, Bug #4: Lightspeed treats SKU as the unique variant
      // key. The previous logic used `endsWith(size)` to skip appending — that
      // accidentally matched style-codes already containing the size's digits
      // (e.g. "Mosaique-26" looks like it "ends with 6"), leaving every size
      // sharing one SKU and Lightspeed merging the rows on import.
      // Always append "-{size}" when a size is present and not already a
      // delimited segment of the SKU.
      const variantSku = v.sku
        ? sanitiseSku(v.sku)
        : generateVariantSku(styleCode, v.colour || '', v.size || '');
      const sizeToken = (v.size || '').replace(/[^a-zA-Z0-9]/g, '');
      const sizeSegmentRe = sizeToken
        ? new RegExp(`-${sizeToken}$`, 'i')
        : null;
      const variantSkuWithSize = sizeToken && !sizeSegmentRe!.test(variantSku)
        ? sanitiseSku(`${variantSku}-${sizeToken}`)
        : variantSku;

      const attr1Val = s.attributeOrder === 'size_first' ? (titleCase(v.size || '')) : (titleCase(v.colour || ''));
      const attr2Val = s.attributeOrder === 'size_first' ? (titleCase(v.colour || '')) : (titleCase(v.size || ''));

      // B1 #2 — per-variant cost/retail with safe fallback to product-level.
      const supply = v.supplyPrice ?? product.price ?? 0;
      const retail = v.retailPrice ?? product.rrp ?? 0;

      const row = baseRow();
      row.sku = variantSkuWithSize;
      row.description = buildDescription(product, v.colour || '');
      row.tags = isFirst ? (product.tags || '') : '';
      row.variant_option_one_name = attr1Name;
      row.variant_option_one_value = attr1Val;
      row.variant_option_two_name = attr2Name;
      row.variant_option_two_value = attr2Val;
      row.supply_price = supply.toFixed(2);
      row.retail_price = retail.toFixed(2);
      // B1 #3 — extracted_qty (from the invoice/matrix), NOT received_qty.
      row[stockCol] = String(v.quantity ?? 0);
      allRows.push(row);
    });
  });

  // Validation
  const seenSkus = new Set<string>();
  let totalStock = 0;
  allRows.forEach((r, i) => {
    if (/[^a-z0-9-]/.test(r.handle)) {
      errors.push({ row: i, field: 'handle', message: `Handle contains invalid characters: "${r.handle}"`, severity: 'error' });
    }
    if (r.sku && seenSkus.has(r.sku)) {
      errors.push({ row: i, field: 'sku', message: `Duplicate SKU: "${r.sku}"`, severity: 'error' });
    }
    if (r.sku && /[^a-zA-Z0-9-]/.test(r.sku)) {
      errors.push({ row: i, field: 'sku', message: `SKU contains invalid characters: "${r.sku}"`, severity: 'error' });
    }
    if (r.sku) seenSkus.add(r.sku);

    // B1 #2 — runtime margin assertion: warn if supply >= retail (zero/negative margin).
    const supply = parseFloat(r.supply_price) || 0;
    const retail = parseFloat(r.retail_price) || 0;
    if (supply > 0 && retail > 0 && supply >= retail) {
      errors.push({
        row: i,
        field: 'supply_price',
        message: `Suspicious margin on "${r.name}" (${r.variant_option_two_value || r.variant_option_one_value}): supply $${supply.toFixed(2)} >= retail $${retail.toFixed(2)}. Cost may have been overwritten with RRP.`,
        severity: 'warning',
      });
    }

    totalStock += parseInt(r[stockCol] || '0', 10) || 0;
  });

  // Column order matches the official Lightspeed product-export header exactly
  const columns = [
    'id', 'handle', 'sku',
    'composite_name', 'composite_sku', 'composite_quantity',
    'name', 'description', 'product_category',
    'variant_option_one_name', 'variant_option_one_value',
    'variant_option_two_name', 'variant_option_two_value',
    'variant_option_three_name', 'variant_option_three_value',
    'tags', 'supply_price', 'retail_price',
    'loyalty_value', 'loyalty_value_default',
    'tax_name', 'tax_value',
    'account_code', 'account_code_purchase',
    'brand_name', 'supplier_name', 'supplier_code',
    'active', 'track_inventory',
    stockCol, reorderPointCol, restockLevelCol,
  ];

  const csv = Papa.unparse(allRows, { columns });
  return { csv, errors, rowCount: allRows.length };
}

/**
 * Sum of Main_Outlet_stock across the produced CSV — used by the Review screen
 * to compare against the invoice's total unit count and surface a mismatch banner.
 */
export function totalStockForProducts(products: XSeriesProduct[]): number {
  return products.reduce((sum, p) => {
    if (!p.variants || p.variants.length === 0) return sum;
    return sum + p.variants.reduce((s, v) => s + (v.quantity ?? 0), 0);
  }, 0);
}
