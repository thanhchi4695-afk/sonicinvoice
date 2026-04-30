import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type RestockStatus,
  RESTOCK_STATUS_LABEL,
  RESTOCK_STATUS_EMOJI,
  RESTOCK_STATUS_OPTIONS,
} from "@/lib/restock-status";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  value: RestockStatus;
  platformVariantId: string | null | undefined;
  shopDomain?: string | null;
  userId: string | null;
  onChange?: (next: RestockStatus) => void;
  size?: "sm" | "xs";
  disabled?: boolean;
}

/** Compact dropdown editor for per-variant restock status (writes override row). */
export default function RestockStatusCell({
  value,
  platformVariantId,
  shopDomain,
  userId,
  onChange,
  size = "sm",
  disabled,
}: Props) {
  const [saving, setSaving] = useState(false);

  const handleChange = async (next: RestockStatus) => {
    if (!userId) {
      toast.error("Not signed in");
      return;
    }
    if (!platformVariantId) {
      // Should not happen — InventoryDashboard now passes internal variant UUID as fallback
      toast.warning("Variant ID missing — status saved locally only");
      onChange?.(next);
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("restock_status_override" as any)
        .upsert(
          {
            user_id: userId,
            platform: "shopify",
            platform_variant_id: String(platformVariantId),
            shop_domain: shopDomain ?? null,
            restock_status: next,
            updated_by: userId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,platform,platform_variant_id" },
        );
      if (error) {
        console.error("[RestockStatusCell] upsert failed:", error);
        toast.error(error.message || "Failed to save restock status");
        return;
      }
      console.log("[RestockStatusCell] saved:", next, "for variant:", platformVariantId);
      toast.success(`Restock status updated to ${RESTOCK_STATUS_LABEL[next]}`);
      onChange?.(next);
    } catch (e: any) {
      console.error("[RestockStatusCell] unexpected error:", e);
      toast.error(e.message || "Failed to update restock status");
    } finally {
      setSaving(false);
    }
  };

  const trigger = size === "xs" ? "h-7 text-[11px] px-2" : "h-8 text-xs px-2";

  return (
    <Select value={value} onValueChange={handleChange} disabled={disabled || saving}>
      <SelectTrigger className={cn("w-[130px]", trigger)}>
        <SelectValue>
          <span>
            {RESTOCK_STATUS_EMOJI[value]} {RESTOCK_STATUS_LABEL[value]}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {RESTOCK_STATUS_OPTIONS.map((s) => (
          <SelectItem key={s} value={s} className="text-xs">
            {RESTOCK_STATUS_EMOJI[s]} {RESTOCK_STATUS_LABEL[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Bulk helper – set status for a list of variants. */
export async function setRestockBulk(
  userId: string,
  variants: Array<{ platform_variant_id: string | null | undefined; shop_domain?: string | null }>,
  status: RestockStatus,
) {
  const rows = variants
    .filter((v) => v.platform_variant_id)
    .map((v) => ({
      user_id: userId,
      platform: "shopify",
      platform_variant_id: String(v.platform_variant_id),
      shop_domain: v.shop_domain ?? null,
      restock_status: status,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }));
  if (!rows.length) {
    toast.error("None of the selected variants have a platform ID");
    return 0;
  }
  const { error } = await supabase
    .from("restock_status_override" as any)
    .upsert(rows, { onConflict: "user_id,platform,platform_variant_id" });
  if (error) {
    toast.error(error.message);
    return 0;
  }
  return rows.length;
}
