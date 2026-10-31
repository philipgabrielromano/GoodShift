import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_FEATURE_PERMISSIONS, SYSTEM_FEATURES, initialScheduleExportRoles } from "../shared/schema";

test("schedule PDF export is a separate Scheduling permission with the existing viewer defaults", () => {
  const feature = SYSTEM_FEATURES.find((entry) => entry.feature === "schedule.export_pdf");
  assert.equal(feature?.category, "Scheduling");
  assert.deepEqual(DEFAULT_FEATURE_PERMISSIONS["schedule.export_pdf"], ["admin", "manager", "optimizer", "viewer"]);
  assert.notStrictEqual(DEFAULT_FEATURE_PERMISSIONS["schedule.export_pdf"], DEFAULT_FEATURE_PERMISSIONS["schedule.view"]);
  assert.notStrictEqual(DEFAULT_FEATURE_PERMISSIONS["schedule.export_pdf"], DEFAULT_FEATURE_PERMISSIONS["schedule.edit"]);
  assert.notStrictEqual(DEFAULT_FEATURE_PERMISSIONS["schedule.export_pdf"], DEFAULT_FEATURE_PERMISSIONS["schedule.publish"]);
});

test("missing export config starts from effective view roles, including legacy grants", () => {
  assert.deepEqual(
    initialScheduleExportRoles([
      { feature: "schedule.view", allowedRoles: ["admin", "dmdirector", "ordering"] },
      { feature: "schedule", allowedRoles: ["team_lead"] },
    ]),
    ["admin", "dmdirector", "ordering", "team_lead"],
  );
  assert.deepEqual(
    initialScheduleExportRoles([{ feature: "schedule.view", allowedRoles: [] }]),
    [],
  );
});

test("browser PDF export is available in both layouts without edit rights, only for visible authorized schedules", () => {
  const source = readFileSync(new URL("../client/src/pages/Schedule.tsx", import.meta.url), "utf8");
  assert.match(source, /const canExportSchedulePDF = can\("schedule\.export_pdf"\)/);
  assert.match(source, /const canExportVisibleSchedule = canExportSchedulePDF\s*&& canViewSchedule\s*&& \(userRole !== "viewer" \|\| isSchedulePublished\)\s*&& \(isAdmin \|\| userLocations\.some\(location => location\.name === selectedLocation\)\)/);
  assert.match(source, /const handleExportPDF = async \(\) => \{\s*if \(!canExportVisibleSchedule\) \{[\s\S]*?return;\s*\}/);
  assert.match(source, /\(\(!isMobile && canActOnSchedule\) \|\| canExportVisibleSchedule\)/);
  assert.match(source, /\{canExportVisibleSchedule && <Button[\s\S]*?onClick=\{handleExportPDF\}[\s\S]*?Export PDF[\s\S]*?<\/Button>\}/);
  assert.match(source, /if \(!shifts \|\| !employees \|\| shiftsStale\)/);
  assert.match(source, /const exportedEmployeeIds = new Set\(filteredEmployees\.map\(emp => emp\.id\)\)/);
});