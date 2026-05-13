import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface Plan {
  id: string;
  suggestion_id: string;
  blog_index: number;
  title: string;
  target_keywords: string[];
  sections: any;
  faq: any;
  status: "plan" | "approved" | "generated";
  generated_html: string | null;
}

export default function SeoBlogPlans() {
  const { toast } = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { void load(); }, []);

  async function load() {
    const { data } = await supabase
      .from("collection_blog_plans")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    setPlans((data ?? []) as Plan[]);
  }

  async function approve(p: Plan) {
    setBusy(p.id);
    await supabase.from("collection_blog_plans").update({ status: "approved" }).eq("id", p.id);
    setBusy(null);
    await load();
    toast({ title: "Approved", description: "Ready to generate the full post." });
  }

  async function generate(p: Plan) {
    setBusy(p.id);
    const { data, error } = await supabase.functions.invoke("seo-blog-writer", {
      body: { plan_id: p.id },
    });
    setBusy(null);
    if (error || (data as any)?.error) {
      toast({
        title: "Generation failed",
        description: (data as any)?.error || error?.message || "Unknown error",
        variant: "destructive",
      });
      return;
    }
    await load();
    toast({ title: "Post generated", description: `${(data as any)?.length ?? 0} chars of HTML.` });
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header>
          <h1 className="text-2xl font-bold">Blog Plans</h1>
          <p className="text-sm text-muted-foreground">
            Each collection produces 1–3 blog plans plus a 6-question FAQ. Approve a plan to queue it for full-post generation.
          </p>
        </header>

        {plans.length === 0 && <Card className="p-6 text-muted-foreground">No plans yet — generate SEO for a collection first.</Card>}

        {plans.map((p) => (
          <Card key={p.id} className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant={p.status === "generated" ? "default" : p.status === "approved" ? "secondary" : "outline"}>
                    {p.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">#{p.blog_index}</span>
                </div>
                <h3 className="font-semibold">{p.title}</h3>
                <div className="text-xs text-muted-foreground mt-1">
                  Keywords: {(p.target_keywords ?? []).join(", ") || "—"}
                </div>
                {Array.isArray(p.faq) && p.faq.length > 0 && (
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer">FAQ ({p.faq.length})</summary>
                    <ul className="list-disc pl-5 mt-1 space-y-1">
                      {p.faq.map((f: any, i: number) => <li key={i}><strong>Q:</strong> {f.q}</li>)}
                    </ul>
                  </details>
                )}
              </div>
              <div className="flex flex-col gap-2">
                {p.status === "plan" && (
                  <Button size="sm" disabled={busy === p.id} onClick={() => approve(p)}>Approve</Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
