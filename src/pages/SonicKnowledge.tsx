import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Trash2, Plus, Save } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface Entry {
  id: string;
  category: string;
  key: string;
  value: string;
}

const SUGGESTED = ["clients", "brands", "preferences", "pricing", "workflow"];

export default function SonicKnowledge() {
  const [userId, setUserId] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState({ category: "clients", key: "", value: "" });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    if (!userId) return;
    void load();
  }, [userId]);

  async function load() {
    const { data } = await supabase
      .from("user_knowledge" as never)
      .select("id, category, key, value")
      .order("category")
      .order("key");
    setEntries((data as Entry[]) ?? []);
  }

  async function add() {
    if (!userId || !draft.key.trim() || !draft.value.trim()) return;
    setLoading(true);
    const { error } = await supabase.from("user_knowledge" as never).insert({
      user_id: userId,
      category: draft.category.trim().toLowerCase(),
      key: draft.key.trim(),
      value: draft.value.trim(),
    } as never);
    setLoading(false);
    if (error) {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
      return;
    }
    setDraft({ ...draft, key: "", value: "" });
    void load();
  }

  async function update(e: Entry) {
    const { error } = await supabase
      .from("user_knowledge" as never)
      .update({ value: e.value, key: e.key, category: e.category } as never)
      .eq("id", e.id);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
    else toast({ title: "Saved" });
  }

  async function remove(id: string) {
    await supabase.from("user_knowledge" as never).delete().eq("id", id);
    void load();
  }

  const grouped = entries.reduce<Record<string, Entry[]>>((acc, e) => {
    (acc[e.category] ??= []).push(e);
    return acc;
  }, {});

  return (
    <div className="container max-w-4xl py-8">
      <h1 className="font-heading text-3xl font-bold">Sonic Knowledge</h1>
      <p className="mt-2 text-muted-foreground">
        Personal context Sonic uses on every chat. Add facts about your clients, brands, pricing,
        and preferences. Sonic queries this on each message.
      </p>

      {!userId && <div className="mt-6 text-muted-foreground">Sign in to manage knowledge.</div>}

      {userId && (
        <>
          <Card className="mt-6 p-4">
            <h2 className="font-heading text-lg font-semibold">Add entry</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-[140px_1fr]">
              <Input
                list="categories"
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                placeholder="category"
              />
              <datalist id="categories">
                {SUGGESTED.map((c) => <option key={c} value={c} />)}
              </datalist>
              <Input
                value={draft.key}
                onChange={(e) => setDraft({ ...draft, key: e.target.value })}
                placeholder="key (e.g. Pinkhill sizing)"
              />
            </div>
            <Textarea
              className="mt-3"
              rows={3}
              value={draft.value}
              onChange={(e) => setDraft({ ...draft, value: e.target.value })}
              placeholder="value (e.g. uses EU sizing for European brands, AU otherwise)"
            />
            <Button className="mt-3" onClick={add} disabled={loading}>
              <Plus className="mr-2 h-4 w-4" /> Add
            </Button>
          </Card>

          {Object.entries(grouped).map(([cat, items]) => (
            <div key={cat} className="mt-8">
              <h2 className="font-heading text-xl font-semibold capitalize">{cat}</h2>
              <div className="mt-3 space-y-3">
                {items.map((e) => (
                  <Card key={e.id} className="p-3">
                    <div className="grid gap-2 md:grid-cols-[200px_1fr_auto]">
                      <Input
                        value={e.key}
                        onChange={(ev) =>
                          setEntries((arr) =>
                            arr.map((x) => (x.id === e.id ? { ...x, key: ev.target.value } : x)),
                          )
                        }
                      />
                      <Textarea
                        rows={2}
                        value={e.value}
                        onChange={(ev) =>
                          setEntries((arr) =>
                            arr.map((x) => (x.id === e.id ? { ...x, value: ev.target.value } : x)),
                          )
                        }
                      />
                      <div className="flex gap-2">
                        <Button size="icon" variant="outline" onClick={() => update(e)}>
                          <Save className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="outline" onClick={() => remove(e.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}

          {entries.length === 0 && (
            <div className="mt-8 rounded-lg bg-muted/40 p-6 text-center text-muted-foreground">
              No entries yet. Add your first piece of context above.
            </div>
          )}
        </>
      )}
    </div>
  );
}
