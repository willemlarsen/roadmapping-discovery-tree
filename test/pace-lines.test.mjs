import { test } from "node:test";
import assert from "node:assert/strict";
import { forecastLines, inputLines } from "../src/pace/lines.js";

const UNAVAILABLE = ["Forecast unavailable for this card."];

function part(id, status, children = []) {
  return { id, status, children };
}

function forecastOf(results) {
  return { state: "ok", pace: { results, inputs: { sizeSamples: [] } } };
}

function result(id, p50Date, p85Date, p85Hours) {
  return { id, p50Date, p85Date, p85Hours, remainingCycles: 2 };
}

const CASES = [
  {
    name: "inherits the dates of the last open part",
    node: part("f", "now", [part("a", "now"), part("b", "next")]),
    results: [result("a", "2026-11-02", "2026-11-03", 1), result("b", "2026-11-05", "2026-11-09", 5)],
    expected: ["About 5 working hours left in total (85% likely)"],
  },
  {
    name: "skips a closed last part and never borrows its dates",
    node: part("f", "now", [part("a", "next"), part("b", "done")]),
    results: [result("a", "2026-11-02", "2026-11-03", 1), result("b", "2026-11-20", "2026-11-21", 9)],
    expected: ["About 1 working hour left in total (85% likely)"],
  },
  {
    name: "finds the last open part below a part",
    node: part("f", "now", [part("a", "now", [part("a1", "next")])]),
    results: [result("a1", "2026-11-04", "2026-11-06", 2.2)],
    expected: ["About 3 working hours left in total (85% likely)"],
  },
  { name: "missing part result", node: part("f", "now", [part("a", "next")]), results: [], expected: UNAVAILABLE },
  {
    name: "non-numeric hours of a part",
    node: part("f", "now", [part("a", "next")]),
    results: [{ id: "a", p50Date: "2026-11-02", p85Date: "2026-11-03", p85Hours: "3" }],
    expected: UNAVAILABLE,
  },
  {
    name: "negative hours of a part",
    node: part("f", "now", [part("a", "next")]),
    results: [{ id: "a", p50Date: "2026-11-02", p85Date: "2026-11-03", p85Hours: -1 }],
    expected: UNAVAILABLE,
  },
  { name: "no open parts", node: part("f", "now", [part("a", "done")]), results: [], expected: UNAVAILABLE },
];

test("forecastLines shows a feature the hours left of its last open part, or says unavailable", () => {
  for (const { name, node, results, expected } of CASES) {
    const lines = forecastLines(node, forecastOf(results));

    assert.deepEqual(lines, expected, name);
  }
});

test("forecastLines words the order line as Sequence N of M with the order the work follows", () => {
  const results = [result("a", "2026-11-02", "2026-11-03"), result("b", "2026-11-05", "2026-11-09")];

  const lines = forecastLines(part("b", "next"), forecastOf(results));

  assert.equal(lines[0], "Sequence 2 of 2 · the order the work follows");
});

test("inputLines no longer repeats the Sequence order or the date sentences, since each card says it", () => {
  const inputs = { windowDays: 4, rollingDays: 14, sessionGapMinutes: 60, dailyCapHours: 10, sizeSamples: [], commits: 1, cycleCommits: 1, cycleIntervals: 1, activeDays: 1 };
  const pace = { generatedAt: "2026-11-02T00:00:00Z", pace: { hoursPerDay: 1.5 }, inputs };

  const lines = inputLines(pace);

  assert.deepEqual(lines.filter((line) => line.includes("Sequence")), []);
  assert.equal(lines.includes("The later date of each range is the planning-safe end."), false);
  assert.equal(lines.includes("Dates count Monday to Friday only; holidays are not known."), false);
});

test("inputLines says once that hours are working hours at the measured pace, counted from now", () => {
  const inputs = { windowDays: 4, rollingDays: 14, sessionGapMinutes: 60, dailyCapHours: 10, sizeSamples: [], commits: 1, cycleCommits: 1, cycleIntervals: 1, activeDays: 1 };
  const pace = { generatedAt: "2026-11-02T00:00:00Z", pace: { hoursPerDay: 1.5 }, inputs };

  const lines = inputLines(pace);

  assert.equal(lines.filter((line) => line === "Hours are working hours at the measured pace, counted from now, one card after another.").length, 1);
});

test("forecastLines takes the open part that comes last in the Sequence, not in the tree", () => {
  const node = part("f", "now", [part("a", "next"), part("b", "now")]);
  const results = [result("b", "2026-11-01", "2026-11-02", 1), result("a", "2026-11-04", "2026-11-06", 4)];

  const lines = forecastLines(node, forecastOf(results));

  assert.deepEqual(lines, ["About 4 working hours left in total (85% likely)"]);
});

test("forecastLines says unavailable when any open part of a feature has no result", () => {
  const node = part("f", "now", [part("a", "now"), part("b", "next")]);
  const results = [result("a", "2026-11-02", "2026-11-03")];

  const lines = forecastLines(node, forecastOf(results));

  assert.deepEqual(lines, UNAVAILABLE);
});

test("forecastLines words a card's own forecast as its working hours left", () => {
  const results = [{ ...result("a", "2026-11-02", "2026-11-03"), p85Hours: 2.4 }];

  const lines = forecastLines(part("a", "next"), forecastOf(results));

  assert.equal(lines[1], "About 3 working hours left (85% likely)");
});

test("forecastLines says unavailable for a card whose p85Hours is missing, not a number or negative", () => {
  for (const p85Hours of [undefined, "3", NaN, -1]) {
    const results = [{ ...result("a", "2026-11-02", "2026-11-03"), p85Hours }];

    const lines = forecastLines(part("a", "next"), forecastOf(results));

    assert.equal(lines[1], UNAVAILABLE[0], String(p85Hours));
  }
});

test("forecastLines words a feature's forecast as the working hours left in total", () => {
  const node = part("f", "now", [part("a", "next")]);
  const results = [{ ...result("a", "2026-11-02", "2026-11-03"), p85Hours: 2.4 }];

  const lines = forecastLines(node, forecastOf(results));

  assert.deepEqual(lines, ["About 3 working hours left in total (85% likely)"]);
});

test("forecastLines gives a card under sampled inputs no Estimate line, and an unsampled card its per-card Estimate line", () => {
  const results = [result("a", "2026-11-02", "2026-11-03", 2)];
  const sampled = { state: "ok", pace: { results, inputs: { sizeSamples: [1, 2, 3] } } };
  const unsampled = forecastOf(results);

  const lines = [forecastLines(part("a", "next"), sampled), forecastLines(part("a", "next"), unsampled)];

  assert.deepEqual(lines.map((card) => card.filter((line) => line.startsWith("Estimate:"))), [[], ["Estimate: assumes 2 cycles of work on this card after the cards before it."]]);
});
