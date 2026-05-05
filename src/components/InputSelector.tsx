import { FileText, Mail, Camera, FileSpreadsheet } from "lucide-react";
import { cn } from "@/lib/utils";

interface InputSelectorProps {
  onSelect: (kind: "pdf" | "email" | "photo" | "excel") => void;
  selected?: "pdf" | "email" | "photo" | "excel" | null;
}

const OPTIONS = [
  {
    key: "pdf" as const,
    icon: FileText,
    emoji: "📄",
    title: "PDF Invoice",
    desc: "Drag & drop or upload a supplier invoice PDF.",
  },
  {
    key: "email" as const,
    icon: Mail,
    emoji: "📧",
    title: "Email Inbox",
    desc: "Auto-scan Gmail for new supplier invoices.",
  },
  {
    key: "photo" as const,
    icon: Camera,
    emoji: "📷",
    title: "Photo / Packing slip",
    desc: "Snap a photo on mobile or upload an image.",
  },
  {
    key: "excel" as const,
    icon: FileSpreadsheet,
    emoji: "📊",
    title: "Excel / Price list",
    desc: "Upload .xlsx, .xls or .csv from your supplier.",
  },
];

export default function InputSelector({ onSelect, selected }: InputSelectorProps) {
  return (
    <section className="px-4 py-8 max-w-5xl mx-auto">
      <header className="mb-6 text-center">
        <h1 className="text-2xl sm:text-3xl font-bold font-display mb-2">
          How would you like to add stock today?
        </h1>
        <p className="text-sm text-muted-foreground max-w-xl mx-auto">
          Pick an input source. Sonic Invoices will parse, learn the brand and prep it for Shopify.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {OPTIONS.map((o) => {
          const Icon = o.icon;
          const isActive = selected === o.key;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => onSelect(o.key)}
              className={cn(
                "group relative text-left rounded-xl border bg-card p-5 transition-all",
                "hover:border-primary hover:shadow-md hover:-translate-y-0.5",
                isActive ? "border-primary ring-2 ring-primary/30" : "border-border"
              )}
              aria-pressed={isActive}
            >
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl" aria-hidden>
                  {o.emoji}
                </span>
                <Icon className="w-5 h-5 text-muted-foreground group-hover:text-primary" />
              </div>
              <h3 className="font-semibold mb-1">{o.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{o.desc}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
