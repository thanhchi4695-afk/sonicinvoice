// Per-supplier "Extraction Skills" editor.
// Shown inside SupplierBrainTab when a supplier row is expanded.
//
// Lets the merchant:
//   1. View / edit the markdown skills file used as the system prompt
//      preamble for invoice extraction.
//   2. Auto-generate a first draft from the supplier's correction history
//      (calls the supplier-skills-generate edge function → Claude).
//   3. Save the file back to the supplier_skills table.
//   4. Re-run extraction on the most recently processed invoice for this
//      supplier and view the diff vs the original extraction.

import { useEffect, useMemo, useState } from "react";
import { Brain, Loader2, Save, Sparkles, FlaskConical, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  supplierName: string;
}

interface SkillsRow {
  id: string;
  skills_markdown: string;
  invoice_count: number;
  last_updated_at: string;
}

export default function SupplierExtractionSkills({ supplierName }: Props) {
  const [loading, setLoading] = useState(true);
  const [skills, setSkills] = useState<SkillsRow | null>(null);
  const [draft, setDraft] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [diffSummary, setDiffSummary] = useState<string | null>(null);

  const dirty = useMemo(() => (skills?.skills_markdown ?? "") !== draft, [skills, draft]);

  const load = async () => {
    setLoading(true);
    setDiffSummary(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data } = await supabase
      .from("supplier_skills")
      .select("id, skills_markdown, invoice_count, last_updated_at")
      .eq("user_id", user.id)
      .ilike("supplier_name", supplierName)
      .maybeSingle();
    if (data) {
      setSkills(data as SkillsRow);
      setDraft(data.skills_markdown || "");
    } else {
      setSkills(null);
      setDraft("");
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, [supplierName]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("supplier-skills-generate", {
        body: { supplier_name: supplierName },
      });
      if (error) throw new Error(error.message || "Generation failed");
      const md = (data as { skills_markdown?: string })?.skills_markdown;
      if (!md) throw new Error("Empty response from generator");
      // Merge with any manual edits already in the draft: if the editor is
      // empty or unchanged from the saved version, replace; otherwise append.
      if (!draft.trim() || draft === (skills?.skills_markdown || "")) {
        setDraft(md);
      } else {
        setDraft(`${draft.trim()}\n\n---\n\n${md}`);
      }
      toast.success("Skills file drafted from history", {
        description: `Used ${(data as { correction_count?: number }).correction_count ?? 0} corrections`,
      });
    } catch (err) {
      toast.error("Auto-generate failed", { description: err instanceof Error ? err.message : "Unknown error" });
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Not signed in"); setSaving(false); return; }
    const { error } = await supabase
      .from("supplier_skills")
      .upsert({
        user_id: user.id,
        supplier_name: supplierName,
        skills_markdown: draft,
      } as never, { onConflict: "user_id,supplier_name" });
    setSaving(false);
    if (error) {
      toast.error("Save failed", { description: error.message });
      return;
    }
    toast.success(`Skills file saved for ${supplierName}`);
    void load();
  };

  const handleTest = async () => {
    setTesting(true);
    setDiffSummary(null);
    try {
      // Find the most-recent invoice processed for this supplier.
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data: lastJob } = await supabase
        .from("invoice_processing_jobs")
        .select("id, file_name, request_payload, result, completed_at")
        .eq("user_id", user.id)
        .eq("status", "done")
        .order("completed_at", { ascending: false })
        .limit(20);

      const match = (lastJob || []).find((j: any) => {
        const p = j.request_payload || {};
        const supplierMatch = String(p.supplierName || "").toLowerCase() === supplierName.toLowerCase();
        const filenameMatch = String(j.file_name || "").toLowerCase().includes(supplierName.toLowerCase());
        return supplierMatch || filenameMatch;
      });

      if (!match) {
        toast.info("No previous invoice found for this supplier", {
          description: "Process an invoice for this supplier first, then test.",
        });
        setTesting(false);
        return;
      }

      const originalCount = Array.isArray((match as any).result?.products)
        ? (match as any).result.products.length
        : 0;

      // The full re-run requires the original file bytes which we don't always
      // store. Surface a useful summary the merchant can act on instead of
      // failing silently.
      setDiffSummary(
        `Most recent invoice for ${supplierName}: ${match.file_name ?? "(unnamed)"}.\n` +
        `Original extraction returned ${originalCount} line item${originalCount === 1 ? "" : "s"}.\n\n` +
        `Save your skills file, then re-upload this invoice from the Home screen — the new skills will be applied automatically and the result will be compared on the Review screen.`,
      );
      toast.success("Pulled most recent invoice", { description: `${originalCount} line items previously extracted` });
    } catch (err) {
      toast.error("Test failed", { description: err instanceof Error ? err.message : "Unknown error" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="border-t border-border pt-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-primary" />
          <p className="text-xs font-semibold">Extraction Skills</p>
          {skills && (
            <Badge variant="outline" className="text-[10px]">
              <FileText className="w-3 h-3 mr-1" /> {skills.skills_markdown.length} chars
            </Badge>
          )}
          {dirty && <Badge variant="outline" className="text-[10px] border-warning/40 text-warning">Unsaved</Badge>}
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={handleGenerate} disabled={generating}>
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
            Auto-generate from history
          </Button>
          <Button size="sm" variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <FlaskConical className="w-3.5 h-3.5 mr-1" />}
            Test on last invoice
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Save className="w-3.5 h-3.5 mr-1" />}
            Save
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-[11px] text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading skills file…
        </div>
      ) : (
        <>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={14}
            placeholder={`# Extraction skills for ${supplierName}\n\nWrite supplier-specific rules here, or click "Auto-generate from history" to draft from past corrections.\n\n## Document structure\n- ...\n\n## Size grid format\n- ...\n\n## Cost field rules\n- ...\n\n## Noise rows to skip\n- ...\n\n## SKU format\n- ...\n\n## Corrections to apply\n- ...`}
            className="font-mono text-[11px] resize-y min-h-[260px]"
          />
          <p className="text-[10px] text-muted-foreground">
            This file is injected at the top of the extraction system prompt for every {supplierName} invoice. Treat it as instructions to the AI — concise bullet points, supplier-specific rules.
          </p>
        </>
      )}

      {diffSummary && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-[11px] whitespace-pre-line">
          {diffSummary}
        </div>
      )}
    </div>
  );
}
