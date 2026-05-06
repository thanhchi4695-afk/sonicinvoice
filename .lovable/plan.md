# Proactive Sonic — Architecture Plan

## Core Concept: From Reactive to Proactive

Today Sonic waits for the user to type. A true employee watches, notices, and brings work to you. Three new capabilities layered on top of the existing PipelineRunner (23 flows), WhatsNextSuggestions, and task graph:

1. **Watch** — monitor signals (invoice arrives, stock drops, step completes, timer fires)
2. **Decide** — Claude reads the signal, checks the task graph, picks the right next action
3. **Report** — tell the user what it found, ask permission, then execute and hand off to the next step

---

## Layer 1 — The 4 Trigger Types

### Trigger 1: Event-based (invoice arrives)
When a new invoice lands in the email inbox or is uploaded, Sonic doesn't just parse it and stop. It asks: "Based on this invoice, what chain of tasks should happen next?"
- Example: Seafolly new arrivals invoice → parse → stock check → tags → SEO titles → feed update → social captions (6 auto-queued tasks).

### Trigger 2: Scheduled timer (morning scan)
Daily at a set time Sonic checks:
- unprocessed supplier emails in inbox
- products with stock below threshold
- approaching seasonal deadlines (e.g. end of summer = season close pipeline)

Posts a morning briefing into chat:
> "Good morning. 3 supplier emails waiting. Baku is low on sizes 10–12. Summer season ends in 3 weeks — want me to start the season close pipeline?"

### Trigger 3: Data change
When a pipeline step completes (e.g. tags generated), Sonic notices and suggests the next step. This promotes `WhatsNextSuggestions` from passive panel into actionable chat messages.

### Trigger 4: Step completion hand-off
After any pipeline step finishes, the brain reads the task graph and fires the next suggestion immediately — no waiting. This is what makes it feel like an employee rather than a button.

---

## Layer 2 — The Brain (Proactive Claude call)

A second Claude call, separate from the chat intent classifier. Where the chat system prompt handles user messages, the proactive brain runs on triggers with its own system prompt.

Inputs to the brain on each trigger:
- Trigger type and payload (event/timer/data-change/step-completion)
- Snapshot of relevant app state (last invoice, pending emails, stock levels, current pipeline run)
- The full task graph (so it knows valid next steps)
- User preferences/history (auto-approved actions, blocked actions)

Output (structured, tool-call):
- `headline` — one-line briefing
- `suggested_chain` — ordered list of pipeline step ids
- `auto_run` — which steps may run without confirmation
- `confirmation_required` — which steps need a Yes button
- `chat_message` — markdown to post into Sonic chat

---

## Layer 2.5 — Brain System Prompt (locked)

This is the system prompt for the `sonic-proactive-brain` Claude call. It runs on triggers, not on user messages.

```
You are Sonic's proactive task manager. You run automatically when
triggered — not when the user types. Your job is to look at what
just happened, check what's pending, and decide what to do next.

You ALWAYS ask permission before executing multi-step tasks.
You NEVER act silently — every action gets reported in the chat.
You pick the most logical next step, not the most ambitious one.

Current state: {trigger_type} · {trigger_context} · {open_tasks} ·
{completed_today} · {user_preference_for_automation}

Return JSON:
{
  "observation": "what you noticed",
  "proposed_action": "what you want to do next",
  "requires_permission": true/false,
  "permission_question": "question to ask user",
  "pipeline_to_run": "pipeline_key or null",
  "immediate_actions": [],
  "skip_reason": "why you're not acting if you're not"
}
```

Template variables filled by the watcher before each call:
- `trigger_type` — one of `invoice_arrived` | `scheduled_timer` | `data_change` | `step_completed`
- `trigger_context` — payload summary (invoice id + brand, low-stock SKUs, last completed step, etc.)
- `open_tasks` — pending rows from `agent_tasks`
- `completed_today` — tasks already done in last 24h (avoid re-suggesting)
- `user_preference_for_automation` — `conservative` | `balanced` | `aggressive` from user settings

---

## Layer 3 — Wiring

- **Watch sources:** invoice ingest webhook, `invoice_processing_jobs` insert, low-stock cron, scheduled morning cron, pipeline step completion event.
- **Decide:** new edge function `sonic-proactive-brain` (Claude Sonnet 4) called by each watcher.
- **Report:** writes assistant message into `chat_messages` with `action_data.proactive = true`. SonicChat renders these with chip buttons (Run / Skip / Snooze) and badge "Proactive".
- **Execute:** confirm → fire existing `runParseFromChat` / pipeline runner / inline action. On step completion, dispatch event back into the brain for next hand-off.

---

## Open Questions / Decisions to Make

1. Morning briefing time — fixed (e.g. 7:00 local) or user-configurable?
2. Default auto-run posture — conservative (everything asks) or aggressive (low-risk steps auto-run)?
3. Snooze model — per-trigger, per-suggestion, or quiet hours?
4. Notification surface — only in chat panel, or also a desktop/Shopify badge when panel closed?
5. Where does the task graph live — keep in code or move to DB so the brain can read it dynamically?

---

## Build Order (proposed)

1. **Foundations:** add `proactive` flag + chip buttons to chat message rendering. No behaviour change yet.
2. **Trigger 4 (step hand-off):** wire pipeline-step events into a single brain call; smallest blast radius.
3. **Trigger 3 (data change):** promote WhatsNextSuggestions output into chat via the brain.
4. **Trigger 1 (event):** invoice-arrives → suggested chain.
5. **Trigger 2 (morning scan):** scheduled cron + briefing message.
6. **Polish:** snooze, auto-run preferences, badge when closed.

---

## Layer 3 (expanded) — What It Actually Does

### Immediate actions (no pipeline needed)
After parsing a Baku invoice with 3 new styles, Sonic instantly generates tags and SEO titles for all 3 inline in chat — without asking, because these are fast, reversible, and low-risk. Then says: *"Tags and SEO titles done for 3 Baku styles. Want me to run the full new arrivals pipeline to update the feed and write social captions?"*

### Pipeline chain trigger
On Yes, Sonic kicks off `PipelineRunner` with the correct pipeline key. The pipeline now reports **each completed step back into the chat as it goes**, not just a progress bar.

### Next recommendation
After any pipeline completes, Sonic reads the task graph and fires the next logical suggestion:
- New arrivals → feed health check
- Restock → purchase order
- Season close → next season's budget plan

---

## The Task Graph — Memory Layer (NEW table)

`agent_tasks` Supabase table — the key new piece. Lets Sonic behave like an employee with memory ("I parsed Seafolly 2h ago. Tags done. SEO done. Feed not updated, no social captions. I should follow up.")

```
id | user_id | task_type | status | depends_on |
trigger_source | context_json | created_at |
completed_at | next_suggested | dismissed_at
```

RLS: user can only see/modify their own rows. Indexes on `(user_id, status)` and `(user_id, created_at desc)`.

---

## The 5 Real Conversations (concrete examples)

1. **Morning briefing (8am cron):** *"Morning. 2 Seafolly emails overnight — parsed (48 products). Tags ready to review. Baku sizes 10/12 low — draft reorder email? Summer feed not updated in 6 days — Swimwear Galore updated theirs yesterday."*
2. **After invoice parse:** *"Done — 24 Jantzen products. 18 refills, 6 new styles. Tags generated for the 6 new. Run full new arrivals pipeline (~8 min)?"*
3. **Pipeline hand-off:** *"SEO titles done for 6 Jantzen styles. Next: update Google feed (~2 min). Go ahead?"*
4. **Stock alert:** *"Funkita sizes 8/10 below reorder threshold (3 units). Last ordered 6 weeks ago. Draft reorder email?"*
5. **Season close nudge:** *"Summer ends in 3 weeks. 47 full-price summer products in stock. ~12 likely won't move based on last year. Start season close pipeline?"*

---

## Build Order — 4 Sprints (final)

| Sprint | Build | Notes |
|--------|-------|-------|
| 1 | `agent_tasks` table + task graph helpers | Memory layer first — everything depends on it |
| 2 | Morning briefing (scheduled cron edge function) | Daily scan: inbox + stock + pending tasks → chat message |
| 3 | Post-parse proactive suggestion (event trigger) | After every invoice parse, run the brain, post next suggestion |
| 4 | Pipeline step hand-off (step completion trigger) | After each PipelineRunner step, auto-post next recommendation |

