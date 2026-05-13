// supabase/functions/seo-collection-detector/index.ts
// Phase B - Colour, Occasion, Trend & Special Collection Detector (White Fox style)
// Scans the user's product corpus for nested-collection opportunities and writes
// suggestions into public.collection_suggestions.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

// ---- Vocabularies ----------------------------------------------------------

const COLOURS = [
  "black","white","ivory","cream","beige","nude","tan","brown","chocolate","camel",
  "grey","gray","charcoal","silver","navy","blue","cobalt","teal","mint","sage","olive",
  "green","emerald","yellow","mustard","gold","orange","coral","rust","red","burgundy",
  "wine","pink","blush","rose","fuchsia","purple","lilac","lavender","print","floral",
];

const OCCASIONS: Record<string, string[]> = {
  festival: ["festival","coachella","rave"],
  resort: ["resort","vacation","holiday","cruise"],
  wedding: ["wedding","bridesmaid","bridal"],
  party: ["party","clubwear","going-out","night-out"],
  workwear: ["work","office","corporate"],
  weekend: ["weekend","casual","everyday"],
  race_day: ["race day","spring racing","carnival"],
};

const TRENDS: Record<string, string[]> = {
  y2k: ["y2k","00s"],
  coastal_grandmother: ["coastal grandmother","coastal-grandma"],
  quiet_luxury: ["quiet luxury","old money"],
  balletcore: ["balletcore","ballet core"],
  westerncore: ["western","cowgirl"],
};

// ACCESSORIES vocabulary — Louenhide model
const BAG_TYPES: Record<string, string[]> = {
  crossbody: ["crossbody","cross body","cross-body"],
  shoulder: ["shoulder bag","shoulder-bag"],
  tote: ["tote"],
  clutch: ["clutch"],
  backpack: ["backpack"],
  sling: ["sling","bum bag","belt bag","fanny"],
  bucket: ["bucket bag"],
  hobo: ["hobo"],
  satchel: ["satchel"],
  weekender: ["weekender","duffle"],
  laptop_bag: ["laptop bag","laptop-friendly","laptop sleeve"],
  cosmetic_bag: ["cosmetic bag","makeup bag","toiletry"],
  beach_bag: ["beach bag","straw bag"],
  wallet: ["wallet","cardholder","card holder","purse"],
};

const ACC_FEATURES: Record<string, string[]> = {
  rfid: ["rfid","rfid blocking","rfid-blocking"],
  vegan_leather: ["vegan leather","vegan-leather"],
  multi_wear: ["multi-wear","multi wear","convertible"],
  laptop_friendly: ["13-inch","13 inch","14-inch","15-inch","16-inch","laptop"],
  waterproof: ["waterproof","water-resistant","water resistant"],
};

const ACC_OCCASIONS: Record<string, string[]> = {
  work: ["work bag","office","corporate"],
  uni: ["uni","university","student","campus"],
  travel: ["travel","carry-on","carry on","weekender"],
  evening: ["evening","cocktail","gala","formal"],
  beach: ["beach","poolside","resort"],
};

// Niche keyword blocklist (Louenhide/Megantic Innovation 2)
const BROAD_BLOCKLIST = new Set(["bags","accessories","wallets","handbags","online shopping","jewellery","jewelry","earrings","necklaces","bracelets","rings"]);
function isAccessoriesVertical(productType: string): boolean {
  const t = productType.toLowerCase();
  return /bag|wallet|clutch|backpack|tote|crossbody|purse|accessor/.test(t);
}

// JEWELLERY vocabulary — Girls With Gems model
const JEWELLERY_BRANDS = [
  "amber sceats","by charlotte","mayol","arms of eve","emma pills","avant studio",
  "noah the label","heaven mayhem","porter","lana wilkinson","midsummer star","olga de polga",
];
const JEWELLERY_TYPES: Record<string, string[]> = {
  earrings: ["earring","earrings","hoop","hoops","stud","studs","drop earring","huggie"],
  necklaces: ["necklace","pendant","chain","choker","layering"],
  bracelets: ["bracelet","bangle","cuff","tennis"],
  rings: ["ring","signet","stacker","stacking ring","band"],
  anklets: ["anklet"],
  charms: ["charm"],
  sets: ["jewellery set","jewelry set","matching set"],
};
const JEWELLERY_METALS: Record<string, string[]> = {
  gold: ["gold filled","14k gold","18k gold"," gold "],
  silver: ["sterling silver","silver","925"],
  rose_gold: ["rose gold"],
  vermeil: ["vermeil"],
  pearl: ["pearl","freshwater pearl"],
};
const JEWELLERY_GEMSTONES: Record<string, string[]> = {
  diamond: ["diamond"], moonstone: ["moonstone"], turquoise: ["turquoise"],
  opal: ["opal"], topaz: ["topaz"], amethyst: ["amethyst"], cz: ["cubic zirconia"," cz "],
};
const GIFT_RECIPIENTS: Record<string, string[]> = {
  her: ["for her","womens","women's"],
  mum: ["for mum","mothers day","mother's day"],
  bridesmaid: ["bridesmaid","bridal party"],
  him: ["for him","mens","men's"],
};
const GIFT_OCCASIONS: Record<string, string[]> = {
  birthday: ["birthday"],
  christmas: ["christmas","xmas"],
  valentines: ["valentine","valentines"],
  mothers_day: ["mothers day","mother's day"],
  anniversary: ["anniversary"],
  graduation: ["graduation"],
  bridal: ["bridal","wedding"],
};
const GIFT_SIGNALS = ["gift","gift box","giftable","gift-ready","gift wrap","gift packaging"];

function isJewelleryVertical(productType: string, vendor: string, title: string): boolean {
  const t = (productType || "").toLowerCase();
  const v = (vendor || "").toLowerCase();
  const ti = (title || "").toLowerCase();
  if (JEWELLERY_BRANDS.some((b) => v.includes(b))) return true;
  if (/jewellery|jewelry|earring|necklace|bracelet|ring|bangle|pendant|hoop|stud|chain|anklet|charm/.test(t)) return true;
  if (/\b(earring|earrings|necklace|bracelet|bangle|pendant|hoop|stud|chain|anklet)\b/.test(ti)) return true;
  return false;
}

// ---- Helpers ---------------------------------------------------------------

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function detectIn(text: string, vocab: string[]): string[] {
  const t = text.toLowerCase();
  return vocab.filter((w) => t.includes(w));
}

function detectMap(text: string, vocab: Record<string, string[]>): string[] {
  const t = text.toLowerCase();
  const hits: string[] = [];
  for (const [key, words] of Object.entries(vocab)) {
    if (words.some((w) => t.includes(w))) hits.push(key);
  }
  return hits;
}

// ---- Main ------------------------------------------------------------------

interface RunBody {
  user_id?: string;
  brand_id?: string;
  min_products?: number; // threshold for proposing a nested collection
  dry_run?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body: RunBody = await req.json().catch(() => ({}));
    const minProducts = body.min_products ?? 3;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve user from JWT if not provided
    let userId = body.user_id;
    if (!userId) {
      const auth = req.headers.get("Authorization") ?? "";
      const token = auth.replace(/^Bearer\s+/i, "");
      if (token) {
        const { data: u } = await supabase.auth.getUser(token);
        userId = u?.user?.id;
      }
    }
    if (!userId) {
      return new Response(JSON.stringify({ error: "user_id required" }), { status: 400, headers: corsHeaders });
    }

    // Pull products (cap to avoid timeouts)
    const { data: products, error: prodErr } = await supabase
      .from("products")
      .select("id,title,product_type,vendor,description")
      .eq("user_id", userId)
      .limit(2000);

    if (prodErr) throw prodErr;
    const rows = products ?? [];

    // Pull restock signals from catalog cache (optional)
    const { data: cache } = await supabase
      .from("product_catalog_cache")
      .select("platform_product_id,product_title,vendor,restock_status")
      .eq("user_id", userId)
      .limit(2000);
    const restockByTitle = new Map<string, string>();
    for (const c of cache ?? []) {
      if (c.product_title && c.restock_status) {
        restockByTitle.set(c.product_title.toLowerCase(), c.restock_status);
      }
    }

    // Aggregators: parent (product_type) -> child (colour|occasion|trend) -> count
    type Bucket = { count: number; sample_ids: string[] };
    const buckets: Record<string, Record<string, Bucket>> = {};

    function bump(parent: string, child: string, productId: string) {
      if (!parent || !child) return;
      buckets[parent] ??= {};
      buckets[parent][child] ??= { count: 0, sample_ids: [] };
      const b = buckets[parent][child];
      b.count++;
      if (b.sample_ids.length < 5) b.sample_ids.push(productId);
    }

    // Gifting aggregator: recipient/occasion/price/signal -> { count, sample_ids }
    type GiftBucket = { count: number; sample_ids: string[]; kind: string; value: string; price_band?: string };
    const giftBuckets: Record<string, GiftBucket> = {};
    function gbump(kind: string, value: string, productId: string, price_band?: string) {
      const key = `${kind}:${value}${price_band ? `|${price_band}` : ""}`;
      giftBuckets[key] ??= { count: 0, sample_ids: [], kind, value, price_band };
      giftBuckets[key].count++;
      if (giftBuckets[key].sample_ids.length < 5) giftBuckets[key].sample_ids.push(productId);
    }

    for (const p of rows) {
      const parent = (p.product_type || "").trim();
      if (!parent) continue;
      const text = `${p.title ?? ""} ${p.description ?? ""}`;
      const vendor = (p as any).vendor ?? "";

      for (const c of detectIn(text, COLOURS)) bump(parent, `colour:${c}`, p.id);
      for (const o of detectMap(text, OCCASIONS)) bump(parent, `occasion:${o}`, p.id);
      for (const tr of detectMap(text, TRENDS)) bump(parent, `trend:${tr}`, p.id);

      // ACCESSORIES — bag_type, feature, accessories occasion
      if (isAccessoriesVertical(parent)) {
        for (const bt of detectMap(text, BAG_TYPES)) bump(parent, `bag_type:${bt}`, p.id);
        for (const f of detectMap(text, ACC_FEATURES)) bump(parent, `feature:${f}`, p.id);
        for (const o of detectMap(text, ACC_OCCASIONS)) bump(parent, `acc_occasion:${o}`, p.id);
      }

      // JEWELLERY — type / metal / gemstone / gifting
      if (isJewelleryVertical(parent, vendor, p.title ?? "")) {
        for (const jt of detectMap(text, JEWELLERY_TYPES)) bump(parent, `jewellery_type:${jt}`, p.id);
        for (const m of detectMap(text, JEWELLERY_METALS)) bump(parent, `metal:${m}`, p.id);
        for (const g of detectMap(text, JEWELLERY_GEMSTONES)) bump(parent, `gemstone:${g}`, p.id);
        // Gifting signals (any jewellery product is potentially giftable)
        for (const r of detectMap(text, GIFT_RECIPIENTS)) gbump("recipient", r, p.id);
        for (const o of detectMap(text, GIFT_OCCASIONS)) gbump("occasion", o, p.id);
        if (GIFT_SIGNALS.some((s) => text.toLowerCase().includes(s))) gbump("signal", "giftable", p.id);
      }
    }

    // STATIC FILTER COLLECTIONS (Megantic Innovation 1):
    // colour × bag_type and feature × bag_type intersections — produces
    // /collections/black-crossbody-bags, /collections/rfid-wallets etc.
    const staticFilters: Record<string, Bucket & { kind: string; parent: string; left: string; right: string }> = {};
    for (const p of rows) {
      const parent = (p.product_type || "").trim();
      if (!parent || !isAccessoriesVertical(parent)) continue;
      const text = `${p.title ?? ""} ${p.description ?? ""}`;
      const colours = detectIn(text, COLOURS);
      const bagTypes = detectMap(text, BAG_TYPES);
      const features = detectMap(text, ACC_FEATURES);
      for (const c of colours) for (const bt of bagTypes) {
        const key = `colour:${c}|bag_type:${bt}`;
        staticFilters[key] ??= { count: 0, sample_ids: [], kind: "colour_x_bag", parent, left: c, right: bt };
        staticFilters[key].count++;
        if (staticFilters[key].sample_ids.length < 5) staticFilters[key].sample_ids.push(p.id);
      }
      for (const f of features) for (const bt of bagTypes) {
        const key = `feature:${f}|bag_type:${bt}`;
        staticFilters[key] ??= { count: 0, sample_ids: [], kind: "feature_x_bag", parent, left: f, right: bt };
        staticFilters[key].count++;
        if (staticFilters[key].sample_ids.length < 5) staticFilters[key].sample_ids.push(p.id);
      }
    }

    // Sale + Back-in-stock detection from catalog cache restock_status
    const sale: Record<string, Bucket> = {};
    const backInStock: Record<string, Bucket> = {};
    for (const p of rows) {
      const parent = (p.product_type || "").trim();
      if (!parent) continue;
      const status = restockByTitle.get((p.title || "").toLowerCase());
      if (!status) continue;
      if (status === "on_sale" || status === "markdown") {
        sale[parent] ??= { count: 0, sample_ids: [] };
        sale[parent].count++;
        if (sale[parent].sample_ids.length < 5) sale[parent].sample_ids.push(p.id);
      }
      if (status === "back_in_stock" || status === "restocked") {
        backInStock[parent] ??= { count: 0, sample_ids: [] };
        backInStock[parent].count++;
        if (backInStock[parent].sample_ids.length < 5) backInStock[parent].sample_ids.push(p.id);
      }
    }

    // Build suggestion rows
    const suggestions: any[] = [];

    for (const [parent, kids] of Object.entries(buckets)) {
      const parentSlug = slug(parent);
      for (const [child, info] of Object.entries(kids)) {
        if (info.count < minProducts) continue;
        const [kind, value] = child.split(":");
        const childSlug = slug(value);
        const handle = `${parentSlug}/${childSlug}`;
        const titleCase = (s: string) => s.replace(/_/g, " ").replace(/(^|\s)\S/g, (m) => m.toUpperCase());
        let title: string;
        let collection_type: string;
        if (kind === "colour")        { title = `${titleCase(value)} ${parent}`;            collection_type = "colour"; }
        else if (kind === "occasion") { title = `${parent} for ${titleCase(value)}`;        collection_type = "occasion"; }
        else if (kind === "bag_type") { title = `${titleCase(value)} ${parent}`;            collection_type = "bag_type"; }
        else if (kind === "feature")  { title = `${titleCase(value)} ${parent}`;            collection_type = "feature"; }
        else if (kind === "acc_occasion"){ title = `${titleCase(value)} ${parent}`;          collection_type = "occasion"; }
        else                          { title = `${titleCase(value)} ${parent}`;            collection_type = "trend"; }

        // Niche-keyword guard (Megantic Innovation 2): block standalone broad keywords as title
        if (BROAD_BLOCKLIST.has(title.toLowerCase().trim())) continue;

        suggestions.push({
          user_id: userId,
          suggested_title: title,
          suggested_handle: handle,
          shopify_handle: handle,
          collection_type,
          colour_filter: kind === "colour" ? value : null,
          occasion_filter: (kind === "occasion" || kind === "acc_occasion") ? value : null,
          trend_signal: kind === "trend" ? value : null,
          product_count: info.count,
          status: "pending",
          source: "seo-collection-detector",
          sample_product_ids: info.sample_ids,
        });
      }
    }

    // Static filter intersections (Megantic Innovation 1) — minimum 3 products
    for (const [, info] of Object.entries(staticFilters)) {
      if (info.count < Math.max(3, minProducts)) continue;
      const titleCase = (s: string) => s.replace(/_/g, " ").replace(/(^|\s)\S/g, (m) => m.toUpperCase());
      const handle = info.kind === "colour_x_bag"
        ? `${slug(info.left)}-${slug(info.right)}-bags`
        : `${slug(info.left)}-${slug(info.right)}-bags`;
      const title = info.kind === "colour_x_bag"
        ? `${titleCase(info.left)} ${titleCase(info.right)} Bags`
        : `${titleCase(info.left)} ${titleCase(info.right)} Bags`;
      suggestions.push({
        user_id: userId,
        suggested_title: title,
        suggested_handle: handle,
        shopify_handle: handle,
        collection_type: "static_filter",
        colour_filter: info.kind === "colour_x_bag" ? info.left : null,
        product_count: info.count,
        status: "pending",
        source: "seo-collection-detector",
        sample_product_ids: info.sample_ids,
      });
    }

    for (const [parent, info] of Object.entries(sale)) {
      if (info.count < minProducts) continue;
      const parentSlug = slug(parent);
      suggestions.push({
        user_id: userId,
        suggested_title: `${parent} on Sale`,
        suggested_handle: `sale/${parentSlug}`,
        shopify_handle: `sale/${parentSlug}`,
        collection_type: "sale",
        product_count: info.count,
        status: "pending",
        source: "seo-collection-detector",
        sample_product_ids: info.sample_ids,
      });
    }

    for (const [parent, info] of Object.entries(backInStock)) {
      if (info.count < minProducts) continue;
      const parentSlug = slug(parent);
      suggestions.push({
        user_id: userId,
        suggested_title: `${parent} Back in Stock`,
        suggested_handle: `back-in-stock/${parentSlug}`,
        shopify_handle: `back-in-stock/${parentSlug}`,
        collection_type: "back_in_stock",
        product_count: info.count,
        status: "pending",
        source: "seo-collection-detector",
        sample_product_ids: info.sample_ids,
      });
    }

    if (body.dry_run) {
      return new Response(JSON.stringify({ ok: true, dry_run: true, suggestions }), { headers: corsHeaders });
    }

    let inserted = 0;
    if (suggestions.length) {
      const { data, error } = await supabase
        .from("collection_suggestions")
        .upsert(suggestions, { onConflict: "user_id,suggested_handle", ignoreDuplicates: false })
        .select("id");
      if (error) throw error;
      inserted = data?.length ?? 0;
    }

    return new Response(JSON.stringify({
      ok: true,
      products_scanned: rows.length,
      suggestions_generated: suggestions.length,
      suggestions_written: inserted,
    }), { headers: corsHeaders });
  } catch (e) {
    console.error("seo-collection-detector error", e);
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), { status: 500, headers: corsHeaders });
  }
});
