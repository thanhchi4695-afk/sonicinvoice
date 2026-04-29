import { useEffect, useState } from "react";
import { Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface TokenRow {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

// Crypto-safe random token, prefixed so we can spot-check format on the wire.
async function generateToken(): Promise<string> {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  const hex = Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sgi_${hex}`;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function ExtensionTokensPanel() {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("margin_guardian_extension_tokens")
      .select("id, label, created_at, last_used_at, revoked_at")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setTokens(data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) {
        toast.error("Sign in required");
        return;
      }
      const raw = await generateToken();
      const hash = await sha256Hex(raw);
      const { error } = await supabase
        .from("margin_guardian_extension_tokens")
        .insert({
          user_id: auth.user.id,
          token_hash: hash,
          label: label.trim() || "Chrome extension",
        });
      if (error) {
        toast.error(error.message);
        return;
      }
      setRevealed(raw);
      setLabel("");
      await load();
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    const { error } = await supabase
      .from("margin_guardian_extension_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Token revoked");
      await load();
    }
  };

  const handleDownload = () => {
    fetch("/sonic-margin-guardian.zip")
      .then((res) => {
        if (!res.ok) throw new Error(`Download failed: ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "sonic-margin-guardian.zip";
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((err) => toast.error(err.message));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Chrome extension tokens</CardTitle>
        <CardDescription>
          The Margin Guardian Chrome extension uses these tokens to call your rules. Each token is shown
          once at creation — copy it immediately. Revoke anytime to lock out a device.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 p-3 text-sm">
          <span>Need the extension? Download the latest build and load it via <code>chrome://extensions</code> → "Load unpacked".</span>
          <Button size="sm" variant="outline" onClick={handleDownload}>
            Download .zip
          </Button>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Label (e.g. Work laptop)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Generate token
          </Button>
        </div>

        {revealed && (
          <Alert>
            <AlertTitle>Copy this token now</AlertTitle>
            <AlertDescription className="space-y-2">
              <p className="text-sm">
                You won&apos;t be able to see it again. Paste it into the extension popup.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-muted px-2 py-1 font-mono text-xs">
                  {revealed}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(revealed);
                    toast.success("Copied");
                  }}
                >
                  <Copy className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRevealed(null)}>
                  Done
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : tokens.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tokens yet.</p>
        ) : (
          <div className="space-y-2">
            {tokens.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between rounded-md border p-3 text-sm"
              >
                <div>
                  <div className="font-medium">
                    {t.label}
                    {t.revoked_at && (
                      <span className="ml-2 rounded bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                        revoked
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Created {new Date(t.created_at).toLocaleDateString()}
                    {t.last_used_at && ` · last used ${new Date(t.last_used_at).toLocaleDateString()}`}
                  </div>
                </div>
                {!t.revoked_at && (
                  <Button size="sm" variant="ghost" onClick={() => handleRevoke(t.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
