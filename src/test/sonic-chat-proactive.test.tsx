/**
 * End-to-end-style test for the proactive realtime path in SonicChat.
 *
 * What this verifies (Bug 1 regression guard):
 *   1. On mount, SonicChat subscribes to a `proactive-tasks-*` channel.
 *   2. A simulated `agent_tasks` INSERT renders a proactive card in the chat.
 *   3. When the tab is backgrounded (`visibilitychange` → hidden) and then
 *      restored (`visible`), if the channel is no longer in a joined state
 *      the component removes the stale channel and re-subscribes.
 *   4. The freshly-subscribed channel still delivers proactive messages.
 *
 * The realtime layer is mocked in-memory — no network calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";

// ── Mocks ─────────────────────────────────────────────────────────────────

// Avoid pulling in heavy / browser-only deps that SonicChat references.
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/SupplierEmailCard", () => ({ default: () => null }));
vi.mock("@/components/ProductDescriptionCard", () => ({ default: () => null }));
vi.mock("@/lib/auto-approve", () => ({
  checkAndAutoApprove: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/sonic-chat-actions", () => ({
  executeChatAction: vi.fn(),
  executeGatedAction: vi.fn(),
  runInlineAction: vi.fn().mockResolvedValue(null),
  runParseFromChat: vi.fn(),
}));

// In-memory channel registry so the test can drive INSERT events and inspect
// subscribe/unsubscribe lifecycle.
type Handler = (payload: { new: Record<string, unknown> }) => void | Promise<void>;
interface FakeChannel {
  name: string;
  state: "joining" | "joined" | "closed";
  handler: Handler | null;
  subscribed: boolean;
  removed: boolean;
}
const channels: FakeChannel[] = [];

function makeChannel(name: string): FakeChannel & {
  on: (...args: unknown[]) => FakeChannel;
  subscribe: () => FakeChannel;
} {
  const ch: FakeChannel = {
    name,
    state: "joining",
    handler: null,
    subscribed: false,
    removed: false,
  };
  channels.push(ch);
  const api = {
    ...ch,
    on: (_event: string, _filter: unknown, handler: Handler) => {
      ch.handler = handler;
      return api;
    },
    subscribe: () => {
      ch.subscribed = true;
      ch.state = "joined";
      return api;
    },
  };
  // Keep `state` etc. live by reading from `ch` via getters
  Object.defineProperty(api, "state", { get: () => ch.state });
  Object.defineProperty(api, "subscribed", { get: () => ch.subscribed });
  Object.defineProperty(api, "removed", { get: () => ch.removed });
  return api as FakeChannel & {
    on: (...args: unknown[]) => FakeChannel;
    subscribe: () => FakeChannel;
  };
}

vi.mock("@/integrations/supabase/client", () => {
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } } }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
    channel: vi.fn((name: string) => makeChannel(name)),
    removeChannel: vi.fn((ch: FakeChannel) => {
      ch.removed = true;
      ch.state = "closed";
      // Find original entry (the proxy returned from makeChannel shares state via getters)
      const found = channels.find((c) => c === ch || c.name === (ch as FakeChannel).name);
      if (found) {
        found.removed = true;
        found.state = "closed";
      }
    }),
    from: vi.fn(() => {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.gte = chain;
      builder.order = chain;
      builder.limit = chain;
      builder.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      builder.single = vi.fn().mockResolvedValue({ data: null, error: null });
      builder.insert = vi.fn(() => ({
        select: () => ({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }),
      }));
      builder.update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
      // user_preferences(...).select(...).eq(...).maybeSingle()
      // Default returns proactive_mode_enabled = true so notifications flow.
      builder.maybeSingle = vi
        .fn()
        .mockResolvedValue({ data: { proactive_mode_enabled: true }, error: null });
      return builder;
    }),
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
  };
  return { supabase };
});

// Import AFTER mocks are registered.
import SonicChat from "@/components/SonicChat";
import { supabase } from "@/integrations/supabase/client";

// Helper — the proactive subscription is async (auth → effect), so wait for it.
async function waitForProactiveChannel(timeoutMs = 1000): Promise<FakeChannel> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ch = channels.find((c) => c.name.startsWith("proactive-tasks-") && c.subscribed);
    if (ch) return ch;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(
    `No proactive channel subscribed within ${timeoutMs}ms. Channels seen: ${channels
      .map((c) => `${c.name}[sub=${c.subscribed}]`)
      .join(", ")}`,
  );
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("SonicChat — proactive realtime survives tab background/restore", () => {
  beforeEach(() => {
    channels.length = 0;
    sessionStorage.clear();
    setVisibility("visible");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("subscribes on mount, renders an INSERT, and re-subscribes after background→foreground", async () => {
    render(<SonicChat />);

    // 1. Initial subscription
    const first = await waitForProactiveChannel();
    expect(first.name).toMatch(/^proactive-tasks-user-123/);
    expect(first.handler).toBeTypeOf("function");

    // 2. Simulate the brain inserting a proactive task while the tab is open
    await act(async () => {
      await first.handler!({
        new: {
          id: "task-aaa",
          user_id: "user-123",
          status: "permission_requested",
          task_type: "reorder", // not in auto-approvable set → renders the card
          observation: "Stock for Baku 4521 is below your reorder threshold.",
          proposed_action: "Draft a reorder PO for 24 units.",
          permission_question: "Want me to draft it?",
          pipeline_id: null,
          created_at: new Date().toISOString(),
        },
      });
    });

    // The proactive card surfaces the observation text
    expect(
      await screen.findByText(/Stock for Baku 4521 is below your reorder threshold\./),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /yes, go ahead/i })).toBeInTheDocument();

    // 3. Background the tab — simulate the OS killing the websocket by flipping
    // the channel state to "closed" before the tab returns.
    setVisibility("hidden");
    first.state = "closed";

    // 4. Restore the tab → visibilitychange handler should remove the stale
    // channel and create a fresh subscription.
    await act(async () => {
      setVisibility("visible");
    });

    // Wait for a NEW subscribed proactive channel to appear (different from `first`).
    const start = Date.now();
    let second: FakeChannel | undefined;
    while (Date.now() - start < 1000) {
      second = channels.find(
        (c) => c !== first && c.name.startsWith("proactive-tasks-") && c.subscribed,
      );
      if (second) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(second, "expected a fresh proactive channel after tab restore").toBeTruthy();
    expect(supabase.removeChannel).toHaveBeenCalled();
    expect(first.removed).toBe(true);

    // 5. The fresh channel still delivers proactive messages
    await act(async () => {
      await second!.handler!({
        new: {
          id: "task-bbb",
          user_id: "user-123",
          status: "suggested",
          task_type: "stock_alert",
          observation: "Seafolly 6312 is down to 2 units across all locations.",
          proposed_action: "",
          permission_question: null,
          pipeline_id: null,
          created_at: new Date().toISOString(),
        },
      });
    });

    expect(
      await screen.findByText(/Seafolly 6312 is down to 2 units across all locations\./),
    ).toBeInTheDocument();
  });

  it("does NOT re-subscribe when the tab regains focus while the channel is still healthy", async () => {
    render(<SonicChat />);
    const first = await waitForProactiveChannel();
    const beforeCount = channels.filter((c) => c.subscribed).length;

    // Tab leaves and returns, but the websocket is still joined → no churn.
    setVisibility("hidden");
    await act(async () => {
      setVisibility("visible");
    });

    // Give any (incorrect) re-subscribe a moment to fire
    await new Promise((r) => setTimeout(r, 50));
    const afterCount = channels.filter((c) => c.subscribed).length;
    expect(afterCount).toBe(beforeCount);
    expect(first.removed).toBe(false);
  });
});
