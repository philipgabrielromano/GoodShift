// Which stores a signed-in user may see and act on.
//
// Single source of truth for store scoping outside the order module (orders
// match on Order Form aliases; see getUserAllowedLocationNames in
// routes/orders.ts). Several modules used to re-implement this and treated a
// non-admin with no assigned stores — or with stores that no longer exist —
// as unrestricted, exposing every store's HR data.
//
// Policy (owner decision 2026-10-31): only admins are unrestricted. A
// non-admin with no assigned stores, or whose assigned store ids no longer
// resolve to a location, has access to no stores.

import { storage } from "./storage";

// null = unrestricted (admin); otherwise the set of location names
// (locations.name, which is what employees.location stores).
export type LocationScope = Set<string> | null;

interface ScopedUser {
  role?: string;
  locationIds?: string[] | null;
}

export async function getUserLocationScope(user: ScopedUser | null | undefined): Promise<LocationScope> {
  if (!user || !user.role) return new Set();
  if (user.role === "admin") return null;
  const ids = new Set((user.locationIds ?? []).filter(Boolean).map(String));
  if (ids.size === 0) return new Set();
  const allLocations = await storage.getLocations();
  return new Set(allLocations.filter(l => ids.has(String(l.id))).map(l => l.name));
}

export function isLocationInScope(scope: LocationScope, locationName: string | null | undefined): boolean {
  if (scope === null) return true;
  return !!locationName && scope.has(locationName);
}

// Ids of employees whose store is in scope; null when unrestricted.
export async function getEmployeeIdsInScope(scope: LocationScope): Promise<Set<number> | null> {
  if (scope === null) return null;
  if (scope.size === 0) return new Set();
  const employees = await storage.getEmployees();
  return new Set(employees.filter(e => isLocationInScope(scope, e.location)).map(e => e.id));
}

// Whether the user may act on this employee's records (by the employee's store).
export async function canAccessEmployeeLocation(user: ScopedUser | null | undefined, employeeId: number): Promise<boolean> {
  const scope = await getUserLocationScope(user);
  if (scope === null) return true;
  const employee = await storage.getEmployee(employeeId);
  return !!employee && isLocationInScope(scope, employee.location);
}
