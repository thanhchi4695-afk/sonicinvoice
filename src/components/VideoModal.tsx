import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

interface Props {
  src: string | null;
  title: string;
  onClose: () => void;
}

const STAGE = 800;

export default function VideoModal({ src, title, onClose }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
  }, [src]);

  useEffect(() => {
    if (!src) return;
    function recalc() {
      const maxW = Math.min(window.innerWidth - 32, STAGE);
      const maxH = Math.min(window.innerHeight - 32, STAGE);
      setScale(Math.min(maxW, maxH) / STAGE);
    }
    recalc();
    window.addEventListener("resize", recalc);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("resize", recalc);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [src, onClose]);

  if (!src) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.92)" }}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute top-4 right-4 text-[#f5f5f5] hover:text-lime transition-colors p-2 z-10"
      >
        <X size={24} />
      </button>

      <div
        ref={wrapRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: STAGE * scale,
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
            src={src}
            title={title}
            width={STAGE}
            height={STAGE}
            allow="autoplay"
            onLoad={() => setTimeout(() => setReady(true), 300)}
            style={{
              border: "none",
              borderRadius: 12,
              display: "block",
              background: "#0a0a0a",
            }}
          />
        </div>
        {!ready && (
          <div
            aria-hidden="true"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-[#0a0a0a]"
          >
            <div className="relative h-10 w-10">
              <div className="absolute inset-0 rounded-full border-2 border-[#262626]" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-lime animate-spin" />
            </div>
            <span className="font-mono text-[11px] uppercase tracking-wider text-[#737373]">
              Loading animation
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
