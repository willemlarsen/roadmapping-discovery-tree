// Replays a short, made-up sequence of roadmap changes against a COPY of the sample, so a page
// served from that copy redraws as each change lands. The committed sample files are never touched.
import { appendFileSync, cpSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateDecisionLog } from "../src/decisions.js";
import { validateRoadmap } from "../src/validate.js";
import { GARDEN_STEPS } from "./replay-steps.mjs";
import { defaultEnd, regenerate } from "./sample-history.mjs";

// What the pages need to run, copied so the replay never writes to a tracked file.
const SITE_PARTS = ["strip", "src", "portfolio", "roadmap", "products"];
const ROADMAP_DIR = "roadmap";

// The copy is wiped and remade on every replay, so it carries a marker: a directory without one
// (holding anything at all) is never removed.
const MARKER = ".replay-copy";

const isReplaceable = (copyDir) => !existsSync(copyDir) || readdirSync(copyDir).length === 0 || existsSync(join(copyDir, MARKER));

function copySite(repoRoot, copyDir) {
  rmSync(copyDir, { recursive: true, force: true });
  SITE_PARTS.forEach((part) => cpSync(join(repoRoot, part), join(copyDir, part), { recursive: true }));
  writeFileSync(join(copyDir, MARKER), "Made by scripts/replay.mjs; removed and remade on every replay.\n");
}

function readState(copyDir) {
  const roadmap = JSON.parse(readFileSync(join(copyDir, ROADMAP_DIR, "roadmap.json"), "utf8"));
  const entries = readFileSync(join(copyDir, ROADMAP_DIR, "decisions.jsonl"), "utf8")
    .split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line));
  return { roadmap, entries };
}

function writeState(copyDir, { roadmap, lines }) {
  const roadmapPath = join(copyDir, ROADMAP_DIR, "roadmap.json");
  writeFileSync(`${roadmapPath}.tmp`, `${JSON.stringify(roadmap, null, 2)}\n`);
  renameSync(`${roadmapPath}.tmp`, roadmapPath);
  appendFileSync(join(copyDir, ROADMAP_DIR, "decisions.jsonl"), lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
}

const isoSeconds = (date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");

// The copy's forecast is rebuilt from the synthetic sample history after every step and dated
// at that step, so it is never older than the roadmap and the page keeps showing forecast hours
// as the cards change.
function refreshPace(copyDir, now) {
  regenerate({ root: copyDir, end: defaultEnd(now), generatedAt: isoSeconds(now) });
}

export async function replay({ repoRoot, copyDir, steps, waitMs, pauseMs, sleep, now, log }) {
  if (!isReplaceable(copyDir)) {
    log("Replay not started: the copy directory already holds something that is not a replay copy");
    return { exitCode: 1 };
  }
  copySite(repoRoot, copyDir);
  refreshPace(copyDir, now());
  for (const [index, step] of steps.entries()) {
    await sleep(index === 0 ? waitMs : pauseMs);
    const at = now();
    const where = `Step ${index + 1} of ${steps.length}`;
    let applied;
    try {
      applied = applyStep(step, readState(copyDir), isoSeconds(at));
    } catch (error) {
      if (!(error instanceof ReplayRefused)) throw error;
      log(`${where} not written: ${error.message}`);
      return { exitCode: 1 };
    }
    writeState(copyDir, applied);
    refreshPace(copyDir, at);
    log(`${where}: ${step.say}`);
  }
  log("Replay finished; the copy stays in place until the next replay.");
  return { exitCode: 0 };
}

function changeStatus(problem, { status }, { actor, why }, at) {
  const day = at.slice(0, 10);
  const done = status === "done";
  const action = done ? "coach-confirm-done" : "coach-status";
  const line = { at, problemId: problem.id, actor, action, before: problem.status, after: status, why };
  const confirmation = done ? { doneOn: day, confirmedBy: actor } : {};
  return { problem: { ...problem, status, statusSince: day, ...confirmation }, line };
}

function changeOrder(problem, { order }, { actor, why }, at) {
  const line = { at, problemId: problem.id, actor, action: "coach-rerank", before: String(problem.order), after: String(order), why };
  return { problem: { ...problem, order }, line };
}

const applyChange = (problem, change, step, at) =>
  (change.status === undefined ? changeOrder : changeStatus)(problem, change, step, at);

export class ReplayRefused extends Error {
  constructor(reason) {
    super(`replay step refused: ${reason}`);
    this.name = "ReplayRefused";
  }
}

const errorWords = (where, errors) => errors.map((error) => `${where}: ${error.problemId ?? `line ${error.line}`} ${error.reason}`).join("; ");

// Every step must leave a roadmap that validates and a decision log that agrees with it.
function refuseUnlessValid(roadmap, entries) {
  const roadmapCheck = validateRoadmap(roadmap);
  if (!roadmapCheck.valid) throw new ReplayRefused(errorWords("roadmap", roadmapCheck.errors));
  const logCheck = validateDecisionLog(entries, roadmap);
  if (!logCheck.valid) throw new ReplayRefused(errorWords("decision log", logCheck.errors));
}

// Changes are applied in the order the step lists them, so the log lines follow that order.
export function applyStep(step, { roadmap, entries }, at) {
  const byId = new Map(roadmap.problems.map((problem) => [problem.id, problem]));
  const lines = step.changes.map((change) => {
    if (!byId.has(change.card)) throw new ReplayRefused(`unknown card ${change.card}`);
    const changed = applyChange(byId.get(change.card), change, step, at);
    byId.set(change.card, changed.problem);
    return changed.line;
  });
  const next = { ...roadmap, problems: roadmap.problems.map((problem) => byId.get(problem.id)) };
  refuseUnlessValid(next, [...entries, ...lines]);
  return { roadmap: next, lines };
}

// The page re-reads its files every 5 seconds, so the default pause is a little longer than that:
// with a shorter pause the page can skip a step.
const DEFAULT_OPTIONS = { waitMs: 15000, pauseMs: 6000 };
const OPTION_OF_FLAG = new Map([["--wait", "waitMs"], ["--pause", "pauseMs"]]);
const MAX_SECONDS = 600;
const SECONDS = /^\d+(\.\d+)?$/;

export function replayOptions(argv) {
  const options = { ...DEFAULT_OPTIONS };
  for (let index = 0; index < argv.length; index += 2) {
    const option = OPTION_OF_FLAG.get(argv[index]);
    const value = argv[index + 1];
    if (option === undefined || !SECONDS.test(value ?? "") || Number(value) > MAX_SECONDS) return null;
    options[option] = Number(value) * 1000;
  }
  return options;
}

const USAGE = "replay not started: usage (accepted: --wait <seconds>, --pause <seconds>)";
const COPY_DIR = ".replay";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const options = replayOptions(process.argv.slice(2));
  if (options === null) {
    console.error(USAGE);
    process.exitCode = 1;
  } else {
    console.log(`Copying the sample site to ${COPY_DIR}/. Serve it and open the tree page:`);
    console.log(`  python3 -m http.server 8000 --directory ${COPY_DIR}`);
    console.log("  http://localhost:8000/strip/index.html");
    console.log(`The first change lands in ${options.waitMs / 1000} s, then one every ${options.pauseMs / 1000} s.`);
    const result = await replay({
      repoRoot, copyDir: join(repoRoot, COPY_DIR), steps: GARDEN_STEPS, ...options,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now: () => new Date(), log: console.log,
    });
    process.exitCode = result.exitCode;
  }
}
