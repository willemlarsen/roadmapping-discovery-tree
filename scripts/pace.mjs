import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PaceInputError, paceFile } from "../src/pace/file.js";
import { forecastOrder } from "../src/pace/order.js";
import { LogParseError, parseLog } from "../src/pace/parse.js";
import { validateRoadmap } from "../src/validate.js";

export const DEFAULT_REMAINING_CYCLES = 16;
export const GIT_LOG_ARGUMENTS = ["log", "--format=%h%x1f%aI%x1f%s", "-n", "5000"];
export const GIT_LOG_MAX_BYTES = 10_000_000;

class Failure extends Error {
  constructor(code, detail = null) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

export function run(effects) {
  try {
    return generate(effects);
  } catch (error) {
    return failureResult(error);
  }
}

function failureResult(error) {
  const failure = error instanceof Failure ? error : new Failure("unexpected_error");
  const detail = failure.detail === null ? "" : ` (${failure.detail})`;
  return { exitCode: 1, message: `pace file not written: ${failure.code}${detail}` };
}

function generate({ readGitLog, readRoadmap, writeFile, now }) {
  const commits = refuseWith("log_invalid", LogParseError, () => parseLog(attempt("git_unavailable", readGitLog)));
  const roadmap = attempt("roadmap_unreadable", readRoadmap);
  if (!validateRoadmap(roadmap).valid) throw new Failure("roadmap_invalid");
  const cards = forecastOrder(roadmap.problems).map((problem) => ({ id: problem.id, remainingCycles: DEFAULT_REMAINING_CYCLES }));
  const generatedAt = now().toISOString().replace(/\.\d{3}Z$/, "Z");
  const file = refuseWith("input_invalid", PaceInputError, () => paceFile({ commits, cards, generatedAt }));
  attempt("write_failed", () => writeFile(`${JSON.stringify(file, null, 2)}\n`));
  return { exitCode: 0, message: `pace file written: ${file.status}` };
}

function attempt(code, action) {
  try {
    return action();
  } catch {
    throw new Failure(code);
  }
}

function refuseWith(code, errorType, action) {
  try {
    return action();
  } catch (error) {
    throw error instanceof errorType ? new Failure(code, error.message) : error;
  }
}

const isInside = (parent, child) => {
  const path = relative(parent, child);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};

const isReallyInside = (parent, child) => !existsSync(child) || isInside(realpathSync(parent), realpathSync(child));

function resolveRoadmapDir(root, roadmapDir) {
  const dir = resolve(root, roadmapDir);
  if (!isInside(root, dir) || !isReallyInside(root, dir)) {
    throw new Failure("roadmap_dir_outside_repo", "--roadmap must name a directory inside the repo");
  }
  return dir;
}

function resolveGitDir(root, gitDir) {
  const dir = resolve(root, gitDir);
  if (statSync(dir, { throwIfNoEntry: false })?.isDirectory() !== true) {
    throw new Failure("git_dir_missing", "--git must name an existing directory");
  }
  return dir;
}

export function main(root, now = () => new Date(), { roadmapDir = "roadmap", gitDir = "." } = {}) {
  try {
    return forecastInto(resolveRoadmapDir(root, roadmapDir), resolveGitDir(root, gitDir), now);
  } catch (error) {
    return failureResult(error);
  }
}

function forecastInto(roadmapPath, gitPath, now) {
  const paceFilePath = join(roadmapPath, "pace.json");
  return run({
    readGitLog: () => execFileSync("git", GIT_LOG_ARGUMENTS, {
      cwd: gitPath, encoding: "utf8", maxBuffer: GIT_LOG_MAX_BYTES, stdio: ["ignore", "pipe", "ignore"],
    }),
    readRoadmap: () => JSON.parse(readFileSync(join(roadmapPath, "roadmap.json"), "utf8")),
    writeFile: (text) => {
      writeFileSync(`${paceFilePath}.tmp`, text);
      renameSync(`${paceFilePath}.tmp`, paceFilePath);
    },
    now,
  });
}

const OPTION_OF_FLAG = new Map([["--roadmap", "roadmapDir"], ["--git", "gitDir"]]);
const USAGE_FAILURE = { exitCode: 1, message: "pace file not written: usage (accepted: --roadmap <dir>, --git <dir>)" };

const isFlagValue = (value) => typeof value === "string" && !value.startsWith("--");

export function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const option = OPTION_OF_FLAG.get(argv[index]);
    if (option === undefined || !isFlagValue(argv[index + 1])) return null;
    options[option] = argv[index + 1];
  }
  return options;
}

export function cli(argv, root, now) {
  const options = parseArgs(argv);
  return options === null ? USAGE_FAILURE : main(root, now, options);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = cli(process.argv.slice(2), dirname(dirname(fileURLToPath(import.meta.url))));
  (result.exitCode === 0 ? console.log : console.error)(result.message);
  process.exitCode = result.exitCode;
}
