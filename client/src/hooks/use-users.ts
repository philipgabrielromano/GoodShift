import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import type { User, InsertUser } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

export function useUsers() {
  return useQuery<User[]>({
    queryKey: [api.users.list.path],
    queryFn: async () => {
      const res = await fetch(api.users.list.path, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 403) return [];
        throw new Error("Failed to fetch users");
      }
      return res.json();
    },
  });
}

export function useUser(id: number) {
  return useQuery<User>({
    queryKey: [api.users.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.users.get.path, { id });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch user");
      return res.json();
    },
    enabled: !!id,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (user: InsertUser) => {
      const res = await apiRequest(api.users.create.method, api.users.create.path, user);
      return res.json() as Promise<User>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.users.list.path] });
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...user }: Partial<InsertUser> & { id: number }) => {
      const url = buildUrl(api.users.update.path, { id });
      const res = await apiRequest(api.users.update.method, url, user);
      return res.json() as Promise<User>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.users.list.path] });
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.users.delete.path, { id });
      await apiRequest(api.users.delete.method, url);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.users.list.path] });
    },
  });
}

export function useCurrentUser() {
  return useQuery<{ 
    isAuthenticated: boolean; 
    user: { 
      id: number; 
      name: string; 
      email: string; 
      role: string; 
      locationIds: string[] | null 
    } | null; 
    ssoConfigured: boolean 
  }>({
    queryKey: ["/api/auth/status"],
  });
}
