// Recompute the collection_link_mesh graph for a user using ICONIC's link rules:
//  Rule 1: siblings (same parent type) link both ways
//  Rule 2: sub-collection links up to parent + sideways to siblings
//  Rule 3: brand pages link down to brand+category sub-collections
//  Rule 4: occasion/feature pages link to relevant type collections
//  Rule 5: colour/material pages link to types in that colour
//
// Input:  { user_id?: string }  (defaults to caller's auth user)
// Output: { ok, edges_inserted, edges_deleted }
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Suggestion {
  id: string;
  user_id: string;
  collection_type: string;
  suggested_title: string;
  suggested_handle: string;
  shopify_handle: string | null;
  taxonomy_level: number | null;
}

function handleOf(s: Suggestion): string {
  return (s.shopify_handle || s.suggested_handle || "").toLowerCase();
}

function audiencePrefix(h: string): string | null {
  const m = h.match(/^(womens|mens|kids)/);
  return m ? m[1] : null;
}

function brandSlugFromHandle(s: Suggestion, brandNames: Set<string>): string | null {
  // brand or brand_category: handle is brand-... or {audience}-{brand}-...
  const h = handleOf(s);
  for (const b of brandNames) {
    if (h === b || h.startsWith(b + "-") || h.includes("-" + b + "-") || h.endsWith("-" + b)) return b;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const auth = req.headers.get("Authorization") || "";
    const jwt = auth.replace("Bearer ", "");
    const { data: u } = await supabase.auth.getUser(jwt);
    const callerId = u?.user?.id;
    const body = await req.json().catch(() => ({}));
    const userId: string | undefined = body.user_id || callerId;
    if (!userId) return json({ error: "user_id required" }, 400);

    const { data: rows, error } = await supabase
      .from("collection_suggestions")
      .select("id,user_id,collection_type,suggested_title,suggested_handle,shopify_handle,taxonomy_level")
      .eq("user_id", userId);
    if (error) return json({ error: error.message }, 500);
    const suggestions = (rows ?? []) as Suggestion[];
    if (suggestions.length === 0) return json({ ok: true, edges_inserted: 0, edges_deleted: 0 });

    // Build helpers
    const byHandle = new Map(suggestions.map((s) => [handleOf(s), s]));
    const brandNames = new Set(
      suggestions
        .filter((s) => s.collection_type === "brand")
        .map((s) => handleOf(s))
        .filter(Boolean),
    );

    const edges: Array<{ source: string; target: string; type: string; anchor: string }> = [];

    function addEdge(src: Suggestion, tgt: Suggestion, type: string) {
      if (src.id === tgt.id) return;
      edges.push({ source: src.id, target: tgt.id, type, anchor: tgt.suggested_title });
    }

    for (const s of suggestions) {
      const h = handleOf(s);
      if (!h) continue;
      const aud = audiencePrefix(h);
      const segs = h.split("-");

      // Rule 1: siblings — same audience, same depth, type collections
      if ((s.collection_type === "type" || s.taxonomy_level === 3) && aud) {
        for (const o of suggestions) {
          const oh = handleOf(o);
          if (!oh || o.id === s.id) continue;
          if (audiencePrefix(oh) !== aud) continue;
          if ((o.collection_type === "type" || o.taxonomy_level === 3) &&
              oh.split("-").length === segs.length) {
            addEdge(s, o, "sibling");
          }
        }
      }

      // Rule 2: sub-type → parent type (one segment shorter, same prefix)
      if (s.taxonomy_level === 4 || segs.length >= 4) {
        const parentHandle = segs.slice(0, segs.length - 1).join("-");
        const parent = byHandle.get(parentHandle);
        if (parent) addEdge(s, parent, "parent");
        // sibling sub-types: same parent
        for (const o of suggestions) {
          const oh = handleOf(o);
          if (!oh || o.id === s.id) continue;
          if (oh.startsWith(parentHandle + "-") && oh.split("-").length === segs.length) {
            addEdge(s, o, "sibling");
          }
        }
      }

      // Rule 3: brand → brand+category sub-collections
      if (s.collection_type === "brand") {
        const brand = h;
        for (const o of suggestions) {
          const oh = handleOf(o);
          if (o.id === s.id || !oh) continue;
          if (o.collection_type === "brand_category" &&
              (oh.startsWith(brand + "-") || oh.includes("-" + brand + "-"))) {
            addEdge(s, o, "child");
            addEdge(o, s, "parent");
          }
        }
      }

      // Rule 4: occasion/feature → matching type collections
      if (s.collection_type === "niche" || s.taxonomy_level === 6) {
        for (const o of suggestions) {
          if (o.id === s.id) continue;
          if (o.collection_type === "type" || o.taxonomy_level === 3) {
            // weak heuristic: same audience or no audience
            const oh = handleOf(o);
            if (!aud || audiencePrefix(oh) === aud) {
              addEdge(s, o, "occasion");
            }
          }
        }
      }

      // Rule 5: colour/material (collection_type print/dimension) → types
      if (s.collection_type === "print" || s.collection_type === "dimension") {
        for (const o of suggestions) {
          if (o.id === s.id) continue;
          if (o.collection_type === "type") addEdge(s, o, "material");
        }
      }
    }

    // Cap outgoing edges per source at 8 (link mesh density without spam)
    const capped: typeof edges = [];
    const perSource = new Map<string, number>();
    for (const e of edges) {
      const c = perSource.get(e.source) ?? 0;
      if (c >= 8) continue;
      perSource.set(e.source, c + 1);
      capped.push(e);
    }

    // Wipe + reinsert
    const { error: delErr, count: deleted } = await supabase
      .from("collection_link_mesh")
      .delete({ count: "exact" })
      .eq("user_id", userId);
    if (delErr) return json({ error: delErr.message }, 500);

    let inserted = 0;
    for (let i = 0; i < capped.length; i += 200) {
      const batch = capped.slice(i, i + 200).map((e) => ({
        user_id: userId,
        source_collection_id: e.source,
        target_collection_id: e.target,
        link_type: e.type,
        anchor_text: e.anchor,
      }));
      const { error: insErr, count } = await supabase
        .from("collection_link_mesh")
        .insert(batch, { count: "exact" });
      if (insErr) return json({ error: insErr.message, inserted_so_far: inserted }, 500);
      inserted += count ?? batch.length;
    }

    return json({ ok: true, edges_inserted: inserted, edges_deleted: deleted ?? 0 });
  } catch (e) {
    console.error("seo-link-mesh-builder error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Hint to satisfy unused var lint when brand mode is added later
void brandSlugFromHandle;
