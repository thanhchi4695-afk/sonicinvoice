// Load TS sources via tsx
import { generateShopifyCSV, generateLightspeedCSV } from "/dev-server/src/lib/csv-export-engine.ts";
import Papa from "papaparse";
import fs from "node:fs";

// Sample invoice extraction matching Jantzen-style data + Om Designs-style data
const lines = [
  // Size-run row that should expand 8→16 (5 sizes), 20 qty → 4 each
  { name: "Retro Racerback", brand: "Jantzen", type: "One Piece",
    colour: "Coral", size: "8-16", sku: "JA81520", barcode: "9351234567890",
    price: 159.95, rrp: 159.95, cogs: 79.97, qty: 20, status: "active" },
  // Alpha range S-L
  { name: "Boho Kaftan", brand: "Om Designs", type: "Cover Up",
    colour: "Ivory", size: "S-L", sku: "OM-KAF-001", barcode: "",
    price: 189.00, rrp: 189.00, cogs: 85.00, qty: 6, status: "active" },
  // Single size, no expansion
  { name: "Wide Brim Hat", brand: "Om Designs", type: "Accessory",
    colour: "Tan", size: "One Size", sku: "OM-HAT-002", barcode: "9351111111118",
    price: 79.00, rrp: 79.00, cogs: 32.00, qty: 8, status: "active" },
];

const shop = generateShopifyCSV(lines, "variant", []);
const ls = generateLightspeedCSV(lines);

fs.writeFileSync("/mnt/documents/sonic-roundtrip-shopify.csv", shop.csv);
fs.writeFileSync("/mnt/documents/sonic-roundtrip-lightspeed.csv", ls.csv);

const shopRows = Papa.parse(shop.csv, { header: true, skipEmptyLines: true }).data;
const lsRows = Papa.parse(ls.csv, { header: true, skipEmptyLines: true }).data;

console.log("=== SHOPIFY ===");
console.log("Rows:", shopRows.length, "Columns:", Object.keys(shopRows[0] || {}).length);
console.log("Validation errors:", shop.validation.errorCount, "warnings:", shop.validation.warningCount);
console.log("\nFirst row sample:");
const r0 = shopRows[0];
["Handle","Title","Vendor","Type","Tags","Option1 Name","Option1 Value","Option2 Name","Option2 Value","Variant SKU","Variant Barcode","Variant Price","Variant Inventory Qty","Variant Inventory Tracker","Cost per item"].forEach(k => console.log(`  ${k}: ${JSON.stringify(r0[k])}`));

console.log("\nAll variant rows (handle / opt1 / opt2 / sku / qty / cost):");
shopRows.forEach(r => console.log(`  ${r.Handle} | ${r["Option1 Value"]} | ${r["Option2 Value"]} | ${r["Variant SKU"]} | qty=${r["Variant Inventory Qty"]} | cost=${r["Cost per item"]}`));

console.log("\n=== LIGHTSPEED ===");
console.log("Rows:", lsRows.length, "Columns:", Object.keys(lsRows[0] || {}).length);
console.log("\nFirst row sample:");
const l0 = lsRows[0];
Object.entries(l0).forEach(([k,v]) => console.log(`  ${k}: ${JSON.stringify(v)}`));

console.log("\nAll LS rows (sku / variant1 / variant2 / qty / supply / brand):");
lsRows.forEach(r => console.log(`  ${r.sku} | ${r.variant_option_one_value} | ${r.variant_option_two_value} | inv=${r.inventory_Main_Outlet} | supply=${r.supply_price} | brand=${r.brand_name}`));

// Compliance check vs reference templates
console.log("\n=== COMPLIANCE CHECK ===");
const refShop = Papa.parse(fs.readFileSync("/mnt/documents/om-designs-order-306-shopify.csv","utf8"), { header: true }).data[0];
const refLs = Papa.parse(fs.readFileSync("/mnt/documents/lula-soul-function-design-58270-lightspeed-xseries.csv","utf8"), { header: true }).data[0];

if (refShop) {
  const refCols = new Set(Object.keys(refShop));
  const ourCols = new Set(Object.keys(shopRows[0]));
  const missing = [...refCols].filter(c => !ourCols.has(c));
  const extra = [...ourCols].filter(c => !refCols.has(c));
  console.log(`Shopify ref has ${refCols.size} cols, we emit ${ourCols.size}`);
  console.log(`  Critical missing on our side:`, missing.filter(c => /Variant|Option|Title|Handle|Vendor|Type|Tags|SKU|Barcode|Price|Qty|Cost/i.test(c)).slice(0, 15));
}
if (refLs) {
  const refCols = new Set(Object.keys(refLs));
  const ourCols = new Set(Object.keys(lsRows[0]));
  const missing = [...refCols].filter(c => !ourCols.has(c));
  console.log(`Lightspeed ref has ${refCols.size} cols, we emit ${ourCols.size}`);
  console.log(`  Missing:`, missing);
}
