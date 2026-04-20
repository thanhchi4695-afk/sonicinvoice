// One-time Point-of-Sale picker shown before the user uploads their first
// invoice. Persists choice via prompt-builder's saveStoreConfig so the rest
// of the app (CSV exports, sync targets, etc.) routes correctly.

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ShoppingBag, Monitor } from "lucide-react";
import { getStoreConfig, saveStoreConfig, type StoreType, type LightspeedVersion } from "@/lib/prompt-builder";

const POS_PROMPTED_KEY = "pos_prompted_sonic_invoice";

export function hasPickedPOS(): boolean {
  return localStorage.getItem(POS_PROMPTED_KEY) === "1";
}

interface Props {
  open: boolean;
  onClose: () => void;
  onPicked: (st: StoreType) => void;
}

export default function POSPickerDialog({ open, onClose, onPicked }: Props) {
  const initial = getStoreConfig();
  const [storeType, setStoreType] = useState<StoreType>(initial.storeType || "shopify");
  const [lsVersion, setLsVersion] = useState<LightspeedVersion>(initial.lightspeedVersion || "x_series");

  useEffect(() => {
    if (open) {
      const c = getStoreConfig();
      setStoreType(c.storeType || "shopify");
      setLsVersion(c.lightspeedVersion || "x_series");
    }
  }, [open]);

  const handleConfirm = () => {
    saveStoreConfig({ storeType, lightspeedVersion: lsVersion });
    localStorage.setItem(POS_PROMPTED_KEY, "1");
    onPicked(storeType);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Which POS do you use?</DialogTitle>
          <DialogDescription>
            We need this to route exports and sync targets correctly. You can change it later in Account settings.
          </DialogDescription>
        </DialogHeader>

        <RadioGroup value={storeType} onValueChange={(v) => setStoreType(v as StoreType)} className="space-y-2 my-2">
          <Label htmlFor="pos-shopify" className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 cursor-pointer hover:bg-muted/50">
            <RadioGroupItem id="pos-shopify" value="shopify" />
            <ShoppingBag className="w-5 h-5 text-primary" />
            <div className="flex-1">
              <p className="text-sm font-medium">Shopify only</p>
              <p className="text-xs text-muted-foreground">Push direct or export Shopify CSV</p>
            </div>
          </Label>

          <Label htmlFor="pos-lightspeed" className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 cursor-pointer hover:bg-muted/50">
            <RadioGroupItem id="pos-lightspeed" value="lightspeed" />
            <Monitor className="w-5 h-5 text-primary" />
            <div className="flex-1">
              <p className="text-sm font-medium">Lightspeed only</p>
              <p className="text-xs text-muted-foreground">Export Lightspeed-compatible CSV</p>
            </div>
          </Label>

          <Label htmlFor="pos-both" className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 cursor-pointer hover:bg-muted/50">
            <RadioGroupItem id="pos-both" value="lightspeed_shopify" />
            <div className="flex gap-1">
              <Monitor className="w-5 h-5 text-primary" />
              <ShoppingBag className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">Lightspeed + Shopify</p>
              <p className="text-xs text-muted-foreground">Sync to both</p>
            </div>
          </Label>
        </RadioGroup>

        {(storeType === "lightspeed" || storeType === "lightspeed_shopify") && (
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Lightspeed version</p>
            <RadioGroup value={lsVersion} onValueChange={(v) => setLsVersion(v as LightspeedVersion)} className="flex gap-4">
              <Label htmlFor="ls-x" className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem id="ls-x" value="x_series" />
                <span className="text-sm">X-Series (Vend)</span>
              </Label>
              <Label htmlFor="ls-r" className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem id="ls-r" value="r_series" />
                <span className="text-sm">R-Series (Retail)</span>
              </Label>
            </RadioGroup>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleConfirm}>Save & continue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
