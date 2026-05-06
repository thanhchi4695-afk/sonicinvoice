import { useEffect, useRef, useState } from "react";
import { Copy, Pencil, RotateCcw, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface SupplierEmail {
  supplierName: string;
  emailType: string;
  subject: string;
  body: string;
  productDetails: string;
  userName: string;
  storeName: string;
  toneVariant: number;
}

interface Props {
  msgId: string;
  email: SupplierEmail;
  onUpdateBody: (body: string) => void;
  onRegenerate: () => Promise<void> | void;
}

export default function SupplierEmailCard({ email, onUpdateBody, onRegenerate }: Props) {
  const [editing, setEditing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bodyRef.current && bodyRef.current.innerText !== email.body) {
      bodyRef.current.innerText = email.body;
    }
  }, [email.body]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${email.subject}\n\n${email.body}`);
      toast.success("Copied!");
    } catch {
      toast.error("Copy failed");
    }
  };

  const handleEditToggle = () => {
    if (editing) {
      const next = bodyRef.current?.innerText ?? email.body;
      onUpdateBody(next.trim());
    }
    setEditing((v) => !v);
    setTimeout(() => {
      if (!editing) bodyRef.current?.focus();
    }, 0);
  };

  const handleRegen = async () => {
    setRegenerating(true);
    try {
      await onRegenerate();
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="w-full max-w-[85%] space-y-2 rounded-2xl border border-border bg-muted p-3 text-sm">
      <div className="space-y-0.5 text-xs text-muted-foreground">
        <div>
          <span className="font-semibold text-foreground">To:</span> {email.supplierName}{" "}
          <span className="opacity-70">(supplier contact)</span>
        </div>
        <div>
          <span className="font-semibold text-foreground">Subject:</span> {email.subject}
        </div>
      </div>
      <div className="border-t border-border" />
      <div
        ref={bodyRef}
        contentEditable={editing}
        suppressContentEditableWarning
        className={`whitespace-pre-wrap rounded bg-background/60 p-2 text-sm leading-relaxed text-foreground outline-none ${
          editing ? "ring-1 ring-primary/40" : ""
        }`}
      >
        {email.body}
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm" variant="outline" onClick={handleCopy}>
          <Copy className="mr-1 h-3 w-3" /> Copy email
        </Button>
        <Button size="sm" variant="outline" onClick={handleEditToggle}>
          {editing ? (
            <>
              <Check className="mr-1 h-3 w-3" /> Done
            </>
          ) : (
            <>
              <Pencil className="mr-1 h-3 w-3" /> Edit
            </>
          )}
        </Button>
        <Button size="sm" variant="outline" onClick={handleRegen} disabled={regenerating}>
          <RotateCcw className={`mr-1 h-3 w-3 ${regenerating ? "animate-spin" : ""}`} /> Try again
        </Button>
      </div>
    </div>
  );
}
