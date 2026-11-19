import { test } from "node:test";
import assert from "node:assert/strict";
import { main } from "../scripts/backtest.mjs";
import { buildStartedLaterOn, workdayOn } from "./support/commits.mjs";

const SEPARATOR = "\u001f";
const GIT_ARGUMENTS = ["log", "--format=%h%x1f%aI%x1f%s", "-n", "5000"];
const WORKDAYS = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-11-02"];

const gitLogOf = (commits) => commits.map((commit, index) => [
  (index + 1).toString(16).padStart(7, "0"),
  new Date(commit.at).toISOString().replace(".000Z", "Z"),
  commit.subject,
].join(SEPARATOR)).join("\n") + "\n";

const history = (days) => days.flatMap((day) => workdayOn(day));

const slowSession = workdayOn("2026-11-03", { spacingMinutes: 50 });
const oversizeSession = workdayOn("2026-11-04", { cycles: 201, spacingMinutes: 1 });
const realistic = [...history(WORKDAYS), ...slowSession, ...oversizeSession, buildStartedLaterOn("2026-11-05")];

async function runMain({ git }) {
  const calls = [];
  const out = [];
  const err = [];
  const exitCode = await main({
    git: (args) => { calls.push(args); return git(args); },
    out: (text) => out.push(text),
    err: (text) => err.push(text),
  });
  return { calls, exitCode, stdout: out.join(""), stderr: err.join("") };
}

const throwing = () => { throw new Error("fatal: /Users/secret/repo"); };

test("main_withAFakeGit_printsCoverageNAndExclusionsAndRefusesWithFixedLinesOnBadInput", async (t) => {
  await t.test("a readable history prints coverage, N, the excluded count with reasons, and the seed, gap, cap and day rule", async () => {
    const result = await runMain({ git: () => gitLogOf(realistic) });

    assert.deepEqual(result.calls, [GIT_ARGUMENTS]);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, [
      "pace backtest",
      "forecast: one typical-size card, as the share page shows",
      "seed: 20261031",
      "session gap: 60 min",
      "daily cap: 10 h",
      "day rule: hours count on the day the session starts, in the commit's own UTC offset",
      "window days: 4",
      "rolling days: 14",
      "minimum sizes: 3 finished sizes of 5 cycles or more",
      "coverage: 0.667 (2 of 3 sessions covered)",
      "sharpness: median actual/p95 1.000, share of sessions with actual under a quarter of p95 0.000",
      "N: 3",
      "excluded: 5",
      "excluded reasons: too_few_active_days=4, too_many_cycles=1",
      "",
    ].join("\n"));
  });

  const refusals = [
    ["git cannot be read", { git: throwing }, "git_unreadable"],
    ["git prints a line that is not a log line", { git: () => "garbage\n" }, "git_unreadable"],
    ["a commit has an invalid timestamp", { git: () => `abc1234${SEPARATOR}2026-13-45T99:00:00Z${SEPARATOR}C1: x (gov-0123456789ab)\n` }, "timestamps_invalid"],
    ["no session has enough history", { git: () => gitLogOf([...history(WORKDAYS.slice(0, 2)), buildStartedLaterOn("2026-10-28")]) }, "no_eligible_sessions"],
  ];
  for (const [name, deps, code] of refusals) {
    await t.test(`${name}: exit 1, one fixed stderr line, nothing on stdout`, async () => {
      const result = await runMain(deps);

      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, `backtest refused: ${code}\n`);
    });
  }
});

test("main_withAFakeGit_printsWhatIsMeasuredTheWindowsAndTheSharpnessWithoutAPaceConfig", async () => {
  const quickSessions = [
    ...history(WORKDAYS),
    ...workdayOn("2026-11-03", { spacingMinutes: 5 }),
    ...workdayOn("2026-11-04", { spacingMinutes: 10 }),
    buildStartedLaterOn("2026-11-05"),
  ];

  const result = await runMain({ git: () => gitLogOf(quickSessions) });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, [
    "pace backtest",
    "forecast: one typical-size card, as the share page shows",
    "seed: 20261031",
    "session gap: 60 min",
    "daily cap: 10 h",
    "day rule: hours count on the day the session starts, in the commit's own UTC offset",
    "window days: 4",
    "rolling days: 14",
    "minimum sizes: 3 finished sizes of 5 cycles or more",
    "coverage: 1.000 (4 of 4 sessions covered)",
    "sharpness: median actual/p95 0.667, share of sessions with actual under a quarter of p95 0.250",
    "N: 4",
    "excluded: 4",
    "excluded reasons: too_few_active_days=4",
    "",
  ].join("\n"));
});
