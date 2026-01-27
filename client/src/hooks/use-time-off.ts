import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type TimeOffRequest, type InsertTimeOffRequest } from "@shared/routes";

export function useTimeOffRequests() {
  return useQuery({
    queryKey: [api.timeOffRequests.list.path],
    queryFn: async () => {
      const res = await fetch(api.timeOffRequests.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch requests");
      const data = await res.json();
      const parsed = api.timeOffRequests.list.responses[200].parse(data);
      // Ensure dates are Date objects
      return parsed.map(r => ({
        ...r,
        startDate: new Date(r.startDate),
        endDate: new Date(r.endDate)
      }));
    },
  });
}

export function useCreateTimeOffRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (req: InsertTimeOffRequest) => {
      const res = await fetch(api.timeOffRequests.create.path, {
        method: api.timeOffRequests.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to create request");
      return api.timeOffRequests.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.timeOffRequests.list.path] });
    },
  });
}

export function useUpdateTimeOffRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & Partial<InsertTimeOffRequest>) => {
      const url = buildUrl(api.timeOffRequests.update.path, { id });
      const res = await fetch(url, {
        method: api.timeOffRequests.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update request");
      return api.timeOffRequests.update.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.timeOffRequests.list.path] });
    },
  });
}
