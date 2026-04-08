/**
 * Shopify Mandatory Compliance Webhooks
 * Required for Shopify App Store approval.
 *
 * Handles all three compliance topics via X-Shopify-Topic header:
 *   - customers/data_request
 *   - customers/redact
 *   - shop/redact
 *
 * HMAC is verified using RAW BYTES (ArrayBuffer) before any text/JSON parsing.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SHOPIFY_API_SECRET = Deno.env.get("SHOPIFY_API_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function getAdminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

// ─── HMAC verification using raw bytes (timing-safe) ─────────────────
async function verifyShopifyHmac(
  rawBytes: Uint8Array,
  hmacHeader: string | null
): Promise<boolean> {
  if (!hmacHeader || !SHOPIFY_API_SECRET) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(SHOPIFY_API_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, rawBytes)
  );

  // Decode the base64 header into bytes
  let expected: Uint8Array;
  try {
    const binaryStr = atob(hmacHeader);
    expected = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      expected[i] = binaryStr.charCodeAt(i);
    }
  } catch {
    return false;
  }

  // Constant-time comparison
  if (signature.byteLength !== expected.byteLength) return false;
  let mismatch = 0;
  for (let i = 0; i < signature.byteLength; i++) {
    mismatch |= signature[i] ^ expected[i];
  }
  return mismatch === 0;
}

// ─── Topic handlers ──────────────────────────────────────────────────

async function handleCustomerDataRequest(shop: string, payload: Record<string, unknown>) {
  const customer = payload.customer as Record<string, unknown> | undefined;
  console.log("customers/data_request received", { shop, customerId: customer?.id });
  // No customer PII stored — nothing to export.
  console.log("customers/data_request: No customer PII stored for shop:", shop);
}

async function handleCustomerRedact(shop: string, payload: Record<string, unknown>) {
  const customer = payload.customer as Record<string, unknown> | undefined;
  console.log("customers/redact received", { shop, customerId: customer?.id });
  // No customer PII stored — nothing to redact.
  console.log("customers/redact: No customer PII stored for shop:", shop);
}

async function handleShopRedact(shop: string, _payload: Record<string, unknown>) {
  console.log("shop/redact — purging all data for shop:", shop);

  const supabase = getAdminClient();
  const tables = [
    { name: "shopify_connections", col: "store_url" },
    { name: "shopify_push_history", col: "store_url" },
    { name: "shopify_subscriptions", col: "shop" },
    { name: "shopify_login_tokens", col: "shop" },
    { name: "shopify_oauth_states", col: "shop" },
  ];

  const errors: string[] = [];
  for (const t of tables) {
    const { error } = await supabase.from(t.name).delete().eq(t.col, shop);
    if (error) errors.push(`${t.name}: ${error.message}`);
  }

  if (errors.length) {
    console.error("shop/redact partial failures:", errors);
  } else {
    console.log("shop/redact: All data purged for shop:", shop);
  }
}

// ─── Main handler ────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Health check
  if (req.method === "GET" && url.pathname.endsWith("/health")) {
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  if (!SHOPIFY_API_SECRET) {
    console.error("SHOPIFY_API_SECRET is not set");
    return new Response("Server misconfigured", { status: 500 });
  }

  // Step 1: Read request body as raw ArrayBuffer
  const rawBytes = new Uint8Array(await req.arrayBuffer());

  // Step 2: Verify HMAC against raw bytes
  const hmacHeader = req.headers.get("x-shopify-hmac-sha256");
  const valid = await verifyShopifyHmac(rawBytes, hmacHeader);
  if (!valid) {
    console.warn("Invalid Shopify webhook HMAC");
    return new Response("Unauthorized", { status: 401 });
  }

  // Step 3: Only NOW decode to text and parse JSON
  const decoder = new TextDecoder();
  const rawText = decoder.decode(rawBytes);

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawText);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // Step 4: Route by topic
  const topic = req.headers.get("x-shopify-topic") || "";
  const shop = req.headers.get("x-shopify-shop-domain") || "";
  console.log("Privacy webhook:", { topic, shop });

  switch (topic) {
    case "customers/data_request":
      await handleCustomerDataRequest(shop, payload);
      break;
    case "customers/redact":
      await handleCustomerRedact(shop, payload);
      break;
    case "shop/redact":
      await handleShopRedact(shop, payload);
      break;
    default:
      console.warn("Unhandled topic:", topic);
      break;
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
