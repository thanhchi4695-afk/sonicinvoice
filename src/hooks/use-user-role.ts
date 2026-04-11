import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "buyer" | "warehouse" | "viewer";

/** Permission keys used throughout the app */
export type Permission =
  | "create_po" | "receive_po" | "delete_po"
  | "adjust_inventory" | "view_inventory"
  | "create_stocktake" | "view_stocktake"
  | "view_reports"
  | "manage_settings" | "manage_team"
  | "create_invoice" | "delete_invoice"
  | "manage_suppliers" | "view_suppliers"
  | "manage_transfers";

const ROLE_PERMISSIONS: Record<AppRole, Set<Permission>> = {
  admin: new Set([
    "create_po", "receive_po", "delete_po",
    "adjust_inventory", "view_inventory",
    "create_stocktake", "view_stocktake",
    "view_reports",
    "manage_settings", "manage_team",
    "create_invoice", "delete_invoice",
    "manage_suppliers", "view_suppliers",
    "manage_transfers",
  ]),
  buyer: new Set([
    "create_po", "receive_po",
    "adjust_inventory", "view_inventory",
    "create_stocktake", "view_stocktake",
    "view_reports",
    "create_invoice",
    "manage_suppliers", "view_suppliers",
    "manage_transfers",
  ]),
  warehouse: new Set([
    "receive_po",
    "view_inventory",
    "create_stocktake", "view_stocktake",
    "adjust_inventory",
  ]),
  viewer: new Set([
    "view_inventory",
    "view_stocktake",
    "view_reports",
    "view_suppliers",
  ]),
};

export function useUserRole() {
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const fetchRole = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (mounted) { setRole(null); setLoading(false); } return; }

      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();

      if (mounted) {
        setRole((data?.role as AppRole) || null);
        setLoading(false);
      }
    };

    fetchRole();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      fetchRole();
    });

    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  const hasPermission = useCallback((perm: Permission): boolean => {
    if (!role) return false;
    return ROLE_PERMISSIONS[role]?.has(perm) ?? false;
  }, [role]);

  const isAdmin = role === "admin";

  return { role, loading, hasPermission, isAdmin };
}

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Admin",
  buyer: "Buyer",
  warehouse: "Warehouse",
  viewer: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  admin: "Full access to all features and settings",
  buyer: "Create POs, receive goods, manage suppliers, adjust inventory",
  warehouse: "Receive POs, perform stocktakes, adjust stock",
  viewer: "View-only access to reports and inventory",
};
