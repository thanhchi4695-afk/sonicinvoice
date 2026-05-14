import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trash2,
  CheckCircle2,
  CircleDashed,
  Folder,
  Search,
  Store,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";

interface TokenRow {
  id: string;
  label: string;
  last_used_at: string | null;
  created_at: string;
}

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sonic-mcp`;

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateRawToken(): string {
  // 32 random bytes → base64url, prefixed for easy identification
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `snc_${b64}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const ClaudeConnector = () => {
  const confirm = useConfirmDialog();
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [token, setToken] = useState<TokenRow | null>(null);
  const [rawToken, setRawToken] = useState<string | null>(null); // only set immediately after generation
  const [revealed, setRevealed] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("sonic_mcp_tokens")
      .select("id, label, last_used_at, created_at")
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) toast.error(error.message);
    setToken((data as TokenRow | null) ?? null);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const generate = async () => {
    setWorking(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Not signed in");

      // Revoke all existing active tokens for this user (single active token model)
      await supabase
        .from("sonic_mcp_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("user_id", auth.user.id)
        .is("revoked_at", null);

      const raw = generateRawToken();
      const hash = await sha256Hex(raw);
      const { error } = await supabase.from("sonic_mcp_tokens").insert({
        user_id: auth.user.id,
        token_hash: hash,
        label: "Claude connector",
      });
      if (error) throw error;

      setRawToken(raw);
      setRevealed(true);
      await load();
      toast.success("Token generated — copy it now before leaving this page");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to generate token");
    } finally {
      setWorking(false);
    }
  };

  const regenerate = async () => {
    const ok = await confirm({
      title: "Regenerate connection token?",
      description:
        "This will disconnect any existing Claude sessions. You'll need to paste the new token into Claude.ai.",
      confirmLabel: "Regenerate",
    });
    if (!ok) return;
    await generate();
  };

  const revoke = async () => {
    if (!token) return;
    const ok = await confirm({
      title: "Revoke Claude access?",
      description: "Claude will lose access to your store immediately.",
      confirmLabel: "Revoke",
      destructive: true,
    });
    if (!ok) return;
    setWorking(true);
    const { error } = await supabase
      .from("sonic_mcp_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", token.id);
    setWorking(false);
    if (error) return toast.error(error.message);
    setRawToken(null);
    setRevealed(false);
    setToken(null);
    toast.success("Access revoked");
  };

  const copy = (text: string, what = "Copied") => {
    navigator.clipboard.writeText(text);
    toast.success(what);
  };

  const maskedToken = useMemo(() => {
    if (!rawToken) return "••••••••••••••••••••••••";
    return rawToken.slice(0, 8) + "•".repeat(24);
  }, [rawToken]);

  const bearerPrefill = rawToken ? `Bearer ${rawToken}` : "Bearer <your-token>";

  return (
    <div className="container max-w-3xl py-8 space-y-6">
      <Link to="/settings" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to Settings
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Sparkles className="h-7 w-7 text-[hsl(280,70%,60%)]" />
            Connect Claude AI
          </h1>
          <p className="text-muted-foreground mt-2">
            Use natural language to manage your store with Claude.
          </p>
        </div>
      </div>

      {/* Connection status */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Connection status</CardTitle>
            <CardDescription>
              {loading
                ? "Checking…"
                : token
                ? token.last_used_at
                  ? `Last used ${timeAgo(token.last_used_at)}`
                  : "Token created — waiting for Claude's first call"
                : "No active token. Generate one to connect Claude."}
            </CardDescription>
          </div>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : token ? (
            <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15 border border-emerald-500/30">
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Connected
            </Badge>
          ) : (
            <Badge variant="secondary">
              <CircleDashed className="h-3.5 w-3.5 mr-1" /> Not connected
            </Badge>
          )}
        </CardHeader>
      </Card>

      {/* Token section / Generate */}
      {!loading && !token && (
        <Card>
          <CardHeader>
            <CardTitle>Generate your connection token</CardTitle>
            <CardDescription>One token per store. Treat it like a password.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={generate} disabled={working}>
              {working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Generate connection token
            </Button>
          </CardContent>
        </Card>
      )}

      {token && (
        <Card>
          <CardHeader>
            <CardTitle>Your connection</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Your connection URL</Label>
              <div className="flex gap-2">
                <Input readOnly value={FUNCTION_URL} className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={() => copy(FUNCTION_URL, "URL copied")}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Your bearer token</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={revealed && rawToken ? rawToken : maskedToken}
                  className="font-mono text-xs"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setRevealed((v) => !v)}
                  disabled={!rawToken}
                  title={rawToken ? "Reveal" : "Token can only be revealed at generation"}
                >
                  {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => rawToken && copy(rawToken, "Token copied")}
                  disabled={!rawToken}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <ShieldAlert className="h-3.5 w-3.5" /> Keep this private. Anyone with this token can read your store data.
              </p>

              {rawToken && (
                <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
                  ⚠ Save this token now — it cannot be shown again after you leave this page.
                </div>
              )}
              {!rawToken && (
                <div className="rounded-md border border-muted bg-muted/30 p-3 text-xs text-muted-foreground">
                  Token is masked. The full value is only shown once at generation. Regenerate if you've lost it.
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="secondary" onClick={regenerate} disabled={working}>
                <RefreshCw className="h-4 w-4 mr-2" /> Regenerate token
              </Button>
              <Button variant="destructive" onClick={revoke} disabled={working}>
                <Trash2 className="h-4 w-4 mr-2" /> Revoke access
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* How to connect */}
      {token && (
        <Card>
          <CardHeader>
            <CardTitle>How to connect</CardTitle>
            <CardDescription>One-time setup in Claude.ai</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 text-sm">
            <Step n={1} title="Copy your connection URL above" />
            <Step
              n={2}
              title="Open Claude.ai"
              body="Go to Settings → Connectors → Add custom connector"
            />
            <Step n={3} title="Fill in the form">
              <div className="mt-2 grid gap-2">
                <KV label="Name" value="Sonic Invoices" onCopy={() => copy("Sonic Invoices", "Copied")} />
                <KV label="URL" value={FUNCTION_URL} onCopy={() => copy(FUNCTION_URL, "URL copied")} />
                <div className="text-xs text-muted-foreground mt-1">Under "Custom Headers":</div>
                <KV label="Header name" value="Authorization" onCopy={() => copy("Authorization", "Copied")} />
                <KV
                  label="Value"
                  value={bearerPrefill}
                  mono
                  onCopy={() => rawToken && copy(bearerPrefill, "Bearer value copied")}
                  disabled={!rawToken}
                />
              </div>
            </Step>
            <Step n={4} title="Start a conversation with Claude">
              <ul className="mt-2 space-y-1 text-muted-foreground">
                <li>• "Show me my SEO gaps"</li>
                <li>• "Which collections need SEO content?"</li>
                <li>• "What are my top brands?"</li>
              </ul>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => window.open("https://claude.ai", "_blank")}
              >
                Open Claude <ExternalLink className="h-3.5 w-3.5 ml-1" />
              </Button>
            </Step>
          </CardContent>
        </Card>
      )}

      {/* Permissions */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What Claude can see</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Chip icon={<Store className="h-3.5 w-3.5" />}>Store overview & brands</Chip>
            <Chip icon={<Folder className="h-3.5 w-3.5" />}>Collections & SEO scores</Chip>
            <Chip icon={<Search className="h-3.5 w-3.5" />}>Competitor gap results</Chip>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What Claude cannot do</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <div>✕ Cannot modify products or collections</div>
            <div>✕ Cannot access payment or customer data</div>
            <div>✕ Cannot trigger invoices or imports</div>
            <p className="italic text-xs text-muted-foreground pt-2">
              This is a read-only connection. Future versions will allow Claude to take actions.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="text-center">
        <Link
          to="/settings/claude-activity"
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4"
        >
          View Claude activity log →
        </Link>
      </div>
    </div>
  );
};

const Step = ({
  n,
  title,
  body,
  children,
}: {
  n: number;
  title: string;
  body?: string;
  children?: React.ReactNode;
}) => (
  <div className="flex gap-3">
    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold">
      {n}
    </div>
    <div className="flex-1">
      <div className="font-medium">{title}</div>
      {body && <div className="text-muted-foreground text-xs mt-0.5">{body}</div>}
      {children}
    </div>
  </div>
);

const KV = ({
  label,
  value,
  mono,
  onCopy,
  disabled,
}: {
  label: string;
  value: string;
  mono?: boolean;
  onCopy: () => void;
  disabled?: boolean;
}) => (
  <div className="flex items-center gap-2">
    <div className="w-28 text-xs text-muted-foreground">{label}</div>
    <code className={`flex-1 px-2 py-1.5 rounded bg-muted text-xs break-all ${mono ? "font-mono" : ""}`}>
      {value}
    </code>
    <Button variant="ghost" size="icon" onClick={onCopy} disabled={disabled}>
      <Copy className="h-3.5 w-3.5" />
    </Button>
  </div>
);

const Chip = ({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) => (
  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-xs">
    {icon}
    {children}
  </div>
);

export default ClaudeConnector;
