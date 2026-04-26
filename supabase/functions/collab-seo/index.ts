import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AI_GATEWAY_URL = Deno.env.get("AI_GATEWAY_URL") || "https://ai.gateway.lovable.dev/v1/chat/completions";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { type, partners, theme, targetLength, cta, storeName, storeUrl } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    if (type === "blog") {
      const partnerList = partners.map((p: any) => `- ${p.name}: ${p.url} — ${p.note || p.name}`).join("\n");
      const prompt = `You are a content writer for a local Darwin, Australia fashion retailer. Write a blog post for the following topic: "${theme}"

The post must naturally mention and hyperlink ALL of these local Darwin fashion businesses. Each link must appear as natural anchor text within a sentence — never as a bare URL, and never as a list of links. The links should feel editorial, not promotional.

PARTNER BUSINESSES (link each one exactly once):
${partnerList}

WRITING RULES:
- Length: ${targetLength} words
- Tone: warm, local, conversational. Written for Darwin shoppers who care about supporting local business.
- Australian English spelling throughout.
- Include at least one mention of Darwin's tropical lifestyle/climate where it fits naturally.
- DO NOT write "This post was written in collaboration with..." or any disclosure language.
- DO NOT use the words "curated", "delve", "tapestry", or "vibrant community". Write like a real person.
- Each partner mention must feel organic — describe what they actually sell, what makes them special.
- End with a short call to action: ${cta || "encourage readers to shop local in Darwin this season"}.
- Format: return the post as plain text with paragraph breaks. Use [LINK:partner_url] immediately after the anchor text where each link should appear. Example: "...visit Pinkhill[LINK:pinkhill.com.au] for the season's best arrivals..."

Return only the blog post text. No title, no headings, no metadata.`;

      const response = await fetch(AI_GATEWAY_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!response.ok) {
        const status = response.status;
        if (status === 429) return new Response(JSON.stringify({ error: "Rate limited, please try again shortly." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (status === 402) return new Response(JSON.stringify({ error: "Credits exhausted. Add funds in Settings > Workspace > Usage." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        throw new Error(`AI gateway error: ${status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";
      return new Response(JSON.stringify({ content }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (type === "themes") {
      const partnerNames = partners.map((p: any) => p.name).join(", ");
      const month = new Date().toLocaleString("en-AU", { month: "long" });
      const prompt = `Suggest exactly 4 blog post topics for a collaborative local SEO blog post about Darwin, Australia fashion boutiques. The participating stores are: ${partnerNames}. The current month is ${month}. Each topic should be specific and seasonally relevant. Return as a JSON array of 4 strings, nothing else.`;

      const response = await fetch(AI_GATEWAY_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [{ role: "user", content: prompt }],
          tools: [{
            type: "function",
            function: {
              name: "suggest_themes",
              description: "Return 4 blog post theme suggestions",
              parameters: {
                type: "object",
                properties: { themes: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 } },
                required: ["themes"],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "suggest_themes" } },
        }),
      });

      if (!response.ok) throw new Error(`AI gateway error: ${response.status}`);
      const data = await response.json();
      const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
      let themes: string[] = [];
      if (toolCall) {
        try { themes = JSON.parse(toolCall.function.arguments).themes; } catch { themes = []; }
      }
      if (!themes.length) {
        themes = [
          `Darwin's best women's fashion boutiques this ${month}`,
          "Shop local Darwin: the ultimate fashion guide",
          "Darwin style guide: where to find every look",
          `Supporting Darwin fashion this ${month.toLowerCase()}`,
        ];
      }
      return new Response(JSON.stringify({ themes }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (type === "emails") {
      const emailPrompts = partners.map((p: any) => `Write a short, friendly outreach email from ${storeName} (${storeUrl}) to ${p.name}, a local Darwin business.

Context:
- We are inviting them to share a collaborative blog post about Darwin fashion that mentions their business.
- Their business: ${p.note || p.name}
- Their website: ${p.url}
- The blog post topic: "${theme}"
- Their mention in the post: they are linked naturally in a post about Darwin fashion boutiques.

Email requirements:
- Subject line: keep it under 8 words, specific to them
- Opening: reference something specific about their store (what they sell, their vibe) — NOT generic "I love your store"
- Body: explain the collab blog, what they get (a backlink + mention + exposure to our audience), and what we ask of them (share the post on their blog or social media with a link back to us).
- Tone: local, warm, peer-to-peer. We are equals, not clients. This is a mutual win.
- Length: 120–180 words MAX.
- Closing: simple — first name of sender only, no formal sign-off.
- DO NOT use the phrases "I hope this email finds you well", "synergy", "leverage", "win-win partnership".

Return as JSON: {"subject": "...", "body": "..."}`);

      const allEmails: any[] = [];
      for (const [i, prompt] of emailPrompts.entries()) {
        const response = await fetch(AI_GATEWAY_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [{ role: "user", content: prompt }],
            tools: [{
              type: "function",
              function: {
                name: "draft_email",
                description: "Draft an outreach email",
                parameters: {
                  type: "object",
                  properties: { subject: { type: "string" }, body: { type: "string" } },
                  required: ["subject", "body"],
                  additionalProperties: false,
                },
              },
            }],
            tool_choice: { type: "function", function: { name: "draft_email" } },
          }),
        });

        if (!response.ok) {
          allEmails.push({ partnerId: partners[i].id, subject: "Collab blog about Darwin fashion", body: "Hi — we'd love to feature your store in a Darwin fashion blog post. Interested?" });
          continue;
        }
        const data = await response.json();
        const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
        let email = { subject: "", body: "" };
        if (toolCall) {
          try { email = JSON.parse(toolCall.function.arguments); } catch {}
        }
        allEmails.push({ partnerId: partners[i].id, ...email });
      }

      return new Response(JSON.stringify({ emails: allEmails }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown type" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("collab-seo error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
