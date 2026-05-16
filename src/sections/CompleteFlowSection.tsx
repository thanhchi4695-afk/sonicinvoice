import { useEffect, useRef, useState } from "react";

const STAGE = 800;

export default function CompleteFlowSection() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    function recalc() {
      const w = wrapRef.current?.clientWidth ?? STAGE;
      setScale(Math.min(1, w / STAGE));
    }
    recalc();
    window.addEventListener("resize", recalc);
    return () => window.removeEventListener("resize", recalc);
  }, []);

  return (
    <section className="bg-[#0a0a0a] py-20 px-6">
      <div className="max-w-[900px] mx-auto text-center">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#737373]">
          THE FULL FLOW
        </span>
        <h2
          className="mt-4 text-[#f5f5f5]"
          style={{
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontSize: "clamp(24px, 3.5vw, 32px)",
            letterSpacing: "-0.02em",
            lineHeight: 1.15,
          }}
        >
          From invoice to Google #1 — in 14 minutes
        </h2>

        <div
          ref={wrapRef}
          className="mx-auto mt-10"
          style={{ width: "100%", maxWidth: STAGE }}
        >
          <div style={{ width: "100%", height: STAGE * scale, position: "relative" }}>
            <div
              style={{
                width: STAGE,
                height: STAGE,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            >
              <iframe
                src="/videos/sonic_complete_flow.html"
                title="Sonic Invoices — Complete Flow"
                width={STAGE}
                height={STAGE}
                allow="autoplay"
                style={{
                  border: "none",
                  borderRadius: 12,
                  display: "block",
                  background: "#0a0a0a",
                }}
              />
            </div>
          </div>
        </div>

        <p className="text-sm text-[#737373] mt-6">
          AI parsing · 7-layer tagging · Shopify sync · SEO content · Google ranking · 32 features covered
        </p>

        {/* NEW IN OPERATIONS — Batch 2 highlight row */}
        <div className="mt-12 text-left">
          <div className="font-mono text-[10px] uppercase tracking-[0.07em] text-lime mb-3">
            NEW IN OPERATIONS
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { icon: "📋", headline: "PO in 90 seconds", body: "From reorder decision to sent purchase order. Shopify syncs on receive.", hash: "purchase-orders" },
              { icon: "📡", headline: "Never stock out again", body: "AI restock recommendations + alerts before you hit zero.", hash: "restock-monitor" },
              { icon: "🛡️", headline: "$12,400 margin protected", body: "Blocks below-margin orders on JOOR. Slack approval in 47 seconds.", hash: "margin-guardian" },
              { icon: "📉", headline: "34 units cleared automatically", body: "Progressive markdown pricing. Old stock gone before new stock arrives.", hash: "markdown-pricing" },
            ].map((c) => (
              <a
                key={c.hash}
                href={`/how-it-works#${c.hash}`}
                className="block rounded-xl p-4 bg-[#141414] border border-[#242424] hover:border-lime transition-colors duration-200 no-underline"
              >
                <div className="text-lime text-[20px] leading-none mb-2">{c.icon}</div>
                <div className="text-[13px] font-semibold text-[#f5f5f5]">{c.headline}</div>
                <div className="text-[12px] text-[#737373] mt-1 leading-relaxed">{c.body}</div>
              </a>
            ))}
          </div>
        </div>

        {/* GROWTH TOOLS — Batch 3 highlight row */}
        <div className="mt-6 text-left">
          <div className="font-mono text-[10px] uppercase tracking-[0.07em] text-lime mb-3">
            GROWTH TOOLS
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { icon: "🔎", headline: "From page 3 to page 1", body: "AI writes every collection title, meta, description, and FAQ. Automatically.", hash: "seo-tools" },
              { icon: "📣", headline: "2.8x real ROAS", body: "Margin-aware bidding. No vanity metrics. Spend that actually pays.", hash: "ads-setup" },
              { icon: "✅", headline: "234 disapprovals → 0", body: "AI fixes every gender, age_group, and colour error. One click.", hash: "google-feed" },
              { icon: "👁️", headline: "See everything they charge", body: "Real-time competitor prices. One-click match. Gap collections in seconds.", hash: "competitor-tools" },
            ].map((c) => (
              <a
                key={c.hash}
                href={`/how-it-works#${c.hash}`}
                className="block rounded-xl p-4 bg-[#141414] border border-[#242424] hover:border-lime transition-colors duration-200 no-underline"
              >
                <div className="text-lime text-[20px] leading-none mb-2">{c.icon}</div>
                <div className="text-[13px] font-semibold text-[#f5f5f5]">{c.headline}</div>
                <div className="text-[12px] text-[#737373] mt-1 leading-relaxed">{c.body}</div>
              </a>
            ))}
          </div>
        </div>

        <div className="mt-6">
          <a
            href="/how-it-works"
            className="text-[13px] text-[#737373] no-underline hover:underline underline-offset-4"
          >
            View all 32 explainer videos →
          </a>
        </div>
      </div>
    </section>
  );
}
