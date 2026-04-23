import { useQuery } from "@tanstack/react-query";

interface AuthStatus {
  isAuthenticated: boolean;
  user: { id: number; name: string; email: string; role: string; locationIds?: string[] } | null;
  ssoConfigured?: boolean;
  accessibleFeatures?: string[];
}

/**
 * Permission hook — single source of truth for frontend access checks.
 *
 * Convention:
 *   - Use `can("feature.key")` for any permission gate that maps to a feature
 *     defined in the permissions matrix. This is the preferred form because it
 *     respects custom roles configured by admins.
 *   - Use `role === "admin"` ONLY for operations that are intentionally
 *     reserved for the built-in admin role and have no feature key (e.g.
 *     "show every location regardless of assignment", destructive global
 *     config, etc.). Keep these checks rare and obvious.
 *   - Avoid bare `authStatus.user.role === "manager" | "optimizer" | "viewer"`
 *     comparisons in pages/components — they bypass custom roles. Prefer
 *     `can(feature)` instead.
 */
export function usePermissions() {
  const { data } = useQuery<AuthStatus>({ queryKey: ["/api/auth/status"] });
  const role = data?.user?.role;
  const features = data?.accessibleFeatures ?? [];

  const can = (feature: string): boolean => {
    if (role === "admin") return true;
    return features.includes(feature);
  };

  return { can, role, user: data?.user ?? null };
}
