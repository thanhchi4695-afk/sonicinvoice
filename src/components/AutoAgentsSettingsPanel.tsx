import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import {
  AUTO_AGENT_LABELS,
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

  return (
    <section
      className={cn(
        "rounded-lg border border-border bg-card p-4",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-primary" />
          <div>
            <h3 className="text-sm font-semibold">Auto-run AI agents after parsing</h3>
            {!compact && (
              <p className="text-xs text-muted-foreground mt-0.5">
                When a parse finishes, automatically run the agents you choose below.
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
          return (
            <label
              key={id}
              className="flex items-start gap-3 p-2 rounded-md border border-border/60 hover:bg-muted/30 cursor-pointer"
            >
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-primary"
                checked={checked}
                onChange={() => toggleAgent(id)}
              />
              <div className="min-w-0">
                <div className="text-sm font-medium">{meta.name}</div>
                <div className="text-xs text-muted-foreground">{meta.help}</div>
              </div>
            </label>
          );
        })}
      </div>
    </section>
  );
};

export default AutoAgentsSettingsPanel;
