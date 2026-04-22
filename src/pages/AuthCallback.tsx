import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

const AuthCallbackPage = () => {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Connecting...");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const path = window.location.pathname;

    // ── Lightspeed X-Series callback ──
    if (path.includes("lightspeed-x")) {
      const domainPrefix =
        params.get("domain_prefix") ||
        localStorage.getItem("ls_domain_prefix") ||
        "";
      if (!code) {
        setStatus("error");
        setMessage("No authorization code received");
        return;
      }
      setMessage("Connecting to Lightspeed X-Series...");
      supabase.functions.invoke("pos-proxy", {
        body: { action: "exchange_code", platform: "lightspeed_x", code, domain_prefix: domainPrefix, state },
      }).then(({ data, error }) => {
        if (error || !data?.success) {
          setStatus("error");
          setMessage(`Connection failed: ${error?.message || data?.error || "Unknown error"}`);
          window.opener?.postMessage({ type: "POS_AUTH_ERROR", platform: "lightspeed_x" }, "*");
        } else {
          setStatus("success");
          setMessage(`Connected to ${data.domain || "Lightspeed X-Series"}!`);
          window.opener?.postMessage({ type: "POS_AUTH_SUCCESS", platform: "lightspeed_x", data }, "*");
          setTimeout(() => window.close(), 1500);
        }
      });
      return;
    }

    // ── Lightspeed R-Series callback ──
    if (path.includes("lightspeed-r")) {
      if (!code) {
        setStatus("error");
        setMessage("No authorization code received");
        return;
      }
      setMessage("Connecting to Lightspeed R-Series...");
      supabase.functions.invoke("pos-proxy", {
        body: { action: "exchange_code", platform: "lightspeed_r", code, state },
      }).then(({ data, error }) => {
        if (error || !data?.success) {
          setStatus("error");
          setMessage(`Connection failed: ${error?.message || data?.error || "Unknown error"}`);
          window.opener?.postMessage({ type: "POS_AUTH_ERROR", platform: "lightspeed_r" }, "*");
        } else {
          setStatus("success");
          setMessage(`Connected to Lightspeed R-Series (Account #${data.account_id})!`);
          window.opener?.postMessage({ type: "POS_AUTH_SUCCESS", platform: "lightspeed_r", data }, "*");
          setTimeout(() => window.close(), 1500);
        }
      });
      return;
    }

    // ── Accounting (Xero / MYOB) callback — existing ──
    const platform = path.includes("xero") ? "xero" : "myob";
    if (!code) {
      setStatus("error");
      setMessage("No authorization code received");
      return;
    }
    setMessage(`Connecting to ${platform}...`);
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
