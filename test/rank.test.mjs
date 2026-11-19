import test from "node:test";
import assert from "node:assert/strict";
import { rankProblems } from "../src/rank.js";

test("rank orders by value per size, keeps sequence on ties, puts unestimated last", () => {
  const sequence = [
    { id: "a", value: 2, size: 2 },
    { id: "b", value: 8, size: 2 },
    { id: "c" },
    { id: "d", value: 3, size: 3 },
    { id: "e", value: 1 },
  ];
  const before = JSON.stringify(sequence);

  const ranked = rankProblems(sequence);

  assert.deepEqual(ranked, [
    { id: "b", priority: 1, value: 8, size: 2 },
    { id: "a", priority: 2, value: 2, size: 2 },
    { id: "d", priority: 3, value: 3, size: 3 },
    { id: "c", priority: null, value: null, size: null },
    { id: "e", priority: null, value: 1, size: null },
  ]);
  assert.equal(JSON.stringify(sequence), before);
});

test("rank gives parts no entry and keeps features' priorities", () => {
  const sequence = [
    { id: "f1", parent: null, value: 8, size: 2 },
    { id: "p1", parent: "f1", value: 5, size: 1 },
    { id: "f2", parent: null, value: 4, size: 1 },
    { id: "f3", parent: null },
  ];

  const ranked = rankProblems(sequence);

  assert.deepEqual(ranked, [
    { id: "f1", priority: 1, value: 8, size: 2 },
    { id: "f2", priority: 2, value: 4, size: 1 },
    { id: "f3", priority: null, value: null, size: null },
  ]);
});
