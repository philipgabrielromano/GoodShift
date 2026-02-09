import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import type { Location, InsertLocation } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

export function useLocations() {
  return useQuery({
    queryKey: [api.locations.list.path],
    queryFn: async () => {
      const res = await fetch(api.locations.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch locations");
      const data = await res.json();
      return data as Location[];
    },
  });
}

export function useLocation(id: number) {
  return useQuery({
    queryKey: [api.locations.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.locations.get.path, { id });
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch location");
      const data = await res.json();
      return data as Location;
    },
    enabled: !!id,
  });
}

export function useCreateLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (location: InsertLocation) => {
      const res = await apiRequest(api.locations.create.method, api.locations.create.path, location);
      return await res.json() as Location;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.locations.list.path] });
    },
  });
}

export function useUpdateLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & Partial<InsertLocation>) => {
      const url = buildUrl(api.locations.update.path, { id });
      const res = await apiRequest(api.locations.update.method, url, updates);
      return await res.json() as Location;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.locations.list.path] });
    },
  });
}

export function useDeleteLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.locations.delete.path, { id });
      await apiRequest(api.locations.delete.method, url);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.locations.list.path] });
    },
  });
}
