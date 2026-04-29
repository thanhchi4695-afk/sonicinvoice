// Background service worker — talks to the margin-guardian edge function.
// Authentication is via X-Sonic-Token (extension token from the dashboard).

const SUPABASE_URL = "https://xuaakgdkkrrsqxafffyj.supabase.co";
const ENDPOINT = `${SUPABASE_URL}/functions/v1/margin-guardian`;

async function getToken() {
  const { sonicToken } = await chrome.storage.local.get("sonicToken");
  return sonicToken || null;
}

async function evaluateCart({ cartItems, surface }) {
  const token = await getToken();
  if (!token) return { allowed: true, error: "no_token", message: "Set token in popup." };

  try {
    const resp = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sonic-Token": token,
      },
      body: JSON.stringify({ cartItems, surface, dryRun: false }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      return { allowed: true, error: `http_${resp.status}`, message: text };
    }
    return await resp.json();
  } catch (e) {
    return { allowed: true, error: "network", message: String(e) };
  }
}

async function pollDecision({ decisionId }) {
  const token = await getToken();
  if (!token) return { error: "no_token" };
  try {
    const resp = await fetch(`${ENDPOINT}?decisionId=${encodeURIComponent(decisionId)}`, {
      method: "GET",
      headers: { "X-Sonic-Token": token },
    });
    if (!resp.ok) return { error: `http_${resp.status}` };
    return await resp.json();
  } catch (e) {
    return { error: String(e) };
  }
}

chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (req?.type === "EVALUATE_CART") {
    evaluateCart({ cartItems: req.cartItems, surface: req.surface })
      .then(sendResponse)
      .catch((e) => sendResponse({ allowed: true, error: String(e) }));
    return true;
  }
  if (req?.type === "POLL_DECISION") {
    pollDecision({ decisionId: req.decisionId })
      .then(sendResponse)
      .catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
  if (req?.type === "PING") {
    sendResponse({ ok: true });
    return false;
  }
});

// ── External messages from the dashboard (sonicinvoices.com / lovable preview) ──
// Used by the rule-builder "Test with current cart" button: the dashboard asks
// the extension for the most recently observed JOOR / NuOrder cart.
const CART_HOST_PATTERNS = [
  /(^|\.)jooraccess\.com$/i,
  /^app\.joor\.com$/i,
  /(^|\.)nuorder\.com$/i,
];

function isCartHost(urlString) {
  try {
    const u = new URL(urlString);
    return CART_HOST_PATTERNS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

async function findCartTab() {
  // Prefer the active tab if it's a cart host; else the most-recently-active matching tab.
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.url && isCartHost(active.url)) return active;
  const all = await chrome.tabs.query({});
  return all
    .filter((t) => t.url && isCartHost(t.url))
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
}

async function getCurrentCart() {
  const tab = await findCartTab();
  if (!tab?.id) {
    return { ok: false, reason: "no_cart_tab" };
  }
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: "GET_CART" });
    if (!res || !Array.isArray(res.items)) {
      return { ok: false, reason: "content_script_unavailable" };
    }
    if (res.items.length === 0) {
      return { ok: false, reason: "empty_cart", surface: res.surface, url: tab.url };
    }
    return { ok: true, items: res.items, surface: res.surface, url: tab.url };
  } catch (e) {
    return { ok: false, reason: "content_script_unavailable", error: String(e) };
  }
}

chrome.runtime.onMessageExternal.addListener((req, _sender, sendResponse) => {
  if (req?.type === "PING") {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return false;
  }
  if (req?.type === "GET_CURRENT_CART") {
    getCurrentCart()
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, reason: "error", error: String(e) }));
    return true;
  }
  sendResponse({ ok: false, reason: "unknown_type" });
  return false;
});
