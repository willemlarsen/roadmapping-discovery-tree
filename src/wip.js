const WORKING = new Set(["now", "blocked"]);

export function innermostWorking(roadmap) {
  const working = roadmap.problems.filter((entry) => WORKING.has(entry.status));
  const parentIds = new Set(working.map((entry) => entry.parent));
  return working.filter((entry) => !parentIds.has(entry.id));
}

export function wipStatus(roadmap) {
  return { count: innermostWorking(roadmap).length, limit: roadmap.wipLimit };
}
