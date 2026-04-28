// ════════════════════════════════════════════════════════════════
// EnrichmentAgentsShowcase — visualises the 4 enrichment sub-agents
// (Query Builder, Supplier Agent, Web Agent, Verifier) that power
// the high-accuracy product matching pipeline. Rendered as a
// separate group beneath the main 5-agent pipeline on the home.
// ════════════════════════════════════════════════════════════════

import { Search, Building2, Globe2, ShieldCheck, ArrowRight, ChevronRight, Workflow } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Props {
  onOpenGuide?: () => void;
}

const agents = [
  {
    name: "Query Builder",
    desc: "Ranks search strategies",
    icon: Search,
    detail: "Brand + Name + Colour + Material first; SKU-only last",
  },
  {
    name: "Supplier Agent",
    desc: "Crawls brand websites",
    icon: Building2,
    detail: "Validates /products/, /shop/, /p/ URLs only",
  },
  {
    name: "Web Agent",
    desc: "Searches retailers in parallel",
    icon: Globe2,
    detail: "Brave Search across AU stockists",
  },
  {
    name: "Verifier",
    desc: "Scores top candidates",
    icon: ShieldCheck,
    detail: "Picks highest-confidence match (top 3)",
  },
];

const EnrichmentAgentsShowcase = ({ onOpenGuide }: Props) => {
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Workflow className="h-4 w-4 text-accent" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Enrichment intelligence
              <Badge variant="secondary" className="ml-2 text-[10px]">New</Badge>
            </h2>
            <p className="text-xs text-muted-foreground">
              4 specialised sub-agents driving 80–95% product match accuracy.
            </p>
          </div>
        </div>
        {onOpenGuide && (
          <Button variant="ghost" size="sm" onClick={onOpenGuide} className="text-xs">
            How it works <ChevronRight className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Agent cards */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {agents.map((a, i) => {
          const Icon = a.icon;
          return (
            <div key={a.name} className="relative">
              <Card className="flex h-full flex-col gap-2 border-accent/30 bg-card p-3">
                <div className="flex items-start justify-between">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent/10 text-accent">
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className="h-2 w-2 rounded-full bg-success" aria-label="active" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-foreground">{a.name}</p>
                  <p className="text-[10px] text-muted-foreground">{a.desc}</p>
                </div>
                <p className="text-[10px] text-muted-foreground">{a.detail}</p>
              </Card>
              {i < agents.length - 1 && (
                <ArrowRight className="absolute right-[-10px] top-1/2 hidden h-3 w-3 -translate-y-1/2 text-muted-foreground/40 lg:block" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default EnrichmentAgentsShowcase;
