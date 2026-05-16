import { useEffect, useState } from "react";
import GuidedWorkflowsSection from "@/sections/GuidedWorkflowsSection";
import RouteSeo from "@/components/RouteSeo";

const QUERY_TO_PIPELINE: Record<string, string> = {
  new_arrivals: "new_arrivals",
  restock: "restock",
  season_close: "season_close",
  seo: "seo",
  marketing: "marketing",
  catalog: "catalog",
};

const HASH_TO_PIPELINE: Record<string, string> = {
  "new-arrivals": "new_arrivals",
  restock: "restock",
  "season-close": "season_close",
  seo: "seo",
  marketing: "marketing",
  catalog: "catalog",
};

export default function Workflows() {
  const [pipeline, setPipeline] = useState<string | undefined>();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("pipeline");
    if (q && QUERY_TO_PIPELINE[q]) {
      setPipeline(QUERY_TO_PIPELINE[q]);
      return;
    }
    const hash = window.location.hash.replace(/^#/, "");
    if (hash && HASH_TO_PIPELINE[hash]) setPipeline(HASH_TO_PIPELINE[hash]);
  }, []);

  return (
    <div className="bg-[#0a0a0a] min-h-screen">
      <RouteSeo
        title="Sonic Invoices — Guided Workflows"
        description="6 guided workflows. Every step Sonic runs — in real time. From invoice to live Shopify products, social posts, and ranked collections."
        path="/workflows"
      />

      <header
        className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06] backdrop-blur-2xl bg-[#0a0a0a]/60"
      >
        <div className="max-w-[1200px] mx-auto px-6 md:px-12 flex items-center justify-between h-16">
          <a href="/" className="flex items-center gap-2">
            <span className="text-lime text-lg">⚡</span>
            <span className="font-sans text-lg font-semibold text-[#fafafa]">Sonic Invoices</span>
          </a>
          <a
            href="/signup"
            className="text-sm font-medium bg-lime text-[#0a0a0a] px-4 py-2 rounded-full hover:brightness-110 transition-all"
          >
            Book a free demo →
          </a>
        </div>
      </header>

      <section className="pt-28 pb-6 px-6 text-center">
        <h1 className="text-[#f0f0f0]" style={{ fontSize: 36, letterSpacing: "-0.02em", fontWeight: 500 }}>
          See exactly how Sonic works
        </h1>
        <p className="text-[#737373]" style={{ fontSize: 16, marginTop: 8 }}>
          6 guided workflows. Every step. In real time.
        </p>
      </section>

      <GuidedWorkflowsSection variant="home" pipeline={pipeline} />

      <footer className="py-10 text-center text-[#404040]" style={{ fontSize: 12 }}>
        sonicinvoices.com · Darwin, NT, Australia
      </footer>
    </div>
  );
}
