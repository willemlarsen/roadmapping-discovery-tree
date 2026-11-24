// Replays a short, made-up sequence of roadmap changes against a COPY of the sample, so a page
// served from that copy redraws as each change lands. The committed sample files are never touched.
import { validateDecisionLog } from "../src/decisions.js";
import { validateRoadmap } from "../src/validate.js";

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
