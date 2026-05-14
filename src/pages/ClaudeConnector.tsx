import { useEffect, useState } from "react";
import { Copy, Loader2, Plug, ShieldAlert, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { BackButton } from "@/components/BackButton";

interface TokenRow {
  id: string;
  label: string;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sonic-mcp`;

// SHA-256 helper (matches the edge function)
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Generate a 32-byte random token, base64url-encoded.
function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const ClaudeConnector = () => {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("Splash Swimwear — Lisa");
  const [creating, setCreating] = useState(false);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("sonic_mcp_tokens")
      .select("id, label, last_used_at, created_at, revoked_at")
      .is("revoked_at", null)
      .order("created_at", { ascending: false });
    if (error) toast({ title: "Failed to load tokens", description: error.message, variant: "destructive" });
    else setTokens((data ?? []) as TokenRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!label.trim()) return;
    setCreating(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Not signed in");
      const raw = "snc_" + generateToken();
      const hash = await sha256Hex(raw);
      const { error } = await supabase.from("sonic_mcp_tokens").insert({
        user_id: auth.user.id,
        token_hash: hash,
        label: label.trim(),
      });
      if (error) throw error;
      setRevealedToken(raw);
      setLabel("");
      await load();
    } catch (e: any) {
      toast({ title: "Could not create token", description: e?.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    if (!confirm("Revoke this token? Claude will lose access immediately.")) return;
    const { error } = await supabase
      .from("sonic_mcp_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast({ title: "Revoke failed", description: error.message, variant: "destructive" });
    else load();
  };

  const copy = (text: string, what = "Copied") => {
    navigator.clipboard.writeText(text);
    toast({ title: what });
  };

  return (
    <div className="container max-w-3xl py-8 space-y-6">
      <BackButton />
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Plug className="h-7 w-7 text-primary" />
          Connect to Claude
        </h1>
        <p className="text-muted-foreground mt-2">
          Generate a private token to let Claude.ai (or any MCP client) read your Sonic Invoices
          data. v1 is read-only: store context, collections, and competitor gap results.
        </p>
      </div>

      {/* Setup instructions */}
      <Card>
        <CardHeader>
          <CardTitle>How to connect</CardTitle>
          <CardDescription>One-time setup in Claude.ai → Settings → Connectors → Add custom connector</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <div className="font-medium mb-1">1. Server URL</div>
            <div className="flex gap-2">
              <code className="flex-1 px-3 py-2 rounded bg-muted text-xs break-all">{FUNCTION_URL}</code>
              <Button size="icon" variant="outline" onClick={() => copy(FUNCTION_URL, "URL copied")}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div>
            <div className="font-medium mb-1">2. Custom header</div>
            <code className="block px-3 py-2 rounded bg-muted text-xs">
              Authorization: Bearer &lt;your-token-below&gt;
            </code>
          </div>
          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/40 rounded p-3">
            <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
            <span>Tokens are shown once at creation. We store only a SHA-256 hash. Revoke anytime — Claude loses access immediately.</span>
          </div>
        </CardContent>
      </Card>

      {/* Create */}
      <Card>
        <CardHeader>
          <CardTitle>Create a new token</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Label (e.g. Splash Swimwear — Lisa)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={80}
          />
          <Button onClick={create} disabled={creating || !label.trim()}>
            {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Generate token
          </Button>

          {revealedToken && (
            <div className="rounded border border-primary/40 bg-primary/5 p-4 space-y-2">
              <div className="text-sm font-medium">Copy this token now — you won't see it again:</div>
              <div className="flex gap-2">
                <code className="flex-1 px-3 py-2 rounded bg-background text-xs break-all">{revealedToken}</code>
                <Button size="icon" variant="outline" onClick={() => copy(revealedToken, "Token copied")}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setRevealedToken(null)}>
                I've copied it
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* List */}
      <Card>
        <CardHeader>
          <CardTitle>Active tokens</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : tokens.length === 0 ? (
            <div className="text-sm text-muted-foreground">No tokens yet.</div>
          ) : (
            <ul className="divide-y">
              {tokens.map((t) => (
                <li key={t.id} className="py-3 flex items-center justify-between">
                  <div>
                    <div className="font-medium">{t.label}</div>
                    <div className="text-xs text-muted-foreground">
                      Created {new Date(t.created_at).toLocaleDateString()}
                      {t.last_used_at
                        ? ` · Last used ${new Date(t.last_used_at).toLocaleString()}`
                        : " · Never used"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {t.last_used_at ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Unused</Badge>}
                    <Button size="icon" variant="ghost" onClick={() => revoke(t.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ClaudeConnector;
