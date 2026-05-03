import { useEffect, useState } from "react";
import { Bot, Info } from "lucide-react";
import {
  AUTO_AGENT_LABELS,
  type AgentMode,
  type AutoAgentId,
  type AutoAgentSettings,
  getAutoAgentSettings,
  saveAutoAgentSettings,
} from "@/lib/auto-agents-settings";
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
  compact?: boolean;
}

const AutoAgentsSettingsPanel = ({ className, compact }: Props) => {
  const [s, setS] = useState<AutoAgentSettings>(() => getAutoAgentSettings());

  useEffect(() => {
    saveAutoAgentSettings(s);
  }, [s]);

  const toggleAgent = (id: AutoAgentId) =>
    setS((prev) => ({ ...prev, agents: { ...prev.agents, [id]: !prev.agents[id] } }));

  const setMode = (id: AutoAgentId, mode: AgentMode) =>
    setS((prev) => ({ ...prev, modes: { ...prev.modes, [id]: mode } }));

  return (
    <section className={cn("rounded-lg border border-border bg-card p-4", className)}>
      <header className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-primary" />
          <div>
            <h3 className="text-sm font-semibold">Auto-run AI agents after parsing</h3>
            {!compact && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Pick which agents run automatically and how cautious each one should be.
              </p>
            )}
          </div>
        </div>
        <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={s.enabled}
            onChange={(e) => setS({ ...s, enabled: e.target.checked })}
          />
          <span className="w-9 h-5 rounded-full bg-muted peer-checked:bg-primary relative transition-colors">
            <span
              className={cn(
                "absolute top-0.5 left-0.5 w-4 h-4 bg-background rounded-full transition-transform",
                s.enabled && "translate-x-4",
              )}
            />
          </span>
          <span className="text-xs font-medium">{s.enabled ? "On" : "Off"}</span>
        </label>
      </header>

      <div className={cn("grid gap-2", s.enabled ? "opacity-100" : "opacity-50 pointer-events-none")}>
        {(Object.keys(AUTO_AGENT_LABELS) as AutoAgentId[]).map((id) => {
          const meta = AUTO_AGENT_LABELS[id];
          const checked = s.agents[id];
          const mode = s.modes[id];
          return (
            <div
              key={id}
              className="p-2.5 rounded-md border border-border/60 hover:bg-muted/20 transition-colors"
            >
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-primary"
                  checked={checked}
                  onChange={() => toggleAgent(id)}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{meta.name}</div>
                  <div className="text-xs text-muted-foreground">{meta.help}</div>
                </div>
              </label>

              {meta.hasMode && (
                <div
                  className={cn(
                    "mt-2 ml-7 flex items-center gap-2",
                    !checked && "opacity-40 pointer-events-none",
                  )}
                >
                  <ModeChip
                    active={mode === "strict"}
                    label={meta.modeLabels?.strict || "Strict"}
                    title={meta.modeHelp?.strict}
                    onClick={() => setMode(id, "strict")}
                  />
                  <ModeChip
                    active={mode === "relaxed"}
                    label={meta.modeLabels?.relaxed || "Relaxed"}
                    title={meta.modeHelp?.relaxed}
                    onClick={() => setMode(id, "relaxed")}
                  />
                  <span
                    className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
                    title={mode === "strict" ? meta.modeHelp?.strict : meta.modeHelp?.relaxed}
                  >
                    <Info className="w-3 h-3" />
                    {mode === "strict" ? meta.modeHelp?.strict : meta.modeHelp?.relaxed}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

const ModeChip = ({
  active,
  label,
  title,
  onClick,
}: {
  active: boolean;
  label: string;
  title?: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className={cn(
      "px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors",
      active
        ? "bg-primary text-primary-foreground border-primary"
        : "bg-card border-border text-muted-foreground hover:bg-muted",
    )}
  >
    {label}
  </button>
);

export default AutoAgentsSettingsPanel;
