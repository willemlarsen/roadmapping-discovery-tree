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

test("a parent with a part in progress, now or merged, shows now", () => {
  const problems = [
    card("f", "blocked"), card("a", "now", "f"), card("b", "blocked", "f"),
    card("g", "next"), card("c", "merged", "g"), card("d", "done", "g"),
  ];

  const shown = displayedStates(problems);

  assert.deepEqual([shown.get("f"), shown.get("g")], ["now", "now"]);
});

test("a parent with a blocked part and none in progress shows blocked", () => {
  const problems = [card("f", "now"), card("a", "blocked", "f"), card("b", "done", "f"), card("c", "next", "f")];

  const shown = displayedStates(problems);

  assert.equal(shown.get("f"), "blocked");
});

test("a parent whose parts are all done shows done", () => {
  const problems = [card("f", "next"), card("a", "done", "f"), card("b", "done", "f")];

  const shown = displayedStates(problems);

  assert.equal(shown.get("f"), "done");
});
