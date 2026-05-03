import { ArrowLeft, ArrowRight, CheckCircle2, Inbox, Send as SendIcon, Zap } from "lucide-react";
import { AGENT_DETAILS, type AgentId } from "@/lib/agent-catalog";
import { cn } from "@/lib/utils";

interface Props {
  agentId: AgentId;
  onBack: () => void;
  onQuickStart?: () => void;
  quickStartLabel?: string;
}

const AgentLearnMore = ({ agentId, onBack, onQuickStart, quickStartLabel }: Props) => {
  const agent = AGENT_DETAILS[agentId];
  const Icon = agent.icon;

  return (
    <div className="px-4 py-6 sm:py-10 max-w-4xl mx-auto">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back to AI Agents
      </button>

      <header className="flex items-start gap-4 mb-6">
        <div className={cn("w-14 h-14 rounded-lg flex items-center justify-center border", agent.accent)}>
          <Icon className="w-7 h-7" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold font-display">{agent.name}</h1>
          <p className="text-sm text-muted-foreground">{agent.tagline}</p>
        </div>
        {onQuickStart && (
          <button
            onClick={onQuickStart}
            className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 shrink-0"
          >
            {quickStartLabel || "Quick start"}
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </header>

      <p className="text-sm leading-relaxed mb-8 text-foreground/90">{agent.summary}</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <Section icon={<Inbox className="w-4 h-4" />} title="Inputs" items={agent.inputs} />
        <Section icon={<SendIcon className="w-4 h-4" />} title="Outputs" items={agent.outputs} />
      </div>

      <section className="mb-8">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" /> Examples
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {agent.examples.map((ex) => (
            <article key={ex.title} className="rounded-md border border-border bg-card p-4">
              <h3 className="text-sm font-semibold mb-1">{ex.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{ex.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-border bg-muted/20 p-4">
        <h2 className="text-sm font-semibold mb-2">When does it run?</h2>
        <ul className="text-xs text-muted-foreground space-y-1">
          {agent.triggers.map((t) => (
            <li key={t} className="flex items-start gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

const Section = ({ icon, title, items }: { icon: React.ReactNode; title: string; items: string[] }) => (
  <section className="rounded-md border border-border bg-card p-4">
    <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
      {icon} {title}
    </h2>
    <ul className="space-y-2">
      {items.map((it) => (
        <li key={it} className="flex items-start gap-2 text-xs text-foreground/85">
          <span className="w-1 h-1 rounded-full bg-primary mt-1.5 shrink-0" />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  </section>
);

export default AgentLearnMore;
