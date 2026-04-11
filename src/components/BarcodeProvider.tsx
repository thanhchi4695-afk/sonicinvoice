import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { toast } from "sonner";

/* ─── Types ─── */
export type BarcodePage = "purchase_order_receive" | "stocktake" | "inventory" | "transfer" | "none";

export interface BarcodeHandler {
  (barcode: string): void;
}

export interface BarcodeScanEntry {
  barcode: string;
  timestamp: number;
  page: BarcodePage;
}

interface BarcodeContextValue {
  /** Register the active page handler. Returns an unregister function. */
  registerHandler: (page: BarcodePage, handler: BarcodeHandler) => () => void;
  /** Recent scan history (newest first, max 50) */
  history: BarcodeScanEntry[];
  /** Currently active page */
  activePage: BarcodePage;
}

const BarcodeContext = createContext<BarcodeContextValue | null>(null);

export function useBarcode() {
  const ctx = useContext(BarcodeContext);
  if (!ctx) throw new Error("useBarcode must be inside <BarcodeProvider>");
  return ctx;
}

/* ─── Visual flash helper ─── */
function flashGreen() {
  // Flash a green border on the currently focused element
  const el = document.activeElement as HTMLElement | null;
  if (el && el !== document.body) {
    const prev = el.style.boxShadow;
    el.style.boxShadow = "0 0 0 3px hsl(142 71% 45% / 0.7)";
    el.style.transition = "box-shadow 0.15s ease";
    setTimeout(() => {
      el.style.boxShadow = prev;
    }, 400);
  }
}

/* ─── Provider ─── */
const MAX_HISTORY = 50;
const MAX_KEYSTROKE_GAP_MS = 50;
const MIN_BARCODE_LENGTH = 3;

export default function BarcodeProvider({ children }: { children: ReactNode }) {
  const bufferRef = useRef("");
  const lastKeyTimeRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlersRef = useRef<Map<BarcodePage, BarcodeHandler>>(new Map());
  const [activePage, setActivePage] = useState<BarcodePage>("none");
  const [history, setHistory] = useState<BarcodeScanEntry[]>([]);

  const registerHandler = useCallback((page: BarcodePage, handler: BarcodeHandler) => {
    handlersRef.current.set(page, handler);
    setActivePage(page);
    return () => {
      handlersRef.current.delete(page);
      setActivePage(prev => prev === page ? "none" : prev);
    };
  }, []);

  const processScan = useCallback((barcode: string) => {
    const trimmed = barcode.trim();
    if (trimmed.length < MIN_BARCODE_LENGTH) return;

    // Visual feedback
    flashGreen();
    toast.success(`Scanned: ${trimmed}`, { duration: 2000 });

    // Add to history
    const entry: BarcodeScanEntry = { barcode: trimmed, timestamp: Date.now(), page: activePage };
    setHistory(prev => [entry, ...prev].slice(0, MAX_HISTORY));

    // Dispatch to active handler
    const handler = handlersRef.current.get(activePage);
    if (handler) {
      handler(trimmed);
    }
  }, [activePage]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if user is typing in an input/textarea that already handles barcodes locally
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA";

      // Check for data attribute to opt-out of global scanner
      if (target.closest("[data-barcode-ignore]")) return;

      const now = Date.now();
      const gap = now - lastKeyTimeRef.current;

      if (e.key === "Enter") {
        e.stopPropagation();
        if (bufferRef.current.length >= MIN_BARCODE_LENGTH) {
          // Prevent form submission from barcode
          if (isInput) e.preventDefault();
          processScan(bufferRef.current);
        }
        bufferRef.current = "";
        lastKeyTimeRef.current = 0;
        return;
      }

      // Only track printable single characters
      if (e.key.length !== 1) {
        // Non-printable key → reset buffer
        bufferRef.current = "";
        lastKeyTimeRef.current = 0;
        return;
      }

      // If gap > threshold, this is manual typing — reset
      if (bufferRef.current.length > 0 && (now - lastKeyTimeRef.current) > MAX_KEYSTROKE_GAP_MS) {
        bufferRef.current = "";
      }

      bufferRef.current += e.key;
      lastKeyTimeRef.current = now;

      // Safety: clear buffer after 500ms of no input
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        bufferRef.current = "";
        lastKeyTimeRef.current = 0;
      }, 500);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [processScan]);

  return (
    <BarcodeContext.Provider value={{ registerHandler, history, activePage }}>
      {children}
    </BarcodeContext.Provider>
  );
}
