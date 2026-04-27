import { MapPin } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useShopifyLocations } from "@/hooks/use-shopify-locations";
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
  showLabel?: boolean;
  size?: "sm" | "md";
}

/**
 * Shared location picker. Shows "All locations" plus every active
 * Shopify location for this user. Selection is persisted globally
 * via the `useShopifyLocations` hook.
 */
export default function LocationFilter({
  className,
  showLabel = true,
  size = "md",
}: Props) {
  const { locations, selected, setSelected, loading } = useShopifyLocations();

  const triggerClass = size === "sm" ? "h-8 text-xs" : "h-9 text-sm";

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {showLabel && (
        <Label className="text-xs text-muted-foreground flex items-center gap-1">
          <MapPin className="h-3 w-3" /> Location
        </Label>
      )}
      <Select value={selected} onValueChange={setSelected} disabled={loading}>
        <SelectTrigger className={cn("min-w-[180px]", triggerClass)}>
          <SelectValue placeholder="All locations" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All locations</SelectItem>
          {locations
            .filter((l) => l.active)
            .map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </div>
  );
}
