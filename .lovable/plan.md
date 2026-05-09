# Sonic Parsing Improvement Roadmap

Source: `.lovable/sonic_parsing_improvement_roadmap.html` (uploaded 2026-05-09)

## ✅ Already built
- Native Claude PDF document-block extraction (`stage1ClaudePdf()`); Azure/Gemini fallback for non-PDFs
- Schema-first extraction via `return_invoice` tool (one row per size variant)
- Validation + auto re-extract loop (`validateAndMaybeReExtract()`, $1 delta threshold)
- Sonic Master Prompt v2 — 42-brand vendor lookup + universal Step 0–8 pipeline
- Auto-learn brand profile system (`autoLearnBrandProfile()` → Haiku → `brand_profiles` upsert)
- Dynamic brand-profile injection (`findBrandProfile()` fuzzy lookup at parse time)
- `profile_status` column (active / needs_enrichment / do_not_book) with UI gating
- Refill price restoration (non-destructive, logs to `price_changes`)
- 32 Cowork brand profiles seeded into `brand_profiles`

## 🔥 Do next

### Week 1 — Fix what's broken, unlock what's built
1. **Add `ANTHROPIC_API_KEY` to Supabase secrets + fix PDF MIME routing** — debug currently shows `azure_layout+llm` because Claude path never fires. Unblocks the whole pipeline.
2. **Upgrade model string to `claude-sonnet-4-6`** — 30–50% faster, 1M context GA at no surcharge. One-line change.
3. **Confirm 32 Cowork profiles are active** in `brand_profiles` (already seeded — verify).
4. **Cin7 size-unpacking + Sea Level SKU routing + non-invoice detection** — fixes Rhythm, We Are Feel Good, TOGS, Audi/Wacoal garbage.
5. **Prompt caching** — wrap master prompt (~4K tokens) and injected brand profile in `cache_control: ephemeral`. ~70% cost reduction per invoice after the first.

### Week 2 — Outcomes rubric (biggest accuracy leap)
6. **Claude Managed Agents — Outcomes (public beta, header `managed-agents-2026-04-01`)**. Write the Sonic rubric:
   - every product has colour, size, cost, vendor
   - cost × qty matches subtotal
   - no TESTER rows
   - vendor comes from SKU prefix, not invoice header
   Grader agent evaluates each parse in its own context and tells Claude what to fix. Reported ~10pt accuracy lift.
7. **Load all 42 profiles into a single 1M-token context block** — remove the separate DB lookup, faster cold starts.

### Week 3–4 — Multiagent + Dreaming
8. **Request Dreaming access** at claude.com/form/claude-managed-agents. While waiting, migrate auto-learn from custom `brand_profiles` table to Claude Managed Agents memory so it's ready on GA.
9. **Multiagent orchestration** for large invoices (Rigon 85 lines / 4 pages, Salty Ink 3 pages). Lead agent detects supplier; subagents (Haiku) extract rows / validate subtotal / update profile / detect non-invoice — in parallel. Validator merges.

## 🧠 New AI capabilities (May 2026)
- **Dreaming** (research preview) — scheduled review of agent sessions, curates memory, surfaces recurring mistakes. Harvey reported ~6× task-completion lift.
- **Outcomes** (public beta) — separate grader agent, rubric-driven. Wisedocs: 50% review-time reduction.
- **Multiagent Orchestration** (public beta) — lead + up to 20 parallel subagents.
- **1M token context** — GA on Sonnet 4.6 / Opus 4.7, no surcharge.

## Compounding flywheel (after all 9 steps)
New invoice → Claude parses with brand profile → outcomes rubric grades → grader catches misses → corrected rows saved → auto-learn updates profile → dreaming reviews overnight → parser wakes up smarter. No human in the loop unless grader flags.
