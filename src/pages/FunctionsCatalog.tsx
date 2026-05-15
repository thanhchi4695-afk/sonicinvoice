import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, ChevronDown, ArrowLeft, Sparkles } from "lucide-react";
import {
  featureRegistry,
  searchFeatures,
  categoryLabels,
  categoryIcons,
  type FeatureEntry,
} from "@/lib/feature-registry";
import { AGENT_DETAILS, AGENT_ORDER } from "@/lib/agent-catalog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type CategoryKey = keyof typeof categoryLabels;
const CATEGORY_KEYS = Object.keys(categoryLabels) as CategoryKey[];

const FunctionsCatalog = () => {
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<CategoryKey | "all" | "agents">("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list: FeatureEntry[] = query ? searchFeatures(query) : featureRegistry;
    if (activeCat !== "all" && activeCat !== "agents") {
      list = list.filter((f) => f.category === activeCat);
    }
    const grouped: Record<string, FeatureEntry[]> = {};
    for (const f of list) {
      (grouped[f.category] ||= []).push(f);
    }
    return grouped;
  }, [query, activeCat]);

  const matchedAgents = useMemo(() => {
    if (activeCat !== "all" && activeCat !== "agents") return [];
    if (!query) return AGENT_ORDER;
    const q = query.toLowerCase();
    return AGENT_ORDER.filter((id) => {
      const a = AGENT_DETAILS[id];
      return (
        a.name.toLowerCase().includes(q) ||
        a.tagline.toLowerCase().includes(q) ||
        a.summary.toLowerCase().includes(q)
      );
    });
  }, [query, activeCat]);

  const totalFeatures = featureRegistry.length;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/50 bg-card/30 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/dashboard">
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Link>
          </Button>
          <div className="flex-1">
            <h1 className="font-display text-xl sm:text-2xl">Functions Catalog</h1>
            <p className="text-xs text-muted-foreground">
              {totalFeatures} features · 5 AI agents · grouped by domain
            </p>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-4 pb-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search functions, agents, keywords…"
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={activeCat === "all"} onClick={() => setActiveCat("all")}>
              All
            </FilterChip>
            <FilterChip active={activeCat === "agents"} onClick={() => setActiveCat("agents")}>
              🤖 AI Agents
            </FilterChip>
            {CATEGORY_KEYS.map((k) => (
              <FilterChip key={k} active={activeCat === k} onClick={() => setActiveCat(k)}>
                {categoryIcons[k]} {categoryLabels[k]}
              </FilterChip>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-8">
        {/* AI Agents */}
        {(activeCat === "all" || activeCat === "agents") && matchedAgents.length > 0 && (
          <section>
            <h2 className="font-display text-lg mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" /> AI Agents
              <Badge variant="secondary" className="ml-1">{matchedAgents.length}</Badge>
            </h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {matchedAgents.map((id) => {
                const a = AGENT_DETAILS[id];
                const Icon = a.icon;
                const isOpen = openId === `agent:${id}`;
                return (
                  <div
                    key={id}
                    className="rounded-xl border border-border bg-card hover:border-primary/40 transition-colors"
                  >
                    <button
                      onClick={() => setOpenId(isOpen ? null : `agent:${id}`)}
                      className="w-full text-left p-4 flex items-start gap-3"
                    >
                      <div className={`shrink-0 w-10 h-10 rounded-lg border flex items-center justify-center ${a.accent}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-semibold">{a.name}</div>
                          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                        </div>
                        <div className="text-xs text-muted-foreground">{a.tagline}</div>
                        <p className="text-sm text-foreground/80 mt-2 line-clamp-2">{a.summary}</p>
                      </div>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 pt-1 space-y-3 text-sm border-t border-border/50">
                        <p className="text-foreground/90">{a.summary}</p>
                        <DetailList label="Inputs" items={a.inputs} />
                        <DetailList label="Outputs" items={a.outputs} />
                        <DetailList label="Triggers" items={a.triggers} />
                        <div>
                          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Examples</div>
                          <div className="space-y-2">
                            {a.examples.map((ex, i) => (
                              <div key={i} className="rounded-md bg-muted/40 border border-border/50 p-2">
                                <div className="text-xs font-semibold">{ex.title}</div>
                                <div className="text-xs text-muted-foreground">{ex.body}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Features by category */}
        {CATEGORY_KEYS.map((cat) => {
          const items = filtered[cat];
          if (!items || !items.length) return null;
          return (
            <section key={cat}>
              <h2 className="font-display text-lg mb-3 flex items-center gap-2">
                <span>{categoryIcons[cat]}</span> {categoryLabels[cat]}
                <Badge variant="secondary" className="ml-1">{items.length}</Badge>
              </h2>
              <div className="grid sm:grid-cols-2 gap-3">
                {items.map((f) => {
                  const isOpen = openId === f.id;
                  return (
                    <div
                      key={f.id}
                      className="rounded-xl border border-border bg-card hover:border-primary/40 transition-colors"
                    >
                      <button
                        onClick={() => setOpenId(isOpen ? null : f.id)}
                        className="w-full text-left p-4 flex items-start gap-3"
                      >
                        <div className="shrink-0 text-2xl">{f.icon}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-semibold">{f.name}</div>
                            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                          </div>
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{f.description}</p>
                        </div>
                      </button>
                      {isOpen && (
                        <div className="px-4 pb-4 pt-1 space-y-3 text-sm border-t border-border/50">
                          <p className="text-foreground/90">{f.description}</p>
                          {f.howTo?.length > 0 && (
                            <div>
                              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">How to use</div>
                              <ol className="list-decimal list-inside space-y-1 text-foreground/80">
                                {f.howTo.map((s, i) => (
                                  <li key={i}>{s}</li>
                                ))}
                              </ol>
                            </div>
                          )}
                          {f.tips && f.tips.length > 0 && (
                            <div>
                              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Tips</div>
                              <ul className="space-y-1 text-foreground/80">
                                {f.tips.map((t, i) => (
                                  <li key={i}>💡 {t}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {f.keywords && f.keywords.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {f.keywords.slice(0, 8).map((k) => (
                                <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                  {k}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}

        {Object.keys(filtered).length === 0 && matchedAgents.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            No matches for "{query}". Try a different search.
          </div>
        )}
      </main>
    </div>
  );
};

const FilterChip = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    onClick={onClick}
    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
      active
        ? "bg-primary text-primary-foreground border-primary"
        : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
    }`}
  >
    {children}
  </button>
);

const DetailList = ({ label, items }: { label: string; items: string[] }) => (
  <div>
    <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
    <ul className="space-y-0.5 text-foreground/80">
      {items.map((s, i) => (
        <li key={i}>• {s}</li>
      ))}
    </ul>
  </div>
);

export default FunctionsCatalog;
