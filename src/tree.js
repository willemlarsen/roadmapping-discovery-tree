export function buildTree(roadmap) {
  const nodesUnder = (parentId) =>
    sortSiblings(roadmap.problems.filter((entry) => entry.parent === parentId && !isParked(entry))).map(toNode);

  const toNode = (entry) => withChildren(entry, nodesUnder(entry.id));

  const withChildren = (entry, children) => ({
    id: entry.id,
    problem: entry.problem,
    status: entry.status,
    order: entry.order,
    statusSince: entry.statusSince,
    waitingOn: entry.waitingOn,
    resumesAfter: entry.resumesAfter,
    resumesAfterProblem: roadmap.problems.find((other) => other.id === entry.resumesAfter)?.problem,
    doneOn: entry.doneOn,
    confirmedBy: entry.confirmedBy,
    doneWithOpenChild: entry.status === "done" && children.some((child) => child.status !== "done"),
    children,
  });

  const parked = sortSiblings(roadmap.problems.filter(isParked)).map(toNode);

  return deepFreeze({ goal: roadmap.goal, children: nodesUnder(null), parked });
}

function isParked(entry) {
  return entry.status === "parked";
}

export function sortSiblings(siblings) {
  return [...siblings].sort((left, right) => left.order - right.order);
}

export function activePartsOf(parentId, problems) {
  return sortSiblings(problems.filter((entry) => entry.parent === parentId && !isParked(entry)));
}

function deepFreeze(value) {
  Object.values(value).forEach((child) => {
    if (typeof child === "object" && child !== null) deepFreeze(child);
  });
  return Object.freeze(value);
}
