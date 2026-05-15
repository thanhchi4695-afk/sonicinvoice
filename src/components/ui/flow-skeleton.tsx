// Fixed-height skeletons for lazy-loaded flow panels.
// Prevents CLS by reserving the same vertical space the real panel occupies.
import { cn } from "@/lib/utils";

interface FlowSkeletonProps {
  variant?: "default" | "wizard" | "table" | "split" | "narrow";
  className?: string;
}

export function FlowSkeleton({ variant = "default", className }: FlowSkeletonProps) {
  const blocks = (() => {
    switch (variant) {
      case "wizard":
        return (
          <>
            <div className="h-2 w-full bg-muted rounded animate-pulse" />
            <div className="h-72 w-full bg-muted/60 rounded-lg animate-pulse" />
            <div className="flex gap-2"><div className="h-9 w-24 bg-muted rounded animate-pulse" /><div className="h-9 w-24 bg-muted rounded animate-pulse" /></div>
          </>
        );
      case "table":
        return (
          <>
            <div className="h-9 w-64 bg-muted rounded animate-pulse" />
            <div className="space-y-1.5">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="h-8 w-full bg-muted/50 rounded animate-pulse" />
              ))}
            </div>
          </>
        );
      case "split":
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="h-96 bg-muted/60 rounded-lg animate-pulse" />
            <div className="h-96 bg-muted/60 rounded-lg animate-pulse" />
          </div>
        );
      case "narrow":
        return (
          <div className="max-w-md mx-auto space-y-3">
            <div className="h-8 w-3/4 bg-muted rounded animate-pulse" />
            <div className="h-32 w-full bg-muted/60 rounded-lg animate-pulse" />
            <div className="h-10 w-full bg-muted rounded animate-pulse" />
          </div>
        );
      default:
        return (
          <>
            <div className="h-8 w-1/3 bg-muted rounded animate-pulse" />
            <div className="h-4 w-2/3 bg-muted/70 rounded animate-pulse" />
            <div className="h-64 w-full bg-muted/60 rounded-lg animate-pulse" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="h-24 bg-muted/50 rounded animate-pulse" />
              <div className="h-24 bg-muted/50 rounded animate-pulse" />
              <div className="h-24 bg-muted/50 rounded animate-pulse" />
            </div>
          </>
        );
    }
  })();

  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn("p-4 sm:p-6 space-y-4 min-h-[480px]", className)}
    >
      {blocks}
    </div>
  );
}
