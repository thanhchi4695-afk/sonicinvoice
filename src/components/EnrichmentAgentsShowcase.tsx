// ════════════════════════════════════════════════════════════════
// EnrichmentAgentsShowcase — visualises the 4 enrichment sub-agents
// (Query Builder, Supplier Agent, Web Agent, Verifier) that power
// the high-accuracy product matching pipeline. Each card now has a
// tappable info tooltip explaining inputs, outputs, and why it runs.
// ════════════════════════════════════════════════════════════════

import { useState } from "react";
import { Search, Building2, Globe2, ShieldCheck, ArrowRight, ChevronRight, Workflow, PlayCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import AgentInfoPopover, { type AgentInfo } from "./AgentInfoPopover";
import AgentTourController, { type TourStep } from "./AgentTourController";

interface Props {
  onOpenGuide?: () => void;
}

interface EnrichAgent {
  name: string;
  desc: string;
  icon: typeof Search;
  detail: string;
  info: AgentInfo;
}

const agents: EnrichAgent[] = [
  {
    name: "Query Builder",
    desc: "Ranks search strategies",
    icon: Search,
    detail: "Brand + Name + Colour + Material first; SKU-only last",
    info: {
      name: "Query Builder",
      why: "SKU-only searches return 10–25% match rates. Rich attribute queries hit 80–95%. This agent ranks the strongest queries first so downstream agents try the most-likely-to-match strategy first.",
      inputs: [
        "Invoice line: brand, name, SKU",
        "Optional: colour, material, season",
      ],
      outputs: [
        "Ordered list of search queries (best → fallback)",
        "Strategy label per query",
      ],
      triggers: "Every invoice line entering enrichment.",
    },
  },
  {
    name: "Supplier Agent",
    desc: "Crawls brand websites",
    icon: Building2,
    detail: "Validates /products/, /shop/, /p/ URLs only",
    info: {
      name: "Supplier Agent",
      why: "Brand sites are the source of truth for descriptions, RRP, and imagery. URL-shape validation rejects search/listing pages so we never store low-quality matches.",
      inputs: [
        "Top-ranked queries from Query Builder",
        "Known supplier domain (if linked)",
      ],
      outputs: [
        "Validated product page candidates",
        "Title, RRP, hero image, description",
      ],
      triggers: "When the brand has a known website or matches a supplier profile.",
    },
  },
  {
    name: "Web Agent",
    desc: "Searches retailers in parallel",
    icon: Globe2,
    detail: "Brave Search across AU stockists",
    info: {
      name: "Web Agent",
      why: "Some brands wholesale-only or have weak sites. Searching AU stockists in parallel widens coverage without slowing down the pipeline.",
      inputs: [
        "Remaining queries from Query Builder",
        "Region filter (AU stockists by default)",
      ],
      outputs: [
        "Ranked list of retailer product pages",
        "Snippets and confidence hints",
      ],
      triggers: "When Supplier Agent returns no high-confidence match — or always, in parallel.",
    },
  },
  {
    name: "Verifier",
    desc: "Scores top candidates",
    icon: ShieldCheck,
    detail: "Picks highest-confidence match (top 3)",
    info: {
      name: "Verifier",
      why: "Multiple candidates beats first-hit. The verifier compares the top 3 against the invoice line and picks the highest post-verification score, preventing low-quality early hits from blocking better matches.",
      inputs: [
        "Top 3 candidates from Supplier + Web agents",
        "Original invoice line attributes",
      ],
      outputs: [
        "Single best match with confidence %",
        "HIGH (≥90%) auto-export, MEDIUM (70–89%) confirm",
      ],
      triggers: "After candidate pool is collected from upstream agents.",
    },
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
                  <div className="flex items-center gap-1">
                    <AgentInfoPopover info={a.info} variant="accent" />
                    <span className="h-2 w-2 rounded-full bg-success" aria-label="active" />
                  </div>
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
