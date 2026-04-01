import { useState, useMemo } from "react";
import { ChevronLeft, Plus, Trash2, ChevronDown, ChevronUp, ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getStoreConfig } from "@/lib/prompt-builder";

// ── Types ──────────────────────────────────────────────────
type DropStatus = "received" | "partial" | "expected" | "overdue" | "skipped";

interface BrandDrop {
  id: string;
  brand: string;
  expectedMonth: string; // "Oct 2025"
  status: DropStatus;
  products: number;
  notes: string;
}

interface Season {
  id: string;
  name: string;        // "Summer 2025/26"
  emoji: string;
  tag: string;          // "Summer 25/26" or "SS26"
  startMonth: string;   // "2025-10"
  endMonth: string;     // "2026-03"
  drops: BrandDrop[];
}

const STATUS_CFG: Record<DropStatus, { emoji: string; label: string; color: string }> = {
  received: { emoji: "✅", label: "Received", color: "text-green-600" },
  partial:  { emoji: "⚠", label: "Partial", color: "text-yellow-500" },
  expected: { emoji: "⏳", label: "Expected", color: "text-muted-foreground" },
  overdue:  { emoji: "❌", label: "Overdue", color: "text-destructive" },
  skipped:  { emoji: "⏭", label: "Skipped", color: "text-muted-foreground line-through" },
};

const STATUSES: DropStatus[] = ["received", "partial", "expected", "overdue", "skipped"];

// ── Persistence ────────────────────────────────────────────
function loadSeasons(): Season[] {
  try { return JSON.parse(localStorage.getItem("season_manager") || "[]"); }
  catch { return []; }
}
function saveSeasons(s: Season[]) { localStorage.setItem("season_manager", JSON.stringify(s)); }

function defaultSeasons(): Season[] {
  const now = new Date();
  const yr = now.getFullYear();
  const mo = now.getMonth(); // 0-based
  const isSummer = mo >= 9 || mo <= 2; // Oct–Mar
  const summerYr = mo >= 9 ? yr : yr - 1;
  const winterYr = isSummer ? summerYr + 1 : yr;

  return [
    {
      id: crypto.randomUUID(),
      name: `Summer ${summerYr}/${String(summerYr + 1).slice(-2)}`,
      emoji: "🌊",
      tag: `Summer ${String(summerYr).slice(-2)}/${String(summerYr + 1).slice(-2)}`,
      startMonth: `${summerYr}-10`,
      endMonth: `${summerYr + 1}-03`,
      drops: [],
    },
    {
      id: crypto.randomUUID(),
      name: `Winter ${winterYr}`,
      emoji: "🍂",
      tag: `Winter ${String(winterYr).slice(-2)}`,
      startMonth: `${winterYr}-04`,
      endMonth: `${winterYr}-09`,
      drops: [],
    },
  ];
}

function isCurrentSeason(s: Season): boolean {
  const now = new Date();
  const nowStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return nowStr >= s.startMonth && nowStr <= s.endMonth;
}

function formatMonthRange(start: string, end: string): string {
  const fmt = (m: string) => {
    const [y, mo] = m.split("-");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[parseInt(mo) - 1]} ${y}`;
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

// ── Main Component ─────────────────────────────────────────
export default function SeasonManager({ onBack }: { onBack: () => void }) {
  const [seasons, setSeasons] = useState<Season[]>(() => {
    const saved = loadSeasons();
    return saved.length > 0 ? saved : defaultSeasons();
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCompare, setShowCompare] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const persist = (updated: Season[]) => { setSeasons(updated); saveSeasons(updated); };

  const selected = seasons.find(s => s.id === selectedId);

  const updateSeason = (id: string, patch: Partial<Season>) => {
    persist(seasons.map(s => s.id === id ? { ...s, ...patch } : s));
  };

  const deleteSeason = (id: string) => {
    persist(seasons.filter(s => s.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  // ── Season Detail View ──
  if (selected) {
    return (
      <SeasonDetail
        season={selected}
        onBack={() => setSelectedId(null)}
        onUpdate={(patch) => updateSeason(selected.id, patch)}
      />
    );
  }

  // ── Compare View ──
  if (showCompare && seasons.length >= 2) {
    return (
      <CompareSeasons
        seasons={seasons}
        onBack={() => setShowCompare(false)}
      />
    );
  }

  // ── Season List ──
  return (
    <div className="px-4 pt-2 pb-24 animate-fade-in">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-accent"><ChevronLeft className="w-5 h-5" /></button>
        <h2 className="text-lg font-bold">🌊 Seasons</h2>
        <div className="flex-1" />
        {seasons.length >= 2 && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setShowCompare(true)}>
            <ArrowRightLeft className="w-3.5 h-3.5 mr-1" /> Compare
          </Button>
        )}
        <Button size="sm" onClick={() => setShowAdd(true)}><Plus className="w-4 h-4 mr-1" /> Add season</Button>
      </div>

      {/* Season cards */}
      <div className="space-y-3">
        {seasons.map(season => {
          const current = isCurrentSeason(season);
          const received = season.drops.filter(d => d.status === "received" || d.status === "partial").length;
          const total = season.drops.length;
          const totalProducts = season.drops.reduce((s, d) => s + d.products, 0);
          const overdue = season.drops.filter(d => d.status === "overdue").length;
          const pct = total > 0 ? Math.round((received / total) * 100) : 0;

          return (
            <button
              key={season.id}
              onClick={() => setSelectedId(season.id)}
              className="w-full text-left bg-card border rounded-xl p-4 hover:bg-accent/30 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{season.emoji}</span>
                    <span className="font-semibold">{season.name}</span>
                    {current && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/15 text-primary">ACTIVE</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{formatMonthRange(season.startMonth, season.endMonth)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Tag: <span className="font-mono text-foreground">{season.tag}</span></p>
                </div>
              </div>

              <div className="mt-3 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Brands received: {received}/{total} expected</span>
                  <span className="text-muted-foreground">{totalProducts} products</span>
                </div>
                {total > 0 && (
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="text-muted-foreground">{pct}% complete</span>
                  {overdue > 0 && <span className="text-destructive font-medium">❌ {overdue} overdue</span>}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Add season dialog */}
      {showAdd && (
        <AddSeasonDialog
          onAdd={(s) => { persist([...seasons, s]); setShowAdd(false); }}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}

// ── Season Detail ──────────────────────────────────────────
function SeasonDetail({ season, onBack, onUpdate }: {
  season: Season;
  onBack: () => void;
  onUpdate: (patch: Partial<Season>) => void;
}) {
  const [addingBrand, setAddingBrand] = useState(false);
  const [newBrand, setNewBrand] = useState("");
  const [newMonth, setNewMonth] = useState("");
  const [editTag, setEditTag] = useState(false);
  const [tagVal, setTagVal] = useState(season.tag);

  const addDrop = () => {
    if (!newBrand.trim()) return;
    const drop: BrandDrop = {
      id: crypto.randomUUID(),
      brand: newBrand.trim(),
      expectedMonth: newMonth || "TBD",
      status: "expected",
      products: 0,
      notes: "",
    };
    onUpdate({ drops: [...season.drops, drop] });
    setNewBrand("");
    setNewMonth("");
    setAddingBrand(false);
  };

  const updateDrop = (dropId: string, patch: Partial<BrandDrop>) => {
    onUpdate({ drops: season.drops.map(d => d.id === dropId ? { ...d, ...patch } : d) });
  };

  const deleteDrop = (dropId: string) => {
    onUpdate({ drops: season.drops.filter(d => d.id !== dropId) });
  };

  const received = season.drops.filter(d => d.status === "received" || d.status === "partial").length;
  const totalProducts = season.drops.reduce((s, d) => s + d.products, 0);

  return (
    <div className="px-4 pt-2 pb-24 animate-fade-in">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-accent"><ChevronLeft className="w-5 h-5" /></button>
        <h2 className="text-lg font-bold">{season.emoji} {season.name}</h2>
      </div>

      {/* Overview */}
      <div className="bg-card border rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">{formatMonthRange(season.startMonth, season.endMonth)}</span>
          {isCurrentSeason(season) && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/15 text-primary">ACTIVE</span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-xl font-bold">{received}/{season.drops.length}</p>
            <p className="text-[11px] text-muted-foreground">Brands received</p>
          </div>
          <div>
            <p className="text-xl font-bold">{totalProducts}</p>
            <p className="text-[11px] text-muted-foreground">Products</p>
          </div>
          <div>
            <p className="text-xl font-bold">{season.drops.filter(d => d.status === "overdue").length}</p>
            <p className="text-[11px] text-muted-foreground">Overdue</p>
          </div>
        </div>

        {/* Season tag */}
        <div className="mt-3 pt-3 border-t flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Season tag:</span>
          {editTag ? (
            <div className="flex items-center gap-1">
              <Input value={tagVal} onChange={e => setTagVal(e.target.value)} className="h-7 w-32 text-xs" />
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => { onUpdate({ tag: tagVal }); setEditTag(false); }}>
                Save
              </Button>
            </div>
          ) : (
            <button onClick={() => setEditTag(true)} className="text-xs font-mono bg-muted px-2 py-0.5 rounded hover:bg-accent">
              {season.tag}
            </button>
          )}
        </div>
      </div>

      {/* Brand Drop Tracker */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Brand Drops</h3>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAddingBrand(true)}>
          <Plus className="w-3 h-3 mr-1" /> Add brand
        </Button>
      </div>

      {addingBrand && (
        <div className="bg-card border rounded-xl p-3 mb-3 space-y-2">
          <Input placeholder="Brand name" value={newBrand} onChange={e => setNewBrand(e.target.value)} className="h-9 text-sm" />
          <Input placeholder="Expected month (e.g. Oct 2025)" value={newMonth} onChange={e => setNewMonth(e.target.value)} className="h-9 text-sm" />
          <div className="flex gap-2">
            <Button size="sm" className="h-8 text-xs" onClick={addDrop} disabled={!newBrand.trim()}>Add</Button>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setAddingBrand(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {season.drops.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <p className="text-sm">No brand drops tracked yet.</p>
          <p className="text-xs mt-1">Add expected brands for this season.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {season.drops.map(drop => {
            const st = STATUS_CFG[drop.status];
            return (
              <div key={drop.id} className="bg-card border rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{st.emoji}</span>
                    <span className={`text-sm font-medium ${st.color}`}>{drop.brand}</span>
                  </div>
                  <select
                    value={drop.status}
                    onChange={(e) => updateDrop(drop.id, { status: e.target.value as DropStatus })}
                    className="h-7 text-[11px] rounded-md border border-border bg-input px-1.5 text-foreground"
                  >
                    {STATUSES.map(s => (
                      <option key={s} value={s}>{STATUS_CFG[s].emoji} {STATUS_CFG[s].label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-xs text-muted-foreground">{drop.expectedMonth}</span>
                  <div className="flex items-center gap-2">
                    {(drop.status === "received" || drop.status === "partial") && (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          value={drop.products || ""}
                          onChange={e => updateDrop(drop.id, { products: parseInt(e.target.value) || 0 })}
                          className="w-14 h-6 text-center text-[11px] rounded border border-border bg-input"
                          placeholder="0"
                        />
                        <span className="text-[11px] text-muted-foreground">products</span>
                      </div>
                    )}
                    <button onClick={() => deleteDrop(drop.id)} className="text-destructive p-1 hover:bg-destructive/10 rounded">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                {/* Notes */}
                <input
                  type="text"
                  value={drop.notes}
                  onChange={e => updateDrop(drop.id, { notes: e.target.value })}
                  placeholder="Notes…"
                  className="w-full mt-1.5 h-7 text-[11px] rounded border border-border bg-input px-2 text-foreground placeholder:text-muted-foreground"
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Compare Seasons ────────────────────────────────────────
function CompareSeasons({ seasons, onBack }: { seasons: Season[]; onBack: () => void }) {
  const [leftIdx, setLeftIdx] = useState(0);
  const [rightIdx, setRightIdx] = useState(Math.min(1, seasons.length - 1));

  const stats = (s: Season) => {
    const received = s.drops.filter(d => d.status === "received" || d.status === "partial").length;
    const products = s.drops.reduce((sum, d) => sum + d.products, 0);
    const overdue = s.drops.filter(d => d.status === "overdue").length;
    return { received, total: s.drops.length, products, overdue };
  };

  const left = seasons[leftIdx];
  const right = seasons[rightIdx];
  const ls = stats(left);
  const rs = stats(right);

  return (
    <div className="px-4 pt-2 pb-24 animate-fade-in">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-accent"><ChevronLeft className="w-5 h-5" /></button>
        <h2 className="text-lg font-bold">Compare seasons</h2>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4">
        <select value={leftIdx} onChange={e => setLeftIdx(Number(e.target.value))} className="h-9 text-xs rounded-md border border-border bg-input px-2 text-foreground">
          {seasons.map((s, i) => <option key={s.id} value={i}>{s.emoji} {s.name}</option>)}
        </select>
        <select value={rightIdx} onChange={e => setRightIdx(Number(e.target.value))} className="h-9 text-xs rounded-md border border-border bg-input px-2 text-foreground">
          {seasons.map((s, i) => <option key={s.id} value={i}>{s.emoji} {s.name}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[{ s: left, st: ls }, { s: right, st: rs }].map(({ s, st }, i) => (
          <div key={i} className="bg-card border rounded-xl p-4 space-y-2">
            <h3 className="font-semibold text-sm">{s.emoji} {s.name}</h3>
            <p className="text-xs text-muted-foreground">{formatMonthRange(s.startMonth, s.endMonth)}</p>
            <div className="space-y-1.5 pt-2 border-t">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Brands</span>
                <span className="font-medium">{st.received}/{st.total}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Products</span>
                <span className="font-medium">{st.products}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Overdue</span>
                <span className={`font-medium ${st.overdue > 0 ? "text-destructive" : ""}`}>{st.overdue}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Insight */}
      {ls.total > 0 && rs.total > 0 && (
        <div className="mt-4 bg-muted/50 rounded-xl p-3 text-xs text-muted-foreground">
          {ls.received !== rs.received && (
            <p>
              {left.name} has {Math.abs(ls.received - rs.received)} {ls.received > rs.received ? "more" : "fewer"} brand deliveries than {right.name}.
            </p>
          )}
          {ls.products !== rs.products && (
            <p className="mt-1">
              Product count difference: {Math.abs(ls.products - rs.products)} products ({ls.products > rs.products ? left.name : right.name} has more).
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Add Season Dialog ──────────────────────────────────────
function AddSeasonDialog({ onAdd, onClose }: { onAdd: (s: Season) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🌊");
  const [tag, setTag] = useState("");
  const [startMonth, setStartMonth] = useState("");
  const [endMonth, setEndMonth] = useState("");

  const handle = () => {
    if (!name.trim() || !startMonth || !endMonth) return;
    onAdd({
      id: crypto.randomUUID(),
      name: name.trim(),
      emoji,
      tag: tag.trim() || name.trim(),
      startMonth,
      endMonth,
      drops: [],
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-card border rounded-xl p-5 w-full max-w-md space-y-3">
        <h3 className="font-semibold text-base">Add season</h3>
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <select value={emoji} onChange={e => setEmoji(e.target.value)} className="h-10 rounded-md border border-border bg-input px-2 text-lg">
            {["🌊", "🍂", "❄️", "🌸", "☀️"].map(e => <option key={e} value={e}>{e}</option>)}
          </select>
          <Input placeholder="Season name (e.g. Summer 2026/27)" value={name} onChange={e => setName(e.target.value)} className="h-10 text-sm" />
        </div>
        <Input placeholder="Season tag (e.g. SS27)" value={tag} onChange={e => setTag(e.target.value)} className="h-10 text-sm" />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Start month</label>
            <Input type="month" value={startMonth} onChange={e => setStartMonth(e.target.value)} className="h-10 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">End month</label>
            <Input type="month" value={endMonth} onChange={e => setEndMonth(e.target.value)} className="h-10 text-sm" />
          </div>
        </div>
        <div className="flex gap-2 pt-2">
          <Button className="flex-1 h-10" onClick={handle} disabled={!name.trim() || !startMonth || !endMonth}>Create season</Button>
          <Button variant="ghost" className="h-10" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
