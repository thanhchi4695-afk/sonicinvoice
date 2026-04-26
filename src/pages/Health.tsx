import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const BUILD_TIMESTAMP = new Date().toISOString();

type Status = "checking" | "ok" | "failed";

const Row = ({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "err" }) => (
  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between border-b border-border/40 py-3">
    <span className="text-sm font-mono text-muted-foreground">{label}</span>
    <span
      className={
        "text-sm font-mono break-all " +
        (tone === "ok"
          ? "text-emerald-500"
          : tone === "err"
            ? "text-red-500"
            : tone === "warn"
              ? "text-amber-500"
              : "text-foreground")
      }
    >
      {value}
    </span>
  </div>
);

export default function Health() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

  const [connStatus, setConnStatus] = useState<Status>("checking");
  const [connDetail, setConnDetail] = useState<string>("");

  useEffect(() => {
    document.title = "Health Check — Sonic Invoices";
    let cancelled = false;

    (async () => {
      try {
        const { error } = await supabase.auth.getSession();
        if (cancelled) return;
        if (error) {
          setConnStatus("failed");
          setConnDetail(error.message);
        } else {
          setConnStatus("ok");
          setConnDetail("auth.getSession reachable");
        }
      } catch (e) {
        if (cancelled) return;
        setConnStatus("failed");
        setConnDetail(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const mask = (v?: string) => {
    if (!v) return "MISSING";
    if (v.length <= 16) return v;
    return `${v.slice(0, 12)}…${v.slice(-6)} (${v.length} chars)`;
  };

  return (
    <main className="min-h-screen bg-background text-foreground px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-semibold mb-1">Health Check</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Public diagnostic page. No login required.
        </p>

        <section className="rounded-lg border border-border bg-card p-4">
          <Row
            label="VITE_SUPABASE_URL"
            value={supabaseUrl || "MISSING"}
            tone={supabaseUrl ? "ok" : "err"}
          />
          <Row
            label="VITE_SUPABASE_PUBLISHABLE_KEY"
            value={mask(publishableKey)}
            tone={publishableKey ? "ok" : "err"}
          />
          <Row
            label="Supabase connection"
            value={
              connStatus === "checking"
                ? "checking…"
                : connStatus === "ok"
                  ? `OK — ${connDetail}`
                  : `FAILED — ${connDetail}`
            }
            tone={connStatus === "ok" ? "ok" : connStatus === "failed" ? "err" : "warn"}
          />
          <Row label="Bundle built at" value={BUILD_TIMESTAMP} />
          <Row label="Page loaded at" value={new Date().toISOString()} />
        </section>

        <p className="mt-6 text-xs text-muted-foreground">
          If <code>VITE_SUPABASE_URL</code> shows MISSING, the Vite fallback in{" "}
          <code>vite.config.ts</code> failed to inject. If connection shows FAILED, the
          Supabase project may be paused or unreachable.
        </p>
      </div>
    </main>
  );
}