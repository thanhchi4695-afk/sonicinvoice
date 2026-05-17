# Phase 2 — Discount Strategy A/B Tester (Karpathy Loop)

Weekly autonomous A/B test of pricing-engine parameters. Same architecture as Phase 1 (prompt optimizer) but feedback signal is **actual sales velocity vs margin loss**, not approval rate.

## Scope

Targets `src/lib/pricing/lifecycleEngine.ts` — the only deterministic pure-function discount engine in the codebase. The "current formula" in the brief is paraphrased; real constants (`PHASE_BANDS`, weights, velocity bands) become the v0 variant.

Defaults to **dry-run / disabled** — merchants must opt in to auto-promotion. Margin floor in `lifecycleEngine` stays hard-coded and non-negotiable (variants cannot override it).

## Database (one migration)

- **`discount_strategy_experiments`** — variant_id, strategy_name, parameters (jsonb), efficiency_score, velocity_gain_pct, margin_loss_pct, sample_size, test_started_at, test_completed_at, is_active, parent_variant_id, promoted_at, blacklisted (bool, for early-terminated variants)
- **`discount_strategy_feedback`** — experiment_id, variant_id, product_id, units_sold_during_test, revenue_during_test, margin_during_test, discount_applied_pct, competitor_price_at_test, observation_date
- **`discount_strategy_log`** — run_started_at, run_completed_at, run_type ('start'|'collect'), experiments_ran, winning_variant_id, previous_variant_id, efficiency_improvement_pct, promoted, notes, error_message
- **`test_product_set_discount`** — product_id, product_title, current_price, cost_price, inventory_quantity, weekly_velocity_baseline, test_week_start, test_week_end, unique(product_id, test_week_start)
- **`discount_variant_assignments`** — test_week_start, product_id, variant_id, experiment_id, assigned_at — what variant a given product is on for the week
- **`discount_optimizer_settings`** — singleton row per user_id: enabled (bool, default false), auto_promote (bool, default false), schedule_cron (text), max_margin_loss_pct (default 15), updated_at

RLS: admin-only writes on experiments/log/test set/assignments; auth read. Settings: owner read+write (user_id = auth.uid()). Feedback: admin write (populated server-side).

Seed: insert v0 baseline representing current lifecycleEngine constants.

## Engine changes — `src/lib/pricing/lifecycleEngine.ts`

- Export a `StrategyParams` interface mirroring `PHASE_BANDS`, the four scoring weights, and velocity thresholds.
- Add a `DEFAULT_STRATEGY: StrategyParams` constant equal to today's constants.
- Make `recommendPrice(input, strategy?)` accept an optional second arg; default to `DEFAULT_STRATEGY`.
- Margin floor logic stays inside `recommendPrice` and ignores `strategy` — variants cannot soften it.
- No callers need to change; default behaviour preserved.

## Lookup helper — `src/lib/pricing/strategyResolver.ts` (new)

`resolveStrategyForProduct(productId, userId)` → returns `StrategyParams`:
1. Look up `discount_variant_assignments` for current test_week_start
2. If hit → load variant params from `discount_strategy_experiments`
3. Else → load active strategy params (`is_active = true`)
4. Else → `DEFAULT_STRATEGY`

Cache for 60s in-memory. UI components that call `recommendPrice` can opt to pass the resolved strategy.

## Edge functions

**`discount-optimizer-start`** (weekly Sun 02:00 UTC, `verify_jwt = false`, requires `CRON_SECRET`)
1. Load active strategy params
2. Generate 5–8 variants via Lovable AI Gateway (`google/gemini-2.5-pro`, JSON-out). Each variant mutates ONE param, all others identical
3. Validate variants: every discount cap ≤ 0.85, weights sum to 1.0 ±0.05; reject otherwise
4. Insert variants (is_active=false, test_started_at=now)
5. Build new `test_product_set_discount`: 100 products from `collection_suggestions`/Shopify product source meeting: stock ≥ 10, in inventory ≥ 30 days, not currently clearance (price > floor × 1.1), not in last week's test, excluded from top 10% by revenue (heuristic — skip products with very high `avgWeeklySales`)
6. Record baseline `weekly_velocity_baseline` per product
7. Assign products to variants round-robin (≈12 each) → `discount_variant_assignments`
8. Log run

**`discount-optimizer-collect`** (weekly Sun 01:30 UTC, BEFORE start — collects previous week's results before new round)
1. Find experiments where `test_started_at < now() - 7 days` and `test_completed_at IS NULL`
2. For each variant: aggregate `discount_strategy_feedback` rows from the test week
3. Compute `velocity_gain_pct` = (avg_actual_velocity − avg_baseline_velocity) / baseline × 100
4. Compute `margin_loss_pct` = (baseline_margin − actual_margin) / baseline_margin × 100
5. Compute `efficiency_score = velocity_gain_pct / max(0.01, margin_loss_pct)`
6. Mark `test_completed_at`, store all three on experiment row
7. **Early-terminate / blacklist** any variant whose margin_loss_pct > `max_margin_loss_pct` (default 15)
8. Promotion gate: candidate must have ≥50 feedback rows AND efficiency_score ≥ active × 1.1 AND not blacklisted AND no single param differs >50% from current (otherwise mark `pending_human_approval = true` and DON'T auto-promote unless `auto_promote=true`)
9. **Rollback check**: if active strategy promoted < 14 days ago AND store-wide margin in feedback dropped > 10pp vs baseline, revert to parent variant + log incident
10. Log run

**`discount-optimizer-feedback`** (auth required, called by sales sync or manually)
- Accepts `{product_id, units_sold, revenue, margin, discount_applied_pct, competitor_price?}` for current test week
- Looks up active assignment for product → inserts `discount_strategy_feedback` row tagged with variant_id + experiment_id
- Idempotent on (experiment_id, product_id, observation_date::date)

**`discount-optimizer-run`** (admin-only manual trigger)
- Invokes start, then collect, for smoke testing

## Cron (via `supabase--insert`)
- `discount-optimizer-collect-weekly` — `30 1 * * 0`
- `discount-optimizer-start-weekly` — `0 2 * * 0`

## UI — `src/components/DiscountOptimizerPanel.tsx`

Admin-only panel, mounted on `src/pages/Rules.tsx` (pricing rules page):

- **Settings card**: enable toggle (writes `discount_optimizer_settings.enabled`), auto-promote toggle, schedule display ("Sunday 02:00 UTC"), max margin loss slider (5–25%)
- **Current strategy** card: active variant_id, efficiency_score, sample_size, expandable JSON of params
- **This week's test**: count of variants, count of products under test, expected completion date, mini list of "what changed" per variant
- **Last week's winner**: highlighted card with parameter diff vs previous, efficiency lift, "Apply now" button if `pending_human_approval`
- **Recent experiments** table: variant_id, efficiency_score, velocity_gain_pct, margin_loss_pct, samples, status (active/blacklisted/pending)
- **Run history**: last 10 cron runs with timestamps and lift
- **Buttons**: "Run now" (calls `discount-optimizer-run`), "Rollback to previous" (sets parent_variant_id active)
- **Trend chart**: simple line chart of weekly efficiency_score from log rows (Recharts, already in project)

Uses the existing dark theme, Syne headings, IBM Plex Mono for numbers, teal/amber accents.

## Safety guardrails (recap)

1. Margin floor: hard-coded in `recommendPrice`, never overridable by variants
2. Max margin loss: 15pp default per variant per week → blacklist
3. Large change gate: param delta > 50% requires human approval
4. Min samples: 50 feedback rows
5. 14-day rollback window with auto-revert on store-wide regression
6. Test set excludes best-sellers (top 10% by velocity)
7. **Default OFF**: merchants must opt in via settings toggle

## Out of scope (Phase 3+)

- Real Shopify sales-data ingestion into `discount_strategy_feedback` — Phase 2 ships the endpoint; wiring it into the existing sales sync is a follow-up
- Multivariate testing (Thompson sampling) — pure winner-takes-all this phase
- Per-segment strategy (by collection, brand, season)
- Dry-run "what-would-have-happened" simulation card

## Build order

1. Migration (6 tables + RLS + seed v0)
2. `lifecycleEngine.ts` — accept optional StrategyParams
3. `strategyResolver.ts` helper
4. Three edge functions: start, collect, feedback (+ run trigger)
5. UI panel + mount on Rules page
6. Cron schedules via `supabase--insert`
7. Smoke test via "Run now"
