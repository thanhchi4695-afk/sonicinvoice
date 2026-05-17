# Phase 3 — SEO Content A/B Tester

Closes the Karpathy loop with real Google CTR data. Tests SEO title / meta description / H1 variants on high-traffic collections, measures via Google Search Console (GSC), and auto-promotes winners.

## Approach decisions (MVP)

- **Approach B — Scheduled Deployment**: 7-day control → 7-day variant rotation by writing Shopify collection SEO fields directly. Faster to ship than liquid metafield rotation; we still store full variant history in metafields under `seo_ab_test.*` for audit/rollback.
- **GSC auth**: use the existing **Google Search Console connector** (already in the Lovable connector catalog, gateway-based, no per-user OAuth needed for MVP — uses the workspace owner's connected GSC account).
- **AI Gateway**: Gemini 2.5 Pro for variant generation, Gemini 2.5 Flash fallback (per project doctrine).
- **Pattern**: AUTOMATION_FLOW with bounded LLM_CALL for variant generation (no agent loop).

## Database (one migration)

New tables:
- `seo_ab_experiments` — collection, variant_id, seo_title, meta_description, h1_tag, dates, impressions, clicks, ctr, position, is_winner, status
- `seo_ab_experiment_log` — cron audit (started/completed, experiments_ran, winners, errors)
- `seo_ab_schedule` — per-variant deployment windows (pending/active/completed/rolled_back)
- `seo_ab_settings` — per-user toggles (enabled, min_impressions=100, min_ctr_lift=0.10, max_concurrent=3, excluded_collections[])
- `seo_ab_gsc_daily` — daily impressions/clicks/ctr/position per (experiment_id, variant_id, date)

RLS: user-scoped on `user_id`; service role full access for cron functions.

## Edge functions

1. `gsc-fetch-performance` — accepts `{ siteUrl, page, startDate, endDate }`, calls GSC `searchanalytics/query` via the `google_search_console` connector gateway, returns aggregated + daily rows. Internal helper used by other functions.
2. `seo-ab-optimizer-start` — picks up to N eligible collections (≥100 impressions/30d, not tested in 60d, CTR ≤ 8%, not excluded), generates 2 variants per collection via Lovable AI Gateway, writes `seo_ab_experiments` + `seo_ab_schedule` rows. Deploys control for week 1.
3. `seo-ab-optimizer-rotate` — daily tick. Activates the next scheduled variant when its window opens (writes Shopify collection `seo.title` / `seo.description` + H1 via GraphQL, stores prior values in `seo_ab_test.*` metafields). Marks completed schedules.
4. `seo-ab-optimizer-collect` — daily, pulls GSC data for active/recently-active experiment URLs (skips last 3 days due to GSC delay), upserts into `seo_ab_gsc_daily`, recomputes `impressions/clicks/ctr/position` on experiments.
5. `seo-ab-optimizer-evaluate` — when an experiment's window closes + 72h buffer: compares variants vs control. If lift ≥ `min_ctr_lift` and impressions ≥ threshold → mark winner, push winner's SEO to Shopify, log to `seo_ab_experiment_log`. Safety: CTR floor (terminate if <50% of control), manual approval gate at >25% lift.
6. `seo-ab-optimizer-run` — admin manual trigger (chains start → rotate → collect → evaluate for the requesting user only).

Cron (scheduled in DB after deploy):
- `0 2 1,15 * *` → `seo-ab-optimizer-start`
- `15 2 * * *` → `seo-ab-optimizer-rotate`
- `0 8 * * *`  → `seo-ab-optimizer-collect`
- `0 9 * * *`  → `seo-ab-optimizer-evaluate`

## Frontend

New component `src/components/SeoAbTesterPanel.tsx` mounted on `src/pages/SonicRank.tsx`:
- Settings card (enabled toggle, min impressions, min lift %, max concurrent, excluded collections)
- Active tests card (collection, current variant, days remaining, predicted completion)
- Experiments table (collection, control CTR, variant CTRs with deltas, winner, status, details)
- Details modal (full SEO per variant, daily CTR chart from `seo_ab_gsc_daily`, "Apply winner now", "Extend 7 days")
- Trend chart (avg CTR over time, winning rate)
- "Run now" admin button

## Connector & secrets

- Link `google_search_console` connector (prompts you to pick/create a connection). Gateway env vars `LOVABLE_API_KEY` + `GOOGLE_SEARCH_CONSOLE_API_KEY` become available to edge functions automatically.
- Reuses existing `SHOPIFY_*` secrets for collection writes.
- No new manual secrets needed.

## Safety guardrails (encoded in evaluator)

- Min 100 impressions per variant before scoring
- Min 7-day / max 21-day windows
- CTR floor: kill variant if <50% control mid-test
- Manual approval gate for >25% lift winners
- 14-day rollback window (keep prior SEO snapshot)
- Per-user concurrent test cap (default 3)

## Order of execution

1. Migration (5 tables + RLS + seed default `seo_ab_settings` row trigger)
2. Link `google_search_console` connector
3. Write all 6 edge functions
4. Build `SeoAbTesterPanel.tsx` + mount on `SonicRank`
5. Schedule the 4 cron jobs via `supabase--insert` (user-specific URLs/anon key)
6. Update `mem://index.md` with a Phase 3 entry

Confirm to proceed and I'll run the migration first.