// ── Invoice Session Store ──
// Lightweight session-scoped store (sessionStorage) for sharing the most
// recently extracted invoice products between the Review screen and
// downstream pricing tools (Price Adjustment, Margin Protection, Markdown
// Ladder). Clears on browser tab close; persists across in-app navigation.

import { useEffect, useState, useCallback } from "react";

export interface SessionProduct {
  product_title: string;
  sku: string;
  vendor: string;
  unit_cost: number;
  rrp: number;
  margin_pct: number;
  qty: number;
}

export interface InvoiceSession {
  sessionProducts: SessionProduct[];
  sessionSupplier: string;
  sessionDate: string;
}

const STORAGE_KEY = "sonic_invoice_session";
const EVENT_NAME = "sonic:invoice-session-change";

const empty: InvoiceSession = {
  sessionProducts: [],
  sessionSupplier: "",
  sessionDate: "",
};

function readSession(): InvoiceSession {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    return {
      sessionProducts: Array.isArray(parsed.sessionProducts) ? parsed.sessionProducts : [],
      sessionSupplier: parsed.sessionSupplier || "",
      sessionDate: parsed.sessionDate || "",
    };
  } catch {
    return empty;
  }
}

function writeSession(s: InvoiceSession) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore quota errors */
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function setSessionProducts(
  products: SessionProduct[],
  supplier = "",
  date = new Date().toISOString().slice(0, 10),
) {
  writeSession({ sessionProducts: products, sessionSupplier: supplier, sessionDate: date });
}

export function clearSession() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function getSession(): InvoiceSession {
  return readSession();
}

// React hook — re-renders on session change (cross-component sync).
export function useInvoiceSession() {
  const [session, setSession] = useState<InvoiceSession>(() => readSession());

  useEffect(() => {
    const onChange = () => setSession(readSession());
    window.addEventListener(EVENT_NAME, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT_NAME, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const setProducts = useCallback(
    (products: SessionProduct[], supplier?: string, date?: string) =>
      setSessionProducts(products, supplier ?? session.sessionSupplier, date ?? session.sessionDate),
    [session.sessionSupplier, session.sessionDate],
  );

  return {
    ...session,
    setSessionProducts: setProducts,
    clearSession,
    hasSession: session.sessionProducts.length > 0,
  };
}
