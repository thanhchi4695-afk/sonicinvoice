// Validates a draft rule and exposes errors keyed by editor-tree paths so
// inline messages can be rendered next to the offending input.
//
// Path conventions used by the UI:
//   "name"                          — rule name
//   "actions"                       — actions array (e.g. "must add at least one action")
//   "action:<i>"                    — generic error on action #i (e.g. type mismatch)
//   "action:<i>:channel"            — slack channel input on action #i
//   "action:<i>:email"              — email input on action #i
//   "action:<i>:target_margin"      — price-correction target margin input
//   "conditions"                    — the whole conditions tree (top-level)
//   "cond:<idxTrail>"               — generic error on a condition leaf at the given path
//   "cond:<idxTrail>:value"         — value cell of a condition leaf
//   "cond:<idxTrail>:operator"      — operator cell of a condition leaf
//   "group:<idxTrail>"              — error on a nested group (e.g. empty children)
//
// `idxTrail` is a dot-joined chain of child indices from the root group,
// e.g. "0", "0.2", "1.0.3". The root group itself is "" (empty trail).

import { useMemo } from "react";
import { z } from "zod";
import { ruleSchema } from "./rule-schema";
import {
  isGroup,
  isGroupField,
  type ConditionGroup,
  type DraftRule,
  type RuleAction,
} from "./types";

export interface RuleErrorMap {
  isValid: boolean;
  /** All issues, in zod order. Useful for a top-of-form summary. */
  issues: z.ZodIssue[];
  /** Look up the first error message bound to a given path (see header). */
  errorAt: (path: string) => string | undefined;
  /** Convenience: true if any error exists under the given prefix. */
  hasErrorUnder: (prefix: string) => boolean;
}

/**
 * Translate a zod issue path (which addresses the *persisted* shape) into one
 * of the UI path keys above. We always validate the persisted shape (legacy
 * array OR root-group object) so the result matches what gets saved, but the
 * editor always works in the root-group shape — so we map both forms back to
 * a unified leaf trail.
 */
function zodPathToUiKey(
  issuePath: (string | number)[],
  persisted: DraftRule,
  rootGroup: ConditionGroup,
): string | null {
  if (issuePath.length === 0) return null;
  const head = issuePath[0];

  // ── name / priority / top-level actions array
  if (head === "name") return "name";
  if (head === "priority") return "priority";

  if (head === "actions") {
    if (issuePath.length === 1) return "actions";
    const i = issuePath[1] as number;
    // actions.<i>.params.<key> → action:<i>:<key>
    if (issuePath[2] === "params" && typeof issuePath[3] === "string") {
      return `action:${i}:${issuePath[3]}`;
    }
    // Custom refinements without a deeper path land on actions.<i>.
    return `action:${i}`;
  }

  // ── conditions: two possible shapes ──
  if (head === "conditions") {
    // Flat-array shape: conditions.<i>(.value)
    if (Array.isArray(persisted.conditions)) {
      if (issuePath.length === 1) return "conditions";
      const idx = issuePath[1] as number;
      // The editor wraps these in the root group, so the leaf trail is just "<idx>".
      const trail = String(idx);
      const tail = issuePath[2];
      if (tail === "value") return `cond:${trail}:value`;
      if (tail === "operator") return `cond:${trail}:operator`;
      return `cond:${trail}`;
    }

    // Group shape: walk down "children.<n>.children.<m>..." until we hit a leaf field.
    const trail: number[] = [];
    let node: any = persisted.conditions;
    let i = 1;
    while (i < issuePath.length) {
      const seg = issuePath[i];
      if (seg === "children" && typeof issuePath[i + 1] === "number") {
        const childIdx = issuePath[i + 1] as number;
        trail.push(childIdx);
        node = node?.children?.[childIdx];
        i += 2;
      } else {
        break;
      }
    }

    const trailStr = trail.join(".");
    if (i >= issuePath.length) {
      // Issue is on the group itself (empty children, depth, etc.).
      return trail.length === 0 ? "conditions" : `group:${trailStr}`;
    }

    // Remaining segments address a leaf-condition field (value / operator).
    const tail = issuePath[i];
    if (node && !isGroup(node)) {
      if (tail === "value") return `cond:${trailStr}:value`;
      if (tail === "operator") return `cond:${trailStr}:operator`;
    }
    return trail.length === 0 ? "conditions" : `cond:${trailStr}`;
  }

  return null;
}

export function useRuleValidation(
  persisted: DraftRule,
  rootGroup: ConditionGroup,
): RuleErrorMap {
  return useMemo(() => {
    const result = ruleSchema.safeParse(persisted);
    if (result.success) {
      return {
        isValid: true,
        issues: [],
        errorAt: () => undefined,
        hasErrorUnder: () => false,
      };
    }

    const map = new Map<string, string>();
    for (const issue of result.error.issues) {
      const key = zodPathToUiKey(issue.path, persisted, rootGroup);
      if (!key) continue;
      // First issue wins per key — that's what we render inline.
      if (!map.has(key)) map.set(key, issue.message);
    }

    return {
      isValid: false,
      issues: result.error.issues,
      errorAt: (p: string) => map.get(p),
      hasErrorUnder: (prefix: string) => {
        for (const k of map.keys()) {
          if (k === prefix || k.startsWith(prefix + ":") || k.startsWith(prefix + ".")) {
            return true;
          }
        }
        return false;
      },
    };
  }, [persisted, rootGroup]);
}

/** True when the persisted conditions are stored as a single root group. */
export function persistedIsGroup(d: DraftRule) {
  return isGroupField(d.conditions);
}
