import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { StoreMode } from "@/hooks/use-store-mode";
import { supabase } from "@/integrations/supabase/client";

interface StoreModePillProps {
  mode: StoreMode;
  onOpenAccount: () => void;
}

/**
 * Shopify/Lightspeed mode pill (#13). Replaces the previously-dead title-only
 * button. Click opens a real menu: shows the active platform, lets the user
 * jump to integrations or sign out.
 */
const StoreModePill = ({ mode, onOpenAccount }: StoreModePillProps) => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${mode.modeBadge.color}`}
          aria-label={`${mode.modeBadge.label} — open account menu`}
        >
          <span>{mode.modeBadge.emoji}</span>
          {mode.modeBadge.label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-[10px] uppercase text-muted-foreground tracking-wider">
          Active mode
        </DropdownMenuLabel>
        <div className="px-2 py-1.5 text-xs">
          <div className="font-medium text-foreground flex items-center gap-1.5">
            <span>{mode.modeBadge.emoji}</span>
            {mode.modeBadge.label}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Exports use {mode.exportLabel}.
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[10px] uppercase text-muted-foreground tracking-wider">
          Account
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={onOpenAccount}>
          Account & integrations
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/billing")}>
          Billing
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut} className="text-destructive">
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default StoreModePill;
