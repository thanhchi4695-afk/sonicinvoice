# Phase 1 — AI Prompt Optimizer (Karpathy Loop)

Autonomous nightly system that A/B tests SEO prompt variants and promotes winners based on merchant approval rates.

## Scope (Phase 1)

Targets the **collection description / SEO** generation path (`seo-collection-engine`), since that's where merchant approve/reject feedback already exists (`collection_suggestions.status` + `collection_seo_snapshots`). Other experiment types (`seo_title`, `meta_description`, `faq`) use the same tables but are wired in Phase 2.

## Database (one migration)

**`prompt_experiments`** — versioned prompt variants
- experiment_type, variant_id, prompt_template, temperature, few_shot_examples (jsonb), approval_rate, sample_size, is_active, parent_variant_id (for rollback), promoted_at

**`prompt_experiment_feedback`** — per-content approval signal
- experiment_id, variant_id, suggestion_id, user_id, approved, edited, time_to_approve_seconds

**`prompt_optimizer_log`** — run history
- run_started_at, run_completed_at, experiments_ran, winning_variant_id, previous_variant_id, improvement_percentage, promoted (bool), error_message

**`test_product_set`** — held-constant 50-item set, refreshed weekly
- product_id, set_week (date), position

**Schema additions**
- `collection_suggestions.prompt_variant_id text` — tag which variant generated this row
- `collection_blogs.prompt_variant_id text` (if table exists; skip if not)

RLS: admin-only write on experiments/log/test set; read for authenticated. Feedback writeable by content owner.

Seed: insert current hardcoded `seo-collection-engine` prompt as `v0` baseline with `is_active=true`.

## Edge functions

**`prompt-optimizer-cron`** (verify_jwt=false, requires `CRON_SECRET`)
1. Load active variant for `collection_description`
2. Generate 5–7 variants via Lovable AI Gateway (`google/gemini-2.5-pro`) with structured output
3. Insert variants into `prompt_experiments` (inactive)
4. Load weekly test set (regenerate if older than 7 days from non-optimized in-stock products)
5. For each variant × product, call internal generator with `variant_override` → store as draft `collection_suggestions` rows tagged with `prompt_variant_id`
6. Write `prompt_optimizer_log` row (promotion happens later, see evaluator)

**`prompt-optimizer-evaluator`** (runs after cron or on-demand)
- Aggregates `prompt_experiment_feedback` per variant
- Promotion gate: ≥100 feedback rows AND ≥5pp absolute lift over current default → mark new variant `is_active=true`, set previous `is_active=false`, record `promoted_at`
- Rollback check: if current active was promoted <7 days ago and its rolling approval rate dropped below the previous default's recorded rate, flip back and log incident

**`prompt-optimizer-run`** (auth required, admin role)
- Manual trigger that invokes the cron function with the user's auth context

**Modify `seo-collection-engine`**
- Accept optional `prompt_variant_id` param; if absent, load active variant from DB
- Stamp `prompt_variant_id` on the inserted `collection_suggestions` row

**Hook approval feedback** — when `collection_suggestions.status` flips to `approved`/`rejected` and the row has a `prompt_variant_id`, insert into `prompt_experiment_feedback` (DB trigger).

## Cron

Insert via `supabase--insert` (not migration, contains URL + anon key):
- `prompt-optimizer-cron` daily 02:00 UTC
- `prompt-optimizer-evaluator` every 6 hours

## UI — new section on Sonic Rank page

`src/components/PromptOptimizerPanel.tsx` added to `SonicRank.tsx`:
- Toggle: autonomous optimization on/off (writes a row to `system_settings` or equivalent feature flag)
- Schedule selector (display-only initially; daily 02:00)
- "Current winning prompt" card: active template, temperature, approval rate, sample size
- Recent experiments table: run date, variants tested, winner, improvement %, promoted yes/no
- "Run manually now" button → invokes `prompt-optimizer-run`
- "Preview test products" dialog: list of 50 current test products
- Admin-role-gated via existing `useUserRole`

## Safety guardrails

- Min sample size: 100 feedback rows before promotion
- Min lift: ≥5pp absolute
- 7-day rollback window with auto-revert on regression
- Human override: admin can click any past variant in experiments table → set as active
- Test set held constant for 7 days (refreshed Mondays)

## Technical details

- **AI Gateway**: `_shared/ai-gateway.ts` already supports `google/gemini-2.5-pro` with fallback; reuse for variant generation
- **Variant generation** uses structured JSON output (`response_format: json_object`) to return `{variants: [{variant_id, prompt_template, temperature, few_shot_examples}]}`
- **Test batch concurrency**: sequential with 500ms delay (per Shopify API doctrine memory) to avoid rate limits on downstream generator
- **Approval rate calc**: `count(approved=true) / count(*)` over `prompt_experiment_feedback` filtered to current variant since `promoted_at`
- **No client-side admin checks** — gated via `has_role(auth.uid(), 'admin')` in RLS + edge function JWT verification
- **Feedback trigger**: AFTER UPDATE on `collection_suggestions` when `status` transitions and `prompt_variant_id IS NOT NULL`

## Out of scope (Phase 2+)

- Experiment types beyond `collection_description`
- Bandit/Thompson sampling (this phase is simple winner-takes-all)
- Per-merchant prompt personalization
- Cost tracking per variant

## Build order

1. Migration (tables + RLS + trigger + seed v0)
2. Update `seo-collection-engine` to use DB-stored active prompt
3. New edge functions: `prompt-optimizer-cron`, `prompt-optimizer-evaluator`, `prompt-optimizer-run`
4. UI panel on Sonic Rank
5. Cron schedule (via `insert` tool)
6. Manual smoke test
