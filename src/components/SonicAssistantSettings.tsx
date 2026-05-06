import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { toast } from "sonner";

// Briefing time choices → UTC hour (assumes AEST UTC+10, no DST adjustment)
const BRIEFING_OPTIONS: { label: string; utc: number }[] = [
  { label: "6:00am AEST", utc: 20 },
  { label: "7:00am AEST", utc: 21 },
  { label: "7:30am AEST", utc: 21 }, // approx — cron is hourly
  { label: "8:00am AEST", utc: 22 },
  { label: "9:00am AEST", utc: 23 },
];

interface Prefs {
  morning_briefing_enabled: boolean;
  briefing_hour_utc: number;
  proactive_mode_enabled: boolean;
  auto_approve_tags: boolean;
  auto_approve_seo: boolean;
}

const DEFAULTS: Prefs = {
  morning_briefing_enabled: true,
  briefing_hour_utc: 22,
  proactive_mode_enabled: true,
  auto_approve_tags: false,
  auto_approve_seo: false,
};

const SonicAssistantSettings = () => {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("morning_briefing_enabled, briefing_hour_utc, proactive_mode_enabled, auto_approve_tags, auto_approve_seo")
        .eq("user_id", userId)
        .maybeSingle();
      if (data) {
        setPrefs({
          morning_briefing_enabled: data.morning_briefing_enabled ?? true,
          briefing_hour_utc: data.briefing_hour_utc ?? 22,
          proactive_mode_enabled: data.proactive_mode_enabled ?? true,
          auto_approve_tags: data.auto_approve_tags ?? false,
          auto_approve_seo: data.auto_approve_seo ?? false,
        });
      }
      setLoading(false);
    })();
  }, [userId]);

  const save = async (patch: Partial<Prefs>) => {
    if (!userId) return;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    const { error } = await supabase
      .from("user_preferences")
      .upsert({ user_id: userId, ...next }, { onConflict: "user_id" });
    if (error) {
      toast.error("Couldn't save preference");
    } else {
      toast.success("Saved");
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card mt-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between p-4"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="font-medium">Sonic Assistant</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Morning briefing</p>
                  <p className="text-xs text-muted-foreground">
                    Daily summary of pending emails, recent imports, and tasks.
                  </p>
                </div>
                <Switch
                  checked={prefs.morning_briefing_enabled}
                  onCheckedChange={(v) => save({ morning_briefing_enabled: v })}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Briefing time</p>
                  <p className="text-xs text-muted-foreground">
                    When you'd like the briefing to arrive.
                  </p>
                </div>
                <Select
                  value={String(prefs.briefing_hour_utc)}
                  onValueChange={(v) => save({ briefing_hour_utc: parseInt(v, 10) })}
                  disabled={!prefs.morning_briefing_enabled}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BRIEFING_OPTIONS.map((o) => (
                      <SelectItem key={o.label} value={String(o.utc)}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Proactive suggestions</p>
                  <p className="text-xs text-muted-foreground">
                    Sonic posts next-step suggestions in chat after key events.
                  </p>
                </div>
                <Switch
                  checked={prefs.proactive_mode_enabled}
                  onCheckedChange={(v) => save({ proactive_mode_enabled: v })}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="pr-4">
                  <p className="text-sm font-medium">Auto-generate tags after parse</p>
                  <p className="text-xs text-muted-foreground">
                    Tags will be generated automatically after every invoice parse.
                    You can edit them before importing to Shopify.
                  </p>
                </div>
                <Switch
                  checked={prefs.auto_approve_tags}
                  onCheckedChange={(v) => save({ auto_approve_tags: v })}
                  disabled={!prefs.proactive_mode_enabled}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="pr-4">
                  <p className="text-sm font-medium">Auto-write SEO titles after parse</p>
                  <p className="text-xs text-muted-foreground">
                    SEO titles and meta descriptions will be written automatically
                    after tags are done. Review them in the SEO Writer before pushing.
                  </p>
                </div>
                <Switch
                  checked={prefs.auto_approve_seo}
                  onCheckedChange={(v) => save({ auto_approve_seo: v })}
                  disabled={!prefs.proactive_mode_enabled}
                />
              </div>

              <p className="text-[11px] text-muted-foreground bg-muted/40 rounded-md p-2 border border-border">
                Auto-approved tasks still appear in your chat history and can be
                reviewed or undone before Shopify import.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default SonicAssistantSettings;
