import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import type { RoleRequirement, InsertRoleRequirement, InsertGlobalSettings } from "@shared/schema";

// Role Requirements
export function useRoleRequirements() {
  return useQuery({
    queryKey: [api.roleRequirements.list.path],
    queryFn: async () => {
      const res = await fetch(api.roleRequirements.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch role requirements");
      const data = await res.json();
      return api.roleRequirements.list.responses[200].parse(data);
    },
  });
}

export function useCreateRoleRequirement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (req: InsertRoleRequirement) => {
      const res = await fetch(api.roleRequirements.create.path, {
        method: api.roleRequirements.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to create role requirement");
      return api.roleRequirements.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.roleRequirements.list.path] });
    },
  });
}

export function useDeleteRoleRequirement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.roleRequirements.delete.path, { id });
      const res = await fetch(url, {
        method: api.roleRequirements.delete.method,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete role requirement");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.roleRequirements.list.path] });
    },
  });
}

// Global Settings
export function useGlobalSettings() {
  return useQuery({
    queryKey: [api.globalSettings.get.path],
    queryFn: async () => {
      const res = await fetch(api.globalSettings.get.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch settings");
      const data = await res.json();
      return api.globalSettings.get.responses[200].parse(data);
    },
  });
}

export function useUpdateGlobalSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings: InsertGlobalSettings) => {
      const res = await fetch(api.globalSettings.update.path, {
        method: api.globalSettings.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update settings");
      return api.globalSettings.update.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.globalSettings.get.path] });
    },
  });
}
