import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveLastRerank, validateDecisionLog } from "../src/decisions.js";

const completeEntry = {
  at: "2026-10-28T13:30:00-07:00",
  problemId: "up-001",
  actor: "Amal",
  action: "coach-add",
  before: null,
  after: "now",
  why: "Seeded from the approved tree design",
};

test("a decision-log entry missing a field fails with missing_field and its line", () => {
  const fields = Object.keys(completeEntry);
  const logs = fields.map((field) =>
    [completeEntry, Object.fromEntries(Object.entries(completeEntry).filter(([key]) => key !== field))]);

  const results = logs.map((entries) => validateDecisionLog(entries));

  results.forEach((result, index) => assert.deepEqual(result,
    { valid: false, errors: [{ line: 2, reason: "missing_field", field: fields[index] }] }, fields[index]));
});

test("a decision-log line that is not an object fails once with wrong_type and its line", () => {
  const entries = [completeEntry, null, "coach-add", [completeEntry], 7];

  const result = validateDecisionLog(entries);

  assert.deepEqual(result, { valid: false, errors: [2, 3, 4, 5].map((line) => ({ line, reason: "wrong_type" })) });
});

test("a decision-log line with an action the design doesn't name fails with unknown_action", () => {
  const knownActions = ["coach-add", "coach-rerank", "coach-status", "coach-confirm-done", "willem-override"];
  const entries = [...knownActions, "coach-delete", "constructor"].map((action) => ({ ...completeEntry, action }));

  const result = validateDecisionLog(entries);

  assert.deepEqual(result, { valid: false, errors: [6, 7].map((line) => ({ line, reason: "unknown_action" })) });
});

test("a decision-log line dated before the one above it fails with out_of_order", () => {
  const times = [
    "2026-10-28T13:30:00-07:00", "2026-10-28T20:30:00Z", "2026-10-29T09:00:00Z",
    "2026-10-29T08:00:00Z", "2026-10-30T09:00:00Z", "2026-10-30T12:00:00+05:00",
  ];
  const entries = times.map((at) => ({ ...completeEntry, at }));

  const result = validateDecisionLog(entries);

  assert.deepEqual(result, { valid: false, errors: [4, 6].map((line) => ({ line, reason: "out_of_order" })) });
});

test("a status that disagrees with its latest status line in the log fails with status_disagrees", () => {
  const lines = [
    ["coach-status", "up-001", "next"], ["coach-status", "up-001", "now"], ["coach-confirm-done", "up-002", "done"],
    ["coach-add", "up-003", "next"], ["coach-status", "up-004", "next"], ["willem-override", "up-004", "parked"],
  ];
  const entries = lines.map(([action, problemId, after], index) =>
    ({ ...completeEntry, at: `2026-10-${20 + index}T09:00:00Z`, action, problemId, after }));
  const statuses = { "up-001": "now", "up-002": "next", "up-003": "paused", "up-004": "parked" };
  const roadmap = { problems: Object.entries(statuses).map(([id, status]) => ({ id, status })) };

  const result = validateDecisionLog(entries, roadmap);

  assert.deepEqual(result, { valid: false, errors: [{ line: 3, problemId: "up-002", reason: "status_disagrees" }] });
});

test("a decision log that isn't a list fails with wrong_type instead of throwing", () => {
  const logs = [null, { ...completeEntry }, "coach-add", []];

  const results = logs.map((entries) => validateDecisionLog(entries));

  assert.deepEqual(results, [
    ...[1, 2, 3].map(() => ({ valid: false, errors: [{ line: null, reason: "wrong_type" }] })),
    { valid: true, errors: [] },
  ]);
});

test("a decision-log time that isn't a real timestamp fails with invalid_date", () => {
  const notTimestamps = ["yesterday", "2026-10-28", "2026-10-28T13:30:00", "2026-13-01T00:00:00Z", "2026-11-31T09:00:00Z", "2026-10-28T25:00:00Z", 5];
  const timestamps = ["2026-10-28T13:30:00-07:00", "2026-10-28T20:30Z", "2026-10-28T20:30:00.125Z"];
  const logs = [...notTimestamps, ...timestamps].map((at) => [{ ...completeEntry, at }]);

  const results = logs.map((entries) => validateDecisionLog(entries));

  assert.deepEqual(results, [
    ...notTimestamps.map(() => ({ valid: false, errors: [{ line: 1, reason: "invalid_date", field: "at" }] })),
    ...timestamps.map(() => ({ valid: true, errors: [] })),
  ]);
});

test("a decision-log line about a problem the roadmap doesn't have fails with unknown_problem", () => {
  const problemIds = ["up-001", "up-999", "up-002", "constructor"];
  const entries = problemIds.map((problemId, index) =>
    ({ ...completeEntry, at: `2026-10-2${index}T09:00:00Z`, action: "coach-rerank", problemId }));
  const roadmap = { problems: [{ id: "up-001", status: "now" }, { id: "up-002", status: "next" }] };

  const result = validateDecisionLog(entries, roadmap);

  assert.deepEqual(result, { valid: false, errors: [
    { line: 2, problemId: "up-999", reason: "unknown_problem" },
    { line: 4, problemId: "constructor", reason: "unknown_problem" },
  ] });
});

test("a decision-log time at hour 24 fails with invalid_date", () => {
  const times = ["2026-10-31T24:00Z", "2026-10-31T24:00:00-07:00", "2026-10-31T00:00Z", "2026-10-31T23:59:59Z"];
  const logs = times.map((at) => [{ ...completeEntry, at }]);

  const results = logs.map((entries) => validateDecisionLog(entries));

  assert.deepEqual(results, [
    ...[1, 2].map(() => ({ valid: false, errors: [{ line: 1, reason: "invalid_date", field: "at" }] })),
    ...[1, 2].map(() => ({ valid: true, errors: [] })),
  ]);
});

test("a coach-estimate line is a known action and never counts as a status line", () => {
  const entries = [
    { ...completeEntry, action: "coach-status", after: "now" },
    { ...completeEntry, at: "2026-10-28T14:00:00-07:00", action: "coach-estimate", before: null, after: { value: 3, size: 2 } },
  ];
  const roadmap = { problems: [{ id: "up-001", status: "now", value: 3, size: 2 }] };

  const result = validateDecisionLog(entries, roadmap);

  assert.deepEqual(result, { valid: true, errors: [] });
});

test("a willem-estimate-override line is a known action and never counts as a status line", () => {
  const entries = [
    { ...completeEntry, action: "coach-status", after: "now" },
    { ...completeEntry, at: "2026-10-28T14:00:00-07:00", action: "willem-estimate-override", before: { value: 3, size: 2 }, after: { value: 5, size: 2 } },
  ];
  const roadmap = { problems: [{ id: "up-001", status: "now", value: 5, size: 2 }] };

  const result = validateDecisionLog(entries, roadmap);

  assert.deepEqual(result, { valid: true, errors: [] });
});

test("an estimate line whose after is not a {value, size} record from the scale fails with wrong_type", () => {
  const badShapes = [3, null, "3/2", [3, 2], { value: 3 }, { size: 2 }, { value: 4, size: 2 }, { value: 3, size: "2" }];
  const estimateLine = (action, after) => ({ ...completeEntry, action, before: null, after });
  const logFor = (action, after) => [completeEntry, estimateLine(action, after)];
  const actions = ["coach-estimate", "willem-estimate-override"];

  const results = actions.flatMap((action) => [
    validateDecisionLog(logFor(action, { value: 5, size: 3 })),
    ...badShapes.map((after) => validateDecisionLog(logFor(action, after))),
  ]);

  const rejected = { valid: false, errors: [{ line: 2, reason: "wrong_type" }] };
  assert.deepEqual(results, actions.flatMap(() => [{ valid: true, errors: [] }, ...badShapes.map(() => rejected)]));
});

test("an estimate that disagrees with its latest estimate line in the log fails with estimate_disagrees, and an override wins", () => {
  const estimate = (problemId, action, value, size, minute) => ({
    ...completeEntry, problemId, action, at: `2026-10-28T14:${minute}:00-07:00`, before: null, after: { value, size },
  });
  const entries = [
    estimate("up-001", "coach-estimate", 3, 2, "00"), estimate("up-001", "willem-estimate-override", 8, 5, "01"),
    estimate("up-002", "coach-estimate", 3, 2, "02"), estimate("up-002", "willem-estimate-override", 8, 5, "03"),
  ];
  const roadmap = { problems: [
    { id: "up-001", status: "now", value: 8, size: 5 },
    { id: "up-002", status: "now", value: 3, size: 2 },
  ] };

  const result = validateDecisionLog(entries, roadmap);

  assert.deepEqual(result, { valid: false, errors: [{ line: 4, reason: "estimate_disagrees", problemId: "up-002" }] });
});

test("a roadmap value or size with no estimate line in the log fails with estimate_disagrees, and no value, size or line is fine", () => {
  const roadmap = { problems: [
    { id: "up-001", status: "now", value: 3 },
    { id: "up-002", status: "now", size: 2 },
    { id: "up-003", status: "now" },
  ] };
  const entries = ["up-001", "up-002", "up-003"].map((problemId) => ({ ...completeEntry, problemId, action: "coach-status", after: "now" }));

  const result = validateDecisionLog(entries, roadmap);

  assert.deepEqual(result, { valid: false, errors: [
    { line: null, reason: "estimate_disagrees", problemId: "up-001" },
    { line: null, reason: "estimate_disagrees", problemId: "up-002" },
  ] });
});

test("the latest coach-rerank line gives {by, at, why} as a new object, and a log with no rerank line gives null", () => {
  const rerank = (at, actor, why) => ({ ...completeEntry, at, actor, action: "coach-rerank", why });
  const entries = [rerank("2026-10-30T09:00:00-07:00", "Amal", "older"), rerank("2026-10-31T12:30:00-07:00", "Amaya", "newer"), completeEntry];
  const before = structuredClone(entries);

  const derived = deriveLastRerank(entries);

  assert.deepEqual(derived, { by: "Amaya", at: "2026-10-31T12:30:00-07:00", why: "newer" });
  assert.notEqual(derived, entries[1]);
  assert.deepEqual(entries, before);
  assert.equal(deriveLastRerank([completeEntry]), null);
  assert.equal(deriveLastRerank([]), null);
});
