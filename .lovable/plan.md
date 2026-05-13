# David Jones + Louenhide/Megantic SEO Intelligence

## Shipped

- [x] **Reference data** — Louenhide and David Jones rows seeded into `brand_intelligence`
- [x] **Engine — detector** — ACCESSORIES detection with `bag_type`, `feature`, `acc_occasion`; static filter collections; broad keyword blocklist
- [x] **Engine — generator** — Competitor router (`luxury_authority` → David Jones, `aussie_accessible` → Louenhide); deterministic length normaliser (meta 150-160, body ≥200w, FAQ 30-80w); niche-keyword guard; model switched to `gemini-2.5-flash` with 120s timeout
- [x] **Engine — audit** — `product-seo-audit` edge function reusing shared validators (same thresholds as retry loop)
- [x] **UI — Collections** — `static_filter` chip + voice selector with `luxury_authority` and `aussie_accessible`
- [x] **UI — SeoEngine** — `ProductSeoAuditPanel` wired with inputs, sample data, and scored results

## Next Round (Engine Quality — Do In This Order)

### Step 1: industry_taxonomy seeding for ACCESSORIES
Insert vertical `ACCESSORIES` with dimensions: `bag_type`, `travel_type`, `occasion`, `size`, `material`, `feature`, `accessory_type`, `gender_use`. Required for reliable vertical detection.

### Step 2: seo_keyword_library pre-load for ACCESSORIES
Insert Tiers 2-5 keywords for ACCESSORIES covering: brand+type, feature, local Darwin, attribute. Required for the niche-keyword guard to have a keyword backbone.

### Step 3: Dedicated formula schemas in engine prompt
Replace the temporary ICONIC 5-part reuse with:
- `david_jones_4_part`: authority opener → occasion+material loading → embedded FAQ prose → sub-collection link list
- `louenhide_brand_page`: Brisbane founding → mission → brand+type keyword repetition (≥3) → collection link-out

**Order constraint:** Steps 1 and 2 must complete before Step 3, because the formula schemas will reference keyword tiers directly and need real data (not placeholders).

## Deferred (UI Polish — Wait Until Lisa Asks)

- "Megantic score" badge on suggestion cards
- One-click "apply suggested handle/title/meta" buttons in audit panel
- Demo seeding for Stomp Shoes Darwin collection suggestions and SEO outputs

## Out of scope

- Actual publishing to Shopify (token expired)
- Live crawl of David Jones / Louenhide — formulas baked from research
