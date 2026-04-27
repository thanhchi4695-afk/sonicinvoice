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

const COMPARISON: Array<[string, string, "live" | "soon"]> = [
  ["Manual PO data entry", "AI extracts invoice data automatically", "live"],
  ["Inventory on hand view", "Live inventory view", "live"],
  ["Supplier management", "Supplier Brain — AI-trained per supplier", "live"],
  ["No email automation", "Auto-pulls invoices from your inbox", "live"],
  ["No accounting integration", "Xero + MYOB integration", "live"],
  ["Privacy policy", "Privacy policy with AI disclosure", "live"],
  ["Low stock reports", "Coming soon", "soon"],
  ["Rule-based restock forecasting", "Coming soon", "soon"],
  ["ABC analysis", "Coming soon", "soon"],
  ["Stock adjustments", "Coming soon", "soon"],
  ["Stocktakes", "Coming soon", "soon"],
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
      <div className="w-full relative z-[60] bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-b border-slate-700/60 text-slate-100">
        <div className="max-w-screen-2xl mx-auto min-h-[44px] flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 px-4 sm:px-6 py-2 sm:py-0 pr-12 text-center sm:text-left">
          <div className="flex items-center gap-2 text-[13px] sm:text-sm leading-snug">
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
              <Clock className="h-3 w-3" />
              Stocky sunset
            </span>
            <span className="text-slate-200">
              Shopify Stocky shuts down <span className="font-semibold text-white">August 31, 2026</span>.
              <span className="hidden md:inline"> Migrate to Sonic Invoices — AI invoice processing, automatic stock updates, and everything Stocky did, done better.</span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 inline-flex items-center gap-1.5 bg-white hover:bg-slate-100 text-slate-900 rounded-md px-3 py-1.5 text-[13px] font-semibold shadow-sm transition-colors"
          >
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
            See what's included
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <button
          type="button"
          aria-label="Dismiss announcement"
          onClick={dismiss}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-white hover:bg-white/10 rounded-md p-1.5 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[680px] p-0 overflow-hidden">
          <div className="px-6 pt-6 pb-4 border-b bg-gradient-to-br from-slate-50 to-white">
            <DialogHeader>
              <div className="inline-flex items-center gap-1.5 self-start rounded-full bg-amber-100 text-amber-800 border border-amber-200 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide mb-2 w-fit">
                <Clock className="h-3 w-3" />
                Stocky shuts down Aug 31, 2026
              </div>
              <DialogTitle className="text-xl text-foreground">
                Replacing Stocky? You're in the right place.
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                Everything Stocky did — and a lot more.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/60 border-b">
                    <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground w-1/2 text-xs uppercase tracking-wide">
                      Stocky
                    </th>
                    <th className="text-left px-4 py-2.5 font-semibold text-foreground w-1/2 text-xs uppercase tracking-wide">
                      Sonic Invoices
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map(([s, v, status], i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-muted/20" : "bg-background"}>
                      <td className="px-4 py-2.5 text-muted-foreground line-through decoration-muted-foreground/40">
                        {s}
                      </td>
                      <td className="px-4 py-2.5 text-foreground">
                        <span className="inline-flex items-center gap-2">
                          <span className={status === "live"
                            ? "inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 shrink-0"
                            : "inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-100 text-amber-700 shrink-0 text-[10px]"
                          }>
                            {status === "live" ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : "🔜"}
                          </span>
                          {v}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-4 py-3 text-sm flex gap-2.5">
              <Clock className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
              <p>
                <span className="font-semibold">Stocky shuts down in less than 4 months.</span>{" "}
                The sooner you migrate, the smoother the transition. Your data, your suppliers,
                your stock — all transferable.
              </p>
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t bg-muted/30 gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button onClick={startMigration} className="gap-1.5">
              Start migration now
              <ArrowRight className="h-4 w-4" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
