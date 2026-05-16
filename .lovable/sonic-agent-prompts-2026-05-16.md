# Sonic Invoices — Lovable Prompts to Build the Agent Layer (Phase 1)

Date: 2026-05-16
Companion to: `sonic-agent-architecture-2026-05-16.md`

## How to use this document

Lovable works best when you feed it **one well-scoped prompt at a time** in dependency order. Don't paste the whole document at once.

1. Run **Prompt 0 (Context Primer)** first — pin this as system context if Lovable supports it, or include the relevant bits as preamble for each later prompt.
2. Then run Prompts **1 → 2 → 3 → ... → 10** in order. Each builds on the previous.
3. Between prompts, **test in Lovable preview** before moving on. If something breaks, fix that prompt's output before stacking more.
4. **The agent ORCHESTRATOR itself is NOT built in Lovable.** That's a separate Node service on Vercel (using Claude Agent SDK). The Lovable prompts here build the UI, database, and integration endpoints. Notes throughout flag what Lovable handles vs what the external service handles.

The prompts assume:
- Lovable is using Supabase as the backend
- shadcn/ui is the component library
- Tailwind is the styling
- TanStack Query (React Query) for data fetching
- Existing Sonic Invoices app at `invoice-shop-sync.base44.app` (port to Lovable if not already)

If your Lovable setup uses different libraries, adjust the component imports in the prompts.

---

## Prompt 0 — Context Primer

Paste this at the start of a fresh Lovable conversation, or at the top of every prompt if Lovable resets context between sessions.

```
PROJECT CONTEXT — Sonic Invoices Agent Layer

I'm building Sonic Invoices, an AI-powered invoice parsing + Shopify inventory tool for Australian fashion/swimwear retailers. Anchor client: Splash Swimwear (3,858 products, 187 brands).

The app already has 70 individual flows and 6 guided pipelines (invoice → Shopify → SEO → ads → etc).

I'm now adding an AGENT LAYER. The agent runs flows autonomously on a daily heartbeat, queues high-stakes actions for human approval, and writes everything to an audit log.

ARCHITECTURE:
- Lovable handles: UI (chat panel, approval inbox, audit log, briefing view, settings), Supabase database tables for agent state, REST endpoints that the external agent calls back to.
- EXTERNAL SERVICE (not built in Lovable): A Node service on Vercel running the Claude Agent SDK. It plans actions, executes flows via MCP, and writes results back to our Supabase tables via REST.
- The agent service is at: https://sonic-agent.vercel.app (placeholder URL; configure as env var SONIC_AGENT_URL).

AUTONOMY RULES:
- 🟢 Full autonomy: content / SEO / tagging / image optimization / product descriptions / collection SEO / feed health — agent just does it and writes to audit log.
- 🟡 Approval-gated: anything that spends money or touches live ads — POs, accounting bills, price changes, markdowns, ad spend, Shopify product creation. Agent prepares, user approves in inbox.
- 🔴 Never agentic: competitor intel, season setup, migration flows.

DATABASE TABLES TO CREATE (covered in Prompt 1):
- agent_runs (one row per agent invocation)
- agent_actions (one row per action taken within a run)
- approval_queue (pending human approvals)
- scheduled_tasks (cron-style triggers)
- audit_log (append-only record of every action)

DESIGN PRINCIPLES:
- Calm, trustworthy UI. The retailer is handing the agent meaningful power; the UI should make them feel safe.
- Every agent action is visible and reversible (where possible).
- Approval inbox is the most important UI surface — make it delightful to triage.
- Dry-run mode toggle in settings so I can test without real-world side effects.
- Mobile-friendly. Splash's owner reviews approvals on her phone in the morning.

UI LIBRARY: shadcn/ui with Tailwind. Components I want to use: Card, Dialog, Tabs, Table, Badge, Button, Separator, Toast, Form components.

Confirm you understand before I send the next prompt.
```

---

## Prompt 1 — Database Schema (Supabase)

```
Add these 5 new tables to my Supabase database with the following columns, indexes, and RLS policies.

1. TABLE: agent_runs
- id (uuid, primary key, default gen_random_uuid())
- trigger_type (text, enum-like: 'invoice_received', 'cron_daily_briefing', 'cron_slow_stock', 'cron_reorder', 'cron_ad_check', 'user_chat', 'webhook')
- trigger_payload (jsonb, the original event payload)
- status (text, enum: 'planning', 'executing', 'awaiting_approval', 'completed', 'failed', 'cancelled')
- planner_model (text, e.g. 'claude-opus-4-6')
- executor_model (text, e.g. 'claude-haiku-4-5-20251001')
- plan_summary (text, the agent's stated plan in natural language)
- started_at (timestamptz, default now())
- completed_at (timestamptz, nullable)
- error_message (text, nullable)
- dry_run (boolean, default false)
- user_id (uuid, references auth.users)
- shop_id (uuid, references shops table — assume this exists)

2. TABLE: agent_actions
- id (uuid, primary key, default gen_random_uuid())
- run_id (uuid, references agent_runs.id, on delete cascade)
- flow_name (text, e.g. 'product_descriptions', 'shopify_push')
- autonomy_level (text, enum: 'autonomous', 'approval_gated', 'never_agentic')
- status (text, enum: 'pending', 'executing', 'awaiting_approval', 'approved', 'rejected', 'completed', 'failed', 'rolled_back')
- input_payload (jsonb)
- output_payload (jsonb, nullable)
- diff_summary (text, human-readable summary of what changed — for the audit log UI)
- approval_queue_id (uuid, nullable, references approval_queue.id)
- started_at (timestamptz, default now())
- completed_at (timestamptz, nullable)
- error_message (text, nullable)
- rolled_back_at (timestamptz, nullable)
- rolled_back_by (uuid, nullable, references auth.users)

3. TABLE: approval_queue
- id (uuid, primary key, default gen_random_uuid())
- run_id (uuid, references agent_runs.id, on delete cascade)
- title (text, short summary — e.g. "Apply markdown to 23 styles, $X savings")
- description (text, longer details for the inbox detail view)
- proposed_actions (jsonb, the structured plan — list of {flow_name, input_payload, estimated_impact})
- estimated_impact (jsonb, e.g. {money_out: 1234.56, products_affected: 23, currency: 'AUD'})
- priority (text, enum: 'low', 'medium', 'high', 'urgent')
- status (text, enum: 'pending', 'approved', 'rejected', 'expired', 'cancelled')
- created_at (timestamptz, default now())
- approved_at (timestamptz, nullable)
- approved_by (uuid, nullable, references auth.users)
- rejection_reason (text, nullable)
- expires_at (timestamptz, nullable — default to created_at + 7 days)
- category (text, enum: 'money_out', 'live_ads', 'live_catalog', 'other')
- shop_id (uuid, references shops)

4. TABLE: scheduled_tasks
- id (uuid, primary key, default gen_random_uuid())
- name (text, e.g. 'Daily Operations Briefing')
- description (text)
- cron_expression (text, e.g. '0 8 * * *')
- timezone (text, default 'Australia/Darwin')
- enabled (boolean, default true)
- trigger_type (text — matches agent_runs.trigger_type)
- trigger_payload (jsonb, default '{}')
- last_run_at (timestamptz, nullable)
- next_run_at (timestamptz, nullable)
- created_at (timestamptz, default now())
- shop_id (uuid, references shops)

5. TABLE: audit_log
- id (uuid, primary key, default gen_random_uuid())
- run_id (uuid, nullable, references agent_runs.id)
- action_id (uuid, nullable, references agent_actions.id)
- event_type (text, e.g. 'action_started', 'action_completed', 'approval_requested', 'approval_granted', 'approval_rejected', 'rollback', 'manual_override')
- actor (text — 'agent' or user uuid or 'system')
- payload (jsonb)
- created_at (timestamptz, default now())
- shop_id (uuid, references shops)

INDEXES:
- agent_runs(shop_id, status, started_at desc)
- agent_actions(run_id, status)
- approval_queue(shop_id, status, priority, created_at desc)
- scheduled_tasks(shop_id, enabled, next_run_at)
- audit_log(shop_id, created_at desc)
- audit_log(action_id)

RLS POLICIES:
- All tables: users can only read/write rows where shop_id matches a shop they belong to (assume there's a shop_users join table; if not, scaffold one with user_id, shop_id, role columns).
- Add a service_role bypass policy so the external agent service (using the service key) can read/write all rows.

After creating these, generate TypeScript types for each table and export them from src/types/agent.ts.
```

---

## Prompt 2 — REST endpoints for the external agent to call

```
Build Supabase Edge Functions (or Lovable serverless functions if that's the convention here) for the following REST endpoints. These are how the EXTERNAL agent service writes back into our database. All endpoints require the SONIC_AGENT_API_KEY header (validate against an env var) — NOT user auth, because the agent acts on behalf of the shop, not a user.

1. POST /api/agent/runs
   Creates a new agent_runs row.
   Body: { shop_id, trigger_type, trigger_payload, planner_model, executor_model, plan_summary, dry_run }
   Returns: { run_id }

2. PATCH /api/agent/runs/:run_id
   Updates an agent_runs row (status, completed_at, error_message).
   Body: { status?, completed_at?, error_message? }
   Returns: { ok: true }

3. POST /api/agent/actions
   Creates an agent_actions row.
   Body: { run_id, flow_name, autonomy_level, input_payload, diff_summary? }
   Returns: { action_id }
   Side effect: writes an audit_log row event_type='action_started'.

4. PATCH /api/agent/actions/:action_id
   Updates an agent_actions row.
   Body: { status?, output_payload?, diff_summary?, completed_at?, error_message? }
   Returns: { ok: true }
   Side effect: writes an audit_log row event_type='action_completed' or 'action_failed'.

5. POST /api/agent/approvals
   Creates an approval_queue row.
   Body: { run_id, shop_id, title, description, proposed_actions, estimated_impact, priority, category, expires_at? }
   Returns: { approval_id }
   Side effect: writes audit_log row event_type='approval_requested'. Optionally triggers a notification (skip notification logic for Phase 1; just write to DB).

6. GET /api/agent/approvals/:approval_id
   Returns the full approval payload (for the agent to check status after approval).
   Returns: { id, status, approved_at, rejection_reason, ... }

7. POST /api/agent/audit
   Append-only audit log writer.
   Body: { run_id?, action_id?, event_type, actor, payload, shop_id }
   Returns: { ok: true }

ERROR HANDLING:
- Return 401 if SONIC_AGENT_API_KEY missing/invalid.
- Return 400 with clear message on validation failure.
- Return 404 on unknown run_id/action_id/approval_id.
- Return 500 on DB errors with the message.

ADDITIONAL: also add a USER-FACING endpoint:
8. POST /api/approvals/:approval_id/decide
   Authenticated user endpoint. Body: { decision: 'approve' | 'reject', reason?: string }
   Updates approval_queue.status, approved_at, approved_by, rejection_reason.
   Side effect: writes audit_log row event_type='approval_granted' or 'approval_rejected'.
   Returns: { ok: true, status }
   This endpoint is what the approval inbox UI calls when the user taps approve/reject.

Generate the endpoint code with proper Supabase service-role usage. Validate inputs with Zod.
```

---

## Prompt 3 — Agent Chat Panel UI

```
Build a new page/route at /agent. This is the agent chat panel.

LAYOUT:
- Full-height layout, two-column on desktop (chat on left ~70%, current run details on right ~30%), single-column on mobile.
- Top bar: title "Sonic Agent" with a small "online" status dot + Dry Run toggle on the right.
- Main chat area: scrollable message thread.
- Bottom: input box with send button + a "Quick actions" row of chip buttons above the input.

CHAT MESSAGES:
Three message types, each visually distinct:
- USER message: right-aligned, primary background, white text.
- AGENT message: left-aligned, secondary background, includes a small "Sonic Agent" label with model badge ("opus-4-6" or "haiku-4-5").
- SYSTEM message: centered, muted, used for events like "Action completed: image_optimise (12 products tagged)" with an icon.

When the agent is "thinking", show a typing indicator (3 animated dots) on a placeholder agent message.

CHAT BEHAVIOR:
- On send, POST { message, run_id? } to ${SONIC_AGENT_URL}/chat with the user's auth token.
- The agent service returns a streaming response (SSE). Render tokens as they arrive.
- When the agent decides to take an action, it streams a special event: { type: 'action', action_id, flow_name, autonomy_level }. Render this as a SYSTEM message with a status badge.
- When an action needs approval, the agent streams { type: 'approval_requested', approval_id, title }. Render as a SYSTEM message with a "Review in inbox →" link button.

QUICK ACTIONS (chip buttons above input):
- "Process inbox" — sends "Check my inbox and process new invoices"
- "Today's briefing" — sends "Give me today's briefing"
- "Slow stock report" — sends "What slow stock should I markdown?"
- "Reorder check" — sends "What should I reorder this week?"

RIGHT-COLUMN PANEL — Current Run Details:
- Shows the active agent_run (status, plan_summary, list of agent_actions with status badges).
- Status badges: 🟢 completed, 🟡 awaiting approval, 🔵 executing, 🔴 failed, ⚪ pending.
- Tap an action to see its diff_summary in a Dialog.
- If no active run, show "No active run. Try a quick action or ask the agent something."

REAL-TIME UPDATES:
- Subscribe to Supabase realtime on agent_actions where run_id = current run. Update the right panel as actions progress.
- Subscribe to approval_queue inserts for the current run. When one appears, show a Toast: "Approval needed: {title}. Review →".

EMPTY STATE:
- If user has never used the agent before, show a friendly intro card: "Hi, I'm Sonic Agent. I run your back-office tasks autonomously. Try a quick action above or just tell me what you need."

DESIGN NOTES:
- Use shadcn Avatar for the agent icon. Use a calm color palette (indigo for primary agent color, slate for system messages).
- Make it feel like a thoughtful colleague, not a chatbot. Avoid "I am an AI..." preambles. The agent's responses should be direct and useful.
- Mobile: chat thread + a sticky bottom sheet that swipes up to show the run details panel.

ACCESSIBILITY:
- Chat input has a clear label, message thread has aria-live="polite" so screen readers announce new messages.
```

---

## Prompt 4 — Approval Inbox UI

```
Build a new page/route at /approvals. This is the approval inbox — the most important UI in the agent system.

LAYOUT:
- Top bar: title "Approval Inbox" + count badge of pending approvals (e.g. "Approval Inbox (4)") + filter chips.
- Filter chips: All, Money Out, Live Ads, Live Catalog. Selected chip has primary color.
- Sort dropdown: "Newest first" (default) / "Highest priority" / "Highest impact".
- Main area: list of approval cards. On wide screens (md+), also show a right-panel detail view of the selected card.

EACH APPROVAL CARD (list view):
- Left edge: colored stripe by category (money_out=amber, live_ads=red, live_catalog=blue, other=slate).
- Title (text-base font-semibold).
- One-line description (text-sm muted).
- Estimated impact row: "$1,234.56 spend" or "23 products affected" or "12 ad sets paused" with appropriate icon.
- Right side: priority badge + age ("2h ago" / "yesterday" / "3 days ago") + checkbox for bulk select.
- Hover: subtle elevation. Selected: thicker border in primary color.

DETAIL PANEL (right side on desktop, full-screen Dialog on mobile):
- Title + full description.
- Estimated impact (formatted table).
- "Proposed actions" section: a numbered list of the actions the agent will take if approved. Each shows flow_name, a short summary of what it'll do, and the input payload in a collapsed details element.
- "Why the agent suggests this" section: a paragraph the agent provides (passed in proposed_actions or description).
- "Originating run" link: takes user to /agent?run_id=...
- Two big buttons at the bottom: "Approve" (primary, green) and "Reject" (secondary, with a small dropdown for reason).
- Approve confirmation: A small Dialog "Are you sure? This will trigger the proposed actions immediately." with a "Don't ask again for this category" checkbox (stores in localStorage).
- Reject reason: dropdown with presets ("Wrong product selection", "Wrong amount", "Bad timing", "Other → text input").

BULK ACTIONS:
- When 2+ rows selected, show a sticky bottom bar with "Approve N selected" and "Reject N selected" buttons.
- Bulk approve has the same confirmation Dialog. Don't allow bulk approve across different categories — show a warning if the user mixes.

API CALLS:
- Load list: GET /api/approvals?status=pending&shop_id=... (filter & sort client-side for Phase 1).
- Approve: POST /api/approvals/:approval_id/decide { decision: 'approve' }
- Reject: POST /api/approvals/:approval_id/decide { decision: 'reject', reason }
- Subscribe to Supabase realtime on approval_queue inserts/updates for live count update.

EMPTY STATE:
- "Inbox zero. Nothing waiting for your approval right now. 🌴"
- Below: "Looking for past approvals? View history →" (links to /approvals?status=all).

EXPIRY:
- Approvals older than expires_at (default 7 days) show a red banner "Expired — re-trigger if still relevant" and disable the approve button.

MOBILE BEHAVIOR:
- Tap a card → full-screen detail Dialog with slide-in animation.
- Bottom bar with Approve / Reject buttons is sticky.
- Bulk-select hidden on mobile; show "Select" toggle in top bar that enables checkboxes.

DESIGN NOTES:
- Money-out approvals get extra visual weight (slightly larger card, bolder dollar amount).
- Use the existing shadcn Card, Badge, Button, Dialog, Checkbox components.
- Aim for "tappable in 2 seconds" — Splash's owner reviews from her phone over coffee.
```

---

## Prompt 5 — Audit Log Viewer

```
Build a new page/route at /audit. This is the audit log viewer — every agent action ever taken, visible and filterable.

LAYOUT:
- Top bar: title "Agent Audit Log" + date range picker (default: last 7 days) + filters + Export CSV button.
- Filters: Flow name (multi-select), Status (Completed / Failed / Rolled back), Autonomy (Autonomous / Approval-gated), Actor (Agent / User).
- Main: timeline view (vertical, newest at top), grouped by day with day headers.

EACH ROW:
- Timestamp (HH:MM, with full date in tooltip).
- Status icon (✓ green, ✗ red, ↺ rolled back, ⏳ in progress).
- Flow name (e.g. `product_descriptions`) styled as a badge.
- Diff summary (one line, e.g. "Generated descriptions for 12 Splash products").
- Right side: actor badge ("agent" / user email).
- Click row → expandable detail with input_payload + output_payload in collapsed code blocks + a "Rollback" button if autonomy_level='autonomous' AND completed_at within 24h.

ROLLBACK BUTTON:
- Calls POST /api/agent/actions/:action_id/rollback.
- The endpoint forwards to ${SONIC_AGENT_URL}/rollback with the action_id.
- The agent service handles the actual reversal logic (e.g. revert tag changes, restore old description). Lovable just shows status.
- On success: row updates to status='rolled_back', show a Toast "Rolled back. Original state restored."
- On failure: show error in Toast and keep status as 'completed' with a small warning icon.

EXPORT CSV:
- Generates a CSV with columns: timestamp, run_id, action_id, flow_name, autonomy_level, status, diff_summary, actor.
- Filtered by current view filters.
- Downloads via browser download.

EMPTY STATE:
- "No agent activity in this period. Try a wider date range or check if the agent is enabled in Settings."

DESIGN NOTES:
- Day group headers are sticky as you scroll.
- Use monospaced font for code blocks (JSON payloads).
- Differentiate autonomous vs approval-gated visually with a small icon next to flow_name.
```

---

## Prompt 6 — Daily Operations Briefing Component

```
Build a new component <DailyBriefing /> that renders on the main dashboard at /. It shows the most recent daily briefing the agent produced.

DATA SOURCE:
- Query for the most recent agent_runs row where trigger_type='cron_daily_briefing' and status='completed', ordered by completed_at desc. Limit 1.
- The briefing content lives in agent_runs.plan_summary as markdown (the agent's morning summary).

CARD LAYOUT:
- Card title: "Morning Briefing" + relative time ("today, 8:02am" / "yesterday, 8:01am").
- Body: render the markdown content. Use a markdown-renderer that supports bullets and inline emoji.
- Footer: row of action chips, one per topic the briefing surfaces.

THE 5-BULLET FORMAT:
The agent produces briefings in this canonical shape (don't enforce in Lovable, just expect):
1. 📥 Inbox: N new invoices arrived overnight (link → /agent + chip "Process inbox")
2. 📦 Stock: N items are running low / N items sold out (link → /flows/restock_suggestions)
3. 🐌 Slow stock: N styles need markdown attention (chip "Run slow-stock killer")
4. 📊 Ads: ROAS up/down X% week-over-week (link → /flows/performance)
5. ✅ Last night: Agent completed N autonomous actions (link → /audit)

EACH BULLET:
- Bullet text rendered as markdown.
- Below the text, a row of clickable chips (only for topics that have a CTA). Chips trigger either a navigation or a POST to the agent.

EMPTY STATE:
- If no briefing exists yet: show "Your first briefing arrives tomorrow at 8am. Until then, here's how the agent works → " with a "Learn more" link.
- If the briefing is older than 36 hours (agent missed a run): show a warning badge "Briefing missed yesterday — check agent status".

REFRESH BUTTON:
- Small refresh icon in the top-right of the card. Calls POST /api/agent/runs/trigger { trigger_type: 'cron_daily_briefing', force: true } to re-run on demand.

DESIGN NOTES:
- Use a calm, low-stim color scheme. The briefing is the first thing the retailer sees in the morning — it should feel inviting, not alarming.
- Make it the top card of the dashboard, full-width on mobile, half-width on desktop with other dashboard cards on the right.
```

---

## Prompt 7 — Scheduled Tasks Manager (Settings)

```
Add a new section to the Settings page at /settings titled "Scheduled Tasks". This lets the retailer view and configure the agent's cron jobs.

DATA:
- Reads from the scheduled_tasks table for the current shop.

LIST VIEW:
- Each scheduled task is one Card.
- Card shows: Name, Description, Schedule (human-readable from cron expression, e.g. "Every day at 8:00 AM Darwin time"), Last run, Next run, Enabled toggle.
- The Enabled toggle calls PATCH /api/scheduled_tasks/:id { enabled: bool }.

DEFAULT TASKS (seed these on first load if missing):
1. Daily Operations Briefing — cron `0 8 * * *` Darwin tz — trigger_type='cron_daily_briefing'
2. Weekly Slow Stock Review — cron `0 8 * * 1` Darwin tz (Monday 8am) — trigger_type='cron_slow_stock'
3. Weekly Reorder Review — cron `0 8 * * 3` Darwin tz (Wednesday 8am) — trigger_type='cron_reorder'
4. Daily Ad Performance Check — cron `0 16 * * *` Darwin tz — trigger_type='cron_ad_check'

EDIT DIALOG:
- Tap a task to open a Dialog with editable fields: Name, Description, Cron expression, Timezone (dropdown of common timezones).
- Validate cron expressions client-side (use a library like `cron-parser`).
- Show a "Preview next 5 runs" section that lists the next 5 times this would fire.
- Save calls PATCH /api/scheduled_tasks/:id.

MANUAL TRIGGER:
- Each task has a "Run now" button (small, outline style).
- Calls POST /api/agent/runs/trigger { trigger_type, force: true }.
- Shows a Toast "Triggered. Agent will start within a minute."

DESIGN NOTES:
- Friendly schedule formatter ("Every Monday at 8:00 AM" not "0 8 * * 1").
- If a task hasn't run in 2× its expected interval, show a warning badge "Behind schedule".
```

---

## Prompt 8 — Agent Settings page

```
Add a new section to the Settings page at /settings titled "Agent". This controls the agent's behavior at a shop level.

FIELDS (all stored in a new agent_settings table — create it if it doesn't exist, with shop_id, key, value (jsonb), updated_at columns):

1. AGENT ENABLED toggle.
   - Big switch at the top: "Agent is ON / OFF".
   - When off: the cron jobs don't fire, the chat panel shows "Agent is paused. Re-enable to resume."

2. DRY RUN MODE toggle.
   - Sub-toggle that only matters when agent is on.
   - When dry-run is on: agent runs through its planning + autonomous actions but writes only to audit_log and never makes real external API calls (no Shopify writes, no Xero, no Meta).
   - Show a warning chip when dry-run is on: "Dry run mode — agent is simulating, no real changes will happen."

3. AUTONOMY LEVEL slider/select with three presets:
   - "Conservative" — every action requires approval (overrides the autonomous flows).
   - "Balanced" (default) — content/SEO/tagging autonomous, money/ads gated.
   - "Aggressive" — also allow social media auto-publish without approval, allow autonomous price match within ±5%.
   - Note below: "You can override individual flows in the Advanced section below."

4. ADVANCED FLOW OVERRIDES (collapsed by default):
   - Table of all flows (use the list from sonic-flows.md — there are 70).
   - For each: dropdown with options "Autonomous / Approval / Disabled".
   - Defaults follow the autonomy_level preset; user can override individual flows.

5. APPROVAL EXPIRY DAYS slider.
   - "Approvals expire after [N] days if not actioned."
   - Default 7. Range 1-30.

6. NOTIFICATIONS section:
   - Email digest of pending approvals: dropdown "Off / Daily 8am / Daily 5pm / On every new approval".
   - Send to: email input (default to logged-in user's email).

7. DOLLAR THRESHOLD:
   - "Auto-approve POs and ad spend changes under $X" (default $0 = always require approval).
   - Range $0 - $500 in $50 increments.

SAVE BEHAVIOR:
- Settings save on change with a debounced Toast "Saved" (no Save button — instant save).
- The external agent service reads agent_settings on each run start, so changes propagate within one cron tick.

DESIGN NOTES:
- Group fields with a Separator and clear section headers.
- Use shadcn Switch, Select, Slider, Input components.
- The Dry Run toggle should be visually prominent (with a yellow warning icon) so it's clear this is a powerful setting.
```

---

## Prompt 9 — Realtime notifications & badge counts

```
Wire up realtime notifications for the agent system so the retailer sees activity without refreshing.

GLOBAL NAV BAR BADGES:
- "Approvals" nav link: subscribe to Supabase realtime on approval_queue inserts/updates for the current shop. Show a count badge of pending approvals. Update live as approvals are added or actioned.
- "Audit" nav link: no badge needed (audit log is historical, doesn't demand attention).
- "Agent" nav link: badge dot (no number) when there's an active running agent_run (status='executing' or 'planning' or 'awaiting_approval').

TOAST NOTIFICATIONS:
- When a new approval_queue row arrives (subscribed via realtime), show a Toast: "Approval needed: {title}. Review →" with a button linking to /approvals.
- When an agent_run completes successfully, show a subtle Toast: "Agent completed: {plan_summary truncated to 60 chars}".
- When an agent_run fails, show a Toast variant 'destructive': "Agent failed: {error_message}. View details →".

OPTIONAL: BROWSER PUSH NOTIFICATIONS:
- In Settings → Agent → Notifications, add a "Enable browser notifications" toggle.
- Use the Web Push API. When approvals arrive, push a notification even if the app isn't open.
- For Phase 1, this can be skipped if it adds friction — flag for Phase 2.

IMPLEMENTATION:
- Use @supabase/supabase-js realtime subscription.
- Wrap subscriptions in a custom hook useAgentNotifications() that the root layout calls once.
- Show all toasts via the existing shadcn Toaster.
```

---

## Prompt 10 — Connect existing flows to the agent (back-references)

```
Add cross-linking between the existing 70 flow pages and the agent system. The goal: every time the user manually opens a flow, they should see whether the agent has touched it recently, and have the option to delegate to the agent next time.

ON EVERY FLOW PAGE:
Add a small banner at the top of the page that shows:
- "Last agent run: {time}, {status}" if any agent_actions exist for this flow_name in the last 30 days.
- A "Delegate to agent" button that triggers POST /api/agent/runs/trigger with { trigger_type: 'user_chat', trigger_payload: { request: 'Run the {flow_name} flow', flow_name }, force: true }.
- If no recent agent activity, just show the "Delegate to agent" button.

ON THE PIPELINE RUNNER PAGE (/flows/pipeline):
- Add a third option alongside "Run manually" and "Run with prompts": "Run with agent" (with a small agent icon).
- "Run with agent" submits to the agent service which executes the full pipeline autonomously, gating only at the approval-gated steps.
- Show a progress view that mirrors the agent chat panel's right-side run details panel.

DON'T MODIFY THE FLOW LOGIC ITSELF. This prompt only adds the agent-delegation surface to existing flow pages. The flow logic remains as-is.

NAVIGATION:
- Add an "Agent" top-nav item with a sparkles icon, ordered between Dashboard and Flows.
- Sub-nav under Agent: Chat (/agent), Approvals (/approvals), Audit (/audit), Briefing (default landing on /agent dashboard view).
```

---

## Prompt 11 (optional, Phase 1.5) — Mobile-first approval review screen

```
Build a dedicated mobile-optimized approval review experience at /m/approvals. This is for Splash's owner reviewing on her phone in the morning.

ONE-AT-A-TIME REVIEW:
- Full-screen card per approval, swipe up/down to navigate between approvals.
- Top: title + category badge.
- Middle: estimated impact in big, readable text ($1,234.56 in 36pt font).
- Detail: full description + proposed actions list.
- Bottom: two huge thumb-friendly buttons — Reject (left, secondary) and Approve (right, primary).
- Swipe right to approve, swipe left to reject (with a confirmation slide).

GESTURES:
- Use a library like react-spring or framer-motion for the swipe animations.
- Add haptic feedback (navigator.vibrate) on approve/reject.
- Show a progress dot indicator at the top "3 of 12".

QUICK REJECT REASONS:
- After swiping left, show 4 quick-reason chips: "Wrong selection", "Wrong amount", "Bad timing", "Other".
- Tap a chip to submit.

DONE STATE:
- When all approvals have been actioned, show a celebratory empty state: "All caught up. Have a great day, {first name}. 🌴"

DESIGN NOTES:
- This is a delight surface. Make it feel as good as Tinder for retail ops.
- Hide the rest of the app chrome (no top nav, no side nav) — this is a focused review mode.
- "Exit review" button in top-left to return to /approvals.
```

---

## Order of execution — recommended timing

| Day | Prompt | Why |
|---|---|---|
| Day 1 | Prompt 0 (primer) | Sets Lovable's context. |
| Day 1 | Prompt 1 (schema) | Foundation for everything. Test by inspecting tables in Supabase. |
| Day 2 | Prompt 2 (REST endpoints) | The external agent needs these to write back. Test with curl. |
| Day 3 | Prompt 8 (agent settings) | Build the kill-switch first. Critical for safe testing. |
| Day 4 | Prompt 5 (audit log) | Build visibility before you build power. |
| Day 5 | Prompt 4 (approval inbox) | Most important user-facing surface. |
| Day 6 | Prompt 6 (briefing) | Engagement driver. |
| Day 7 | Prompt 7 (scheduled tasks) | Wire the cron config. |
| Day 8 | Prompt 3 (chat panel) | Now you have all the supporting infra, build the chat. |
| Day 9 | Prompt 9 (realtime notifications) | Polish. |
| Day 10 | Prompt 10 (back-references) | Final integration. |
| Day 11+ | Prompt 11 (mobile review) | Phase 1.5 polish if time permits. |

If you have a fast Lovable plan (auto-generate per prompt), you'll move faster than one prompt/day. The bottleneck is testing each prompt's output, not generating it.

---

## What's NOT in these prompts (and why)

These are deliberately omitted from Lovable's scope:

1. **The Claude Agent SDK orchestrator service.** This is a Node service on Vercel that Lovable doesn't host. Build separately. Skeleton in next section.

2. **The Sonic MCP server.** Also separate. Wraps your existing flow APIs as MCP tools.

3. **Claude API calls.** Never call Claude from Lovable directly — always through your external agent service. Lovable is the UI + database; the agent service is the brain.

4. **Webhooks from Shopify/Xero/Meta.** These hit the agent service first, which then writes to Supabase via the REST endpoints in Prompt 2.

5. **Email sending.** Use a service like Resend or Postmark — call from the agent service, not Lovable.

---

## Quick-start companion: the agent service skeleton

For the part Lovable doesn't build, here's the minimum viable scaffold for the external Node service. Paste this into a fresh Node project (not Lovable):

```
sonic-agent/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                  // Express app, routes
│   ├── orchestrator.ts           // Claude Agent SDK setup
│   ├── mcp-server.ts             // Sonic MCP server (wraps flow APIs)
│   ├── routes/
│   │   ├── chat.ts               // POST /chat — user message → agent run
│   │   ├── trigger.ts            // POST /trigger — webhook / cron entry
│   │   └── rollback.ts           // POST /rollback — undo an action
│   ├── flows/                    // Wrappers for each Sonic flow API
│   │   ├── product_descriptions.ts
│   │   ├── image_optimise.ts
│   │   └── ... (one per flow)
│   ├── lib/
│   │   ├── supabase.ts           // service-role client
│   │   ├── claude.ts             // Anthropic SDK client
│   │   └── audit.ts              // helper to write audit_log rows
│   └── types.ts
└── .env                          // ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, SONIC_AGENT_API_KEY
```

Key dependencies:
- `@anthropic-ai/claude-agent-sdk` — the agent runtime
- `@modelcontextprotocol/sdk` — for the MCP server
- `@supabase/supabase-js` — DB writes
- `express` + `zod` — routes + validation
- `node-cron` — cron triggers (or use Vercel Cron from outside the app)

Deploy to Vercel:
- Set the env vars in Vercel project settings.
- Point Vercel Cron at `/trigger?type=cron_daily_briefing` etc.
- Add the URL to Lovable's env vars as `SONIC_AGENT_URL`.

Build this BEFORE running Prompt 3 (chat panel) — otherwise the chat has nothing to talk to.

---

## After Phase 1 — what these prompts unlock

By the time you've worked through Prompts 0-10 + built the agent service, you'll have:

- ✅ Daily Operations Briefing running at 8am NT
- ✅ Agentic new_arrivals_full (most steps autonomous, money/Shopify gated)
- ✅ Slow Stock Killer (weekly, with markdown floor protection)
- ✅ Approval inbox + audit log + chat panel + settings
- ✅ All running on Splash live with case-study data being captured

Phase 2 prompts (not in this doc — write them after Phase 1 stabilises):
- Restock Loop pipeline + PO drafting UI
- Ad Performance Check + ROAS anomaly detection UI
- Cold Brand Cold Start pipeline
- Mobile-first approval review (Prompt 11 elevated to standard)

Phase 3:
- Conversational co-pilot upgrades (multi-shop awareness, brand-specific personality)
- Cross-retailer flywheel (anonymised pattern pooling — needs data policy)
- White-label option for agency partners
