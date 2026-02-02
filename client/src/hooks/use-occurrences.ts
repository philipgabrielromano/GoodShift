import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Occurrence, OccurrenceAdjustment } from "@shared/schema";

interface OccurrenceSummary {
  employeeId: number;
  periodStart: string;
  periodEnd: string;
  totalOccurrences: number;
  adjustmentsThisYear: number;
  adjustmentsRemaining: number;
  netTally: number;
  occurrenceCount: number;
  occurrences: Occurrence[];
  adjustments: OccurrenceAdjustment[];
  perfectAttendanceBonus?: boolean;
  perfectAttendanceBonusValue?: number;
  perfectAttendanceUsed?: number;
  perfectAttendanceEligible?: boolean;
  perfectAttendanceWouldBeWasted?: boolean;
}

export function useOccurrences(employeeId: number, startDate: string, endDate: string) {
  return useQuery<Occurrence[]>({
    queryKey: ["/api/occurrences", employeeId, startDate, endDate],
    queryFn: async () => {
      const res = await fetch(`/api/occurrences/${employeeId}?startDate=${startDate}&endDate=${endDate}`, {
        credentials: "include"
      });
      if (!res.ok) throw new Error("Failed to fetch occurrences");
      return res.json();
    },
    enabled: !!employeeId && !!startDate && !!endDate
  });
}

export function useOccurrenceSummary(employeeId: number, options?: { enabled?: boolean }) {
  const externalEnabled = options?.enabled ?? true;
  return useQuery<OccurrenceSummary>({
    queryKey: ["/api/occurrences", employeeId, "summary"],
    queryFn: async () => {
      const res = await fetch(`/api/occurrences/${employeeId}/summary`, {
        credentials: "include"
      });
      if (!res.ok) throw new Error("Failed to fetch occurrence summary");
      return res.json();
    },
    enabled: !!employeeId && externalEnabled
  });
}

export function useCreateOccurrence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      employeeId: number;
      occurrenceDate: string;
      occurrenceType: string;
      occurrenceValue: number;
      isNcns?: boolean;
      isFmla?: boolean;
      isConsecutiveSickness?: boolean;
      reason?: string;
      illnessGroupId?: string;
      notes?: string;
      documentUrl?: string;
    }) => {
      const res = await apiRequest("POST", "/api/occurrences", data);
      return res.json();
    },
    onSuccess: (_, variables) => {
      // Invalidate all occurrence-related queries for this employee
      queryClient.invalidateQueries({ queryKey: ["/api/occurrences", variables.employeeId] });
      // Also invalidate alerts since adding occurrences may trigger new alerts
      queryClient.invalidateQueries({ queryKey: ["/api/occurrence-alerts"] });
    }
  });
}

export function useRetractOccurrence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason, employeeId }: { id: number; reason: string; employeeId: number }) => {
      const res = await apiRequest("POST", `/api/occurrences/${id}/retract`, { reason });
      return res.json();
    },
    onSuccess: (_, variables) => {
      // Invalidate the occurrence summary specifically
      queryClient.invalidateQueries({ queryKey: ["/api/occurrences", variables.employeeId, "summary"] });
      // Also invalidate other occurrence-related queries for this employee
      queryClient.invalidateQueries({ queryKey: ["/api/occurrences", variables.employeeId] });
      // Also invalidate alerts since retracting occurrences may change alert status
      queryClient.invalidateQueries({ queryKey: ["/api/occurrence-alerts"] });
    }
  });
}

export function useRetractAdjustment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason, employeeId }: { id: number; reason: string; employeeId: number }) => {
      const res = await apiRequest("POST", `/api/occurrence-adjustments/${id}/retract`, { reason });
      return res.json();
    },
    onSuccess: (_, variables) => {
      // Invalidate the occurrence summary specifically (includes adjustments remaining count)
      queryClient.invalidateQueries({ queryKey: ["/api/occurrences", variables.employeeId, "summary"] });
      // Also invalidate other occurrence-related queries for this employee
      queryClient.invalidateQueries({ queryKey: ["/api/occurrences", variables.employeeId] });
      // Also invalidate alerts since retracting adjustments may change alert status
      queryClient.invalidateQueries({ queryKey: ["/api/occurrence-alerts"] });
    }
  });
}

export function useCreateOccurrenceAdjustment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      employeeId: number;
      adjustmentValue: number;
      adjustmentType: string;
      notes?: string;
      calendarYear?: number;
    }) => {
      const res = await apiRequest("POST", "/api/occurrence-adjustments", data);
      return res.json();
    },
    onSuccess: (_, variables) => {
      // Invalidate all occurrence-related queries for this employee
      queryClient.invalidateQueries({ queryKey: ["/api/occurrences", variables.employeeId] });
      // Also invalidate alerts since adjustments may change alert status
      queryClient.invalidateQueries({ queryKey: ["/api/occurrence-alerts"] });
    }
  });
}

export interface OccurrenceAlert {
  employeeId: number;
  employeeName: string;
  location: string | null;
  jobTitle: string;
  occurrenceTotal: number;
  netTally: number;
  threshold: 5 | 7 | 8;
  message: string;
}

export function useOccurrenceAlerts() {
  return useQuery<OccurrenceAlert[]>({
    queryKey: ["/api/occurrence-alerts"],
    queryFn: async () => {
      const res = await fetch("/api/occurrence-alerts", { credentials: "include" });
      if (res.status === 403) return [];
      if (!res.ok) throw new Error("Failed to fetch occurrence alerts");
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 2 * 60 * 1000,
  });
}

export interface CorrectiveAction {
  id: number;
  employeeId: number;
  actionType: 'warning' | 'final_warning' | 'termination';
  actionDate: string;
  occurrenceCount: number;
  createdBy: number | null;
  createdAt: string | null;
  notes: string | null;
}

export function useCorrectiveActions(employeeId: number, options?: { enabled?: boolean }) {
  return useQuery<CorrectiveAction[]>({
    queryKey: ["/api/corrective-actions", employeeId],
    queryFn: async () => {
      const res = await fetch(`/api/corrective-actions/${employeeId}`, { credentials: "include" });
      if (res.status === 403) return [];
      if (!res.ok) throw new Error("Failed to fetch corrective actions");
      return res.json();
    },
    enabled: options?.enabled !== false && employeeId > 0,
  });
}

export function useCreateCorrectiveAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { 
      employeeId: number; 
      actionType: 'warning' | 'final_warning' | 'termination'; 
      actionDate: string; 
      occurrenceCount: number;
      notes?: string;
    }) => {
      const res = await apiRequest("POST", "/api/corrective-actions", data);
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/corrective-actions", variables.employeeId] });
      queryClient.invalidateQueries({ queryKey: ["/api/occurrence-alerts"] });
    }
  });
}

export function useDeleteCorrectiveAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, employeeId }: { id: number; employeeId: number }) => {
      const res = await apiRequest("DELETE", `/api/corrective-actions/${id}`);
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/corrective-actions", variables.employeeId] });
      queryClient.invalidateQueries({ queryKey: ["/api/occurrence-alerts"] });
    }
  });
}
