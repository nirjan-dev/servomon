// Unit tests for the dashboard's chart-window and table-sort helpers.
// Run: node --experimental-strip-types --test test/metrics.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  compareMetric,
  parsePeriod,
  parseQuantity,
  periodAvailable,
  periodSamples,
  sampleCoverage,
} from "../utils/metrics.ts";

const MIN = 60_000;
// 120 samples every 6 s: 12 minutes of data ending at t = 0.
const samples = Array.from({ length: 120 }, (_, i) => ({ timestamp: (i - 119) * 6_000 }));

test("parsePeriod accepts known values and defaults to all", () => {
  assert.equal(parsePeriod("5m"), "5m");
  assert.equal(parsePeriod("15m"), "15m");
  assert.equal(parsePeriod("30m"), "30m");
  assert.equal(parsePeriod("all"), "all");
  assert.equal(parsePeriod(undefined), "all");
  assert.equal(parsePeriod("2h"), "all");
  assert.equal(parsePeriod(["5m"]), "all");
});

test("sampleCoverage counts one interval per sample", () => {
  assert.equal(sampleCoverage([]), 0);
  assert.equal(sampleCoverage([{ timestamp: 5 }]), 0);
  assert.equal(sampleCoverage([{ timestamp: 5 }, { timestamp: 5 }]), 0);
  assert.equal(sampleCoverage(samples), 12 * MIN);
  // 50 samples at 6 s span 294 s but stand for 5 minutes.
  assert.equal(sampleCoverage(samples.slice(-50)), 5 * MIN);
});

test("periodAvailable offers windows the data covers, and always all", () => {
  const coverage = sampleCoverage(samples);
  assert.equal(periodAvailable("5m", coverage), true);
  assert.equal(periodAvailable("15m", coverage), false);
  assert.equal(periodAvailable("30m", coverage), false);
  assert.equal(periodAvailable("all", coverage), true);
  assert.equal(periodAvailable("all", 0), true);
  assert.equal(periodAvailable("5m", 0), false);
});

test("periodSamples keeps the window ending at the newest sample", () => {
  const five = periodSamples(samples, "5m");
  assert.equal(five.at(-1), samples.at(-1));
  assert.equal(five[0].timestamp, -5 * MIN);
  assert.equal(five.length, 51);
  // A window longer than the data, or "all", returns the input untouched.
  assert.equal(periodSamples(samples, "30m"), samples);
  assert.equal(periodSamples(samples, "all"), samples);
  assert.deepEqual(periodSamples([], "5m"), []);
});

test("parseQuantity reads agent percentages and sizes", () => {
  assert.equal(parseQuantity("12.34%"), 12.34);
  assert.equal(parseQuantity("0.00%"), 0);
  assert.equal(parseQuantity("7"), 7);
  assert.equal(parseQuantity(3.5), 3.5);
  assert.equal(parseQuantity("200.00 MBs"), 200 * 1024 ** 2);
  assert.equal(parseQuantity("1.5 GiB"), 1.5 * 1024 ** 3);
  assert.equal(parseQuantity("512 KB"), 512 * 1024);
  assert.equal(parseQuantity("10 bytes"), 10);
  assert.ok(parseQuantity("1.00 GBs") > parseQuantity("900.00 MBs"));
});

test("parseQuantity rejects missing or malformed values", () => {
  assert.equal(parseQuantity(undefined), null);
  assert.equal(parseQuantity(null), null);
  assert.equal(parseQuantity(""), null);
  assert.equal(parseQuantity("N/A"), null);
  assert.equal(parseQuantity("--"), null);
  assert.equal(parseQuantity("12 parsecs"), null);
  assert.equal(parseQuantity(Number.NaN), null);
});

test("compareMetric sorts numerically with missing values last", () => {
  const values = [2, null, 10, 1.5, undefined, 100];
  assert.deepEqual([...values].sort((a, b) => compareMetric(a, b, true)), [100, 10, 2, 1.5, null, undefined]);
  assert.deepEqual([...values].sort((a, b) => compareMetric(a, b)), [1.5, 2, 10, 100, null, undefined]);
  // Numeric, not lexicographic: "9.5%" sorts below "12.34%".
  assert.ok(compareMetric(parseQuantity("9.5%"), parseQuantity("12.34%"), true) > 0);
  assert.equal(compareMetric(null, Number.NaN), 0);
});
