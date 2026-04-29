# Sonic Invoices — Sola.ai-Inspired Agentic Roadmap

This plan governs all upcoming prompts. Future changes must align with these four lessons. Reject any prompt that contradicts the locked principles below.

---

## North-star principle

Move Sonic Invoices from **passive rule-based alerts** to an **agentic, decision-making, screen-learning, cross-system orchestrator** for wholesale buyers.

We are NOT cloning Sola.ai features. We are adopting its core principles and applying them to wholesale buying (JOOR, NuOrder, supplier sites, Shopify, Lightspeed, Slack, email, accounting).

---

## Lesson 1 — Margin Guardian Agent (not a static alert)

**Goal:** Replace the existing margin protection alert with an *agent* that monitors and intervenes across multiple touchpoints in real time.

### Touchpoints (locked)
| Surface | Behaviour |
|---|---|
| JOOR / NuOrder cart (Chrome extension) | Recalculate margin live as items added/removed; inject ⚡ badge with current margin %, floor, exposure |
| Slack channel | For POs above a configurable $ threshold, post summary + manager sign-off button BEFORE buyer can submit |
| Email / PO system | Auto-flag any outbound PO that dips below margin floor; halt send until human review |
| Sonic Invoices app | Central inbox of pending guardian decisions with audit trail |

### Implementation rules
- Reuse `src/lib/margin-protection.ts` as the calculation core. Do NOT fork margin logic.
- Agent logic lives in a new edge function `margin-guardian` (server-side decisions, never client-only).
- Decisions logged to a new `margin_guardian_events` table (event sourcing — no destructive updates).
- Slack approval = approval token in Supabase; expires after 24h.
- Reject prompts that ask for plain `toast`-only alerts. Must be agent-mediated.

---

## Lesson 2 — Screen-to-Agent (record & replay workflows)

**Goal:** Buyer demonstrates a workflow once in the Chrome extension; system generates a reusable, self-healing automation.

### Locked cascade
1. **Record** — extension captures DOM events, network calls, and selector context for a user-demonstrated flow (e.g. supplier stock check).
2. **Interpret** — recording sent to edge function `workflow-interpret`; LLM (via AI Gateway, gemini-2.5-pro → flash fallback) converts into a structured workflow JSON (steps, selectors, semantic intent).
3. **Store** — saved to `recorded_workflows` table, scoped per-user, versioned.
4. **Replay** — extension or edge function executes the workflow on demand (one-click "AI Stock Check").
5. **Self-heal** — if a selector breaks, re-run interpretation against fresh DOM, prefer semantic intent over raw selectors.

### First target use case (locked)
- "AI Stock Check" on JOOR + NuOrder product pages — replaces manual SKU copy → new tab → inventory lookup.

### Implementation rules
- Recording uses the existing extension infrastructure in `extension/`. Do NOT spawn a new extension project.
- Storage: `recorded_workflows` table with RLS (owner-only).
- Interpretation goes through AI Gateway only. No direct Anthropic/Google calls from the extension.
- Reject any prompt that asks to hardcode supplier-specific scrapers — recorded workflows are the path.

---

## Lesson 3 — Citizen Developer Condition Builder

**Goal:** Business owner builds their own guardian rules visually, no code, no support ticket.

### Locked schema (no-code rule shape)
```
WHEN  <trigger>           // e.g. margin_below, po_total_above, brand_is, vendor_first_time
WITH  <conditions[]>      // AND-combined filters
AND   <conditions[]>
THEN  <action>            // email_manager | slack_approval | block_order | log_only
```

### UI placement
- New panel inside the side panel: **Guardian Rules**.
- Rules CRUD lives in a new `guardian_rules` table with RLS.
- Rule evaluation runs inside the `margin-guardian` edge function (single source of truth).

### Implementation rules
- Builder UI uses existing shadcn primitives + design tokens (no custom colors).
- Triggers/actions are an enum — extending the enum requires explicit prompt + migration.
- Reject prompts that bypass the builder and hardcode rules in components.

---

## Lesson 4 — Downfield Automation ("Reapply Last Fix")

**Goal:** A margin alert's "Fix" action becomes an executable trigger, not a suggestion. Built on the Lesson 2 recording infrastructure.

### Locked flow
1. Buyer manually corrects a margin violation once (e.g. updates price in JOOR, emails supplier).
2. The correction is recorded via the same Lesson 2 pipeline → stored as a `correction_workflow` linked to the violating rule.
3. On the next matching violation, the alert UI shows a **Reapply Last Fix** button.
4. Clicking it replays the stored workflow end-to-end (cart update + email draft + audit entry).

### Implementation rules
- Re-use `recorded_workflows` table; add `purpose = 'correction'` discriminator.
- Replay must always require explicit user confirmation (no silent auto-fix). Logged to `margin_guardian_events`.
- Reject prompts that ask for fully autonomous correction without confirmation.

---

## Cross-cutting non-negotiables

- **AI Gateway only** — every LLM call goes through the centralized fallback (`gemini-2.5-pro` → `gemini-2.5-flash`). No direct provider SDKs from client or extension.
- **RLS on every new table** — owner-scoped, no anonymous access.
- **Event sourcing** for guardian decisions — never overwrite history.
- **Design system** — semantic tokens only, no hardcoded colors. Syne headings, IBM Plex Mono for data, teal/amber accents.
- **Sequential Shopify writes** — 500ms minimum delay, batch metafields 8 at a time.
- **Variant order** — Colour first, Size second (Shopify CSV, previews, recorded workflows).
- **Audit log** — every guardian action and workflow replay appended to existing audit log (500-entry localStorage cap still applies for client mirror).

---

## Build order (do not reorder without approval)

1. `margin_guardian_events` table + `margin-guardian` edge function (Lesson 1 backbone)
2. JOOR/NuOrder live margin badge in extension (Lesson 1, surface 1)
3. Slack approval flow for high-$ POs (Lesson 1, surface 2)
4. Email/PO outbound guardrail (Lesson 1, surface 3)
5. `guardian_rules` table + Condition Builder UI (Lesson 3)
6. Recording infrastructure in extension + `recorded_workflows` table (Lesson 2 foundation)
7. `workflow-interpret` edge function + AI Stock Check (Lesson 2 first use case)
8. Self-healing selector retry on replay failure (Lesson 2 hardening)
9. Correction recording + Reapply Last Fix (Lesson 4)
10. Replay confirmation + audit surfacing across UI

---

## Plan-adherence rules for future prompts

- Reject any margin alert change that is not routed through the `margin-guardian` agent.
- Reject any new supplier-specific scraper — must use recorded workflows.
- Reject any LLM call outside the AI Gateway.
- Reject any guardian rule hardcoded in a component instead of stored in `guardian_rules`.
- Reject any auto-fix action that runs without explicit user confirmation.
- Reject any new storage bucket or new auth provider unless the prompt explicitly justifies it.
- Reject reordering of the build sequence above without an explicit user instruction.

---

## Out of scope (explicitly)

- Cloning Sola.ai's general-purpose RPA studio.
- Generic web automation outside wholesale-buying surfaces.
- Replacing existing extraction cascades (URL importer, invoice parsing) — those keep their own locked plans.
- Removing Lovable Cloud / swapping backend providers.

---

## Appendix A — Agentic Margin Guardian: technical requirements

### A.1 System architecture
- **Calculation core:** reuse `src/lib/margin-protection.ts` (`checkMargin`, `checkMultiPrice`, `bulkMarginCheck`). No forks.
- **Agent runtime:** new edge function `margin-guardian` (server-authoritative; never trust client margin verdicts).
- **Event store:** `margin_guardian_events` (append-only). Every evaluation, gate, approval, override, and replay is one row.
- **Rule store:** `guardian_rules` (see Appendix B). Loaded at evaluation time.
- **Decision pipeline (per evaluation):**
  1. Load applicable rules for `user_id` + `surface` (joor | nuorder | po | email | invoice_review).
  2. Resolve cost via `resolveCost` (invoice → shopify → manual).
  3. Compute margin via existing engine.
  4. Apply rules in priority order; first matching `then` wins; emit a `decision` (allow | warn | gate | block).
  5. Persist event with full input snapshot + chosen action + rule id.
  6. Dispatch side-effects (Slack post, email halt token, in-app inbox card).

### A.2 Surfaces & wire format
| Surface | Input source | Trigger | Output |
|---|---|---|---|
| JOOR / NuOrder cart | Chrome extension content script | DOM mutation on cart rows (debounced 400ms) | ⚡ badge with margin %, floor, exposure $; tooltip lists violating rules |
| Slack | `margin-guardian` → Slack webhook | PO total ≥ rule threshold | Block-kit card with Approve / Reject buttons; signed approval token (24h TTL) |
| Email / PO | Outbound interceptor edge function | Pre-send hook | Halt with `requires_review=true` until inbox card resolved |
| Sonic Invoices inbox | `margin_guardian_events` realtime channel | Any `gate` or `block` event | Card in `MarginProtectionPanel` with Approve / Override / Reapply Last Fix |

### A.3 Edge function contract (`margin-guardian`)
- `POST /evaluate` — body: `{ surface, user_id, line_items[], po_total, vendor, brand, context }`. Returns `{ decision, rule_id, event_id, narrative, exposure_cents, requires_approval }`.
- `POST /approve` — body: `{ event_id, approval_token, decision: 'approve'|'reject', notes }`. Server validates token, updates event chain (never overwrites prior events).
- `POST /replay-fix` — body: `{ event_id, workflow_id }`. Requires explicit user confirmation flag. Logs replay as a new event linked to the original.

### A.4 Schema (Appendix-locked; future migrations follow this shape)
```
margin_guardian_events (
  id uuid pk,
  user_id uuid not null,
  surface text not null,
  rule_id uuid null references guardian_rules,
  parent_event_id uuid null references margin_guardian_events,
  decision text check (decision in ('allow','warn','gate','block','approve','reject','replay')),
  exposure_cents integer,
  margin_pct numeric,
  cost_cents integer,
  price_cents integer,
  vendor text, brand text,
  input_snapshot jsonb not null,
  approval_token text null,
  approval_expires_at timestamptz null,
  narrative text,
  created_at timestamptz default now()
)
```
- RLS: owner-only (`auth.uid() = user_id`).
- Indexes: `(user_id, created_at desc)`, `(parent_event_id)`, `(approval_token) where approval_token is not null`.

### A.5 Cost & AI Gateway
- Narratives generated via AI Gateway (`gemini-2.5-pro` → flash fallback). Hard-cap one LLM call per `gate`/`block` event. No LLM call for `allow`.
- Each event records `cost_cents` and contributes to `agent_budgets`.

### A.6 Acceptance criteria
- Server-side calculation matches `checkMargin` output for ≥1000 randomized fixtures (test added under `src/test/`).
- Slack approval flow: token expires at 24h, single-use, signed.
- No client component is allowed to mutate `margin_guardian_events` directly — RLS denies INSERT from anon; client uses `supabase.functions.invoke('margin-guardian', ...)`.
- Every `block` event has at least one matching `guardian_rules` row referenced by `rule_id`.

---

## Appendix B — Condition Builder: mockup spec

### B.1 Placement
- New tab inside `MarginProtectionPanel` titled **Guardian Rules** (do not create a new top-level page).
- Mobile (<1024px): full-screen sheet from bottom tab. Desktop: inline in the existing two-column layout.

### B.2 Visual structure (semantic tokens only)
```
┌─ Guardian Rules ─────────────────────────────┐
│  [+ New rule]                  [Search rules]│
├──────────────────────────────────────────────┤
│  ⚡  Swimwear margin floor          ● Active │
│      WHEN margin_below 35%                   │
│      AND  brand IS "Seafolly"                │
│      AND  po_total_above $2,000              │
│      THEN slack_approval (#buying)           │
│      Last fired: 2h ago · 12 events          │
│      [Edit] [Duplicate] [Pause] [Delete]     │
└──────────────────────────────────────────────┘
```

### B.3 Builder dialog (3 fixed sections)
1. **WHEN — Trigger** (single-select, enum):
   `margin_below`, `cost_increase_above`, `po_total_above`, `vendor_first_time`, `price_below_cost`, `compare_at_below_price`.
2. **AND — Conditions** (repeatable, AND-combined only — no OR in v1):
   Field + operator + value chips. Fields: `brand`, `vendor`, `category`, `tag`, `season`, `surface`, `po_total`, `margin_pct`, `cost_delta_pct`.
   Operators: `is`, `is_not`, `in`, `not_in`, `>`, `<`, `between`.
3. **THEN — Action** (single-select, enum):
   `log_only`, `warn_in_app`, `email_manager`, `slack_approval`, `block_order`, `require_reapply_fix`.
   Action-specific fields appear inline (Slack channel picker, manager email, etc.).

### B.4 UX rules
- Live preview chip at the top of the dialog renders the rule as a sentence (matches the card view above).
- "Test rule" button runs `margin-guardian /evaluate` against the last 30 days of events (read-only) and shows how many would have fired.
- Save is disabled until trigger + at least one condition + action are valid.
- Use shadcn `Dialog`, `Select`, `Input`, `Badge`, `Button` only. No custom colors. Status dots use `bg-primary` / `bg-warning` / `bg-destructive`.

### B.5 Storage
- `guardian_rules` table: `id, user_id, name, trigger, conditions jsonb, action, action_config jsonb, priority int, is_active bool, created_at, updated_at, last_fired_at, fire_count int`.
- RLS owner-only. Priority is integer; lower = higher precedence; ties broken by `created_at`.

### B.6 Acceptance criteria
- Rules created in the UI are evaluated by `margin-guardian` within the same request cycle (no caching layer in v1).
- Pausing a rule sets `is_active=false`; the agent skips it without deleting history.
- Deleting a rule sets `is_active=false` and soft-deletes (event history preserved by `rule_id` FK with `on delete set null`).
- "Test rule" never mutates state and never sends Slack/email.

### B.7 Out of scope for v1
- OR / nested condition groups.
- Time-window conditions (e.g. "during sale season").
- Per-rule budgets.
- Rule sharing across users.

---

## Appendix C — Margin Guardian: detailed Part A spec (locked)

This appendix is the authoritative source for the agent's runtime behaviour. Where it conflicts with Appendix A, Appendix C wins for table names, sequence, and Slack contract; Appendix A still governs RLS, AI Gateway, and event-sourcing principles.

### C.1 Core capabilities (locked)
| Capability | Implementation |
|---|---|
| Real-time cart monitoring | Chrome extension content script with `MutationObserver` on the JOOR/NuOrder cart container. Debounce 400ms. |
| Continuous margin calc | Extension calls edge function `check-batch-margin` with full cart snapshot on every change. Local product cache TTL = 5 minutes. |
| Contextual decision engine | JSON-based rule decision tree evaluated server-side in `margin-guardian` (single source of truth — extension never decides alone). |
| Proactive actions | Extension intercepts the "Place Order" click and conditionally blocks submission until rules are satisfied. |
| Cross-channel orchestration | Edge function dispatches to Slack (connector gateway), email (Resend connector), and Sonic Invoices inbox via Supabase Realtime. |

### C.2 Tables (locked names — use these in migrations)
```sql
-- Rule definitions authored via the Condition Builder
CREATE TABLE public.margin_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  actions    JSONB NOT NULL DEFAULT '[]'::jsonb,
  priority   INT  NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only decision log (event sourcing)
CREATE TABLE public.agent_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_id UUID NULL REFERENCES public.margin_rules(id) ON DELETE SET NULL,
  cart_snapshot JSONB NOT NULL,
  decision_outcome TEXT NOT NULL CHECK (decision_outcome IN ('allowed','blocked','pending_approval','approved','denied','expired')),
  action_taken JSONB NOT NULL DEFAULT '[]'::jsonb,
  approval_token TEXT NULL,
  approval_expires_at TIMESTAMPTZ NULL,
  parent_decision_id UUID NULL REFERENCES public.agent_decisions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
- RLS owner-only on both tables.
- The existing `agent_decisions` table in this project is NOT this one (it logs LLM step decisions). When migrating, namespace the new one as `margin_agent_decisions` to avoid collision with the existing `public.agent_decisions`. **Locked rename: use `margin_agent_decisions` everywhere this appendix says `agent_decisions`.**
- Indexes: `(user_id, created_at desc)`, `(approval_token) where approval_token is not null`, `(parent_decision_id)`.

### C.3 Agent loop (locked sequence)
1. Cart change detected → extension extracts cart items.
2. Extension `POST /functions/v1/margin-guardian/evaluate` with `{ surface, cart_items[], po_total, vendor, brand, context }`.
3. Edge function:
   - Loads landed costs (invoice → shopify → manual via `resolveCost`).
   - Loads active `margin_rules` for `user_id`, ordered by `priority` ASC then `created_at` ASC.
   - Computes margin per item via `checkMargin`.
   - Evaluates conditions; first matching rule wins.
   - Returns `{ allowed, reason, requiredAction, decision_id, approval_required }`.
4. Extension:
   - Renders banner (red = blocked, amber = pending approval, green = allowed).
   - If any action is `block_checkout`, disables Place Order.
   - If `manager_approval` required, exposes "Request Approval" button.
5. Approval click → `POST /margin-guardian/request-approval` → posts Slack message with signed token (24h TTL).
6. Slack button → Slack hits `POST /margin-guardian/slack-actions` → validates Slack signing secret → updates row → broadcasts via Supabase Realtime on `margin_agent_decisions`.
7. Extension subscribed to realtime channel → re-evaluates → unblocks checkout if approved.

### C.4 Slack contract (locked)
- Connector: Slack via gateway (`https://connector-gateway.lovable.dev/slack/api/...`). No direct Slack SDK from edge or extension.
- Signing secret stored as `SLACK_SIGNING_SECRET` (custom app required because we receive interactive callbacks; the connector cannot receive events).
- Approval payload (Block Kit) — exact shape:
```json
{
  "blocks": [
    {"type":"section","text":{"type":"mrkdwn","text":"*🛑 Margin Approval Required*"}},
    {"type":"section","fields":[
      {"type":"mrkdwn","text":"*Brand:*\nBrand X"},
      {"type":"mrkdwn","text":"*Total Margin:*\n38% (7% below target)"}
    ]},
    {"type":"actions","elements":[
      {"type":"button","text":{"type":"plain_text","text":"✅ Approve"},"style":"primary","value":"approve","action_id":"margin_approve"},
      {"type":"button","text":{"type":"plain_text","text":"❌ Deny"},"style":"danger","value":"deny","action_id":"margin_deny"}
    ]}
  ]
}
```
- The `value` of every button MUST embed the signed `approval_token` (e.g. `approve:{token}`). Server rejects buttons without a valid, unexpired, single-use token.

### C.5 Edge function endpoints (locked)
- `POST /margin-guardian/evaluate` — runs the loop, writes a `pending_approval`/`blocked`/`allowed` row.
- `POST /margin-guardian/request-approval` — sends Slack message, attaches token to existing row.
- `POST /margin-guardian/slack-actions` — Slack interactive callback; validates signing secret; appends `approved`/`denied` event row with `parent_decision_id`.
- `POST /margin-guardian/replay-fix` — Lesson 4 hook (see Appendix A.3).
- All endpoints validate input with Zod and return `{ error }` on 400. JWT verification disabled for `slack-actions` only (Slack cannot send a Supabase JWT) — Slack signing-secret HMAC is the auth.

### C.6 Cache & performance
- Extension keeps a 5-minute LRU of `(sku → { cost, margin })`. Invalidated on any `evaluate` response that changes cost source.
- Edge function batches DB reads: one query for rules, one for product costs (IN clause on SKUs).
- Hard cap: max 50 cart items per `evaluate` request — extension splits larger carts.

### C.7 Acceptance criteria
- Cart change → banner update p95 < 600ms on a 20-item cart.
- Slack approval round-trip updates the extension banner via Realtime in < 3s.
- Tampering with the Slack `value` token (modifying the embedded token) results in 401 and no row update.
- Every `blocked` decision references a rule_id; `pending_approval` may have `rule_id` null only when triggered by a global default (logged with `rule_id = null` and `action_taken[0].source = 'default'`).
- `cart_snapshot` is never mutated after insert (event sourcing). Subsequent state changes create new rows linked via `parent_decision_id`.

### C.8 Out of scope for v1
- Auto-applying price corrections without human confirmation (Lesson 4 still requires explicit confirm).
- Multi-rule chaining (only first matching rule fires).
- Per-line approval (approval is whole-cart in v1).
