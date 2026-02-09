import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import type { ShiftPreset, InsertShiftPreset } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

export function useShiftPresets() {
  return useQuery({
    queryKey: [api.shiftPresets.list.path],
    queryFn: async () => {
      const res = await fetch(api.shiftPresets.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch shift presets");
      const data = await res.json();
      return data as ShiftPreset[];
    },
  });
}

export function useShiftPreset(id: number) {
  return useQuery({
    queryKey: [api.shiftPresets.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.shiftPresets.get.path, { id });
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch shift preset");
      const data = await res.json();
      return data as ShiftPreset;
    },
    enabled: !!id,
  });
}

export function useCreateShiftPreset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (preset: InsertShiftPreset) => {
      const res = await apiRequest(api.shiftPresets.create.method, api.shiftPresets.create.path, preset);
      return await res.json() as ShiftPreset;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.shiftPresets.list.path] });
    },
  });
}

export function useUpdateShiftPreset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & Partial<InsertShiftPreset>) => {
      const url = buildUrl(api.shiftPresets.update.path, { id });
      const res = await apiRequest(api.shiftPresets.update.method, url, updates);
      return await res.json() as ShiftPreset;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.shiftPresets.list.path] });
    },
  });
}

export function useDeleteShiftPreset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.shiftPresets.delete.path, { id });
      await apiRequest(api.shiftPresets.delete.method, url);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.shiftPresets.list.path] });
    },
  });
}
