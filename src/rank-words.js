import { activePartsOf } from "./tree.js";

const UNRANKED_WORDS = "Unranked: value and size are not set yet.";
const PART_STATUS_WORDS = { now: ", in progress", next: ", next" };

export function rankLine(id, ranking) {
  const entry = ranking.find((candidate) => candidate.id === id);
  if (!entry) return null;
  if (entry.priority === null) return UNRANKED_WORDS;
  const total = ranking.filter((candidate) => candidate.priority !== null).length;
  return `Priority ${entry.priority} of ${total} · value for size: value ${entry.value}, size ${entry.size}`;
}

export function partLine(problem, problems) {
  const siblings = activePartsOf(problem.parent, problems);
  return `Part ${siblings.findIndex((sibling) => sibling.id === problem.id) + 1} of ${siblings.length}${PART_STATUS_WORDS[problem.status] ?? ""}`;
}
