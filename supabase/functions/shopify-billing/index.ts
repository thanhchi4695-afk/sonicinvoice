/**
 * Shopify Billing API
 * 
 * Creates app subscriptions using the Shopify GraphQL Admin API.
 * Handles plan creation, status checks, and cancellation.
 * 
 * Actions:
 *   create  — Create a new subscription (returns confirmation URL)
 *   status  — Check current billing status
 *   cancel  — Cancel the current subscription (not implemented yet)
 *
 * Uses Shopify's appSubscriptionCreate mutation.
 * Billing is only triggered after merchant approval via the confirmation URL.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { ensureValidToken, ShopifyReauthRequiredError, type ShopifyConnectionRow } from "../_shared/shopify-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Plan configuration — 3 tiers, AUD pricing
const PLANS: Record<string, {
  name: string; handle: string; price: number;
  currency: string; trialDays: number; interval: string; test: boolean;
}> = {
  starter: {
    name: "Starter",
    handle: "starter",
    price: 29.00,
    currency: "AUD",
    trialDays: 14,
    interval: "EVERY_30_DAYS",
    test: false,
  },
  pro: {
    name: "Pro",
    handle: "pro",
    price: 59.00,
    currency: "AUD",
    trialDays: 14,
    interval: "EVERY_30_DAYS",
    test: false,
  },
  growth: {
    name: "Growth",
    handle: "growth",
    price: 99.00,
    currency: "AUD",
    trialDays: 14,
    interval: "EVERY_30_DAYS",
    test: false,
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Authenticate user via Supabase JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
    if (!anonKey) {
      return new Response(JSON.stringify({ error: "Server misconfigured: missing anon key" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabaseUser = createClient(SUPABASE_URL, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get Shopify connection
    const { data: conn } = await supabaseAdmin
      .from("shopify_connections")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (!conn) {
      return new Response(JSON.stringify({
        has_subscription: false,
        plan_name: null,
        status: "not_connected",
        connected: false,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const action = body.action || "status";
    const { store_url, access_token, api_version } = conn;
    const graphqlUrl = `https://${store_url}/admin/api/${api_version}/graphql.json`;

    const shopifyGraphQL = async (query: string, variables?: Record<string, unknown>) => {
      const resp = await fetch(graphqlUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": access_token,
        },
        body: JSON.stringify({ query, variables }),
      });
      return resp.json();
    };

    // ── ACTION: status — Check current billing status ──
    if (action === "status") {
      // Check local subscription record
      const { data: sub } = await supabaseAdmin
        .from("shopify_subscriptions")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (sub && sub.status === "active") {
        return new Response(JSON.stringify({
          has_subscription: true,
          plan_name: sub.plan_name,
          status: sub.status,
          trial_ends_at: sub.trial_ends_at,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Also check with Shopify directly
      const result = await shopifyGraphQL(`
        query {
          currentAppInstallation {
            activeSubscriptions {
              id
              name
              status
              trialDays
              currentPeriodEnd
              test
            }
          }
        }
      `);

      const subscriptions = result.data?.currentAppInstallation?.activeSubscriptions || [];
      const activeSub = subscriptions.find((s: { status: string }) => 
        s.status === "ACTIVE" || s.status === "ACCEPTED"
      );

      if (activeSub) {
        // Sync to local DB
        await supabaseAdmin.from("shopify_subscriptions").upsert({
          user_id: user.id,
          shop: store_url,
          plan_name: activeSub.name || "Starter",
          shopify_subscription_id: activeSub.id,
          status: "active",
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });

        return new Response(JSON.stringify({
          has_subscription: true,
          plan_name: activeSub.name,
          status: "active",
          shopify_status: activeSub.status,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        has_subscription: false,
        plan_name: null,
        status: "none",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ACTION: create — Create new subscription ──
    if (action === "create") {
      const planKey = body.plan || "starter";
      const billing = PLANS[planKey] || PLANS.starter;
      const returnUrl = body.return_url || `https://${store_url}/admin/apps`;
      const isTest = body.test !== undefined ? body.test : billing.test;

      const result = await shopifyGraphQL(`
        mutation appSubscriptionCreate($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!, $trialDays: Int, $test: Boolean) {
          appSubscriptionCreate(
            name: $name
            lineItems: $lineItems
            returnUrl: $returnUrl
            trialDays: $trialDays
            test: $test
          ) {
            appSubscription {
              id
              status
            }
            confirmationUrl
            userErrors {
              field
              message
            }
          }
        }
      `, {
        name: billing.name,
        returnUrl,
        trialDays: billing.trialDays,
        test: isTest,
        lineItems: [{
          plan: {
            appRecurringPricingDetails: {
              price: {
                amount: billing.price,
                currencyCode: billing.currency,
              },
              interval: billing.interval,
            },
          },
        }],
      });

      const createResult = result.data?.appSubscriptionCreate;
      
      if (createResult?.userErrors?.length > 0) {
        return new Response(JSON.stringify({
          error: createResult.userErrors.map((e: { message: string }) => e.message).join(", "),
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Save pending subscription
      if (createResult?.appSubscription?.id) {
        await supabaseAdmin.from("shopify_subscriptions").upsert({
          user_id: user.id,
          shop: store_url,
          plan_name: billing.name,
          shopify_subscription_id: createResult.appSubscription.id,
          status: "pending",
          trial_ends_at: new Date(Date.now() + billing.trialDays * 24 * 60 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
      }

      return new Response(JSON.stringify({
        confirmation_url: createResult?.confirmationUrl,
        subscription_id: createResult?.appSubscription?.id,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Billing error:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Unknown error" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
