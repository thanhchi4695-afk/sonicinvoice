import { callAI, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UPDATE_PROMPT = `You are an expert Australian fashion retail invoice analyst.

You are given:
1. An EXISTING supplier invoice profile (JSON)
2. A list of USER CORRECTIONS made during invoice review

Your job: merge the corrections into the existing profile to make it more accurate for future extractions.

RULES:
- If a correction contradicts an existing rule, UPDATE the rule
- If a correction reveals a NEW pattern, ADD it
- Add new colour abbreviations to colour_abbreviations
- Add new noise patterns to noise_patterns
- Update column_mappings if the user corrected field mappings
- Update product_name_rules, colour_rules, size_rules if corrections reveal naming patterns
- Add new examples from corrected data
- Increment confidence where patterns are confirmed
- Keep ALL existing data that wasn't contradicted

OUTPUT ONLY the updated JSON profile (same schema as input). No markdown fences, no explanation.`;

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
