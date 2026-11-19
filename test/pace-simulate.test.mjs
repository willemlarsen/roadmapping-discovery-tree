import { test } from "node:test";
import assert from "node:assert/strict";
import { simulate, simulateInOrder, simulateSampled, SIMULATION_SEED } from "../src/pace/simulate.js";

test("simulate returns p50 and p85 hours, the same for the same seed and different for another", () => {
  const samples = [7, 12, 19, 25, 31, 44, 58, 90];

  const first = simulate(samples, 5, SIMULATION_SEED);
  const again = simulate(samples, 5, SIMULATION_SEED);
  const other = simulate(samples, 5, SIMULATION_SEED + 1);
  const exact = simulate([30], 4, SIMULATION_SEED);

  assert.deepEqual(first, again);
  assert.notDeepEqual(first, other);
  assert.deepEqual(first, { p50Hours: 2.9166666666666665, p85Hours: 4.033333333333333, p95Hours: 4.683333333333334 });
  assert.deepEqual(exact, { p50Hours: 2, p85Hours: 2, p95Hours: 2 });
});

test("simulateInOrder gives each later card the earlier cards' work as well as its own", () => {
  const samples = [30];

  const ranges = simulateInOrder(samples, [2, 3, 1], SIMULATION_SEED);

  assert.deepEqual(ranges, [
    { p50Hours: 1, p85Hours: 1, p95Hours: 1 },
    { p50Hours: 2.5, p85Hours: 2.5, p95Hours: 2.5 },
    { p50Hours: 3, p85Hours: 3, p95Hours: 3 },
  ]);
});

test("simulateSampled_withObservedBuildSizes_drawsEachCardsCyclesFromThemIndependently", () => {
  const steady = simulateSampled({ samples: [60], sizes: [3] }, 2, SIMULATION_SEED);
  const varied = simulateSampled({ samples: [60], sizes: [1, 10] }, 1, SIMULATION_SEED);
  const separateDraws = simulateSampled({ samples: [60], sizes: [1, 1, 1, 10] }, 2, SIMULATION_SEED);

  assert.deepEqual(steady, [
    { p50Hours: 3, p85Hours: 3, p95Hours: 3 },
    { p50Hours: 6, p85Hours: 6, p95Hours: 6 },
  ]);
  assert.equal(varied[0].p85Hours, 10);
  assert.equal(separateDraws[1].p85Hours, 11);
});

test("simulate returns p95Hours, the 95th percentile of the simulated hours, on a fixed seed", () => {
  const samples = [7, 12, 19, 25, 31, 44, 58, 90];

  const range = simulate(samples, 5, SIMULATION_SEED);

  assert.equal(range.p95Hours, 4.683333333333334);
});

test("simulate keeps p95Hours >= p85Hours >= p50Hours on a fixed seed, with ties for fixed cycles", () => {
  const spread = simulate([7, 12, 19, 25, 31, 44, 58, 90], 5, SIMULATION_SEED);
  const tied = simulate([30], 1, SIMULATION_SEED);
  const everyCard = simulateInOrder([7, 12, 19, 25, 31, 44, 58, 90], [1, 3, 5], SIMULATION_SEED);

  assert.ok(spread.p95Hours >= spread.p85Hours && spread.p85Hours >= spread.p50Hours);
  assert.ok(spread.p95Hours > spread.p50Hours);
  assert.deepEqual(tied, { p50Hours: 0.5, p85Hours: 0.5, p95Hours: 0.5 });
  for (const range of everyCard) {
    assert.ok(range.p95Hours >= range.p85Hours && range.p85Hours >= range.p50Hours);
  }
});
