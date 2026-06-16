---
name: Employee hierarchy visibility duplication
description: Three route modules independently re-implement employee-visibility-by-job-title-hierarchy; they must stay in lockstep, especially the level-0 (HR) case.
---

# Employee hierarchy visibility is duplicated across modules

`server/routes/occurrences.ts` (attendance), `server/routes/coaching.ts`, and
`server/routes/reports.ts` each define their own `getHierarchyLevel(jobTitle)`
plus their own filter logic deciding WHICH employees a non-admin/non-viewer user
may see/act on. The logic is copy-pasted, not shared — so it drifts.

**The level-0 rule:** `getHierarchyLevel` returns 0 for any title not in the
manager title lists (district/store/asst/team-lead) — this includes HR and other
non-store roles, and null titles. A user whose linked employee record has a
level-0 title must be treated as "sees everyone within their allowed locations",
i.e. the filter must be `managerLevel === 0 || managerLevel >= 3 → allow`.

**Why:** A real bug — HR-role users (custom role like `hradmin`) saw an EMPTY
employee dropdown in the attendance module. Coaching had the `=== 0` case;
attendance's occurrences.ts did NOT, so level-0 fell through to
`getHierarchyLevel(emp) < 0` (never true) → empty list. Location scoping is
applied separately/beforehand, so the `=== 0` allow does not bypass location
restrictions.

**How to apply:** When changing visibility/authorization in any one of these
three files, mirror the change in the others (or extract a shared helper). When
debugging "user X sees no employees / can't access employee", check the
managerLevel computed from their linked employee's jobTitle first.
