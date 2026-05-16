import { useState, useEffect, useCallback, useRef } from "react";
import LandingNavigation from "@/components/LandingNavigation";
import FooterSection from "@/sections/FooterSection";
import RouteSeo from "@/components/RouteSeo";
import VideoCard from "@/components/VideoCard";
import VideoModal from "@/components/VideoModal";

type Video = { src: string; title: string; caption: string; slug: string };

const CORE: Video[] = [
  {
    src: "/videos/sonic_complete_flow.html",
    title: "Complete Journey",
    caption: "The full Sonic story — invoice to Google #1 in 14 minutes",
    slug: "complete-journey",
  },
  {
    src: "/videos/sonic_import_invoice.html",
    title: "Import Invoice",
    caption: "How 3 supplier invoices become 83 Shopify products in 14 minutes — automatically",
    slug: "import-invoice",
  },
  {
    src: "/videos/sonic_tagging_flow.html",
    title: "7-Layer Tagging",
    caption: "How every product gets 7 layers of tags — brand, type, colour, size, feature, season, occasion",
    slug: "7-layer-tagging",
  },
];

const DEEP: Video[] = [
  {
    src: "/videos/sonic_email_inbox.html",
    title: "Email Inbox",
    caption: "Forward a supplier invoice. Sonic processes it in 34 seconds.",
    slug: "email-inbox",
  },
  {
    src: "/videos/sonic_scan_mode.html",
    title: "Scan Mode",
    caption: "200 items. Barcode scanner. 26 minutes. No laptop required.",
    slug: "scan-mode",
  },
  {
    src: "/videos/sonic_wholesale_imports.html",
    title: "Wholesale Imports",
    caption: "JOOR size matrices, PDF line sheets, lookbook PDFs — one review queue",
    slug: "wholesale-imports",
  },
  {
    src: "/videos/sonic_enrichment_publishing.html",
    title: "Enrichment + Publishing",
    caption: "From SKU code to SEO title, 140-word description, brand image, and Shopify push",
    slug: "enrichment-publishing",
  },
  {
    src: "/videos/sonic_ai_agents_watchdog.html",
    title: "Watchdog + Learning",
    caption: "The AI that blocks bad prices and gets smarter with every invoice",
    slug: "watchdog-learning",
  },
  {
    src: "/videos/sonic_automations_flow.html",
    title: "Silent Automations",
    caption: "6 systems running at 2 AM — nightly scan, season switch, SEO updater, Klaviyo trigger",
    slug: "silent-automations",
  },
  {
    src: "/videos/sonic_rank_flow.html",
    title: "Sonic Rank",
    caption: "From invisible on Google to collection SEO score 92/100 — automatically",
    slug: "sonic-rank",
  },
  {
    src: "/videos/sonic_agents_flow.html",
    title: "The 3 AI Agents",
    caption: "Brand Intelligence, SEO Audit, and Competitor Gap running every night while you sleep",
    slug: "ai-agents",
  },
  {
    src: "/videos/sonic-video-2-automate.html",
    title: "Automate (classic)",
    caption: "The original automations overview — Darwin-aware season switching and Klaviyo",
    slug: "automate",
  },
  {
    src: "/videos/sonic-video-3-rank.html",
    title: "Rank System (classic)",
    caption: "The tagging and SEO scoring system — original explainer",
    slug: "rank-system",
  },
  {
    src: "/videos/sonic-video-4-ai-agents.html",
    title: "AI Agents (classic)",
    caption: "The original AI agents overview — Brand Intel, SEO Audit, Gap Finder",
    slug: "ai-agents-original",
  },
];

const TECH: Video[] = [
  {
    src: "/videos/sonic_mcp_flow.html",
    title: "MCP Connector",
    caption: "One MCP server — ask Claude or Kimi anything about your live Shopify store",
    slug: "mcp-connector",
  },
  {
    src: "/videos/sonic_connection_map.html",
    title: "Connection Map",
    caption: "Every Sonic feature connected — interactive particle node diagram",
    slug: "connection-map",
  },
  {
    src: "/videos/sonic_import_flow.html",
    title: "Import Pipeline",
    caption: "Inside the AI parsing pipeline — from PDF to 40 extracted products",
    slug: "import-flow",
  },
  {
    src: "/videos/sonic-video-4-ai-agents.html",
    title: "AI Agents Tech",
    caption: "Technical deep dive — MCP architecture, Claude integration, AskSonicAI",
    slug: "ai-agents-tech",
  },
];

const ALL: Video[] = [...CORE, ...DEEP, ...TECH];

// Old hash aliases → new slug
const HASH_ALIASES: Record<string, string> = {
  "import-engine": "import-invoice",
};

const SECTIONS: { id: string; label: string; count: number; videos: Video[] }[] = [
  { id: "core", label: "CORE STORY", count: CORE.length, videos: CORE },
  { id: "deep", label: "DEEP DIVES", count: DEEP.length, videos: DEEP },
  { id: "technical", label: "TECHNICAL", count: TECH.length, videos: TECH },
];

function SectionLabel({ children, count }: { children: string; count: number }) {
  return (
    <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-lime mb-5">
      {children} · {count} videos
    </div>
  );
}

export default function HowItWorks() {
  const [open, setOpen] = useState<{ src: string; title: string } | null>(null);
  const scrollHandled = useRef(false);

  const onOpen = useCallback((src: string, title: string, slug?: string) => {
    setOpen({ src, title });
    if (slug) {
      window.location.hash = slug;
    }
  }, []);

  const onClose = useCallback(() => {
    setOpen(null);
    // eslint-disable-next-line no-restricted-globals
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, "");
    if (!raw || scrollHandled.current) return;
    scrollHandled.current = true;

    const hash = HASH_ALIASES[raw] ?? raw;

    const video = ALL.find((v) => v.slug === hash);
    if (video) {
      setOpen({ src: video.src, title: video.title });
      setTimeout(() => {
        const el = document.getElementById(`video-${video.slug}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
      return;
    }

    const section = SECTIONS.find((s) => s.id === hash);
    if (section) {
      setTimeout(() => {
        const el = document.getElementById(`section-${section.id}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }, []);

  return (
    <div className="bg-[#0a0a0a] min-h-screen text-[#f5f5f5]">
      <RouteSeo
        title="How It Works — Sonic Invoices"
        description="18 animated explainers — see how Sonic Invoices imports invoices, tags products, syncs Shopify, ranks on Google, and runs its AI agents."
        path="/how-it-works"
      />
      <LandingNavigation />

      <section className="pt-28 pb-16 px-6">
        <div className="max-w-[1200px] mx-auto text-center">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#737373]">
            ⚡ SONIC INVOICES
          </span>
          <h1
            className="mt-4"
            style={{
              fontFamily: "Georgia, 'Times New Roman', serif",
              fontSize: "clamp(32px, 4.5vw, 52px)",
              letterSpacing: "-0.03em",
              lineHeight: 1.05,
            }}
          >
            18 ways Sonic works for your store
          </h1>
          <p className="text-base text-[#a3a3a3] max-w-[600px] mx-auto mt-5">
            Animated explainers for every feature — click any to watch.
          </p>
        </div>
      </section>

      <section className="px-6 pb-24">
        <div className="max-w-[1200px] mx-auto space-y-20">
          {/* Core Story */}
          <div id="section-core">
            <SectionLabel count={CORE.length}>CORE STORY</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {CORE.map((v) => (
                <div key={v.src} id={`video-${v.slug}`}>
                  <VideoCard {...v} onOpen={(src, title) => onOpen(src, title, v.slug)} />
                </div>
              ))}
            </div>
          </div>

          {/* Deep Dives */}
          <div id="section-deep">
            <SectionLabel count={DEEP.length}>DEEP DIVES</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {DEEP.map((v) => (
                <div key={v.src} id={`video-${v.slug}`}>
                  <VideoCard {...v} onOpen={(src, title) => onOpen(src, title, v.slug)} />
                </div>
              ))}
            </div>
          </div>

          {/* Technical */}
          <div id="section-technical">
            <SectionLabel count={TECH.length}>TECHNICAL</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {TECH.map((v) => (
                <div key={v.src} id={`video-${v.slug}`}>
                  <VideoCard {...v} onOpen={(src, title) => onOpen(src, title, v.slug)} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <VideoModal src={open?.src ?? null} title={open?.title ?? ""} onClose={onClose} />

      <FooterSection />
    </div>
  );
}
