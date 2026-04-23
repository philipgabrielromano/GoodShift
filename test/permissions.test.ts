/**
 * Integration tests for the custom-role permission system.
 *
 * These tests verify that requireFeatureAccess + the feature_permissions table
 * actually gate the corresponding endpoints when a custom role (e.g. "DM") is
 * granted or revoked from a feature via the role/permissions UI.
 *
 * The suite is data-driven from a ROUTE_GATES table that maps each feature
 * key in shared/schema.ts → SYSTEM_FEATURES to a representative endpoint:
 *
 *   • "real" entries mount the real route registration from server/routes/*
 *     so we exercise the actual middleware wiring.
 *   • "stub" entries cover routes registered inline in server/routes.ts; we
 *     mount a tiny stub here that uses the same requireFeatureAccess(...)
 *     middleware and additionally regex-grep server/routes.ts to prove the
 *     production route is wired to the same feature key.
 *
 * Adding a new feature to SYSTEM_FEATURES will fail the coverage test until
 * either an entry is added to ROUTE_GATES or it is added to EXEMPT_FEATURES
 * with a documented reason. Exempt features are also asserted to never appear
 * as a `requireFeatureAccess("...")` argument anywhere in server/, so an
 * accidentally-added gate forces the entry to move into ROUTE_GATES.
 *
 * Run with:   npx tsx --test test/permissions.test.ts
 *
 * Requires DATABASE_URL to be set so the real feature_permissions table can
 * be read/written. The tests scope all changes to a unique synthetic role
 * string per run and restore allowed_roles after each test.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type Express } from "express";
import session from "express-session";
import http from "http";
import type { AddressInfo } from "net";
import { eq } from "drizzle-orm";

import { db } from "../server/db";
import { featurePermissions, DEFAULT_FEATURE_PERMISSIONS, SYSTEM_FEATURES, users } from "../shared/schema";
import { storage } from "../server/storage";
import {
  invalidatePermissionsCache,
  requireFeatureAccess,
} from "../server/middleware";
import { applyUserUpdate } from "../server/users-update";
import { registerOccurrenceRoutes } from "../server/routes/occurrences";
import { registerCoachingRoutes } from "../server/routes/coaching";
import { registerShiftTradeRoutes } from "../server/routes/shift-trades";
import { registerTaskAssignmentRoutes } from "../server/routes/task-assignments";
import { registerOptimizationRoutes } from "../server/routes/optimization";
import { registerDriverInspectionRoutes } from "../server/routes/driverInspections";
import { registerCreditCardInspectionRoutes } from "../server/routes/creditCardInspections";
import { registerOrderRoutes } from "../server/routes/orders";
import { registerTrailerManifestRoutes } from "../server/routes/trailerManifests";
import { registerWarehouseInventoryRoutes } from "../server/routes/warehouseInventory";
import { registerReportRoutes } from "../server/routes/reports";
import { registerRosterRoutes } from "../server/routes/roster";
import { registerUKGRoutes } from "../server/routes/ukg";

// A unique synthetic role per test run so we never collide with real data.
const TEST_ROLE = `test_dm_${process.pid}_${Date.now()}`;

let server: http.Server;
let baseUrl = "";

// ---------------------------------------------------------------------------
// ROUTE GATE INVENTORY
// ---------------------------------------------------------------------------

type RouteGate = {
  feature: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  // Statuses that count as "gate let me through" (anything that isn't 401/403).
  okStatuses?: number[];
  // "real": handler is mounted by one of the registerXxxRoutes() above and we
  // can verify its production wiring via source grep against `sourceFile`.
  // "stub": handler is inlined in server/routes.ts in production; we mount a
  // local stub with the same middleware here AND grep server/routes.ts to
  // prove the production route is gated by the same feature.
  kind: "real" | "stub";
  sourceFile: string;
  sourcePattern: RegExp;
};

// Default broad set of "passed the gate" statuses; specific entries can
// narrow this when we know exactly what the handler returns.
const BROADLY_OK = [200, 201, 204, 400, 404, 409, 500];

const ROUTE_GATES: RouteGate[] = [
  // -------------------- Scheduling --------------------
  {
    feature: "schedule.edit",
    method: "POST",
    path: "/api/_stub/shifts",
    body: {},
    kind: "stub",
    sourceFile: "server/routes.ts",
    sourcePattern: /app\.post\(\s*api\.shifts\.create\.path\s*,\s*requireFeatureAccess\(\s*"schedule\.edit"\s*\)/,
  },
  {
    feature: "schedule.publish",
    method: "POST",
    path: "/api/schedule/publish",
    body: {},
    kind: "stub",
    sourceFile: "server/routes.ts",
    sourcePattern:
      /app\.post\(\s*"\/api\/schedule\/publish"\s*,\s*requireFeatureAccess\(\s*"schedule\.publish"\s*\)/,
  },
  {
    feature: "schedule.generate",
    method: "POST",
    path: "/api/schedule/generate",
    body: {},
    kind: "stub",
    sourceFile: "server/routes.ts",
    sourcePattern:
      /app\.post\(\s*api\.schedule\.generate\.path\s*,\s*requireFeatureAccess\(\s*"schedule\.generate"\s*\)/,
  },
  {
    feature: "schedule.templates",
    method: "GET",
    path: "/api/shift-presets",
    kind: "stub",
    sourceFile: "server/routes.ts",
    sourcePattern:
      /app\.get\(\s*api\.shiftPresets\.list\.path\s*,\s*requireFeatureAccess\(\s*"schedule\.templates"\s*\)/,
  },
  {
    feature: "schedule.roster_targets",
    method: "GET",
    path: "/api/roster-targets?locationId=1",
    okStatuses: [200, 400, 500],
    kind: "real",
    sourceFile: "server/routes/roster.ts",
    sourcePattern:
      /app\.get\(\s*"\/api\/roster-targets"\s*,\s*requireFeatureAccess\(\s*"schedule\.roster_targets"\s*\)/,
  },

  // -------------------- Workforce --------------------
  {
    feature: "employees.edit",
    method: "POST",
    path: "/api/employees",
    body: {},
    kind: "stub",
    sourceFile: "server/routes.ts",
    sourcePattern:
      /app\.post\(\s*api\.employees\.create\.path\s*,\s*requireFeatureAccess\(\s*"employees\.edit"\s*\)/,
  },
  {
    feature: "employees.delete",
    method: "DELETE",
    path: "/api/employees/999999",
    kind: "stub",
    sourceFile: "server/routes.ts",
    sourcePattern:
      /app\.delete\(\s*api\.employees\.delete\.path\s*,\s*requireFeatureAccess\(\s*"employees\.delete"\s*\)/,
  },

  // -------------------- Compliance & HR --------------------
  {
    feature: "attendance.view",
    method: "GET",
    path: "/api/attendance/employees",
    okStatuses: [200, 500],
    kind: "real",
    sourceFile: "server/routes/occurrences.ts",
    sourcePattern:
      /app\.get\(\s*"\/api\/attendance\/employees"\s*,\s*requireFeatureAccess\(\s*"attendance\.view"\s*\)/,
  },
  {
    feature: "attendance.edit",
    method: "POST",
    path: "/api/occurrences",
    body: {},
    okStatuses: [400],
    kind: "real",
    sourceFile: "server/routes/occurrences.ts",
    sourcePattern:
      /app\.post\(\s*"\/api\/occurrences"\s*,\s*requireFeatureAccess\(\s*"attendance\.edit"\s*\)/,
  },
  {
    feature: "coaching.view",
    method: "GET",
    path: "/api/coaching/employees",
    okStatuses: [200, 500],
    kind: "real",
    sourceFile: "server/routes/coaching.ts",
    sourcePattern:
      /app\.get\(\s*"\/api\/coaching\/employees"\s*,\s*requireFeatureAccess\(\s*"coaching\.view"\s*\)/,
  },
  {
    feature: "coaching.edit",
    method: "POST",
    path: "/api/coaching/logs",
    body: {},
    okStatuses: [400],
    kind: "real",
    sourceFile: "server/routes/coaching.ts",
    sourcePattern:
      /app\.post\(\s*"\/api\/coaching\/logs"\s*,\s*requireFeatureAccess\(\s*"coaching\.edit"\s*\)/,
  },

  // -------------------- Collaboration --------------------
  {
    feature: "shift_trades.view",
    method: "GET",
    path: "/api/shift-trades",
    okStatuses: [200, 500],
    kind: "real",
    sourceFile: "server/routes/shift-trades.ts",
    sourcePattern:
      /app\.get\(\s*"\/api\/shift-trades"\s*,\s*requireFeatureAccess\(\s*"shift_trades\.view"\s*\)/,
  },
  {
    feature: "shift_trades.approve",
    method: "PATCH",
    path: "/api/shift-trades/999999/manager-respond",
    body: { approved: false },
    okStatuses: [400, 404, 500],
    kind: "real",
    sourceFile: "server/routes/shift-trades.ts",
    sourcePattern:
      /app\.patch\(\s*"\/api\/shift-trades\/:id\/manager-respond"\s*,\s*requireFeatureAccess\(\s*"shift_trades\.approve"\s*\)/,
  },
  {
    feature: "task_assignment.view",
    method: "GET",
    path: "/api/task-assignments?date=2025-01-01",
    okStatuses: [200, 500],
    kind: "real",
    sourceFile: "server/routes/task-assignments.ts",
    sourcePattern:
      /app\.get\(\s*"\/api\/task-assignments"\s*,\s*requireFeatureAccess\(\s*"task_assignment\.view"\s*\)/,
  },
  {
    feature: "task_assignment.edit",
    method: "POST",
    path: "/api/task-assignments",
    body: {},
    okStatuses: [400],
    kind: "real",
    sourceFile: "server/routes/task-assignments.ts",
    sourcePattern:
      /app\.post\(\s*"\/api\/task-assignments"\s*,\s*requireFeatureAccess\(\s*"task_assignment\.edit"\s*\)/,
  },

  // -------------------- Store Operations --------------------
  {
    feature: "optimization.view",
    method: "GET",
    path: "/api/optimization/events",
    okStatuses: [200, 500],
    kind: "real",
    sourceFile: "server/routes/optimization.ts",
    sourcePattern:
      /app\.get\(\s*"\/api\/optimization\/events"\s*,\s*requireFeatureAccess\(\s*"optimization\.view"\s*\)/,
  },
  {
    feature: "optimization.edit",
    method: "POST",
    path: "/api/optimization/events",
    body: {},
    okStatuses: [400, 500],
    kind: "real",
    sourceFile: "server/routes/optimization.ts",
    sourcePattern:
      /app\.post\(\s*"\/api\/optimization\/events"\s*,\s*requireFeatureAccess\(\s*"optimization\.edit"\s*\)/,
  },

  // -------------------- Orders --------------------
  // The orders routes hit MySQL; in test envs without MySQL the handler may
  // return 500 after the gate passes. That's fine — what we care about is
  // that the gate let the request through.
  {
    feature: "orders.submit",
    method: "POST",
    path: "/api/orders",
    body: {},
    okStatuses: [400, 500],
    kind: "real",
    sourceFile: "server/routes/orders.ts",
    sourcePattern:
      /app\.post\(\s*"\/api\/orders"\s*,\s*requireFeatureAccess\(\s*"orders\.submit"\s*\)/,
  },
  {
    feature: "orders.view_all",
    method: "GET",
    path: "/api/orders",
    okStatuses: [200, 500],
    kind: "real",
    sourceFile: "server/routes/orders.ts",
    sourcePattern:
      /app\.get\(\s*"\/api\/orders"\s*,\s*requireFeatureAccess\(\s*"orders\.view_all"\s*\)/,
  },
  {
    feature: "orders.edit",
    method: "PUT",
    path: "/api/orders/999999",
    body: {},
    okStatuses: BROADLY_OK,
    kind: "real",
    sourceFile: "server/routes/orders.ts",
    sourcePattern:
      /app\.put\(\s*"\/api\/orders\/:id"\s*,\s*requireFeatureAccess\(\s*"orders\.edit"\s*\)/,
  },
  {
    feature: "orders.delete",
    method: "DELETE",
    path: "/api/orders/999999",
    okStatuses: BROADLY_OK,
    kind: "real",
    sourceFile: "server/routes/orders.ts",
    sourcePattern:
      /app\.delete\(\s*"\/api\/orders\/:id"\s*,\s*requireFeatureAccess\(\s*"orders\.delete"\s*\)/,
  },
  {
    feature: "orders.submit",
    method: "GET",
    path: "/api/orders/seasonal-balances",
    okStatuses: [200, 500],
    kind: "real",
    sourceFile: "server/routes/orders.ts",
    sourcePattern:
      /app\.get\(\s*"\/api\/orders\/seasonal-balances"\s*,\s*requireFeatureAccess\(\s*"orders\.submit"\s*\)/,
  },
  {
    feature: "orders.edit",
    method: "POST",
    path: "/api/orders/999999/fulfill",
    body: {},
    okStatuses: BROADLY_OK,
    kind: "real",
    sourceFile: "server/routes/orders.ts",
    sourcePattern:
      /app\.post\(\s*"\/api\/orders\/:id\/fulfill"\s*,\s*requireFeatureAccess\(\s*"orders\.edit"\s*\)/,
  },
  {
    feature: "orders.edit",
    method: "POST",
    path: "/api/orders/999999/unfulfill",
    body: {},
    okStatuses: BROADLY_OK,
    kind: "real",
    sourceFile: "server/routes/orders.ts",
    sourcePattern:
      /app\.post\(\s*"\/api\/orders\/:id\/unfulfill"\s*,\s*requireFeatureAccess\(\s*"orders\.edit"\s*\)/,
  },

  // -------------------- Credit Card Inspections --------------------
  {
    feature: "credit_card_inspection.view_all",
    method: "GET",
    path: "/api/credit-card-inspections",
    okStatuses: [200, 500],
    kind: "real",
    sourceFile: "server/routes/creditCardInspections.ts",
    sourcePattern:
      /app\.get\(\s*"\/api\/credit-card-inspections"\s*,\s*requireFeatureAccess\(\s*"credit_card_inspection\.view_all"\s*\)/,
  },
  {
    feature: "credit_card_inspection.submit",
    method: "POST",
    path: "/api/credit-card-inspections",
    body: {},
    okStatuses: [400, 500],
    kind: "real",
    sourceFile: "server/routes/creditCardInspections.ts",
    sourcePattern:
      /app\.post\(\s*"\/api\/credit-card-inspections"\s*,\s*requireFeatureAccess\(\s*"credit_card_inspection\.submit"\s*\)/,
  },
  {
    feature: "credit_card_inspection.delete",
    method: "DELETE",
    path: "/api/credit-card-inspections/999999",
    okStatuses: [204, 500],
    kind: "real",
    sourceFile: "server/routes/creditCardInspections.ts",
    sourcePattern:
      /app\.delete\(\s*"\/api\/credit-card-inspections\/:id"\s*,\s*requireFeatureAccess\(\s*"credit_card_inspection\.delete"\s*\)/,
  },

  // -------------------- Driver Inspections --------------------
  {
    feature: "driver_inspection.view_all",
    method: "GET",
    path: "/api/driver-inspections",
    okStatuses: [200, 500],
    kind: "real",
    sourceFile: "server/routes/driverInspections.ts",
    sourcePattern:
      /app\.get\(\s*"\/api\/driver-inspections"\s*,\s*requireFeatureAccess\(\s*"driver_inspection\.view_all"\s*\)/,
  },
  {
    feature: "driver_inspection.submit",
    method: "POST",
    path: "/api/driver-inspections",
    body: {},
    okStatuses: [400, 500],
    kind: "real",
    sourceFile: "server/routes/driverInspections.ts",
    sourcePattern:
      /app\.post\(\s*"\/api\/driver-inspections"\s*,\s*requireFeatureAccess\(\s*"driver_inspection\.submit"\s*\)/,
  },
  {
    feature: "driver_inspection.resolve_repairs",
    method: "PATCH",
    path: "/api/driver-inspections/999999/items/foo",
    body: { resolved: true },
    okStatuses: [400, 404, 500],
    kind: "real",
    sourceFile: "server/routes/driverInspections.ts",
    sourcePattern:
      /app\.patch\(\s*"\/api\/driver-inspections\/:id\/items\/:key"\s*,\s*requireFeatureAccess\(\s*"driver_inspection\.resolve_repairs"\s*\)/,
  },
  {
    feature: "driver_inspection.delete",
    method: "DELETE",
    path: "/api/driver-inspections/999999",
    okStatuses: [204, 500],
    kind: "real",
    sourceFile: "server/routes/driverInspections.ts",
    sourcePattern:
      /app\.delete\(\s*"\/api\/driver-inspections\/:id"\s*,\s*requireFeatureAccess\(\s*"driver_inspection\.delete"\s*\)/,
  },

  // -------------------- Logistics --------------------
  {
    feature: "trailer_manifest.view",
    method: "GET",
    path: "/api/trailer-manifests",
    okStatuses: [200, 500],
    kind: "real",
    sourceFile: "server/routes/trailerManifests.ts",
    sourcePattern: /app\.get\(\s*"\/api\/trailer-manifests"\s*,\s*requireAccess\b/,
  },
  {
    feature: "trailer_manifest.edit",
    method: "POST",
    path: "/api/trailer-manifests",
    body: {},
    okStatuses: [400, 500],
    kind: "real",
    sourceFile: "server/routes/trailerManifests.ts",
    sourcePattern: /app\.post\(\s*"\/api\/trailer-manifests"\s*,\s*requireEdit\b/,
  },
  {
    feature: "trailer_manifest.delete",
    method: "DELETE",
    path: "/api/trailer-manifests/999999",
    okStatuses: [204, 404, 500],
    kind: "real",
    sourceFile: "server/routes/trailerManifests.ts",
    sourcePattern: /app\.delete\(\s*"\/api\/trailer-manifests\/:id"\s*,\s*requireDelete\b/,
  },
  {
    feature: "truck_routes.view",
    method: "GET",
    path: "/api/truck-routes",
    okStatuses: [200, 500],
    kind: "real",
    sourceFile: "server/routes/truckRoutes.ts",
    sourcePattern: /app\.get\(\s*"\/api\/truck-routes"\s*,\s*requireFeatureAccess\(\s*"truck_routes\.view"\s*\)/,
  },
  {
    feature: "truck_routes.edit",
    method: "POST",
    path: "/api/truck-routes",
    body: {},
    okStatuses: [400, 500],
    kind: "real",
    sourceFile: "server/routes/truckRoutes.ts",
    sourcePattern: /app\.post\(\s*"\/api\/truck-routes"\s*,\s*requireFeatureAccess\(\s*"truck_routes\.edit"\s*\)/,
  },
  {
    feature: "truck_routes.edit",
    method: "PUT",
    path: "/api/truck-routes/999999/stops",
    body: { locationIds: [] },
    okStatuses: [400, 404, 500],
    kind: "real",
    sourceFile: "server/routes/truckRoutes.ts",
    sourcePattern: /app\.put\(\s*"\/api\/truck-routes\/:id\/stops"\s*,\s*requireFeatureAccess\(\s*"truck_routes\.edit"\s*\)/,
  },
  {
    feature: "truck_routes.delete",
    method: "DELETE",
    path: "/api/truck-routes/999999",
    okStatuses: [204, 404, 500],
    kind: "real",
    sourceFile: "server/routes/truckRoutes.ts",
    sourcePattern: /app\.delete\(\s*"\/api\/truck-routes\/:id"\s*,\s*requireFeatureAccess\(\s*"truck_routes\.delete"\s*\)/,
  },
  {
    // The seasonal-balances endpoint is gated by `orders.submit` for the
    // per-store branch (used by the Order Form). The aggregate (no `location`
    // query) branch additionally requires `seasonal_inventory.view`, enforced
    // inline via `userHasFeature` rather than middleware. We assert both the
    // inline check exists in source and that an unauthorized request to the
    // aggregate branch is rejected.
    feature: "seasonal_inventory.view",
    method: "GET",
    path: "/api/orders/seasonal-balances",
    okStatuses: [200, 403, 500],
    kind: "real",
    sourceFile: "server/routes/orders.ts",
    sourcePattern: /userHasFeature\([^)]*,\s*"seasonal_inventory\.view"\s*\)/,
  },

  // -------------------- Inventory --------------------
  {
    feature: "warehouse_inventory.view",
    method: "GET",
    path: "/api/warehouse-inventory",
    okStatuses: [200, 500],
    kind: "real",
    sourceFile: "server/routes/warehouseInventory.ts",
    sourcePattern: /app\.get\(\s*"\/api\/warehouse-inventory"\s*,\s*requireAccess\b/,
  },
  {
    feature: "warehouse_inventory.edit",
    method: "POST",
    path: "/api/warehouse-inventory",
    body: {},
    okStatuses: [400, 500],
    kind: "real",
    sourceFile: "server/routes/warehouseInventory.ts",
    sourcePattern: /app\.post\(\s*"\/api\/warehouse-inventory"\s*,\s*requireEdit\b/,
  },
  {
    feature: "warehouse_inventory.finalize",
    method: "POST",
    path: "/api/warehouse-inventory/999999/finalize",
    body: {},
    okStatuses: [404, 500],
    kind: "real",
    sourceFile: "server/routes/warehouseInventory.ts",
    sourcePattern:
      /app\.post\(\s*"\/api\/warehouse-inventory\/:id\/finalize"\s*,\s*requireFinalize\b/,
  },
  {
    feature: "warehouse_inventory.transfer",
    method: "POST",
    path: "/api/warehouse-transfers",
    body: {},
    okStatuses: [400, 500],
    kind: "real",
    sourceFile: "server/routes/warehouseInventory.ts",
    sourcePattern: /app\.post\(\s*"\/api\/warehouse-transfers"\s*,\s*requireTransfer\b/,
  },

  // -------------------- Reports --------------------
  {
    feature: "reports.occurrences",
    method: "GET",
    path: "/api/reports/occurrences",
    okStatuses: [200, 500],
    kind: "real",
    sourceFile: "server/routes/reports.ts",
    sourcePattern:
      /app\.get\(\s*"\/api\/reports\/occurrences"\s*,\s*requireFeatureAccess\(\s*"reports\.occurrences"\s*\)/,
  },
  {
    feature: "reports.variance",
    method: "GET",
    path: "/api/reports/variance",
    okStatuses: [400, 500],
    kind: "real",
    sourceFile: "server/routes/reports.ts",
    sourcePattern:
      /app\.get\(\s*"\/api\/reports\/variance"\s*,\s*requireFeatureAccess\(\s*"reports\.variance"\s*\)/,
  },
  {
    feature: "reports.roster",
    method: "GET",
    path: "/api/roster-report",
    okStatuses: [200, 400, 500],
    kind: "real",
    sourceFile: "server/routes/roster.ts",
    sourcePattern:
      /app\.get\(\s*"\/api\/roster-report"\s*,\s*requireFeatureAccess\(\s*"reports\.roster"\s*\)/,
  },

  // -------------------- Configuration --------------------
  {
    feature: "locations.view",
    method: "GET",
    path: "/api/locations/999999",
    kind: "stub",
    sourceFile: "server/routes.ts",
    sourcePattern:
      /app\.get\(\s*api\.locations\.get\.path\s*,\s*requireFeatureAccess\(\s*"locations\.view"\s*\)/,
  },
  {
    feature: "locations.edit",
    method: "PUT",
    path: "/api/locations/999999",
    body: {},
    kind: "stub",
    sourceFile: "server/routes.ts",
    sourcePattern:
      /app\.put\(\s*api\.locations\.update\.path\s*,\s*requireFeatureAccess\(\s*"locations\.edit"\s*\)/,
  },
  {
    feature: "settings.global_config",
    method: "POST",
    path: "/api/global-settings",
    body: {},
    kind: "stub",
    sourceFile: "server/routes.ts",
    sourcePattern:
      /app\.post\(\s*api\.globalSettings\.update\.path\s*,\s*requireFeatureAccess\(\s*"settings\.global_config"\s*\)/,
  },
  {
    feature: "settings.ukg_config",
    method: "GET",
    path: "/api/ukg/credentials",
    okStatuses: [200, 500],
    kind: "real",
    sourceFile: "server/routes/ukg.ts",
    sourcePattern:
      /app\.get\(\s*"\/api\/ukg\/credentials"\s*,\s*requireFeatureAccess\(\s*"settings\.ukg_config"\s*\)/,
  },
  {
    feature: "settings.ukg_sync",
    method: "GET",
    path: "/api/ukg/diagnostics",
    okStatuses: [200, 500],
    kind: "real",
    sourceFile: "server/routes/ukg.ts",
    sourcePattern:
      /app\.get\(\s*"\/api\/ukg\/diagnostics"\s*,\s*requireFeatureAccess\(\s*"settings\.ukg_sync"\s*\)/,
  },
  {
    feature: "settings.email_audit",
    method: "GET",
    path: "/api/email-logs",
    kind: "stub",
    sourceFile: "server/routes.ts",
    sourcePattern:
      /app\.get\(\s*"\/api\/email-logs"\s*,\s*requireAuth\s*,\s*requireFeatureAccess\(\s*"settings\.email_audit"\s*\)/,
  },
  {
    feature: "settings.permissions",
    method: "GET",
    path: "/api/permissions",
    kind: "stub",
    sourceFile: "server/routes.ts",
    sourcePattern:
      /app\.get\(\s*"\/api\/permissions"\s*,\s*requireFeatureAccess\(\s*"settings\.permissions"\s*\)/,
  },

  // -------------------- User Administration --------------------
  {
    feature: "users.view",
    method: "GET",
    path: "/api/users",
    kind: "stub",
    sourceFile: "server/routes.ts",
    sourcePattern:
      /app\.get\(\s*api\.users\.list\.path\s*,\s*requireFeatureAccess\(\s*"users\.view"\s*\)/,
  },
  {
    feature: "users.edit_profile",
    method: "POST",
    path: "/api/users",
    body: {},
    kind: "stub",
    sourceFile: "server/routes.ts",
    sourcePattern:
      /app\.post\(\s*api\.users\.create\.path\s*,\s*requireFeatureAccess\(\s*"users\.edit_profile"\s*\)/,
  },
  {
    feature: "users.delete",
    method: "DELETE",
    path: "/api/users/999999",
    kind: "stub",
    sourceFile: "server/routes.ts",
    sourcePattern:
      /app\.delete\(\s*api\.users\.delete\.path\s*,\s*requireFeatureAccess\(\s*"users\.delete"\s*\)/,
  },
];

// Features intentionally NOT covered by ROUTE_GATES because they are not
// enforced via requireFeatureAccess middleware on a server route. The
// EXEMPT_FEATURES negative test below asserts none of these accidentally
// gain a middleware gate without being moved into ROUTE_GATES.
const EXEMPT_FEATURES: Record<string, string> = {
  "schedule.view": "Display-only filter; schedule listing is gated by requireAuth, not feature middleware.",
  "employees.view": "Employee directory listing is gated by requireAuth; visibility filtering happens in handlers, not via requireFeatureAccess middleware.",
  "raw_shifts.view": "Client-side navigation guard only (Navigation.tsx); no server route gates it.",
  "employees.has_direct_reports": "Role capability flag consumed by direct-report assignment logic, not a route gate.",
  "users.assign_roles": "Enforced inline inside PUT /api/users/:id with a custom 403 message, not via requireFeatureAccess middleware.",
  "users.assign_locations": "Enforced inline inside PUT /api/users/:id with a custom 403 message, not via requireFeatureAccess middleware.",
};

// ---------------------------------------------------------------------------
// Test app + helpers
// ---------------------------------------------------------------------------

function mountStubs(app: Express) {
  // For each "stub" RouteGate, mount a tiny handler with the same middleware
  // so the gate behaviour can be exercised end-to-end without booting the
  // entire production app (which depends on UKG, scheduler, MySQL, etc.).
  const register: Record<RouteGate["method"], Express["get"]> = {
    GET: app.get.bind(app),
    POST: app.post.bind(app),
    PUT: app.put.bind(app),
    PATCH: app.patch.bind(app),
    DELETE: app.delete.bind(app),
  };
  const stubHandler = (
    feature: string,
  ): express.RequestHandler => (_req, res) => {
    res.json({ ok: true, feature });
  };
  for (const gate of ROUTE_GATES) {
    if (gate.kind !== "stub") continue;
    // For paths that have query strings in the table, register against the
    // bare path without the query string.
    const path = gate.path.split("?")[0];
    register[gate.method](
      path,
      requireFeatureAccess(gate.feature),
      stubHandler(gate.feature),
    );
  }
}

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

  // Mount all real route registrations whose feature gating we want to test.
  registerOccurrenceRoutes(app);
  registerCoachingRoutes(app);
  registerShiftTradeRoutes(app);
  registerTaskAssignmentRoutes(app);
  registerOptimizationRoutes(app);
  registerDriverInspectionRoutes(app);
  registerCreditCardInspectionRoutes(app);
  registerOrderRoutes(app);
  registerTrailerManifestRoutes(app);
  registerWarehouseInventoryRoutes(app);
  registerReportRoutes(app);
  registerRosterRoutes(app);
  registerUKGRoutes(app);

  // Mount stubs for routes registered inline in server/routes.ts (which we
  // can't import in isolation). Source-grep tests verify the production
  // wiring matches.
  mountStubs(app);

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
 * Granted: the endpoint must NOT return 401 or 403 (it may legitimately
 * return 200/400/404/500 depending on request payload — what matters is
 * that the gate let the request through).
 *
 * Revoked: the endpoint MUST return 403 with the middleware's "Access
 * denied" message.
 */
async function assertGated(opts: {
  feature: string;
  method: string;
  path: string;
  body?: unknown;
  okStatuses?: number[];
}) {
  const { feature, method, path, body } = opts;
  const okStatuses = opts.okStatuses ?? BROADLY_OK;

  const original = await grantTestRole(feature);
  try {
    const cookie = await loginAs(TEST_ROLE);

    const granted = await request({ method, path, body, cookie });
    // The gate passed iff we don't see the middleware's 401/403 responses.
    // A downstream 403 from a different check (e.g. an inline admin-only
    // guard inside the handler) is fine: it proves the request reached the
    // handler.
    assert.notEqual(
      granted.status,
      401,
      `[${feature}] granted role should be authenticated`,
    );
    if (granted.status === 403) {
      assert.notEqual(
        granted.body?.message,
        "Access denied",
        `[${feature}] granted role hit the feature-gate middleware (got "Access denied")`,
      );
    }
    const allowed = [...okStatuses, 403];
    assert.ok(
      allowed.includes(granted.status),
      `[${feature}] expected status in ${JSON.stringify(okStatuses)} (or downstream 403), got ${granted.status}: ${JSON.stringify(granted.body)}`,
    );

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
    await setAllowedRoles(feature, original);
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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

test("custom role with no permissions is denied across a sample of gated endpoints", async () => {
  const cookie = await loginAs(TEST_ROLE);
  // A representative slice of the table — the data-driven loop below covers
  // every entry exhaustively in the granted/revoked direction.
  const samples = ROUTE_GATES.filter((g) =>
    [
      "attendance.view",
      "attendance.edit",
      "coaching.view",
      "coaching.edit",
      "schedule.publish",
      "shift_trades.approve",
      "warehouse_inventory.view",
      "orders.submit",
      "users.view",
    ].includes(g.feature),
  );
  for (const c of samples) {
    const path = c.path; // include query string if present
    const res = await request({ method: c.method, path, body: c.body, cookie });
    assert.equal(
      res.status,
      403,
      `${c.method} ${path} should be 403 for ungranted role (got ${res.status})`,
    );
    assert.equal(res.body?.message, "Access denied");
  }
});

// One concrete test per feature — generated from ROUTE_GATES so adding a new
// SYSTEM_FEATURES entry only requires extending the table above.
for (const gate of ROUTE_GATES) {
  test(`gate ${gate.feature} → ${gate.method} ${gate.path}`, async () => {
    await assertGated({
      feature: gate.feature,
      method: gate.method,
      path: gate.path,
      body: gate.body,
      okStatuses: gate.okStatuses,
    });
  });
}

test("production source wires every ROUTE_GATES entry to the expected feature", async () => {
  // Guards against the production routes silently drifting away from the
  // feature keys exercised by the integration tests above. We grep the route
  // sources directly so we don't have to boot the full app to assert the
  // middleware wiring.
  const fs = await import("node:fs/promises");
  const cache = new Map<string, string>();
  for (const gate of ROUTE_GATES) {
    let src = cache.get(gate.sourceFile);
    if (!src) {
      src = await fs.readFile(gate.sourceFile, "utf8");
      cache.set(gate.sourceFile, src);
    }
    assert.ok(
      gate.sourcePattern.test(src),
      `Missing wiring in ${gate.sourceFile} for ${gate.feature}: ${gate.sourcePattern}`,
    );
  }
});

test("every SYSTEM_FEATURES entry is covered by ROUTE_GATES or explicitly exempt", async () => {
  const covered = new Set(ROUTE_GATES.map((g) => g.feature));
  const exempt = new Set(Object.keys(EXEMPT_FEATURES));

  // Sanity: ROUTE_GATES entries must reference real SYSTEM_FEATURES keys.
  const knownFeatures = new Set(SYSTEM_FEATURES.map((f) => f.feature));
  for (const f of covered) {
    assert.ok(
      knownFeatures.has(f),
      `ROUTE_GATES references unknown feature "${f}"`,
    );
  }
  for (const f of exempt) {
    assert.ok(
      knownFeatures.has(f),
      `EXEMPT_FEATURES references unknown feature "${f}"`,
    );
  }

  // Sanity: no overlap between covered and exempt.
  for (const f of covered) {
    assert.ok(
      !exempt.has(f),
      `Feature "${f}" is in both ROUTE_GATES and EXEMPT_FEATURES`,
    );
  }

  // Coverage assertion: every system feature must be addressed somewhere.
  const missing: string[] = [];
  for (const f of knownFeatures) {
    if (!covered.has(f) && !exempt.has(f)) missing.push(f);
  }
  assert.deepEqual(
    missing,
    [],
    `New SYSTEM_FEATURES entries lack a permission test. Add a ROUTE_GATES entry or an EXEMPT_FEATURES reason for: ${missing.join(", ")}`,
  );
});

test("EXEMPT_FEATURES never accidentally gain a requireFeatureAccess gate", async () => {
  // If someone adds requireFeatureAccess("raw_shifts.view") to a route, this
  // test fails so the entry is moved out of EXEMPT_FEATURES into ROUTE_GATES
  // and gets real coverage.
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  async function walk(dir: string): Promise<string[]> {
    const out: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        out.push(...(await walk(full)));
      } else if (e.isFile() && full.endsWith(".ts")) {
        out.push(full);
      }
    }
    return out;
  }

  const files = await walk("server");
  const sources: Record<string, string> = {};
  for (const f of files) sources[f] = await fs.readFile(f, "utf8");

  for (const feature of Object.keys(EXEMPT_FEATURES)) {
    const needle = new RegExp(
      `requireFeatureAccess\\(\\s*"${feature.replace(/\./g, "\\.")}"\\s*\\)`,
    );
    const offenders = Object.entries(sources)
      .filter(([, src]) => needle.test(src))
      .map(([file]) => file);
    assert.deepEqual(
      offenders,
      [],
      `EXEMPT feature "${feature}" is now wired as middleware in ${offenders.join(", ")}; move it into ROUTE_GATES.`,
    );
  }
});

// ---------------------------------------------------------------------------
// Inline (non-middleware) permission tests
// ---------------------------------------------------------------------------
//
// A handful of permissions are enforced inline inside their handlers instead
// of through requireFeatureAccess middleware. They return custom 403 messages
// so they need direct coverage here in addition to the EXEMPT_FEATURES grep.
//
//   • PUT /api/users/:id has three inline checks (users.edit_profile,
//     users.assign_roles, users.assign_locations) layered on top of the
//     users.view middleware gate. These tests call the production
//     applyUserUpdate helper directly so the real handler logic is exercised.
//   • DELETE /api/trailer-manifests/:id passes the trailer_manifest.delete
//     gate but then enforces an inline admin-only override.

async function createInlineTestUser(): Promise<number> {
  const created = await storage.createUser({
    email: `inline_test_${process.pid}_${Date.now()}@example.com`,
    name: "Inline Test User",
    role: "viewer",
    isActive: true,
    locationIds: null as any,
  } as any);
  return created.id;
}

async function deleteInlineTestUser(id: number): Promise<void> {
  try {
    await db.delete(users).where(eq(users.id, id));
  } catch {
    /* best-effort cleanup */
  }
}

function makeSessionUser(role: string) {
  return {
    id: 9001,
    microsoftId: "test-msid",
    name: `Test ${role}`,
    email: `${role}@example.com`,
    role,
    locationIds: null,
  };
}

test("inline: users.assign_roles withheld → applyUserUpdate role change returns 403 with custom message", async () => {
  const userId = await createInlineTestUser();
  const originalView = await grantTestRole("users.view");
  const originalEdit = await grantTestRole("users.edit_profile");
  const originalAssignRoles = await getAllowedRoles("users.assign_roles");
  await setAllowedRoles(
    "users.assign_roles",
    originalAssignRoles.filter(r => r !== TEST_ROLE),
  );
  try {
    const existing = await storage.getUser(userId);
    const result = await applyUserUpdate(makeSessionUser(TEST_ROLE), existing!, { role: "manager" });
    assert.equal(result.status, 403);
    assert.equal(
      (result.body as any)?.message,
      "You don't have permission to change user roles.",
    );
  } finally {
    await setAllowedRoles("users.view", originalView);
    await setAllowedRoles("users.edit_profile", originalEdit);
    await setAllowedRoles("users.assign_roles", originalAssignRoles);
    await deleteInlineTestUser(userId);
  }
});

test("inline: users.assign_locations withheld → applyUserUpdate location change returns 403 with custom message", async () => {
  const userId = await createInlineTestUser();
  const originalView = await grantTestRole("users.view");
  const originalEdit = await grantTestRole("users.edit_profile");
  const originalAssignLocations = await getAllowedRoles("users.assign_locations");
  await setAllowedRoles(
    "users.assign_locations",
    originalAssignLocations.filter(r => r !== TEST_ROLE),
  );
  try {
    const existing = await storage.getUser(userId);
    const result = await applyUserUpdate(makeSessionUser(TEST_ROLE), existing!, { locationIds: ["1"] });
    assert.equal(result.status, 403);
    assert.equal(
      (result.body as any)?.message,
      "You don't have permission to change store assignments.",
    );
  } finally {
    await setAllowedRoles("users.view", originalView);
    await setAllowedRoles("users.edit_profile", originalEdit);
    await setAllowedRoles("users.assign_locations", originalAssignLocations);
    await deleteInlineTestUser(userId);
  }
});

test("inline: trailer_manifest.delete granted but non-admin → 403 with admin-only message", async () => {
  // Grant the synthetic role the feature gate so we get past requireDelete and
  // hit the inline admin-only override inside the handler.
  const original = await grantTestRole("trailer_manifest.delete");
  try {
    const cookie = await loginAs(TEST_ROLE);
    const res = await request({
      method: "DELETE",
      path: "/api/trailer-manifests/999999",
      cookie,
    });
    assert.equal(
      res.status,
      403,
      `expected inline admin 403, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
    assert.equal(
      res.body?.message,
      "Admin access required to delete manifests",
    );
  } finally {
    await setAllowedRoles("trailer_manifest.delete", original);
  }
});

test("inline: trailer_manifest.delete granted to admin → bypasses inline admin override", async () => {
  // Sanity check the inverse: admin role should pass both the gate and the
  // inline admin-only check (and proceed to a non-403 status downstream).
  const cookie = await loginAs("admin");
  const res = await request({
    method: "DELETE",
    path: "/api/trailer-manifests/999999",
    cookie,
  });
  assert.notEqual(
    res.status,
    403,
    `admin should not be blocked by inline admin-only override (got ${res.status}: ${JSON.stringify(res.body)})`,
  );
});

test("inline check source patterns still exist in production routes", async () => {
  // The user-update inline checks are now exercised directly via
  // applyUserUpdate(), so no source-grep mirror is needed for them.
  // The trailer-manifest test still exercises the inline admin-only override
  // via HTTP, so guard against drift in that handler.
  const fs = await import("node:fs/promises");
  const trailerSrc = await fs.readFile("server/routes/trailerManifests.ts", "utf8");

  assert.ok(
    /app\.delete\(\s*"\/api\/trailer-manifests\/:id"\s*,\s*requireDelete\b/.test(trailerSrc),
    "DELETE /api/trailer-manifests/:id should still be wrapped in requireDelete",
  );
  assert.ok(
    /sessionUser\.role\s*!==\s*"admin"/.test(trailerSrc) &&
      /Admin access required to delete manifests/.test(trailerSrc),
    "Inline admin-only override missing from DELETE /api/trailer-manifests/:id",
  );
});
