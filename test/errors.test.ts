/**
 * Unit tests for dependency error classification (server/errors.ts).
 *
 * Regression coverage for AUDIT_REPORT.md §2 (E-1, E-3): MySQL/tunnel and
 * Postgres outages answer 503, everything else stays 500.
 *
 * Run with:   npx tsx --test test/errors.test.ts
 * No database needed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { errorStatus, dependencyOf } from "../server/errors";

const withCode = (code: string, message = "x") => Object.assign(new Error(message), { code });

test("MySQL connection and timeout failures are 503", () => {
  for (const code of ["PROTOCOL_CONNECTION_LOST", "PROTOCOL_SEQUENCE_TIMEOUT", "ECONNREFUSED", "ETIMEDOUT", "MYSQL_ACQUIRE_TIMEOUT", "MYSQL_QUEUE_FULL"]) {
    assert.equal(errorStatus(withCode(code)), 503, code);
  }
  assert.equal(errorStatus(Object.assign(new Error("Connection was killed"), { fatal: true })), 503);
});

test("Postgres outages are 503, including pg-pool's wait timeout", () => {
  assert.equal(errorStatus(withCode("57P01")), 503);
  assert.equal(errorStatus(withCode("53300")), 503);
  assert.equal(errorStatus(new Error("timeout exceeded when trying to connect")), 503);
  assert.equal(errorStatus(Object.assign(new Error("Failed query"), { cause: new Error("Connection terminated unexpectedly") })), 503);
});

test("query and app errors stay 500", () => {
  assert.equal(errorStatus(withCode("ER_PARSE_ERROR")), 500);
  assert.equal(errorStatus(withCode("23505")), 500); // unique violation
  assert.equal(errorStatus(new Error("boom")), 500);
  assert.equal(errorStatus(undefined), 500);
});

test("dependencyOf tags errors for logs", () => {
  assert.equal(dependencyOf(withCode("ER_PARSE_ERROR")), "mysql");
  assert.equal(dependencyOf(withCode("PROTOCOL_CONNECTION_LOST")), "mysql");
  assert.equal(dependencyOf(withCode("23505")), "pg");
  assert.equal(dependencyOf(new Error("timeout exceeded when trying to connect")), "pg");
  assert.equal(dependencyOf(new Error("boom")), "app");
});
