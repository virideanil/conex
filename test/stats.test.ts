import test from "node:test";
import assert from "node:assert/strict";
import { median, percentile, trimmedMean, trimmedMeanBelow, jitterOf, rpmOf, stable, fitness } from "../shared/stats.ts";

test("median and percentile", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9);
  assert.equal(percentile([5], 0.5), 5);
});

test("trimmed means drop the slow-start floor and the bursts", () => {
  const samples = [1, 2, 3, 50, 50, 50, 50, 50, 50, 900];
  assert.equal(trimmedMean(samples, 0.3, 0.1), 50);
  assert.ok(Math.abs(trimmedMeanBelow([10, 10, 10, 10, 10, 10, 10, 10, 10, 500], 0.95) - 10) < 1e-9);
  assert.equal(trimmedMean([], 0.3, 0.1), 0);
});

test("jitter and rpm", () => {
  assert.equal(jitterOf([10, 12, 10]), 2);
  assert.equal(jitterOf([10]), 0);
  assert.ok(Math.abs(rpmOf([30, 30, 30]) - 2000) < 1e-9);
  assert.equal(rpmOf([]), 0);
});

test("stable: four intervals within five percent", () => {
  assert.equal(stable([10, 50, 95, 100, 101, 99, 100]), true);
  assert.equal(stable([10, 50, 95, 100, 120]), false);
  assert.equal(stable([100, 100]), false);
});

test("fitness: a good line, a bloated line, a thin line", () => {
  assert.deepEqual(fitness({ download: 300, upload: 50, latency: 10, jitter: 2, loaded: 20 }), { call: 5, game: 5, stream: 5 });
  const bloated = fitness({ download: 300, upload: 50, latency: 10, jitter: 2, loaded: 200 });
  assert.equal(bloated.call, 3);
  assert.equal(bloated.game, 3);
  assert.equal(bloated.stream, 4);
  const thin = fitness({ download: 3, upload: 0.5, latency: 180, jitter: 40, loaded: null });
  assert.deepEqual(thin, { call: 1, game: 1, stream: 1 });
  // measured stream beats the threshold guess
  assert.equal(fitness({ download: 3, upload: 0.5, latency: 180, jitter: 40, loaded: null, late: 0 }).stream, 5);
  assert.equal(fitness({ download: 900, upload: 50, latency: 5, jitter: 1, loaded: 6, late: 0.2 }).stream, 1);
});
