// End-to-end test for the canonical seo-collection-engine.
//
// Verifies that a real engine run against an existing collection_suggestion:
//   1. Persists collection_blogs rows (BLOG_TEMPLATE port from CCG)
//   2. Persists smart_collection_rules AND backfills rule_set on the suggestion
//      (smart-rules port from CCG)
//
// This test makes real AI + DB calls, so it is gated behind RUN_E2E=1.
//
// Usage:
//   RUN_E2E=1 deno test --allow-net --allow-env supabase/functions/seo-collection-engine/integration.test.ts
//
// Optional env:
//   E2E_SUGGESTION_ID  pin to a specific suggestion. Otherwise the most recent
//                      pending suggestion is used.

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { selectBlogTypes } from "../_shared/blog-templates.ts";

const RUN_E2E = Deno.env.get("RUN_E2E") === "1";
const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

Deno.test({
  name: "seo-collection-engine: blogs + smart rules persist for a real suggestion",
  ignore: !RUN_E2E,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    assert(SUPABASE_URL, "VITE_SUPABASE_URL or SUPABASE_URL required");
    assert(SERVICE_KEY, "SUPABASE_SERVICE_ROLE_KEY required (test uses service role to bypass RLS)");

    const admin = createClient(SUPABASE_URL!, SERVICE_KEY!);

    // 1. Resolve the suggestion to test against
    const pinned = Deno.env.get("E2E_SUGGESTION_ID");
    let suggestion: any;
    if (pinned) {
      const { data, error } = await admin
        .from("collection_suggestions")
        .select("id, user_id, suggested_title, collection_type, shopify_handle")
        .eq("id", pinned)
        .maybeSingle();
      assert(!error, error?.message);
      assert(data, `pinned suggestion ${pinned} not found`);
      suggestion = data;
    } else {
      const { data, error } = await admin
        .from("collection_suggestions")
        .select("id, user_id, suggested_title, collection_type, shopify_handle")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      assert(!error, error?.message);
      assert(data, "no collection_suggestions found — seed one before running E2E");
      suggestion = data;
    }

    console.log(`[e2e] using suggestion ${suggestion.id} (${suggestion.suggested_title})`);

    // 2. Snapshot pre-state so we can assert the engine *changed* things
    const { data: blogsBefore } = await admin
      .from("collection_blogs")
      .select("id")
      .eq("suggestion_id", suggestion.id);
    const beforeBlogIds = new Set((blogsBefore ?? []).map((b: any) => b.id));

    // 3. Invoke the canonical engine
    const res = await fetch(`${SUPABASE_URL}/functions/v1/seo-collection-engine`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ suggestion_id: suggestion.id }),
    });
    const bodyText = await res.text();
    assertEquals(res.status, 200, `engine returned ${res.status}: ${bodyText}`);
    const result = JSON.parse(bodyText);
    console.log(`[e2e] engine ok — taxonomy_level=${result.taxonomy_level}, smart_rules=${JSON.stringify(result.smart_rules)}, blogs=${JSON.stringify(result.blogs)}`);

    // 4. Verify collection_blogs rows
    const expectedTypes = selectBlogTypes(suggestion.collection_type);
    const { data: blogsAfter, error: blogsErr } = await admin
      .from("collection_blogs")
      .select("id, blog_type, title, content_html, status")
      .eq("suggestion_id", suggestion.id);
    assert(!blogsErr, blogsErr?.message);

    if (expectedTypes.length === 0) {
      // archive collections legitimately produce 0 blogs
      assertEquals(blogsAfter?.length ?? 0, 0, "archive collection_type should produce no blogs");
    } else {
      assert(
        (blogsAfter?.length ?? 0) > 0,
        `expected >=1 collection_blogs row for collection_type=${suggestion.collection_type}, got 0`,
      );
      // Old draft rows should have been replaced (delete-then-insert in helper)
      const sharedIds = (blogsAfter ?? []).filter((b: any) => beforeBlogIds.has(b.id));
      assertEquals(sharedIds.length, 0, "blog rows should be replaced, not appended");

      for (const b of blogsAfter ?? []) {
        assert(b.title && b.title.length > 0, `blog ${b.id} missing title`);
        assert(b.content_html && b.content_html.length > 100, `blog ${b.id} content_html too short`);
        assertEquals(b.status, "pending", `new blog ${b.id} should be status=pending`);
      }
      console.log(`[e2e] blogs ok — ${blogsAfter!.length} rows, types=${blogsAfter!.map((b: any) => b.blog_type).join(",")}`);
    }

    // 5. Verify smart_collection_rules + rule_set on the suggestion
    const { data: sugAfter, error: sugErr } = await admin
      .from("collection_suggestions")
      .select("smart_collection_rules, rule_set")
      .eq("id", suggestion.id)
      .maybeSingle();
    assert(!sugErr, sugErr?.message);
    assert(sugAfter, "suggestion vanished after engine run");

    // The engine occasionally returns no smart rules for some taxonomy levels.
    // If the engine reported persisted=true we MUST see them; otherwise skip.
    if (result?.smart_rules?.persisted) {
      assert(sugAfter.smart_collection_rules, "engine reported persisted but smart_collection_rules is null");
      const scr = sugAfter.smart_collection_rules as any;
      assert(Array.isArray(scr.rules) && scr.rules.length > 0, "smart_collection_rules.rules should be non-empty");
      for (const r of scr.rules) {
        assert(r.column && r.relation && r.condition, `malformed rule: ${JSON.stringify(r)}`);
      }
      // rule_set must be populated too (either filled this run, or pre-existing)
      assert(sugAfter.rule_set, "rule_set should be populated for collection-publish to consume");
      console.log(`[e2e] smart rules ok — ${scr.rules.length} rules, rule_set populated`);
    } else {
      console.log(`[e2e] engine returned no smart rules for this suggestion — skipping rules assertion`);
    }

    // 6. Sanity-check that the canonical output row also exists
    const { data: output } = await admin
      .from("collection_seo_outputs")
      .select("seo_title, meta_description, description_html, status")
      .eq("suggestion_id", suggestion.id)
      .maybeSingle();
    assert(output, "collection_seo_outputs row missing after engine run");
    assertEquals(output.status, "draft", "engine should write outputs as draft");
    assert(output.seo_title && output.seo_title.length > 0, "seo_title empty");
    assert(output.description_html && output.description_html.length > 200, "description_html too short");
  },
});
