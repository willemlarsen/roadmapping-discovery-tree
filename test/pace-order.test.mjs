import { test } from "node:test";
import assert from "node:assert/strict";
import { activeProblems, forecastOrder } from "../src/pace/order.js";

function problem(id, parent, status, order) {
  return { id, parent, status, order };
}

const CASES = [
  { name: "empty input", problems: [], expected: [] },
  { name: "only done problems", problems: [problem("a", null, "done", 1), problem("b", "a", "done", 1)], expected: [] },
  { name: "now only", problems: [problem("b", null, "now", 2), problem("a", null, "now", 1)], expected: ["a", "b"] },
  { name: "next only", problems: [problem("b", null, "next", 2), problem("a", null, "next", 1)], expected: ["a", "b"] },
  {
    name: "stable tree order, now before next, done and later skipped",
    problems: [
      problem("n2", "p", "next", 2), problem("p", null, "now", 1), problem("x", null, "later", 2),
      problem("n1", "p", "next", 1), problem("d", null, "done", 3), problem("q", null, "next", 4),
    ],
    expected: ["p", "n1", "n2", "q"],
  },
];

test("activeProblems lists only now and next problems in tree order", () => {
  for (const { name, problems, expected } of CASES) {
    const ids = activeProblems(problems).map((p) => p.id);

    assert.deepEqual(ids, expected, name);
  }
});

const FORECAST_CASES = [
  { name: "empty input", problems: [], expected: [] },
  {
    name: "an open-parent feature is left out, its open parts are listed, now before next",
    problems: [
      problem("q", null, "next", 3), problem("f", null, "now", 1), problem("f2", "f", "next", 2),
      problem("f1", "f", "now", 1), problem("s", null, "now", 2), problem("x", null, "later", 4),
    ],
    expected: ["f1", "s", "f2", "q"],
  },
  {
    name: "a feature whose parts are all done is listed, as is a feature whose parts are later",
    problems: [
      problem("f", null, "now", 1), problem("d", "f", "done", 1), problem("g", null, "next", 2), problem("l", "g", "later", 1),
    ],
    expected: ["f", "g"],
  },
];

test("forecastOrder lists only problems with no open children, now before next", () => {
  for (const { name, problems, expected } of FORECAST_CASES) {
    const ids = forecastOrder(problems).map((p) => p.id);

    assert.deepEqual(ids, expected, name);
  }
});
