import { test } from "node:test";
import assert from "node:assert/strict";
import { paceFile, MAX_REMAINING_CYCLES } from "../src/pace/file.js";
import { SIMULATION_SEED } from "../src/pace/simulate.js";
import { forecastOrder } from "../src/pace/order.js";
import { validatePace } from "../src/pace/validate.js";
import { buildStartedLaterOn, workdayOn } from "./support/commits.mjs";
import { FORECAST_ROADMAP } from "./support/pace.mjs";

test("sufficient history becomes a versioned pace file with a result per card and its remaining-cycle assumption", () => {
  const days = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"];
  const note = { at: Date.parse("2026-10-30T09:45:00Z"), day: "2026-10-30", subject: "tasks: note" };
  const spacings = [12, 58, 26, 44, 37];
  const commits = [...days.flatMap((day, index) => workdayOn(day, { spacingMinutes: spacings[index] })), note];
  const cards = [{ id: "forecast-001", remainingCycles: 7 }, { id: "up-007", remainingCycles: 10 }];

  const file = paceFile({ commits, cards, generatedAt: "2026-10-31T12:00:00Z" });

  assert.deepEqual(file, {
    contractVersion: 3,
    generator: "scripts/pace.mjs",
    generatedAt: "2026-10-31T12:00:00Z",
    status: "ok",
    inputs: {
      sessionGapMinutes: 60,
      windowDays: 4,
      rollingDays: 14,
      dailyCapHours: 10,
      simulationSeed: SIMULATION_SEED,
      commits: 21,
      cycleCommits: 20,
      cycleIntervals: 15,
      activeDays: 5,
      sizeSamples: [],
    },
    pace: { hoursPerDay: 2.0625 },
    results: [
      { id: "forecast-001", remainingCycles: 7, p50Hours: 4.116666666666666, p85Hours: 4.883333333333334, p95Hours: 5.3, p50Date: "2026-11-03", p85Date: "2026-11-04" },
      { id: "up-007", remainingCycles: 10, p50Hours: 10.033333333333333, p85Hours: 11.15, p95Hours: 11.8, p50Date: "2026-11-06", p85Date: "2026-11-09" },
    ],
  });
});

test("insufficient history is written as that state, with a closed reason and no results", () => {
  const generatedAt = "2026-10-31T12:00:00Z";
  const cards = [{ id: "forecast-001", remainingCycles: 7 }];
  const threeDays = ["2026-10-28", "2026-10-29", "2026-10-30"].flatMap((day) => workdayOn(day));
  const loneCommits = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"].flatMap((day) => workdayOn(day, { cycles: 1 }));
  const inputsFor = (counts) => ({
    sessionGapMinutes: 60, windowDays: 4, rollingDays: 14, dailyCapHours: 10, simulationSeed: SIMULATION_SEED, sizeSamples: [], ...counts,
  });

  const fourDays = ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"].flatMap((day) => workdayOn(day));
  const fewDays = paceFile({ commits: threeDays, cards, generatedAt });
  const noIntervals = paceFile({ commits: loneCommits, cards, generatedAt });
  const justEnough = paceFile({ commits: fourDays, cards, generatedAt });

  assert.deepEqual(fewDays, {
    contractVersion: 3,
    generator: "scripts/pace.mjs",
    generatedAt,
    status: "insufficient",
    reason: "too_few_active_days",
    inputs: inputsFor({ commits: 12, cycleCommits: 12, cycleIntervals: 9, activeDays: 3 }),
    results: [],
  });
  assert.deepEqual(noIntervals, {
    contractVersion: 3,
    generator: "scripts/pace.mjs",
    generatedAt,
    status: "insufficient",
    reason: "no_cycle_intervals",
    inputs: inputsFor({ commits: 5, cycleCommits: 5, cycleIntervals: 0, activeDays: 5 }),
    results: [],
  });
  assert.equal(justEnough.status, "ok");
});

test("invalid cards or a malformed generation time are refused with a closed code, and values at the limits still work", () => {
  const commits = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"].flatMap((day) => workdayOn(day));
  const generatedAt = "2026-10-31T12:00:00Z";
  const card = { id: "up-007", remainingCycles: 5 };
  const refused = [
    ["invalid_cards", "cards: invalid_cards", "not a list", generatedAt],
    ["invalid_cards", "cards: invalid_cards", { id: "up-007", remainingCycles: 5 }, generatedAt],
    ["invalid_card", "card 1: invalid_card", [null], generatedAt],
    ["invalid_card", "card 2: invalid_card", [card, { ...card, id: "" }], generatedAt],
    ["invalid_card", "card 1: invalid_card", [{ ...card, id: "Up 007" }], generatedAt],
    ["invalid_card", "card 1: invalid_card", [{ ...card, id: "a".repeat(65) }], generatedAt],
    ["invalid_card", "card 1: invalid_card", [{ ...card, id: 7 }], generatedAt],
    ...[0, -3, 2.5, "7", Number.NaN, MAX_REMAINING_CYCLES + 1].map((remainingCycles) =>
      ["invalid_card", "card 1: invalid_card", [{ ...card, remainingCycles }], generatedAt]),
    ["invalid_generated_at", "generatedAt: invalid_generated_at", [card], "yesterday"],
    ["invalid_generated_at", "generatedAt: invalid_generated_at", [card], "2026-10-31T12:00:00+02:00"],
    ["invalid_generated_at", "generatedAt: invalid_generated_at", [card], undefined],
  ];
  const limits = [{ id: "a".repeat(64), remainingCycles: 1 }, { id: "up-007", remainingCycles: MAX_REMAINING_CYCLES }];

  const atLimits = paceFile({ commits, cards: limits, generatedAt });

  refused.forEach(([code, message, cards, time]) => assert.throws(() => paceFile({ commits, cards, generatedAt: time }), {
    name: "PaceInputError",
    code,
    message,
  }, message));
  assert.deepEqual(atLimits.results.map((result) => result.remainingCycles), [1, MAX_REMAINING_CYCLES]);
});

test("a later card's range includes the work of the cards before it", () => {
  const commits = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]
    .flatMap((day, index) => workdayOn(day, { spacingMinutes: [12, 58, 26, 44, 37][index] }));
  const cards = [{ id: "up-001", remainingCycles: 5 }, { id: "up-002", remainingCycles: 5 }, { id: "up-003", remainingCycles: 5 }];

  const { results } = paceFile({ commits, cards, generatedAt: "2026-10-31T12:00:00Z" });

  const p50Hours = results.map((result) => result.p50Hours);
  const p85Hours = results.map((result) => result.p85Hours);
  assert.deepEqual([p50Hours[0] < p50Hours[1], p50Hours[1] < p50Hours[2], p85Hours[0] < p85Hours[1], p85Hours[1] < p85Hours[2]],
    [true, true, true, true]);
});

test("history older than 14 days before the generation day does not count as active days", () => {
  const generatedAt = "2026-10-31T12:00:00Z";
  const cards = [{ id: "forecast-001", remainingCycles: 7 }];
  const historyFrom = (days) => days.flatMap((day) => workdayOn(day));

  const edgeDayKept = paceFile({ commits: historyFrom(["2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21"]), cards, generatedAt });
  const edgeDayDropped = paceFile({ commits: historyFrom(["2026-10-17", "2026-10-19", "2026-10-20", "2026-10-21"]), cards, generatedAt });

  assert.deepEqual([edgeDayKept.status, edgeDayKept.inputs.activeDays], ["ok", 4]);
  assert.deepEqual([edgeDayDropped.status, edgeDayDropped.reason, edgeDayDropped.inputs.activeDays], ["insufficient", "too_few_active_days", 3]);
});

test("likely-done days count from the author's own day when the run is in the evening", () => {
  const days = ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"];
  const cards = [{ id: "forecast-001", remainingCycles: 40 }];
  const generatedAt = "2026-11-03T03:00:00Z";
  const historyAt = (newestOffset) => days.flatMap((day, index) => workdayOn(day, { offsetMinutes: index === days.length - 1 ? newestOffset : 0 }));

  const evening = paceFile({ commits: historyAt(-420), cards, generatedAt });
  const utcAuthor = paceFile({ commits: historyAt(0), cards, generatedAt });

  assert.deepEqual([evening.results[0].p50Date, evening.results[0].p85Date], ["2026-11-20", "2026-11-20"]);
  assert.deepEqual([utcAuthor.results[0].p50Date, utcAuthor.results[0].p85Date], ["2026-11-23", "2026-11-23"]);
});

test("paceFile_withThreeOrMoreBuildSizes_samplesCardCyclesAndOtherwiseKeepsTheFixedNumber", () => {
  const days = ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"];
  const historyOf = (cyclesPerDay) => [...days.flatMap((day, index) => workdayOn(day, { cycles: cyclesPerDay[index] })), buildStartedLaterOn(days[3])];
  const cards = [{ id: "forecast-001", remainingCycles: 20 }, { id: "up-007", remainingCycles: 20 }];
  const generatedAt = "2026-10-31T12:00:00Z";

  const sampled = paceFile({ commits: historyOf([6, 6, 6, 6]), cards, generatedAt }).results;
  const varied = paceFile({ commits: historyOf([5, 7, 9, 11]), cards, generatedAt }).results;
  const exactlyThree = paceFile({ commits: historyOf([6, 6, 6, 4]), cards, generatedAt }).results;
  const fallback = paceFile({ commits: historyOf([6, 6, 4, 4]), cards, generatedAt }).results;

  assert.deepEqual(sampled.map((result) => [result.remainingCycles, result.p50Hours, result.p85Hours]), [[6, 3, 3], [6, 6, 6]]);
  assert.deepEqual(exactlyThree.map((result) => [result.remainingCycles, result.p50Hours]), [[6, 3], [6, 6]]);
  assert.deepEqual(varied.map((result) => result.remainingCycles), [7, 7]);
  assert.equal(varied[0].p85Hours, 5.5);
  assert.deepEqual(fallback.map((result) => [result.remainingCycles, result.p50Hours]), [[20, 10], [20, 20]]);
});

test("paceFile_withRepeatedCycleIdsAndFixCommits_neitherWidensNorRecordsRiskTerms", () => {
  const days = ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"];
  const plain = days.flatMap((day) => workdayOn(day));
  const noisy = [
    ...plain,
    { at: Date.parse("2026-10-30T11:00:00Z"), day: "2026-10-30", offsetMinutes: 0, subject: "C1: a behaviour done a second time (gov-20261030)" },
    { at: Date.parse("2026-10-30T11:05:00Z"), day: "2026-10-30", offsetMinutes: 0, subject: "fix: a review finding (gov-20261030)" },
  ];
  const cards = [{ id: "forecast-001", remainingCycles: 10 }];
  const generatedAt = "2026-10-31T12:00:00Z";

  const quiet = paceFile({ commits: plain, cards, generatedAt });
  const withNoise = paceFile({ commits: noisy, cards, generatedAt });

  assert.deepEqual(withNoise.results[0].p85Hours, 5);
  assert.equal(withNoise.inputs.overrunSessions, undefined);
  assert.equal(withNoise.inputs.reworkPercent, undefined);
  assert.equal(quiet.inputs.reworkPercent, undefined);
});

test("paceFile_withFinishedBuilds_recordsTheirSizesAndTheFileValidates", () => {
  const days = ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"];
  const historyOf = (cyclesPerDay) => [...cyclesPerDay.flatMap((cycles, index) => workdayOn(days[index], { cycles })), buildStartedLaterOn(days[cyclesPerDay.length - 1])];
  const cards = FORECAST_ROADMAP.problems.map((problem) => ({ id: problem.id, remainingCycles: 16 }));
  const generatedAt = "2026-10-31T12:00:00Z";
  const stateOf = (file) => validatePace(file, FORECAST_ROADMAP, "2026-11-01T00:00:00Z").state;

  const sampled = paceFile({ commits: historyOf([11, 5, 9, 7]), cards, generatedAt });
  const fallback = paceFile({ commits: historyOf([6, 4, 4, 4]), cards, generatedAt });
  const insufficient = paceFile({ commits: historyOf([6, 6, 6]), cards, generatedAt });

  assert.deepEqual([sampled.inputs.sizeSamples, fallback.inputs.sizeSamples, insufficient.inputs.sizeSamples], [[5, 7, 9, 11], [6], [6, 6, 6]]);
  assert.deepEqual([sampled, fallback, insufficient].map(stateOf), ["ok", "ok", "insufficient"]);
});

test("paceFile_and_forecastOrder_withValueAndSize_giveTheSameOutputAsWithout", () => {
  const days = ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"];
  const commits = [...days.flatMap((day) => workdayOn(day, { cycles: 6 })), buildStartedLaterOn(days[3])];
  const generatedAt = "2026-10-31T12:00:00Z";
  const plain = [{ id: "a", status: "next", order: 1, parent: null }, { id: "b", status: "now", order: 2, parent: null }];
  const estimated = plain.map((problem, index) => ({ ...problem, value: 8 - index * 7, size: 1 + index * 7 }));
  const cardsOf = (problems) => forecastOrder(problems).map((problem) => ({ ...problem, remainingCycles: 20 }));

  const without = paceFile({ commits, cards: cardsOf(plain), generatedAt });
  const withEstimates = paceFile({ commits, cards: cardsOf(estimated), generatedAt });

  assert.deepEqual(forecastOrder(estimated).map((problem) => problem.id), forecastOrder(plain).map((problem) => problem.id));
  assert.deepEqual(withEstimates, without);
});
