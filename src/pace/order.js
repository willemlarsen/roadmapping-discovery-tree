import { sortSiblings } from "../tree.js";
import { ancestorsAbove } from "../validate.js";

const ACTIVE_STATUSES = ["now", "next"];

const FORECAST_STATUSES = new Set(["now", "paused", "next"]);

const STARTED_STATUSES = new Set(["done", "paused"]);

const RANK_BANDS = [1, 2, 3];

const isPresent = (value) => value !== undefined && value !== null;

export function forecastOrder(problems) {
  const leaves = forecastLeaves(problems);
  const parentOf = new Map(problems.map((problem) => [problem.id, problem.parent]));
  const fileLeaves = leavesInFile(problems);
  // A target is open while any leaf at or under it is not done.
  const isOpen = (target) => fileLeaves.some((leaf) => leaf.status !== "done"
    && (leaf.id === target || ancestorsAbove(leaf.id, parentOf).includes(target)));
  const isDeferred = (leaf) => leaf.status === "paused" && isPresent(leaf.resumesAfter) && isOpen(leaf.resumesAfter);
  const ranked = inRankBands(leaves.filter((leaf) => !isDeferred(leaf)), fileLeaves, parentOf);
  return withWaitersAfterTargets(ranked, leaves.filter(isDeferred), parentOf);
}

// Bands 1 (now), 2 (started work), 3 (other next), each in walk order.
function inRankBands(leaves, fileLeaves, parentOf) {
  const started = startedAncestors(fileLeaves, parentOf);
  const isStarted = (leaf) => ancestorsAbove(leaf.id, parentOf).some((id) => started.has(id));
  const bandOf = (leaf) => rankBand(leaf, isStarted);
  return RANK_BANDS.flatMap((band) => leaves.filter((leaf) => bandOf(leaf) === band));
}

// Waiters are placed targets first (by chain depth, then walk order), each directly after the last
// card already placed in its target's group, or at the end when the group has none.
function withWaitersAfterTargets(ranked, waiting, parentOf) {
  const waiterById = new Map(waiting.map((waiter) => [waiter.id, waiter]));
  const isAtOrUnder = (id, target) => id === target || ancestorsAbove(id, parentOf).includes(target);
  // A target's group: cards at or under it, and waiters on a member of the group.
  const belongsTo = (id, target) => isAtOrUnder(id, target)
    || (waiterById.has(id) && belongsTo(waiterById.get(id).resumesAfter, target));
  const depthOf = (waiter, seen = new Set([waiter])) => Math.max(0, ...waiting
    .filter((other) => !seen.has(other) && isAtOrUnder(other.id, waiter.resumesAfter))
    .map((other) => depthOf(other, new Set([...seen, other])) + 1));
  const targetsFirst = [...waiting].sort((left, right) => depthOf(left) - depthOf(right));
  const placeInGroup = (placed, waiter) =>
    insertAfter(placed, placed.findLast((card) => belongsTo(card.id, waiter.resumesAfter)), waiter);
  return targetsFirst.reduce(placeInGroup, ranked);
}

// A new sequence with card after anchor, or at the end when there is no anchor.
function insertAfter(sequence, anchor, card) {
  if (anchor === undefined) return [...sequence, card];
  return sequence.flatMap((existing) => (existing === anchor ? [existing, card] : [existing]));
}

// A forecast leaf: a now, paused or next card with no now, paused or next part.
function forecastLeaves(problems) {
  const forecastable = walkInSiblingOrder(problems, null).filter((problem) => FORECAST_STATUSES.has(problem.status));
  const parentIds = new Set(forecastable.map((problem) => problem.parent));
  return forecastable.filter((problem) => !parentIds.has(problem.id));
}

function rankBand(leaf, isStarted) {
  if (leaf.status === "now") return 1;
  return leaf.status === "paused" || isStarted(leaf) ? 2 : 3;
}

// Cards holding a leaf that is done or paused: their open parts are started work.
function startedAncestors(fileLeaves, parentOf) {
  return new Set(fileLeaves
    .filter((leaf) => STARTED_STATUSES.has(leaf.status))
    .flatMap((leaf) => ancestorsAbove(leaf.id, parentOf)));
}

// Leaves of the file: cards with no parts at all, whatever their status.
function leavesInFile(problems) {
  const parentIds = new Set(problems.map((problem) => problem.parent));
  return problems.filter((problem) => !parentIds.has(problem.id));
}

export function activeProblems(problems) {
  return walkedByStatus(problems, ACTIVE_STATUSES);
}

function walkedByStatus(problems, statuses) {
  const walked = walkInSiblingOrder(problems, null);
  return statuses.flatMap((status) => walked.filter((problem) => problem.status === status));
}

function walkInSiblingOrder(problems, parentId) {
  const siblings = sortSiblings(problems.filter((problem) => problem.parent === parentId));
  return siblings.flatMap((problem) => [problem, ...walkInSiblingOrder(problems, problem.id)]);
}
