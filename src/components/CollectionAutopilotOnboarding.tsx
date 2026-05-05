import { useEffect, useState } from "react";
import { Bot, Sparkles, Search, Package, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const STORAGE_KEY = "collection_autopilot_onboarding_seen";

type Mode = "ask" | "brand_only" | "all";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function CollectionAutopilotOnboarding({ open, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("ask");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setMode("ask");
  }, [open]);

  if (!open) return null;

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch {}
    onClose();
  };

  const enable = async () => {
    setSaving(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) {
        toast.error("Please sign in to enable Autopilot");
        setSaving(false);
        return;
      }
      const settings = {
        user_id: uid,
        auto_approve_brand_collections: mode !== "ask",
        auto_approve_brand_stories: mode === "all",
        seo_auto_generate: true,
        weekly_health_check: true,
      };
      const { error } = await supabase
        .from("collection_automation_settings")
        .upsert(settings, { onConflict: "user_id" });
      if (error) throw error;
      try { localStorage.setItem(STORAGE_KEY, "1"); } catch {}
      try { localStorage.setItem("collection_open_tab", "autopilot"); } catch {}
      toast.success("Collection Autopilot enabled");
      onClose();
      window.dispatchEvent(new CustomEvent("sonic:navigate-flow", { detail: "collection_decomposer" }));
    } catch (e: any) {
      toast.error(e?.message || "Could not enable Autopilot");
    } finally {
      setSaving(false);
    }
  };

  const opts: { id: Mode; label: string; hint?: string }[] = [
    { id: "ask", label: "Ask me before creating", hint: "recommended" },
    { id: "brand_only", label: "Auto-create brand pages only" },
    { id: "all", label: "Auto-create everything" },
  ];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="autopilot-onboarding-title"
    >
      <div
        className="relative w-full max-w-lg rounded-2xl border border-indigo-500/30 p-6 sm:p-8 shadow-2xl animate-in zoom-in-95"
        style={{ background: "linear-gradient(135deg, hsl(222 47% 8%) 0%, hsl(222 60% 14%) 100%)" }}
      >
        <div className="flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-2xl bg-indigo-500/15 border border-indigo-400/30 flex items-center justify-center mb-3">
            <Bot className="w-7 h-7 text-indigo-300" />
          </div>
          <h2 id="autopilot-onboarding-title" className="text-2xl font-semibold text-white">
            Collection Autopilot
          </h2>
          <p className="mt-2 text-sm text-slate-300 max-w-sm">
            Your store now runs its own collection pages — automatically.
          </p>
        </div>

        <div className="my-5 border-t border-white/10" />

        <ol className="space-y-3">
          <li className="flex items-start gap-3">
            <Package className="w-5 h-5 text-slate-300 mt-0.5 shrink-0" />
            <div>
              <div className="text-sm font-medium text-white">Invoice arrives</div>
              <div className="text-xs text-slate-400">Walnut Melbourne 219077 processed</div>
            </div>
          </li>
          <li className="pl-1.5 text-slate-500"><ArrowDown className="w-3.5 h-3.5" /></li>
          <li className="flex items-start gap-3">
            <Search className="w-5 h-5 text-amber-300 mt-0.5 shrink-0" />
            <div>
              <div className="text-sm font-medium text-white">AI detects new style lines</div>
              <div className="text-xs text-slate-400">"Marrakesh", "Madrid", "Paris"</div>
            </div>
          </li>
          <li className="pl-1.5 text-slate-500"><ArrowDown className="w-3.5 h-3.5" /></li>
          <li className="flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-indigo-300 mt-0.5 shrink-0" />
            <div>
              <div className="text-sm font-medium text-white">Collections created automatically</div>
              <div className="text-xs text-slate-400">With SEO content and smart rules</div>
            </div>
          </li>
        </ol>

        <div className="my-5 border-t border-white/10" />

        <div>
          <div className="text-sm font-medium text-white mb-2">Choose how much control you want:</div>
          <div role="radiogroup" className="space-y-2">
            {opts.map((o) => {
              const selected = mode === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setMode(o.id)}
                  className={`w-full flex items-center gap-3 text-left px-3 py-2.5 rounded-lg border transition-colors ${
                    selected
                      ? "bg-indigo-500/15 border-indigo-400/50"
                      : "bg-white/[0.03] border-white/10 hover:bg-white/[0.06]"
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                      selected ? "border-indigo-300" : "border-slate-500"
                    }`}
                  >
                    {selected && <span className="w-2 h-2 rounded-full bg-indigo-300" />}
                  </span>
                  <span className="text-sm text-white">{o.label}</span>
                  {o.hint && (
                    <span className="ml-auto text-[10px] uppercase tracking-wide text-indigo-300">
                      {o.hint}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2">
          <Button
            onClick={enable}
            disabled={saving}
            className="bg-indigo-500 hover:bg-indigo-400 text-white"
          >
            {saving ? "Enabling…" : "Enable Collection Autopilot →"}
          </Button>
          <Button variant="ghost" onClick={dismiss} className="text-slate-300 hover:text-white">
            Maybe later — I'll do it manually
          </Button>
        </div>
      </div>
    </div>
  );
}

export function shouldShowAutopilotOnboarding(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "1";
  } catch {
    return false;
  }
}
