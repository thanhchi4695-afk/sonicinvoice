const tokenInput = document.getElementById("token");
const saveBtn = document.getElementById("save");
const openBtn = document.getElementById("open");
const statusEl = document.getElementById("status");
const urlInput = document.getElementById("product-url");
const importBtn = document.getElementById("import-url");

const DASHBOARD_URL = "https://www.sonicinvoices.com";

function setStatus(msg, ok) {
  statusEl.textContent = msg;
  statusEl.className = `status ${ok ? "ok" : "err"}`;
  statusEl.style.display = "block";
}

(async () => {
  const { sonicToken } = await chrome.storage.local.get("sonicToken");
  if (sonicToken) {
    tokenInput.value = sonicToken;
  }
  // Pre-fill with the active tab's URL if it looks like a product page
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && /^https?:\/\//i.test(tab.url) && !/chrome:\/\/|chrome-extension:\/\//.test(tab.url)) {
      urlInput.value = tab.url;
    }
  } catch {}
  urlInput.focus();
})();

importBtn.addEventListener("click", () => {
  const v = (urlInput.value || "").trim();
  if (!/^https?:\/\//i.test(v)) {
    setStatus("Enter a valid product URL (https://…)", false);
    return;
  }
  const target = `${DASHBOARD_URL}/dashboard?importUrl=${encodeURIComponent(v)}`;
  chrome.tabs.create({ url: target });
});

urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") importBtn.click();
});

saveBtn.addEventListener("click", async () => {
  const v = tokenInput.value.trim();
  if (!v.startsWith("sgi_")) {
    setStatus("Token should start with sgi_", false);
    return;
  }
  await chrome.storage.local.set({ sonicToken: v });
  setStatus("Token saved.", true);
});

openBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: `${DASHBOARD_URL}/rules` });
});
