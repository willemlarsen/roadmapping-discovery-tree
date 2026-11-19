import { activePartsOf } from "./tree.js";

const SOLVED_STATUSES = ["done", "merged"];
const OPEN_STATUSES = ["now", "next", "blocked", "paused"];

const isSolved = (part) => SOLVED_STATUSES.includes(part.status);
const isOpen = (part) => OPEN_STATUSES.includes(part.status);
const isNextFeature = (feature) => feature.status === "next";

function isStarted(parts) {
  return parts.some(isSolved) && parts.some(isOpen);
}

export function startedParts(feature, problems) {
  if (!isNextFeature(feature)) return null;
  const parts = activePartsOf(feature.id, problems);
  if (!isStarted(parts)) return null;
  return `${parts.filter(isSolved).length} of ${parts.length} parts solved`;
}
