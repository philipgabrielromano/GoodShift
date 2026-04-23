/**
 * Integration tests for the custom-role permission system.
 *
 * These tests verify that requireFeatureAccess + the feature_permissions table
 * actually gate the corresponding endpoints when a custom role (e.g. "DM") is
 * granted or revoked from a feature via the role/permissions UI.
 *
 * Run with:   npx tsx --test test/permissions.test.ts
 *
 * Requires DATABASE_URL to be set so the real feature_permissions table can
 * be read/written. The tests scope all changes to a unique synthetic role
 * string per run and restore allowed_roles after each test.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import http from "http";
import type { AddressInfo } from "net";
import { eq } from "drizzle-orm";

import { db } from "../server/db";
import { featurePermissions, DEFAULT_FEATURE_PERMISSIONS, SYSTEM_FEATURES } from "../shared/schema";
import {
  invalidatePermissionsCache,
  requireFeatureAccess,
} from "../server/middleware";
import { registerOccurrenceRoutes } from "../server/routes/occurrences";
import { registerCoachingRoutes } from "../server/routes/coaching";
import { registerShiftTradeRoutes } from "../server/routes/shift-trades";

// A unique synthetic role per test run so we never collide with real data.
const TEST_ROLE = `test_dm_${process.pid}_${Date.now()}`;

let server: http.Server;
let baseUrl = "";

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: true,
      cookie: { httpOnly: true, sameSite: "lax", secure: false },
    }),
  );

  // Test-only login endpoint to seed req.session.user without going through
  // Microsoft SSO (which can't be exercised from a test runner).
  app.post("/_test/login", (req, res) => {
    const { id, email, name, role } = req.body ?? {};
    (req.session as any).user = {
      id: id ?? 9001,
      microsoftId: "test-msid",
      name: name ?? "Test User",
      email: email ?? "test@example.com",
      role: role ?? "viewer",
      locationIds: null,
    };
    (req.session as any).isAuthenticated = true;
    req.session.save((err) => {
      if (err) return res.status(500).json({ message: err.message });
      res.json({ ok: true });
    });
  });

  // Mount the real route registrations whose feature gating we want to test.
  registerOccurrenceRoutes(app);
  registerCoachingRoutes(app);
  registerShiftTradeRoutes(app);

  // schedule.publish is registered inline in server/routes.ts. Re-mount a stub
  // here that uses the same middleware so we can verify the feature gate
  // without booting the entire app (which pulls in UKG, scheduler, etc).
  app.post(
    "/api/schedule/publish",
    requireFeatureAccess("schedule.publish"),
    (_req, res) => res.json({ ok: true }),
  );

  return app;
}

// Minimal cookie-aware fetch helper (express-session sets a single cookie).
async function request(opts: {
  method: string;
  path: string;
  body?: unknown;
  cookie?: string;
}): Promise<{ status: number; body: any; cookie?: string }> {
  const res = await fetch(`${baseUrl}${opts.path}`, {
    method: opts.method,
    headers: {
      "content-type": "application/json",
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie") ?? undefined;
  // Strip attributes; keep only the name=value pair for round-tripping.
  const cookie = setCookie ? setCookie.split(";")[0] : undefined;
  let body: any = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, cookie };
}

async function loginAs(role: string): Promise<string> {
  const res = await request({
    method: "POST",
    path: "/_test/login",
    body: { role, name: `Test ${role}`, email: `${role}@example.com` },
  });
  assert.equal(res.status, 200, "test login must succeed");
  assert.ok(res.cookie, "test login must set a session cookie");
  return res.cookie!;
}

async function getAllowedRoles(feature: string): Promise<string[]> {
  const rows = await db
    .select()
    .from(featurePermissions)
    .where(eq(featurePermissions.feature, feature));
  if (rows.length > 0) return [...rows[0].allowedRoles];
  return [...(DEFAULT_FEATURE_PERMISSIONS[feature] ?? ["admin"])];
}

async function setAllowedRoles(feature: string, roles: string[]): Promise<void> {
  const existing = await db
    .select()
    .from(featurePermissions)
    .where(eq(featurePermissions.feature, feature));
  if (existing.length === 0) {
    const meta = SYSTEM_FEATURES.find((f) => f.feature === feature);
    await db.insert(featurePermissions).values({
      feature,
      label: meta?.label ?? feature,
      description: meta?.description ?? "",
      allowedRoles: roles,
    });
  } else {
    await db
      .update(featurePermissions)
      .set({ allowedRoles: roles })
      .where(eq(featurePermissions.feature, feature));
  }
  invalidatePermissionsCache();
}

async function grantTestRole(feature: string): Promise<string[]> {
  const original = await getAllowedRoles(feature);
  const next = original.includes(TEST_ROLE) ? original : [...original, TEST_ROLE];
  await setAllowedRoles(feature, next);
  return original;
}

async function revokeTestRole(feature: string): Promise<void> {
  const current = await getAllowedRoles(feature);
  const next = current.filter((r) => r !== TEST_ROLE);
  await setAllowedRoles(feature, next);
}

/**
 * Run a feature's grant→endpoint→revoke→endpoint cycle.
 *
 * `expectGrantedNotForbidden`: when the role has the feature, the endpoint
 * must NOT return 403 (it may legitimately return 200/400/404/500 depending
 * on request payload — what matters is that the gate let the request through).
 *
 * `expectRevoked403`: when the role lacks the feature, the endpoint MUST
 * return 403 with the middleware's "Access denied" message.
 */
async function assertGated(opts: {
  feature: string;
  method: string;
  path: string;
  body?: unknown;
  // Statuses that are acceptable as "passed the gate".
  okStatuses?: number[];
}) {
  const { feature, method, path, body } = opts;
  const okStatuses = opts.okStatuses ?? [200, 400, 404, 500];

  const original = await grantTestRole(feature);
  try {
    const cookie = await loginAs(TEST_ROLE);

    // Granted: must not be 403 (and must not be 401).
    const granted = await request({ method, path, body, cookie });
    assert.notEqual(
      granted.status,
      403,
      `[${feature}] granted role should not be forbidden (got 403 ${JSON.stringify(granted.body)})`,
    );
    assert.notEqual(
      granted.status,
      401,
      `[${feature}] granted role should be authenticated`,
    );
    assert.ok(
      okStatuses.includes(granted.status),
      `[${feature}] expected status in ${JSON.stringify(okStatuses)}, got ${granted.status}: ${JSON.stringify(granted.body)}`,
    );

    // Revoke and re-test: must be 403 with middleware message.
    await revokeTestRole(feature);
    const revoked = await request({ method, path, body, cookie });
    assert.equal(
      revoked.status,
      403,
      `[${feature}] revoked role should be forbidden (got ${revoked.status})`,
    );
    assert.equal(
      revoked.body?.message,
      "Access denied",
      `[${feature}] revoked role should hit the feature-gate middleware (got ${JSON.stringify(revoked.body)})`,
    );
  } finally {
    // Restore original allowed_roles so we never leak test state.
    await setAllowedRoles(feature, original);
  }
}

before(async () => {
  const app = buildTestApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  // Drain DB pool so the test process can exit cleanly.
  const { pool } = await import("../server/db");
  await pool.end();
});

test("admin shortcut: even with no permission row, admin role bypasses the gate", async () => {
  // attendance.edit removed for everyone except the synthetic role; admin must
  // still pass because of the user.role === "admin" shortcut in the middleware.
  const original = await getAllowedRoles("attendance.edit");
  await setAllowedRoles("attendance.edit", []);
  try {
    const cookie = await loginAs("admin");
    const res = await request({
      method: "POST",
      path: "/api/occurrences",
      body: {},
      cookie,
    });
    assert.notEqual(res.status, 403, `admin should bypass gate (got ${res.status})`);
  } finally {
    await setAllowedRoles("attendance.edit", original);
  }
});

test("custom role with no permissions is denied across all gated endpoints", async () => {
  const cookie = await loginAs(TEST_ROLE);
  const cases: Array<{ method: string; path: string; body?: unknown }> = [
    { method: "GET", path: "/api/attendance/employees" },
    { method: "POST", path: "/api/occurrences", body: {} },
    { method: "GET", path: "/api/coaching/employees" },
    { method: "POST", path: "/api/coaching/logs", body: {} },
    { method: "POST", path: "/api/schedule/publish", body: {} },
    { method: "PATCH", path: "/api/shift-trades/999999/manager-respond", body: {} },
  ];
  for (const c of cases) {
    const res = await request({ ...c, cookie });
    assert.equal(res.status, 403, `${c.method} ${c.path} should be 403 for ungranted role`);
    assert.equal(res.body?.message, "Access denied");
  }
});

test("attendance.view gates GET /api/attendance/employees", async () => {
  await assertGated({
    feature: "attendance.view",
    method: "GET",
    path: "/api/attendance/employees",
    okStatuses: [200],
  });
});

test("attendance.edit gates POST /api/occurrences", async () => {
  await assertGated({
    feature: "attendance.edit",
    method: "POST",
    path: "/api/occurrences",
    body: {},
    okStatuses: [400], // empty body → handler returns 400 after gate passes
  });
});

test("coaching.view gates GET /api/coaching/employees", async () => {
  await assertGated({
    feature: "coaching.view",
    method: "GET",
    path: "/api/coaching/employees",
    okStatuses: [200],
  });
});

test("coaching.edit gates POST /api/coaching/logs", async () => {
  await assertGated({
    feature: "coaching.edit",
    method: "POST",
    path: "/api/coaching/logs",
    body: {},
    okStatuses: [400], // schema validation fails after gate passes
  });
});

test("schedule.publish gates POST /api/schedule/publish", async () => {
  await assertGated({
    feature: "schedule.publish",
    method: "POST",
    path: "/api/schedule/publish",
    body: {},
    okStatuses: [200], // stub handler returns 200 once gate passes
  });
});

test("production route source wires each feature to the expected endpoint", async () => {
  // Guards against the schedule.publish inline route (and the externally
  // mounted routes) silently drifting away from the feature keys exercised
  // by the integration tests above. We grep the route sources directly so
  // we don't have to boot the full app (with UKG, scheduler, etc.) just to
  // assert middleware wiring.
  const fs = await import("node:fs/promises");
  const expectations: Array<{ file: string; pattern: RegExp; label: string }> = [
    {
      file: "server/routes.ts",
      pattern:
        /app\.post\(\s*"\/api\/schedule\/publish"\s*,\s*requireFeatureAccess\(\s*"schedule\.publish"\s*\)/,
      label: "POST /api/schedule/publish -> schedule.publish",
    },
    {
      file: "server/routes/occurrences.ts",
      pattern:
        /app\.get\(\s*"\/api\/attendance\/employees"\s*,\s*requireFeatureAccess\(\s*"attendance\.view"\s*\)/,
      label: "GET /api/attendance/employees -> attendance.view",
    },
    {
      file: "server/routes/occurrences.ts",
      pattern:
        /app\.post\(\s*"\/api\/occurrences"\s*,\s*requireFeatureAccess\(\s*"attendance\.edit"\s*\)/,
      label: "POST /api/occurrences -> attendance.edit",
    },
    {
      file: "server/routes/coaching.ts",
      pattern:
        /app\.get\(\s*"\/api\/coaching\/employees"\s*,\s*requireFeatureAccess\(\s*"coaching\.view"\s*\)/,
      label: "GET /api/coaching/employees -> coaching.view",
    },
    {
      file: "server/routes/coaching.ts",
      pattern:
        /app\.post\(\s*"\/api\/coaching\/logs"\s*,\s*requireFeatureAccess\(\s*"coaching\.edit"\s*\)/,
      label: "POST /api/coaching/logs -> coaching.edit",
    },
    {
      file: "server/routes/shift-trades.ts",
      pattern:
        /app\.patch\(\s*"\/api\/shift-trades\/:id\/manager-respond"\s*,\s*requireFeatureAccess\(\s*"shift_trades\.approve"\s*\)/,
      label: "PATCH /api/shift-trades/:id/manager-respond -> shift_trades.approve",
    },
  ];
  for (const exp of expectations) {
    const src = await fs.readFile(exp.file, "utf8");
    assert.ok(exp.pattern.test(src), `Missing wiring in ${exp.file}: ${exp.label}`);
  }
});

test("shift_trades.approve gates PATCH /api/shift-trades/:id/manager-respond", async () => {
  await assertGated({
    feature: "shift_trades.approve",
    method: "PATCH",
    path: "/api/shift-trades/999999/manager-respond",
    body: { approved: false },
    okStatuses: [404], // unknown trade id → 404 after gate passes
  });
});
