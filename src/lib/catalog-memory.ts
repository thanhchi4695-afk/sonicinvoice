// Catalog Memory — localStorage-based supplier catalog storage

export interface CatalogProduct {
  title: string;
  sku: string;
  barcode: string;
  colour: string;
  size: string;
  type: string;
  rrp: number;
  /** Marketing description extracted from supplier catalog/PDF (optional). */
  description?: string;
  /** Fabric / composition (optional). */
  fabric?: string;
  /** Care instructions (optional). */
  care?: string;
}

export interface SupplierCatalog {
  supplier: string;
  products: CatalogProduct[];
  uploadedAt: string;
  fileName: string;
}

const CATALOG_KEY = "catalog_memory";

export function getCatalogs(): SupplierCatalog[] {
  try { return JSON.parse(localStorage.getItem(CATALOG_KEY) || "[]"); } catch { return []; }
}

export function saveCatalogs(catalogs: SupplierCatalog[]) {
  localStorage.setItem(CATALOG_KEY, JSON.stringify(catalogs));
}

export function addCatalog(catalog: SupplierCatalog) {
  const all = getCatalogs();
  // Replace existing catalog for same supplier
  const idx = all.findIndex(c => c.supplier.toLowerCase() === catalog.supplier.toLowerCase());
  if (idx >= 0) all[idx] = catalog;
  else all.push(catalog);
  saveCatalogs(all);
}

export function deleteCatalog(supplier: string) {
  const all = getCatalogs().filter(c => c.supplier.toLowerCase() !== supplier.toLowerCase());
  saveCatalogs(all);
}

export function getTotalCatalogProducts(): number {
  return getCatalogs().reduce((s, c) => s + c.products.length, 0);
}

export type CatalogMatchResult = {
  matched: true;
  product: CatalogProduct;
  supplier: string;
  matchType: "barcode" | "sku" | "name";
} | {
  matched: false;
};

export function lookupCatalog(query: { barcode?: string; sku?: string; name?: string }): CatalogMatchResult {
  const catalogs = getCatalogs();
  for (const cat of catalogs) {
    // 1. Barcode match
    if (query.barcode) {
      const match = cat.products.find(p => p.barcode && p.barcode === query.barcode);
      if (match) return { matched: true, product: match, supplier: cat.supplier, matchType: "barcode" };
    }
    // 2. SKU match
    if (query.sku) {
      const match = cat.products.find(p => p.sku && p.sku.toLowerCase() === query.sku!.toLowerCase());
      if (match) return { matched: true, product: match, supplier: cat.supplier, matchType: "sku" };
    }
    // 3. Name match (fuzzy — starts with or includes)
    if (query.name) {
      const q = query.name.toLowerCase().trim();
      const match = cat.products.find(p => p.title.toLowerCase().includes(q) || q.includes(p.title.toLowerCase()));
      if (match) return { matched: true, product: match, supplier: cat.supplier, matchType: "name" };
    }
  }
  return { matched: false };
}

export function searchCatalogs(query: string): (CatalogProduct & { supplier: string })[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const results: (CatalogProduct & { supplier: string })[] = [];
  for (const cat of getCatalogs()) {
    for (const p of cat.products) {
      if (
        p.title.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.includes(q) ||
        p.type.toLowerCase().includes(q)
      ) {
        results.push({ ...p, supplier: cat.supplier });
      }
    }
  }
  return results.slice(0, 50);
}

// Seed demo catalogs
(function seedCatalogs() {
  const existing = getCatalogs();
  if (existing.length > 0) return;
  const demos: SupplierCatalog[] = [
    {
      supplier: "Jantzen",
      fileName: "jantzen_ss26_catalog.xlsx",
      uploadedAt: "2026-03-15T10:00:00Z",
      products: [
        { title: "Retro Racerback", sku: "JA81520", barcode: "9351234567890", colour: "Coral", size: "8-16", type: "One Piece", rrp: 159.95 },
        { title: "Classic High Waist Bikini Bottom", sku: "JA81530", barcode: "9351234567891", colour: "Navy", size: "8-16", type: "Bikini Bottoms", rrp: 79.95 },
        { title: "Vintage Halter Top", sku: "JA81540", barcode: "9351234567892", colour: "Red", size: "8-14", type: "Bikini Tops", rrp: 89.95 },
        { title: "Swim Dress", sku: "JA81550", barcode: "9351234567893", colour: "Black", size: "10-18", type: "Swim Dresses", rrp: 179.95 },
        { title: "Boyleg One Piece", sku: "JA81560", barcode: "9351234567894", colour: "Floral", size: "8-16", type: "One Piece", rrp: 169.95 },
      ],
    },
    {
      supplier: "Seafolly",
      fileName: "seafolly_range_2026.pdf",
      uploadedAt: "2026-03-10T09:30:00Z",
      products: [
        { title: "Collective Bikini Top", sku: "SF10023", barcode: "9350987654321", colour: "Navy", size: "8-14", type: "Bikini Tops", rrp: 109.95 },
        { title: "Active Hybrid Bralette", sku: "SF10030", barcode: "9350987654322", colour: "Black", size: "8-16", type: "Bikini Tops", rrp: 99.95 },
        { title: "Summer Essentials One Piece", sku: "SF10040", barcode: "9350987654323", colour: "Olive", size: "8-14", type: "One Piece", rrp: 189.95 },
        { title: "Beach Edit Sarong", sku: "SF10050", barcode: "", colour: "Stripe", size: "One Size", type: "Accessories", rrp: 69.95 },
      ],
    },
  ];
  saveCatalogs(demos);
})();
