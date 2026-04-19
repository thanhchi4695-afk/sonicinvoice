import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FIRECRAWL_API = "https://api.firecrawl.dev/v2";

// Known brand → AU domain map for direct URL probing (point 3)
const BRAND_DOMAINS: Record<string, string> = {
  seafolly: "seafolly.com.au",
  baku: "bakuswimwear.com.au",
  "bond-eye": "bond-eyeswim.com",
  bondeye: "bond-eyeswim.com",
  jets: "jets.com.au",
  zimmermann: "zimmermann.com",
  jantzen: "jantzen.com.au",
  sunseeker: "sunseeker.com.au",
  "sea level": "sealevelaustralia.com",
};

function slugify(s: string): string {
  return s.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function isCollectionUrl(url: string): boolean {
  const u = url.toLowerCase();
  return /\/collections?\//.test(u) || /\/categor(y|ies)\//.test(u) || /\/search\//.test(u);
}

function isProductUrl(url: string): boolean {
  const u = url.toLowerCase();
  return /\/products?\//.test(u) || /\/p\//.test(u);
}

async function tryDirectBrandUrl(brand: string, productName: string): Promise<string | null> {
  const key = brand.toLowerCase().trim();
  const domain = BRAND_DOMAINS[key];
  if (!domain) return null;
  const slug = slugify(productName);
  if (!slug) return null;
  const url = `https://${domain}/products/${slug}`;
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(5000) });
    if (res.ok) return url;
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
  "baku.com.au": { type: "brand_direct", au: true },
  "sunseeker.com.au": { type: "brand_direct", au: true },
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
  const isAu = d.endsWith(".com.au") || d.endsWith(".au");
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

    // ── Query construction by mode ──
    // mode = "primary" (default) → product-page query with collection exclusions
    // mode = "sku"               → fallback by style number
    // mode = "direct"            → only attempt direct brand-URL probe (no search)
    const searchMode: "primary" | "sku" | "direct" = mode === "sku" ? "sku" : mode === "direct" ? "direct" : "primary";

    let searchQuery = "";
    if (searchMode === "primary") {
      const parts = [cleanProductName, supplier, colour].filter(Boolean);
      searchQuery = `${parts.join(" ")} Australia -collection -collections -category -categories`;
    } else if (searchMode === "sku") {
      const parts = [style_number, supplier].filter(Boolean);
      searchQuery = parts.length > 0
        ? `${parts.join(" ")} Australia`
        : `${cleanProductName} ${supplier || ""} Australia`.trim();
    }

    // ── Mode: direct brand URL probe (point 3) ──
    if (searchMode === "direct") {
      const directUrl = supplier ? await tryDirectBrandUrl(supplier, cleanProductName) : null;
      if (directUrl) {
        let domain = "";
        try { domain = new URL(directUrl).hostname.replace(/^www\./, ""); } catch {}
        const meta = classifyDomain(domain, supplier);
        return new Response(JSON.stringify({
          search_query: `direct: ${directUrl}`,
          source: "direct_url",
          results: [{
            title: `${supplier} — ${cleanProductName}`,
            url: directUrl,
            domain,
            snippet: "Direct brand product URL",
            is_australian: meta.au,
            is_official_brand: true,
            retailer_type: "brand_direct",
          }],
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        search_query: "direct probe failed",
        source: "direct_url",
        results: [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

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
        const spRes = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
        const spData = await spRes.json();
        if (spRes.ok && Array.isArray(spData?.shopping_results) && spData.shopping_results.length > 0) {
          const results = spData.shopping_results.slice(0, 10).map((r: any) => {
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
          }).filter((r: any) => r.url);

          results.sort((a: any, b: any) => {
            const score = (x: any) =>
              (isProductUrl(x.url) ? 5 : 0) +
              (isCollectionUrl(x.url) ? -3 : 0) +
              (x.is_official_brand ? 3 : 0) +
              (x.is_australian ? 1 : 0);
            return score(b) - score(a);
          });

          // Auto-fallback: if every result is a collection page, retry with SKU query
          const allCollections = results.length > 0 && results.every((r: any) => isCollectionUrl(r.url));
          if (allCollections && searchMode === "primary" && style_number) {
            // Recurse via internal call: switch to SKU mode
            const skuRes = await fetch(req.url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ product_name, supplier, style_number, colour, serpapi_key, mode: "sku" }),
            });
            if (skuRes.ok) return new Response(skuRes.body, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }

          return new Response(JSON.stringify({
            search_query: searchQuery,
            source: "serpapi",
            mode: searchMode,
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

    // ── Real Google search via Firecrawl ──
    const fcRes = await fetch(`${FIRECRAWL_API}/search`, {
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
    });

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

    const results = rawResults
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
      .filter(Boolean) as any[];

    // Sort: product pages first, collection pages last
    results.sort((a, b) => {
      const score = (x: any) =>
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
