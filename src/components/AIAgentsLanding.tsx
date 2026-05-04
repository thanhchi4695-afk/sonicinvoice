import { useState } from "react";
import { ArrowRight, Bot, BookOpen, PlayCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import AutoAgentsSettingsPanel from "@/components/AutoAgentsSettingsPanel";
import AgentLearnMore from "@/components/AgentLearnMore";
import { AGENT_DETAILS, AGENT_ORDER, type AgentId } from "@/lib/agent-catalog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface AIAgentsLandingProps {
  onOpenAgentDashboard: () => void;
  onOpenAgentGuide: () => void;
  onNavigateTab: (tab: string) => void;
  onNavigateFlow: (flow: string) => void;
}

const AIAgentsLanding = ({
  onOpenAgentDashboard,
  onOpenAgentGuide,
  onNavigateTab,
  onNavigateFlow,
}: AIAgentsLandingProps) => {
  const [active, setActive] = useState<AgentId | null>(null);

  // Map each agent to its primary quick-start action.
  const quickStartFor = (id: AgentId): { label: string; onClick: () => void } => {
    switch (id) {
      case "watchdog":
        return { label: "Open Margin Guardian", onClick: () => { window.location.href = "/rules"; } };
      case "classifier":
        return { label: "Start an invoice", onClick: () => onNavigateFlow("invoice") };
      case "enrichment":
        return { label: "Run enrichment flow", onClick: () => onNavigateFlow("invoice") };
      case "publishing":
        return { label: "Go to Invoices", onClick: () => onNavigateTab("invoices") };
      case "learning":
        return { label: "Open Supplier Brain", onClick: () => onNavigateFlow("supplier_intelligence") };
    }
  };

  if (active) {
    const qs = quickStartFor(active);
    return (
      <AgentLearnMore
        agentId={active}
        onBack={() => setActive(null)}
        onQuickStart={qs.onClick}
        quickStartLabel={qs.label}
      />
    );
  }

  return (
    <div className="px-4 py-6 sm:py-10 max-w-5xl mx-auto">
      <header className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <Bot className="w-6 h-6 text-primary" />
          <h1 className="text-2xl sm:text-3xl font-bold font-display">AI Agents</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Five specialised agents work together on every invoice — from classification
          to publishing. Tap any card to see its inputs, outputs and examples, or jump
          straight into its dashboard.
        </p>
        <div className="flex gap-2 mt-4">
          <button
            onClick={onOpenAgentDashboard}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
          >
            Open agent dashboard
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={onOpenAgentGuide}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-border text-sm font-medium hover:bg-muted"
          >
            Read the agent guide
          </button>
        </div>
      </header>

      <AutoAgentsSettingsPanel className="mb-6" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {AGENT_ORDER.map((id) => {
          const agent = AGENT_DETAILS[id];
          const Icon = agent.icon;
          const qs = quickStartFor(id);
          return (
            <article key={id} className="rounded-lg border border-border bg-card p-5 flex flex-col">
              <div className="flex items-start gap-3 mb-3">
                <div className={cn("w-10 h-10 rounded-md flex items-center justify-center border", agent.accent)}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold font-display">{agent.name}</h2>
                  <p className="text-xs text-muted-foreground">{agent.tagline}</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground flex-1 mb-4 line-clamp-3">{agent.summary}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={qs.onClick}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 text-xs font-medium"
                >
                  {qs.label}
                  <ArrowRight className="w-3 h-3" />
                </button>
                <button
                  onClick={() => setActive(id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border hover:bg-muted text-xs font-medium"
                >
                  <BookOpen className="w-3 h-3" />
                  Learn more
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
};

export default AIAgentsLanding;
