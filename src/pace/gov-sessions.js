import { isCycleCommit } from "./cycle.js";
import { sessionOf, sessionsInProgress } from "./sizes.js";

export function govSessions(commits) {
  const cycleCommits = commits.filter((commit) => isCycleCommit(commit.subject));
  const inProgress = new Set(sessionsInProgress(cycleCommits));
  const byToken = Map.groupBy(cycleCommits, sessionOf);
  return [...byToken]
    .filter(([token]) => !inProgress.has(token))
    .map(([token, own]) => {
      const times = own.map((commit) => commit.at);
      return { token, firstAt: Math.min(...times), lastAt: Math.max(...times), cycles: own.length };
    })
    .sort((a, b) => a.firstAt - b.firstAt);
}
