import { innermostWorking } from "./wip.js";

export function pulsingIds(roadmap, stale) {
  if (stale) return new Set();
  const now = innermostWorking(roadmap).filter((entry) => entry.status === "now");
  return new Set(now.map((entry) => entry.id));
}
