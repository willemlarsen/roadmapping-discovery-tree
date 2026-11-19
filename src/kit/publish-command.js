import { join } from "node:path";
import { main as publishShare } from "../../scripts/publish-share.mjs";

export function publishCommand({ flags, roadmapDir }, deps) {
  return publishShare([...flags, "--roadmap", join(roadmapDir, "roadmap.json")], deps);
}
