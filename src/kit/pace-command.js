import { cli } from "../../scripts/pace.mjs";

export function paceCommand({ flags, roadmapDir }, deps) {
  const result = cli(["--roadmap", roadmapDir, ...flags], deps.cwd, deps.now);
  (result.exitCode === 0 ? deps.out : deps.err).write(`${result.message}\n`);
  return result.exitCode;
}
