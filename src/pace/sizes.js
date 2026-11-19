import { isCycleCommit, SESSION_TOKEN } from "./cycle.js";

export const MIN_SESSION_CYCLES = 5;
export const MAX_SESSION_CYCLES = 200;
export const MIN_SIZES = 3;

export function buildSizes(commits) {
  const cycleCommits = commits.filter((commit) => isCycleCommit(commit.subject));
  const inProgress = sessionsInProgress(cycleCommits);
  const cyclesBySession = new Map();
  cycleCommits.forEach((commit) => {
    const session = sessionOf(commit);
    cyclesBySession.set(session, (cyclesBySession.get(session) ?? 0) + 1);
  });
  inProgress.forEach((session) => cyclesBySession.delete(session));
  return [...cyclesBySession.values()]
    .filter((cycles) => cycles >= MIN_SESSION_CYCLES)
    .map((cycles) => Math.min(cycles, MAX_SESSION_CYCLES))
    .sort((a, b) => a - b);
}

export function sessionsInProgress(cycleCommits) {
  const newestAt = Math.max(...cycleCommits.map((commit) => commit.at).filter(Number.isFinite));
  return cycleCommits.filter((commit) => commit.at === newestAt).map(sessionOf);
}

export function sessionOf(commit) {
  return SESSION_TOKEN.exec(commit.subject)[0];
}
