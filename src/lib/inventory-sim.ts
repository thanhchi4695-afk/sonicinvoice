// Simulated inventory storage for stock tracking

export interface InventoryItem {
  qty: number;
  location: string;
  lastUpdated?: string;
}

export type InventoryMap = Record<string, InventoryItem>;

const INV_KEY = "inventory_sim";
const UPDATES_KEY = "stock_updates_count";

export function getInventory(): InventoryMap {
  try { return JSON.parse(localStorage.getItem(INV_KEY) || "{}"); } catch { return {}; }
}

export function saveInventory(inv: InventoryMap) {
  localStorage.setItem(INV_KEY, JSON.stringify(inv));
}

export function getStockUpdatesCount(): number {
  return parseInt(localStorage.getItem(UPDATES_KEY) || "0", 10);
}

export function incrementStockUpdates(count: number) {
  const current = getStockUpdatesCount();
  localStorage.setItem(UPDATES_KEY, String(current + count));
}

export function lookupInventory(sku: string): InventoryItem | null {
  const inv = getInventory();
  return inv[sku] || null;
}

export function updateStock(sku: string, addQty: number, location: string): InventoryItem {
  const inv = getInventory();
  const existing = inv[sku] || { qty: 0, location };
  existing.qty += addQty;
  existing.location = location;
  existing.lastUpdated = new Date().toISOString();
  inv[sku] = existing;
  saveInventory(inv);
  return existing;
}

// Seed demo inventory on first load
(function seedInventory() {
  const inv = getInventory();
  if (Object.keys(inv).length > 0) return;
  const seed: InventoryMap = {
    "JA81520-COR-8": { qty: 3, location: "Main store" },
    "JA81520-COR-10": { qty: 5, location: "Main store" },
    "JA81520-COR-12": { qty: 2, location: "Main store" },
    "SF10023": { qty: 7, location: "Main store" },
    "BK20015": { qty: 4, location: "Main store" },
    "BE2204-BLK-8": { qty: 1, location: "Main store" },
    "BE2204-BLK-10": { qty: 2, location: "Main store" },
    "BE2204-NAV-10": { qty: 0, location: "Main store" },
  };
  saveInventory(seed);
})();
