import { test } from "node:test";
import assert from "node:assert/strict";
import { activeProblems, forecastOrder } from "../src/pace/order.js";
import { validateRoadmap } from "../src/validate.js";
import { run } from "../scripts/pace.mjs";
import { workdayOn } from "./support/commits.mjs";

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

function paused(id, parent, order, resumesAfter) {
  return { ...problem(id, parent, "paused", order), resumesAfter };
}

const forecastIds = (problems) => forecastOrder(problems).map((p) => p.id);

test("a paused leaf whose resumesAfter card is done is forecast in band 2, before other next leaves", () => {
  const problems = [
    problem("q", null, "next", 1), problem("d", null, "done", 2), paused("p", null, 3, "d"), problem("n", null, "now", 4),
  ];

  const ids = forecastIds(problems);

  assert.deepEqual(ids, ["n", "p", "q"]);
});

test("a next leaf with a done sibling is started work in band 2, before an earlier next leaf", () => {
  const problems = [
    problem("q", null, "next", 1), problem("a", null, "next", 2), problem("a1", "a", "done", 1), problem("a2", "a", "next", 2),
  ];

  const ids = forecastIds(problems);

  assert.deepEqual(ids, ["a2", "q"]);
});

test("a next leaf with a paused cousin under the same top card is band 2, in walk order with that cousin", () => {
  const problems = [
    problem("q", null, "next", 1), problem("a", null, "next", 2), problem("d", null, "done", 3),
    problem("b", "a", "next", 1), problem("b1", "b", "next", 1),
    problem("c", "a", "next", 2), paused("c1", "c", 1, "d"),
  ];

  const ids = forecastIds(problems);

  assert.deepEqual(ids, ["b1", "c1", "q"]);
});

test("a top-level next leaf stays in band 3 even when other trees are started", () => {
  const problems = [
    problem("t", null, "next", 1), problem("a", null, "next", 2), problem("a1", "a", "done", 1),
    problem("a2", "a", "next", 2), problem("d", null, "done", 3), problem("u", null, "next", 4),
  ];

  const ids = forecastIds(problems);

  assert.deepEqual(ids, ["a2", "t", "u"]);
});

test("a paused leaf waiting on an open leaf is forecast right after that leaf", () => {
  const problems = [problem("t", null, "next", 1), problem("x", null, "next", 2), paused("p", null, 3, "t")];

  const ids = forecastIds(problems);

  assert.deepEqual(ids, ["t", "p", "x"]);
});

test("a paused leaf waiting on an open parent is forecast after that parent's last forecast leaf", () => {
  const problems = [
    problem("t", null, "next", 1), problem("t1", "t", "next", 1), problem("t2", "t", "next", 2),
    problem("x", null, "next", 2), paused("p", null, 3, "t"),
  ];

  const ids = forecastIds(problems);

  assert.deepEqual(ids, ["t1", "t2", "p", "x"]);
});

test("a paused leaf waiting on a parked card is forecast at the end", () => {
  const problems = [
    problem("k", null, "parked", 1), problem("x", null, "next", 2), paused("p", null, 3, "k"), problem("n", null, "now", 4),
  ];

  const ids = forecastIds(problems);

  assert.deepEqual(ids, ["n", "x", "p"]);
});

test("a chain of waiters P1 on P2 on T is forecast T, P2, P1", () => {
  const problems = [
    paused("p1", null, 1, "p2"), paused("p2", null, 2, "t"), problem("t", null, "next", 3), problem("x", null, "next", 4),
  ];

  const ids = forecastIds(problems);

  assert.deepEqual(ids, ["t", "p2", "p1", "x"]);
});

test("two paused leaves waiting on one target follow it in walk order", () => {
  const problems = [
    paused("r", null, 3, "t"), problem("x", null, "next", 4), problem("t", null, "next", 1), paused("q", null, 2, "t"),
  ];

  const ids = forecastIds(problems);

  assert.deepEqual(ids, ["t", "q", "r", "x"]);
});

function card(id, parent, status, order, resumesAfter = null) {
  return { id, parent, problem: `Problem ${id}`, status, statusSince: "2026-11-23", order, slices: ["s"], resumesAfter };
}

function roadmapOf(...problems) {
  return { version: 1, goal: "Finish started work first", wipLimit: 1, staleAfterDays: 3, problems };
}

test("validateRoadmap refuses a 2-card resumesAfter loop, naming its first card in walk order", () => {
  const roadmap = roadmapOf(
    card("up-003", null, "paused", 3, "up-002"), card("up-001", null, "now", 1), card("up-002", null, "paused", 2, "up-003"),
  );

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: false, errors: [{ problemId: "up-002", reason: "resumes_after_cycle" }] });
});

test("validateRoadmap refuses a 3-card loop and an indirect loop through a parent target", () => {
  const threeCardLoop = roadmapOf(
    card("up-004", null, "paused", 4, "up-002"), card("up-001", null, "now", 1),
    card("up-002", null, "paused", 2, "up-003"), card("up-003", null, "paused", 3, "up-004"),
  );
  const loopThroughParent = roadmapOf(
    card("up-012", null, "paused", 2, "up-010"), card("up-010", null, "next", 1), card("up-011", "up-010", "paused", 1, "up-012"),
  );

  const results = [threeCardLoop, loopThroughParent].map(validateRoadmap);

  assert.deepEqual(results, [
    { valid: false, errors: [{ problemId: "up-002", reason: "resumes_after_cycle" }] },
    { valid: false, errors: [{ problemId: "up-011", reason: "resumes_after_cycle" }] },
  ]);
});

function gitLogOf(commits) {
  return commits.map((commit, index) => [
    (index + 1).toString(16).padStart(7, "0"), new Date(commit.at).toISOString().replace(".000Z", "Z"), commit.subject,
  ].join("\u001f")).join("\n") + "\n";
}

function paceRunOf(roadmap) {
  const commits = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"].flatMap((day) => workdayOn(day));
  const written = [];
  const result = run({
    readGitLog: () => gitLogOf(commits),
    readRoadmap: () => roadmap,
    writeFile: (text) => written.push(text),
    now: () => new Date("2026-10-31T12:00:00.000Z"),
  });
  return { result, forecastIds: written.map((text) => JSON.parse(text).results.map((entry) => entry.id)) };
}

test("the pace script writes forecast ids in finish-started-first order and refuses a resumesAfter loop", () => {
  const ordered = roadmapOf(
    card("up-002", null, "next", 2), card("up-001", null, "now", 1), card("up-004", null, "paused", 4, "up-002"),
    card("up-003", null, "next", 3), { ...card("up-031", "up-003", "done", 1), doneOn: "2026-10-27", confirmedBy: "Amal" },
    card("up-032", "up-003", "next", 2),
  );
  const looped = roadmapOf(
    card("up-001", null, "now", 1), card("up-002", null, "paused", 2, "up-003"), card("up-003", null, "paused", 3, "up-002"),
  );

  const outcomes = [ordered, looped].map(paceRunOf);

  assert.deepEqual(outcomes, [
    { result: { exitCode: 0, message: "pace file written: ok" }, forecastIds: [["up-001", "up-032", "up-002", "up-004"]] },
    { result: { exitCode: 1, message: "pace file not written: roadmap_invalid" }, forecastIds: [] },
  ]);
  assert.deepEqual(validateRoadmap(looped).errors, [{ problemId: "up-002", reason: "resumes_after_cycle" }]);
});

test("a chain rooted on a waiter with nothing to follow stays at the end, P2 then P1, dropping no card", () => {
  const problems = [
    problem("k", null, "parked", 1), problem("x", null, "next", 2), paused("p1", null, 3, "p2"), paused("p2", null, 4, "k"),
  ];

  const ids = forecastIds(problems);

  assert.deepEqual(ids, ["x", "p2", "p1"]);
});

test("validateRoadmap refuses a loop through the second paused waiter under a parent target", () => {
  const roadmap = roadmapOf(
    card("up-020", null, "next", 1),
    card("up-021", "up-020", "paused", 1, "up-030"),
    card("up-022", "up-020", "paused", 2, "up-040"),
    { ...card("up-030", null, "done", 2), doneOn: "2026-11-20", confirmedBy: "Amal" },
    card("up-040", null, "paused", 3, "up-020"),
  );

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: false, errors: [{ problemId: "up-022", reason: "resumes_after_cycle" }] });
});

test("a paused leaf waiting on a parent whose leaves are all done, or on nothing, ranks in band 2", () => {
  const waitsOnFinishedParent = [
    problem("q", null, "next", 1), problem("t", null, "next", 2), problem("t1", "t", "done", 1), problem("t2", "t", "done", 2),
    paused("p", null, 3, "t"),
  ];
  const waitsOnNothing = [problem("q", null, "next", 1), problem("r", null, "paused", 2)];

  const ids = [waitsOnFinishedParent, waitsOnNothing].map(forecastIds);

  assert.deepEqual(ids, [["p", "q", "t"], ["r", "q"]]);
});

test("a waiter on a parent whose forecast leaves all wait elsewhere goes right after the last of them", () => {
  const problems = [
    problem("x", null, "next", 1), problem("t", null, "next", 2), paused("t1", "t", 1, "x"),
    problem("y", null, "next", 3), paused("p", null, 4, "t"),
  ];

  const ids = forecastIds(problems);

  assert.deepEqual(ids, ["x", "t1", "p", "y"]);
});

test("forecastOrder keeps every card of an unvalidated resumesAfter loop, in walk order at the end", () => {
  const problems = [problem("x", null, "next", 1), paused("p1", null, 2, "p2"), paused("p2", null, 3, "p1")];

  const ids = forecastIds(problems);

  assert.deepEqual(ids, ["x", "p1", "p2"]);
});
