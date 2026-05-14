import { useEffect, useState } from "react";
import { Loader2, Sparkles, Check, X, RefreshCw, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  suggestionId: string | null;
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

interface ScenarioQA { question: string; answer: string }
interface Comparison { question: string; answer: string; brand_a: string; brand_b: string }
interface CareStep { step: string; instruction: string }

interface GeoBlock {
  id: string;
  collection_suggestion_id: string;
  scenario_questions: ScenarioQA[];
  comparison_snippet: Comparison | null;
  care_instructions: CareStep[] | null;
  best_for_summary: string | null;
  status: "draft" | "approved" | "published";
  validation_errors: any;
}

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  approved: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  published: "bg-violet-500/15 text-violet-300 border-violet-500/30",
};

export default function CollectionGeoDialog({ suggestionId, open, onClose, onChanged }: Props) {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [block, setBlock] = useState<GeoBlock | null>(null);
  const [tab, setTab] = useState<"seo" | "geo">("geo");

  const load = async () => {
    if (!suggestionId) return;
    setLoading(true);
    const { data } = await supabase
      .from("collection_geo_blocks")
      .select("*")
      .eq("collection_suggestion_id", suggestionId)
      .maybeSingle();
    setBlock((data as any) ?? null);
    setLoading(false);
  };

  useEffect(() => { if (open) { setTab("geo"); load(); } }, [open, suggestionId]);

  const regenerate = async () => {
    if (!suggestionId) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("seo-collection-engine", {
        body: { suggestion_id: suggestionId },
      });
      if (error) throw error;
      if (!(data as any)?.geo?.generated) {
        toast.message((data as any)?.geo?.reason ?? "GEO regeneration skipped");
      } else {
        toast.success("GEO blocks regenerated");
      }
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Regeneration failed");
    } finally {
      setBusy(false);
    }
  };

  const saveBlock = async (patch: Partial<GeoBlock>) => {
    if (!block) return;
    const { error } = await supabase
      .from("collection_geo_blocks")
      .update(patch)
      .eq("id", block.id);
    if (error) toast.error(error.message);
    else { setBlock({ ...block, ...patch } as GeoBlock); }
  };

  const callPublishFn = async (action: "approve" | "publish" | "unpublish") => {
    if (!block) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("publish-geo-block", {
        body: { geo_block_id: block.id, action },
      });
      if (error) throw error;
      toast.success(`GEO block ${(data as any)?.status ?? action}`);
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${action} failed`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Collection content
            {block && <Badge className={`${STATUS_BADGE[block.status]} border text-xs`}>GEO {block.status}</Badge>}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="seo">SEO</TabsTrigger>
            <TabsTrigger value="geo">
              GEO
              {block?.status === "published" && <Check className="ml-1 h-3 w-3 text-emerald-400" />}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="seo" className="text-sm text-muted-foreground py-4">
            SEO output is managed from the existing collection panel and Sonic Rank list.
          </TabsContent>

          <TabsContent value="geo" className="space-y-4 py-4">
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : !block ? (
              <Card>
                <CardContent className="py-8 text-center space-y-3">
                  <p className="text-sm text-muted-foreground">No GEO blocks yet for this collection.</p>
                  <Button onClick={regenerate} disabled={busy}>
                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                    Generate GEO blocks
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="flex items-center justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={regenerate} disabled={busy || block.status === "approved" || block.status === "published"}>
                    <RefreshCw className="mr-1 h-3 w-3" /> Re-generate
                  </Button>
                  {block.status === "draft" && (
                    <Button size="sm" onClick={() => callPublishFn("approve")} disabled={busy}>
                      <Check className="mr-1 h-3 w-3" /> Approve
                    </Button>
                  )}
                  {block.status === "approved" && (
                    <Button size="sm" onClick={() => callPublishFn("publish")} disabled={busy}>
                      <ExternalLink className="mr-1 h-3 w-3" /> Publish to Shopify
                    </Button>
                  )}
                  {block.status === "published" && (
                    <Button size="sm" variant="outline" onClick={() => callPublishFn("unpublish")} disabled={busy}>
                      <X className="mr-1 h-3 w-3" /> Unpublish
                    </Button>
                  )}
                </div>

                {/* Best for */}
                <Card>
                  <CardContent className="p-4 space-y-2">
                    <div className="text-xs font-semibold uppercase text-muted-foreground">Best-for summary (≤25 words)</div>
                    <Textarea
                      value={block.best_for_summary ?? ""}
                      onChange={(e) => setBlock({ ...block, best_for_summary: e.target.value })}
                      onBlur={(e) => saveBlock({ best_for_summary: e.target.value })}
                      disabled={block.status === "published"}
                      rows={2}
                    />
                  </CardContent>
                </Card>

                {/* Scenario questions */}
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <div className="text-xs font-semibold uppercase text-muted-foreground">Scenario questions (40–80 words each)</div>
                    {(block.scenario_questions ?? []).map((qa, i) => (
                      <div key={i} className="space-y-1 border-l-2 border-border pl-3">
                        <Input
                          value={qa.question}
                          disabled={block.status === "published"}
                          onChange={(e) => {
                            const next = [...block.scenario_questions];
                            next[i] = { ...qa, question: e.target.value };
                            setBlock({ ...block, scenario_questions: next });
                          }}
                          onBlur={() => saveBlock({ scenario_questions: block.scenario_questions })}
                          placeholder="What should I wear to…?"
                        />
                        <Textarea
                          value={qa.answer}
                          rows={3}
                          disabled={block.status === "published"}
                          onChange={(e) => {
                            const next = [...block.scenario_questions];
                            next[i] = { ...qa, answer: e.target.value };
                            setBlock({ ...block, scenario_questions: next });
                          }}
                          onBlur={() => saveBlock({ scenario_questions: block.scenario_questions })}
                        />
                        <div className="text-[10px] text-muted-foreground">{qa.answer.trim().split(/\s+/).filter(Boolean).length} words</div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* Comparison snippet */}
                <Card>
                  <CardContent className="p-4 space-y-2">
                    <div className="text-xs font-semibold uppercase text-muted-foreground">Comparison snippet (optional, ≤60 words)</div>
                    {block.comparison_snippet ? (
                      <>
                        <Input value={block.comparison_snippet.question} readOnly className="text-xs" />
                        <Textarea
                          value={block.comparison_snippet.answer}
                          rows={3}
                          disabled={block.status === "published"}
                          onChange={(e) => setBlock({
                            ...block,
                            comparison_snippet: { ...block.comparison_snippet!, answer: e.target.value },
                          })}
                          onBlur={() => saveBlock({ comparison_snippet: block.comparison_snippet })}
                        />
                        <div className="text-[10px] text-muted-foreground">
                          {block.comparison_snippet.brand_a} vs {block.comparison_snippet.brand_b} ·{" "}
                          {block.comparison_snippet.answer.trim().split(/\s+/).filter(Boolean).length} words
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">No comparison generated (collection has fewer than 2 brands).</p>
                    )}
                  </CardContent>
                </Card>

                {/* Care instructions */}
                <Card>
                  <CardContent className="p-4 space-y-2">
                    <div className="text-xs font-semibold uppercase text-muted-foreground">Care &amp; use steps (≤20 words each)</div>
                    {block.care_instructions?.length ? (
                      <ol className="space-y-2 list-decimal list-inside text-sm">
                        {block.care_instructions.map((s, i) => (
                          <li key={i}>
                            <strong className="mr-1">{s.step}:</strong>
                            <span className="text-muted-foreground">{s.instruction}</span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-xs text-muted-foreground">Not applicable for this vertical.</p>
                    )}
                  </CardContent>
                </Card>

                {Array.isArray(block.validation_errors) && block.validation_errors.length > 0 && (
                  <Card className="border-amber-500/30">
                    <CardContent className="p-3">
                      <div className="text-xs font-semibold text-amber-300 mb-1">Validation issues</div>
                      <ul className="text-[11px] text-muted-foreground space-y-0.5">
                        {block.validation_errors.map((e: any, i: number) => (
                          <li key={i}>[{e.field}] {e.message}</li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
