// Lightspeed X-Series CSV export utilities
import Papa from 'papaparse';

// ── Types ──────────────────────────────────────────────────
export interface XSeriesProduct {
  title: string;
  brand: string;
  type: string;
  price: number;       // supply/cost price
  rrp: number;         // retail price
  description?: string;
  tags?: string;
  supplierCode?: string;
  variants?: { size?: string; colour?: string; sku?: string; quantity?: number }[];
}

export interface XSeriesSettings {
  outletName: string;
  taxName: string;
  useReorderPoints: boolean;
  reorderPoint: number;
  reorderAmount: number;
  nameFormat: 'brand_first' | 'product_only';
  attributeOrder: 'size_first' | 'colour_first' | 'auto';
}

export interface XSeriesValidationError {
  row: number;
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

const DEFAULT_SETTINGS: XSeriesSettings = {
  outletName: 'STORE_NAME_1',
  taxName: 'GST',
  useReorderPoints: false,
  reorderPoint: 2,
  reorderAmount: 6,
  nameFormat: 'brand_first',
  attributeOrder: 'size_first',
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
interface CsvRow {
  handle: string;
  name: string;
  sku: string;
  supplier_code: string;
  description: string;
  brand: string;
  supply_price: string;
  retail_price: string;
  tax: string;
  active: string;
  tags: string;
  variant_option_1_name: string;
  variant_option_1_value: string;
  variant_option_2_name: string;
  variant_option_2_value: string;
  variant_option_3_name: string;
  variant_option_3_value: string;
  [key: string]: string;
}

export function generateXSeriesCSV(
  products: XSeriesProduct[],
  settings?: Partial<XSeriesSettings>,
): { csv: string; errors: XSeriesValidationError[]; rowCount: number } {
  const s = { ...getXSeriesSettings(), ...settings };
  const outletKey = s.outletName.replace(/\s+/g, '_');
  const stockCol = `${outletKey}_stock`;
  const reorderPointCol = `${outletKey}_reorder_point`;
  const reorderAmountCol = `${outletKey}_reorder_amount`;

  const allRows: CsvRow[] = [];
  const errors: XSeriesValidationError[] = [];
  const handleMap: Record<string, string> = {}; // title→handle for grouping

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

    if (!hasVariants) {
      // Standard (non-variant) product — single row
      const row: CsvRow = {
        handle,
        name: displayName,
        sku: baseCode.replace(/[^a-zA-Z0-9]/g, ''),
        supplier_code: product.supplierCode || '',
        description: (product.description || '').slice(0, 255).replace(/[\r\n]+/g, ' '),
        brand: product.brand,
        supply_price: product.price.toFixed(2),
        retail_price: product.rrp.toFixed(2),
        tax: s.taxName,
        active: '1',
        tags: product.tags || '',
        variant_option_1_name: '',
        variant_option_1_value: '',
        variant_option_2_name: '',
        variant_option_2_value: '',
        variant_option_3_name: '',
        variant_option_3_value: '',
        [stockCol]: '1',
        [reorderPointCol]: s.useReorderPoints ? String(s.reorderPoint) : '',
        [reorderAmountCol]: s.useReorderPoints ? String(s.reorderAmount) : '',
      };
      allRows.push(row);
      return;
    }

    // Sort variants: colour then size (or vice versa)
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

      const row: CsvRow = {
        handle,
        name: displayName,
        sku,
        supplier_code: product.supplierCode || '',
        description: '', // blank for variants
        brand: product.brand,
        supply_price: product.price.toFixed(2),
        retail_price: product.rrp.toFixed(2),
        tax: s.taxName,
        active: '1',
        tags: isFirst ? (product.tags || '') : '',
        variant_option_1_name: isFirst ? attr1Name : '',
        variant_option_1_value: attr1Val,
        variant_option_2_name: isFirst ? attr2Name : '',
        variant_option_2_value: attr2Val,
        variant_option_3_name: '',
        variant_option_3_value: '',
        [stockCol]: String(v.quantity || 1),
        [reorderPointCol]: s.useReorderPoints ? String(s.reorderPoint) : '',
        [reorderAmountCol]: s.useReorderPoints ? String(s.reorderAmount) : '',
      };
      allRows.push(row);
    });
  });

  // Validation
  const seenHandles = new Set<string>();
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

  if (s.outletName === 'STORE_NAME_1') {
    errors.push({ row: -1, field: 'outlet', message: 'Set your outlet name in Lightspeed settings before importing', severity: 'warning' });
  }

  const columns = [
    'handle', 'name', 'sku', 'supplier_code', 'description', 'brand',
    'supply_price', 'retail_price', 'tax', 'active', 'tags',
    'variant_option_1_name', 'variant_option_1_value', 'variant_option_2_name', 'variant_option_2_value',
    'variant_option_3_name', 'variant_option_3_value',
    stockCol,
    ...(s.useReorderPoints ? [reorderPointCol, reorderAmountCol] : []),
  ];

  const csv = Papa.unparse(allRows, { columns });
  return { csv, errors, rowCount: allRows.length };
}
