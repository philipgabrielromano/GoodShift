// Shared job-title hierarchy + role-based visibility caps.
//
// Employee visibility for attendance (occurrences), coaching, and reports is
// scoped by store hierarchy: District (4) > Store Manager (3) > Assistant
// Manager (2) > Team Lead (1) > everyone else (0). Team leads and assistant
// managers may only see/act on employees STRICTLY BELOW their own level;
// level-0 viewers (HR, corporate, unknown titles) and level >= 3 see everyone
// within their allowed locations.
//
// This module is the single source of truth. Do NOT re-declare title lists or
// level logic inside route files — the previous per-file copies drifted
// (reports.ts was missing EASSIS/ECMCOMLD/DSTTMLDR) and caused visibility bugs.

export const DISTRICT_MANAGER_TITLES = ["DSTTMLDR"];
export const STORE_MANAGER_TITLES = ["STSUPER", "WVSTMNG", "ECOMDIR"];
export const ASST_MANAGER_TITLES = ["STASSTSP", "WVSTAST", "EASSIS"];
export const TEAM_LEAD_TITLES = ["STLDWKR", "WVLDWRK", "ECMCOMLD", "ALTSTLD", "ECLEAD"];

export function getHierarchyLevel(jobTitle: string | null): number {
  if (!jobTitle) return 0;
  const upper = jobTitle.toUpperCase();
  if (DISTRICT_MANAGER_TITLES.includes(upper)) return 4;
  if (STORE_MANAGER_TITLES.includes(upper)) return 3;
  if (ASST_MANAGER_TITLES.includes(upper)) return 2;
  if (TEAM_LEAD_TITLES.includes(upper)) return 1;
  return 0;
}

// Role-based hierarchy caps. A user account whose role encodes a sub-store
// management level must never exceed that level — even when the account has
// no linked employee record (email mismatch), or the linked record's job
// title is not in the manager title lists above. Without this cap, such
// accounts fall through to store-manager-level visibility (level 3) and can
// see manager/assistant-manager records. In production most team_lead and
// asstmanager accounts have no email-matched employee record, so the role cap
// is the reliable enforcement signal.
export const ROLE_LEVEL_CAPS: Record<string, number> = {
  team_lead: 1,
  asstmanager: 2,
};

/**
 * Effective hierarchy level for a viewer: the job-title-derived level,
 * clamped by the account role's cap when one exists. A title level of 0
 * (unknown title) normally grants see-all — for capped roles it clamps to
 * the cap instead. Accounts with no linked employee record default to
 * level 3 (see-all within allowed locations) unless capped.
 */
export function getEffectiveLevel(
  user: { role?: string } | null | undefined,
  managerEmployee: { jobTitle: string | null } | undefined,
): number {
  const titleLevel = managerEmployee ? getHierarchyLevel(managerEmployee.jobTitle) : 3;
  const cap = user?.role ? ROLE_LEVEL_CAPS[user.role] : undefined;
  if (cap === undefined) return titleLevel;
  if (titleLevel === 0 || titleLevel > cap) return cap;
  return titleLevel;
}
