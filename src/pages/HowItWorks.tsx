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
    src: "/videos/sonic-video-1-import.html",
    title: "The Import Engine",
    caption: "How an invoice becomes 47 Shopify products in 15 minutes",
    slug: "import-engine",
  },
];

const DEEP: Video[] = [
  {
    src: "/videos/sonic_tagging_flow.html",
    title: "7-Layer Tagging",
    caption: "How every product gets tagged — brand, type, colour, size, feature, season, occasion",
    slug: "7-layer-tagging",
  },
  {
    src: "/videos/sonic_automations_flow.html",
    title: "Silent Automations",
    caption: "6 systems running at 2 AM while you sleep",
    slug: "silent-automations",
  },
  {
    src: "/videos/sonic_rank_flow.html",
    title: "Sonic Rank",
    caption: "From invisible to Google #1 for your product keywords",
    slug: "sonic-rank",
  },
  {
    src: "/videos/sonic_agents_flow.html",
    title: "The 3 AI Agents",
    caption: "Brand Intel · SEO Audit · Competitor Gap — running every night",
    slug: "ai-agents",
  },
  {
    src: "/videos/sonic-video-3-rank.html",
    title: "The Rank System",
    caption: "The SEO tagging engine and scoring system explained",
    slug: "rank-system",
  },
  {
    src: "/videos/sonic-video-2-automate.html",
    title: "Automate",
    caption: "Darwin-aware season switching, link mesh rebuild, Klaviyo triggers",
    slug: "automate",
  },
  {
    src: "/videos/sonic-video-4-ai-agents.html",
    title: "AI Agents",
    caption: "Brand Intelligence · SEO Audit · Gap Finder agents",
    slug: "ai-agents-original",
  },
];

const TECH: Video[] = [
  {
    src: "/videos/sonic_mcp_flow.html",
    title: "MCP Connector",
    caption: "One MCP server — ask Claude or Kimi anything about your live store",
    slug: "mcp-connector",
  },
  {
    src: "/videos/sonic_import_flow.html",
    title: "Import Flow",
    caption: "Inside the AI parsing pipeline — from PDF to 40 extracted products",
    slug: "import-flow",
  },
  {
    src: "/videos/sonic_connection_map.html",
    title: "Connection Map",
    caption: "How every Sonic feature connects — interactive node diagram",
    slug: "connection-map",
  },
];

const ALL: Video[] = [...CORE, ...DEEP, ...TECH];

const SECTIONS: { id: string; label: string; videos: Video[] }[] = [
  { id: "core", label: "CORE STORY", videos: CORE },
  { id: "deep", label: "DEEP DIVES", videos: DEEP },
  { id: "technical", label: "TECHNICAL", videos: TECH },
];

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-lime mb-5">
      {children}
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

  // On mount: handle hash → scroll to card or open modal
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash || scrollHandled.current) return;
    scrollHandled.current = true;

    const video = ALL.find((v) => v.slug === hash);
    if (video) {
      // Open modal for this video
      setOpen({ src: video.src, title: video.title });
      // Also scroll its card into view after a short delay
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
        description="12 animated explainers — see how Sonic Invoices imports invoices, tags products, syncs Shopify, ranks on Google, and runs 3 AI agents."
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
            12 ways Sonic works for your store
          </h1>
          <p className="text-base text-[#a3a3a3] max-w-[600px] mx-auto mt-5">
            Animated explainers — click any to explore.
          </p>
        </div>
      </section>

      <section className="px-6 pb-24">
        <div className="max-w-[1200px] mx-auto space-y-20">
          {/* Core Story */}
          <div id="section-core">
            <SectionLabel>CORE STORY</SectionLabel>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {CORE.map((v) => (
                <div key={v.src} id={`video-${v.slug}`}>
                  <VideoCard {...v} onOpen={(src, title) => onOpen(src, title, v.slug)} />
                </div>
              ))}
            </div>
          </div>

          {/* Deep Dives */}
          <div id="section-deep">
            <SectionLabel>DEEP DIVES</SectionLabel>
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
            <SectionLabel>TECHNICAL</SectionLabel>
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
