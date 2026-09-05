import { test } from "node:test";
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