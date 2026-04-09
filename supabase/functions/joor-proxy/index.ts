import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const JOOR_BASE_URL = "https://api.jooraccess.com/v2";

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

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
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

    const { data: conn } = await supabase
      .from("joor_connections")
      .select("oauth_token, token_label")
      .eq("user_id", user.id)
      .single();

    if (!conn?.oauth_token) {
      return new Response(
        JSON.stringify({ error: "No JOOR connection found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { action, params } = body;

    const joorAuth = `OAuth2 ${btoa(conn.oauth_token)}`;

    const joorFetch = async (path: string) => {
      const res = await fetch(`${JOOR_BASE_URL}${path}`, {
        headers: {
          "Authorization": joorAuth,
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`JOOR API error ${res.status}: ${text}`);
      }
      return res.json();
    };

    let result: unknown;

    switch (action) {
      case "test_connection": {
        result = await joorFetch("/order/?sync=0&count=1&order_type=6");
        break;
      }
      case "get_orders": {
        const count = params?.count || 100;
        const start = params?.start || 0;
        result = await joorFetch(
          `/order/?sync=0&count=${count}&start=${start}&order_type=6`
        );
        break;
      }
      case "get_order": {
        if (!params?.order_id) throw new Error("order_id required");
        result = await joorFetch(`/order/${params.order_id}`);
        break;
      }
      case "get_style": {
        if (!params?.style_id) throw new Error("style_id required");
        result = await joorFetch(`/style/${params.style_id}`);
        break;
      }
      case "mark_exported": {
        if (!params?.order_id) throw new Error("order_id required");
        await joorFetch(
          `/order/?sync=1&count=1&order_id=${params.order_id}&order_type=6`
        );
        result = { success: true };
        break;
      }
      default:
        return new Response(
          JSON.stringify({ error: "Unknown action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("JOOR proxy error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
