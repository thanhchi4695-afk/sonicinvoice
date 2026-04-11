// Sonic Invoices - Instant Price Check Extension

const $ = (sel) => document.querySelector(sel);

// Config management
async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["apiUrl", "apiKey"], (data) => resolve(data));
  });
}

async function saveConfig(apiUrl, apiKey) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ apiUrl, apiKey }, resolve);
  });
}

// UI helpers
function showView(view) {
  $("#setup-view").style.display = view === "setup" ? "block" : "none";
  $("#main-view").style.display = view === "main" ? "block" : "none";
}

function showSection(section) {
  $("#results-section").style.display = section === "results" ? "block" : "none";
  $("#loading-section").style.display = section === "loading" ? "block" : "none";
  $("#status-section").style.display = section === "status" ? "block" : "none";
}

function showStatus(message, type = "info") {
  const el = $("#status-message");
  el.textContent = message;
  el.className = `status ${type}`;
  showSection("status");
}

// Check if current site is a known competitor
async function detectCompetitor() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return null;

    const url = new URL(tab.url);
    const hostname = url.hostname.replace("www.", "");

    // Try to detect Shopify stores by checking for common patterns
    const config = await getConfig();
    if (!config.apiUrl || !config.apiKey) return null;

    // Store the current URL for later
    chrome.storage.local.set({ lastCheckedUrl: tab.url, lastCheckedHostname: hostname });

    return { hostname, url: tab.url };
  } catch (e) {
    return null;
  }
}

// Try to extract product title from current page
async function extractProductTitle() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // Try various common selectors for product titles
        const selectors = [
          'h1.product-single__title',
          'h1.product__title',
          'h1[data-product-title]',
          '.product-title h1',
          '.product-info h1',
          'h1.title',
          '[itemprop="name"]',
          'h1',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el?.textContent?.trim()) return el.textContent.trim();
        }
        return document.title.split('–')[0].split('|')[0].split('-')[0].trim();
      },
    });

    return result?.result || null;
  } catch (e) {
    return null;
  }
}

// Try to extract price from current page
async function extractProductPrice() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const selectors = [
          '.product__price .money',
          '.product-single__price .money',
          '[data-product-price]',
          '.price .money',
          '.current-price',
          '[itemprop="price"]',
          '.product-price',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            const text = el.textContent || el.getAttribute('content') || '';
            const match = text.match(/[\d,.]+/);
            if (match) return parseFloat(match[0].replace(/,/g, ''));
          }
        }
        return null;
      },
    });

    return result?.result || null;
  } catch (e) {
    return null;
  }
}

// Search merchant's store for matching product
async function checkPrice(productTitle, competitorPrice) {
  const config = await getConfig();
  if (!config.apiUrl || !config.apiKey) {
    showStatus("Please configure your connection first.", "warning");
    return;
  }

  showSection("loading");

  try {
    // Call your backend to search for this product
    const baseUrl = config.apiUrl.replace(/\/+$/, '');
    const response = await fetch(`${baseUrl}/functions/v1/competitor-price-fetch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
        "apikey": config.apiKey,
      },
      body: JSON.stringify({
        search_title: productTitle,
        action: "quick_lookup",
      }),
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json();

    if (data.product) {
      displayResults(data.product, competitorPrice, data.confidence || 0);
    } else {
      showStatus("Product not found in your store. Try a different search term.", "warning");
    }
  } catch (e) {
    showStatus(`Error: ${e.message}. Check your connection settings.`, "error");
  }
}

function displayResults(product, competitorPrice, confidence) {
  const myPrice = product.retail_price || product.price || 0;
  const diff = myPrice - competitorPrice;
  const pctDiff = competitorPrice > 0 ? ((diff / competitorPrice) * 100) : 0;

  $("#result-comp-price").textContent = `$${competitorPrice.toFixed(2)}`;
  $("#result-my-price").textContent = `$${myPrice.toFixed(2)}`;
  $("#result-product-title").textContent = product.title || "—";
  $("#result-confidence").textContent = `${confidence}%`;

  const badge = $("#result-diff-badge");
  if (diff < -0.01) {
    badge.className = "diff-badge cheaper";
    badge.textContent = `You're cheaper by $${Math.abs(diff).toFixed(2)} (${Math.abs(pctDiff).toFixed(0)}%)`;
    $("#result-my-price").className = "price-value green";
  } else if (diff > 0.01) {
    badge.className = "diff-badge pricier";
    badge.textContent = `You're pricier by $${diff.toFixed(2)} (${pctDiff.toFixed(0)}%)`;
    $("#result-my-price").className = "price-value red";
  } else {
    badge.className = "diff-badge matched";
    badge.textContent = "Prices matched!";
    $("#result-my-price").className = "price-value blue";
  }

  showSection("results");
}

// Initialize
async function init() {
  const config = await getConfig();

  if (!config.apiUrl || !config.apiKey) {
    showView("setup");
  } else {
    showView("main");

    // Try to detect competitor and extract product info
    const competitor = await detectCompetitor();
    if (competitor) {
      $("#detected-competitor").style.display = "block";
      $("#detected-name").textContent = `Browsing: ${competitor.hostname}`;
    }

    // Try to extract product title from current page
    const title = await extractProductTitle();
    if (title) {
      $("#product-title").value = title;
    }

    // Try to extract price
    const price = await extractProductPrice();
    if (price) {
      $("#competitor-price-input").value = price;
    }

    updateCheckButton();
  }
}

function updateCheckButton() {
  const title = $("#product-title").value.trim();
  const price = $("#competitor-price-input").value;
  $("#check-price").disabled = !title || !price;
}

// Event listeners
$("#save-config").addEventListener("click", async () => {
  const url = $("#api-url").value.trim();
  const key = $("#api-key").value.trim();
  if (!url || !key) return;
  await saveConfig(url, key);
  showView("main");
  showStatus("Connected successfully!", "success");
});

$("#check-price").addEventListener("click", () => {
  const title = $("#product-title").value.trim();
  const price = parseFloat($("#competitor-price-input").value);
  if (!title || isNaN(price)) return;
  checkPrice(title, price);
});

$("#product-title").addEventListener("input", updateCheckButton);
$("#competitor-price-input").addEventListener("input", updateCheckButton);

$("#btn-match").addEventListener("click", async () => {
  const config = await getConfig();
  if (config.apiUrl) {
    const url = config.apiUrl.replace(/\/+$/, '').replace('/functions/v1', '');
    window.open(url, "_blank");
  }
});

$("#btn-dashboard").addEventListener("click", async () => {
  const config = await getConfig();
  if (config.apiUrl) {
    const url = config.apiUrl.replace(/\/+$/, '').replace('/functions/v1', '');
    window.open(url, "_blank");
  }
});

$("#toggle-config").addEventListener("click", (e) => {
  e.preventDefault();
  const setupVisible = $("#setup-view").style.display !== "none";
  showView(setupVisible ? "main" : "setup");
  if (!setupVisible) {
    getConfig().then((config) => {
      if (config.apiUrl) $("#api-url").value = config.apiUrl;
    });
  }
});

$("#open-app").addEventListener("click", async (e) => {
  e.preventDefault();
  const config = await getConfig();
  if (config.apiUrl) {
    const url = config.apiUrl.replace(/\/+$/, '').replace('/functions/v1', '');
    window.open(url, "_blank");
  }
});

// Keyboard shortcut
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !$("#check-price").disabled) {
    $("#check-price").click();
  }
});

init();
