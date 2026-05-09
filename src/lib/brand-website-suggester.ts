/**
 * Heuristic guesser for a supplier's brand website.
 *
 * Inputs:
 *   - brandName  : the parsed vendor / brand name from the invoice
 *   - hint       : free-form string that may contain an email or URL
 *                  (e.g. supplier label, "from" line, footer)
 *
 * Output: ordered list of candidate domains (host only, lower-case,
 * no protocol / trailing slash). Best guess first.
 *
 * Strategy (in priority order):
 *   1. Extract any email domain from `hint` (skip generic providers).
 *   2. Extract any explicit URL host from `hint`.
 *   3. Build domain variants from the brand name slug:
 *        <slug>.com.au, <slug>.com, <slug-no-hyphens>.com.au, <slug-no-hyphens>.com
 */
const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "yahoo.com.au", "outlook.com", "hotmail.com",
  "live.com", "icloud.com", "me.com", "bigpond.com", "optusnet.com.au",
  "aol.com", "proton.me", "protonmail.com", "msn.com",
]);

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[''’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanHost(raw: string): string | null {
  if (!raw) return null;
  let h = raw.trim().toLowerCase();
  h = h.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) return null;
  return h;
}

export interface BrandWebsiteSuggestion {
  host: string;
  source: "email" | "url" | "name";
  /** Why this candidate was generated — shown to the user as a tooltip. */
  reason: string;
}

export function suggestBrandWebsites(
  brandName: string,
  hint?: string | null,
): BrandWebsiteSuggestion[] {
  const out: BrandWebsiteSuggestion[] = [];
  const seen = new Set<string>();
  const push = (s: BrandWebsiteSuggestion) => {
    if (seen.has(s.host)) return;
    seen.add(s.host);
    out.push(s);
  };

  // 1) Email domain in hint
  if (hint) {
    const emailMatches = hint.match(/[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})/gi) ?? [];
    for (const m of emailMatches) {
      const dom = m.split("@")[1]?.toLowerCase();
      if (!dom) continue;
      if (GENERIC_EMAIL_DOMAINS.has(dom)) continue;
      const host = cleanHost(dom);
      if (host) push({ host, source: "email", reason: `From email "${m}"` });
    }
  }

  // 2) Explicit URL host in hint
  if (hint) {
    const urlMatches = hint.match(/\bhttps?:\/\/[^\s)>"']+/gi) ?? [];
    for (const u of urlMatches) {
      const host = cleanHost(u);
      if (host) push({ host, source: "url", reason: `From URL "${u}"` });
    }
  }

  // 3) Name-based variants
  const slug = slugify(brandName);
  if (slug) {
    const noHyphens = slug.replace(/-/g, "");
    const tlds = ["com.au", "com", "co", "net", "shop"];
    const bases = noHyphens === slug ? [slug] : [slug, noHyphens];
    for (const tld of tlds) {
      for (const base of bases) {
        push({
          host: `${base}.${tld}`,
          source: "name",
          reason: `Built from brand name "${brandName}"`,
        });
      }
    }
  }

  return out.slice(0, 6);
}
