// Ported from collection-content-generator (deprecated).
// BLOG_TEMPLATE selects which blog topics to generate per collection_type
// and generateAndPersistBlogs runs the AI call + writes collection_blogs rows.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { callAI, getContent } from "./ai-gateway.ts";

export type BlogType =
  | "sizing" | "care" | "features" | "faq" | "styling"
  | "occasion" | "trends" | "brand_story" | "materials" | "comparison";

export const BLOG_TEMPLATE: Record<string, BlogType[]> = {
  brand: ["brand_story", "styling", "trends"],
  brand_category: ["styling", "features", "sizing"],
  brand_print: ["styling", "trends"],
  type: ["sizing", "care", "features"],
  dimension: ["styling", "occasion"],
  niche: ["features", "faq"],
  print: ["styling", "trends"],
  archive: [],
};

export function selectBlogTypes(collectionType: string | null | undefined): BlogType[] {
  return BLOG_TEMPLATE[String(collectionType ?? "type")] ?? ["styling", "features"];
}

interface GenerateBlogsOpts {
  supabase: SupabaseClient;
  suggestionId: string;
  userId: string;
  collectionType: string | null | undefined;
  collectionTitle: string;
  sampleTitles?: string[];
  storeName: string;
  brandName?: string | null;
  brandTone?: string | null;
}

interface GeneratedBlog {
  blog_type: BlogType;
  title: string;
  content_html: string;
}

export async function generateAndPersistBlogs(opts: GenerateBlogsOpts): Promise<{
  generated: number;
  blog_types: BlogType[];
  skipped?: string;
}> {
  const types = selectBlogTypes(opts.collectionType);
  if (types.length === 0) {
    return { generated: 0, blog_types: [], skipped: "archive collection — no blogs" };
  }

  const blogSpec = types
    .map((t) => `    {"blog_type":"${t}","title":"...","content_html":"400-600 words HTML with <h2>/<p>/<ul>"}`)
    .join(",\n");

  const brandLine = opts.brandName
    ? `\nBRAND: ${opts.brandName}${opts.brandTone ? ` — tone: ${opts.brandTone}` : ""}\nMirror this brand's voice and vocabulary.`
    : "";

  const prompt = `COLLECTION CONTEXT:
Collection type: ${opts.collectionType ?? "type"}
Title: ${opts.collectionTitle}
Sample products: ${(opts.sampleTitles ?? []).slice(0, 5).join(" | ") || "(none)"}
Store: ${opts.storeName}${brandLine}

Write ${types.length} blog draft(s) of types: ${types.join(", ")}.

OUTPUT JSON ONLY (no prose, no markdown fences):
{
  "blogs": [
${blogSpec}
  ]
}
Australian English. No exaggerated claims. No fake material claims.`;

  const ai = await callAI({
    model: "google/gemini-2.5-flash",
    messages: [
      {
        role: "system",
        content: `You are a senior SEO copywriter for ${opts.storeName}. You output strict JSON only.`,
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.4,
    max_tokens: 4000,
  });

  const raw = getContent(ai).trim().replace(/^```json\s*|```$/g, "");
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("blog-templates: AI did not return JSON");
  const parsed = JSON.parse(m[0]) as { blogs?: GeneratedBlog[] };
  const blogs = (parsed.blogs ?? []).filter((b) => b?.title && b?.content_html);

  // Replace existing draft blogs for this suggestion
  await opts.supabase.from("collection_blogs").delete().eq("suggestion_id", opts.suggestionId);
  if (blogs.length > 0) {
    await opts.supabase.from("collection_blogs").insert(
      blogs.map((b) => ({
        suggestion_id: opts.suggestionId,
        user_id: opts.userId,
        blog_type: b.blog_type,
        title: String(b.title).slice(0, 200),
        content_html: b.content_html,
        status: "pending",
      })),
    );
  }

  return { generated: blogs.length, blog_types: types };
}
