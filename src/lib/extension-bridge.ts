// Tiny wrapper around chrome.runtime.sendMessage(extId, …) for talking to the
// Sonic Invoices Chrome extension from the dashboard.
//
// The extension ID is environment-dependent (changes between unpacked installs
// and the Chrome Web Store version), so we read it from one of:
//   1. window.SONIC_EXTENSION_ID  (lets users override at runtime)
//   2. localStorage "sonicExtensionId"
//   3. import.meta.env.VITE_SONIC_EXTENSION_ID
//
// All calls are best-effort: if the extension is missing we return a typed
// "not_installed" result so callers can render a helpful message.

export type CartItem = {
  sku: string;
  quantity: number;
  unitListPrice: number;
  brand?: string;
  vendor?: string;
  product_category?: string;
  landedCost?: number;
};

export type GetCartResult =
  | { ok: true; items: CartItem[]; surface: string; url?: string }
  | {
      ok: false;
      reason:
        | "not_installed"
        | "no_cart_tab"
        | "empty_cart"
        | "content_script_unavailable"
        | "timeout"
        | "error"
        | "unknown_type";
      error?: string;
      surface?: string;
      url?: string;
    };

interface ChromeRuntime {
  sendMessage: (
    extId: string,
    msg: unknown,
    cb: (response: unknown) => void,
  ) => void;
  lastError?: { message?: string };
}

interface ChromeGlobal {
  runtime?: ChromeRuntime;
}

function getChrome(): ChromeGlobal | null {
  return (globalThis as unknown as { chrome?: ChromeGlobal }).chrome ?? null;
}

function getExtensionId(): string | null {
  const w = globalThis as unknown as { SONIC_EXTENSION_ID?: string };
  if (w.SONIC_EXTENSION_ID) return w.SONIC_EXTENSION_ID;
  try {
    const stored = localStorage.getItem("sonicExtensionId");
    if (stored) return stored;
  } catch {
    /* SSR or storage blocked */
  }
  // Vite injects this at build time when set in env.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env = (import.meta as any)?.env ?? {};
  return env.VITE_SONIC_EXTENSION_ID ?? null;
}

function sendMessage<T>(extId: string, msg: unknown, timeoutMs = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const chrome = getChrome();
    if (!chrome?.runtime?.sendMessage) {
      reject(new Error("not_installed"));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("timeout"));
    }, timeoutMs);

    try {
      chrome.runtime.sendMessage(extId, msg, (response: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const err = chrome.runtime?.lastError?.message;
        if (err) reject(new Error(err));
        else resolve(response as T);
      });
    } catch (e) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/** True when the extension is installed and answers a PING within 1.5s. */
export async function isExtensionAvailable(): Promise<boolean> {
  const id = getExtensionId();
  if (!id) return false;
  try {
    const res = await sendMessage<{ ok?: boolean }>(id, { type: "PING" }, 1500);
    return !!res?.ok;
  } catch {
    return false;
  }
}

/** Ask the extension for the cart visible in the active JOOR / NuOrder tab. */
export async function fetchCurrentCart(): Promise<GetCartResult> {
  const id = getExtensionId();
  if (!id) return { ok: false, reason: "not_installed" };
  try {
    const res = await sendMessage<GetCartResult>(id, { type: "GET_CURRENT_CART" }, 5000);
    if (!res || typeof res !== "object") {
      return { ok: false, reason: "error", error: "Empty response" };
    }
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "not_installed") return { ok: false, reason: "not_installed" };
    if (msg === "timeout") return { ok: false, reason: "timeout" };
    return { ok: false, reason: "error", error: msg };
  }
}

/** Stored extension ID setter — used by the popup pairing flow if we add one. */
export function setExtensionId(id: string | null) {
  try {
    if (id) localStorage.setItem("sonicExtensionId", id);
    else localStorage.removeItem("sonicExtensionId");
  } catch {
    /* ignore */
  }
}
