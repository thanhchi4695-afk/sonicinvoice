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
