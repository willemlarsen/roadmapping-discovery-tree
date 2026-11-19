import { sortSiblings } from "../tree.js";

const FORECAST_STATUSES = ["now", "next"];

export function forecastOrder(problems) {
  const active = activeProblems(problems);
  const parentIds = new Set(active.map((problem) => problem.parent));
  return active.filter((problem) => !parentIds.has(problem.id));
}

export function activeProblems(problems) {
  const walked = walkInSiblingOrder(problems, null);
  return FORECAST_STATUSES.flatMap((status) => walked.filter((problem) => problem.status === status));
}

function walkInSiblingOrder(problems, parentId) {
  const siblings = sortSiblings(problems.filter((problem) => problem.parent === parentId));
  return siblings.flatMap((problem) => [problem, ...walkInSiblingOrder(problems, problem.id)]);
}
