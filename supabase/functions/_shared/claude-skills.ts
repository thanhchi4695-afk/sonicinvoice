// Shared loader: fetch user-curated "Claude Skills" markdown files
// from the `claude_skills` table and join them into a single block to be
// injected at the top of an LLM system prompt.
//
// Skills cascade from broad → specific:
//   1. Base skill          (always — e.g. "fashion-retail")
//   2. Task-type skill     (e.g. "extraction", "enrichment", "seo", "pricing")
//   3. Supplier-specific   (e.g. "supplier-baku")
//
// Each is just a row in `claude_skills` keyed by (user_id, skill_name).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

export type SkillTaskType = "extraction" | "enrichment" | "seo" | "pricing";

const BASE_SKILL = "fashion-retail";

interface SkillRow {
  skill_name: string;
  content: string;
}

function admin() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

async function fetchOne(userId: string, skillName: string): Promise<string> {
  try {
    const { data } = await admin()
      .from("claude_skills")
      .select("content")
      .eq("user_id", userId)
      .eq("skill_name", skillName)
      .maybeSingle();
    const c = (data as { content?: string } | null)?.content?.trim();
    return c && c.length > 0 ? c : "";
  } catch (e) {
    console.warn(`[claude-skills] fetch ${skillName} failed:`, e);
    return "";
  }
}

/**
 * Load all relevant skill files for a task and return them concatenated as
 * a single markdown block, ready to prepend to a system prompt.
 *
 * Returns an empty string when the user has no matching skill rows — caller
 * should treat that as "no skills configured".
 */
export async function loadSkillsForTask(
  userId: string | null | undefined,
  taskType: SkillTaskType,
  supplierName?: string | null,
): Promise<string> {
  if (!userId) return "";

  const tasks: string[] = [
    BASE_SKILL,
    taskType,
  ];
  if (supplierName) {
    tasks.push(`supplier-${supplierName.toLowerCase().trim().replace(/\s+/g, "-")}`);
  }

  const parts = await Promise.all(tasks.map(t => fetchOne(userId, t)));
  const joined = parts.filter(p => p && p.length > 0).join("\n\n---\n\n");

  if (joined.length > 0) {
    console.log(
      `[claude-skills] loaded for task=${taskType} supplier=${supplierName || "-"} (${joined.length} chars)`,
    );
  }
  return joined;
}

/**
 * Wrap a skills block with explicit instructions so the model treats it as
 * authoritative. Safe to call with an empty string (returns "").
 */
export function asSkillsPreamble(skillsMarkdown: string, label = "this task"): string {
  if (!skillsMarkdown || !skillsMarkdown.trim()) return "";
  return `Before completing ${label}, READ AND APPLY the following merchant-curated skill files. They override your defaults.

--- BEGIN CLAUDE SKILLS ---
${skillsMarkdown.trim()}
--- END CLAUDE SKILLS ---

`;
}
