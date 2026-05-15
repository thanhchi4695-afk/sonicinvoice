import { useEffect, useRef, useState } from "react";
import LandingNavigation from "@/components/LandingNavigation";
import FooterSection from "@/sections/FooterSection";
import RouteSeo from "@/components/RouteSeo";

type TabId = "import" | "automate" | "rank" | "ai-agents";

const TABS: { id: TabId; label: string; src: string; caption: string }[] = [
  {
    id: "import",
    label: "Import",
    src: "/how-it-works/import.html",
    caption: "How a supplier invoice becomes live Shopify products in minutes.",
  },
  {
    id: "automate",
    label: "Automate",
    src: "/how-it-works/automate.html",
    caption: "Six background systems that quietly run your store every day.",
  },
  {
    id: "rank",
    label: "Rank",
    src: "/how-it-works/rank.html",
    caption: "7-layer SEO tagging that gets your collections ranking on Google.",
  },
  {
    id: "ai-agents",
    label: "AI Agents",
    src: "/how-it-works/ai-agents.html",
    caption: "Brand Intelligence, SEO Audit, and Gap Finder — your three AI specialists.",
  },
];

const STAGE = 800;

export default function HowItWorks() {
  const [active, setActive] = useState<TabId>("import");
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Scale the fixed 800x800 stage down on narrow viewports while keeping aspect ratio.
  useEffect(() => {
    function recalc() {
      const w = wrapRef.current?.clientWidth ?? STAGE;
      setScale(Math.min(1, w / STAGE));
    }
    recalc();
    window.addEventListener("resize", recalc);
    return () => window.removeEventListener("resize", recalc);
  }, []);

  const current = TABS.find((t) => t.id === active)!;

  return (
    <div className="bg-[#0a0a0a] min-h-screen text-[#fafafa]">
      <RouteSeo
        title="How It Works — Sonic Invoices"
        description="Watch how Sonic Invoices imports supplier invoices, automates your store, ranks collections on Google, and runs three AI agents."
        path="/how-it-works"
      />
      <LandingNavigation />

      <section className="pt-28 pb-20 px-6">
        <div className="max-w-[1100px] mx-auto">
          <div className="text-center mb-10">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#737373]">
              HOW IT WORKS
            </span>
            <h1 className="font-serif text-[clamp(32px,4.5vw,52px)] leading-[1.05] tracking-[-0.03em] mt-4">
              Four short videos. The whole product.
            </h1>
            <p className="text-base text-[#a3a3a3] max-w-[600px] mx-auto mt-5">
              Each clip is under 90 seconds. Watch in any order.
            </p>
          </div>

          {/* Tabs */}
          <div
            role="tablist"
            aria-label="How it works sections"
            className="flex flex-wrap items-center justify-center gap-2 mb-8"
          >
            {TABS.map((t) => {
              const isActive = t.id === active;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`panel-${t.id}`}
                  onClick={() => setActive(t.id)}
                  className={
                    "px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 border " +
                    (isActive
                      ? "bg-lime text-[#0a0a0a] border-transparent"
                      : "bg-white/[0.03] text-[#a3a3a3] border-white/[0.08] hover:text-[#fafafa] hover:bg-white/[0.06]")
                  }
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Stage wrapper — scales the fixed 800x800 iframe down on mobile */}
          <div
            ref={wrapRef}
            className="mx-auto"
            style={{ width: "100%", maxWidth: STAGE }}
          >
            <div
              id={`panel-${current.id}`}
              role="tabpanel"
              aria-label={current.label}
              style={{
                width: "100%",
                height: STAGE * scale,
                position: "relative",
              }}
            >
              <div
                style={{
                  width: STAGE,
                  height: STAGE,
                  transform: `scale(${scale})`,
                  transformOrigin: "top left",
                }}
              >
                <iframe
                  // key forces a fresh mount on tab switch → autoplays from act 1, old video stops
                  key={current.id}
                  src={current.src}
                  title={`${current.label} — Sonic Invoices`}
                  width={STAGE}
                  height={STAGE}
                  style={{
                    border: "none",
                    borderRadius: 12,
                    display: "block",
                    background: "#0a0a0a",
                  }}
                  allow="autoplay"
                />
              </div>
            </div>
          </div>

          <p className="text-center text-sm text-[#737373] mt-6">{current.caption}</p>
        </div>
      </section>

      <FooterSection />
    </div>
  );
}
