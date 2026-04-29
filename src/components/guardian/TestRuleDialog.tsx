import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import type { DraftRule } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: DraftRule;
}

interface DecisionResponse {
  allowed: boolean;
  ruleId?: string;
  ruleName?: string;
  message?: string;
  actions?: { type: string; params?: Record<string, unknown> }[];
  marginData?: Record<string, number | null>;
  poTotal?: number;
  error?: string;
}

type TestResult =
  | { state: "idle" }
  | { state: "running" }
  | { state: "done"; decision: DecisionResponse }
  | { state: "error"; message: string };

// Matches CartItem in supabase/functions/margin-guardian/index.ts
const PLACEHOLDER_JSON = `{
  "surface": "joor",
  "items": [
    {
      "sku": "SW123",
      "quantity": 5,
      "unitListPrice": 45.00,
      "landedCost": 28.00,
      "brand": "SunnySwim"
    }
  ]
}`;

export function TestRuleDialog({ open, onOpenChange }: Props) {
  const [orderRef, setOrderRef] = useState("");
  const [cartJson, setCartJson] = useState("");
  const [result, setResult] = useState<TestResult>({ state: "idle" });

  const runTest = async () => {
    setResult({ state: "running" });
    try {
      let cart: { items?: unknown[]; surface?: string } | null = null;
      if (cartJson.trim()) {
        try {
          cart = JSON.parse(cartJson);
        } catch {
          setResult({ state: "error", message: "Cart JSON is not valid." });
          return;
        }
      }

      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) {
        setResult({ state: "error", message: "You must be signed in to test rules." });
        return;
      }

      // Server evaluates the SAVED rules with dryRun=true (no log write, no Slack/email).
      // userId is derived from the JWT — never trust a client-supplied value.
      const { data, error } = await supabase.functions.invoke("margin-guardian", {
        body: {
          cartItems: Array.isArray(cart?.items) ? cart!.items : [],
          surface: cart?.surface ?? "test",
          dryRun: true,
        },
      });

      if (error) {
        setResult({ state: "error", message: error.message });
        return;
      }

      setResult({ state: "done", decision: (data as DecisionResponse) ?? { allowed: true } });
    } catch (err) {
      setResult({ state: "error", message: err instanceof Error ? err.message : "Test failed" });
    }
  };

  const decision = result.state === "done" ? result.decision : null;
  const fired = !!decision?.ruleId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Test rule</DialogTitle>
          <DialogDescription>
            Dry-run against your saved rules. Never sends Slack, email, or writes to the decision log.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="order-ref">JOOR / NuOrder reference (optional)</Label>
            <Input
              id="order-ref"
              value={orderRef}
              onChange={(e) => setOrderRef(e.target.value)}
              placeholder="JOOR-12345"
            />
          </div>
          <div>
            <Label htmlFor="cart-json">Cart JSON</Label>
            <Textarea
              id="cart-json"
              value={cartJson}
              onChange={(e) => setCartJson(e.target.value)}
              placeholder={PLACEHOLDER_JSON}
              rows={9}
              className="font-mono text-xs"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Items need <code>sku</code>, <code>quantity</code>, <code>unitListPrice</code>. Add{" "}
              <code>landedCost</code> to override the cost lookup.
            </p>
          </div>

          {decision && (
            <div
              className={`rounded-md border p-3 text-sm ${
                fired
                  ? decision.allowed
                    ? "border-warning/40 bg-warning/10"
                    : "border-destructive/40 bg-destructive/10"
                  : "border-primary/40 bg-primary/10"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {fired ? `Rule matched: ${decision.ruleName}` : "No rule matched"}
                </span>
                <Badge variant={decision.allowed ? "secondary" : "destructive"}>
                  {decision.allowed ? "Allowed" : "Blocked"}
                </Badge>
              </div>
              {decision.message && (
                <p className="mt-2 text-foreground/80">{decision.message}</p>
              )}
              {decision.actions && decision.actions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {decision.actions.map((a, i) => (
                    <Badge key={i} variant="outline" className="text-[10px]">
                      {a.type}
                    </Badge>
                  ))}
                </div>
              )}
              {decision.marginData && Object.keys(decision.marginData).length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    Per-SKU margins {decision.poTotal !== undefined && `· PO total ${decision.poTotal.toFixed(2)}`}
                  </summary>
                  <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 font-mono text-[11px]">
{Object.entries(decision.marginData)
  .map(([sku, m]) => `${sku.padEnd(16)} ${m === null ? "—" : `${m.toFixed(1)}%`}`)
  .join("\n")}
                  </pre>
                </details>
              )}
              {decision.error && (
                <p className="mt-2 text-xs text-destructive">Error: {decision.error}</p>
              )}
            </div>
          )}
          {result.state === "error" && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {result.message}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={runTest} disabled={result.state === "running"}>
            {result.state === "running" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Run test
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
