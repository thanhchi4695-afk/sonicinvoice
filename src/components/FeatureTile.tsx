import { cn } from "@/lib/utils";

interface FeatureTileProps {
  icon: string;
  label: string;
  badge?: string | number;
  onClick: () => void;
  highlight?: boolean;
}

const FeatureTile = ({ icon, label, badge, onClick, highlight }: FeatureTileProps) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative bg-card border border-border rounded-xl py-3 px-2 flex flex-col items-center text-center transition-colors hover:bg-primary/10",
        highlight && "border-primary/40 bg-primary/5"
      )}
    >
      {badge !== undefined && badge !== 0 && (
        <span className="absolute top-1 right-1 bg-primary text-primary-foreground text-[10px] rounded-full px-1.5 min-w-[18px] text-center font-semibold">
          {badge}
        </span>
      )}
      <span className="text-2xl mb-1">{icon}</span>
      <span className="text-xs font-medium text-foreground leading-tight">{label}</span>
    </button>
  );
};

export default FeatureTile;
