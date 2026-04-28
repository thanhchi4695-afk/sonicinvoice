// ══════════════════════════════════════════════════════════════
// supplier-website-rrp
//
// Looks up a single product's RRP/image/description with this
// priority chain:
//
//   1. Cached scrape in `supplier_website_prices` (per-user
//      `supplier_profiles.website_pricing_enabled = true`)
//   2. NEW — registry fallback: live `products.json` fetch from
//      a brand listed in `supplier_websites` (shared 35-brand
//      seed; users with NO supplier_profile still get website
//      RRPs because the registry is pre-populated)
//   3. Returns { found:false } so the caller can fall through
//      to Google / markup formula.
//
// The registry fetch is best-effort and time-limited; failures
// are logged to `supplier_websites.scrape_failure_count`. Brand
// names that don't match anything in the registry are recorded
// in `brand_lookup_misses` so the user knows what to add next.
// ══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function slugify(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normaliseBrand(raw: string): string {
  return (raw || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\+/g, "plus")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlToText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
}

interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string;
  vendor: string;
  product_type: string;
  created_at: string;
  images: { src: string; alt?: string | null }[];
  variants: { price: string; compare_at_price: string | null; sku?: string | null; title?: string | null }[];
  tags?: string[] | string;
}

// ── Abbreviation expansion (general fashion / footwear / accessories) ──
// Used to "expand" invoice tokens before matching against retailer titles.
// Covers swimwear, apparel, footwear, lingerie, accessories, beauty.
// e.g. invoice "KOKOMO LLINE OP"      → [kokomo, longline, one, piece]
//      invoice "DAISY MIDI DRS S/S"    → [daisy, midi, dress, short, sleeve]
//      invoice "BLK LTHR BT SZ8"       → [black, leather, boot, size, 8]
const ABBREV_MAP: Record<string, string> = {
  // Swimwear / lingerie
  "lline": "longline", "llline": "longline", "ll": "longline",
  "op": "one piece", "1pc": "one piece", "onepc": "one piece",
  "uw": "underwire", "halt": "halter", "tie": "tieside",
  "bd": "bandeau", "boost": "booster", "brz": "bralette",
  // Apparel — silhouettes
  "drs": "dress", "dr": "dress", "skt": "skirt", "shrt": "shirt",
  "blz": "blazer", "jkt": "jacket", "jckt": "jacket", "cdgn": "cardigan",
  "swtr": "sweater", "swt": "sweat", "hd": "hoodie", "tshirt": "t-shirt",
  "tee": "t-shirt", "ts": "t-shirt", "tnk": "tank", "cami": "camisole",
  "jmpst": "jumpsuit", "jmps": "jumpsuit", "rmpr": "romper",
  "plyst": "playsuit", "pls": "playsuit", "ovrl": "overall",
  "shrts": "shorts", "trsr": "trouser", "trsrs": "trouser",
  "lggn": "legging", "lggns": "legging", "jn": "jean", "jns": "jean",
  // Footwear
  "bt": "boot", "bts": "boot", "snkr": "sneaker", "sndl": "sandal",
  "snd": "sandal", "mcsn": "moccasin", "lfr": "loafer", "hl": "heel",
  // Accessories / bags
  "bg": "bag", "bp": "backpack", "ttbg": "tote", "clt": "clutch",
  "wlt": "wallet", "blt": "belt", "scrf": "scarf", "ht": "hat",
  // Length / cut / fit
  "mdi": "midi", "mxi": "maxi", "mn": "mini", "krt": "crop",
  "crp": "crop", "ovsz": "oversized", "rlx": "relaxed", "slm": "slim",
  "stra": "straight", "wd": "wide", "tprd": "tapered", "rgr": "regular",
  "reg": "regular", "tll": "tall", "ptt": "petite",
  // Sleeves / necklines
  "ss": "short sleeve", "ls": "long sleeve", "sl": "sleeveless",
  "v-nk": "v neck", "vnk": "v neck", "crwn": "crew neck", "scp": "scoop",
  // Waist (also kept from swimwear)
  "uh": "ultra high", "uhw": "ultra high", "hw": "high waist",
  "mw": "mid waist", "lw": "low waist",
  // Materials / colours shorthand
  "ltr": "leather", "lthr": "leather", "sd": "suede", "lin": "linen",
  "lnn": "linen", "ctn": "cotton", "wl": "wool", "csh": "cashmere",
  "vlv": "velvet", "stn": "satin", "slk": "silk", "dnm": "denim",
  "chf": "chiffon", "lc": "lace",
  "blk": "black", "wht": "white", "nvy": "navy", "gry": "grey",
  "grn": "green", "brn": "brown", "crm": "cream", "bge": "beige",
  "ntl": "natural", "chrcl": "charcoal",
  // Generic noun overrides (kept from swimwear matcher)
  "pant": "bottom", "pants": "bottom", "bra": "top",
};

function expandAbbreviations(name: string): string {
  return name
    .toLowerCase()
    // Normalise punctuation: "D.E" → "d/e", "D.DD" → "d/dd", "EFG" stays
    .replace(/\bd\.e\b/g, "d/e")
    .replace(/\bd\.dd\b/g, "d/dd")
    .replace(/\bc\.dd\b/g, "c/dd")
    .replace(/\be-f\b/g, "e/f")
    .replace(/[.,]/g, " ")
    .split(/\s+/)
    .map((w) => ABBREV_MAP[w] || w)
    .join(" ");
}

/** Extract a supplier style code from styleNumber or name.
 *  Accepts common patterns across brands:
 *    BRA403KKM, M785RCE, PANT321KKM   (alpha+digits+alpha — Baku, Seafolly)
 *    AB-12345, AW24-1234              (hyphenated season codes)
 *    1234567 / 12345-678              (digit-only SKUs — common in apparel)
 *    SKU.123.ABC                      (dotted)
 *  Returns up to 5 distinct uppercase codes. */
function extractStyleCodes(s: string): string[] {
  if (!s) return [];
  const out = new Set<string>();
  const patterns = [
    /\b([A-Z]{2,6}\d{2,5}[A-Z]{0,5})\b/gi,  // alpha-digit-alpha
    /\b([A-Z]{1,4}[-.]?\d{2,6}[-.]?[A-Z0-9]{0,6})\b/gi, // hyphen/dot variants
    /\b(\d{5,8})\b/g, // bare numeric SKUs
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
      const code = m[1].toUpperCase().replace(/[.\-]/g, "");
      if (code.length >= 4) out.add(code);
      if (out.size >= 5) break;
    }
  }
  return [...out];
}

/**
 * Generate fuzzy-tail variants of a colour string.
 * Invoices often append a description word (e.g. "Mosaique Green",
 * "Jaguar Jungle Orange") that the website variant doesn't have.
 * We try the full string first, then progressively strip the last word.
 *   "Jaguar Jungle Orange" → ["jaguar jungle orange", "jaguar jungle", "jaguar"]
 */
function colourVariants(colour: string): string[] {
  const c = (colour || "").toLowerCase().trim().replace(/\s+/g, " ");
  if (!c) return [];
  const parts = c.split(" ");
  const out: string[] = [];
  for (let i = parts.length; i >= 1; i--) {
    out.push(parts.slice(0, i).join(" "));
  }
  return out;
}

/** Build a single haystack string per product (title + handle + type + tags + image filenames + variant SKUs). */
function productHaystack(p: ShopifyProduct): string {
  const tags = Array.isArray(p.tags) ? p.tags.join(" ") : (p.tags || "");
  const imgs = (p.images || []).map((i) => `${i.src || ""} ${i.alt || ""}`).join(" ");
  const skus = (p.variants || []).map((v) => v.sku || "").join(" ");
  return `${p.title} ${p.handle} ${p.product_type} ${p.vendor} ${tags} ${imgs} ${skus}`.toLowerCase();
}

function findProductByNameAndColour(
  products: ShopifyProduct[],
  name: string,
  colour?: string,
  styleNumber?: string,
): ShopifyProduct | null {
  if (!products?.length) return null;

  // ── Step 0: STYLE-CODE MATCH (highest precision) ──
  // Supplier codes (e.g. BRA403KKM, M785RCE, PANT512KKM) appear in
  // various places depending on the brand:
  //   • Title / handle / body_html / variant SKUs (most precise)
  //   • Tags
  //   • Image filenames in the CDN URL or alt text (less precise —
  //     brands like Baku reuse a single lookbook photo across the
  //     bra+bottom pair, so the same image filename references
  //     multiple style codes).
  //
  // To avoid false positives from shared lookbook images we:
  //   1. Try the precise fields first.
  //   2. Fall back to image filenames, but only after filtering by
  //      SKU-prefix → silhouette (BRA* → bra/top, PANT* → bottom,
  //      M*/MAIL* → one-piece/swimsuit).
  const codes = [
    ...extractStyleCodes(styleNumber || ""),
    ...extractStyleCodes(name),
  ];
  const silhouetteFilter = (code: string) => (p: ShopifyProduct) => {
    const t = `${p.title} ${p.product_type}`.toLowerCase();
    const u = code.toUpperCase();
    if (u.startsWith("PANT")) return /\b(bottom|brief|short|pant)\b/.test(t);
    if (u.startsWith("BRA")) return /\b(bra|top|halter|bandeau|bralette)\b/.test(t);
    if (/^M\d/.test(u) || u.startsWith("MAIL") || u.startsWith("OP")) {
      return /\b(one[\s-]?piece|swimsuit|maillot)\b/.test(t);
    }
    return true;
  };
  if (codes.length) {
    for (const code of codes) {
      const codeLow = code.toLowerCase();
      // 0a — precise fields (title, handle, body, tags, SKU)
      const precise = products.find((p) => {
        const tags = Array.isArray(p.tags) ? p.tags.join(" ") : (p.tags || "");
        const skus = (p.variants || []).map((v) => v.sku || "").join(" ");
        const hay = `${p.title} ${p.handle} ${p.body_html} ${tags} ${skus}`.toLowerCase();
        return hay.includes(codeLow);
      });
      if (precise) return precise;
      // 0b — image-filename match, narrowed by silhouette
      const imgMatches = products.filter((p) => {
        const imgs = (p.images || []).map((i) => `${i.src || ""} ${i.alt || ""}`).join(" ").toLowerCase();
        return imgs.includes(codeLow);
      });
      if (imgMatches.length === 1) return imgMatches[0];
      if (imgMatches.length > 1) {
        const filtered = imgMatches.filter(silhouetteFilter(code));
        if (filtered.length === 1) return filtered[0];
        // If still ambiguous, fall through to token matcher rather than
        // returning a wrong product.
      }
    }
  }

  const expanded = expandAbbreviations(name);
  const STOP = new Set(["the", "a", "an", "and", "or", "of", "in", "on", "for", "with", "cup"]);
  const tokens = expanded
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9/]/g, ""))
    .filter((t) => t.length >= 2 && !STOP.has(t));

  if (!tokens.length) return null;

  // First token is treated as the "anchor" (usually the story/collection
  // word like KOKOMO, ROCOCCO, CAPRI). Anchor MUST appear in title or product_type.
  const anchor = tokens[0];

  // ── Step 1a: Strict — every token in title ──
  let candidates = products.filter((p) => {
    const t = p.title.toLowerCase();
    return tokens.every((tok) => t.includes(tok));
  });

  // ── Step 1b: Anchor + ≥50% other tokens in title|product_type|handle ──
  if (candidates.length === 0) {
    const otherTokens = tokens.slice(1);
    const minOverlap = Math.max(1, Math.ceil(otherTokens.length * 0.5));
    candidates = products.filter((p) => {
      const hay = `${p.title} ${p.product_type} ${p.handle}`.toLowerCase();
      if (!hay.includes(anchor)) return false;
      if (!otherTokens.length) return true;
      const hits = otherTokens.filter((tok) => hay.includes(tok)).length;
      return hits >= minOverlap;
    });
  }

  // ── Step 1c: Anchor only (story-level fallback) ──
  if (candidates.length === 0) {
    candidates = products.filter((p) => {
      const hay = `${p.title} ${p.product_type}`.toLowerCase();
      return hay.includes(anchor);
    });
  }

  if (candidates.length === 0) return null;

  // ── Step 1d: silhouette filter from supplier code prefix ──
  // (PANT* → bottom, BRA* → bra/top, M* → one-piece). This disambiguates
  // when the token matcher returns several products from the same story.
  if (codes.length && candidates.length > 1) {
    const filtered = candidates.filter(silhouetteFilter(codes[0]));
    if (filtered.length) candidates = filtered;
  }

  if (candidates.length === 1) return candidates[0];

  // ── Step 2: narrow by colour ──
  for (const variant of colourVariants(colour || "")) {
    const variantTokens = variant.split(/\s+/).filter((t) => t.length >= 3);
    if (!variantTokens.length) continue;
    const colourMatch = candidates.find((p) => {
      const hay = productHaystack(p);
      return variantTokens.every((t) => hay.includes(t));
    });
    if (colourMatch) return colourMatch;
  }

  // ── Step 3: most-recently created ──
  candidates = [...candidates].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  return candidates[0];
}

/** Fetch up to `maxPages` pages of products.json, accumulating results. */
async function fetchAllProducts(endpoint: string, maxPages = 4): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  // Endpoint may already include ?limit=...; ensure we can append &page=
  const sep = endpoint.includes("?") ? "&" : "?";
  for (let page = 1; page <= maxPages; page++) {
    const url = `${endpoint}${sep}page=${page}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { "User-Agent": "SonicInvoice/1.0 (+https://sonicinvoices.com)" },
      });
      if (!res.ok) break;
      const data = await res.json();
      const ps = (data?.products || []) as ShopifyProduct[];
      if (!ps.length) break;
      all.push(...ps);
      if (ps.length < 50) break; // last page
    } catch (e) {
      console.warn("[supplier-website-rrp] page fetch failed:", url, (e as Error).message);
      break;
    } finally {
      clearTimeout(timer);
    }
  }
  return all;
}

async function fetchFromRegistry(
  endpoint: string,
  styleName: string,
  colour?: string,
  styleNumber?: string,
): Promise<
  | {
      price: number;
      product_url: string;
      product_title: string;
      image_url: string;
      description: string;
      match_method?: string;
    }
  | null
> {
  try {
    const products = await fetchAllProducts(endpoint, 4);
    if (!products.length) return null;
    const match = findProductByNameAndColour(products, styleName, colour, styleNumber);
    if (!match) return null;
    const variantPrice = parseFloat(
      match.variants?.[0]?.compare_at_price || match.variants?.[0]?.price || "0",
    );
    if (!variantPrice || variantPrice <= 0) return null;
    const origin = endpoint.replace(/\/products\.json.*$/, "");
    return {
      price: variantPrice,
      product_url: `${origin}/products/${match.handle}`,
      product_title: match.title,
      image_url: match.images?.[0]?.src || "",
      description: htmlToText(match.body_html || ""),
    };
  } catch (e) {
    console.warn("[supplier-website-rrp] registry fetch failed:", endpoint, (e as Error).message);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorised" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const vendor = (body.vendor as string | undefined)?.trim();
    const styleName = (body.style_name as string | undefined)?.trim();
    const styleNumber = (body.style_number as string | undefined)?.trim();
    const colour = (body.colour as string | undefined)?.trim();

    if (!vendor || !styleName) {
      return new Response(
        JSON.stringify({ error: "vendor and style_name required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ── 1. Cached path: supplier_profiles + supplier_website_prices ──
    const { data: profiles } = await supabase
      .from("supplier_profiles")
      .select("id, supplier_name, website_pricing_enabled, website_last_scraped_at")
      .eq("user_id", userId)
      .ilike("supplier_name", vendor);

    const profile = (profiles || []).find((p) => p.website_pricing_enabled);
    if (profile) {
      const handle = slugify(styleName);
      const titleLower = styleName.toLowerCase().trim();
      const STOP_WORDS = new Set(["the", "a", "an", "and", "or", "of", "in", "on", "for", "with"]);
      const tokens = titleLower
        .split(/\s+/)
        .map((t) => t.replace(/[^a-z0-9]/g, ""))
        .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));

      const allTokensMatch = (title: string): boolean => {
        const t = (title || "").toLowerCase();
        return tokens.every((tok) => t.includes(tok));
      };

      let { data: rows } = await supabase
        .from("supplier_website_prices")
        .select("product_title, colour, size, price, product_url, handle")
        .eq("supplier_profile_id", profile.id)
        .eq("user_id", userId)
        .eq("handle", handle);

      let matchMethod: "handle" | "all_tokens" | "style_number" | "fuzzy" = "handle";

      if (!rows?.length && tokens.length) {
        const { data: rows2 } = await supabase
          .from("supplier_website_prices")
          .select("product_title, colour, size, price, product_url, handle")
          .eq("supplier_profile_id", profile.id)
          .eq("user_id", userId)
          .ilike("product_title", `%${tokens[0]}%`)
          .limit(200);
        const filtered = (rows2 || []).filter((r) => allTokensMatch(r.product_title));
        if (filtered.length) {
          rows = filtered;
          matchMethod = "all_tokens";
        }
      }

      if (!rows?.length && styleNumber) {
        const { data: rows3 } = await supabase
          .from("supplier_website_prices")
          .select("product_title, colour, size, price, product_url, handle")
          .eq("supplier_profile_id", profile.id)
          .eq("user_id", userId)
          .ilike("product_title", `%${styleNumber}%`)
          .limit(50);
        rows = rows3 || [];
        matchMethod = "style_number";
      }

      if (rows?.length) {
        let candidates = rows;
        if (colour) {
          // Fuzzy-tail colour matching: try the full colour first, then strip
          // the trailing word and retry. Handles invoice noise like
          // "Mosaique Green" → website variant "Mosaique".
          for (const variant of colourVariants(colour)) {
            const colourMatches = rows.filter((r) =>
              (r.colour || "").toLowerCase().includes(variant) ||
              (r.product_title || "").toLowerCase().includes(variant)
            );
            if (colourMatches.length) {
              candidates = colourMatches;
              break;
            }
          }
        }
        const best = candidates.reduce((a, b) =>
          Number(a.price) >= Number(b.price) ? a : b,
        );
        return new Response(
          JSON.stringify({
            found: true,
            price: Number(best.price),
            product_url: best.product_url,
            product_title: best.product_title,
            colour: best.colour,
            size: best.size,
            last_scraped_at: profile.website_last_scraped_at,
            supplier_profile_id: profile.id,
            match_method: matchMethod,
            confidence: matchMethod === "handle" ? 99 : matchMethod === "all_tokens" ? 90 : 75,
            source: "cached_profile",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // ── 2a. User's own brand_database takes priority over global registry ──
    const norm = normaliseBrand(vendor);
    let registry:
      | {
          id: string;
          brand_name_display: string;
          website_url: string | null;
          is_shopify: boolean;
          products_json_endpoint: string | null;
          enrichment_enabled: boolean;
          scrape_failure_count?: number;
          source?: "user" | "global";
        }
      | null = null;

    const { data: userBrand } = await supabase
      .from("brand_database")
      .select("id, canonical_brand_name, brand_name, website_url, is_shopify, products_json_endpoint, enrichment_enabled")
      .eq("user_id", userId)
      .or(`brand_name.ilike.${vendor},canonical_brand_name.ilike.${vendor}`)
      .maybeSingle();

    if (userBrand) {
      registry = {
        id: userBrand.id,
        brand_name_display: userBrand.canonical_brand_name || userBrand.brand_name,
        website_url: userBrand.website_url,
        is_shopify: userBrand.is_shopify,
        products_json_endpoint: userBrand.products_json_endpoint,
        enrichment_enabled: userBrand.enrichment_enabled,
        source: "user",
      };
    }

    // ── 2b. Global supplier_websites registry fallback ──────────────
    if (!registry) {
      const { data: globalReg } = await supabase
        .from("supplier_websites")
        .select("id, brand_name_display, website_url, is_shopify, products_json_endpoint, enrichment_enabled, scrape_failure_count")
        .eq("brand_name_normalised", norm)
        .maybeSingle();
      if (globalReg) registry = { ...globalReg, source: "global" };

      // Token fallback (e.g. "Walnut" → "walnut melbourne")
      if (!registry && norm) {
        const firstToken = norm.split(" ")[0];
        if (firstToken.length >= 3) {
          const { data: fuzzy } = await supabase
            .from("supplier_websites")
            .select("id, brand_name_display, website_url, is_shopify, products_json_endpoint, enrichment_enabled, scrape_failure_count")
            .ilike("brand_name_normalised", `%${firstToken}%`)
            .limit(1);
          if (fuzzy?.length) registry = { ...fuzzy[0], source: "global" };
        }
      }
    }

    if (registry?.enrichment_enabled && registry.is_shopify && registry.products_json_endpoint) {
      const liveResult = await fetchFromRegistry(
        registry.products_json_endpoint,
        styleName,
        colour,
        styleNumber,
      );
      if (liveResult) {
        return new Response(
          JSON.stringify({
            found: true,
            price: liveResult.price,
            product_url: liveResult.product_url,
            product_title: liveResult.product_title,
            image_url: liveResult.image_url,
            description: liveResult.description,
            colour: colour || null,
            match_method: "registry_live",
            confidence: 92,
            source: "registry_live",
            registry_brand: registry.brand_name_display,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      // Live fetch returned nothing — increment failure counter (only for global registry rows)
      if (registry.source !== "user") {
        await supabase
          .from("supplier_websites")
          .update({ scrape_failure_count: (registry as { scrape_failure_count?: number }).scrape_failure_count
            ? (registry as { scrape_failure_count: number }).scrape_failure_count + 1
            : 1 })
          .eq("id", registry.id);
      }
    }

    // ── 3. Not in registry — log the miss so the user can add it ──
    if (!registry) {
      // Upsert-style: try update count first, else insert
      const { data: existing } = await supabase
        .from("brand_lookup_misses")
        .select("id, occurrence_count")
        .eq("user_id", userId)
        .eq("normalised", norm)
        .maybeSingle();
      if (existing) {
        await supabase
          .from("brand_lookup_misses")
          .update({
            occurrence_count: (existing.occurrence_count || 0) + 1,
            occurred_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      } else {
        await supabase.from("brand_lookup_misses").insert({
          user_id: userId,
          raw_brand: vendor,
          normalised: norm,
        });
      }
    }

    return new Response(
      JSON.stringify({
        found: false,
        reason: registry
          ? "Brand registered but no matching product on website"
          : "Brand not in supplier_websites registry",
        searched_brand: vendor,
        normalised: norm,
        registry_match: registry?.brand_name_display ?? null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[supplier-website-rrp] error:", err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
