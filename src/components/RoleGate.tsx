import { type Permission, useUserRole } from "@/hooks/use-user-role";
import { Shield } from "lucide-react";

interface Props {
  permission: Permission;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/** Renders children only if user has the required permission */
export default function RoleGate({ permission, children, fallback }: Props) {
  const { hasPermission, loading } = useUserRole();

  if (loading) return null;
  if (!hasPermission(permission)) {
    return fallback ? <>{fallback}</> : (
      <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground">
        <Shield className="w-4 h-4" />
        <span>You don't have permission to perform this action.</span>
      </div>
    );
  }

  return <>{children}</>;
}
