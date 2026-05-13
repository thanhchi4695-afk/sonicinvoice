# White Fox SEO Architecture — Implementation Plan

Extends the existing ICONIC reference system with White Fox's three signature techniques: nested Shopify handles, colour-dimension collections, and occasion/trend layers — plus voice-matched copy.

## Phase A — Schema, voice & nested handle support

**Migration:**
- `collection_suggestions`: add `parent_collection_id uuid` (self-FK), `collection_type text` (`type | colour | occasion | trend | sale | restock | brand`), `colour_filter text`, `occasion_filter text`, `trend_signal text`.
- `store_settings`: add `brand_voice_style text` default `local_warmth` (one of `aspirational_youth | professional_editorial | local_warmth | luxury_refined`).
- `brand_intelligence`: add `whitefox_reference jsonb`.
- `seo_keyword_tiers`: seed CLOTHING vertical (Tier 2–5 + TREND).
- New table `nested_handle_map` (parent_slug, child_slug, vertical) — pre-seeded with the full White Fox / Sonic handle taxonomy from the spec.

**Engine:**
- Update `seo-collection-engine` to:
  - emit `shopify_handle = parent-slug/child-slug` when `parent_collection_id` is set,
  - select voice template by `brand_voice_style`,
  - apply White Fox **6-part description formula** (`hook | sub-types | features | fit/body | cross-sell | utility`) for `aspirational_youth` and `local_warmth`,
  - keep ICONIC 5-part formula for `professional_editorial`.

## Phase B — Colour & occasion detectors

New edge function `seo-collection-detector`:
- **Colour pass:** scan products in each parent type collection for the 32-colour vocabulary (Black, White, Navy, Cream, Beige, Tan, Floral, Animal, etc.); when ≥5 solid / ≥3 print → suggest a colour child collection nested under the parent.
- **Occasion pass:** scan tags + titles + descriptions for the universal/CLOTHING/SWIMWEAR/FOOTWEAR occasion sets in the spec; ≥5 matches → suggest occasion collection.
- **Trend pass:** scan against quarterly trend vocabulary; ≥3 matches → `collection_type='trend'` with auto-review-after-90-days flag.
- **Sale-by-category:** if ≥3 products in a type have `compare_at_price > 0` → emit `/collections/sale/{type}`.
- **Back in Stock:** ensure one per store; bind to `tag IN ('back-in-stock','restocked','back-soon')`.

Returns batch of `collection_suggestions` rows with the right `parent_collection_id`, `colour_filter`, `occasion_filter`, `trend_signal`.

## Phase C — White Fox brand-intel scraper

Extend `brand-intelligence-crawler` with a Step 7D (CLOTHING-only) that scrapes `whitefoxboutique.com.au/collections/{slug}` via Firecrawl. Captures opening line voice sample, sub-type list, description structure, and trend vocabulary into `brand_intelligence.whitefox_reference`.

Add `whitefox-reference-refresh` edge function (mirror of `iconic-brand-refresh`) and a ⚡ button on CLOTHING brand rows in `/brands`.

## Phase D — UI & competitor reference router

- `/seo-engine`: add filters by `collection_type` (Type / Colour / Occasion / Trend / Sale / Restock) and a "Nested under" column showing parent.
- `/seo-engine` row action: "Generate child collections" button (runs detector for one parent).
- New "Voice" selector in store settings page.
- Engine **decision router**: multi-brand store → ICONIC ref; single-brand DTC → White Fox ref; young fashion boutique → White Fox voice + ICONIC URL depth.

## One-tap action for Splash Swimwear

After Phases A–B deploy, add a "Generate White Fox-style swim collections" button on `/seo-engine` that creates the full nested set from the spec (bikinis, bikini-tops, bikini-bottoms, one-pieces, cover-ups, plus black/floral/navy/white colour children, plus resort-wear / tummy-control / back-in-stock / sale-by-type) for the active Splash store in one go.

---

**Technical notes:** completeness trigger already auto-recomputes on `collection_seo_outputs` / `collection_link_mesh` / `collection_blog_plans` writes — no change needed. Existing `seo-link-mesh-builder` will pick up new sibling links once colour/occasion children exist (siblings rule already covers same-parent grouping). All edge functions remain Lovable AI Gateway → `gemini-2.5-pro` → `gemini-2.5-flash` fallback.

Reply **continue** to start Phase A.