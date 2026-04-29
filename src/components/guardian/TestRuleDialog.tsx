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
import { supabase } from "@/integrations/supabase/client";
import type { DraftRule } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: DraftRule;
}

type TestResult =
  | { state: "idle" }
  | { state: "running" }
  | { state: "done"; would_fire: boolean; narrative: string }
  | { state: "error"; message: string };

export function TestRuleDialog({ open, onOpenChange, rule }: Props) {
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
      const { data, error } = await supabase.functions.invoke("margin-guardian", {
        body: {
          userId: auth.user.id,
          cartItems: Array.isArray(cart?.items) ? cart!.items : [],
          surface: cart?.surface ?? "test",
          dryRun: true,
        },
      });

      if (error) {
        setResult({ state: "error", message: error.message });
        return;
      }

      const wouldFire = !!data?.ruleId;
      const narrative = data?.message ??
        (wouldFire ? "A rule would fire on the supplied cart." : "No rule would fire on the supplied cart.");
      setResult({ state: "done", would_fire: wouldFire, narrative });
    } catch (err) {
      setResult({ state: "error", message: err instanceof Error ? err.message : "Test failed" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Test rule</DialogTitle>
          <DialogDescription>
            Dry-run only — never sends Slack, email, or writes to the decision log.
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
            <Label htmlFor="cart-json">Or paste cart JSON</Label>
            <Textarea
              id="cart-json"
              value={cartJson}
              onChange={(e) => setCartJson(e.target.value)}
              placeholder='{"items":[{"brand":"Brand X","margin_pct":38}],"po_total":5200}'
              rows={6}
              className="font-mono text-xs"
            />
          </div>

          {result.state === "done" && (
            <div
              className={`rounded-md border p-3 text-sm ${
                result.would_fire
                  ? "border-warning/40 bg-warning/10 text-warning-foreground"
                  : "border-primary/40 bg-primary/10 text-foreground"
              }`}
            >
              {result.narrative}
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
            {result.state === "running" && <Loader2 className="h-4 w-4 animate-spin" />}
            Run test
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
