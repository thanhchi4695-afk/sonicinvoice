import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SHORTCUT_DEFINITIONS } from "@/hooks/use-keyboard-shortcuts";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const KeyboardShortcutsModal = ({ open, onOpenChange }: Props) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <span>⌨️</span> Keyboard Shortcuts
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-1">
        {SHORTCUT_DEFINITIONS.map((s) => (
          <div key={s.key + (s.ctrl ? "ctrl" : "") + (s.shift ? "shift" : "")} className="flex items-center justify-between py-2 border-b border-border last:border-0">
            <span className="text-sm text-foreground">{s.description}</span>
            <kbd className="inline-flex items-center gap-0.5 px-2 py-1 rounded bg-muted text-muted-foreground text-xs font-mono border border-border">
              {s.label}
            </kbd>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        Shortcuts are disabled when typing in input fields.
      </p>
    </DialogContent>
  </Dialog>
);

export default KeyboardShortcutsModal;
