// Auto-agent settings — controls which AI agents run automatically right
// after an invoice or packing slip finishes parsing.
// Persisted in localStorage so the choice survives reloads.

export type AutoAgentId = "classifier" | "enrichment" | "publishing" | "watchdog" | "learning";

// Per-agent mode preset. Not every agent has a meaningful mode — those that
// don't are kept for shape consistency but ignored at runtime.
export type AgentMode = "strict" | "relaxed";

export interface AutoAgentSettings {
  enabled: boolean; // master switch
  agents: Record<AutoAgentId, boolean>;
  modes: Record<AutoAgentId, AgentMode>;
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
  modes: {
    classifier: "relaxed",
    enrichment: "relaxed",
    watchdog: "strict", // protect margins by default
    publishing: "strict", // require Watchdog clearance + ≥90% confidence
    learning: "relaxed",
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
      modes: { ...DEFAULTS.modes, ...(parsed.modes || {}) },
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

export interface AutoAgentMeta {
  name: string;
  help: string;
  /** When true, expose strict/relaxed mode chooser in UI. */
  hasMode: boolean;
  /** Short labels for each mode shown next to the chooser. */
  modeLabels?: { strict: string; relaxed: string };
  /** Tooltip describing what each mode does. */
  modeHelp?: { strict: string; relaxed: string };
}

export const AUTO_AGENT_LABELS: Record<AutoAgentId, AutoAgentMeta> = {
  classifier: {
    name: "Classifier",
    help: "Auto-tag categories, fabric, season, fit, audience.",
    hasMode: true,
    modeLabels: { strict: "Strict", relaxed: "Relaxed" },
    modeHelp: {
      strict: "Only apply tags with confidence ≥ 90%. Low-confidence tags are skipped for review.",
      relaxed: "Apply all suggested tags; flag low-confidence ones for later review.",
    },
  },
  enrichment: {
    name: "Enrichment",
    help: "Generate titles, descriptions, find colour images.",
    hasMode: true,
    modeLabels: { strict: "Conservative", relaxed: "Creative" },
    modeHelp: {
      strict: "Only rewrite when source title is clearly weak. Keep supplier wording where possible.",
      relaxed: "Always rewrite to the [Color] + [Feature] + [Type] format and write fresh descriptions.",
    },
  },
  watchdog: {
    name: "Watchdog",
    help: "Run margin & price checks before anything publishes.",
    hasMode: true,
    modeLabels: { strict: "Strict", relaxed: "Relaxed" },
    modeHelp: {
      strict: "Block any price below target margin. No exceptions — surfaces a manual fix.",
      relaxed: "Warn but allow prices within 5% of target margin to pass through.",
    },
  },
  publishing: {
    name: "Publishing",
    help: "Push to Shopify/Lightspeed automatically (off by default).",
    hasMode: true,
    modeLabels: { strict: "Auto-publish only on ≥90%", relaxed: "Auto-publish on ≥70%" },
    modeHelp: {
      strict: "Only push when supplier confidence ≥ 90% and Watchdog approves.",
      relaxed: "Push when confidence ≥ 70% — faster, but more chance of needing fixes.",
    },
  },
  learning: {
    name: "Learning",
    help: "Feed corrections back into the supplier brain.",
    hasMode: false,
  },
};
