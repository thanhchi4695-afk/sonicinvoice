// Brand Directory — universal, editable, importable

import Papa from 'papaparse';

export interface BrandDirectoryEntry {
  id: string;
  name: string;
  aliases: string[];
  website: string;
  category: string;
  industry: string;
  country: string;
  tag: string;
  status: 'system' | 'custom' | 'unverified' | 'catalog';
  notes: string;
  addedBy: 'system' | 'user' | 'auto';
  dateAdded: string;
}

const BRAND_DIR_KEY = 'brand_directory_skupilot';

function uid(): string { return Math.random().toString(36).slice(2, 12); }
function toTag(name: string): string { return name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim(); }
function today(): string { return new Date().toISOString().slice(0, 10); }

// ── CRUD ───────────────────────────────────────────────────
export function getBrandDirectory(): BrandDirectoryEntry[] {
  try {
    const saved = localStorage.getItem(BRAND_DIR_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  const defaults = getDefaultBrands();
  saveBrandDirectory(defaults);
  return defaults;
}

export function saveBrandDirectory(brands: BrandDirectoryEntry[]) {
  localStorage.setItem(BRAND_DIR_KEY, JSON.stringify(brands));
}

export function addBrand(brand: Omit<BrandDirectoryEntry, 'id' | 'dateAdded'>): BrandDirectoryEntry {
  const entry: BrandDirectoryEntry = { ...brand, id: uid(), dateAdded: today() };
  const dir = getBrandDirectory();
  dir.push(entry);
  saveBrandDirectory(dir);
  return entry;
}

export function updateBrand(id: string, updates: Partial<BrandDirectoryEntry>) {
  const dir = getBrandDirectory().map(b => b.id === id ? { ...b, ...updates } : b);
  saveBrandDirectory(dir);
}

export function deleteBrand(id: string) {
  saveBrandDirectory(getBrandDirectory().filter(b => b.id !== id));
}

// ── Alias Matching ─────────────────────────────────────────
export interface AliasMatch {
  brand: BrandDirectoryEntry;
  matchedVia: 'name' | 'alias';
  matchedValue: string;
}

export function matchVendor(vendorName: string, directory?: BrandDirectoryEntry[]): AliasMatch | null {
  const dir = directory || getBrandDirectory();
  const lower = vendorName.toLowerCase().trim();

  // Exact name match
  for (const b of dir) {
    if (b.name.toLowerCase() === lower) return { brand: b, matchedVia: 'name', matchedValue: b.name };
  }
  // Exact alias match
  for (const b of dir) {
    for (const alias of b.aliases) {
      if (alias.toLowerCase() === lower) return { brand: b, matchedVia: 'alias', matchedValue: alias };
    }
  }
  // Partial match (vendor contains brand name or vice versa)
  for (const b of dir) {
    if (lower.includes(b.name.toLowerCase()) || b.name.toLowerCase().includes(lower)) {
      return { brand: b, matchedVia: 'name', matchedValue: b.name };
    }
    for (const alias of b.aliases) {
      if (lower.includes(alias.toLowerCase()) || alias.toLowerCase().includes(lower)) {
        return { brand: b, matchedVia: 'alias', matchedValue: alias };
      }
    }
  }
  return null;
}

// ── CSV Import/Export ──────────────────────────────────────
export function exportBrandsCSV(brands: BrandDirectoryEntry[]): string {
  const rows = brands.map(b => ({
    name: b.name,
    aliases: b.aliases.join('; '),
    website: b.website,
    tag: b.tag,
    industry: b.industry,
    country: b.country,
    notes: b.notes,
  }));
  return Papa.unparse(rows);
}

export function getCSVTemplate(): string {
  return 'name,aliases,website,tag,industry,country,notes\nExample Brand,"Alias 1; Alias 2",example.com,example-brand,general,AU,Notes here';
}

export interface ImportResult {
  imported: BrandDirectoryEntry[];
  skipped: string[];
}

export function importBrandsCSV(csvText: string): ImportResult {
  const result = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  const existing = getBrandDirectory();
  const existingNames = new Set(existing.map(b => b.name.toLowerCase()));
  const imported: BrandDirectoryEntry[] = [];
  const skipped: string[] = [];

  for (const row of result.data as Record<string, string>[]) {
    const name = (row.name || '').trim();
    if (!name) continue;
    if (existingNames.has(name.toLowerCase())) { skipped.push(name); continue; }

    imported.push({
      id: uid(),
      name,
      aliases: (row.aliases || '').split(';').map(a => a.trim()).filter(Boolean),
      website: (row.website || '').trim(),
      category: (row.industry || 'general').trim(),
      industry: (row.industry || 'general').trim(),
      country: (row.country || 'AU').trim(),
      tag: (row.tag || '').trim() || toTag(name),
      status: 'custom',
      notes: (row.notes || '').trim(),
      addedBy: 'user',
      dateAdded: today(),
    });
    existingNames.add(name.toLowerCase());
  }

  if (imported.length > 0) saveBrandDirectory([...existing, ...imported]);
  return { imported, skipped };
}

// ── Search & Filter ────────────────────────────────────────
export function searchBrands(
  brands: BrandDirectoryEntry[],
  query: string,
  industryFilter?: string,
  countryFilter?: string,
  statusFilter?: string,
): BrandDirectoryEntry[] {
  let filtered = brands;
  const q = query.toLowerCase().trim();

  if (q) {
    filtered = filtered.filter(b =>
      b.name.toLowerCase().includes(q) ||
      b.website.toLowerCase().includes(q) ||
      b.aliases.some(a => a.toLowerCase().includes(q)) ||
      b.tag.toLowerCase().includes(q)
    );
  }
  if (industryFilter && industryFilter !== 'all') filtered = filtered.filter(b => b.industry === industryFilter);
  if (countryFilter && countryFilter !== 'all') filtered = filtered.filter(b => b.country === countryFilter);
  if (statusFilter && statusFilter !== 'all') filtered = filtered.filter(b => b.status === statusFilter);

  return filtered;
}

export function sortBrandsByIndustry(brands: BrandDirectoryEntry[], storeIndustry: string): BrandDirectoryEntry[] {
  return [...brands].sort((a, b) => {
    const aMatch = a.industry === storeIndustry ? 0 : 1;
    const bMatch = b.industry === storeIndustry ? 0 : 1;
    if (aMatch !== bMatch) return aMatch - bMatch;
    return a.name.localeCompare(b.name);
  });
}

// ── Default Brands ─────────────────────────────────────────
function b(name: string, website: string, industry: string, aliases: string[] = [], country = 'AU'): BrandDirectoryEntry {
  return { id: uid(), name, aliases, website, category: industry, industry, country, tag: toTag(name), status: 'system', notes: '', addedBy: 'system', dateAdded: '2026-01-01' };
}

function getDefaultBrands(): BrandDirectoryEntry[] {
  return [
    // Swimwear
    b('Jantzen', 'jantzen.com.au', 'swimwear', ['Skye Group Pty Ltd', 'Skye Group']),
    b('Seafolly', 'seafolly.com.au', 'swimwear'),
    b('Bond Eye', 'bond-eye.com.au', 'swimwear', ['Bond-Eye Swim']),
    b('Baku', 'baku.com.au', 'swimwear'),
    b('Sunseeker', 'sunseeker.com.au', 'swimwear'),
    b('Sea Level', 'sealevel.com.au', 'swimwear', ['Sea Level Swim']),
    b('Capriosca', 'capriosca.com.au', 'swimwear'),
    b('Artesands', 'artesands.com', 'swimwear'),
    b('Jets', 'jets.com.au', 'swimwear'),
    b('Billabong', 'billabong.com.au', 'swimwear'),
    b('Roxy', 'roxy.com.au', 'swimwear'),
    b('Rip Curl', 'ripcurl.com.au', 'swimwear'),
    // Beauty
    b("L'Oreal", 'loreal.com.au', 'beauty', ["L'Oreal Australia", "L'Oreal Australia Pty Ltd"]),
    b('Maybelline', 'maybelline.com.au', 'beauty'),
    b('NYX', 'nyxcosmetics.com.au', 'beauty', ['NYX Professional Makeup']),
    b('MAC', 'maccosmetics.com.au', 'beauty', ['MAC Cosmetics']),
    b('Charlotte Tilbury', 'charlottetilbury.com', 'beauty', [], 'UK'),
    // Fashion
    b('Country Road', 'countryroad.com.au', 'fashion'),
    b('Assembly Label', 'assemblylabel.com', 'fashion'),
    b('Seed Heritage', 'seedheritage.com', 'fashion'),
    b('Aje', 'ajeworld.com.au', 'fashion'),
    b('Zimmermann', 'zimmermann.com', 'fashion'),
    // Jewellery
    b('Pandora', 'pandora.net', 'jewellery', [], 'EU'),
    b('Swarovski', 'swarovski.com', 'jewellery', [], 'EU'),
    // Electronics
    b('Samsung', 'samsung.com/au', 'electronics', ['Samsung Australia']),
    b('Apple', 'apple.com/au', 'electronics'),
    b('JBL', 'jbl.com.au', 'electronics', ['JBL Professional']),
    b('Logitech', 'logitech.com', 'electronics', [], 'US'),
    b('Anker', 'anker.com', 'electronics', [], 'US'),
    // Health
    b('Blackmores', 'blackmores.com.au', 'health'),
    b('Swisse', 'swisse.com.au', 'health'),
  ];
}
