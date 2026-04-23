import { useQuery } from "@tanstack/react-query";

interface AuthStatus {
  isAuthenticated: boolean;
  user: { id: number; name: string; email: string; role: string; locationIds?: string[] } | null;
  ssoConfigured?: boolean;
  accessibleFeatures?: string[];
}

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
