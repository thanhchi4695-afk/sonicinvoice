// Content script — observes JOOR / NuOrder cart DOM, asks background to evaluate,
// and renders banner + per-row margin dots. Selectors are best-effort across known
// surfaces; users can refine via the dashboard if their JOOR theme differs.

const SURFACE = location.hostname.includes("nuorder") ? "nuorder" : "joor";

let lastSnapshot = "";
let inFlight = false;
let debounceTimer = null;

function text(el) {
  return (el?.textContent || "").trim();
}

function num(s) {
  const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function extractCartItems() {
  const rows = document.querySelectorAll(
    '.cart-item, .order-item-row, [data-testid="cart-item"], tr[data-row="cart"]',
  );
  const items = [];
  rows.forEach((row) => {
    const skuEl =
      row.querySelector("[data-sku]") ||
      row.querySelector(".sku") ||
      row.querySelector(".item-sku");
    const qtyEl =
      row.querySelector('input[type="number"]') ||
      row.querySelector(".item-qty") ||
      row.querySelector("[data-qty]");
    const priceEl =
      row.querySelector(".unit-price") ||
      row.querySelector(".item-price") ||
      row.querySelector("[data-price]");
    const brandEl =
      row.querySelector(".brand-name") ||
      row.querySelector(".vendor") ||
      row.querySelector("[data-brand]");

    const sku = skuEl?.getAttribute?.("data-sku") || text(skuEl);
    const qty = qtyEl?.value ? parseInt(qtyEl.value, 10) : num(text(qtyEl));
    const price = num(text(priceEl) || priceEl?.getAttribute?.("data-price"));

    if (sku && qty && price !== null) {
      items.push({
        sku,
        quantity: qty,
        unitListPrice: price,
        brand: text(brandEl) || undefined,
      });
    }
  });
  return items;
}

function snapshotKey(items) {
  return items.map((i) => `${i.sku}:${i.quantity}:${i.unitListPrice}`).join("|");
}

function renderBanner(decision) {
  document.getElementById("sonic-margin-banner")?.remove();
  if (decision.allowed) return;
  const banner = document.createElement("div");
  banner.id = "sonic-margin-banner";
  banner.className = "sonic-banner";
  banner.innerHTML = `
    <div class="sonic-banner-row">
      <div>
        <strong>⚠️ Margin alert</strong>
        <div class="sonic-banner-message">${decision.message || "A rule was triggered."}</div>
        <div class="sonic-banner-actions">${(decision.actions || []).map((a) => a.type).join(", ")}</div>
      </div>
      <button class="sonic-dismiss" type="button">Dismiss</button>
    </div>`;
  const host =
    document.querySelector(".cart-summary") ||
    document.querySelector(".order-summary") ||
    document.body;
  host.prepend(banner);
  banner.querySelector(".sonic-dismiss")?.addEventListener("click", () => banner.remove());
}

function toggleCheckout(decision) {
  const btn =
    document.querySelector('button[type="submit"].place-order') ||
    document.querySelector(".checkout-button") ||
    document.querySelector('[data-testid="place-order"]');
  if (!btn) return;
  if (!decision.allowed) {
    btn.disabled = true;
    btn.style.opacity = "0.5";
    btn.setAttribute("data-sonic-disabled", "true");
  } else if (btn.getAttribute("data-sonic-disabled") === "true") {
    btn.disabled = false;
    btn.style.opacity = "1";
    btn.removeAttribute("data-sonic-disabled");
  }
}

function renderDots(marginData) {
  if (!marginData) return;
  document.querySelectorAll(".sonic-margin-dot").forEach((d) => d.remove());
  document
    .querySelectorAll('.cart-item, .order-item-row, [data-testid="cart-item"]')
    .forEach((row) => {
      const skuEl =
        row.querySelector("[data-sku]") ||
        row.querySelector(".sku") ||
        row.querySelector(".item-sku");
      const sku = skuEl?.getAttribute?.("data-sku") || text(skuEl);
      const margin = sku ? marginData[sku] : null;
      if (margin === undefined || margin === null) return;
      const dot = document.createElement("span");
      dot.className = "sonic-margin-dot";
      dot.style.background = margin >= 45 ? "#16a34a" : margin >= 35 ? "#eab308" : "#dc2626";
      dot.title = `Margin ${margin.toFixed(1)}%`;
      skuEl?.parentNode?.appendChild(dot);
    });
}

let pollTimer = null;
let pollingDecisionId = null;

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  pollingDecisionId = null;
}

function startPolling(decisionId) {
  if (pollingDecisionId === decisionId) return;
  stopPolling();
  pollingDecisionId = decisionId;
  let attempts = 0;
  pollTimer = setInterval(async () => {
    attempts += 1;
    if (attempts > 60) return stopPolling(); // 5 min cap
    const status = await chrome.runtime.sendMessage({
      type: "POLL_DECISION",
      decisionId,
    });
    if (!status || status.error) return;
    if (status.decision_outcome && status.decision_outcome !== "pending_approval") {
      stopPolling();
      // Surface the resolution and re-run evaluate so the banner/checkout state refreshes.
      const banner = document.getElementById("sonic-margin-banner");
      if (banner) {
        const note = document.createElement("div");
        note.className = "sonic-banner-message";
        note.style.marginTop = "8px";
        note.textContent =
          status.decision_outcome === "approved"
            ? "✅ Approved in Slack — cart unblocked."
            : status.decision_outcome === "denied"
              ? "❌ Denied in Slack — cart remains blocked."
              : "⏰ Approval expired.";
        banner.querySelector(".sonic-banner-row > div")?.appendChild(note);
      }
      lastSnapshot = ""; // force re-eval
      scheduleEvaluate();
    }
  }, 5000);
}

async function evaluateNow() {
  if (inFlight) return;
  const items = extractCartItems();
  if (items.length === 0) {
    renderBanner({ allowed: true });
    stopPolling();
    return;
  }
  const key = snapshotKey(items);
  if (key === lastSnapshot) return;
  lastSnapshot = key;
  inFlight = true;
  try {
    const decision = await chrome.runtime.sendMessage({
      type: "EVALUATE_CART",
      cartItems: items,
      surface: SURFACE,
    });
    if (!decision) return;
    renderBanner(decision);
    toggleCheckout(decision);
    renderDots(decision.marginData);

    const needsApproval = (decision.actions || []).some((a) => a.type === "slack_approval");
    if (needsApproval && decision.decisionId) {
      startPolling(decision.decisionId);
    } else {
      stopPolling();
    }
  } catch (e) {
    console.warn("[sonic] evaluate failed", e);
  } finally {
    inFlight = false;
  }
}

function scheduleEvaluate() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(evaluateNow, 800);
}

const observer = new MutationObserver(() => scheduleEvaluate());
observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["value"],
});

window.addEventListener("load", scheduleEvaluate);

// Respond to the dashboard's "Test with current cart" — re-extract on demand
// so the response reflects the live DOM, not a possibly-stale snapshot.
chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (req?.type === "GET_CART") {
    try {
      const items = extractCartItems();
      sendResponse({ items, surface: SURFACE });
    } catch (e) {
      sendResponse({ items: [], surface: SURFACE, error: String(e) });
    }
    return false;
  }
});
