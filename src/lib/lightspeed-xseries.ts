// Lightspeed X-Series CSV export utilities
// Schema matches the official Lightspeed product-export CSV
// (see user-uploads://product-export-12.csv for the canonical header).
import Papa from 'papaparse';

// ── Types ──────────────────────────────────────────────────
export interface XSeriesProduct {
  title: string;
  brand: string;
  type: string;          // → product_category
  price: number;         // supply/cost price
  rrp: number;           // retail price
  description?: string;
  tags?: string;
  supplierCode?: string;
  supplierName?: string;
  variants?: { size?: string; colour?: string; sku?: string; quantity?: number }[];
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
  nameFormat: 'brand_first',
  attributeOrder: 'colour_first', // matches real export (Colour, Size)
  trackInventory: true,
};

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

// ── Handle generation ──────────────────────────────────────
export function generateHandle(title: string, brand: string): string {
  return `${title} ${brand}`
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
function generateVariantSku(baseCode: string, colour: string, size: string): string {
  const c = colour.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 3);
  const s = size.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return `${baseCode}${c}${s}`.replace(/[^a-zA-Z0-9]/g, '');
}

// ── Size sort ──────────────────────────────────────────────
const SIZE_ORDER = ['6', '8', '10', '12', '14', '16', '18', '20', '22', '24', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
function sizeRank(s: string): number {
  const idx = SIZE_ORDER.indexOf(s.toUpperCase());
  return idx >= 0 ? idx : 999;
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

  // Generate unique handles per product
  const rawHandles = products.map(p => generateHandle(p.title, p.brand));
  const uniqueHandles = ensureUniqueHandles(rawHandles);

  products.forEach((product, pi) => {
    const handle = uniqueHandles[pi];
    const displayName = s.nameFormat === 'brand_first'
      ? `${product.brand} ${product.title}`
      : product.title;
    const baseCode = product.supplierCode || product.brand.replace(/\s/g, '').toUpperCase().slice(0, 3) + String(pi + 1).padStart(3, '0');
    const hasVariants = product.variants && product.variants.length > 0;

    const baseRow = (): CsvRow => ({
      id: '', // blank → Lightspeed creates new
      handle,
      sku: '',
      composite_name: '',
      composite_sku: '',
      composite_quantity: '',
      name: displayName,
      description: '',
      product_category: product.type || '',
      variant_option_one_name: '',
      variant_option_one_value: '',
      variant_option_two_name: '',
      variant_option_two_value: '',
      variant_option_three_name: '',
      variant_option_three_value: '',
      tags: '',
      supply_price: product.price.toFixed(2),
      retail_price: product.rrp.toFixed(2),
      loyalty_value: '',
      loyalty_value_default: '',
      tax_name: s.taxName,
      tax_value: '',
      account_code: '',
      account_code_purchase: '',
      brand_name: product.brand,
      supplier_name: product.supplierName || '',
      supplier_code: product.supplierCode || '',
      active: '1',
      track_inventory: s.trackInventory ? '1' : '0',
      [stockCol]: '0',
      [reorderPointCol]: s.useReorderPoints ? String(s.reorderPoint) : '',
      [restockLevelCol]: s.useReorderPoints ? String(s.reorderAmount) : '',
    });

    if (!hasVariants) {
      const row = baseRow();
      row.sku = baseCode.replace(/[^a-zA-Z0-9]/g, '');
      row.description = (product.description || '').replace(/[\r\n]+/g, ' ');
      row.tags = product.tags || '';
      row[stockCol] = '1';
      allRows.push(row);
      return;
    }

    // Sort variants
    const sorted = [...product.variants!].sort((a, b) => {
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
      const sku = v.sku
        ? v.sku.replace(/[^a-zA-Z0-9]/g, '')
        : generateVariantSku(baseCode, v.colour || '', v.size || '');

      const attr1Val = s.attributeOrder === 'size_first' ? (v.size || '') : (v.colour || '');
      const attr2Val = s.attributeOrder === 'size_first' ? (v.colour || '') : (v.size || '');

      const row = baseRow();
      row.sku = sku;
      // Description on every variant row matches Lightspeed's own export style
      row.description = (product.description || '').replace(/[\r\n]+/g, ' ');
      row.tags = isFirst ? (product.tags || '') : '';
      // Lightspeed export repeats option NAME on every row, not just the first
      row.variant_option_one_name = attr1Name;
      row.variant_option_one_value = attr1Val;
      row.variant_option_two_name = attr2Name;
      row.variant_option_two_value = attr2Val;
      row[stockCol] = String(v.quantity || 1);
      allRows.push(row);
    });
  });

  // Validation
  const seenSkus = new Set<string>();
  allRows.forEach((r, i) => {
    if (/[^a-z0-9-]/.test(r.handle)) {
      errors.push({ row: i, field: 'handle', message: `Handle contains invalid characters: "${r.handle}"`, severity: 'error' });
    }
    if (r.sku && seenSkus.has(r.sku)) {
      errors.push({ row: i, field: 'sku', message: `Duplicate SKU: "${r.sku}"`, severity: 'error' });
    }
    if (r.sku && /[^a-zA-Z0-9]/.test(r.sku)) {
      errors.push({ row: i, field: 'sku', message: `SKU contains invalid characters: "${r.sku}"`, severity: 'error' });
    }
    if (r.sku) seenSkus.add(r.sku);
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
