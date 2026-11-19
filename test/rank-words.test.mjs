import test from "node:test";
import assert from "node:assert/strict";
import { partLine, rankLine } from "../src/rank-words.js";

test("rankLine words per entry kind", () => {
  const ranking = [
    { id: "a", priority: 1, value: 8, size: 2 },
    { id: "b", priority: 2, value: 3, size: 5 },
    { id: "c", priority: null, value: null, size: null },
  ];

  const lines = ["a", "b", "c", "missing"].map((id) => rankLine(id, ranking));

  assert.deepEqual(lines, [
    "Priority 1 of 2 · value for size: value 8, size 2",
    "Priority 2 of 2 · value for size: value 3, size 5",
    "Unranked: value and size are not set yet.",
    null,
  ]);
});

const part = (id, order, status = "now", parent = "f") => ({ id, parent, order, status });

test("partLine words per sibling arrangement", () => {
  const only = [part("a", 1)];
  const allDone = [part("a", 3, "done"), part("b", 1, "done"), part("c", 2, "done")];
  const withParked = [part("a", 1), part("p", 2, "parked"), part("b", 3), part("other", 1, "now", "g")];
  const shuffled = [part("late", 9), part("early", 2), part("mid", 5)];

  const lines = [
    partLine(only[0], only),
    allDone.map((problem) => partLine(problem, allDone)),
    partLine(withParked[2], withParked),
    ["early", "mid", "late"].map((id) => partLine(shuffled.find((problem) => problem.id === id), shuffled)),
  ];

  assert.deepEqual(lines, [
    "Part 1 of 1, in progress",
    ["Part 3 of 3", "Part 1 of 3", "Part 2 of 3"],
    "Part 2 of 2, in progress",
    ["Part 1 of 3, in progress", "Part 2 of 3, in progress", "Part 3 of 3, in progress"],
  ]);
});

test("rankLine explains priority as value for size", () => {
  const ranking = [
    { id: "a", priority: 1, value: 8, size: 2 },
    { id: "c", priority: null, value: null, size: null },
  ];

  const lines = [rankLine("a", ranking), rankLine("c", ranking), rankLine("missing", ranking)];

  assert.deepEqual(lines, [
    "Priority 1 of 1 · value for size: value 8, size 2",
    "Unranked: value and size are not set yet.",
    null,
  ]);
});

test("partLine says in progress for now and next for next", () => {
  const parts = [part("a", 1, "now"), part("b", 2, "next")];

  const lines = parts.map((problem) => partLine(problem, parts));

  assert.deepEqual(lines, ["Part 1 of 2, in progress", "Part 2 of 2, next"]);
});
