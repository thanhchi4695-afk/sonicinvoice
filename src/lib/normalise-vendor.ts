// Title-case vendor names while preserving acronyms (G2M, BBQ) and casing
// common business suffixes consistently (Pty Ltd, Inc, GmbH, BV, SAS, Srl).
// Mirrors the SQL function `public.normalise_vendor()` so frontend writes
// to `supplier_intelligence` produce the same canonical form the unique
// index (user_id, lower(supplier_name)) expects.

const ACRONYM_RE = /^[A-Z0-9&]{2,}$/;

export function normaliseVendor(raw: string | null | undefined): string {
  if (!raw) return "";
  const cleaned = raw.trim().replace(/\s+/g, " ");
  if (!cleaned) return "";
  return cleaned
    .split(" ")
    .map((word) => {
      if (ACRONYM_RE.test(word)) return word; // preserve G2M, BBQ, P/L
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}
