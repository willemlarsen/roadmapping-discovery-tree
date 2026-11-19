import { test } from "node:test";
import assert from "node:assert/strict";
import { workingHoursWords } from "../src/pace/hours-words.js";

const plural = (n) => `About ${n} working hours left (85% likely)`;
const singular = "About 1 working hour left (85% likely)";

const rows = [
  { name: "rounds up a fraction", input: 3.2, expected: plural(4) },
  { name: "keeps a whole number", input: 4, expected: plural(4) },
  { name: "shows 1 hour as singular", input: 1, expected: singular },
  { name: "rounds a small fraction up to singular", input: 0.2, expected: singular },
  { name: "shows zero as 1 hour", input: 0, expected: singular },
  { name: "no forecast for undefined", input: undefined, expected: null },
  { name: "no forecast for null", input: null, expected: null },
  { name: "no forecast for a string", input: "3", expected: null },
  { name: "no forecast for NaN", input: NaN, expected: null },
  { name: "no forecast for Infinity", input: Infinity, expected: null },
  { name: "no forecast for a negative", input: -1, expected: null },
];

test("workingHoursWords rounds p85 hours up to whole working hours", () => {
  for (const { name, input, expected } of rows) {
    assert.equal(workingHoursWords(input), expected, name);
  }
});
