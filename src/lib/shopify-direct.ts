// Direct Shopify store connections via Custom App tokens
// Stored in localStorage — never sent to any server except Shopify itself (via edge proxy)

export interface DirectStore {
  id: string;
  storeUrl: string;
  token: string;
  storeName: string;
  productCount: number;
  connectedAt: string;
  isActive: boolean;
}

const LS_KEY = "shopify_stores";

export function getDirectStores(): DirectStore[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
  } catch {
    return [];
  }
}

export function getActiveDirectStore(): DirectStore | null {
  return getDirectStores().find(s => s.isActive) || null;
}

export function saveDirectStore(store: Omit<DirectStore, "id" | "connectedAt">): DirectStore {
  const stores = getDirectStores();
  // Deactivate others if this one is active
  if (store.isActive) {
    stores.forEach(s => (s.isActive = false));
  }
  const existing = stores.findIndex(s => s.storeUrl === store.storeUrl);
  const entry: DirectStore = {
    ...store,
    id: existing >= 0 ? stores[existing].id : crypto.randomUUID(),
    connectedAt: new Date().toISOString(),
  };
  if (existing >= 0) {
    stores[existing] = entry;
  } else {
    stores.push(entry);
  }
  localStorage.setItem(LS_KEY, JSON.stringify(stores));
  return entry;
}

export function setActiveStore(id: string): void {
  const stores = getDirectStores();
  stores.forEach(s => (s.isActive = s.id === id));
  localStorage.setItem(LS_KEY, JSON.stringify(stores));
}

export function removeDirectStore(id: string): void {
  const stores = getDirectStores().filter(s => s.id !== id);
  localStorage.setItem(LS_KEY, JSON.stringify(stores));
}

export function normalizeStoreUrl(url: string): string {
  let clean = url.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!clean.includes(".myshopify.com")) {
    clean = `${clean}.myshopify.com`;
  }
  return clean;
}
