// Skills Library — manage Claude "skill files" (markdown) that get
// injected as authoritative system-prompt preambles for AI tasks.
//
// Lives inside Account → AI & Data tab.
//
// Backed by the `claude_skills` table (one row per user × skill_name).
// The skill_name slugs the loader looks for are:
//   - "fashion-retail"          (always loaded)
//   - "extraction" / "enrichment" / "seo" / "pricing"
//   - "supplier-<slug>"         (per-supplier overrides)
//
// Pre-populates 3 starter files on first open if the user has none.

import { useEffect, useMemo, useState } from "react";
import {
  Brain, Plus, Save, Trash2, Loader2, FlaskConical, BookOpen, FileText, RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SkillRow {
  id: string;
  skill_name: string;
  content: string;
  task_types: string[];
  is_global: boolean;
  updated_at: string;
}

const TASK_TYPE_OPTIONS = ["extraction", "enrichment", "seo", "pricing"] as const;

// Friendly names for the canonical slugs.
const FRIENDLY: Record<string, string> = {
  "fashion-retail": "Fashion Retail — Australian Market",
  "extraction": "Invoice Extraction",
  "enrichment": "Product Enrichment",
  "seo": "SEO Writer",
  "pricing": "Pricing & Margin",
  "shopify-csv": "Shopify CSV Format",
  "darwin-retail": "Darwin Retail Market",
};

function pretty(name: string): string {
  if (FRIENDLY[name]) return FRIENDLY[name];
  if (name.startsWith("supplier-")) {
    const s = name.slice("supplier-".length).replace(/-/g, " ");
    return `Supplier — ${s.replace(/\b\w/g, (c) => c.toUpperCase())}`;
  }
  return name;
}

const STARTER_SKILLS: Array<Pick<SkillRow, "skill_name" | "content" | "task_types" | "is_global">> = [
  {
    skill_name: "fashion-retail",
    is_global: true,
    task_types: ["extraction", "enrichment", "seo", "pricing"],
    content: `# Fashion Retail — Australian Market

## Sizing
- Use AU sizes by default (6, 8, 10, 12, 14, 16). 'OS' = One Size.
- Variants ALWAYS list Colour first, then Size.

## Pricing & GST
- Prices are inclusive of 10% GST unless explicitly marked "ex-GST".
- Default markup ladder: cost × 2.35 (rounded to nearest $0.05).
- Round retail to .95 endings where possible.

## Seasons (Australia)
- SS = Spring/Summer (Aug–Jan). AW = Autumn/Winter (Feb–Jul).

## Vendor names
- Vendor names should match the official brand spelling exactly.
- Strip suffixes like "Swimwear", "Apparel", "Australia", "Pty Ltd" unless they are part of the official name.
- Always check vendor spelling against the brand database before confirming.
`,
  },
  {
    skill_name: "shopify-csv",
    is_global: false,
    task_types: ["extraction", "enrichment"],
    content: `# Shopify CSV Format

## Required columns
- Handle (lowercase, hyphenated, ASCII only)
- Title, Body (HTML), Vendor, Product Category, Type, Tags
- Variant SKU, Variant Price, Variant Inventory Qty, Variant Barcode
- Option1 Name = "Colour", Option2 Name = "Size" (in that order)

## Variant rules
- One row per variant. Repeat Handle for each variant of a product.
- First variant row carries Title, Body, Vendor, etc. Subsequent variant rows leave those blank.
- Image rows (no variant data) come AFTER all variant rows for the handle.

## Common gotchas
- Tags: comma-separated, no quotes around the whole field.
- Status: "active" / "draft" / "archived" only.
- Published: TRUE/FALSE — leave FALSE for draft import.
`,
  },
  {
    skill_name: "darwin-retail",
    is_global: false,
    task_types: ["seo", "enrichment"],
    content: `# Darwin Retail Market

## Climate
- Tropical year-round. Two seasons only: Wet (Nov–Apr) and Dry (May–Oct).
- Customers shop swimwear and resort wear all year — never assume "off-season".

## Customer demographics
- Mix of locals, FIFO workers, defence families, and tourists.
- Strong demand for sun-protective fabrics (UPF 50+), quick-dry, and chlorine-resistant.
- Mention "tropical", "humid", and "outdoor lifestyle" cues in SEO copy where relevant.

## Local context
- Free shipping threshold copy should reference "across NT and Australia-wide".
- Reference Mindil Beach, Cullen Bay, and the Top End sparingly for local SEO.
`,
  },
];

const FEATURE_USAGE: Record<string, string[]> = {
  extraction: ["Invoice Extraction"],
  enrichment: ["Product Enrichment"],
  seo: ["SEO Writer", "Collection SEO"],
  pricing: ["Pricing Engine"],
};

function defaultUsedBy(skill: SkillRow): string[] {
  if (skill.skill_name === "fashion-retail") {
    return ["Invoice Extraction", "Product Enrichment", "SEO Writer", "Pricing Engine"];
  }
  if (skill.skill_name.startsWith("supplier-")) {
    return ["Invoice Extraction", "Product Enrichment"];
  }
  const out = new Set<string>();
  (skill.task_types || []).forEach((t) => (FEATURE_USAGE[t] || []).forEach((f) => out.add(f)));
  return Array.from(out);
}

interface UsageStat {
  feature: string;
  task_type: string | null;
  count: number;
  last_used_at: string;
}

export default function ClaudeSkillsLibrary() {
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [usageBySkill, setUsageBySkill] = useState<Record<string, UsageStat[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [draftTaskTypes, setDraftTaskTypes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testOutput, setTestOutput] = useState<string | null>(null);
  const [testTaskType, setTestTaskType] = useState<string>("extraction");

  const selected = useMemo(() => skills.find((s) => s.id === selectedId) || null, [skills, selectedId]);
  const dirty = selected
    ? draftContent !== selected.content
        || draftName !== selected.skill_name
        || JSON.stringify(draftTaskTypes.sort()) !== JSON.stringify((selected.task_types || []).slice().sort())
    : draftContent.length > 0 || draftName.length > 0;

  const load = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data, error } = await supabase
      .from("claude_skills")
      .select("id, skill_name, content, task_types, is_global, updated_at")
      .eq("user_id", user.id)
      .order("skill_name", { ascending: true });
    if (error) {
      toast.error("Failed to load skills", { description: error.message });
    }
    const rows = (data as SkillRow[] | null) || [];
    setSkills(rows);

    // Auto-seed starter files on first open.
    if (rows.length === 0) {
      setSeeding(true);
      try {
        const inserts = STARTER_SKILLS.map((s) => ({ ...s, user_id: user.id }));
        const { data: inserted } = await supabase
          .from("claude_skills")
          .insert(inserts as never)
          .select("id, skill_name, content, task_types, is_global, updated_at");
        if (inserted) setSkills(inserted as SkillRow[]);
      } finally { setSeeding(false); }
    }

    setLoading(false);
    void loadUsage(user.id);
  };

  const loadUsage = async (userId: string) => {
    const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 90).toISOString();
    const { data } = await supabase
      .from("claude_skill_usage")
      .select("skill_name, feature, task_type, used_at")
      .eq("user_id", userId)
      .gte("used_at", since)
      .order("used_at", { ascending: false })
      .limit(2000);
    const rows = (data as Array<{ skill_name: string; feature: string; task_type: string | null; used_at: string }> | null) || [];
    const map: Record<string, Record<string, UsageStat>> = {};
    for (const r of rows) {
      const key = `${r.feature}::${r.task_type || ""}`;
      map[r.skill_name] = map[r.skill_name] || {};
      const slot = map[r.skill_name][key];
      if (slot) {
        slot.count += 1;
      } else {
        map[r.skill_name][key] = {
          feature: r.feature,
          task_type: r.task_type,
          count: 1,
          last_used_at: r.used_at,
        };
      }
    }
    const out: Record<string, UsageStat[]> = {};
    Object.entries(map).forEach(([k, v]) => {
      out[k] = Object.values(v).sort((a, b) => b.count - a.count);
    });
    setUsageBySkill(out);
  };

  useEffect(() => { void load(); }, []);

  // Hydrate draft when a skill is selected.
  useEffect(() => {
    if (selected) {
      setDraftName(selected.skill_name);
      setDraftContent(selected.content);
      setDraftTaskTypes(selected.task_types || []);
      setTestOutput(null);
      setTestTaskType(selected.task_types?.[0] || "extraction");
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNew = () => {
    setSelectedId(null);
    setDraftName("");
    setDraftContent("");
    setDraftTaskTypes(["extraction"]);
    setTestOutput(null);
  };

  const handleSave = async () => {
    if (!draftName.trim()) {
      toast.error("Skill name required");
      return;
    }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }
    const slug = draftName.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const { error } = await supabase
      .from("claude_skills")
      .upsert({
        user_id: user.id,
        skill_name: slug,
        content: draftContent,
        task_types: draftTaskTypes,
      } as never, { onConflict: "user_id,skill_name" });
    setSaving(false);
    if (error) {
      toast.error("Save failed", { description: error.message });
      return;
    }
    toast.success(`Saved "${pretty(slug)}"`);
    await load();
    const fresh = (await supabase
      .from("claude_skills")
      .select("id")
      .eq("user_id", user.id)
      .eq("skill_name", slug)
      .maybeSingle()).data as { id: string } | null;
    if (fresh) setSelectedId(fresh.id);
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (!confirm(`Delete skill "${pretty(selected.skill_name)}"?`)) return;
    const { error } = await supabase.from("claude_skills").delete().eq("id", selected.id);
    if (error) { toast.error("Delete failed", { description: error.message }); return; }
    toast.success("Skill deleted");
    setSelectedId(null);
    await load();
  };

  const handleTest = async () => {
    setTesting(true);
    setTestOutput(null);
    try {
      const { data, error } = await supabase.functions.invoke("claude-skills-test", {
        body: { skills_markdown: draftContent, task_type: testTaskType },
      });
      if (error) throw new Error(error.message || "Test failed");
      const out = (data as { output?: string; sample_task?: string }).output || "(no output)";
      const sample = (data as { sample_task?: string }).sample_task || "";
      setTestOutput(`▶ Sample task:\n${sample}\n\n◀ Claude response:\n${out}`);
    } catch (err) {
      toast.error("Test failed", { description: err instanceof Error ? err.message : "Unknown" });
    } finally {
      setTesting(false);
    }
  };

  const handleResetStarters = async () => {
    if (!confirm("Re-create the starter skill files? Existing ones with the same name will be updated.")) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const inserts = STARTER_SKILLS.map((s) => ({ ...s, user_id: user.id }));
    const { error } = await supabase
      .from("claude_skills")
      .upsert(inserts as never, { onConflict: "user_id,skill_name" });
    if (error) { toast.error(error.message); return; }
    toast.success("Starter skills restored");
    await load();
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">Skills Library</h3>
          <Badge variant="outline" className="text-[10px]">Claude</Badge>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={handleResetStarters}>
            <RotateCcw className="w-3.5 h-3.5 mr-1" /> Restore starters
          </Button>
          <Button size="sm" onClick={handleNew}>
            <Plus className="w-3.5 h-3.5 mr-1" /> New skill
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Skill files are merchant-curated markdown rule books that get injected at the top of every Claude prompt. Use them to teach Claude your store's vocabulary, sizing, brands, and conventions.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        {/* List */}
        <div className="border border-border rounded-md overflow-hidden">
          <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border bg-muted/30">
            {skills.length} skill{skills.length === 1 ? "" : "s"}
          </div>
          {loading || seeding ? (
            <div className="p-4 text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" /> {seeding ? "Setting up starter skills…" : "Loading…"}
            </div>
          ) : skills.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground">No skills yet. Click <strong>New skill</strong>.</div>
          ) : (
            <ul className="divide-y divide-border">
              {skills.map((s) => {
                const used = usedByLabels(s);
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => setSelectedId(s.id)}
                      className={`w-full text-left px-3 py-2 hover:bg-muted/40 transition-colors ${selectedId === s.id ? "bg-muted/60" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold truncate">{pretty(s.skill_name)}</span>
                        {s.is_global && <Badge variant="outline" className="text-[9px]">global</Badge>}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                        {used.length > 0 ? `Used by: ${used.join(", ")}` : "Not wired to a feature"}
                      </div>
                      <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                        {new Date(s.updated_at).toLocaleDateString()} · {s.content.length} chars
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Editor */}
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-end">
            <div>
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Skill name (slug)</Label>
              <Input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="e.g. fashion-retail, supplier-baku, shopify-csv"
                className="text-sm"
              />
            </div>
            {dirty && <Badge variant="outline" className="text-[10px] border-warning/40 text-warning">Unsaved</Badge>}
          </div>

          <div>
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Used by tasks</Label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {TASK_TYPE_OPTIONS.map((t) => {
                const on = draftTaskTypes.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setDraftTaskTypes((prev) => on ? prev.filter((x) => x !== t) : [...prev, t])}
                    className={`text-[11px] px-2 py-0.5 rounded border ${on ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Skill content (markdown)</Label>
            <Textarea
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              rows={16}
              className="font-mono text-[11px] resize-y min-h-[280px]"
              placeholder={"# My skill\n\nWrite concise rules. Bullet points work best.\n\n## Section\n- Rule 1\n- Rule 2"}
            />
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Test as task</Label>
              <select
                value={testTaskType}
                onChange={(e) => setTestTaskType(e.target.value)}
                className="text-xs bg-background border border-border rounded px-2 py-1"
              >
                {TASK_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <Button size="sm" variant="outline" onClick={handleTest} disabled={testing}>
                {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <FlaskConical className="w-3.5 h-3.5 mr-1" />}
                Test this skill
              </Button>
            </div>
            <div className="flex items-center gap-1.5">
              {selected && (
                <Button size="sm" variant="ghost" onClick={handleDelete} className="text-destructive">
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                </Button>
              )}
              <Button size="sm" onClick={handleSave} disabled={saving || !draftName.trim()}>
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Save className="w-3.5 h-3.5 mr-1" />}
                Save
              </Button>
            </div>
          </div>

          {testOutput && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-[11px] whitespace-pre-wrap font-mono">
              {testOutput}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
