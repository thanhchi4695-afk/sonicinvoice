import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { action, niche, storeName, storeUrl, storeCity, existingCollections, cluster, pillar, crossLinks, existingPosts } = await req.json();
    // LOVABLE_API_KEY checked by callAI

    let systemPrompt = "";
    let userContent = "";

    if (action === "generate_topic_map") {
      systemPrompt = "You are an SEO strategist following the topical authority method taught by Income Stream Surfers. Create complete topic maps for Shopify ecommerce stores. Use Australian English.";
      userContent = `STORE DETAILS:
  Niche: ${niche}
  Store name: ${storeName}
  Location: ${storeCity}
  URL: ${storeUrl}
  ${existingCollections?.length ? `Existing collections: ${existingCollections.join(', ')}` : ''}

BUILD A TOPICAL AUTHORITY MAP:

1. ONE PILLAR PAGE — broadest, highest-volume keyword for this niche

2. EXACTLY 12 CLUSTER PAGES — mix of:
   - Buying guides: "How to choose [product]"
   - Feature guides: "What is [feature]"
   - Care guides: "How to care for [product]"
   - Comparison posts: "Best [product] for [customer type]"
   - Location posts: "Where to buy [product] in [city]"
   - Brand guides: "Best [brand] [product]"
   - Seasonal: "[Season] [product] guide [year]"
   - Problem-solving: "How to find [product] for [need]"

3. For EACH cluster: SEO title (<60 chars), target keyword, search intent (informational/commercial/navigational), volume (high/medium/low), collection links, pillar anchor text, postType

4. INTERNAL LINKING PLAN: 3 cross-cluster links

Return JSON ONLY:
{"pillar":{"title":"","keyword":"","slug":"","description":""},"clusters":[{"title":"","keyword":"","slug":"","intent":"","volume":"","collectionLinks":[],"pillarAnchorText":"","postType":""}],"crossLinks":[{"from":"","to":"","anchorText":""}],"topicalGaps":[]}`;

    } else if (action === "write_blog_post") {
      const isPillar = !cluster;
      const post = cluster || pillar;
      const wordTarget = isPillar ? "2000-2500" : "800-1200";

      systemPrompt = "You are an ecommerce SEO content writer using the topical authority method. Write complete, rankable blog posts with internal links. Use Australian English. Never use: curated, vibrant, tapestry, delve, elevate, leverage, synergy, seamless.";
      userContent = `STORE: ${storeName}
LOCATION: ${storeCity}
STORE URL: ${storeUrl}

POST TITLE: ${post.title}
TARGET KEYWORD: ${post.keyword}
SEARCH INTENT: ${post.intent || 'informational'}
POST TYPE: ${post.postType || 'guide'}

INTERNAL LINKS TO INCLUDE:
${pillar ? `Pillar page: "${pillar.title}" — link to ${storeUrl}/blogs/news/${pillar.slug}\nUse anchor text: "${post.pillarAnchorText || pillar.title}"` : 'This IS the pillar page.'}

${post.collectionLinks?.length ? `Collection pages to link to:\n${post.collectionLinks.map((c: string) => `"${c}" — link to ${storeUrl}/collections/${c.toLowerCase().replace(/\s+/g, '-')}`).join('\n')}` : ''}

${crossLinks?.length ? `Cross-links to other blog posts:\n${crossLinks.map((l: any) => `"${l.title}" — link to ${storeUrl}/blogs/news/${l.slug} using anchor: "${l.anchorText}"`).join('\n')}` : ''}

WRITING RULES:
1. Word count: ${wordTarget} words
2. H1: use the exact target keyword naturally
3. H2 subheadings: use related keywords and questions
4. First paragraph: answer the question directly
5. Include ALL internal links naturally in the body
6. Australian English throughout
7. Mention ${storeCity} naturally at least twice
8. End with a call to action linking to the most relevant collection
9. E-E-A-T signals: write as someone who genuinely knows the niche
10. DO NOT use: curated, vibrant, tapestry, delve, elevate, leverage, synergy, seamless

OUTPUT FORMAT (JSON only):
{"metaTitle":"SEO title under 60 chars","metaDescription":"Meta description under 160 chars","slug":"url-safe-slug","wordCount":950,"readTime":"4 min read","html":"<h1>...</h1><p>...</p>..."}

The HTML must be complete, valid HTML with proper <a href="..."> tags for all internal links. NO markdown.`;

    } else if (action === "gap_analysis") {
      systemPrompt = "You are an SEO strategist. Analyse existing blog content and identify topical authority gaps. Use Australian English.";
      userContent = `STORE NICHE: ${niche}
STORE LOCATION: ${storeCity}

EXISTING BLOG POSTS:
${existingPosts?.join('\n') || 'None'}

TASK:
1. List 10 topics a ${niche} store SHOULD cover but hasn't
2. Flag any duplicate topics (same search intent covered twice)
3. Suggest which 3 new posts would have the highest impact

Return JSON:
{"gaps":[{"topic":"","keyword":"","priority":"high|medium|low","reason":""}],"duplicates":[{"post1":"","post2":"","recommendation":""}],"topThreeNext":["","",""]}`;

    } else {
      return new Response(JSON.stringify({ error: "Unknown action" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await callAI({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });
    const text = getContent(data);
    const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      parsed = { raw: clean };
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("organic-seo error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
