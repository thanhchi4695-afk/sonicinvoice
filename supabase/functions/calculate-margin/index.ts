// Calculate recommended RRP from cost + brand using category markup rules.
// Input: { cost: number, brand?: string, category?: string }
// Output: { cost, brand, category, multiplier, raw_rrp, rrp, margin_pct }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CATEGORY_MULTIPLIERS: Record<string, number> = {
  swimwear: 2.2,
  accessories: 2.5,
  footwear: 2.0,
  jewellery: 3.0,
};

// Lightweight brand → category map. Unknown brands default to swimwear
// (the most common case for this retailer's catalogue) and the response
// flags `category_inferred: true` so the UI can show that to the user.
const BRAND_CATEGORY: Record<string, keyof typeof CATEGORY_MULTIPLIERS> = {
  baku: "swimwear",
  seafolly: "swimwear",
  jets: "swimwear",
  "tigerlily": "swimwear",
  "zimmermann": "swimwear",
  "peony": "swimwear",
  "frankies bikinis": "swimwear",
  "havaianas": "footwear",
  "birkenstock": "footwear",
  "tony bianco": "footwear",
  "saben": "accessories",
  "status anxiety": "accessories",
  "elk": "accessories",
  "by charlotte": "jewellery",
  "reliquia": "jewellery",
  "pdpaola": "jewellery",
};

function roundTo95(value: number): number {
  // Round to nearest $X.95 (e.g. 92.34 → 89.95, 93.20 → 94.95).
  const candidate = Math.round(value - 0.95) + 0.95;
  return Math.max(0.95, Number(candidate.toFixed(2)));
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
      const r = inferCategory(brand);
      category = r.category;
      inferred = r.inferred;
    }

    const multiplier = CATEGORY_MULTIPLIERS[category];
    const rawRrp = cost * multiplier;
    const rrp = roundTo95(rawRrp);
    const marginPct = ((rrp - cost) / rrp) * 100;

    return new Response(
      JSON.stringify({
        cost,
        brand: brand ?? null,
        category,
        category_inferred: inferred,
        multiplier,
        raw_rrp: Number(rawRrp.toFixed(2)),
        rrp,
        margin_pct: Number(marginPct.toFixed(1)),
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
