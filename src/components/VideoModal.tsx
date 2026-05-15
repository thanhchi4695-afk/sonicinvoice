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
  );
}
