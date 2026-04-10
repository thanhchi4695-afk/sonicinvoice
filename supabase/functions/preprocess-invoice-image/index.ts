import { callAI, getContent } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * AI-powered invoice image analysis.
 * Uses vision model to detect:
 * - Orientation (rotation needed)
 * - Document regions (header, line-items, totals)
 * - Image quality issues
 * Returns structured data for client-side preprocessing.
 */

const ANALYSIS_PROMPT = `You are an expert document image analyser. Examine this invoice/document photo and return a JSON analysis.

TASKS:
1. **Orientation**: Is the document correctly oriented for reading? If rotated, specify how.
2. **Landscape Detection**: Is this a landscape-format document photographed sideways? Fashion wholesale invoices are often landscape with size columns running horizontally.
3. **Regions**: Identify the vertical zones of the document (normalised 0-1 where 0=top, 1=bottom).
4. **Quality issues**: Note any problems that could affect OCR.

ORIENTATION DETECTION:
- Look at text direction, header position, and visual flow
- "correct" = text reads normally left-to-right, top-to-bottom
- "rotated_90_cw" = document is rotated 90° clockwise (text runs top-to-bottom)
- "rotated_90_ccw" = document is rotated 90° counter-clockwise
- "upside_down" = document is flipped 180°

LANDSCAPE DETECTION:
- If the document appears wider than tall in its natural reading orientation, it's landscape
- Fashion wholesale invoices with size grids (XS, S, M, L, XL or 6, 8, 10, 12, 14) running horizontally are typically landscape
- If style codes are in a vertical left column and sizes span horizontally, it's landscape
- Set is_landscape to true if the document's natural orientation is landscape format

REGION DETECTION:
- header: company logo, supplier name, invoice title area
- address_info: billing/shipping addresses, reference numbers
- line_items: the product/item table — this is the MOST IMPORTANT region
- totals: subtotal, GST, total, payment terms
- For each region, give normalised y position (0-1) and height (0-1)

QUALITY ISSUES:
- highlights: are there highlighter marks over text?
- handwriting: is there handwritten text/annotations?
- shadows: are there shadows affecting readability?
- skew: is the document at an angle (perspective distortion)?
- blur: is any area blurry?
- handwritten_prices: are prices written by hand next to descriptions?
- handwritten_ticks: are quantity ticks/marks written by hand in size grid cells?

Return ONLY valid JSON:
{
  "orientation": "correct" | "rotated_90_cw" | "rotated_90_ccw" | "upside_down",
  "orientation_confidence": 0-100,
  "is_landscape": boolean,
  "regions": {
    "header": { "y": 0.0, "height": 0.1 },
    "address_info": { "y": 0.1, "height": 0.1 } | null,
    "line_items": { "y": 0.2, "height": 0.5 },
    "totals": { "y": 0.7, "height": 0.1 } | null
  },
  "quality_issues": {
    "highlights": boolean,
    "highlight_locations": "description of where highlights are",
    "handwriting": boolean,
    "handwriting_description": "what is handwritten",
    "handwritten_prices": boolean,
    "handwritten_ticks": boolean,
    "shadows": boolean,
    "skew_degrees": number,
    "blur_areas": "description or null",
    "overall_readability": "good" | "fair" | "poor"
  },
  "recommendations": {
    "needs_rotation": boolean,
    "needs_perspective_correction": boolean,
    "needs_contrast_enhancement": boolean,
    "needs_highlight_removal": boolean,
    "crop_to_line_items": boolean,
    "is_landscape_sideways": boolean
  }
}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { imageBase64, fileType } = await req.json();

    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: "No image provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const mimeType = `image/${fileType === "jpg" ? "jpeg" : (fileType || "jpeg")}`;

    const data = await callAI({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: ANALYSIS_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${imageBase64}` },
            },
            {
              type: "text",
              text: "Analyse this invoice photo. Detect orientation, regions, and quality issues. Return JSON only.",
            },
          ],
        },
      ],
      temperature: 0.1,
    });

    const content = getContent(data);
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
    const jsonStr = (jsonMatch[1] || content).trim();
    const analysis = JSON.parse(jsonStr);

    // Map to DetectedRegions format for the client
    const regions = {
      header: analysis.regions?.header || null,
      lineItems: analysis.regions?.line_items || null,
      totals: analysis.regions?.totals || null,
      orientation: analysis.orientation || "correct",
      confidence: analysis.orientation_confidence || 80,
      isLandscape: analysis.is_landscape || false,
    };

    return new Response(
      JSON.stringify({
        regions,
        quality: analysis.quality_issues || {},
        recommendations: analysis.recommendations || {},
        raw: analysis,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Preprocess error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Analysis failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
