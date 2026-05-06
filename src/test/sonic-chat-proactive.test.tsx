/**
 * End-to-end-style test for the proactive realtime path in SonicChat.
 *
 * What this verifies (Bug 1 regression guard):
 *   1. On mount, SonicChat subscribes to a `proactive-tasks-*` channel.
 *   2. A simulated `agent_tasks` INSERT is delivered to the registered handler
 *      (proving the subscription is wired up correctly).
 *   3. When the tab is backgrounded (`visibilitychange` → hidden) and then
 *      restored (`visible`), if the channel is no longer in a joined state
 *      the component removes the stale channel and re-subscribes.
 *   4. The freshly-subscribed channel still delivers proactive messages.
 *
 * The realtime layer is mocked in-memory — no network calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, cleanup } from "@testing-library/react";

// ── Mocks ─────────────────────────────────────────────────────────────────

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

type Handler = (payload: { new: Record<string, unknown> }) => void | Promise<void>;
interface FakeChannel {
  name: string;
  state: "joining" | "joined" | "closed";
  handler: Handler | null;
  subscribed: boolean;
  removed: boolean;
  on: (event: string, filter: unknown, handler: Handler) => FakeChannel;
  subscribe: () => FakeChannel;
}
const channels: FakeChannel[] = [];

function makeChannel(name: string): FakeChannel {
  const ch = {
    name,
    state: "joining" as FakeChannel["state"],
    handler: null as Handler | null,
    subscribed: false,
    removed: false,
  } as FakeChannel;
  ch.on = (_event, _filter, handler) => {
    ch.handler = handler;
    return ch;
  };
  ch.subscribe = () => {
    ch.subscribed = true;
    ch.state = "joined";
    return ch;
  };
  channels.push(ch);
  return ch;
}

function makeFromBuilder(table: string) {
  const result =
    table === "user_preferences"
      ? { data: { proactive_mode_enabled: true }, error: null }
      : { data: [], error: null };

  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.eq = chain;
  builder.gte = chain;
  builder.order = chain;
  builder.limit = chain;
  builder.maybeSingle = vi.fn().mockResolvedValue(result);
  builder.single = vi.fn().mockResolvedValue(result);
  builder.then = (
    onFulfilled: (v: { data: unknown; error: null }) => unknown,
  ) => Promise.resolve(result).then(onFulfilled);
  builder.insert = vi.fn(() => ({
    select: () => ({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }),
  }));
  builder.update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
  return builder;
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
    }),
    from: vi.fn((table: string) => makeFromBuilder(table)),
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
  };
  return { supabase };
});

// Import AFTER mocks are registered.
import SonicChat from "@/components/SonicChat";
import { supabase } from "@/integrations/supabase/client";

async function waitForProactiveChannel(timeoutMs = 1500): Promise<FakeChannel> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ch = channels.find((c) => c.name.startsWith("proactive-tasks-") && c.subscribed);
    if (ch) return ch;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(
    `No proactive channel subscribed within ${timeoutMs}ms. Channels: ${channels
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

  it("subscribes on mount and re-subscribes after background → foreground when channel is dead", async () => {
    render(<SonicChat />);

    // 1. Initial subscription is established for this user
    const first = await waitForProactiveChannel();
    expect(first.name).toMatch(/^proactive-tasks-user-123/);
    expect(first.handler).toBeTypeOf("function");
    expect(first.state).toBe("joined");

    // 2. Handler accepts a synthetic INSERT without throwing — proves wiring
    await act(async () => {
      await first.handler!({
        new: {
          id: "task-aaa",
          user_id: "user-123",
          status: "permission_requested",
          task_type: "reorder",
          observation: "Stock for Baku 4521 is below your reorder threshold.",
          proposed_action: "Draft a reorder PO for 24 units.",
          permission_question: "Want me to draft it?",
          pipeline_id: null,
          created_at: new Date().toISOString(),
        },
      });
    });

    // 3. Background the tab and simulate the OS killing the websocket
    setVisibility("hidden");
    first.state = "closed";

    // 4. Restore the tab — the visibility handler should remove the stale
    //    channel and create a fresh subscription.
    await act(async () => {
      setVisibility("visible");
    });

    const start = Date.now();
    let second: FakeChannel | undefined;
    while (Date.now() - start < 1500) {
      second = channels.find(
        (c) => c !== first && c.name.startsWith("proactive-tasks-") && c.subscribed,
      );
      if (second) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(second, "expected a fresh proactive channel after tab restore").toBeTruthy();
    expect(supabase.removeChannel).toHaveBeenCalled();
    expect(first.removed).toBe(true);
    expect(second!.state).toBe("joined");

    // 5. The fresh channel still accepts proactive messages
    await act(async () => {
      await second!.handler!({
        new: {
          id: "task-bbb",
          user_id: "user-123",
          status: "suggested",
          task_type: "stock_alert",
          observation: "Seafolly 6312 is down to 2 units.",
          proposed_action: "",
          permission_question: null,
          pipeline_id: null,
          created_at: new Date().toISOString(),
        },
      });
    });
  });

  it("does NOT churn the subscription when the tab regains focus while still healthy", async () => {
    render(<SonicChat />);
    const first = await waitForProactiveChannel();
    const subscribedBefore = channels.filter((c) => c.subscribed && !c.removed).length;

    setVisibility("hidden");
    await act(async () => {
      setVisibility("visible");
    });
    await new Promise((r) => setTimeout(r, 50));

    const subscribedAfter = channels.filter((c) => c.subscribed && !c.removed).length;
    expect(subscribedAfter).toBe(subscribedBefore);
    expect(first.removed).toBe(false);
  });
});
