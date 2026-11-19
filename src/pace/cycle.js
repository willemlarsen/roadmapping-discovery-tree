import { MS_PER_MINUTE } from "./time.js";

const CYCLE_ID_PREFIX = /^[A-Z]+\d+[a-z0-9]*(?:-\d+)?:/;
export const SESSION_TOKEN = /\bgov-[0-9a-f]+/;

export function isCycleCommit(subject) {
  return CYCLE_ID_PREFIX.test(subject) && SESSION_TOKEN.test(subject);
}

export function cycleMinutes(sessions) {
  return sessions.flatMap((session) => {
    const cycles = session.filter((commit) => isCycleCommit(commit.subject));
    return cycles.slice(1).map((commit, index) => (commit.at - cycles[index].at) / MS_PER_MINUTE);
  });
}
