// Auto-agent settings — controls which AI agents run automatically right
// after an invoice or packing slip finishes parsing.
// Persisted in localStorage so the choice survives reloads.

export type AutoAgentId = "classifier" | "enrichment" | "publishing" | "watchdog" | "learning";

export interface AutoAgentSettings {
  enabled: boolean; // master switch
  agents: Record<AutoAgentId, boolean>;
}

const KEY = "auto_agents_settings_v1";

const DEFAULTS: AutoAgentSettings = {
  enabled: false,
  agents: {
    classifier: true,
    enrichment: true,
    watchdog: true,
    publishing: false, // off by default — pushes to POS
    learning: true,
  },
};

export function getAutoAgentSettings(): AutoAgentSettings {
  if (typeof localStorage === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<AutoAgentSettings>;
    return {
      enabled: !!parsed.enabled,
      agents: { ...DEFAULTS.agents, ...(parsed.agents || {}) },
    };
  } catch {
    return DEFAULTS;
  }
}

export function saveAutoAgentSettings(s: AutoAgentSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    window.dispatchEvent(new CustomEvent("auto-agents:changed", { detail: s }));
  } catch {
    /* ignore */
  }
}

export const AUTO_AGENT_LABELS: Record<AutoAgentId, { name: string; help: string }> = {
  classifier: { name: "Classifier", help: "Auto-tag categories, fabric, season, fit, audience." },
  enrichment: { name: "Enrichment", help: "Generate titles, descriptions, find colour images." },
  watchdog: { name: "Watchdog", help: "Run margin & price checks before anything publishes." },
  publishing: { name: "Publishing", help: "Push to Shopify/Lightspeed automatically (off by default)." },
  learning: { name: "Learning", help: "Feed corrections back into the supplier brain." },
};
