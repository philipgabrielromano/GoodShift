import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../shared/schema";
import {
  DatabaseStorage,
} from "../server/storage";
import {
  employees,
  locations,
  publishedScheduleOverrides,
  publishedSchedules,
  shifts,
} from "../shared/schema";

// These tests use a dedicated PostgreSQL schema and a dedicated client. They
// never touch application tables; cleanup drops the schema even after a test
// failure. This also exercises the real Drizzle transaction/advisory-lock
// paths instead of replacing them with mocks.
const testSchema = `schedule_storage_test_${process.pid}_${Date.now()}`;
if (!/^[a-z0-9_]+$/.test(testSchema)) {
  throw new Error("Generated test schema name was unexpectedly unsafe");
}

const quotedSchema = `"${testSchema}"`;
let client: Client | undefined;
let testDb: any;
let testStorage: DatabaseStorage | undefined;

const weekStart = "2026-06-07";
const rangeStart = new Date("2026-06-07T00:00:00.000Z");
const rangeEnd = new Date("2026-06-14T00:00:00.000Z");

async function createOverrideTable(): Promise<void> {
  await client!.query(`
    CREATE TABLE ${quotedSchema}.published_schedule_overrides (
      id SERIAL PRIMARY KEY,
      week_start DATE NOT NULL,
      location TEXT NOT NULL,
      is_published BOOLEAN NOT NULL DEFAULT FALSE,
      published_by INTEGER,
      published_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT published_schedule_overrides_week_location_idx
        UNIQUE (week_start, location)
    )
  `);
}

async function resetData(): Promise<void> {
  await testDb.delete(shifts);
  await testDb.delete(publishedScheduleOverrides);
  await testDb.delete(publishedSchedules);
  await testDb.delete(employees);
  await testDb.delete(locations);

  await testDb.insert(employees).values([
    {
      name: "Store A Employee",
      email: "storage-publication-a@example.test",
      jobTitle: "STLDWKR",
      location: "Store A",
    },
    {
      name: "Store B Employee",
      email: "storage-publication-b@example.test",
      jobTitle: "STLDWKR",
      location: "Store B",
    },
    {
      name: "Unlocated Employee",
      email: "storage-publication-null@example.test",
      jobTitle: "STLDWKR",
      location: null,
    },
  ]);
  await testDb.insert(locations).values([
    { name: "Store A" },
    { name: "Store B" },
  ]);
}

async function countShifts(): Promise<number> {
  const rows = await testDb.select({ id: shifts.id }).from(shifts);
  return rows.length;
}

test.before(async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is not configured; isolated storage tests require PostgreSQL");
    return;
  }

  client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`CREATE SCHEMA ${quotedSchema}`);
  await client.query(`SET search_path TO ${quotedSchema}`);
  await client.query(`
    CREATE TABLE employees (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      job_title TEXT NOT NULL,
      max_weekly_hours INTEGER NOT NULL DEFAULT 40,
      color TEXT NOT NULL DEFAULT '#3b82f6',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      is_hidden_from_schedule BOOLEAN NOT NULL DEFAULT FALSE,
      location TEXT,
      employment_type TEXT,
      ukg_employee_id TEXT,
      preferred_days_per_week INTEGER DEFAULT 5,
      non_working_days TEXT[],
      hire_date DATE,
      alternate_email TEXT,
      shift_preference TEXT,
      fixed_shift_start TEXT,
      fixed_shift_end TEXT,
      day_specific_shifts TEXT
    );
    CREATE TABLE locations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      weekly_hours_limit INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      apparel_processor_stations INTEGER NOT NULL DEFAULT 0,
      donation_pricing_stations INTEGER NOT NULL DEFAULT 0,
      notification_email TEXT,
      form_only BOOLEAN NOT NULL DEFAULT FALSE,
      available_for_order_form BOOLEAN NOT NULL DEFAULT TRUE,
      order_form_name TEXT,
      available_for_scheduling BOOLEAN NOT NULL DEFAULT TRUE,
      scheduling_name TEXT,
      available_for_roster_targets BOOLEAN NOT NULL DEFAULT TRUE,
      warehouse_assignment TEXT
    );
    CREATE TABLE shifts (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL,
      start_time TIMESTAMP NOT NULL,
      end_time TIMESTAMP NOT NULL,
      cross_trained_role TEXT
    );
    CREATE TABLE published_schedules (
      id SERIAL PRIMARY KEY,
      week_start DATE NOT NULL UNIQUE,
      published_by INTEGER,
      published_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await createOverrideTable();

  // The constructor's optional handle keeps this test isolated from the
  // application's default schema while retaining production behavior.
  testDb = drizzle(client, { schema });
  testStorage = new DatabaseStorage(testDb);
});

test.beforeEach(async (t) => {
  if (!testStorage) {
    t.skip("PostgreSQL setup was skipped");
    return;
  }
  await resetData();
});

test.after(async () => {
  if (client) {
    await client.query(`DROP SCHEMA ${quotedSchema} CASCADE`);
    await client.end();
  }
});

test("location override takes precedence, then falls back to legacy global state", async () => {
  assert.ok(testStorage);
  await testStorage.publishSchedule(weekStart, 11);
  assert.equal(await testStorage.isSchedulePublished(weekStart, "Store A"), true);
  assert.equal(await testStorage.isSchedulePublished(weekStart, null), true);

  await testStorage.unpublishSchedule(weekStart, "Store A");
  assert.equal(await testStorage.isSchedulePublished(weekStart, "Store A"), false);
  // A scoped unpublish must not hide another location still covered by the
  // legacy global marker.
  assert.equal(await testStorage.isSchedulePublished(weekStart, "Store B"), true);
  assert.equal(await testStorage.isSchedulePublished(weekStart, null), true);
});

test("global publish supersedes overrides and global unpublish removes all state", async () => {
  assert.ok(testStorage);
  await testStorage.publishSchedule(weekStart, 11, "Store A");
  assert.equal(await testStorage.isSchedulePublished(weekStart, "Store A"), true);
  assert.equal(await testStorage.isSchedulePublished(weekStart, "Store B"), false);

  await testStorage.publishSchedule(weekStart, 12);
  assert.equal(await testStorage.isSchedulePublished(weekStart), true);
  const overridesAfterGlobalPublish = await testDb
    .select()
    .from(publishedScheduleOverrides);
  assert.equal(overridesAfterGlobalPublish.length, 0);

  await testStorage.unpublishSchedule(weekStart);
  assert.equal(await testStorage.isSchedulePublished(weekStart, "Store A"), false);
  assert.equal(await testStorage.isSchedulePublished(weekStart, "Store B"), false);
  assert.equal(await testStorage.isSchedulePublished(weekStart, null), false);
});

test("administrator aggregate requires every known location to be published", async () => {
  assert.ok(testStorage);
  await testStorage.publishSchedule(weekStart, 11, "Store A");
  assert.equal(await testStorage.isSchedulePublished(weekStart), false);
  assert.equal(await testStorage.isSchedulePublished(weekStart, null), false);

  await testStorage.publishSchedule(weekStart, 11, "Store B");
  // The unlocated employee remains legacy-only, so the aggregate is still
  // false until the legacy marker is published.
  assert.equal(await testStorage.isSchedulePublished(weekStart), false);

  await testStorage.publishSchedule(weekStart, 11);
  assert.equal(await testStorage.isSchedulePublished(weekStart), true);
});

test("clearSchedule atomically scopes shifts and publication state", async () => {
  assert.ok(testStorage);
  const [employeeA, employeeB] = await testDb
    .select({ id: employees.id, location: employees.location })
    .from(employees);
  const employeeByLocation = new Map(
    [employeeA, employeeB].map((employee: { id: number; location: string | null }) => [
      employee.location,
      employee.id,
    ]),
  );
  await testDb.insert(shifts).values([
    {
      employeeId: employeeByLocation.get("Store A")!,
      startTime: new Date("2026-06-08T10:00:00.000Z"),
      endTime: new Date("2026-06-08T18:00:00.000Z"),
    },
    {
      employeeId: employeeByLocation.get("Store B")!,
      startTime: new Date("2026-06-09T10:00:00.000Z"),
      endTime: new Date("2026-06-09T18:00:00.000Z"),
    },
  ]);
  await testStorage.publishSchedule(weekStart, 11);

  const scoped = await testStorage.clearSchedule(rangeStart, rangeEnd, weekStart, "Store A");
  assert.deepEqual(scoped, { deletedCount: 1, unpublished: true });
  assert.equal(await testStorage.isSchedulePublished(weekStart, "Store A"), false);
  assert.equal(await testStorage.isSchedulePublished(weekStart, "Store B"), true);
  assert.equal(await countShifts(), 1);

  const global = await testStorage.clearSchedule(rangeStart, rangeEnd, weekStart);
  assert.deepEqual(global, { deletedCount: 1, unpublished: true });
  assert.equal(await testStorage.isSchedulePublished(weekStart), false);
  assert.equal(await countShifts(), 0);
});

test("clearSchedule rolls back deleted shifts if publication cleanup fails", async () => {
  assert.ok(testStorage);
  const [employeeA] = await testDb
    .select({ id: employees.id })
    .from(employees);
  await testDb.insert(shifts).values({
    employeeId: employeeA.id,
    startTime: new Date("2026-06-08T10:00:00.000Z"),
    endTime: new Date("2026-06-08T18:00:00.000Z"),
  });
  await testStorage.publishSchedule(weekStart, 11);

  // Removing only the isolated override table forces the publication phase
  // to fail after the shift DELETE, proving the transaction rolls it back.
  await client!.query(`DROP TABLE ${quotedSchema}.published_schedule_overrides`);
  await assert.rejects(
    testStorage.clearSchedule(rangeStart, rangeEnd, weekStart),
  );
  const shiftsAfterRollback = await countShifts();
  assert.equal(shiftsAfterRollback, 1);

  await createOverrideTable();
  assert.equal(await testStorage.isSchedulePublished(weekStart), true);
});