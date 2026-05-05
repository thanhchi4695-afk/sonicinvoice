import { useEffect, useMemo, useState } from "react";
import { Loader2, RotateCcw, Save, Cpu } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { BackButton } from "@/components/BackButton";

// Keep in sync with supabase/functions/_shared/model-router.ts
const JOBS: Array<{ id: string; layer: string; label: string; defaultModel: string; help: string }> = [
  { id: "invoice.parse",        layer: "Parsing",    label: "Invoice parse",         defaultModel: "google/gemini-2.5-pro",       help: "PDF/image → structured line items" },
  { id: "invoice.classify",     layer: "Parsing",    label: "Invoice classify",      defaultModel: "google/gemini-2.5-flash",     help: "Detect type (A–F) + supplier" },
  { id: "packing-slip.parse",   layer: "Parsing",    label: "Packing slip parse",    defaultModel: "google/gemini-2.5-flash",     help: "Style/colour/size/qty only" },
  { id: "image.ocr",            layer: "Parsing",    label: "Image OCR",             defaultModel: "google/gemini-2.5-flash",     help: "Photo/scan OCR fallback" },

  { id: "brand.tag",            layer: "Brand IP",   label: "Brand tagging",         defaultModel: "anthropic/claude-sonnet-4-5", help: "187-rule tag engine + size norm" },
  { id: "product.naming",       layer: "Brand IP",   label: "Product naming",        defaultModel: "anthropic/claude-sonnet-4-5", help: "[Colour] + [Feature] + [Type]" },
  { id: "product.enrich",       layer: "Brand IP",   label: "Product enrich",        defaultModel: "anthropic/claude-sonnet-4-5", help: "Full Shopify-ready row" },
  { id: "seo.description",      layer: "Brand IP",   label: "SEO description",       defaultModel: "anthropic/claude-sonnet-4-5", help: "Long-form SEO copy" },
  { id: "collection.architect", layer: "Brand IP",   label: "Collection architect",  defaultModel: "anthropic/claude-sonnet-4-5", help: "Collection structure / hierarchy" },

  { id: "price.lookup",         layer: "Enrichment", label: "Price lookup",          defaultModel: "google/gemini-2.5-flash",     help: "Live AU RRP lookup" },
  { id: "competitor.scan",      layer: "Enrichment", label: "Competitor scan",       defaultModel: "google/gemini-2.5-flash",     help: "Competitor pricing intel" },

  { id: "classify.simple",      layer: "Misc",       label: "Simple classify",       defaultModel: "google/gemini-3-flash-preview", help: "Cheap routing" },
  { id: "chat.assistant",       layer: "Misc",       label: "Chat assistant",        defaultModel: "google/gemini-2.5-flash",     help: "In-app helper" },
];

const MODEL_OPTIONS = [
  { value: "google/gemini-2.5-pro",            label: "Gemini 2.5 Pro" },
  { value: "google/gemini-2.5-flash",          label: "Gemini 2.5 Flash" },
  { value: "google/gemini-2.5-flash-lite",     label: "Gemini 2.5 Flash Lite" },
  { value: "google/gemini-3-flash-preview",    label: "Gemini 3 Flash (preview)" },
  { value: "google/gemini-3.1-pro-preview",    label: "Gemini 3.1 Pro (preview)" },
  { value: "anthropic/claude-sonnet-4-5",      label: "Claude Sonnet 4.5" },
  { value: "anthropic/claude-haiku-4-5",       label: "Claude Haiku 4.5" },
  { value: "openai/gpt-5",                     label: "GPT-5" },
  { value: "openai/gpt-5-mini",                label: "GPT-5 mini" },
  { value: "openai/gpt-5-nano",                label: "GPT-5 nano" },
];

interface OverrideRow {
  job: string;
  model: string;
  notes: string | null;
}

const AdminAIModels = () => {
  const [overrides, setOverrides] = useState<Record<string, OverrideRow>>({});
  const [drafts, setDrafts] = useState<Record<string, { model: string; notes: string }>>({});
  const [loading, setLoading] = useState(true);
  const [savingJob, setSavingJob] = useState<string | null>(null);

  const layers = useMemo(() => Array.from(new Set(JOBS.map((j) => j.layer))), []);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("ai_model_overrides")
      .select("job,model,notes");
    if (error) {
      toast({ title: "Load failed", description: error.message, variant: "destructive" });
    } else {
      const map: Record<string, OverrideRow> = {};
      (data || []).forEach((r: any) => { map[r.job] = r; });
      setOverrides(map);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const effectiveModel = (jobId: string, def: string) =>
    drafts[jobId]?.model ?? overrides[jobId]?.model ?? def;

  const setDraft = (jobId: string, patch: Partial<{ model: string; notes: string }>) => {
    setDrafts((d) => ({
      ...d,
      [jobId]: {
        model: patch.model ?? d[jobId]?.model ?? overrides[jobId]?.model ?? "",
        notes: patch.notes ?? d[jobId]?.notes ?? overrides[jobId]?.notes ?? "",
      },
    }));
  };

  const save = async (jobId: string, def: string) => {
    const draft = drafts[jobId];
    if (!draft) return;
    setSavingJob(jobId);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const payload = { job: jobId, model: draft.model || def, notes: draft.notes || null, updated_by: user?.id };
      const { error } = await supabase
        .from("ai_model_overrides")
        .upsert(payload, { onConflict: "job" });
      if (error) throw error;
      toast({ title: "Saved", description: `${jobId} → ${payload.model}` });
      setDrafts((d) => { const { [jobId]: _, ...rest } = d; return rest; });
      await load();
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSavingJob(null);
    }
  };

  const reset = async (jobId: string) => {
    setSavingJob(jobId);
    try {
      const { error } = await supabase.from("ai_model_overrides").delete().eq("job", jobId);
      if (error) throw error;
      toast({ title: "Reset to default" });
      setDrafts((d) => { const { [jobId]: _, ...rest } = d; return rest; });
      await load();
    } catch (e: any) {
      toast({ title: "Reset failed", description: e.message, variant: "destructive" });
    } finally {
      setSavingJob(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-5xl py-8 px-4 space-y-6">
      <BackButton />
      <div className="flex items-center gap-3">
        <Cpu className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Model Routing</h1>
          <p className="text-sm text-muted-foreground">
            Choose which AI model handles each pipeline step. Changes apply within 60 seconds. No redeploy needed.
          </p>
        </div>
      </div>

      {layers.map((layer) => (
        <Card key={layer}>
          <CardHeader>
            <CardTitle className="text-base">{layer}</CardTitle>
            <CardDescription>
              {layer === "Parsing" && "Document → structured data"}
              {layer === "Brand IP" && "Your brand intelligence — tagging, naming, SEO, collections"}
              {layer === "Enrichment" && "Live web lookups for pricing & competitive intel"}
              {layer === "Misc" && "Lightweight helpers"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {JOBS.filter((j) => j.layer === layer).map((job) => {
              const isOverridden = !!overrides[job.id];
              const isDirty = !!drafts[job.id];
              const current = effectiveModel(job.id, job.defaultModel);
              return (
                <div key={job.id} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start border-t pt-4 first:border-t-0 first:pt-0">
                  <div className="md:col-span-4">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{job.label}</span>
                      {isOverridden && <Badge variant="secondary" className="text-[10px]">override</Badge>}
                      {isDirty && <Badge className="text-[10px]">unsaved</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{job.help}</p>
                    <p className="text-[10px] text-muted-foreground/70 mt-1 font-mono">{job.id}</p>
                  </div>
                  <div className="md:col-span-4">
                    <Select value={current} onValueChange={(v) => setDraft(job.id, { model: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MODEL_OPTIONS.map((m) => (
                          <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Default: <span className="font-mono">{job.defaultModel}</span>
                    </p>
                  </div>
                  <div className="md:col-span-3">
                    <Input
                      placeholder="Notes (optional)"
                      value={drafts[job.id]?.notes ?? overrides[job.id]?.notes ?? ""}
                      onChange={(e) => setDraft(job.id, { notes: e.target.value })}
                    />
                  </div>
                  <div className="md:col-span-1 flex flex-col gap-1">
                    <Button
                      size="sm"
                      disabled={!isDirty || savingJob === job.id}
                      onClick={() => save(job.id, job.defaultModel)}
                    >
                      {savingJob === job.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                    </Button>
                    {isOverridden && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={savingJob === job.id}
                        onClick={() => reset(job.id)}
                        title="Reset to default"
                      >
                        <RotateCcw className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default AdminAIModels;
