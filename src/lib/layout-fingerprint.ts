// ══════════════════════════════════════════════════════════════
// Layout Fingerprint
// Deterministic, order-independent hash of an invoice's column
// layout. Used to recognise familiar invoice formats instantly,
// even when column order varies between uploads from the same
// supplier.
// ══════════════════════════════════════════════════════════════

export interface InvoicePatternLike {
  layout_fingerprint?: string | null;
  [key: string]: unknown;
}

/**
 * Normalise a single header — lowercase, trim, strip non-alphanumerics.
 * "Style Name", "style name", "STYLE_NAME" all collapse to "stylename".
 */
function normaliseHeader(header: string): string {
  return (header || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "");
}

/**
 * djb2 hash — simple, fast, well-distributed for short strings.
 * Returns an unsigned 32-bit hex string.
 */
function djb2Hash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    // hash * 33 + c
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  // Convert to unsigned and hex
  return (hash >>> 0).toString(16);
}

/**
 * Build a deterministic layout fingerprint for a set of headers.
 *
 * Properties:
 * - Deterministic: same headers → same fingerprint
 * - Order-independent: ["Style","Cost"] === ["Cost","Style"]
 * - Normalised: case/punctuation insensitive
 * - Structural: encodes column count, size-matrix signal, size-pair signal
 */
export function generateLayoutFingerprint(headers: string[]): string {
  const cleaned = (headers || [])
    .map(normaliseHeader)
    .filter((h) => h.length > 0);

  // Order-independent
  const sorted = [...cleaned].sort();

  // Structural signals (use original headers — trimmed only — for pattern checks)
  const trimmed = (headers || []).map((h) => (h || "").trim());
  const hasNumericOnly = trimmed.some((h) => /^\d{1,3}$/.test(h));
  const hasSizePair = trimmed.some((h) => /^\d{1,3}\s*\/\s*\d{1,3}$/.test(h));

  let signature = sorted.join("|");
  signature += `_cols${cleaned.length}`;
  if (hasNumericOnly) signature += "_matrix";
  if (hasSizePair) signature += "_pairs";

  return djb2Hash(signature);
}

/**
 * Find a saved invoice pattern that matches the given fingerprint exactly.
 * Returns the first match, or null if none.
 */
export function matchFingerprint<T extends InvoicePatternLike>(
  newFingerprint: string,
  savedPatterns: T[],
): T | null {
  if (!newFingerprint || !savedPatterns?.length) return null;
  for (const pattern of savedPatterns) {
    if (pattern.layout_fingerprint === newFingerprint) {
      return pattern;
    }
  }
  return null;
}
