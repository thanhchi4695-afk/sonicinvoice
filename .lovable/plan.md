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
