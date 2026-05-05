import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

const setMeta = (name: string, content: string) => {
  let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
};

interface Props {
  source?: string;
  compact?: boolean;
}

export default function WaitlistForm({ source = "case-study", compact = false }: Props) {
  const [email, setEmail] = useState("");
  const [storeName, setStoreName] = useState("");
  const [storeUrl, setStoreUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    document.title = "Sonic Invoices — Boutique Retailer Case Study & Waitlist";
    setMeta(
      "description",
      "How a boutique fashion retailer cut invoice-to-Shopify time by 95% with Sonic Invoices. Join the waitlist."
    );
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setSubmitting(true);
    const { error } = await supabase.from("retailer_waitlist" as any).insert({
      email: email.trim().toLowerCase(),
      store_name: storeName || null,
      store_url: storeUrl || null,
      source,
    });
    setSubmitting(false);
    if (error) {
      if (error.code === "23505") {
        setDone(true);
        toast.success("You're already on the list.");
      } else {
        toast.error("Could not join waitlist. Try again.");
      }
      return;
    }
    setDone(true);
    toast.success("You're on the waitlist!");
  };

  if (done) {
    return (
      <Card className="p-6 text-center">
        <p className="font-[Syne] text-xl">⚡ You're in.</p>
        <p className="mt-2 text-sm text-muted-foreground">We'll be in touch shortly.</p>
      </Card>
    );
  }

  return (
    <form onSubmit={submit} className={compact ? "flex gap-2" : "space-y-3"}>
      <Input
        type="email"
        required
        placeholder="you@yourstore.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        aria-label="Email"
      />
      {!compact && (
        <>
          <Input
            placeholder="Store name (optional)"
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            aria-label="Store name"
          />
          <Input
            placeholder="Store URL (optional)"
            value={storeUrl}
            onChange={(e) => setStoreUrl(e.target.value)}
            aria-label="Store URL"
          />
        </>
      )}
      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Joining…" : "Join the waitlist"}
      </Button>
    </form>
  );
}

export function CaseStudyPage() {
  useEffect(() => {
    document.title = "Case Study: 95% Faster Invoice → Shopify | Sonic Invoices";
    setMeta(
      "description",
      "Real results from a boutique fashion retailer using Sonic Invoices: AI parsing, brand intelligence flywheel, one-click Shopify import."
    );
    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = `${window.location.origin}/case-study`;
  }, []);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "Boutique retailer cuts invoice-to-Shopify time by 95%",
    author: { "@type": "Organization", name: "Sonic Invoices" },
    datePublished: "2026-05-05",
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header className="border-b border-border">
        <div className="container mx-auto max-w-4xl px-6 py-10">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← Sonic Invoices
          </Link>
          <h1 className="mt-4 font-[Syne] text-4xl font-bold tracking-tight md:text-5xl">
            From supplier email to Shopify in under 3 minutes
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
            How a Sydney boutique replaced 4 hours of manual invoice keying per drop with an
            agentic pipeline that gets smarter every week.
          </p>
        </div>
      </header>

      <section className="container mx-auto max-w-4xl px-6 py-12">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            { k: "95%", v: "Less time per invoice" },
            { k: "12+", v: "Variants/style auto-grouped" },
            { k: "94%", v: "Brand parse accuracy" },
          ].map((s) => (
            <Card key={s.k} className="p-6 text-center">
              <div className="font-[Syne] text-4xl font-bold text-primary">{s.k}</div>
              <div className="mt-2 text-sm text-muted-foreground">{s.v}</div>
            </Card>
          ))}
        </div>

        <article className="prose prose-invert mt-12 max-w-none">
          <h2 className="font-[Syne] text-2xl font-semibold">The pipeline</h2>
          <p className="text-muted-foreground">
            Gmail intake → cron scan → supplier auto-learn → confidence badge → Smart Bulk
            auto-fire → attachment fetch → Gemini 2.5 Flash document parse → Claude Sonnet 4.5
            brand intelligence → Perplexity AU RRP enrichment → buyer review → one-click Shopify
            import with proper variant grouping.
          </p>

          <h2 className="font-[Syne] text-2xl font-semibold">The flywheel</h2>
          <p className="text-muted-foreground">
            Every correction trains the brand pattern. SKU formats, size schemas and price bands
            are stored per brand and re-injected on the next parse. Accuracy rises with every
            invoice — see the <Link to="/brand-guide" className="text-primary underline">live brand directory</Link>.
          </p>
        </article>

        <div className="mt-14 rounded-xl border border-border bg-muted/20 p-8">
          <h3 className="font-[Syne] text-2xl font-semibold">Join the retailer waitlist</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Boutique fashion retailers only. Early access + onboarding support.
          </p>
          <div className="mt-6 max-w-md">
            <WaitlistForm source="case-study" />
          </div>
        </div>
      </section>
    </main>
  );
}
