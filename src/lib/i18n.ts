// Internationalisation — currency, locale, and geography config

export interface CurrencyConfig {
  code: string;
  symbol: string;
  name: string;
  flag: string;
}

export interface LocaleConfig {
  id: string;
  country: string;
  flag: string;
  english: string;
  dateFormat: 'DD-MM-YYYY' | 'MM-DD-YYYY' | 'YYYY-MM-DD';
  taxLabel: string;
  taxRate: number;
  tld: string;
  sizeFormat: string;
  enrichmentInstruction: string;
}

// ── Currencies ─────────────────────────────────────────────
export const CURRENCIES: CurrencyConfig[] = [
  { code: 'AUD', symbol: '$', name: 'Australian Dollar', flag: '🇦🇺' },
  { code: 'USD', symbol: '$', name: 'US Dollar', flag: '🇺🇸' },
  { code: 'GBP', symbol: '£', name: 'British Pound', flag: '🇬🇧' },
  { code: 'EUR', symbol: '€', name: 'Euro', flag: '🇪🇺' },
  { code: 'NZD', symbol: '$', name: 'New Zealand Dollar', flag: '🇳🇿' },
  { code: 'CAD', symbol: '$', name: 'Canadian Dollar', flag: '🇨🇦' },
  { code: 'SGD', symbol: '$', name: 'Singapore Dollar', flag: '🇸🇬' },
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar', flag: '🇭🇰' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', flag: '🇯🇵' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', flag: '🇮🇳' },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand', flag: '🇿🇦' },
];

export function getCurrency(code: string): CurrencyConfig {
  return CURRENCIES.find(c => c.code === code) || { code, symbol: '$', name: code, flag: '🏳️' };
}

export function formatPrice(amount: number, currencyCode: string): string {
  const c = getCurrency(currencyCode);
  if (currencyCode === 'JPY') return `${c.symbol}${Math.round(amount)}`;
  return `${c.symbol}${amount.toFixed(2)}`;
}

// ── Locales ────────────────────────────────────────────────
export const LOCALES: LocaleConfig[] = [
  {
    id: 'AU', country: 'Australia', flag: '🇦🇺', english: 'Australian English',
    dateFormat: 'DD-MM-YYYY', taxLabel: 'GST', taxRate: 10, tld: '.com.au',
    sizeFormat: '6,8,10,12,14,16,18,20',
    enrichmentInstruction: 'Search .com.au sources first. {currency} prices only. Never use US (.com), UK (.co.uk), or marketplace sites.',
  },
  {
    id: 'US', country: 'United States', flag: '🇺🇸', english: 'American English',
    dateFormat: 'MM-DD-YYYY', taxLabel: 'Sales Tax', taxRate: 0, tld: '.com',
    sizeFormat: '0,2,4,6,8,10,12,14',
    enrichmentInstruction: 'Search .com sources. {currency} prices only. Preferred: brand official site, then major US retailers. Never use AU, UK, or marketplace aggregators.',
  },
  {
    id: 'UK', country: 'United Kingdom', flag: '🇬🇧', english: 'British English',
    dateFormat: 'DD-MM-YYYY', taxLabel: 'VAT', taxRate: 20, tld: '.co.uk',
    sizeFormat: '6,8,10,12,14,16,18',
    enrichmentInstruction: 'Search .co.uk sources. {currency} prices only. Preferred: brand official site, then major UK retailers. Never use AU or US sites.',
  },
  {
    id: 'NZ', country: 'New Zealand', flag: '🇳🇿', english: 'Australian English',
    dateFormat: 'DD-MM-YYYY', taxLabel: 'GST', taxRate: 15, tld: '.co.nz',
    sizeFormat: '6,8,10,12,14,16,18,20',
    enrichmentInstruction: 'Search .co.nz sources first, then .com.au as fallback. {currency} prices only. Flag AUD conversions as estimated.',
  },
  {
    id: 'CA', country: 'Canada', flag: '🇨🇦', english: 'American English',
    dateFormat: 'YYYY-MM-DD', taxLabel: 'HST/GST', taxRate: 13, tld: '.ca',
    sizeFormat: '0,2,4,6,8,10,12,14',
    enrichmentInstruction: 'Search .ca sources first, then .com. {currency} prices only.',
  },
  {
    id: 'SG', country: 'Singapore', flag: '🇸🇬', english: 'English',
    dateFormat: 'DD-MM-YYYY', taxLabel: 'GST', taxRate: 9, tld: '.sg',
    sizeFormat: 'XS,S,M,L,XL',
    enrichmentInstruction: 'Search .sg sources. {currency} prices only.',
  },
  {
    id: 'IN', country: 'India', flag: '🇮🇳', english: 'English',
    dateFormat: 'DD-MM-YYYY', taxLabel: 'GST', taxRate: 18, tld: '.in',
    sizeFormat: 'XS,S,M,L,XL,XXL',
    enrichmentInstruction: 'Search .in and Indian retailer sources. {currency} prices only.',
  },
  {
    id: 'ZA', country: 'South Africa', flag: '🇿🇦', english: 'English',
    dateFormat: 'YYYY-MM-DD', taxLabel: 'VAT', taxRate: 15, tld: '.co.za',
    sizeFormat: 'XS,S,M,L,XL',
    enrichmentInstruction: 'Search .co.za sources. {currency} prices only.',
  },
  {
    id: 'EU', country: 'Europe', flag: '🇪🇺', english: 'English',
    dateFormat: 'DD-MM-YYYY', taxLabel: 'VAT', taxRate: 21, tld: '.eu',
    sizeFormat: 'XS,S,M,L,XL',
    enrichmentInstruction: 'Search European retailer sources. {currency} prices only.',
  },
];

export function getLocale(id: string): LocaleConfig {
  return LOCALES.find(l => l.id === id) || LOCALES[0];
}

export function getLocaleEnglish(localeId: string): string {
  return getLocale(localeId).english;
}

export function getEnrichmentInstruction(localeId: string, currency: string): string {
  return getLocale(localeId).enrichmentInstruction.replace('{currency}', currency);
}

export function formatDateForLocale(date: Date, localeId: string): string {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  const fmt = getLocale(localeId).dateFormat;
  if (fmt === 'MM-DD-YYYY') return `${m}-${d}-${y}`;
  if (fmt === 'YYYY-MM-DD') return `${y}-${m}-${d}`;
  return `${d}-${m}-${y}`;
}
