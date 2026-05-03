import { Shield, Tags, Sparkles, Send, GraduationCap, ArrowRight, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import AutoAgentsSettingsPanel from "@/components/AutoAgentsSettingsPanel";

interface AIAgentsLandingProps {
  onOpenAgentDashboard: () => void;
  onOpenAgentGuide: () => void;
  onNavigateTab: (tab: string) => void;
  onNavigateFlow: (flow: string) => void;
}

type Agent = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  icon: React.ElementType;
  accent: string;
  quickStart: { label: string; onClick: () => void }[];
};

const AIAgentsLanding = ({
  onOpenAgentDashboard,
  onOpenAgentGuide,
  onNavigateTab,
  onNavigateFlow,
}: AIAgentsLandingProps) => {
  const agents: Agent[] = [
    {
      id: "watchdog",
      name: "Watchdog",
      tagline: "Margin & price guardian",
      description:
        "Monitors every price change against your margin rules. Blocks unsafe edits and alerts you when a competitor or supplier price would push you below target margin.",
      icon: Shield,
      accent: "text-amber-500 bg-amber-500/10 border-amber-500/30",
      quickStart: [
        { label: "Open Margin Guardian", onClick: () => { window.location.href = "/rules"; } },
        { label: "View Price Intelligence", onClick: () => { window.location.href = "/pricing-intelligence"; } },
      ],
    },
    {
      id: "classifier",
      name: "Classifier",
      tagline: "Auto-tags & categorises",
      description:
        "Reads each product and applies the 7-layer tag formula — category, fabric, season, occasion, fit, audience and collection — so your catalog stays consistently organised.",
      icon: Tags,
      accent: "text-teal-400 bg-teal-400/10 border-teal-400/30",
      quickStart: [
        { label: "Start an invoice", onClick: () => onNavigateFlow("invoice") },
        { label: "Open tools", onClick: () => onNavigateTab("tools") },
      ],
    },
    {
      id: "enrichment",
      name: "Enrichment",
      tagline: "Names, descriptions & images",
      description:
        "Generates SEO-ready titles in the [Color] + [Feature] + [Type] structure, writes product descriptions, and finds the right colour image variants from supplier sites.",
      icon: Sparkles,
      accent: "text-purple-400 bg-purple-400/10 border-purple-400/30",
      quickStart: [
        { label: "Run enrichment flow", onClick: () => onNavigateFlow("invoice") },
        { label: "Browse suppliers", onClick: () => onNavigateFlow("suppliers") },
      ],
    },
    {
      id: "publishing",
      name: "Publishing",
      tagline: "Push to Shopify & Lightspeed",
      description:
        "Builds Shopify CSV / Lightspeed exports, syncs inventory, updates barcodes and writes metafields — with idempotent GraphQL calls and a 500ms safety delay.",
      icon: Send,
      accent: "text-blue-400 bg-blue-400/10 border-blue-400/30",
      quickStart: [
        { label: "Go to Invoices", onClick: () => onNavigateTab("invoices") },
        { label: "Account & integrations", onClick: () => onNavigateTab("account") },
      ],
    },
    {
      id: "learning",
      name: "Learning",
      tagline: "Improves from your edits",
      description:
        "Watches every correction you make and feeds it back into the supplier brain — fingerprinting layouts, remembering field positions, and getting better with each invoice.",
      icon: GraduationCap,
      accent: "text-green-400 bg-green-400/10 border-green-400/30",
      quickStart: [
        { label: "Open Supplier Brain", onClick: () => onNavigateFlow("supplier_intelligence") },
        { label: "Processing history", onClick: () => onNavigateFlow("processing_history") },
      ],
    },
  ];

  return (
    <div className="px-4 py-6 sm:py-10 max-w-5xl mx-auto">
      <header className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <Bot className="w-6 h-6 text-primary" />
          <h1 className="text-2xl sm:text-3xl font-bold font-display">AI Agents</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Five specialised agents work together on every invoice — from classification
          to publishing. Each one runs automatically, but you can trigger them manually
          or jump into their dashboards below.
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {agents.map((agent) => {
          const Icon = agent.icon;
          return (
            <article
              key={agent.id}
              className="rounded-lg border border-border bg-card p-5 flex flex-col"
            >
              <div className="flex items-start gap-3 mb-3">
                <div className={cn("w-10 h-10 rounded-md flex items-center justify-center border", agent.accent)}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold font-display">{agent.name}</h2>
                  <p className="text-xs text-muted-foreground">{agent.tagline}</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground flex-1 mb-4">{agent.description}</p>
              <div className="flex flex-wrap gap-2">
                {agent.quickStart.map((qs, i) => (
                  <button
                    key={qs.label}
                    onClick={qs.onClick}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                      i === 0
                        ? "bg-primary/10 text-primary hover:bg-primary/20"
                        : "border border-border hover:bg-muted",
                    )}
                  >
                    {qs.label}
                    <ArrowRight className="w-3 h-3" />
                  </button>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
};

export default AIAgentsLanding;
