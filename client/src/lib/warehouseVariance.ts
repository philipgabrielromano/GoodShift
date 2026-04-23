export interface WarehouseVariance {
  net: number;
  abs: number;
  expectedTotal: number;
  hasExpected: boolean;
}

export type VarianceLevel = "none" | "ok" | "moderate" | "high";

export function classifyVariance(v: WarehouseVariance): VarianceLevel {
  if (!v.hasExpected) return "none";
  const pct = v.expectedTotal > 0 ? v.abs / v.expectedTotal : 0;
  if (v.abs >= 25 || pct >= 0.1) return "high";
  if (v.abs >= 10 || pct >= 0.05) return "moderate";
  return "ok";
}
