import { cn } from "@/lib/utils";
import { ringClasses, fillColor, gapHint } from "@/lib/seo-score";

interface SeoScoreBadgeProps {
  score: number;
  breakdown?: unknown;
  size?: "sm" | "md";
  showHint?: boolean;
  showBar?: boolean;
  className?: string;
}

/** Reusable score-ring + mini progress bar + hint. */
export function SeoScoreBadge({
  score,
  breakdown,
  size = "md",
  showHint = true,
  showBar = true,
  className,
}: SeoScoreBadgeProps) {
  const display = Math.max(0, Math.min(100, Math.round(score)));
  const ring = ringClasses(display);
  const ringSize = size === "sm" ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-xs";
  const barWidth = size === "sm" ? 56 : 64;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className={cn(
          "shrink-0 rounded-full border-2 flex items-center justify-center font-semibold font-mono-data tabular-nums",
          ring.bg,
          ring.text,
          ring.border,
          ringSize,
        )}
        title={`SEO score ${display} / 100`}
      >
        {display}
      </div>
      {(showBar || showHint) && (
        <div className="min-w-0">
          {showBar && (
            <div className="rounded-full bg-muted overflow-hidden h-1" style={{ width: barWidth }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${display}%`, background: fillColor(display) }}
              />
            </div>
          )}
          {showHint && (
            <div className="text-[10px] text-muted-foreground mt-1 truncate" style={{ maxWidth: barWidth + 24 }}>
              {gapHint(display, breakdown)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SeoScoreBadge;
