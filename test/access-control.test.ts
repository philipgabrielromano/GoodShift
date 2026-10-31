import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { storage } from "../server/storage";
import {
  canAccessEmployeeLocation,
  canManageEmployee,
  filterEmployeesByLocationScope,
  getAuthorizedUkgEmployeeIds,
  resolveAuthorizedLocation,
} from "../server/access-control";
import { revalidateSessionUser } from "../server/session-authorization";
import type { Employee, User } from "../shared/schema";
import { readFile } from "node:fs/promises";
import express from "express";
import session from "express-session";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { registerRoutes } from "../server/routes";
import { pool as pgPool } from "../server/db";

const originalGetLocations = storage.getLocations;
const originalGetEmployeeByEmail = storage.getEmployeeByEmail;
const originalGetDirectReportsForManager = storage.getDirectReportsForManager;
const originalGetVisibleJobTitlesFor = storage.getVisibleJobTitlesFor;
const originalGetUser = storage.getUser;
const originalGetGlobalSettings = storage.getGlobalSettings;
const originalGetEmployees = storage.getEmployees;
const originalGetShifts = storage.getShifts;
const originalGetUserByEmail = storage.getUserByEmail;
const originalIsSchedulePublished = storage.isSchedulePublished;
const originalPublishSchedule = storage.publishSchedule;
const originalUnpublishSchedule = storage.unpublishSchedule;
const originalClearSchedule = storage.clearSchedule;
const originalSeedBuiltInRoles = storage.seedBuiltInRoles;
const originalSeedFeaturePermissions = storage.seedFeaturePermissions;

const manager = {
  id: 10,
  email: "manager@example.test",
  role: "asstmanager",
  locationIds: ["1"],
};

function employee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 20,
    name: "Employee",
    email: "employee@example.test",
    jobTitle: "STLDWKR",
    maxWeeklyHours: 40,
    color: "#000000",
    isActive: true,
    isHiddenFromSchedule: false,
    location: "Store A",
    employmentType: null,
    ukgEmployeeId: null,
    preferredDaysPerWeek: 5,
    nonWorkingDays: null,
    hireDate: null,
    alternateEmail: null,
    shiftPreference: null,
    fixedShiftStart: null,
    fixedShiftEnd: null,
    daySpecificShifts: null,
    ...overrides,
  };
}

function user(overrides: Partial<User> = {}): User {
  return {
    id: 10,
    email: "manager@example.test",
    name: "Manager",
    role: "manager",
    microsoftId: "ms-id",
    locationIds: ["1"],
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

const testLocations = [
  { id: 1, name: "Store A", address: null, city: null, state: null, zipCode: null, latitude: null, longitude: null, notificationEmail: null },
  { id: 2, name: "Store B", address: null, city: null, state: null, zipCode: null, latitude: null, longitude: null, notificationEmail: null },
];

type ScheduleStorageOptions = {
  locations?: typeof testLocations;
  employees?: Employee[];
  shifts?: any[];
  isPublished?: (weekStart: string, location?: string | null) => boolean | Promise<boolean>;
  onNotificationLookup?: (email: string) => void;
};

function stubScheduleStorage(
  t: Pick<TestContext, "after">,
  options: ScheduleStorageOptions = {},
) {
  const publishCalls: Array<[string, number | undefined, string | undefined]> = [];
  const unpublishCalls: Array<[string, string | undefined]> = [];
  const atomicClearCalls: Array<[Date, Date, string, string | undefined]> = [];
  const statusCalls: Array<[string, string | null | undefined]> = [];
  const notificationLookups: string[] = [];

  (storage as any).getGlobalSettings = async () => ({});
  (storage as any).getLocations = async () => options.locations ?? testLocations;
  // registerRoutes runs its seedDatabase() tail during setup. Keep at least
  // one fixture employee in every harness so setup cannot create live seed
  // rows (role requirements, employees, and shifts) in the test database.
  (storage as any).getEmployees = async () => options.employees ?? [employee()];
  (storage as any).getShifts = async () => options.shifts ?? [];
  (storage as any).getUserByEmail = async (email: string) => {
    notificationLookups.push(email);
    options.onNotificationLookup?.(email);
    // Returning no linked user and using employees without alternateEmail
    // prevents the route's fire-and-forget notification branch from sending
    // a real Outlook email.
    return undefined;
  };
  (storage as any).isSchedulePublished = async (
    weekStart: string,
    location?: string | null,
  ) => {
    statusCalls.push([weekStart, location]);
    return options.isPublished?.(weekStart, location) ?? false;
  };
  (storage as any).publishSchedule = async (
    weekStart: string,
    publishedBy?: number,
    location?: string,
  ) => {
    publishCalls.push([weekStart, publishedBy, location]);
    return {
      id: publishCalls.length,
      weekStart,
      publishedBy: publishedBy ?? null,
      publishedAt: new Date(),
    };
  };
  (storage as any).unpublishSchedule = async (
    weekStart: string,
    location?: string,
  ) => {
    unpublishCalls.push([weekStart, location]);
  };
  (storage as any).clearSchedule = async (
    start: Date,
    end: Date,
    weekStart: string,
    location?: string,
  ) => {
    atomicClearCalls.push([start, end, weekStart, location]);
    return { deletedCount: 2, unpublished: false };
  };
  // These are setup-only writes in registerRoutes; permission behavior is
  // exercised through the real middleware, so no-op the seeders as well.
  (storage as any).seedBuiltInRoles = async () => undefined;
  (storage as any).seedFeaturePermissions = async () => undefined;

  t.after(() => {
    storage.getGlobalSettings = originalGetGlobalSettings;
    storage.getLocations = originalGetLocations;
    storage.getEmployees = originalGetEmployees;
    storage.getShifts = originalGetShifts;
    storage.getUserByEmail = originalGetUserByEmail;
    storage.isSchedulePublished = originalIsSchedulePublished;
    storage.publishSchedule = originalPublishSchedule;
    storage.unpublishSchedule = originalUnpublishSchedule;
    storage.clearSchedule = originalClearSchedule;
    storage.seedBuiltInRoles = originalSeedBuiltInRoles;
    storage.seedFeaturePermissions = originalSeedFeaturePermissions;
  });

  return {
    publishCalls,
    unpublishCalls,
    atomicClearCalls,
    statusCalls,
    notificationLookups,
  };
}

async function createRoutesHarness(t: Pick<TestContext, "after">) {
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: "task69-access-control-test-secret",
    resave: false,
    saveUninitialized: false,
  }));

  app.post("/__test/login", (req, res) => {
    (req.session as any).user = {
      id: 9001,
      microsoftId: "task69-test-msid",
      name: "Task 69 Test User",
      email: "task69@example.test",
      role: "viewer",
      locationIds: [],
      ...req.body,
    };
    (req.session as any).isAuthenticated = true;
    res.json({ ok: true });
  });

  const server = http.createServer(app);
  await registerRoutes(server, app, { initializeOrdersTable: false });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  });

  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async (
    method: string,
    path: string,
    cookie: string,
    body?: unknown,
  ) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        cookie,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: response.status, body: parsed };
  };
  const login = async (overrides: Record<string, unknown>) => {
    const response = await fetch(`${baseUrl}/__test/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(overrides),
    });
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie")?.split(";")[0] ?? "";
  };

  return { request, login };
}

async function flushRouteNotifications() {
  // Publishing responds before its notification task finishes. Let that task
  // observe the storage stubs before the test context restores them.
  await new Promise<void>(resolve => setTimeout(resolve, 25));
}

test("employee and shift targets are limited to assigned locations", async t => {
  storage.getLocations = async () => [
    { id: 1, name: "Store A", address: null, city: null, state: null, zipCode: null, latitude: null, longitude: null, notificationEmail: null },
    { id: 2, name: "Store B", address: null, city: null, state: null, zipCode: null, latitude: null, longitude: null, notificationEmail: null },
  ];
  storage.getEmployeeByEmail = async () => employee({ id: 10, email: manager.email, jobTitle: "STASSTSP" });
  storage.getDirectReportsForManager = async () => [];
  storage.getVisibleJobTitlesFor = async () => [];
  t.after(() => {
    storage.getLocations = originalGetLocations;
    storage.getEmployeeByEmail = originalGetEmployeeByEmail;
    storage.getDirectReportsForManager = originalGetDirectReportsForManager;
    storage.getVisibleJobTitlesFor = originalGetVisibleJobTitlesFor;
  });

  assert.equal(await canAccessEmployeeLocation(manager, employee()), true);
  assert.equal(await canAccessEmployeeLocation(manager, employee({ location: "Store B" })), false);
  assert.equal(await canManageEmployee(manager, employee({ jobTitle: "STLDWKR" })), true);
  assert.equal(await canManageEmployee(manager, employee({ jobTitle: "STASSTSP" })), false);
});

test("explicit direct reports replace automatic hierarchy access", async t => {
  storage.getLocations = async () => [
    { id: 1, name: "Store A", address: null, city: null, state: null, zipCode: null, latitude: null, longitude: null, notificationEmail: null },
  ];
  storage.getDirectReportsForManager = async () => [21];
  t.after(() => {
    storage.getLocations = originalGetLocations;
    storage.getDirectReportsForManager = originalGetDirectReportsForManager;
  });

  assert.equal(await canManageEmployee(manager, employee({ id: 21 })), true);
  assert.equal(await canManageEmployee(manager, employee({ id: 22 })), false);
  assert.equal(await canManageEmployee(manager, employee({ id: 21, location: "Store B" })), false);
});

test("non-admin users without assignments cannot select a global schedule scope", async t => {
  storage.getLocations = async () => [];
  t.after(() => { storage.getLocations = originalGetLocations; });

  const result = await resolveAuthorizedLocation({ ...manager, locationIds: [] }, undefined);
  assert.match(result.error ?? "", /no assigned locations/i);
});

test("employee reads deny zero-location and cross-location users by default", async t => {
  storage.getLocations = async () => [
    { id: 1, name: "Store A", address: null, city: null, state: null, zipCode: null, latitude: null, longitude: null, notificationEmail: null },
    { id: 2, name: "Store B", address: null, city: null, state: null, zipCode: null, latitude: null, longitude: null, notificationEmail: null },
  ];
  t.after(() => { storage.getLocations = originalGetLocations; });
  const records = [employee({ id: 21, location: "Store A" }), employee({ id: 22, location: "Store B" })];

  assert.deepEqual(await filterEmployeesByLocationScope({ ...manager, locationIds: [] }, records), []);
  assert.deepEqual(
    (await filterEmployeesByLocationScope(manager, records)).map(record => record.id),
    [21],
  );
  assert.equal(await canAccessEmployeeLocation(manager, records[1]), false);
  assert.deepEqual(
    Array.from(await getAuthorizedUkgEmployeeIds(
      manager,
      records.map((record, index) => ({ ...record, ukgEmployeeId: `ukg-${index + 1}` })),
    ) ?? []),
    ["ukg-1"],
  );
});

test("employee and shift GET routes apply shared deny-by-default scoping", async () => {
  const source = await readFile("server/routes.ts", "utf8");
  const employeeList = source.slice(
    source.indexOf("app.get(api.employees.list.path"),
    source.indexOf("app.get(api.employees.get.path"),
  );
  const employeeDetail = source.slice(
    source.indexOf("app.get(api.employees.get.path"),
    source.indexOf("app.post(api.employees.create.path"),
  );
  const shiftList = source.slice(
    source.indexOf("app.get(api.shifts.list.path"),
    source.indexOf("app.post(api.shifts.create.path"),
  );
  assert.match(employeeList, /filterEmployeesByLocationScope\(user,\s*employees\)/);
  assert.match(employeeDetail, /canAccessEmployeeLocation\(user,\s*employee\)/);
  assert.match(shiftList, /canAccessEmployeeLocation\(user,\s*requestedEmployee\)/);
  assert.match(shiftList, /getAuthorizedLocationNames\(user\)/);
});

test("UKG-backed read routes deny raw access and use authorized employee IDs", async () => {
  const ukgSource = await readFile("server/routes/ukg.ts", "utf8");
  const routeSource = await readFile("server/routes.ts", "utf8");
  assert.match(ukgSource, /app\.get\(api\.ukg\.employees\.path,\s*requireAdmin/);
  assert.match(ukgSource, /getAuthorizedUkgEmployeeIds\(user,\s*allEmployees\)/);
  assert.match(routeSource, /const allowedUkgIds = await getAuthorizedUkgEmployeeIds\(user,\s*allEmployees\)/);
});

test("session revalidation immediately refreshes role and location assignments", async t => {
  storage.getUser = async () => user({ role: "viewer", locationIds: ["2"] });
  t.after(() => { storage.getUser = originalGetUser; });
  const session: any = {
    user: { ...manager, name: "Manager", microsoftId: "ms-id" },
    destroy: () => undefined,
  };
  const req: any = { session };
  const res: any = {};

  await new Promise<void>((resolve, reject) => {
    revalidateSessionUser(req, res, error => error ? reject(error) : resolve());
  });
  assert.equal(session.user.role, "viewer");
  assert.deepEqual(session.user.locationIds, ["2"]);
});

test("session revalidation rejects disabled users and destroys their session", async t => {
  storage.getUser = async () => user({ isActive: false });
  t.after(() => { storage.getUser = originalGetUser; });
  let destroyed = false;
  let status = 0;
  const req: any = {
    session: {
      user: { ...manager, name: "Manager", microsoftId: "ms-id" },
      destroy: (callback: () => void) => {
        destroyed = true;
        callback();
      },
    },
  };
  const res: any = {
    status(code: number) {
      status = code;
      return this;
    },
    json() {
      return this;
    },
  };

  await revalidateSessionUser(req, res, () => assert.fail("disabled session must not continue"));
  assert.equal(destroyed, true);
  assert.equal(status, 401);
});

test("session revalidation ends impersonation when the real user is demoted", async t => {
  storage.getUser = async id => user({ id, role: "manager", locationIds: ["2"] });
  t.after(() => { storage.getUser = originalGetUser; });
  const session: any = {
    realUser: { ...manager, role: "admin", name: "Admin", microsoftId: "admin-ms" },
    user: { ...manager, id: 20, role: "admin", name: "Viewed Admin", microsoftId: "viewed-ms" },
    destroy: () => undefined,
  };

  await new Promise<void>((resolve, reject) => {
    revalidateSessionUser({ session } as any, {} as any, error => error ? reject(error) : resolve());
  });
  assert.equal(session.realUser, undefined);
  assert.equal(session.user.id, manager.id);
  assert.equal(session.user.role, "manager");
  assert.deepEqual(session.user.locationIds, ["2"]);
});

test("shift trade approval uses a transactional compare-and-swap", async () => {
  const source = await readFile("server/storage.ts", "utf8");
  const method = source.slice(
    source.indexOf("async approveShiftTrade("),
    source.indexOf("async deleteShiftTrade(", source.indexOf("async approveShiftTrade(")),
  );
  assert.match(method, /db\.transaction/);
  assert.match(method, /eq\(shifts\.employeeId,\s*input\.requesterId\)/);
  assert.match(method, /eq\(shifts\.employeeId,\s*input\.responderId\)/);
  assert.match(method, /eq\(shiftTrades\.status,\s*"pending_manager"\)/);
  assert.match(method, /throw new ShiftTradeConflictError\(\)/);
});

test("assigned manager can publish a scoped schedule and notifications stay in scope", async t => {
  const employees = [
    employee({ id: 20, email: "store-a-employee@example.test", location: "Store A" }),
    employee({ id: 21, email: "store-b-employee@example.test", location: "Store B" }),
  ];
  const shifts = [
    { employeeId: 20, startTime: new Date("2025-01-05T15:00:00.000Z"), endTime: new Date("2025-01-05T23:00:00.000Z") },
    { employeeId: 21, startTime: new Date("2025-01-05T15:00:00.000Z"), endTime: new Date("2025-01-05T23:00:00.000Z") },
  ];
  const calls = stubScheduleStorage(t, { employees, shifts });
  const { request, login } = await createRoutesHarness(t);
  const cookie = await login({ id: 42, role: "manager", locationIds: ["1"] });

  const response = await request(
    "POST",
    "/api/schedule/publish",
    cookie,
    { weekStart: "2025-01-05", location: "Store A" },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls.publishCalls, [["2025-01-05", 42, "Store A"]]);
  await flushRouteNotifications();
  assert.deepEqual(
    calls.notificationLookups,
    ["store-a-employee@example.test"],
    "publishing Store A must not notify employees scheduled at Store B",
  );
});

test("manager publish rejects no, invalid, and cross-location assignments without side effects", async t => {
  const calls = stubScheduleStorage(t);
  const { request, login } = await createRoutesHarness(t);
  const cases: Array<{
    locationIds: string[];
    body: Record<string, unknown>;
    status: number;
  }> = [
    {
      locationIds: [],
      body: { weekStart: "2025-01-05", location: "Store A" },
      status: 403,
    },
    {
      locationIds: ["999"],
      body: { weekStart: "2025-01-05", location: "Store A" },
      status: 403,
    },
    {
      locationIds: ["1"],
      body: { weekStart: "2025-01-05", location: "Store B" },
      status: 403,
    },
    {
      locationIds: ["1"],
      body: { weekStart: "2025-01-05", location: 1 },
      status: 400,
    },
  ];

  for (const testCase of cases) {
    const cookie = await login({ id: 42, role: "manager", locationIds: testCase.locationIds });
    const response = await request("POST", "/api/schedule/publish", cookie, testCase.body);
    assert.equal(response.status, testCase.status);
  }

  assert.deepEqual(calls.publishCalls, []);
});

test("configured feature denial prevents an ungranted role from publishing", async t => {
  const calls = stubScheduleStorage(t);
  const { request, login } = await createRoutesHarness(t);
  // Use a role that cannot be present in a persisted feature row from another
  // test run; this keeps the denial assertion independent of configured
  // built-in-role permissions.
  const deniedRole = `task69_denied_${process.pid}`;
  const cookie = await login({ id: 43, role: deniedRole, locationIds: ["1"] });

  const response = await request(
    "POST",
    "/api/schedule/publish",
    cookie,
    { weekStart: "2025-01-05", location: "Store A" },
  );

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { message: "Access denied" });
  assert.deepEqual(calls.publishCalls, []);
});

test("assigned manager can unpublish only its scoped schedule while admin can publish globally or by location", async t => {
  const calls = stubScheduleStorage(t);
  const { request, login } = await createRoutesHarness(t);

  const managerCookie = await login({ id: 42, role: "manager", locationIds: ["1"] });
  const crossLocationStatus = await request(
    "GET",
    "/api/schedule/published/2025-01-05?location=Store%20B",
    managerCookie,
  );
  assert.equal(crossLocationStatus.status, 403);

  const noAssignmentCookie = await login({ id: 43, role: "manager", locationIds: [] });
  const noAssignmentStatus = await request(
    "GET",
    "/api/schedule/published/2025-01-05",
    noAssignmentCookie,
  );
  assert.equal(noAssignmentStatus.status, 403);
  assert.deepEqual(calls.statusCalls, []);

  const unpublish = await request(
    "DELETE",
    "/api/schedule/publish/2025-01-05?location=Store%20A",
    managerCookie,
  );
  assert.equal(unpublish.status, 204);
  assert.deepEqual(calls.unpublishCalls, [["2025-01-05", "Store A"]]);

  const crossLocationUnpublish = await request(
    "DELETE",
    "/api/schedule/publish/2025-01-05?location=Store%20B",
    managerCookie,
  );
  assert.equal(crossLocationUnpublish.status, 403);
  assert.deepEqual(
    calls.unpublishCalls,
    [["2025-01-05", "Store A"]],
    "a rejected cross-location unpublish must not call storage",
  );
  assert.deepEqual(
    calls.statusCalls,
    [],
    "rejected status checks must not call publication storage",
  );

  const adminCookie = await login({ id: 7, role: "admin", locationIds: [] });
  assert.equal(
    (await request("POST", "/api/schedule/publish", adminCookie, { weekStart: "2025-01-05" })).status,
    200,
  );
  assert.equal(
    (await request(
      "POST",
      "/api/schedule/publish",
      adminCookie,
      { weekStart: "2025-01-05", location: "Store B" },
    )).status,
    200,
  );
  await flushRouteNotifications();
  assert.deepEqual(calls.publishCalls, [
    ["2025-01-05", 7, undefined],
    ["2025-01-05", 7, "Store B"],
  ]);
});

test("viewer filtering uses published week and employee location, including a Sunday local day", async t => {
  const employees = [
    employee({ id: 20, location: "Store A" }),
    employee({ id: 21, location: "Store B" }),
  ];
  const shifts = [
    // 05:30 UTC is 00:30 in New York in January: Sunday local day.
    { id: 1, employeeId: 20, startTime: new Date("2025-01-05T05:30:00.000Z"), endTime: new Date("2025-01-05T13:30:00.000Z") },
    { id: 2, employeeId: 21, startTime: new Date("2025-01-05T05:30:00.000Z"), endTime: new Date("2025-01-05T13:30:00.000Z") },
    { id: 3, employeeId: 20, startTime: new Date("2025-01-12T15:00:00.000Z"), endTime: new Date("2025-01-12T23:00:00.000Z") },
    // Saturday local day, despite being Sunday in UTC: preceding week.
    { id: 4, employeeId: 20, startTime: new Date("2025-01-05T04:30:00.000Z"), endTime: new Date("2025-01-05T05:30:00.000Z") },
  ];
  const publicationCalls: Array<[string, string | null | undefined]> = [];
  const calls = stubScheduleStorage(t, {
    employees,
    shifts,
    isPublished: (weekStart, location) => {
      publicationCalls.push([weekStart, location]);
      return weekStart === "2025-01-05" && location === "Store A";
    },
  });
  const { request, login } = await createRoutesHarness(t);
  const cookie = await login({ id: 44, role: "viewer", locationIds: ["1", "2"] });

  const response = await request("GET", "/api/shifts", cookie);

  assert.equal(response.status, 200);
  assert.deepEqual((response.body as any[]).map(shift => shift.id), [1]);
  assert.deepEqual(publicationCalls, [
    ["2025-01-05", "Store A"],
    ["2025-01-05", "Store B"],
    ["2025-01-12", "Store A"],
    ["2024-12-29", "Store A"],
  ]);
  assert.deepEqual(calls.publishCalls, []);
});

test("scoped clear passes only the assigned location to storage", async t => {
  const calls = stubScheduleStorage(t);
  const { request, login } = await createRoutesHarness(t);
  const cookie = await login({ id: 42, role: "manager", locationIds: ["1"] });

  const response = await request(
    "POST",
    "/api/schedule/clear",
    cookie,
    { weekStart: "2025-01-05", location: "Store A" },
  );

  assert.equal(response.status, 200);
  assert.equal((response.body as any).deletedCount, 2);
  assert.equal(calls.atomicClearCalls.length, 1);
  assert.deepEqual(calls.atomicClearCalls[0].slice(2), ["2025-01-05", "Store A"]);

  const crossLocationResponse = await request(
    "POST",
    "/api/schedule/clear",
    cookie,
    { weekStart: "2025-01-05", location: "Store B" },
  );
  assert.equal(crossLocationResponse.status, 403);
  assert.equal(calls.atomicClearCalls.length, 1);
});

test("real workforce GET routes deny zero-location and cross-location sessions", async t => {
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: "access-control-test-secret",
    resave: false,
    saveUninitialized: false,
  }));

  const locations = await storage.getLocations();
  const employees = await storage.getEmployees();
  const target = employees.find(record => !!record.location);
  const assignedLocation = target
    ? locations.find(location => location.name !== target.location)
    : undefined;
  if (!target || !assignedLocation) {
    t.skip("requires employees in at least two configured locations");
    return;
  }

  app.get("/__test/login/:kind", (req, res) => {
    req.session.user = {
      id: 999999,
      microsoftId: "test",
      name: "Access Test",
      email: "access-test@example.test",
      role: "manager",
      locationIds: req.params.kind === "none" ? [] : [String(assignedLocation.id)],
    };
    req.session.isAuthenticated = true;
    res.json({ ok: true });
  });

  const server = http.createServer(app);
  // This harness intentionally reads the existing workforce rows above; once
  // a target exists, route registration must not run any production seed
  // writes against the test database.
  storage.seedBuiltInRoles = async () => undefined;
  storage.seedFeaturePermissions = async () => undefined;
  t.after(() => {
    storage.seedBuiltInRoles = originalSeedBuiltInRoles;
    storage.seedFeaturePermissions = originalSeedFeaturePermissions;
  });
  await registerRoutes(server, app, { initializeOrdersTable: false });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pgPool.end();
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const login = async (kind: "none" | "cross") => {
    const response = await fetch(`${baseUrl}/__test/login/${kind}`);
    return response.headers.get("set-cookie")?.split(";")[0] ?? "";
  };
  const get = (path: string, cookie: string) =>
    fetch(`${baseUrl}${path}`, { headers: { cookie } });

  const noLocationCookie = await login("none");
  const noLocationEmployees = await get("/api/employees", noLocationCookie);
  assert.deepEqual(await noLocationEmployees.json(), []);
  const noLocationShifts = await get("/api/shifts", noLocationCookie);
  assert.deepEqual(await noLocationShifts.json(), []);

  for (const path of [
    "/api/pal-entries?start=2026-01-01&end=2026-12-31",
    "/api/unpaid-time-off-entries?start=2026-01-01&end=2026-12-31",
  ]) {
    const response = await get(path, noLocationCookie);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
  }
  const noLocationTimeClock = await get(
    "/api/ukg/timeclock?startDate=2026-01-01&endDate=2026-12-31",
    noLocationCookie,
  );
  assert.deepEqual((await noLocationTimeClock.json()).entries, []);
  assert.equal((await get("/api/ukg/employees", noLocationCookie)).status, 403);

  const crossLocationCookie = await login("cross");
  assert.equal((await get(`/api/employees/${target.id}`, crossLocationCookie)).status, 403);
  assert.equal((await get(`/api/shifts?employeeId=${target.id}`, crossLocationCookie)).status, 403);
});