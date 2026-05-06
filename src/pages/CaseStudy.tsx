import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
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
            What 6 months of invoices looks like.
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
            A Darwin swimwear retailer, 180+ brands, 3,800+ SKUs.
          </p>
        </div>
      </header>

      <section className="container mx-auto max-w-4xl px-6 py-12">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            { k: "180+", v: "Distinct brands parsed" },
            { k: "3,800+", v: "SKUs imported to Shopify" },
            { k: "94%", v: "Avg parse accuracy after 6 months" },
          ].map((s) => (
            <Card key={s.k} className="p-6 text-center">
              <div className="font-[Syne] text-4xl font-bold text-primary">{s.k}</div>
              <div className="mt-2 text-sm text-muted-foreground">{s.v}</div>
            </Card>
          ))}
        </div>

        {/* Before vs After */}
        <div className="mt-14 grid gap-6 md:grid-cols-2">
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6">
            <h3 className="font-[Syne] text-xl font-semibold text-destructive">❌ Before</h3>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li>• Supplier emails invoices as PDF</li>
              <li>• 2–4 hours manually re-keying products into Shopify</li>
              <li>• Typos and wrong variants go live</li>
              <li>• Every new brand starts from scratch</li>
            </ul>
          </div>
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-6">
            <h3 className="font-[Syne] text-xl font-semibold text-primary">✅ After</h3>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li>• Invoice forwarded or uploaded in seconds</li>
              <li>• Shopify-ready CSV generated in under 3 minutes</li>
              <li>• Brand patterns learned and reused automatically</li>
              <li>• 180+ brands recognised with no re-training</li>
            </ul>
          </div>
        </div>

        {/* Timeline */}
        <div className="mt-14">
          <h2 className="font-[Syne] text-2xl font-semibold">How it works</h2>
          <ol className="mt-6 grid gap-6 md:grid-cols-4 md:gap-0 relative">
            {[
              { t: "Invoice arrives", d: "Supplier emails a PDF." },
              { t: "Upload or forward", d: "Dropped into Sonic or forwarded via email." },
              { t: "AI parses + learns", d: "Products extracted, brand pattern saved." },
              { t: "Import to Shopify", d: "Download CSV, import done." },
            ].map((s, i, arr) => (
              <li key={s.t} className="relative flex flex-col items-center text-center md:px-3">
                {i < arr.length - 1 && (
                  <span className="hidden md:block absolute top-5 left-1/2 w-full h-px bg-primary/30" aria-hidden />
                )}
                <span className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground font-[Syne] font-semibold">
                  {i + 1}
                </span>
                <div className="mt-3 font-[Syne] font-semibold">{s.t}</div>
                <div className="mt-1 text-xs text-muted-foreground max-w-[180px]">{s.d}</div>
              </li>
            ))}
          </ol>
        </div>

        {/* Sample output */}
        <div className="mt-14">
          <h2 className="font-[Syne] text-2xl font-semibold">What the output looks like</h2>
          <p className="mt-2 text-sm text-muted-foreground">Sample Shopify CSV output</p>
          <div className="mt-4 overflow-x-auto rounded-lg border border-border">
            <table className="w-full font-[IBM_Plex_Mono] text-xs">
              <thead className="bg-muted/40 text-left">
                <tr>
                  {["Handle","Title","Brand","Colour","Size","Price","Compare At","Tags"].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                {[
                  ["seafolly-long-sleeve-zip-rash","Seafolly Long Sleeve Zip Rash","Seafolly","Navy","10","109.95","139.95","womens, swimwear, rash-vests"],
                  ["seafolly-long-sleeve-zip-rash","Seafolly Long Sleeve Zip Rash","Seafolly","Black","12","109.95","139.95","womens, swimwear, rash-vests"],
                  ["jets-jetset-plunge-onepiece","Jets Jetset Plunge One Piece","Jets","Sand","8","159.00","189.00","womens, swimwear, one-piece"],
                  ["bondi-born-margot-bikini-top","Bondi Born Margot Bikini Top","Bondi Born","Ivory","S","145.00","","womens, swimwear, bikini-top"],
                  ["baku-cancun-boardshort","Baku Cancun Board Short","Baku","Coral","M","79.95","99.95","mens, swimwear, boardshorts"],
                ].map((row, i) => (
                  <tr key={i} className="border-t border-border">
                    {row.map((c, j) => (
                      <td key={j} className="px-3 py-2 whitespace-nowrap">{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* FAQ */}
        <div className="mt-14">
          <h2 className="font-[Syne] text-2xl font-semibold">FAQ</h2>
          <Accordion type="single" collapsible className="mt-4">
            {[
              { q: "What invoice formats does Sonic accept?", a: "PDF, Excel, CSV, photo, and email forward." },
              { q: "Does it work for any brand?", a: "Yes — and it gets more accurate the more invoices you process for that brand." },
              { q: "Do I need to train it manually?", a: "No. Corrections you make are automatically saved and applied next time." },
              { q: "Is my invoice data private?", a: "Yes. Your brand patterns are private to your account." },
            ].map((f, i) => (
              <AccordionItem key={i} value={`item-${i}`}>
                <AccordionTrigger className="text-left font-[Syne]">{f.q}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">{f.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>

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
