import { useEffect, useRef } from "react";

const STAGE = 800;

/**
 * Full-width dark section with the Connection Map canvas as background.
 * Controls are hidden via injected CSS (same-origin iframe).
 * Loops by reloading the iframe every 16s.
 */
export default function ConnectionMapHero() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    function injectHideCss() {
      try {
        const doc = iframe!.contentDocument;
        if (!doc) return;
        const style = doc.createElement("style");
        style.textContent = `
          #controls { display: none !important; }
          #progress-wrap { display: none !important; }
          body { background: transparent !important; }
          #stage { box-shadow: none !important; border-radius: 0 !important; }
        `;
        doc.head.appendChild(style);
      } catch {
        /* cross-origin no-op */
      }
    }

    iframe.addEventListener("load", injectHideCss);
    const loop = setInterval(() => {
      // eslint-disable-next-line no-self-assign
      iframe.src = iframe.src;
    }, 16000);
    return () => {
      iframe.removeEventListener("load", injectHideCss);
      clearInterval(loop);
    };
  }, []);

  // The canvas is fixed 800x800 — we cover the section by scaling it up to fill width.
  return (
    <section
      ref={wrapRef}
      className="relative w-full overflow-hidden bg-[#0a0a0a]"
      style={{ height: 520 }}
    >
      <div className="absolute inset-0 hidden md:flex items-center justify-center">
        <iframe
          ref={iframeRef}
          src="/videos/sonic_connection_map.html"
          title="Sonic Invoices — Connection Map"
          width={STAGE}
          height={STAGE}
          style={{
            border: "none",
            width: STAGE,
            height: STAGE,
            transform: "scale(1.1)",
            background: "transparent",
          }}
          aria-hidden="true"
          tabIndex={-1}
        />
      </div>
      {/* Mobile: smaller scaled wrapper */}
      <div className="absolute inset-0 md:hidden flex items-center justify-center" style={{ overflow: "hidden" }}>
        <div style={{ width: STAGE, height: STAGE, transform: "scale(0.5)", transformOrigin: "center" }}>
          <iframe
            src="/videos/sonic_connection_map.html"
            title=""
            width={STAGE}
            height={STAGE}
            style={{ border: "none", background: "transparent" }}
            aria-hidden="true"
            tabIndex={-1}
          />
        </div>
      </div>

      {/* Vignette + tagline overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(10,10,10,0) 30%, rgba(10,10,10,0.85) 100%)",
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center px-6">
        <div
          className="relative px-6 py-3 rounded-md"
          style={{ background: "rgba(0,0,0,0.45)" }}
        >
          <p
            className="text-center text-[#f5f5f5]"
            style={{
              fontFamily: "Georgia, 'Times New Roman', serif",
              fontSize: "clamp(20px, 3vw, 32px)",
              letterSpacing: "-0.01em",
            }}
          >
            Every invoice. Every product. Automatically.
          </p>
        </div>
      </div>
    </section>
  );
}
