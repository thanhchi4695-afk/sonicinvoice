import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getLocations } from "@/lib/shopify-api";

export interface ShopifyLocation {
  id: string; // Shopify location_id (string)
  name: string;
  active: boolean;
}

const LS_KEY = "sonic_selected_location_v1";

/**
 * Hook for managing the global "selected location" filter across
 * Inventory, Stock on Hand, and Low Stock screens.
 *
 * - Persists the user's selection in localStorage so it survives refresh.
 * - Loads the list of available locations from the cached `shopify_locations`
 *   table, falling back to a live Shopify Admin API call (and seeding the cache).
 *
 * The selected value is always either "all" or a Shopify location_id (string).
 */
export function useShopifyLocations() {
  const [locations, setLocations] = useState<ShopifyLocation[]>([]);
  const [selected, setSelected] = useState<string>(() => {
    try {
      return localStorage.getItem(LS_KEY) || "all";
    } catch {
      return "all";
    }
  });
  const [loading, setLoading] = useState(true);

  // Persist selection
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, selected);
    } catch {
      /* ignore */
    }
  }, [selected]);

  const refresh = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLocations([]);
        return;
      }

      // 1) Try cache first unless forced
      if (!force) {
        const { data: cached } = await supabase
          .from("shopify_locations")
          .select("location_id, location_name, is_active")
          .eq("user_id", user.id)
          .order("location_name");

        if (cached && cached.length > 0) {
          setLocations(
            cached.map((c) => ({
              id: c.location_id,
              name: c.location_name,
              active: c.is_active,
            })),
          );
          return;
        }
      }

      // 2) Fall back to live Shopify call + seed cache
      const live = await getLocations();
      setLocations(live);

      if (live.length > 0) {
        const rows = live.map((l) => ({
          user_id: user.id,
          location_id: l.id,
          location_name: l.name,
          is_active: l.active,
        }));
        await supabase
          .from("shopify_locations")
          .upsert(rows, { onConflict: "user_id,location_id" });
      }
    } catch (err) {
      console.warn("[useShopifyLocations] refresh failed", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh(false);
  }, [refresh]);

  const selectedLocation =
    selected === "all"
      ? null
      : locations.find((l) => l.id === selected) || null;

  return {
    locations,
    selected, // "all" | location_id
    selectedLocation, // resolved object or null
    setSelected,
    refresh,
    loading,
  };
}
