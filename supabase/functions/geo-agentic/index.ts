import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { action, storeName, storeUrl, storeCity, niche, checklist, pageType, pageTopic, existingIntro, products, locale } = await req.json();
    // LOVABLE_API_KEY checked by callAI

    const spelling = (locale || "AU").toUpperCase().startsWith("US") ? "American English" : "Australian/British English";
    let systemPrompt = "";
    let userContent = "";

    if (action === "audit") {
      systemPrompt = `You are a GEO (Generative Engine Optimization) auditor. Score ecommerce stores for AI citation readiness. Be strict — most stores score 30-50 before optimisation. Use ${spelling}.`;
      userContent = `STORE: ${storeName}\nURL: ${storeUrl}\nNICHE: ${niche}\nCITY: ${storeCity}\n\nUSER-REPORTED CHECKLIST:\n${JSON.stringify(checklist)}\n\nScore each area 0-100:\n1. Content GEO Score (answer capsules, fact density, question-based H2s, no promotional language)\n2. Technical GEO Score (AI crawlers allowed, SSR, sitemap, llms.txt)\n3. Schema Score (Product, Organization, FAQPage, BreadcrumbList, LocalBusiness JSON-LD)\n4. Entity & E-E-A-T Score (brand consistency, author bios, reviews, 3rd party mentions)\n5. Agentic Readiness Score (complete product data, utility mapping, accurate stock)\n\nFor each provide topWin (highest-impact action) and quickFix (under 1 hour).\n\nRESPOND WITH JSON ONLY:\n{"scores":{"contentGEO":{"score":0,"topWin":"","quickFix":""},"technicalGEO":{"score":0,"topWin":"","quickFix":""},"schema":{"score":0,"topWin":"","quickFix":""},"entityEEAT":{"score":0,"topWin":"","quickFix":""},"agenticReadiness":{"score":0,"topWin":"","quickFix":""}},"overallScore":0,"overallVerdict":"Not ready|In progress|Good|AI-ready","priorityActions":["","",""]}`;
    } else if (action === "capsule") {
      systemPrompt = `You are a GEO content specialist following the "answer capsule" technique from Princeton GEO research. Use ${spelling}.`;
      userContent = `STORE: ${storeName} in ${storeCity}\nPAGE TYPE: ${pageType}\nPAGE TOPIC: ${pageTopic}\n\nWrite an ANSWER CAPSULE — 40-60 words, direct answer to the core question.\nRules:\n- First sentence directly answers the core question\n- Include 1-2 specific facts\n- Use store name and location naturally\n- Zero promotional language (no "curated", "amazing", "world-class")\n- Zero links or CTAs\n- Must stand alone as a complete answer\n\nAlso write a companion FAQ QUESTION.\n\nRESPOND WITH JSON:\n{"answerCapsule":"","faqQuestion":"","wordCount":0}`;
    } else if (action === "rewrite_intro") {
      systemPrompt = `You are a GEO content optimizer. Rewrite blog intros for AI citation compliance. Use ${spelling}.`;
      userContent = `STORE: ${storeName} in ${storeCity}\nBLOG TITLE: ${pageTopic}\nEXISTING INTRO:\n${existingIntro}\n\nRewrite following GEO rules:\n- Answer capsule in first 40-60 words\n- Add 1 statistic with source in first 150 words\n- Frame first H2 as a question\n- Remove all promotional language\n- Maintain ${spelling} and brand voice\n\nRESPOND WITH JSON:\n{"rewrittenIntro":"","changes":["change 1","change 2"]}`;
    } else if (action === "utility_tags") {
      systemPrompt = `You are a UCP product utility mapper. Generate situational use-case phrases for ecommerce products. Use ${spelling}.`;
      const productList = (products || []).slice(0, 20).map((p: any, i: number) =>
        `${i + 1}. Title: "${p.title}" | Brand: ${p.vendor || "unknown"} | Type: ${p.type || "unknown"} | Fabric: ${p.fabric || "unknown"}`
      ).join("\n");
      userContent = `Generate a "product utility" phrase for each product below.\nEach phrase: 8-12 words, starts with a verb, describes the specific situation this product is designed for.\n\nExamples:\n"Fast-drying for surfing trips and water sports"\n"Sun-protective for long beach days in Darwin"\n"Chlorine-resistant for lap swimmers and pool training"\n\nPRODUCTS:\n${productList}\n\nRESPOND WITH JSON:\n{"utilities":[{"index":0,"phrase":""}]}`;
    } else if (action === "visibility_prompts") {
      systemPrompt = `You are an AI visibility testing expert. Generate realistic conversational queries shoppers would ask AI assistants. Use ${spelling}.`;
      userContent = `Generate 10 realistic conversational queries a shopper would ask ChatGPT, Perplexity, or Gemini about ${niche} in ${storeCity}.\n\nMix:\n- 3 discovery: "what/where to buy [product] in ${storeCity}"\n- 3 recommendation: "best [product type] for [need]"\n- 2 comparison: "[brand A] vs [brand B]"\n- 2 local: "[niche] shop ${storeCity}"\n\nMake queries 8-15 words, conversational.\n\nRESPOND WITH JSON:\n{"prompts":[{"text":"","intent":"discovery|recommendation|comparison|local"}]}`;
    } else {
      return new Response(JSON.stringify({ error: "Unknown action" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await callAI({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });
    const raw = getContent(data);
    const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let parsed: any = null;
    try { parsed = JSON.parse(clean); } catch {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) try { parsed = JSON.parse(match[0]); } catch { /* fallback */ }
    }

    if (!parsed) {
      return new Response(JSON.stringify({ error: "Could not parse AI response" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ result: parsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("geo-agentic error:", e);
    const status = e instanceof AIGatewayError ? e.status : 500;
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
