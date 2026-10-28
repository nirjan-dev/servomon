// Unit tests for the low-battery alert rule.
// Run: node --experimental-strip-types --test test/battery.test.mjs
// Pure function, no server needed. Uses an explicit threshold so the tests
// don't depend on the production constant.
import test from "node:test";
import assert from "node:assert/strict";
import { isLowBattery } from "../server/utils/battery.ts";

const THRESHOLD = 50;

test("a machine without a battery never alerts", () => {
  // The agent reports charge 0 when the machine has no battery.
  assert.equal(isLowBattery(0, THRESHOLD), false);
});

test("a low battery alerts, down to 1%", () => {
  assert.equal(isLowBattery(20, THRESHOLD), true);
  assert.equal(isLowBattery(1, THRESHOLD), true);
});

test("a charged battery doesn't alert", () => {
  assert.equal(isLowBattery(100, THRESHOLD), false);
});
