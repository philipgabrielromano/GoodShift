import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import type { Shift, InsertShift } from "@shared/schema";

export function useShifts(start?: string, end?: string, employeeId?: number) {
  return useQuery({
    queryKey: [api.shifts.list.path, start, end, employeeId],
    queryFn: async () => {
      const url = new URL(api.shifts.list.path, window.location.origin);
      if (start) url.searchParams.set("start", start);
      if (end) url.searchParams.set("end", end);
      if (employeeId) url.searchParams.set("employeeId", employeeId.toString());

      const res = await fetch(url.toString(), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch shifts");
      const data = await res.json();
      
      // Parse dates properly since JSON returns strings
      const rawData = api.shifts.list.responses[200].parse(data);
      return rawData.map(s => ({
        ...s,
        startTime: new Date(s.startTime),
        endTime: new Date(s.endTime)
      }));
    },
  });
}

export function useCreateShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (shift: InsertShift) => {
      const res = await fetch(api.shifts.create.path, {
        method: api.shifts.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(shift),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to create shift");
      return api.shifts.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.shifts.list.path] });
    },
  });
}

export function useUpdateShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & Partial<InsertShift>) => {
      const url = buildUrl(api.shifts.update.path, { id });
      const res = await fetch(url, {
        method: api.shifts.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update shift");
      return api.shifts.update.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.shifts.list.path] });
    },
  });
}

export function useDeleteShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.shifts.delete.path, { id });
      const res = await fetch(url, {
        method: api.shifts.delete.method,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete shift");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.shifts.list.path] });
    },
  });
}
