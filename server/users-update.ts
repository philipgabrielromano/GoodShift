import { storage } from "./storage";
import { userHasFeature } from "./middleware";
import type { User } from "@shared/schema";

export type ApplyUserUpdateResult =
  | { status: 200; body: User }
  | { status: 400 | 403; body: { message: string } };

const arraysEqual = (a: unknown[] = [], b: unknown[] = []) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export async function applyUserUpdate(
  sessionUser: any,
  existing: User,
  input: Record<string, unknown>,
): Promise<ApplyUserUpdateResult> {
  const canEditProfile = await userHasFeature(sessionUser, "users.edit_profile");
  const canAssignRoles = await userHasFeature(sessionUser, "users.assign_roles");
  const canAssignLocations = await userHasFeature(sessionUser, "users.assign_locations");

  const wantsProfile = ["name", "email", "isActive"].some(
    k =>
      Object.prototype.hasOwnProperty.call(input, k) &&
      (input as any)[k] !== undefined &&
      (input as any)[k] !== (existing as any)[k]
  );
  const wantsRole =
    Object.prototype.hasOwnProperty.call(input, "role") &&
    input.role !== undefined &&
    input.role !== (existing as any).role;
  const wantsLocations =
    Object.prototype.hasOwnProperty.call(input, "locationIds") &&
    Array.isArray(input.locationIds) &&
    !arraysEqual(
      input.locationIds as unknown[],
      ((existing as any).locationIds as unknown[]) || [],
    );

  if (wantsProfile && !canEditProfile) {
    return { status: 403, body: { message: "You don't have permission to edit user profiles." } };
  }
  if (wantsRole && !canAssignRoles) {
    return { status: 403, body: { message: "You don't have permission to change user roles." } };
  }
  if (wantsLocations && !canAssignLocations) {
    return { status: 403, body: { message: "You don't have permission to change store assignments." } };
  }
  if (!wantsProfile && !wantsRole && !wantsLocations) {
    return { status: 200, body: existing };
  }

  if (wantsRole) {
    const validRoles = await storage.getRoles();
    if (!validRoles.some(r => r.name === input.role)) {
      return { status: 400, body: { message: `Invalid role: ${input.role}` } };
    }
  }

  const patch: Record<string, unknown> = {};
  if (wantsProfile) {
    for (const k of ["name", "email", "isActive"]) {
      if (Object.prototype.hasOwnProperty.call(input, k)) patch[k] = (input as any)[k];
    }
  }
  if (wantsRole) patch.role = input.role;
  if (wantsLocations) patch.locationIds = input.locationIds;

  const user = await storage.updateUser((existing as any).id, patch as any);
  return { status: 200, body: user };
}
