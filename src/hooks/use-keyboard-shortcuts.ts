import { useEffect, useCallback } from "react";

export interface ShortcutDef {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  label: string;
  description: string;
  action: () => void;
}

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts(shortcuts: ShortcutDef[]) {
  const handler = useCallback(
    (e: KeyboardEvent) => {
      if (isInputFocused()) return;

      for (const s of shortcuts) {
        const wantCtrl = !!s.ctrl;
        const hasCtrl = e.metaKey || e.ctrlKey;
        if (wantCtrl !== hasCtrl) continue;
        const wantShift = !!s.shift;
        if (wantShift !== e.shiftKey) continue;
        if (e.key.toLowerCase() === s.key.toLowerCase()) {
          e.preventDefault();
          s.action();
          return;
        }
      }
    },
    [shortcuts]
  );

  useEffect(() => {
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handler]);
}

export const SHORTCUT_DEFINITIONS: Omit<ShortcutDef, "action">[] = [
  { key: "n", label: "N", description: "New Purchase Order" },
  { key: "r", label: "R", description: "Receive Stock" },
  { key: "t", label: "T", description: "New Stocktake" },
  { key: "s", label: "S", description: "Focus Barcode Scanner" },
  { key: "k", ctrl: true, label: "⌘K", description: "Quick Search" },
  { key: "?", label: "?", description: "Keyboard Shortcuts" },
];
