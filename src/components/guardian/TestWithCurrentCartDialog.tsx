// "Test with current cart" — runs the unsaved draft rule against the live cart
// observed by the Chrome extension on the user's active JOOR / NuOrder tab.
//
// Flow:
//   1. Ask the extension for the current cart (ext bridge → background → content script).
//   2. POST to margin-guardian with { draftRule, cartItems, dryRun: true }.
//      The endpoint evaluates ONLY this rule and skips decision-log + Slack.
//   3. Render Yes/No + the actions that would have fired.

import { useEffect, useState } from "react";
import { Loader2, ExternalLink, AlertCircle, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { fetchCurrentCart, type CartItem, type GetCartResult } from "@/lib/extension-bridge";
import { ACTION_LABELS, type DraftRule, type RuleAction } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The unsaved/in-progress rule from the editor. */
  rule: DraftRule;
}

interface DecisionResponse {
  allowed: boolean;
  ruleId?: string;
  ruleName?: string;
  message?: string;
  actions?: RuleAction[];
  marginData?: Record<string, number | null>;
  poTotal?: number;
  error?: string;
}

type State =
  | { kind: "idle" }
  | { kind: "fetching_cart" }
  | { kind: "evaluating"; cart: { items: CartItem[]; surface: string; url?: string } }
  | { kind: "no_cart"; result: GetCartResult }
  | {
      kind: "done";
      decision: DecisionResponse;
      cart: { items: CartItem[]; surface: string; url?: string };
    }
  | { kind: "error"; message: string };

type NoCartResult = Extract<GetCartResult, { ok: false }>;

function describeNoCart(result: NoCartResult): { title: string; body: string } {
  switch (result.reason) {
    case "not_installed":
      return {
        title: "Chrome extension not detected",
        body:
          "Install the Sonic Margin Guardian extension and reload the dashboard, then try again.",
      };
    case "no_cart_tab":
      return {
        title: "Open a JOOR cart to test live",
        body:
          "Open a JOOR or NuOrder cart in another tab so the extension can read the current line items.",
      };
    case "empty_cart":
      return {
        title: "Cart is empty",
        body: "The cart on your JOOR / NuOrder tab has no line items yet.",
      };
    case "content_script_unavailable":
      return {
        title: "Couldn't read the cart page",
        body:
          "The extension is installed but can't reach the cart page. Refresh the JOOR / NuOrder tab and try again.",
      };
    case "timeout":
      return {
        title: "Extension didn't respond",
        body: "The extension took too long to answer. Refresh and try again.",
      };
    default:
      return {
        title: "Couldn't fetch the cart",
        body: result.error ?? "Unknown error from the extension.",
      };
  }
}

export function TestWithCurrentCartDialog({ open, onOpenChange, rule }: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });

  // Reset whenever the dialog re-opens — stale results from a previous run
  // shouldn't be shown against a freshly-edited rule.
  useEffect(() => {
    if (open) setState({ kind: "idle" });
  }, [open]);

  const run = async () => {
    setState({ kind: "fetching_cart" });
    const cartResult = await fetchCurrentCart();
    if (!cartResult.ok) {
      setState({ kind: "no_cart", result: cartResult });
      return;
    }
    const cart = { items: cartResult.items, surface: cartResult.surface, url: cartResult.url };
    setState({ kind: "evaluating", cart });

    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) {
        setState({ kind: "error", message: "You must be signed in to test rules." });
        return;
      }

      const { data, error } = await supabase.functions.invoke("margin-guardian", {
        body: {
          cartItems: cart.items,
          surface: cart.surface,
          dryRun: true,
          draftRule: {
            name: rule.name || "Draft rule",
            conditions: rule.conditions,
            actions: rule.actions,
          },
        },
      });

      if (error) {
        setState({ kind: "error", message: error.message });
        return;
      }
      const decision = (data as DecisionResponse) ?? { allowed: true };
      setState({ kind: "done", decision, cart });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : "Test failed" });
    }
  };

  const decision = state.kind === "done" ? state.decision : null;
  const triggered = !!decision?.ruleId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Test with current cart</DialogTitle>
          <DialogDescription>
            Dry-run this rule against the live JOOR / NuOrder cart in your browser. Nothing is
            saved or sent to Slack.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {state.kind === "idle" && (
            <p className="text-sm text-muted-foreground">
              Click <strong>Run test</strong> to fetch the current cart from the active JOOR or
              NuOrder tab and check whether this rule would have triggered.
            </p>
          )}

          {(state.kind === "fetching_cart" || state.kind === "evaluating") && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              {state.kind === "fetching_cart"
                ? "Reading cart from the active tab…"
                : `Evaluating ${state.cart.items.length} line item${state.cart.items.length === 1 ? "" : "s"}…`}
            </div>
          )}

          {state.kind === "no_cart" && (() => {
            const { title, body } = describeNoCart(state.result);
            return (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 text-warning" />
                  <div>
                    <p className="font-medium">{title}</p>
                    <p className="mt-1 text-foreground/80">{body}</p>
                  </div>
                </div>
              </div>
            );
          })()}

          {state.kind === "error" && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {state.message}
            </div>
          )}

          {decision && state.kind === "done" && (
            <>
              <div
                className={`rounded-md border p-3 text-sm ${
                  triggered
                    ? decision.allowed
                      ? "border-warning/40 bg-warning/10"
                      : "border-destructive/40 bg-destructive/10"
                    : "border-primary/40 bg-primary/10"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium flex items-center gap-2">
                    {triggered ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-warning" />
                        This rule would have triggered: Yes
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                        This rule would have triggered: No
                      </>
                    )}
                  </span>
                  {triggered && (
                    <Badge variant={decision.allowed ? "secondary" : "destructive"}>
                      {decision.allowed ? "Allowed" : "Blocked"}
                    </Badge>
                  )}
                </div>

                {triggered ? (
                  <>
                    {decision.message && (
                      <p className="mt-2 text-foreground/80">{decision.message}</p>
                    )}
                    {decision.actions && decision.actions.length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs font-medium text-muted-foreground mb-1">
                          Actions that would have been taken:
                        </p>
                        <ul className="space-y-1">
                          {decision.actions.map((a, i) => (
                            <li key={i} className="flex items-center gap-2 text-xs">
                              <Badge variant="outline">{ACTION_LABELS[a.type] ?? a.type}</Badge>
                              {a.type === "slack_approval" && a.params?.channel && (
                                <span className="text-muted-foreground">
                                  to <code>{a.params.channel}</code>
                                </span>
                              )}
                              {a.type === "email_notify" && a.params?.email && (
                                <span className="text-muted-foreground">
                                  to <code>{a.params.email}</code>
                                </span>
                              )}
                              {a.type === "price_correction" &&
                                a.params?.target_margin !== undefined && (
                                  <span className="text-muted-foreground">
                                    target {String(a.params.target_margin)}%
                                  </span>
                                )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="mt-2 text-foreground/80">
                    No conditions matched your cart. Try changing values.
                  </p>
                )}
              </div>

              <div className="rounded-md border border-border bg-muted/30 p-2 text-[11px] text-muted-foreground flex items-center gap-2">
                <ExternalLink className="h-3 w-3" />
                <span>
                  Cart from <strong>{state.cart.surface}</strong> · {state.cart.items.length} item
                  {state.cart.items.length === 1 ? "" : "s"}
                  {decision.poTotal !== undefined && (
                    <> · PO total {decision.poTotal.toFixed(2)}</>
                  )}
                </span>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            onClick={run}
            disabled={state.kind === "fetching_cart" || state.kind === "evaluating"}
          >
            {(state.kind === "fetching_cart" || state.kind === "evaluating") && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {state.kind === "done" || state.kind === "no_cart" || state.kind === "error"
              ? "Run again"
              : "Run test"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
