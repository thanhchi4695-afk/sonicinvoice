import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUser = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { action, platform, params } = await req.json();

    if (platform === "joor") {
      const { data: conn } = await supabase
        .from("wholesale_connections")
        .select("credentials")
        .eq("user_id", user.id)
        .eq("platform", "joor")
        .single();

      if (!conn?.credentials?.oauth_token) {
        return new Response(
          JSON.stringify({ error: "No JOOR connection found. Please connect your JOOR account first." }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const joorAuth = `OAuth2 ${btoa(conn.credentials.oauth_token)}`;
      const joorBase = "https://api.jooraccess.com/v2";

      const endpoints: Record<string, string> = {
        get_orders: `/order/?sync=0&count=${params?.count || 100}&start=${params?.start || 0}&order_type=6`,
        get_order: `/order/${params?.order_id}`,
        get_style: `/style/${params?.style_id}`,
        mark_exported: `/order/?sync=1&count=1&order_id=${params?.order_id}&order_type=6`,
        test: `/order/?sync=0&count=1&order_type=6`,
      };

      const path = endpoints[action];
      if (!path) {
        return new Response(
          JSON.stringify({ error: "Unknown JOOR action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const resp = await fetch(`${joorBase}${path}`, {
        headers: {
          Authorization: joorAuth,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });

      if (!resp.ok) {
        const text = await resp.text();
        return new Response(
          JSON.stringify({ error: `JOOR API error ${resp.status}: ${text}` }),
          { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await resp.json();
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (platform === "faire") {
      const { data: conn } = await supabase
        .from("wholesale_connections")
        .select("credentials")
        .eq("user_id", user.id)
        .eq("platform", "faire")
        .single();

      if (!conn?.credentials?.api_key) {
        return new Response(
          JSON.stringify({ error: "No Faire connection found. Please connect your Faire account first." }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const faireBase = "https://www.faire.com/api/v2";
      const faireEndpoints: Record<string, string> = {
        get_orders: "/orders?state=NEW&state=IN_PROGRESS",
        test: "/brand",
      };

      const path = faireEndpoints[action] || `/${action}`;
      const resp = await fetch(`${faireBase}${path}`, {
        headers: {
          "X-FAIRE-ACCESS-TOKEN": conn.credentials.api_key,
          Accept: "application/json",
        },
      });

      if (!resp.ok) {
        const text = await resp.text();
        return new Response(
          JSON.stringify({ error: `Faire API error ${resp.status}: ${text}` }),
          { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await resp.json();
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ error: `Unknown platform: ${platform}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Wholesale proxy error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
