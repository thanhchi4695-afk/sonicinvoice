import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, GripVertical, RefreshCw, Send, Calendar, Plus, Trash2, Eye, ExternalLink, Megaphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import WhatsNextSuggestions from "@/components/WhatsNextSuggestions";

// ── Types ──
interface SocialSettings {
  storeTagline: string;
  storeLocation: string;
  websiteUrl: string;
  brandVoice: string;
  newArrivalTag: string;
  lookbackDays: number;
  defaultPostTime: string;
  postFrequency: string;
  enabledPlatforms: string[];
  autoDetect: boolean;
}

interface SocialPost {
  id: string;
  productTitle: string;
  productBrand: string;
  productType: string;
  productHandle: string;
  imageUrl: string;
  additionalImages: string[];
  colourName: string;
  captionFacebook: string;
  captionInstagram: string;
  captionYoutube: string;
  captionTiktok: string;
  hashtags: string[];
  scheduledAt: string | null;
  sortOrder: number;
  status: "draft" | "scheduled" | "publishing" | "posted" | "failed";
  platformStatus: Record<string, string>;
  postedAt: string | null;
  createdAt: string;
}

interface NewArrival {
  id: string;
  title: string;
  handle: string;
  brand: string;
  type: string;
  tags: string[];
  imageUrl: string;
  additionalImages: string[];
  price: string;
}

const DEFAULT_SETTINGS: SocialSettings = {
  storeTagline: "",
  storeLocation: "",
  websiteUrl: "",
  brandVoice: "trendy",
  newArrivalTag: "new",
  lookbackDays: 30,
  defaultPostTime: "09:00",
  postFrequency: "daily",
  enabledPlatforms: ["facebook", "instagram"],
  autoDetect: true,
};

const VOICE_OPTIONS = [
  { value: "trendy", label: "Trendy" },
  { value: "luxury", label: "Luxury" },
  { value: "casual", label: "Casual" },
  { value: "sporty", label: "Sporty" },
  { value: "inclusive", label: "Inclusive" },
];

// ── Persistence helpers ──
function loadSettings(): SocialSettings {
  try {
    const raw = localStorage.getItem("social_media_settings");
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(s: SocialSettings) {
  localStorage.setItem("social_media_settings", JSON.stringify(s));
}
function loadPosts(): SocialPost[] {
  try {
    return JSON.parse(localStorage.getItem("social_media_posts") || "[]");
  } catch { return []; }
}
function savePosts(p: SocialPost[]) {
  localStorage.setItem("social_media_posts", JSON.stringify(p));
}

// ── Component ──
export default function SocialMediaPanel({ onBack, onStartFlow }: { onBack: () => void; onStartFlow?: (flow: string) => void }) {
  const [tab, setTab] = useState("queue");
  const [settings, setSettings] = useState<SocialSettings>(loadSettings);
  const [posts, setPosts] = useState<SocialPost[]>(loadPosts);
  const [newArrivals, setNewArrivals] = useState<NewArrival[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [editingPost, setEditingPost] = useState<SocialPost | null>(null);
  const [editPlatform, setEditPlatform] = useState<"facebook" | "instagram">("facebook");
  const [showSettings, setShowSettings] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // Persist posts on change
  useEffect(() => { savePosts(posts); }, [posts]);

  // ── Detect new arrivals from Shopify ──
  const detectArrivals = useCallback(async () => {
    setDetecting(true);
    try {
      const conn = localStorage.getItem("shopify_connection");
      if (!conn) { toast.error("Connect your Shopify store first (Account → Shopify)"); setDetecting(false); return; }
      const { store_url, access_token } = JSON.parse(conn);

      const tags = settings.newArrivalTag.split(",").map(t => t.trim()).filter(Boolean);
      const tagQuery = tags.map(t => `tag:${t}`).join(" OR ");
      const lookback = new Date(); lookback.setDate(lookback.getDate() - settings.lookbackDays);

      const { data, error } = await supabase.functions.invoke("shopify-direct-proxy", {
        body: {
          store_url, access_token,
          endpoint: "/admin/api/2024-10/products.json",
          method: "GET",
          params: { limit: 50, created_at_min: lookback.toISOString(), status: "active" },
        },
      });

      if (error) throw error;
      const products = data?.products || [];
      const existingIds = new Set(posts.map(p => p.productHandle));

      const arrivals: NewArrival[] = products
        .filter((p: any) => {
          const pTags = (p.tags || "").split(",").map((t: string) => t.trim().toLowerCase());
          const matchesTag = tags.some(t => pTags.includes(t.toLowerCase()));
          return matchesTag && !existingIds.has(p.handle);
        })
        .map((p: any) => ({
          id: String(p.id),
          title: p.title,
          handle: p.handle,
          brand: p.vendor || "",
          type: p.product_type || "",
          tags: (p.tags || "").split(",").map((t: string) => t.trim()),
          imageUrl: p.images?.[0]?.src || "",
          additionalImages: (p.images || []).slice(1, 5).map((i: any) => i.src),
          price: p.variants?.[0]?.price || "",
        }));

      setNewArrivals(arrivals);
      if (arrivals.length === 0) toast.info("No new arrivals found");
      else toast.success(`Found ${arrivals.length} new arrivals`);
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to detect arrivals: " + (err.message || "Unknown error"));
    } finally {
      setDetecting(false);
    }
  }, [settings, posts]);

  // ── Generate AI captions ──
  const generateCaptions = useCallback(async (arrival: NewArrival) => {
    setGeneratingId(arrival.id);
    try {
      const { data, error } = await supabase.functions.invoke("social-captions", {
        body: {
          product: {
            title: arrival.title,
            brand: arrival.brand,
            type: arrival.type,
            tags: arrival.tags,
          },
          settings: {
            storeTagline: settings.storeTagline,
            storeLocation: settings.storeLocation,
            websiteUrl: settings.websiteUrl,
            brandVoice: settings.brandVoice,
          },
        },
      });

      if (error) throw error;

      const dashMatch = arrival.title.match(/\s-\s(.+?)(?:,\s*\d|$)/);
      const colourName = dashMatch ? dashMatch[1].trim() : "";

      const newPost: SocialPost = {
        id: `sp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        productTitle: arrival.title,
        productBrand: arrival.brand,
        productType: arrival.type,
        productHandle: arrival.handle,
        imageUrl: arrival.imageUrl,
        additionalImages: arrival.additionalImages,
        colourName,
        captionFacebook: data?.facebook || `Just arrived: ${arrival.brand} ${arrival.title}. Now in stock!`,
        captionInstagram: data?.instagram || `Just arrived: ${arrival.brand} ${arrival.title} ✨`,
        captionYoutube: data?.youtube || `${arrival.brand} ${arrival.title} | Now in stock`,
        captionTiktok: data?.tiktok || `New drop: ${arrival.brand} is in ✨`,
        hashtags: data?.hashtags || [`#${arrival.brand.replace(/\s+/g, "")}`, "#swimwear", "#newstock"],
        scheduledAt: null,
        sortOrder: posts.length,
        status: "draft",
        platformStatus: {},
        postedAt: null,
        createdAt: new Date().toISOString(),
      };

      setPosts(prev => [...prev, newPost]);
      setNewArrivals(prev => prev.filter(a => a.id !== arrival.id));
      toast.success(`Added "${arrival.title}" to queue with AI captions`);
    } catch (err: any) {
      console.error(err);
      toast.error("Caption generation failed: " + (err.message || "Unknown error"));
    } finally {
      setGeneratingId(null);
    }
  }, [settings, posts]);

  // ── Regenerate captions for existing post ──
  const regenerateCaptions = useCallback(async (post: SocialPost) => {
    setGeneratingId(post.id);
    try {
      const { data, error } = await supabase.functions.invoke("social-captions", {
        body: {
          product: { title: post.productTitle, brand: post.productBrand, type: post.productType, tags: [] },
          settings: { storeTagline: settings.storeTagline, storeLocation: settings.storeLocation, websiteUrl: settings.websiteUrl, brandVoice: settings.brandVoice },
        },
      });
      if (error) throw error;

      const updated = {
        ...post,
        captionFacebook: data?.facebook || post.captionFacebook,
        captionInstagram: data?.instagram || post.captionInstagram,
        captionYoutube: data?.youtube || post.captionYoutube,
        captionTiktok: data?.tiktok || post.captionTiktok,
        hashtags: data?.hashtags || post.hashtags,
      };

      setPosts(prev => prev.map(p => p.id === post.id ? updated : p));
      if (editingPost?.id === post.id) setEditingPost(updated);
      toast.success("Captions regenerated");
    } catch (err: any) {
      toast.error("Regeneration failed");
    } finally {
      setGeneratingId(null);
    }
  }, [settings, editingPost]);

  // ── Auto-schedule ──
  const autoScheduleAll = useCallback(() => {
    const drafts = posts.filter(p => p.status === "draft" || p.status === "scheduled");
    if (drafts.length === 0) { toast.info("No posts to schedule"); return; }

    const freqDays = settings.postFrequency === "every2days" ? 2 : settings.postFrequency === "weekly" ? 7 : 1;
    const [hours, mins] = settings.defaultPostTime.split(":").map(Number);

    const updated = posts.map((p, i) => {
      const draftIdx = drafts.findIndex(d => d.id === p.id);
      if (draftIdx === -1) return p;
      const date = new Date();
      date.setDate(date.getDate() + draftIdx * freqDays);
      date.setHours(hours, mins, 0, 0);
      return { ...p, scheduledAt: date.toISOString(), status: "scheduled" as const, sortOrder: draftIdx };
    });

    setPosts(updated);
    toast.success(`Scheduled ${drafts.length} posts`);
  }, [posts, settings]);

  // ── Drag and drop ──
  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const reordered = [...posts];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(idx, 0, moved);
    setPosts(reordered.map((p, i) => ({ ...p, sortOrder: i })));
    setDragIdx(idx);
  };
  const handleDragEnd = () => setDragIdx(null);

  // ── Remove post ──
  const removePost = (id: string) => {
    setPosts(prev => prev.filter(p => p.id !== id));
    toast.success("Removed from queue");
  };

  // ── Save edited post ──
  const saveEdit = () => {
    if (!editingPost) return;
    setPosts(prev => prev.map(p => p.id === editingPost.id ? editingPost : p));
    setEditingPost(null);
    toast.success("Post saved");
  };

  // ── Settings save ──
  const handleSaveSettings = () => {
    saveSettings(settings);
    setShowSettings(false);
    toast.success("Settings saved");
  };

  // ── Status badge ──
  const StatusBadge = ({ status }: { status: string }) => {
    const colors: Record<string, string> = {
      draft: "bg-muted text-muted-foreground",
      scheduled: "bg-primary/15 text-primary",
      publishing: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
      posted: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
      failed: "bg-destructive/15 text-destructive",
    };
    return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[status] || colors.draft}`}>{status}</span>;
  };

  const queuePosts = posts.sort((a, b) => a.sortOrder - b.sortOrder);
  const publishedPosts = posts.filter(p => p.status === "posted" || p.status === "failed");

  // ── Settings View ──
  if (showSettings) {
    return (
      <div className="max-w-2xl mx-auto p-4 pb-32">
        <button onClick={() => setShowSettings(false)} className="flex items-center gap-1 text-muted-foreground hover:text-foreground text-sm mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to queue
        </button>
        <h1 className="text-xl font-bold mb-6">Social Media Settings</h1>

        <div className="space-y-6">
          <div className="bg-card rounded-lg border p-4 space-y-4">
            <h2 className="font-semibold">Store Identity</h2>
            <div>
              <label className="text-sm text-muted-foreground">Store tagline</label>
              <input className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm" placeholder="Darwin's favourite swimwear store" value={settings.storeTagline} onChange={e => setSettings(s => ({ ...s, storeTagline: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Location</label>
              <input className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm" placeholder="Darwin, NT" value={settings.storeLocation} onChange={e => setSettings(s => ({ ...s, storeLocation: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Website URL</label>
              <input className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm" placeholder="splashswimwear.com.au" value={settings.websiteUrl} onChange={e => setSettings(s => ({ ...s, websiteUrl: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Brand voice</label>
              <select className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm" value={settings.brandVoice} onChange={e => setSettings(s => ({ ...s, brandVoice: e.target.value }))}>
                {VOICE_OPTIONS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
              </select>
            </div>
          </div>

          <div className="bg-card rounded-lg border p-4 space-y-4">
            <h2 className="font-semibold">New Arrivals Detection</h2>
            <div>
              <label className="text-sm text-muted-foreground">Tag to detect (comma-separated)</label>
              <input className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm" placeholder="new, Mar26" value={settings.newArrivalTag} onChange={e => setSettings(s => ({ ...s, newArrivalTag: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Look back (days)</label>
              <input type="number" min={1} max={90} className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm" value={settings.lookbackDays} onChange={e => setSettings(s => ({ ...s, lookbackDays: Number(e.target.value) || 30 }))} />
            </div>
          </div>

          <div className="bg-card rounded-lg border p-4 space-y-4">
            <h2 className="font-semibold">Posting Schedule</h2>
            <div>
              <label className="text-sm text-muted-foreground">Default post time</label>
              <input type="time" className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm" value={settings.defaultPostTime} onChange={e => setSettings(s => ({ ...s, defaultPostTime: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Frequency</label>
              <select className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm" value={settings.postFrequency} onChange={e => setSettings(s => ({ ...s, postFrequency: e.target.value }))}>
                <option value="daily">Daily</option>
                <option value="every2days">Every 2 days</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Enabled platforms</label>
              <div className="flex gap-4 mt-1">
                {["facebook", "instagram"].map(p => (
                  <label key={p} className="flex items-center gap-2 text-sm capitalize">
                    <input type="checkbox" checked={settings.enabledPlatforms.includes(p)}
                      onChange={e => {
                        setSettings(s => ({
                          ...s,
                          enabledPlatforms: e.target.checked
                            ? [...s.enabledPlatforms, p]
                            : s.enabledPlatforms.filter(x => x !== p),
                        }));
                      }} />
                    {p === "facebook" ? "📘 Facebook" : "📷 Instagram"}
                  </label>
                ))}
              </div>
              <div className="flex gap-4 mt-2">
                {["youtube", "tiktok"].map(p => (
                  <label key={p} className="flex items-center gap-2 text-sm capitalize text-muted-foreground">
                    <input type="checkbox" disabled />
                    {p === "youtube" ? "📹 YouTube" : "🎵 TikTok"} <span className="text-xs">(Coming soon)</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <Button onClick={handleSaveSettings} className="w-full">Save settings</Button>
        </div>
      </div>
    );
  }

  // ── Edit Post View ──
  if (editingPost) {
    const caption = editPlatform === "facebook" ? editingPost.captionFacebook : editingPost.captionInstagram;
    const maxLen = editPlatform === "facebook" ? 63206 : 2200;

    return (
      <div className="max-w-2xl mx-auto p-4 pb-32">
        <button onClick={() => setEditingPost(null)} className="flex items-center gap-1 text-muted-foreground hover:text-foreground text-sm mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to queue
        </button>

        <h1 className="text-lg font-bold mb-1">{editingPost.productBrand}</h1>
        <p className="text-sm text-muted-foreground mb-4">{editingPost.productTitle}</p>

        {/* Image */}
        {editingPost.imageUrl && (
          <div className="mb-4 rounded-lg overflow-hidden border">
            <img src={editingPost.imageUrl} alt={editingPost.productTitle} className="w-full max-h-64 object-cover" />
          </div>
        )}

        {/* Platform tabs */}
        <div className="flex gap-2 mb-4">
          {(["facebook", "instagram"] as const).map(p => (
            <button key={p} onClick={() => setEditPlatform(p)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${editPlatform === p ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              {p === "facebook" ? "📘 Facebook" : "📷 Instagram"}
            </button>
          ))}
        </div>

        {/* Caption editor */}
        <div className="space-y-3">
          <Textarea
            value={caption}
            onChange={e => setEditingPost(prev => prev ? {
              ...prev,
              [editPlatform === "facebook" ? "captionFacebook" : "captionInstagram"]: e.target.value,
            } : null)}
            rows={8}
            className="text-sm"
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{caption.length} / {maxLen.toLocaleString()} chars</span>
            <Button variant="ghost" size="sm" onClick={() => regenerateCaptions(editingPost)} disabled={generatingId === editingPost.id}>
              <RefreshCw className={`w-3 h-3 mr-1 ${generatingId === editingPost.id ? "animate-spin" : ""}`} />
              Regenerate
            </Button>
          </div>
        </div>

        {/* Hashtags (Instagram) */}
        {editPlatform === "instagram" && (
          <div className="mt-4">
            <label className="text-sm font-medium">Hashtags</label>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {editingPost.hashtags.map((tag, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded-full">
                  {tag}
                  <button onClick={() => setEditingPost(prev => prev ? { ...prev, hashtags: prev.hashtags.filter((_, j) => j !== i) } : null)} className="text-muted-foreground hover:text-foreground">×</button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Schedule */}
        <div className="mt-4">
          <label className="text-sm font-medium">Schedule</label>
          <input type="datetime-local" className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm"
            value={editingPost.scheduledAt ? editingPost.scheduledAt.slice(0, 16) : ""}
            onChange={e => setEditingPost(prev => prev ? { ...prev, scheduledAt: e.target.value ? new Date(e.target.value).toISOString() : null, status: e.target.value ? "scheduled" : "draft" } : null)} />
        </div>

        <div className="flex gap-2 mt-6">
          <Button className="flex-1" onClick={saveEdit}>Save</Button>
          <Button variant="outline" onClick={() => setEditingPost(null)}>Cancel</Button>
        </div>
      </div>
    );
  }

  // ── Main View ──
  return (
    <div className="max-w-2xl mx-auto p-4 pb-32">
      <div className="flex items-center justify-between mb-4">
        <button onClick={onBack} className="flex items-center gap-1 text-muted-foreground hover:text-foreground text-sm">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <Button variant="ghost" size="sm" onClick={() => setShowSettings(true)}>⚙️ Settings</Button>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center">
          <Megaphone className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Social Media</h1>
          <p className="text-sm text-muted-foreground">AI captions · schedule · publish</p>
        </div>
      </div>

      {/* Platform connection status */}
      <div className="flex gap-2 mb-4">
        {["facebook", "instagram"].map(p => (
          <div key={p} className="flex items-center gap-1.5 text-xs bg-muted px-2.5 py-1 rounded-full">
            {p === "facebook" ? "📘" : "📷"} <span className="capitalize">{p}</span>
            <span className="text-muted-foreground">· Setup required</span>
          </div>
        ))}
        {["youtube", "tiktok"].map(p => (
          <div key={p} className="flex items-center gap-1.5 text-xs bg-muted/50 px-2.5 py-1 rounded-full text-muted-foreground">
            {p === "youtube" ? "📹" : "🎵"} <span className="capitalize">{p}</span> · Phase 2
          </div>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full">
          <TabsTrigger value="queue" className="flex-1">Queue ({queuePosts.length})</TabsTrigger>
          <TabsTrigger value="published" className="flex-1">Published ({publishedPosts.length})</TabsTrigger>
        </TabsList>

        {/* ── Queue Tab ── */}
        <TabsContent value="queue" className="space-y-4 mt-4">
          {/* Action bar */}
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={detectArrivals} disabled={detecting}>
              {detecting ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> : <Plus className="w-3 h-3 mr-1" />}
              Detect new arrivals
            </Button>
            {queuePosts.length > 0 && (
              <Button size="sm" variant="outline" onClick={autoScheduleAll}>
                <Calendar className="w-3 h-3 mr-1" /> Auto-schedule all
              </Button>
            )}
          </div>

          {/* New arrivals panel */}
          {newArrivals.length > 0 && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
              <h3 className="text-sm font-semibold mb-3">✨ {newArrivals.length} new products detected</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {newArrivals.map(a => (
                  <div key={a.id} className="bg-card rounded-lg border p-3 flex gap-3">
                    {a.imageUrl && <img src={a.imageUrl} alt={a.title} className="w-16 h-16 rounded object-cover shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-primary">{a.brand}</p>
                      <p className="text-sm font-medium truncate">{a.title}</p>
                      {a.price && <p className="text-xs text-muted-foreground">${a.price}</p>}
                      <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => generateCaptions(a)} disabled={generatingId === a.id}>
                        {generatingId === a.id ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> : <Plus className="w-3 h-3 mr-1" />}
                        Add to queue
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Queue list */}
          {queuePosts.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Megaphone className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No posts in queue</p>
              <p className="text-sm mt-1">Click "Detect new arrivals" to find products to post about</p>
            </div>
          ) : (
            <div className="space-y-2">
              {queuePosts.map((post, idx) => (
                <div
                  key={post.id}
                  draggable
                  onDragStart={() => handleDragStart(idx)}
                  onDragOver={e => handleDragOver(e, idx)}
                  onDragEnd={handleDragEnd}
                  className={`bg-card rounded-lg border p-3 flex gap-3 cursor-grab active:cursor-grabbing transition-all ${dragIdx === idx ? "opacity-50 scale-[0.98]" : ""}`}
                >
                  <div className="flex items-center text-muted-foreground">
                    <GripVertical className="w-4 h-4" />
                  </div>
                  {post.imageUrl && <img src={post.imageUrl} alt={post.productTitle} className="w-16 h-16 rounded object-cover shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-xs font-medium text-primary">{post.productBrand}</p>
                      <StatusBadge status={post.status} />
                    </div>
                    <p className="text-sm font-medium truncate">{post.productTitle}</p>
                    {post.colourName && <p className="text-xs text-muted-foreground">{post.colourName}</p>}
                    <div className="flex items-center gap-2 mt-1">
                      {settings.enabledPlatforms.includes("facebook") && <span className="text-xs">📘</span>}
                      {settings.enabledPlatforms.includes("instagram") && <span className="text-xs">📷</span>}
                      {post.scheduledAt && (
                        <span className="text-xs text-muted-foreground">
                          {new Date(post.scheduledAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                          {" "}
                          {new Date(post.scheduledAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1 mt-2">
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setEditingPost(post); setEditPlatform("facebook"); }}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => removePost(post.id)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Published Tab ── */}
        <TabsContent value="published" className="space-y-3 mt-4">
          {publishedPosts.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Send className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No published posts yet</p>
              <p className="text-sm mt-1">Posts will appear here after publishing</p>
            </div>
          ) : (
            publishedPosts.map(post => (
              <div key={post.id} className="bg-card rounded-lg border p-3 flex gap-3">
                {post.imageUrl && <img src={post.imageUrl} alt={post.productTitle} className="w-12 h-12 rounded object-cover shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{post.productTitle}</p>
                    <StatusBadge status={post.status} />
                  </div>
                  {post.postedAt && <p className="text-xs text-muted-foreground">{new Date(post.postedAt).toLocaleDateString()}</p>}
                </div>
              </div>
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* Phase 2 info */}
      <div className="mt-6 bg-muted/50 rounded-lg border p-4">
        <h3 className="text-sm font-semibold mb-2">🚀 Coming in Phase 2</h3>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p><strong>📹 YouTube Shorts</strong> — Auto-generate product slideshow videos and publish as Shorts</p>
          <p><strong>🎵 TikTok</strong> — Post product photos/videos directly (pending platform audit)</p>
          <p><strong>🔗 Direct publishing</strong> — Connect Facebook & Instagram accounts to publish automatically</p>
        </div>
      </div>

      {onStartFlow && (
        <WhatsNextSuggestions
          completedFlow="social_media"
          onStartFlow={onStartFlow}
          onGoHome={onBack}
        />
      )}
    </div>
  );
}
