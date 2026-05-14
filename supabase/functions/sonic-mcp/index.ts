// ══════════════════════════════════════════════════════════
// Sonic Invoices — MCP Server (day-1 MVP)
//
// Lets Claude.ai (or any MCP client) connect to a user's
// Sonic Invoices account via a per-user bearer token.
//
// Tools (read-only for v1):
//   - get_store_context   → Shopify store, voice, brand list
//   - get_collections     → Suggested collections + SEO score
//   - get_gap_results     → Latest competitor-gap results
//
// Auth model:
//   Authorization: Bearer <raw_token>
//   token_hash = SHA-256(raw_token), stored in sonic_mcp_tokens.
//
// IMPORTANT: this function deploys with verify_jwt = false
// (Claude.ai cannot send a Supabase JWT). We validate the
// bearer token IN CODE via verify_sonic_mcp_token RPC.
// ══════════════════════════════════════════════════════════
import { Hono } from "npm:hono@4";
import { McpServer, StreamableHttpTransport } from "npm:mcp-lite@^0.10.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, mcp-session-id",
  "Access-Control-Expose-Headers": "mcp-session-id",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Service-role client used only for verify/touch RPCs and server-scoped reads.
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function resolveUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const hash = await sha256Hex(m[1].trim());
  const { data, error } = await admin.rpc("verify_sonic_mcp_token", {
    _token_hash: hash,
  });
  if (error || !data) return null;
  // fire-and-forget last_used_at bump
  admin.rpc("touch_sonic_mcp_token", { _token_hash: hash }).then(() => {});
  return data as string;
}

// ── MCP server + tools ──────────────────────────────────────
const mcp = new McpServer({
  name: "sonic-invoices",
  version: "0.1.0",
});

mcp.tool({
  name: "get_store_context",
  description:
    "Returns the connected Shopify store, brand voice style, and a list of known brands for the current Sonic Invoices user.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  handler: async (_args, ctx) => {
    const userId = (ctx as any)?.extra?.userId as string | undefined;
    if (!userId) return { content: [{ type: "text", text: "Unauthorized" }] };

    const [{ data: shop }, { data: brands }] = await Promise.all([
      admin
        .from("shopify_connections")
        .select("store_url, shop_name, brand_voice_style, product_status")
        .eq("user_id", userId)
        .maybeSingle(),
      admin
        .from("brand_profiles")
        .select("brand_name")
        .eq("user_id", userId)
        .limit(50),
    ]);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          shopify: shop ?? null,
          brands: (brands ?? []).map((b: any) => b.brand_name),
        }, null, 2),
      }],
    };
  },
});

mcp.tool({
  name: "get_collections",
  description:
    "Lists the user's Sonic-suggested Shopify collections with their SEO completeness score. Optionally filter by status (pending|approved|published) or minimum completeness.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["pending", "approved", "published"] },
      min_completeness: { type: "number", minimum: 0, maximum: 100 },
      limit: { type: "number", minimum: 1, maximum: 100, default: 25 },
    },
    additionalProperties: false,
  },
  handler: async (args: any, ctx) => {
    const userId = (ctx as any)?.extra?.userId as string | undefined;
    if (!userId) return { content: [{ type: "text", text: "Unauthorized" }] };

    let q = admin
      .from("collection_suggestions")
      .select(
        "id, suggested_title, shopify_handle, status, product_count, completeness_score, completeness_breakdown, collection_type",
      )
      .eq("user_id", userId)
      .order("completeness_score", { ascending: true })
      .limit(Math.min(Number(args?.limit) || 25, 100));

    if (args?.status) q = q.eq("status", args.status);
    if (typeof args?.min_completeness === "number") {
      q = q.gte("completeness_score", args.min_completeness);
    }

    const { data, error } = await q;
    if (error) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  },
});

mcp.tool({
  name: "get_gap_results",
  description:
    "Returns the most recent competitor gap-analysis cards (collections this store is missing vs competitors).",
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", minimum: 1, maximum: 50, default: 10 },
    },
    additionalProperties: false,
  },
  handler: async (args: any, ctx) => {
    const userId = (ctx as any)?.extra?.userId as string | undefined;
    if (!userId) return { content: [{ type: "text", text: "Unauthorized" }] };

    const { data, error } = await admin
      .from("collection_suggestions")
      .select(
        "id, suggested_title, suggested_handle, collection_type, product_count, confidence_score, sample_titles, status, created_at",
      )
      .eq("user_id", userId)
      .eq("status", "pending")
      .order("confidence_score", { ascending: false })
      .limit(Math.min(Number(args?.limit) || 10, 50));

    if (error) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  },
});

// ── HTTP transport ─────────────────────────────────────────
const transport = new StreamableHttpTransport();
const app = new Hono();

app.options("*", (c) => {
  return new Response("ok", { headers: corsHeaders });
});

app.all("*", async (c) => {
  const userId = await resolveUserId(c.req.raw);
  if (!userId) {
    return new Response(
      JSON.stringify({ error: "Unauthorized — missing or invalid bearer token" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  // Pass userId through to tool handlers via the transport's extra context.
  const res = await transport.handleRequest(c.req.raw, mcp, { userId });
  // Merge CORS headers into the streamed response.
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
});

Deno.serve(app.fetch);
