import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { type ConfidenceBreakdown, getConfidenceBgColor, getConfidenceLabel } from "@/lib/confidence";

interface ConfidenceBadgeProps {
  breakdown: ConfidenceBreakdown;
  size?: "sm" | "md";
}

const FieldRow = ({ label, ok }: { label: string; ok: boolean }) => (
  <span className={ok ? "text-success" : "text-destructive"}>
    {ok ? "✓" : "✗"} {label}
  </span>
);

export default function ConfidenceBadge({ breakdown, size = "sm" }: ConfidenceBadgeProps) {
  const label = getConfidenceLabel(breakdown.level);
  const bg = getConfidenceBgColor(breakdown.level);
  const textSize = size === "sm" ? "text-[9px]" : "text-[11px]";
  const px = size === "sm" ? "px-1.5 py-0.5" : "px-2 py-1";

  if (breakdown.level === "pending") {
    return (
      <span className={`inline-flex items-center rounded border font-medium ${bg} ${textSize} ${px}`}>
        {label}
      </span>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={`inline-flex items-center rounded border font-medium cursor-pointer hover:opacity-80 transition-opacity ${bg} ${textSize} ${px}`}>
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3" side="top" align="start">
        <p className="text-[10px] font-semibold mb-2">Confidence breakdown</p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
          <FieldRow label="Title" ok={breakdown.title} />
          <FieldRow label="Type" ok={breakdown.type} />
          <FieldRow label="Description" ok={breakdown.description} />
          <FieldRow label="Image URL" ok={breakdown.image} />
          <FieldRow label="Compare-at" ok={breakdown.compareAtPrice} />
          <FieldRow label="SEO title" ok={breakdown.seoTitle} />
          <FieldRow label="Tags" ok={breakdown.tags} />
        </div>
        <div className="mt-2 pt-2 border-t border-border text-[10px] text-muted-foreground">
          Match: {breakdown.matchSource === "none" ? "—" : breakdown.matchSource}
          {" · "}Score: {breakdown.score} pts → {getConfidenceLabel(breakdown.level)}
        </div>
      </PopoverContent>
    </Popover>
  );
}
