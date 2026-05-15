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
          AI parsing · 7-layer tagging · Shopify sync · SEO content · Google ranking
        </p>
      </div>
    </section>
  );
}
