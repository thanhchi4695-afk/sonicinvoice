import { useState } from "react";
import { Tag, Search, Globe, Bot, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const tools = [
  { id: "tags", icon: Tag, label: "Tag builder", desc: "Build Shopify tags manually", color: "text-primary" },
  { id: "seo", icon: Search, label: "SEO writer", desc: "Generate SEO title + meta description", color: "text-primary" },
  { id: "brands", icon: Globe, label: "Brand reference", desc: "AU brand website directory", color: "text-primary" },
  { id: "ai", icon: Bot, label: "AI instructions", desc: "Custom rules for your invoices", color: "text-secondary" },
];

const quickInserts = [
  { label: "+ Brand prefix", text: "Add [BRAND NAME] at the start of every product name." },
  { label: "+ Title case", text: "Title case all product names (capitalise each word)." },
  { label: "+ Map price cols", text: "QTY column means quantity. First price = cost, second = retail." },
  { label: "+ Abbreviation", text: "Replace '[ABBR]' with '[FULL WORD]' in all names." },
];

const ToolsScreen = () => {
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");

  if (activeTool === "ai") {
    return (
      <div className="px-4 pt-6 pb-24 animate-fade-in">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setActiveTool(null)} className="text-muted-foreground">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h2 className="text-lg font-semibold font-display">AI instructions</h2>
        </div>

        <p className="text-sm text-muted-foreground mb-3">
          Tell SkuPilot exactly how to process your invoices. These rules override all defaults.
        </p>

        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={8}
          placeholder={`Examples:\n• QTY means quantity, first price is cost, second is retail\n• Add my brand name at the start of every product name\n• Replace 'nk' with Necklace, 'br' with Bracelet\n• All names should have first letter capitalised only\n• The SKU column is called 'Style No' in this invoice`}
          className="w-full rounded-lg bg-input border border-border px-4 py-3 text-sm resize-none leading-relaxed placeholder:text-muted-foreground/50"
        />

        <div className="flex flex-wrap gap-2 mt-3">
          {quickInserts.map((qi) => (
            <button
              key={qi.label}
              onClick={() => setInstructions((prev) => (prev ? prev + "\n" : "") + qi.text)}
              className="px-3 py-1.5 rounded-full text-xs font-medium bg-muted text-muted-foreground active:bg-accent"
            >
              {qi.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 mt-4">
          <input type="checkbox" id="save-all" className="w-4 h-4 rounded border-border" />
          <label htmlFor="save-all" className="text-sm text-muted-foreground">Save for all future invoices from this supplier</label>
        </div>

        <Button variant="teal" className="w-full mt-6 h-12 text-base">Save instructions</Button>
      </div>
    );
  }

  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <h1 className="text-2xl font-bold font-display mb-1">Tools</h1>
      <p className="text-muted-foreground text-sm mb-6">Power user features</p>

      <div className="grid grid-cols-2 gap-3">
        {tools.map((tool) => {
          const Icon = tool.icon;
          return (
            <button
              key={tool.id}
              onClick={() => setActiveTool(tool.id)}
              className="bg-card rounded-lg border border-border p-4 text-left active:bg-muted transition-colors"
            >
              <Icon className={`w-6 h-6 ${tool.color} mb-3`} />
              <p className="text-sm font-semibold">{tool.label}</p>
              <p className="text-xs text-muted-foreground mt-1">{tool.desc}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ToolsScreen;
