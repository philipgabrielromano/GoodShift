// Store-scope helpers keyed by location names and employee ids.
//
// The policy itself lives in server/access-control.ts
// (getAuthorizedLocationNames): only admins are unrestricted, and a non-admin
// with no assigned stores, or whose assigned store ids no longer resolve to a
// location, has access to no stores (owner decision 2026-10-31). These helpers
// only adapt it for callers that work with ids. Orders match on Order Form
// names instead; see getUserAllowedLocationNames in routes/orders.ts.

import { storage } from "./storage";
import { getAuthorizedLocationNames } from "./access-control";

// null = unrestricted (admin); otherwise the set of location names
// (locations.name, which is what employees.location stores).
export type LocationScope = Set<string> | null;

interface ScopedUser {
  role?: string;
  locationIds?: string[] | null;
}

export async function getUserLocationScope(user: ScopedUser | null | undefined): Promise<LocationScope> {
  if (!user || !user.role) return new Set();
  return getAuthorizedLocationNames(user as Parameters<typeof getAuthorizedLocationNames>[0]);
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

// Whether the user may act on this employee's records (by the employee's
// store). Takes an employee id; access-control's canAccessEmployeeLocation
// takes the employee record.
export async function canAccessEmployeeIdLocation(user: ScopedUser | null | undefined, employeeId: number): Promise<boolean> {
  const scope = await getUserLocationScope(user);
  if (scope === null) return true;
  const employee = await storage.getEmployee(employeeId);
  return !!employee && isLocationInScope(scope, employee.location);
}
