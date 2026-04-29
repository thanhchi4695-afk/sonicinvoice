// CRUD hook for margin_rules. RLS guarantees user-scoping.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { DraftRule, MarginRule } from "./types";
import { ruleSchema } from "./rule-schema";

export function useMarginRules() {
  const [rules, setRules] = useState<MarginRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("margin_rules")
      .select("*")
      .order("priority", { ascending: true })
      .order("created_at", { ascending: true });
    if (err) {
      setError(err.message);
      setRules([]);
    } else {
      setRules((data as unknown as MarginRule[]) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveRule = useCallback(
    async (draft: DraftRule): Promise<{ ok: true; rule: MarginRule } | { ok: false; error: string }> => {
      const parsed = ruleSchema.safeParse({
        name: draft.name,
        is_active: draft.is_active,
        conditions: draft.conditions,
        actions: draft.actions,
        priority: draft.priority,
      });
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        return { ok: false, error: first?.message ?? "Validation failed" };
      }

      const { data: userResp } = await supabase.auth.getUser();
      const userId = userResp.user?.id;
      if (!userId) return { ok: false, error: "Not signed in" };

      if (draft.id) {
        const { data, error: err } = await supabase
          .from("margin_rules")
          .update({
            name: parsed.data.name,
            is_active: parsed.data.is_active,
            conditions: parsed.data.conditions as unknown as never,
            actions: parsed.data.actions as unknown as never,
            priority: parsed.data.priority,
          })
          .eq("id", draft.id)
          .select()
          .maybeSingle();
        if (err || !data) return { ok: false, error: err?.message ?? "Update failed" };
        await refresh();
        return { ok: true, rule: data as unknown as MarginRule };
      }

      const { data, error: err } = await supabase
        .from("margin_rules")
        .insert({
          user_id: userId,
          name: parsed.data.name,
          is_active: parsed.data.is_active,
          conditions: parsed.data.conditions as unknown as never,
          actions: parsed.data.actions as unknown as never,
          priority: parsed.data.priority,
        })
        .select()
        .maybeSingle();
      if (err || !data) return { ok: false, error: err?.message ?? "Create failed" };
      await refresh();
      return { ok: true, rule: data as unknown as MarginRule };
    },
    [refresh],
  );

  const deleteRule = useCallback(
    async (id: string) => {
      const { error: err } = await supabase.from("margin_rules").delete().eq("id", id);
      if (err) return { ok: false as const, error: err.message };
      await refresh();
      return { ok: true as const };
    },
    [refresh],
  );

  const toggleActive = useCallback(
    async (id: string, is_active: boolean) => {
      const { error: err } = await supabase.from("margin_rules").update({ is_active }).eq("id", id);
      if (err) return { ok: false as const, error: err.message };
      await refresh();
      return { ok: true as const };
    },
    [refresh],
  );

  const reorder = useCallback(
    async (orderedIds: string[]) => {
      // Rewrite priorities in a single batch (sequential updates; small lists).
      for (let i = 0; i < orderedIds.length; i++) {
        const { error: err } = await supabase
          .from("margin_rules")
          .update({ priority: i })
          .eq("id", orderedIds[i]);
        if (err) return { ok: false as const, error: err.message };
      }
      await refresh();
      return { ok: true as const };
    },
    [refresh],
  );

  return { rules, loading, error, refresh, saveRule, deleteRule, toggleActive, reorder };
}
