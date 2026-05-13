# David Jones + Louenhide/Megantic SEO Intelligence

## Shipped

- [x] Reference data (Louenhide, David Jones in `brand_intelligence`)
- [x] Detector — ACCESSORIES + static_filter + blocklist
- [x] Generator — competitor router, length normaliser, niche-keyword guard
- [x] Audit edge function reusing shared validators
- [x] Collections UI — static_filter chip + voice options
- [x] SeoEngine — ProductSeoAuditPanel
- [x] **Round 2 / Step 1** — `industry_taxonomy` ACCESSORIES (9 dimensions)
- [x] **Round 2 / Step 2** — `seo_keyword_library` ACCESSORIES across 8 buckets
- [x] **Round 2 / Step 3** — Dedicated `david_jones_4_part` + `louenhide_brand_page` schemas
- [x] **Round 3 / 3.3** — Product-push optimiser hook
  - `_shared/product-seo-optimiser.ts` (single source of truth: bag-type detection, handle/title/meta formulas)
  - Wired into `publishing-agent` for accessories vendors only — sets `handle`, `body_html`, `metafields_global_title_tag`, `metafields_global_description_tag` BEFORE Shopify push
  - Returns `seo_optimised[]` with per-product flags for the audit log
- [x] **Round 3 / Part 6** — Structured 6-question FAQ for ACCESSORIES
  - Engine prompt now specifies the 6 Louenhide-template question slots (most-popular, colour, what-fits, vegan/material, care, in-store)
  - Pulls brand/store/city from existing args; falls back to generic 4-6 for non-accessories

## Open

- **Round 3 / Part 8** — Stomp Shoes Darwin pre-seed (blocked: Stomp store not connected; need user_id to seed `collection_suggestions` + `seo_keyword_library` rows)

## Deferred (UI Polish)

- "Megantic score" badge on suggestion cards
- One-click apply buttons in audit panel

## Out of scope

- Shopify publishing (token expired)
- Live competitor crawl
