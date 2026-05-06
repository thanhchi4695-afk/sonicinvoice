// Calculate recommended RRP from cost + brand/category using markup rules.
// Input: { cost: number, brand?: string, category?: string, product_type?: string }
// Output includes GST split, gross margin/profit, and compare-at price.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CATEGORY_MULTIPLIERS: Record<string, number> = {
  swimwear: 2.2,
  clothing: 2.2,
  accessories: 2.5,
  footwear: 2.0,
  jewellery: 3.0,
};

// Free-text product type / keyword → canonical category
const TYPE_ALIASES: Record<string, keyof typeof CATEGORY_MULTIPLIERS> = {
  swimwear: "swimwear",
  swim: "swimwear",
  "one piece": "swimwear",
  "one pieces": "swimwear",
  bikini: "swimwear",
  bikinis: "swimwear",
  rashie: "swimwear",
  clothing: "clothing",
  dress: "clothing",
  dresses: "clothing",
  top: "clothing",
  shirt: "clothing",
  pants: "clothing",
  skirt: "clothing",
  accessories: "accessories",
  accessory: "accessories",
  hat: "accessories",
  hats: "accessories",
  bag: "accessories",
  bags: "accessories",
  sunnies: "accessories",
  sunglasses: "accessories",
  footwear: "footwear",
  shoe: "footwear",
  shoes: "footwear",
  thong: "footwear",
  thongs: "footwear",
  sandal: "footwear",
  sandals: "footwear",
  jewellery: "jewellery",
  jewelry: "jewellery",
  necklace: "jewellery",
  earring: "jewellery",
  earrings: "jewellery",
  bracelet: "jewellery",
  ring: "jewellery",
};

const BRAND_CATEGORY: Record<string, keyof typeof CATEGORY_MULTIPLIERS> = {
  baku: "swimwear",
  seafolly: "swimwear",
  jets: "swimwear",
  tigerlily: "swimwear",
  zimmermann: "swimwear",
  peony: "swimwear",
  "frankies bikinis": "swimwear",
  havaianas: "footwear",
  birkenstock: "footwear",
  "tony bianco": "footwear",
  saben: "accessories",
  "status anxiety": "accessories",
  elk: "accessories",
  "by charlotte": "jewellery",
  reliquia: "jewellery",
  pdpaola: "jewellery",
};

function roundTo95(value: number): number {
  // Round to nearest $X.95 using boundaries at .45 (e.g. 94.20 → 93.95, 94.60 → 94.95).
  const candidate = Math.round(value - 0.95) + 0.95;
  return Math.max(0.95, Number(candidate.toFixed(2)));
}

function detectCategoryFromType(productType?: string): keyof typeof CATEGORY_MULTIPLIERS | null {
  if (!productType) return null;
  const lower = productType.toLowerCase();
  const sorted = Object.keys(TYPE_ALIASES).sort((a, b) => b.length - a.length);
  for (const k of sorted) {
    if (lower.includes(k)) return TYPE_ALIASES[k];
  }
  return null;
}

function inferCategory(brand: string | undefined): {
  category: keyof typeof CATEGORY_MULTIPLIERS;
  inferred: boolean;
} {
  const key = (brand ?? "").trim().toLowerCase();
  if (key && BRAND_CATEGORY[key]) {
    return { category: BRAND_CATEGORY[key], inferred: false };
  }
  return { category: "swimwear", inferred: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const cost = Number(body.cost);
    const brand = typeof body.brand === "string" ? body.brand.trim() : undefined;
    const productType = typeof body.product_type === "string" ? body.product_type.trim() : undefined;
    const explicitCategory =
      typeof body.category === "string" ? body.category.trim().toLowerCase() : undefined;

    if (!Number.isFinite(cost) || cost <= 0) {
      return new Response(
        JSON.stringify({ error: "cost must be a positive number" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let category: keyof typeof CATEGORY_MULTIPLIERS;
    let inferred = false;
    if (explicitCategory && CATEGORY_MULTIPLIERS[explicitCategory]) {
      category = explicitCategory as keyof typeof CATEGORY_MULTIPLIERS;
    } else {
      const fromType = detectCategoryFromType(productType);
      if (fromType) {
        category = fromType;
      } else {
        const r = inferCategory(brand);
        category = r.category;
        inferred = r.inferred;
      }
    }

    const multiplier = CATEGORY_MULTIPLIERS[category];
    const rawRrp = cost * multiplier;
    const rrp = roundTo95(rawRrp); // RRP incl GST
    const rrpExGst = Number((rrp / 1.1).toFixed(2));
    const grossProfit = Number((rrpExGst - cost).toFixed(2));
    const marginPct = Number(((grossProfit / rrpExGst) * 100).toFixed(1));
    const compareAt = roundTo95(rrp * 1.25); // suggested compare-at for ~20% sale

    return new Response(
      JSON.stringify({
        cost,
        brand: brand ?? null,
        product_type: productType ?? null,
        category,
        category_inferred: inferred,
        multiplier,
        raw_rrp: Number(rawRrp.toFixed(2)),
        rrp,
        rrp_ex_gst: rrpExGst,
        gross_profit: grossProfit,
        margin_pct: marginPct,
        compare_at: compareAt,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("calculate-margin error", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
