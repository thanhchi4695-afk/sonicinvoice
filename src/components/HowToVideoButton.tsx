import { useState } from "react";
import { Play } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface HowToVideoButtonProps {
  /** MP4 path served from /public, e.g. "/howto/url-importer.mp4" */
  videoSrc: string;
  /** Tool / feature name shown in the modal heading. */
  title: string;
  /** Short subtitle shown under the title. */
  description?: string;
  /** Optional poster image path. */
  poster?: string;
  /** Tooltip / aria label. Defaults to "Watch how it works". */
  label?: string;
  className?: string;
  size?: "sm" | "md";
}

/**
 * Compact ▶ button that opens a modal playing a short how-to video for the
 * adjacent tool / feature. Designed to sit inline next to a heading or row
 * label. Reusable across the app — supply a different videoSrc per tool.
 */
const HowToVideoButton = ({
  videoSrc,
  title,
  description,
  poster,
  label = "Watch how it works",
  className,
  size = "sm",
}: HowToVideoButtonProps) => {
  const [open, setOpen] = useState(false);
  const dim = size === "sm" ? "w-7 h-7" : "w-9 h-9";
  const icon = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={label}
        aria-label={label}
        className={cn(
          "inline-flex items-center justify-center rounded-full",
          "bg-primary/15 text-primary border border-primary/30",
          "hover:bg-primary hover:text-primary-foreground hover:border-primary",
          "transition-colors shadow-sm shrink-0",
          dim,
          className,
        )}
      >
        <Play className={cn(icon, "fill-current ml-[1px]")} />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden bg-card">
          <DialogHeader className="px-5 pt-4 pb-2">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Play className="w-4 h-4 text-primary fill-current" />
              How it works · {title}
            </DialogTitle>
            {description && (
              <DialogDescription className="text-xs">
                {description}
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="bg-black">
            <video
              key={videoSrc}
              src={videoSrc}
              poster={poster}
              autoPlay
              controls
              playsInline
              className="w-full h-auto block"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default HowToVideoButton;
