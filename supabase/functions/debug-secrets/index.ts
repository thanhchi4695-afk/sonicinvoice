const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const allKeys = Object.keys(Deno.env.toObject()).sort();
  return new Response(
    JSON.stringify({
      ANTHROPIC_API_KEY: !!Deno.env.get("ANTHROPIC_API_KEY"),
      AZURE_DOCUMENT_INTELLIGENCE_KEY: !!Deno.env.get("AZURE_DOCUMENT_INTELLIGENCE_KEY"),
      AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: !!Deno.env.get("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT"),
      SUPABASE_URL: !!Deno.env.get("SUPABASE_URL"),
      SUPABASE_SERVICE_ROLE_KEY: !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
      LOVABLE_API_KEY: !!Deno.env.get("LOVABLE_API_KEY"),
      all_env_keys: allKeys,
    }, null, 2),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
