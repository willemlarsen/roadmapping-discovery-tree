import test from "node:test";
import assert from "node:assert/strict";
import { startedParts } from "../src/started-words.js";

const part = (id, status, order, parent = "f") => ({ id, parent, order, status });

test("startedParts words a next feature with one solved and one open part", () => {
  const feature = part("f", "next", 1, null);
  const problems = [feature, part("a", "done", 1), part("b", "next", 2)];

  const words = startedParts(feature, problems);

  assert.equal(words, "1 of 2 parts solved");
});

const ROWS = [
  ["merged counts as solved", "next", ["merged", "next"], "1 of 2 parts solved"],
  ["blocked counts as open", "next", ["done", "blocked"], "1 of 2 parts solved"],
  ["paused counts as open", "next", ["done", "paused"], "1 of 2 parts solved"],
  ["now part counts as open", "next", ["done", "now"], "1 of 2 parts solved"],
  ["parked parts are left out of the count", "next", ["done", "parked", "next", "done"], "2 of 3 parts solved"],
  ["a now feature gets no words", "now", ["done", "next"], null],
  ["all parts solved gets no words", "next", ["done", "merged"], null],
  ["no solved part gets no words", "next", ["next", "now"], null],
  ["only parked and done parts gets no words", "next", ["done", "parked"], null],
  ["no parts gets no words", "next", [], null],
];

test("startedParts table of edge and must-not rows", () => {
  const failures = ROWS.filter(([, featureStatus, partStatuses, expected]) => {
    const feature = part("f", featureStatus, 1, null);
    const parts = partStatuses.map((status, index) => part(`p${index}`, status, index + 1));

    return startedParts(feature, [feature, ...parts]) !== expected;
  });

  assert.deepEqual(failures.map(([name]) => name), []);
});
