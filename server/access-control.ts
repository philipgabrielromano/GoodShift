import { storage } from "./storage";
import { getEffectiveLevel, getHierarchyLevel } from "./hierarchy";
import type { Employee } from "@shared/schema";

type SessionUser = {
  id: number;
  email: string;
  role: string;
  locationIds: string[] | null;
};

export async function getAuthorizedLocationNames(user: SessionUser): Promise<Set<string> | null> {
  if (user.role === "admin") return null;
  const assignedIds = new Set((user.locationIds ?? []).map(String));
  if (assignedIds.size === 0) return new Set();
  const locations = await storage.getLocations();
  return new Set(locations.filter(location => assignedIds.has(String(location.id))).map(location => location.name));
}

export async function canAccessLocation(user: SessionUser, location: string | null | undefined): Promise<boolean> {
  const names = await getAuthorizedLocationNames(user);
  return names === null || (!!location && names.has(location));
}

export async function canManageEmployee(user: SessionUser, employee: Employee): Promise<boolean> {
  if (user.role === "admin") return true;
  if (!(await canAccessLocation(user, employee.location))) return false;

  const explicitReports = await storage.getDirectReportsForManager(user.id);
  if (explicitReports.length > 0) return explicitReports.includes(employee.id);

  const managerEmployee = await storage.getEmployeeByEmail(user.email);
  if (managerEmployee && managerEmployee.id === employee.id) return false;
  const visibleTitles = managerEmployee
    ? await storage.getVisibleJobTitlesFor(managerEmployee.jobTitle)
    : [];
  if (visibleTitles.length > 0) {
    return visibleTitles.some(title => title.toUpperCase() === employee.jobTitle.toUpperCase());
  }
  const managerLevel = getEffectiveLevel(user, managerEmployee);
  return managerLevel === 0 || managerLevel >= 3 || getHierarchyLevel(employee.jobTitle) < managerLevel;
}

export async function canAccessEmployeeLocation(user: SessionUser, employee: Employee): Promise<boolean> {
  return user.role === "admin" || canAccessLocation(user, employee.location);
}

export async function filterEmployeesByLocationScope<T extends Pick<Employee, "location">>(
  user: SessionUser,
  employees: T[],
): Promise<T[]> {
  const names = await getAuthorizedLocationNames(user);
  if (names === null) return employees;
  return employees.filter(employee => !!employee.location && names.has(employee.location));
}

export async function getAuthorizedUkgEmployeeIds(
  user: SessionUser,
  employees: Employee[],
): Promise<Set<string> | null> {
  if (user.role === "admin") return null;
  const scoped = await filterEmployeesByLocationScope(user, employees);
  return new Set(
    scoped
      .filter(employee => !!employee.ukgEmployeeId)
      .map(employee => employee.ukgEmployeeId as string),
  );
}

export async function resolveAuthorizedLocation(
  user: SessionUser,
  requestedLocation: string | undefined,
): Promise<{ effectiveLocation?: string; error?: string }> {
  if (user.role === "admin") {
    return { effectiveLocation: requestedLocation && requestedLocation !== "all" ? requestedLocation : undefined };
  }
  const names = await getAuthorizedLocationNames(user);
  if (!names || names.size === 0) return { error: "Access denied: no assigned locations" };
  if (!requestedLocation || requestedLocation === "all") {
    if (names.size === 1) return { effectiveLocation: Array.from(names)[0] };
    return { error: "You must specify a location you are assigned to" };
  }
  if (!names.has(requestedLocation)) return { error: "Access denied: location outside your assigned scope" };
  return { effectiveLocation: requestedLocation };
}