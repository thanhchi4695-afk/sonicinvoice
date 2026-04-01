// Lightspeed R-Series CSV export utilities
import Papa from 'papaparse';

export interface RSeriesProduct {
  name: string;
  brand: string;
  sku?: string;
  upc?: string;
  ean?: string;
  vendor: string;
  vendorId?: string;
  vendorCost?: number;
  price: number;
  description?: string;
  tags?: string;
  quantity?: number;
  // Matrix/variant fields
  isMatrix?: boolean;
  matrixDescription?: string;
  matrixAttribute1?: string;
  matrixAttribute1Value?: string;
  matrixAttribute2?: string;
  matrixAttribute2Value?: string;
}

export interface RSeriesValidationError {
  row: number;
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

// ── Validation ─────────────────────────────────────────────
export function validateRSeriesProduct(p: RSeriesProduct, index: number): RSeriesValidationError[] {
  const errors: RSeriesValidationError[] = [];

  // UPC must be exactly 12 digits
  if (p.upc && !/^\d{12}$/.test(p.upc)) {
    errors.push({ row: index, field: 'UPC', message: `UPC must be exactly 12 digits (got "${p.upc}")`, severity: 'error' });
  }

  // EAN must be exactly 13 digits
  if (p.ean && !/^\d{13}$/.test(p.ean)) {
    errors.push({ row: index, field: 'EAN', message: `EAN must be exactly 13 digits (got "${p.ean}")`, severity: 'error' });
  }

  // Scientific notation check for barcodes
  if (p.upc && /e\+/i.test(p.upc)) {
    errors.push({ row: index, field: 'UPC', message: 'UPC contains scientific notation — expand the number', severity: 'error' });
  }
  if (p.ean && /e\+/i.test(p.ean)) {
    errors.push({ row: index, field: 'EAN', message: 'EAN contains scientific notation — expand the number', severity: 'error' });
  }

  // Vendor required when Vendor Cost is provided
  if (p.vendorCost != null && p.vendorCost > 0 && !p.vendor) {
    errors.push({ row: index, field: 'Vendor', message: 'Vendor is required when Vendor Cost is provided', severity: 'error' });
  }

  // Matrix: description should be blank
  if (p.isMatrix && p.description) {
    errors.push({ row: index, field: 'Description', message: 'Description must be blank for matrix (variant) products — use Matrix Description instead', severity: 'warning' });
  }

  // Standard: matrix description should be blank
  if (!p.isMatrix && p.matrixDescription) {
    errors.push({ row: index, field: 'Matrix Description', message: 'Matrix Description should be blank for standard (non-variant) products', severity: 'warning' });
  }

  return errors;
}

export function validateRSeriesBatch(products: RSeriesProduct[]): RSeriesValidationError[] {
  return products.flatMap((p, i) => validateRSeriesProduct(p, i));
}

// ── CSV Generation ─────────────────────────────────────────
export function generateRSeriesCSV(products: RSeriesProduct[]): string {
  const rows = products.map(p => ({
    'System ID': '', // Always blank for new products
    'Name': p.name,
    'Description': p.isMatrix ? '' : (p.description || ''),
    'Matrix Description': p.isMatrix ? (p.matrixDescription || '') : '',
    'Matrix Attribute 1': p.matrixAttribute1 || '',
    'Matrix Attribute 1 Value': p.matrixAttribute1Value || '',
    'Matrix Attribute 2': p.matrixAttribute2 || '',
    'Matrix Attribute 2 Value': p.matrixAttribute2Value || '',
    'Custom SKU': p.sku || '',
    'UPC': p.upc || '',
    'EAN': p.ean || '',
    'Vendor': p.vendor || '',
    'Vendor ID': p.vendorId || '',
    'Vendor Cost': p.vendorCost != null ? p.vendorCost.toFixed(2) : '',
    'Price': p.price.toFixed(2),
    'Brand': p.brand || '',
    'Tags': p.tags || '',
    'QOH': p.quantity != null ? String(p.quantity) : '',
  }));

  return Papa.unparse(rows, {
    columns: [
      'System ID', 'Name', 'Description', 'Matrix Description',
      'Matrix Attribute 1', 'Matrix Attribute 1 Value',
      'Matrix Attribute 2', 'Matrix Attribute 2 Value',
      'Custom SKU', 'UPC', 'EAN', 'Vendor', 'Vendor ID',
      'Vendor Cost', 'Price', 'Brand', 'Tags', 'QOH',
    ],
  });
}

// ── Stock Order CSV for R-Series ───────────────────────────
export function generateRSeriesStockOrderCSV(
  items: { sku: string; vendor: string; vendorId?: string; vendorCost: number; quantity: number }[]
): string {
  const rows = items.map(i => ({
    'Custom SKU': i.sku,
    'Vendor': i.vendor,
    'Vendor ID': i.vendorId || '',
    'Vendor Cost': i.vendorCost.toFixed(2),
    'QOH': String(i.quantity),
  }));
  return Papa.unparse(rows, { columns: ['Custom SKU', 'Vendor', 'Vendor ID', 'Vendor Cost', 'QOH'] });
}
