import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Bot, Copy, Eye, RefreshCw, Sparkles, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface LlmsTxtRow {
  shop_domain: string;
  content: string;
  word_count: number | null;
  generated_at: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

export default function LlmsTxtCard() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [row, setRow] = useState<LlmsTxtRow | null>(null);
  const [preview, setPreview] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("llms_txt_files")
      .select("shop_domain, content, word_count, generated_at")
      .maybeSingle();
    if (error && error.code !== "PGRST116") {
      // ignore "no rows" — just leave row as null
      console.warn("[llms.txt] load error", error);
    }
    setRow((data as LlmsTxtRow | null) ?? null);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function generate() {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-llms-txt", { body: {} });
      if (error) throw error;
      if (!(data as any)?.ok) throw new Error((data as any)?.error || "Generation failed");
      toast.success("llms.txt generated");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  const publicUrl = row
    ? `${SUPABASE_URL}/functions/v1/serve-llms-txt?shop=${encodeURIComponent(row.shop_domain)}`
    : null;

  async function copyUrl() {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    toast.success("Public URL copied");
  }

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start gap-4">
          <div className="rounded-lg bg-violet-500/15 border border-violet-500/30 p-2.5">
            <Bot className="w-5 h-5 text-violet-300" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm">AI Discoverability File</h3>
              {loading ? (
                <Badge variant="outline" className="text-[10px]">Loading…</Badge>
              ) : row ? (
                <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px]">
                  Generated · {timeAgo(row.generated_at)}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                  Not generated
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Help ChatGPT, Perplexity, and Claude recommend your store.
            </p>

            {row && publicUrl && (
              <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5">
                <code className="text-[11px] truncate flex-1 font-mono">{publicUrl}</code>
                <Button size="sm" variant="ghost" onClick={copyUrl} className="h-7 px-2">
                  <Copy className="w-3 h-3" />
                </Button>
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center h-7 px-2 rounded-md hover:bg-muted text-muted-foreground"
                  title="Open"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}

            <div className="mt-3 flex items-center gap-2 flex-wrap">
              {!row ? (
                <Button size="sm" onClick={generate} disabled={busy}>
                  {busy ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Sparkles className="mr-2 h-3 w-3" />}
                  Generate llms.txt
                </Button>
              ) : (
                <>
                  <Button size="sm" variant="secondary" onClick={() => setPreview(true)}>
                    <Eye className="mr-2 h-3 w-3" /> Preview
                  </Button>
                  <Button size="sm" variant="outline" onClick={generate} disabled={busy}>
                    {busy ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-2 h-3 w-3" />}
                    Regenerate
                  </Button>
                </>
              )}
              <span className="mx-1 text-muted-foreground/50 text-xs">──</span>
              <Button
                size="sm"
                variant="outline"
                disabled
                title="Adds llms.txt to your store root — coming next"
                className={cn("opacity-50 cursor-not-allowed")}
              >
                Push to your Shopify theme
              </Button>
              <span className="text-[10px] text-muted-foreground">Coming soon</span>
            </div>
          </div>
        </div>
      </CardContent>

      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm">llms.txt preview</DialogTitle>
          </DialogHeader>
          <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap bg-muted/40 p-4 rounded-md max-h-[60vh] overflow-auto border border-border">
{row?.content ?? ""}
          </pre>
          <div className="text-[10px] text-muted-foreground">
            {row?.word_count ?? 0} words · generated {row ? timeAgo(row.generated_at) : ""}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
