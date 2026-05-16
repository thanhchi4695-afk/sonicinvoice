import { useEffect, useRef } from "react";

type Props = {
  /** Optional eyebrow / heading override (used on /how-it-works). */
  variant?: "home" | "how-it-works";
  /** Optional pipeline key to deep-link into (e.g. "season_close"). */
  pipeline?: string;
};

const PIPELINE_HASH_MAP: Record<string, string> = {
  "new-arrivals": "new_arrivals",
  restock: "restock",
  "season-close": "season_close",
  seo: "seo",
  "seo-boost": "seo",
  marketing: "marketing",
  catalog: "catalog",
};

export default function GuidedWorkflowsSection({ variant = "home", pipeline }: Props) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Responsive scale
  useEffect(() => {
    const scaleWorkflow = () => {
      const wrapper = wrapperRef.current;
      const iframe = iframeRef.current;
      if (!wrapper || !iframe) return;
      const scale = Math.min(wrapper.offsetWidth / 1100, 1);
      wrapper.style.height = 900 * scale + "px";
      iframe.style.setProperty("--wf-scale", String(scale));
      iframe.style.transform = `scale(${scale})`;
    };
    scaleWorkflow();
    window.addEventListener("resize", scaleWorkflow);
    return () => window.removeEventListener("resize", scaleWorkflow);
  }, []);

  // Lazy load + deep-link on iframe load
  useEffect(() => {
    const iframe = iframeRef.current;
    const wrapper = wrapperRef.current;
    if (!iframe || !wrapper) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !iframe.src) {
            iframe.src = iframe.dataset.src || "";
          }
        });
      },
      { rootMargin: "100px" }
    );
    observer.observe(wrapper);

    const onLoad = () => {
      const hash = window.location.hash.replace(/^#/, "");
      const target = pipeline ?? PIPELINE_HASH_MAP[hash];
      if (target && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ pipeline: target }, "*");
      }
    };
    iframe.addEventListener("load", onLoad);

    return () => {
      observer.disconnect();
      iframe.removeEventListener("load", onLoad);
    };
  }, [pipeline]);

  const eyebrow = variant === "how-it-works" ? "INTERACTIVE DEMO" : "GUIDED WORKFLOWS";
  const heading =
    variant === "how-it-works"
      ? "Try Sonic's 6 guided workflows — step by step"
      : "Select a workflow. Watch it run.";
  const body =
    variant === "how-it-works"
      ? "Select a scenario below. Each workflow walks through every step Sonic takes — from invoice to live products, social posts, and ranked collections."
      : "Pick a scenario and see every step Sonic takes — in real time.";

  return (
    <section className="bg-[#0a0a0a]" style={{ padding: "80px 24px" }}>
      <div className="max-w-[1100px] mx-auto">
        <div
          className="font-mono uppercase text-lime"
          style={{ fontSize: 11, letterSpacing: "0.07em" }}
        >
          {eyebrow}
        </div>
        <h2
          className="text-[#f0f0f0]"
          style={{
            fontSize: variant === "how-it-works" ? 20 : 28,
            fontWeight: 500,
            letterSpacing: "-0.02em",
            marginTop: 8,
          }}
        >
          {heading}
        </h2>
        <p className="text-[#737373]" style={{ fontSize: variant === "how-it-works" ? 13 : 15, marginTop: 8, marginBottom: 32 }}>
          {body}
        </p>

        <div
          ref={wrapperRef}
          className="workflow-embed-wrapper"
          style={{
            width: "100%",
            maxWidth: 1100,
            margin: "0 auto",
            position: "relative",
            borderRadius: 16,
            overflow: "hidden",
            border: "1px solid #242424",
          }}
        >
          <iframe
            ref={iframeRef}
            title="Sonic Guided Workflows"
            data-src="/workflows/sonic-flows-animation.html"
            style={{
              width: 1100,
              height: 900,
              border: "none",
              transformOrigin: "top left",
              display: "block",
            }}
          />
        </div>
      </div>
    </section>
  );
}
