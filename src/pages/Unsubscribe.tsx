import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Loader2, CheckCircle2, AlertTriangle, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

type State = "validating" | "ready" | "already" | "invalid" | "submitting" | "done" | "error";

const Unsubscribe = () => {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<State>("validating");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    document.title = "Unsubscribe — Sonic Invoices";
  }, []);

  useEffect(() => {
    if (!token) { setState("invalid"); return; }
    (async () => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`,
          { headers: { apikey: SUPABASE_ANON } }
        );
        const data = await res.json();
        if (!res.ok) { setState("invalid"); return; }
        if (data.valid === false && data.reason === "already_unsubscribed") { setState("already"); return; }
        if (data.valid) { setState("ready"); return; }
        setState("invalid");
      } catch {
        setState("invalid");
      }
    })();
  }, [token]);

  const handleConfirm = async () => {
    if (!token) return;
    setState("submitting");
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/handle-email-unsubscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unsubscribe failed");
      if (data.success || data.reason === "already_unsubscribed") setState("done");
      else throw new Error("Unexpected response");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Something went wrong");
      setState("error");
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
      <div className="max-w-md w-full rounded-xl border border-border bg-card p-8 text-center">
        <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <Mail className="w-6 h-6 text-primary" />
        </div>

        {state === "validating" && (
          <><Loader2 className="w-5 h-5 animate-spin mx-auto mb-3 text-muted-foreground" /><p className="text-sm text-muted-foreground">Checking your link…</p></>
        )}
        {state === "ready" && (
          <>
            <h1 className="text-xl font-bold mb-2">Unsubscribe from emails</h1>
            <p className="text-sm text-muted-foreground mb-6">Click below to stop receiving emails from Sonic Invoices.</p>
            <Button onClick={handleConfirm} className="w-full">Confirm unsubscribe</Button>
          </>
        )}
        {state === "submitting" && (
          <><Loader2 className="w-5 h-5 animate-spin mx-auto mb-3 text-muted-foreground" /><p className="text-sm text-muted-foreground">Processing…</p></>
        )}
        {state === "done" && (
          <>
            <CheckCircle2 className="w-10 h-10 text-primary mx-auto mb-3" />
            <h1 className="text-xl font-bold mb-2">You're unsubscribed</h1>
            <p className="text-sm text-muted-foreground mb-6">You won't receive any more emails from us.</p>
            <Link to="/"><Button variant="outline">Back to home</Button></Link>
          </>
        )}
        {state === "already" && (
          <>
            <CheckCircle2 className="w-10 h-10 text-primary mx-auto mb-3" />
            <h1 className="text-xl font-bold mb-2">Already unsubscribed</h1>
            <p className="text-sm text-muted-foreground mb-6">This email is already opted out.</p>
            <Link to="/"><Button variant="outline">Back to home</Button></Link>
          </>
        )}
        {(state === "invalid" || state === "error") && (
          <>
            <AlertTriangle className="w-10 h-10 text-destructive mx-auto mb-3" />
            <h1 className="text-xl font-bold mb-2">Link not valid</h1>
            <p className="text-sm text-muted-foreground mb-6">{errorMsg || "This unsubscribe link is invalid or has expired."}</p>
            <Link to="/"><Button variant="outline">Back to home</Button></Link>
          </>
        )}
      </div>
    </div>
  );
};

export default Unsubscribe;
