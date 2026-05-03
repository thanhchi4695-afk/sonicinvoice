import { useEffect, useState } from "react";
import {
  Mail, Upload, X, Send, CheckCircle2, Loader2, ArrowLeft,
  FileText, ShoppingBag, Tag, Wand2, CreditCard, Bug, HelpCircle, Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

const supportSchema = z.object({
  email: z.string().trim().email("Please enter a valid email").max(255),
  name: z.string().trim().max(100).optional(),
  message: z.string().trim().min(10, "Message must be at least 10 characters").max(2000, "Message must be under 2000 characters"),
});

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];

type TopicId =
  | "invoice" | "shopify" | "tags" | "enrichment"
  | "billing" | "bug" | "feature" | "other";

interface Topic {
  id: TopicId;
  label: string;
  icon: React.ElementType;
  template: string;
}

const TOPICS: Topic[] = [
  {
    id: "invoice",
    label: "Invoice processing",
    icon: FileText,
    template:
      "Topic: Invoice processing\n\n" +
      "Supplier / brand: \n" +
      "Invoice file type (PDF / Excel / photo): \n" +
      "What I expected: \n" +
      "What happened instead: \n",
  },
  {
    id: "shopify",
    label: "Shopify connection",
    icon: ShoppingBag,
    template:
      "Topic: Shopify connection\n\n" +
      "Store URL (e.g. mystore.myshopify.com): \n" +
      "Connection type (App Store / Custom App): \n" +
      "What I'm trying to do: \n" +
      "Error message (if any): \n",
  },
  {
    id: "tags",
    label: "Tags & categorisation",
    icon: Tag,
    template:
      "Topic: Tags & categorisation\n\n" +
      "Industry profile: \n" +
      "Product example (title or SKU): \n" +
      "Tags I expected: \n" +
      "Tags I actually got: \n",
  },
  {
    id: "enrichment",
    label: "RRP / AI enrichment",
    icon: Wand2,
    template:
      "Topic: RRP / AI enrichment\n\n" +
      "Brand: \n" +
      "Product example: \n" +
      "Issue (wrong RRP / missing data / low confidence): \n" +
      "What the correct value should be: \n",
  },
  {
    id: "billing",
    label: "Billing & subscription",
    icon: CreditCard,
    template:
      "Topic: Billing & subscription\n\n" +
      "Current plan: \n" +
      "What I'd like to change: \n" +
      "Invoice / charge in question (if any): \n",
  },
  {
    id: "bug",
    label: "Report a bug",
    icon: Bug,
    template:
      "Topic: Bug report\n\n" +
      "Page / screen: \n" +
      "Steps to reproduce:\n  1. \n  2. \n  3. \n" +
      "What I expected: \n" +
      "What happened: \n" +
      "Browser / device: \n",
  },
  {
    id: "feature",
    label: "Feature request",
    icon: Sparkles,
    template:
      "Topic: Feature request\n\n" +
      "What I'd love to do: \n" +
      "Why this would help: \n" +
      "How I work around it today: \n",
  },
  {
    id: "other",
    label: "Something else",
    icon: HelpCircle,
    template: "",
  },
];


const Support = () => {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [topic, setTopic] = useState<TopicId | null>(null);

  const selectTopic = (t: Topic) => {
    setTopic(t.id);
    // Only overwrite the message if it's empty or matches an existing template
    const isExistingTemplate = TOPICS.some((x) => x.template && message.trim() === x.template.trim());
    if (!message.trim() || isExistingTemplate) {
      setMessage(t.template);
    }
  };

  useEffect(() => {
    document.title = "Contact Support — Sonic Invoices";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", "Send a question to Sonic Invoices support. Attach a screenshot and we'll get back to you.");
  }, []);

  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handleFile = (f: File | null) => {
    if (!f) { setFile(null); return; }
    if (!ALLOWED_TYPES.includes(f.type)) {
      toast({ title: "Unsupported file", description: "Please upload a PNG, JPG, WEBP, or GIF image.", variant: "destructive" });
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      toast({ title: "File too large", description: "Screenshot must be smaller than 10 MB.", variant: "destructive" });
      return;
    }
    setFile(f);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = supportSchema.safeParse({ email, name: name || undefined, message });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      toast({ title: "Please fix the form", description: first.message, variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      let screenshotUrl: string | undefined;

      if (file) {
        const ext = (file.name.split(".").pop() || "png").toLowerCase();
        const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("support-screenshots")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) throw upErr;
        const { data } = supabase.storage.from("support-screenshots").getPublicUrl(path);
        screenshotUrl = data.publicUrl;
      }

      const idempotencyKey = `support-${crypto.randomUUID()}`;
      const { error: fnErr } = await supabase.functions.invoke("send-transactional-email", {
        body: {
          templateName: "support-request",
          recipientEmail: "thanhchi4695@gmail.com",
          idempotencyKey,
          replyTo: parsed.data.email,
          templateData: {
            customerEmail: parsed.data.email,
            customerName: parsed.data.name || "",
            topic: topic ? TOPICS.find((t) => t.id === topic)?.label || "" : "",
            message: parsed.data.message,
            screenshotUrl: screenshotUrl || "",
            pageUrl: typeof window !== "undefined" ? window.location.href : "",
            submittedAt: new Date().toLocaleString(),
          },
        },
      });
      if (fnErr) throw fnErr;

      setDone(true);
      setEmail(""); setName(""); setMessage(""); setFile(null); setTopic(null);
      toast({ title: "Message sent", description: "We've received your question and will reply soon." });
    } catch (err) {
      console.error("Support submit failed", err);
      toast({ title: "Couldn't send your message", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-xl mx-auto px-6 py-12">
        <div className="mb-6">
          <BackButton to="/dashboard" />
        </div>

        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Mail className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-2xl font-bold font-display">Contact support</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-8">
          Have a question or hit a snag? Send us a message and attach a screenshot — we'll reply by email.
        </p>

        {done ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center animate-fade-in">
            <CheckCircle2 className="w-12 h-12 text-primary mx-auto mb-3" />
            <h2 className="text-lg font-semibold mb-1">Message sent!</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Thanks for reaching out. We'll reply to your email shortly.
            </p>
            <Button onClick={() => setDone(false)} variant="outline">Send another message</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Your email *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                maxLength={255}
                placeholder="you@example.com"
                className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Your name (optional)</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                placeholder="Jane Doe"
                className="w-full h-10 rounded-lg bg-input border border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2">
                What's this about? <span className="text-muted-foreground/60">(optional — pre-fills a template)</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {TOPICS.map((t) => {
                  const Icon = t.icon;
                  const active = topic === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => selectTopic(t)}
                      className={
                        "inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-xs transition-colors " +
                        (active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card border-border text-muted-foreground hover:bg-muted hover:text-foreground")
                      }
                      aria-pressed={active}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Your question * <span className="text-muted-foreground/60">({message.length}/2000)</span>
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                maxLength={2000}
                rows={6}
                placeholder="Tell us what's happening, what you expected, and any steps to reproduce…"
                className="w-full rounded-lg bg-input border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Screenshot (optional)</label>
              {file && preview ? (
                <div className="relative rounded-lg border border-border overflow-hidden">
                  <img src={preview} alt="Screenshot preview" className="w-full max-h-64 object-contain bg-muted" />
                  <button
                    type="button"
                    onClick={() => handleFile(null)}
                    className="absolute top-2 right-2 w-7 h-7 rounded-full bg-background/90 border border-border flex items-center justify-center hover:bg-background"
                    aria-label="Remove screenshot"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <p className="text-[11px] text-muted-foreground p-2 truncate">{file.name} · {(file.size / 1024).toFixed(0)} KB</p>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center gap-2 h-28 rounded-lg border border-dashed border-border bg-card/50 cursor-pointer hover:bg-muted/40 transition-colors">
                  <Upload className="w-5 h-5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">PNG, JPG, WEBP or GIF · max 10 MB</span>
                  <input
                    type="file"
                    accept={ALLOWED_TYPES.join(",")}
                    className="hidden"
                    onChange={(e) => handleFile(e.target.files?.[0] || null)}
                  />
                </label>
              )}
            </div>

            <Button type="submit" disabled={submitting} className="w-full h-11">
              {submitting ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</>
              ) : (
                <><Send className="w-4 h-4 mr-2" /> Send message</>
              )}
            </Button>

            <p className="text-[11px] text-muted-foreground text-center">
              Your message goes directly to the Sonic Invoices team. We typically reply within one business day.
            </p>
          </form>
        )}
      </div>
    </div>
  );
};

export default Support;
