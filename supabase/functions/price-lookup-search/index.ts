import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FIRECRAWL_API = "https://api.firecrawl.dev/v2";

// Known brand → AU domain map for direct URL probing + AU prioritisation.
// Keys must be lowercase. Whitespace and hyphens are normalised before lookup.
const BRAND_DOMAINS: Record<string, string> = {
  "seafolly": "seafolly.com.au",
  "baku": "bakuswimwear.com.au",
  "bond-eye": "bond-eyeswim.com",
  "bondeye": "bond-eyeswim.com",
  "bond eye": "bond-eyeswim.com",
  "sunseeker": "sunseekerbathers.com.au",
  "sea level": "sealevelswimwear.com.au",
  "sealevel": "sealevelswimwear.com.au",
  "jantzen": "jantzen.com.au",
  "kulani kinis": "kulanikinis.com",
  "kulanikinis": "kulanikinis.com",
  "tigerlily": "tigerlilyswimwear.com.au",
  "speedo": "speedo.com.au",
  "funkita": "funkita.com.au",
  "funky trunks": "funkytrunks.com.au",
  "funkytrunks": "funkytrunks.com.au",
  "billabong": "billabong.com/en-au",
  "rip curl": "ripcurl.com.au",
  "ripcurl": "ripcurl.com.au",
  "quiksilver": "quiksilver.com.au",
  "jets": "jets.com.au",
  "zimmermann": "zimmermann.com",
};

function lookupBrandDomain(brand?: string): string | null {
  if (!brand) return null;
  const key = brand.toLowerCase().trim();
  if (BRAND_DOMAINS[key]) return BRAND_DOMAINS[key];
  // Try collapsed (no spaces) and hyphenated variants
  const collapsed = key.replace(/\s+/g, "");
  if (BRAND_DOMAINS[collapsed]) return BRAND_DOMAINS[collapsed];
  const hyphenated = key.replace(/\s+/g, "-");
  if (BRAND_DOMAINS[hyphenated]) return BRAND_DOMAINS[hyphenated];
  return null;
}

// Domains that are noise for product searches — social, editorial, blog
const NOISE_DOMAINS = [
  "instagram.com", "facebook.com", "tiktok.com", "pinterest.com",
  "youtube.com", "twitter.com", "x.com", "shopltk.com", "liketoknow.it",
  "glamadelaide.com.au", "reddit.com", "quora.com",
];

function isNoiseUrl(url: string): boolean {
  const u = url.toLowerCase();
  return NOISE_DOMAINS.some(d => u.includes(d));
}

function slugify(s: string): string {
  return s.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function isCollectionUrl(url: string): boolean {
  const u = url.toLowerCase();
  return /\/collections?\//.test(u) || /\/categor(y|ies)\//.test(u) || /\/search\//.test(u);
}

function isProductUrl(url: string): boolean {
  const u = url.toLowerCase();
  return /\/products?\//.test(u) || /\/p\//.test(u);
}

/** Probe `https://www.{domain}/products/{slug}` with HEAD then GET fallback. */
async function tryDirectBrandUrl(brand: string, productName: string): Promise<string | null> {
  const domain = lookupBrandDomain(brand);
  if (!domain) return null;
  const slug = slugify(productName);
  if (!slug) return null;
  const url = `https://www.${domain}/products/${slug}`;
  try {
    let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(5000) });
    // Some Shopify storefronts return 405 for HEAD — retry with GET
    if (res.status === 405 || res.status === 403) {
      res = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(6000) });
    }
    if (res.ok) return res.url || url;
  } catch { /* ignore */ }
  return null;
}

// Domains we trust as Australian retailers (used to enrich + sort results)
const AU_RETAILERS: Record<string, { type: string; au: boolean }> = {
  "theiconic.com.au": { type: "department_store", au: true },
  "myer.com.au": { type: "department_store", au: true },
  "davidjones.com": { type: "department_store", au: true },
  "surfstitch.com": { type: "specialty", au: true },
  "citybeach.com.au": { type: "specialty", au: true },
  "swimwear365.com.au": { type: "specialty", au: true },
  "seafolly.com.au": { type: "brand_direct", au: true },
  "seafolly.com": { type: "brand_direct", au: false },
  "us.seafolly.com": { type: "brand_direct", au: false },
  "baku.com.au": { type: "brand_direct", au: true },
  "bakuswimwear.com.au": { type: "brand_direct", au: true },
  "sunseeker.com.au": { type: "brand_direct", au: true },
  "sunseekerbathers.com.au": { type: "brand_direct", au: true },
  "bondeyeswim.com": { type: "brand_direct", au: false },
  "ozsale.com.au": { type: "marketplace", au: true },
};

function classifyDomain(domain: string, supplier?: string) {
  const d = domain.toLowerCase();
  const known = AU_RETAILERS[d];
  if (known) {
    const isOfficial = supplier ? d.includes(supplier.toLowerCase().replace(/\s+/g, "")) : false;
    return { ...known, is_official_brand: isOfficial || known.type === "brand_direct" };
  }
  const isAu = d.endsWith(".com.au") || d.endsWith(".net.au") || d.endsWith(".org.au") || d.endsWith(".au");
  const isOfficial = supplier ? d.includes(supplier.toLowerCase().replace(/\s+/g, "")) : false;
  return {
    type: isOfficial ? "brand_direct" : isAu ? "specialty" : "marketplace",
    au: isAu,
    is_official_brand: isOfficial,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { product_name, supplier, style_number, colour, serpapi_key, mode } = await req.json();

    if (!product_name) {
      return new Response(JSON.stringify({ error: "product_name is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    const SERPAPI_KEY = serpapi_key || Deno.env.get("SERPAPI_KEY");

    // Strip leading supplier from product_name to avoid duplication
    let cleanProductName = String(product_name).trim();
    if (supplier) {
      const supRe = new RegExp(`^${supplier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i");
      cleanProductName = cleanProductName.replace(supRe, "").trim();
    }

    // ── Resolve known brand domain (for AU bias + direct probe) ──
    const brandDomain = lookupBrandDomain(supplier);
    // Strip path suffix (e.g. billabong.com/en-au) for site: operator
    const brandSiteOperator = brandDomain ? brandDomain.split("/")[0] : null;

    // ── Query construction by mode ──
    const searchMode: "primary" | "sku" | "direct" = mode === "sku" ? "sku" : mode === "direct" ? "direct" : "primary";

    // AU TLD bias — appended to every search
    const AU_TLD_BIAS = "(site:.com.au OR site:.net.au OR site:.org.au OR inurl:/products/)";

    let searchQuery = "";
    if (searchMode === "primary") {
      const parts = [cleanProductName, supplier, colour].filter(Boolean);
      const exclusions = "-site:instagram.com -site:facebook.com -site:tiktok.com -site:pinterest.com -site:youtube.com -site:shopltk.com -site:glamadelaide.com.au -inurl:collection -inurl:collections -inurl:category";
      // If we know the brand's AU domain, lead with site: to anchor results there.
      const brandPrefix = brandSiteOperator ? `site:${brandSiteOperator} OR ` : "";
      searchQuery = `${parts.join(" ")} buy (${brandPrefix}${AU_TLD_BIAS}) ${exclusions}`;
    } else if (searchMode === "sku") {
      const parts = [style_number, supplier].filter(Boolean);
      const brandPrefix = brandSiteOperator ? `site:${brandSiteOperator} OR ` : "";
      searchQuery = parts.length > 0
        ? `${parts.join(" ")} Australia (${brandPrefix}${AU_TLD_BIAS})`
        : `${cleanProductName} ${supplier || ""} Australia ${AU_TLD_BIAS}`.trim();
    }

    // ── Mode: direct brand URL probe only ──
    if (searchMode === "direct") {
      const directUrl = supplier ? await tryDirectBrandUrl(supplier, cleanProductName) : null;
      if (directUrl) {
        let domain = "";
        try { domain = new URL(directUrl).hostname.replace(/^www\./, ""); } catch {}
        const meta = classifyDomain(domain, supplier);
        return new Response(JSON.stringify({
          search_query: `direct: ${directUrl}`,
          source: "direct_url",
          brand_au_domain: brandSiteOperator,
          results: [{
            title: `${supplier} — ${cleanProductName}`,
            url: directUrl,
            domain,
            snippet: "Direct brand product URL",
            is_australian: meta.au,
            is_official_brand: true,
            retailer_type: "brand_direct",
            is_direct_brand_url: true,
          }],
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        search_query: "direct probe failed",
        source: "direct_url",
        brand_au_domain: brandSiteOperator,
        results: [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Kick off direct brand URL probe IN PARALLEL with the search (point 3) ──
    const directProbe = supplier ? tryDirectBrandUrl(supplier, cleanProductName) : Promise.resolve(null);

    // ── Source 1 (PREFERRED): SerpApi Google Shopping ──
    if (SERPAPI_KEY) {
      try {
        const params = new URLSearchParams({
          engine: "google_shopping",
          q: searchQuery,
          gl: "au",
          hl: "en",
          location: "Australia",
          api_key: SERPAPI_KEY,
        });
        const [spRes, directUrl] = await Promise.all([
          fetch(`https://serpapi.com/search.json?${params.toString()}`),
          directProbe,
        ]);
        const spData = await spRes.json();
        if (spRes.ok && Array.isArray(spData?.shopping_results) && spData.shopping_results.length > 0) {
          let results = spData.shopping_results.slice(0, 10).map((r: any) => {
            const url: string = r.product_link || r.link || "";
            let domain = "";
            try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch {}
            const meta = classifyDomain(domain, supplier);
            let price: number | null = null;
            if (typeof r.extracted_price === "number") price = r.extracted_price;
            else if (typeof r.price === "string") {
              const m = r.price.replace(/,/g, "").match(/[\d.]+/);
              if (m) price = parseFloat(m[0]);
            }
            return {
              title: r.title || domain,
              url,
              domain,
              snippet: r.snippet || (r.source ? `${r.source} — ${r.price || ""}` : ""),
              is_australian: meta.au,
              is_official_brand: meta.is_official_brand,
              retailer_type: meta.type,
              price_aud: price,
              retailer: r.source || domain,
              thumbnail: r.thumbnail || null,
            };
          }).filter((r: any) => r.url && !isNoiseUrl(r.url));

          // Prepend the direct brand URL if the probe succeeded
          if (directUrl) {
            let domain = "";
            try { domain = new URL(directUrl).hostname.replace(/^www\./, ""); } catch {}
            const meta = classifyDomain(domain, supplier);
            const alreadyPresent = results.some((r: any) => r.url === directUrl);
            if (!alreadyPresent) {
              results = [{
                title: `${supplier || "Brand"} — ${cleanProductName}`,
                url: directUrl,
                domain,
                snippet: "Direct brand product URL",
                is_australian: meta.au,
                is_official_brand: true,
                retailer_type: "brand_direct",
                price_aud: null,
                retailer: domain,
                thumbnail: null,
                is_direct_brand_url: true,
              }, ...results];
            }
          }

          results.sort((a: any, b: any) => {
            const score = (x: any) =>
              (x.is_direct_brand_url ? 100 : 0) +
              (isProductUrl(x.url) ? 5 : 0) +
              (isCollectionUrl(x.url) ? -3 : 0) +
              (x.is_official_brand ? 3 : 0) +
              (x.is_australian ? 1 : 0);
            return score(b) - score(a);
          });

          // Auto-fallback: retry with SKU query if no usable product page came back
          const hasProductPage = results.some((r: any) => isProductUrl(r.url));
          if (!hasProductPage && searchMode === "primary" && style_number) {
            const skuRes = await fetch(req.url, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization") || "" },
              body: JSON.stringify({ product_name, supplier, style_number, colour, serpapi_key, mode: "sku" }),
            });
            if (skuRes.ok) return new Response(skuRes.body, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }

          return new Response(JSON.stringify({
            search_query: searchQuery,
            source: "serpapi",
            mode: searchMode,
            brand_au_domain: brandSiteOperator,
            results: results.slice(0, 8),
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        console.log("SerpApi returned no shopping_results, falling back to Firecrawl");
      } catch (e) {
        console.warn("SerpApi failed, falling back to Firecrawl:", e);
      }
    }

    if (!FIRECRAWL_API_KEY) {
      return new Response(JSON.stringify({ error: "Neither SERPAPI_KEY nor FIRECRAWL_API_KEY is configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Real Google search via Firecrawl (in parallel with direct probe) ──
    const [fcRes, directUrl] = await Promise.all([
      fetch(`${FIRECRAWL_API}/search`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: searchQuery,
          limit: 10,
          country: "au",
          lang: "en",
        }),
      }),
      directProbe,
    ]);

    const fcData = await fcRes.json();
    if (!fcRes.ok) {
      throw new Error(`Firecrawl search failed [${fcRes.status}]: ${JSON.stringify(fcData)}`);
    }

    const rawResults: any[] = Array.isArray(fcData?.data)
      ? fcData.data
      : Array.isArray(fcData?.web)
        ? fcData.web
        : Array.isArray(fcData?.data?.web)
          ? fcData.data.web
          : [];

    let results = rawResults
      .map((r) => {
        const url: string = r.url || r.link || "";
        if (!url) return null;
        let domain = "";
        try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
        const meta = classifyDomain(domain, supplier);
        return {
          title: r.title || r.name || domain,
          url,
          domain,
          snippet: r.description || r.snippet || "",
          is_australian: meta.au,
          is_official_brand: meta.is_official_brand,
          retailer_type: meta.type,
        };
      })
      .filter((r) => r && !isNoiseUrl(r.url)) as any[];

    // Prepend direct brand URL if probe succeeded
    if (directUrl) {
      let domain = "";
      try { domain = new URL(directUrl).hostname.replace(/^www\./, ""); } catch {}
      const meta = classifyDomain(domain, supplier);
      const alreadyPresent = results.some((r: any) => r.url === directUrl);
      if (!alreadyPresent) {
        results = [{
          title: `${supplier || "Brand"} — ${cleanProductName}`,
          url: directUrl,
          domain,
          snippet: "Direct brand product URL",
          is_australian: meta.au,
          is_official_brand: true,
          retailer_type: "brand_direct",
          is_direct_brand_url: true,
        }, ...results];
      }
    }

    // Auto-fallback for Firecrawl path too: retry with SKU if no product page
    const hasProductPageFc = results.some((r: any) => isProductUrl(r.url));
    if (!hasProductPageFc && searchMode === "primary" && style_number) {
      const skuRes = await fetch(req.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization") || "" },
        body: JSON.stringify({ product_name, supplier, style_number, colour, serpapi_key, mode: "sku" }),
      });
      if (skuRes.ok) return new Response(skuRes.body, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Sort: direct brand URL first, then product pages, AU domains, official brands
    results.sort((a, b) => {
      const score = (x: any) =>
        (x.is_direct_brand_url ? 100 : 0) +
        (isProductUrl(x.url) ? 5 : 0) +
        (isCollectionUrl(x.url) ? -3 : 0) +
        (x.is_official_brand ? 3 : 0) +
        (x.is_australian ? 1 : 0);
      return score(b) - score(a);
    });

    return new Response(JSON.stringify({
      search_query: searchQuery,
      source: "firecrawl",
      mode: searchMode,
      brand_au_domain: brandSiteOperator,
      results: results.slice(0, 8),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("price-lookup-search error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
