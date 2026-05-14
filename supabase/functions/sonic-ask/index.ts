// sonic-ask — Conversational expert assistant for Sonic Invoices.
// LLM_CALL pattern (one-shot per user turn). Direct Anthropic API.
// System prompt = live store context + distilled skill knowledge.
//
// POST { message: string, conversation_history: {role,content}[] }
// Auth: Supabase JWT (verify_jwt = true via default).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 1024;
const MAX_HISTORY = 20;

const EXPERT_KNOWLEDGE = `
══════════════════════════════════════
SKILL 1 — 7-LAYER TAGGING SYSTEM
══════════════════════════════════════
Every product gets all applicable layers. Apply in order.

LAYER 1 — GENDER (exactly one):
- Womens → women's swimwear, clothing, accessories (capital W)
- mens → men's products. Vendors: Rhythm Mens, Funky Trunks, Skwosh, Budgy Smuggler, Green Rock, Rusty, Dukies, Suen Noaj
- kids → children's products. Type/vendor contains: Girls, Boys, Kids, 00-7, 8-16

LAYER 2 — DEPARTMENT (1-2 that apply):
- Swimwear + womens swim → women's swimwear (one pieces, bikinis, tankinis, rashies, boardshorts womens)
- clothing + womens clothing → women's clothing (dresses, tops, pants, kaftans, jumpsuits)
- accessories → hats, sunnies, jewellery, bags, towels, goggles, gifts
- mens swim → men's swimwear
- kids → all children's

LAYER 3 — PRODUCT TYPE (exact casing — case matters):
Women's Swimwear: One Pieces | Bikini Tops | bikini bottoms (lowercase) | Bikini Set | tankini tops | rashies & sunsuits | swimdress (use BOTH One Pieces + swimdress) | boardshorts | Boyleg | Blouson
Women's Clothing: Dresses | tops + womens top (both) | kaftans & cover ups + cover ups (both) | Sarongs + sarong (both) | playsuits & jumpsuits | pants | skirts
Men's: boardshorts + mens boardies (both) | mens swim | mens clothing
Kids: Girls swimwear + girls 00-7 OR girls 8-16 | boys swim + boys 00-7 OR boys 8-16
Accessories: hats | Sunnies + sunglasses (both) | BAGS + handbags (both) | towels | goggles
Jewellery: JEWELLERY (all caps) + earrings OR necklace OR bracelet OR ring — NO Womens or accessories tags

LAYER 4 — BRAND TAGS (exact casing):
Seafolly → Seafolly ★ | Seafolly Girls → Seafolly Girls ★ | Baku → Baku ★ | Jantzen → jantzen | Sunseeker → Sunseeker ★ | Sea Level → sea level | Kulani Kinis → Kulani Kinis ★ | Bond Eye → bond eye | Artesands → artesands | Monte & Lou → Monte & Lou ★ | Rhythm Womens → rhythm women | Rhythm Mens → rhythm | Funkita → Funkita ★ | Funky Trunks → funky trunks | Reef → Thongs/ Shoes | Jets → Jets ★ | Tigerlily → Tigerlily ★ | Salty Ink Kids → salty ink | Salty Ink Ladies → Ladies Salty Ink ★ | Zoggs → zoggs | Speedo → speedo | Hammamas → hammamas | Walnut Melbourne → walnut melbourne
Rule: if vendor not in table, use lowercase version of vendor name

LAYER 5 — ARRIVAL MONTH (from invoice date, not today):
Format: 3-letter month + 2-digit year. NO space. Examples: Jan26, Feb26, Mar26, Apr26, May26, Jun26, Jul26, Aug26, Sept26 (4 letters — NEVER Sep26), Oct26, Nov26, Dec26
CRITICAL: September = Sept (4 letters). Most common tagging mistake.

LAYER 6 — PRICE STATUS (conditional):
- Compare-at price blank or 0 → ADD full_price (underscore, lowercase)
- Compare-at price > current price (on sale) → OMIT full_price entirely

LAYER 7 — SPECIAL PROPERTIES:
- chlorine resistant / Xtralife → chlorine resist (lowercase). EXCEPTION: Funkita only → Chlorine Resistant (capital C and R)
- underwire / balconette → underwire
- plus size / extended sizing / sizes 18-26 → plus size
- tummy control / shaping / powermesh → tummy control. Miracle Suit always gets tummy control.
- D/E, E/F, F/G, G/H, DD cup or above → d-g
- mastectomy / prosthesis pocket → mastectomy
- UPF / sun protection → Sun Protection (capital S and P)
- new arrival → new + new arrivals + new swim (swimwear) OR new clothing + new womens (clothing) OR new mens (mens)
- period-proof → Period Swimwear (capital P and S)
- multifit / A-DD → A-DD

BRAND-SPECIFIC OVERRIDES:
- Artesands: every product → plus size (automatic, even if not stated)
- Jantzen (on invoice as "Skye Group Pty. Ltd") → vendor must be "Jantzen" not "Skye Group"
- Reef: type = shoes/thongs → brand tag = Thongs/ Shoes (slash + space). Never swimwear.
- Seafolly Girls: must use Seafolly Girls vendor and brand tag — NOT Seafolly
- Rhythm: Rhythm Womens ≠ Rhythm Mens (different vendor, different tag)
- Sea Level: style code ending in S = swimdress → One Pieces + swimdress both
- Funkita ONLY: chlorine resistant = Chlorine Resistant (capital)

COMPLETE TAG FORMULAS:
Women's swimwear: Womens, Swimwear, womens swim, [TYPE], [BRAND], [MONTH], [full_price if applicable], [new tags if new], [special tags]
Women's clothing: Womens, clothing, womens clothing, [TYPE], [BRAND], [MONTH], [full_price], [new tags if new]
Men's boardshorts: mens, mens swim, boardshorts, mens boardies, [BRAND], [MONTH], [full_price]
Girls swimwear: kids, Swimwear, Girls swimwear, [girls 00-7 OR girls 8-16], [BRAND], [MONTH], [full_price]
Jewellery: JEWELLERY, [earrings OR necklace etc.], [BRAND], [MONTH], [full_price]

══════════════════════════════════════
SKILL 2 — INVOICE PROCESSING RULES
══════════════════════════════════════
INVOICE TYPES:
A = standard table | B = pack notation (1x8, 2x10 → one row per size) | C = size matrix (each non-zero cell = one row) | D = free-form PDF (style number = anchor) | E = image/scan (OCR first)

7 REQUIRED FIELDS per row: Product name | Style number/SKU | Colour | Size | Quantity | Cost ex GST | RRP incl GST

STOCK CLASSIFICATION (every line):
REFILL = barcode or style already in catalog → update inventory only
NEW COLOUR = same style, new colourway → add as new variant
NEW PRODUCT = style not found → create from scratch with full tagging
Matching priority: barcode → style number → style name + vendor fuzzy match

PRICING when RRP not on invoice:
One pieces, bikini sets: cost ex GST × 2.3-2.5
Bikini tops/bottoms: × 2.2-2.4
Rashies/sunsuits: × 2.0-2.2
Women's clothing: × 2.0-2.2
Men's swimwear: × 2.0-2.3
Kids swimwear: × 2.2-2.4
Accessories/hats/footwear: × 2.0
Rounding: nearest $0.95 or $5.00. Example: $42 × 2.3 = $96.60 → $99.95

GST RULE: Shopify Cost per item = ex GST. Shopify Price = RRP incl GST. Never same number in both.
Minimum margin: 50% on all categories.
Margin formula: (RRP incl GST − Cost incl GST) ÷ RRP incl GST × 100. Cost incl GST = cost ex GST × 1.1

BRAND INVOICE QUIRKS:
- Jantzen: invoice says "Skye Group Pty. Ltd" — always map to vendor "Jantzen"
- Seafolly: 6-digit numeric style numbers. Sizes AU 6-20. DD/E cup → d-g tag.
- Baku: style = letters+digits, sometimes colour code suffix. Fuller-bust → d-g + underwire.
- Ambra: scanned PDF, handwritten qty. Size matrix uses PAIRS (8/10 col = both 8 AND 10). Codes: BLAC=Black, ROBE=Rose Beige, NAVY=Navy, NUDE=Nude, WHIT=White.
- Sea Level: invoice numbers start N000. Style ending S = swimdress.
- Artesands: ALL products → plus size tag.
- Sunseeker: chlorine-resistant range common.

PACK NOTATION: 1x8, 2x10, 1x12 = size 8 qty 1, size 10 qty 2, size 12 qty 1 (one row per size)
SIZE CONVERSION: US women's + 4 = AU (US6=AU10). EUR − 30 = AU (EUR40=AU10).

══════════════════════════════════════
SKILL 3 — SEO FORMULAS
══════════════════════════════════════
PRODUCT SEO TITLE: [Brand] [Style Name] [Product Type] - [Colour]
Rules: max 65 chars. Brand first or second word. Append | Australia if under 52 chars.
Good: "Seafolly Beach Bound DD Bandeau One Piece - Dark Chocolate" (58)

META DESCRIPTION: [What it is] + [Key feature] + [Delivery CTA]
Rules: 120-155 chars. Unique per product. End with benefit/soft CTA.
Good: "Shop the Beach Bound DD Bandeau One Piece by Seafolly at Splash Swimwear. Dark Chocolate. Free delivery Australia-wide on orders over $150." (139)

COLLECTION DESCRIPTION (5 parts):
1. Keyword-loaded opener: location + brand + type in first sentence
2. Materials and features paragraph
3. Brand names mentioned explicitly
4. FAQ section: 4-6 questions targeting Google People Also Ask
5. Internal links to 3-5 sibling collections
Length: 200-350 words.

SEO SCORE (0-100): Title=15, Meta 150-160=20, Body 200+ words=25, FAQ 4+=20, Links 3+=10, Products=10. <70 needs attention. >90 complete.

COLLECTION URL HIERARCHY:
L1 /collections/[brand] | L2 /collections/[brand]-[type] | L3 /collections/[colour]-[type] | L4 /collections/[feature]-[type] | L5 /collections/[occasion]-[type]

DESCRIPTION TEMPLATES:
One piece: "Shop the [style] by [brand] at [store]. [colour]. Free delivery Australia-wide on orders over $150."
Bikini top: "The [style] bikini top by [brand]. Available in [colour]. Shop at [store] — free AU delivery over $150."
Bikini bottom: "The [style] bikini bottom by [brand]. In [colour]. Mix & match at [store] — free AU delivery over $150."
Clothing: "The [style] by [brand]. Shop women's fashion at [store]. Free delivery Australia-wide on orders over $150."

AUSTRALIAN SEO RULES:
- AU English: colour not color, swimwear not swimsuit, free delivery not free shipping
- Geo-modifier: "Darwin", "Darwin NT", "Australia" in titles/descriptions
- AI search: answer-format FAQ to rank in ChatGPT, Perplexity, Google AI Mode

══════════════════════════════════════
SKILL 4 — DARWIN RETAIL CALENDAR
══════════════════════════════════════
Two seasons, not four:
- Wet: Nov-Apr (humid, cyclone risk, lighter swimwear/resort)
- Dry: May-Oct (peak tourist season, best retail months)

KEY EVENTS:
Jan: Back to school — kids/school swimwear push
Mar-Apr: End of wet season clearance — markdown summer stock
May: Dry season starts — resort wear, travel
Jun: EOFY sales. Dry season peak begins.
Jul-Aug: PEAK retail. Tourist influx. Darwin Cup (Aug) — racing fashion, hats, formal wear
Sept: Cup hangover. Spring collections arriving.
Oct: Pre-Christmas stock arriving. Swimwear for gifting.
Nov-Dec: Christmas. Wet season starts. Summer swimwear peak.
Dec 26: Boxing Day clearance.

DARWIN CUP (Aug): biggest single retail event. Fascinators, hats, dresses, formal wear. Stock up Jun-Jul. Hats/sunnies are impulse buys.

COMPETITOR REFERENCES: THE ICONIC (swimwear), Mathers (footwear), David Jones (premium), White Fox (clothing/occasion).

WHOLESALE INVOICING CALENDAR:
Jan-Feb: spring/summer pre-orders arrive (Seafolly, Baku)
Mar-Apr: JOOR/NuOrder bulk for mid-year delivery
Jun-Jul: spring/summer arrives — major invoice processing
Aug-Sept: new launches at trade shows, forward orders
Oct-Nov: Christmas/summer arrives

══════════════════════════════════════
SKILL 5 — PRICING & MARGIN BENCHMARKS
══════════════════════════════════════
SWIMWEAR RRP (AU incl GST):
Bikini tops: $120-$220 (budget $89-$119, premium $220-$299)
Bikini bottoms: $90-$160
Bikini sets: $180-$320
One pieces: $180-$280 (Jets premium $229-$329)
Rashies/sunsuits: $79-$149
Kids: $49-$89

FOOTWEAR RRP: Sandals/thongs $80-$160 | Sneakers $120-$220 | Boots $180-$380 | Dress $150-$280
CLOTHING RRP: Dresses $89-$199 (maxi $149-$249) | Tops $59-$129 | Kaftans $79-$169

MARKUP:
One pieces, bikini sets: 2.3-2.5× (56-60% margin)
Bikini tops/bottoms: 2.2-2.4× (55-58%)
Clothing: 2.0-2.2× (50-55%)
Footwear: 2.0-2.3× (50-57%)
Accessories: 2.0× (50%)
Minimum: 50% across all categories

PRICE SANITY CHECKS:
- One piece under $100 → likely wholesale not RRP (esp. Jets, Seafolly premium)
- Cost = RRP → GST error (cost should be ex GST, price incl GST)
- Margin <40% → flag (wrong cost, RRP, or markup)

══════════════════════════════════════
INTERNAL DOCTRINE
══════════════════════════════════════
Three-pattern AI: classify every feature as LLM_CALL (one-shot), AUTOMATION_FLOW (cron/rule, no LLM hot path), or AI_AGENT (tool-using loop). Never use an Agent for what an automation can do.
`.trim();

interface ChatMessage { role: "user" | "assistant"; content: string }

async function fetchContext(userId: string): Promise<string> {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const [{ data: conn }, { data: cols }, { data: brands }, { count: gapCount }, { count: invoiceCount }] = await Promise.all([
    admin.from("shopify_connections").select("store_url").eq("user_id", userId).maybeSingle(),
    admin.from("collection_suggestions").select("suggested_title,shopify_handle,completeness_score,status").eq("store_domain", "").or(`store_domain.neq.`).limit(10),
    admin.from("brand_intelligence").select("brand_name").eq("user_id", userId).limit(10),
    admin.from("competitor_gaps").select("*", { count: "exact", head: true }).eq("user_id", userId).eq("status", "pending"),
    admin.from("invoice_processing_jobs").select("*", { count: "exact", head: true }).eq("user_id", userId),
  ]);

  // Re-fetch collections scoped properly (collection_suggestions has no user_id directly)
  const { data: realCols } = await admin
    .from("collection_suggestions")
    .select("suggested_title,shopify_handle,completeness_score,status")
    .order("completeness_score", { ascending: true, nullsFirst: false })
    .limit(10);

  const storeUrl = conn?.store_url || "(no Shopify store connected)";
  const colSummary = (realCols ?? cols ?? [])
    .map((c: any) => `  - ${c.suggested_title || c.shopify_handle || "(untitled)"} — score ${c.completeness_score ?? 0}/100, ${c.status || "draft"}`)
    .join("\n") || "  (no collections yet)";
  const brandList = (brands ?? []).map((b: any) => b.brand_name).filter(Boolean).join(", ") || "(no brands tracked)";

  return `## LIVE STORE CONTEXT
Store: ${storeUrl}
Pending SEO gaps: ${gapCount ?? 0}
Invoice jobs processed: ${invoiceCount ?? 0}
Top brands tracked: ${brandList}
Lowest-scoring collections (focus areas):
${colSummary}`;
}

// Loads the user's active claude_skills from the DB and concatenates them
// into a single knowledge block. Falls back to the hardcoded EXPERT_KNOWLEDGE
// if no active skills exist (so the chat still works on a fresh install).
async function fetchSkills(userId: string): Promise<string> {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await admin
    .from("claude_skills")
    .select("skill_name, content")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("skill_name", { ascending: true });
  if (error) {
    console.warn("[sonic-ask] skills fetch failed:", error.message);
    return EXPERT_KNOWLEDGE;
  }
  const rows = (data ?? []) as { skill_name: string; content: string }[];
  if (rows.length === 0) return EXPERT_KNOWLEDGE;
  const sep = "═".repeat(40);
  return rows
    .map(s => `${sep}\nSKILL — ${s.skill_name.toUpperCase()}\n${sep}\n${s.content}`)
    .join("\n\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Auth
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const message: string = String(body.message || "").trim();
    const history: ChatMessage[] = Array.isArray(body.conversation_history) ? body.conversation_history : [];
    if (!message) {
      return new Response(JSON.stringify({ error: "message required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const trimmedHistory = history.slice(-MAX_HISTORY).filter(m =>
      (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim()
    );

    const liveContext = await fetchContext(user.id).catch((e) => {
      console.warn("[sonic-ask] context fetch failed:", e);
      return "## LIVE STORE CONTEXT\n(unavailable this turn)";
    });

    const systemPrompt = `You are Sonic AI — an embedded expert assistant inside Sonic Invoices, a Shopify stock-intake and SEO automation tool for Australian independent retailers (boutique fashion, swimwear, footwear).

You answer the store owner's questions using the live data and expert knowledge below. Be concise, specific, and practical.

## ACTION RULES (strict)
- Never claim to be executing an action (generating SEO, creating a collection, pushing to Shopify, parsing an invoice) — you cannot take those actions from this chat panel.
- You may explain *what* Sonic would do and *where* to do it.
- If the user asks for something actionable, end your response with the exact path in this format: "Go to [Tab] → [Page] → [Button]" (e.g. "Go to Collections → black-dresses → Generate SEO content").

${liveContext}

${EXPERT_KNOWLEDGE}

Tone: confident, retail-savvy, no fluff. Default to short answers (2-5 sentences) unless the user asks for detail. Use markdown sparingly (lists, bold) when it helps scanability.`;

    const anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [
          ...trimmedHistory.map(m => ({ role: m.role, content: m.content })),
          { role: "user", content: message },
        ],
      }),
    });

    if (!anthropicResp.ok) {
      const errText = await anthropicResp.text();
      console.error("[sonic-ask] anthropic error", anthropicResp.status, errText);
      return new Response(JSON.stringify({ error: `Anthropic ${anthropicResp.status}`, detail: errText }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await anthropicResp.json();
    const reply = data?.content?.[0]?.text || "(no response)";

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[sonic-ask] error", e);
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
