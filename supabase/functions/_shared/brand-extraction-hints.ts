// Per-brand extraction hints for fashion supplier/retailer sites.
// Used by price-lookup-extract to give Firecrawl better targeting (includeTags / excludeTags)
// and to nudge the AI prompt with brand-specific structural notes.

export interface BrandHint {
  /** Display name shown in logs / extraction notes */
  name: string;
  /** CSS selectors / tag patterns to KEEP when scraping (passed to Firecrawl includeTags) */
  includeTags?: string[];
  /** CSS selectors / tag patterns to STRIP (passed to Firecrawl excludeTags) */
  excludeTags?: string[];
  /** Extra wait time in ms for slow-rendering JS sites */
  waitFor?: number;
  /** Free-text guidance appended to the AI extraction prompt */
  promptHint?: string;
}

// Map matched against the page hostname (lowercased, no `www.`).
// Order doesn't matter — first match by `endsWith` wins.
export const BRAND_HINTS: Record<string, BrandHint> = {
  "seafolly.com.au": {
    name: "Seafolly",
    includeTags: [".product-detail__description", ".product-detail__features", ".product__info", '[itemprop="description"]', "h1", ".price", "main"],
    excludeTags: ["header", "footer", "nav", ".header", ".footer", ".reviews", ".you-may-also-like", ".recommendations"],
    waitFor: 2000,
    promptHint: "Seafolly product pages put the marketing description directly under the title and a 'Details' accordion with bullet features. Fabric content is usually under 'Fabric & Care'.",
  },
  "bakuswimwear.com": {
    name: "Baku",
    includeTags: [".product-single__description", ".product__description", ".rte", "h1", ".price", "main"],
    excludeTags: ["header", "footer", "nav", ".announcement-bar", ".product-recommendations"],
    promptHint: "Baku description is in a single rich-text block; features are bulleted at the bottom of that block.",
  },
  "bondeyeswim.com": {
    name: "Bond-Eye",
    includeTags: [".product__description", ".product-single__description", ".rte", "h1", ".product__price", "main"],
    excludeTags: ["header", "footer", "nav", ".product-recommendations", ".reviews-io"],
    promptHint: "Bond-Eye descriptions are short and editorial. Fabric content is in a separate accordion labelled 'Composition'.",
  },
  "tigerlilyswimwear.com.au": {
    name: "Tigerlily",
    includeTags: [".product-info", ".product__description", ".pdp-description", "h1", ".price", "main"],
    excludeTags: ["header", "footer", "nav", ".recommendations"],
    promptHint: "Tigerlily uses a 'Description' tab and a 'Details' tab — both contain useful copy.",
  },
  "jets.com.au": {
    name: "JETS",
    includeTags: [".product__description", ".product-single__description", "h1", ".price", "main"],
    excludeTags: ["header", "footer", "nav", ".recommendations"],
    promptHint: "JETS product pages list fabric percentages in the description block itself.",
  },
  "zimmermann.com": {
    name: "Zimmermann",
    includeTags: [".product-information", ".product-description", ".product-details", "h1", ".price", "main"],
    excludeTags: ["header", "footer", "nav", ".recommendations", ".you-may-also-like"],
    waitFor: 2500,
    promptHint: "Zimmermann descriptions are short and prose-style. Composition/care is under a 'Details & Care' accordion.",
  },
  "theiconic.com.au": {
    name: "The Iconic",
    includeTags: ['[data-testid="product-description"]', '[data-testid="product-details"]', "h1", '[data-testid="product-price"]', "main"],
    excludeTags: ["header", "footer", "nav", '[data-testid="recommendations"]', '[data-testid="reviews"]'],
    waitFor: 2500,
    promptHint: "The Iconic shows brand-supplied description first, then a 'Product Details' bullet list with fabric & care.",
  },
  "myer.com.au": {
    name: "Myer",
    includeTags: [".product-description", ".product-details", "h1", ".price", "main"],
    excludeTags: ["header", "footer", "nav", ".recommendations", ".reviews"],
    waitFor: 2000,
  },
  "davidjones.com": {
    name: "David Jones",
    includeTags: [".product-description", ".product-info", "h1", ".price", "main"],
    excludeTags: ["header", "footer", "nav", ".recommendations"],
    waitFor: 2000,
  },
  "swimwearGalore.com.au": {
    name: "Swimwear Galore",
    includeTags: [".product-single__description", ".rte", "h1", ".price", "main"],
    excludeTags: ["header", "footer", "nav", ".recommendations"],
  },
};

/** Returns the hint for a URL, or undefined if no brand match. */
export function findBrandHint(url: string): BrandHint | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    for (const [domain, hint] of Object.entries(BRAND_HINTS)) {
      if (host === domain.toLowerCase() || host.endsWith("." + domain.toLowerCase())) {
        return hint;
      }
    }
  } catch {
    // ignore malformed URLs
  }
  return undefined;
}
