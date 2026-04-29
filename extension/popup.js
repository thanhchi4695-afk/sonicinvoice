const tokenInput = document.getElementById("token");
const saveBtn = document.getElementById("save");
const openBtn = document.getElementById("open");
const statusEl = document.getElementById("status");

function setStatus(msg, ok) {
  statusEl.textContent = msg;
  statusEl.className = `status ${ok ? "ok" : "err"}`;
  statusEl.style.display = "block";
}

(async () => {
  const { sonicToken } = await chrome.storage.local.get("sonicToken");
  if (sonicToken) {
    tokenInput.value = sonicToken;
    setStatus("Token saved. Visit a JOOR cart to test.", true);
  }
})();

saveBtn.addEventListener("click", async () => {
  const v = tokenInput.value.trim();
  if (!v.startsWith("sgi_")) {
    setStatus("Token should start with sgi_", false);
    return;
  }
  await chrome.storage.local.set({ sonicToken: v });
  setStatus("Saved.", true);
});

openBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://www.sonicinvoices.com/rules" });
});
