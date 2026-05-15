// Public endpoint — serves a generated llms.txt as plain text.
// GET /functions/v1/serve-llms-txt?shop=<domain>

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function normaliseDomain(raw: string): string {
  return raw.replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const shop = url.searchParams.get("shop");
  if (!shop) {
    return new Response("Missing ?shop= parameter", {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const domain = normaliseDomain(shop);
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data, error } = await admin
    .from("llms_txt_files")
    .select("content")
    .ilike("shop_domain", domain)
    .maybeSingle();

  if (error || !data) {
    return new Response("# llms.txt not found for this store\n", {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(data.content, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
});
