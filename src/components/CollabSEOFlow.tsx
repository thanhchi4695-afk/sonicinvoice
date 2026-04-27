import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2, Check, Copy, Loader2, ExternalLink, RefreshCw, Mail, Link, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { addAuditEntry } from "@/lib/audit-log";

interface CollabSEOFlowProps {
  onBack: () => void;
}

interface Partner {
  id: string;
  name: string;
  url: string;
  email: string;
  contactName: string;
  note: string;
  hasBlog: boolean | null;
  summary: string;
  addedAt: string;
}

interface CampaignPartner {
  partnerId: string;
  status: "invited" | "agreed" | "declined" | "no_response";
  responseNote: string;
  backlinkLive: boolean | null;
  backlinkAnchor: string;
  lastChecked: string;
  emailSent: boolean;
  emailSentAt: string;
}

interface DraftEmail {
  partnerId: string;
  subject: string;
  body: string;
}

interface Campaign {
  id: string;
  theme: string;
  createdAt: string;
  partners: CampaignPartner[];
  blogPostMarkdown: string;
  blogPostHtml: string;
  emailsDrafted: DraftEmail[];
}

type Step = 1 | 2 | 3 | 4;
const stepLabels = ["Partners", "Blog post", "Outreach", "Tracker"];

const uuid = () => crypto.randomUUID();

// localStorage helpers
function getPartners(): Partner[] {
  try { return JSON.parse(localStorage.getItem("collab_partners") || "[]"); } catch { return []; }
}
function savePartners(p: Partner[]) { localStorage.setItem("collab_partners", JSON.stringify(p)); }
function getCampaigns(): Campaign[] {
  try { return JSON.parse(localStorage.getItem("collab_campaigns") || "[]"); } catch { return []; }
}
function saveCampaigns(c: Campaign[]) { localStorage.setItem("collab_campaigns", JSON.stringify(c)); }

const SUGGESTIONS = [
  { name: "Stomp Shoes Darwin", url: "stompshoesdarwin.com.au", note: "footwear boutique Darwin" },
  { name: "Pinkhill Darwin", url: "pinkhill.com.au", note: "women's clothing boutique Darwin" },
  { name: "Lulu & Daw", url: "luluanddaw.com.au", note: "women's fashion boutique Darwin" },
];

const CollabSEOFlow = ({ onBack }: CollabSEOFlowProps) => {
  const [step, setStep] = useState<Step>(1);
  const [partners, setPartners] = useState<Partner[]>(getPartners);

  // Form
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formContact, setFormContact] = useState("");
  const [formNote, setFormNote] = useState("");

  // Step 2
  const [themes, setThemes] = useState<string[]>([]);
  const [selectedTheme, setSelectedTheme] = useState("");
  const [customTheme, setCustomTheme] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [targetLength, setTargetLength] = useState<string>("650–800");
  const [cta, setCta] = useState("");
  const [blogPost, setBlogPost] = useState("");
  const [generating, setGenerating] = useState(false);
  const [loadingThemes, setLoadingThemes] = useState(false);
  const [editing, setEditing] = useState(false);

  // Step 3
  const [emails, setEmails] = useState<DraftEmail[]>([]);
  const [emailsGenerating, setEmailsGenerating] = useState(false);
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [followUp, setFollowUp] = useState(true);
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);

  // Step 4
  const [campaign, setCampaign] = useState<Campaign | null>(null);

  // Save partners on change
  useEffect(() => { savePartners(partners); }, [partners]);

  const addPartner = () => {
    if (!formName.trim() || !formUrl.trim()) return;
    const p: Partner = {
      id: uuid(), name: formName.trim(), url: formUrl.trim().replace(/^https?:\/\//, ""),
      email: formEmail.trim(), contactName: formContact.trim(), note: formNote.trim(),
      hasBlog: null, summary: "", addedAt: new Date().toISOString(),
    };
    const updated = [...partners, p];
    setPartners(updated);
    setFormName(""); setFormUrl(""); setFormEmail(""); setFormContact(""); setFormNote("");
    checkBlog(p, updated);
  };

  const addSuggestion = (s: typeof SUGGESTIONS[0]) => {
    setFormName(s.name); setFormUrl(s.url); setFormNote(s.note);
  };

  const removePartner = (id: string) => setPartners(partners.filter(p => p.id !== id));

  const checkBlog = async (p: Partner, list: Partner[]) => {
    try {
      const url = p.url.startsWith("http") ? p.url : `https://${p.url}`;
      const res = await fetch(url, { mode: "no-cors" });
      // no-cors returns opaque response, so we can't check HTML
      // set hasBlog to null (pending)
      setPartners(prev => prev.map(x => x.id === p.id ? { ...x, hasBlog: null } : x));
    } catch {
      setPartners(prev => prev.map(x => x.id === p.id ? { ...x, hasBlog: null } : x));
    }
  };

  // Step 2: Generate themes
  const generateThemes = async () => {
    setLoadingThemes(true);
    try {
      const { data, error } = await supabase.functions.invoke("collab-seo", {
        body: { type: "themes", partners },
      });
      if (error) throw error;
      setThemes(data.themes || []);
    } catch {
      setThemes([
        "Darwin's best women's fashion boutiques this season",
        "Shop local Darwin: the ultimate fashion guide",
        "Darwin style guide: where to find every look",
        "Supporting Darwin fashion this autumn",
      ]);
    } finally { setLoadingThemes(false); }
  };

  useEffect(() => {
    if (step === 2 && themes.length === 0) generateThemes();
  }, [step]);

  const generateBlogPost = async () => {
    const theme = showCustom ? customTheme : selectedTheme;
    if (!theme) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("collab-seo", {
        body: { type: "blog", partners, theme, targetLength, cta },
      });
      if (error) throw error;
      setBlogPost(data.content || "");
    } catch (e: any) {
      setBlogPost("Error generating blog post. Please try again.");
    } finally { setGenerating(false); }
  };

  const getLinkCount = () => {
    return (blogPost.match(/\[LINK:[^\]]+\]/g) || []).length;
  };

  const toMarkdown = (text: string) => {
    return text.replace(/([^[\]]+)\[LINK:([^\]]+)\]/g, "[$1]($2)");
  };

  const toHtml = (text: string) => {
    return text.replace(/([^[\]]+)\[LINK:([^\]]+)\]/g, '<a href="https://$2">$1</a>');
  };

  const toPlain = (text: string) => {
    return text.replace(/\[LINK:[^\]]+\]/g, "");
  };

  const highlightedPost = () => {
    const parts = blogPost.split(/(\[LINK:[^\]]+\])/g);
    return parts.map((part, i) => {
      if (part.startsWith("[LINK:")) {
        return <span key={i} className="text-primary font-medium">{part}</span>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  const copyText = async (text: string) => {
    await navigator.clipboard.writeText(text);
  };

  // Step 3: Generate emails
  const generateEmails = async () => {
    setEmailsGenerating(true);
    try {
      const storeName = localStorage.getItem("store_name") || "Our Store";
      const storeUrl = localStorage.getItem("store_url") || "";
      const theme = showCustom ? customTheme : selectedTheme;
      const { data, error } = await supabase.functions.invoke("collab-seo", {
        body: { type: "emails", partners, theme, storeName, storeUrl },
      });
      if (error) throw error;
      const drafts: DraftEmail[] = (data.emails || []).map((e: any, i: number) => ({
        partnerId: partners[i]?.id || "",
        subject: e.subject || "Darwin fashion collab",
        body: e.body || "",
      }));
      setEmails(drafts);
      setSelectedEmails(new Set(drafts.map(d => d.partnerId)));
    } catch {
      const fallback = partners.map(p => ({
        partnerId: p.id,
        subject: `Darwin fashion collab — ${p.name}`,
        body: `Hi ${p.contactName || "there"},\n\nWe're writing a blog post about Darwin's best fashion boutiques and would love to feature ${p.name}. You'd get a backlink and mention to our audience.\n\nInterested in sharing it on your channels too?\n\nCheers`,
      }));
      setEmails(fallback);
      setSelectedEmails(new Set(fallback.map(d => d.partnerId)));
    } finally { setEmailsGenerating(false); }
  };

  useEffect(() => {
    if (step === 3 && emails.length === 0) generateEmails();
  }, [step]);

  const openMailto = (email: DraftEmail) => {
    const partner = partners.find(p => p.id === email.partnerId);
    if (!partner?.email) return;
    const mailto = `mailto:${partner.email}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`;
    window.open(mailto, "_blank");
  };

  // Step 4: Create campaign
  const createCampaign = () => {
    const theme = showCustom ? customTheme : selectedTheme;
    const c: Campaign = {
      id: uuid(),
      theme,
      createdAt: new Date().toISOString(),
      partners: partners.map(p => ({
        partnerId: p.id,
        status: "invited",
        responseNote: "",
        backlinkLive: null,
        backlinkAnchor: "",
        lastChecked: "",
        emailSent: selectedEmails.has(p.id),
        emailSentAt: selectedEmails.has(p.id) ? new Date().toISOString() : "",
      })),
      blogPostMarkdown: toMarkdown(blogPost),
      blogPostHtml: toHtml(blogPost),
      emailsDrafted: emails,
    };
    const campaigns = getCampaigns();
    campaigns.unshift(c);
    saveCampaigns(campaigns);
    setCampaign(c);

    // Save follow-up reminder
    if (followUp) {
      const reminders = JSON.parse(localStorage.getItem("collab_followup_reminders") || "[]");
      reminders.push({ campaignId: c.id, dueDate: new Date(Date.now() + 7 * 86400000).toISOString(), dismissed: false });
      localStorage.setItem("collab_followup_reminders", JSON.stringify(reminders));
    }

    addAuditEntry("SEO Campaign", `Created collab SEO campaign: ${theme} — ${partners.length} partners`);
    setStep(4);
  };

  const updateCampaignPartner = (partnerId: string, updates: Partial<CampaignPartner>) => {
    if (!campaign) return;
    const updated = {
      ...campaign,
      partners: campaign.partners.map(p => p.partnerId === partnerId ? { ...p, ...updates } : p),
    };
    setCampaign(updated);
    const campaigns = getCampaigns().map(c => c.id === updated.id ? updated : c);
    saveCampaigns(campaigns);
  };

  const checkBacklink = async (partnerId: string) => {
    const partner = partners.find(p => p.id === partnerId);
    if (!partner) return;
    updateCampaignPartner(partnerId, { lastChecked: new Date().toISOString() });
    try {
      const url = partner.url.startsWith("http") ? partner.url : `https://${partner.url}`;
      const res = await fetch(url);
      const html = await res.text();
      const storeUrl = localStorage.getItem("store_url") || "";
      const storeDomain = storeUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
      if (storeDomain && html.includes(storeDomain)) {
        const match = html.match(new RegExp(`<a[^>]*href="[^"]*${storeDomain.replace(/\./g, "\\.")}[^"]*"[^>]*>([^<]+)<`, "i"));
        updateCampaignPartner(partnerId, { backlinkLive: true, backlinkAnchor: match?.[1] || "Link found" });
      } else {
        updateCampaignPartner(partnerId, { backlinkLive: false });
      }
    } catch {
      updateCampaignPartner(partnerId, { backlinkLive: null });
    }
  };

  return (
    <div className="min-h-screen bg-background animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-2">
        <button onClick={step === 1 ? onBack : () => setStep((step - 1) as Step)} className="text-muted-foreground">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold font-display flex-1">Local collab SEO</h1>
        <span className="text-xs text-muted-foreground font-mono-data">Step {step}/4</span>
      </div>

      {/* Step progress */}
      <div className="flex gap-1 px-4 mb-4">
        {stepLabels.map((label, i) => (
          <div key={label} className="flex-1">
            <div className={`h-1 rounded-full transition-colors ${i + 1 <= step ? "bg-primary" : "bg-muted"}`} />
            <p className={`text-[10px] mt-1 text-center ${i + 1 === step ? "text-foreground font-medium" : "text-muted-foreground"}`}>{label}</p>
          </div>
        ))}
      </div>

      <div className="px-4 pb-24">
        {/* ─── STEP 1: Partners ─── */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold mb-1">Your collab partners</h2>
              <p className="text-sm text-muted-foreground">Add local businesses to collaborate with. Each one will be linked in the blog post.</p>
            </div>

            {/* Partner list */}
            {partners.length > 0 && (
              <div className="space-y-2">
                {partners.map(p => (
                  <div key={p.id} className="bg-card rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">{p.name}</p>
                        <p className="text-xs font-mono-data text-primary truncate">{p.url}</p>
                        {p.email && <p className="text-xs text-muted-foreground">{p.email}</p>}
                        {p.note && <p className="text-xs text-muted-foreground italic mt-0.5">{p.note}</p>}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`w-2 h-2 rounded-full ${p.hasBlog === true ? "bg-green-500" : p.hasBlog === false ? "bg-muted-foreground" : "bg-muted-foreground/40"}`} />
                        <span className="text-[10px] text-muted-foreground">
                          {p.hasBlog === true ? "Has blog" : p.hasBlog === false ? "Homepage" : "Pending"}
                        </span>
                        <button onClick={() => removePartner(p.id)} className="text-muted-foreground hover:text-destructive ml-1">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Suggestions when empty */}
            {partners.length === 0 && (
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map(s => (
                  <button key={s.name} onClick={() => addSuggestion(s)} className="px-3 py-1.5 rounded-full border border-border text-xs font-medium hover:bg-primary/10 hover:border-primary/30 transition-colors">
                    {s.name}
                  </button>
                ))}
                <button
                  onClick={() => {
                    const el = document.getElementById("collab-add-partner-form");
                    el?.scrollIntoView({ behavior: "smooth", block: "center" });
                    el?.querySelector<HTMLInputElement>("input")?.focus();
                  }}
                  className="px-3 py-1.5 rounded-full border border-border text-xs font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
                >
                  + Add your own
                </button>
              </div>
            )}

            {/* Add form */}
            <div id="collab-add-partner-form" className="bg-card rounded-lg border border-border p-3 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Add partner</p>
              <Input placeholder="Business name" value={formName} onChange={e => setFormName(e.target.value)} className="h-9 text-sm" />
              <Input placeholder="Website URL (e.g. pinkhill.com.au)" value={formUrl} onChange={e => setFormUrl(e.target.value)} className="h-9 text-sm" />
              <Input placeholder="Contact email" value={formEmail} onChange={e => setFormEmail(e.target.value)} className="h-9 text-sm" />
              <Input placeholder="Contact name (optional)" value={formContact} onChange={e => setFormContact(e.target.value)} className="h-9 text-sm" />
              <Input placeholder="Note (e.g. women's clothing boutique Darwin)" value={formNote} onChange={e => setFormNote(e.target.value)} className="h-9 text-sm" />
              <Button variant="outline" className="w-full" onClick={addPartner} disabled={!formName.trim() || !formUrl.trim()}>
                <Plus className="w-4 h-4 mr-1" /> Add partner
              </Button>
            </div>

            <Button variant="teal" className="w-full h-12 text-base" disabled={partners.length < 2} onClick={() => setStep(2)}>
              Next → Write blog post <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* ─── STEP 2: Blog Post ─── */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold mb-1">AI writes the blog post</h2>
              <p className="text-sm text-muted-foreground">Every partner gets mentioned and linked naturally in the content.</p>
            </div>

            {/* Theme selector */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Blog post topic</p>
              {loadingThemes ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Generating themes...</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {themes.map(t => (
                    <button key={t} onClick={() => { setSelectedTheme(t); setShowCustom(false); }}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${selectedTheme === t && !showCustom ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary/30"}`}>
                      {t}
                    </button>
                  ))}
                  <button onClick={() => setShowCustom(true)} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${showCustom ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary/30"}`}>
                    Custom topic...
                  </button>
                </div>
              )}
              {showCustom && <Input placeholder="Enter your custom topic..." value={customTheme} onChange={e => setCustomTheme(e.target.value)} className="mt-2 h-9 text-sm" />}
            </div>

            {/* Target length */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Target length</p>
              <div className="flex gap-2">
                {[{ label: "Short (400–500 words)", value: "400–500" }, { label: "Standard (650–800 words)", value: "650–800" }, { label: "Long (900–1100 words)", value: "900–1100" }].map(o => (
                  <button key={o.value} onClick={() => setTargetLength(o.value)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors flex-1 ${targetLength === o.value ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}>
                    {o.label.split(" (")[0]}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">{targetLength === "650–800" ? "Recommended" : targetLength === "400–500" ? "Quick read" : "Detailed guide"}</p>
            </div>

            {/* CTA */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Call to action (optional)</p>
              <Input placeholder="e.g. Shop your local Darwin boutiques this weekend" value={cta} onChange={e => setCta(e.target.value)} className="h-9 text-sm" />
            </div>

            {/* Generate */}
            <Button variant="teal" className="w-full h-12 text-base" onClick={generateBlogPost} disabled={generating || (!selectedTheme && !customTheme)}>
              {generating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Writing your blog post...</> : "✨ Generate blog post"}
            </Button>

            {/* Blog preview */}
            {blogPost && !generating && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium bg-primary/15 text-primary px-2 py-0.5 rounded-full">{getLinkCount()} partner links included</span>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(!editing)} className="text-xs h-7">{editing ? "Preview" : "Edit post"}</Button>
                    <Button variant="outline" size="sm" onClick={generateBlogPost} className="text-xs h-7"><RefreshCw className="w-3 h-3 mr-1" /> Regenerate</Button>
                  </div>
                </div>

                {editing ? (
                  <Textarea value={blogPost} onChange={e => setBlogPost(e.target.value)} className="min-h-[300px] text-sm font-mono-data" />
                ) : (
                  <div className="bg-card rounded-lg border border-border p-4 max-h-[400px] overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap">
                    {highlightedPost()}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2">
                  <Button variant="outline" size="sm" className="text-xs" onClick={() => copyText(toMarkdown(blogPost))}>
                    <Copy className="w-3 h-3 mr-1" /> Markdown
                  </Button>
                  <Button variant="outline" size="sm" className="text-xs" onClick={() => copyText(toHtml(blogPost))}>
                    <Copy className="w-3 h-3 mr-1" /> HTML
                  </Button>
                  <Button variant="outline" size="sm" className="text-xs" onClick={() => copyText(toPlain(blogPost))}>
                    <Copy className="w-3 h-3 mr-1" /> Plain text
                  </Button>
                </div>

                <Button variant="teal" className="w-full h-12 text-base" onClick={() => setStep(3)}>
                  Next → Write outreach emails <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ─── STEP 3: Outreach Emails ─── */}
        {step === 3 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold mb-1">Personalised outreach emails</h2>
              <p className="text-sm text-muted-foreground">One email per partner. Each is unique — not a template.</p>
            </div>

            {emailsGenerating ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                <Loader2 className="w-5 h-5 animate-spin" /> Drafting personalised emails...
              </div>
            ) : (
              <>
                {/* Select all */}
                <div className="flex items-center gap-3">
                  <button onClick={() => setSelectedEmails(new Set(emails.map(e => e.partnerId)))} className="text-xs text-primary hover:underline">Select all</button>
                  <button onClick={() => setSelectedEmails(new Set())} className="text-xs text-muted-foreground hover:underline">Deselect all</button>
                </div>

                <div className="space-y-3">
                  {emails.map(email => {
                    const partner = partners.find(p => p.id === email.partnerId);
                    if (!partner) return null;
                    return (
                      <div key={email.partnerId} className="bg-card rounded-lg border border-border p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <input type="checkbox" checked={selectedEmails.has(email.partnerId)}
                            onChange={e => {
                              const next = new Set(selectedEmails);
                              e.target.checked ? next.add(email.partnerId) : next.delete(email.partnerId);
                              setSelectedEmails(next);
                            }} className="rounded" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold">{partner.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{partner.email || "No email"}</p>
                          </div>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-0.5">Subject</p>
                          <Input value={email.subject} onChange={e => {
                            setEmails(prev => prev.map(em => em.partnerId === email.partnerId ? { ...em, subject: e.target.value } : em));
                          }} className="h-8 text-xs" />
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-0.5">Body</p>
                          <Textarea value={email.body} onChange={e => {
                            setEmails(prev => prev.map(em => em.partnerId === email.partnerId ? { ...em, body: e.target.value } : em));
                          }} className="min-h-[120px] text-xs" />
                          <p className="text-[10px] text-muted-foreground text-right mt-0.5">{email.body.length} chars</p>
                        </div>
                        <div className="flex gap-2">
                          {partner.email && (
                            <Button variant="outline" size="sm" className="text-xs flex-1" onClick={() => openMailto(email)}>
                              <Mail className="w-3 h-3 mr-1" /> Open in mail
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" className="text-xs" onClick={() => {
                            copyText(`Subject: ${email.subject}\n\n${email.body}`);
                            setCopiedEmail(email.partnerId);
                            setTimeout(() => setCopiedEmail(null), 1500);
                          }}>
                            {copiedEmail === email.partnerId ? <Check className="w-3 h-3 mr-1" /> : <Copy className="w-3 h-3 mr-1" />}
                            {copiedEmail === email.partnerId ? "Copied" : "Copy"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Follow-up */}
                <div className="flex items-center gap-2 bg-card rounded-lg border border-border p-3">
                  <input type="checkbox" checked={followUp} onChange={e => setFollowUp(e.target.checked)} className="rounded" />
                  <span className="text-sm">Remind me to follow up in 7 days if no response</span>
                </div>

                <Button variant="teal" className="w-full h-12 text-base" onClick={createCampaign}>
                  Next → Track your campaign <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </>
            )}
          </div>
        )}

        {/* ─── STEP 4: Tracker ─── */}
        {step === 4 && campaign && (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold mb-1">Campaign tracker</h2>
              <p className="text-sm text-muted-foreground">Track who responded and which backlinks are live.</p>
            </div>

            {/* Summary */}
            <div className="bg-card rounded-lg border border-border p-4 space-y-2">
              <p className="text-sm font-semibold">{campaign.theme}</p>
              <div className="grid grid-cols-2 gap-y-1 text-xs">
                <span className="text-muted-foreground">Started:</span>
                <span>{new Date(campaign.createdAt).toLocaleDateString("en-AU")}</span>
                <span className="text-muted-foreground">Partners contacted:</span>
                <span>{campaign.partners.length}</span>
                <span className="text-muted-foreground">Emails sent:</span>
                <span>{campaign.partners.filter(p => p.emailSent).length}</span>
                <span className="text-muted-foreground">Backlinks live:</span>
                <span>{campaign.partners.filter(p => p.backlinkLive === true).length} / {campaign.partners.length}</span>
              </div>
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => {
                copyText(campaign.blogPostHtml);
              }}>
                <Copy className="w-3 h-3 mr-1" /> Copy blog post
              </Button>
            </div>

            {/* Partner status */}
            <div className="space-y-2">
              {campaign.partners.map(cp => {
                const partner = partners.find(p => p.id === cp.partnerId);
                if (!partner) return null;
                const statuses: { value: CampaignPartner["status"]; icon: string; label: string }[] = [
                  { value: "invited", icon: "⏳", label: "Invited" },
                  { value: "agreed", icon: "✅", label: "Agreed" },
                  { value: "declined", icon: "❌", label: "Declined" },
                  { value: "no_response", icon: "💬", label: "No response" },
                ];

                return (
                  <div key={cp.partnerId} className="bg-card rounded-lg border border-border p-3 space-y-2">
                    <p className="text-sm font-semibold">{partner.name}</p>

                    {/* Status */}
                    <div className="flex flex-wrap gap-1">
                      {statuses.map(s => (
                        <button key={s.value} onClick={() => updateCampaignPartner(cp.partnerId, { status: s.value })}
                          className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${cp.status === s.value ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}>
                          {s.icon} {s.label}
                        </button>
                      ))}
                    </div>

                    {/* Response note */}
                    <Input placeholder="Response notes..." value={cp.responseNote} onChange={e => updateCampaignPartner(cp.partnerId, { responseNote: e.target.value })} className="h-8 text-xs" />

                    {/* Backlink check */}
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" className="text-xs" onClick={() => checkBacklink(cp.partnerId)}>
                        <Link className="w-3 h-3 mr-1" /> Check link
                      </Button>
                      {cp.backlinkLive === true && <span className="text-xs text-green-500 font-medium">✓ Live {cp.backlinkAnchor && `— "${cp.backlinkAnchor}"`}</span>}
                      {cp.backlinkLive === false && <span className="text-xs text-amber-500">Not yet live</span>}
                      {cp.backlinkLive === null && cp.lastChecked && <span className="text-[10px] text-muted-foreground">Check pending (CORS)</span>}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      {partner.email && (
                        <Button variant="ghost" size="sm" className="text-xs" onClick={() => {
                          const email = campaign.emailsDrafted.find(e => e.partnerId === cp.partnerId);
                          if (email) openMailto(email);
                        }}>
                          <Mail className="w-3 h-3 mr-1" /> Resend
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="text-xs" onClick={() => copyText(campaign.blogPostHtml)}>
                        <Copy className="w-3 h-3 mr-1" /> Copy post
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Next campaign prompt */}
            <div className="bg-card rounded-lg border border-primary/20 p-4 mt-4">
              <p className="text-sm font-semibold">Run your next collab campaign</p>
              <p className="text-xs text-muted-foreground mt-1">
                Seasonal rotation keeps content fresh and relationships warm. Plan the next one for {new Date(Date.now() + 90 * 86400000).toLocaleString("en-AU", { month: "long" })}.
              </p>
              <Button variant="outline" className="w-full mt-3" onClick={() => {
                setBlogPost(""); setEmails([]); setThemes([]);
                setCampaign(null); setStep(1);
              }}>
                Plan next campaign →
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CollabSEOFlow;
