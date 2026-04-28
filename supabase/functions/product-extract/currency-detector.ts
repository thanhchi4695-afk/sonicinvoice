// ════════════════════════════════════════════════════════════════
// currency-detector.ts — Detect ISO currency code + parse numeric
// price from raw text scraped from a product page.
//
// Locked rules (mem://features/url-product-extractor):
//   • Symbol map first ($, €, £, ¥), then compound prefixes
//     (A$, AU$, NZ$, CA$, C$, HK$, S$, R$, kr, zł, …)
//   • Embedded ISO 4217 codes win over ambiguous "$" alone
//   • Locale hint last (en-US → USD, en-AU → AUD, fr-FR → EUR …)
//   • Unknown → "UNKNOWN" + null price (caller can flag a warning)
//   • Numeric parser handles US (1,234.56) AND EU (1.234,56) formats
// ════════════════════════════════════════════════════════════════

// ────────────────────────────────────────────────────────────────
// Symbol & locale tables
// ────────────────────────────────────────────────────────────────

/** Compound prefixes checked before single-char symbols. Order matters. */
const COMPOUND_SYMBOLS: Array<[RegExp, string]> = [
  [/AU\$|A\$/i, "AUD"],
  [/NZ\$/i, "NZD"],
  [/CA\$|C\$/i, "CAD"],
  [/HK\$/i, "HKD"],
  [/SG\$|S\$/i, "SGD"],
  [/US\$/i, "USD"],
  [/R\$/i, "BRL"],
  [/\bkr\b/i, "SEK"],   // also DKK/NOK — pick SEK as a safe default
  [/zł/i, "PLN"],
  [/₹/, "INR"],
  [/₽/, "RUB"],
  [/₩/, "KRW"],
  [/₪/, "ILS"],
  [/₺/, "TRY"],
  [/CHF/i, "CHF"],
];

/** Single-char fallbacks. */
const SYMBOL_MAP: Record<string, string> = {
  "$": "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
};

/** ISO 4217 codes we explicitly recognise when present in text. */
const ISO_CODES = new Set([
  "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "NZD", "CHF", "SEK", "NOK",
  "DKK", "PLN", "CZK", "HUF", "INR", "CNY", "HKD", "SGD", "KRW", "MXN",
  "BRL", "ZAR", "ILS", "TRY", "AED", "SAR", "THB", "MYR", "IDR", "PHP",
  "TWD", "RUB", "VND",
]);

/** Locale → currency hint. Country code is the deciding part. */
const LOCALE_TO_CURRENCY: Record<string, string> = {
  US: "USD", AU: "AUD", NZ: "NZD", CA: "CAD", GB: "GBP", UK: "GBP",
  IE: "EUR", FR: "EUR", DE: "EUR", ES: "EUR", IT: "EUR", PT: "EUR",
  NL: "EUR", BE: "EUR", AT: "EUR", FI: "EUR", GR: "EUR", LU: "EUR",
  JP: "JPY", CN: "CNY", HK: "HKD", SG: "SGD", IN: "INR", KR: "KRW",
  CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK", PL: "PLN", CZ: "CZK",
  HU: "HUF", MX: "MXN", BR: "BRL", ZA: "ZAR", IL: "ILS", TR: "TRY",
  AE: "AED", SA: "SAR", TH: "THB", MY: "MYR", ID: "IDR", PH: "PHP",
  TW: "TWD", RU: "RUB", VN: "VND",
};

// ────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────

/**
 * Detect the ISO currency code for a price string.
 * Returns "UNKNOWN" if nothing matches.
 */
export function detectCurrency(priceText: string, pageLocale?: string): string {
  const text = (priceText ?? "").trim();

  // 1. Embedded ISO 4217 code wins (e.g. "USD 49.99", "49.99 AUD")
  const isoMatch = text.toUpperCase().match(/\b([A-Z]{3})\b/);
  if (isoMatch && ISO_CODES.has(isoMatch[1])) {
    return isoMatch[1];
  }

  // 2. Compound symbols (A$, NZ$, R$, kr, zł, …)
  for (const [re, code] of COMPOUND_SYMBOLS) {
    if (re.test(text)) return code;
  }

  // 3. Single-char symbols
  for (const sym of Object.keys(SYMBOL_MAP)) {
    if (text.includes(sym)) return SYMBOL_MAP[sym];
  }

  // 4. Locale hint — accept "en-US", "en_US", "en-us", "US"
  if (pageLocale) {
    const region = pageLocale.replace("_", "-").split("-").pop()?.toUpperCase();
    if (region && LOCALE_TO_CURRENCY[region]) {
      return LOCALE_TO_CURRENCY[region];
    }
  }

  return "UNKNOWN";
}

/**
 * Extract the numeric value from a price string.
 * Handles both US (1,234.56) and European (1.234,56) formats by
 * looking at which separator appears last.
 *
 * Returns NaN when no digits are present (caller should treat as null).
 */
export function normalizePrice(priceText: string, _detectedCurrency: string): number {
  if (!priceText) return NaN;

  // Keep digits, dots, commas, and a leading minus for refunds/credits
  const cleaned = priceText.replace(/[^\d.,-]/g, "");
  if (!cleaned) return NaN;

  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");

  let normalised: string;
  if (lastDot === -1 && lastComma === -1) {
    normalised = cleaned;
  } else if (lastComma > lastDot) {
    // European format: "." = thousands, "," = decimal
    normalised = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    // US/UK format: "," = thousands, "." = decimal
    normalised = cleaned.replace(/,/g, "");
  }

  const n = parseFloat(normalised);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Convenience helper used by the orchestrator: returns both the
 * currency and numeric price in one shot, with an explicit
 * `unknown` flag so the caller can attach a warning.
 */
export function detectAndNormalize(
  priceText: string,
  pageLocale?: string,
): { currency: string; numericPrice: number | null; unknown: boolean } {
  const currency = detectCurrency(priceText, pageLocale);
  const n = normalizePrice(priceText, currency);
  const unknown = currency === "UNKNOWN" || !Number.isFinite(n);
  return {
    currency,
    numericPrice: Number.isFinite(n) ? n : null,
    unknown,
  };
}
