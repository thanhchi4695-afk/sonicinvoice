# David Jones + Louenhide/Megantic SEO Intelligence

Extend the Universal SEO Collection Engine with a new **ACCESSORIES** vertical and three Megantic-grade techniques (indexable filter collections, niche keyword tiers, product URL/H1/meta audit). Reuses existing tables — no new schemas required.

## 1. Reference data (seeded into existing tables)

**`brand_intelligence`** — add two retailer references for the demo user (Stomp Shoes Darwin) and the global "shared" row:

- `david_jones_reference` — 4-part luxury formula, sub-collection link list, accessories taxonomy snippets
- `louenhide_megantic_reference` — 3 innovations, niche-keyword tiers, product audit checklist, accessories FAQ template

**`industry_taxonomy`** — insert vertical `ACCESSORIES` with dimensions:
`bag_type`, `travel_type`, `occasion`, `size`, `material`, `feature`, `accessory_type`, `gender_use` (full Louenhide model).

**`seo_keyword_library`** — pre-load Tiers 2-5 keywords for `ACCESSORIES` (brand+type, feature, local Darwin, attribute).

## 2. Engine changes

**`supabase/functions/seo-collection-detector/index.ts`**
- Add ACCESSORIES detection rules using new taxonomy + thresholds:
  - bag_type ≥3, occasion ≥3, material ≥5, feature ≥2, accessory_type ≥3
- Emit `static_filter_collection` suggestions for every colour/feature/size combination with ≥3 products (Megantic Innovation 1) instead of relying on Shopify dynamic filter URLs.

**`supabase/functions/seo-collection-engine/index.ts`**
- Add competitor router branch: when `vertical IN ('ACCESSORIES')` → choose `david_jones` (luxury voice) or `louenhide_megantic` (Aussie accessible voice) based on price band / `voice` selector.
- New formula `david_jones_4_part`: authority opener → occasion+material loading → embedded FAQ prose → sub-collection link list.
- New formula `louenhide_brand_page`: Brisbane founding → mission → brand+type keyword repetition (≥3) → collection link-out.
- Niche-keyword guard: reject any primary keyword in the broad blocklist (`bags`, `accessories`, `wallets`, `handbags` standalone) — must combine with brand / type / locale.

**New: `supabase/functions/product-seo-audit/index.ts`** (Megantic Innovation 3)
- For each Shopify product in accessories vertical, score:
  - Handle contains bag_type keyword? (else suggest `-{bag_type}` suffix)
  - H1/title contains bag_type word?
  - Meta description present and ≤160 chars in formula `{benefit}. {Brand} {Style} in {colour}. {Specs}. {Store + shipping}.`
- Writes results to existing `collection_seo_outputs`-style row per product (or new `product_seo_audits` if needed — TBD: prefer reusing `agent_feedback` notes table to avoid migration).

## 3. UI

**`src/pages/Collections.tsx`**
- Add filter chip `static_filter` (Megantic) alongside existing chips.
- Add voice option `luxury_authority` (David Jones) and `aussie_accessible` (Louenhide) to the Voice selector.
- Show a "Megantic score" badge on each suggestion card (filter-indexable + niche keyword + product-audit pass).

**`src/pages/SeoEngine.tsx`**
- New panel "Product SEO Audit" listing flagged products from the new edge function with one-click "apply suggested handle/title/meta" buttons.

## 4. Demo seeding for Stomp Shoes Darwin

Insert demo `collection_suggestions` covering:
- Static filter: `louenhide-black-bags`, `olga-berg-gold-clutches`
- Feature: `rfid-wallets-darwin`, `vegan-leather-bags-darwin`
- Brand+type: `louenhide-crossbody-bags`, `peta-and-jain-tote-bags`
- Occasion: `work-bags-darwin`, `evening-bags-darwin`

Generate `collection_seo_outputs` for the Louenhide brand page using the new `louenhide_brand_page` formula and 6-question FAQ template.

## Out of scope (this round)
- Actual publishing to Shopify (Testing-store token still expired).
- Live crawl of David Jones / Louenhide — formulas baked from research above; can wire `whitefox-reference-refresh` pattern to a `dj-reference-refresh` later if desired.

Approve to proceed and I'll seed references → update detector/engine → add audit function → wire UI.
