// Generates a structured "skills file" (markdown) for a given supplier using
// Claude. Pulls the supplier's correction history from `correction_log` and
// learned patterns from `supplier_intelligence` / `invoice_patterns` and asks
// Claude to write a markdown rule-book. The result is returned to the client
// — the client decides whether to save it to `supplier_skills`.

import { createClient } from "npm:@supabase/supabase-js@2";
import { callAI, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ error: "Missing Authorization" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const supplierName = String(body?.supplier_name || "").trim();
    if (!supplierName) return json({ error: "supplier_name is required" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    // 1. Pull correction history (best-effort across the tables that store it).
    const [corrLog, intel, patterns, profile, learnedHints] = await Promise.all([
      admin.from("correction_log")
        .select("field_name, original_value, corrected_value, delta_reason, created_at")
        .eq("user_id", userId)
        .ilike("supplier_name", supplierName)
        .order("created_at", { ascending: false })
        .limit(80)
        .then((r: any) => r).catch(() => ({ data: null })),
      admin.from("supplier_intelligence")
        .select("detected_pattern, column_map, confidence_score, invoice_count, last_correction_rate")
        .eq("user_id", userId)
        .ilike("supplier_name", supplierName)
        .maybeSingle()
        .then((r: any) => r).catch(() => ({ data: null })),
      admin.from("invoice_patterns")
        .select("pattern_signature, sample_text, confidence_score, created_at")
        .eq("user_id", userId)
        .ilike("supplier_name", supplierName)
        .order("created_at", { ascending: false })
        .limit(10)
        .then((r: any) => r).catch(() => ({ data: null })),
      admin.from("supplier_profiles")
        .select("profile_data, currency, confidence_score, invoice_count")
        .eq("user_id", userId)
        .ilike("supplier_name", supplierName)
        .maybeSingle()
        .then((r: any) => r).catch(() => ({ data: null })),
      // user-level historical hints
      admin.rpc("get_supplier_hints", { _supplier: supplierName, _user_id: userId, _limit: 25 })
        .then((r: any) => r).catch(() => ({ data: null })),
    ]);

    const corrections = (corrLog as any).data || [];
    const intelRow = (intel as any).data || null;
    const patternRows = (patterns as any).data || [];
    const profileRow = (profile as any).data || null;
    const hintsText = (learnedHints as any).data || null;

    // 2. Build the prompt context.
    const correctionsBlock = corrections.length
      ? corrections.slice(0, 60).map((c: any) =>
          `- field=${c.field_name}: "${truncate(c.original_value, 80)}" → "${truncate(c.corrected_value, 80)}"${c.delta_reason ? ` (${truncate(c.delta_reason, 60)})` : ""}`,
        ).join("\n")
      : "(no corrections recorded yet)";

    const columnMap = intelRow?.column_map ? JSON.stringify(intelRow.column_map) : "(not learned)";
    const docPattern = intelRow?.detected_pattern || profileRow?.profile_data?.classification?.layout_pattern || "unknown";
    const samplePattern = patternRows[0]?.pattern_signature || "(none)";

    const prompt = `Based on the correction history and learned structure for supplier "${supplierName}", write a STRUCTURED SKILLS FILE in markdown that documents:

(1) Document structure
(2) Size grid format
(3) Cost field rules
(4) Known noise rows to skip
(5) SKU format pattern
(6) Corrections to apply (rules learned from staff edits)

The file MUST be concise, deterministic, and read like an instruction manual for an extraction model. Use bullet points under each section. Do not invent rules that the data does not support — if a section has no evidence, write "(not yet learned)".

## Detected document pattern
${docPattern}

## Column mapping (learned)
${columnMap}

## Pattern signature sample
${samplePattern}

## Correction history (most recent ${corrections.length})
${correctionsBlock}

${hintsText ? `## Aggregated user hints\n${hintsText}\n` : ""}
Write the markdown file now. Output ONLY the markdown — no preamble, no closing remarks.`;

    // 3. Call Claude (with Gemini fallback handled by the shared gateway).
    let markdown = "";
    try {
      const resp = await callAI({
        model: "anthropic/claude-sonnet-4-5",
        max_tokens: 2500,
        messages: [
          { role: "system", content: "You write precise, structured extraction rule books for invoice processing models." },
          { role: "user", content: prompt },
        ],
      });
      markdown = (getContent(resp) || "").trim();
    } catch (err) {
      if (err instanceof AIGatewayError) {
        return json({ error: err.message }, err.status);
      }
      throw err;
    }

    if (!markdown) {
      return json({ error: "Model returned empty skills file. Try again." }, 502);
    }

    return json({
      supplier_name: supplierName,
      skills_markdown: markdown,
      correction_count: corrections.length,
      pattern_count: patternRows.length,
    });
  } catch (err) {
    console.error("[supplier-skills-generate] error:", err);
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function truncate(v: unknown, max: number): string {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
