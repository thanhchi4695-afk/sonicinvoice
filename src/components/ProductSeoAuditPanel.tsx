import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ClipboardCheck, CheckCircle2, XCircle, AlertTriangle, MinusCircle, Sparkles } from "lucide-react";

interface RuleResult {
  id: string;
  label: string;
  threshold: string;
  status: "pass" | "fail" | "warn" | "skipped";
  detail: string;
}
interface AuditResult {
  score: number;
  summary: { pass: number; fail: number; warn: number; skipped: number };
  rules: RuleResult[];
  input_used: {
    title_length: number;
    meta_length: number;
    body_words: number;
    faq_count: number;
    primary_keyword: string;
  };
}

interface Props {
  defaultCity?: string;
  defaultStoreName?: string;
}

const SAMPLE = {
  title: "Vegan Leather Bags Darwin | Stomp Shoes",
  meta:
    "Shop vegan leather bags in Darwin at Stomp Shoes. Cruelty-free crossbody, tote and backpack styles built for real life. Free Australian shipping over $100.",
  body:
    "<p>Vegan leather bags in Darwin from Stomp Shoes — cruelty-free crossbody, tote and backpack styles built for real life. Whether you're heading from the school run to dinner or chasing dry-season markets, our edit pairs everyday function with the kind of finish you'd happily wear on a Friday night.</p><p>We stock the colours that actually go with a Darwin wardrobe — black, tan, sand, soft pink — in shapes you can sling on with one hand. Most styles fit a 14\" laptop or a swimsuit, towel and sunscreen, with adjustable straps so the same bag works at the office and at the beach.</p>",
  faqJson: JSON.stringify(
    [
      { q: "Are these bags really vegan?", a: "Yes — every bag in this edit is made from PU or recycled vegan leather, with no animal-derived linings, glues or trims. We check each shipment so what you see in the listing is what arrives at your door in Darwin." },
      { q: "Will vegan leather hold up in Darwin's wet season?", a: "Vegan leather actually outperforms real leather in humidity — it doesn't mould, swell or stiffen the way animal hide does. Wipe down with a damp cloth after a downpour and your bag stays looking sharp from build-up to dry season." },
      { q: "Do you ship vegan leather bags Australia-wide?", a: "Yes — we ship from our Darwin store to every postcode in Australia, with free shipping on orders over $100. Most metro orders land in two to four business days, and we include tracking on every parcel so you can plan around it." },
      { q: "Can I return a bag if the colour isn't right?", a: "Absolutely — you've got 30 days from delivery to return any unworn bag for a refund or exchange. Vegan leather can read slightly different in person, so we keep the policy generous and the process simple." },
    ],
    null,
    2,
  ),
};

export default function ProductSeoAuditPanel({ defaultCity = "Darwin", defaultStoreName = "Stomp Shoes Darwin" }: Props) {
  const { toast } = useToast();
  const [title, setTitle] = useState(SAMPLE.title);
  const [meta, setMeta] = useState(SAMPLE.meta);
  const [body, setBody] = useState(SAMPLE.body);
  const [faqJson, setFaqJson] = useState(SAMPLE.faqJson);
  const [primaryKeyword, setPrimaryKeyword] = useState("vegan leather bags");
  const [city, setCity] = useState(defaultCity);
  const [storeName, setStoreName] = useState(defaultStoreName);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AuditResult | null>(null);

  async function runAudit() {
    setRunning(true);
    setResult(null);
    try {
      let faq: any[] = [];
      try { faq = JSON.parse(faqJson); } catch { faq = []; }
      const { data, error } = await supabase.functions.invoke("product-seo-audit", {
        body: {
          title,
          meta_description: meta,
          body_html: body,
          faq,
          primary_keyword: primaryKeyword,
          city,
          store_name: storeName,
        },
      });
      if (error) throw error;
      setResult(data as AuditResult);
      const r = data as AuditResult;
      toast({
        title: `Audit score ${r.score}%`,
        description: `${r.summary.pass} pass · ${r.summary.fail} fail · ${r.summary.warn} warn`,
      });
    } catch (e: any) {
      toast({ title: "Audit failed", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  }

  function loadSample() {
    setTitle(SAMPLE.title);
    setMeta(SAMPLE.meta);
    setBody(SAMPLE.body);
    setFaqJson(SAMPLE.faqJson);
    setPrimaryKeyword("vegan leather bags");
  }

  function clearAll() {
    setTitle(""); setMeta(""); setBody(""); setFaqJson("[]"); setPrimaryKeyword("");
    setResult(null);
  }

  const statusIcon = (s: RuleResult["status"]) => {
    if (s === "pass") return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
    if (s === "fail") return <XCircle className="w-4 h-4 text-destructive" />;
    if (s === "warn") return <AlertTriangle className="w-4 h-4 text-amber-500" />;
    return <MinusCircle className="w-4 h-4 text-muted-foreground" />;
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-primary" />
          <h2 className="text-base font-semibold">Product SEO audit</h2>
          <Badge variant="outline" className="text-[10px]">
            Same rules as engine retry
          </Badge>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={loadSample}>Load sample</Button>
          <Button size="sm" variant="ghost" onClick={clearAll}>Clear</Button>
          <Button size="sm" onClick={runAudit} disabled={running}>
            {running ? "Auditing…" : <><Sparkles className="w-3 h-3 mr-1" />Run audit</>}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Inputs */}
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Input value={primaryKeyword} onChange={(e) => setPrimaryKeyword(e.target.value)} placeholder="Primary keyword" />
            <div className="grid grid-cols-2 gap-2">
              <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" />
              <Input value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="Store" />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">SEO title ({title.length}/60)</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Meta description ({meta.length}/150–160)</label>
            <Textarea value={meta} onChange={(e) => setMeta(e.target.value)} rows={2} />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Body HTML</label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} className="font-mono text-xs" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">FAQ JSON [{`{q,a}`}]</label>
            <Textarea value={faqJson} onChange={(e) => setFaqJson(e.target.value)} rows={6} className="font-mono text-xs" />
          </div>
        </div>

        {/* Results */}
        <div className="space-y-2">
          {!result && (
            <div className="border border-dashed border-border rounded-lg p-8 text-center text-sm text-muted-foreground">
              Run the audit to see per-rule pass/fail using the engine's own thresholds:
              <div className="mt-2 text-[11px]">
                title ≤60 · meta 150–160 · body ≥200w · FAQ 30–80w · no banned phrases · keyword in first 12 words
              </div>
            </div>
          )}
          {result && (
            <>
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/40">
                <div>
                  <div className="text-3xl font-bold">{result.score}<span className="text-base text-muted-foreground">%</span></div>
                  <div className="text-[11px] text-muted-foreground">
                    {result.summary.pass} pass · {result.summary.fail} fail · {result.summary.warn} warn · {result.summary.skipped} skipped
                  </div>
                </div>
                <div className="text-right text-[11px] text-muted-foreground space-y-0.5">
                  <div>Title: {result.input_used.title_length} chars</div>
                  <div>Meta: {result.input_used.meta_length} chars</div>
                  <div>Body: {result.input_used.body_words} words</div>
                  <div>FAQ: {result.input_used.faq_count} items</div>
                </div>
              </div>
              <div className="space-y-1">
                {result.rules.map((r) => (
                  <div key={r.id} className="flex items-start gap-2 p-2 rounded border border-border/40 bg-card">
                    {statusIcon(r.status)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">{r.label}</span>
                        <span className="text-[10px] text-muted-foreground">{r.threshold}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">{r.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
