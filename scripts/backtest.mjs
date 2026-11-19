import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DAILY_CAP_HOURS, ROLLING_DAYS, WINDOW_DAYS } from "../src/pace/hours.js";
import { MIN_SESSION_CYCLES, MIN_SIZES } from "../src/pace/sizes.js";
import { SIMULATION_SEED } from "../src/pace/simulate.js";
import { GAP_MINUTES, backtest } from "../src/pace/backtest.js";
import { LogParseError, parseLog } from "../src/pace/parse.js";
import { GIT_LOG_ARGUMENTS, GIT_LOG_MAX_BYTES } from "./pace.mjs";

const QUARTER = 0.25;
const DAY_RULE = "hours count on the day the session starts, in the commit's own UTC offset";

class Refusal extends Error {}

function refuse(code) {
  throw new Refusal(code);
}

function parsedCommits(text) {
  try {
    return parseLog(text);
  } catch (error) {
    return refuse(error instanceof LogParseError && error.code === "invalid_date" ? "timestamps_invalid" : "git_unreadable");
  }
}

function reasonCounts(rows) {
  const counts = new Map();
  rows.filter((row) => "excluded" in row).forEach((row) => counts.set(row.excluded, (counts.get(row.excluded) ?? 0) + 1));
  return [...counts].map(([reason, count]) => `${reason}=${count}`).join(", ");
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  return sorted.length % 2 ? sorted[Math.floor(middle)] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function sharpnessLine(rows) {
  const ratios = rows.filter((row) => !("excluded" in row)).map((row) => row.actualHours / row.p95Hours);
  const under = ratios.filter((ratio) => ratio < QUARTER).length / ratios.length;
  return `sharpness: median actual/p95 ${median(ratios).toFixed(3)}, share of sessions with actual under a quarter of p95 ${under.toFixed(3)}`;
}

function report(result) {
  const covered = result.rows.filter((row) => row.covered).length;
  return [
    "pace backtest",
    "forecast: one typical-size card, as the share page shows",
    `seed: ${SIMULATION_SEED}`,
    `session gap: ${GAP_MINUTES} min`,
    `daily cap: ${DAILY_CAP_HOURS} h`,
    `day rule: ${DAY_RULE}`,
    `window days: ${WINDOW_DAYS}`,
    `rolling days: ${ROLLING_DAYS}`,
    `minimum sizes: ${MIN_SIZES} finished sizes of ${MIN_SESSION_CYCLES} cycles or more`,
    `coverage: ${result.coverage.toFixed(3)} (${covered} of ${result.n} sessions covered)`,
    sharpnessLine(result.rows),
    `N: ${result.n}`,
    `excluded: ${result.excluded}`,
    `excluded reasons: ${reasonCounts(result.rows)}`,
    "",
  ].join("\n");
}

function evaluate({ git }) {
  let logText;
  try {
    logText = git(GIT_LOG_ARGUMENTS);
  } catch {
    return refuse("git_unreadable");
  }
  const commits = parsedCommits(logText);
  const result = backtest(commits);
  if (result.n === 0) refuse("no_eligible_sessions");
  return result;
}

export async function main(deps) {
  try {
    deps.out(report(evaluate(deps)));
    return 0;
  } catch (error) {
    deps.err(`backtest refused: ${error instanceof Refusal ? error.message : "unexpected_error"}\n`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  process.exitCode = await main({
    git: (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: GIT_LOG_MAX_BYTES, stdio: ["ignore", "pipe", "ignore"] }),
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
