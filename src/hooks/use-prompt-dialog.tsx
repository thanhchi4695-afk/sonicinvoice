import { createContext, useCallback, useContext, useState, ReactNode } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface PromptOptions {
  title: string;
  description?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  multiline?: boolean;
}

type PromptFn = (opts: PromptOptions) => Promise<string | null>;

const PromptContext = createContext<PromptFn | null>(null);

interface PendingPrompt extends PromptOptions {
  resolve: (value: string | null) => void;
}

export const PromptDialogProvider = ({ children }: { children: ReactNode }) => {
  const [pending, setPending] = useState<PendingPrompt | null>(null);
  const [value, setValue] = useState("");

  const promptFn = useCallback<PromptFn>((opts) => {
    setValue(opts.defaultValue ?? "");
    return new Promise<string | null>((resolve) => setPending({ ...opts, resolve }));
  }, []);

  const handleClose = (result: string | null) => {
    if (pending) pending.resolve(result);
    setPending(null);
    setValue("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleClose(value);
  };

  return (
    <PromptContext.Provider value={promptFn}>
      {children}
      <Dialog open={!!pending} onOpenChange={(o) => { if (!o) handleClose(null); }}>
        <DialogContent>
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>{pending?.title}</DialogTitle>
              {pending?.description && (
                <DialogDescription className="whitespace-pre-line">{pending.description}</DialogDescription>
              )}
            </DialogHeader>
            <div className="py-4 space-y-2">
              {pending?.label && <Label htmlFor="prompt-input">{pending.label}</Label>}
              {pending?.multiline ? (
                <Textarea
                  id="prompt-input"
                  autoFocus
                  value={value}
                  placeholder={pending?.placeholder}
                  onChange={(e) => setValue(e.target.value)}
                  rows={4}
                />
              ) : (
                <Input
                  id="prompt-input"
                  autoFocus
                  value={value}
                  placeholder={pending?.placeholder}
                  onChange={(e) => setValue(e.target.value)}
                />
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleClose(null)}>
                {pending?.cancelLabel ?? "Cancel"}
              </Button>
              <Button type="submit">{pending?.confirmLabel ?? "OK"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PromptContext.Provider>
  );
};

export const usePromptDialog = (): PromptFn => {
  const ctx = useContext(PromptContext);
  if (!ctx) {
    return async (opts) => window.prompt(opts.title, opts.defaultValue ?? "");
  }
  return ctx;
};
