import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import type { InsertRoleRequirement, InsertGlobalSettings } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

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
      const res = await apiRequest(api.roleRequirements.create.method, api.roleRequirements.create.path, req);
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
      await apiRequest(api.roleRequirements.delete.method, url);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.roleRequirements.list.path] });
    },
  });
}

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
      const res = await apiRequest(api.globalSettings.update.method, api.globalSettings.update.path, settings);
      return api.globalSettings.update.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.globalSettings.get.path] });
    },
  });
}
