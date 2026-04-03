/**
 * Shopify Mandatory Compliance Webhooks
 * Required for Shopify App Store approval.
 *
 * Handles three compliance topics:
 *   - customers/data_request
 *   - customers/redact
 *   - shop/redact
 *
 * Single endpoint — the topic is detected from the X-Shopify-Topic header.
 */

const SHOPIFY_API_SECRET = Deno.env.get("SHOPIFY_API_SECRET")!;

// ─── HMAC verification ───────────────────────────────────────────────
// Shopify signs every webhook with HMAC-SHA256 using your app's API secret.
// The signature is sent in the X-Shopify-Hmac-Sha256 header (base64-encoded).
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
  const computed = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return computed === hmacHeader;
}

// ─── Topic handlers ──────────────────────────────────────────────────

/**
 * customers/data_request
 * Shopify sends this when a customer requests their data.
 * TODO: Query your database for any data associated with the customer
 *       (orders, profiles, etc.) and prepare it for export / review.
 */
function handleCustomersDataRequest(payload: Record<string, unknown>) {
  const shopDomain = payload.shop_domain;
  const customer = payload.customer as Record<string, unknown> | undefined;
  console.log(
    `[customers/data_request] Shop: ${shopDomain}, Customer ID: ${customer?.id}`
  );
  // ──────────────────────────────────────────────────────
  // PLACEHOLDER: Export relevant customer/order data here.
  // Example:
  //   const data = await supabase.from("orders")
  //     .select("*")
  //     .eq("shopify_customer_id", customer?.id);
  //   // Send data to the shop owner or store for later retrieval
  // ──────────────────────────────────────────────────────
}

/**
 * customers/redact
 * Shopify sends this when a store must redact/delete a customer's data.
 * TODO: Delete or anonymize all personally-identifiable customer data
 *       where legally allowed (keep transaction records if required by law).
 */
function handleCustomersRedact(payload: Record<string, unknown>) {
  const shopDomain = payload.shop_domain;
  const customer = payload.customer as Record<string, unknown> | undefined;
  console.log(
    `[customers/redact] Shop: ${shopDomain}, Customer ID: ${customer?.id}`
  );
  // ──────────────────────────────────────────────────────
  // PLACEHOLDER: Redact/delete customer data here.
  // Example:
  //   await supabase.from("customer_profiles")
  //     .delete()
  //     .eq("shopify_customer_id", customer?.id);
  // ──────────────────────────────────────────────────────
}

/**
 * shop/redact
 * Shopify sends this 48 hours after a store uninstalls your app.
 * TODO: Delete all data associated with this shop from your database.
 */
function handleShopRedact(payload: Record<string, unknown>) {
  const shopDomain = payload.shop_domain;
  console.log(`[shop/redact] Shop: ${shopDomain}`);
  // ──────────────────────────────────────────────────────
  // PLACEHOLDER: Delete all shop data here.
  // Example:
  //   await supabase.from("shopify_connections")
  //     .delete()
  //     .eq("store_url", shopDomain);
  //   await supabase.from("shopify_push_history")
  //     .delete()
  //     .eq("store_url", shopDomain);
  // ──────────────────────────────────────────────────────
}

// ─── Main handler ────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Only accept POST
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const rawBody = await req.text();

  // ── HMAC verification step ──
  const hmacHeader = req.headers.get("x-shopify-hmac-sha256");
  const valid = await verifyShopifyHmac(rawBody, hmacHeader);
  if (!valid) {
    console.warn("Webhook HMAC verification failed");
    return new Response("Unauthorized", { status: 401 });
  }

  // ── Detect compliance topic from header ──
  const topic = req.headers.get("x-shopify-topic") || "";
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  console.log(`Received Shopify webhook: ${topic}`);

  switch (topic) {
    case "customers/data_request":
      handleCustomersDataRequest(payload);
      break;
    case "customers/redact":
      handleCustomersRedact(payload);
      break;
    case "shop/redact":
      handleShopRedact(payload);
      break;
    default:
      console.warn(`Unknown compliance topic: ${topic}`);
      // Still return 200 to avoid Shopify retries
      break;
  }

  // Return 200 quickly as required by Shopify
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
