// Client-side Claude Skills loader.
// Fetches user-curated skill markdown from the `claude_skills` table
// and joins them in cascade order (base → task → supplier).
//
// For server-side use, see supabase/functions/_shared/claude-skills.ts.

import { supabase } from "@/integrations/supabase/client";

export type SkillTaskType = "extraction" | "enrichment" | "seo" | "pricing";

const BASE_SKILL = "fashion-retail";

async function getSkill(name: string): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "";
  const { data } = await supabase
    .from("claude_skills")
    .select("content")
    .eq("user_id", user.id)
    .eq("skill_name", name)
    .maybeSingle();
  return (data as { content?: string } | null)?.content ?? "";
}

export async function loadSkillsForTask(
  taskType: SkillTaskType,
  supplierName?: string | null,
): Promise<string> {
  const names = [BASE_SKILL, taskType];
  if (supplierName) {
    names.push(`supplier-${supplierName.toLowerCase().trim().replace(/\s+/g, "-")}`);
  }
  const parts = await Promise.all(names.map(getSkill));
  return parts.filter(p => p && p.trim().length > 0).join("\n\n---\n\n");
}
