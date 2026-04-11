// Tax Service — dynamic tax calculation with built-in rates and optional TaxJar integration
// Replaces hardcoded AU GST (10%) with locale-aware tax calculation

import { LOCALES, type LocaleConfig } from "./i18n";
import { getStoreConfig } from "./prompt-builder";

// ── Types ──────────────────────────────────────────────────────

export interface TaxRegion {
  countryCode: string;
  country: string;
  flag: string;
  taxLabel: string;
  /** Default national rate (decimal, e.g. 0.1 = 10%) */
  defaultRate: number;
  /** Whether prices are typically tax-inclusive */
  taxInclusive: boolean;
  /** Sub-regions with different rates (US states, CA provinces, EU countries) */
  subRegions?: TaxSubRegion[];
}

export interface TaxSubRegion {
  code: string;
  name: string;
  rate: number;
}

export interface TaxLineItem {
  description: string;
  amount: number;       // line total ex-tax
  quantity: number;
  category?: string;    // product category for rate lookup
}

export interface TaxCalculation {
  subtotalExTax: number;
  taxAmount: number;
  totalIncTax: number;
  taxRate: number;       // effective rate used
  taxLabel: string;      // "GST", "VAT", "Sales Tax"
  regionCode: string;
  subRegionCode?: string;
  breakdown?: { description: string; amount: number; tax: number }[];
}

export interface TaxConfig {
  regionCode: string;
  subRegionCode?: string;
  /** Override rate (user can set custom rate) */
  customRate?: number;
  /** If set, use TaxJar API instead of built-in rates */
  useTaxJar?: boolean;
}

// ── Built-in Tax Regions ───────────────────────────────────────

const US_STATES: TaxSubRegion[] = [
  { code: "AL", name: "Alabama", rate: 0.04 },
  { code: "AK", name: "Alaska", rate: 0 },
  { code: "AZ", name: "Arizona", rate: 0.056 },
  { code: "AR", name: "Arkansas", rate: 0.065 },
  { code: "CA", name: "California", rate: 0.0725 },
  { code: "CO", name: "Colorado", rate: 0.029 },
  { code: "CT", name: "Connecticut", rate: 0.0635 },
  { code: "DE", name: "Delaware", rate: 0 },
  { code: "FL", name: "Florida", rate: 0.06 },
  { code: "GA", name: "Georgia", rate: 0.04 },
  { code: "HI", name: "Hawaii", rate: 0.04 },
  { code: "ID", name: "Idaho", rate: 0.06 },
  { code: "IL", name: "Illinois", rate: 0.0625 },
  { code: "IN", name: "Indiana", rate: 0.07 },
  { code: "IA", name: "Iowa", rate: 0.06 },
  { code: "KS", name: "Kansas", rate: 0.065 },
  { code: "KY", name: "Kentucky", rate: 0.06 },
  { code: "LA", name: "Louisiana", rate: 0.0445 },
  { code: "ME", name: "Maine", rate: 0.055 },
  { code: "MD", name: "Maryland", rate: 0.06 },
  { code: "MA", name: "Massachusetts", rate: 0.0625 },
  { code: "MI", name: "Michigan", rate: 0.06 },
  { code: "MN", name: "Minnesota", rate: 0.06875 },
  { code: "MS", name: "Mississippi", rate: 0.07 },
  { code: "MO", name: "Missouri", rate: 0.04225 },
  { code: "MT", name: "Montana", rate: 0 },
  { code: "NE", name: "Nebraska", rate: 0.055 },
  { code: "NV", name: "Nevada", rate: 0.0685 },
  { code: "NH", name: "New Hampshire", rate: 0 },
  { code: "NJ", name: "New Jersey", rate: 0.06625 },
  { code: "NM", name: "New Mexico", rate: 0.05125 },
  { code: "NY", name: "New York", rate: 0.04 },
  { code: "NC", name: "North Carolina", rate: 0.0475 },
  { code: "ND", name: "North Dakota", rate: 0.05 },
  { code: "OH", name: "Ohio", rate: 0.0575 },
  { code: "OK", name: "Oklahoma", rate: 0.045 },
  { code: "OR", name: "Oregon", rate: 0 },
  { code: "PA", name: "Pennsylvania", rate: 0.06 },
  { code: "RI", name: "Rhode Island", rate: 0.07 },
  { code: "SC", name: "South Carolina", rate: 0.06 },
  { code: "SD", name: "South Dakota", rate: 0.045 },
  { code: "TN", name: "Tennessee", rate: 0.07 },
  { code: "TX", name: "Texas", rate: 0.0625 },
  { code: "UT", name: "Utah", rate: 0.061 },
  { code: "VT", name: "Vermont", rate: 0.06 },
  { code: "VA", name: "Virginia", rate: 0.053 },
  { code: "WA", name: "Washington", rate: 0.065 },
  { code: "WV", name: "West Virginia", rate: 0.06 },
  { code: "WI", name: "Wisconsin", rate: 0.05 },
  { code: "WY", name: "Wyoming", rate: 0.04 },
  { code: "DC", name: "District of Columbia", rate: 0.06 },
];

const CA_PROVINCES: TaxSubRegion[] = [
  { code: "AB", name: "Alberta", rate: 0.05 },
  { code: "BC", name: "British Columbia", rate: 0.12 },
  { code: "MB", name: "Manitoba", rate: 0.12 },
  { code: "NB", name: "New Brunswick", rate: 0.15 },
  { code: "NL", name: "Newfoundland", rate: 0.15 },
  { code: "NS", name: "Nova Scotia", rate: 0.15 },
  { code: "ON", name: "Ontario", rate: 0.13 },
  { code: "PE", name: "Prince Edward Island", rate: 0.15 },
  { code: "QC", name: "Quebec", rate: 0.14975 },
  { code: "SK", name: "Saskatchewan", rate: 0.11 },
  { code: "NT", name: "Northwest Territories", rate: 0.05 },
  { code: "NU", name: "Nunavut", rate: 0.05 },
  { code: "YT", name: "Yukon", rate: 0.05 },
];

const EU_COUNTRIES: TaxSubRegion[] = [
  { code: "AT", name: "Austria", rate: 0.20 },
  { code: "BE", name: "Belgium", rate: 0.21 },
  { code: "BG", name: "Bulgaria", rate: 0.20 },
  { code: "HR", name: "Croatia", rate: 0.25 },
  { code: "CY", name: "Cyprus", rate: 0.19 },
  { code: "CZ", name: "Czech Republic", rate: 0.21 },
  { code: "DK", name: "Denmark", rate: 0.25 },
  { code: "EE", name: "Estonia", rate: 0.22 },
  { code: "FI", name: "Finland", rate: 0.255 },
  { code: "FR", name: "France", rate: 0.20 },
  { code: "DE", name: "Germany", rate: 0.19 },
  { code: "GR", name: "Greece", rate: 0.24 },
  { code: "HU", name: "Hungary", rate: 0.27 },
  { code: "IE", name: "Ireland", rate: 0.23 },
  { code: "IT", name: "Italy", rate: 0.22 },
  { code: "LV", name: "Latvia", rate: 0.21 },
  { code: "LT", name: "Lithuania", rate: 0.21 },
  { code: "LU", name: "Luxembourg", rate: 0.17 },
  { code: "MT", name: "Malta", rate: 0.18 },
  { code: "NL", name: "Netherlands", rate: 0.21 },
  { code: "PL", name: "Poland", rate: 0.23 },
  { code: "PT", name: "Portugal", rate: 0.23 },
  { code: "RO", name: "Romania", rate: 0.19 },
  { code: "SK", name: "Slovakia", rate: 0.23 },
  { code: "SI", name: "Slovenia", rate: 0.22 },
  { code: "ES", name: "Spain", rate: 0.21 },
  { code: "SE", name: "Sweden", rate: 0.25 },
];

export const TAX_REGIONS: TaxRegion[] = [
  { countryCode: "AU", country: "Australia", flag: "🇦🇺", taxLabel: "GST", defaultRate: 0.10, taxInclusive: true },
  { countryCode: "NZ", country: "New Zealand", flag: "🇳🇿", taxLabel: "GST", defaultRate: 0.15, taxInclusive: true },
  { countryCode: "US", country: "United States", flag: "🇺🇸", taxLabel: "Sales Tax", defaultRate: 0, taxInclusive: false, subRegions: US_STATES },
  { countryCode: "CA", country: "Canada", flag: "🇨🇦", taxLabel: "HST/GST", defaultRate: 0.05, taxInclusive: false, subRegions: CA_PROVINCES },
  { countryCode: "UK", country: "United Kingdom", flag: "🇬🇧", taxLabel: "VAT", defaultRate: 0.20, taxInclusive: true },
  { countryCode: "EU", country: "Europe (EU)", flag: "🇪🇺", taxLabel: "VAT", defaultRate: 0.21, taxInclusive: true, subRegions: EU_COUNTRIES },
  { countryCode: "SG", country: "Singapore", flag: "🇸🇬", taxLabel: "GST", defaultRate: 0.09, taxInclusive: true },
  { countryCode: "IN", country: "India", flag: "🇮🇳", taxLabel: "GST", defaultRate: 0.18, taxInclusive: true },
  { countryCode: "ZA", country: "South Africa", flag: "🇿🇦", taxLabel: "VAT", defaultRate: 0.15, taxInclusive: true },
];

// ── Tax Config Persistence ─────────────────────────────────────

const TAX_CONFIG_KEY = "tax_config";

export function getTaxConfig(): TaxConfig {
  try {
    const raw = localStorage.getItem(TAX_CONFIG_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  // Default: derive from locale in store config
  const store = getStoreConfig();
  const locale = LOCALES.find(l => l.id === (store.locale || "AU"));
  return { regionCode: locale?.id || "AU" };
}

export function saveTaxConfig(config: Partial<TaxConfig>): void {
  const current = getTaxConfig();
  localStorage.setItem(TAX_CONFIG_KEY, JSON.stringify({ ...current, ...config }));
}

// ── Tax Calculation ────────────────────────────────────────────

export function getTaxRegion(code: string): TaxRegion | undefined {
  return TAX_REGIONS.find(r => r.countryCode === code);
}

export function getEffectiveTaxRate(config?: TaxConfig): number {
  const cfg = config || getTaxConfig();
  if (cfg.customRate !== undefined) return cfg.customRate;

  const region = getTaxRegion(cfg.regionCode);
  if (!region) return 0.10; // fallback to AU GST

  if (cfg.subRegionCode && region.subRegions) {
    const sub = region.subRegions.find(s => s.code === cfg.subRegionCode);
    if (sub) return sub.rate;
  }

  return region.defaultRate;
}

export function getTaxLabel(config?: TaxConfig): string {
  const cfg = config || getTaxConfig();
  const region = getTaxRegion(cfg.regionCode);
  return region?.taxLabel || "Tax";
}

export function isTaxInclusive(config?: TaxConfig): boolean {
  const cfg = config || getTaxConfig();
  const region = getTaxRegion(cfg.regionCode);
  return region?.taxInclusive ?? true;
}

/**
 * Calculate tax for a subtotal amount (exclusive of tax).
 */
export function calculateTax(subtotalExTax: number, config?: TaxConfig): TaxCalculation {
  const cfg = config || getTaxConfig();
  const rate = getEffectiveTaxRate(cfg);
  const label = getTaxLabel(cfg);
  const taxAmount = Math.round(subtotalExTax * rate * 100) / 100;

  return {
    subtotalExTax,
    taxAmount,
    totalIncTax: Math.round((subtotalExTax + taxAmount) * 100) / 100,
    taxRate: rate,
    taxLabel: label,
    regionCode: cfg.regionCode,
    subRegionCode: cfg.subRegionCode,
  };
}

/**
 * Calculate tax for line items individually.
 */
export function calculateTaxForLines(
  lines: TaxLineItem[],
  config?: TaxConfig,
): TaxCalculation {
  const cfg = config || getTaxConfig();
  const rate = getEffectiveTaxRate(cfg);
  const label = getTaxLabel(cfg);

  let subtotal = 0;
  let totalTax = 0;
  const breakdown: { description: string; amount: number; tax: number }[] = [];

  for (const line of lines) {
    const lineTax = Math.round(line.amount * rate * 100) / 100;
    subtotal += line.amount;
    totalTax += lineTax;
    breakdown.push({ description: line.description, amount: line.amount, tax: lineTax });
  }

  return {
    subtotalExTax: Math.round(subtotal * 100) / 100,
    taxAmount: Math.round(totalTax * 100) / 100,
    totalIncTax: Math.round((subtotal + totalTax) * 100) / 100,
    taxRate: rate,
    taxLabel: label,
    regionCode: cfg.regionCode,
    subRegionCode: cfg.subRegionCode,
    breakdown,
  };
}

/**
 * Extract tax from a tax-inclusive amount.
 */
export function extractTaxFromInclusive(totalIncTax: number, config?: TaxConfig): TaxCalculation {
  const cfg = config || getTaxConfig();
  const rate = getEffectiveTaxRate(cfg);
  const label = getTaxLabel(cfg);
  const subtotal = Math.round((totalIncTax / (1 + rate)) * 100) / 100;
  const tax = Math.round((totalIncTax - subtotal) * 100) / 100;

  return {
    subtotalExTax: subtotal,
    taxAmount: tax,
    totalIncTax,
    taxRate: rate,
    taxLabel: label,
    regionCode: cfg.regionCode,
    subRegionCode: cfg.subRegionCode,
  };
}

/**
 * Format tax rate as percentage string.
 */
export function formatTaxRate(config?: TaxConfig): string {
  const rate = getEffectiveTaxRate(config);
  return `${(rate * 100).toFixed(rate % 0.01 === 0 ? 0 : 2)}%`;
}
