/**
 * Shopify Mandatory Compliance Webhooks
 * Required for Shopify App Store approval.
 *
 * Handles all three compliance topics via X-Shopify-Topic header:
 *   - customers/data_request
 *   - customers/redact
 *   - shop/redact
 *
 * HMAC is verified using the raw body + SHOPIFY_API_SECRET
 * before any JSON parsing occurs.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SHOPIFY_API_SECRET = Deno.env.get("SHOPIFY_API_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function getAdminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

// ─── HMAC verification (timing-safe) ────────────────────────────────
// Shopify signs every webhook with HMAC-SHA256 using your app's API secret.
// The signature is in X-Shopify-Hmac-Sha256 (base64-encoded).
// We compare raw HMAC bytes using a constant-time loop to prevent timing attacks.
async function verifyShopifyHmac(
  rawBody: string,
  hmacHeader: string | null
): Promise<boolean> {
  if (!hmacHeader) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(SHOPIFY_API_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const computed = new Uint8Array(signature);

  // Decode the base64 header into bytes for raw comparison
  let expected: Uint8Array;
  try {
    const binaryStr = atob(hmacHeader);
    expected = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      expected[i] = binaryStr.charCodeAt(i);
    }
  } catch {
    return false; // invalid base64
  }

  // Constant-time comparison on raw bytes
  if (computed.byteLength !== expected.byteLength) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.byteLength; i++) {
    mismatch |= computed[i] ^ expected[i];
  }
  return mismatch === 0;
}

// ─── Topic handlers ──────────────────────────────────────────────────

/**
 * customers/data_request
 * Shopify sends this when a customer requests their data under GDPR/CCPA.
 *
 * TODO (replace placeholder):
 *   1. Look up all data stored for this customer/shop
 *   2. Export or compile it for manual review / compliance workflow
 *   3. Notify your support/compliance inbox if needed
 */
async function handleCustomerDataRequest(shop: string, payload: Record<string, unknown>) {
  const customer = payload.customer as Record<string, unknown> | undefined;
  console.log("Handle customers/data_request", {
    shop,
    customerId: customer?.id,
    ordersRequested: payload.orders_requested,
  });

  // Example placeholder:
  // const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  // await supabase.from("privacy_requests").insert({
  //   type: "customers/data_request",
  //   shop,
  //   customer_id: customer?.id,
  //   payload,
  //   status: "pending"
  // });
}

/**
 * customers/redact
 * Shopify sends this when a store must redact/delete a customer's data.
 *
 * TODO (replace placeholder):
 *   1. Find all data stored for this customer
 *   2. Delete or anonymize it unless legally required to retain
 */
async function handleCustomerRedact(shop: string, payload: Record<string, unknown>) {
  const customer = payload.customer as Record<string, unknown> | undefined;
  console.log("Handle customers/redact", {
    shop,
    customerId: customer?.id,
  });

  // Example placeholder:
  // const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  // if (customer?.id) {
  //   await supabase.from("customer_data").delete()
  //     .eq("shop", shop).eq("shopify_customer_id", customer.id);
  // }
}

/**
 * shop/redact
 * Shopify sends this 48 hours after a store uninstalls your app.
 *
 * TODO (replace placeholder):
 *   1. Delete shop-level data (tokens, cached files, settings, analytics)
 *   2. Remove all stored data for this shop where legally allowed
 */
async function handleShopRedact(shop: string, payload: Record<string, unknown>) {
  console.log("Handle shop/redact", { shop, payload });

  // Example placeholder:
  // const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  // await supabase.from("shopify_connections").delete().eq("store_url", shop);
  // await supabase.from("shopify_push_history").delete().eq("store_url", shop);
}

// ─── Main handler ────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Health check endpoint
  if (req.method === "GET" && url.pathname.endsWith("/health")) {
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Only accept POST for webhook processing
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Check server config
  if (!SHOPIFY_API_SECRET) {
    console.error("Missing SHOPIFY_API_SECRET");
    return new Response("Server misconfigured", { status: 500 });
  }

  // Step 1: Read raw body BEFORE parsing (same as express.raw())
  const rawBody = await req.text();

  // Step 2: Verify HMAC — return 401 if invalid
  const hmacHeader = req.headers.get("x-shopify-hmac-sha256");
  const valid = await verifyShopifyHmac(rawBody, hmacHeader);
  if (!valid) {
    console.warn("Invalid Shopify webhook HMAC");
    return new Response("Unauthorized", { status: 401 });
  }

  // Step 3: Parse JSON only AFTER HMAC verification passes
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // Step 4: Read topic and shop from Shopify headers
  const topic = req.headers.get("x-shopify-topic") || "";
  const shop = req.headers.get("x-shopify-shop-domain") || "";

  console.log("Privacy webhook received:", { topic, shop });

  // Step 5: Handle compliance topics
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
      console.warn(`Unhandled privacy webhook topic: ${topic}`);
      break;
  }

  // Step 6: Respond 200 quickly as required by Shopify
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
