import { useState, useEffect } from "react";
import { X, Download, Sparkle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "sonic-install-dismissed";

export default function InstallAppBanner() {
  const navigate = useNavigate();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISSED_KEY) === "1");

  useEffect(() => {
    if (dismissed) return;

    // Chrome / Android install prompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // iOS (or any device without beforeinstallprompt) — show Claude / Ask Sonic shortcuts
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = (window.navigator as any).standalone === true;
    if (isIos && !isStandalone) setShowShortcuts(true);

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, [dismissed]);

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
    setDeferredPrompt(null);
    setShowShortcuts(false);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") dismiss();
    setDeferredPrompt(null);
  };

  const openAskSonic = () => {
    window.dispatchEvent(new CustomEvent("sonic:open-ask"));
  };

  if (dismissed || (!deferredPrompt && !showShortcuts)) return null;

  return (
    <div className="fixed bottom-20 inset-x-0 z-50 flex justify-center px-3 pb-2 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-md rounded-xl border bg-card shadow-lg p-3 flex items-center gap-2">
        {deferredPrompt ? (
          <>
            <Download className="h-5 w-5 shrink-0 text-primary" />
            <p className="text-sm flex-1">Install Sonic Invoices for quick access.</p>
            <Button size="sm" onClick={install}>Install</Button>
          </>
        ) : (
          <>
            <Sparkle className="h-5 w-5 shrink-0 text-purple-400" />
            <p className="text-sm flex-1 leading-tight">
              Power up your store with AI shortcuts.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2 gap-1 border-purple-500/40 text-purple-300 hover:bg-purple-500/10"
              onClick={() => navigate("/settings/claude-connector")}
            >
              <Sparkle className="h-3.5 w-3.5" />
              <span className="text-xs">Claude</span>
            </Button>
            <Button
              size="sm"
              className="h-8 px-2 gap-1"
              onClick={openAskSonic}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span className="text-xs">Ask Sonic</span>
            </Button>
          </>
        )}
        <button onClick={dismiss} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

