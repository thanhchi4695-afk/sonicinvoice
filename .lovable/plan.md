# David Jones + Louenhide/Megantic SEO Intelligence

## Shipped

- [x] Reference data (Louenhide, David Jones in `brand_intelligence`)
- [x] Detector — ACCESSORIES + static_filter + blocklist
- [x] Generator — competitor router, length normaliser, niche-keyword guard
- [x] Audit edge function reusing shared validators
- [x] Collections UI — static_filter chip + voice options
- [x] SeoEngine — ProductSeoAuditPanel
- [x] **Round 2 / Step 1** — `industry_taxonomy` ACCESSORIES (9 dimensions: bag_type, travel_type, occasion, size, material, feature, accessory_type, gender_use, closure)
- [x] **Round 2 / Step 2** — `seo_keyword_library` ACCESSORIES across 8 buckets (high_volume, type_specific, occasion, material, colour, feature, local Darwin, brand_long_tail)
- [x] **Round 2 / Step 3** — Dedicated formula schemas in engine prompt:
  - `david_jones_4_part` (luxury_authority + ACCESSORIES collection): authority opener → occasion+material loading → embedded FAQ prose → sub-collection links
  - `louenhide_brand_page` (aussie_accessible + brand page): Brisbane founding → mission → primary-keyword repetition (≥3) → collection link-out
  - Stitcher + length-normaliser updated to route fillers into the correct slot per schema

## Deferred (UI Polish — Wait Until Lisa Asks)

- "Megantic score" badge on suggestion cards
- One-click apply buttons in audit panel
- Demo seeding for Stomp Shoes Darwin

## Out of scope

- Shopify publishing (token expired)
- Live competitor crawl
