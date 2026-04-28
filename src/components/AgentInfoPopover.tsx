// ════════════════════════════════════════════════════════════════
// AgentInfoPopover — tappable info icon that expands into a short
// guide explaining an agent's inputs, outputs, and why it runs.
// Uses Popover so it works on touch (tap to open) as well as mouse.
// ════════════════════════════════════════════════════════════════

import { Info, ArrowDownToLine, ArrowUpFromLine, Sparkles } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface AgentInfo {
  name: string;
  inputs: string[];
  outputs: string[];
  why: string;
  triggers?: string;
}

interface Props {
  info: AgentInfo;
  className?: string;
  variant?: "default" | "accent";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const AgentInfoPopover = ({ info, className, variant = "default", open, onOpenChange }: Props) => {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label={`How ${info.name} works`}
          className={cn(
            "rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring",
            variant === "accent" && "hover:text-accent",
            className
          )}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-72 p-3 text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-1.5">
          <Sparkles className={cn("h-3.5 w-3.5", variant === "accent" ? "text-accent" : "text-primary")} />
          <p className="text-sm font-semibold text-foreground">{info.name}</p>
        </div>

        <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">{info.why}</p>

        <div className="space-y-2">
          <Section
            icon={<ArrowDownToLine className="h-3 w-3 text-primary" />}
            label="Inputs"
            items={info.inputs}
          />
          <Section
            icon={<ArrowUpFromLine className="h-3 w-3 text-success" />}
            label="Outputs"
            items={info.outputs}
          />
          {info.triggers && (
            <div className="rounded-md border border-border/60 bg-muted/30 px-2 py-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Runs when
              </p>
              <p className="text-[11px] text-foreground">{info.triggers}</p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

const Section = ({
  icon,
  label,
  items,
}: {
  icon: React.ReactNode;
  label: string;
  items: string[];
}) => (
  <div>
    <div className="mb-1 flex items-center gap-1.5">
      {icon}
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
    </div>
    <ul className="space-y-0.5 pl-4">
      {items.map((it, i) => (
        <li key={i} className="list-disc text-[11px] text-foreground marker:text-muted-foreground/60">
          {it}
        </li>
      ))}
    </ul>
  </div>
);

export default AgentInfoPopover;
