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

chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (req?.type === "EVALUATE_CART") {
    evaluateCart({ cartItems: req.cartItems, surface: req.surface })
      .then(sendResponse)
      .catch((e) => sendResponse({ allowed: true, error: String(e) }));
    return true; // keep channel open for async sendResponse
  }
  if (req?.type === "PING") {
    sendResponse({ ok: true });
    return false;
  }
});
