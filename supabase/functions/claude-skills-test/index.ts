// Quick "Test this skill" endpoint for the Skills Library UI.
// Sends the supplied skill markdown + a sample user task to Claude and
// returns the model's response so the merchant can see how their rules
// influence output.
import { callAI, getContent } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SAMPLE_TASKS: Record<string, string> = {
  extraction:
    "Extract the brand and a clean product title from this invoice line: 'BAKU SWIMWEAR — Kokomo Ultra High Pant — Black — Size 10 — Qty 2 — RRP $129.95'. Return JSON: { brand, product_title }.",
  enrichment:
    "Write a 40-80 word product description for: Brand 'Baku', Product 'Kokomo Ultra High Pant', Type 'Bikini Bottom', Colour 'Black'.",
  seo:
    "Write a Shopify SEO meta title (≤60 chars) and meta description (≤160 chars) for: Baku 'Kokomo Ultra High Pant' bikini bottom in black.",
  pricing:
    "Suggest a retail price for a wholesale cost of AUD $45 (ex-GST). Show your formula and the final ex-GST and inc-GST retail price.",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { skills_markdown, task_type, sample_task } = await req.json();
    const taskKey = String(task_type || "extraction") as keyof typeof SAMPLE_TASKS;
    const userTask = sample_task || SAMPLE_TASKS[taskKey] || SAMPLE_TASKS.extraction;
    const skills = String(skills_markdown || "").trim();

    const systemPrompt = (skills.length > 0
      ? `Apply the following merchant-curated skill file BEFORE answering. Treat its rules as authoritative.\n\n--- BEGIN CLAUDE SKILLS ---\n${skills}\n--- END CLAUDE SKILLS ---\n\n`
      : "") + "You are a helpful retail assistant. Be concise.";

    const res = await callAI({
      model: "anthropic/claude-sonnet-4-5",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userTask },
      ],
      temperature: 0.2,
      max_tokens: 600,
    });

    return new Response(JSON.stringify({
      output: getContent(res),
      sample_task: userTask,
      model: "anthropic/claude-sonnet-4-5",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("claude-skills-test error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
