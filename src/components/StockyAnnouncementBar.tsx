import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { X, Sparkles, ArrowRight, Check, Clock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "sonic_stocky_announcement_dismissed";

const COMPARISON: Array<[string, string]> = [
  ["Manual PO data entry", "AI extracts invoice data automatically"],
  ["Receive stock against POs", "Receive stock from any supplier invoice"],
  ["Inventory on hand view", "Live inventory with multi-location view"],
  ["Supplier management", "Supplier Brain — AI-trained per supplier"],
  ["Low stock reports", "Low stock alerts with depletion forecast"],
  ["Rule-based restock forecasting", "Velocity-based restock suggestions"],
  ["ABC analysis", "ABC analysis built in"],
  ["Stock adjustments", "Manual stock adjustments"],
  ["Stocktakes", "Stocktake module with barcode scan"],
  ["No accounting integration", "Xero + MYOB integration"],
  ["No email automation", "Auto-pulls invoices from your inbox"],
  ["Shuts down August 31, 2026", "Built for the long term"],
];

export default function StockyAnnouncementBar() {
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(STORAGE_KEY);
      setVisible(!dismissed);
    } catch {
      setVisible(true);
    }
  }, []);

  const path = location.pathname.toLowerCase();
  const isAuthPage =
    path.startsWith("/login") ||
    path.startsWith("/signup") ||
    path.startsWith("/sign-up") ||
    path.startsWith("/sign-in") ||
    path.startsWith("/signin") ||
    path.startsWith("/register") ||
    path.startsWith("/reset-password");

  if (!visible || isAuthPage) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* noop */
    }
    setVisible(false);
  };

  const startMigration = () => {
    setOpen(false);
    navigate("/dashboard?tab=invoices");
  };

  return (
    <>
      <div
        style={{ backgroundColor: "#1F3864", fontFamily: "Arial, sans-serif" }}
        className="w-full text-white text-[14px] relative z-[60]"
      >
        <div className="min-h-[48px] flex flex-col sm:flex-row items-center justify-center gap-3 px-4 py-2 sm:py-0 pr-12 text-center sm:text-left">
          <span className="leading-snug">
            📦 Stocky is shutting down on August 31, 2026. Sonic Invoices is the smart
            replacement — AI-powered invoice processing, automatic stock updates, and
            everything Stocky did, done better. Start your migration today.
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            style={{ color: "#1F3864" }}
            className="shrink-0 bg-white hover:bg-[#DBEAFE] rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors"
          >
            See What's Included →
          </button>
        </div>
        <button
          type="button"
          aria-label="Dismiss announcement"
          onClick={dismiss}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-white opacity-70 hover:opacity-100 p-1"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[640px] bg-white">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              Replacing Stocky? You're in the right place.
            </DialogTitle>
            <DialogDescription>Everything Stocky did — and a lot more.</DialogDescription>
          </DialogHeader>

          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted">
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground w-1/2">
                    Stocky
                  </th>
                  <th className="text-left px-3 py-2 font-semibold text-foreground w-1/2">
                    Sonic Invoices
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map(([s, v], i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-[#F9FAFB]" : "bg-white"}>
                    <td className="px-3 py-2 text-muted-foreground">{s}</td>
                    <td className="px-3 py-2 text-foreground">
                      <span className="text-green-600 mr-1">✅</span>
                      {v}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 text-sm">
            ⏳ Stocky shuts down in less than 4 months. The sooner you migrate, the
            smoother the transition. Your data, your suppliers, your stock — all
            transferable.
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button onClick={startMigration}>Start Migration Now</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
