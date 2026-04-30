import { useEffect, useState } from "react";
import { Keyboard, X, Wrench } from "lucide-react";
import { useMediaQuery } from "@/hooks/use-media-query";

const STORAGE_KEY = "mobile-keyboard-hint-dismissed";

/**
 * Detects when a physical keyboard is being used on a mobile/tablet device
 * (no desktop sidebar) and surfaces the Shift+T → Tools shortcut as a
 * dismissible overlay. Shown once per browser unless reset.
 *
 * Detection heuristic: a non-modifier keydown that fires while the user is
 * NOT typing into an input — virtual keyboards only fire keydown when an
 * editable element is focused.
 */
const MobileKeyboardHint = () => {
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isDesktop) return;
    if (typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "1") return;

    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (t?.isContentEditable) return;
      // Ignore pure modifier presses
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      setVisible(true);
      window.removeEventListener("keydown", onKey);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDesktop]);

  const dismiss = () => {
    setVisible(false);
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch {}
  };

  if (!visible || isDesktop) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] max-w-[92vw] animate-fade-in"
    >
      <div className="flex items-center gap-3 bg-card border border-border rounded-full shadow-lg pl-3 pr-2 py-2">
        <Keyboard className="w-4 h-4 text-primary shrink-0" />
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Keyboard detected —</span>
          <kbd className="px-1.5 py-0.5 rounded bg-muted text-foreground font-mono text-[10px] border border-border">⇧T</kbd>
          <span className="text-foreground inline-flex items-center gap-1">
            opens <Wrench className="w-3 h-3" /> Tools
          </span>
          <span className="text-muted-foreground hidden sm:inline">·</span>
          <kbd className="hidden sm:inline-flex px-1.5 py-0.5 rounded bg-muted text-foreground font-mono text-[10px] border border-border">?</kbd>
          <span className="text-muted-foreground hidden sm:inline">all shortcuts</span>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss keyboard hint"
          className="ml-1 p-1 rounded-full hover:bg-muted text-muted-foreground"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

export default MobileKeyboardHint;
