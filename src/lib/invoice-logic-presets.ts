// ═══════════════════════════════════════════════════════════
// Invoice Logic Library — built-in + user-saved presets
// Each preset is a named bundle of plain-English rules that
// the AI parser injects as HIGHEST PRIORITY into the prompt.
// ═══════════════════════════════════════════════════════════

export interface InvoiceLogicPreset {
  /** Unique key (slug) */
  id: string;
  /** Display name in the picker */
  name: string;
  /** Short tagline shown in the dropdown */
  description: string;
  /** Suppliers / brands this preset is known to work for (used for auto-suggest) */
  matches: string[];
  /** The plain-English instructions sent to the AI */
  instructions: string;
  /** true = ships with the app and cannot be deleted */
  builtin?: boolean;
  /** Suggested POS for export */
  posTarget?: "lightspeed_xseries" | "lightspeed_rseries" | "shopify" | "any";
}

// ── Built-in presets ───────────────────────────────────────
// Add new patterns here as you discover them across customers.
export const BUILTIN_PRESETS: InvoiceLogicPreset[] = [
  {
    id: "function-design-lula-soul",
    name: "Function Design / Lula Soul (handwritten RRP + cost)",
    description:
      "RRP written next to product name • cost written next to Unit Price • 5% discount + 10% GST already applied",
    matches: ["function design", "function design group", "lula soul", "lulasoul"],
    posTarget: "lightspeed_xseries",
    instructions: `INVOICE LAYOUT — Function Design Group / Lula Soul:

1. PRODUCT NAME: each row's "Description" cell contains the product name followed by the merchant's HANDWRITTEN RRP (e.g. "MUSTANG BUTTON MIDI licorice $179.95"). Treat the trailing "$xxx.xx" as the RETAIL PRICE (RRP), NOT part of the name. Strip it from the name field.

2. COST PRICE: ignore the printed "Unit Price" column. Use the HANDWRITTEN number written by hand next to / above the printed Unit Price (e.g. "73.30" printed → "76.59" handwritten = the cost-per-item the merchant wants to use). The handwritten number is already net of 5% supplier discount AND inclusive of 10% GST. Use it AS-IS as supply_price/cost.

3. SIZE MATRIX: the columns "XXS 35 / XS 36 / S 37 / M 38 / L 39 / XL 40 / 2X 41 / 3X 42 / 4X" are size buckets. Any cell with a "1" (or a number) means that quantity of that size was ordered. Create one variant per non-empty size cell.

4. COLOUR: the colour name appears at the END of the product name in lowercase (e.g. "licorice"). Extract it as the colour attribute and Title-Case it ("Licorice").

5. BRAND: the supplier "Function Design Group" is a distributor. The actual product brand is "Lula Soul" — set vendor/brand = "Lula Soul" on every line.

6. PRODUCT NAME CLEANING: convert ALL CAPS names to Title Case (e.g. "MUSTANG BUTTON MIDI" → "Mustang Button Midi"). Prefix the brand: "Lula Soul Mustang Button Midi".

7. IGNORE: rows for "Freight", "SubTotal", "GST", "Amount", "Balance Owing" — these are totals, not products.`,
    builtin: true,
  },
  {
    id: "rrp-in-name-handwritten-cost",
    name: "Generic: RRP in name + handwritten cost-per-item",
    description: "Use when RRP appears beside the product name and the real cost is written by hand on the invoice",
    matches: [],
    posTarget: "any",
    instructions: `INVOICE LAYOUT — Handwritten cost / RRP-in-name pattern:

1. The product name cell contains the product name followed by a "$xxx.xx" RRP — strip it from the name and use it as the retail price.
2. Ignore any printed Unit Price. Use the HANDWRITTEN number next to it as the cost-per-item.
3. Treat the handwritten cost as final (already includes any discount and GST adjustments the merchant wants).
4. If a size matrix is present (size labels as columns, quantities as cells), create one variant per non-empty cell.
5. Strip total rows like SubTotal, GST, Freight, Amount, Balance Owing.`,
    builtin: true,
  },
  {
    id: "size-matrix-grid",
    name: "Size matrix grid (sizes as columns)",
    description: "Sizes appear as column headers (XS, S, M, L…) with quantities in the cells",
    matches: [],
    posTarget: "any",
    instructions: `INVOICE LAYOUT — Size matrix:

1. The columns labelled XS, S, M, L, XL (or 6, 8, 10, 12, etc.) are size buckets, NOT separate products.
2. For each row, create one variant per non-empty size cell. The cell value is the quantity for that size.
3. The product name, SKU, cost and RRP apply to all variants of the same row.`,
    builtin: true,
  },
];

// ── User-saved presets (localStorage) ─────────────────────
const USER_PRESETS_KEY = "invoice_logic_user_presets";

export function getUserPresets(): InvoiceLogicPreset[] {
  try {
    return JSON.parse(localStorage.getItem(USER_PRESETS_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveUserPreset(preset: InvoiceLogicPreset) {
  const all = getUserPresets().filter(p => p.id !== preset.id);
  all.unshift({ ...preset, builtin: false });
  localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(all.slice(0, 50)));
}

export function deleteUserPreset(id: string) {
  const all = getUserPresets().filter(p => p.id !== id);
  localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(all));
}

export function getAllPresets(): InvoiceLogicPreset[] {
  return [...getUserPresets(), ...BUILTIN_PRESETS];
}

/** Find the best preset for a supplier/brand name (exact-ish match on `matches`) */
export function suggestPresetForSupplier(supplierName: string): InvoiceLogicPreset | null {
  const q = supplierName.trim().toLowerCase();
  if (!q) return null;
  for (const p of getAllPresets()) {
    if (p.matches.some(m => q.includes(m) || m.includes(q))) return p;
  }
  return null;
}
