// ───────────────────────────────────────────────────────────────
// Agent 2 — Stage 3: VALIDATION
// Adds `flags: string[]` to each product. Never removes products.
// ───────────────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const COLOUR_CODE_MAP: Record<string, string> = {
  BK: "Black", NY: "Navy", SW: "Seaweed", WH: "White", RD: "Red",
  PK: "Pink", GY: "Grey", BE: "Beige", CR: "Cream", IK: "Ink",
  AQ: "Aqua", NV: "Navy", GR: "Green", TL: "Teal", OL: "Olive",
  RS: "Rose", IV: "Ivory", BL: "Blue", OR: "Orange", YL: "Yellow",
  PR: "Purple",
};

interface Product {
  name?: string;
  product_name?: string;
  sku?: string;
  style_code?: string;
  vendor?: string;
  brand?: string;
  cost?: number;
  unit_cost?: number;
  rrp?: number;
  qty?: number;
  quantity?: number;
  colour?: string;
  flags?: string[];
  variants?: Array<{ qty?: number; quantity?: number }>;
  [k: string]: unknown;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { products, classification, supplier_name } = await req.json() as {
      products: Product[];
      classification?: { has_rrp?: boolean } | null;
      supplier_name?: string | null;
    };

    if (!Array.isArray(products)) {
      return new Response(JSON.stringify({ error: "products must be an array" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const hasRrp = !!classification?.has_rrp;
    const supplier = (supplier_name || "").trim();

    const flagCounts: Record<string, number> = {};
    const addFlag = (p: Product, flag: string) => {
      if (!Array.isArray(p.flags)) p.flags = [];
      if (!p.flags.includes(flag)) p.flags.push(flag);
      flagCounts[flag] = (flagCounts[flag] || 0) + 1;
    };

    // Rule 3 — duplicate detection: collect style code occurrences first
    const styleCounts = new Map<string, number>();
    for (const p of products) {
      const code = String(p.style_code || p.sku || "").trim().toLowerCase();
      if (code) styleCounts.set(code, (styleCounts.get(code) || 0) + 1);
    }

    let flaggedCount = 0;
    for (const p of products) {
      const before = (p.flags?.length ?? 0);

      const cost = Number(p.cost ?? p.unit_cost ?? 0);
      const rrp = Number(p.rrp ?? 0);
      const qty = Number(p.qty ?? p.quantity ?? 0);
      const name = String(p.name ?? p.product_name ?? "").trim();

      // Rule 1 — margin sanity
      if (cost > 0 && rrp > 0) {
        const margin = (rrp - cost) / rrp;
        if (margin < 0) addFlag(p, "cost_exceeds_rrp");
        else if (margin > 0.90) addFlag(p, "margin_unusually_high");
        else if (margin < 0.30) addFlag(p, "low_margin");
      }

      // Rule 2 — required fields
      if (!name) addFlag(p, "missing_name");
      if (hasRrp && !rrp) addFlag(p, "missing_rrp");
      if (!cost) addFlag(p, "missing_cost");
      const variantQtys = Array.isArray(p.variants)
        ? p.variants.map(v => Number(v.qty ?? v.quantity ?? 0))
        : [qty];
      if (variantQtys.length > 0 && variantQtys.every(q => q === 0)) {
        addFlag(p, "zero_quantity");
      }

      // Rule 3 — duplicate
      const code = String(p.style_code || p.sku || "").trim().toLowerCase();
      if (code && (styleCounts.get(code) || 0) > 1) addFlag(p, "possible_duplicate");

      // Rule 4 — fractional quantity
      const allQtys = [qty, ...variantQtys];
      if (allQtys.some(q => q > 0 && !Number.isInteger(q))) addFlag(p, "fractional_quantity");

      // Rule 5 — colour code expansion (mutates colour if it's a known 2-letter code)
      const colour = String(p.colour ?? "").trim();
      if (colour.length === 2 && /^[A-Z]{2}$/.test(colour) && COLOUR_CODE_MAP[colour]) {
        p.colour = COLOUR_CODE_MAP[colour];
      }

      // Rule 6 — vendor fill from classification
      if (supplier) {
        const v = String(p.vendor ?? p.brand ?? "").trim();
        if (!v) {
          p.vendor = supplier;
          if (!p.brand) p.brand = supplier;
        }
      }

      if ((p.flags?.length ?? 0) > before) flaggedCount++;
    }

    return new Response(JSON.stringify({
      products,
      summary: {
        total: products.length,
        flagged: flaggedCount,
        flag_types: flagCounts,
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("validate-extraction error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Validation failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
