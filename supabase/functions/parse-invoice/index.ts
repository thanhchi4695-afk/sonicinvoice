// 3-stage invoice parse pipeline
// Stage 1: Gemini 2.5 Flash (Lovable AI Gateway) -> document parsing
// Stage 2: Claude Sonnet (Anthropic) -> brand intelligence + Shopify CSV rows
// Stage 3: Perplexity sonar-pro -> RRP lookup for missing values
// Persists job + result to public.parse_jobs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface ParsedRow {
  productName?: string | null;
  styleNumber?: string | null;
  colour?: string | null;
  size?: string | null;
  quantity?: number | null;
  costPrice?: number | null;
  rrp?: number | null;
}

const STAGE1_FIELDS: (keyof ParsedRow)[] = [
  "productName",
  "styleNumber",
  "colour",
  "size",
  "quantity",
  "costPrice",
  "rrp",
];

function computeConfidence(rows: ParsedRow[]): {
  level: "high" | "medium" | "low";
  completeness: number;
} {
  if (!rows || rows.length === 0) return { level: "low", completeness: 0 };
  let filled = 0;
  let total = 0;
  for (const row of rows) {
    for (const f of STAGE1_FIELDS) {
      total += 1;
      const v = row[f];
      if (v !== null && v !== undefined && v !== "" && !(typeof v === "number" && Number.isNaN(v))) {
        filled += 1;
      }
    }
  }
  const completeness = total === 0 ? 0 : filled / total;
  const level = completeness >= 0.85 ? "high" : completeness >= 0.6 ? "medium" : "low";
  return { level, completeness };
}

// Brand-pattern context — Strategy 1 Step 4 (Flywheel)
interface BrandPattern {
  supplier_sku_format?: string | null;
  size_schema?: string | null;
  invoice_layout_fingerprint?: unknown;
  sample_count?: number | null;
  accuracy_rate?: number | null;
}
async function loadBrandPattern(admin: any, userId: string, brandName: string): Promise<BrandPattern | null> {
  if (!brandName?.trim()) return null;
  const { data } = await admin
    .from("brand_patterns")
    .select("supplier_sku_format, size_schema, invoice_layout_fingerprint, sample_count, accuracy_rate")
    .eq("user_id", userId)
    .ilike("brand_name", brandName.trim())
    .maybeSingle();
  return data ?? null;
}
function brandHintsBlock(p: BrandPattern | null): string {
  if (!p) return "";
  const lines: string[] = ["", "KNOWN BRAND PATTERNS (use as priors, but trust the document if it disagrees):"];
  if (p.supplier_sku_format) lines.push(`- SKU format: ${p.supplier_sku_format}`);
  if (p.size_schema) lines.push(`- Size schema: ${p.size_schema}`);
  if (p.invoice_layout_fingerprint) lines.push(`- Layout fingerprint: ${JSON.stringify(p.invoice_layout_fingerprint).slice(0, 400)}`);
  if (p.sample_count) lines.push(`- Learned from ${p.sample_count} prior invoice(s) (accuracy ${Math.round((p.accuracy_rate ?? 1) * 100)}%)`);
  return lines.join("\n");
}

// Stage 1 — Gemini 2.5 Flash via Lovable AI Gateway
async function stage1Gemini(fileBase64: string, mimeType: string, supplierName: string, brandHints = "") {
  const systemPrompt = `You are a precise invoice parser. Extract every line item from the supplied invoice. Return ONLY a JSON object matching the provided schema. Numbers must be plain numbers (no currency symbols). Use null for any field you cannot confidently extract.`;

  const userPrompt = `Supplier: ${supplierName}${brandHints}\n\nExtract every product line item. For each item return: productName, styleNumber, colour, size, quantity, costPrice (unit cost ex-tax), rrp (recommended retail price if shown).`;

  const tools = [
    {
      type: "function",
      function: {
        name: "return_invoice_rows",
        description: "Return parsed invoice line items as structured rows.",
        parameters: {
          type: "object",
          properties: {
            rows: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  productName: { type: ["string", "null"] },
                  styleNumber: { type: ["string", "null"] },
                  colour: { type: ["string", "null"] },
                  size: { type: ["string", "null"] },
                  quantity: { type: ["number", "null"] },
                  costPrice: { type: ["number", "null"] },
                  rrp: { type: ["number", "null"] },
                },
                required: ["productName", "styleNumber", "colour", "size", "quantity", "costPrice", "rrp"],
                additionalProperties: false,
              },
            },
          },
          required: ["rows"],
          additionalProperties: false,
        },
      },
    },
  ];

  const messages = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: [
        { type: "text", text: userPrompt },
        {
          type: "image_url",
          image_url: { url: `data:${mimeType};base64,${fileBase64}` },
        },
      ],
    },
  ];

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages,
      tools,
      tool_choice: { type: "function", function: { name: "return_invoice_rows" } },
    }),
  });

  if (!resp.ok) {
    if (resp.status === 429) throw new Error("AI rate limit exceeded (Gemini). Please retry shortly.");
    if (resp.status === 402) throw new Error("AI credits exhausted. Add credits in Settings → Workspace → Usage.");
    const t = await resp.text();
    throw new Error(`Gemini stage failed: ${resp.status} ${t.slice(0, 300)}`);
  }
  const json = await resp.json();
  const toolCall = json?.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("Gemini returned no tool call");
  const args = JSON.parse(toolCall.function.arguments || "{}");
  const rows: ParsedRow[] = Array.isArray(args.rows) ? args.rows : [];
  return rows;
}

// Stage 2 — Claude Sonnet brand intelligence -> Shopify-ready rows
async function stage2Claude(stage1Rows: ParsedRow[], supplierName: string) {
  const systemPrompt = `You are a Shopify merchandising specialist for Australian boutique retail. Apply tagging rules, generate SEO-friendly titles, normalise sizes to AU sizing, and output one Shopify-ready CSV row per variant. Return ONLY via the provided tool.`;

  const userPrompt = `Supplier / brand: ${supplierName}

Input rows (from invoice parse):
${JSON.stringify(stage1Rows, null, 2)}

For each variant, output a Shopify-ready row with these columns:
- handle (lowercased, hyphenated, brand + product)
- title (SEO format: "[Colour] [Key Feature] [Product Type]")
- vendor (the supplier/brand)
- productCategory
- type
- tags (comma-separated; include season/material/style/colour where inferable)
- option1Name = "Colour"
- option1Value
- option2Name = "Size"
- option2Value (AU sizing — convert from EU/US/UK/Alpha if needed)
- variantSku (style-colour-size)
- variantPrice (RRP — leave null if not available, Stage 3 will fill)
- variantCostPerItem (costPrice)
- variantInventoryQty (quantity)
- seoTitle (<= 60 chars)
- seoDescription (<= 160 chars)
- styleNumber (pass through)`;

  const tools = [
    {
      name: "return_shopify_rows",
      description: "Return Shopify-ready CSV rows.",
      input_schema: {
        type: "object",
        properties: {
          rows: {
            type: "array",
            items: {
              type: "object",
              properties: {
                handle: { type: "string" },
                title: { type: "string" },
                vendor: { type: "string" },
                productCategory: { type: ["string", "null"] },
                type: { type: ["string", "null"] },
                tags: { type: "string" },
                option1Name: { type: "string" },
                option1Value: { type: ["string", "null"] },
                option2Name: { type: "string" },
                option2Value: { type: ["string", "null"] },
                variantSku: { type: ["string", "null"] },
                variantPrice: { type: ["number", "null"] },
                variantCostPerItem: { type: ["number", "null"] },
                variantInventoryQty: { type: ["number", "null"] },
                seoTitle: { type: ["string", "null"] },
                seoDescription: { type: ["string", "null"] },
                styleNumber: { type: ["string", "null"] },
              },
              required: ["handle", "title", "vendor", "tags", "option1Name", "option2Name"],
            },
          },
        },
        required: ["rows"],
      },
    },
  ];

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 8000,
      system: systemPrompt,
      tools,
      tool_choice: { type: "tool", name: "return_shopify_rows" },
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Claude stage failed: ${resp.status} ${t.slice(0, 300)}`);
  }
  const json = await resp.json();
  const block = (json.content || []).find((b: any) => b.type === "tool_use");
  if (!block) throw new Error("Claude returned no tool_use block");
  const rows = Array.isArray(block.input?.rows) ? block.input.rows : [];
  return rows;
}

// Stage 3 — Perplexity sonar-pro RRP lookup for missing variantPrice
async function stage3Perplexity(rows: any[], supplierName: string) {
  const targets = rows
    .map((r, idx) => ({ idx, row: r }))
    .filter(({ row }) => row.variantPrice === null || row.variantPrice === undefined);

  if (targets.length === 0 || !PERPLEXITY_API_KEY) return rows;

  const lookups: Array<{ idx: number; price: number | null; source: string | null }> = [];

  for (const { idx, row } of targets) {
    const query = `Current Australian RRP (AUD) for ${supplierName} ${row.title || row.styleNumber || row.handle}${row.option1Value ? `, colour ${row.option1Value}` : ""}${row.option2Value ? `, size ${row.option2Value}` : ""}. Reply with the price as a plain number only (no currency symbol, no text). If unknown, reply "null".`;

    try {
      const resp = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "sonar-pro",
          messages: [
            { role: "system", content: "You return only an Australian RRP as a plain number (e.g. 149.95) or the literal word null. No other text." },
            { role: "user", content: query },
          ],
          temperature: 0.1,
          max_tokens: 32,
        }),
      });
      if (!resp.ok) {
        lookups.push({ idx, price: null, source: null });
        continue;
      }
      const data = await resp.json();
      const text = (data?.choices?.[0]?.message?.content || "").trim();
      const num = parseFloat(text.replace(/[^0-9.]/g, ""));
      const citations = data?.citations || [];
      lookups.push({
        idx,
        price: Number.isFinite(num) && num > 0 ? num : null,
        source: citations[0] || null,
      });
    } catch (_e) {
      lookups.push({ idx, price: null, source: null });
    }
    await new Promise(r => setTimeout(r, 500)); // rate-limit politeness
  }

  for (const { idx, price, source } of lookups) {
    if (price !== null) {
      rows[idx].variantPrice = price;
      rows[idx].rrpSource = source;
      rows[idx].rrpSourceModel = "perplexity:sonar-pro";
    }
  }
  return rows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!LOVABLE_API_KEY || !ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: "Missing AI credentials (LOVABLE_API_KEY / ANTHROPIC_API_KEY)" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Auth: require a logged-in user
  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = userData.user.id;

  // Service-role client for writing parse_jobs
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const fileBase64: string | undefined = body?.fileBase64;
  const supplierName: string = (body?.supplierName || "Unknown supplier").toString();
  const mimeType: string = body?.mimeType || "application/pdf";
  const inputFilename: string | null = body?.inputFilename || null;
  const inputFileRef: string | null = body?.inputFileRef || null;
  const source: string | null = body?.source || null;

  if (!fileBase64 || typeof fileBase64 !== "string") {
    return new Response(JSON.stringify({ error: "fileBase64 (string) is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Create job row
  const { data: jobRow, error: jobErr } = await admin
    .from("parse_jobs")
    .insert({
      user_id: userId,
      supplier_name: supplierName,
      source,
      input_file_ref: inputFileRef,
      input_filename: inputFilename,
      input_mime_type: mimeType,
      status: "processing",
    })
    .select("id")
    .single();

  if (jobErr || !jobRow) {
    return new Response(JSON.stringify({ error: `Failed to create parse job: ${jobErr?.message}` }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const jobId = jobRow.id;

  try {
    // Stage 1
    const stage1Rows = await stage1Gemini(fileBase64, mimeType, supplierName);
    const { level: confidence, completeness } = computeConfidence(stage1Rows);
    await admin
      .from("parse_jobs")
      .update({
        stage1_output: stage1Rows,
        confidence,
        field_completeness: completeness,
      })
      .eq("id", jobId);

    // Stage 2
    const stage2Rows = await stage2Claude(stage1Rows, supplierName);
    await admin.from("parse_jobs").update({ stage2_output: stage2Rows }).eq("id", jobId);

    // Stage 3
    const stage3Rows = await stage3Perplexity(stage2Rows, supplierName);
    await admin
      .from("parse_jobs")
      .update({
        stage3_output: stage3Rows,
        output_rows: stage3Rows,
        status: "done",
      })
      .eq("id", jobId);

    return new Response(
      JSON.stringify({
        jobId,
        confidence,
        fieldCompleteness: completeness,
        rows: stage3Rows,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (err: any) {
    const message = err?.message || String(err);
    await admin
      .from("parse_jobs")
      .update({ status: "failed", error_message: message })
      .eq("id", jobId);
    console.error("parse-invoice failed:", message);
    return new Response(JSON.stringify({ error: message, jobId }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
