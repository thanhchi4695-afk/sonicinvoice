// Sonic invoice question — answers questions about the user's most recent parsed invoice.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Product {
  brand?: string;
  name?: string;
  sku?: string;
  colour?: string;
  size?: string;
  type?: string;
  qty?: number;
  cost?: number;
  rrp?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { question = "" } = await req.json();
    if (!question || typeof question !== "string") {
      return new Response(JSON.stringify({ error: "question required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supaUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Most recent successful invoice parse
    const { data: jobs, error } = await supabase
      .from("invoice_processing_jobs")
      .select("id, file_name, result, completed_at, created_at")
      .eq("user_id", user.id)
      .eq("job_kind", "invoice_read")
      .eq("status", "done")
      .order("completed_at", { ascending: false, nullsFirst: false })
      .limit(1);

    if (error) throw error;
    const job = jobs?.[0];
    const products: Product[] = Array.isArray(job?.result?.products) ? job.result.products : [];

    if (!job || products.length === 0) {
      return new Response(
        JSON.stringify({
          answer:
            "I don't have a recent invoice loaded. Upload or parse one first and I can answer questions about it.",
          no_invoice: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Slim down products for the prompt
    const slim = products.map((p) => ({
      brand: p.brand ?? "",
      style_name: p.name ?? "",
      sku: p.sku ?? "",
      colour: p.colour ?? "",
      size: p.size ?? "",
      type: p.type ?? "",
      qty: Number(p.qty ?? 0),
      cost: Number(p.cost ?? 0),
      rrp: Number(p.rrp ?? 0),
    }));

    const totalCost = slim.reduce((s, p) => s + p.cost * p.qty, 0);
    const totalRrp = slim.reduce((s, p) => s + p.rrp * p.qty, 0);
    const totalUnits = slim.reduce((s, p) => s + p.qty, 0);
    const uniqueStyles = new Set(slim.map((p) => (p.style_name || p.sku || "").toLowerCase())).size;
    const uniqueBrands = [...new Set(slim.map((p) => p.brand).filter(Boolean))];

    const summary = {
      file_name: job.file_name ?? "",
      line_count: slim.length,
      total_units: totalUnits,
      unique_styles: uniqueStyles,
      brands: uniqueBrands,
      total_cost: Number(totalCost.toFixed(2)),
      total_rrp: Number(totalRrp.toFixed(2)),
    };

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const sys =
      "You are an assistant with access to a retailer's invoice data. Answer questions about the invoice concisely and accurately. Numbers should be formatted with $ and 2 decimal places for prices, whole numbers for quantities. Keep answers to 1–3 sentences unless a list is needed. When listing items use simple markdown bullet points (- ). Australian English. Do not invent data — if the answer isn't in the data say so.";

    const userPrompt = [
      `Invoice file: ${summary.file_name}`,
      `Pre-computed totals: ${JSON.stringify(summary)}`,
      `Line items (JSON): ${JSON.stringify(slim)}`,
      `Question: ${question}`,
    ].join("\n\n");

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 700,
        system: sys,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("Anthropic error:", resp.status, t);
      return new Response(JSON.stringify({ error: `Claude error ${resp.status}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const answer = String(data?.content?.[0]?.text ?? "").trim();

    return new Response(
      JSON.stringify({ answer, summary, file_name: summary.file_name }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("sonic-invoice-question error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
