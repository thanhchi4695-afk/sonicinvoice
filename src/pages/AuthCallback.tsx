import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

const AuthCallbackPage = () => {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Connecting to accounting software...");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const platform = window.location.pathname.includes("xero") ? "xero" : "myob";

    if (!code) {
      setStatus("error");
      setMessage("No authorization code received");
      return;
    }

    supabase.functions.invoke("accounting-proxy", {
      body: { action: "exchange_code", platform, code, state },
    }).then(({ data, error }) => {
      if (error || !data?.success) {
        setStatus("error");
        setMessage(`Connection failed: ${error?.message || data?.error || "Unknown error"}`);
        window.opener?.postMessage({ type: "ACCOUNTING_AUTH_ERROR", platform, error: error?.message || data?.error }, "*");
      } else {
        setStatus("success");
        setMessage(`Connected to ${data.tenant_name || data.company_name || platform}!`);
        window.opener?.postMessage({ type: "ACCOUNTING_AUTH_SUCCESS", platform, data }, "*");
        setTimeout(() => window.close(), 1500);
      }
    });
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="text-center space-y-4 p-8">
        {status === "loading" && <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />}
        {status === "success" && <div className="w-8 h-8 rounded-full bg-green-500 text-white flex items-center justify-center mx-auto text-lg">✓</div>}
        {status === "error" && <div className="w-8 h-8 rounded-full bg-destructive text-white flex items-center justify-center mx-auto text-lg">✗</div>}
        <p className="text-sm text-muted-foreground">{message}</p>
        {status === "error" && (
          <button onClick={() => window.close()} className="text-xs text-primary hover:underline">Close window</button>
        )}
      </div>
    </div>
  );
};

export default AuthCallbackPage;
