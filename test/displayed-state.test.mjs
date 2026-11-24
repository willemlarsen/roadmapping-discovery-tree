import test from "node:test";
import assert from "node:assert/strict";
import { displayedStates } from "../src/displayed-state.js";

const card = (id, status, parent = null) => ({ id, parent, status });

test("a card with no parts shows its own status", () => {
  const problems = [card("a", "blocked"), card("b", "merged")];

  const shown = displayedStates(problems);

  assert.deepEqual([...shown], [["a", "blocked"], ["b", "merged"]]);
});

test("a parent whose parts have not started shows next, whatever its own status", () => {
  const problems = [card("f", "now"), card("a", "next", "f"), card("b", "next", "f")];

  const shown = displayedStates(problems);

  assert.equal(shown.get("f"), "next");
});
