import Papa from '/dev-server/node_modules/papaparse/papaparse.js';
import { generateXSeriesCSV, type XSeriesProduct } from '/dev-server/src/lib/lightspeed-xseries.ts';

const slug = (value: string) => value
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '');

const products: XSeriesProduct[] = [
  {
    title: 'Reid Leather Sandal',
    brand: 'Walnut Melbourne',
    type: 'Footwear',
    price: 68.16,
    rrp: 199.95,
    supplierCode: 'Reid-HS24-CoconutTan',
    supplierName: 'Walnut Melbourne',
    season: 'HS24',
    arrivalDate: '2026-04-24',
    tags: 'Walnut Melbourne; Footwear; Coconut Tan; Apr26; HS24',
    description: 'Reid Leather Sandal in Coconut Tan. Walnut Melbourne HS24 collection.',
    variants: [
      ['36', 1], ['37', 1], ['38', 2], ['39', 2], ['40', 2], ['41', 2], ['42', 1],
    ].map(([size, quantity]) => ({
      size,
      colour: 'Coconut Tan',
      quantity,
      supplyPrice: 68.16,
      retailPrice: 199.95,
    })),
  },
  {
    title: 'Mon Cheri Skirt',
    brand: 'Walnut Melbourne',
    type: 'Kids Clothing',
    price: 22.70,
    rrp: 59.95,
    supplierCode: 'MonCheriSkirt-W26-LaFraise',
    supplierName: 'Walnut Melbourne',
    season: 'W26',
    arrivalDate: '2026-04-24',
    tags: 'Walnut Melbourne; Kids Clothing; La Fraise; Apr26; W26',
    description: 'Mon Cheri Skirt in La Fraise. Walnut Melbourne W26 collection.',
    variants: [
      '1 Year', '2 Year', '3 Year', '4 Year', '5 Year', '6 Year',
    ].map((size) => ({
      size,
      colour: 'La Fraise',
      quantity: 1,
      supplyPrice: 22.70,
      retailPrice: 59.95,
    })),
  },
];

const { csv, errors, rowCount } = generateXSeriesCSV(products, {
  outletName: 'Main Outlet',
  taxName: 'Default Tax',
  useReorderPoints: false,
  reorderPoint: 2,
  reorderAmount: 6,
  nameFormat: 'product_only',
  attributeOrder: 'colour_first',
  trackInventory: true,
});

if (errors.some((e) => e.severity === 'error')) {
  console.error(JSON.stringify(errors, null, 2));
  process.exit(1);
}

const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
const fields = parsed.meta.fields || [];
const rows = parsed.data.map((row) => {
  const supplierCode = row.supplier_code || row.sku || row.name || '';
  return {
    ...row,
    handle: slug(`${row.brand_name || ''}-${row.name || ''}-${supplierCode}`),
  };
});

const finalCsv = Papa.unparse(rows, { columns: fields });
await Bun.write('/tmp/r2-documents-mount/walnut-melbourne_219242_219244_lightspeed_v3.csv', finalCsv);
console.log(JSON.stringify({ rowCount, rows: rows.length, warnings: errors.filter((e) => e.severity === 'warning') }, null, 2));
