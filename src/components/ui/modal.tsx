import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Standard Modal primitive — Apple-inspired, semantic-token-only.
 *
 * Sizes:
 *  - sm  → max-w-[480px]
 *  - md  → max-w-[640px]  (default)
 *  - lg  → max-w-[800px]
 *  - full → full-screen takeover (mobile-friendly long forms)
 *
 * Standard layout:
 *  - Header: title 18/600 + optional description (14/muted) + ✕ close (provided by DialogContent)
 *  - Body:   scrollable, comfortable padding
 *  - Footer: secondary action LEFT, primary RIGHT (use <ModalFooter />)
 */
export type ModalSize = "sm" | "md" | "lg" | "full";

const sizeClass: Record<ModalSize, string> = {
  sm: "max-w-[480px]",
  md: "max-w-[640px]",
  lg: "max-w-[800px]",
  full: "max-w-none w-screen h-screen rounded-none sm:rounded-none top-0 left-0 translate-x-0 translate-y-0",
};

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  size?: ModalSize;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  size = "md",
  children,
  footer,
  className,
  contentClassName,
}: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "p-0 gap-0 border-border/60 bg-card",
          sizeClass[size],
          className,
        )}
      >
        <DialogHeader className="px-6 pt-6 pb-3 text-left">
          <DialogTitle className="text-[18px] font-semibold leading-tight">
            {title}
          </DialogTitle>
          {description ? (
            <DialogDescription className="text-sm text-muted-foreground mt-1">
              {description}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <div className={cn("px-6 py-4 max-h-[70vh] overflow-y-auto", contentClassName)}>
          {children}
        </div>

        {footer ? (
          <DialogFooter className="px-6 py-4 border-t border-border/60 bg-muted/30 sm:justify-between gap-2">
            {footer}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Standard footer slot — secondary on the left, primary on the right.
 * Pass two children: <ModalFooter><CancelBtn /><PrimaryBtn /></ModalFooter>
 */
export function ModalFooter({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex w-full items-center justify-between gap-2", className)}>
      {children}
    </div>
  );
}
