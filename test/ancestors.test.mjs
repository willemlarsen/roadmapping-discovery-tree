import { test } from "node:test";
import assert from "node:assert/strict";
import { ancestorsAbove } from "../src/validate.js";

test("walks up to the root or to the first repeat", () => {
  const chain = new Map([["c", "b"], ["b", "a"], ["a", null]]);
  const loop = new Map([["a", "b"], ["b", "a"]]);

  const fromChain = ancestorsAbove("c", chain);
  const fromLoop = ancestorsAbove("a", loop);

  assert.deepEqual(fromChain, ["b", "a"]);
  assert.deepEqual(fromLoop, ["b"]);
});

test("pins the guard for a self-parent, an unknown parent and a three-record cycle", () => {
  const cases = [
    { name: "self-parent", start: "a", parentOf: new Map([["a", "a"]]), expected: [] },
    { name: "unknown parent", start: "c", parentOf: new Map([["c", "b"], ["b", "ghost"]]), expected: ["b", "ghost"] },
    { name: "three-record cycle", start: "a", parentOf: new Map([["a", "b"], ["b", "c"], ["c", "a"]]), expected: ["b", "c"] },
  ];

  const results = cases.map((row) => ({ name: row.name, above: ancestorsAbove(row.start, row.parentOf) }));

  assert.deepEqual(results, cases.map((row) => ({ name: row.name, above: row.expected })));
});
