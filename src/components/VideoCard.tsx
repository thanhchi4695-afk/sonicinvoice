import { useEffect, useRef, useState } from "react";

interface Props {
  src: string;
  title: string;
  caption: string;
  onOpen: (src: string, title: string) => void;
}

const STAGE = 800;

export default function VideoCard({ src, title, caption, onOpen }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(0.4);
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    function recalc() {
      const w = wrapRef.current?.clientWidth ?? STAGE;
      setScale(w / STAGE);
    }
    recalc();
    const ro = new ResizeObserver(recalc);
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener("resize", recalc);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recalc);
    };
  }, []);

  // Lazy-load iframe when card scrolls near viewport
  useEffect(() => {
    if (loaded || !wrapRef.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setLoaded(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px" }
    );
    io.observe(wrapRef.current);
    return () => io.disconnect();
  }, [loaded]);

  return (
    <button
      type="button"
      onClick={() => onOpen(src, title)}
      className="group text-left rounded-xl overflow-hidden border border-[#262626] bg-[#141414] hover:border-lime transition-colors duration-200 flex flex-col"
    >
      <div
        ref={wrapRef}
        className="relative w-full"
        style={{ aspectRatio: "1 / 1", overflow: "hidden" }}
      >
        {loaded && (
          <iframe
            ref={iframeRef}
            src={src}
            title={title}
            width={STAGE}
            height={STAGE}
            onLoad={() => setTimeout(() => setReady(true), 300)}
            style={{
              border: "none",
              width: STAGE,
              height: STAGE,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              pointerEvents: "none",
              background: "#0a0a0a",
            }}
            tabIndex={-1}
          />
        )}
        {!ready && (
          <div
            aria-hidden="true"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0a0a0a]"
          >
            <div className="relative h-8 w-8">
              <div className="absolute inset-0 rounded-full border-2 border-[#262626]" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-lime animate-spin" />
            </div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-[#525252]">
              Loading
            </span>
          </div>
        )}
      </div>
      <div className="p-4 border-t border-[#262626]">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold text-[#f5f5f5]">{title}</h3>
          <span className="font-mono text-[11px] text-lime shrink-0 group-hover:translate-x-0.5 transition-transform">
            ▶ Play
          </span>
        </div>
        <p className="text-xs text-[#737373] mt-1 leading-relaxed">{caption}</p>
      </div>
    </button>
  );
}
