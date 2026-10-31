import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidObjectPath,
  normalizeUkgApiUrl,
} from "../server/security/urlValidation";

test("HR attachments only accept normalized application object paths", () => {
  assert.equal(isValidObjectPath("/objects/uploads/report-123.pdf"), true);

  for (const value of [
    "javascript:alert(document.cookie)",
    "data:text/html,<script>alert(1)</script>",
    "https://attacker.example/report.pdf",
    "/objects/../private",
    "/objects//report.pdf",
    "/objects/%2e%2e/private",
    "/objects/report.pdf?next=javascript:alert(1)",
  ]) {
    assert.equal(isValidObjectPath(value), false, value);
  }
});

test("UKG API URLs are restricted to HTTPS vendor hosts", () => {
  assert.equal(
    normalizeUkgApiUrl("https://service5.ultipro.com/api/"),
    "https://service5.ultipro.com/api",
  );
  assert.equal(
    normalizeUkgApiUrl("https://api.ukg.com/personnel/v1"),
    "https://api.ukg.com/personnel/v1",
  );
  assert.equal(
    normalizeUkgApiUrl("https://tenant.ulticlock.com/UtmOdataServices/api"),
    "https://tenant.ulticlock.com/UtmOdataServices/api",
  );

  for (const value of [
    "http://service5.ultipro.com",
    "https://attacker.example",
    "https://ukg.com.attacker.example",
    "https://127.0.0.1",
    "https://user:password@service5.ultipro.com",
    "https://service5.ultipro.com:8443",
    "https://service5.ultipro.com/api?redirect=internal",
    "https://service5.ultipro.com/api#fragment",
  ]) {
    assert.throws(() => normalizeUkgApiUrl(value), undefined, value);
  }
});