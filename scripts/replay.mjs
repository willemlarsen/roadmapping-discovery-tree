// Replays a short, made-up sequence of roadmap changes against a COPY of the sample, so a page
// served from that copy redraws as each change lands. The committed sample files are never touched.
import { appendFileSync, cpSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateDecisionLog } from "../src/decisions.js";
import { validateRoadmap } from "../src/validate.js";
import { defaultEnd, regenerate } from "./sample-history.mjs";

// What the pages need to run, copied so the replay never writes to a tracked file.
const SITE_PARTS = ["strip", "src", "portfolio", "roadmap", "products"];
const ROADMAP_DIR = "roadmap";

function copySite(repoRoot, copyDir) {
  rmSync(copyDir, { recursive: true, force: true });
  SITE_PARTS.forEach((part) => cpSync(join(repoRoot, part), join(copyDir, part), { recursive: true }));
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

// The copy's forecast is rebuilt from the synthetic sample history after every step, so the
// page keeps showing forecast hours as the cards change.
function refreshPace(copyDir, now) {
  regenerate({ root: copyDir, end: defaultEnd(now) });
}

export async function replay({ repoRoot, copyDir, steps, waitMs, pauseMs, sleep, now, log }) {
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

// A short sequence for the Community Garden Planner: a part starts, both parts of the weekly
// tasks card are solved (so the card shows solved), its owner confirms it, a re-rank, and the
// re-ranked card's next part starts.
export const GARDEN_STEPS = [
  {
    say: "Reminders (gp-022) moves from next to now",
    actor: "Tech Coach",
    why: "The task list is nearly done, so watering reminders start alongside it",
    changes: [{ card: "gp-022", status: "now" }],
  },
  {
    say: "The task list (gp-021) is solved",
    actor: "Product Coach",
    why: "Checked against the problem statement: each bed lists its tasks for the week",
    changes: [{ card: "gp-021", status: "done" }],
  },
  {
    say: "Reminders (gp-022) is solved, so its parent card shows solved",
    actor: "Product Coach",
    why: "Checked against the problem statement: a gardener was reminded of an overdue bed",
    changes: [{ card: "gp-022", status: "done" }],
  },
  {
    say: "The weekly tasks card (gp-002) is confirmed solved",
    actor: "Product Coach",
    why: "Both parts done; gardeners planned a week of tasks unaided",
    changes: [{ card: "gp-002", status: "done" }],
  },
  {
    say: "Re-rank: the welcome card (gp-007) moves ahead of harvest logging (gp-006)",
    actor: "Product Coach",
    why: "Sign-ups for the new season open next week; harvest logging can wait for the autumn",
    changes: [{ card: "gp-007", order: 3 }, { card: "gp-006", order: 7 }],
  },
  {
    say: "The welcome card (gp-007) and its note (gp-072) move from next to now",
    actor: "Tech Coach",
    why: "Next in line after the re-rank",
    changes: [{ card: "gp-007", status: "now" }, { card: "gp-072", status: "now" }],
  },
];

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
