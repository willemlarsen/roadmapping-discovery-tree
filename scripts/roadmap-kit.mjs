import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { paceCommand } from "../src/kit/pace-command.js";
import { publishCommand } from "../src/kit/publish-command.js";
import { validateCommand } from "../src/kit/validate-command.js";
import { splitArgs } from "../src/kit/args.js";
import { KIT_VERSION } from "../src/kit/version.js";
import { SNAPSHOT_SCHEMA_VERSION } from "../src/share/snapshot.js";

const USAGE = "usage: roadmap-kit validate <dir> | pace <dir> [--git <dir>] | publish --product <id> --url <base> <dir>\n";

const COMMANDS = new Map([
  ["validate", ({ roadmapDir }, deps) => validateCommand(roadmapDir, deps)],
  ["pace", paceCommand],
  ["publish", publishCommand],
]);

const isVersionCall = ([first, ...rest]) => first === "--version" && rest.length === 0;

function printVersion(deps) {
  deps.out.write(`roadmap-kit ${KIT_VERSION} snapshot-schema ${SNAPSHOT_SCHEMA_VERSION}\n`);
  return 0;
}

function refuseWithUsage(deps) {
  deps.err.write(USAGE);
  return 2;
}

export async function main(argv, deps) {
  if (isVersionCall(argv)) return printVersion(deps);
  const [commandName, ...args] = argv;
  const command = COMMANDS.get(commandName);
  const { flags, positionals } = splitArgs(args);
  if (!command || positionals.length !== 1) return refuseWithUsage(deps);
  return command({ flags, roadmapDir: positionals[0] }, deps);
}

const execText = (command, args, options = {}) => new Promise((resolve, reject) =>
  execFile(command, args, { encoding: "utf8", ...options }, (error, stdout) => (error ? reject(error) : resolve(stdout))));

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2), {
    readFile: (path) => readFile(path, "utf8"),
    cwd: process.cwd(),
    now: () => new Date(),
    git: (args, options) => execText("git", args, options),
    clock: () => new Date(),
    env: process.env,
    fetch,
    uuid: () => crypto.randomUUID(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random: Math.random,
    out: process.stdout,
    err: process.stderr,
    log: (line) => process.stderr.write(`${line}\n`),
  });
}
