import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { keyOrExit } from "../src/share/key.js";
import { createLogger } from "../src/share/log.js";
import { publish } from "../src/share/publish.js";
import { buildSnapshot } from "../src/share/snapshot.js";
import { validateSnapshot } from "../src/share/validate-snapshot.js";

const USAGE = "usage: publish-share --product <id> --roadmap <path> --url <base>\n";
const FLAGS = ["--product", "--roadmap", "--url"];

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!FLAGS.includes(argv[index]) || argv[index + 1] === undefined) return null;
    values[argv[index].slice(2)] = argv[index + 1];
  }
  return FLAGS.every((flag) => flag.slice(2) in values) ? values : null;
}

const URL_LINE = "--url must start with https://\n";
const MALFORMED_URL_LINE = "--url must be an https origin with an optional path, no query, hash or credentials\n";

const TRAVERSAL_LINE = "--url must not contain a .. path segment\n";

function decoded(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

const hasTraversal = (value) =>
  value.replace(/^https:\/\/[^/\\]*/i, "").split(/[/\\]/).some((segment) => decoded(segment) === "..");

function urlLineFor(value) {
  let base;
  try {
    base = new URL(value);
  } catch {
    return URL_LINE;
  }
  if (base.protocol !== "https:") return URL_LINE;
  const wellFormed = /^https:\/\/[^?#]*$/i.test(value) && !base.username && !base.password;
  if (!wellFormed) return MALFORMED_URL_LINE;
  return hasTraversal(value) ? TRAVERSAL_LINE : null;
}

const utc = (iso) => new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z");

async function readRoadmap(readFile, path) {
  try {
    return JSON.parse(await readFile(path));
  } catch {
    return null;
  }
}

const pacePathOf = (roadmapPath) => join(dirname(roadmapPath), "pace.json");

const readPace = (readFile, roadmapPath) => readRoadmap(readFile, pacePathOf(roadmapPath));

async function sourceCommit(git, roadmapPath) {
  let stdout;
  try {
    stdout = await git(["log", "-1", "--format=%H%x1f%cI", "--", basename(roadmapPath), "pace.json"], { cwd: dirname(roadmapPath) });
  } catch {
    return null;
  }
  if (stdout.trim() === "") return null;
  const [sourceRevision, committed] = stdout.trim().split("\u001f");
  return { sourceRevision, sourceCommittedAt: utc(committed) };
}

export async function main(argv, deps) {
  const args = parseArgs(argv);
  if (args === null) {
    deps.err.write(USAGE);
    return 2;
  }
  const urlLine = urlLineFor(args.url);
  if (urlLine !== null) {
    deps.err.write(urlLine);
    return 2;
  }
  const keyed = keyOrExit({ env: deps.env, err: deps.err });
  if (keyed.exitCode !== 0) return keyed.exitCode;
  const roadmap = await readRoadmap(deps.readFile, args.roadmap);
  if (!Array.isArray(roadmap?.problems)) {
    deps.err.write("roadmap unreadable or not JSON\n");
    return 1;
  }
  const commit = await sourceCommit(deps.git, args.roadmap);
  if (commit === null) {
    deps.err.write("no git commit for roadmap; commit it first\n");
    return 1;
  }
  const snapshot = buildSnapshot({
    roadmap, pace: await readPace(deps.readFile, args.roadmap), productId: args.product, generatedAt: utc(deps.clock()), ...commit,
  });
  const invalid = validateSnapshot(snapshot);
  if (invalid.length > 0) {
    deps.err.write(`snapshot invalid: ${invalid.join(", ")}\n`);
    return 1;
  }
  const result = await publish(snapshot, {
    fetch: deps.fetch, key: keyed.key, url: args.url, uuid: deps.uuid,
    log: createLogger(deps.log), sleep: deps.sleep, random: deps.random,
  });
  deps.out.write(`${result.line}\n`);
  return result.exitCode;
}

const execText = (command, args, options = {}) => new Promise((resolve, reject) =>
  execFile(command, args, { encoding: "utf8", ...options }, (error, stdout) => (error ? reject(error) : resolve(stdout))));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2), {
    readFile: (path) => readFile(path, "utf8"),
    git: (args, options) => execText("git", args, options),
    clock: () => new Date(),
    env: process.env,
    fetch,
    uuid: () => crypto.randomUUID(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random: Math.random,
    out: process.stdout,
    err: process.stderr,
    log: (line) => process.stdout.write(`${line}\n`),
  });
}
