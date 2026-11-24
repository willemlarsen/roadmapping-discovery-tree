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

test("a parent whose unsolved parts are all parked shows parked", () => {
  const problems = [
    card("f", "next"), card("a", "done", "f"), card("b", "parked", "f"),
    card("g", "now"), card("c", "parked", "g"), card("d", "parked", "g"),
  ];

  const shown = displayedStates(problems);

  assert.deepEqual([shown.get("f"), shown.get("g")], ["parked", "parked"]);
});

test("a parent whose work has started, a part done or paused, shows paused; one beside only parked and next parts shows next", () => {
  const problems = [
    card("f", "next"), card("a", "done", "f"), card("b", "next", "f"),
    card("g", "now"), card("c", "paused", "g"), card("d", "parked", "g"),
    card("h", "now"), card("e", "next", "h"), card("i", "parked", "h"),
  ];

  const shown = displayedStates(problems);

  assert.deepEqual([shown.get("f"), shown.get("g"), shown.get("h")], ["paused", "paused", "next"]);
});

test("a parent judges a part that is itself a parent by what that part shows", () => {
  const problems = [
    card("f", "blocked"), card("g", "next", "f"), card("a", "now", "g"), card("b", "next", "f"),
    card("h", "next"), card("i", "now", "h"), card("c", "done", "i"), card("d", "next", "i"),
  ];

  const shown = displayedStates(problems);

  assert.deepEqual([shown.get("f"), shown.get("g"), shown.get("h"), shown.get("i")], ["now", "now", "paused", "paused"]);
});
