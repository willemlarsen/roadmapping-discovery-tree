import { test } from "node:test";
import assert from "node:assert/strict";
import { paceFile } from "../src/pace/file.js";
import { forecastOrder } from "../src/pace/order.js";
import { validatePace } from "../src/pace/validate.js";
import { lastChangedAt } from "../src/freshness.js";
import { workdayOn } from "./support/commits.mjs";
import { FORECAST_ROADMAP, insufficientPace, roadmapWith, validPace } from "./support/pace.mjs";

const NOW = "2026-10-30T00:00:00Z"; // the roadmap's newest change, before the pace file was computed
const withResult = (changes) => validPace().results.map((result, index) => (index === 0 ? { ...result, ...changes } : result));

test("validatePace accepts a pace file that fits the contract and the roadmap and marks anything else invalid", () => {
  const good = validPace();
  const hostile = [
    undefined, null, "text", 7, [],
    validPace({ contractVersion: 1 }),
    validPace({ generator: "other.mjs" }),
    validPace({ generatedAt: "yesterday" }),
    validPace({ generatedAt: "2026-02-30T00:00:00Z" }),
    validPace({ status: "maybe" }),
    validPace({ extra: "<script>alert(1)</script>" }),
    validPace({ inputs: { ...good.inputs, commits: -1 } }),
    validPace({ inputs: { ...good.inputs, activeDays: 2.5 } }),
    validPace({ inputs: { ...good.inputs, surprise: 1 } }),
    validPace({ inputs: null }),
    validPace({ pace: { hoursPerDay: 0 } }),
    validPace({ pace: { hoursPerDay: 25 } }),
    validPace({ pace: { hoursPerDay: "1.45" } }),
    validPace({ pace: { hoursPerDay: 1.45, extra: 1 } }),
    validPace({ results: "none" }),
    validPace({ results: withResult({ id: "<img src=x onerror=alert(1)>" }) }),
    validPace({ results: withResult({ remainingCycles: 0 }) }),
    validPace({ results: withResult({ remainingCycles: 201 }) }),
    validPace({ results: withResult({ p50Hours: -1 }) }),
    validPace({ results: withResult({ p50Hours: Number.NaN }) }),
    validPace({ results: withResult({ p50Hours: 3, p85Hours: 2 }) }),
    validPace({ results: withResult({ p50Date: "2026-13-01" }) }),
    validPace({ results: withResult({ p85Date: "<b>soon</b>" }) }),
    validPace({ results: withResult({ p50Date: "2026-11-03", p85Date: "2026-11-01" }) }),
    validPace({ results: withResult({ extra: 1 }) }),
    validPace({ results: [null] }),
    insufficientPace("<b>soon</b>"),
    { ...insufficientPace(), results: validPace().results },
    { ...insufficientPace(), results: "none" },
    { ...insufficientPace(), extra: 1 },
    { ...insufficientPace(), pace: { hoursPerDay: 1 } },
    { ...insufficientPace(), generatedAt: "yesterday" },
    { ...insufficientPace(), inputs: null },
    { ...insufficientPace(), generator: "other.mjs" },
    { ...insufficientPace(), contractVersion: 1 },
    { ...insufficientPace(), status: "ok" },
  ];

  const verdicts = hostile.map((pace) => validatePace(pace, FORECAST_ROADMAP, NOW).state);

  assert.deepEqual(validatePace(good, FORECAST_ROADMAP, NOW), { state: "ok", pace: good });
  assert.deepEqual(verdicts, hostile.map(() => "invalid"));
});

test("validatePace refuses an ok file whose inputs show too little history", () => {
  const good = validPace();
  const withInputs = (changes) => validPace({ inputs: { ...good.inputs, ...changes } });

  const refused = [withInputs({ activeDays: 3 }), withInputs({ activeDays: 0 }), withInputs({ cycleIntervals: 0 })];
  const enough = withInputs({ activeDays: 4, cycleIntervals: 1 });

  assert.deepEqual(refused.map((pace) => validatePace(pace, FORECAST_ROADMAP, NOW).state), ["invalid", "invalid", "invalid"]);
  assert.equal(validatePace(enough, FORECAST_ROADMAP, NOW).state, "ok");
  assert.equal(validatePace(insufficientPace(), FORECAST_ROADMAP, NOW).state, "insufficient");
});

test("validatePace calls a pace file stale only when the roadmap changed after it was computed, however old it is", () => {
  const generatedAt = "2026-10-31T20:33:29Z";
  const pace = validPace({ generatedAt });
  const stateWhenChangedAt = (changedAt) => validatePace(pace, FORECAST_ROADMAP, changedAt).state;

  assert.deepEqual(
    ["2026-10-31T20:33:30Z", "2026-10-31T12:33:30-08:00", generatedAt, "2026-10-01T00:00:00Z", null].map(stateWhenChangedAt),
    ["stale", "stale", "ok", "ok", "ok"],
  );
});

test("validatePace keeps a forecast current when the decision log is empty, since no roadmap change is known", () => {
  const pace = validPace({ generatedAt: "2020-01-01T00:00:00Z" });

  assert.equal(validatePace(pace, FORECAST_ROADMAP, lastChangedAt([])).state, "ok");
});

test("validatePace keeps a forecast dated in the future current: only a change after it makes it stale", () => {
  const pace = validPace({ generatedAt: "2099-01-01T00:00:00Z" });

  assert.equal(validatePace(pace, FORECAST_ROADMAP, "2026-11-24T12:00:00Z").state, "ok");
  assert.equal(validatePace(pace, FORECAST_ROADMAP, "2099-01-01T00:00:01Z").state, "stale");
});

test("validatePace refuses results whose ranges go backwards in forecast order", () => {
  const [first, second] = validPace().results;
  const withSecond = (changes) => validPace({ results: [first, { ...second, ...changes }] });

  const backwards = [
    withSecond({ p50Hours: 0.9 }),
    withSecond({ p85Hours: 1.3, p50Hours: 1.2 }),
    withSecond({ p50Date: "2026-10-31" }),
    withSecond({ p85Date: "2026-11-01", p50Date: "2026-11-01" }),
  ];
  const level = withSecond({ p50Hours: first.p50Hours, p85Hours: first.p85Hours, p50Date: first.p50Date, p85Date: first.p85Date });

  const threeCards = roadmapWith([...FORECAST_ROADMAP.problems, { id: "up-003", parent: null, problem: "Third", status: "next", order: 3 }]);
  const thirdBackwards = validPace({ results: [first, second, { ...second, id: "up-003", p50Hours: 1.5, p85Hours: 2.6 }] });

  assert.deepEqual(backwards.map((pace) => validatePace(pace, FORECAST_ROADMAP, NOW).state), ["invalid", "invalid", "invalid", "invalid"]);
  assert.equal(validatePace(level, FORECAST_ROADMAP, NOW).state, "ok");
  assert.equal(validatePace(thirdBackwards, threeCards, NOW).state, "invalid");
});

test("validatePace calls a well-formed file outdated when its cards no longer match the roadmap", () => {
  const threeCards = roadmapWith([...FORECAST_ROADMAP.problems, { id: "up-003", parent: null, problem: "Third", status: "next", order: 3 }]);
  const renamedCards = roadmapWith(FORECAST_ROADMAP.problems.map((problem) => ({ ...problem, id: `${problem.id}-new` })));
  const reordered = roadmapWith(FORECAST_ROADMAP.problems.map((problem) => ({ ...problem, status: "next", order: 3 - problem.order })));
  const unknownId = validPace({ results: withResult({ id: "up-404" }) });
  const duplicateId = validPace({ results: withResult({ id: "up-002" }) });
  const malformedId = validPace({ results: withResult({ id: "<img src=x>" }) });

  const outdated = [
    validatePace(validPace(), threeCards, NOW),
    validatePace(validPace(), renamedCards, NOW),
    validatePace(validPace(), reordered, NOW),
    validatePace(unknownId, FORECAST_ROADMAP, NOW),
    validatePace(duplicateId, FORECAST_ROADMAP, NOW),
  ];

  assert.deepEqual(outdated.map((verdict) => verdict.state), ["outdated", "outdated", "outdated", "outdated", "outdated"]);
  assert.equal(outdated[0].pace.generatedAt, validPace().generatedAt);
  assert.equal(validatePace(malformedId, FORECAST_ROADMAP, NOW).state, "invalid");
  assert.equal(validatePace(validPace(), threeCards, "2026-11-09T00:00:00Z").state, "stale");
});

test("validatePace_withContractVersion3_acceptsOnlyBoundedSortedIntegerSizeSamples", () => {
  const withSamples = (pace, sizeSamples, extraInputs = {}) => {
    return { ...pace, inputs: { ...pace.inputs, ...extraInputs, sizeSamples } };
  };
  const withoutSamples = withSamples(validPace(), []);
  delete withoutSamples.inputs.sizeSamples;
  const stateOf = (pace) => validatePace(pace, FORECAST_ROADMAP, NOW).state;

  const accepted = [
    withSamples(validPace(), [6, 11, 14]), withSamples(validPace(), []), withSamples(validPace(), [5, 5, 200]),
    withSamples(validPace(), Array.from({ length: 500 }, () => 7)), withSamples(insufficientPace(), [6, 11, 14]),
  ];
  const refused = [
    { ...validPace(), contractVersion: 2 }, withoutSamples, withSamples(validPace(), "6, 11"), withSamples(validPace(), [6, 7.5]), withSamples(validPace(), [4, 6]),
    withSamples(validPace(), [6, 201]), withSamples(validPace(), [11, 6]), withSamples(validPace(), [6, "7"]),
    withSamples(validPace(), Array.from({ length: 501 }, () => 7)), withSamples(validPace(), [6], { reworkPercent: 0 }), withSamples(validPace(), null),
  ];

  assert.deepEqual(accepted.map(stateOf), ["ok", "ok", "ok", "ok", "insufficient"]);
  assert.deepEqual(refused.map(stateOf), Array(11).fill("invalid"));
});

test("validatePace requires p95Hours on every result: a generated pace file carries it, and a missing, negative or non-number one is invalid", () => {
  const days = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"];
  const commits = days.flatMap((day) => workdayOn(day));
  const roadmap = FORECAST_ROADMAP;
  const cards = forecastOrder(roadmap.problems).map((problem) => ({ id: problem.id, remainingCycles: 16 }));
  const generated = paceFile({ commits, cards, generatedAt: "2026-10-31T12:00:00Z" });
  const withFirst = (changes) => ({ ...generated, results: generated.results.map((result, index) => (index === 0 ? { ...result, ...changes } : result)) });
  const withoutP95 = withFirst({});
  delete withoutP95.results[0].p95Hours;
  const stateOf = (pace) => validatePace(pace, roadmap, generated.generatedAt).state;

  const carried = generated.results.map((result) => Number.isFinite(result.p95Hours) && result.p95Hours >= result.p85Hours);
  const accepted = [generated, withFirst({ p95Hours: 0 }), withFirst({ p95Hours: 1e9 })].map(stateOf);
  const refused = [withoutP95, withFirst({ p95Hours: -0.001 }), withFirst({ p95Hours: "5.3" }), withFirst({ p95Hours: null }),
    withFirst({ p95Hours: Number.NaN }), withFirst({ p95Hours: Infinity })].map(stateOf);

  assert.deepEqual(carried, generated.results.map(() => true));
  assert.deepEqual(accepted.map((state) => state !== "invalid"), [true, true, true]);
  assert.deepEqual(refused, Array(6).fill("invalid"));
});
