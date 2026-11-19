import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateDecisionLog } from "../src/decisions.js";
import { validateRoadmap } from "../src/validate.js";

const wellFormedRoadmap = {
  version: 1,
  goal: "Willem always knows where we are, in the same shape every time",
  wipLimit: 1,
  staleAfterDays: 3,
  problems: [
    {
      id: "up-001",
      parent: null,
      problem: "See which user problems are solved, in progress and next",
      status: "now",
      statusSince: "2026-10-28",
      order: 1,
      slices: ["skin-roadmap-bar"],
      waitingOn: null,
      resumesAfter: null,
      doneOn: null,
      confirmedBy: null,
    },
  ],
};

const [firstProblem] = wellFormedRoadmap.problems;
const roadmapWith = (...problems) => ({ ...wellFormedRoadmap, problems });
const secondProblemWith = (overrides) => ({ ...firstProblem, id: "up-002", order: 2, ...overrides });
const verdictOf = (errors) => ({ valid: errors.length === 0, errors });
const without = (record, ...keys) => Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));

test("a well-formed roadmap validates", () => {
  const roadmap = wellFormedRoadmap;

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: true, errors: [] });
});

test("an unknown status fails with the reason unknown_status", () => {
  const roadmaps = ["someday", "constructor"].map((status) => roadmapWith({ ...firstProblem, status }));

  const results = roadmaps.map((roadmap) => validateRoadmap(roadmap));

  results.forEach((result) => assert.deepEqual(result, { valid: false, errors: [{ problemId: "up-001", reason: "unknown_status" }] }));
});

test("each required field missing from a problem fails with missing_field", () => {
  const secondProblem = secondProblemWith({});
  const incompleteRoadmaps = ["problem", "slices"].map((field) => {
    const incomplete = without(secondProblem, field);
    return { field, roadmap: roadmapWith(firstProblem, incomplete) };
  });

  const results = incompleteRoadmaps.map(({ field, roadmap }) => ({ field, result: validateRoadmap(roadmap) }));

  results.forEach(({ field, result }) =>
    assert.deepEqual(result, { valid: false, errors: [{ problemId: "up-002", reason: "missing_field", field }] }, field));
});

test("a problem with empty required fields fails with one empty_field error per field", () => {
  const emptyProblem = secondProblemWith({ problem: "", slices: [] });
  const roadmap = roadmapWith(firstProblem, emptyProblem);

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: false, errors: [
    { problemId: "up-002", reason: "empty_field", field: "problem" },
    { problemId: "up-002", reason: "empty_field", field: "slices" },
  ] });
});

test("a roadmap missing its top-level fields fails with one missing_field error per field", () => {
  const roadmapFields = ["goal", "wipLimit", "staleAfterDays"];
  const bareRoadmap = without(wellFormedRoadmap, ...roadmapFields);

  const result = validateRoadmap(bareRoadmap);

  assert.deepEqual(result, { valid: false, errors: roadmapFields.map((field) =>
    ({ problemId: null, reason: "missing_field", field })) });
});

test("a problem with blank required fields fails with one empty_field error per field", () => {
  const blankProblem = secondProblemWith({ problem: "   ", slices: null });
  const roadmap = roadmapWith(firstProblem, blankProblem);

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: false, errors: [
    { problemId: "up-002", reason: "empty_field", field: "problem" },
    { problemId: "up-002", reason: "empty_field", field: "slices" },
  ] });
});

test("a roadmap with no problems list fails with missing_field instead of throwing", () => {
  const roadmap = without(wellFormedRoadmap, "problems");

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: false, errors: [{ problemId: null, reason: "missing_field", field: "problems" }] });
});

test("a roadmap with blank top-level fields fails with one empty_field error per field", () => {
  const roadmap = { ...wellFormedRoadmap, goal: "   ", problems: null };

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: false, errors: [
    { problemId: null, reason: "empty_field", field: "goal" },
    { problemId: null, reason: "empty_field", field: "problems" },
  ] });
});

test("a goal-only roadmap with no problems yet validates", () => {
  const roadmap = roadmapWith();

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: true, errors: [] });
});

test("a parent problem with no slices of its own validates", () => {
  const parent = { ...firstProblem, slices: [] };
  const child = secondProblemWith({ parent: firstProblem.id, order: 1 });

  const result = validateRoadmap(roadmapWith(parent, child));

  assert.deepEqual(result, { valid: true, errors: [] });
});

test("a problems value that is not a list fails with wrong_type instead of throwing", () => {
  const roadmaps = ["up-001", { up001: firstProblem }].map((problems) => ({ ...wellFormedRoadmap, problems }));

  const results = roadmaps.map((roadmap) => validateRoadmap(roadmap));

  results.forEach((result) =>
    assert.deepEqual(result, { valid: false, errors: [{ problemId: null, reason: "wrong_type", field: "problems" }] }));
});

test("a problem entry that is not an object fails once with wrong_type and its index", () => {
  const roadmap = roadmapWith(firstProblem, null, "up-002", ["up-003"]);

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: false, errors: [1, 2, 3].map((index) =>
    ({ problemId: null, reason: "wrong_type", field: "problems", index })) });
});

test("a roadmap that is not an object fails once with wrong_type instead of throwing", () => {
  const notRoadmaps = [null, "roadmap", [wellFormedRoadmap], 5];

  const results = notRoadmaps.map((value) => validateRoadmap(value));

  results.forEach((result) =>
    assert.deepEqual(result, { valid: false, errors: [{ problemId: null, reason: "wrong_type", field: "roadmap" }] }));
});

test("a problem field of the wrong kind fails with wrong_type", () => {
  const roadmap = roadmapWith(firstProblem, secondProblemWith({ problem: 5, slices: "skin-roadmap-bar" }));

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: false, errors: [
    { problemId: "up-002", reason: "wrong_type", field: "problem" },
    { problemId: "up-002", reason: "wrong_type", field: "slices" },
  ] });
});

test("a roadmap field of the wrong kind fails with wrong_type", () => {
  const roadmap = { ...wellFormedRoadmap, goal: 42, wipLimit: "one", staleAfterDays: [3] };

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: false, errors: ["goal", "wipLimit", "staleAfterDays"].map((field) =>
    ({ problemId: null, reason: "wrong_type", field })) });
});

test("roadmap limits that are not positive whole numbers fail with out_of_range", () => {
  const roadmaps = [[0, 1.5], [-1, -3]].map(([wipLimit, staleAfterDays]) => ({ ...wellFormedRoadmap, wipLimit, staleAfterDays }));

  const results = roadmaps.map((roadmap) => validateRoadmap(roadmap));

  results.forEach((result) => assert.deepEqual(result, { valid: false, errors: ["wipLimit", "staleAfterDays"].map((field) =>
    ({ problemId: null, reason: "out_of_range", field })) }));
});

test("a slices list holding anything but non-blank text fails with wrong_type", () => {
  const roadmaps = [[5], [null], ["skin-roadmap-bar", "   "]].map((slices) => roadmapWith(firstProblem, secondProblemWith({ slices })));

  const results = roadmaps.map((roadmap) => validateRoadmap(roadmap));

  results.forEach((result) =>
    assert.deepEqual(result, { valid: false, errors: [{ problemId: "up-002", reason: "wrong_type", field: "slices" }] }));
});

test("a record with a field the design doesn't know fails with unknown_field", () => {
  const roadmap = { ...roadmapWith(firstProblem, secondProblemWith({ colour: "red" })), theme: "dark" };

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: false, errors: [
    { problemId: null, reason: "unknown_field" },
    { problemId: "up-002", reason: "unknown_field" },
  ] });
});

test("a problem without an id fails with missing_field and no problem id to name", () => {
  const noId = without(secondProblemWith({}), "id");
  const roadmap = roadmapWith(firstProblem, noId, { ...noId, order: 3 });

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: false, errors: [
    { problemId: null, reason: "missing_field", field: "id" },
    { problemId: null, reason: "missing_field", field: "id" },
  ] });
});

test("problems sharing an id fail once with duplicate_id", () => {
  const twice = secondProblemWith({});
  const roadmap = roadmapWith(firstProblem, { ...firstProblem, order: 3 }, { ...firstProblem, order: 4 }, twice, { ...twice, order: 5 });

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: false, errors: [
    { problemId: "up-001", reason: "duplicate_id" },
    { problemId: "up-002", reason: "duplicate_id" },
  ] });
});

test("a problem's order must be a positive whole number", () => {
  const cases = [
    { problem: without(secondProblemWith({}), "order"), reason: "missing_field" },
    { problem: secondProblemWith({ order: "second" }), reason: "wrong_type" },
    { problem: secondProblemWith({ order: 0 }), reason: "out_of_range" },
    { problem: secondProblemWith({ order: 1.5 }), reason: "out_of_range" },
  ];

  const results = cases.map(({ problem }) => validateRoadmap(roadmapWith(firstProblem, problem)));

  results.forEach((result, index) => assert.deepEqual(result,
    { valid: false, errors: [{ problemId: "up-002", reason: cases[index].reason, field: "order" }] }, cases[index].reason));
});

test("each sibling group with a shared order fails once with duplicate_order", () => {
  const clashingRoot = secondProblemWith({ order: 1 });
  const childOne = secondProblemWith({ id: "up-003", parent: "up-001", order: 1 });
  const childTwo = secondProblemWith({ id: "up-004", parent: "up-001", order: 2 });
  const clashingChild = secondProblemWith({ id: "up-005", parent: "up-001", order: 2 });
  const roadmap = roadmapWith(firstProblem, clashingRoot, childOne, childTwo, clashingChild);

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: false, errors: [
    { problemId: null, reason: "duplicate_order", parent: null },
    { problemId: null, reason: "duplicate_order", parent: "up-001" },
  ] });
});

test("a parent that names no problem fails with unknown_parent", () => {
  const roadmap = roadmapWith(firstProblem, secondProblemWith({ parent: "up-999", order: 1 }));

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: false, errors: [{ problemId: "up-002", reason: "unknown_parent" }] });
});

test("a problem that doesn't state its parent fails with missing_field", () => {
  const roadmap = roadmapWith(firstProblem, without(secondProblemWith({}), "parent"));

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: false, errors: [{ problemId: "up-002", reason: "missing_field", field: "parent" }] });
});

test("a problem that is its own parent fails with direct_cycle", () => {
  const roadmap = roadmapWith(firstProblem, secondProblemWith({ parent: "up-002", order: 1, slices: [] }));

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: false, errors: [
    { problemId: "up-002", reason: "empty_field", field: "slices" },
    { problemId: "up-002", reason: "direct_cycle" },
  ] });
});

test("parent links that loop through other problems fail with indirect_cycle", () => {
  const loop = [["up-002", "up-004"], ["up-003", "up-002"], ["up-004", "up-003"]]
    .map(([id, parent]) => secondProblemWith({ id, parent, order: 1 }));
  const offTheLoop = secondProblemWith({ id: "up-005", parent: "up-002", order: 2 });
  const roadmap = roadmapWith(firstProblem, ...loop, offTheLoop);

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: false, errors: ["up-002", "up-003", "up-004"].map((problemId) =>
    ({ problemId, reason: "indirect_cycle" })) });
});

test("a parked problem with children fails with parked_has_children", () => {
  const parkedIdea = secondProblemWith({ status: "parked" });
  const child = secondProblemWith({ id: "up-003", parent: "up-002", order: 1 });
  const childlessParkedIdea = secondProblemWith({ id: "up-004", status: "parked", order: 3 });
  const roadmap = roadmapWith(firstProblem, parkedIdea, child, childlessParkedIdea);

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: false, errors: [{ problemId: "up-002", reason: "parked_has_children" }] });
});

test("a next problem with a now part fails with next_has_now_part", () => {
  const nextParent = secondProblemWith({ status: "next" });
  const nowPart = secondProblemWith({ id: "up-003", parent: "up-002", order: 1 });
  const roadmap = roadmapWith(firstProblem, nextParent, nowPart);

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: false, errors: [{ problemId: "up-002", reason: "next_has_now_part" }] });
});

test("a next problem with a now record two or more levels below fails with next_has_now_descendant", () => {
  const nextGrandparent = secondProblemWith({ status: "next" });
  const nextParent = secondProblemWith({ id: "up-021", parent: "up-002", order: 1, status: "next" });
  const nowGrandchild = secondProblemWith({ id: "up-211", parent: "up-021", order: 1 });
  const roadmap = roadmapWith(firstProblem, nextGrandparent, nextParent, nowGrandchild);

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: false, errors: [
    { problemId: "up-002", reason: "next_has_now_descendant" },
    { problemId: "up-021", reason: "next_has_now_part" },
  ] });
});

test("next and now records at depth raise exactly the documented link errors", () => {
  const chain = (topStatus, middleStatus, bottomStatus) => [
    secondProblemWith({ status: topStatus, waitingOn: null }),
    secondProblemWith({ id: "up-021", parent: "up-002", order: 1, status: middleStatus, waitingOn: "design review" }),
    secondProblemWith({ id: "up-211", parent: "up-021", order: 1, status: bottomStatus }),
  ];
  const nowGrandparentWithTwoParts = [
    secondProblemWith({ status: "now" }),
    secondProblemWith({ id: "up-021", parent: "up-002", order: 1, status: "now" }),
    secondProblemWith({ id: "up-022", parent: "up-002", order: 2, status: "now" }),
  ];
  const cyclicNextAndNow = [
    secondProblemWith({ status: "next", parent: "up-004" }),
    secondProblemWith({ id: "up-003", parent: "up-002", order: 1, status: "now" }),
    secondProblemWith({ id: "up-004", parent: "up-003", order: 1, status: "now" }),
  ];
  const rows = [
    { records: chain("next", "now", "now"), errors: [{ problemId: "up-002", reason: "next_has_now_part" }] },
    { records: chain("next", "blocked", "now"), errors: [{ problemId: "up-002", reason: "next_has_now_descendant" }] },
    { records: nowGrandparentWithTwoParts, errors: [] },
    { records: cyclicNextAndNow, errors: [
      { problemId: "up-002", reason: "indirect_cycle" },
      { problemId: "up-003", reason: "indirect_cycle" },
      { problemId: "up-004", reason: "indirect_cycle" },
      { problemId: "up-002", reason: "next_has_now_part" },
    ] },
  ];

  const verdicts = rows.map(({ records }) => validateRoadmap(roadmapWith(firstProblem, ...records)));

  assert.deepEqual(verdicts, rows.map(({ errors }) => verdictOf(errors)));
});

test("next_has_now_part is not raised for a now parent with a now part or a next parent with next or merged parts", () => {
  const cases = [
    { parentStatus: "now", partStatus: "now" },
    { parentStatus: "next", partStatus: "next" },
    { parentStatus: "next", partStatus: "merged" },
  ];

  const verdicts = cases.map(({ parentStatus, partStatus }) => validateRoadmap(roadmapWith(
    secondProblemWith({ id: "up-002", status: parentStatus }),
    secondProblemWith({ id: "up-003", parent: "up-002", order: 1, status: partStatus }),
  )));

  assert.deepEqual(verdicts, cases.map(() => verdictOf([])));
});

test("a blocked problem must say what it is waiting on", () => {
  const blockedOnNothing = secondProblemWith({ status: "blocked", waitingOn: null });
  const blockedOnBlank = secondProblemWith({ id: "up-003", order: 3, status: "blocked", waitingOn: "   " });
  const blockedOnSomething = secondProblemWith({ id: "up-004", order: 4, status: "blocked", waitingOn: "design review" });
  const roadmap = roadmapWith(firstProblem, blockedOnNothing, blockedOnBlank, blockedOnSomething);

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: false, errors: ["up-002", "up-003"].map((problemId) =>
    ({ problemId, reason: "missing_field", field: "waitingOn" })) });
});

test("a paused problem must say what it resumes after", () => {
  const pausedForNothing = secondProblemWith({ status: "paused", resumesAfter: null });
  const pausedForSomething = secondProblemWith({ id: "up-003", order: 3, status: "paused", resumesAfter: "up-001" });
  const roadmap = roadmapWith(firstProblem, pausedForNothing, pausedForSomething);

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: false, errors: [{ problemId: "up-002", reason: "missing_field", field: "resumesAfter" }] });
});

test("a paused problem must resume after another problem that exists", () => {
  const pausedForNoOne = secondProblemWith({ status: "paused", resumesAfter: "up-999" });
  const pausedForItself = secondProblemWith({ id: "up-003", order: 3, status: "paused", resumesAfter: "up-003" });
  const pausedForAnother = secondProblemWith({ id: "up-004", order: 4, status: "paused", resumesAfter: "up-001" });
  const roadmap = roadmapWith(firstProblem, pausedForNoOne, pausedForItself, pausedForAnother);

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: false, errors: ["up-002", "up-003"].map((problemId) =>
    ({ problemId, reason: "unknown_resumes_after" })) });
});

test("a done problem must say when it was done and who confirmed it", () => {
  const doneUnrecorded = secondProblemWith({ status: "done", doneOn: null, confirmedBy: "  " });
  const doneRecorded = secondProblemWith({ id: "up-003", order: 3, status: "done", doneOn: "2026-10-31", confirmedBy: "Amal" });
  const roadmap = roadmapWith(firstProblem, doneUnrecorded, doneRecorded);

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: false, errors: ["doneOn", "confirmedBy"].map((field) =>
    ({ problemId: "up-002", reason: "missing_field", field })) });
});

test("only a done problem carries a done date and a confirmer", () => {
  const nextButConfirmed = secondProblemWith({ status: "next", doneOn: "2026-10-31", confirmedBy: "Amal" });
  const doneAndConfirmed = secondProblemWith({ id: "up-003", order: 3, status: "done", doneOn: "2026-10-31", confirmedBy: "Amal" });
  const roadmap = roadmapWith(firstProblem, nextButConfirmed, doneAndConfirmed);

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: false, errors: ["doneOn", "confirmedBy"].map((field) =>
    ({ problemId: "up-002", reason: "not_done_yet", field })) });
});

test("date fields must hold real calendar dates", () => {
  const vagueSince = secondProblemWith({ statusSince: "last week" });
  const impossibleDoneOn = secondProblemWith({ id: "up-003", order: 3, status: "done", doneOn: "2026-02-30", confirmedBy: "Amal" });
  const realDates = secondProblemWith({ id: "up-004", order: 4, status: "done", doneOn: "2026-10-31", confirmedBy: "Amal" });
  const monthThirteen = secondProblemWith({ id: "up-005", order: 5, statusSince: "2026-13-01" });
  const roadmap = roadmapWith(firstProblem, vagueSince, impossibleDoneOn, realDates, monthThirteen);

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: false, errors: [
    { problemId: "up-002", reason: "invalid_date", field: "statusSince" },
    { problemId: "up-003", reason: "invalid_date", field: "doneOn" },
    { problemId: "up-005", reason: "invalid_date", field: "statusSince" },
  ] });
});

test("every problem says when its status last changed", () => {
  const noSince = without(secondProblemWith({}), "statusSince");
  const nullSince = secondProblemWith({ id: "up-003", order: 3, statusSince: null });
  const blankSince = secondProblemWith({ id: "up-004", order: 4, statusSince: "  " });
  const roadmap = roadmapWith(firstProblem, noSince, nullSince, blankSince);

  const result = validateRoadmap(roadmap);

  assert.deepEqual(result, { valid: false, errors: [
    { problemId: "up-002", reason: "missing_field", field: "statusSince" },
    { problemId: "up-003", reason: "empty_field", field: "statusSince" },
    { problemId: "up-004", reason: "empty_field", field: "statusSince" },
  ] });
});

test("a status field that isn't text fails once with wrong_type", () => {
  const cases = [
    [{ status: "blocked", waitingOn: 5 }, "waitingOn"],
    [{ status: "paused", resumesAfter: {} }, "resumesAfter"],
    [{ status: "done", doneOn: "2026-10-30", confirmedBy: 7 }, "confirmedBy"],
    [{ status: "blocked", waitingOn: "A partner's review" }, null],
    [{ status: "paused", resumesAfter: "up-001" }, null],
    [{ status: "done", doneOn: "2026-10-30", confirmedBy: "Willem" }, null],
  ];
  const roadmaps = cases.map(([overrides]) => roadmapWith(firstProblem, secondProblemWith(overrides)));

  const results = roadmaps.map((roadmap) => validateRoadmap(roadmap));

  results.forEach((result, index) => {
    const field = cases[index][1];
    const errors = field ? [{ problemId: "up-002", reason: "wrong_type", field }] : [];
    assert.deepEqual(result, verdictOf(errors), JSON.stringify(cases[index][0]));
  });
});

test("a done date that isn't text fails with wrong_type", () => {
  const cases = [[5, ["doneOn"]], [{ year: 2026 }, ["doneOn"]], ["2026-10-30", []]];
  const roadmaps = cases.map(([doneOn]) =>
    roadmapWith(firstProblem, secondProblemWith({ status: "done", doneOn, confirmedBy: "Willem" })));

  const results = roadmaps.map((roadmap) => validateRoadmap(roadmap));

  results.forEach((result, index) => {
    const errors = cases[index][1].map((field) => ({ problemId: "up-002", reason: "wrong_type", field }));
    assert.deepEqual(result, verdictOf(errors), JSON.stringify(cases[index][0]));
  });
});

test("a roadmap version must be a positive whole number when given", () => {
  const cases = [["x", "wrong_type"], [0, "out_of_range"], [1.5, "out_of_range"], [2, null], [null, null]];
  const roadmaps = [...cases.map(([version]) => ({ ...wellFormedRoadmap, version })), without(wellFormedRoadmap, "version")];

  const results = roadmaps.map((roadmap) => validateRoadmap(roadmap));

  results.forEach((result, index) => {
    const reason = cases[index]?.[1];
    const errors = reason ? [{ problemId: null, reason, field: "version" }] : [];
    assert.deepEqual(result, verdictOf(errors), String(cases[index]?.[0] ?? "absent"));
  });
});

test("a problem's value and size must come from the scale 1, 2, 3, 5, 8 when given", () => {
  const estimates = [
    ["value", 4, "out_of_range"], ["size", 13, "out_of_range"], ["value", 0, "out_of_range"],
    ["size", 2.5, "wrong_type"], ["value", "3", "wrong_type"],
  ];
  const badResults = estimates.map(([field, bad]) => validateRoadmap(roadmapWith({ ...firstProblem, [field]: bad })));
  const goodResult = validateRoadmap(roadmapWith({ ...firstProblem, value: 8, size: 1 }));

  assert.deepEqual(goodResult, { valid: true, errors: [] });
  badResults.forEach((result, index) => {
    const [field, , reason] = estimates[index];
    assert.deepEqual(result, verdictOf([{ problemId: "up-001", reason, field }]), `${field} ${estimates[index][1]}`);
  });
});

test("a hand-written lastRerank fails with unknown_field", () => {
  const handWritten = { ...wellFormedRoadmap, lastRerank: { by: "Amal", at: "2026-10-28T12:00:00-07:00", why: "typed by hand" } };
  const derivedOnly = wellFormedRoadmap;

  const results = [handWritten, derivedOnly].map((roadmap) => validateRoadmap(roadmap));

  assert.deepEqual(results, [verdictOf([{ problemId: null, reason: "unknown_field" }]), verdictOf([])]);
});

test("the live roadmap and decision log validate under every rule, including next_has_now_descendant", async () => {
  const roadmap = JSON.parse(await readFile(new URL("../roadmap/roadmap.json", import.meta.url), "utf8"));
  const lines = (await readFile(new URL("../roadmap/decisions.jsonl", import.meta.url), "utf8")).split("\n").filter((line) => line.trim() !== "");
  const entries = lines.map((line) => JSON.parse(line));

  const results = [validateRoadmap(roadmap), validateDecisionLog(entries, roadmap)];

  assert.deepEqual(results, [{ valid: true, errors: [] }, { valid: true, errors: [] }]);
});
