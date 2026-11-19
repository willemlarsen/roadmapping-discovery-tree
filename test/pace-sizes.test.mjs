import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSizes } from "../src/pace/sizes.js";
import { commitAt } from "./support/commits.mjs";

const inSession = (token, subjects, startMinute = 0) =>
  subjects.map((subject, index) => commitAt(startMinute + index, `${subject} (gov-${token})`));

test("buildSizes_withFinishedAndSmallSessions_returnsSortedSizesOfSessionsWithAtLeastFiveCycles", () => {
  const finished = inSession("2f5cacf8da28", ["K1a: cycle ids", "K1b: rework", "K2a: planned", "K2b: overrun input", "K3: no double count", "tasks: record K1-K3"]);
  const larger = inSession("62222a191533", ["H1: history", "H2: window", "H3: stale", "H4: order", "C15b-10: id with a suffix", "H5a: offsets", "H6a: weekdays"]);
  const longest = inSession("2b7e151628ae", ["G1: a", "G2: b", "G3: c", "G4: d", "G5: e", "G6: f", "G7: g", "G8: h", "G9: i", "G10: j"]);
  const tooSmall = inSession("e7fffe21f4b8", ["F1: one", "F2: two", "F3: three", "F4: four"]);
  const inProgress = inSession("3c9a00000003", ["P1: a", "P2: b", "P3: c", "P4: d", "P5: e"], 1000);
  const untokened = [commitAt(0, "C1: a behaviour"), commitAt(1, "pace.json: regenerated"), commitAt(2, "Forecast: K1-K3 verified")];

  const sizes = buildSizes([...larger, ...longest, ...tooSmall, ...untokened, ...finished, ...inProgress]);

  assert.deepEqual(sizes, [5, 7, 10]);
});

test("buildSizes_withASessionOverTheContractLimit_clampsItsSizeToTwoHundred", () => {
  const subjects = Array.from({ length: 205 }, (_, index) => `H${index + 1}: a planned behaviour`);
  const huge = inSession("4a1d00000001", subjects);
  const large = inSession("4b2e00000002", subjects.slice(0, 200));
  const inProgress = inSession("3c9a00000003", subjects.slice(0, 5), 1000);

  const sizes = buildSizes([...huge, ...large, ...inProgress]);

  assert.deepEqual(sizes, [200, 200]);
});

test("buildSizes_withTheNewestSessionStillInProgress_leavesItOutOfTheSizes", () => {
  const finished = inSession("2f5cacf8da28", ["K1: a", "K2: b", "K3: c", "K4: d", "K5: e"]);
  const inProgress = inSession("62222a191533", ["H1: a", "H2: b", "H3: c", "H4: d", "H5: e", "H6: f", "H7: g"], 100);

  const sizes = buildSizes([...inProgress, ...finished]);

  assert.deepEqual(sizes, [5]);
});

test("buildSizes_withTwoSessionsSharingTheNewestTime_leavesBothOutOfTheSizes", () => {
  const finished = inSession("2f5cacf8da28", ["K1: a", "K2: b", "K3: c", "K4: d", "K5: e"]);
  const tiedShort = inSession("62222a191533", ["H1: a", "H2: b", "H3: c", "H4: d", "H5: e", "H6: f"], 100);
  const tiedLong = inSession("2b7e151628ae", ["G1: a", "G2: b", "G3: c", "G4: d", "G5: e", "G6: f", "G7: g"], 99);

  const sizes = buildSizes([...finished, ...tiedShort, ...tiedLong]);

  assert.deepEqual(sizes, [5]);
});

test("buildSizes_withACommitWhoseTimeIsNotANumber_stillLeavesTheNewestSessionOut", () => {
  const finished = inSession("2f5cacf8da28", ["K1: a", "K2: b", "K3: c", "K4: d", "K5: e"]);
  const withBrokenTime = inSession("62222a191533", ["H1: a", "H2: b", "H3: c", "H4: d", "H5: e"], 50).map((commit, index) => (index === 1 ? { ...commit, at: Number.NaN } : index === 2 ? { ...commit, at: Number.POSITIVE_INFINITY } : commit));
  const inProgress = inSession("2b7e151628ae", ["G1: a", "G2: b", "G3: c", "G4: d", "G5: e", "G6: f"], 100);

  const sizes = buildSizes([...finished, ...withBrokenTime, ...inProgress]);

  assert.deepEqual(sizes, [5, 5]);
});
