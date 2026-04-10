import { useState, useEffect } from "react";
import { X, Download, Share } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "sonic-install-dismissed";

export default function InstallAppBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosTip, setShowIosTip] = useState(false);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISSED_KEY) === "1");

  useEffect(() => {
    if (dismissed) return;

    // Chrome / Android install prompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // iOS detection (no beforeinstallprompt)
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = (window.navigator as any).standalone === true;
    if (isIos && !isStandalone) setShowIosTip(true);

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, [dismissed]);

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
    setDeferredPrompt(null);
    setShowIosTip(false);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") dismiss();
    setDeferredPrompt(null);
  };

  if (dismissed || (!deferredPrompt && !showIosTip)) return null;

  return (
    <div className="fixed bottom-16 inset-x-0 z-50 flex justify-center px-3 pb-2 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-md rounded-xl border bg-card shadow-lg p-3 flex items-center gap-3">
        {deferredPrompt ? (
          <>
            <Download className="h-5 w-5 shrink-0 text-primary" />
            <p className="text-sm flex-1">Install Sonic Invoices for quick access.</p>
            <Button size="sm" onClick={install}>Install</Button>
          </>
        ) : (
          <>
            <Share className="h-5 w-5 shrink-0 text-primary" />
            <p className="text-sm flex-1">
              To install: tap <strong>Share</strong> → <strong>Add to Home Screen</strong>
            </p>
          </>
        )}
        <button onClick={dismiss} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
