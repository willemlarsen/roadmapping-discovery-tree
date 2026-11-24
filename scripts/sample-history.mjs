// Builds a synthetic git history for the sample products and regenerates their pace files from it.
// The sample repository's own history is too short for a forecast, so the sample forecast comes
// from this made-up history: fixed author, backdated commits, made-up session tokens.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isCalendarDate } from "../src/validate.js";
import { main as writePace } from "./pace.mjs";

const AUTHOR = { name: "Sample Builder", email: "sample@example.com" };

// Each build is one made-up working session on one of the product's own cards. The last build
// of each product is still under way, so the forecast does not count it as a finished size.
export const SAMPLE_PRODUCTS = [
  {
    roadmapDir: "roadmap",
    tokenPrefix: "5a",
    builds: [
      { card: "gp-011", cycles: 6 }, { card: "gp-011", cycles: 5 }, { card: "gp-012", cycles: 7 },
      { card: "gp-071", cycles: 5 }, { card: "gp-021", cycles: 6 }, { card: "gp-021", cycles: 4 },
    ],
  },
  {
    roadmapDir: "products/seed-library/roadmap",
    tokenPrefix: "5b",
    builds: [
      { card: "sl-001", cycles: 6 }, { card: "sl-001", cycles: 5 }, { card: "sl-001", cycles: 7 },
      { card: "sl-002", cycles: 6 }, { card: "sl-002", cycles: 5 }, { card: "sl-002", cycles: 3 },
    ],
  },
];

function commitPlan(dir, plan) {
  const git = (args, date) => execFileSync("git", args, {
    cwd: dir,
    stdio: "ignore",
    env: {
      PATH: process.env.PATH, HOME: dir, GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: AUTHOR.name, GIT_AUTHOR_EMAIL: AUTHOR.email,
      GIT_COMMITTER_NAME: AUTHOR.name, GIT_COMMITTER_EMAIL: AUTHOR.email,
      ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
    },
  });
  git(["init", "--quiet", "--initial-branch=main"]);
  plan.forEach(({ at, subject }) => git(["-c", "commit.gpgsign=false", "commit", "--allow-empty", "--quiet", "-m", subject], at));
}

export function regenerate({ root, end }) {
  return SAMPLE_PRODUCTS.map(({ roadmapDir, tokenPrefix, builds }) => {
    const gitDir = mkdtempSync(join(tmpdir(), "sample-history-"));
    try {
      commitPlan(gitDir, historyPlan(builds, { tokenPrefix, end }));
      return { roadmapDir, ...writePace(root, () => new Date(generatedAtFor(end)), { roadmapDir, gitDir }) };
    } finally {
      rmSync(gitDir, { recursive: true, force: true });
    }
  });
}

const USAGE_FAILURE = { exitCode: 1, message: "sample history not written: usage (accepted: --end <YYYY-MM-DD>)" };

function endFrom(argv, now) {
  if (argv.length === 0) return defaultEnd(now);
  const [flag, value, ...rest] = argv;
  return flag === "--end" && rest.length === 0 && typeof value === "string" && isCalendarDate(value) ? value : null;
}

export function cli(argv, root, now) {
  const end = endFrom(argv, now);
  if (end === null) return USAGE_FAILURE;
  const results = regenerate({ root, end });
  return {
    exitCode: results.some((result) => result.exitCode !== 0) ? 1 : 0,
    message: results.map((result) => `${result.roadmapDir}: ${result.message}`).join("\n"),
  };
}

const MS_PER_DAY = 86_400_000;
const SATURDAY = 6;
const SUNDAY = 0;

const isWeekday = (milliseconds) => ![SATURDAY, SUNDAY].includes(new Date(milliseconds).getUTCDay());
const dayOf = (milliseconds) => new Date(milliseconds).toISOString().slice(0, 10);

// A modest pace: a few cycles a day, half an hour or so apart, all in one morning sitting.
const DAILY_CYCLES = [3, 4, 2, 3, 4];
const CYCLE_GAPS_MINUTES = [28, 41, 33, 24, 37];
const DAY_START = "09:30:00";
const OFFSET = "-08:00";
const OFFSET_MS = -8 * 3_600_000;
const MS_PER_MINUTE = 60_000;

export const sessionToken = (tokenPrefix, number) => `gov-${tokenPrefix}${String(number).padStart(10, "0")}`;

function cyclesOf(builds, tokenPrefix) {
  return builds.flatMap(({ card, cycles }, index) => Array.from({ length: cycles }, (_, cycle) =>
    `C${cycle + 1}: ${card} sample cycle ${cycle + 1} of ${cycles} (${sessionToken(tokenPrefix, index + 1)})`));
}

function cyclesPerDay(total) {
  const counts = [];
  for (let left = total; left > 0; left -= counts.at(-1)) counts.push(Math.min(left, DAILY_CYCLES[counts.length % DAILY_CYCLES.length]));
  return counts;
}

const localTime = (milliseconds) => `${new Date(milliseconds + OFFSET_MS).toISOString().slice(0, 19)}${OFFSET}`;

function timesOn(day, count) {
  const times = [Date.parse(`${day}T${DAY_START}${OFFSET}`)];
  while (times.length < count) times.push(times.at(-1) + CYCLE_GAPS_MINUTES[times.length - 1] * MS_PER_MINUTE);
  return times.map(localTime);
}

export function historyPlan(builds, { tokenPrefix, end }) {
  const subjects = cyclesOf(builds, tokenPrefix);
  const counts = cyclesPerDay(subjects.length);
  const times = workdaysEndingOn(end, counts.length).flatMap((day, index) => timesOn(day, counts[index]));
  return subjects.map((subject, index) => ({ at: times[index], subject }));
}

export const defaultEnd = (now) => dayOf(now.getTime() - MS_PER_DAY);

export const generatedAtFor = (end) => `${end}T23:59:00Z`;

export function workdaysEndingOn(end, count) {
  const days = [];
  for (let at = Date.parse(`${end}T00:00:00Z`); days.length < count; at -= MS_PER_DAY) {
    if (isWeekday(at)) days.unshift(dayOf(at));
  }
  return days;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = cli(process.argv.slice(2), dirname(dirname(fileURLToPath(import.meta.url))), new Date());
  (result.exitCode === 0 ? console.log : console.error)(result.message);
  process.exitCode = result.exitCode;
}
