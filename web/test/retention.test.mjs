// S3 unit tests for the retention partition function.
// Run: node --experimental-strip-types --test test/retention.test.mjs
// Pure function, no server needed. Uses explicit window/count/floor args so
// the tests don't depend on production constants.
import test from "node:test";
import assert from "node:assert/strict";
import { partitionKeys } from "../server/utils/retention.ts";

const NOW = 1_000_000_000;
const WINDOW = 1000;
const MAX = 5;
const FLOOR = 2;
const keys = (timestamps) => timestamps.map(String);

test("keeps everything within window and count", () => {
  const { keep, remove } = partitionKeys(keys([NOW, NOW - 100, NOW - 200]), NOW, WINDOW, MAX, FLOOR);
  assert.deepEqual(remove, []);
  assert.equal(keep.length, 3);
});

test("removes samples older than the window", () => {
  const { keep, remove } = partitionKeys(
    keys([NOW, NOW - 100, NOW - 2000, NOW - 3000]),
    NOW, WINDOW, MAX, FLOOR,
  );
  assert.deepEqual(remove.sort(), [String(NOW - 2000), String(NOW - 3000)].sort());
  assert.ok(keep.includes(String(NOW)));
});

test("removes samples beyond the count cap even if fresh", () => {
  const fresh = [0, 10, 20, 30, 40, 50, 60].map((d) => NOW - d);
  const { keep, remove } = partitionKeys(keys(fresh), NOW, WINDOW, MAX, FLOOR);
  assert.equal(keep.length, MAX);
  assert.equal(remove.length, fresh.length - MAX);
  // The removed ones are the oldest, never the newest.
  assert.ok(keep.includes(String(NOW)));
  assert.ok(remove.includes(String(NOW - 60)));
});

test("floor always preserves the newest samples", () => {
  // Every sample is older than the window: floor still keeps the newest two.
  const { keep, remove } = partitionKeys(keys([NOW - 5000, NOW - 6000, NOW - 7000]), NOW, WINDOW, MAX, FLOOR);
  assert.equal(keep.length, FLOOR);
  assert.ok(keep.includes(String(NOW - 5000)));
  assert.deepEqual(remove, [String(NOW - 7000)]);
});

test("out-of-order arrivals are ordered, never delete newer data", () => {
  // Storage keys arrive in arbitrary order; deletion targets the oldest.
  const { keep, remove } = partitionKeys(
    keys([NOW - 3000, NOW, NOW - 100, NOW - 4000, NOW - 200, NOW - 5000]),
    NOW, WINDOW, 4, 1,
  );
  const newest = [NOW, NOW - 100, NOW - 200].map(String);
  for (const key of newest) assert.ok(keep.includes(key), `${key} must survive`);
  for (const key of remove) {
    assert.ok(Number(key) < NOW - 200, `${key} must be older than kept samples`);
  }
});

test("non-numeric keys are never deleted", () => {
  const { keep, remove } = partitionKeys(["abc", String(NOW), "def"], NOW, WINDOW, MAX, FLOOR);
  assert.deepEqual(remove, []);
  assert.ok(keep.includes(String(NOW)));
});

test("empty input partitions cleanly", () => {
  assert.deepEqual(partitionKeys([], NOW, WINDOW, MAX, FLOOR), { keep: [], remove: [] });
});
