# Sonic AI Merge Plan

> **When Claude can act, not just advise.**
> Trigger: Lisa or Silvija says they want Claude to DO something from chat, not just explain it.

## 1. What Changes in the Merge

- **SonicChat** (the intent classifier / action router) gets rewritten as **Claude tool definitions**.
- Each current intent becomes a named tool with a Zod input schema.
- **Single chat panel** replaces both `SonicChat` and `AskSonicAI` components.
- `AskSonicAI`'s system prompt + expert knowledge becomes the merged agent's system prompt.
- The merged agent can both **answer questions** (current AskSonicAI) and **perform actions** (current SonicChat).

---

## 2. Tool Definitions to Write

Map every existing SonicChat action to a tool. Claude decides which tool to call based on user intent.

| Tool Name | Input Schema | What It Does |
|-----------|-------------|--------------|
| `generate_seo_content` | `{ collection_handle: string }` | Calls existing edge fn to generate meta title, description, FAQ for a collection |
| `create_collection_from_gap` | `{ gap_id: string }` | Creates a new Shopify collection from a competitor gap finding |
| `run_competitor_gap_analysis` | `{}` | Triggers the full gap analysis across all collections |
| `run_seo_audit` | `{}` | Runs the SEO health audit and returns a report |
| `push_products_to_shopify` | `{ invoice_id: string }` | Publishes parsed invoice products to Shopify |
| `get_seo_score` | `{ collection_handle: string }` | Returns current SEO score + what's missing for a collection |
| `navigate_to` | `{ page: "collections" | "invoices" | "gaps" | "rank" | "settings" }` | Opens the requested page in the app |

### Example tool definition (generate_seo_content):

```typescript
const tools = {
  generate_seo_content: tool({
    description: "Generate SEO content (meta title, description, FAQ) for a Shopify collection.",
    parameters: z.object({
      collection_handle: z.string().describe("Shopify collection handle, e.g. 'black-dresses'"),
    }),
    execute: async ({ collection_handle }) => {
      const result = await supabase.functions.invoke("generate-collection-seo", {
        body: { handle: collection_handle }
      });
      return result.data;
    },
  }),
  create_collection_from_gap: tool({
    description: "Create a new Shopify collection based on a competitor gap.",
    parameters: z.object({
      gap_id: z.string().describe("The ID of the identified competitor gap"),
    }),
    execute: async ({ gap_id }) => {
      const result = await supabase.functions.invoke("create-collection-from-gap", {
        body: { gap_id }
      });
      return result.data;
    },
  }),
  run_competitor_gap_analysis: tool({
    description: "Run a full competitor gap analysis.",
    parameters: z.object({}),
    execute: async () => {
      const result = await supabase.functions.invoke("competitor-gap-agent", {});
      return result.data;
    },
  }),
  run_seo_audit: tool({
    description: "Run a comprehensive SEO health audit.",
    parameters: z.object({}),
    execute: async () => {
      const result = await supabase.functions.invoke("run-seo-audit", {});
      return result.data;
    },
  }),
  push_products_to_shopify: tool({
    description: "Push parsed invoice products to Shopify.",
    parameters: z.object({
      invoice_id: z.string().describe("The ID of the invoice to process"),
    }),
    execute: async ({ invoice_id }) => {
      const result = await supabase.functions.invoke("push-products-to-shopify", {
        body: { invoice_id }
      });
      return result.data;
    },
  }),
  get_seo_score: tool({
    description: "Get the current SEO score for a collection.",
    parameters: z.object({
      collection_handle: z.string().describe("Shopify collection handle"),
    }),
    execute: async ({ collection_handle }) => {
      const result = await supabase.functions.invoke("get-seo-score", {
        body: { handle: collection_handle }
      });
      return result.data;
    },
  }),
  navigate_to: tool({
    description: "Navigate the user to a specific page in the application.",
    parameters: z.object({
      page: z.enum(["collections", "invoices", "gaps", "rank", "settings"]),
    }),
    execute: async ({ page }) => {
      return { success: true, message: `Navigating to ${page}` };
    },
  }),
};
```

---

## 3. Agent Loop Pattern

The user message flows through the AI SDK agent loop:

```
User: "Generate SEO for my black-dresses collection"
  ↓
Claude analyzes intent → calls tool: generate_seo_content({ collection_handle: "black-dresses" })
  ↓
Edge function executes the existing generate-collection-seo function
  ↓
Returns: { success: true, score_before: 40, score_after: 87 }
  ↓
Claude receives tool result, then responds to user:
  "Done — /black-dresses went from 40 to 87. Meta description and FAQ were the biggest wins."
```

Key properties:
- Claude decides *which* tool to call (or if no tool is needed, just answer).
- Multiple tools can be called in one turn if the request implies multiple actions.
- Tool execution happens server-side in the edge function.
- The merged agent can answer questions, give advice, AND take action — all in one chat.

## 4. What Stays the Same

| Component | Status |
|-----------|--------|
| Underlying edge functions (`generate-collection-seo`, `competitor-gap-agent`, etc.) | **Unchanged** — tools call them as-is |
| Expert system prompt (7-layer tagging, SEO formula, Darwin retail, AU pricing) | **Identical** — becomes the merged agent's base prompt |
| App navigation, existing pages, data models | **Unchanged** |
| UI pattern | One chat panel replaces two buttons |

## 5. Estimated Build Time

| Task | Time |
|------|------|
| Rewrite SonicChat intents as tool schemas (Zod + descriptions) | 2–3 hours |
| Wire tool execution into the agent loop (edge function + client) | 2–3 hours |
| Test all existing flows still work (regression) | 1–2 hours |
| **Total** | **~1 day** |

## 6. Pre-Work Checklist (do before starting)

- [ ] Lisa or Silvija confirms: "I want to ask Claude to do things, not just explain"
- [ ] Audit current `SonicChat` intents to make sure none are missed in tool mapping
- [ ] Verify all existing edge functions accept the simplified tool input shapes
- [ ] Confirm the AI SDK `streamText` + `tool` pattern is being used (not hand-rolled)

## 7. Files to Modify / Create

| File | Change |
|------|--------|
| `supabase/functions/sonic-ask/index.ts` | Add tool definitions + execute loop; keep existing context injection |
| `src/components/AskSonicAI.tsx` | Remove floating button; replace with unified chat panel if UI changes needed |
| `src/components/SonicChat.tsx` | Remove entirely (replaced by tool-calling agent) |
| `src/App.tsx` | Mount only the merged chat component |
| `src/lib/agent-tools.ts` | New file: tool definitions + execute wrappers |

## Notes

- This is a **deliberate product upgrade**, not cleanup.
- The trigger signal is user feedback wanting Claude to perform actions from chat.
- Keep this doc updated if new SonicChat intents are added before the merge.
