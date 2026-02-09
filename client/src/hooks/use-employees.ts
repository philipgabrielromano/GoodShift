import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import type { InsertEmployee } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

export function useEmployees(options?: { retailOnly?: boolean; enabled?: boolean }) {
  const retailOnly = options?.retailOnly ?? false;
  const enabled = options?.enabled ?? true;
  const url = retailOnly 
    ? `${api.employees.list.path}?retailOnly=true`
    : api.employees.list.path;
  
  return useQuery({
    queryKey: [api.employees.list.path, { retailOnly }],
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch employees");
      const data = await res.json();
      return api.employees.list.responses[200].parse(data);
    },
    enabled,
  });
}

export function useEmployee(id: number) {
  return useQuery({
    queryKey: [api.employees.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.employees.get.path, { id });
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch employee");
      const data = await res.json();
      return api.employees.get.responses[200].parse(data);
    },
    enabled: !!id,
  });
}

export function useCreateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (employee: InsertEmployee) => {
      const res = await apiRequest(api.employees.create.method, api.employees.create.path, employee);
      return api.employees.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.employees.list.path] });
    },
  });
}

export function useUpdateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & Partial<InsertEmployee>) => {
      const url = buildUrl(api.employees.update.path, { id });
      const res = await apiRequest(api.employees.update.method, url, updates);
      return api.employees.update.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.employees.list.path] });
    },
  });
}

export function useDeleteEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.employees.delete.path, { id });
      await apiRequest(api.employees.delete.method, url);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.employees.list.path] });
    },
  });
}

export function useToggleScheduleVisibility() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isHiddenFromSchedule }: { id: number; isHiddenFromSchedule: boolean }) => {
      const url = buildUrl(api.employees.toggleScheduleVisibility.path, { id });
      const res = await apiRequest(api.employees.toggleScheduleVisibility.method, url, { isHiddenFromSchedule });
      return api.employees.toggleScheduleVisibility.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.employees.list.path] });
    },
  });
}
