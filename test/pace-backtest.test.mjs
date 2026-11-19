import { test } from "node:test";
import assert from "node:assert/strict";
import { backtest } from "../src/pace/backtest.js";
import { paceFile } from "../src/pace/file.js";
import { buildStartedLaterOn, workdayOn } from "./support/commits.mjs";

const MS_PER_MINUTE = 60_000;
const TOKEN = "gov-abcdef012345";
const HISTORY_DAYS = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"];
const TARGET_DAY = "2026-10-30";
const TARGET_START = Date.parse(`${TARGET_DAY}T09:00:00Z`);
const STEP_MINUTES = 36;
const CYCLES = 6;

const historyOf = (days) => days.flatMap((day) => workdayOn(day, { cycles: 4, spacingMinutes: 30 }));

const targetSession = (lastCommitMinute) => {
  const minutes = [...Array.from({ length: CYCLES - 1 }, (_, index) => index * STEP_MINUTES), lastCommitMinute];
  return minutes.map((minute, index) => ({
    at: TARGET_START + minute * MS_PER_MINUTE,
    day: TARGET_DAY,
    offsetMinutes: 0,
    subject: `T${index + 1}: work (${TOKEN})`,
  }));
};

const logWith = (days, lastCommitMinute) =>
  [...historyOf(days), ...targetSession(lastCommitMinute), buildStartedLaterOn(TARGET_DAY)];

test("backtest_atTheP95Boundary_countsAnSessionAtP95AsCoveredAndOneHundredthOverAsNotAndThinHistoryAsExcluded", async (t) => {
  const rows = [
    ["a session whose hours equal p95 is covered", logWith(HISTORY_DAYS, 150), { actualHours: 2.5, covered: true }],
    ["a session 0.01 h over p95 is not covered", logWith(HISTORY_DAYS, 150.6), { actualHours: 2.51, covered: false }],
  ];

  for (const [name, commits, outcome] of rows) {
    await t.test(name, () => {
      const result = backtest(commits);
      const row = result.rows.find((candidate) => candidate.token === TOKEN);

      assert.deepEqual(row, { token: TOKEN, p95Hours: 2.5, ...outcome });
      assert.equal(result.coverage, outcome.covered ? 1 : 0);
      assert.equal(result.n, 1);
      assert.equal(result.excluded, 4);
    });
  }

  await t.test("a session with too little history is excluded with its reason", () => {
    const result = backtest(logWith(HISTORY_DAYS.slice(1), 150));
    const row = result.rows.find((candidate) => candidate.token === TOKEN);

    assert.deepEqual(row, { token: TOKEN, excluded: "too_few_active_days" });
    assert.equal(result.n, 0);
    assert.equal(result.excluded, 4);
  });

  await t.test("replaying leaves the input commits untouched", () => {
    const commits = logWith(HISTORY_DAYS, 150);
    const before = structuredClone(commits);

    backtest(commits);

    assert.deepEqual(commits, before);
  });
});

const sessionOfCycles = (cycles) =>
  Array.from({ length: cycles }, (_, index) => ({
    at: TARGET_START + index * 30 * MS_PER_MINUTE,
    day: TARGET_DAY,
    offsetMinutes: 0,
    subject: `T${index + 1}: work (${TOKEN})`,
  }));

test("backtest_whenASessionHasFewCycles_forecastsOneFewerCycleThanItHasAndExcludesSingleCycleSessions", async (t) => {
  const rows = [
    ["a 1-cycle session is excluded", 1, { excluded: "too_few_cycles" }],
    ["a 2-cycle session is forecast for 1 cycle", 2, { p95Hours: 0.5, actualHours: 0.5, covered: true }],
    ["a 3-cycle session is forecast for 2 cycles", 3, { p95Hours: 1, actualHours: 1, covered: true }],
  ];

  for (const [name, cycles, outcome] of rows) {
    await t.test(name, () => {
      const commits = [...historyOf(HISTORY_DAYS), ...sessionOfCycles(cycles), buildStartedLaterOn(TARGET_DAY)];

      const result = backtest(commits);

      assert.deepEqual(result.rows.find((candidate) => candidate.token === TOKEN), { token: TOKEN, ...outcome });
    });
  }
});

const SIZED_DAYS = [["2026-10-25", 5], ["2026-10-26", 6], ["2026-10-27", 7], ["2026-10-28", 8], ["2026-10-29", 5]];

test("backtest_whenHistoryHasThreeFinishedSizes_usesTheSampledTypicalSizeForecastNotOneSizedToTheSession", () => {
  const history = SIZED_DAYS.flatMap(([day, cycles]) => workdayOn(day, { cycles, spacingMinutes: 30 }));
  const target = Array.from({ length: 3 }, (_, index) => ({
    at: TARGET_START + index * 60 * MS_PER_MINUTE,
    day: TARGET_DAY,
    offsetMinutes: 0,
    subject: `T${index + 1}: work (${TOKEN})`,
  }));
  const [{ p95Hours: sampled }] = paceFile({
    commits: history,
    cards: [{ id: "replay", remainingCycles: 2 }],
    generatedAt: "2026-10-30T09:00:00Z",
  }).results;

  const result = backtest([...history, ...target, buildStartedLaterOn(TARGET_DAY)]);

  assert.deepEqual(result.rows.find((row) => row.token === TOKEN), { token: TOKEN, p95Hours: sampled, actualHours: 2, covered: true });
  assert.ok(sampled > 2);
});
