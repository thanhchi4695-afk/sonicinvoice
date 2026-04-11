import { callAI, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UPDATE_PROMPT = `You are the Sonic Invoices Learning Engine — an expert Australian fashion retail invoice analyst.

You are given:
1. An EXISTING supplier invoice profile (JSON) — or null if first time
2. A list of USER CORRECTIONS comparing original AI extraction vs user-corrected version
3. The supplier name

=== LEARNING RULES ===
1. Compare every corrected field (product_name, colour, size, unit_cost, quantity, etc.).
2. Identify PATTERNS that explain the corrections — don't just memorise individual fixes.
3. Strengthen or add new rules in column_mappings, product_name_cleaning_rules, variant_rules, and abbreviations.
4. Add 1-2 new high-quality examples from the corrected data.
5. NEVER remove existing good rules — only add, refine, or increase confidence.
6. Be conservative but precise. Only make changes clearly supported by corrections.
7. Prioritise rules that prevent the SAME mistake in future invoices.
8. Keep the profile focused on fashion retail patterns (sizes, colours, style numbers).
9. If no meaningful corrections were made, increment total_invoices_analysed and slightly increase confidence.

=== OUTPUT FORMAT (strict JSON, no markdown fences, no explanation) ===
{
  "supplier": "Same supplier name",
  "profile_version": "YYYY-MM-DD-vN",
  "total_invoices_analysed": previous + 1,
  "invoice_layout": "keep or update layout description",
  "column_mappings": { "...previous + new/improved mappings..." },
  "product_name_cleaning_rules": ["...previous + new rules from corrections..."],
  "variant_rules": "Updated rule explaining how sizes/colours should be handled",
  "abbreviations": { "...previous + new discovered abbreviations..." },
  "examples": ["...keep best previous + add 1-2 new from this invoice..."],
  "confidence": number_0_to_100,
  "notes_for_future": "Summary of what was learned",
  "last_refined_at": "ISO timestamp",
  "refinements_made": ["list of specific changes made in this update"]
}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { existingProfile, corrections, supplierName } = await req.json();

    if (!corrections || !Array.isArray(corrections) || corrections.length === 0) {
      return new Response(
        JSON.stringify({ error: "No corrections provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const profileText = existingProfile
      ? JSON.stringify(existingProfile, null, 2)
      : `{"supplier": "${supplierName || "Unknown"}", "column_mappings": {}, "noise_patterns": [], "colour_abbreviations": {}, "examples": []}`;

    const correctionsText = corrections.map((c: Record<string, unknown>, i: number) =>
      `${i + 1}. [${c.type}] field="${c.field}" | original="${c.original}" → corrected="${c.corrected}" | reason="${c.reason || "user correction"}"`
    ).join("\n");

    const data = await callAI({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: UPDATE_PROMPT },
        {
          role: "user",
          content: `EXISTING PROFILE:\n${profileText}\n\nUSER CORRECTIONS (${corrections.length} total):\n${correctionsText}\n\nMerge these corrections and return the UPDATED profile JSON.`,
        },
      ],
      temperature: 0.1,
    });

    const content = getContent(data);
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
    const jsonStr = (jsonMatch[1] || content).trim();
    const updatedProfile = JSON.parse(jsonStr);

    return new Response(
      JSON.stringify({ profile: updatedProfile, corrections_applied: corrections.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Profile update error:", error);
    const status = error instanceof AIGatewayError ? error.status : 500;
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Profile update failed" }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
