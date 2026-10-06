import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { computeNetTally, getRollingTallyWindow } from "../server/occurrenceTally";
import { renderSampleEmail } from "../server/emailSamples";
import { resolveBranding, EMAIL_TYPES } from "../server/emailBranding";

// Execute the actual production declarations with isolated dependencies: no DB,
// real recipients, Azure client, or test-only changes to application behavior.
function loadFunctions(path: string, names: string[], dependencies: Record<string, unknown> = {}) {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true,
    path.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const declarations = source.statements.filter(node =>
    ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ""));
  assert.equal(declarations.length, names.length);
  const code = declarations.map(node => node.getText(source).replace(/^export default /, "").replace(/^export /, "")).join("\n");
  const js = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  return vm.runInNewContext(`${js}\n({${names.join(",")}})`, {
    console: { log() {}, error(error: unknown) { throw error; } },
    ...dependencies,
  });
}

function fixture(netTally: number, actions: string[] = []) {
  const employee = { id: 1, name: "Test Employee", email: "employee@example.test", location: "Store A", jobTitle: "Cashier", isActive: true };
  const occurrences = [{ employeeId: 1, occurrenceDate: getRollingTallyWindow().endDate, occurrenceValue: netTally * 100, status: "active" }];
  const corrective = actions.map(actionType => ({ employeeId: 1, actionType }));
  const sent: Array<{ email: string; data: { threshold: number; netTally: number } }> = [];
  const storage = {
    getEmployee: async () => employee,
    getOccurrences: async () => occurrences,
    getOccurrenceAdjustments: async () => [],
    getCorrectiveActions: async () => corrective,
    getGlobalSettings: async () => ({ hrNotificationEmail: "HR@example.test, hr@example.test" }),
    getEmployees: async () => [employee,
      { ...employee, id: 2, jobTitle: "STORE_MANAGER", email: "manager@example.test" },
      { ...employee, id: 3, jobTitle: "STORE_MANAGER", location: "Store B", email: "other@example.test" },
      { ...employee, id: 4, jobTitle: "STORE_MANAGER", isActive: false, email: "inactive@example.test" }],
    getUserByEmail: async (email: string) => ({ email }),
    getAllOccurrencesInDateRange: async () => occurrences,
    getAllOccurrenceAdjustmentsInDateRange: async () => [],
    getAllCorrectiveActions: async () => corrective,
  };
  return {
    storage, sent, computeNetTally, getRollingTallyWindow,
    STORE_MANAGER_TITLES: ["STORE_MANAGER"],
    sendOccurrenceAlertEmail: async (email: string, data: any) => { sent.push({ email, data }); },
  };
}

for (const [total, added, actions, expected] of [
  [4.5, 100, [], null],
  [5, 50, [], 5],
  [5.5, 100, [], 5],
  [5.5, 50, [], null],
  [6, 100, [], null],
  [5, 100, ["warning"], null],
  [7, 100, ["warning"], 7],
  [7, 100, ["final_warning"], null],
  [8, 100, ["warning", "final_warning"], 8],
  [8, 100, ["termination"], null],
  [8, 400, [], 8],
  [8, 400, ["termination"], null],
] as const) {
  test(`email crossing: total=${total}, added=${added}, actions=${actions.join("/") || "none"}`, async () => {
    const deps = fixture(total, [...actions]);
    const { checkAndSendHRNotification } = loadFunctions("server/middleware.ts", ["checkAndSendHRNotification"], deps);
    await checkAndSendHRNotification(1, added, "https://example.test");
    assert.deepEqual(deps.sent.map(s => s.email), expected === null ? [] : ["hr@example.test", "manager@example.test"]);
    for (const sent of deps.sent) {
      assert.equal(sent.data.threshold, expected);
      assert.equal(sent.data.netTally, total);
    }
  });
}

test("in-app alerts start at five, suppress recorded actions, and preserve escalation", async () => {
  for (const [total, actions, expected] of [
    [4.5, [], null], [5, [], 5], [6, [], 5], [5, ["warning"], null],
    [7, ["warning"], 7], [8, ["warning", "final_warning"], 8],
    [8, ["warning", "final_warning", "termination"], null],
  ] as const) {
    const deps = fixture(total, [...actions]);
    const handlers = new Map<string, Function>();
    const app = Object.fromEntries(["get", "post", "delete", "put", "patch"].map(method => [method,
      (path: string, ...callbacks: Function[]) => { if (method === "get") handlers.set(path, callbacks.at(-1)!); }]));
    const { registerOccurrenceRoutes } = loadFunctions("server/routes/occurrences.ts", ["registerOccurrenceRoutes"], {
      ...deps, ObjectStorageService: class {}, requireFeatureAccess: () => () => {},
      getVisibleEmployeeIds: async () => new Set([1]),
    });
    registerOccurrenceRoutes(app);
    let result: any;
    await handlers.get("/api/occurrence-alerts")!({ session: { user: { role: "admin" } } },
      { json(value: unknown) { result = value; }, status() { throw new Error("Unexpected error response"); } });
    assert.equal(result.length, expected === null ? 0 : 1);
    if (expected !== null) assert.equal(result[0].threshold, expected);
  }
});

test("report and notification presentation use warning at five and retain 7/8 precedence", () => {
  const Badge = ({ children, ...props }: any) => React.createElement("span", props, children);
  const report = loadFunctions("client/src/pages/OccurrenceReport.tsx", ["getThresholdBadge", "getRowHighlight"], { React, Badge });
  const bell = loadFunctions("client/src/components/NotificationBell.tsx", ["getThresholdColor", "getThresholdLabel"]);
  assert.equal(report.getThresholdBadge(4.5), null);
  assert.equal(report.getRowHighlight(4.5), "");
  for (const [points, label, color] of [[5, "Warning", "yellow"], [6, "Warning", "yellow"], [7, "Final Warning", "orange"], [8, "Termination", "red"]] as const) {
    assert.match(renderToStaticMarkup(report.getThresholdBadge(points)), new RegExp(`>${label}</span>`));
    assert.match(report.getRowHighlight(points), new RegExp(`bg-${color}-50`));
    assert.equal(bell.getThresholdLabel(points === 6 ? 5 : points), label);
  }
  assert.equal(bell.getThresholdColor(5), "bg-orange-500 text-white");
});

test("attendance warning presentation and corrective-action gate use five", () => {
  const source = readFileSync("client/src/pages/Attendance.tsx", "utf8");
  assert.match(source, /summary\.netTally >= 5 \? 'text-orange-500'/);
  assert.match(source, /summary\.netTally >= 5 \? \(\s*<Badge[^>]*>Warning/);
  assert.match(source, /canManageOccurrences && summary\.netTally >= 5 &&/);
  assert.match(source, /disabled=\{hasWarning \|\| summary\.netTally < 5\}/);
  assert.match(source, /At 5\+ occurrences/);
  assert.match(source, /disabled=\{hasFinalWarning \|\| summary\.netTally < 7 \|\| !hasWarning\}/);
  assert.doesNotMatch(source, /summary\.netTally [<>]=? 6/);
});

test("email content, preview, test email and settings agree on 5/7/8", () => {
  const email = loadFunctions("server/outlook.ts", ["getThresholdLabel", "getThresholdAction"]);
  for (const threshold of [5, 7, 8]) {
    assert.match(email.getThresholdAction(threshold), new RegExp(`reached ${threshold} occurrence points`));
    assert.notEqual(email.getThresholdLabel(threshold), "Threshold");
  }
  assert.match(renderSampleEmail("occurrence_alert", resolveBranding(), "https://example.test"), /reached 5 occurrence points/);
  assert.match(EMAIL_TYPES.find(t => t.id === "occurrence_alert")!.description, /5\/7\/8/);
  assert.match(readFileSync("server/routes.ts", "utf8"), /netTally: 5\.0,\s*threshold: 5/);
  assert.match(readFileSync("client/src/pages/Settings.tsx", "utf8"), /thresholds \(5, 7, or 8 points\)/);
});

test("net tally still excludes protected leave and applies stored adjustments", () => {
  const window = getRollingTallyWindow();
  const occurrence = { status: "active", occurrenceDate: window.endDate, occurrenceValue: 600 };
  const rows = [occurrence, { ...occurrence, isFmla: true }, { ...occurrence, isOtherLeave: true },
    { ...occurrence, isConsecutiveSickness: true }, { ...occurrence, status: "retracted" }];
  const adjustment = { status: "active", adjustmentDate: window.endDate, adjustmentType: "perfect_attendance", adjustmentValue: -100 };
  assert.equal(computeNetTally(rows as any, [adjustment] as any, window).netTally, 5);
  const route = readFileSync("server/routes/occurrences.ts", "utf8");
  assert.match(route, /if \(!isFmla && !isOtherLeave && !isConsecutiveSickness\)/);
});
