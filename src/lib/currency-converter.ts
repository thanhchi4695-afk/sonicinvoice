// Currency Converter — uses Frankfurter API (free, no key needed, ECB rates)
// Provides real-time exchange rates and conversion for invoice display

const FRANKFURTER_BASE = "https://api.frankfurter.app";
const CACHE_KEY = "fx_rates_cache";
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

// ── Types ──────────────────────────────────────────────────────

export interface ExchangeRates {
  base: string;
  date: string;
  rates: Record<string, number>;
  fetchedAt: number;
}

export interface ConversionResult {
  from: string;
  to: string;
  rate: number;
  originalAmount: number;
  convertedAmount: number;
  date: string;
}

// ── Cache ──────────────────────────────────────────────────────

function getCachedRates(base: string): ExchangeRates | null {
  try {
    const raw = localStorage.getItem(`${CACHE_KEY}_${base}`);
    if (!raw) return null;
    const cached: ExchangeRates = JSON.parse(raw);
    if (Date.now() - cached.fetchedAt < CACHE_TTL) return cached;
  } catch {}
  return null;
}

function setCachedRates(base: string, rates: ExchangeRates): void {
  try {
    localStorage.setItem(`${CACHE_KEY}_${base}`, JSON.stringify(rates));
  } catch {}
}

// ── API ────────────────────────────────────────────────────────

/**
 * Fetch latest exchange rates from Frankfurter API.
 * Returns cached rates if fresh enough.
 */
export async function getExchangeRates(baseCurrency: string = "AUD"): Promise<ExchangeRates> {
  const cached = getCachedRates(baseCurrency);
  if (cached) return cached;

  const resp = await fetch(`${FRANKFURTER_BASE}/latest?from=${baseCurrency}`);
  if (!resp.ok) {
    throw new Error(`Exchange rate fetch failed: ${resp.status}`);
  }
  const data = await resp.json();
  const rates: ExchangeRates = {
    base: data.base,
    date: data.date,
    rates: { ...data.rates, [baseCurrency]: 1 },
    fetchedAt: Date.now(),
  };
  setCachedRates(baseCurrency, rates);
  return rates;
}

/**
 * Convert an amount between currencies.
 */
export async function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
): Promise<ConversionResult> {
  if (fromCurrency === toCurrency) {
    return { from: fromCurrency, to: toCurrency, rate: 1, originalAmount: amount, convertedAmount: amount, date: new Date().toISOString().slice(0, 10) };
  }

  // Fetch rates based on the source currency
  const rates = await getExchangeRates(fromCurrency);
  const rate = rates.rates[toCurrency];

  if (!rate) {
    // Fallback: try the reverse direction
    const reverseRates = await getExchangeRates(toCurrency);
    const reverseRate = reverseRates.rates[fromCurrency];
    if (!reverseRate) {
      throw new Error(`No exchange rate found for ${fromCurrency} → ${toCurrency}`);
    }
    const convertedAmount = Math.round((amount / reverseRate) * 100) / 100;
    return {
      from: fromCurrency,
      to: toCurrency,
      rate: Math.round((1 / reverseRate) * 10000) / 10000,
      originalAmount: amount,
      convertedAmount,
      date: reverseRates.date,
    };
  }

  const convertedAmount = Math.round(amount * rate * 100) / 100;
  return {
    from: fromCurrency,
    to: toCurrency,
    rate: Math.round(rate * 10000) / 10000,
    originalAmount: amount,
    convertedAmount,
    date: rates.date,
  };
}

/**
 * Get a single exchange rate (cached).
 */
export async function getRate(from: string, to: string): Promise<number> {
  if (from === to) return 1;
  const rates = await getExchangeRates(from);
  return rates.rates[to] || 1;
}

/**
 * Format a converted amount with both currencies.
 * e.g. "US$150.00 (≈ A$232.50)"
 */
export function formatConvertedAmount(
  original: number,
  converted: number,
  fromCurrency: string,
  toCurrency: string,
): string {
  const fromSymbol = CURRENCY_SYMBOLS[fromCurrency] || fromCurrency;
  const toSymbol = CURRENCY_SYMBOLS[toCurrency] || toCurrency;
  return `${fromSymbol}${original.toFixed(2)} (≈ ${toSymbol}${converted.toFixed(2)})`;
}

/**
 * List of supported currencies from Frankfurter.
 */
export const SUPPORTED_CURRENCIES = [
  "AUD", "BGN", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP",
  "HKD", "HUF", "IDR", "ILS", "INR", "ISK", "JPY", "KRW", "MXN", "MYR",
  "NOK", "NZD", "PHP", "PLN", "RON", "SEK", "SGD", "THB", "TRY", "USD", "ZAR",
];

const CURRENCY_SYMBOLS: Record<string, string> = {
  AUD: "A$", USD: "US$", GBP: "£", EUR: "€", NZD: "NZ$", CAD: "C$",
  SGD: "S$", INR: "₹", ZAR: "R", JPY: "¥", CNY: "¥", CHF: "CHF ",
  HKD: "HK$", SEK: "kr", NOK: "kr", DKK: "kr", MXN: "MX$", BRL: "R$",
};

export function getCurrencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] || code + " ";
}
