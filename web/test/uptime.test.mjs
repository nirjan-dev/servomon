// Unit tests for the dashboard uptime formatter.
// Run: node --experimental-strip-types --test test/uptime.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { formatUptime } from "../utils/metrics.ts";

const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test("absent or invalid uptime shows a dash", () => {
  assert.equal(formatUptime(undefined), "—");
  assert.equal(formatUptime(null), "—");
  assert.equal(formatUptime(Number.NaN), "—");
  assert.equal(formatUptime(-5), "—");
});

test("zero and sub-minute uptime", () => {
  assert.equal(formatUptime(0), "under a minute");
  assert.equal(formatUptime(59.9), "under a minute");
});

test("minutes", () => {
  assert.equal(formatUptime(MIN), "1 minute");
  assert.equal(formatUptime(42 * MIN + 30), "42 minutes");
  assert.equal(formatUptime(HOUR - 1), "59 minutes");
});

test("hours", () => {
  assert.equal(formatUptime(HOUR), "1 hour");
  assert.equal(formatUptime(5 * HOUR + 12 * MIN + 59), "5 hours, 12 minutes");
  assert.equal(formatUptime(2 * HOUR + MIN), "2 hours, 1 minute");
  assert.equal(formatUptime(DAY - 1), "23 hours, 59 minutes");
});

test("days keep the two most significant non-zero units", () => {
  assert.equal(formatUptime(DAY), "1 day");
  assert.equal(formatUptime(3 * DAY + 4 * HOUR + 30 * MIN), "3 days, 4 hours");
  assert.equal(formatUptime(DAY + 5 * MIN), "1 day, 5 minutes");
  assert.equal(formatUptime(400 * DAY + HOUR), "400 days, 1 hour");
});
