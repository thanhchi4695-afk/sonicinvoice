import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, X, Copy, ShieldAlert, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

interface SecretItem {
  name: string;
  group: "ai" | "xero" | "myob";
  default: string;
  purpose: string;
  configured: boolean;
}

const GROUP_LABEL: Record<SecretItem["group"], string> = {
  ai: "AI Gateway",
  xero: "Xero",
  myob: "MYOB",
};

const AdminSecrets = () => {
  const [items, setItems] = useState<SecretItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("check-optional-secrets");
        if (error) throw error;
        setItems(data.items);
      } catch (e: any) {
        setError(e?.message || "Failed to load secrets status");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: text });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-md">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              <CardTitle>Access denied</CardTitle>
            </div>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link to="/dashboard">Back to dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const groups: SecretItem["group"][] = ["ai", "xero", "myob"];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto px-6 py-10 space-y-8">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold">Optional environment variables</h1>
          <p className="text-sm text-muted-foreground">
            Override defaults by setting these in Lovable Cloud → Backend → Secrets. Values are never displayed — only configuration status.
          </p>
        </header>

        {groups.map((g) => {
          const groupItems = items?.filter((i) => i.group === g) ?? [];
          const setCount = groupItems.filter((i) => i.configured).length;
          return (
            <Card key={g}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{GROUP_LABEL[g]}</CardTitle>
                  <Badge variant={setCount > 0 ? "default" : "secondary"}>
                    {setCount}/{groupItems.length} overridden
                  </Badge>
                </div>
                <CardDescription>
                  Defaults are used unless an override is set. All defaults are production-safe.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {groupItems.map((item) => (
                  <div key={item.name} className="rounded-lg border border-border p-3 flex items-start gap-3">
                    <div className="mt-0.5">
                      {item.configured ? (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <Check className="h-3.5 w-3.5" />
                        </span>
                      ) : (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          <X className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-mono font-semibold">{item.name}</code>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2"
                          onClick={() => copy(item.name)}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                        {item.configured ? (
                          <Badge variant="outline" className="text-xs">Override active</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">Using default</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{item.purpose}</p>
                      <p className="text-xs text-muted-foreground mt-1 font-mono break-all">
                        Default: {item.default}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })}

          <footer className="pt-4 border-t border-border">
          <BackButton to="/dashboard" />
        </footer>
      </div>
    </div>
  );
};

export default AdminSecrets;
