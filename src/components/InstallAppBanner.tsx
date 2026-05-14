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

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, [dismissed]);

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
    setDeferredPrompt(null);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") dismiss();
    setDeferredPrompt(null);
  };

  if (dismissed || !deferredPrompt) return null;

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
            {/* iOS / no-install path: nothing extra here — Claude & Ask Sonic
                are now their own dedicated floating buttons. */}
          </>
        )}
        <button onClick={dismiss} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

