import { actualHours } from "./actual-hours.js";
import { govSessions } from "./gov-sessions.js";
import { MAX_REMAINING_CYCLES, paceFile } from "./file.js";
import { isCycleCommit } from "./cycle.js";
import { sessionOf } from "./sizes.js";

export const GAP_MINUTES = 60;
const MIN_SESSION_CYCLES = 2;
const REPLAY_CARD_ID = "replay";

export function backtest(commits) {
  return aggregate(sessionRows(commits));
}

export function sessionRows(commits) {
  return govSessions(commits).map((session) => Object.freeze(rowOf(session, commits)));
}

function rowOf(session, commits) {
  if (session.cycles < MIN_SESSION_CYCLES) return { token: session.token, excluded: "too_few_cycles" };
  if (session.cycles > MAX_REMAINING_CYCLES) return { token: session.token, excluded: "too_many_cycles" };
  const history = commits.filter((commit) => commit.at < session.firstAt);
  const forecast = paceFile({
    commits: history,
    cards: [{ id: REPLAY_CARD_ID, remainingCycles: session.cycles - 1 }],
    generatedAt: utcSeconds(session.firstAt),
  });
  if (forecast.status !== "ok") return { token: session.token, excluded: forecast.reason };
  const own = commits.filter((commit) => isCycleCommit(commit.subject) && sessionOf(commit) === session.token);
  const [{ p95Hours }] = forecast.results;
  const hours = actualHours(own, GAP_MINUTES);
  return { token: session.token, p95Hours, actualHours: hours, covered: hours <= p95Hours };
}

function utcSeconds(epochMs) {
  return `${new Date(epochMs).toISOString().slice(0, 19)}Z`;
}

function aggregate(rows) {
  const eligible = rows.filter((row) => !("excluded" in row));
  const covered = eligible.filter((row) => row.covered).length;
  return { rows, coverage: covered / eligible.length, n: eligible.length, excluded: rows.length - eligible.length };
}
