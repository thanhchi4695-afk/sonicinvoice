import { createContext, useCallback, useContext, useState, ReactNode } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

export const ConfirmDialogProvider = ({ children }: { children: ReactNode }) => {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => setPending({ ...opts, resolve }));
  }, []);

  const handleClose = (result: boolean) => {
    if (pending) pending.resolve(result);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={!!pending} onOpenChange={(o) => { if (!o) handleClose(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
            {pending?.description && (
              <AlertDialogDescription>{pending.description}</AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => handleClose(false)}>
              {pending?.cancelLabel ?? "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleClose(true)}
              className={pending?.destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
            >
              {pending?.confirmLabel ?? "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
};

export const useConfirmDialog = (): ConfirmFn => {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    // Fallback to native confirm if provider not mounted (defensive)
    return async (opts) => window.confirm(`${opts.title}${opts.description ? "\n\n" + opts.description : ""}`);
  }
  return ctx;
};
