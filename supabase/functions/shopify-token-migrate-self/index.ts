// Performs an on-demand Shopify token auto-migration for the calling user's
// own connection. Returns success/failure plus the new expiry metadata.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  ensureValidToken,
  ShopifyReauthRequiredError,
  type ShopifyConnectionRow,
} from "../_shared/shopify-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing Authorization" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Identify caller via their JWT.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "Not authenticated" }, 401);
    }
    const userId = userData.user.id;

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: conn, error: connErr } = await admin
      .from("shopify_connections")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (connErr || !conn) {
      return json({ error: "No Shopify connection found for this user" }, 404);
    }

    const beforeHadExpiry = !!conn.token_expires_at;
    const beforeHadRefresh = !!conn.refresh_token;

    try {
      const result = await ensureValidToken(admin, conn as ShopifyConnectionRow);
      return json({
        success: true,
        shop: result.storeUrl,
        already_migrated: beforeHadExpiry && beforeHadRefresh,
        token_expires_at: result.conn.token_expires_at,
        refresh_token_expires_at: result.conn.refresh_token_expires_at,
        has_refresh: !!result.conn.refresh_token,
      });
    } catch (err) {
      if (err instanceof ShopifyReauthRequiredError) {
        return json(
          {
            success: false,
            needs_reauth: true,
            shop: conn.store_url,
            error:
              "Shopify refresh token has expired. Please reconnect your store.",
          },
          200,
        );
      }
      throw err;
    }
  } catch (err) {
    console.error("[shopify-token-migrate-self] error", err);
    return json({ success: false, error: String(err?.message ?? err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
