import { agoWords } from "./freshness.js";

export const RECENT_DECISIONS = 5;

const estimateWords = (entry, card) => `estimated ${card} at value ${entry.after.value}, size ${entry.after.size}`;

const ACTION_WORDS = {
  "coach-add": (entry, card) => `added ${card} as ${entry.after}`,
  "coach-rerank": (entry, card) => `re-ranked ${card} from ${entry.before} to ${entry.after}`,
  "coach-status": (entry, card) => `moved ${card} from ${entry.before} to ${entry.after}`,
  "coach-confirm-done": (_entry, card) => `confirmed ${card} solved`,
  "willem-override": (entry, card) => `overrode ${card} to ${entry.after}`,
  "coach-estimate": estimateWords,
  "willem-estimate-override": estimateWords,
};

// The newest decision-log entries first, in plain words. Newest means the latest instant, as in
// `lastChangedAt`; among entries at the same instant the later line in the file counts as newer.
// The log is validated before this runs, so every entry has a known action and names a card in
// the roadmap.
export function recentDecisions(entries, roadmap, now, count = RECENT_DECISIONS) {
  const titles = new Map(roadmap.problems.map((problem) => [problem.id, problem.problem]));
  const byTime = [...entries].sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  return byTime.slice(-count).reverse().map((entry) => {
    const what = ACTION_WORDS[entry.action](entry, `“${titles.get(entry.problemId)}”`);
    return `${entry.actor} ${what}, ${agoWords(Date.parse(now) - Date.parse(entry.at))}`;
  });
}
