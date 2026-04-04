import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, ChevronRight, Download, Plus, X, Search, Copy, Check } from "lucide-react";
import Papa from "papaparse";

interface StyleGroupingFlowProps {
  onBack: () => void;
}

interface GroupMember {
  handle: string;
  title: string;
  colourLabel: string;
}

interface StyleGroup {
  baseKey: string;
  vendor: string;
  baseTitle: string;
  variantType: "colour" | "print" | "style" | "unknown";
  confidence: "high" | "medium" | "low";
  confirmed: boolean;
  members: GroupMember[];
}

const COLOUR_WORDS = [
  "black", "white", "navy", "ivory", "stone", "ebony", "sand", "coral", "blush", "teal",
  "khaki", "red", "blue", "green", "pink", "yellow", "orange", "purple", "grey", "gray",
  "bronze", "gold", "silver", "nude", "tan", "olive", "cream", "midnight", "aqua", "mint",
  "indigo", "rose", "lilac", "lemon", "floral", "stripe", "spot", "print", "abstract",
  "geo", "animal", "leopard", "tiger", "snake", "multi", "coloured", "colored", "patterned",
  "bondi", "harbour", "reef", "tropicana", "riviera", "coastal", "island", "paradise",
  "tahitian", "bali", "santorini", "cafe", "emerald", "jade", "ruby", "sapphire",
  "merlot", "dusk", "cloud", "storm", "pepper", "slate", "espresso", "creme",
  "amber", "copper", "rust", "terracotta", "sage", "forest", "chocolate", "coffee",
  "caramel", "lavender", "peach", "charcoal", "burgundy", "magenta", "turquoise",
];

function getBaseKey(handle: string): string {
  const segments = handle.toLowerCase().split("-");
  if (segments.length <= 1) return handle.toLowerCase();

  for (let strip = 1; strip <= Math.min(3, segments.length - 1); strip++) {
    const lastSegments = segments.slice(-strip).join("-");
    const isColourSuffix = COLOUR_WORDS.some(c => lastSegments.includes(c));
    if (isColourSuffix) {
      return segments.slice(0, -strip).join("-");
    }
  }
  return handle.toLowerCase();
}

function extractColourLabel(handle: string, baseHandle: string): string {
  const suffix = handle
    .toLowerCase()
    .replace(baseHandle, "")
    .replace(/^-/, "")
    .split("-")
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return suffix || "Default";
}

function detectVariantType(members: { title: string }[]): "colour" | "print" | "style" | "unknown" {
  const hasColour = members.some(m =>
    COLOUR_WORDS.some(c => m.title.toLowerCase().includes(c))
  );
  return hasColour ? "colour" : "print";
}

function detectStyleGroups(products: { handle: string; title: string; vendor: string }[]): StyleGroup[] {
  const handleGroups = new Map<string, typeof products>();

  products.forEach(p => {
    const key = getBaseKey(p.handle);
    if (!handleGroups.has(key)) handleGroups.set(key, []);
    handleGroups.get(key)!.push(p);
  });

  const groups: StyleGroup[] = [];

  handleGroups.forEach((members, key) => {
    if (members.length < 2) return;
    const vendors = new Set(members.map(m => (m.vendor || "").toLowerCase()));
    if (vendors.size > 1) return;

    const variantType = detectVariantType(members);
    groups.push({
      baseKey: key,
      vendor: members[0].vendor || "",
      baseTitle: members[0].title.replace(/\s*-\s*[^-]+$/, ""),
      variantType,
      confidence: members.length >= 3 ? "high" : "medium",
      confirmed: false,
      members: members.map(m => ({
        handle: m.handle,
        title: m.title,
        colourLabel: extractColourLabel(m.handle, key),
      })),
    });
  });

  return groups.sort((a, b) => b.members.length - a.members.length);
}

function generateStyleGroupingCSV(confirmedGroups: StyleGroup[]): string {
  const headers = [
    "Handle",
    "Command",
    "Metafield: custom.related_products [list.product_reference]",
    "Metafield: custom.colour_label [single_line_text]",
  ];
  const rows = [headers.map(h => `"${h}"`).join(",")];

  confirmedGroups.forEach(group => {
    group.members.forEach(member => {
      const siblings = group.members
        .filter(m => m.handle !== member.handle)
        .map(m => m.handle)
        .join(";");
      rows.push(
        [
          `"${member.handle}"`,
          `"MERGE"`,
          `"${siblings}"`,
          `"${member.colourLabel || ""}"`,
        ].join(",")
      );
    });
  });

  return "\uFEFF" + rows.join("\n");
}

const STEPS = ["Detect groups", "Review & edit", "Export CSV"];

const StyleGroupingFlow = ({ onBack }: StyleGroupingFlowProps) => {
  const [step, setStep] = useState(0);
  const [source, setSource] = useState<"invoice" | "csv" | "paste">("invoice");
  const [pasteText, setPasteText] = useState("");
  const [groups, setGroups] = useState<StyleGroup[]>([]);
  const [allProducts, setAllProducts] = useState<{ handle: string; title: string; vendor: string }[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  const [addingToGroup, setAddingToGroup] = useState<string | null>(null);
  const [addSearch, setAddSearch] = useState("");

  // Load saved groups on mount
  useState(() => {
    try {
      const saved = localStorage.getItem("style_groups");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setGroups(parsed);
          setStep(1);
        }
      }
    } catch { /* ignore */ }
  });

  const runDetection = useCallback(() => {
    let products: { handle: string; title: string; vendor: string }[] = [];

    if (source === "invoice") {
      try {
        const raw = localStorage.getItem("invoice_lines");
        const lines = raw ? JSON.parse(raw) : [];
        products = lines.map((l: any) => ({
          handle: l.handle || l.title?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "") || "",
          title: l.title || "",
          vendor: l.vendor || l.brand || "",
        }));
      } catch {
        toast.error("No invoice products found");
        return;
      }
    } else if (source === "paste") {
      const handles = pasteText.split("\n").map(h => h.trim()).filter(Boolean);
      products = handles.map(h => ({ handle: h, title: h.replace(/-/g, " "), vendor: "" }));
    }

    if (products.length < 2) {
      toast.error("Need at least 2 products to detect groups");
      return;
    }

    setAllProducts(products);
    const detected = detectStyleGroups(products);
    setGroups(detected);
    localStorage.setItem("style_groups", JSON.stringify(detected));
    localStorage.setItem("style_groups_source", source);
    toast.success(`Found ${detected.length} style groups`);
    setStep(1);
  }, [source, pasteText]);

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const products = result.data.map((row: any) => ({
          handle: row.Handle || row.handle || "",
          title: row.Title || row.title || "",
          vendor: row.Vendor || row.vendor || "",
        })).filter((p: any) => p.handle);

        if (products.length < 2) {
          toast.error("CSV needs at least 2 products with Handle column");
          return;
        }

        setAllProducts(products);
        const detected = detectStyleGroups(products);
        setGroups(detected);
        localStorage.setItem("style_groups", JSON.stringify(detected));
        localStorage.setItem("style_groups_source", "csv");
        toast.success(`Found ${detected.length} style groups from ${products.length} products`);
        setStep(1);
      },
      error: () => toast.error("Failed to parse CSV"),
    });
    e.target.value = "";
  };

  const confirmGroup = (baseKey: string) => {
    setGroups(prev => {
      const updated = prev.map(g => g.baseKey === baseKey ? { ...g, confirmed: true } : g);
      localStorage.setItem("style_groups", JSON.stringify(updated));
      return updated;
    });
  };

  const removeGroup = (baseKey: string) => {
    setGroups(prev => {
      const updated = prev.filter(g => g.baseKey !== baseKey);
      localStorage.setItem("style_groups", JSON.stringify(updated));
      return updated;
    });
    toast.success("Group removed");
  };

  const removeMember = (baseKey: string, handle: string) => {
    setGroups(prev => {
      const updated = prev.map(g => {
        if (g.baseKey !== baseKey) return g;
        const newMembers = g.members.filter(m => m.handle !== handle);
        if (newMembers.length < 2) return null as any;
        return { ...g, members: newMembers };
      }).filter(Boolean);
      localStorage.setItem("style_groups", JSON.stringify(updated));
      return updated;
    });
  };

  const updateColourLabel = (baseKey: string, handle: string, label: string) => {
    setGroups(prev => {
      const updated = prev.map(g => {
        if (g.baseKey !== baseKey) return g;
        return {
          ...g,
          members: g.members.map(m => m.handle === handle ? { ...m, colourLabel: label } : m),
        };
      });
      localStorage.setItem("style_groups", JSON.stringify(updated));
      return updated;
    });
  };

  const addMemberToGroup = (baseKey: string, product: { handle: string; title: string; vendor: string }) => {
    setGroups(prev => {
      const updated = prev.map(g => {
        if (g.baseKey !== baseKey) return g;
        if (g.members.some(m => m.handle === product.handle)) return g;
        return {
          ...g,
          members: [...g.members, {
            handle: product.handle,
            title: product.title,
            colourLabel: extractColourLabel(product.handle, baseKey),
          }],
        };
      });
      localStorage.setItem("style_groups", JSON.stringify(updated));
      return updated;
    });
    setAddingToGroup(null);
    setAddSearch("");
  };

  const confirmAll = () => {
    setGroups(prev => {
      const updated = prev.map(g => ({ ...g, confirmed: true }));
      localStorage.setItem("style_groups", JSON.stringify(updated));
      return updated;
    });
    toast.success("All groups confirmed");
  };

  const exportCSV = () => {
    const confirmed = groups.filter(g => g.confirmed);
    if (confirmed.length === 0) {
      toast.error("No confirmed groups to export");
      return;
    }

    const csv = generateStyleGroupingCSV(confirmed);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "Products.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    const totalProducts = confirmed.reduce((s, g) => s + g.members.length, 0);
    toast.success(`Exported ${totalProducts} products across ${confirmed.length} groups`);

    // History
    try {
      const hist = JSON.parse(localStorage.getItem("export_history") || "[]");
      const vendorList = [...new Set(confirmed.map(g => g.vendor))].filter(Boolean).slice(0, 3).join(", ");
      hist.unshift({
        type: "style_group",
        label: `${confirmed.length} groups, ${totalProducts} products — ${vendorList}`,
        date: new Date().toISOString(),
      });
      localStorage.setItem("export_history", JSON.stringify(hist.slice(0, 50)));
    } catch { /* ignore */ }
  };

  const groupedHandles = new Set(groups.flatMap(g => g.members.map(m => m.handle)));
  const ungrouped = allProducts.filter(p => !groupedHandles.has(p.handle));
  const confirmedGroups = groups.filter(g => g.confirmed);
  const totalConfirmedProducts = confirmedGroups.reduce((s, g) => s + g.members.length, 0);

  const filteredGroups = searchTerm
    ? groups.filter(g =>
        g.baseTitle.toLowerCase().includes(searchTerm.toLowerCase()) ||
        g.vendor.toLowerCase().includes(searchTerm.toLowerCase()) ||
        g.members.some(m => m.handle.includes(searchTerm.toLowerCase()))
      )
    : groups;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-32">
      {/* Header */}
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground mb-4 hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <h1 className="text-2xl font-bold mb-1">🎨 Style Grouping</h1>
      <p className="text-muted-foreground text-sm mb-6">
        Link same-style products so customers can switch between colours on the product page.
      </p>

      {/* Progress */}
      <div className="flex items-center gap-2 mb-6">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
              i === step ? "bg-primary text-primary-foreground" :
              i < step ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
            }`}>{i + 1}</div>
            <span className={`text-xs ${i === step ? "text-foreground font-medium" : "text-muted-foreground"}`}>{s}</span>
            {i < STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* STEP 1 — Detect */}
      {step === 0 && (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <h2 className="font-semibold">Source</h2>
              <div className="space-y-2">
                {[
                  { val: "invoice" as const, label: "Current invoice products" },
                  { val: "csv" as const, label: "Upload CSV (Handle + Title + Vendor)" },
                  { val: "paste" as const, label: "Paste handles (one per line)" },
                ].map(opt => (
                  <label key={opt.val} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={source === opt.val} onChange={() => setSource(opt.val)} className="accent-primary" />
                    <span className="text-sm">{opt.label}</span>
                  </label>
                ))}
              </div>

              {source === "csv" && (
                <input type="file" accept=".csv" onChange={handleCSVUpload} className="text-sm" />
              )}

              {source === "paste" && (
                <textarea
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                  placeholder="jets-jetset-d-dd-twist-top&#10;jets-jetset-d-dd-twist-top-ebony&#10;jets-jetset-d-dd-twist-top-stone"
                  className="w-full h-32 text-xs font-mono border rounded-md p-2 bg-background"
                />
              )}

              {source !== "csv" && (
                <Button onClick={runDetection} className="w-full">
                  Detect style groups <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* STEP 2 — Review */}
      {step === 1 && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-card border rounded-lg p-3 text-center">
              <div className="text-2xl font-bold">{groups.length}</div>
              <div className="text-xs text-muted-foreground">Groups</div>
            </div>
            <div className="bg-card border rounded-lg p-3 text-center">
              <div className="text-2xl font-bold">{groups.reduce((s, g) => s + g.members.length, 0)}</div>
              <div className="text-xs text-muted-foreground">Products</div>
            </div>
            <div className="bg-card border rounded-lg p-3 text-center">
              <div className="text-2xl font-bold">{ungrouped.length}</div>
              <div className="text-xs text-muted-foreground">Ungrouped</div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Button size="sm" onClick={confirmAll} variant="default">
              <Check className="w-3 h-3 mr-1" /> Confirm all
            </Button>
            <div className="flex-1 relative">
              <Search className="w-4 h-4 absolute left-2 top-2.5 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Search groups..."
                className="pl-8 h-9"
              />
            </div>
          </div>

          {/* Groups */}
          {filteredGroups.map(group => (
            <Card key={group.baseKey} className={group.confirmed ? "border-primary/40" : ""}>
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-sm">{group.baseTitle || group.baseKey}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      {group.vendor && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{group.vendor}</span>
                      )}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground capitalize">{group.variantType}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={
                      group.confidence === "high" ? "default" :
                      group.confidence === "medium" ? "secondary" : "destructive"
                    } className="text-[10px]">
                      {group.confidence}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">{group.members.length}</Badge>
                    {group.confirmed && <Check className="w-3.5 h-3.5 text-primary" />}
                  </div>
                </div>

                {/* Members */}
                <div className="space-y-1.5">
                  {group.members.map(member => (
                    <div key={member.handle} className="flex items-center gap-2 text-xs bg-muted/50 rounded px-2 py-1.5">
                      <span className="text-muted-foreground">●</span>
                      <span className="flex-1 font-mono truncate">{member.handle}</span>
                      <Input
                        value={member.colourLabel}
                        onChange={e => updateColourLabel(group.baseKey, member.handle, e.target.value)}
                        className="w-28 h-6 text-xs px-1.5"
                        placeholder="Colour label"
                      />
                      <button onClick={() => removeMember(group.baseKey, member.handle)} className="text-muted-foreground hover:text-destructive">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add product */}
                {addingToGroup === group.baseKey ? (
                  <div className="space-y-2">
                    <Input
                      value={addSearch}
                      onChange={e => setAddSearch(e.target.value)}
                      placeholder="Search handle or title..."
                      className="h-8 text-xs"
                      autoFocus
                    />
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {allProducts
                        .filter(p => !groupedHandles.has(p.handle) && (
                          p.handle.includes(addSearch.toLowerCase()) || p.title.toLowerCase().includes(addSearch.toLowerCase())
                        ))
                        .slice(0, 8)
                        .map(p => (
                          <button
                            key={p.handle}
                            onClick={() => addMemberToGroup(group.baseKey, p)}
                            className="w-full text-left text-xs px-2 py-1 rounded hover:bg-muted truncate"
                          >
                            {p.handle}
                          </button>
                        ))}
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => { setAddingToGroup(null); setAddSearch(""); }}>Cancel</Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    {!group.confirmed && (
                      <Button size="sm" variant="default" onClick={() => confirmGroup(group.baseKey)}>
                        <Check className="w-3 h-3 mr-1" /> Confirm
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setAddingToGroup(group.baseKey)}>
                      <Plus className="w-3 h-3 mr-1" /> Add
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeGroup(group.baseKey)}>
                      <X className="w-3 h-3 mr-1" /> Remove
                    </Button>
                  </div>
                )}

                {group.confidence === "low" && !group.confirmed && (
                  <p className="text-[10px] text-destructive">
                    ⚠ Low confidence — verify these are the same style before confirming
                  </p>
                )}
              </CardContent>
            </Card>
          ))}

          {/* Ungrouped */}
          {ungrouped.length > 0 && (
            <Card>
              <CardContent className="pt-4">
                <h3 className="font-semibold text-sm mb-2 text-muted-foreground">Ungrouped ({ungrouped.length})</h3>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {ungrouped.map(p => (
                    <div key={p.handle} className="text-xs font-mono text-muted-foreground px-2 py-1 truncate">
                      {p.handle}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Button onClick={() => setStep(2)} className="w-full" disabled={confirmedGroups.length === 0}>
            Continue to export ({confirmedGroups.length} groups) <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}

      {/* STEP 3 — Export */}
      {step === 2 && (
        <div className="space-y-4">
          {/* Summary */}
          <Card>
            <CardContent className="pt-6 space-y-3">
              <h2 className="font-semibold">Export summary</h2>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Groups:</span>{" "}
                  <span className="font-semibold">{confirmedGroups.length}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Products:</span>{" "}
                  <span className="font-semibold">{totalConfirmedProducts}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">CSV rows:</span>{" "}
                  <span className="font-semibold">{totalConfirmedProducts}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Ungrouped:</span>{" "}
                  <span className="font-semibold">{ungrouped.length}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Preview */}
          <Card>
            <CardContent className="pt-4">
              <h3 className="text-sm font-semibold mb-2">CSV preview</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-[10px] font-mono">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-1 pr-2">Handle</th>
                      <th className="text-left py-1 pr-2">related_products</th>
                      <th className="text-left py-1">colour_label</th>
                    </tr>
                  </thead>
                  <tbody>
                    {confirmedGroups.slice(0, 2).flatMap(group =>
                      group.members.slice(0, 3).map(member => (
                        <tr key={member.handle} className="border-b border-muted">
                          <td className="py-1 pr-2 truncate max-w-[140px]">{member.handle}</td>
                          <td className="py-1 pr-2 truncate max-w-[200px] text-muted-foreground">
                            {group.members.filter(m => m.handle !== member.handle).map(m => m.handle).join(";")}
                          </td>
                          <td className="py-1">{member.colourLabel}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Download */}
          <Button onClick={exportCSV} className="w-full h-12 text-base">
            <Download className="w-4 h-4 mr-2" /> Download Products.csv
          </Button>

          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              const csv = generateStyleGroupingCSV(confirmedGroups);
              const tsv = csv.replace(/"/g, "").replace(/,/g, "\t");
              navigator.clipboard.writeText(tsv);
              toast.success("Copied as TSV for Google Sheets");
            }}
          >
            <Copy className="w-4 h-4 mr-2" /> Copy as table
          </Button>

          {/* Setup instructions */}
          <button onClick={() => setShowSetup(!showSetup)} className="text-xs text-primary hover:underline">
            {showSetup ? "Hide" : "Show"} Matrixify setup instructions
          </button>
          {showSetup && (
            <Card>
              <CardContent className="pt-4 text-xs space-y-2 text-muted-foreground">
                <p className="font-semibold text-foreground">Before importing, create metafield definitions:</p>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>Shopify Admin → Settings → Custom Data → Products</li>
                  <li>
                    Create <strong>Related products</strong> — Namespace: <code>custom</code>, Key: <code>related_products</code>, Type: <em>Product — List of products</em>
                  </li>
                  <li>
                    Create <strong>Colour label</strong> — Namespace: <code>custom</code>, Key: <code>colour_label</code>, Type: <em>Single line text</em>
                  </li>
                  <li>Import CSV via Matrixify</li>
                  <li>In Theme Editor, add a "Product list" block connected to <code>custom.related_products</code></li>
                </ol>
              </CardContent>
            </Card>
          )}

          <Button variant="ghost" className="w-full" onClick={() => setStep(1)}>
            ← Back to review
          </Button>
        </div>
      )}
    </div>
  );
};

export default StyleGroupingFlow;
